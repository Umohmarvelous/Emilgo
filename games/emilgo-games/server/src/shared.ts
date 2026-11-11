// What the services share (v6 max, 3.12): one small interface over Redis, or
// over this process's memory when there is no REDIS_URL (one node, as before).
//
//   pub/sub       nodes tell each other things: a direct message for a friend
//                 on another node
//   keys          short-lived JSON: who is on which node (presence), what an
//                 absent player listed (a held message needs it)
//   lists         messages held for a friend who is off (a day)
//   sorted sets   the leaderboards (a week's XP per player)
//   hashes        the leaderboards' display names
//
// Everything here can be lost without harm: presence rebuilds itself within a
// refresh, held messages are a courtesy, the boards are a week's tally.

import { Redis } from "./redis";

export interface Shared {
  readonly kind: "redis" | "memory";
  publish(channel: string, msg: unknown): void;
  subscribe(channel: string, fn: (msg: unknown) => void): void;
  setJson(key: string, value: unknown, ttlS: number): Promise<void>;
  getJson(keys: readonly string[]): Promise<unknown[]>;
  del(key: string): Promise<void>;
  /** Append to a list (kept `ttlS`, at most `max`, the oldest dropped). */
  push(key: string, value: unknown, ttlS: number, max: number): Promise<number>;
  /** The whole list, and it's gone. */
  drain(key: string): Promise<unknown[]>;
  zincr(key: string, member: string, by: number, ttlS: number): Promise<void>;
  /** The top n, highest first: [member, score]. */
  ztop(key: string, n: number): Promise<[string, number][]>;
  /** A member's place (0 = first) and score, or null. */
  zrank(key: string, member: string): Promise<{ place: number; score: number } | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hmget(key: string, fields: readonly string[]): Promise<(string | null)[]>;
  close(): void;
}

const parse = (s: unknown): unknown => {
  if (typeof s !== "string") return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export class RedisShared implements Shared {
  readonly kind = "redis";
  private readonly r: Redis;

  constructor(url: string) {
    this.r = new Redis(url);
  }

  publish(channel: string, msg: unknown): void {
    this.r.cmd("PUBLISH", channel, JSON.stringify(msg)).catch(() => {});
  }

  subscribe(channel: string, fn: (msg: unknown) => void): void {
    this.r.subscribe(channel, (s) => {
      const m = parse(s);
      if (m !== null) fn(m);
    });
  }

  async setJson(key: string, value: unknown, ttlS: number): Promise<void> {
    await this.r.cmd("SET", key, JSON.stringify(value), "EX", Math.max(1, Math.round(ttlS)));
  }

  async getJson(keys: readonly string[]): Promise<unknown[]> {
    if (!keys.length) return [];
    const v = await this.r.cmd("MGET", ...keys);
    return Array.isArray(v) ? v.map(parse) : keys.map(() => null);
  }

  async del(key: string): Promise<void> {
    await this.r.cmd("DEL", key);
  }

  async push(key: string, value: unknown, ttlS: number, max: number): Promise<number> {
    const n = Number(await this.r.cmd("RPUSH", key, JSON.stringify(value)));
    if (n > max) await this.r.cmd("LTRIM", key, -max, -1);
    await this.r.cmd("EXPIRE", key, Math.max(1, Math.round(ttlS)));
    return Math.min(n, max);
  }

  async drain(key: string): Promise<unknown[]> {
    // LRANGE then DEL in one MULTI: nothing pushed in between is lost. All four written in one go, so no other
    // command on this connection can land inside the transaction.
    const parts = [this.r.cmd("MULTI"), this.r.cmd("LRANGE", key, 0, -1), this.r.cmd("DEL", key)];
    const out = await this.r.cmd("EXEC");
    await Promise.all(parts);
    const list = Array.isArray(out) && Array.isArray(out[0]) ? out[0] : [];
    return list.map(parse).filter((x) => x !== null);
  }

  async zincr(key: string, member: string, by: number, ttlS: number): Promise<void> {
    await this.r.cmd("ZINCRBY", key, by, member);
    await this.r.cmd("EXPIRE", key, Math.max(1, Math.round(ttlS)));
  }

  async ztop(key: string, n: number): Promise<[string, number][]> {
    const v = await this.r.cmd("ZREVRANGE", key, 0, Math.max(0, n - 1), "WITHSCORES");
    const out: [string, number][] = [];
    if (Array.isArray(v)) for (let i = 0; i + 1 < v.length; i += 2) out.push([String(v[i]), Number(v[i + 1])]);
    return out;
  }

  async zrank(key: string, member: string): Promise<{ place: number; score: number } | null> {
    const [rank, score] = await Promise.all([this.r.cmd("ZREVRANK", key, member), this.r.cmd("ZSCORE", key, member)]);
    return rank === null || score === null ? null : { place: Number(rank), score: Number(score) };
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.r.cmd("HSET", key, field, value);
  }

  async hmget(key: string, fields: readonly string[]): Promise<(string | null)[]> {
    if (!fields.length) return [];
    const v = await this.r.cmd("HMGET", key, ...fields);
    return Array.isArray(v) ? v.map((x) => (x === null ? null : String(x))) : fields.map(() => null);
  }

  close(): void {
    this.r.close();
  }
}

/** One process's memory: the same semantics, for one node (and the tests: two nodes sharing one). */
export class MemoryShared implements Shared {
  readonly kind = "memory";
  private readonly subs = new Map<string, ((msg: unknown) => void)[]>();
  private readonly kv = new Map<string, { v: string; until: number }>();
  private readonly lists = new Map<string, { v: string[]; until: number }>();
  private readonly zsets = new Map<string, { m: Map<string, number>; until: number }>();
  private readonly hashes = new Map<string, Map<string, string>>();

  publish(channel: string, msg: unknown): void {
    const s = JSON.stringify(msg);
    // Delivered later, as a real bus would.
    for (const fn of this.subs.get(channel) ?? []) queueMicrotask(() => fn(JSON.parse(s)));
  }

  subscribe(channel: string, fn: (msg: unknown) => void): void {
    this.subs.set(channel, [...(this.subs.get(channel) ?? []), fn]);
  }

  async setJson(key: string, value: unknown, ttlS: number): Promise<void> {
    this.kv.set(key, { v: JSON.stringify(value), until: Date.now() + ttlS * 1000 });
    if (this.kv.size > 200_000) this.sweep();
  }

  async getJson(keys: readonly string[]): Promise<unknown[]> {
    const t = Date.now();
    return keys.map((k) => {
      const e = this.kv.get(k);
      return e && e.until > t ? parse(e.v) : null;
    });
  }

  async del(key: string): Promise<void> {
    this.kv.delete(key);
    this.lists.delete(key);
  }

  async push(key: string, value: unknown, ttlS: number, max: number): Promise<number> {
    const t = Date.now();
    const e = this.lists.get(key);
    const list = e && e.until > t ? e.v : [];
    list.push(JSON.stringify(value));
    while (list.length > max) list.shift();
    this.lists.set(key, { v: list, until: t + ttlS * 1000 });
    return list.length;
  }

  async drain(key: string): Promise<unknown[]> {
    const e = this.lists.get(key);
    this.lists.delete(key);
    return e && e.until > Date.now() ? e.v.map(parse).filter((x) => x !== null) : [];
  }

  async zincr(key: string, member: string, by: number, ttlS: number): Promise<void> {
    const t = Date.now();
    const e = this.zsets.get(key);
    const z = e && e.until > t ? e : { m: new Map<string, number>(), until: 0 };
    z.m.set(member, (z.m.get(member) ?? 0) + by);
    z.until = t + ttlS * 1000;
    this.zsets.set(key, z);
  }

  private sorted(key: string): [string, number][] {
    const e = this.zsets.get(key);
    if (!e || e.until <= Date.now()) return [];
    return [...e.m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));
  }

  async ztop(key: string, n: number): Promise<[string, number][]> {
    return this.sorted(key).slice(0, n);
  }

  async zrank(key: string, member: string): Promise<{ place: number; score: number } | null> {
    const s = this.sorted(key);
    const i = s.findIndex(([m]) => m === member);
    return i < 0 ? null : { place: i, score: s[i][1] };
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    const h = this.hashes.get(key) ?? new Map<string, string>();
    h.set(field, value);
    if (h.size > 500_000) h.clear();
    this.hashes.set(key, h);
  }

  async hmget(key: string, fields: readonly string[]): Promise<(string | null)[]> {
    const h = this.hashes.get(key);
    return fields.map((f) => h?.get(f) ?? null);
  }

  private sweep(): void {
    const t = Date.now();
    for (const [k, e] of this.kv) if (e.until <= t) this.kv.delete(k);
    for (const [k, e] of this.lists) if (e.until <= t) this.lists.delete(k);
  }

  close(): void {}
}

/** REDIS_URL set: Redis; else this process's memory. */
export function sharedFromEnv(env: NodeJS.ProcessEnv): Shared {
  const url = env.REDIS_URL?.trim();
  return url ? new RedisShared(url) : new MemoryShared();
}
