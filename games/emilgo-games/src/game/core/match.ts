// The match core for the open worlds (SPEC-V3 §1.1): bodies, the clock and
// the phases, and a list of rule modules that make it a mode. Free For All and
// Dead Streets are this plus their modules; Red Light, Green Light moves onto
// it in Phase 11.
//
// Pure, like rules.ts: no three.js, no DOM, no clock. It advances only when
// step(dt) is called with a fixed dt, and every random choice comes from a
// seeded stream (`rng(name)`: one per module, so adding a module never shifts
// another's choices). The server runs it as the authority; Solo and the dev
// pages run it locally.
//
//   walkout → countdown → play → ended
//   Bodies move only in play. The match ends when its time is up, or when a
//   module says someone won (`win`).
//
// Squads (Phase 4): every body has a squad; in a solo mode each is its own.
// Places and the winner go by squad, and squadmates can't hit each other.
//
// The online client keeps a MIRROR of the match (`mirror: true`): built from
// the same seed and world, so everything the seed decides (the zone's
// circles, the scatter, the props) is already the same. It never decides
// anything: bodies come from snapshots, and what happens arrives as the
// server's events (`applyRemote`), which each module applies to its state.
//
// What a player mustn't know ahead — where Find the Flag's flag is hidden,
// the zone's next circles, where a crate or a drop zone will come down —
// comes from a second, SECRET seed (`secretRng`) only the server has. The
// copy learns it from the events, when everyone does.

import { DEFAULT_COURSE, MOVE, RESPAWN, RULES, type Stance } from "../../config";
import type { ModeDef, ModuleId } from "../../content/modes";
import { Rng } from "../../core/rng";
import type { BoostMods } from "../../shop/boosts";
import { makeModules } from "../modules";
import type { ZoneModule } from "../modules/zone";
import { freshMotion, moveContestant, NORMAL_ENV, setBoosts, type Cause, type Contestant, type MoveEnv } from "./body";
import type { MatchEvent, MatchPhase, RuleModule } from "./module";
import { reachOf, type Reach } from "./reach";
import type { CourtRoom } from "../../maps/open/prefabs";
import type { Space } from "./space";

/** The world a match is played in: its solids, its starts and the places worth finding. */
export interface MatchWorld {
  readonly space: Space;
  readonly spawns: readonly (readonly [number, number])[];
  readonly places: readonly { x: number; z: number; r: number }[];
  /** Find the Flag's stash spots: inside a danfo, a water tank, under a stall … */
  readonly stash?: readonly { x: number; z: number; h: number }[];
  /** Squad Rally's route: down the middle of the main roads, a loop. */
  readonly route?: readonly (readonly [number, number])[];
  /** The roads (vehicles start on them, and a Danfo Key calls one to the nearest). */
  readonly roads?: readonly { x0: number; z0: number; x1: number; z1: number; w: number }[];
  /** The fuel boys' stands by the roadside (a car stopped beside one gets a top-up, once a match each). */
  readonly fuel?: readonly { x: number; z: number; rot: number }[];
  /** Compound Wars: the courtyard's rooms and their doorways. */
  readonly rooms?: readonly CourtRoom[];
  /** The named places (landmarks and areas) by id: Riddles of the Elders' answers. */
  readonly named?: readonly { id: string; x: number; z: number; r: number }[];
  /** The street generators (Lights Out: they run in a power cut, light what's near, and shock what touches them). */
  readonly generators?: readonly { x: number; z: number }[];
  /** A mode played on part of the world (the Flag Duel): that circle is the zone's first. */
  readonly arena?: { x: number; z: number; r: number };
}

/** What a mode asks of the match, after the Ranked overrides and this week's mutator. */
export interface MatchSettings {
  time: number;
  respawn: { on: boolean; delay: number };
  modules: Partial<Record<ModuleId, Record<string, unknown>>>;
  /** This week's mutator (SPEC-V3 §10.13), if any. */
  mutator?: Mutator;
}

/** The weekly mutators (§10.13): Juju Day (low gravity), Rainy Season (slippery), Market Day (double items). */
export type Mutator = "juju" | "rainy" | "market";
export const MUTATORS: readonly Mutator[] = ["juju", "rainy", "market"];

/**
 * This week's mutator: none, Market Day, Juju Day, Rainy Season in turn, by
 * the week of the year (UTC). The server says which in a match's start, so a
 * phone's copy plays the same week.
 */
export function weeklyMutator(ms: number): Mutator | undefined {
  const week = Math.floor((ms / 86_400_000 + 3) / 7);
  return ([undefined, "market", "juju", "rainy"] as const)[((week % 4) + 4) % 4];
}

/** How a mutator changes the ground and the air. */
export function envOf(mu: Mutator | undefined): MoveEnv {
  return mu === "juju" ? { grav: 0.55, slip: 1 } : mu === "rainy" ? { grav: 1, slip: 0.45 } : NORMAL_ENV;
}

/** A mode's settings, Ranked or not ("module.key" overrides; "respawn.on"). */
export function settingsOf(def: Pick<ModeDef, "time" | "respawn" | "modules" | "ranked">, ranked = false, mutator?: Mutator): MatchSettings {
  const modules = JSON.parse(JSON.stringify(def.modules)) as MatchSettings["modules"];
  const respawn = { on: def.respawn.on, delay: def.respawn.delay ?? 6 };
  if (ranked) {
    for (const [path, v] of Object.entries(def.ranked ?? {})) {
      const [head, key] = path.split(".");
      if (head === "respawn" && key === "on") respawn.on = v === true;
      else {
        const mod = modules[head as ModuleId];
        if (mod) mod[key] = v;
      }
    }
  }
  // Market Day: twice the items on the ground.
  if (mutator === "market" && modules.items) modules.items = { ...modules.items, density: Math.min(2, Number(modules.items.density ?? 1) * 2) };
  return { time: def.time, respawn, modules, ...(mutator ? { mutator } : {}) };
}

export interface MatchOptions {
  seed: number;
  /** squad: a squad number (squadmates share it); missing, each body is its own squad. */
  contestants: { id: string; name: string; bot: boolean; boosts?: readonly string[]; squad?: number }[];
  world: MatchWorld;
  settings: MatchSettings;
  /** Seconds of walkout before the countdown; 0 or missing: none. */
  walkout?: number;
  /** Seconds of countdown (RULES.countdown). */
  countdown?: number;
  /** The online client's copy: decides nothing (see the header). */
  mirror?: boolean;
  /** The server's own seed for hidden things (missing: the match seed, for tests and Solo). */
  secret?: number;
}

/** A body's standing at the end (or now): place 1 is best; squads share theirs. */
export interface Standing {
  id: string;
  squad: number;
  place: number;
  objective: number;
  won: boolean;
}

/** A name → a 32-bit salt (FNV-1a), so each stream is fixed by its name. */
function salt(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface Effect {
  until: number;
  v: number;
}

export class Match {
  phase: MatchPhase = "countdown";
  phaseTime = 0;
  phaseDuration: number;
  /** Seconds of play. */
  elapsed = 0;
  readonly seed: number;
  readonly world: MatchWorld;
  readonly settings: MatchSettings;
  readonly contestants: Contestant[];
  readonly modules: RuleModule[];
  /** Modules the mode names that this build can't run (the mode shouldn't have been offered). */
  readonly missing: ModuleId[];
  /** Each body's squad. */
  readonly squads: number[];
  readonly mirror: boolean;
  private readonly secret: number;
  /** Who won, once someone has (squad −1: nobody, a draw or the time ran out). */
  winner: { id: string | null; squad: number } | null = null;

  private readonly byId = new Map<string, Contestant>();
  private readonly byModule = new Map<string, RuleModule>();
  private events: MatchEvent[] = [];
  private reachGrid: Reach | null = null;
  // The open-world buttons, per body: interact (a counter, and held), the backpack (a counter).
  private readonly inInteract: number[];
  private readonly interactSeen: number[];
  private readonly inHold: boolean[];
  private readonly inPack: number[];
  private readonly packSeen: number[];
  private readonly inBrace: boolean[];
  /** This step's speed share from the modules (a brace, a flag), reset every step. */
  private readonly mul: number[];
  private readonly slowed: BoostMods[];
  private readonly fx: Map<string, Effect>[];
  private readonly base: BoostMods[];
  private readonly fast: (BoostMods | null)[];
  private readonly respawnAt: number[];
  private readonly respawnRng: Rng;
  /** The ground and the air (this week's mutator). */
  readonly env: MoveEnv;
  /** The car each body sits in (vehicles), or −1. */
  private readonly seats: Int16Array;

  constructor(opts: MatchOptions) {
    this.seed = opts.seed;
    this.world = opts.world;
    this.settings = opts.settings;
    this.mirror = opts.mirror === true;
    this.secret = (opts.secret ?? opts.seed) >>> 0;
    const n = opts.contestants.length;
    const spawnRng = this.rng("spawns");
    this.respawnRng = this.rng("respawns");
    const spots = spawnRng.shuffle(opts.world.spawns.map((s) => [s[0], s[1]] as [number, number]));
    const b = opts.world.space.bounds;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    this.contestants = opts.contestants.map((p, index) => {
      // More players than starts: the extras stand a few metres round one.
      const [sx, sz] = spots.length ? spots[index % spots.length] : [cx, cz];
      const ring = spots.length ? Math.floor(index / spots.length) : index;
      const x = sx + (ring ? Math.cos(ring * 2.4) * 2.5 : 0);
      const z = sz + (ring ? Math.sin(ring * 2.4) * 2.5 : 0);
      const c: Contestant = {
        id: p.id,
        name: p.name,
        bot: p.bot,
        index,
        x,
        z,
        vx: 0,
        vz: 0,
        heading: Math.atan2(cx - x, cz - z),
        status: "alive",
        finishTime: -1,
        place: 0,
        eliminatedAt: -1,
        cause: null,
        inX: 0,
        inZ: 0,
        progress: 0,
        graceBonus: 0,
        ...freshMotion(),
      };
      setBoosts(c, p.boosts);
      c.h = opts.world.space.floorAt(x, z, 0).h;
      this.byId.set(p.id, c);
      return c;
    });
    this.inInteract = new Array(n).fill(0);
    this.interactSeen = new Array(n).fill(0);
    this.inHold = new Array(n).fill(false);
    this.inPack = new Array(n).fill(0);
    this.packSeen = new Array(n).fill(0);
    this.inBrace = new Array(n).fill(false);
    this.mul = new Array(n).fill(1);
    this.slowed = this.contestants.map((c) => ({ ...c.bst }));
    this.squads = opts.contestants.map((p, i) => (Number.isInteger(p.squad) && (p.squad as number) >= 0 ? (p.squad as number) : 1000 + i));
    this.fx = Array.from({ length: n }, () => new Map());
    this.base = this.contestants.map((c) => c.bst);
    this.fast = new Array(n).fill(null);
    this.respawnAt = new Array(n).fill(-1);
    this.seats = new Int16Array(n).fill(-1);
    this.env = envOf(opts.settings.mutator);

    this.modules = makeModules(opts.settings.modules);
    for (const m of this.modules) this.byModule.set(m.id, m);
    this.missing = (Object.keys(opts.settings.modules) as ModuleId[]).filter((id) => !this.byModule.has(id));

    const walkout = opts.walkout ?? 0;
    if (walkout > 0) {
      this.phase = "walkout";
      this.phaseDuration = walkout;
    } else this.phaseDuration = opts.countdown ?? RULES.countdown;
    this.events.push({ type: "phase", phase: this.phase, duration: this.phaseDuration });
    for (const m of this.modules) m.init?.(this);
  }

  /** A seeded stream of its own for `name` (a module, the spawns). */
  rng(name: string): Rng {
    return new Rng((this.seed ^ salt(name)) >>> 0);
  }

  /** A stream for hidden things, from the server's secret seed (never used by the copy). */
  secretRng(name: string): Rng {
    return new Rng((this.secret ^ salt(name)) >>> 0);
  }

  /** Where bodies can walk (built on first use, then shared by every match on this world). */
  get reach(): Reach {
    if (!this.reachGrid) {
      const s = this.world.spawns[0] ?? [0, 0];
      this.reachGrid = reachOf(this.world.space, s);
    }
    return this.reachGrid;
  }

  module<T extends RuleModule>(id: ModuleId): T | null {
    return (this.byModule.get(id) as T | undefined) ?? null;
  }

  get over(): boolean {
    return this.phase === "ended";
  }

  get timeLeft(): number {
    return Math.max(0, this.settings.time - this.elapsed);
  }

  get aliveCount(): number {
    let n = 0;
    for (const c of this.contestants) if (c.status === "alive") n++;
    return n;
  }

  get(id: string): Contestant | undefined {
    return this.byId.get(id);
  }

  /** Two different bodies on the same squad. */
  sameSquad(a: Contestant, b: Contestant): boolean {
    return a !== b && this.squads[a.index] === this.squads[b.index];
  }

  /** In a car (vehicles): the car moves them, nothing else does, and nobody can hit them. */
  seated(c: Contestant): boolean {
    return this.seats[c.index] >= 0;
  }

  seatOf(c: Contestant): number {
    return this.seats[c.index];
  }

  /** Into car `car` (vehicles only), or out (−1). */
  setSeat(c: Contestant, car: number): void {
    this.seats[c.index] = car;
  }

  /** Bodies per squad number. */
  squadSizes(): Map<number, number> {
    const out = new Map<number, number>();
    for (const q of this.squads) out.set(q, (out.get(q) ?? 0) + 1);
    return out;
  }

  // ── Input (the same counters as the Red Light, Green Light referee, plus the open world's) ──

  setInput(id: string, x: number, z: number): void {
    const c = this.byId.get(id);
    if (!c) return;
    const len = Math.hypot(x, z);
    if (!isFinite(len)) return;
    const k = len > 1 ? 1 / len : 1;
    c.inX = x * k;
    c.inZ = z * k;
  }

  setButtons(id: string, sprint: boolean, stance: Stance, jump: number): void {
    const c = this.byId.get(id);
    if (!c) return;
    c.inSprint = !!sprint;
    c.inStance = stance === 1 || stance === 2 ? stance : 0;
    if (Number.isInteger(jump)) c.inJump = jump & 255;
  }

  setActions(id: string, attack: number, grab: number): void {
    const c = this.byId.get(id);
    if (!c) return;
    if (Number.isInteger(attack)) c.inAttack = attack & 255;
    if (Number.isInteger(grab)) c.inGrab = grab & 255;
  }

  /** Interact: `press` counts taps (pick up, loot); `hold` is the button held (open a crate). */
  setInteract(id: string, press: number, hold: boolean): void {
    const c = this.byId.get(id);
    if (!c || !Number.isInteger(press)) return;
    this.inInteract[c.index] = press & 255;
    this.inHold[c.index] = !!hold;
  }

  /** The backpack: act = (counter << 5) | (16 to drop, 0 to use) | slot. A change is one request. */
  setPack(id: string, act: number): void {
    const c = this.byId.get(id);
    if (!c || !Number.isInteger(act)) return;
    this.inPack[c.index] = act & 0x3fff;
  }

  /** A new interact tap from c since the last call (each tap counts once). */
  takePress(c: Contestant): boolean {
    const i = c.index;
    if (this.inInteract[i] === this.interactSeen[i]) return false;
    this.interactSeen[i] = this.inInteract[i];
    return true;
  }

  holding(c: Contestant): boolean {
    return this.inHold[c.index];
  }

  /** Brace (melee): held. */
  setBrace(id: string, on: boolean): void {
    const c = this.byId.get(id);
    if (c) this.inBrace[c.index] = !!on;
  }

  braced(c: Contestant): boolean {
    return this.inBrace[c.index];
  }

  /** A module slows c this step (×k on run and sprint): a brace, a flag carried, a clinch. */
  slow(c: Contestant, k: number): void {
    this.mul[c.index] *= k;
  }

  /** A new backpack request from c (its low 5 bits), or −1. */
  takePackAct(c: Contestant): number {
    const i = c.index;
    if (this.inPack[i] === this.packSeen[i]) return -1;
    this.packSeen[i] = this.inPack[i];
    return this.inPack[i] & 31;
  }

  // ── Effects: timed states an item or a hazard puts on a body ──

  /** Seconds left of `key` on c (0: none). */
  effect(c: Contestant, key: string): number {
    const e = this.fx[c.index].get(key);
    return e ? Math.max(0, e.until - this.elapsed) : 0;
  }

  effectValue(c: Contestant, key: string): number {
    return this.fx[c.index].get(key)?.v ?? 0;
  }

  setEffect(c: Contestant, key: string, seconds: number, v = 1): void {
    this.fx[c.index].set(key, { until: this.elapsed + seconds, v });
    if (key === "speed") {
      const b = this.base[c.index];
      this.fast[c.index] = { ...b, speed: b.speed * v, sprint: b.sprint * v };
    }
  }

  /** Every effect on c with seconds left (the HUD's chips). */
  effects(c: Contestant): { key: string; left: number }[] {
    const out: { key: string; left: number }[] = [];
    for (const [key, e] of this.fx[c.index]) if (e.until > this.elapsed) out.push({ key, left: e.until - this.elapsed });
    return out;
  }

  // ── Events ──

  /** Queue an event, and let every module react to it now. */
  emit(e: MatchEvent): void {
    this.events.push(e);
    for (const m of this.modules) m.onEvent?.(this, e);
  }

  drain(): MatchEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ── The clock ──

  step(dt: number): void {
    if (this.phase === "ended") return;
    this.phaseTime += dt;
    if (this.mirror) {
      // The copy: the clock runs (the server's snapshots keep it true); what can be worked out locally is.
      if (this.phase === "play") this.elapsed += dt;
      for (const m of this.modules) m.view?.(this, dt);
      return;
    }
    if (this.phase === "play") {
      this.elapsed += dt;
      for (const m of this.modules) m.pre?.(this, dt);
      this.integrate(dt);
      this.interacts();
      for (const m of this.modules) m.step?.(this, dt);
      this.respawns();
      if (this.elapsed >= this.settings.time && this.phase === "play") {
        for (const m of this.modules) if (!this.winner) m.timeUp?.(this);
        this.end();
      }
      return;
    }
    if (this.phaseTime >= this.phaseDuration) {
      this.phaseTime -= this.phaseDuration;
      if (this.phase === "walkout") this.enter("countdown", RULES.countdown);
      else this.enter("play", this.settings.time);
    }
  }

  private enter(phase: MatchPhase, duration: number): void {
    this.phase = phase;
    this.phaseDuration = duration;
    this.emit({ type: "phase", phase, duration });
  }

  /** The time is up (or a mode's win), once. */
  end(): void {
    if (this.phase === "ended") return;
    this.phase = "ended";
    this.emit({ type: "ended" });
  }

  /** A module's win: someone (and their squad) won; the match ends. Once. */
  win(c: Contestant | null, squad = c ? this.squads[c.index] : -1): void {
    if (this.phase === "ended" || this.winner) return;
    this.winner = { id: c?.id ?? null, squad };
    this.emit({ type: "won", id: c?.id ?? null, squad });
    this.end();
  }

  /** The mode's measure for body i (0 when the mode has none). */
  objective(i: number): number {
    let v = 0;
    for (const m of this.modules) if (m.objective) v += m.objective(this, i);
    return v;
  }

  /**
   * Places: the winner's squad first; then by the mode's measure (squads
   * pooled), then by time alive. Ties share the better place.
   */
  standings(): Standing[] {
    const bySquad = new Map<number, { obj: number; alive: number; members: Contestant[] }>();
    for (const c of this.contestants) {
      const q = this.squads[c.index];
      let e = bySquad.get(q);
      if (!e) bySquad.set(q, (e = { obj: 0, alive: 0, members: [] }));
      e.obj += this.objective(c.index);
      e.alive = Math.max(e.alive, c.status === "alive" ? this.elapsed + 1 : c.eliminatedAt);
      e.members.push(c);
    }
    const wq = this.winner?.squad ?? -1;
    const order = [...bySquad.entries()].sort((a, b) => (a[0] === wq ? -1 : b[0] === wq ? 1 : 0) || b[1].obj - a[1].obj || b[1].alive - a[1].alive);
    const out: Standing[] = [];
    let place = 0;
    order.forEach(([q, e], k) => {
      const prev = order[k - 1];
      const tie = prev && q !== wq && prev[0] !== wq && Math.abs(prev[1].obj - e.obj) < 1e-6 && Math.abs(prev[1].alive - e.alive) < 1e-6;
      if (!tie) place = k + 1;
      for (const c of e.members) out.push({ id: c.id, squad: q, place, objective: this.objective(c.index), won: q === wq });
    });
    return out;
  }

  // ── Interact: one tap, to the nearest thing any module offers ──

  private interacts(): void {
    for (const c of this.contestants) {
      if (!this.takePress(c) || c.status !== "alive") continue;
      let best: { d: number; take: () => void } | null = null;
      // In a car, the only thing in reach is the door.
      const seated = this.seated(c);
      for (const m of this.modules) {
        if (seated && m.id !== "vehicles") continue;
        const r = m.reachFor?.(this, c);
        if (r && (!best || r.d < best.d)) best = r;
      }
      best?.take();
    }
  }

  // ── The online client's copy ──

  /**
   * One of the server's events (Match.mirror): the bodies' part here (phases,
   * deaths, comebacks, the end), the rest by each module; then queued for the
   * screen like a local event.
   */
  applyRemote(e: MatchEvent): void {
    switch (e.type) {
      case "phase":
        this.phase = e.phase;
        this.phaseTime = 0;
        this.phaseDuration = e.duration;
        break;
      case "eliminated": {
        const c = this.byId.get(e.id);
        if (c && c.status === "alive") {
          c.status = "eliminated";
          c.cause = e.cause;
          c.eliminatedAt = this.elapsed;
          c.vx = c.vz = 0;
          this.fx[c.index].clear();
          if (this.settings.respawn.on) this.respawnAt[c.index] = this.elapsed + this.settings.respawn.delay;
        }
        break;
      }
      case "respawn": {
        const c = this.byId.get(e.id);
        if (c) {
          Object.assign(c, freshMotion(), { bst: this.base[c.index], inJump: c.inJump, jumpSeen: c.inJump, inAttack: c.inAttack, attackSeen: c.inAttack, inGrab: c.inGrab, grabSeen: c.inGrab });
          c.status = "alive";
          c.cause = null;
          c.eliminatedAt = -1;
          c.x = e.x;
          c.z = e.z;
          c.vx = c.vz = 0;
          c.h = this.world.space.floorAt(e.x, e.z, 0).h;
          this.respawnAt[c.index] = -1;
        }
        break;
      }
      case "won":
        this.winner = { id: e.id, squad: e.squad };
        break;
      case "ended":
        this.phase = "ended";
        break;
    }
    for (const m of this.modules) m.apply?.(this, e);
    this.events.push(e);
  }

  private integrate(dt: number): void {
    const space = this.world.space;
    const melee = this.byModule.has("melee");
    for (const c of this.contestants) {
      const i = c.index;
      // Without melee a swing is ignored, never queued.
      if (!melee) {
        c.attackSeen = c.inAttack;
        c.grabSeen = c.inGrab;
      }
      const k = this.mul[i];
      this.mul[i] = 1;
      if (c.status !== "alive" || this.seats[i] >= 0) continue;
      this.move(c, dt, k, space);
    }
    this.separate();
  }

  /**
   * The online client's own body, moved as the server will move it (a phone
   * predicts only itself; Match.mirror). `k`: the speed share the modules
   * would give it this step (a brace, a flag held, a clinch).
   */
  predict(c: Contestant, dt: number, k = 1): void {
    if (c.status === "alive" && this.seats[c.index] < 0) this.move(c, dt, k, this.world.space);
  }

  private move(c: Contestant, dt: number, k: number, space: Space): void {
    const i = c.index;
    const fast = this.fast[i];
    const src = fast && this.effect(c, "speed") > 0 ? fast : this.base[i];
    if (k !== 1) {
      const s = Object.assign(this.slowed[i], src);
      s.speed = src.speed * k;
      s.sprint = src.sprint * k;
      c.bst = s;
    } else c.bst = src;
    moveContestant(c, dt, DEFAULT_COURSE, space, this.env);
  }

  private readonly sepCells = new Map<number, number[]>();
  /** The buckets filled last step: only these are emptied (the map keeps every cell ever visited otherwise). */
  private readonly sepUsed: number[][] = [];
  private readonly sepPushed: boolean[] = [];

  /**
   * Keep bodies from overlapping, on a spatial hash (1 m cells): only bodies
   * in neighbouring cells, at about the same height, are compared. As in Red
   * Light, Green Light, a bump moves positions only, never velocities.
   */
  private separate(): void {
    const list = this.contestants;
    const min = MOVE.radius * 2;
    const cells = this.sepCells;
    for (const b of this.sepUsed) b.length = 0;
    this.sepUsed.length = 0;
    // A long match wanders over thousands of cells: start the map afresh now and then.
    if (cells.size > 4096) cells.clear();
    const key = (q: number, r: number) => (q + 2048) * 4096 + (r + 2048);
    for (const c of list) {
      if (c.status !== "alive" || this.seats[c.index] >= 0) continue;
      const k = key(Math.floor(c.x), Math.floor(c.z));
      let b = cells.get(k);
      if (!b) cells.set(k, (b = []));
      if (!b.length) this.sepUsed.push(b);
      b.push(c.index);
    }
    const pushed = this.sepPushed;
    pushed.length = list.length;
    pushed.fill(false);
    for (const a of list) {
      if (a.status !== "alive" || this.seats[a.index] >= 0) continue;
      const q = Math.floor(a.x);
      const r = Math.floor(a.z);
      for (let dq = -1; dq <= 1; dq++) {
        for (let dr = -1; dr <= 1; dr++) {
          const bucket = cells.get(key(q + dq, r + dr));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= a.index) continue;
            const b = list[j];
            if (Math.abs(a.h + a.y - (b.h + b.y)) > 1.4) continue;
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const d2 = dx * dx + dz * dz;
            if (d2 >= min * min || d2 < 1e-8) continue;
            const d = Math.sqrt(d2);
            const push = (min - d) / 2;
            a.x -= (dx / d) * push;
            a.z -= (dz / d) * push;
            b.x += (dx / d) * push;
            b.z += (dz / d) * push;
            pushed[a.index] = pushed[j] = true;
          }
        }
      }
    }
    // A bump never puts anyone inside a wall.
    for (const c of list) if (pushed[c.index]) this.world.space.resolve(c, MOVE.radius);
  }

  // ── Death and coming back ──

  eliminate(c: Contestant, cause: Cause): void {
    if (c.status !== "alive") return;
    c.status = "eliminated";
    c.cause = cause;
    c.eliminatedAt = this.elapsed;
    c.vx = c.vz = 0;
    c.inX = c.inZ = 0;
    c.inSprint = c.sprinting = false;
    this.fx[c.index].clear();
    if (this.settings.respawn.on) this.respawnAt[c.index] = this.elapsed + this.settings.respawn.delay;
    this.emit({ type: "eliminated", id: c.id, cause, x: c.x, z: c.z, h: c.h });
  }

  /** Seconds until c comes back (−1: not coming back, or alive). */
  respawnIn(c: Contestant): number {
    const at = this.respawnAt[c.index];
    return at < 0 ? -1 : Math.max(0, at - this.elapsed);
  }

  private respawns(): void {
    for (const c of this.contestants) {
      const at = this.respawnAt[c.index];
      if (at < 0 || this.elapsed < at) continue;
      this.respawnAt[c.index] = -1;
      this.respawn(c);
    }
  }

  /**
   * Back in, somewhere safe: a start or open ground inside the zone, as far
   * from everyone else as can be found.
   */
  private respawn(c: Contestant): void {
    const zone = this.module<ZoneModule>("zone");
    const circle = zone ? zone.safe() : null;
    const rng = this.respawnRng;
    const reach = this.reach;
    const cands: [number, number][] = this.world.spawns.map((s) => [s[0], s[1]]);
    for (let t = 0; t < 24 && reach.open.length; t++) {
      if (circle) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * circle.r * 0.85;
        const cell = reach.cell(circle.x + Math.cos(a) * d, circle.z + Math.sin(a) * d);
        if (cell >= 0 && reach.ground[cell]) cands.push(reach.centre(cell));
      } else cands.push(reach.centre(reach.open[rng.int(0, reach.open.length - 1)]));
    }
    let best: [number, number] | null = null;
    let bestScore = -Infinity;
    for (const [x, z] of cands) {
      const inside = !circle || Math.hypot(x - circle.x, z - circle.z) <= circle.r * 0.9;
      let clear = RESPAWN.clear * 4;
      for (const o of this.contestants) if (o !== c && o.status === "alive") clear = Math.min(clear, Math.hypot(o.x - x, o.z - z));
      // Inside the zone first; then the most room, up to a point (past it, any is as good).
      const score = (inside ? 1000 : 0) + Math.min(clear, RESPAWN.clear * 2);
      if (score > bestScore) {
        bestScore = score;
        best = [x, z];
      }
    }
    const [x, z] = best ?? [c.x, c.z];
    // Fresh movement, but the input counters carry on (a repeat must not jump or swing).
    this.inBrace[c.index] = false;
    const keep = { bst: this.base[c.index], grip: c.grip, inJump: c.inJump, inAttack: c.inAttack, inGrab: c.inGrab };
    Object.assign(c, freshMotion(), keep, { jumpSeen: keep.inJump, attackSeen: keep.inAttack, grabSeen: keep.inGrab });
    c.status = "alive";
    c.cause = null;
    c.eliminatedAt = -1;
    c.x = x;
    c.z = z;
    c.vx = c.vz = 0;
    c.h = this.world.space.floorAt(x, z, 0).h;
    if (circle) c.heading = Math.atan2(circle.x - x, circle.z - z);
    this.emit({ type: "respawn", id: c.id, x, z });
  }
}

/** The modules a match can run in this build (the rest wait for their phases). */
export { MATCH_MODULES } from "../modules";