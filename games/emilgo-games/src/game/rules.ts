// Red Light, Green Light — the referee.
//
// Pure logic: no three.js, no DOM, no clock. It advances only when step(dt) is
// called with a fixed dt, and all randomness comes from the seeded Rng. The
// online server runs THIS file as the authority (games/emilgo-games/server), and the
// client uses `moveContestant` from it to predict its own runner. Two copies of
// the rules would drift.
//
// The cycle:   countdown → sing → hum → (sing → hum)* → turning → watch → turningBack → sing → …
//   sing         doll faces the wall, song plays. Move freely. She cuts it anywhere.
//   hum          3 s of humming under the song: the warning. Still safe to move.
//                Sometimes it's fake: she sings on and doesn't turn.
//   turning      she is turning round. Still safe — stop NOW.
//   watch        she is looking. After `grace`, any speed > tolerance = out.
//   turningBack  she turns to the wall again. Safe to set off early.
// The round ends when nobody is still running, or time is up (everyone still
// on the field is eliminated).
//
// Modes (SPEC-V2 §2.1): Classic Run — reach the line. Ball Haunting — reach
// it HOLDING a ball (fewer balls than players); the ball goes in a basket and
// you are safe for good. Attacks (fist, slap, push; combat.ts) knock a ball
// loose — only when someone taps an attack button: running into people is
// just a bump. While she watches, an attacker is shot and the one they hit is
// forgiven.

import { ATTACK, ATTACK_KINDS, BALLS, DEFAULT_COURSE, FIELD, MOVE, RULES, ballCount, type AttackKind, type Course, type SingBands, type Stance } from "../config";
import { Rng } from "../core/rng";
import { inPlay, nearestBasket, placeBalls, placeBaskets, type Ball, type Basket } from "./balls";
import { attackTarget, canAttack, knock, type ActKind } from "./combat";

export type Phase = "countdown" | "sing" | "hum" | "turning" | "watch" | "turningBack" | "ended";
export type Status = "alive" | "finished" | "eliminated";
/** moved: caught by the doll; time: the clock ran out; noball: every ball was banked without yours. */
export type Cause = "moved" | "time" | "noball";

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
  /** Attack requests: (counter << 2) | kind (1 fist, 2 slap, 3 push). Grab requests: a counter. */
  inAttack: number;
  attackSeen: number;
  inGrab: number;
  grabSeen: number;
  /** The ball held (index), or −1. */
  ball: number;
  /** Seconds left: stunned (can't steer), forgiven by the doll, mid-action, before attacking again. */
  stun: number;
  forgive: number;
  act: number;
  cool: number;
  /** What the current action is (animation). */
  actKind: ActKind;
  /** Seconds left of a slide (sprint, then crouch). */
  slide: number;
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
  readonly course: Course;
  readonly balls: readonly Ball[];
  readonly baskets: readonly Basket[];
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
  /** Action counters: attack = (n << 2) | kind, grab = n. A change is one request. */
  setActions(id: string, attack: number, grab: number): void;
  step(dt: number): void;
  drain(): RoundEvent[];
}

export const PHASES: readonly Phase[] = ["countdown", "sing", "hum", "turning", "watch", "turningBack", "ended"];

/**
 * Phases whose length is a secret. The referee knows it; nobody else is told —
 * not the HUD, not the network — because knowing when the song ends IS the game.
 */
export const HIDDEN_LENGTH: readonly Phase[] = ["sing", "watch"];

/** A fresh contestant's movement state (shared by the referee and the online client). */
type Motion = "y" | "vy" | "stance" | "inStance" | "stanceT" | "inSprint" | "sprinting" | "stamina" | "rested" | "inJump" | "jumpSeen" | "inAttack" | "attackSeen" | "inGrab" | "grabSeen" | "ball" | "stun" | "forgive" | "act" | "cool" | "actKind" | "slide";

export function freshMotion(): Pick<Contestant, Motion> {
  return {
    y: 0, vy: 0, stance: 0, inStance: 0, stanceT: 0, inSprint: false, sprinting: false, stamina: 1, rested: 9, inJump: 0, jumpSeen: 0,
    inAttack: 0, attackSeen: 0, inGrab: 0, grabSeen: 0, ball: -1, stun: 0, forgive: 0, act: 0, cool: 0, actKind: "", slide: 0,
  };
}

/** Moving, as Mama sees it: on the move, in the air, changing stance, swinging or picking up. */
export function isMoving(c: Contestant): boolean {
  return Math.hypot(c.vx, c.vz) > RULES.tolerance || c.y > 0.02 || c.stanceT > 0 || c.act > 0;
}

/**
 * One contestant's movement for one fixed step: stick and buttons → speed →
 * velocity → position, clamped to the street, facing where they go. Shared by
 * the referee and by the online client's prediction, so both move a runner
 * identically. Finishing, collisions and judging are NOT here — only the
 * referee does those.
 */
export function moveContestant(c: Contestant, dt: number, course: Course = DEFAULT_COURSE): void {
  if (c.status === "eliminated") return;

  if (c.stun > 0) c.stun = Math.max(0, c.stun - dt);
  if (c.forgive > 0) c.forgive = Math.max(0, c.forgive - dt);
  if (c.act > 0) {
    c.act = Math.max(0, c.act - dt);
    if (c.act === 0) c.actKind = "";
  }
  if (c.cool > 0) c.cool = Math.max(0, c.cool - dt);

  let ix = c.inX;
  let iz = c.inZ;
  let wantStance = c.inStance;
  let wantSprint = c.inSprint;
  if (c.status === "finished") {
    // Walk on into the safe zone, then stand still. Input is ignored.
    ix = 0;
    iz = c.z > course.safeZ ? -0.5 : 0;
    wantStance = 0;
    wantSprint = false;
    c.jumpSeen = c.inJump;
  } else if (c.stun > 0) {
    // Hit or shoved: sliding, not steering. Requests made now are dropped.
    ix = iz = 0;
    wantStance = c.stance;
    wantSprint = false;
    c.jumpSeen = c.inJump;
  }
  const grounded = c.y <= 0 && c.vy <= 0;

  // ── Slide: crouching out of a sprint carries you on, low, for a moment ──
  if (c.slide > 0) {
    c.slide = Math.max(0, c.slide - dt);
    const sp = Math.hypot(c.vx, c.vz);
    // Slowing evenly from where it started to a crouch's pace; no steering.
    const want = MOVE.crouch + (MOVE.sprint - MOVE.crouch) * (c.slide / MOVE.slideTime);
    if (sp > 1e-3) {
      c.vx *= want / sp;
      c.vz *= want / sp;
    }
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    clampToField(c, course);
    c.progress = Math.max(c.progress, FIELD.startZ - c.z);
    if (c.stanceT > 0) c.stanceT = Math.max(0, c.stanceT - dt);
    return;
  }
  if (c.status === "alive" && c.sprinting && grounded && c.stance === 0 && wantStance > 0 && c.stanceT === 0 && Math.hypot(c.vx, c.vz) > MOVE.run) {
    c.slide = MOVE.slideTime;
    c.sprinting = false;
    c.stance = 1;
    c.stanceT = MOVE.stanceTime;
    return;
  }

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
  clampToField(c, course);

  // Face where you are going; keep the last facing when standing still (or knocked back).
  const sp = Math.hypot(c.vx, c.vz);
  if (sp > 0.3 && c.stun <= 0) {
    const want = Math.atan2(c.vx, c.vz);
    let d = want - c.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const maxTurn = MOVE.turnRate * dt;
    c.heading += Math.max(-maxTurn, Math.min(maxTurn, d));
  }

  c.progress = Math.max(c.progress, FIELD.startZ - c.z);
}

export function clampToField(c: Contestant, course: Course = DEFAULT_COURSE): void {
  const lim = course.halfWidth - MOVE.radius;
  if (c.x > lim) { c.x = lim; c.vx = Math.min(0, c.vx); }
  if (c.x < -lim) { c.x = -lim; c.vx = Math.max(0, c.vx); }
  if (c.z > course.backLimitZ) { c.z = course.backLimitZ; c.vz = Math.min(0, c.vz); }
  if (c.z < course.safeZ - 2) { c.z = course.safeZ - 2; c.vz = Math.max(0, c.vz); }
}

export type RoundEvent =
  | { type: "phase"; phase: Phase; duration: number }
  | { type: "eliminated"; id: string; cause: Cause }
  | { type: "finished"; id: string; time: number; place: number }
  | { type: "ended" }
  /** A swing. `target` is who it landed on (null: it missed); `dropped` the ball it knocked loose, or −1. */
  | { type: "attack"; id: string; kind: AttackKind; target: string | null; dropped: number }
  | { type: "grab"; id: string; ball: number }
  | { type: "drop"; ball: number; x: number; z: number }
  | { type: "bank"; id: string; ball: number; basket: number };

export interface RoundOptions {
  seed: number;
  contestants: { id: string; name: string; bot: boolean }[];
  /** Whose spot is front and centre (the local player in practice). */
  featuredId?: string;
  /** Mode, distance, time and width (default: Classic Run, 200 m). */
  course?: Course;
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
  readonly course: Course;
  readonly balls: Ball[];
  readonly baskets: Basket[];

  private readonly rng: Rng;
  private readonly byId = new Map<string, Contestant>();
  private events: RoundEvent[] = [];
  private finishedCount = 0;
  private turns = 0;

  constructor(opts: RoundOptions) {
    this.seed = opts.seed;
    this.rng = new Rng(opts.seed);
    this.course = opts.course ?? DEFAULT_COURSE;
    const hw = this.course.halfWidth;

    // Spawn on a staggered grid behind the start line. The featured contestant
    // gets the centre front slot; everyone else is shuffled into the rest.
    const n = opts.contestants.length;
    const cols = Math.min(6, n);
    const rows = Math.ceil(n / cols);
    const slots: { x: number; z: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = cols === 1 ? 0.5 : c / (cols - 1);
        const x = (t - 0.5) * 2 * (hw - 1.4) + (r % 2 ? 0.7 : -0.7);
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

    // Ball Haunting: the balls come from their own stream, so the spawns above
    // are the same whatever the mode.
    const ballRng = new Rng(opts.seed ^ 0x6a09e667);
    this.balls = this.course.mode === "balls" ? placeBalls(this.course, ballCount(n), ballRng) : [];
    this.baskets = this.course.mode === "balls" ? placeBaskets(this.course) : [];

    this.events.push({ type: "phase", phase: "countdown", duration: RULES.countdown });
  }

  /** Read through a getter: TypeScript can't see that advance() changes `phase`. */
  get over(): boolean {
    return this.phase === "ended";
  }

  get timeLeft(): number {
    return Math.max(0, this.course.timeLimit - this.elapsed);
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

  setActions(id: string, attack: number, grab: number): void {
    const c = this.byId.get(id);
    if (!c) return;
    if (Number.isInteger(attack)) c.inAttack = attack & 255;
    if (Number.isInteger(grab)) c.inGrab = grab & 255;
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
      if (this.elapsed >= this.course.timeLimit) {
        this.timeUp();
        return;
      }
      if (this.course.mode === "balls" && !this.balls.some(inPlay)) {
        this.noBallsLeft();
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
      case "sing":
        // Every turn is warned by the hum; whether this one is real is decided when it ends.
        this.enter("hum", RULES.hum.length);
        break;
      case "hum": {
        // A fake, sometimes — but never before she has turned for real once,
        // and never twice running.
        const fake = this.turns > 0 && !this.justFaked && this.rng.chance(RULES.hum.fakeChance);
        this.justFaked = fake;
        if (fake) {
          // She sings on from where she was.
          this.enter("sing", this.singLength(this.timeLeft <= RULES.lateAt ? RULES.singLate : RULES.sing));
        } else {
          this.cycle++;
          this.turns++;
          this.enter("turning", this.rng.range(RULES.turning.min, RULES.turning.max));
        }
        break;
      }
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

  private justFaked = false;

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
    const course = this.course;
    for (const c of this.contestants) {
      if (c.status === "eliminated") continue;
      this.actions(c);
      moveContestant(c, dt, course);

      if (c.status === "alive" && c.z <= course.finishZ && (course.mode === "classic" || c.ball >= 0)) {
        c.status = "finished";
        c.finishTime = this.elapsed;
        c.place = ++this.finishedCount;
        this.events.push({ type: "finished", id: c.id, time: c.finishTime, place: c.place });
        if (c.ball >= 0) this.bank(c);
      }
    }
    this.separate();
    // Held balls go where their holders go.
    for (const b of this.balls) {
      if (b.holder < 0 || b.basket >= 0) continue;
      const h = this.contestants[b.holder];
      b.x = h.x;
      b.z = h.z;
    }
  }

  // ── Actions: attacks and grabs ────────────────────────────────────────────

  private actions(c: Contestant): void {
    if (c.status !== "alive") {
      c.attackSeen = c.inAttack;
      c.grabSeen = c.inGrab;
      return;
    }
    if (c.inAttack !== c.attackSeen) {
      c.attackSeen = c.inAttack;
      const kind = ATTACK_KINDS[(c.inAttack & 3) - 1];
      if (kind && canAttack(c)) this.attack(c, kind);
    }
    if (c.inGrab !== c.grabSeen) {
      c.grabSeen = c.inGrab;
      if (this.course.mode === "balls" && c.ball < 0 && c.stun <= 0 && c.y <= 0 && c.stance !== 2) this.grab(c);
    }
  }

  private attack(c: Contestant, kind: AttackKind): void {
    const k = ATTACK.kinds[kind];
    c.cool = k.cooldown;
    c.act = ATTACK.swing;
    c.actKind = kind;
    // Online, the target moved on during the attacker's lag: a little extra reach.
    const target = attackTarget(c, this.contestants, ATTACK.range + Math.min(0.5, c.graceBonus * 2));
    let dropped = -1;
    if (target) {
      let dx = target.x - c.x;
      let dz = target.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) {
        dx /= d;
        dz /= d;
      } else {
        dx = Math.sin(c.heading);
        dz = Math.cos(c.heading);
      }
      c.heading = Math.atan2(dx, dz);
      knock(target, dx, dz, k.knock, k.stun);
      // The hit first, then the ball it knocked loose: cause before effect on every phone.
      dropped = target.ball;
      this.events.push({ type: "attack", id: c.id, kind, target: target.id, dropped });
      if (dropped >= 0) this.drop(target, dx, dz, c.index);
      return;
    }
    this.events.push({ type: "attack", id: c.id, kind, target: null, dropped });
  }

  private grab(c: Contestant): void {
    let best: Ball | null = null;
    let bestD: number = BALLS.reach;
    for (const b of this.balls) {
      if (b.holder >= 0 || b.basket >= 0) continue;
      if (b.noGrab === c.index && this.elapsed < b.waitUntil) continue;
      const d = Math.hypot(b.x - c.x, b.z - c.z);
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
    if (!best) return;
    best.holder = c.index;
    best.noGrab = -1;
    c.ball = best.index;
    c.act = BALLS.grabTime;
    c.actKind = "grab";
    this.events.push({ type: "grab", id: c.id, ball: best.index });
  }

  /** Knock `c`'s ball loose, a little along (dx, dz). `by` may not take it for a while. */
  private drop(c: Contestant, dx: number, dz: number, by: number): number {
    const b = this.balls[c.ball];
    c.ball = -1;
    b.holder = -1;
    const lim = this.course.halfWidth - 0.5;
    b.x = Math.max(-lim, Math.min(lim, c.x + dx * 0.9));
    b.z = Math.max(this.course.finishZ + 0.5, Math.min(this.course.backLimitZ, c.z + dz * 0.9));
    b.noGrab = by;
    b.waitUntil = by >= 0 ? this.elapsed + BALLS.attackerWait : 0;
    this.events.push({ type: "drop", ball: b.index, x: b.x, z: b.z });
    return b.index;
  }

  /** Across the line with a ball: it goes in the nearest basket, out of play for good. */
  private bank(c: Contestant): void {
    const b = this.balls[c.ball];
    const k = nearestBasket(this.baskets, c.x);
    const basket = this.baskets[k];
    b.basket = k;
    b.holder = -1;
    b.x = basket.x + ((basket.count % 3) - 1) * 0.12;
    b.z = basket.z + (Math.floor(basket.count / 3) % 2) * 0.12;
    basket.count++;
    c.ball = -1;
    this.events.push({ type: "bank", id: c.id, ball: b.index, basket: k });
  }

  /**
   * Keep bodies from overlapping: nobody runs through anybody. A bump changes
   * position only, never velocity, so being bumped while frozen cannot get you
   * eliminated — the one doing the pushing is the one moving. Running (even
   * sprinting) into someone is never a fight: that takes a tap on an attack
   * button (the owner's rule, 17 Oct 2026).
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
        const nx = dx / d;
        const nz = dz / d;
        const push = (min - d) / 2;
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
      // Hit or shoved: the slide is the attacker's doing, not theirs.
      if (c.forgive > 0) continue;
      if (isMoving(c)) this.eliminate(c, "moved");
    }
  }

  /** Ball Haunting: every ball is in a basket — nobody left on the field can still make it. */
  private noBallsLeft(): void {
    for (const c of this.contestants) {
      if (c.status === "alive") this.eliminate(c, "noball");
    }
    this.enter("ended", 0);
    this.events.push({ type: "ended" });
  }

  private timeUp(): void {
    for (const c of this.contestants) {
      if (c.status === "alive") this.eliminate(c, "time");
    }
    this.enter("ended", 0);
    this.events.push({ type: "ended" });
  }

  private eliminate(c: Contestant, cause: Cause): void {
    // A ball in the hands of the fallen rolls free where they fall.
    if (c.ball >= 0) this.drop(c, 0, 0, -1);
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
