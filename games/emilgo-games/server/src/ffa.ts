// A Free For All match in a room (SPEC-V3 Phase 4): the server side of the
// GameMode seam. The room keeps people, the waiting room and the social
// side; this runs the match core (src/game/core/match.ts) with the mode's
// modules, turns its events and state into protocol 12 (net/matchWire.ts),
// keeps the event log a rejoining phone replays, and says who won and how
// everyone placed, for XP and for a staked match.

import { randomInt } from "node:crypto";

import { BUILTIN_MANIFEST, type ModeDef } from "../../src/content/modes";
import { buildable } from "../../src/content/catalog";
import { actCode } from "../../src/game/combat";
import { Match, settingsOf, weeklyMutator, type MatchWorld, type Standing } from "../../src/game/core/match";
import { Space } from "../../src/game/core/space";
import type { AirfallModule } from "../../src/game/modules/airfall";
import type { FlagsModule } from "../../src/game/modules/flags";
import type { MeleeModule } from "../../src/game/modules/melee";
import type { VehiclesModule } from "../../src/game/modules/vehicles";
import { PROP_IDS } from "../../src/game/modules/melee";
import type { ZoneModule } from "../../src/game/modules/zone";
import { matchWorldOf } from "../../src/maps/open/matchWorld";
import { buildNaijaWorld, SURFACE_OF, type OpenLayout } from "../../src/maps/open/naija";
import { buildMaxWorld } from "../../src/maps/open/max";
import { CAR_STRIDE, encodeEvent, HAND_FLAG, MATCH_PHASES, MSNAP_STRIDE, packMeter, type FfaStart, type MatchSnap, type MatchSync, type WireEvent } from "../../src/net/matchWire";
import { packFlags } from "../../src/net/protocol";
import type { MatchFacts } from "../../src/rank/xp";
import type { WireLook } from "../../src/shop/catalog";

/** The Flag Duel: what a Lagos Life staked match plays (SPEC-V3 Answers, §11). */
export const STAKED_FFA = "flag-duel";
/** Seconds of countdown before a match. */
export const FFA_COUNTDOWN = 5;
/** Events kept for a rejoining phone; a match makes a few thousand. */
const LOG_MAX = 40_000;

let naija: { layout: OpenLayout; space: Space } | null = null;
const worlds = new Map<string, MatchWorld>();

/** The world for a mode's map: Naija World (built once per process), or a part of it. */
export function worldFor(map: string): MatchWorld {
  let w = worlds.get(map);
  if (w) return w;
  // v4: Naija Max, the big world (built once, the first time a room needs it).
  if (map.startsWith("max-world")) {
    if (!maxW) {
      const layout = buildMaxWorld();
      maxW = { layout, space: new Space(layout.solids, { x0: -layout.half, z0: -layout.half, x1: layout.half, z1: layout.half }, (x, z) => SURFACE_OF[layout.groundAt(x, z)]) };
    }
    w = matchWorldOf(maxW.layout, maxW.space, map);
    worlds.set(map, w);
    return w;
  }
  if (!naija) {
    const layout = buildNaijaWorld();
    naija = { layout, space: new Space(layout.solids, { x0: -layout.half, z0: -layout.half, x1: layout.half, z1: layout.half }, (x, z) => SURFACE_OF[layout.groundAt(x, z)]) };
  }
  w = matchWorldOf(naija.layout, naija.space, map);
  worlds.set(map, w);
  return w;
}
let maxW: { layout: OpenLayout; space: Space } | null = null;

/** A Free For All mode this server can run, or null. */
export function ffaMode(id: string): ModeDef | null {
  const def = BUILTIN_MANIFEST.modes.find((m) => m.id === id);
  return def && def.family === "ffa" && buildable(def) ? def : null;
}

export interface Member {
  seat: string;
  party: string | null;
}

/**
 * Squads for a mode (its `players.squad` [least, most]):
 *   1 each        everyone on their own
 *   fixed size    Squad Rally's fours: parties first, then everyone else fills the smallest squads
 *   1 … n         each party is a squad (split past n), everyone else on their own
 */
export function assignSquads(members: readonly Member[], def: ModeDef): number[] {
  const [lo, hi] = def.players.squad;
  const out = new Array<number>(members.length).fill(-1);
  if (hi <= 1) return members.map((_, i) => i);
  const parties = new Map<string, number[]>();
  const solo: number[] = [];
  members.forEach((m, i) => {
    if (!m.party) return void solo.push(i);
    const p = parties.get(m.party);
    if (p) p.push(i);
    else parties.set(m.party, [i]);
  });
  if (lo === hi) {
    const n = Math.max(2, Math.ceil(members.length / hi));
    const size = new Array<number>(n).fill(0);
    const groups = [...parties.values()].sort((a, b) => b.length - a.length);
    for (const g of groups) {
      for (let k = 0; k < g.length; k += hi) {
        const part = g.slice(k, k + hi);
        let q = 0;
        for (let s = 1; s < n; s++) if (size[s] < size[q]) q = s;
        for (const i of part) out[i] = q;
        size[q] += part.length;
      }
    }
    for (const i of solo) {
      let q = 0;
      for (let s = 1; s < n; s++) if (size[s] < size[q]) q = s;
      out[i] = q;
      size[q]++;
    }
    return out;
  }
  let next = 0;
  for (const g of parties.values()) for (let k = 0; k < g.length; k += hi) {
    const q = next++;
    for (const i of g.slice(k, k + hi)) out[i] = q;
  }
  for (const i of solo) out[i] = next++;
  return out;
}

export class FfaGame {
  readonly match: Match;
  readonly start: FfaStart;
  private readonly log: WireEvent[] = [];
  private readonly index = new Map<string, number>();
  private readonly melee: MeleeModule | null;
  private readonly zone: ZoneModule | null;
  private readonly flags: FlagsModule | null;
  private readonly cars: VehiclesModule | null;

  constructor(
    readonly def: ModeDef,
    readonly seed: number,
    readonly roster: { id: string; name: string; look?: WireLook }[],
    squads: number[],
    readonly ranked = false,
  ) {
    // This week's mutator (§10.13): not in a staked match.
    const mu = def.tags?.includes("staked") ? undefined : weeklyMutator(Date.now());
    this.start = { mode: def.id, v: def.v, map: def.map, sq: squads, cd: FFA_COUNTDOWN, ...(ranked ? { rk: 1 as const } : {}), ...(mu ? { mu } : {}) };
    this.match = new Match({
      seed,
      world: worldFor(def.map),
      settings: settingsOf(def, ranked, mu),
      contestants: roster.map((r, i) => ({ id: r.id, name: r.name, bot: false, squad: squads[i] })),
      countdown: FFA_COUNTDOWN,
      // Hidden things (the flag's stash, the circles to come) from a seed no phone has.
      secret: randomInt(0, 2 ** 31),
    });
    roster.forEach((r, i) => this.index.set(r.id, i));
    this.melee = this.match.module<MeleeModule>("melee");
    this.zone = this.match.module<ZoneModule>("zone");
    this.flags = this.match.module<FlagsModule>("flags");
    this.cars = this.match.module<VehiclesModule>("vehicles");
    // What the modules decided at the start (the drop zones' first places) goes out with the first tick.
  }

  get over(): boolean {
    return this.match.over;
  }

  /** A person's buttons, as "in" carries them (protocol 12). */
  input(seat: string, x: number, z: number, b: number, j: number, a: number, g: number, i: number, k: number, y = 0, p = 0, w = 0): void {
    const m = this.match;
    m.setAim(seat, y / 1000, p / 1000, (w & 1) === 1, (w & 2) === 2, (w >> 2) & 15, (w >> 6) & 15);
    m.setInput(seat, x / 100, z / 100);
    m.setButtons(seat, (b & 1) === 1, Math.min(2, (b >> 1) & 3) as 0 | 1 | 2, j);
    m.setBrace(seat, (b & 8) !== 0);
    m.setActions(seat, a, g);
    m.setInteract(seat, i & 255, (i & 256) !== 0);
    m.setPack(seat, k);
  }

  /** Nobody in the seat: standing still, nothing held. */
  idle(seat: string): void {
    this.match.setInput(seat, 0, 0);
    this.match.setBrace(seat, false);
    const a = this.match.get(seat) ? this.match.aims[this.match.get(seat)!.index] : null;
    if (a) a.trigger = a.ads = false;
    const c = this.match.get(seat);
    if (c) this.match.setInteract(seat, 0, false);
  }

  /** One fixed step: what happened, for the wire. */
  step(dt: number, graceOf: (seat: string) => number): WireEvent[] {
    const m = this.match;
    for (const c of m.contestants) c.graceBonus = graceOf(c.id);
    m.step(dt);
    const out: WireEvent[] = [];
    for (const e of m.drain()) out.push(encodeEvent(e, (id) => this.index.get(id) ?? -1));
    if (this.log.length < LOG_MAX) this.log.push(...out);
    return out;
  }

  /** The state now; `measures`: with each body's measure (once a second). `full`: the fallen too (a sync). */
  snapshot(serverMs: number, full = false, measures = full): MatchSnap {
    const m = this.match;
    const list = m.contestants;
    const p: number[] = new Array(list.length * MSNAP_STRIDE).fill(0);
    const o: number[] | null = measures ? new Array(list.length).fill(0) : null;
    let st = "";
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      st += c.status === "alive" ? "a" : "e";
      if (o) o[i] = Math.round(m.objective(i) * 10);
      if (!full && c.status !== "alive") continue;
      const k = i * MSNAP_STRIDE;
      p[k] = cm(c.x);
      p[k + 1] = cm(c.z);
      p[k + 2] = Math.round(Math.atan2(Math.sin(c.heading), Math.cos(c.heading)) * 100);
      p[k + 3] = cm(c.h + c.y);
      p[k + 4] = packFlags(c.stance, c.sprinting, c.stamina, c.stun > 0, actCode(c.actKind), c.slide > 0);
      const mel = this.melee;
      p[k + 5] = packMeter(mel?.wobble[i] ?? 0, this.zone?.exposureOf(i) ?? 0, mel?.isDown(i) ?? false, mel?.brace[i] ?? false, (mel?.heldBy[i] ?? -1) >= 0, (mel?.immune[i] ?? -1) > m.elapsed);
      const prop = mel?.hand[i] ?? -1;
      p[k + 6] = this.flags?.heldBy(i) ? HAND_FLAG : prop >= 0 ? PROP_IDS.indexOf(mel!.props[prop].kind) + 1 : 0;
    }
    let v: number[] | null = null;
    const cars = this.cars?.cars ?? [];
    if (cars.length) {
      v = new Array(cars.length * CAR_STRIDE).fill(0);
      cars.forEach((car, i) => {
        const k = i * CAR_STRIDE;
        v![k] = cm(car.x);
        v![k + 1] = cm(car.z);
        v![k + 2] = Math.round(car.heading * 100);
        v![k + 3] = cm(car.speed);
        v![k + 4] = Math.round(car.fuel * 10);
        v![k + 5] = Math.round(car.damage * 10);
      });
    }
    return {
      t: "msnap",
      s: serverMs,
      ph: MATCH_PHASES.indexOf(m.phase),
      ...(m.phase !== "play" ? { pt: Math.round(m.phaseTime * 1000), pd: Math.round(m.phaseDuration * 1000) } : {}),
      el: Math.round(m.elapsed * 1000),
      st,
      p,
      ...(o ? { o } : {}),
      ...(v ? { v } : {}),
    };
  }

  /** A rejoin: everything so far, less the last `pending` events (the room sends those to everyone shortly). */
  sync(startMs: number, serverMs: number, pending = 0): MatchSync {
    const log = pending > 0 && this.log.length < LOG_MAX ? this.log.slice(0, Math.max(0, this.log.length - pending)) : this.log;
    return { seed: this.seed, s: startMs, roster: this.roster, ffa: this.start, log, snap: this.snapshot(serverMs, true) };
  }

  /** "draw", or the winning seat (a staked duel: first to claim the flag; a timeout is a draw). */
  /** A spectator's vote on the next Airfall's spot (§10.6). */
  vote(seat: string, c: number): void {
    const body = this.match.get(seat);
    if (body) this.match.module<AirfallModule>("airfall")?.vote(this.match, body, c);
  }

  /** The other seats in seat's squad (none in a solo match). */
  squadMates(seat: string): string[] {
    const m = this.match;
    const c = m.get(seat);
    if (!c) return [];
    return m.contestants.filter((o) => o !== c && m.sameSquad(o, c)).map((o) => o.id);
  }

  winner(): string {
    return this.match.winner?.id ?? "draw";
  }

  standings(): Standing[] {
    return this.match.standings();
  }

  /** What XP needs to know about a seat's match (SPEC-V3 §2.2). */
  facts(seat: string, st: Standing[] = this.standings()): MatchFacts | null {
    const s = st.find((x) => x.id === seat);
    if (!s) return null;
    const squads = new Set(st.map((x) => x.squad)).size;
    const top = Math.max(0, ...st.map((x) => x.objective));
    return {
      players: squads,
      place: s.place,
      won: s.won,
      stayed: true,
      objective: s.objective,
      objectiveTop: top,
      seconds: this.match.elapsed,
      ...(this.ranked ? { ranked: true } : {}),
    };
  }
}

function cm(v: number): number {
  return Math.round(v * 100);
}
