// Practice-mode CPU contestants.
//
// They are opponents you OPT IN to (the lobby button says "Practice vs CPU")
// and every one is labelled CPU wherever its name appears. A bot is never
// passed off as a person, and a bot never sits in an online match.
//
// They play by the same rules and the same physics as you: a bot only ever
// sets its stick and presses buttons, the referee decides everything else.
// What makes them human is reaction time — each has a personality with a mean
// and a spread for how long it takes to notice the song stopped, plus a habit
// of flinching — and, in Ball Haunting, how readily it fights for a ball.

import { ATTACK, BALLS, MOVE, RULES, type AttackKind } from "../config";
import { Rng } from "../core/rng";
import { attackTarget, canAttack } from "./combat";
import { openLane, penAt, route } from "./pens";
import type { Contestant, Phase, RedLightRound } from "./rules";

interface Personality {
  /** Mean seconds to react when the song stops. */
  reaction: number;
  /** Spread of that reaction (σ). */
  spread: number;
  /** Chance per cycle that it runs instead of walks. */
  runChance: number;
  /** Twitches per second while she watches. */
  flinch: number;
  /** Chance it sets off while she is still turning back. */
  eager: number;
  /** How far it drifts sideways, metres. */
  wander: number;
  /**
   * Chance it believes the hum and freezes before she turns — even when the hum
   * is fake. Freezing is safe but slow; the bold ones watch her instead.
   */
  fooled: number;
  /** Attacks per second it's willing to throw when someone is in reach. */
  aggression: number;
  /** Its favourite attack. */
  move: AttackKind;
}

const TYPES: Record<"careful" | "steady" | "bold", Personality> = {
  careful: { reaction: 0.24, spread: 0.08, runChance: 0.4, flinch: 0.012, eager: 0.5, wander: 1.2, fooled: 0.95, aggression: 0.6, move: "slap" },
  steady: { reaction: 0.34, spread: 0.11, runChance: 0.68, flinch: 0.03, eager: 0.35, wander: 2.0, fooled: 0.7, aggression: 1.4, move: "push" },
  bold: { reaction: 0.47, spread: 0.14, runChance: 0.95, flinch: 0.07, eager: 0.2, wander: 2.6, fooled: 0.3, aggression: 2.6, move: "fist" },
};

const MIX: (keyof typeof TYPES)[] = ["careful", "steady", "bold", "steady", "careful", "bold", "steady", "steady", "bold", "careful", "steady", "bold"];

export const BOT_NAMES = [
  "Ada", "Tunde", "Ngozi", "Musa", "Chioma", "Emeka", "Aisha", "Segun", "Kemi", "Ibrahim",
  "Bisi", "Obinna", "Zainab", "Femi", "Halima", "Uche", "Funke", "Yusuf", "Amaka", "Dayo",
] as const;

export class BotBrain {
  private readonly p: Personality;
  private lastPhase: Phase | null = null;
  private moveFrom = 0; // phaseTime when it starts moving this phase
  private moveUntil = Infinity; // phaseTime when it stops moving this phase
  private running = false;
  private flinchAt = Infinity;
  private flinchFor = 0;
  /** How long this turn takes: her turn speed varies, and the bot sees it. */
  private turnFor = 0;
  private readonly wanderPhase: number;
  private laneX: number;
  private attacks = 0;
  private grabs = 0;

  constructor(
    readonly id: string,
    kind: number,
    private readonly rng: Rng,
  ) {
    this.p = TYPES[MIX[kind % MIX.length]];
    this.wanderPhase = rng.range(0, Math.PI * 2);
    this.laneX = 0;
  }

  think(round: RedLightRound, me: Contestant): void {
    if (me.status !== "alive") {
      round.setInput(this.id, 0, 0);
      return;
    }

    if (round.phase !== this.lastPhase) {
      this.onPhase(round.phase, round, me);
      this.lastPhase = round.phase;
    }

    const t = round.phaseTime;
    let go = false;
    switch (round.phase) {
      case "sing":
        go = t >= this.moveFrom;
        break;
      case "hum":
        // The warning. Fooled bots stop before it ends, sure she'll turn; the rest
        // run on and watch her.
        go = t < this.moveUntil;
        break;
      case "turning":
        // Still moving until the reaction catches up with the silence.
        go = t < this.moveUntil;
        break;
      case "watch":
        // A slow reaction carries over from the turn into her stare — that is
        // exactly how people get caught.
        go = t < this.moveUntil - this.turnFor || (t >= this.flinchAt && t < this.flinchAt + this.flinchFor);
        break;
      case "turningBack":
        go = t >= this.moveFrom;
        break;
      default:
        go = false;
    }

    if (!go) {
      round.setInput(this.id, 0, 0);
      round.setButtons(this.id, false, 0, me.inJump);
      return;
    }

    // Ball Haunting, empty-handed: go for a free ball, else for whoever holds one.
    // Being close to someone is never a reason to fight: a CPU swings only to
    // take a ball off its holder (hunt), like a player choosing to tap.
    if (round.course.mode === "balls" && me.ball < 0) {
      if (this.hunt(round, me)) return;
    }

    const mag = this.running ? 1 : MOVE.runAt * 0.95;
    const pens = round.course.pens;
    if (pens.length && penAt(pens, me.x, me.z, 0.3)) {
      // In a pen (it just picked up a ball there): out by the door first.
      const w = route(pens, me.x, me.z, 0, me.z - 8);
      const ddx = w.x - me.x;
      const ddz = w.z - me.z;
      const l = Math.hypot(ddx, ddz) || 1;
      round.setInput(this.id, (ddx / l) * mag, (ddz / l) * mag);
      return;
    }
    // Head for the finish, drifting toward a lane that wanders over time (kept clear of the pens).
    const lane = Math.min(6, openLane(pens) - 0.9);
    const sway = Math.sin(round.elapsed * 0.55 + this.wanderPhase) * this.p.wander;
    const want = Math.max(-lane, Math.min(lane, this.laneX + sway));
    const dx = Math.max(-0.45, Math.min(0.45, (want - me.x) * 0.35));
    const len = Math.hypot(dx, 1);
    round.setInput(this.id, (dx / len) * mag, (-1 / len) * mag);
  }

  /** Chase a ball (or its holder). Returns false when there is nothing to chase. */
  private hunt(round: RedLightRound, me: Contestant): boolean {
    let ball: { x: number; z: number; d: number } | null = null;
    for (const b of round.balls) {
      if (b.holder >= 0 || b.basket >= 0) continue;
      if (b.noGrab === me.index && round.elapsed < b.waitUntil) continue;
      const d = Math.hypot(b.x - me.x, b.z - me.z);
      if (!ball || d < ball.d) ball = { x: b.x, z: b.z, d };
    }
    let holder: Contestant | null = null;
    let hd = Infinity;
    for (const b of round.balls) {
      if (b.holder < 0 || b.basket >= 0) continue;
      const h = round.contestants[b.holder];
      if (h === me || h.status !== "alive") continue;
      const d = Math.hypot(h.x - me.x, h.z - me.z);
      if (d < hd) {
        hd = d;
        holder = h;
      }
    }
    // A free ball within reach: take it.
    if (ball && ball.d <= BALLS.reach * 0.9) {
      round.setActions(this.id, me.inAttack, ++this.grabs & 255);
    }
    const target = ball && (!holder || ball.d < hd + 8) ? ball : holder ? { x: holder.x, z: holder.z, d: hd } : null;
    if (!target) return false;
    if (holder && target.d === hd && (round.phase === "sing" || round.phase === "turningBack")) this.maybeAttack(round, me, holder, 1.4);
    // In and out of the pens by the door.
    const w = route(round.course.pens, me.x, me.z, target.x, target.z);
    const dx = w.x - me.x;
    const dz = w.z - me.z;
    const len = Math.hypot(dx, dz) || 1;
    // Slow down near a free ball (and close to a door) so it doesn't run past it.
    const door = (w.x !== target.x || w.z !== target.z) && len < 4;
    const mag = target.d < 2 || door ? MOVE.runAt * 0.7 : this.running ? 1 : MOVE.runAt * 0.95;
    round.setInput(this.id, (dx / len) * mag, (dz / len) * mag);
    round.setButtons(this.id, this.running && !door && target.d > 6 && me.stamina > 0.4, 0, me.inJump);
    return true;
  }

  /** Throw its favourite attack at the ball's holder, now and then, once it's the one in reach. */
  private maybeAttack(round: RedLightRound, me: Contestant, holder: Contestant, k: number): void {
    if (!canAttack(me) || attackTarget(me, round.contestants, ATTACK.range * 0.9) !== holder) return;
    if (!this.rng.chance(Math.min(1, this.p.aggression * k * (1 / 60)))) return;
    const kind = this.p.move === "fist" ? 1 : this.p.move === "slap" ? 2 : 3;
    this.attacks = (this.attacks + 1) & 63;
    round.setActions(this.id, (this.attacks << 2) | kind, me.inGrab);
  }

  private onPhase(phase: Phase, round: RedLightRound, me: Contestant): void {
    const p = this.p;
    const reaction = Math.max(0.06, p.reaction + this.rng.gauss() * p.spread);
    switch (phase) {
      case "sing": {
        // Run more when the clock is short and the line is far.
        const remaining = Math.max(0, me.z - round.course.finishZ);
        const urgent = round.timeLeft > 0 && remaining / round.timeLeft > MOVE.walk * 0.45;
        this.running = urgent || this.rng.chance(p.runChance);
        // After a fake hum it was frozen (or wasn't); either way it picks up again.
        const fromPause = this.lastPhase === "hum";
        this.moveFrom =
          this.lastPhase === "turningBack" && this.moveFrom < RULES.turningBack
            ? 0
            : fromPause && this.moveUntil === Infinity
              ? 0
              : reaction * 0.7;
        this.laneX = Math.max(-6, Math.min(6, me.x + this.rng.range(-1.5, 1.5)));
        break;
      }
      case "hum":
        // Fooled: stops a little before the hum runs out. Otherwise waits for her to turn.
        this.moveUntil = this.rng.chance(p.fooled) ? Math.max(0.3, RULES.hum.length - this.rng.range(0.2, 0.9)) : Infinity;
        break;
      case "turning":
        this.moveUntil = reaction;
        this.turnFor = round.phaseDuration;
        break;
      case "watch": {
        this.flinchAt = Infinity;
        this.flinchFor = 0;
        if (p.flinch > 0) {
          // Exponential wait for the next twitch; most watches have none.
          const wait = -Math.log(Math.max(this.rng.next(), 1e-6)) / p.flinch;
          this.flinchAt = wait;
          this.flinchFor = this.rng.range(0.15, 0.35);
        }
        break;
      }
      case "turningBack":
        this.moveFrom = this.rng.chance(p.eager) ? this.rng.range(0.1, RULES.turningBack) : Infinity;
        break;
      default:
        break;
    }
  }
}
