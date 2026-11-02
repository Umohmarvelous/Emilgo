// Dead Streets' rules (SPEC-V3 §3.3; Phase 7): a solo run across Spooky World
// from the Motor Park to the Broadcast Mast.
//
//   You         body 0. Health 100 (a damage-only bar), armour takes half of a
//               hit, a gun (24 rounds), a cutlass and a shove, a torch with a
//               battery, night vision from the backpack. At 0 health the sky
//               laser. After `bleedAfter` s (12:00) health drains 1% a second.
//   Zombies     the other bodies: a pool, SURVIVAL.cap awake at once. Each
//               rises out of the ground (2.5 s), then shambles after you on a
//               flow field (a 1 m grid, rebuilt every 0.25 s within 40 m),
//               lunges when close and claws. Never into a church or mosque.
//   Director    build, peak, relief: spawns out of your sight, 16–34 m off,
//               more of them in a peak, none in relief.
//   Obstacles   Spooky World's hazards (sparks, flares, swinging zinc, the
//               collapse) and gates (three blows, a key, the generator's fuel
//               and switch, a floor that gives way).
//   Sanctuary   quiet: no zombie comes in, slow healing, no weapons.
//   The Mast    reach it and the run is won.
//
// Pure and seeded. A run is played on the phone and checked by the server
// (server/src/runs.ts) from what the phone reports, not replayed.

import { MOVE, SURVIVAL } from "../../config";
import type { ItemId } from "../../content/items";
import type { Gate, Hazard, SpookyRun } from "../../maps/open/spooky";
import { routeProgress } from "../../maps/open/spooky";
import { knock } from "../combat";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";

/** Zombie states. */
const POOLED = 0;
const RISING = 1;
const AWAKE = 2;

export interface RunTally {
  kills: number;
  headshots: number;
  lore: number;
  /** The furthest along the route (m), and its share. */
  best: number;
  route: number;
  finished: boolean;
  /** Seconds of play when the run ended (finished or not). */
  seconds: number;
}

export class SurvivalModule implements RuleModule {
  readonly id = "survival" as const;
  private readonly bleedAfter: number;
  private readonly bleedRate: number;
  run: SpookyRun | null = null;
  // You.
  hp = 100;
  armour = 0;
  ammo = 0;
  torch = 100;
  nvUntil = 0;
  /** Keys and fuel picked up (by gate id). */
  readonly keys = new Set<number>();
  readonly fuel = new Set<number>();
  readonly tally: RunTally = { kills: 0, headshots: 0, lore: 0, best: 0, route: 0, finished: false, seconds: 0 };
  /** The laser coming (seconds of play), or −1. */
  doomAt = -1;
  // Zombies, by body index.
  state = new Int8Array(0);
  zhp = new Float32Array(0);
  wake = new Float64Array(0);
  cool = new Float64Array(0);
  lungeUntil = new Float64Array(0);
  stagger = new Float64Array(0);
  /** Each zombie's pace this step, as a share of a full run. */
  private pace01 = new Float32Array(0);
  // The runner's swings and weapons.
  private seenAtk = 0;
  private gunAt = -9;
  private meleeAt = -9;
  // Gates and hazards.
  readonly open = new Set<number>();
  private readonly blows = new Map<number, number>();
  private readonly hazardAt = new Map<number, number>();
  private collapseAt = -1;
  // The sanctuary visit's healing so far.
  private healed = 0;
  private inSanct = -1;
  // The flow field: a cell's steps to you (−1 none), stamped by build.
  private flow = new Int16Array(0);
  private stamp = new Int32Array(0);
  private gen = 0;
  private flowAt = -9;
  private queue = new Int32Array(0);
  // The director.
  private phaseAt = 0;
  private pace: 0 | 1 | 2 = 0;
  private spawnAt = 0;
  private rng!: ReturnType<Match["rng"]>;

  constructor(params: Record<string, unknown>) {
    this.bleedAfter = typeof params.bleedAfter === "number" ? params.bleedAfter : 720;
    this.bleedRate = typeof params.bleedRate === "number" ? params.bleedRate : 0.01;
  }

  init(m: Match): void {
    const n = m.contestants.length;
    this.run = (m.world as { run?: SpookyRun }).run ?? null;
    this.state = new Int8Array(n);
    this.zhp = new Float32Array(n);
    this.wake = new Float64Array(n);
    this.cool = new Float64Array(n);
    this.lungeUntil = new Float64Array(n);
    this.stagger = new Float64Array(n);
    this.pace01 = new Float32Array(n);
    this.hp = SURVIVAL.you.hp;
    this.ammo = SURVIVAL.you.ammo;
    this.torch = SURVIVAL.you.torch;
    this.rng = m.rng("survival");
    // The gates start shut (a world is shared between runs on a phone).
    const space = m.world.space;
    for (const g of this.run?.gates ?? []) {
      space.solids[g.solid].y0 = g.shut[0];
      space.solids[g.solid].y1 = g.shut[1];
    }
    // You at the Motor Park; the pool asleep out of the way.
    const me = m.contestants[0];
    if (this.run) {
      me.x = this.run.start[0];
      me.z = this.run.start[1];
      me.h = space.floorAt(me.x, me.z, 0).h;
    }
    for (let i = 1; i < n; i++) this.sleep(m, m.contestants[i]);
    const reach = m.reach;
    this.flow = new Int16Array(reach.n * reach.n).fill(-1);
    this.stamp = new Int32Array(reach.n * reach.n);
    this.queue = new Int32Array(reach.n * reach.n);
  }

  /** Back into the pool: out of play, out of sight. */
  private sleep(m: Match, z: Contestant): void {
    this.state[z.index] = POOLED;
    z.status = "eliminated";
    z.x = -m.world.space.bounds.x1 + 2 + (z.index % 8);
    z.z = -m.world.space.bounds.z1 + 2;
    z.vx = z.vz = 0;
    z.inX = z.inZ = 0;
  }

  get me(): number {
    return 0;
  }

  /** Is (x, z) inside a sanctuary (and which)? */
  sanctuary(x: number, z: number): number {
    const list = this.run?.sanctuaries ?? [];
    for (let k = 0; k < list.length; k++) if (Math.hypot(x - list[k].x, z - list[k].z) <= list[k].r) return k;
    return -1;
  }

  /** A hazard's on now? */
  hazardOn(m: Match, h: Hazard): boolean {
    if (h.kind === "collapse") return this.collapseAt >= 0 && m.elapsed >= this.collapseAt && m.elapsed < this.collapseAt + h.on;
    if (h.kind === "pool" || h.kind === "dark" || h.kind === "nogun") return true;
    return (m.elapsed + h.phase) % h.period < h.on;
  }

  /** In a hazard of this kind? */
  inside(c: Contestant, kind: Hazard["kind"]): boolean {
    for (const h of this.run?.hazards ?? []) if (h.kind === kind && Math.hypot(c.x - h.x, c.z - h.z) <= h.r) return true;
    return false;
  }

  /** Can item `kind` be used now? */
  can(_m: Match, c: Contestant, kind: ItemId): boolean {
    if (c.index !== 0) return false;
    switch (kind) {
      case "bandage":
      case "medkit":
        return this.hp < SURVIVAL.you.hp;
      case "armour":
        return this.armour < 100;
      case "battery":
        return this.torch < 100;
      default:
        return true;
    }
  }

  onEvent(m: Match, e: MatchEvent): void {
    if (e.type !== "use") return;
    const c = m.get(e.id);
    if (!c || c.index !== 0) return;
    switch (e.kind) {
      case "bandage":
        this.hp = Math.min(SURVIVAL.you.hp, this.hp + 25);
        break;
      case "medkit":
        this.hp = Math.min(SURVIVAL.you.hp, this.hp + 60);
        break;
      case "ammo":
        this.ammo += 12;
        break;
      case "armour":
        this.armour = Math.min(100, this.armour + 50);
        break;
      case "battery":
        this.torch = 100;
        break;
      case "nv":
        this.nvUntil = m.elapsed + 60;
        break;
      default:
        return;
    }
    this.kit(m, c, "item");
  }

  private kit(m: Match, c: Contestant, why: "item" | "sanctuary"): void {
    m.emit({ type: "kit", id: c.id, hp: Math.round(this.hp), armour: Math.round(this.armour), ammo: this.ammo, torch: Math.round(this.torch), why });
  }

  /** You take `dmg` (armour takes its share first). */
  hurt(_m: Match, dmg: number): void {
    const a = Math.min(this.armour, dmg * SURVIVAL.you.armourShare);
    this.armour -= a;
    this.hp = Math.max(0, this.hp - (dmg - a));
  }

  // ── Every step ──

  pre(m: Match): void {
    const me = m.contestants[0];
    // Rising zombies don't move; staggered ones reel.
    for (let i = 1; i < m.contestants.length; i++) {
      const z = m.contestants[i];
      if (this.state[i] === RISING || (this.state[i] === AWAKE && m.elapsed < this.stagger[i])) m.slow(z, 0);
      else if (this.state[i] === AWAKE) m.slow(z, this.pace01[i]);
    }
    if (me.status !== "alive") return;
    // Your swings (there's no melee module in a run): 1 cutlass, 2 the gun, 3 a shove.
    if (me.inAttack !== this.seenAtk) {
      this.seenAtk = me.inAttack;
      const kind = me.inAttack & 3;
      if (kind === 2) this.shoot(m, me);
      else if (kind === 1 || kind === 3) this.melee(m, me, kind === 1 ? "cutlass" : "shove");
    }
    me.attackSeen = me.inAttack;
    me.grabSeen = me.inGrab;
  }

  step(m: Match, dt: number): void {
    const me = m.contestants[0];
    const t = m.elapsed;
    if (me.status === "alive") {
      this.you(m, me, dt);
      this.hazards(m, me);
      this.gates(m, me);
    }
    if (t - this.flowAt >= SURVIVAL.flow.every) {
      this.flowAt = t;
      this.buildFlow(m, me);
    }
    this.director(m, me);
    this.zombies(m, me);
    // The laser.
    if (this.doomAt >= 0 && t >= this.doomAt) {
      this.doomAt = -1;
      this.tally.seconds = t;
      m.eliminate(me, "zone");
      m.end();
    }
  }

  private you(m: Match, me: Contestant, dt: number): void {
    const t = m.elapsed;
    // The bleed clock.
    if (t > this.bleedAfter) this.hp = Math.max(0, this.hp - this.bleedRate * 100 * dt);
    // The torch runs down slowly (a battery fills it).
    this.torch = Math.max(0, this.torch - dt * 0.12);
    // Sanctuary: quiet, and a little health back.
    const s = this.sanctuary(me.x, me.z);
    if (s !== this.inSanct) {
      this.inSanct = s;
      this.healed = 0;
    }
    if (s >= 0 && this.healed < SURVIVAL.heal.most && this.hp < SURVIVAL.you.hp) {
      const add = Math.min(SURVIVAL.heal.rate * dt, SURVIVAL.heal.most - this.healed, SURVIVAL.you.hp - this.hp);
      this.hp += add;
      this.healed += add;
      if (this.healed >= SURVIVAL.heal.most - 1e-6) this.kit(m, me, "sanctuary");
    }
    // How far along.
    if (this.run) {
      const p = routeProgress(this.run, me.x, me.z);
      if (p.off < 12 && p.d > this.tally.best && p.d < this.tally.best + 30) this.tally.best = p.d;
      this.tally.route = Math.min(1, this.tally.best / this.run.length);
      // The Mast.
      if (Math.hypot(me.x - this.run.finish[0], me.z - this.run.finish[1]) <= SURVIVAL.finish && !this.tally.finished) {
        this.tally.finished = true;
        this.tally.seconds = t;
        this.tally.best = this.run.length;
        this.tally.route = 1;
        m.win(me);
      }
    }
    if (this.hp <= 0 && this.doomAt < 0) {
      this.doomAt = t + SURVIVAL.laser;
      m.emit({ type: "laser", id: me.id, hitAt: this.doomAt });
    }
  }

  private hazards(m: Match, me: Contestant): void {
    for (const h of this.run?.hazards ?? []) {
      const d = Math.hypot(me.x - h.x, me.z - h.z);
      if (h.kind === "collapse" && d <= h.r && this.collapseAt < 0) this.collapseAt = m.elapsed + h.period;
      if (h.dmg <= 0 || d > h.r || !this.hazardOn(m, h)) continue;
      if (m.elapsed - (this.hazardAt.get(h.id) ?? -9) < 1) continue;
      this.hazardAt.set(h.id, m.elapsed);
      this.hurt(m, h.dmg);
      me.stun = Math.max(me.stun, h.stun);
      me.sprinting = false;
      m.emit({ type: "hazard", hz: h.id, id: me.id, hp: Math.round(this.hp) });
    }
  }

  private gates(m: Match, me: Contestant): void {
    const run = this.run;
    if (!run) return;
    for (const g of run.gates) {
      if (this.open.has(g.id)) continue;
      if (g.kind === "floor") {
        const s = m.world.space.solids[g.solid];
        const c = Math.cos(s.rot);
        const sn = Math.sin(s.rot);
        const lx = (me.x - s.x) * c - (me.z - s.z) * sn;
        const lz = (me.x - s.x) * sn + (me.z - s.z) * c;
        if (Math.abs(lx) < s.hx && Math.abs(lz) < s.hz - 2) this.openGate(m, g, me);
        continue;
      }
      // Keys and fuel: walk over them.
      if (g.key && !this.keys.has(g.id) && Math.hypot(me.x - g.key[0], me.z - g.key[1]) < SURVIVAL.reach) {
        this.keys.add(g.id);
        m.emit({ type: "dgate", gate: g.id, how: "key", id: me.id, n: 0 });
      }
      if (g.fuel && !this.fuel.has(g.id) && Math.hypot(me.x - g.fuel[0], me.z - g.fuel[1]) < SURVIVAL.reach) {
        this.fuel.add(g.id);
        m.emit({ type: "dgate", gate: g.id, how: "fuel", id: me.id, n: 0 });
      }
    }
  }

  /** Interact: a key at its gate, the generator's switch with its fuel in. */
  reachFor(m: Match, c: Contestant): { d: number; take: () => void } | null {
    if (c.index !== 0 || !this.run) return null;
    let best: { d: number; take: () => void } | null = null;
    for (const g of this.run.gates) {
      if (this.open.has(g.id)) continue;
      const at = g.kind === "generator" ? g.sw : [g.x, g.z];
      if (!at) continue;
      const ready = g.kind === "generator" ? this.fuel.has(g.id) : (g.kind === "key" || g.kind === "barricade") && this.keys.has(g.id);
      const d = Math.hypot(c.x - at[0], c.z - at[1]);
      if (!ready || d > SURVIVAL.reach + 1.4) continue;
      if (!best || d < best.d) best = { d, take: () => this.openGate(m, g, c) };
    }
    return best;
  }

  private openGate(m: Match, g: Gate, by: Contestant): void {
    this.open.add(g.id);
    // Gone: neither a wall (its bottom above any head) nor a floor (its top far below).
    const s = m.world.space.solids[g.solid];
    s.y0 = 99;
    s.y1 = -99;
    m.emit({ type: "dgate", gate: g.id, how: "open", id: by.id, n: 0 });
  }

  // ── Your weapons ──

  private canFight(m: Match, me: Contestant): boolean {
    return this.sanctuary(me.x, me.z) < 0 && !this.inside(me, "nogun") && m.elapsed >= 0;
  }

  /** The awake zombie nearest within `range` and `cone` of where c faces (and in sight), or null. */
  private target(m: Match, c: Contestant, range: number, cone: number): Contestant | null {
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    let best: Contestant | null = null;
    let bestD = range;
    for (let i = 1; i < m.contestants.length; i++) {
      const z = m.contestants[i];
      if (this.state[i] !== AWAKE || z.status !== "alive") continue;
      const dx = z.x - c.x;
      const dz = z.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD || d < 1e-6) continue;
      if (Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) > cone) continue;
      if (d > 2 && !m.world.space.lineClear(c.x, c.z, z.x, z.z, c.h + 1.4)) continue;
      bestD = d;
      best = z;
    }
    return best;
  }

  private shoot(m: Match, me: Contestant): void {
    const G = SURVIVAL.gun;
    if (this.ammo <= 0 || m.elapsed - this.gunAt < G.every || !this.canFight(m, me)) return;
    this.gunAt = m.elapsed;
    this.ammo--;
    const z = this.target(m, me, G.range, G.cone);
    let head = false;
    if (z) {
      const d = Math.hypot(z.x - me.x, z.z - me.z);
      head = this.rng.next() < G.headNear + (G.headFar - G.headNear) * Math.min(1, d / G.range);
      this.damage(m, z, head ? 999 : G.dmg, me, head);
      this.stagger[z.index] = Math.max(this.stagger[z.index], m.elapsed + 0.25);
    }
    m.emit({ type: "shot", id: me.id, tg: z ? z.id : null, head, ammo: this.ammo });
  }

  private melee(m: Match, me: Contestant, kind: "cutlass" | "shove"): void {
    const W = kind === "cutlass" ? SURVIVAL.cutlass : SURVIVAL.shove;
    if (m.elapsed - this.meleeAt < W.every || !this.canFight(m, me)) return;
    this.meleeAt = m.elapsed;
    // A gate in reach takes the blow first (barricades and hedges break).
    for (const g of this.run?.gates ?? []) {
      if (this.open.has(g.id) || (g.kind !== "barricade" && g.kind !== "hedge")) continue;
      if (Math.hypot(me.x - g.x, me.z - g.z) > W.reach + 1.2) continue;
      const n = (this.blows.get(g.id) ?? 0) + 1;
      this.blows.set(g.id, n);
      m.emit({ type: "blow", id: me.id, tg: null, gate: g.id, kind });
      m.emit({ type: "dgate", gate: g.id, how: "hit", id: me.id, n });
      if (n >= SURVIVAL.blows) this.openGate(m, g, me);
      return;
    }
    const z = this.target(m, me, W.reach, W.cone);
    m.emit({ type: "blow", id: me.id, tg: z ? z.id : null, gate: -1, kind });
    if (!z) return;
    const dx = z.x - me.x;
    const dz = z.z - me.z;
    const d = Math.max(1e-6, Math.hypot(dx, dz));
    knock(z, dx / d, dz / d, W.knock, W.stagger);
    this.stagger[z.index] = m.elapsed + W.stagger;
    this.lungeUntil[z.index] = 0;
    this.damage(m, z, W.dmg, me, false);
  }

  private damage(m: Match, z: Contestant, dmg: number, by: Contestant, head: boolean): void {
    this.zhp[z.index] -= dmg;
    if (this.zhp[z.index] > 0) return;
    this.tally.kills++;
    if (head) this.tally.headshots++;
    m.emit({ type: "zdie", id: z.id, by: by.id, head });
    this.state[z.index] = POOLED;
    this.wake[z.index] = m.elapsed + 4;
    z.status = "eliminated";
    z.vx = z.vz = 0;
  }

  // ── The flow field ──

  /** Breadth-first from your cell over the walk grid, out to SURVIVAL.flow.r. */
  private buildFlow(m: Match, me: Contestant): void {
    const reach = m.reach;
    const n = reach.n;
    const start = reach.cell(me.x, me.z);
    this.gen++;
    if (start < 0) return;
    const r = SURVIVAL.flow.r;
    const q0 = start % n;
    const r0 = (start / n) | 0;
    const free = reach.free;
    let tail = 0;
    this.queue[tail++] = start;
    this.stamp[start] = this.gen;
    this.flow[start] = 0;
    for (let head = 0; head < tail; head++) {
      const i = this.queue[head];
      const q = i % n;
      const rr = (i / n) | 0;
      const nd = this.flow[i] + 1;
      for (const j of [i - 1, i + 1, i - n, i + n]) {
        if (j < 0 || j >= n * n || this.stamp[j] === this.gen || !free[j]) continue;
        const jq = j % n;
        const jr = (j / n) | 0;
        if (Math.abs(jq - q) + Math.abs(jr - rr) !== 1 || Math.abs(jq - q0) > r || Math.abs(jr - r0) > r) continue;
        if (Math.abs(reach.h[j] - reach.h[i]) > 0.5) continue;
        this.stamp[j] = this.gen;
        this.flow[j] = nd;
        this.queue[tail++] = j;
      }
    }
  }

  /** Steps from cell i to you on the current field (−1: no way). */
  private steps(i: number): number {
    return i >= 0 && this.stamp[i] === this.gen ? this.flow[i] : -1;
  }

  // ── The director ──

  private director(m: Match, me: Contestant): void {
    const S = SURVIVAL.spawn;
    const t = m.elapsed;
    const len = this.pace === 0 ? S.build : this.pace === 1 ? S.peak : S.relief;
    if (t - this.phaseAt >= len) {
      this.phaseAt = t;
      this.pace = ((this.pace + 1) % 3) as 0 | 1 | 2;
    }
    if (me.status !== "alive" || t < this.spawnAt || this.sanctuary(me.x, me.z) >= 0) return;
    this.spawnAt = t + S.gaps[this.pace];
    if (this.pace === 2) return;
    let awake = 0;
    let free: Contestant | null = null;
    for (let i = 1; i < m.contestants.length; i++) {
      if (this.state[i] !== POOLED) awake++;
      else if (!free && t >= this.wake[i]) free = m.contestants[i];
    }
    if (!free || awake >= SURVIVAL.cap) return;
    // Somewhere out of sight, on the field (so it can reach you), not in a sanctuary; ahead of you more often.
    const reach = m.reach;
    for (let tries = 0; tries < 24; tries++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(S.near, S.far);
      const x = me.x + Math.sin(a) * d;
      const z = me.z + Math.cos(a) * d;
      const k = reach.cell(x, z);
      if (k < 0 || !reach.free[k] || this.steps(k) < 0 || this.sanctuary(x, z) >= 0) continue;
      if (m.world.space.lineClear(me.x, me.z, x, z, me.h + 1.6) && tries < 20) continue;
      this.rise(m, free, x, z);
      return;
    }
  }

  private rise(m: Match, z: Contestant, x: number, zz: number): void {
    const i = z.index;
    z.status = "alive";
    z.x = x;
    z.z = zz;
    z.h = m.world.space.floorAt(x, zz, 0).h;
    z.y = z.vy = z.vx = z.vz = 0;
    z.stance = 0;
    this.state[i] = RISING;
    this.wake[i] = m.elapsed + SURVIVAL.rise;
    this.zhp[i] = SURVIVAL.hp;
    this.cool[i] = m.elapsed + SURVIVAL.rise + 0.5;
    m.emit({ type: "zrise", id: z.id, x, z: zz, h: z.h });
  }

  // ── The zombies ──

  private zombies(m: Match, me: Contestant): void {
    const t = m.elapsed;
    const reach = m.reach;
    const n = reach.n;
    const alive = me.status === "alive";
    for (let i = 1; i < m.contestants.length; i++) {
      const z = m.contestants[i];
      const s = this.state[i];
      if (s === POOLED) {
        // A body down a while goes back to the pool (out of sight).
        if (z.status === "eliminated" && t >= this.wake[i] && z.x > -m.world.space.bounds.x1 + 20) this.sleep(m, z);
        continue;
      }
      if (s === RISING) {
        if (t >= this.wake[i]) this.state[i] = AWAKE;
        continue;
      }
      if (!alive) {
        z.inX = z.inZ = 0;
        continue;
      }
      const dx = me.x - z.x;
      const dz = me.z - z.z;
      const d = Math.hypot(dx, dz);
      // Too far behind you: back to the pool (the director brings more).
      if (d > SURVIVAL.flow.r + 15) {
        this.sleep(m, z);
        continue;
      }
      z.heading = Math.atan2(dx, dz);
      // The way to you: straight when close and clear, else down the flow field.
      let wx = dx;
      let wz = dz;
      if (d > 3) {
        const k = reach.cell(z.x, z.z);
        const here = this.steps(k);
        if (here > 0) {
          let best = here;
          for (const j of [k - 1, k + 1, k - n, k + n]) {
            const sj = this.steps(j);
            if (sj >= 0 && sj < best) {
              best = sj;
              const [cx, cz] = reach.centre(j);
              wx = cx - z.x;
              wz = cz - z.z;
            }
          }
        }
      }
      const wl = Math.hypot(wx, wz) || 1;
      // A lunge when close; never into a sanctuary.
      if (d < SURVIVAL.lungeR && this.lungeUntil[i] < t - 1.2 && t >= this.stagger[i]) this.lungeUntil[i] = t + SURVIVAL.lungeS;
      const speed = t < this.lungeUntil[i] ? SURVIVAL.lunge : SURVIVAL.walk;
      const nx = z.x + (wx / wl) * 1.2;
      const nz = z.z + (wz / wl) * 1.2;
      if (this.sanctuary(nx, nz) >= 0) {
        z.inX = z.inZ = 0;
      } else {
        // A full push (a run), slowed to the zombie's pace in pre().
        z.inX = wx / wl;
        z.inZ = wz / wl;
        this.pace01[i] = speed / MOVE.run;
      }
      // The claw.
      if (d <= SURVIVAL.claw.reach && t >= this.cool[i] && t >= this.stagger[i] && Math.abs(me.h + me.y - z.h) < 1.2 && this.sanctuary(me.x, me.z) < 0) {
        this.cool[i] = t + SURVIVAL.claw.every;
        this.hurt(m, SURVIVAL.claw.dmg);
        me.stun = Math.max(me.stun, 0.15);
        m.emit({ type: "claw", id: z.id, tg: me.id, hp: Math.round(this.hp), armour: Math.round(this.armour) });
      }
    }
  }

  // ── The mode's measure: metres along the route ──

  objective(_m: Match, i: number): number {
    return i === 0 ? Math.round(this.tally.best) : 0;
  }

  timeUp(m: Match): void {
    this.tally.seconds = m.elapsed;
  }
}
