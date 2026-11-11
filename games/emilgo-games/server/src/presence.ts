// Friends (SPEC-V2 Decisions, "Invite Lagos Life friends"): who is on, friend
// requests and room invites. Nothing is stored: a phone says who it is (its
// friend id, random, made on the phone) and who its friends are each time it
// connects, and the server forgets both when it goes.
//
// Friendship must be mutual for anything to pass: you see a friend as online,
// and can invite them, only if they list you too. So a friend id on its own
// tells a stranger nothing. Friend ids are per copy of the game (Lagos Life's
// and EMILGO's are different), so they never link a player across services.

import { filterChat } from "../../src/social/filter";
import type { Lobby } from "./lobby";
import type { Peer } from "./peer";

/** v6 max (3.11): a direct message held for a friend who is off: at most this many each, for a day, in memory only. */
const HOLD_MAX = 20;
const HOLD_MS = 24 * 3600 * 1000;
/** The last lines passed between two friends, kept (in memory) as evidence for a report. */
const EVIDENCE = 6;

interface Held {
  from: string;
  name: string;
  text: string;
  at: number;
}

export class Presence {
  private readonly byFid = new Map<string, Peer>();
  /** Who an absent player listed (and whether they took messages), from when they left: a held message needs it. */
  private readonly lastFriends = new Map<string, { friends: ReadonlySet<string>; dms: boolean; at: number }>();
  private readonly held = new Map<string, Held[]>();
  /** "a|b" (the two friend ids, sorted) → the last lines between them. */
  private readonly between = new Map<string, string[]>();

  constructor(private readonly lobby: Lobby) {}

  /** A phone said who it is (and again whenever its list changes). */
  identify(peer: Peer, fid: string, friends: string[]): void {
    if (peer.fid && peer.fid !== fid && this.byFid.get(peer.fid) === peer) this.byFid.delete(peer.fid);
    // A friend id already on another live connection: the newer one wins (the same phone reconnecting).
    peer.fid = fid;
    peer.friendFids = new Set(friends.slice(0, 100));
    this.byFid.set(fid, peer);
    this.lastFriends.delete(fid);
    this.tell(peer);
    // Messages friends sent while this player was off.
    const waiting = this.held.get(fid);
    if (waiting) {
      this.held.delete(fid);
      const t = Date.now();
      for (const h of waiting) if (t - h.at < HOLD_MS && peer.friendFids.has(h.from)) peer.send({ t: "dm", fid: h.from, name: h.name, text: h.text, at: h.at });
    }
    // Friends who list this player see them come on.
    for (const f of peer.friendFids) {
      const o = this.byFid.get(f);
      if (o && o !== peer && this.mutual(peer, o)) this.tell(o);
    }
  }

  forget(peer: Peer): void {
    if (peer.fid && this.byFid.get(peer.fid) === peer) {
      this.byFid.delete(peer.fid);
      this.lastFriends.set(peer.fid, { friends: peer.friendFids, dms: peer.acceptsDms, at: Date.now() });
      if (this.lastFriends.size > 50_000) this.sweep();
      for (const f of peer.friendFids) {
        const o = this.byFid.get(f);
        if (o && this.mutual(peer, o)) this.tell(o);
      }
    }
  }

  /** Both list each other, both connected, neither blocked the other. */
  mutual(a: Peer, b: Peer): boolean {
    return !!a.fid && !!b.fid && a.friendFids.has(b.fid) && b.friendFids.has(a.fid) && a.connected && b.connected && !a.blockedWith(b);
  }

  /** Send a peer the state of their friends. */
  tell(peer: Peer): void {
    if (!peer.connected || !peer.fid) return;
    const on: string[] = [];
    const rm: string[] = [];
    const pl: string[] = [];
    for (const f of peer.friendFids) {
      const o = this.byFid.get(f);
      if (!o || !this.mutual(peer, o)) continue;
      const room = this.lobby.roomOf(o);
      (room?.playing ? pl : room ? rm : on).push(f);
    }
    peer.send({ t: "fr", on, rm, pl });
  }

  /** Everyone's friends' state, now and then (rooms come and go). */
  tellAll(): void {
    for (const p of this.byFid.values()) if (p.connected) this.tell(p);
  }

  /** A friend request to `target`. Returns a note for the asker, or null when it went. */
  request(from: Peer, target: Peer | undefined): string | null {
    if (!target || target === from || !target.connected) return "They're not online right now.";
    if (!from.fid || !target.fid) return "They can't take friend requests in this version of the game.";
    if (from.blockedWith(target)) return "You can't add them.";
    if (!target.acceptsReqs) return `${target.name} isn't taking friend requests.`;
    if (from.friendFids.has(target.fid) && target.friendFids.has(from.fid)) return `You and ${target.name} are already friends.`;
    if (!from.allowChat()) return "Easy! Try again in a moment.";
    from.asked.add(target.id);
    target.send({ t: "freq", id: from.id, name: from.name, fid: from.fid });
    return null;
  }

  /** `by` said yes to `asker`'s request: tell the asker, so they add `by`. */
  accept(by: Peer, asker: Peer | undefined): void {
    if (!asker || !asker.asked.has(by.id) || !by.fid) return;
    asker.asked.delete(by.id);
    asker.send({ t: "facc", name: by.name, fid: by.fid });
  }

  /**
   * v6 max (3.11): a direct message. Only between friends who list each other
   * (so nobody gets one from a stranger, whatever their age), never blocked,
   * cleaned like chat (no numbers, links, handles or addresses), at chat's
   * pace. A friend who is off gets it when they come on (held a day, in memory).
   */
  dm(from: Peer, to: string, raw: string, n: number): void {
    const no = (why: string) => from.send({ t: "dmack", to, n, why });
    if (!from.fid) return no("Messages need the friends list on.");
    if (!from.friendFids.has(to)) return no("Only friends can message each other.");
    if (!from.allowChat()) return no("Easy! Try again in a moment.");
    const { text, changed } = filterChat(raw);
    if (!text) return no("Nothing to send.");
    const target = this.byFid.get(to);
    const at = Date.now();
    const evidence = (line: string) => {
      const key = [from.fid, to].sort().join("|");
      const list = this.between.get(key) ?? [];
      list.push(line);
      if (list.length > EVIDENCE) list.shift();
      this.between.set(key, list);
      if (this.between.size > 100_000) this.between.clear();
    };
    if (target && target.connected) {
      if (!target.friendFids.has(from.fid) || from.blockedWith(target)) return no("You're not on each other's friends lists.");
      if (!target.acceptsDms) return no(`${target.name} has messages off.`);
      target.send({ t: "dm", fid: from.fid, name: from.name, text, at });
      evidence(`${from.name}: ${text}`);
      return from.send({ t: "dmack", to, n, ok: 1, ...(changed ? { text } : {}) });
    }
    // Off: only if, when they left, they listed this sender and took messages.
    const last = this.lastFriends.get(to);
    if (!last || !last.friends.has(from.fid) || !last.dms || at - last.at > HOLD_MS) return no("They're not online right now.");
    const list = (this.held.get(to) ?? []).filter((h) => at - h.at < HOLD_MS);
    if (list.length >= HOLD_MAX) return no("They have too many messages waiting.");
    list.push({ from: from.fid, name: from.name, text, at });
    this.held.set(to, list);
    evidence(`${from.name}: ${text}`);
    from.send({ t: "dmack", to, n, held: 1, ...(changed ? { text } : {}) });
  }

  /** The last lines between two friends (a report's evidence). */
  evidence(a: string, b: string): string[] {
    return [...(this.between.get([a, b].sort().join("|")) ?? [])];
  }

  /** A friend's peer, if both list each other and they're on. */
  friend(of: Peer, fid: string): Peer | null {
    const o = this.byFid.get(fid);
    return o && this.mutual(of, o) ? o : null;
  }

  /** Drop what's older than a day. */
  sweep(): void {
    const t = Date.now();
    for (const [k, v] of this.lastFriends) if (t - v.at > HOLD_MS) this.lastFriends.delete(k);
    for (const [k, v] of this.held) if (!v.some((h) => t - h.at < HOLD_MS)) this.held.delete(k);
  }

  /** Invite a friend to the room `from` is in. Returns a note for the sender. */
  invite(from: Peer, fid: string): string {
    const target = this.byFid.get(fid);
    if (!target || !this.mutual(from, target)) return "They're not online right now.";
    const room = this.lobby.roomOf(from);
    const code = room?.code;
    if (!room || !code || room.kind !== "private") return "Make a room first, then invite.";
    if (!from.allowChat()) return "Easy! Try again in a moment.";
    target.send({ t: "inv", name: from.name, fid: from.fid, code });
    return `Invited ${target.name}.`;
  }
}
