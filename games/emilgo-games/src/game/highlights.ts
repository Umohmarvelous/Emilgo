// The play of the game (SPEC-V2 §2.9): the round's best moment. Pure, and run
// by whoever referees — the server online, the phone in Solo — so in a room
// everyone sees the same one.
//
// Three kinds, each scored 0…100 so they can be compared:
//   escape   the closest escape: still moving as she turned and stopped
//            within half a second of being seen — and not caught that stare.
//            Closer and faster is better.
//   dodge    the best dodge: someone right next to you was shot during a stare
//            and you weren't; or a swing at you missed by less than a metre.
//   attack   the best attack: a hit that knocked a ball loose, taken by the
//            attacker themselves; better nearer the line.
//
// Moments are found as they happen and announced when they beat the best so
// far (the phones keep a clip of each from their replay recording, so it must
// be recent); the last one announced is the play of the game.

import { ATTACK, BALLS, RULES, type AttackKind } from "../config";
import { isMoving, type Contestant, type RedLightRound, type RoundEvent } from "./rules";

export type MomentKind = "escape" | "dodge" | "attack";
export const MOMENT_KINDS: readonly MomentKind[] = ["escape", "dodge", "attack"];

export interface Moment {
  kind: MomentKind;
  /** The contestant it's about. */
  who: number;
  /** Seconds of play: the moment itself (the stop, the shot that missed, the hit). */
  t: number;
  score: number;
}

/** What the replay shows round a moment: from `before` seconds earlier to `after` seconds later. */
export const CLIP = { before: 3, after: 1.5 } as const;

/** Stopping later than this before being seen isn't close. */
const CLOSE = 0.5;
/** Shot this close to you, and you stood still: a near miss. */
const NEAR_MISS = 2.5;
/** A swing that missed you by this little. */
const WHIFF = ATTACK.range + 1;
/**
 * A hit is a steal when the attacker takes back the ball it knocked loose
 * before anyone else touches it — within this long (her stares can hold
 * everyone still for a while).
 */
const STEAL_WITHIN = BALLS.attackerWait + 12;

const ATTACK_SCORE: Record<AttackKind, number> = { fist: 14, push: 10, slap: 6 };

interface Pending {
  kind: MomentKind;
  who: number;
  t: number;
  score: number;
}

export class Highlights {
  best: Moment | null = null;
  /** Per contestant: the last time they were moving (seconds of play). */
  private lastMoving: number[] = [];
  /** Per contestant: their top speed in the last moments of moving. */
  private lastSpeed: number[] = [];
  /** This stare's candidates, judged when it ends (only the ones not caught count). */
  private stare: Pending[] = [];
  /** Who had their detection start checked this stare. */
  private seen = new Set<number>();
  /** Balls knocked loose: ball → who hit, when, how, where. */
  private loose = new Map<number, { by: number; t: number; kind: AttackKind; progress: number }>();
  private wasWatch = false;

  /**
   * After every referee step, with the events it produced. Returns a moment
   * that beat the best so far (announce it), else null.
   */
  observe(round: RedLightRound, events: readonly RoundEvent[]): Moment | null {
    const t = round.elapsed;
    const list = round.contestants;
    let found: Moment | null = null;
    const offer = (p: Pending) => {
      const m: Moment = { kind: p.kind, who: p.who, t: p.t, score: Math.round(p.score * 10) / 10 };
      if (!this.best || m.score > this.best.score) {
        this.best = m;
        found = m;
      }
    };

    for (const c of list) {
      if (c.status !== "alive") continue;
      if (isMoving(c)) {
        this.lastMoving[c.index] = t;
        const sp = Math.hypot(c.vx, c.vz);
        this.lastSpeed[c.index] = Math.max(sp, (this.lastSpeed[c.index] ?? 0) * 0.9);
      }
    }

    const watch = round.phase === "watch";
    if (watch) {
      // The moment each runner starts being judged: did they stop just in time?
      for (const c of list) {
        if (c.status !== "alive" || this.seen.has(c.index)) continue;
        if (round.phaseTime < RULES.grace + c.graceBonus) continue;
        this.seen.add(c.index);
        if (isMoving(c)) continue;
        const stopped = this.lastMoving[c.index];
        if (stopped === undefined) continue;
        const margin = t - stopped;
        if (margin > CLOSE) continue;
        const speed = Math.min(1, (this.lastSpeed[c.index] ?? 0) / 9);
        this.stare.push({ kind: "escape", who: c.index, t: stopped, score: 45 + 40 * (1 - margin / CLOSE) + 12 * speed + (c.bot ? 0 : 3) });
      }
    } else if (this.wasWatch) {
      // The stare is over: whoever is still in made it.
      for (const p of this.stare) if (list[p.who]?.status !== "eliminated") offer(p);
      this.stare = [];
      this.seen.clear();
    }
    this.wasWatch = watch;

    for (const e of events) {
      if (e.type === "eliminated" && e.cause === "moved") {
        const shot = round.get(e.id);
        if (!shot) continue;
        // Everyone standing still right beside them: a near miss.
        for (const c of list) {
          if (c === shot || c.status !== "alive") continue;
          const d = Math.hypot(c.x - shot.x, c.z - shot.z);
          if (d > NEAR_MISS) continue;
          this.stare.push({ kind: "dodge", who: c.index, t, score: 42 + 34 * (1 - d / NEAR_MISS) + (c.ball >= 0 ? 10 : 0) + (c.bot ? 0 : 3) });
        }
      } else if (e.type === "attack") {
        const by = round.get(e.id);
        if (!by) continue;
        if (!e.target) {
          // A miss: the nearest runner in reach of a step more dodged it.
          const near = nearest(by, list, WHIFF);
          if (near) {
            const d = Math.hypot(near.x - by.x, near.z - by.z);
            offer({ kind: "dodge", who: near.index, t, score: 35 + 25 * (1 - (d - ATTACK.range) / (WHIFF - ATTACK.range)) + (near.ball >= 0 ? 12 : 0) + (near.bot ? 0 : 3) });
          }
        } else if (e.dropped >= 0) {
          this.loose.set(e.dropped, { by: by.index, t, kind: e.kind, progress: by.progress / round.course.distance });
        }
      } else if (e.type === "grab") {
        const c = round.get(e.id);
        const hit = this.loose.get(e.ball);
        this.loose.delete(e.ball);
        if (c && hit && hit.by === c.index && t - hit.t <= STEAL_WITHIN) {
          offer({ kind: "attack", who: c.index, t: hit.t, score: 50 + ATTACK_SCORE[hit.kind] + 26 * Math.min(1, hit.progress) + (c.bot ? 0 : 3) });
        }
      } else if (e.type === "drop") {
        // Knocked loose and picked up by someone else (or rolled free): not a steal any more once it moves on.
      } else if (e.type === "ended") {
        for (const p of this.stare) if (list[p.who]?.status !== "eliminated") offer(p);
        this.stare = [];
      }
    }
    return found;
  }
}

function nearest(c: Contestant, list: readonly Contestant[], reach: number): Contestant | null {
  let best: Contestant | null = null;
  let bestD = reach;
  for (const o of list) {
    if (o === c || o.status !== "alive") continue;
    const d = Math.hypot(o.x - c.x, o.z - c.z);
    if (d <= bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}
