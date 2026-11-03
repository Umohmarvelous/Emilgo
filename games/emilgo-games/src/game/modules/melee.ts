// Gidigbo, Free For All's melee (SPEC-V3 §4): no health bar. Hits fill a
// balance meter, the Wobble; full, you're Dazed — knocked down for a moment,
// dropping whatever is in your hands. Supremacy comes from position and
// displacement, not damage.
//
//   Slap   quick, little wobble; interrupts a grab's wind-up
//   Fist   heavy wobble behind a telegraphed wind-up
//   Push   a big shove, little wobble
//   Brace  (held) half the knockback and wobble, slower; pressed just before
//          a hit lands it parries and staggers the attacker
//   Grab   a wind-up, then a clinch: after a moment the grabber finishes with
//          Throw (fist), Trip (slap) or Drag (push). The held player picks a
//          direction in secret with their stick: opposite the finisher's, and
//          it's a reversal.
//   Trip   attack while crouched (a sweep), or slide into someone: a knockdown
//   Charge attack while sprinting: a shoulder lunge that costs stamina
//
// Props from the street (a chair, a bucket, a broom, a pestle, a bench, a
// slipper) go in your hands and change your swing until they break. Some
// backpack items work through here too (Pepper Soup, Iron Wrapper, the
// slippers).
//
// Anti-frustration: get-up immunity, diminishing wobble when several gang up,
// a frontal cone with auto-face, input buffering, and (online) the target
// rewound by the attacker's lag, as Red Light, Green Light's graceBonus does.
//
// Pure, shared with the server, like every module.

import { MELEE, MOVE, type AttackKind } from "../../config";
import { SpotGrid } from "../core/spotgrid";
import type { ItemId } from "../../content/items";
import { knock } from "../combat";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { DownWhy, MatchEvent, RuleModule } from "../core/module";
import type { ItemsModule } from "./items";

export type PropId = "chair" | "bucket" | "broom" | "pestle" | "bench" | "slipper";
export const PROP_IDS: readonly PropId[] = ["chair", "bucket", "broom", "pestle", "bench", "slipper"];

/** What a swing is, as the wire and the animations know it. */
export type SwingKind = AttackKind | "grab" | "trip" | "charge" | "prop" | "throw";
export const SWING_KINDS: readonly SwingKind[] = ["fist", "slap", "push", "grab", "trip", "charge", "prop", "throw"];

export interface GroundProp {
  readonly index: number;
  readonly kind: PropId;
  x: number;
  z: number;
  h: number;
  uses: number;
  /** In someone's hands (their index), or −1 on the ground; −2 broken. */
  holder: number;
}

export interface Flight {
  readonly index: number;
  readonly by: number;
  x: number;
  z: number;
  h: number;
  readonly dx: number;
  readonly dz: number;
  left: number;
  /** A Golden Slipper comes back to the thrower's backpack. */
  readonly back: boolean;
  /** The prop it is (a thrown street slipper lands and can be picked up again), or −1 (an item). */
  readonly prop: number;
  done: boolean;
}

interface Windup {
  kind: SwingKind;
  /** Seconds of play when it resolves. */
  at: number;
}

interface Clinch {
  /** The held body's index. */
  held: number;
  since: number;
  /** Drag: until when. */
  dragUntil: number;
}

/** The finishers on the attack buttons while you hold someone: fist, slap, push. */
const FINISH = ["throw", "trip", "drag"] as const;

export class MeleeModule implements RuleModule {
  readonly id = "melee" as const;
  readonly props: GroundProp[] = [];
  readonly flights: Flight[] = [];
  /** 0 … 1 each; full is Dazed. */
  wobble = new Float64Array(0);
  /** Knocked down until (seconds of play), or −1. */
  down = new Float64Array(0);
  /** Can't be hit until. */
  immune = new Float64Array(0);
  /** Each body's prop in hand (index into props), or −1. */
  hand = new Int32Array(0);
  /** Who holds whom: heldBy[i] = the grabber's index, or −1. */
  heldBy = new Int32Array(0);
  /** Brace held (input). */
  brace: boolean[] = [];
  private lastHit = new Float64Array(0);
  private braceAt = new Float64Array(0);
  private hitters: { by: number; t: number }[][] = [];
  private windup: (Windup | null)[] = [];
  private buffered: { code: number; until: number }[] = [];
  private clinch: (Clinch | null)[] = [];
  private dash: { until: number; dx: number; dz: number; hit: boolean }[] = [];
  private tackled: boolean[] = [];
  private floorWas = new Float64Array(0);
  /** This knockdown has had a squad mate's help already. */
  private helped: boolean[] = [];
  private hist: Float64Array[] = [];
  private histAt = 0;
  private readonly density: number;

  constructor(params: Record<string, unknown>) {
    this.density = typeof params.props === "number" ? Math.max(0, Math.min(2, params.props)) : 1;
  }

  init(m: Match): void {
    const n = m.contestants.length;
    this.wobble = new Float64Array(n);
    this.down = new Float64Array(n).fill(-1);
    this.immune = new Float64Array(n).fill(-1);
    this.hand = new Int32Array(n).fill(-1);
    this.heldBy = new Int32Array(n).fill(-1);
    this.brace = new Array(n).fill(false);
    this.lastHit = new Float64Array(n).fill(-99);
    this.braceAt = new Float64Array(n).fill(-99);
    this.hitters = Array.from({ length: n }, () => []);
    this.windup = new Array(n).fill(null);
    this.buffered = Array.from({ length: n }, () => ({ code: -1, until: -1 }));
    this.clinch = new Array(n).fill(null);
    this.dash = Array.from({ length: n }, () => ({ until: -1, dx: 0, dz: 0, hit: false }));
    this.tackled = new Array(n).fill(false);
    this.floorWas = new Float64Array(n);
    this.helped = new Array(n).fill(false);
    this.hist = Array.from({ length: n }, () => new Float64Array(MELEE.histTicks * 2));
    for (const c of m.contestants) this.floorWas[c.index] = c.h;
    this.scatter(m);
  }

  /** Street props at the named places (the market's chairs, a bucket by the borehole …). */
  private scatter(m: Match): void {
    const count = Math.round(MELEE.props.count * this.density);
    if (!count || !m.reach.open.length) return;
    const rng = m.rng("props");
    const places = m.world.places;
    const reach = m.reach;
    const grid = new SpotGrid(4);
    for (let n = 0; n < count; n++) {
      for (let t = 0; t < 12; t++) {
        let cell: number;
        if (places.length) {
          const p = places[rng.int(0, places.length - 1)];
          const a = rng.range(0, Math.PI * 2);
          const d = Math.sqrt(rng.next()) * (p.r + 4);
          cell = reach.cell(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d);
          if (cell < 0 || !reach.ground[cell]) continue;
        } else cell = reach.open[rng.int(0, reach.open.length - 1)];
        const [x, z] = reach.centre(cell);
        if (grid.any(x, z, 4, (sx, sz) => Math.hypot(sx - x, sz - z) < 4)) continue;
        const kind = PROP_IDS[rng.int(0, PROP_IDS.length - 1)];
        this.props.push({ index: this.props.length, kind, x, z, h: reach.h[cell], uses: MELEE.prop[kind].uses, holder: -1 });
        grid.add(x, z);
        break;
      }
    }
  }

  // ── Before the bodies move: buttons, wind-ups, clinches, the slow of a brace ──

  pre(m: Match, dt: number): void {
    const t = m.elapsed;
    // Positions for rewinding (the attacker's lag).
    const k = this.histAt++ % MELEE.histTicks;
    for (const c of m.contestants) {
      const h = this.hist[c.index];
      h[k * 2] = c.x;
      h[k * 2 + 1] = c.z;
    }
    for (const c of m.contestants) {
      const i = c.index;
      if (c.status !== "alive" || m.seated(c)) {
        c.attackSeen = c.inAttack;
        c.grabSeen = c.inGrab;
        if (m.seated(c)) this.brace[i] = false;
        continue;
      }
      // Getting up: then a moment no hit lands.
      if (this.down[i] >= 0 && t >= this.down[i]) {
        this.down[i] = -1;
        this.immune[i] = t + MELEE.immune;
        m.emit({ type: "up", id: c.id });
      }
      // Wobble drains once nobody has hit you for a while.
      if (t - this.lastHit[i] > MELEE.wobble.drainAfter) this.wobble[i] = Math.max(0, this.wobble[i] - MELEE.wobble.drain * dt);
      // Brace: held; the moment it went down is the parry's window.
      const wantBrace = m.braced(c) && this.down[i] < 0 && this.heldBy[i] < 0;
      if (wantBrace && !this.brace[i]) this.braceAt[i] = t;
      this.brace[i] = wantBrace;
      if (wantBrace && m.effect(c, "iron") <= 0) m.slow(c, MELEE.brace.slow);
      if (this.clinch[i]) m.slow(c, MELEE.grab.drag);
      if (this.heldBy[i] >= 0) c.stun = Math.max(c.stun, dt * 2);
      if (this.down[i] >= 0) c.stun = Math.max(c.stun, this.down[i] - t);

      // New requests: an attack (counter << 2 | kind) or a grab (a counter).
      // A press that can't start yet is kept MELEE.buffer seconds (once: a retry never extends it).
      let code = -1;
      let fresh = false;
      if (c.inAttack !== c.attackSeen) {
        c.attackSeen = c.inAttack;
        code = c.inAttack & 3;
        fresh = true;
      }
      if (c.inGrab !== c.grabSeen) {
        c.grabSeen = c.inGrab;
        code = 4;
        fresh = true;
      }
      if (code < 0 && this.buffered[i].until >= t) code = this.buffered[i].code;
      if (code > 0) {
        if (this.request(m, c, code)) this.buffered[i].until = -1;
        else if (fresh) this.buffered[i] = { code, until: t + MELEE.buffer };
      }

      const w = this.windup[i];
      if (w && t >= w.at) {
        this.windup[i] = null;
        this.resolve(m, c, w.kind);
      }
    }
  }

  /** A button press: start it now if you can (true), or false to buffer it. */
  private request(m: Match, c: Contestant, code: number): boolean {
    const i = c.index;
    const t = m.elapsed;
    if (this.down[i] >= 0 || this.heldBy[i] >= 0) return true; // dropped, not buffered
    const cl = this.clinch[i];
    if (cl) {
      // Holding someone: the attack buttons finish (after the clinch's first moment).
      if (code === 4 || t - cl.since < MELEE.grab.min) return code === 4;
      this.finish(m, c, FINISH[code - 1]);
      return true;
    }
    if (this.windup[i] || c.cool > 0 || c.stun > 0 || c.y > 0.05 || c.stance === 2) return false;
    let kind: SwingKind;
    if (code === 4) kind = "grab";
    else if (this.hand[i] >= 0) kind = "prop";
    else if (c.sprinting && c.stamina >= MELEE.charge.stamina) kind = "charge";
    else if (c.stance === 1) kind = "trip";
    else kind = (["fist", "slap", "push"] as const)[code - 1];
    this.start(m, c, kind);
    return true;
  }

  private start(m: Match, c: Contestant, kind: SwingKind): void {
    const i = c.index;
    const t = m.elapsed;
    const wind = this.windupOf(i, kind);
    this.face(m, c);
    if (kind === "charge") {
      c.stamina = Math.max(0, c.stamina - MELEE.charge.stamina);
      this.dash[i] = { until: t + wind + MELEE.charge.dash, dx: Math.sin(c.heading), dz: Math.cos(c.heading), hit: false };
    }
    if (kind === "prop" && MELEE.prop[this.props[this.hand[i]].kind].thrown) {
      this.throwProp(m, c);
      return;
    }
    this.windup[i] = { kind, at: t + wind };
    c.act = wind + 0.2;
    c.actKind = kind === "fist" || kind === "slap" || kind === "push" || kind === "grab" ? kind : kind === "trip" ? "slap" : "push";
    c.cool = this.coolOf(i, kind) * c.bst.cool;
    m.emit({ type: "swing", id: c.id, kind, at: t + wind });
  }

  private windupOf(i: number, kind: SwingKind): number {
    switch (kind) {
      case "fist":
      case "slap":
      case "push":
        return MELEE.kinds[kind].windup;
      case "grab":
        return MELEE.grab.windup;
      case "trip":
        return MELEE.trip.windup;
      case "charge":
        return MELEE.charge.windup;
      case "prop":
        return MELEE.prop[this.props[this.hand[i]]?.kind ?? "broom"].windup;
      default:
        return 0;
    }
  }

  private coolOf(i: number, kind: SwingKind): number {
    switch (kind) {
      case "fist":
      case "slap":
      case "push":
        return MELEE.kinds[kind].cool;
      case "prop":
        return MELEE.prop[this.props[this.hand[i]]?.kind ?? "broom"].cool;
      default:
        return MELEE.coolOther;
    }
  }

  /** Auto-face: turn to the nearest rival within MELEE.autoFace before the swing. */
  private face(m: Match, c: Contestant): void {
    let best: Contestant | null = null;
    let bestD: number = MELEE.autoFace;
    for (const o of m.contestants) {
      if (o === c || !this.hittable(m, o) || m.sameSquad(c, o)) continue;
      const d = Math.hypot(o.x - c.x, o.z - c.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (best) c.heading = Math.atan2(best.x - c.x, best.z - c.z);
  }

  private hittable(m: Match, o: Contestant): boolean {
    const i = o.index;
    return o.status === "alive" && this.down[i] < 0 && this.immune[i] < m.elapsed && this.heldBy[i] < 0 && !m.seated(o);
  }

  /**
   * Something that isn't a swing knocks tg about (a car's bump, a blast):
   * the knockback and the wobble, which can Daze. True: they were Dazed.
   */
  shove(m: Match, tg: Contestant, dx: number, dz: number, dist: number, stun: number, wobble: number): boolean {
    if (tg.status !== "alive" || this.down[tg.index] >= 0) return false;
    if (m.effect(tg, "shaku") <= 0) knock(tg, dx, dz, dist, stun);
    if (wobble <= 0) return false;
    const dazed = this.gain(m, tg, wobble, -1);
    if (dazed) this.knockdown(m, tg, MELEE.daze, "daze", null);
    return dazed;
  }

  /** In a car: can't, while down, held or holding someone. */
  busy(i: number): boolean {
    return this.down[i] >= 0 || this.heldBy[i] >= 0 || !!this.clinch[i] || !!this.windup[i];
  }

  /** Where o was `lag` seconds ago (never more than MELEE.rewind), for an attacker with that lag. */
  private past(o: Contestant, lag: number): [number, number] {
    const ticks = Math.min(MELEE.histTicks - 1, Math.round(Math.min(MELEE.rewind, lag) * 60));
    if (ticks <= 0) return [o.x, o.z];
    const k = (((this.histAt - 1 - ticks) % MELEE.histTicks) + MELEE.histTicks) % MELEE.histTicks;
    const h = this.hist[o.index];
    return [h[k * 2], h[k * 2 + 1]];
  }

  /** Every rival in c's frontal cone within reach, nearest first (rewound by c's lag). */
  private inCone(m: Match, c: Contestant, reach: number, cone: number = MELEE.cone): Contestant[] {
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    const out: { o: Contestant; d: number }[] = [];
    for (const o of m.contestants) {
      if (o === c || !this.hittable(m, o) || m.sameSquad(c, o)) continue;
      const [ox, oz] = this.past(o, c.graceBonus);
      const dx = ox - c.x;
      const dz = oz - c.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + c.bst.reach || Math.abs(o.h + o.y - (c.h + c.y)) > 1.2) continue;
      if (d > 0.3 && (dx * fx + dz * fz) / d < Math.cos(cone)) continue;
      out.push({ o, d });
    }
    return out.sort((a, b) => a.d - b.d).map((e) => e.o);
  }

  // ── A swing lands (or doesn't) ──

  private resolve(m: Match, c: Contestant, kind: SwingKind): void {
    const i = c.index;
    if (c.status !== "alive" || this.down[i] >= 0 || this.heldBy[i] >= 0) return;
    switch (kind) {
      case "fist":
      case "slap":
      case "push": {
        const k = MELEE.kinds[kind];
        const tg = this.inCone(m, c, MELEE.range)[0];
        if (!tg) return void m.emit({ type: "miss", id: c.id, kind });
        this.strike(m, c, tg, kind, k.wobble, k.knock, k.stun);
        return;
      }
      case "prop": {
        const p = this.props[this.hand[i]];
        if (!p) return;
        const pd = MELEE.prop[p.kind];
        const list = this.inCone(m, c, MELEE.range + pd.reach, pd.sweep ? Math.PI / 2 : MELEE.cone);
        const hits = pd.sweep ? list : list.slice(0, 1);
        if (!hits.length) return void m.emit({ type: "miss", id: c.id, kind });
        for (const tg of hits) {
          this.strike(m, c, tg, "prop", pd.wobble, pd.knock, pd.stun);
          if (pd.blind) m.setEffect(tg, "blind", pd.blind);
        }
        this.use(m, c, p);
        return;
      }
      case "trip": {
        const tg = this.inCone(m, c, MELEE.trip.range)[0];
        if (!tg) return void m.emit({ type: "miss", id: c.id, kind });
        this.trip(m, c, tg, "trip");
        return;
      }
      case "grab": {
        const tg = this.inCone(m, c, MELEE.grab.range)[0];
        if (!tg || this.clinch[tg.index]) return void m.emit({ type: "miss", id: c.id, kind });
        // A grab goes through a brace: that's what it's for.
        this.clinch[i] = { held: tg.index, since: m.elapsed, dragUntil: -1 };
        this.heldBy[tg.index] = i;
        tg.vx = tg.vz = 0;
        this.windup[tg.index] = null;
        m.emit({ type: "clinch", id: c.id, tg: tg.id });
        return;
      }
      case "charge":
        // The dash itself does the hitting (step).
        return;
    }
  }

  /**
   * A strike lands on tg: the wobble (less if they brace, less again for each
   * other attacker this second), the knockback, and a parry if their brace
   * went down just in time.
   */
  private strike(m: Match, c: Contestant, tg: Contestant, kind: SwingKind, wobble: number, dist: number, stun: number): void {
    const t = m.elapsed;
    const j = tg.index;
    // Strike beats grab: hitting someone mid-grab wind-up stops it.
    if (this.windup[j]?.kind === "grab") {
      this.windup[j] = null;
      m.emit({ type: "broke", id: tg.id, by: c.id });
    }
    if (this.brace[j] && t - this.braceAt[j] <= MELEE.brace.parry) {
      // Parried: nothing happens to them; the attacker staggers.
      c.stun = Math.max(c.stun, MELEE.brace.stagger);
      this.gain(m, c, MELEE.brace.parryWobble, tg.index);
      m.emit({ type: "parry", id: tg.id, by: c.id });
      return;
    }
    let dx = tg.x - c.x;
    let dz = tg.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      dx /= d;
      dz /= d;
    } else {
      dx = Math.sin(c.heading);
      dz = Math.cos(c.heading);
    }
    const braced = this.brace[j] ? MELEE.brace.cut : 1;
    const hot = m.effect(c, "pepper") > 0 ? MELEE.pepper : 1;
    // Shaku Shield: no knockback; Zanku Bait: a watcher wobbles more.
    const shield = m.effect(tg, "shaku") > 0 ? 0 : 1;
    const bait = m.effect(tg, "bait") > 0 ? m.effectValue(tg, "bait") : 1;
    knock(tg, dx, dz, dist * braced * hot * shield, stun * braced * shield);
    const dazed = this.gain(m, tg, wobble * braced * hot * bait, c.index);
    this.lastHitBy(tg, c, t);
    m.emit({ type: "hit", id: c.id, tg: tg.id, kind, w: this.wobble[j], kx: tg.vx, kz: tg.vz });
    if (dazed) this.knockdown(m, tg, MELEE.daze, "daze", c);
  }

  private lastHitBy(tg: Contestant, c: Contestant, t: number): void {
    const list = this.hitters[tg.index];
    for (let k = list.length - 1; k >= 0; k--) if (t - list[k].t > MELEE.wobble.crowdWindow || list[k].by === c.index) list.splice(k, 1);
    list.push({ by: c.index, t });
  }

  /** Wobble onto tg, less for each other attacker in the last second. True: it's full (Dazed). */
  private gain(m: Match, tg: Contestant, amount: number, by: number): boolean {
    const j = tg.index;
    const t = m.elapsed;
    let others = 0;
    for (const h of this.hitters[j]) if (h.by !== by && t - h.t <= MELEE.wobble.crowdWindow) others++;
    this.wobble[j] = Math.min(1, this.wobble[j] + amount * Math.pow(1 - MELEE.wobble.crowd, others));
    this.lastHit[j] = t;
    return this.wobble[j] >= 1;
  }

  private trip(m: Match, c: Contestant, tg: Contestant, how: "trip" | "tackle"): void {
    // Jumping over it, or bracing, beats a trip.
    if (tg.y > 0.15 || this.brace[tg.index]) return void m.emit({ type: "miss", id: c.id, kind: "trip" });
    this.knockdown(m, tg, MELEE.trip.down, how, c);
  }

  /**
   * Down on the ground for `s`: can't move or be hit, and whatever is in their
   * hands drops (the modules that own it hear "down"). Then a moment's immunity.
   */
  knockdown(m: Match, tg: Contestant, s: number, why: DownWhy, by: Contestant | null): void {
    const j = tg.index;
    if (tg.status !== "alive") return;
    this.release(j);
    if (this.heldBy[j] >= 0) this.release(this.heldBy[j]);
    this.windup[j] = null;
    this.down[j] = m.elapsed + s;
    this.helped[j] = false;
    tg.stun = Math.max(tg.stun, s);
    tg.inSprint = tg.sprinting = false;
    if (why === "daze") this.wobble[j] = 0;
    this.dropProp(m, tg);
    m.emit({ type: "down", id: tg.id, s, why, by: by?.id ?? null });
  }

  // ── Clinches ──

  private finish(m: Match, c: Contestant, how: "throw" | "trip" | "drag"): void {
    const i = c.index;
    const cl = this.clinch[i]!;
    const held = m.contestants[cl.held];
    // The finisher's direction: the grabber's stick (or straight ahead); a trip and a drag go forward.
    let fx = Math.sin(c.heading);
    let fz = Math.cos(c.heading);
    if (how === "throw" && Math.hypot(c.inX, c.inZ) > 0.3) {
      const l = Math.hypot(c.inX, c.inZ);
      fx = c.inX / l;
      fz = c.inZ / l;
    }
    if (how === "drag") {
      cl.dragUntil = m.elapsed + MELEE.grab.dragFor;
      m.emit({ type: "release", id: c.id, tg: held.id, how: "drag" });
      return;
    }
    // The escape mind-game: their stick, chosen in secret, against the finisher's direction.
    const hl = Math.hypot(held.inX, held.inZ);
    const reversed = hl > 0.3 && (held.inX * fx + held.inZ * fz) / hl < MELEE.grab.escape;
    this.release(i);
    const [a, b] = reversed ? [held, c] : [c, held];
    const dx = reversed ? -fx : fx;
    const dz = reversed ? -fz : fz;
    m.emit({ type: "release", id: a.id, tg: b.id, how: reversed ? "reverse" : how });
    if (how === "throw" || reversed) {
      knock(b, dx, dz, MELEE.grab.throw, MELEE.grab.throwStun);
      this.gain(m, b, MELEE.grab.throwWobble, a.index);
      this.knockdown(m, b, MELEE.grab.throwDown, "throw", a);
    } else this.knockdown(m, b, MELEE.trip.down, "trip", a);
  }

  /** Let go of whoever i holds. */
  private release(i: number): void {
    const cl = this.clinch[i];
    if (!cl) return;
    this.clinch[i] = null;
    this.heldBy[cl.held] = -1;
  }

  // ── Props in hand ──

  /** The nearest prop on the ground within reach of c (the interact tap's candidate). */
  propFor(c: Contestant): GroundProp | null {
    if (this.hand[c.index] >= 0 || this.down[c.index] >= 0) return null;
    let best: GroundProp | null = null;
    let bestD: number = MELEE.props.reach;
    const feet = c.h + c.y;
    for (const p of this.props) {
      if (p.holder !== -1 || Math.abs(p.h - feet) > 1.2) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  reachFor(m: Match, c: Contestant): { d: number; take: () => void } | null {
    // A squad mate down beside you: help them up (half the time left, §10.8); in a gutter: pull them out (§10.20).
    const mate = this.mateFor(m, c);
    if (mate) return mate;
    const p = this.propFor(c);
    if (!p) return null;
    return {
      d: Math.hypot(p.x - c.x, p.z - c.z),
      take: () => {
        p.holder = c.index;
        this.hand[c.index] = p.index;
        m.emit({ type: "prop", id: c.id, prop: p.index, kind: p.kind, how: "take", x: p.x, z: p.z, h: p.h });
      },
    };
  }

  /** A squad mate c can help up or pull out of a gutter now (what the tap would do), or null. */
  mateFor(m: Match, c: Contestant): { d: number; take: () => void; how?: "up" | "rescue" } | null {
    if (this.down[c.index] >= 0 || c.y > 0.1) return null;
    let best: { d: number; take: () => void; how?: "up" | "rescue" } | null = null;
    for (const o of m.contestants) {
      if (o === c || o.status !== "alive" || !m.sameSquad(c, o) || m.seated(o)) continue;
      const d = Math.hypot(o.x - c.x, o.z - c.z);
      if (best && best.d <= d) continue;
      const j = o.index;
      // In a gutter (a sunk floor) beside you.
      if (o.h < c.h - MELEE.ringOut.gutterDrop && d <= MELEE.help.rescue) {
        best = {
          d,
          take: () => {
            o.x = c.x + (o.x - c.x) * (0.5 / Math.max(0.5, d));
            o.z = c.z + (o.z - c.z) * (0.5 / Math.max(0.5, d));
            o.h = c.h;
            o.y = o.vy = 0;
            o.vx = o.vz = 0;
            m.world.space.resolve(o, MOVE.radius);
            o.stun = Math.max(o.stun, MELEE.help.lift);
            m.emit({ type: "helpup", id: c.id, tg: o.id, how: "rescue" });
          },
          how: "rescue",
        } as { d: number; take: () => void; how: "rescue" };
      } else if (this.down[j] >= 0 && !this.helped[j] && d <= MELEE.help.reach) {
        best = {
          d,
          take: () => {
            const left = this.down[j] - m.elapsed;
            this.down[j] = m.elapsed + left * MELEE.help.cut;
            o.stun = Math.min(o.stun, left * MELEE.help.cut);
            this.helped[j] = true;
            m.emit({ type: "helpup", id: c.id, tg: o.id, how: "up" });
          },
          how: "up",
        } as { d: number; take: () => void; how: "up" };
      }
    }
    return best;
  }

  /** A bullet breaks a street prop on the ground (v4 guns). */
  shatter(m: Match, index: number, by: Contestant): void {
    const p = this.props[index];
    if (!p || p.holder !== -1) return;
    p.holder = -2;
    m.emit({ type: "prop", id: by.id, prop: p.index, kind: p.kind, how: "break", x: p.x, z: p.z, h: p.h });
  }

  private use(m: Match, c: Contestant, p: GroundProp): void {
    p.uses--;
    if (p.uses > 0) return;
    p.holder = -2;
    this.hand[c.index] = -1;
    m.emit({ type: "prop", id: c.id, prop: p.index, kind: p.kind, how: "break", x: c.x, z: c.z, h: c.h });
  }

  /** Knocked down (or out): the prop falls where you are. */
  dropProp(m: Match, c: Contestant): void {
    const k = this.hand[c.index];
    if (k < 0) return;
    const p = this.props[k];
    this.hand[c.index] = -1;
    p.holder = -1;
    p.x = c.x;
    p.z = c.z;
    p.h = c.h;
    m.emit({ type: "prop", id: c.id, prop: p.index, kind: p.kind, how: "drop", x: p.x, z: p.z, h: p.h });
  }

  private throwProp(m: Match, c: Contestant): void {
    const p = this.props[this.hand[c.index]];
    this.hand[c.index] = -1;
    p.holder = -3;
    this.fly(m, c, false, p.index);
    m.emit({ type: "prop", id: c.id, prop: p.index, kind: p.kind, how: "throw", x: c.x, z: c.z, h: c.h });
  }

  /** A slipper in the air, from c's hands (or backpack) forward. */
  private fly(m: Match, c: Contestant, back: boolean, prop: number): void {
    this.face(m, c);
    c.cool = MELEE.coolOther;
    c.act = 0.4;
    c.actKind = "push";
    const f: Flight = { index: this.flights.length, by: c.index, x: c.x, z: c.z, h: c.h, dx: Math.sin(c.heading), dz: Math.cos(c.heading), left: MELEE.slipper.range, back, prop, done: false };
    this.flights.push(f);
    m.emit({ type: "fly", id: c.id, flight: f.index, x: f.x, z: f.z, h: f.h, dx: f.dx, dz: f.dz, back, prop });
  }

  // ── Every step, after the bodies moved ──

  step(m: Match, dt: number): void {
    const t = m.elapsed;
    for (const c of m.contestants) {
      const i = c.index;
      if (c.status !== "alive") continue;
      if (m.seated(c)) {
        this.floorWas[i] = c.h;
        continue;
      }
      // A clinch: the held body stays in front of the grabber; it breaks after a while, or by escaping a drag.
      const cl = this.clinch[i];
      if (cl) {
        const held = m.contestants[cl.held];
        const dragging = cl.dragUntil >= 0;
        if (held.status !== "alive" || t - cl.since > MELEE.grab.max + (dragging ? MELEE.grab.dragFor : 0) || (dragging && t >= cl.dragUntil)) {
          this.release(i);
          m.emit({ type: "release", id: c.id, tg: held.id, how: "break" });
        } else {
          held.x = c.x + Math.sin(c.heading) * MELEE.grab.hold;
          held.z = c.z + Math.cos(c.heading) * MELEE.grab.hold;
          held.vx = c.vx;
          held.vz = c.vz;
          held.heading = c.heading + Math.PI;
          m.world.space.resolve(held, MOVE.radius);
          // Pulling hard against a drag breaks it.
          const hl = Math.hypot(held.inX, held.inZ);
          const sp = Math.hypot(c.vx, c.vz);
          if (dragging && hl > 0.5 && sp > 0.5 && (held.inX * c.vx + held.inZ * c.vz) / (hl * sp) < MELEE.grab.escape) {
            this.release(i);
            m.emit({ type: "release", id: held.id, tg: c.id, how: "escape" });
          }
        }
      }
      // A shoulder charge: the lunge, and the first rival it meets.
      const ds = this.dash[i];
      if (ds.until >= t && !ds.hit && !this.windup[i]) {
        c.vx = ds.dx * MELEE.charge.speed;
        c.vz = ds.dz * MELEE.charge.speed;
        const tg = this.inCone(m, c, MELEE.charge.reach, MELEE.cone * 0.7)[0];
        if (tg) {
          ds.hit = true;
          if (Math.abs(tg.vx * ds.dz - tg.vz * ds.dx) > MELEE.charge.sidestep) m.emit({ type: "miss", id: c.id, kind: "charge" });
          else this.strike(m, c, tg, "charge", MELEE.charge.wobble, MELEE.charge.knock, MELEE.charge.stun);
        }
      } else if (ds.until >= 0 && t > ds.until) {
        if (!ds.hit) c.stun = Math.max(c.stun, MELEE.charge.miss);
        ds.until = -1;
      }
      // A slide into someone is a tackle (once a slide).
      if (c.slide > 0) {
        if (!this.tackled[i]) {
          const tg = this.inCone(m, c, MELEE.tackle, MELEE.cone)[0];
          if (tg) {
            this.tackled[i] = true;
            this.trip(m, c, tg, "tackle");
          }
        }
      } else this.tackled[i] = false;
      // Ring-outs: shoved into a gutter (a long climb out), or off a roof (a moment's stun).
      const drop = this.floorWas[i] - c.h;
      if (c.stun > 0 && this.down[i] < 0 && drop > MELEE.ringOut.gutterDrop && c.h < -0.3) this.knockdown(m, c, MELEE.ringOut.gutter, "ringout", null);
      else if (c.stun > 0 && this.down[i] < 0 && drop > MELEE.ringOut.roofDrop) this.knockdown(m, c, MELEE.ringOut.roof, "ringout", null);
      this.floorWas[i] = c.h;
    }
    this.flightsStep(m, dt);
  }

  private flightsStep(m: Match, dt: number): void {
    for (const f of this.flights) {
      if (f.done) continue;
      const step = MELEE.slipper.speed * dt;
      f.x += f.dx * step;
      f.z += f.dz * step;
      f.left -= step;
      const by = m.contestants[f.by];
      let hit: Contestant | null = null;
      for (const o of m.contestants) {
        if (o === by || !this.hittable(m, o) || m.sameSquad(by, o)) continue;
        if (Math.hypot(o.x - f.x, o.z - f.z) < MELEE.slipper.radius && Math.abs(o.h - f.h) < 1.5) {
          hit = o;
          break;
        }
      }
      const blocked = !m.reach.at(f.x, f.z);
      if (!hit && !blocked && f.left > 0) continue;
      f.done = true;
      if (hit) {
        let dx = f.dx;
        let dz = f.dz;
        if (this.brace[hit.index]) {
          dx *= MELEE.brace.cut;
          dz *= MELEE.brace.cut;
        }
        knock(hit, f.dx, f.dz, MELEE.slipper.knock, MELEE.slipper.stun);
        const dazed = this.gain(m, hit, MELEE.slipper.wobble * (this.brace[hit.index] ? MELEE.brace.cut : 1), by.index);
        m.emit({ type: "hit", id: by.id, tg: hit.id, kind: "throw", w: this.wobble[hit.index], kx: hit.vx, kz: hit.vz });
        if (dazed) this.knockdown(m, hit, MELEE.daze, "daze", by);
      }
      // It lands where it stopped (a street slipper can be picked up again); a golden one goes home.
      const lx = blocked ? f.x - f.dx * 0.6 : f.x;
      const lz = blocked ? f.z - f.dz * 0.6 : f.z;
      const lh = m.reach.at(lx, lz) ? f.h : by.h;
      m.emit({ type: "landed-fly", flight: f.index, x: lx, z: lz, h: lh, hit: hit?.id ?? null });
      if (f.back) m.module<ItemsModule>("items")?.give(m, by, ["golden-slipper"]);
      this.landProp(f.prop, lx, lz, lh);
    }
  }

  /** A thrown street slipper comes down: one use gone; it lies there to be picked up again, or it's done. */
  private landProp(k: number, x: number, z: number, h: number): void {
    const p = this.props[k];
    if (!p) return;
    p.uses--;
    if (p.uses <= 0) p.holder = -2;
    else Object.assign(p, { holder: -1, x, z, h });
  }

  onEvent(m: Match, e: MatchEvent): void {
    if (e.type === "eliminated") {
      const c = m.get(e.id);
      if (!c) return;
      const i = c.index;
      this.release(i);
      if (this.heldBy[i] >= 0) this.release(this.heldBy[i]);
      this.dropProp(m, c);
      this.windup[i] = null;
      this.down[i] = -1;
      this.wobble[i] = 0;
    } else if (e.type === "respawn") {
      const c = m.get(e.id);
      if (!c) return;
      this.wobble[c.index] = 0;
      this.down[c.index] = -1;
      this.immune[c.index] = m.elapsed + MELEE.immune;
      this.floorWas[c.index] = c.h;
    } else if (e.type === "use") {
      // Backpack items that work through melee.
      const c = m.get(e.id);
      if (!c) return;
      if (e.kind === "slipper" || e.kind === "golden-slipper") this.fly(m, c, e.kind === "golden-slipper", -1);
    }
  }

  // ── The online client's copy (mirror): the server's events, applied ──

  apply(m: Match, e: MatchEvent): void {
    const idx = (id: string | null) => (id ? (m.get(id)?.index ?? -1) : -1);
    switch (e.type) {
      case "down": {
        const j = idx(e.id);
        if (j < 0) return;
        this.down[j] = m.elapsed + e.s;
        if (e.why === "daze") this.wobble[j] = 0;
        this.release(j);
        if (this.heldBy[j] >= 0) this.release(this.heldBy[j]);
        break;
      }
      case "up": {
        const j = idx(e.id);
        if (j >= 0) {
          this.down[j] = -1;
          this.immune[j] = m.elapsed + MELEE.immune;
        }
        break;
      }
      case "clinch": {
        const i = idx(e.id);
        const j = idx(e.tg);
        if (i >= 0 && j >= 0) {
          this.clinch[i] = { held: j, since: m.elapsed, dragUntil: -1 };
          this.heldBy[j] = i;
        }
        break;
      }
      case "release":
        if (e.how !== "drag") {
          this.release(idx(e.id));
          this.release(idx(e.tg));
        }
        break;
      case "prop": {
        const p = this.props[e.prop];
        const i = idx(e.id);
        if (!p) return;
        if (e.how === "take") {
          p.holder = i;
          if (i >= 0) this.hand[i] = p.index;
        } else {
          if (i >= 0 && this.hand[i] === p.index) this.hand[i] = -1;
          p.holder = e.how === "break" ? -2 : e.how === "throw" ? -3 : -1;
          p.x = e.x;
          p.z = e.z;
          p.h = e.h;
        }
        break;
      }
      case "fly":
        this.flights[e.flight] = { index: e.flight, by: idx(e.id), x: e.x, z: e.z, h: e.h, dx: e.dx, dz: e.dz, left: MELEE.slipper.range, back: e.back, prop: e.prop, done: false };
        break;
      case "landed-fly": {
        const f = this.flights[e.flight];
        if (f) {
          f.done = true;
          f.x = e.x;
          f.z = e.z;
          this.landProp(f.prop, e.x, e.z, e.h);
        }
        break;
      }
      case "eliminated":
      case "respawn": {
        const j = idx(e.id);
        if (j < 0) return;
        this.release(j);
        if (this.heldBy[j] >= 0) this.release(this.heldBy[j]);
        if (this.hand[j] >= 0) this.hand[j] = -1;
        this.down[j] = -1;
        this.wobble[j] = 0;
        if (e.type === "respawn") this.immune[j] = m.elapsed + MELEE.immune;
        break;
      }
    }
  }

  /** The online client's copy: slippers in the air keep flying until the server says where they came down. */
  view(_m: Match, dt: number): void {
    for (const f of this.flights) {
      if (!f || f.done || f.left <= 0) continue;
      const step = MELEE.slipper.speed * dt;
      f.x += f.dx * step;
      f.z += f.dz * step;
      f.left -= step;
    }
  }

  /** The online client: a body's wobble from a snapshot. */
  setWobble(i: number, w: number): void {
    this.wobble[i] = w;
  }

  /** Is c holding someone (the HUD's finisher buttons)? */
  holdingSomeone(i: number, t: number): { since: number; ready: boolean } | null {
    const cl = this.clinch[i];
    return cl && cl.dragUntil < 0 ? { since: cl.since, ready: t - cl.since >= MELEE.grab.min } : null;
  }

  isDown(i: number): boolean {
    return this.down[i] >= 0;
  }

  /** Whom body i holds in a clinch (dragging too), or −1. */
  clinchOf(i: number): number {
    return this.clinch[i]?.held ?? -1;
  }

  /** Body i's swing winding up (everyone sees it coming): its kind, or null. */
  windingUp(i: number): SwingKind | null {
    return this.windup[i]?.kind ?? null;
  }
}

/** Names of the items melee gives an effect (content/items.ts uses it to hand them out). */
export const MELEE_ITEMS: readonly ItemId[] = ["pepper-soup", "iron-wrapper", "slipper", "golden-slipper"];
