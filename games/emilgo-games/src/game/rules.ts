// Red Light, Green Light — the referee.
//
// Pure logic: no three.js, no DOM, no clock. It advances only when step(dt) is
// called with a fixed dt, and all randomness comes from seeded streams. The
// online server runs THIS file as the authority (games/emilgo-games/server), and the
// client uses `moveContestant` from it to predict its own runner. Two copies of
// the rules would drift.
//
// Since SPEC-V3 Phase 11 the round runs on the shared match core
// (core/match.ts) with two rule modules: the doll (modules/doll.ts: the cycle,
// the line, the swings, the judging) and the balls (modules/balls.ts). This
// class is what everything that reads a round sees: the phases below as one
// list, and the round's own events (RoundEvent).
//
// Before play: walkout → countdown. Nobody moves through either. The walkout
// (SPEC-V2 §1.3) is the cinematic walk from the tunnel and the field preview;
// it ends early once every person has tapped skip (allowed only after the walk,
// FLOW.walk), else after walkoutLength(mode). Rounds made without it (tests,
// the tutorial) start at the countdown.
//
// The cycle:   countdown → sing → hum → (sing → hum)* → turning → watch → turningBack → sing → …
// (The phases keep the doll's names; since SPEC-V3 Phase 11 there is no doll:
// the song comes from the sky and an eye opens in it.)
//   sing         the song plays from the sky. Move freely. It is cut anywhere.
//   hum          3 s of humming under the song: the warning. Still safe to move.
//                Sometimes it's fake: the song plays on and the eye stays shut.
//   turning      the song has cut, the eye is opening. Still safe — stop NOW.
//   watch        the eye is open. After `grace`, any speed > tolerance = out:
//                the sky laser strikes.
//   turningBack  the eye closes. Safe to set off early.
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
// just a bump. While the eye watches, an attacker is struck and the one they hit is
// forgiven. Ball Haunting's pens (pens.ts) have solid walls: in and out by
// the door, for everyone, in this same movement code.

import { DEFAULT_COURSE, FIELD, FINAL, FLOW, RULES, type AttackKind, type Course, type Stance } from "../config";
import type { Ball, Basket } from "./balls";
import type { Cause, Contestant } from "./core/body";
import { Match, type MatchWorld } from "./core/match";
import { Space } from "./core/space";
import type { BallsModule } from "./modules/balls";
import type { DollModule } from "./modules/doll";
import { prePlay, type Phase } from "./phases";

// The shared body (SPEC-V3): every importer of rules.ts keeps working.
export { clampToField, freshMotion, isMoving, moveContestant, setBoosts, type Cause, type Contestant, type Status } from "./core/body";
export { PHASES, prePlay, type Phase } from "./phases";

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
  readonly seed: number;
  readonly course: Course;
  readonly contestants: Contestant[];
  readonly balls: Ball[];
  readonly baskets: Basket[];
  /** How fast the referee's clock runs now: 1, or FINAL.scale through the final two's slow motion. */
  timeScale = 1;
  /** The match it runs on, and its two modules. */
  private readonly match: Match;
  private readonly doll: DollModule;

  private events: RoundEvent[] = [];
  /** Real seconds of the final two's slow motion left; whether it has happened. */
  private slowLeft = 0;
  private hadFinal = false;
  /** People who tapped skip during the walkout (CPUs never hold it up). */
  private readonly skipped = new Set<string>();

  constructor(opts: RoundOptions) {
    this.seed = opts.seed;
    this.course = opts.course ?? DEFAULT_COURSE;
    const course = this.course;
    const doll = { featured: opts.featuredId };
    this.match = new Match({
      seed: opts.seed,
      contestants: opts.contestants,
      world: fieldOf(course),
      settings: { time: course.timeLimit, respawn: { on: false, delay: 0 }, modules: course.mode === "balls" ? { doll, balls: {} } : { doll } },
      walkout: opts.walkout,
      countdown: RULES.countdown,
    });
    this.doll = this.match.module<DollModule>("doll")!;
    const balls = this.match.module<BallsModule>("balls");
    this.contestants = this.match.contestants;
    this.balls = balls?.balls ?? [];
    this.baskets = balls?.baskets ?? [];
    this.pull();
  }

  /** The match's phase, and through play the cycle's. (The tests set all three directly.) */
  get phase(): Phase {
    const p = this.match.phase;
    return p === "play" ? this.doll.phase ?? "sing" : p;
  }

  set phase(p: Phase) {
    if (p === "walkout" || p === "countdown" || p === "ended") this.match.phase = p;
    else {
      this.match.phase = "play";
      this.doll.phase = p;
    }
  }

  get phaseTime(): number {
    return prePlay(this.phase) ? this.match.phaseTime : this.doll.phaseTime;
  }

  set phaseTime(t: number) {
    if (prePlay(this.phase)) this.match.phaseTime = t;
    else this.doll.phaseTime = t;
  }

  get phaseDuration(): number {
    const p = this.match.phase;
    return p === "play" ? this.doll.phaseDuration : p === "ended" ? 0 : this.match.phaseDuration;
  }

  set phaseDuration(d: number) {
    if (prePlay(this.phase)) this.match.phaseDuration = d;
    else this.doll.phaseDuration = d;
  }

  /** Seconds of play, excluding the walkout and countdown. */
  get elapsed(): number {
    return this.match.elapsed;
  }

  /** Completed turns of the eye. */
  get cycle(): number {
    return this.doll.cycle;
  }

  /**
   * Skip the rest of the walkout. Counts only once everyone has walked into
   * the arena (FLOW.walk); when every person has skipped, the countdown starts.
   */
  skip(id: string): void {
    const m = this.match;
    if (m.phase !== "walkout" || m.phaseTime < FLOW.walk || !m.get(id)) return;
    this.skipped.add(id);
    for (const c of this.contestants) if (!c.bot && !this.skipped.has(c.id)) return;
    m.skipWalkout();
    this.pull();
  }

  /** Has this person skipped the walkout? */
  hasSkipped(id: string): boolean {
    return this.skipped.has(id);
  }

  get over(): boolean {
    return this.match.over;
  }

  get timeLeft(): number {
    return Math.max(0, this.course.timeLimit - this.elapsed);
  }

  get aliveCount(): number {
    return this.match.aliveCount;
  }

  /** Detection is live: the eye is open and the grace period is over. */
  get detecting(): boolean {
    return this.match.phase === "play" && this.doll.detecting;
  }

  get(id: string): Contestant | undefined {
    return this.match.get(id);
  }

  setInput(id: string, x: number, z: number): void {
    this.match.setInput(id, x, z);
  }

  setButtons(id: string, sprint: boolean, stance: Stance, jump: number): void {
    this.match.setButtons(id, sprint, stance, jump);
  }

  setActions(id: string, attack: number, grab: number): void {
    this.match.setActions(id, attack, grab);
  }

  /** Events since the last drain, oldest first. */
  drain(): RoundEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  step(realDt: number): void {
    if (this.over) return;
    // The final two: the clock runs slow for a moment of real time.
    let dt = realDt;
    if (this.slowLeft > 0) {
      dt = realDt * FINAL.scale;
      this.slowLeft = Math.max(0, this.slowLeft - realDt);
      if (this.slowLeft === 0) this.timeScale = 1;
    }
    this.match.step(dt);
    this.pull();
    if (!this.over && !this.hadFinal && this.match.phase === "play" && this.contestants.length >= 3 && this.aliveCount === 2) this.finalTwo();
  }

  /** Two left running: everyone's clock slows (FINAL), once a round. */
  private finalTwo(): void {
    this.hadFinal = true;
    this.slowLeft = FINAL.seconds;
    this.timeScale = FINAL.scale;
    const two = this.contestants.filter((c) => c.status === "alive");
    this.events.push({ type: "final", ids: [two[0].id, two[1].id] });
  }

  /** The match's events, as the round's. */
  private pull(): void {
    for (const e of this.match.drain()) {
      switch (e.type) {
        case "phase":
          // Play itself isn't a phase here: the song's start is (the doll's).
          if (e.phase !== "play") this.events.push({ type: "phase", phase: e.phase, duration: e.duration });
          break;
        case "doll":
          this.events.push({ type: "phase", phase: e.phase, duration: e.duration });
          break;
        case "eliminated":
          this.events.push({ type: "eliminated", id: e.id, cause: e.cause });
          break;
        case "ball":
          this.events.push({ type: "drop", ball: e.ball, x: e.x, z: e.z });
          break;
        case "ended":
        case "finished":
        case "attack":
        case "grab":
        case "bank":
          this.events.push(e);
          break;
        default:
          break;
      }
    }
  }
}

/** Ball Haunt's field as a match's world: the corridor, flat, with nothing in it (the pens' walls are the course's). */
function fieldOf(course: Course): MatchWorld {
  const hw = course.halfWidth;
  return {
    course,
    space: new Space([], { x0: -hw, z0: course.safeZ - 2, x1: hw, z1: course.backLimitZ }),
    spawns: [[0, FIELD.spawnNearZ]],
    places: [],
  };
}
