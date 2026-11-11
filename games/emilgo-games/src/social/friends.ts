// Friends, on the phone (SPEC-V2 Decisions, "Invite Lagos Life friends").
// The list lives in settings (this copy of the game only); the server
// (server/src/presence.ts) only says which friends are on, and passes on
// requests and invites while both are connected. Nothing about a friend
// leaves the phone except their random friend id.

import type { ReportReason, ServerMsg } from "../net/protocol";
import { addDm } from "./profile";
import { FID_RE, type Friend, type Settings } from "../settings";

export type FriendState = "off" | "on" | "room" | "playing";

export interface FriendRequest {
  /** Answers them (the asker's connection id). */
  id: string;
  name: string;
  fid: string;
  at: number;
}

export interface Invite {
  name: string;
  fid: string;
  code: string;
  at: number;
}

/** What the lobby pops up (when notifications are on). */
export type Notice = { kind: "request"; req: FriendRequest } | { kind: "invite"; inv: Invite };

export class Friends {
  /** By friend id; missing = offline (or not listing us back). */
  private state = new Map<string, FriendState>();
  requests: FriendRequest[] = [];
  invites: Invite[] = [];
  private noticeFn: (n: Notice) => void = () => {};
  private changeFn: () => void = () => {};
  /** v6 max (3.11): a direct message came in (fid, name, text). */
  private dmFn: (fid: string, name: string, text: string) => void = () => {};
  private dmN = 0;

  constructor(
    private readonly settings: Settings,
    private readonly save: () => void,
    private readonly send: (msg: object) => void,
  ) {}

  onNotice(fn: (n: Notice) => void): void {
    this.noticeFn = fn;
  }

  onChange(fn: () => void): void {
    this.changeFn = fn;
  }

  onDm(fn: (fid: string, name: string, text: string) => void): void {
    this.dmFn = fn;
  }

  // ── v6 max (3.11): direct messages ──

  /** Send a friend a message (the server says delivered, held or why not). */
  sendDm(fid: string, text: string): void {
    const f = this.settings.friends.find((x) => x.fid === fid);
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!f || !clean) return;
    const n = ++this.dmN;
    addDm(this.settings.dms, fid, f.name, { me: true, text: clean, at: Date.now(), n });
    this.save();
    this.send({ t: "dm", to: fid, text: clean, n });
    this.changeFn();
  }

  /** A thread opened: nothing unread in it now. */
  readDm(fid: string): void {
    const th = this.settings.dms[fid];
    if (th && th.unread) {
      th.unread = 0;
      this.save();
      this.changeFn();
    }
  }

  /** Report a friend's messages (the server keeps what it passed between you). */
  reportDm(fid: string, reason: ReportReason): void {
    this.send({ t: "dmrep", fid, reason });
  }

  /** Block from a thread: off the list, the thread gone, their requests ignored on this phone. */
  block(fid: string): void {
    if (!this.settings.blockedFids.includes(fid)) this.settings.blockedFids = [fid, ...this.settings.blockedFids].slice(0, 200);
    delete this.settings.dms[fid];
    this.remove(fid);
  }

  get list(): readonly Friend[] {
    return this.settings.friends;
  }

  stateOf(fid: string): FriendState {
    return this.state.get(fid) ?? "off";
  }

  /** Friends online, and of those, in a round (the lobby's friends panel). */
  counts(): { online: number; inMatch: number } {
    let online = 0;
    let inMatch = 0;
    for (const f of this.settings.friends) {
      const s = this.stateOf(f.fid);
      if (s !== "off") online++;
      if (s === "playing") inMatch++;
    }
    return { online, inMatch };
  }

  isFriend(fid: string): boolean {
    return this.settings.friends.some((f) => f.fid === fid);
  }

  /** Say who we are (on connect, and when the list changes). */
  hello(): void {
    this.send({ t: "me", fid: this.settings.fid, friends: this.settings.friends.map((f) => f.fid) });
  }

  /** Ask a player (their seat id in the room, or a recent player's) to be friends. */
  ask(id: string): void {
    this.send({ t: "freq", id });
  }

  accept(req: FriendRequest): void {
    this.add(req.fid, req.name);
    this.send({ t: "facc", id: req.id });
    this.requests = this.requests.filter((r) => r !== req);
    this.changeFn();
  }

  decline(req: FriendRequest): void {
    this.requests = this.requests.filter((r) => r !== req);
    this.changeFn();
  }

  remove(fid: string): void {
    this.settings.friends = this.settings.friends.filter((f) => f.fid !== fid);
    this.state.delete(fid);
    this.save();
    this.hello();
    this.changeFn();
  }

  invite(fid: string): void {
    this.send({ t: "inv", fid });
  }

  dropInvite(inv: Invite): void {
    this.invites = this.invites.filter((i) => i !== inv);
    this.changeFn();
  }

  /** Server messages for friends; true if it was one. */
  receive(m: ServerMsg): boolean {
    switch (m.t) {
      case "fr": {
        this.state.clear();
        for (const f of m.on) this.state.set(f, "on");
        for (const f of m.rm) this.state.set(f, "room");
        for (const f of m.pl) this.state.set(f, "playing");
        this.changeFn();
        return true;
      }
      case "freq": {
        if (!this.settings.friendReqs || !FID_RE.test(m.fid) || this.settings.blockedFids.includes(m.fid)) return true;
        if (this.isFriend(m.fid)) {
          // Already on our list (they removed us and asked again): say yes at once.
          this.send({ t: "facc", id: m.id });
          return true;
        }
        const req: FriendRequest = { id: m.id, name: m.name, fid: m.fid, at: Date.now() };
        this.requests = [req, ...this.requests.filter((r) => r.fid !== m.fid)].slice(0, 20);
        this.changeFn();
        if (this.settings.notify) this.noticeFn({ kind: "request", req });
        return true;
      }
      case "facc":
        if (FID_RE.test(m.fid)) this.add(m.fid, m.name);
        return true;
      case "dm": {
        // Only from a friend on this phone's list (the server checks both lists too).
        if (!this.isFriend(m.fid) || !this.settings.dmsOn) return true;
        addDm(this.settings.dms, m.fid, m.name, { me: false, text: m.text, at: Math.min(Date.now(), m.at) });
        this.save();
        this.dmFn(m.fid, m.name, m.text);
        this.changeFn();
        return true;
      }
      case "dmack": {
        const line = this.settings.dms[m.to]?.lines.find((l) => l.me && l.n === m.n);
        if (line) {
          delete line.n;
          if (m.text) line.text = m.text;
          if (m.held) line.held = true;
          if (m.why) line.fail = m.why;
          this.save();
          this.changeFn();
        }
        return true;
      }
      case "inv": {
        const inv: Invite = { name: m.name, fid: m.fid, code: m.code, at: Date.now() };
        this.invites = [inv, ...this.invites.filter((i) => i.fid !== m.fid)].slice(0, 10);
        this.changeFn();
        if (this.settings.notify) this.noticeFn({ kind: "invite", inv });
        return true;
      }
      default:
        return false;
    }
  }

  private add(fid: string, name: string): void {
    const rest = this.settings.friends.filter((f) => f.fid !== fid);
    this.settings.friends = [{ fid, name, at: Date.now() }, ...rest].slice(0, 100);
    this.save();
    this.hello();
    this.changeFn();
  }
}
