// A small Redis client (v6 max, 3.12: "talk between services: Redis pub/sub").
// RESP2 over one socket, no dependency: commands in order, pub/sub on a second
// connection, TLS for rediss:// (Upstash, Fly's Redis), AUTH and SELECT from
// the URL, reconnect with the subscriptions restored. Enough for what the
// services need (strings, lists, hashes, sorted sets, publish/subscribe), not
// a general client.
//
//   const r = new Redis("rediss://default:pass@host:6379");
//   await r.cmd("SET", "k", "v", "EX", "60");
//   r.subscribe("dm:A", (msg) => …);   // its own connection, made on first use

import { connect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

export type Reply = string | number | null | Reply[];

interface Waiting {
  resolve(v: Reply): void;
  reject(e: Error): void;
}

/** One complete reply at `at` in buf: [reply, the offset after it], or null while it's still arriving. */
export function parseReply(buf: Buffer, at = 0): [Reply | Error, number] | null {
  if (at >= buf.length) return null;
  const end = buf.indexOf("\r\n", at);
  if (end < 0) return null;
  const type = String.fromCharCode(buf[at]);
  const line = buf.toString("utf8", at + 1, end);
  const next = end + 2;
  switch (type) {
    case "+":
      return [line, next];
    case "-":
      return [new Error(line), next];
    case ":":
      return [Number(line), next];
    case "$": {
      const n = Number(line);
      if (n < 0) return [null, next];
      if (buf.length < next + n + 2) return null;
      return [buf.toString("utf8", next, next + n), next + n + 2];
    }
    case "*": {
      const n = Number(line);
      if (n < 0) return [null, next];
      const out: Reply[] = [];
      let p = next;
      for (let i = 0; i < n; i++) {
        const r = parseReply(buf, p);
        if (!r) return null;
        const [v, q] = r;
        out.push(v instanceof Error ? v.message : v);
        p = q;
      }
      return [out, p];
    }
    default:
      throw new Error(`redis: unexpected reply type ${JSON.stringify(type)}`);
  }
}

export function encode(args: readonly (string | number)[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const b = Buffer.from(String(a), "utf8");
    parts.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

class Conn {
  private sock: Socket | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private readonly waiting: Waiting[] = [];
  /** Commands asked for while it (re)connects. */
  private readonly backlog: Buffer[] = [];
  private closed = false;
  private retry = 250;

  constructor(
    private readonly url: URL,
    private readonly onPush: ((v: Reply[]) => void) | null,
    private readonly onOpen: () => void,
  ) {
    this.open();
  }

  private open(): void {
    const u = this.url;
    const opts = { host: u.hostname, port: Number(u.port || 6379) };
    const s = u.protocol === "rediss:" ? tlsConnect({ ...opts, servername: u.hostname }) : connect(opts);
    s.setNoDelay(true);
    s.setKeepAlive(true, 30_000);
    s.on("data", (d: Buffer) => this.onData(d));
    s.on("error", () => {});
    s.on("close", () => {
      this.sock = null;
      this.buf = Buffer.alloc(0);
      for (const w of this.waiting.splice(0)) w.reject(new Error("redis: connection lost"));
      if (this.closed) return;
      setTimeout(() => this.open(), this.retry).unref();
      this.retry = Math.min(5000, this.retry * 2);
    });
    s.once(u.protocol === "rediss:" ? "secureConnect" : "connect", () => {
      this.sock = s;
      this.retry = 250;
      // AUTH and SELECT first, ahead of anything waiting; their replies are taken off silently.
      const pre: (string | number)[][] = [];
      if (u.password) pre.push(u.username && u.username !== "default" ? ["AUTH", decodeURIComponent(u.username), decodeURIComponent(u.password)] : ["AUTH", decodeURIComponent(u.password)]);
      const db = Number(u.pathname.slice(1));
      if (db > 0) pre.push(["SELECT", db]);
      for (const p of pre) {
        this.waiting.unshift({ resolve: () => {}, reject: () => {} });
        s.write(encode(p));
      }
      // (unshift above put them in reverse; they're all no-ops, so the order doesn't matter.)
      for (const b of this.backlog.splice(0)) s.write(b);
      this.onOpen();
    });
  }

  private onData(d: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let at = 0;
    for (;;) {
      const r = parseReply(this.buf, at);
      if (!r) break;
      const [v, next] = r;
      at = next;
      // A subscriber's pushes: ["message", channel, payload].
      if (this.onPush && Array.isArray(v) && (v[0] === "message" || v[0] === "subscribe" || v[0] === "unsubscribe")) {
        if (v[0] === "message") this.onPush(v);
        continue;
      }
      const w = this.waiting.shift();
      if (!w) continue;
      if (v instanceof Error) w.reject(v);
      else w.resolve(v);
    }
    this.buf = at >= this.buf.length ? Buffer.alloc(0) : this.buf.subarray(at);
  }

  send(args: readonly (string | number)[], expectReply = true): Promise<Reply> {
    if (this.closed) return Promise.reject(new Error("redis: closed"));
    const b = encode(args);
    return new Promise((resolve, reject) => {
      if (expectReply) this.waiting.push({ resolve, reject });
      else resolve(null);
      if (this.sock) this.sock.write(b);
      else if (this.backlog.length < 10_000) this.backlog.push(b);
      else reject(new Error("redis: backlog full"));
    });
  }

  close(): void {
    this.closed = true;
    this.sock?.end();
  }
}

export class Redis {
  private readonly url: URL;
  private readonly conn: Conn;
  private sub: Conn | null = null;
  private readonly handlers = new Map<string, (msg: string) => void>();

  constructor(url: string) {
    this.url = new URL(url);
    if (this.url.protocol !== "redis:" && this.url.protocol !== "rediss:") throw new Error("redis: the URL must be redis:// or rediss://");
    this.conn = new Conn(this.url, null, () => {});
  }

  cmd(...args: (string | number)[]): Promise<Reply> {
    return this.conn.send(args);
  }

  /** Listen on a channel (its own connection; subscriptions come back after a reconnect). */
  subscribe(channel: string, fn: (msg: string) => void): void {
    this.handlers.set(channel, fn);
    if (!this.sub) {
      this.sub = new Conn(
        this.url,
        (v) => this.handlers.get(String(v[1]))?.(String(v[2])),
        () => {
          // (Re)connected: every channel again.
          if (this.handlers.size) void this.sub?.send(["SUBSCRIBE", ...this.handlers.keys()], false);
        },
      );
    } else void this.sub.send(["SUBSCRIBE", channel], false);
  }

  close(): void {
    this.conn.close();
    this.sub?.close();
  }
}
