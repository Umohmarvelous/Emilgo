// Matchmaking and the room registry for one server process.
//
//   quick         join the open quick room for that mode and distance, or open one
//   create(size)  a private room with a six-letter code
//   join(code)    into a private room that is still filling
//
//   playMatch     a Lagos Life match: verified with Lagos Life, one room per match
//
// One open quick room at a time is enough: it fills in milliseconds when
// people are around, and when they aren't, everyone waiting is in the same
// room instead of scattered across empty ones.

import { randomInt } from "node:crypto";

import { NET, STAKED, type Distance, type Mode } from "../../src/config";
import { cleanName, type ErrorCode } from "../../src/net/protocol";
import type { Peer } from "./peer";
import { Room, type MatchSpec, type Winner } from "./room";
import { VatarError, type VatarApi } from "./vatar";

export interface MatchLog {
  (event: "verified" | "decided" | "posted" | "post_failed" | "refused", info: Record<string, unknown>): void;
}

export class Lobby {
  readonly rooms = new Map<string, Room>();
  private readonly codes = new Map<string, Room>();
  private readonly openQuick: Room[] = [];
  private readonly matches = new Map<string, Room>();
  private readonly opening = new Map<string, Promise<Room>>();

  constructor(
    private readonly vatar: VatarApi | null = null,
    private readonly log: MatchLog = () => {},
  ) {}

  roomOf(peer: Peer): Room | undefined {
    return peer.roomId ? this.rooms.get(peer.roomId) : undefined;
  }

  quick(peer: Peer, mode: Mode = "classic", dist: Distance = 200): ErrorCode | null {
    this.leave(peer);
    // The first open quick room for this mode and distance with nobody this
    // player has blocked (or been blocked by). Usually that is the only one.
    for (let i = this.openQuick.length - 1; i >= 0; i--) {
      const r = this.openQuick[i];
      if (r.closed || r.state !== "lobby" || r.full) this.openQuick.splice(i, 1);
    }
    let room = this.openQuick.find((r) => r.mode === mode && r.dist === dist && !r.members.some((m) => m.blockedWith(peer)));
    if (!room) {
      room = new Room("quick", NET.crowdMax, null, null, null, mode, dist);
      this.rooms.set(room.id, room);
      this.openQuick.push(room);
    }
    return room.add(peer);
  }

  create(peer: Peer, size: number, mode: Mode = "classic", dist: Distance = 200): ErrorCode | null {
    this.leave(peer);
    const room = new Room("private", size, this.newCode(), peer, null, mode, dist);
    this.rooms.set(room.id, room);
    this.codes.set(room.code!, room);
    return room.add(peer);
  }

  join(peer: Peer, code: string): ErrorCode | null {
    const room = this.codes.get(code);
    if (!room || room.closed) return "not_found";
    if (room.has(peer)) return null;
    this.leave(peer);
    return room.add(peer);
  }

  /**
   * Seat `peer` in Lagos Life match `matchId`. Never trusts the phone: the
   * session token is verified with Lagos Life, and the verified player must be
   * one of the match's players, in a match that is being played.
   */
  async playMatch(peer: Peer, matchId: string, session: string): Promise<ErrorCode | null> {
    const api = this.vatar;
    if (!api) return "vatar_off";
    let playerId: string;
    try {
      playerId = (await api.verifySession(session)).playerId;
    } catch (e) {
      this.log("refused", { matchId, why: e instanceof VatarError ? e.code : String(e) });
      return "verify";
    }
    let room: Room;
    try {
      room = await this.matchRoom(matchId);
    } catch (e) {
      const code = e instanceof VatarError ? e.code : "error";
      this.log("refused", { matchId, why: code });
      return code === "match_state" ? "match_state" : code === "not_found" ? "not_found" : "verify";
    }
    if (!room.match!.players.some((p) => p.playerId === playerId)) {
      this.log("refused", { matchId, why: "not_in_match" });
      return "not_in_match";
    }
    if (room.state === "ended" || room.closed) return "match_state";
    if (!peer.connected) return null; // hung up while we were checking
    const current = this.roomOf(peer);
    if (current && current !== room) current.remove(peer);
    peer.name = room.match!.players.find((p) => p.playerId === playerId)!.name;
    room.addToMatch(peer, playerId);
    this.log("verified", { matchId, seats: room.match!.players.length });
    return null;
  }

  /** One room per match, opened once even if every player asks at the same moment. */
  private async matchRoom(matchId: string): Promise<Room> {
    const existing = this.matches.get(matchId);
    if (existing && !existing.closed) return existing;
    let p = this.opening.get(matchId);
    if (!p) {
      p = (async () => {
        const m = await this.vatar!.getMatch(matchId);
        if (m.status !== "playing") throw new VatarError(409, "match_state");
        const spec: MatchSpec = {
          id: m.id,
          nonce: m.nonce,
          stake: Number(m.stake) || 0,
          players: m.players.map((x, i) => ({ playerId: String(x.playerId), name: cleanName(String(x.name ?? ""), () => `Player ${i + 1}`) })),
        };
        // The match API carries only stake and seats: staked matches always play STAKED.
        const room = new Room("match", spec.players.length, null, null, spec, STAKED.mode, STAKED.distance);
        room.onDecided = (r, winner) => void this.settle(r, winner);
        this.rooms.set(room.id, room);
        this.matches.set(matchId, room);
        return room;
      })();
      this.opening.set(matchId, p);
      p.finally(() => this.opening.delete(matchId)).catch(() => {});
    }
    return p;
  }

  /** Post the signed result. Retries live inside postResult; this just reports. */
  private async settle(room: Room, winner: Winner): Promise<void> {
    const m = room.match!;
    this.log("decided", { matchId: m.id, winner: winner === "draw" ? "draw" : "player" });
    try {
      const settled = await this.vatar!.postResult({ id: m.id, nonce: m.nonce }, winner);
      this.log("posted", { matchId: m.id, alreadySettled: settled === null });
      room.announce(winner, true);
    } catch (e) {
      this.log("post_failed", { matchId: m.id, why: e instanceof VatarError ? `${e.http} ${e.code}` : String(e) });
      // Lagos Life refunds every stake if no result arrives within 2 hours.
      room.announce(winner, false);
    }
  }

  leave(peer: Peer): void {
    this.roomOf(peer)?.remove(peer);
    peer.roomId = null;
  }

  tick(dt: number): void {
    for (const room of this.rooms.values()) {
      room.tick(dt);
      if (room.closed) {
        this.rooms.delete(room.id);
        if (room.code) this.codes.delete(room.code);
        const q = this.openQuick.indexOf(room);
        if (q >= 0) this.openQuick.splice(q, 1);
        if (room.match && this.matches.get(room.match.id) === room) this.matches.delete(room.match.id);
      }
    }
  }

  stats(): { rooms: number; playing: number; inRooms: number } {
    let playing = 0;
    let inRooms = 0;
    for (const r of this.rooms.values()) {
      if (r.playing) playing++;
      inRooms += r.members.length;
    }
    return { rooms: this.rooms.size, playing, inRooms };
  }

  private newCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < NET.codeLength; i++) code += NET.codeAlphabet[randomInt(0, NET.codeAlphabet.length)];
      if (!this.codes.has(code)) return code;
    }
  }
}
