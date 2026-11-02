// Dead Streets' rules (SPEC-V3 §3.3, §3.4; Phases 7–8): a solo run across
// Spooky World from the Motor Park to the Broadcast Mast.
//
//   You         body 0. Health 100 (damage only), armour takes half a hit, a
//               gun (or your rank weapon), a cutlass (or the Thunder Pestle)
//               and a shove, a torch with a battery, night vision from the
//               backpack, your perks and any juju charms you chose. At 0
//               health the sky laser. After `bleedAfter` s health drains 1%/s.
//   Zombies     the other bodies: a pool, SURVIVAL.cap awake at once, of eight
//               kinds, each with a counter (§3.4 #2). Each rises out of the
//               ground (2.5 s), then comes after you on a flow field (a 1 m
//               grid, rebuilt every 0.25 s within 40 m), lunges and claws.
//               Never into a church or mosque.
//   Director    build, peak, relief; noise (sprinting, shots, blows on doors)
//               brings them sooner. Spawns out of your sight, 16–34 m off.
//   The way     Spooky World's hazards and gates, eight hidden caches by their
//               chalk marks, 24 pieces of lore, the bounty zombie's gold key
//               and its vault, and at the Mast the Last Stand: hold 45 s while
//               the gate grinds open.
//
// Pure and seeded. A run is played on the phone and checked by the server
// (server/src/runs.ts) from what the phone reports, not replayed.

import { CHARM_XP, MOVE, SURVIVAL, ZOMBIE_KINDS, type RunCharm, type RunMutator, type RunPerk, type RunWeapon, type ZombieKind } from "../../config";
import { builtLoot, type ItemId } from "../../content/items";
import { LORE } from "../../content/lore";
import type { Gate, Hazard, SpookyRun } from "../../maps/open/spooky";
import { routeAt, routeProgress } from "../../maps/open/spooky";
import { knock } from "../combat";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import { pick, type ItemsModule } from "./items";

/** Zombie states. */
const POOLED = 0;
const RISING = 1;
const AWAKE = 2;

export interface RunTally {
  kills: number;
  headshots: number;
  lore: number;
  caches: number;
  /** The furthest along the route (m), and its share. */
  best: number;
  route: number;
  finished: boolean;
  /** Seconds of play when the run ended (finished or not). */
  seconds: number;
  /** Health lost (flawless: none). */
  hurt: number;
  /** The juju charms' XP (1 … 1.5). */
  charm: number;
}

/** Something to find on the way: a cache by its chalk mark, a piece of lore, the vault. */
export interface Find {
  k: number;
  kind: "cache" | "lore" | "vault" | "egg";
  x: number;
  z: number;
}

/** A medal for a finished run (§3.4 #16). */
// medalOf, runMutator and dailySeed live in weekly.ts (the lobby uses them without this module).
export { dailySeed, medalOf, runMutator } from "../weekly";

export class SurvivalModule implements RuleModule {
  readonly id = "survival" as const;
  readonly bleedAfter: number;
  private readonly bleedRate: number;
  readonly weapon: RunWeapon;
  readonly perks: ReadonlySet<RunPerk>;
  readonly charms: ReadonlySet<RunCharm>;
  readonly mutator: RunMutator | undefined;
  /** Weapon mods (§3.4 #17): a suppressor (quieter, a little weaker), a night-vision scope (head shots at range). */
  readonly mods: ReadonlySet<"suppressor" | "scope">;
  /** The broken doll's eyes (§3.4 #19): how many times the beam has held on them, and for how long this time. */
  eggHits = 0;
  private eggT = 0;
  run: SpookyRun | null = null;
  // You.
  hp = 100;
  armour = 0;
  ammo = 0;
  torch = 100;
  nvUntil = 0;
  gasUntil = 0;
  /** Held by a Pool Lurker (its body index, −1 none): you can't move until you strike. */
  heldBy = -1;
  /** Second Breath: used. */
  breathed = false;
  /** Keys and fuel picked up (by gate id); the gold key. */
  readonly keys = new Set<number>();
  readonly fuel = new Set<number>();
  goldKey = false;
  readonly tally: RunTally = { kills: 0, headshots: 0, lore: 0, caches: 0, best: 0, route: 0, finished: false, seconds: 0, hurt: 0, charm: 1 };
  /** The laser coming (seconds of play), or −1. The Last Stand: when it began (−1: not yet). */
  doomAt = -1;
  standAt = -1;
  // Zombies, by body index.
  state = new Int8Array(0);
  kind = new Int8Array(0);
  zhp = new Float32Array(0);
  wake = new Float64Array(0);
  cool = new Float64Array(0);
  lungeUntil = new Float64Array(0);
  stagger = new Float64Array(0);
  beamT = new Float32Array(0);
  bounty = -1;
  private pace01 = new Float32Array(0);
  private charge = new Float64Array(0);
  private screamed = new Uint8Array(0);
  // Things to find.
  readonly finds: Find[] = [];
  readonly found = new Set<number>();
  // The runner's swings and weapons.
  private seenAtk = 0;
  private gunAt = -9;
  private meleeAt = -9;
  /** Noise now (0 …). */
  noise = 0;
  // Gates and hazards.
  readonly open = new Set<number>();
  private readonly blows = new Map<number, number>();
  private readonly hazardAt = new Map<number, number>();
  private collapseAt = -1;
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
  pace: 0 | 1 | 2 = 0;
  private spawnAt = 0;
  private rng!: ReturnType<Match["rng"]>;

  constructor(params: Record<string, unknown>) {
    this.bleedAfter = typeof params.bleedAfter === "number" ? params.bleedAfter : 720;
    this.bleedRate = typeof params.bleedRate === "number" ? params.bleedRate : 0.01;
    const w = params.weapon;
    this.weapon = w === "dane" || w === "pestle" || w === "flame" ? w : "pistol";
    const list = <T extends string>(v: unknown, ok: readonly T[]): Set<T> => new Set(Array.isArray(v) ? (v.filter((x) => ok.includes(x as T)) as T[]) : []);
    this.perks = list<RunPerk>(params.perks, ["breath", "quiet", "eagle", "mule", "steady"]);
    this.charms = list<RunCharm>(params.charms, ["notorch", "melee", "six"]);
    const mu = params.mutator;
    this.mutator = mu === "haze" || mu === "runners" || mu === "onebullet" || mu === "notorch" ? mu : undefined;
    this.mods = list<"suppressor" | "scope">(params.mods, ["suppressor", "scope"]);
  }

  init(m: Match): void {
    const n = m.contestants.length;
    this.run = (m.world as { run?: SpookyRun }).run ?? null;
    this.state = new Int8Array(n);
    this.kind = new Int8Array(n);
    this.zhp = new Float32Array(n);
    this.wake = new Float64Array(n);
    this.cool = new Float64Array(n);
    this.lungeUntil = new Float64Array(n);
    this.stagger = new Float64Array(n);
    this.beamT = new Float32Array(n);
    this.pace01 = new Float32Array(n);
    this.charge = new Float64Array(n).fill(-1);
    this.screamed = new Uint8Array(n);
    this.hp = 100;
    this.ammo = this.mutator === "onebullet" ? 1 : SURVIVAL.you.ammo;
    this.torch = this.noTorch ? 0 : SURVIVAL.you.torch;
    this.tally.charm = Math.min(1.5, [...this.charms].reduce((k, c) => k * CHARM_XP[c], 1));
    this.rng = m.rng("survival");
    // The gates start shut (a world is shared between runs on a phone).
    const space = m.world.space;
    for (const g of this.run?.gates ?? []) {
      space.solids[g.solid].y0 = g.shut[0];
      space.solids[g.solid].y1 = g.shut[1];
    }
    // You at the Motor Park (Pack Mule a little slower); the pool asleep out of the way.
    const me = m.contestants[0];
    if (this.run) {
      me.x = this.run.start[0];
      me.z = this.run.start[1];
      me.h = space.floorAt(me.x, me.z, 0).h;
    }
    if (this.perks.has("mule")) m.setEffect(me, "speed", 1e6, 0.95);
    for (let i = 1; i < n; i++) this.sleep(m, m.contestants[i]);
    const reach = m.reach;
    this.flow = new Int16Array(reach.n * reach.n).fill(-1);
    this.stamp = new Int32Array(reach.n * reach.n);
    this.queue = new Int32Array(reach.n * reach.n);
    this.placeFinds(m);
  }

  private get noTorch(): boolean {
    return this.charms.has("notorch") || this.mutator === "notorch";
  }

  /** The pack's size for this run (Pack Mule +2; the six-slot charm). */
  slots(base: number): number {
    return this.charms.has("six") ? 6 : base + (this.perks.has("mule") ? 2 : 0);
  }

  /** Caches by chalk marks, the lore, the vault: beside the route, from the seed. */
  private placeFinds(m: Match): void {
    const run = this.run;
    if (!run) return;
    const reach = m.reach;
    const spot = (d: number, off: number): [number, number] | null => {
      const p = routeAt(run, Math.max(5, Math.min(run.length - 5, d)));
      for (const side of [1, -1]) {
        for (let o = off; o <= off + 6; o += 1.5) {
          const x = p.x + p.uz * o * side;
          const z = p.z - p.ux * o * side;
          const k = reach.cell(x, z);
          if (k >= 0 && reach.free[k] && Math.abs(reach.h[k]) < 0.2) return [x, z];
        }
      }
      return null;
    };
    let k = 0;
    for (let i = 0; i < SURVIVAL.caches; i++) {
      const at = spot(run.length * ((i + 0.5) / SURVIVAL.caches) + this.rng.range(-20, 20), 5);
      if (at) this.finds.push({ k: k++, kind: "cache", x: at[0], z: at[1] });
    }
    for (let i = 0; i < LORE.length; i++) {
      const at = spot(run.length * ((i + 0.3) / LORE.length), 2.5);
      if (at) this.finds.push({ k: k++, kind: "lore", x: at[0], z: at[1] });
    }
    const v = spot(run.length * SURVIVAL.bounty.vault, 5);
    if (v) this.finds.push({ k: k++, kind: "vault", x: v[0], z: v[1] });
    // The toy shop's broken doll (a nod to the old game's doll): two thirds of the way, off the street.
    const e = spot(run.length * 0.66, 6);
    if (e) this.finds.push({ k: k++, kind: "egg", x: e[0], z: e[1] });
  }

  /** Back into the pool: out of play, out of sight. */
  private sleep(m: Match, z: Contestant): void {
    this.state[z.index] = POOLED;
    z.status = "eliminated";
    z.x = -m.world.space.bounds.x1 + 2 + (z.index % 8);
    z.z = -m.world.space.bounds.z1 + 2;
    z.vx = z.vz = 0;
    z.inX = z.inZ = 0;
    z.stance = 0;
  }

  get me(): number {
    return 0;
  }

  kindOf(i: number): ZombieKind {
    return ZOMBIE_KINDS[this.kind[i]];
  }

  sanctuary(x: number, z: number): number {
    const list = this.run?.sanctuaries ?? [];
    for (let k = 0; k < list.length; k++) if (Math.hypot(x - list[k].x, z - list[k].z) <= list[k].r) return k;
    return -1;
  }

  hazardOn(m: Match, h: Hazard): boolean {
    if (h.kind === "collapse") return this.collapseAt >= 0 && m.elapsed >= this.collapseAt && m.elapsed < this.collapseAt + h.on;
    if (h.kind === "pool" || h.kind === "dark" || h.kind === "nogun") return true;
    return (m.elapsed + h.phase) % h.period < h.on;
  }

  inside(c: Contestant, kind: Hazard["kind"]): boolean {
    for (const h of this.run?.hazards ?? []) if (h.kind === kind && Math.hypot(c.x - h.x, c.z - h.z) <= h.r) return true;
    return false;
  }

  can(_m: Match, c: Contestant, kind: ItemId): boolean {
    if (c.index !== 0) return false;
    switch (kind) {
      case "bandage":
      case "medkit":
        return this.hp < SURVIVAL.you.hp;
      case "armour":
        return this.armour < 100;
      case "battery":
        return this.torch < 100 && !this.noTorch;
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
        this.ammo += this.mutator === "onebullet" ? 1 : 12;
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

  hurt(_m: Match, dmg: number): void {
    const a = Math.min(this.armour, dmg * SURVIVAL.you.armourShare);
    this.armour -= a;
    const lost = Math.min(this.hp, dmg - a);
    this.hp -= lost;
    this.tally.hurt += lost;
  }

  private loud(amount: number): void {
    this.noise += amount;
  }

  // ── Every step ──

  pre(m: Match): void {
    const me = m.contestants[0];
    for (let i = 1; i < m.contestants.length; i++) {
      const z = m.contestants[i];
      if (this.state[i] === RISING || (this.state[i] === AWAKE && m.elapsed < this.stagger[i])) m.slow(z, 0);
      else if (this.state[i] === AWAKE) m.slow(z, this.pace01[i]);
    }
    if (me.status !== "alive") return;
    // Held in a pool, or in the gas: slowed (a strike frees you).
    if (this.heldBy >= 0) m.slow(me, 0);
    else if (m.elapsed < this.gasUntil) m.slow(me, SURVIVAL.gas.k);
    // Your swings (there's no melee module in a run): 1 cutlass, 2 the gun, 3 a shove.
    if (me.inAttack !== this.seenAtk) {
      this.seenAtk = me.inAttack;
      const kind = me.inAttack & 3;
      if (kind === 2) this.shoot(m, me);
      else if (kind === 1 || kind === 3) this.melee(m, me, kind === 1 ? (this.weapon === "pestle" ? "pestle" : "cutlass") : "shove");
    }
    me.attackSeen = me.inAttack;
    me.grabSeen = me.inGrab;
  }

  step(m: Match, dt: number): void {
    const me = m.contestants[0];
    const t = m.elapsed;
    this.noise = Math.max(0, this.noise - SURVIVAL.noise.fade * dt * Math.max(1, this.noise));
    if (me.status === "alive") {
      this.you(m, me, dt);
      this.hazards(m, me);
      this.gates(m, me);
      this.findings(m, me);
      this.beam(m, me, dt);
    }
    if (t - this.flowAt >= SURVIVAL.flow.every) {
      this.flowAt = t;
      this.buildFlow(m, me);
    }
    this.director(m, me);
    this.zombies(m, me);
    if (this.doomAt >= 0 && t >= this.doomAt) {
      this.doomAt = -1;
      this.tally.seconds = t;
      m.eliminate(me, "zone");
      m.end();
    }
  }

  private you(m: Match, me: Contestant, dt: number): void {
    const t = m.elapsed;
    if (t > this.bleedAfter) this.hp = Math.max(0, this.hp - this.bleedRate * 100 * dt);
    if (!this.noTorch) this.torch = Math.max(0, this.torch - dt * 0.12);
    if (me.sprinting && !this.perks.has("quiet")) this.loud(SURVIVAL.noise.sprint * dt);
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
    if (this.run) {
      const p = routeProgress(this.run, me.x, me.z);
      if (p.off < 12 && p.d > this.tally.best && p.d < this.tally.best + 30) this.tally.best = p.d;
      this.tally.route = Math.min(1, this.tally.best / this.run.length);
      // The Mast: the Last Stand, then the gate opens and the run is won.
      const atMast = Math.hypot(me.x - this.run.finish[0], me.z - this.run.finish[1]);
      if (this.standAt < 0 && atMast <= SURVIVAL.finish) {
        this.standAt = t;
        this.pace = 1;
        this.phaseAt = t;
        m.emit({ type: "stand", id: me.id, until: t + SURVIVAL.stand.s });
      }
      if (this.standAt >= 0 && !this.tally.finished && t >= this.standAt + SURVIVAL.stand.s && atMast <= SURVIVAL.stand.r) {
        this.tally.finished = true;
        this.tally.seconds = t;
        this.tally.best = this.run.length;
        this.tally.route = 1;
        m.win(me);
      }
    }
    if (this.hp <= 0 && this.doomAt < 0) {
      // Second Breath: up once at 30%.
      if (this.perks.has("breath") && !this.breathed) {
        this.breathed = true;
        this.hp = 30;
        this.kit(m, me, "item");
      } else {
        this.doomAt = t + SURVIVAL.laser;
        m.emit({ type: "laser", id: me.id, hitAt: this.doomAt });
      }
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

  /** Lore you walk over. Caches and the vault need a tap (reachFor). */
  private findings(m: Match, me: Contestant): void {
    for (const f of this.finds) {
      if (f.kind !== "lore" || this.found.has(f.k) || Math.hypot(me.x - f.x, me.z - f.z) > SURVIVAL.reach) continue;
      this.found.add(f.k);
      this.tally.lore++;
      m.emit({ type: "find", id: me.id, k: f.k, kind: "lore", n: this.tally.lore - 1, items: [] });
    }
  }

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
    for (const f of this.finds) {
      if (f.kind === "lore" || this.found.has(f.k) || (f.kind === "vault" && !this.goldKey) || (f.kind === "egg" && this.eggHits < 3)) continue;
      const d = Math.hypot(c.x - f.x, c.z - f.z);
      if (d > SURVIVAL.reach) continue;
      if (!best || d < best.d) best = { d, take: () => this.openFind(m, c, f) };
    }
    return best;
  }

  /** A cache (Grandma's tin box) or the vault: loot into the pack. */
  private openFind(m: Match, c: Contestant, f: Find): void {
    this.found.add(f.k);
    const table = builtLoot("ds-core", (id) => m.module(id) !== null);
    const items: ItemId[] = [];
    const n = f.kind === "vault" || f.kind === "egg" ? 4 : 2;
    for (let i = 0; i < n && table.length; i++) items.push(pick(table, this.rng.next()));
    if (f.kind === "vault" || f.kind === "egg") items.push("medkit", "armour");
    if (f.kind === "cache") this.tally.caches++;
    m.emit({ type: "find", id: c.id, k: f.k, kind: f.kind, n: f.kind === "cache" ? this.tally.caches - 1 : 0, items });
    m.module<ItemsModule>("items")?.give(m, c, items);
  }

  private openGate(m: Match, g: Gate, by: Contestant): void {
    this.open.add(g.id);
    const s = m.world.space.solids[g.solid];
    s.y0 = 99;
    s.y1 = -99;
    m.emit({ type: "dgate", gate: g.id, how: "open", id: by.id, n: 0 });
  }

  /** Torch stun (§3.4 #3): the beam held on a Runner's face staggers it, for battery. And the doll's eyes. */
  private beam(m: Match, me: Contestant, dt: number): void {
    const B = SURVIVAL.beam;
    if (this.torch <= 0) return;
    const fx = Math.sin(me.heading);
    const fz = Math.cos(me.heading);
    const cone = this.perks.has("eagle") ? B.cone * 0.7 : B.cone;
    // Three times the beam on her eyes (a second each, turning away between) and the secret room opens.
    const egg = this.finds.find((f) => f.kind === "egg");
    if (egg && this.eggHits < 3) {
      const dx = egg.x - me.x;
      const dz = egg.z - me.z;
      const d = Math.hypot(dx, dz);
      const on = d < 10 && d > 0.5 && Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) < cone;
      if (on && this.eggT >= 0) {
        this.eggT += dt;
        if (this.eggT >= 1) {
          this.eggT = -1;
          this.eggHits++;
          m.emit({ type: "find", id: me.id, k: egg.k, kind: "egg", n: this.eggHits, items: [] });
        }
      } else if (!on) this.eggT = 0;
    }
    for (let i = 1; i < m.contestants.length; i++) {
      if (this.state[i] !== AWAKE || this.kindOf(i) !== "runner") continue;
      const z = m.contestants[i];
      const dx = z.x - me.x;
      const dz = z.z - me.z;
      const d = Math.hypot(dx, dz);
      const on = d < B.range && d > 0.3 && Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) < cone;
      this.beamT[i] = on ? this.beamT[i] + dt : 0;
      if (this.beamT[i] >= B.hold) {
        this.beamT[i] = 0;
        this.stagger[i] = m.elapsed + B.stagger;
        this.lungeUntil[i] = 0;
        this.torch = Math.max(0, this.torch - B.cost);
        m.emit({ type: "beam", id: z.id });
      }
    }
  }

  // ── Your weapons ──

  private canFight(m: Match, me: Contestant): boolean {
    return this.sanctuary(me.x, me.z) < 0 && !this.inside(me, "nogun") && m.elapsed >= 0;
  }

  /** The awake zombies within `range` and `cone` of where c faces (and in sight), nearest first. */
  private targets(m: Match, c: Contestant, range: number, cone: number): Contestant[] {
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    const out: [number, Contestant][] = [];
    for (let i = 1; i < m.contestants.length; i++) {
      const z = m.contestants[i];
      if (this.state[i] !== AWAKE || z.status !== "alive") continue;
      const dx = z.x - c.x;
      const dz = z.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 1e-6) continue;
      if (Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) > cone) continue;
      if (d > 2 && !m.world.space.lineClear(c.x, c.z, z.x, z.z, c.h + 1.4)) continue;
      out.push([d, z]);
    }
    return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }

  private shoot(m: Match, me: Contestant): void {
    if (this.charms.has("melee") || !this.canFight(m, me)) return;
    const w = this.weapon;
    if (w === "dane" || w === "flame") {
      const W = w === "dane" ? SURVIVAL.dane : SURVIVAL.flame;
      const cost = w === "dane" ? SURVIVAL.dane.rounds : 1;
      if (this.ammo < cost || m.elapsed - this.gunAt < W.every) return;
      this.gunAt = m.elapsed;
      this.ammo -= cost;
      this.loud(SURVIVAL.noise.shot * (w === "flame" ? 3 : 1.5));
      const hit = this.targets(m, me, W.range, W.cone).slice(0, w === "dane" ? SURVIVAL.dane.most : 8);
      for (const z of hit) {
        // The Masked only fall to a head shot (a spread or a flame isn't one).
        if (this.kindOf(z.index) !== "masked") this.damage(m, z, W.dmg, me, false);
        this.stagger[z.index] = Math.max(this.stagger[z.index], m.elapsed + 0.5);
      }
      m.emit({ type: "shot", id: me.id, tg: hit[0]?.id ?? null, head: false, ammo: this.ammo });
      return;
    }
    const G = SURVIVAL.gun;
    const every = this.perks.has("steady") ? G.every * 0.8 : G.every;
    if (this.ammo <= 0 || m.elapsed - this.gunAt < every) return;
    this.gunAt = m.elapsed;
    this.ammo--;
    const quiet = this.mods.has("suppressor");
    this.loud(SURVIVAL.noise.shot * (quiet ? 0.35 : 1));
    const z = this.targets(m, me, G.range, G.cone)[0] ?? null;
    let head = false;
    if (z) {
      const d = Math.hypot(z.x - me.x, z.z - me.z);
      const bonus = (this.perks.has("eagle") ? 0.2 : 0) + (this.mods.has("scope") && d > 10 ? 0.1 : 0);
      head = this.rng.next() < G.headNear + bonus + (G.headFar - G.headNear) * Math.min(1, d / G.range);
      const masked = this.kindOf(z.index) === "masked";
      this.damage(m, z, head ? 999 : masked ? 0 : G.dmg * (quiet ? 0.8 : 1), me, head);
      this.stagger[z.index] = Math.max(this.stagger[z.index], m.elapsed + 0.25);
    }
    m.emit({ type: "shot", id: me.id, tg: z ? z.id : null, head, ammo: this.ammo });
  }

  private melee(m: Match, me: Contestant, kind: "cutlass" | "shove" | "pestle"): void {
    const W = kind === "cutlass" ? SURVIVAL.cutlass : kind === "pestle" ? SURVIVAL.pestle : SURVIVAL.shove;
    const shown = kind === "pestle" ? "cutlass" : kind;
    if (m.elapsed - this.meleeAt < W.every || !this.canFight(m, me)) return;
    this.meleeAt = m.elapsed;
    // A Pool Lurker's grip: any blow breaks it.
    if (this.heldBy >= 0) {
      const z = m.contestants[this.heldBy];
      this.heldBy = -1;
      this.stagger[z.index] = m.elapsed + 1.5;
      m.emit({ type: "blow", id: me.id, tg: z.id, gate: -1, kind: shown });
      this.damage(m, z, W.dmg, me, false);
      return;
    }
    // A gate in reach takes the blow first (barricades and hedges break; it's loud).
    for (const g of this.run?.gates ?? []) {
      if (this.open.has(g.id) || (g.kind !== "barricade" && g.kind !== "hedge")) continue;
      if (Math.hypot(me.x - g.x, me.z - g.z) > W.reach + 1.2) continue;
      const n = (this.blows.get(g.id) ?? 0) + 1;
      this.blows.set(g.id, n);
      this.loud(SURVIVAL.noise.blow);
      m.emit({ type: "blow", id: me.id, tg: null, gate: g.id, kind: shown });
      m.emit({ type: "dgate", gate: g.id, how: "hit", id: me.id, n });
      if (n >= SURVIVAL.blows) this.openGate(m, g, me);
      return;
    }
    // The pestle knocks down a group; the cutlass and the shove take the nearest.
    const hit = this.targets(m, me, W.reach, W.cone).slice(0, kind === "pestle" ? 6 : 1);
    m.emit({ type: "blow", id: me.id, tg: hit[0]?.id ?? null, gate: -1, kind: shown });
    for (const z of hit) {
      const dx = z.x - me.x;
      const dz = z.z - me.z;
      const d = Math.max(1e-6, Math.hypot(dx, dz));
      knock(z, dx / d, dz / d, W.knock, W.stagger);
      this.stagger[z.index] = m.elapsed + W.stagger;
      this.lungeUntil[z.index] = 0;
      this.charge[z.index] = -1;
      // The Masked: head shots only (a blade staggers it).
      if (this.kindOf(z.index) !== "masked") this.damage(m, z, W.dmg, me, false);
    }
  }

  private damage(m: Match, z: Contestant, dmg: number, by: Contestant, head: boolean): void {
    this.zhp[z.index] -= dmg;
    if (this.zhp[z.index] > 0) return;
    this.tally.kills++;
    if (head) this.tally.headshots++;
    const k = this.kindOf(z.index);
    m.emit({ type: "zdie", id: z.id, by: by.id, head });
    // A Bloater bursts: pepper gas round it (shoot it from range).
    if (k === "bloater") {
      if (Math.hypot(by.x - z.x, by.z - z.z) <= SURVIVAL.gas.r) this.gasUntil = m.elapsed + SURVIVAL.gas.s;
      m.emit({ type: "gas", id: z.id, x: z.x, z: z.z });
    }
    // The bounty: its gold key.
    if (z.index === this.bounty) {
      this.bounty = -1;
      this.goldKey = true;
      m.emit({ type: "find", id: by.id, k: -1, kind: "key", n: 0, items: [] });
    }
    if (this.heldBy === z.index) this.heldBy = -1;
    this.state[z.index] = POOLED;
    this.wake[z.index] = m.elapsed + 4;
    z.status = "eliminated";
    z.vx = z.vz = 0;
  }

  // ── The flow field ──

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

  private steps(i: number): number {
    return i >= 0 && this.stamp[i] === this.gen ? this.flow[i] : -1;
  }

  // ── The director ──

  private director(m: Match, me: Contestant): void {
    const S = SURVIVAL.spawn;
    const t = m.elapsed;
    const len = this.pace === 0 ? S.build : this.pace === 1 ? S.peak : S.relief;
    if (t - this.phaseAt >= len && this.standAt < 0) {
      this.phaseAt = t;
      this.pace = ((this.pace + 1) % 3) as 0 | 1 | 2;
      if (this.pace === 1) m.emit({ type: "horde", id: me.id });
    }
    if (me.status !== "alive" || t < this.spawnAt || this.sanctuary(me.x, me.z) >= 0) return;
    // Noise brings them sooner (and a relief ends early if you're loud).
    const loud = Math.min(SURVIVAL.noise.most, this.noise / 10);
    this.spawnAt = t + S.gaps[this.standAt >= 0 ? 1 : this.pace] * (1 - loud);
    if (this.pace === 2 && this.noise < 3 && this.standAt < 0) return;
    let awake = 0;
    let free: Contestant | null = null;
    for (let i = 1; i < m.contestants.length; i++) {
      if (this.state[i] !== POOLED) awake++;
      else if (!free && t >= this.wake[i]) free = m.contestants[i];
    }
    if (!free || awake >= SURVIVAL.cap) return;
    // A Lurker in the pool beside you; else a kind by how far along you are.
    const pool = this.run?.hazards.find((h) => h.kind === "pool" && Math.hypot(h.x - me.x, h.z - me.z) < h.r + 18) ?? null;
    if (pool && this.rng.next() < 0.5) {
      const a = this.rng.range(0, Math.PI * 2);
      const x = pool.x + Math.cos(a) * pool.r * 0.5;
      const z = pool.z + Math.sin(a) * pool.r * 0.5;
      if (Math.hypot(x - me.x, z - me.z) > 3) return this.rise(m, free, x, z, "lurker");
    }
    const reach = m.reach;
    for (let tries = 0; tries < 24; tries++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(S.near, S.far);
      const x = me.x + Math.sin(a) * d;
      const z = me.z + Math.cos(a) * d;
      const k = reach.cell(x, z);
      if (k < 0 || !reach.free[k] || this.steps(k) < 0 || this.sanctuary(x, z) >= 0) continue;
      if (m.world.space.lineClear(me.x, me.z, x, z, me.h + 1.6) && tries < 20) continue;
      this.rise(m, free, x, z, this.pickKind());
      return;
    }
  }

  /** Which kind rises: Shamblers early, the rest more as you go (Double Runners: twice the Runners). */
  private pickKind(): ZombieKind {
    const u = this.tally.route;
    let total = 0;
    const w = ZOMBIE_KINDS.map((k) => {
      const K = SURVIVAL.kinds[k];
      let x = K.early + (K.late - K.early) * u;
      if (k === "runner" && this.mutator === "runners") x *= 2;
      total += x;
      return x;
    });
    let r = this.rng.next() * total;
    for (let i = 0; i < w.length; i++) if ((r -= w[i]) <= 0) return ZOMBIE_KINDS[i];
    return "shambler";
  }

  /** A zombie rises at (x, zz): a Shambler unless told. */
  private rise(m: Match, z: Contestant, x: number, zz: number, kind: ZombieKind = "shambler"): void {
    const i = z.index;
    z.status = "alive";
    z.x = x;
    z.z = zz;
    z.h = m.world.space.floorAt(x, zz, 0).h;
    z.y = z.vy = z.vx = z.vz = 0;
    z.stance = kind === "crawler" ? 2 : 0;
    this.state[i] = RISING;
    this.kind[i] = ZOMBIE_KINDS.indexOf(kind);
    this.wake[i] = m.elapsed + SURVIVAL.rise;
    this.zhp[i] = SURVIVAL.kinds[kind].hp;
    this.cool[i] = m.elapsed + SURVIVAL.rise + 0.5;
    this.charge[i] = -1;
    this.screamed[i] = 0;
    this.beamT[i] = 0;
    // The bounty zombie: once, about a third of the way along.
    const vaultDone = this.finds.some((f) => f.kind === "vault" && this.found.has(f.k));
    if (this.bounty < 0 && !this.goldKey && !vaultDone && kind === "shambler" && this.tally.route >= SURVIVAL.bounty.at) {
      this.bounty = i;
      this.zhp[i] = 180;
    }
    m.emit({ type: "zrise", id: z.id, x, z: zz, h: z.h, kind, bounty: this.bounty === i });
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
      const kind = this.kindOf(i);
      const K = SURVIVAL.kinds[kind];
      const dx = me.x - z.x;
      const dz = me.z - z.z;
      const d = Math.hypot(dx, dz);
      if (d > SURVIVAL.flow.r + 15 && i !== this.bounty) {
        if (this.heldBy === i) this.heldBy = -1;
        this.sleep(m, z);
        continue;
      }
      // A Screamer awake long enough screams: more come (cut it down quietly first).
      if (kind === "screamer" && !this.screamed[i] && t >= this.wake[i] + SURVIVAL.scream.after) {
        this.screamed[i] = 1;
        this.loud(10);
        this.spawnAt = t;
        m.emit({ type: "scream", id: z.id });
      }
      z.heading = Math.atan2(dx, dz);
      // A Brute's charge: straight at where you were; a wall stops it, stunned (side-step).
      if (kind === "brute") {
        if (this.charge[i] < 0 && d >= SURVIVAL.brute.from && d <= SURVIVAL.brute.to && t >= this.stagger[i] && m.world.space.lineClear(z.x, z.z, me.x, me.z, z.h + 1)) {
          this.charge[i] = Math.atan2(dx, dz);
          this.cool[i] = t;
          m.emit({ type: "charge", id: z.id });
        }
        if (this.charge[i] >= 0) {
          const hx = Math.sin(this.charge[i]);
          const hz = Math.cos(this.charge[i]);
          z.inX = hx;
          z.inZ = hz;
          z.heading = this.charge[i];
          this.pace01[i] = K.lunge / MOVE.run;
          if (t - this.cool[i] > 0.4 && Math.hypot(z.vx, z.vz) < 1.2 && !m.world.space.lineClear(z.x, z.z, z.x + hx * 1, z.z + hz * 1, z.h + 1)) {
            this.charge[i] = -1;
            this.stagger[i] = t + SURVIVAL.brute.stun;
            m.emit({ type: "beam", id: z.id });
          } else if (d < 1.4) {
            this.charge[i] = -1;
            this.cool[i] = t + 2;
            this.hurt(m, SURVIVAL.brute.dmg);
            me.stun = Math.max(me.stun, 0.9);
            const k = Math.max(1e-6, d);
            knock(me, dx / k, dz / k, 2.5, 0.9);
            m.emit({ type: "claw", id: z.id, tg: me.id, hp: Math.round(this.hp), armour: Math.round(this.armour) });
          } else if (t - this.cool[i] > 3) this.charge[i] = -1;
          continue;
        }
      }
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
      if (d < SURVIVAL.lungeR && this.lungeUntil[i] < t - 1.2 && t >= this.stagger[i]) this.lungeUntil[i] = t + SURVIVAL.lungeS;
      const speed = t < this.lungeUntil[i] ? K.lunge : K.walk;
      const nx = z.x + (wx / wl) * 1.2;
      const nz = z.z + (wz / wl) * 1.2;
      if (this.sanctuary(nx, nz) >= 0) {
        z.inX = z.inZ = 0;
      } else {
        z.inX = wx / wl;
        z.inZ = wz / wl;
        this.pace01[i] = speed / MOVE.run;
      }
      // The claw (a Lurker grabs your legs in the pool as well).
      if (d <= SURVIVAL.claw.reach && t >= this.cool[i] && t >= this.stagger[i] && Math.abs(me.h + me.y - z.h) < 1.2 && this.sanctuary(me.x, me.z) < 0) {
        this.cool[i] = t + SURVIVAL.claw.every;
        if (kind === "lurker" && this.inside(me, "pool") && this.heldBy < 0) {
          this.heldBy = i;
          m.emit({ type: "grabbed", id: z.id });
        }
        this.hurt(m, SURVIVAL.claw.dmg);
        me.stun = Math.max(me.stun, this.perks.has("steady") ? 0 : 0.15);
        m.emit({ type: "claw", id: z.id, tg: me.id, hp: Math.round(this.hp), armour: Math.round(this.armour) });
      }
    }
  }

  objective(_m: Match, i: number): number {
    return i === 0 ? Math.round(this.tally.best) : 0;
  }

  timeUp(m: Match): void {
    this.tally.seconds = m.elapsed;
  }
}
