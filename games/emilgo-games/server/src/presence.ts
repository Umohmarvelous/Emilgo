// Friends (SPEC-V2 Decisions, "Invite Lagos Life friends"): who is on, friend
// requests and room invites. Nothing is stored: a phone says who it is (its
// friend id, random, made on the phone) and who its friends are each time it
// connects, and the server forgets both when it goes.
//
// Friendship must be mutual for anything to pass: you see a friend as online,
// and can invite them, only if they list you too. So a friend id on its own
// tells a stranger nothing. Friend ids are per copy of the game (Lagos Life's
// and EMILGO's are different), so they never link a player across services.
//
// v6 max (3.11, 3.12): direct messages between friends, and friends on other
// nodes. Through `shared` (shared.ts: Redis when there are many nodes, this
// process's memory when there's one):
//   pres:<fid>   who is on, on which node, whom they list, whether they take
//                messages, what they're doing (refreshed every 15 s, gone in 90)
//   lf:<fid>     whom an absent player listed when they left (a day): a message
//                held for them needs it
//   held:<fid>   messages waiting for a friend who is off (20 at most, a day)
//   ev:<a|b>     the last lines passed between two friends (a report's evidence)
//   dm:<node>    a channel per node: a message for a friend connected there

import { filterChat } from "../../src/social/filter";
import type { Lobby } from "./lobby";
import type { Peer } from "./peer";
import type { Shared } from "./shared";

const HOLD_MAX = 20;
const DAY_S = 86_400;
const PRES_S = 90;
const EVIDENCE = 6;

type FriendState = "on" | "rm" | "pl";

interface Pres {
  /** The node it's connected to. */
  n: string;
  /** Whom it lists. */
  f: string[];
  /** Takes messages. */
  d: boolean;
  st: FriendState;
}

interface Remote {
  to: string;
  from: string;
  name: string;
  text: string;
  at: number;
}

export class Presence {
  private readonly byFid = new Map<string, Peer>();

  constructor(
    private readonly lobby: Pick<Lobby, "roomOf">,
    private readonly shared: Shared,
    private readonly node = "",
  ) {
    // Messages for friends connected here, from other nodes.
    shared.subscribe(`dm:${node}`, (m) => this.arrive(m as Remote));
  }

  /** A phone said who it is (and again whenever its list changes). */
  identify(peer: Peer, fid: string, friends: string[]): void {
    if (peer.fid && peer.fid !== fid && this.byFid.get(peer.fid) === peer) this.byFid.delete(peer.fid);
    // A friend id already on another live connection: the newer one wins (the same phone reconnecting).
    peer.fid = fid;
    peer.friendFids = new Set(friends.slice(0, 100));
    this.byFid.set(fid, peer);
    void this.announce(peer);
    void this.shared.del(`lf:${fid}`).catch(() => {});
    void this.tell(peer);
    // Friends who list this player see them come on.
    for (const f of peer.friendFids) {
      const o = this.byFid.get(f);
      if (o && o !== peer && this.mutual(peer, o)) void this.tell(o);
    }
    // Messages friends sent while this player was off.
    void this.shared
      .drain(`held:${fid}`)
      .then((list) => {
        const t = Date.now();
        for (const h of list as Remote[]) if (h && t - h.at < DAY_S * 1000 && peer.friendFids.has(h.from) && peer.connected) peer.send({ t: "dm", fid: h.from, name: h.name, text: h.text, at: h.at });
      })
      .catch(() => {});
  }

  forget(peer: Peer): void {
    if (peer.fid && this.byFid.get(peer.fid) === peer) {
      this.byFid.delete(peer.fid);
      void this.shared.del(`pres:${peer.fid}`).catch(() => {});
      void this.shared.setJson(`lf:${peer.fid}`, { f: [...peer.friendFids], d: peer.acceptsDms }, DAY_S).catch(() => {});
      for (const f of peer.friendFids) {
        const o = this.byFid.get(f);
        if (o && this.mutual(peer, o)) void this.tell(o);
      }
    }
  }

  /** Both list each other, both connected, neither blocked the other. */
  mutual(a: Peer, b: Peer): boolean {
    return !!a.fid && !!b.fid && a.friendFids.has(b.fid) && b.friendFids.has(a.fid) && a.connected && b.connected && !a.blockedWith(b);
  }

  private stateOf(p: Peer): FriendState {
    const room = this.lobby.roomOf(p);
    return room?.playing ? "pl" : room ? "rm" : "on";
  }

  /** Tell the other nodes this player is on, here (and what they're doing). */
  private announce(p: Peer): Promise<void> {
    if (!p.fid || !p.connected) return Promise.resolve();
    const pres: Pres = { n: this.node, f: [...p.friendFids], d: p.acceptsDms, st: this.stateOf(p) };
    return this.shared.setJson(`pres:${p.fid}`, pres, PRES_S).catch(() => {});
  }

  /** Send a peer the state of their friends: those here, and those on other nodes who list them back. */
  async tell(peer: Peer): Promise<void> {
    if (!peer.connected || !peer.fid) return;
    const lists: Record<FriendState, string[]> = { on: [], rm: [], pl: [] };
    const away: string[] = [];
    for (const f of peer.friendFids) {
      const o = this.byFid.get(f);
      if (o) {
        if (this.mutual(peer, o)) lists[this.stateOf(o)].push(f);
      } else away.push(f);
    }
    if (away.length) {
      try {
        const got = (await this.shared.getJson(away.map((f) => `pres:${f}`))) as (Pres | null)[];
        got.forEach((p, i) => {
          if (p && p.n !== this.node && Array.isArray(p.f) && p.f.includes(peer.fid) && (p.st === "on" || p.st === "rm" || p.st === "pl")) lists[p.st].push(away[i]);
        });
      } catch {
        // The shared store is away: this node's friends only.
      }
    }
    if (peer.connected) peer.send({ t: "fr", on: lists.on, rm: lists.rm, pl: lists.pl });
  }

  /** Everyone's friends' state, now and then (rooms come and go); and everyone here announced again. */
  tellAll(): void {
    for (const p of this.byFid.values()) {
      if (!p.connected) continue;
      void this.announce(p);
      void this.tell(p);
    }
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
   * pace. On another node: passed over the shared bus. Off: held a day.
   */
  dm(from: Peer, to: string, raw: string, n: number): void {
    const no = (why: string) => from.send({ t: "dmack", to, n, why });
    if (!from.fid) return no("Messages need the friends list on.");
    if (!from.friendFids.has(to)) return no("Only friends can message each other.");
    if (!from.allowChat()) return no("Easy! Try again in a moment.");
    const { text, changed } = filterChat(raw);
    if (!text) return no("Nothing to send.");
    const at = Date.now();
    const shown = changed ? { text } : {};
    const target = this.byFid.get(to);
    if (target && target.connected) {
      if (!target.friendFids.has(from.fid) || from.blockedWith(target)) return no("You're not on each other's friends lists.");
      if (!target.acceptsDms) return no(`${target.name} has messages off.`);
      target.send({ t: "dm", fid: from.fid, name: from.name, text, at });
      this.keep(from.fid, to, `${from.name}: ${text}`);
      return from.send({ t: "dmack", to, n, ok: 1, ...shown });
    }
    // On another node, or off.
    const msg: Remote = { to, from: from.fid, name: from.name, text, at };
    void this.shared
      .getJson([`pres:${to}`, `lf:${to}`])
      .then(async ([p, l]) => {
        const pres = p as Pres | null;
        const last = l as { f: string[]; d: boolean } | null;
        if (pres && pres.n !== this.node && Array.isArray(pres.f)) {
          if (!pres.f.includes(from.fid)) return no("You're not on each other's friends lists.");
          if (!pres.d) return no("They have messages off.");
          this.shared.publish(`dm:${pres.n}`, msg);
          this.keep(from.fid, to, `${from.name}: ${text}`);
          return from.send({ t: "dmack", to, n, ok: 1, ...shown });
        }
        if (!last || !Array.isArray(last.f) || !last.f.includes(from.fid) || !last.d) return no("They're not online right now.");
        // The newest 20 wait (an older one drops off the front).
        await this.shared.push(`held:${to}`, msg, DAY_S, HOLD_MAX);
        this.keep(from.fid, to, `${from.name}: ${text}`);
        from.send({ t: "dmack", to, n, held: 1, ...shown });
      })
      .catch(() => no("Messages are down for a moment. Try again."));
  }

  /** A message from another node, for a friend connected here (or held if they've just gone). */
  private arrive(m: Remote): void {
    if (!m || typeof m.to !== "string" || typeof m.text !== "string") return;
    const target = this.byFid.get(m.to);
    if (target && target.connected) {
      if (target.friendFids.has(m.from) && target.acceptsDms) target.send({ t: "dm", fid: m.from, name: m.name, text: m.text, at: m.at });
      return;
    }
    void this.shared.push(`held:${m.to}`, m, DAY_S, HOLD_MAX).catch(() => {});
  }

  /** The last lines between two friends, for a report. */
  private keep(a: string, b: string, line: string): void {
    void this.shared.push(`ev:${[a, b].sort().join("|")}`, line, 7 * DAY_S, EVIDENCE).catch(() => {});
  }

  /** The last lines between two friends (a report's evidence). The list stays (a second report sees it too). */
  async evidence(a: string, b: string): Promise<string[]> {
    const key = `ev:${[a, b].sort().join("|")}`;
    const lines = (await this.shared.drain(key).catch(() => [])) as string[];
    for (const l of lines) void this.shared.push(key, l, 7 * DAY_S, EVIDENCE).catch(() => {});
    return lines.filter((l) => typeof l === "string");
  }

  /** A friend's peer, if both list each other and they're on this node. */
  friend(of: Peer, fid: string): Peer | null {
    const o = this.byFid.get(fid);
    return o && this.mutual(of, o) ? o : null;
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
