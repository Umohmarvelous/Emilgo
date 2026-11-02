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
