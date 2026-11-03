// The game's one connection to the game server.
//
// - Reconnects by itself while you are in a room (1 s, 2 s, 4 s … 8 s), and
//   resumes your seat with the token the server gave you — a tunnel or a
//   lift on the bus doesn't lose you the round.
// - Notices a dead link itself (NET.silentMs without a word from the server)
//   instead of waiting minutes for TCP, and tries again the moment the
//   phone's network comes back.
// - Keeps an estimate of the server's clock (offset + round trip), so other
//   runners can be drawn at a consistent point in the past.
// - Sends your stick: a STOP goes out at once, other changes at most
//   NET.inputHz a second.

import { NET } from "../config";
import { type ClientMsg, type ServerMsg } from "./protocol";

type Handler = (m: ServerMsg) => void;
export type NetState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export class NetClient {
  state: NetState = "idle";
  id = "";
  name = "";
  /** Smoothed round trip, ms. */
  rtt = 0;
  /** Set by the session: keep reconnecting while this is true. */
  wantConnection = false;
  /** The last welcome came back with a new identity: we were gone too long and the seat is gone. */
  lostSeat = false;

  private ws: WebSocket | null = null;
  private token = "";
  private offset = 0; // serverTime ≈ performance.now() + offset
  private offsetSet = false;
  private readonly handlers = new Set<Handler>();
  private readonly stateHandlers = new Set<(s: NetState) => void>();
  private attempts = 0;
  private retryTimer = 0;
  private watchTimer = 0;
  private lastHeard = 0;
  private sentX = 0;
  private sentZ = 0;
  private wantX = 0;
  private wantZ = 0;
  /** Buttons: sprint | stance << 1, and the jump counter. */
  private wantB = 0;
  private sentB = 0;
  private wantJ = 0;
  private sentJ = 0;
  private wantA = 0;
  private sentA = 0;
  private wantG = 0;
  private sentG = 0;
  /** Free For All (protocol 12): brace held, the interact counter | held << 8, the backpack counter. */
  private wantBrace = false;
  private sentBrace = false;
  private wantI = 0;
  private sentI = 0;
  private wantK = 0;
  private sentK = 0;
  /** Guns (protocol 15): the aim in milliradians, and the gun buttons word. */
  private wantY = 0;
  private sentY = 0;
  private wantP = 0;
  private sentP = 0;
  private wantW = 0;
  private sentW = 0;
  private match = false;
  private lastInputAt = 0;
  private inputTimer = 0;
  private connectWaiters: { ok: () => void; no: (e: Error) => void }[] = [];

  constructor(
    private url: string,
    private readonly displayName: string,
    /** v4 room directory: ask it where to connect (null: always `url`). */
    private readonly dir: string | null = null,
  ) {
    window.addEventListener("online", this.backOnline);
  }

  /** The node we're on (directory only): its address and shard letter. */
  private node: { url: string; shard: string } | null = null;
  /** Messages held while we move to the node that holds a code. */
  private moving: ClientMsg[] = [];

  /** The directory's word: where to connect (for a code or a Lagos Life match, the node holding it). */
  private async pick(key = ""): Promise<{ url: string; shard: string } | null> {
    if (!this.dir) return null;
    try {
      const ctl = new AbortController();
      const timer = window.setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`${this.dir.replace(/\/$/, "")}/dir/pick${key ? `?key=${encodeURIComponent(key)}` : ""}`, { signal: ctl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!r.ok) return null;
      const j = (await r.json()) as { url?: unknown; shard?: unknown };
      if (typeof j.url !== "string" || !/^wss?:\/\//.test(j.url) || typeof j.shard !== "string") return null;
      if (location.protocol === "https:" && j.url.startsWith("ws://")) return null;
      return { url: j.url, shard: j.shard };
    } catch {
      return null;
    }
  }

  /**
   * A room or party code, or a Lagos Life match, lives on one node: if it
   * isn't ours, move there (a fresh connection, no seat to resume) and send
   * the message once welcomed. Without a directory, or on the right node: send.
   */
  private route(msg: ClientMsg): boolean {
    if (!this.dir || !this.node) return false;
    const key = msg.t === "join" ? msg.code : msg.t === "party" && msg.op === "join" ? msg.code : msg.t === "vmatch" ? `v:${msg.id}` : "";
    if (!key || (!key.startsWith("v:") && key[0] === this.node.shard)) return false;
    void this.pick(key).then((n) => {
      if (!n || n.url === this.node?.url) return this.sendNow(msg);
      this.moving.push(msg);
      this.node = n;
      this.url = n.url;
      this.token = "";
      this.offsetSet = false;
      const ws = this.ws;
      this.ws = null;
      try {
        ws?.close(1000, "moving");
      } catch {
        /* already closed */
      }
      this.attempts = 0;
      this.open();
    });
    return true;
  }

  /** The phone's network is back: try now, not at the end of the back-off. */
  private readonly backOnline = (): void => {
    if (this.state === "open") {
      // The old socket may have died with the old network: if it's gone quiet, don't wait.
      if (performance.now() - this.lastHeard > NET.pingEveryMs + 500) this.drop();
      return;
    }
    if (this.state !== "reconnecting" || !this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    this.open();
  };

  /** Nothing from the server for too long: the link is dead even if the socket says open. */
  private readonly watch = (): void => {
    if (this.state === "open" && performance.now() - this.lastHeard > NET.silentMs) this.drop();
  };

  /** Let go of a dead socket and reconnect (resuming the seat). */
  private drop(): void {
    const ws = this.ws;
    this.ws = null; // its onclose, whenever it comes, is ignored
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    if (this.wantConnection) this.retry();
    else this.setState("closed");
  }

  on(fn: Handler): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  onState(fn: (s: NetState) => void): () => void {
    this.stateHandlers.add(fn);
    return () => this.stateHandlers.delete(fn);
  }

  /** Server time now (ms), as best we know it. */
  serverNow(): number {
    return performance.now() + this.offset;
  }

  /** Resolves once the server has welcomed us. */
  connect(): Promise<void> {
    this.wantConnection = true;
    if (this.state === "open") return Promise.resolve();
    const p = new Promise<void>((ok, no) => this.connectWaiters.push({ ok, no }));
    if (this.state !== "connecting" && this.state !== "reconnecting") this.open();
    return p;
  }

  close(): void {
    this.wantConnection = false;
    window.removeEventListener("online", this.backOnline);
    clearTimeout(this.retryTimer);
    clearInterval(this.watchTimer);
    this.watchTimer = 0;
    clearTimeout(this.inputTimer);
    this.token = "";
    this.attempts = 0;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, "bye");
    } catch {
      /* already closed */
    }
    this.setState("closed");
    this.fail(new Error("closed"));
  }

  send(msg: ClientMsg): void {
    if (this.route(msg)) return;
    this.sendNow(msg);
  }

  private sendNow(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** World-space stick, −1…1. Stops go at once; everything else is throttled. */
  setInput(x: number, z: number): void {
    this.wantX = Math.round(Math.max(-1, Math.min(1, x)) * 100);
    this.wantZ = Math.round(Math.max(-1, Math.min(1, z)) * 100);
    const buttons =
      this.wantB !== this.sentB || this.wantJ !== this.sentJ || this.wantA !== this.sentA || this.wantG !== this.sentG || this.wantBrace !== this.sentBrace || this.wantI !== this.sentI || this.wantK !== this.sentK || this.wantW !== this.sentW;
    // The aim alone is throttled like the stick (a moving aim is a steady stream).
    const aimed = Math.abs(this.wantY - this.sentY) > 2 || Math.abs(this.wantP - this.sentP) > 2;
    if (this.wantX === this.sentX && this.wantZ === this.sentZ && !buttons && !aimed) return;
    // Stops and buttons go at once: a late stop, jump, crouch or punch is a lost round.
    const stop = (this.wantX === 0 && this.wantZ === 0) || buttons;
    const gap = 1000 / NET.inputHz;
    const since = performance.now() - this.lastInputAt;
    if (stop || since >= gap) {
      this.flushInput();
    } else if (!this.inputTimer) {
      this.inputTimer = window.setTimeout(() => this.flushInput(), gap - since);
    }
  }

  /** Sprint held, stance wanted (0–2), jump counter. Sent at once when they change. */
  setButtons(sprint: boolean, stance: number, jump: number): void {
    this.wantB = (sprint ? 1 : 0) | ((stance & 3) << 1);
    this.wantJ = jump & 255;
    this.setInput(this.wantX / 100, this.wantZ / 100);
  }

  /** Attack and grab counters (rules.ts setActions). Sent at once when they change. */
  setActions(attack: number, grab: number): void {
    this.wantA = attack & 255;
    this.wantG = grab & 255;
    this.setInput(this.wantX / 100, this.wantZ / 100);
  }

  /** Free For All's buttons: brace held, the interact counter and whether it's held, the backpack's counter. Sent at once when they change. */
  setMatchButtons(brace: boolean, interact: number, hold: boolean, pack: number): void {
    this.match = true;
    this.wantBrace = brace;
    this.wantI = (interact & 255) | (hold ? 256 : 0);
    this.wantK = pack;
    this.setInput(this.wantX / 100, this.wantZ / 100);
  }

  /** Guns: where the camera aims (yaw, pitch radians) and the gun buttons (trigger, ADS, reload and swap counters). The buttons go at once. */
  setAim(yaw: number, pitch: number, trigger: boolean, ads: boolean, reload: number, swap: number): void {
    this.match = true;
    this.wantY = Math.round(Math.atan2(Math.sin(yaw), Math.cos(yaw)) * 1000);
    this.wantP = Math.round(Math.max(-1.1, Math.min(1.1, pitch)) * 1000);
    this.wantW = (trigger ? 1 : 0) | (ads ? 2 : 0) | ((reload & 15) << 2) | ((swap & 15) << 6);
    this.setInput(this.wantX / 100, this.wantZ / 100);
  }

  resetInput(): void {
    this.wantX = this.wantZ = 0;
    this.wantB = 0;
    this.wantBrace = false;
    this.wantI &= 255;
    this.wantW &= ~3;
    if (this.sentX || this.sentZ || this.sentB || this.sentBrace || this.sentI !== this.wantI || this.sentW !== this.wantW) this.flushInput();
    this.match = false;
  }

  private flushInput(): void {
    clearTimeout(this.inputTimer);
    this.inputTimer = 0;
    this.sentX = this.wantX;
    this.sentZ = this.wantZ;
    this.sentB = this.wantB;
    this.sentJ = this.wantJ;
    this.sentA = this.wantA;
    this.sentG = this.wantG;
    this.sentBrace = this.wantBrace;
    this.sentI = this.wantI;
    this.sentK = this.wantK;
    this.sentY = this.wantY;
    this.sentP = this.wantP;
    this.sentW = this.wantW;
    this.lastInputAt = performance.now();
    const b = this.sentB | (this.sentBrace ? 8 : 0);
    if (this.match) this.send({ t: "in", x: this.sentX, z: this.sentZ, b, j: this.sentJ, a: this.sentA, g: this.sentG, i: this.sentI, k: this.sentK, y: this.sentY, p: this.sentP, w: this.sentW });
    else this.send({ t: "in", x: this.sentX, z: this.sentZ, b, j: this.sentJ, a: this.sentA, g: this.sentG });
  }

  // ── Socket ─────────────────────────────────────────────────────────────────

  private open(): void {
    this.setState(this.attempts ? "reconnecting" : "connecting");
    // v4: with a directory, the first connection (and one after a node drained) asks it where to go.
    if (this.dir && !this.node) {
      void this.pick().then((n) => {
        if (!this.wantConnection || this.ws) return;
        this.node = n ?? { url: this.url, shard: "" };
        this.url = this.node.url;
        this.openSocket();
      });
      return;
    }
    this.openSocket();
  }

  private openSocket(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: "hello", v: NET.protocol, name: this.displayName, resume: this.token || undefined });
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastHeard = performance.now();
      if (typeof e.data !== "string") return;
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data) as ServerMsg;
      } catch {
        return;
      }
      this.receive(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      // A node draining for a deploy (1012): ask the directory for another.
      if (e.code === 1012 && this.dir) {
        this.node = null;
        this.token = "";
        this.offsetSet = false;
      }
      // 4001 = protocol version, 4008 = flooding: retrying won't help.
      if (e.code === 4001 || e.code === 4008 || !this.wantConnection) {
        this.setState("closed");
        this.fail(new Error(`closed ${e.code}`));
        return;
      }
      this.retry();
    };
    ws.onerror = () => {
      /* onclose follows and decides */
    };
  }

  private retry(): void {
    if (!this.wantConnection) return;
    this.attempts++;
    // A first connection that never opens is reported, not retried forever.
    if (!this.token && this.attempts > 3) {
      this.setState("closed");
      this.fail(new Error("unreachable"));
      return;
    }
    this.setState("reconnecting");
    const delay = Math.min(8000, 1000 * 2 ** Math.min(3, this.attempts - 1));
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      this.open();
    }, delay);
  }

  private receive(m: ServerMsg): void {
    switch (m.t) {
      case "welcome":
        this.lostSeat = !!this.token && this.token !== m.token;
        this.id = m.id;
        this.token = m.token;
        this.name = m.name;
        this.attempts = 0;
        if (!this.offsetSet) {
          this.offset = m.s - performance.now();
          this.offsetSet = true;
        }
        this.sentX = this.sentZ = 0;
        this.lastHeard = performance.now();
        if (!this.watchTimer) this.watchTimer = window.setInterval(this.watch, 1000);
        this.setState("open");
        for (const w of this.connectWaiters.splice(0)) w.ok();
        // Moved for a code: say it now, on its node (after everyone has heard the welcome).
        if (this.moving.length) {
          const held = this.moving.splice(0);
          queueMicrotask(() => held.forEach((x) => this.sendNow(x)));
        }
        break;
      case "ping": {
        this.send({ t: "pong", s: m.s });
        if (m.rtt > 0) {
          this.rtt = this.rtt ? this.rtt * 0.7 + m.rtt * 0.3 : m.rtt;
          // The ping left the server rtt/2 ago: that is "server now".
          const estimate = m.s + this.rtt / 2 - performance.now();
          this.offset = this.offsetSet ? this.offset * 0.8 + estimate * 0.2 : estimate;
          this.offsetSet = true;
        }
        break;
      }
      default:
        break;
    }
    for (const h of this.handlers) h(m);
  }

  private setState(s: NetState): void {
    if (s === this.state) return;
    this.state = s;
    for (const h of this.stateHandlers) h(s);
  }

  private fail(e: Error): void {
    for (const w of this.connectWaiters.splice(0)) w.no(e);
  }
}
