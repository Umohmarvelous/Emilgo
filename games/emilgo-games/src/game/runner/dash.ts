// Horde Dash (v6 max, 3.1: "a runner mode: run to a finish line ... three
// lanes, swipe to change lane, jump and slide, coins, power-ups (magnet,
// jetpack, shield), something chasing you, the finish line. Our own art,
// names and courses"). The rules, pure: no DOM, no three.js, the same run from
// the same seed on every phone (and in the tests).
//
//   the course   a dusk road out of the dead city to the Safe Gate (1 km, more
//                each level), three lanes. Every 14–22 m a row: a danfo bus
//                parked in a lane (go round it; run into its front and the horde
//                has you), a road barrier or cones (jump), a gantry with a sign
//                (slide under). Never all three lanes closed to a jump or a
//                slide. Owo coins in lines along the free lanes and in arcs over
//                what you jump; now and then a power-up
//   you          run faster and faster (9 → 15 m/s); left and right change
//                lane (a bus beside you bounces you back), up jumps (1.8 m),
//                down slides (or drops you out of a jump)
//   the horde    14 m behind; a stumble (a barrier, a gantry, a side swipe)
//                and it gains 7 m and you slow for a moment; it falls back
//                slowly while you run clean. Within 1.2 m: caught
//   power-ups    Owo Magnet (10 s: coins fly to you), Jet Pack (7 s, 6 m up
//                over everything, a line of coins in the sky), Shield (one hit
//                taken for you, 20 s)

import { Rng } from "../../core/rng";

export const DASH = {
  /** Lane centres' spacing (m): lanes at −w, 0, +w. */
  laneW: 2.6,
  speed0: 9,
  speedMax: 15,
  /** m/s gained each second. */
  accel: 0.07,
  gravity: 34,
  jumpV: 11.2,
  slideS: 0.75,
  /** Seconds a lane change takes. */
  laneT: 0.17,
  length: 1000,
  /** The horde: how far behind it starts (and falls back to), what a stumble gives it, how fast it drops back. */
  gap0: 14,
  stumbleGain: 7,
  recover: 0.5,
  caught: 1.2,
  stumbleS: 0.55,
  magnetS: 10,
  magnetR: 9,
  jetS: 7,
  jetH: 6,
  shieldS: 20,
  coinR: 1.0,
  /** Heights: what a jump clears (barrier, cones), where a gantry's sign starts (slide under it). */
  barrierH: 0.95,
  conesH: 0.75,
  gantryLow: 1.15,
  busH: 3.1,
  /** The runner's height standing and sliding. */
  standH: 1.8,
  slideH: 0.85,
} as const;

export type ObKind = "bus" | "barrier" | "cones" | "gantry";
export type PowKind = "magnet" | "jet" | "shield";

export interface Ob {
  kind: ObKind;
  lane: number;
  /** Where it starts along the road, and how long it is (m). */
  z: number;
  len: number;
  /** Knocked aside (a shield took it). */
  gone?: boolean;
}
export interface Coin {
  lane: number;
  z: number;
  y: number;
  taken: boolean;
}
export interface Pow {
  kind: PowKind;
  lane: number;
  z: number;
  taken: boolean;
}
export interface Course {
  seed: number;
  length: number;
  obs: Ob[];
  coins: Coin[];
  pows: Pow[];
}

const LEN: Record<ObKind, number> = { bus: 9, barrier: 0.5, cones: 0.6, gantry: 0.6 };

/** The course for a seed and a level (each level 250 m longer, a little busier). */
export function buildCourse(seed: number, level = 1): Course {
  const r = new Rng(seed ^ 0x0da5);
  const length = DASH.length + (Math.max(1, level) - 1) * 250;
  const obs: Ob[] = [];
  const coins: Coin[] = [];
  const pows: Pow[] = [];
  let z = 40;
  let powAt = 140 + r.range(0, 80);
  const line = (lane: number, from: number, n: number, gap = 2.4) => {
    for (let k = 0; k < n; k++) coins.push({ lane, z: from + k * gap, y: 0.9, taken: false });
  };
  while (z < length - 40) {
    const hard = Math.min(1, z / length + (level - 1) * 0.15);
    const pick = r.next();
    const lanes = [0, 1, 2];
    if (pick < 0.32) {
      // A bus (or two, side by side, later on): go round.
      const n = hard > 0.45 && r.next() < 0.5 ? 2 : 1;
      const shut = shuffle(lanes, r).slice(0, n);
      for (const l of shut) obs.push({ kind: "bus", lane: l, z, len: LEN.bus });
      const open = lanes.filter((l) => !shut.includes(l));
      line(open[r.int(0, open.length - 1)], z - 4, 6);
      z += LEN.bus;
    } else if (pick < 0.58) {
      // Barriers or cones across some lanes: jump (an arc of coins over one).
      const n = r.next() < 0.25 + hard * 0.5 ? 3 : r.int(1, 2);
      const shut = shuffle(lanes, r).slice(0, n);
      for (const l of shut) obs.push({ kind: r.next() < 0.6 ? "barrier" : "cones", lane: l, z, len: LEN.barrier });
      const arc = shut[0];
      for (let k = 0; k < 5; k++) coins.push({ lane: arc, z: z - 4 + k * 2, y: 0.9 + Math.sin((k / 4) * Math.PI) * 1.4, taken: false });
    } else if (pick < 0.8) {
      // A gantry: slide under (across one lane, two, or the whole road).
      const n = r.next() < 0.3 + hard * 0.4 ? 3 : r.int(1, 2);
      const shut = shuffle(lanes, r).slice(0, n);
      for (const l of shut) obs.push({ kind: "gantry", lane: l, z, len: LEN.gantry });
      const free = lanes.filter((l) => !shut.includes(l));
      if (free.length) line(free[0], z - 3, 4);
    } else {
      // A breather: a long line of coins, maybe a lane change.
      const a = r.int(0, 2);
      line(a, z, 5);
      const b = Math.max(0, Math.min(2, a + (r.next() < 0.5 ? -1 : 1)));
      line(b, z + 14, 5);
      z += 10;
    }
    // A power-up in a lane this row left open.
    if (z >= powAt) {
      const busy = new Set(obs.filter((o) => Math.abs(o.z - z) < 12).map((o) => o.lane));
      const free = lanes.filter((l) => !busy.has(l));
      if (free.length) pows.push({ kind: (["magnet", "jet", "shield"] as const)[r.int(0, 2)], lane: free[r.int(0, free.length - 1)], z: z + 6, taken: false });
      powAt = z + 200 + r.range(0, 120);
    }
    z += 14 + r.range(0, 8) * (1 - hard * 0.4);
  }
  // Nothing on a coin, nothing on a power-up.
  const blocked = (lane: number, at: number, y: number) =>
    obs.some((o) => o.lane === lane && at > o.z - 1.2 && at < o.z + o.len + 1.2 && (o.kind === "bus" || (o.kind === "gantry" ? y > DASH.gantryLow - 0.2 : y < 0.6)));
  return {
    seed,
    length,
    obs,
    coins: coins.filter((c) => c.z < length - 20 && !blocked(c.lane, c.z, c.y)),
    pows: pows.filter((p) => p.z < length - 30 && !blocked(p.lane, p.z, 0.9)),
  };
}

function shuffle<T>(a: T[], r: Rng): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = r.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface DashInput {
  left: boolean;
  right: boolean;
  jump: boolean;
  slide: boolean;
}

export type DashEvent =
  | { type: "lane"; lane: number }
  | { type: "jump" }
  | { type: "slide" }
  | { type: "coin"; n: number }
  | { type: "pow"; kind: PowKind }
  | { type: "stumble"; kind: ObKind | "side" }
  | { type: "shield"; kind: ObKind }
  | { type: "land" }
  | { type: "finish" }
  | { type: "caught"; how: "bus" | "horde" };

export interface Dash {
  t: number;
  z: number;
  x: number;
  lane: number;
  /** The lane it came from (a bounce goes back there). */
  from: number;
  laneT: number;
  y: number;
  vy: number;
  slideT: number;
  speed: number;
  stumbleT: number;
  gap: number;
  coins: number;
  magnetT: number;
  jetT: number;
  shieldT: number;
  done: null | "finish" | "caught";
  events: DashEvent[];
}

export function newDash(): Dash {
  return { t: 0, z: 0, x: 0, lane: 1, from: 1, laneT: 1, y: 0, vy: 0, slideT: 0, speed: DASH.speed0, stumbleT: 0, gap: DASH.gap0, coins: 0, magnetT: 0, jetT: 0, shieldT: 0, done: null, events: [] };
}

export const laneX = (lane: number): number => (lane - 1) * DASH.laneW;

/** One step (dt ≤ 1/30 s). Inputs are edges (a swipe, a key press). */
export function stepDash(d: Dash, c: Course, dt: number, input: DashInput): void {
  if (d.done) return;
  d.t += dt;
  // Lanes.
  if (input.left && d.lane > 0) changeLane(d, d.lane - 1);
  if (input.right && d.lane < 2) changeLane(d, d.lane + 1);
  d.laneT = Math.min(1, d.laneT + dt / DASH.laneT);
  const u = d.laneT * d.laneT * (3 - 2 * d.laneT);
  d.x = laneX(d.from) + (laneX(d.lane) - laneX(d.from)) * u;
  // Jump and slide (a slide in the air drops you).
  const flying = d.jetT > 0;
  if (input.jump && !flying && d.y <= 0.001) {
    d.vy = DASH.jumpV;
    d.slideT = 0;
    d.events.push({ type: "jump" });
  }
  if (input.slide && !flying) {
    if (d.y > 0.001) d.vy = Math.min(d.vy, -DASH.jumpV * 1.2);
    d.slideT = DASH.slideS;
    d.events.push({ type: "slide" });
  }
  d.slideT = Math.max(0, d.slideT - dt);
  // The jet pack: up to its height, held there; then down.
  if (flying) {
    d.jetT -= dt;
    d.y += (DASH.jetH - d.y) * Math.min(1, dt * 4);
    d.vy = 0;
    if (d.jetT <= 0) d.jetT = 0;
  } else if (d.y > 0 || d.vy > 0) {
    d.vy -= DASH.gravity * dt;
    d.y += d.vy * dt;
    if (d.y <= 0) {
      d.y = 0;
      d.vy = 0;
      d.events.push({ type: "land" });
    }
  }
  // Pace: faster and faster; a stumble slows you for a moment.
  d.speed = Math.min(DASH.speedMax, d.speed + DASH.accel * dt);
  d.stumbleT = Math.max(0, d.stumbleT - dt);
  const pace = d.speed * (d.stumbleT > 0 ? 0.55 : 1);
  const z0 = d.z;
  d.z += pace * dt;
  // The horde: back off while you run clean.
  if (d.stumbleT <= 0) d.gap = Math.min(DASH.gap0, d.gap + DASH.recover * dt);
  d.magnetT = Math.max(0, d.magnetT - dt);
  d.shieldT = Math.max(0, d.shieldT - dt);
  hits(d, c, z0);
  collect(d, c);
  if (!d.done && d.gap <= DASH.caught) {
    d.done = "caught";
    d.events.push({ type: "caught", how: "horde" });
  }
  if (!d.done && d.z >= c.length) {
    d.done = "finish";
    d.events.push({ type: "finish" });
  }
}

function changeLane(d: Dash, to: number): void {
  d.from = laneOf(d.x);
  d.lane = to;
  d.laneT = 0;
  d.events.push({ type: "lane", lane: to });
}

const laneOf = (x: number): number => Math.max(0, Math.min(2, Math.round(x / DASH.laneW + 1)));

function stumble(d: Dash, kind: ObKind | "side"): void {
  if (d.shieldT > 0 && kind !== "side") {
    d.shieldT = 0;
    d.events.push({ type: "shield", kind });
    return;
  }
  d.stumbleT = DASH.stumbleS;
  d.gap -= DASH.stumbleGain;
  d.events.push({ type: "stumble", kind });
}

/** What the body runs into between z0 and now. */
function hits(d: Dash, c: Course, z0: number): void {
  const tall = d.slideT > 0 ? DASH.slideH : DASH.standH;
  for (const o of c.obs) {
    if (o.gone || o.z > d.z + 0.4 || o.z + o.len < z0 - 0.4) continue;
    const ox = laneX(o.lane);
    const dx = Math.abs(d.x - ox);
    if (dx > 1.0) continue;
    // Above it on the jet pack: nothing touches you.
    if (d.y >= DASH.jetH - 0.5) continue;
    const front = z0 <= o.z + 0.2;
    if (o.kind === "bus") {
      if (d.y >= DASH.busH) continue;
      if (front && dx < 0.7) {
        // Into its front: a shield takes it (the bus is shoved aside), else the horde has you.
        if (d.shieldT > 0) {
          d.shieldT = 0;
          o.gone = true;
          d.events.push({ type: "shield", kind: "bus" });
          continue;
        }
        d.done = "caught";
        d.events.push({ type: "caught", how: "bus" });
        return;
      }
      // Along its side, half into the lane: bounced back where you came from.
      if (d.laneT < 1 && d.lane === o.lane) {
        const back = d.from;
        d.from = laneOf(d.x);
        d.lane = back;
        d.laneT = 0;
        stumble(d, "side");
      }
      continue;
    }
    if (!front || o.z + o.len < z0) continue;
    const clear = o.kind === "gantry" ? tall <= DASH.gantryLow + d.y && d.y < 0.2 : d.y >= (o.kind === "barrier" ? DASH.barrierH : DASH.conesH) - 0.05;
    if (clear) continue;
    o.gone = true;
    stumble(d, o.kind);
  }
}

/** Coins and power-ups within reach (a magnet's from far off). */
function collect(d: Dash, c: Course): void {
  const reach = d.magnetT > 0 ? DASH.magnetR : DASH.coinR;
  let n = 0;
  for (const k of c.coins) {
    if (k.taken || k.z < d.z - 1 || k.z > d.z + reach) continue;
    const dx = laneX(k.lane) - d.x;
    const dy = k.y - (d.y + 0.9);
    if (d.magnetT > 0 ? Math.hypot(dx, k.z - d.z) < reach : Math.abs(dx) < 1.1 && Math.abs(dy) < 1.1 && Math.abs(k.z - d.z) < reach) {
      k.taken = true;
      n++;
    }
  }
  if (n) {
    d.coins += n;
    d.events.push({ type: "coin", n });
  }
  for (const p of c.pows) {
    if (p.taken || Math.abs(p.z - d.z) > 1.2 || Math.abs(laneX(p.lane) - d.x) > 1.1 || d.y > 2.5) continue;
    p.taken = true;
    if (p.kind === "magnet") d.magnetT = DASH.magnetS;
    if (p.kind === "shield") d.shieldT = DASH.shieldS;
    if (p.kind === "jet") {
      d.jetT = DASH.jetS;
      d.slideT = 0;
      // A line of coins in the sky ahead, while it lasts.
      for (let k = 0; k < 24; k++) c.coins.push({ lane: d.lane, z: d.z + 12 + k * 3.2, y: DASH.jetH + 0.9, taken: false });
    }
    d.events.push({ type: "pow", kind: p.kind });
  }
}

/** CP for a dash (earned by playing, as always): the gate, the coins, a quick time. */
export function dashCp(d: Pick<Dash, "done" | "coins" | "t">, length: number): { cp: number; parts: { label: string; cp: number }[] } {
  const parts: { label: string; cp: number }[] = [];
  if (d.done === "finish") parts.push({ label: "Reached the Safe Gate", cp: 30 });
  const coins = Math.min(50, Math.floor(d.coins / 10));
  if (coins) parts.push({ label: `Owo ×${d.coins}`, cp: coins });
  if (d.done === "finish" && d.t < (length / 12.5)) parts.push({ label: "Quick time", cp: 10 });
  return { cp: parts.reduce((a, p) => a + p.cp, 0), parts };
}
