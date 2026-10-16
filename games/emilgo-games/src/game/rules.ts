// Red Light, Green Light — the referee.
//
// Pure logic: no three.js, no DOM, no clock. It advances only when step(dt) is
// called with a fixed dt, and all randomness comes from the seeded Rng. The
// online server runs THIS file as the authority (games/emilgo-games/server), and the
// client uses `moveContestant` from it to predict its own runner. Two copies of
// the rules would drift.
//
// The cycle:   countdown → sing → (pause → sing)? → turning → watch → turningBack → sing → …
//   sing         doll faces the wall, song plays. Move freely. She cuts it anywhere.
//   pause        a feint: the song stopped but she isn't turning. Still safe.
//   turning      she is turning round. Still safe — stop NOW.
//   watch        she is looking. After `grace`, any speed > tolerance = out.
//   turningBack  she turns to the wall again. Safe to set off early.
// The round ends when nobody is still running, or time is up (everyone still
// on the field is eliminated).

import { FIELD, MOVE, RULES, type SingBands, type Stance } from "../config";
import { Rng } from "../core/rng";

export type Phase = "countdown" | "sing" | "pause" | "turning" | "watch" | "turningBack" | "ended";
export type Status = "alive" | "finished" | "eliminated";
export type Cause = "moved" | "time";

export interface Contestant {
  readonly id: string;
  readonly name: string;
  readonly bot: boolean;
  readonly index: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing angle: the body faces (sin h, cos h) in x/z. */
  heading: number;
  status: Status;
  /** Seconds of play when they crossed, or -1. */
  finishTime: number;
  place: number;
  /** Seconds of play when they were caught, or -1. */
  eliminatedAt: number;
  cause: Cause | null;
  /** Requested movement in WORLD space, length 0..1 (1 = full run). */
  inX: number;
  inZ: number;
  /** Height above the street (jumping) and vertical speed. */
  y: number;
  vy: number;
  /** Current stance (0 stand, 1 crouch, 2 prone) and the one asked for. */
  stance: Stance;
  inStance: Stance;
  /** Seconds left of a stance change in progress (counts as moving). */
  stanceT: number;
  /** Sprint held, and whether actually sprinting now. */
  inSprint: boolean;
  sprinting: boolean;
  /** 0..1. Sprinting spends it; it refills after a short rest. */
  stamina: number;
  /** Seconds since the last sprint (refill delay). */
  rested: number;
  /** Jump requests: a counter, so a repeated or lost message can't double or drop one. */
  inJump: number;
  jumpSeen: number;
  /** Furthest distance past the start line, metres. */
  progress: number;
  /**
   * Extra seconds before movement counts against THIS contestant once she is
   * watching. Online, the server sets it to the player's measured round trip
   * (capped): they saw her turn late and their "stop" arrived late, so they get
   * exactly that time back. Always 0 offline.
   */
  graceBonus: number;
}

/**
 * What the session reads from a round. The local referee implements it for
 * practice; the online client implements it from the server's snapshots.
 */
export interface RoundView {
  readonly phase: Phase;
  readonly phaseTime: number;
  readonly phaseDuration: number;
  readonly elapsed: number;
  readonly contestants: Contestant[];
  readonly timeLeft: number;
  readonly aliveCount: number;
  get(id: string): Contestant | undefined;
  setInput(id: string, x: number, z: number): void;
  /** Buttons: sprint held, the stance wanted, and the jump counter. */
  setButtons(id: string, sprint: boolean, stance: Stance, jump: number): void;
  step(dt: number): void;
  drain(): RoundEvent[];
}

export const PHASES: readonly Phase[] = ["countdown", "sing", "pause", "turning", "watch", "turningBack", "ended"];

/**
 * Phases whose length is a secret. The referee knows it; nobody else is told —
 * not the HUD, not the network — because knowing when the song ends IS the game.
 */
export const HIDDEN_LENGTH: readonly Phase[] = ["sing", "pause", "watch"];

/** A fresh contestant's movement state (shared by the referee and the online client). */
export function freshMotion(): Pick<Contestant, "y" | "vy" | "stance" | "inStance" | "stanceT" | "inSprint" | "sprinting" | "stamina" | "rested" | "inJump" | "jumpSeen"> {
  return { y: 0, vy: 0, stance: 0, inStance: 0, stanceT: 0, inSprint: false, sprinting: false, stamina: 1, rested: 9, inJump: 0, jumpSeen: 0 };
}

/** Moving, as Mama sees it: on the move, in the air, or changing stance. */
export function isMoving(c: Contestant): boolean {
  return Math.hypot(c.vx, c.vz) > RULES.tolerance || c.y > 0.02 || c.stanceT > 0;
}

/**
 * One contestant's movement for one fixed step: stick and buttons → speed →
 * velocity → position, clamped to the street, facing where they go. Shared by
 * the referee and by the online client's prediction, so both move a runner
 * identically. Finishing, collisions and judging are NOT here — only the
 * referee does those.
 */
export function moveContestant(c: Contestant, dt: number): void {
  if (c.status === "eliminated") return;

  let ix = c.inX;
  let iz = c.inZ;
  let wantStance = c.inStance;
  let wantSprint = c.inSprint;
  if (c.status === "finished") {
    // Walk on into the safe zone, then stand still. Input is ignored.
    ix = 0;
    iz = c.z > FIELD.safeZ ? -0.5 : 0;
    wantStance = 0;
    wantSprint = false;
    c.jumpSeen = c.inJump;
  }
  const grounded = c.y <= 0 && c.vy <= 0;

  // ── Stance: one step at a time (prone ↔ crouch ↔ stand), never in the air ──
  if (c.stanceT > 0) c.stanceT = Math.max(0, c.stanceT - dt);
  if (c.stanceT === 0 && grounded && wantStance !== c.stance) {
    c.stance = (c.stance + (wantStance > c.stance ? 1 : -1)) as Stance;
    c.stanceT = MOVE.stanceTime;
  }

  // ── Jump: standing, on the ground, once per request ──
  if (c.inJump !== c.jumpSeen) {
    c.jumpSeen = c.inJump;
    if (grounded && c.stance === 0 && c.stanceT === 0) c.vy = Math.sqrt(2 * MOVE.gravity * MOVE.jumpHeight);
  }
  if (c.y > 0 || c.vy > 0) {
    // Exact for constant gravity, so the peak is the same at any step size.
    c.y += c.vy * dt - 0.5 * MOVE.gravity * dt * dt;
    c.vy -= MOVE.gravity * dt;
    if (c.y <= 0) {
      c.y = 0;
      c.vy = 0;
    }
  }

  // ── Speed from the stick, the stance and the sprint ──
  const m = Math.hypot(ix, iz);
  let top: number = c.stance === 2 ? MOVE.prone : c.stance === 1 ? MOVE.crouch : m < MOVE.runAt ? MOVE.walk * (m / MOVE.runAt) : MOVE.run;
  if (c.stance === 0 && m >= MOVE.runAt) {
    const can = c.sprinting ? c.stamina > 0 : c.stamina >= MOVE.sprintMin;
    c.sprinting = wantSprint && can;
    if (c.sprinting) top = MOVE.sprint;
  } else {
    c.sprinting = false;
  }
  if (c.stance > 0 && m > 1e-3) top *= Math.min(1, m / MOVE.runAt + 0.3);
  if (c.sprinting) {
    c.stamina = Math.max(0, c.stamina - dt / MOVE.sprintFor);
    c.rested = 0;
  } else {
    c.rested += dt;
    if (c.rested >= MOVE.refillDelay) c.stamina = Math.min(1, c.stamina + dt / MOVE.refillIn);
  }
  const speed = m < 1e-3 ? 0 : top;
  const tx = m < 1e-3 ? 0 : (ix / m) * speed;
  const tz = m < 1e-3 ? 0 : (iz / m) * speed;

  let dvx = tx - c.vx;
  let dvz = tz - c.vz;
  const dv = Math.hypot(dvx, dvz);
  const current = Math.hypot(c.vx, c.vz);
  const rate = (c.y > 0 ? MOVE.airAccel : speed >= current ? MOVE.accel : MOVE.decel) * dt;
  if (dv > rate) {
    dvx *= rate / dv;
    dvz *= rate / dv;
  }
  c.vx += dvx;
  c.vz += dvz;
  if (Math.hypot(c.vx, c.vz) < 1e-3) {
    c.vx = 0;
    c.vz = 0;
  }

  c.x += c.vx * dt;
  c.z += c.vz * dt;
  clampToField(c);

  // Face where you are going; keep the last facing when standing still.
  const sp = Math.hypot(c.vx, c.vz);
  if (sp > 0.3) {
    const want = Math.atan2(c.vx, c.vz);
    let d = want - c.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const maxTurn = MOVE.turnRate * dt;
    c.heading += Math.max(-maxTurn, Math.min(maxTurn, d));
  }

  c.progress = Math.max(c.progress, FIELD.startZ - c.z);
}

export function clampToField(c: Contestant): void {
  const lim = FIELD.halfWidth - MOVE.radius;
  if (c.x > lim) { c.x = lim; c.vx = Math.min(0, c.vx); }
  if (c.x < -lim) { c.x = -lim; c.vx = Math.max(0, c.vx); }
  if (c.z > FIELD.backLimitZ) { c.z = FIELD.backLimitZ; c.vz = Math.min(0, c.vz); }
  if (c.z < FIELD.safeZ - 2) { c.z = FIELD.safeZ - 2; c.vz = Math.max(0, c.vz); }
}

export type RoundEvent =
  | { type: "phase"; phase: Phase; duration: number }
  | { type: "eliminated"; id: string; cause: Cause }
  | { type: "finished"; id: string; time: number; place: number }
  | { type: "ended" };

export interface RoundOptions {
  seed: number;
  contestants: { id: string; name: string; bot: boolean }[];
  /** Whose spot is front and centre (the local player in practice). */
  featuredId?: string;
}

export class RedLightRound implements RoundView {
  phase: Phase = "countdown";
  phaseTime = 0;
  phaseDuration: number = RULES.countdown;
  /** Seconds of play, excluding the countdown. */
  elapsed = 0;
  /** Completed sing phases. */
  cycle = 0;
  readonly contestants: Contestant[];
  readonly seed: number;

  private readonly rng: Rng;
  private readonly byId = new Map<string, Contestant>();
  private events: RoundEvent[] = [];
  private finishedCount = 0;
  private turns = 0;

  constructor(opts: RoundOptions) {
    this.seed = opts.seed;
    this.rng = new Rng(opts.seed);

    // Spawn on a staggered grid behind the start line. The featured contestant
    // gets the centre front slot; everyone else is shuffled into the rest.
    const n = opts.contestants.length;
    const cols = Math.min(6, n);
    const rows = Math.ceil(n / cols);
    const slots: { x: number; z: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = cols === 1 ? 0.5 : c / (cols - 1);
        const x = (t - 0.5) * 2 * (FIELD.halfWidth - 1.4) + (r % 2 ? 0.7 : -0.7);
        const z = FIELD.spawnNearZ + (rows === 1 ? 0 : (r / (rows - 1)) * (FIELD.spawnFarZ - FIELD.spawnNearZ));
        slots.push({ x, z });
      }
    }
    slots.sort((a, b) => a.z - b.z || Math.abs(a.x) - Math.abs(b.x));
    const front = slots.shift()!;
    this.rng.shuffle(slots);

    // Nobody featured (online rounds): the first contestant takes the front slot,
    // so every slot is used exactly once and nobody starts on someone else.
    const featured = opts.featuredId ?? opts.contestants[0]?.id;
    let slotIdx = 0;
    this.contestants = opts.contestants.map((c, index) => {
      const s = c.id === featured ? front : slots[slotIdx++] ?? front;
      const jitter = () => this.rng.range(-0.25, 0.25);
      const contestant: Contestant = {
        id: c.id,
        name: c.name,
        bot: c.bot,
        index,
        x: s.x + jitter(),
        z: s.z + jitter(),
        vx: 0,
        vz: 0,
        heading: Math.PI, // facing -Z, towards the doll
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
      this.byId.set(c.id, contestant);
      return contestant;
    });

    this.events.push({ type: "phase", phase: "countdown", duration: RULES.countdown });
  }

  /** Read through a getter: TypeScript can't see that advance() changes `phase`. */
  get over(): boolean {
    return this.phase === "ended";
  }

  get timeLeft(): number {
    return Math.max(0, RULES.timeLimit - this.elapsed);
  }

  get aliveCount(): number {
    let n = 0;
    for (const c of this.contestants) if (c.status === "alive") n++;
    return n;
  }

  /** Detection is live: she is looking and the grace period is over. */
  get detecting(): boolean {
    return this.phase === "watch" && this.phaseTime >= RULES.grace;
  }

  get(id: string): Contestant | undefined {
    return this.byId.get(id);
  }

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

  /** Events since the last drain, oldest first. */
  drain(): RoundEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  step(dt: number): void {
    if (this.phase === "ended") return;

    this.phaseTime += dt;

    if (this.phase !== "countdown") {
      this.elapsed += dt;
      this.integrate(dt);
      this.detect();
      if (this.elapsed >= RULES.timeLimit) {
        this.timeUp();
        return;
      }
    }

    // A long frame can span more than one short phase; loop until caught up.
    let guard = 0;
    while (!this.over && this.phaseTime >= this.phaseDuration && guard++ < 4) {
      this.phaseTime -= this.phaseDuration;
      this.advance();
    }

    if (!this.over && this.phase !== "countdown" && this.aliveCount === 0) {
      this.enter("ended", 0);
      this.events.push({ type: "ended" });
    }
  }

  // ── Phases ────────────────────────────────────────────────────────────────

  private advance(): void {
    switch (this.phase) {
      case "countdown":
        this.enter("sing", this.singLength(RULES.firstSing));
        break;
      case "sing": {
        // A feint, sometimes — but never before she has turned for real once,
        // and never twice running (the previous phase being a pause).
        const feint = this.turns > 0 && !this.justFeinted && this.rng.chance(RULES.feint.chance);
        this.justFeinted = false;
        if (feint) {
          this.justFeinted = true;
          this.enter("pause", this.rng.range(RULES.feint.min, RULES.feint.max));
        } else {
          this.cycle++;
          this.turns++;
          this.enter("turning", this.rng.range(RULES.turning.min, RULES.turning.max));
        }
        break;
      }
      case "pause":
        // She sings on from where she stopped.
        this.enter("sing", this.singLength(this.timeLeft <= RULES.lateAt ? RULES.singLate : RULES.sing));
        break;
      case "turning":
        this.enter("watch", this.rng.range(RULES.watch.min, RULES.watch.max));
        break;
      case "watch":
        this.enter("turningBack", RULES.turningBack);
        break;
      case "turningBack":
        this.enter("sing", this.singLength(this.timeLeft <= RULES.lateAt ? RULES.singLate : RULES.sing));
        break;
      default:
        break;
    }
  }

  private justFeinted = false;

  /** Weighted band, then uniform inside it: lengths cluster unpredictably. */
  private singLength(b: SingBands): number {
    let r = this.rng.next();
    for (let i = 0; i < b.bands.length; i++) {
      r -= b.weights[i];
      if (r <= 0 || i === b.bands.length - 1) return this.rng.range(b.bands[i][0], b.bands[i][1]);
    }
    return this.rng.range(b.bands[0][0], b.bands[0][1]);
  }

  private enter(phase: Phase, duration: number): void {
    this.phase = phase;
    this.phaseDuration = duration;
    if (phase !== "ended") this.events.push({ type: "phase", phase, duration });
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  private integrate(dt: number): void {
    for (const c of this.contestants) {
      if (c.status === "eliminated") continue;
      moveContestant(c, dt);

      if (c.status === "alive" && c.z <= FIELD.finishZ) {
        c.status = "finished";
        c.finishTime = this.elapsed;
        c.place = ++this.finishedCount;
        this.events.push({ type: "finished", id: c.id, time: c.finishTime, place: c.place });
      }
    }
    this.separate();
  }

  /**
   * Keep bodies from overlapping. Pushing changes position only, never
   * velocity, so being bumped while frozen cannot get you eliminated — the
   * one doing the pushing is the one moving.
   */
  private separate(): void {
    const list = this.contestants;
    const min = MOVE.radius * 2;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.status === "eliminated") continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.status === "eliminated") continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
    }
  }

  // ── Judging ───────────────────────────────────────────────────────────────

  private detect(): void {
    if (!this.detecting) return;
    for (const c of this.contestants) {
      if (c.status !== "alive") continue;
      // Each contestant's own grace: the base, plus their network allowance.
      if (this.phaseTime < RULES.grace + c.graceBonus) continue;
      if (isMoving(c)) this.eliminate(c, "moved");
    }
  }

  private timeUp(): void {
    for (const c of this.contestants) {
      if (c.status === "alive") this.eliminate(c, "time");
    }
    this.enter("ended", 0);
    this.events.push({ type: "ended" });
  }

  private eliminate(c: Contestant, cause: Cause): void {
    c.status = "eliminated";
    c.cause = cause;
    c.eliminatedAt = this.elapsed;
    c.vx = 0;
    c.vz = 0;
    c.inX = 0;
    c.inZ = 0;
    c.inSprint = false;
    c.sprinting = false;
    this.events.push({ type: "eliminated", id: c.id, cause });
  }
}
