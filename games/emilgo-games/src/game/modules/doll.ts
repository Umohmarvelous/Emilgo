// Ball Haunt's song and the eye (SPEC-V3 §1.1, Phase 11): the cycle that was
// Mama's, the line, the swings, and the judging. It runs on the match core
// (match.ts) over the corridor (MatchWorld.course); the balls, when the mode
// has them, are balls.ts. game/rules.ts (RedLightRound) wraps the match for
// everything that reads a round: the server's rooms, practice, the tutorial.
//
// The match is in play through the whole cycle; the cycle's phases keep the
// doll's names (rules.ts's header says what each one is):
//   sing → hum → (sing → hum)* → turning → watch → turningBack → sing → …

import { ATTACK, ATTACK_KINDS, FIELD, RULES, type AttackKind, type Course, type SingBands } from "../../config";
import type { Rng } from "../../core/rng";
import { attackTarget, canAttack, knock } from "../combat";
import { isMoving, type Cause, type Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import type { Phase } from "../phases";
import type { BallsModule } from "./balls";

/** The cycle's phases: the match is in play through all of them. */
export type DollPhase = Exclude<Phase, "walkout" | "countdown" | "ended">;

/** The corridor a doll match is played on (the match's world must have one). */
export function courseOf(m: Match): Course {
  const c = m.world.course;
  if (!c) throw new Error("doll: the world has no course");
  return c;
}

export class DollModule implements RuleModule {
  readonly id = "doll" as const;
  /** Null until play starts. */
  phase: DollPhase | null = null;
  phaseTime = 0;
  phaseDuration = 0;
  /** Completed turns of the eye. */
  cycle = 0;
  private turns = 0;
  private justFaked = false;
  private finished = 0;
  private rng: Rng | null = null;
  /** Whose spot is front and centre (the local player in practice). */
  private readonly featured: string | undefined;

  constructor(cfg: Record<string, unknown>) {
    this.featured = typeof cfg.featured === "string" ? cfg.featured : undefined;
  }

  /** Detection is live: the eye is open and the grace period is over. */
  get detecting(): boolean {
    return this.phase === "watch" && this.phaseTime >= RULES.grace;
  }

  /**
   * Everyone on a staggered grid behind the start line, facing the line. The
   * featured contestant gets the centre front slot; everyone else is shuffled
   * into the rest.
   */
  init(m: Match): void {
    const rng = (this.rng = m.rng("doll"));
    const list = m.contestants;
    const n = list.length;
    const cols = Math.min(6, n);
    const rows = Math.ceil(n / cols);
    const slots: { x: number; z: number }[] = [];
    // However wide the field, the start line is at most the Desert Field's 32 m.
    const spread = Math.min(courseOf(m).halfWidth, 16);
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
    rng.shuffle(slots);
    // Nobody featured (online rounds): the first contestant takes the front slot,
    // so every slot is used exactly once and nobody starts on someone else.
    const featured = this.featured ?? list[0]?.id;
    let slotIdx = 0;
    for (const c of list) {
      const s = c.id === featured ? front : slots[slotIdx++] ?? front;
      c.x = s.x + rng.range(-0.25, 0.25);
      c.z = s.z + rng.range(-0.25, 0.25);
      c.h = 0;
      c.heading = Math.PI; // facing −Z, towards the line
    }
  }

  onEvent(m: Match, e: MatchEvent): void {
    // The countdown's over: the song starts, carrying the step's leftover time.
    if (e.type === "phase" && e.phase === "play" && !m.mirror) {
      this.phaseTime = m.phaseTime;
      this.enter(m, "sing", this.singLength(RULES.firstSing));
    }
  }

  /** Swings, before anyone moves. While the eye watches, the one who swings is the one moving. */
  pre(m: Match): void {
    for (const c of m.contestants) {
      if (c.inAttack === c.attackSeen) continue;
      c.attackSeen = c.inAttack;
      if (c.status !== "alive") continue;
      const kind = ATTACK_KINDS[(c.inAttack & 3) - 1];
      if (kind && canAttack(c)) this.attack(m, c, kind);
    }
  }

  step(m: Match, dt: number): void {
    if (!this.phase) return;
    this.phaseTime += dt;
    const course = courseOf(m);
    const balls = m.module<BallsModule>("balls");
    // Over the line: safe (in Ball Haunting, only holding a ball, which goes in a basket).
    for (const c of m.contestants) {
      if (c.status !== "alive" || c.z > course.finishZ || (course.mode !== "classic" && c.ball < 0)) continue;
      c.status = "finished";
      c.finishTime = m.elapsed;
      c.place = ++this.finished;
      m.emit({ type: "finished", id: c.id, time: c.finishTime, place: c.place });
      if (c.ball >= 0) balls?.bank(m, c);
    }
    balls?.carry(m);
    this.detect(m);
    // Time's up: the core asks timeUp() next.
    if (m.elapsed >= m.settings.time) return;
    // Ball Haunting: every ball is in a basket — nobody left on the field can still make it.
    if (balls && !balls.anyInPlay()) {
      for (const c of m.contestants) if (c.status === "alive") this.out(m, c, "noball");
      m.end();
      return;
    }
    // A long frame can span more than one short phase; loop until caught up.
    let guard = 0;
    while (!m.over && this.phaseTime >= this.phaseDuration && guard++ < 4) {
      this.phaseTime -= this.phaseDuration;
      this.advance(m);
    }
    if (!m.over && m.aliveCount === 0) m.end();
  }

  /** Whoever is still on the field when time runs out is out. */
  timeUp(m: Match): void {
    for (const c of m.contestants) if (c.status === "alive") this.out(m, c, "time");
  }

  // ── The cycle ──

  private advance(m: Match): void {
    const rng = this.rng!;
    switch (this.phase) {
      case "sing":
        // Every turn is warned by the hum; whether this one is real is decided when it ends.
        this.enter(m, "hum", RULES.hum.length);
        break;
      case "hum": {
        // A fake, sometimes — but never before the eye has opened for real once,
        // and never twice running.
        const fake = this.turns > 0 && !this.justFaked && rng.chance(RULES.hum.fakeChance);
        this.justFaked = fake;
        if (fake) {
          // The song plays on from where it was.
          this.enter(m, "sing", this.singLength(m.timeLeft <= RULES.lateAt ? RULES.singLate : RULES.sing));
        } else {
          this.cycle++;
          this.turns++;
          this.enter(m, "turning", rng.range(RULES.turning.min, RULES.turning.max));
        }
        break;
      }
      case "turning":
        this.enter(m, "watch", rng.range(RULES.watch.min, RULES.watch.max));
        break;
      case "watch":
        this.enter(m, "turningBack", RULES.turningBack);
        break;
      case "turningBack":
        this.enter(m, "sing", this.singLength(m.timeLeft <= RULES.lateAt ? RULES.singLate : RULES.sing));
        break;
      default:
        break;
    }
  }

  /** Weighted band, then uniform inside it: lengths cluster unpredictably. */
  private singLength(b: SingBands): number {
    const rng = this.rng!;
    let r = rng.next();
    for (let i = 0; i < b.bands.length; i++) {
      r -= b.weights[i];
      if (r <= 0 || i === b.bands.length - 1) return rng.range(b.bands[i][0], b.bands[i][1]);
    }
    return rng.range(b.bands[0][0], b.bands[0][1]);
  }

  private enter(m: Match, phase: DollPhase, duration: number): void {
    this.phase = phase;
    this.phaseDuration = duration;
    m.emit({ type: "doll", phase, duration });
  }

  // ── Swings ──

  private attack(m: Match, c: Contestant, kind: AttackKind): void {
    const k = ATTACK.kinds[kind];
    c.cool = k.cooldown * c.bst.cool;
    c.act = ATTACK.swing;
    c.actKind = kind;
    // Online, the target moved on during the attacker's lag: a little extra reach.
    const target = attackTarget(c, m.contestants, ATTACK.range + c.bst.reach + Math.min(0.5, c.graceBonus * 2));
    if (!target) {
      m.emit({ type: "attack", id: c.id, kind, target: null, dropped: -1 });
      return;
    }
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
    let dropped = target.ball;
    // Iron Grip: the first hit (or more) of the round leaves the ball in their hands.
    if (dropped >= 0 && target.grip > 0) {
      target.grip--;
      dropped = -1;
    }
    m.emit({ type: "attack", id: c.id, kind, target: target.id, dropped });
    if (dropped >= 0) m.module<BallsModule>("balls")?.loose(m, target, dx, dz, c.index);
  }

  // ── Judging ──

  private detect(m: Match): void {
    if (!this.detecting) return;
    for (const c of m.contestants) {
      if (c.status !== "alive") continue;
      // Each contestant's own grace: the base, plus their network allowance.
      if (this.phaseTime < RULES.grace + c.graceBonus + c.bst.grace) continue;
      // Hit or shoved: the slide is the attacker's doing, not theirs.
      if (c.forgive > 0) continue;
      if (isMoving(c)) this.out(m, c, "moved");
    }
  }

  /** Out: a ball in their hands rolls free where they fall, then they're eliminated. */
  private out(m: Match, c: Contestant, cause: Cause): void {
    m.module<BallsModule>("balls")?.release(m, c);
    m.eliminate(c, cause);
  }
}
