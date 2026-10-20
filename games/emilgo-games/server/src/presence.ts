// Friends (SPEC-V2 Decisions, "Invite Lagos Life friends"): who is on, friend
// requests and room invites. Nothing is stored: a phone says who it is (its
// friend id, random, made on the phone) and who its friends are each time it
// connects, and the server forgets both when it goes.
//
// Friendship must be mutual for anything to pass: you see a friend as online,
// and can invite them, only if they list you too. So a friend id on its own
// tells a stranger nothing. Friend ids are per copy of the game (Lagos Life's
// and EMILGO's are different), so they never link a player across services.

import type { Lobby } from "./lobby";
import type { Peer } from "./peer";

export class Presence {
  private readonly byFid = new Map<string, Peer>();

  constructor(private readonly lobby: Lobby) {}

  /** A phone said who it is (and again whenever its list changes). */
  identify(peer: Peer, fid: string, friends: string[]): void {
    if (peer.fid && peer.fid !== fid && this.byFid.get(peer.fid) === peer) this.byFid.delete(peer.fid);
    // A friend id already on another live connection: the newer one wins (the same phone reconnecting).
    peer.fid = fid;
    peer.friendFids = new Set(friends.slice(0, 100));
    this.byFid.set(fid, peer);
    this.tell(peer);
    // Friends who list this player see them come on.
    for (const f of peer.friendFids) {
      const o = this.byFid.get(f);
      if (o && o !== peer && this.mutual(peer, o)) this.tell(o);
    }
  }

  forget(peer: Peer): void {
    if (peer.fid && this.byFid.get(peer.fid) === peer) {
      this.byFid.delete(peer.fid);
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
