// The game's one connection to the game server.
//
// - Reconnects by itself while you are in a room (1 s, 2 s, 4 s … 8 s), and
//   resumes your seat with the token the server gave you — a tunnel or a
//   lift on the bus doesn't lose you the round.
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

  private ws: WebSocket | null = null;
  private token = "";
  private offset = 0; // serverTime ≈ performance.now() + offset
  private offsetSet = false;
  private readonly handlers = new Set<Handler>();
  private readonly stateHandlers = new Set<(s: NetState) => void>();
  private attempts = 0;
  private retryTimer = 0;
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
  private lastInputAt = 0;
  private inputTimer = 0;
  private connectWaiters: { ok: () => void; no: (e: Error) => void }[] = [];

  constructor(
    readonly url: string,
    private readonly displayName: string,
  ) {}

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
    clearTimeout(this.retryTimer);
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** World-space stick, −1…1. Stops go at once; everything else is throttled. */
  setInput(x: number, z: number): void {
    this.wantX = Math.round(Math.max(-1, Math.min(1, x)) * 100);
    this.wantZ = Math.round(Math.max(-1, Math.min(1, z)) * 100);
    const buttons = this.wantB !== this.sentB || this.wantJ !== this.sentJ || this.wantA !== this.sentA || this.wantG !== this.sentG;
    if (this.wantX === this.sentX && this.wantZ === this.sentZ && !buttons) return;
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

  resetInput(): void {
    this.wantX = this.wantZ = 0;
    this.wantB = 0;
    if (this.sentX || this.sentZ || this.sentB) this.flushInput();
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
    this.lastInputAt = performance.now();
    this.send({ t: "in", x: this.sentX, z: this.sentZ, b: this.sentB, j: this.sentJ, a: this.sentA, g: this.sentG });
  }

  // ── Socket ─────────────────────────────────────────────────────────────────

  private open(): void {
    this.setState(this.attempts ? "reconnecting" : "connecting");
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
    this.retryTimer = window.setTimeout(() => this.open(), delay);
  }

  private receive(m: ServerMsg): void {
    switch (m.t) {
      case "welcome":
        this.id = m.id;
        this.token = m.token;
        this.name = m.name;
        this.attempts = 0;
        if (!this.offsetSet) {
          this.offset = m.s - performance.now();
          this.offsetSet = true;
        }
        this.sentX = this.sentZ = 0;
        this.setState("open");
        for (const w of this.connectWaiters.splice(0)) w.ok();
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
