// Practice-mode CPU contestants.
//
// They are opponents you OPT IN to (the lobby button says "Practice vs CPU")
// and every one is labelled CPU wherever its name appears. A bot is never
// passed off as a person, and a bot never sits in an online match.
//
// They play by the same rules and the same physics as you: a bot only ever
// sets its stick, the referee decides everything else. What makes them human is
// reaction time — each has a personality with a mean and a spread for how long
// it takes to notice the song stopped, plus a habit of flinching.

import { FIELD, MOVE, RULES } from "../config";
import { Rng } from "../core/rng";
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
   * Chance it freezes when the song stops even though she isn't turning — the
   * feint. Freezing is safe but slow; the bold ones watch her instead.
   */
  fooled: number;
}

const TYPES: Record<"careful" | "steady" | "bold", Personality> = {
  careful: { reaction: 0.24, spread: 0.08, runChance: 0.4, flinch: 0.012, eager: 0.5, wander: 1.2, fooled: 0.95 },
  steady: { reaction: 0.34, spread: 0.11, runChance: 0.68, flinch: 0.03, eager: 0.35, wander: 2.0, fooled: 0.7 },
  bold: { reaction: 0.47, spread: 0.14, runChance: 0.95, flinch: 0.07, eager: 0.2, wander: 2.6, fooled: 0.3 },
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
      case "pause":
        // The song stopped. Fooled bots stop too, a reaction later; the rest carry on.
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
      return;
    }

    // Head for the finish, drifting toward a lane that wanders over time.
    const sway = Math.sin(round.elapsed * 0.55 + this.wanderPhase) * this.p.wander;
    const dx = Math.max(-0.45, Math.min(0.45, (this.laneX + sway - me.x) * 0.35));
    const mag = this.running ? 1 : MOVE.runAt * 0.95;
    const len = Math.hypot(dx, 1);
    round.setInput(this.id, (dx / len) * mag, (-1 / len) * mag);
  }

  private onPhase(phase: Phase, round: RedLightRound, me: Contestant): void {
    const p = this.p;
    const reaction = Math.max(0.06, p.reaction + this.rng.gauss() * p.spread);
    switch (phase) {
      case "sing": {
        // Run more when the clock is short and the line is far.
        const remaining = Math.max(0, me.z - FIELD.finishZ);
        const urgent = round.timeLeft > 0 && remaining / round.timeLeft > MOVE.walk * 0.45;
        this.running = urgent || this.rng.chance(p.runChance);
        // After a feint it was frozen (or wasn't); either way it picks up again.
        const fromPause = this.lastPhase === "pause";
        this.moveFrom =
          this.lastPhase === "turningBack" && this.moveFrom < RULES.turningBack
            ? 0
            : fromPause && this.moveUntil === Infinity
              ? 0
              : reaction * 0.7;
        this.laneX = Math.max(-6, Math.min(6, me.x + this.rng.range(-1.5, 1.5)));
        break;
      }
      case "pause":
        this.moveUntil = this.rng.chance(p.fooled) ? reaction : Infinity;
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
