// A room: people waiting together, then one round of Red Light, Green Light
// refereed by the SAME RedLightRound class the game uses offline.
//
//   lobby    → filling. Quick rooms start 15 s after the second person arrives
//              (at once when full); private rooms start when full, or when the
//              creator taps Start with two or more; Lagos Life match rooms
//              start when every player in the match is here (or after 30 s).
//   playing  → the referee runs at 60 Hz. Inputs in, snapshots + events out.
//   ended    → results. A private room goes back to lobby with the same code;
//              quick and match rooms close. A match room first posts the
//              signed result to Lagos Life (see vatar.ts).
//
// Seats: in quick/private rooms your seat is your connection's id. In a match
// room it is your Lagos Life per-game player id, checked with Lagos Life — so
// a player who reloads (Lagos Life reloads the game after a payment) comes
// back to the same runner, and nobody can sit in someone else's seat.
//
// No bots, ever: everyone in an online room is a person.

import { randomInt } from "node:crypto";

import { NET } from "../../src/config";
import { HIDDEN_LENGTH, RedLightRound, type Contestant, type Phase, type RoundEvent } from "../../src/game/rules";
import {
  STATUS_CHAR,
  SNAP_STRIDE,
  packFlags,
  cleanName,
  phaseIndex,
  type EventMsg,
  type RoomInfo,
  type SnapMsg,
  type StartInfo,
  type SyncInfo,
} from "../../src/net/protocol";
import { MAPS } from "../../src/maps/registry";
import { filterChat } from "../../src/social/filter";
import { EMOTE_BY_ID, type EmoteId } from "../../src/social/emotes";
import { EMOTE_PACK } from "../../src/shop/catalog";
import { now } from "./clock";
import type { Peer } from "./peer";

const SNAP_EVERY = Math.round(NET.tickHz / NET.snapshotHz);
const BACK_TO_LOBBY_MS = 3000;
const CLOSE_QUICK_MS = 4000;
/** A match room waits this long for everyone, then plays with whoever came. */
const MATCH_WAIT_MS = 30_000;
const CLOSE_MATCH_MS = 15_000;

let nextRoomId = 1;

/** A Lagos Life match, as this room needs it (from GET /matches/{id}). */
export interface MatchSeat {
  playerId: string;
  name: string;
}

export interface MatchSpec {
  id: string;
  nonce: string;
  stake: number;
  players: MatchSeat[];
}

/** "draw", or the winning seat id. */
export type Winner = string;

export class Room {
  readonly id = `r${(nextRoomId++).toString(36)}`;
  state: "lobby" | "playing" | "ended" = "lobby";
  owner: string | null;
  members: Peer[] = [];
  startsAt: number | null = null;
  /** Set when the room should be deleted by the lobby. */
  closed = false;
  /** Match rooms: called once, when the round has a winner (or a draw). */
  onDecided: ((room: Room, winner: Winner) => void) | null = null;

  private round: RedLightRound | null = null;
  private start: StartInfo | null = null;
  /** Seat ids in this round's roster. */
  private readonly inRound = new Set<string>();
  /** peer id → seat id (match rooms only; elsewhere the seat is the peer id). */
  private readonly seats = new Map<string, string>();
  /** seat id → the peer in it. Kept in step with members, so a tick never searches. */
  private readonly bySeat = new Map<string, Peer>();
  private ticks = 0;
  private endedAt = 0;
  private roundsPlayed = 0;
  private lastSnap: SnapMsg | null = null;
  private readonly createdAt = now();

  constructor(
    readonly kind: "quick" | "private" | "match",
    readonly size: number,
    readonly code: string | null,
    owner: Peer | null,
    readonly match: MatchSpec | null = null,
  ) {
    this.owner = owner?.id ?? null;
  }

  private get fullDelay(): number {
    return this.kind === "private" ? 3000 : 1000;
  }

  get full(): boolean {
    return this.members.length >= this.size;
  }

  get playing(): boolean {
    return this.state === "playing";
  }

  has(peer: Peer): boolean {
    return this.members.includes(peer);
  }

  /** The contestant this peer controls. */
  seatOf(peer: Peer): string {
    return this.seats.get(peer.id) ?? peer.id;
  }

  // ── Membership ─────────────────────────────────────────────────────────────

  add(peer: Peer): "full" | "started" | null {
    if (this.has(peer)) return null;
    if (this.kind === "match") return "started"; // match rooms are entered with addToMatch
    if (this.state !== "lobby") return "started";
    if (this.full) return "full";
    this.members.push(peer);
    this.bySeat.set(peer.id, peer);
    peer.roomId = this.id;
    peer.send({ t: "seat", id: peer.id });
    this.broadcastRoom();
    return null;
  }

  /**
   * Seat a verified Lagos Life player in their match. If they were already here
   * on another connection (a second tab, or a reload), that one gives way.
   */
  addToMatch(peer: Peer, playerId: string): Peer | null {
    let replaced: Peer | null = null;
    for (const other of this.members) {
      if (other !== peer && this.seats.get(other.id) === playerId) replaced = other;
    }
    if (replaced) {
      this.members.splice(this.members.indexOf(replaced), 1);
      this.seats.delete(replaced.id);
      this.bySeat.delete(playerId);
      replaced.roomId = null;
      replaced.send({ t: "left" });
    }
    if (!this.has(peer)) this.members.push(peer);
    peer.roomId = this.id;
    this.seats.set(peer.id, playerId);
    this.bySeat.set(playerId, peer);
    peer.send({ t: "seat", id: playerId });
    peer.send({ t: "room", room: this.info() });
    if (this.state === "playing" && this.round) peer.send({ t: "sync", sync: this.syncInfo() });
    this.broadcastRoom();
    return replaced;
  }

  /** Leaving on purpose (or for good). */
  remove(peer: Peer): void {
    const i = this.members.indexOf(peer);
    if (i < 0) return;
    this.members.splice(i, 1);
    peer.roomId = null;
    const seat = this.seatOf(peer);
    this.seats.delete(peer.id);
    if (this.bySeat.get(seat) === peer) this.bySeat.delete(seat);
    if (this.round && this.inRound.has(seat)) this.round.setInput(seat, 0, 0);
    if (this.owner === peer.id) this.owner = this.members[0]?.id ?? null;
    // A match room lives until it is decided, even if everyone steps out.
    if (!this.members.length && this.kind !== "match") this.closed = true;
    else this.broadcastRoom();
  }

  /** Socket dropped. In a round they stay (frozen) and may rejoin; otherwise they go. */
  dropped(peer: Peer): void {
    if ((this.state === "playing" && this.inRound.has(this.seatOf(peer))) || this.kind === "match") {
      this.round?.setInput(this.seatOf(peer), 0, 0);
      this.broadcastRoom();
    } else {
      this.remove(peer);
    }
  }

  /** A dropped player came back: bring them up to date. */
  rejoined(peer: Peer): void {
    peer.send({ t: "seat", id: this.seatOf(peer) });
    peer.send({ t: "room", room: this.info() });
    if (this.state === "playing" && this.start && this.round && this.inRound.has(this.seatOf(peer))) {
      peer.send({ t: "sync", sync: this.syncInfo() });
    }
    this.broadcastRoom();
  }

  requestStart(peer: Peer): "not_owner" | null {
    if (this.kind !== "private" || this.state !== "lobby") return null;
    if (peer.id !== this.owner) return "not_owner";
    if (this.connectedCount() >= 2) {
      this.startsAt = now() + 600;
      this.broadcastRoom();
    }
    return null;
  }

  input(peer: Peer, x: number, z: number, b = 0, j = 0): void {
    if (this.state !== "playing" || !this.round) return;
    const seat = this.seatOf(peer);
    if (!this.inRound.has(seat)) return;
    this.round.setInput(seat, x / 100, z / 100);
    this.round.setButtons(seat, (b & 1) === 1, Math.min(2, (b >> 1) & 3) as 0 | 1 | 2, j);
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  tick(dt: number): void {
    const t = now();
    if (this.state === "lobby") this.tickLobby(t);
    else if (this.state === "playing") this.tickRound(dt);
    else if (this.state === "ended") this.tickEnded(t);
  }

  private tickLobby(t: number): void {
    if (this.kind === "match") return this.tickMatchLobby(t);
    const n = this.connectedCount();
    if (n < 2) {
      if (this.startsAt !== null) {
        this.startsAt = null;
        this.broadcastRoom();
      }
      return;
    }
    // After a private room's first round, only the creator starts the next one:
    // nobody gets pulled off the results screen into a round they didn't ask for.
    const autoStart = this.kind === "quick" || this.roundsPlayed === 0;
    if (this.startsAt === null) {
      if (autoStart) {
        // Full: go now. Quick with 2+: give others a moment to join.
        // A full room of friends gets a moment to say hello; strangers go at once.
        this.startsAt = this.full ? t + this.fullDelay : this.kind === "quick" ? t + NET.quickFillMs : null;
        if (this.startsAt !== null) this.broadcastRoom();
      }
    } else if (autoStart && this.full && this.startsAt > t + this.fullDelay) {
      this.startsAt = t + this.fullDelay;
      this.broadcastRoom();
    }
    if (this.startsAt !== null && t >= this.startsAt) this.begin(t);
  }

  /**
   * The stakes are already in the pot, so a match plays whatever happens: as
   * soon as everyone is here, or 30 s after the room opened with at least one
   * player. Anyone who never comes stands at the start line and loses.
   */
  private tickMatchLobby(t: number): void {
    const want = this.match!.players.length;
    const here = new Set<string>();
    for (const p of this.members) if (p.connected) here.add(this.seatOf(p));
    if (!here.size) return;
    const deadline = this.createdAt + MATCH_WAIT_MS;
    const goAt = here.size >= want ? Math.min(t + 1500, deadline) : deadline;
    if (this.startsAt !== goAt && (this.startsAt === null || goAt < this.startsAt)) {
      this.startsAt = goAt;
      this.broadcastRoom();
    }
    if (t >= this.startsAt!) this.begin(t);
  }

  private begin(t: number): void {
    let roster: StartInfo["roster"];
    if (this.kind === "match") {
      // Everyone in the match runs, here or not, in the platform's order.
      roster = this.match!.players.map((p, i) => ({
        id: p.playerId,
        name: cleanName(p.name, () => `Player ${i + 1}`),
        look: this.bySeat.get(p.playerId)?.look,
      }));
    } else {
      // Only people actually connected take part; anyone mid-reconnect waits.
      const players = this.members.filter((p) => p.connected);
      if (players.length < 2) {
        this.startsAt = null;
        return;
      }
      roster = players.map((p) => ({ id: p.id, name: p.name, look: p.look }));
    }
    const seed = randomInt(0, 2 ** 31);
    this.round = new RedLightRound({ seed, contestants: roster.map((r) => ({ id: r.id, name: r.name, bot: false })) });
    this.inRound.clear();
    for (const r of roster) this.inRound.add(r.id);
    const init: number[] = [];
    for (const c of this.round.contestants) init.push(cm(c.x), cm(c.z), mrad(c.heading));
    // A different street every round: the map comes from the seed.
    const map = MAPS[seed % MAPS.length].id;
    this.start = { seed, s: t, roster, init, map };
    this.state = "playing";
    this.startsAt = null;
    this.ticks = 0;
    this.lastSnap = null;
    this.broadcastRoom();
    this.broadcast({ t: "start", start: this.start });
  }

  private tickRound(dt: number): void {
    const round = this.round!;
    // Lag allowance follows each player's live round trip; nobody connected = standing still.
    for (const c of round.contestants) {
      const peer = this.peerAt(c.id);
      c.graceBonus = peer?.connected ? peer.graceBonus : 0;
      if (!peer?.connected) round.setInput(c.id, 0, 0);
    }

    round.step(dt);
    for (const e of round.drain()) this.broadcast(this.encode(e));

    if (++this.ticks % SNAP_EVERY === 0 || round.over) {
      this.lastSnap = this.snapshot();
      this.broadcastRaw(JSON.stringify(this.lastSnap));
    }

    if (round.over) {
      this.state = "ended";
      this.endedAt = now();
      this.roundsPlayed++;
      if (this.kind === "match") this.onDecided?.(this, decide(round.contestants));
    }
  }

  private tickEnded(t: number): void {
    if (this.kind === "quick" || this.kind === "match") {
      if (t - this.endedAt >= (this.kind === "match" ? CLOSE_MATCH_MS : CLOSE_QUICK_MS)) {
        for (const p of this.members) p.roomId = null;
        this.members = [];
        this.bySeat.clear();
        this.closed = true;
      }
      return;
    }
    if (t - this.endedAt >= BACK_TO_LOBBY_MS) {
      // Private room: same code, same people (minus anyone who left), go again.
      for (const p of [...this.members]) if (!p.connected) this.remove(p);
      if (this.closed) return;
      this.state = "lobby";
      this.round = null;
      this.start = null;
      this.inRound.clear();
      this.broadcastRoom();
    }
  }

  // ── Social ─────────────────────────────────────────────────────────────────

  /** A chat line: cleaned here, never trusted from the phone, then sent to everyone who hasn't blocked them. */
  chat(peer: Peer, raw: string): void {
    if (!peer.allowChat()) return peer.send({ t: "note", text: "Slow down small — one message at a time." });
    const { text, changed } = filterChat(raw);
    if (!text) return;
    if (changed) peer.send({ t: "note", text: "Some words were hidden. Keep it friendly — and never share numbers or links." });
    peer.remember(text);
    const msg = Buffer.from(JSON.stringify({ t: "chat", from: this.seatOf(peer), name: peer.name, text, ...(peer.look.b ? { b: 1 } : {}) }));
    for (const m of this.members) if (!m.blockedWith(peer)) m.sendRaw(msg);
  }

  emote(peer: Peer, e: EmoteId): void {
    // Pack emotes only from players who bought the pack.
    if (EMOTE_BY_ID[e].pack && !peer.owned.has(EMOTE_PACK)) return;
    if (!peer.allowChat()) return;
    const msg = Buffer.from(JSON.stringify({ t: "emote", from: this.seatOf(peer), e }));
    for (const m of this.members) if (!m.blockedWith(peer)) m.sendRaw(msg);
  }

  /** The peer in seat `seat`, for report/block. Only people in THIS room can be named. */
  peerInSeat(seat: string): Peer | undefined {
    return this.bySeat.get(seat);
  }

  /** Tell everyone in the room how the result posting went. */
  announce(winner: Winner, posted: boolean): void {
    this.broadcast({ t: "vresult", winner, posted });
  }

  // ── Wire ───────────────────────────────────────────────────────────────────

  info(): RoomInfo {
    const players =
      this.kind === "match"
        ? this.match!.players.map((s) => {
            const peer = this.peerAt(s.playerId);
            return peer?.connected ? { id: s.playerId, name: s.name, look: peer.look } : { id: s.playerId, name: s.name, away: true };
          })
        : this.members.map((p) => (p.connected ? { id: p.id, name: p.name, look: p.look } : { id: p.id, name: p.name, away: true, look: p.look }));
    return {
      kind: this.kind,
      code: this.code,
      size: this.size,
      owner: this.owner,
      players,
      startsAt: this.startsAt,
      state: this.state,
      ...(this.match ? { stake: this.match.stake } : {}),
    };
  }

  broadcastRoom(): void {
    this.broadcast({ t: "room", room: this.info() });
  }

  private broadcast(msg: object): void {
    this.broadcastRaw(JSON.stringify(msg));
  }

  private broadcastRaw(json: string): void {
    const frame = Buffer.from(json);
    for (const p of this.members) p.sendRaw(frame);
  }

  /** The peer currently sitting in a seat, if any. */
  private peerAt(seat: string): Peer | undefined {
    return this.bySeat.get(seat);
  }

  private connectedCount(): number {
    let n = 0;
    for (const p of this.members) if (p.connected) n++;
    return n;
  }

  private encode(e: RoundEvent): EventMsg {
    const round = this.round!;
    switch (e.type) {
      case "phase":
        return { t: "ev", k: "ph", ph: phaseIndex(e.phase), d: shownLength(e.phase, e.duration) };
      case "eliminated": {
        const c = round.get(e.id)!;
        return { t: "ev", k: "out", i: c.index, c: e.cause === "moved" ? 0 : 1, x: cm(c.x), z: cm(c.z) };
      }
      case "finished":
        return { t: "ev", k: "fin", i: round.get(e.id)!.index, time: Math.round(e.time * 1000), place: e.place };
      case "ended":
        return { t: "ev", k: "end" };
    }
  }

  private snapshot(): SnapMsg {
    const round = this.round!;
    const list = round.contestants;
    const p: number[] = new Array(list.length * SNAP_STRIDE);
    let st = "";
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const o = i * SNAP_STRIDE;
      p[o] = cm(c.x);
      p[o + 1] = cm(c.z);
      p[o + 2] = cm(c.vx);
      p[o + 3] = cm(c.vz);
      p[o + 4] = mrad(c.heading);
      p[o + 5] = cm(c.progress);
      p[o + 6] = cm(c.y);
      p[o + 7] = packFlags(c.stance, c.sprinting, c.stamina);
      st += STATUS_CHAR[c.status];
    }
    return {
      t: "snap",
      s: now(),
      ph: phaseIndex(round.phase),
      pt: Math.round(round.phaseTime * 1000),
      pd: shownLength(round.phase, round.phaseDuration),
      el: Math.round(round.elapsed * 1000),
      st,
      p,
    };
  }

  private syncInfo(): SyncInfo {
    const round = this.round!;
    const outcomes: number[] = [];
    for (const c of round.contestants) {
      outcomes.push(c.place, Math.round(c.finishTime * 1000), Math.round(c.eliminatedAt * 1000), c.cause === "moved" ? 1 : c.cause === "time" ? 2 : 0);
    }
    return { ...this.start!, snap: this.lastSnap ?? this.snapshot(), outcomes };
  }
}

/**
 * Who wins a match: the first across the line. Two across on the very same
 * tick, or nobody across at all, is a draw — every stake goes back.
 */
export function decide(list: readonly Contestant[]): Winner {
  const finished = list.filter((c) => c.status === "finished");
  if (!finished.length) return "draw";
  const best = Math.min(...finished.map((c) => c.finishTime));
  const first = finished.filter((c) => Math.abs(c.finishTime - best) < 1e-9);
  return first.length === 1 ? first[0].id : "draw";
}

/**
 * A phase's length as clients may know it. The song, the feint and her stare
 * are secret — sending them would tell every phone exactly when she turns —
 * so they go out as 0. Countdown and the turns themselves are visible anyway.
 */
function shownLength(phase: Phase, seconds: number): number {
  return HIDDEN_LENGTH.includes(phase) ? 0 : Math.round(seconds * 1000);
}

function cm(v: number): number {
  return Math.round(v * 100);
}

function mrad(v: number): number {
  return Math.round(v * 1000);
}
