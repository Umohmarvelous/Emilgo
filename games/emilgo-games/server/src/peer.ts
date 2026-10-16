// One connected player: a socket, an identity for this process's lifetime, a
// rate limiter and a running measure of their round trip.
//
// Identity is deliberately thin: a random id and a resume token, both forgotten
// when the process restarts. No account, no device id, nothing that links a
// player across sessions, rooms or services.

import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";

import { NET } from "../../src/config";
import type { ServerMsg } from "../../src/net/protocol";
import type { WireLook } from "../../src/shop/catalog";
import { now } from "./clock";

/** LAG_GRACE_CAP=0 turns lag compensation off — for the fairness test's control run only. */
const LAG_GRACE_CAP = Number(process.env.LAG_GRACE_CAP ?? NET.lagGraceCap);

export class Peer {
  readonly id = randomBytes(6).toString("base64url");
  readonly token = randomBytes(18).toString("base64url");
  name = "";
  hello = false;
  /** Room this peer is in, by room id. */
  roomId: string | null = null;
  socket: WebSocket | null;
  /** When the socket dropped (for rejoin), or 0 while connected. */
  droppedAt = 0;
  lastSeen = now();

  private readonly rtts: number[] = [];
  private rttMedian = 0;
  private pingSentAt = 0;
  /** Peers this one has blocked, or been blocked by (both ways: they stop seeing each other). */
  readonly blocks = new Set<string>();
  /** The last few lines this peer said, kept only as evidence if someone reports them. */
  readonly recent: string[] = [];
  /** What this player owns (from a verified ticket) and is wearing. */
  owned: ReadonlySet<string> = new Set();
  look: WireLook = {};
  private chatTokens = 3;
  private chatRefill = now();
  private tokens = 80;
  private lastRefill = now();
  private strikes = 0;

  constructor(socket: WebSocket, readonly ip: string) {
    this.socket = socket;
  }

  get connected(): boolean {
    return !!this.socket && this.socket.readyState === 1;
  }

  /** Median of recent round trips, ms. 0 until measured. Recomputed on each pong. */
  get rtt(): number {
    return this.rttMedian;
  }

  /** Detection allowance for the referee, seconds. */
  get graceBonus(): number {
    return Math.min(LAG_GRACE_CAP, this.rtt / 1000);
  }

  send(msg: ServerMsg): void {
    if (this.connected) this.socket!.send(JSON.stringify(msg));
  }

  /** Pre-encoded broadcast: one stringify and one UTF-8 encode per room, not per player. */
  sendRaw(frame: Buffer): void {
    if (this.connected) this.socket!.send(frame, { binary: false });
  }

  ping(): void {
    this.pingSentAt = now();
    this.send({ t: "ping", s: this.pingSentAt, rtt: this.rtt });
  }

  pong(s: number): void {
    // Only count the answer to the ping we actually sent.
    if (s !== this.pingSentAt) return;
    const rtt = now() - s;
    if (rtt < 0 || rtt > 10_000) return;
    this.rtts.push(rtt);
    if (this.rtts.length > 7) this.rtts.shift();
    const sorted = [...this.rtts].sort((a, b) => a - b);
    this.rttMedian = sorted[sorted.length >> 1];
  }

  /**
   * Token bucket: 40 messages a second sustained, bursts of 80. Returns false
   * to drop a message; `abusive` turns true after repeated floods.
   */
  allow(): boolean {
    const t = now();
    this.tokens = Math.min(80, this.tokens + ((t - this.lastRefill) / 1000) * 40);
    this.lastRefill = t;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    this.strikes++;
    return false;
  }

  /** Chat: one line every 1.5 s, bursts of 3. Emotes share the same allowance. */
  allowChat(): boolean {
    const t = now();
    this.chatTokens = Math.min(3, this.chatTokens + (t - this.chatRefill) / 1500);
    this.chatRefill = t;
    if (this.chatTokens < 1) return false;
    this.chatTokens -= 1;
    return true;
  }

  remember(line: string): void {
    this.recent.push(line);
    if (this.recent.length > 5) this.recent.shift();
  }

  blockedWith(other: Peer): boolean {
    return this.blocks.has(other.id) || other.blocks.has(this.id);
  }

  get abusive(): boolean {
    return this.strikes > 200;
  }

  attach(socket: WebSocket): void {
    this.socket = socket;
    this.droppedAt = 0;
    this.rtts.length = 0;
    this.rttMedian = 0;
    this.lastSeen = now();
  }

  detach(): void {
    this.socket = null;
    this.droppedAt = now();
  }
}
