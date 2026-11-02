// Billboard ads from our game server (SPEC-V3 §8). At match start the phone
// asks `GET /ads/v1/match?map=&host=` and keeps the answer; offline it uses
// that copy (a day old at most), then house boards. After the match it sends
// how many seconds each paid board was on screen: `POST /ads/v1/seen`, slot
// by slot, with no player id and nothing about the player (Agreement 4(f)
// bans profiling). The token in the feed lets the server take one report per
// feed; it is random, not a person.
//
// Lagos Life never asks (Agreement 4(g) bans advertising any payment but
// Vatar.purchase): `adsUrl` is null there, and the server refuses it too.

/** Who hosts the game (platform/types.ts HostKind; spelled out so the server's tests can use this file). */
type HostKind = "lagoslife" | "emilgo" | "web";

export type BoardFormat = "static" | "slideshow" | "video";

/** One booked creative, as the server hands it to the phone. */
export interface BoardAd {
  id: string;
  format: BoardFormat;
  /** static: one picture; slideshow: 2–6, shown in turn. Video: none (the poster is the picture). */
  images: string[];
  video: string | null;
  poster: string | null;
  /** Seconds on a board before the next creative; 0: the whole match. */
  cycle: 0 | 10 | 30;
  /** The advertiser allows sound (the player's Ads audio setting still decides). */
  audio: boolean;
  /** Booked slots ([]: any slot on the map). */
  slots: string[];
  /** Fixed to its slots for the whole match, outside the rotation. */
  premium: boolean;
}

export interface AdFeed {
  v: 1;
  map: string;
  ads: BoardAd[];
  /** One report's token (null for a copy kept from before: it has been used or has run out). */
  tok: string | null;
}

/** How long a kept copy is good for (ads end; an old copy may show one that has). */
const KEEP_MS = 24 * 3600_000;
const KEEP_KEY = "ads.v1.";
/** The most creatives one feed may carry, and pictures per slideshow. */
export const MAX_ADS = 12;
const MAX_SLIDES = 6;

interface Storage {
  load(key: string): string | null;
  save(key: string, value: string): void;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Our server's ads address for this map, or null where paid boards are off (Lagos Life) or there is no server. */
export function adsUrl(kind: HostKind, serverWs: string | null, map: string): string | null {
  if (kind === "lagoslife" || !serverWs) return null;
  return `${httpOf(serverWs)}/ads/v1/match?map=${encodeURIComponent(map)}&host=${kind}`;
}

function httpOf(serverWs: string): string {
  return serverWs.replace(/^ws/, "http").replace(/\/+$/, "");
}

/** A picture or film address the phone will load: https, or http on this machine (development). */
function mediaOk(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 600) return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

/** The server's answer, checked field by field (anything odd is dropped, never trusted). */
export function checkFeed(raw: unknown, map: string): AdFeed | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || r.map !== map || !Array.isArray(r.ads)) return null;
  const ads: BoardAd[] = [];
  for (const a of r.ads.slice(0, MAX_ADS) as Record<string, unknown>[]) {
    if (!a || typeof a !== "object" || typeof a.id !== "string" || !/^[0-9a-f-]{36}$/.test(a.id)) continue;
    const format = a.format;
    if (format !== "static" && format !== "slideshow" && format !== "video") continue;
    const images = Array.isArray(a.images) ? a.images.filter(mediaOk).slice(0, format === "static" ? 1 : MAX_SLIDES) : [];
    const video = format === "video" && mediaOk(a.video) ? a.video : null;
    const poster = mediaOk(a.poster) ? a.poster : null;
    if (format === "video" ? !video || !poster : !images.length) continue;
    const cycle = a.cycle === 0 || a.cycle === 10 || a.cycle === 30 ? a.cycle : 30;
    const slots = Array.isArray(a.slots) ? a.slots.filter((s): s is string => typeof s === "string" && /^[a-z]{2}-\d{2}$/.test(s)).slice(0, 40) : [];
    ads.push({ id: a.id, format, images, video, poster, cycle, audio: a.audio === true, slots, premium: a.premium === true && slots.length > 0 });
  }
  const tok = typeof r.tok === "string" && /^[A-Za-z0-9_-]{16,120}$/.test(r.tok) ? r.tok : null;
  return { v: 1, map, ads, tok };
}

/**
 * This match's ads: the server's, else the copy kept on the phone (a day at
 * most), else null (house boards everywhere). Never asks in Lagos Life.
 */
export async function fetchFeed(store: Storage, kind: HostKind, serverWs: string | null, map: string, get: Fetch = fetch): Promise<AdFeed | null> {
  const url = adsUrl(kind, serverWs, map);
  if (!url) return null;
  try {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 4000) : null;
    const res = await get(url, { cache: "no-store", ...(ctl ? { signal: ctl.signal } : {}) });
    if (timer) clearTimeout(timer);
    if (res.ok) {
      const feed = checkFeed(await res.json(), map);
      if (feed) {
        store.save(KEEP_KEY + map, JSON.stringify({ at: Date.now(), feed: { ...feed, tok: null } }));
        return feed;
      }
    }
  } catch {
    /* offline, or an old server: the kept copy */
  }
  try {
    const kept = JSON.parse(store.load(KEEP_KEY + map) ?? "null") as { at: number; feed: unknown } | null;
    if (kept && typeof kept.at === "number" && Date.now() - kept.at < KEEP_MS) {
      const feed = checkFeed(kept.feed, map);
      if (feed) return { ...feed, tok: null };
    }
  } catch {
    /* a damaged copy: house boards */
  }
  return null;
}

/** One paid board's time on screen: the slot, the creative, seconds. */
export type Seen = [slot: string, ad: string, secs: number];

/** Send the match's seconds on screen (fire and forget; nothing at all in Lagos Life, offline, or for a kept copy). */
export function reportSeen(kind: HostKind, serverWs: string | null, feed: AdFeed | null, seen: readonly Seen[], get: Fetch = fetch): boolean {
  if (kind === "lagoslife" || !serverWs || !feed?.tok) return false;
  const rows = seen.filter(([, , s]) => s >= 1).map(([slot, ad, s]): Seen => [slot, ad, Math.round(s * 2) / 2]);
  if (!rows.length) return false;
  void get(`${httpOf(serverWs)}/ads/v1/seen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, map: feed.map, host: kind, tok: feed.tok, seen: rows.slice(0, 120) }),
    keepalive: true,
  }).catch(() => undefined);
  return true;
}
