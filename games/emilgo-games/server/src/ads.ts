// Billboard ads, the server's side (SPEC-V3 §8).
//
//   GET  /ads/v1/match?map=&host=   this match's creatives for the map's
//        boards, and a one-report token. host=lagoslife is refused (403):
//        Agreement 4(g) bans advertising any payment but Vatar.purchase, so
//        paid boards never show in Lagos Life (the phone never asks there
//        either). With no ad stack configured: no creatives (house boards).
//   POST /ads/v1/seen   { v, map, host, tok, seen: [[slot, ad, secs]] }
//        seconds each paid board was on screen in one match. Taken once per
//        token, only for boards on that map and creatives served for it, and
//        added up per day, map, board and creative. No player id comes in and
//        none is kept (Agreement 4(f) bans profiling).
//
// The creatives live in the EMILGO Supabase ad stack (supabase/migrations/
// migration_game_billboards.sql): `next_billboards` and `record_billboard_seen`,
// called with the project's public anon key plus GAME_ADS_KEY, a secret the
// database checks (its hash is the only copy there). The game server never
// holds the service-role key.
//
// Environment:
//   SUPABASE_URL        the EMILGO project's URL (also used for rank sign-in)
//   SUPABASE_ANON_KEY   its public anon key
//   GAME_ADS_KEY        24+ chars; its SHA-256 is set in public.game_ads_config

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { buildNaijaWorld } from "../../src/maps/open/naija";
import { buildSpookyWorld } from "../../src/maps/open/spooky";

export interface SeenRow {
  day: string;
  map: string;
  slot: string;
  ad: string;
  secs: number;
  views: number;
}

export interface AdsBackend {
  /** The approved, live creatives that may show on this map (the database's shape). */
  next(map: string): Promise<unknown>;
  /** Add these seconds on screen. */
  record(rows: SeenRow[]): Promise<void>;
}

/** The ad stack in the EMILGO Supabase project, through two functions the anon key may call with GAME_ADS_KEY. */
export class SupabaseAds implements AdsBackend {
  constructor(
    private readonly url: string,
    private readonly anon: string,
    private readonly key: string,
  ) {}

  private async rpc(fn: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: this.anon, Authorization: `Bearer ${this.anon}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`${fn}: ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  next(map: string): Promise<unknown> {
    return this.rpc("next_billboards", { p_key: this.key, p_map: map });
  }

  async record(rows: SeenRow[]): Promise<void> {
    await this.rpc("record_billboard_seen", { p_key: this.key, p_rows: rows });
  }
}

export function adsBackendFromEnv(env: NodeJS.ProcessEnv): AdsBackend | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const anon = env.SUPABASE_ANON_KEY?.trim();
  const key = env.GAME_ADS_KEY?.trim();
  return url && anon && key && key.length >= 24 ? new SupabaseAds(url, anon, key) : null;
}

const MAPS: Record<string, () => { boards?: { id: string }[] }> = {
  "naija-world": () => buildNaijaWorld(),
  "spooky-world": () => buildSpookyWorld(),
};
const slotSets = new Map<string, ReadonlySet<string>>();

/** The billboard ids on a map (its layout, built once), or null for a map we don't have. */
export function boardIds(map: string): ReadonlySet<string> | null {
  const had = slotSets.get(map);
  if (had) return had;
  const build = MAPS[map];
  if (!build) return null;
  const set = new Set((build().boards ?? []).map((b) => b.id));
  slotSets.set(map, set);
  return set;
}

/** A creative in the phone's shape (net/ads.ts checks it again), or null. */
function clean(raw: unknown, slots: ReadonlySet<string>): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const https = (u: unknown): u is string => typeof u === "string" && u.length <= 600 && /^https:\/\/[^\s"'<>]+$/.test(u);
  if (typeof a.id !== "string" || !/^[0-9a-f-]{36}$/.test(a.id)) return null;
  const format = a.format;
  if (format !== "static" && format !== "slideshow" && format !== "video") return null;
  const images = Array.isArray(a.images) ? a.images.filter(https).slice(0, format === "static" ? 1 : 6) : [];
  const video = format === "video" && https(a.video) ? a.video : null;
  const poster = https(a.poster) ? a.poster : null;
  if (format === "video" ? !video || !poster : !images.length) return null;
  const booked = Array.isArray(a.slots) ? a.slots.filter((s): s is string => typeof s === "string" && slots.has(s)) : [];
  // Booked for boards, none of them on this map: not for this match.
  if (Array.isArray(a.slots) && a.slots.length && !booked.length) return null;
  const cycle = a.cycle === 0 || a.cycle === 10 || a.cycle === 30 ? a.cycle : 30;
  return { id: a.id, format, images, video, poster, cycle, audio: a.audio === true, slots: booked, premium: a.premium === true && booked.length > 0 };
}

/** One report's token: random, timed, signed by this process. Not a person. */
const TOKEN_TTL_MS = 3 * 3600_000;
/** How long a feed is reused for (s), and the most creatives in one. */
const FEED_TTL_MS = 60_000;
const MAX_ADS = 12;

export class Billboards {
  private readonly cache = new Map<string, { at: number; ads: Record<string, unknown>[] }>();
  /** map → creative id → when it was last served (reports only count what was served). */
  private readonly served = new Map<string, Map<string, number>>();
  /** token nonce → when it runs out (a used token is kept until then). */
  private readonly used = new Map<string, number>();
  private readonly pending = new Map<string, SeenRow>();
  private readonly secret: Buffer;
  private loggedAt = 0;
  readonly stats = { feeds: 0, refused: 0, reports: 0, rejected: 0, flushed: 0, errors: 0 };

  constructor(
    private readonly backend: AdsBackend | null,
    private readonly log: (msg: string) => void = (m) => console.log(m),
    secret?: Buffer,
    private readonly clock: () => number = Date.now,
  ) {
    this.secret = secret ?? randomBytes(32);
  }

  get configured(): boolean {
    return !!this.backend;
  }

  token(): string {
    const nonce = randomBytes(12).toString("base64url");
    const at = Math.floor(this.clock() / 1000).toString(36);
    const sig = createHmac("sha256", this.secret).update(`${nonce}.${at}`).digest("base64url").slice(0, 22);
    return `${nonce}_${at}_${sig}`;
  }

  /** A good token, not used before: true, and now it is used. */
  private takeToken(tok: unknown): boolean {
    if (typeof tok !== "string" || tok.length > 120) return false;
    const m = /^([A-Za-z0-9_-]{16})_([0-9a-z]{1,10})_([A-Za-z0-9_-]{22})$/.exec(tok);
    if (!m) return false;
    const want = createHmac("sha256", this.secret).update(`${m[1]}.${m[2]}`).digest("base64url").slice(0, 22);
    if (want.length !== m[3].length || !timingSafeEqual(Buffer.from(want), Buffer.from(m[3]))) return false;
    const t = parseInt(m[2], 36) * 1000;
    const now = this.clock();
    if (!(t <= now + 60_000 && now - t < TOKEN_TTL_MS)) return false;
    for (const [k, until] of this.used) if (until < now) this.used.delete(k);
    if (this.used.has(m[1])) return false;
    this.used.set(m[1], t + TOKEN_TTL_MS);
    return true;
  }

  /** GET /ads/v1/match: the creatives for this map's boards, and a report token. */
  async feed(map: string, host: string): Promise<{ status: number; body: unknown }> {
    if (host === "lagoslife") {
      this.stats.refused++;
      return { status: 403, body: { error: "no_ads_here" } };
    }
    if (host !== "emilgo" && host !== "web") return { status: 400, body: { error: "bad_request" } };
    const slots = boardIds(map);
    if (!slots) return { status: 404, body: { error: "no_such_map" } };
    const now = this.clock();
    let entry = this.cache.get(map);
    if (!entry || now - entry.at > FEED_TTL_MS) {
      let ads: Record<string, unknown>[] = [];
      if (this.backend) {
        try {
          const raw = await this.backend.next(map);
          const list = Array.isArray(raw) ? raw : Array.isArray((raw as { ads?: unknown })?.ads) ? (raw as { ads: unknown[] }).ads : [];
          ads = list.map((a) => clean(a, slots)).filter((a): a is Record<string, unknown> => !!a).slice(0, MAX_ADS);
        } catch (e) {
          this.stats.errors++;
          if (now - this.loggedAt > 60_000) {
            this.loggedAt = now;
            this.log(`ads feed failed: ${(e as Error).message}`);
          }
          ads = entry?.ads ?? [];
        }
      }
      entry = { at: now, ads };
      this.cache.set(map, entry);
    }
    let seen = this.served.get(map);
    if (!seen) this.served.set(map, (seen = new Map()));
    for (const a of entry.ads) seen.set(a.id as string, now);
    this.stats.feeds++;
    return { status: 200, body: { v: 1, map, ads: entry.ads, tok: this.token() } };
  }

  /** POST /ads/v1/seen: one match's seconds on screen, added up (nothing about who). */
  seen(body: unknown): { status: number; body?: unknown } {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    if (b.host === "lagoslife") {
      this.stats.refused++;
      return { status: 403, body: { error: "no_ads_here" } };
    }
    const map = typeof b.map === "string" ? b.map : "";
    const slots = boardIds(map);
    if (b.v !== 1 || !slots || (b.host !== "emilgo" && b.host !== "web") || !Array.isArray(b.seen) || b.seen.length > 120) {
      this.stats.rejected++;
      return { status: 400, body: { error: "bad_request" } };
    }
    if (!this.takeToken(b.tok)) {
      this.stats.rejected++;
      return { status: 409, body: { error: "token" } };
    }
    const now = this.clock();
    const served = this.served.get(map);
    const day = new Date(now).toISOString().slice(0, 10);
    let n = 0;
    const once = new Set<string>();
    for (const row of b.seen as unknown[]) {
      if (!Array.isArray(row) || row.length !== 3) continue;
      const [slot, ad, secs] = row as [unknown, unknown, unknown];
      if (typeof slot !== "string" || !slots.has(slot) || typeof ad !== "string") continue;
      const at = served?.get(ad);
      if (at === undefined || now - at > TOKEN_TTL_MS) continue;
      if (typeof secs !== "number" || !(secs >= 1) || secs > 1800) continue;
      const k = `${day}|${map}|${slot}|${ad}`;
      if (once.has(k)) continue;
      once.add(k);
      const p = this.pending.get(k);
      if (p) {
        p.secs += secs;
        p.views++;
      } else this.pending.set(k, { day, map, slot, ad, secs, views: 1 });
      n++;
    }
    this.stats.reports++;
    return { status: 204, body: { counted: n } };
  }

  /** What has been added up and not yet sent (the tests read it). */
  waiting(): SeenRow[] {
    return [...this.pending.values()].map((r) => ({ ...r }));
  }

  /** Send what has been added up (every minute). With no ad stack it is dropped: there is nobody to bill. */
  async flush(): Promise<void> {
    if (!this.pending.size) return;
    const rows = [...this.pending.values()].map((r) => ({ ...r, secs: Math.round(r.secs * 10) / 10 }));
    this.pending.clear();
    if (!this.backend) return;
    try {
      await this.backend.record(rows);
      this.stats.flushed += rows.length;
    } catch (e) {
      this.stats.errors++;
      this.log(`ads seen flush failed: ${(e as Error).message}`);
      // Back in for the next try (a bounded number: a long outage drops the oldest).
      for (const r of rows.slice(-2000)) {
        const k = `${r.day}|${r.map}|${r.slot}|${r.ad}`;
        const p = this.pending.get(k);
        if (p) {
          p.secs += r.secs;
          p.views += r.views;
        } else this.pending.set(k, r);
      }
    }
  }
}
