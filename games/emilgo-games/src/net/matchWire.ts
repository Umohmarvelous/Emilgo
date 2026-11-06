// A Free For All match on the wire (protocol 13), shared by the server and the
// phones. The phone keeps a copy of the match (Match.mirror) built from the
// same seed, mode and world, so the start carries only who is playing, in
// which squads; after that:
//
//   msnap  NET.snapshotHz: per body x, z, heading, height (floor + jump),
//          the movement flags, a meter word (wobble, exposure, down, brace,
//          held, immune) and what's in their hands; once a second, each
//          body's measure for the mode (seconds held, deliveries …);
//          per car (protocol 13) x, z, heading, speed, fuel and damage
//   mev    the match's events as they happen, ids as roster indexes, numbers
//          rounded. A phone (re)joining mid-match gets them all again (the
//          server keeps the log) and replays them into a fresh copy.

import type { Cause } from "../game/core/body";
import type { Mutator } from "../game/core/match";
import type { MatchEvent, MatchPhase } from "../game/core/module";
import type { WireLook } from "../shop/catalog";

export const MATCH_PHASES: readonly MatchPhase[] = ["walkout", "countdown", "play", "ended"];
export const MSNAP_STRIDE = 7;
/** Per car in a snapshot: x, z (cm), heading (centiradians), speed (cm/s), fuel (tenths of a second), damage (tenths). */
export const CAR_STRIDE = 6;

/** A Free For All start: in StartInfo as `ffa`. */
export interface FfaStart {
  /** The mode (content/modes.ts) and its version; the map ("naija-world", "naija-world:market"). */
  mode: string;
  v: number;
  map: string;
  /** Per roster index: squad number. */
  sq: number[];
  /** Countdown seconds. */
  cd: number;
  /** Ranked (Phase 6): the mode's `ranked` overrides apply. */
  rk?: 1;
  /** This week's mutator (§10.13), if any: the copy plays the same ground and air. */
  mu?: Mutator;
}

// v5: bodies and cars go as packed bytes in base64 (pb, vb), not lists of numbers.
// A 24-player snapshot on the big world fell from about 1,200 bytes to about 500.
// x, z 3 bytes; heading, height, flags, meter 2; hand 1.
const BODY_BYTES = [3, 3, 2, 2, 2, 2, 1];
// x, z 3 bytes; heading, speed, fuel, damage 2.
const CAR_BYTES = [3, 3, 2, 2, 2, 2];
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_AT = new Uint8Array(128);
for (let i = 0; i < 64; i++) B64_AT[B64.charCodeAt(i)] = i;

/** Numbers (each fits its width, two's complement) as base64. */
export function packInts(list: readonly number[], widths: readonly number[]): string {
  const stride = widths.length;
  let size = 0;
  for (const w of widths) size += w;
  const bytes = new Uint8Array((list.length / stride) * size);
  let o = 0;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    for (let w = widths[i % stride] - 1; w >= 0; w--) bytes[o++] = (v >> (w * 8)) & 255;
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "") + (i + 2 < bytes.length ? B64[n & 63] : "");
  }
  return out;
}

export function unpackInts(text: string, widths: readonly number[]): number[] {
  const size = Math.floor((text.length * 3) / 4);
  const bytes = new Uint8Array(size);
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    acc = ((acc << 6) | B64_AT[text.charCodeAt(i) & 127]) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[o++] = (acc >> bits) & 255;
    }
  }
  const out: number[] = [];
  let at = 0;
  let k = 0;
  while (at < size) {
    const w = widths[k++ % widths.length];
    let v = 0;
    for (let b = 0; b < w; b++) v = v * 256 + bytes[at++];
    // Back from two's complement (every wire number fits below the top bit).
    const top = 2 ** (w * 8 - 1);
    out.push(v >= top ? v - top * 2 : v);
  }
  return out;
}

/** The server's numbers to the wire: `carsAlso` false leaves the cars out (they haven't changed; the phone keeps the last). */
export function packSnap(s: MatchSnap, carsAlso: boolean): MatchSnap {
  const { p, v, ...rest } = s;
  return { ...rest, pb: packInts(p, BODY_BYTES), ...(v && carsAlso ? { vb: packInts(v, CAR_BYTES) } : {}) } as unknown as MatchSnap;
}

/** The wire's bytes back to numbers, in place (a snapshot already in numbers is left as it is). `lastCars`: the newest cars this phone has. */
export function inflateSnap(s: MatchSnap, lastCars: number[] | undefined): MatchSnap {
  const w = s as MatchSnap & { pb?: string; vb?: string };
  if (typeof w.pb === "string") {
    w.p = unpackInts(w.pb, BODY_BYTES);
    delete w.pb;
  }
  if (typeof w.vb === "string") {
    w.v = unpackInts(w.vb, CAR_BYTES);
    delete w.vb;
  } else if (!w.v && lastCars) w.v = lastCars;
  return s;
}

export interface MatchSnap {
  t: "msnap";
  /** Server time, ms. */
  s: number;
  ph: number;
  /** Phase time and duration, ms (left out in play: they follow from el and the mode's time); seconds of play, ms. */
  pt?: number;
  pd?: number;
  el: number;
  /** One char per roster index: a(live) e(liminated). */
  st: string;
  /** Per body MSNAP_STRIDE numbers: x, z (cm), heading (centiradians, −π…π), height (cm), flags (packFlags), meter (packMeter), hand. Out: zeros. */
  p: number[];
  /** Per body: the mode's measure × 10 (once a second, and in a sync). */
  o?: number[];
  /** Per car CAR_STRIDE numbers (vehicles; left out when there are none). */
  v?: number[];
}

/** The match's events, as they happened since the last message. */
export interface MatchEvents {
  t: "mev";
  e: WireEvent[];
}

/** Rejoining mid-match: the start, every event so far, the newest snapshot. */
export interface MatchSync {
  seed: number;
  s: number;
  roster: { id: string; name: string; look?: WireLook }[];
  ffa: FfaStart;
  log: WireEvent[];
  snap: MatchSnap;
}

export type WireEvent = Record<string, unknown> & { k: string };

/** Fields that name a body: sent as its roster index. */
const ID_KEYS = ["id", "tg", "by"] as const;

export function encodeEvent(e: MatchEvent, indexOf: (id: string) => number): WireEvent {
  const out: WireEvent = { k: e.type };
  for (const [key, v] of Object.entries(e)) {
    if (key === "type") continue;
    if ((ID_KEYS as readonly string[]).includes(key)) out[key] = typeof v === "string" ? indexOf(v) : -1;
    else if (typeof v === "number") out[key] = Number.isInteger(v) ? v : Math.round(v * 1000) / 1000;
    else out[key] = v;
  }
  return out;
}

export function decodeEvent(w: WireEvent, idAt: (i: number) => string | null): MatchEvent | null {
  const out: Record<string, unknown> = { type: w.k };
  for (const [key, v] of Object.entries(w)) {
    if (key === "k") continue;
    if ((ID_KEYS as readonly string[]).includes(key)) out[key] = typeof v === "number" && v >= 0 ? idAt(v) : null;
    else out[key] = v;
  }
  // A body the phone doesn't know (-1 is "nobody"): the event is dropped.
  if (typeof w.k !== "string" || (typeof w.id === "number" && w.id >= 0 && out.id === null)) return null;
  return out as unknown as MatchEvent;
}

/** The meter word: wobble 0–31 | exposure 0–31 << 5 | down << 10 | brace << 11 | held << 12 | immune << 13. */
export function packMeter(wobble: number, exposure: number, down: boolean, brace: boolean, held: boolean, immune: boolean): number {
  const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 31);
  return q(wobble) | (q(exposure) << 5) | (down ? 1024 : 0) | (brace ? 2048 : 0) | (held ? 4096 : 0) | (immune ? 8192 : 0);
}

export function unpackMeter(m: number): { wobble: number; exposure: number; down: boolean; brace: boolean; held: boolean; immune: boolean } {
  return { wobble: (m & 31) / 31, exposure: ((m >> 5) & 31) / 31, down: (m & 1024) !== 0, brace: (m & 2048) !== 0, held: (m & 4096) !== 0, immune: (m & 8192) !== 0 };
}

/** What's in your hands: 0 nothing, 1–6 a street prop (melee PROP_IDS + 1), 7 a flag. */
export const HAND_FLAG = 7;

export const CAUSE_WIRE: readonly Cause[] = ["moved", "time", "noball", "zone", "hazard", "found", "shot", "blast"];
