// Red Light, Green Light — the referee.
//
// Pure logic: no three.js, no DOM, no clock. It advances only when step(dt) is
// called with a fixed dt, and all randomness comes from the seeded Rng. The
// online server runs THIS file as the authority (games/emilgo-games/server), and the
// client uses `moveContestant` from it to predict its own runner. Two copies of
// the rules would drift.
//
// Before play: walkout → countdown. Nobody moves through either. The walkout
// (SPEC-V2 §1.3) is the cinematic walk from the tunnel and the field preview;
// it ends early once every person has tapped skip (allowed only after the walk,
// FLOW.walk), else after walkoutLength(mode). Rounds made without it (tests,
// the tutorial) start at the countdown.
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
// The final two (SPEC-V2 §2.8): the moment only two are left running (in a
// round that started with three or more), the referee's clock slows to
// FINAL.scale for FINAL.seconds of real time — the song, the stare, the run,
// everything — for every phone at once.
//
// Modes (SPEC-V2 §2.1): Classic Run — reach the line. Ball Haunting — reach
// it HOLDING a ball (fewer balls than players); the ball goes in a basket and
// you are safe for good. Attacks (fist, slap, push; combat.ts) knock a ball
// loose — only when someone taps an attack button: running into people is
// just a bump. While she watches, an attacker is shot and the one they hit is
// forgiven. Ball Haunting's pens (pens.ts) have solid walls: in and out by
// the door, for everyone, in this same movement code.

import { ATTACK, ATTACK_KINDS, BALLS, DEFAULT_COURSE, FIELD, FINAL, FLOW, MOVE, RULES, ballCount, type AttackKind, type Course, type SingBands, type Stance } from "../config";
import { Rng } from "../core/rng";
import { inPlay, nearestBasket, placeBalls, placeBaskets, type Ball, type Basket } from "./balls";
import { attackTarget, canAttack, knock } from "./combat";
import { clearOfWalls } from "./pens";
import { freshMotion, isMoving, moveContestant, setBoosts, type Cause, type Contestant } from "./core/body";

// The shared body (SPEC-V3): every importer of rules.ts keeps working.
export { clampToField, freshMotion, isMoving, moveContestant, setBoosts, type Cause, type Contestant, type Status } from "./core/body";

export type Phase = "walkout" | "countdown" | "sing" | "hum" | "turning" | "watch" | "turningBack" | "ended";
/**
 * What the session reads from a round. The local referee implements it for
 * practice; the online client implements it from the server's snapshots.
 */
export interface RoundView {
  /** The round's seed (the server's online): everything chosen from it is the same on every phone. */
  readonly seed: number;
  readonly course: Course;
  readonly balls: readonly Ball[];
  readonly baskets: readonly Basket[];
  readonly phase: Phase;
  readonly phaseTime: number;
  readonly phaseDuration: number;
  readonly elapsed: number;
  /** How fast the referee's clock runs now: 1, or FINAL.scale through the final two's slow motion. */
  readonly timeScale: number;
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

export const PHASES: readonly Phase[] = ["walkout", "countdown", "sing", "hum", "turning", "watch", "turningBack", "ended"];

/** Before play: nobody moves and the clock doesn't run. */
export function prePlay(p: Phase): boolean {
  return p === "walkout" || p === "countdown";
}

/**
 * Phases whose length is a secret. The referee knows it; nobody else is told —
 * not the HUD, not the network — because knowing when the song ends IS the game.
 */
export const HIDDEN_LENGTH: readonly Phase[] = ["sing", "watch"];

export type RoundEvent =
  | { type: "phase"; phase: Phase; duration: number }
  | { type: "eliminated"; id: string; cause: Cause }
  | { type: "finished"; id: string; time: number; place: number }
  | { type: "ended" }
  /** A swing. `target` is who it landed on (null: it missed); `dropped` the ball it knocked loose, or −1. */
  | { type: "attack"; id: string; kind: AttackKind; target: string | null; dropped: number }
  | { type: "grab"; id: string; ball: number }
  | { type: "drop"; ball: number; x: number; z: number }
  | { type: "bank"; id: string; ball: number; basket: number }
  /** Two runners left: the slow motion starts (FINAL). */
  | { type: "final"; ids: [string, string] }
  /**
   * A highlight beat the best so far (game/highlights.ts): the play of the
   * game, unless a better one comes. Never from the referee itself — from
   * whoever runs the highlights (the server online, the session in Solo).
   */
  | { type: "moment"; kind: "escape" | "dodge" | "attack"; who: number; t: number; score: number };

export interface RoundOptions {
  seed: number;
  /** `boosts`: the CP boosts each brings (SPEC-V2 §7.7); left out in staked matches. */
  contestants: { id: string; name: string; bot: boolean; boosts?: readonly string[] }[];
  /** Whose spot is front and centre (the local player in practice). */
  featuredId?: string;
  /** Mode, distance, time and width (default: Classic Run, 200 m). */
  course?: Course;
  /** Seconds of walkout before the countdown (walkoutLength(mode)); 0 or missing: none. */
  walkout?: number;
}

export class RedLightRound implements RoundView {
  phase: Phase = "countdown";
  phaseTime = 0;
  phaseDuration: number = RULES.countdown;
  /** Seconds of play, excluding the walkout and countdown. */
  elapsed = 0;
  /** Completed sing phases. */
  cycle = 0;
  timeScale = 1;
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
  /** Real seconds of the final two's slow motion left; whether it has happened. */
  private slowLeft = 0;
  private hadFinal = false;
  /** People who tapped skip during the walkout (CPUs never hold it up). */
  private readonly skipped = new Set<string>();

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
    // However wide the field, the start line is at most the Desert Field's 32 m.
    const spread = Math.min(hw, 16);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = cols === 1 ? 0.5 : c / (cols - 1);
        const x = (t - 0.5) * 2 * (spread - 1.4) + (r % 2 ? 0.7 : -0.7);
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
      setBoosts(contestant, c.boosts);
      this.byId.set(c.id, contestant);
      return contestant;
    });

    // Ball Haunting: the balls come from their own stream, so the spawns above
    // are the same whatever the mode.
    const ballRng = new Rng(opts.seed ^ 0x6a09e667);
    this.balls = this.course.mode === "balls" ? placeBalls(this.course, ballCount(n), ballRng) : [];
    this.baskets = this.course.mode === "balls" ? placeBaskets(this.course) : [];

    const walkout = opts.walkout ?? 0;
    if (walkout > 0) {
      this.phase = "walkout";
      this.phaseDuration = walkout;
    }
    this.events.push({ type: "phase", phase: this.phase, duration: this.phaseDuration });
  }

  /**
   * Skip the rest of the walkout. Counts only once everyone has walked into
   * the arena (FLOW.walk); when every person has skipped, the countdown starts.
   */
  skip(id: string): void {
    if (this.phase !== "walkout" || this.phaseTime < FLOW.walk || !this.byId.has(id)) return;
    this.skipped.add(id);
    for (const c of this.contestants) if (!c.bot && !this.skipped.has(c.id)) return;
    this.phaseTime = 0;
    this.enter("countdown", RULES.countdown);
  }

  /** Has this person skipped the walkout? */
  hasSkipped(id: string): boolean {
    return this.skipped.has(id);
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

  step(realDt: number): void {
    if (this.phase === "ended") return;

    // The final two: the clock runs slow for a moment of real time.
    let dt = realDt;
    if (this.slowLeft > 0) {
      dt = realDt * FINAL.scale;
      this.slowLeft = Math.max(0, this.slowLeft - realDt);
      if (this.slowLeft === 0) this.timeScale = 1;
    }
    this.phaseTime += dt;

    if (!prePlay(this.phase)) {
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

    if (!this.over && !prePlay(this.phase) && this.aliveCount === 0) {
      this.enter("ended", 0);
      this.events.push({ type: "ended" });
    }
    if (!this.over && !this.hadFinal && !prePlay(this.phase) && this.contestants.length >= 3 && this.aliveCount === 2) this.finalTwo();
  }

  /** Two left running: everyone's clock slows (FINAL), once a round. */
  private finalTwo(): void {
    this.hadFinal = true;
    this.slowLeft = FINAL.seconds;
    this.timeScale = FINAL.scale;
    const two = this.contestants.filter((c) => c.status === "alive");
    this.events.push({ type: "final", ids: [two[0].id, two[1].id] });
  }

  // ── Phases ────────────────────────────────────────────────────────────────

  private advance(): void {
    switch (this.phase) {
      case "walkout":
        this.enter("countdown", RULES.countdown);
        break;
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
    c.cool = k.cooldown * c.bst.cool;
    c.act = ATTACK.swing;
    c.actKind = kind;
    // Online, the target moved on during the attacker's lag: a little extra reach.
    const target = attackTarget(c, this.contestants, ATTACK.range + c.bst.reach + Math.min(0.5, c.graceBonus * 2));
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
      // Iron Grip: the first hit (or more) of the round leaves the ball in their hands.
      if (dropped >= 0 && target.grip > 0) {
        target.grip--;
        dropped = -1;
      }
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
    c.act = BALLS.grabTime * c.bst.grab;
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
    // Never inside a pen's wall, where nobody could reach it.
    if (this.course.walls.length) clearOfWalls(b, this.course.walls, 0.3);
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
    // A bump never puts anyone inside a wall.
    const walls = this.course.walls;
    if (walls.length) for (const c of list) if (c.status !== "eliminated") clearOfWalls(c, walls, MOVE.radius);
  }

  // ── Judging ───────────────────────────────────────────────────────────────

  private detect(): void {
    if (!this.detecting) return;
    for (const c of this.contestants) {
      if (c.status !== "alive") continue;
      // Each contestant's own grace: the base, plus their network allowance.
      if (this.phaseTime < RULES.grace + c.graceBonus + c.bst.grace) continue;
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
