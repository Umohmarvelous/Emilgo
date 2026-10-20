// Friends, on the phone (SPEC-V2 Decisions, "Invite Lagos Life friends").
// The list lives in settings (this copy of the game only); the server
// (server/src/presence.ts) only says which friends are on, and passes on
// requests and invites while both are connected. Nothing about a friend
// leaves the phone except their random friend id.

import type { ServerMsg } from "../net/protocol";
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
        if (!this.settings.friendReqs || !FID_RE.test(m.fid)) return true;
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
