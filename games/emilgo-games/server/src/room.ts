// A room: people waiting together, then one round of Red Light, Green Light
// refereed by the SAME RedLightRound class the game uses offline.
//
//   lobby    → the waiting room (SPEC-V2 §1.2). Everyone ticks ready; when
//              all (two or more) are, a 2 s loading begins: the seed and map
//              are chosen and announced, so phones build the map meanwhile,
//              and nobody else can join. Quick rooms (Play with New People)
//              also load 60 s after the second person arrives, or at once
//              when all 20 are in. Lagos Life match rooms load when every
//              player in the match is here (or after 30 s): the stakes are in.
//   playing  → the referee runs at 60 Hz: the walkout (skippable once all are
//              in the arena), the countdown, the round. Inputs in, snapshots +
//              events out.
//   ended    → results. A private room goes back to lobby with the same code
//              (everyone un-ready, so nobody is pulled into a round);
//              quick and match rooms close. A match room first posts the
//              signed result to Lagos Life (see vatar.ts).
//
// Seats: in quick/private rooms your seat is your connection's id. In a match
// room it is your Lagos Life per-game player id, checked with Lagos Life — so
// a player who reloads (Lagos Life reloads the game after a payment) comes
// back to the same runner, and nobody can sit in someone else's seat.
//
// No bots, ever: everyone in an online room is a person.
//
// Free For All rooms (SPEC-V3 Phase 4) are the same room around a different
// game: `ffa` names the mode, and an FfaGame (ffa.ts) runs the match core in
// place of the Red Light, Green Light referee. Quick (public) Free For All
// rooms start when full, or 60 s after the mode's fewest have arrived;
// private ones when everyone (two or more) is ready. Parties are kept
// together as squads.

import { randomInt } from "node:crypto";

import { ATTACK_KINDS, FLOW, NET, courseFor, walkoutLength, type Distance, type Mode } from "../../src/config";
import { ballState } from "../../src/game/balls";
import { Highlights } from "../../src/game/highlights";
import { actCode } from "../../src/game/combat";
import { HIDDEN_LENGTH, RedLightRound, type Contestant, type Phase, type RoundEvent } from "../../src/game/rules";
import {
  BALL_STRIDE,
  MOMENT_WIRE,
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
import { MAPS, fieldHalfWidth } from "../../src/maps/registry";
import type { MatchFacts } from "../../src/rank/xp";
import { filterChat } from "../../src/social/filter";
import { EMOTE_BY_ID, type EmoteId } from "../../src/social/emotes";
import { EMOTE_PACK } from "../../src/shop/catalog";
import { boostsFromWire, boostsToWire } from "../../src/shop/boosts";
import type { ModeDef } from "../../src/content/modes";
import { now } from "./clock";
import type { WireEvent } from "../../src/net/matchWire";
import { assignSquads, FfaGame } from "./ffa";
import type { Peer } from "./peer";

const SNAP_EVERY = Math.round(NET.tickHz / NET.snapshotHz);
const BACK_TO_LOBBY_MS = 3000;
const CLOSE_QUICK_MS = 4000;
/** A match room waits this long for everyone, then plays with whoever came. */
const MATCH_WAIT_MS = 30_000;
const CLOSE_MATCH_MS = 15_000;
const LOADING_MS = FLOW.loading * 1000;

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

/** How long after a match its players can commend each other (ms). */
const COMMEND_MS = 180_000;

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
  /**
   * Rank XP (SPEC-V3 §2.2): every room calls this once a round, for each
   * player still in it, with what the referee saw. Set once by the server.
   */
  static onAward: ((peer: Peer, facts: MatchFacts) => void) | null = null;
  static onCommend: ((from: Peer, to: Peer) => void) | null = null;
  /** The last match's seats, and who has commended someone from it (§10.12: once each). */
  private played = new Set<string>();
  private readonly commended = new Set<string>();

  private round: RedLightRound | null = null;
  /** The play of the game: the round's best moment, scored here so every phone shows the same one. */
  private highlights = new Highlights();
  private start: StartInfo | null = null;
  /** Seat ids in this round's roster. */
  private readonly inRound = new Set<string>();
  /** peer id → seat id (match rooms only; elsewhere the seat is the peer id). */
  private readonly seats = new Map<string, string>();
  /** seat id → the peer in it. Kept in step with members, so a tick never searches. */
  private readonly bySeat = new Map<string, Peer>();
  private ticks = 0;
  private endedAt = 0;
  private lastSnap: SnapMsg | null = null;
  private readonly createdAt = now();
  /** Seat ids ticked ready in the waiting room. */
  private readonly readySeats = new Set<string>();
  /** Chosen when loading starts (the last LOADING_MS before startsAt). */
  private pending: { seed: number; map: string } | null = null;

  constructor(
    readonly kind: "quick" | "private" | "match",
    readonly size: number,
    readonly code: string | null,
    owner: Peer | null,
    readonly match: MatchSpec | null = null,
    /** What this room plays (SPEC-V2 §2.1). */
    readonly mode: Mode = "classic",
    readonly dist: Distance = 200,
    /** A Free For All room: its mode (null: Red Light, Green Light). */
    readonly ffa: ModeDef | null = null,
  ) {
    this.owner = owner?.id ?? null;
  }

  /** Ranked (Phase 6): double XP and the mode's harder rules. */
  ranked = false;
  /** The Free For All match being played, if any. */
  private game: FfaGame | null = null;
  /** A Free For All match's events not sent yet (they go out at 30 Hz). */
  private mev: WireEvent[] = [];
  /** When each seat last pinged its squad. */
  private readonly pinged = new Map<string, number>();

  get full(): boolean {
    return this.members.length >= this.size;
  }

  get playing(): boolean {
    return this.state === "playing";
  }

  /** The 2 s before the start: the map is chosen and the door is shut. */
  get loading(): boolean {
    return this.pending !== null;
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
    if (this.state !== "lobby" || this.loading) return "started";
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
    if (this.state === "playing" && this.game && this.start) peer.send({ t: "msync", sync: this.game.sync(this.start.s, now(), this.mev.length) });
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
    this.readySeats.delete(seat);
    if (this.bySeat.get(seat) === peer) this.bySeat.delete(seat);
    if (this.round && this.inRound.has(seat)) this.round.setInput(seat, 0, 0);
    if (this.game && this.inRound.has(seat)) this.game.idle(seat);
    if (this.owner === peer.id) this.owner = this.members[0]?.id ?? null;
    // A match room lives until it is decided, even if everyone steps out.
    if (!this.members.length && this.kind !== "match") this.closed = true;
    else this.broadcastRoom();
  }

  /** Socket dropped. In a round they stay (frozen) and may rejoin; otherwise they go. */
  dropped(peer: Peer): void {
    if ((this.state === "playing" && this.inRound.has(this.seatOf(peer))) || this.kind === "match") {
      this.round?.setInput(this.seatOf(peer), 0, 0);
      this.game?.idle(this.seatOf(peer));
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
    if (this.state === "playing" && this.start && this.game && this.inRound.has(this.seatOf(peer))) {
      peer.send({ t: "msync", sync: this.game.sync(this.start.s, now(), this.mev.length) });
    }
    this.broadcastRoom();
  }

  /** Waiting room: tick (or untick) ready. Fixed once loading has begun. */
  setReady(peer: Peer, on: boolean): void {
    if (this.kind === "match" || this.state !== "lobby" || this.loading) return;
    const seat = this.seatOf(peer);
    if (on === this.readySeats.has(seat)) return;
    if (on) this.readySeats.add(seat);
    else this.readySeats.delete(seat);
    this.broadcastRoom();
  }

  /** Walkout: this player skips to behind the players (the referee decides when it counts). */
  skip(peer: Peer): void {
    if (this.state !== "playing" || !this.round) return;
    const seat = this.seatOf(peer);
    if (this.inRound.has(seat)) this.round.skip(seat);
  }

  input(peer: Peer, x: number, z: number, b = 0, j = 0, a = 0, g = 0, i = 0, k = 0): void {
    if (this.state !== "playing") return;
    const seat = this.seatOf(peer);
    if (!this.inRound.has(seat)) return;
    if (this.game) return this.game.input(seat, x, z, b, j, a, g, i, k);
    if (!this.round) return;
    this.round.setInput(seat, x / 100, z / 100);
    this.round.setButtons(seat, (b & 1) === 1, Math.min(2, (b >> 1) & 3) as 0 | 1 | 2, j);
    this.round.setActions(seat, a, g);
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  tick(dt: number): void {
    const t = now();
    if (this.state === "lobby") this.tickLobby(t);
    else if (this.state === "playing") {
      if (this.game) this.tickMatch(dt);
      else this.tickRound(dt);
    }
    else if (this.state === "ended") this.tickEnded(t);
  }

  private tickLobby(t: number): void {
    if (this.kind === "match") this.tickMatchLobby(t);
    else this.tickWaiting(t);
    // The last LOADING_MS: pick the place now, so every phone can build it in time.
    if (this.startsAt !== null && !this.pending && t >= this.startsAt - LOADING_MS) {
      const seed = randomInt(0, 2 ** 31);
      // A different place every round: the map comes from the seed (Free For All: the mode's world).
      this.pending = { seed, map: this.ffa ? this.ffa.map : MAPS[seed % MAPS.length].id };
      this.broadcastRoom();
    }
    if (this.startsAt !== null && t >= this.startsAt) this.begin(t);
  }

  /** Quick and private rooms: everyone ready (two or more), or a quick room full or out of time. */
  private tickWaiting(t: number): void {
    const n = this.connectedCount();
    // A public Free For All queue: full now, or a minute once the mode's fewest are in (SPEC-V3 §9).
    if (this.ffa && this.kind === "quick") {
      if (this.pending) return;
      const at = n >= this.size ? t + LOADING_MS : n >= this.ffa.players.min ? (this.startsAt ?? t + NET.quickFillMs) : null;
      if (at !== this.startsAt) {
        this.startsAt = at;
        this.broadcastRoom();
      }
      return;
    }
    if (n < 2) {
      if (this.startsAt !== null) {
        this.startsAt = null;
        this.pending = null;
        this.broadcastRoom();
      }
      return;
    }
    if (this.pending) return;
    let ready = 0;
    for (const p of this.members) if (p.connected && this.readySeats.has(this.seatOf(p))) ready++;
    const go = ready >= n || (this.kind === "quick" && this.full);
    const at = go ? t + LOADING_MS : this.kind === "quick" ? (this.startsAt ?? t + NET.quickFillMs) : null;
    if (at !== this.startsAt) {
      this.startsAt = at;
      this.broadcastRoom();
    }
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
    const goAt = here.size >= want ? Math.min(t + LOADING_MS, deadline) : deadline;
    if (this.startsAt !== goAt && (this.startsAt === null || goAt < this.startsAt)) {
      this.startsAt = goAt;
      this.broadcastRoom();
    }
  }

  private begin(t: number): void {
    if (this.ffa) return this.beginMatch(t, this.ffa);
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
        this.pending = null;
        return;
      }
      // Free rooms: each player's CP boosts (never in a staked match, SPEC-V2 §7.7). At most BOOST_SLOTS, checked on arrival.
      roster = players.map((p) => ({ id: p.id, name: p.name, look: p.look, ...(p.boosts.length ? { bo: boostsToWire(p.boosts) } : {}) }));
    }
    const seed = this.pending?.seed ?? randomInt(0, 2 ** 31);
    const info = MAPS[seed % MAPS.length];
    const course = courseFor(this.mode, this.dist, fieldHalfWidth(info, this.mode));
    const walkout = walkoutLength(this.mode);
    this.round = new RedLightRound({ seed, contestants: roster.map((r) => ({ id: r.id, name: r.name, bot: false, boosts: boostsFromWire(r.bo) })), course, walkout });
    this.highlights = new Highlights();
    this.inRound.clear();
    for (const r of roster) this.inRound.add(r.id);
    const init: number[] = [];
    for (const c of this.round.contestants) init.push(cm(c.x), cm(c.z), mrad(c.heading));
    const bp: number[] = [];
    for (const b of this.round.balls) bp.push(cm(b.x), cm(b.z));
    this.start = { seed, s: t, roster, init, map: info.id, mode: this.mode, dist: this.dist, hw: cm(course.halfWidth), ...(bp.length ? { bp } : {}), wo: Math.round(walkout * 1000) };
    this.state = "playing";
    this.startsAt = null;
    this.pending = null;
    this.readySeats.clear();
    this.ticks = 0;
    this.lastSnap = null;
    this.broadcastRoom();
    this.broadcast({ t: "start", start: this.start });
  }

  /** A Free For All match: its roster, squads (parties together) and the match core. */
  private beginMatch(t: number, def: ModeDef): void {
    let roster: StartInfo["roster"];
    let members: { seat: string; party: string | null }[];
    if (this.kind === "match") {
      roster = this.match!.players.map((p, i) => ({ id: p.playerId, name: cleanName(p.name, () => `Player ${i + 1}`), look: this.bySeat.get(p.playerId)?.look }));
      members = roster.map((r) => ({ seat: r.id, party: null }));
    } else {
      const players = this.members.filter((p) => p.connected);
      if (players.length < 2) {
        this.startsAt = null;
        this.pending = null;
        return;
      }
      // No CP boosts in Free For All: they belong to Red Light, Green Light's movement.
      roster = players.map((p) => ({ id: p.id, name: p.name, look: p.look }));
      members = players.map((p) => ({ seat: p.id, party: p.party }));
    }
    const seed = this.pending?.seed ?? randomInt(0, 2 ** 31);
    const squads = assignSquads(members, def);
    this.mev = [];
    this.game = new FfaGame(def, seed, roster.map((r) => ({ id: r.id, name: r.name, ...(r.look ? { look: r.look } : {}) })), squads, this.ranked && this.kind === "quick");
    this.inRound.clear();
    for (const r of roster) this.inRound.add(r.id);
    this.start = { seed, s: t, roster, init: [], map: def.map, ffa: this.game.start };
    this.state = "playing";
    this.startsAt = null;
    this.pending = null;
    this.readySeats.clear();
    this.ticks = 0;
    this.broadcastRoom();
    this.broadcast({ t: "start", start: this.start });
  }

  private tickMatch(dt: number): void {
    const game = this.game!;
    const events = game.step(dt, (seat) => {
      const peer = this.peerAt(seat);
      if (!peer?.connected) game.idle(seat);
      return peer?.connected ? peer.graceBonus : 0;
    });
    // Events go out at 30 Hz (and with each snapshot, and at the end): half the socket writes of every tick.
    if (events.length) this.mev.push(...events);
    const snapNow = (this.ticks + 1) % SNAP_EVERY === 0 || game.over;
    if (this.mev.length && ((this.ticks + 1) % 2 === 0 || snapNow)) {
      this.broadcast({ t: "mev", e: this.mev });
      this.mev = [];
    }
    if (++this.ticks % SNAP_EVERY === 0 || game.over) {
      const half = (this.ticks / SNAP_EVERY) % 2 === 1 && !game.over;
      // Each body's measure goes out once a second (the HUD's scores), and with the last.
      const measures = (this.ticks / SNAP_EVERY) % NET.snapshotHz === 0 || game.over;
      this.broadcastRaw(JSON.stringify(game.snapshot(now(), false, measures)), half);
    }
    if (game.over) {
      this.state = "ended";
      this.endedAt = now();
      this.played = new Set(game.roster.map((r) => r.id));
      this.commended.clear();
      if (this.kind === "match") this.onDecided?.(this, game.winner());
      const hook = Room.onAward;
      if (hook && game.roster.length >= 2) {
        const st = game.standings();
        for (const peer of this.members) {
          const facts = game.facts(this.seats.get(peer.id) ?? peer.id, st);
          if (facts) hook(peer, facts);
        }
      }
    }
  }

  private tickRound(dt: number): void {
    const round = this.round!;
    // Lag allowance follows each player's live round trip; nobody connected = standing still.
    for (const c of round.contestants) {
      const peer = this.peerAt(c.id);
      c.graceBonus = peer?.connected ? peer.graceBonus : 0;
      if (!peer?.connected) {
        round.setInput(c.id, 0, 0);
        // Nobody waits on an empty seat to skip the walkout.
        round.skip(c.id);
      }
    }

    round.step(dt);
    const events = round.drain();
    const best = this.highlights.observe(round, events);
    // A new best moment goes out before "end", so the last one heard is the play of the game.
    if (best) events.splice(events[events.length - 1]?.type === "ended" ? events.length - 1 : events.length, 0, { type: "moment", ...best });
    for (const e of events) this.broadcast(this.encode(e));

    if (++this.ticks % SNAP_EVERY === 0 || round.over) {
      this.lastSnap = this.snapshot();
      // Data saver phones get every other one (and the last): half the bytes, a little more delay.
      const half = (this.ticks / SNAP_EVERY) % 2 === 1 && !round.over;
      this.broadcastRaw(JSON.stringify(this.lastSnap), half);
    }

    if (round.over) {
      this.state = "ended";
      this.endedAt = now();
      const winner = decide(round.contestants);
      if (this.kind === "match") this.onDecided?.(this, winner);
      this.award(round, winner);
    }
  }

  /**
   * Rank XP for everyone still here (SPEC-V3 §2.2). A round needs two people
   * or more to count; a dropped player inside the rejoin window still counts
   * (a blip shouldn't cost a match). Red Light, Green Light rounds are short,
   * so they pay in proportion to their length (FULL_MATCH_S).
   */
  private award(round: RedLightRound, winner: Winner): void {
    const hook = Room.onAward;
    const list = round.contestants;
    if (!hook || list.length < 2) return;
    const place = places(list);
    const top = Math.max(0, ...list.map((c) => c.progress));
    for (const peer of this.members) {
      const seat = this.seats.get(peer.id) ?? peer.id;
      const c = round.get(seat);
      if (!c) continue;
      hook(peer, {
        players: list.length,
        place: place.get(seat) ?? list.length,
        won: winner === seat,
        stayed: true,
        objective: c.status === "finished" ? top : c.progress,
        objectiveTop: top,
        seconds: round.elapsed,
      });
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
      this.game = null;
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

  /** A spectator's Airfall vote (§10.6): the match decides whether it counts. */
  airfallVote(peer: Peer, c: number): void {
    if (this.game && this.state === "playing") this.game.vote(this.seatOf(peer), c);
  }

  /** Commend someone from the match just played (§10.12): once each, within COMMEND_MS of its end. */
  commend(peer: Peer, id: string): void {
    const seat = this.seatOf(peer);
    const target = this.peerInSeat(id);
    if (!target || target === peer || !this.played.has(seat) || !this.played.has(id)) return;
    if (!this.endedAt || now() - this.endedAt > COMMEND_MS || this.commended.has(peer.id)) return;
    this.commended.add(peer.id);
    Room.onCommend?.(peer, target);
  }

  /** A squad ping (§10.7): to the pinger's squad mates only (never rivals), at most one a second. */
  squadPing(peer: Peer, k: number, x: number, z: number): void {
    const game = this.game;
    if (!game || this.state !== "playing") return;
    const seat = this.seatOf(peer);
    const t = Date.now();
    if (t - (this.pinged.get(seat) ?? 0) < 1000) return;
    this.pinged.set(seat, t);
    const mates = game.squadMates(seat);
    if (!mates.length) return;
    const msg = Buffer.from(JSON.stringify({ t: "sping", from: seat, k, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 }));
    for (const m of this.members) if (m !== peer && mates.includes(this.seatOf(m)) && !m.blockedWith(peer)) m.sendRaw(msg);
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
            // Everyone in a staked match is in for the stakes: ready by being here.
            return peer?.connected ? { id: s.playerId, name: s.name, look: peer.look, ready: 1 as const } : { id: s.playerId, name: s.name, away: true };
          })
        : this.members.map((p) => ({ id: p.id, name: p.name, look: p.look, ...(p.connected ? {} : { away: true }), ...(this.readySeats.has(this.seatOf(p)) ? { ready: 1 as const } : {}) }));
    return {
      kind: this.kind,
      code: this.code,
      size: this.size,
      owner: this.owner,
      players,
      startsAt: this.startsAt,
      ...(this.pending ? { map: this.pending.map } : {}),
      state: this.state,
      ...(this.match ? { stake: this.match.stake } : {}),
      mode: this.mode,
      dist: this.dist,
      ...(this.ffa ? { ffa: this.ffa.id, min: this.ffa.players.min } : {}),
      ...(this.ranked ? { rk: true } : {}),
    };
  }

  broadcastRoom(): void {
    this.broadcast({ t: "room", room: this.info() });
  }

  private broadcast(msg: object): void {
    this.broadcastRaw(JSON.stringify(msg));
  }

  private broadcastRaw(json: string, skipSavers = false): void {
    const frame = Buffer.from(json);
    for (const p of this.members) if (!(skipSavers && p.saver)) p.sendRaw(frame);
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
        return { t: "ev", k: "out", i: c.index, c: e.cause === "moved" ? 0 : e.cause === "time" ? 1 : 2, x: cm(c.x), z: cm(c.z) };
      }
      case "finished":
        return { t: "ev", k: "fin", i: round.get(e.id)!.index, time: Math.round(e.time * 1000), place: e.place };
      case "ended":
        return { t: "ev", k: "end" };
      case "attack": {
        const tg = e.target ? round.get(e.target)! : null;
        return { t: "ev", k: "atk", i: round.get(e.id)!.index, kind: ATTACK_KINDS.indexOf(e.kind) + 1, tg: tg ? tg.index : -1, db: e.dropped, ...(tg ? { kx: cm(tg.vx), kz: cm(tg.vz) } : {}) };
      }
      case "grab":
        return { t: "ev", k: "grb", i: round.get(e.id)!.index, b: e.ball };
      case "drop":
        return { t: "ev", k: "drp", b: e.ball, x: cm(e.x), z: cm(e.z) };
      case "bank":
        return { t: "ev", k: "bnk", i: round.get(e.id)!.index, b: e.ball, bk: e.basket };
      case "final":
        return { t: "ev", k: "fn2", a: round.get(e.ids[0])!.index, b: round.get(e.ids[1])!.index };
      case "moment":
        return { t: "ev", k: "hl", i: e.who, kind: MOMENT_WIRE.indexOf(e.kind) + 1, at: Math.round(e.t * 1000), sc: Math.round(e.score * 10) };
    }
  }

  /**
   * The round's state. The fallen don't move, so in the regular snapshots their
   * entries go out as zeros (phones already have where they fell, from the
   * "out" event); `full` — for a phone (re)joining mid-round — carries them.
   */
  private snapshot(full = false): SnapMsg {
    const round = this.round!;
    const list = round.contestants;
    const p: number[] = new Array(list.length * SNAP_STRIDE);
    let st = "";
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const o = i * SNAP_STRIDE;
      if (!full && c.status === "eliminated") {
        p.fill(0, o, o + SNAP_STRIDE);
        st += STATUS_CHAR[c.status];
        continue;
      }
      p[o] = cm(c.x);
      p[o + 1] = cm(c.z);
      p[o + 2] = mrad(c.heading);
      p[o + 3] = cm(c.y);
      p[o + 4] = packFlags(c.stance, c.sprinting, c.stamina, c.stun > 0, actCode(c.actKind), c.slide > 0);
      st += STATUS_CHAR[c.status];
    }
    let b: number[] | undefined;
    if (full && round.balls.length) {
      b = new Array(round.balls.length * BALL_STRIDE);
      for (const ball of round.balls) {
        const o = ball.index * BALL_STRIDE;
        b[o] = cm(ball.x);
        b[o + 1] = cm(ball.z);
        b[o + 2] = ballState(ball);
      }
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
      ...(b ? { b } : {}),
    };
  }

  private syncInfo(): SyncInfo {
    const round = this.round!;
    const outcomes: number[] = [];
    for (const c of round.contestants) {
      outcomes.push(c.place, Math.round(c.finishTime * 1000), Math.round(c.eliminatedAt * 1000), c.cause === "moved" ? 1 : c.cause === "time" ? 2 : c.cause === "noball" ? 3 : 0, cm(c.progress));
    }
    return { ...this.start!, snap: this.snapshot(true), outcomes };
  }
}

/**
 * Places for XP: those across, by when; then the rest, furthest first. Ties
 * share the better place.
 */
export function places(list: readonly Contestant[]): Map<string, number> {
  const order = [...list].sort((a, b) => {
    const fa = a.status === "finished" ? 0 : 1;
    const fb = b.status === "finished" ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return fa === 0 ? a.finishTime - b.finishTime : b.progress - a.progress;
  });
  const out = new Map<string, number>();
  order.forEach((c, i) => {
    const prev = order[i - 1];
    const tie = prev && (c.status === "finished" ? Math.abs(c.finishTime - prev.finishTime) < 1e-9 && prev.status === "finished" : prev.status !== "finished" && Math.abs(c.progress - prev.progress) < 1e-3);
    out.set(c.id, tie ? out.get(prev.id)! : i + 1);
  });
  return out;
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
 * A phase's length as clients may know it. The song and her stare
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
