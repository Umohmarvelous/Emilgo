// Red Light, Green Light's tutorial (SPEC-V2 §1.5): a real round on the
// short field, played by a model who keeps every rule, while the steps light
// up as they happen. Three scripted people, so every step is sure to be shown:
//
//   Ada     the model: runs while Mama sings, freezes the moment she turns,
//           (Ball Haunting) fetches a ball, picks it up again if it's knocked
//           loose, and carries it over the line.
//   Tunde   runs straight through her first stare and is caught — the rule
//           every new player needs to see once.
//   Bisi    (Ball Haunting) shadows Ada, and once she has a ball sprints up
//           and slaps it loose — while Mama sings, never while she looks,
//           and again if a swing misses. Ada doesn't sprint with the ball
//           until then, so the slap is sure to come.

import { ATTACK, BALLS, MOVE, type Mode } from "../config";
import { penAt, route } from "../game/pens";
import type { Contestant, RedLightRound, RoundEvent } from "../game/rules";
import type { TutorialStep } from "../flow/step";

export const DEMO = "demo";
const VICTIM = "victim";
const THIEF = "thief";

export function tutorialPeople(mode: Mode): { id: string; name: string; bot: boolean }[] {
  const people = [
    { id: DEMO, name: "Ada", bot: true },
    { id: VICTIM, name: "Tunde", bot: true },
  ];
  if (mode === "balls") people.push({ id: THIEF, name: "Bisi", bot: true });
  return people;
}

export function tutorialSteps(mode: Mode): TutorialStep[] {
  const steps: TutorialStep[] = [
    { id: "sing", title: "Mama sings: run", say: "When Mama sings, run. A small push on the stick walks, a full push runs. Sprint while your stamina lasts." },
    { id: "hum", title: "She hums: get ready", say: "Before she turns, she hums for three seconds. Get ready to stop. Sometimes it's a trick, and she sings on." },
    { id: "turn", title: "She turns: freeze", say: "She turns round. Let go of the stick and stand still. Ada stops at once.", hi: ".hud .compass" },
    { id: "caught", title: "Move and you're out", say: "Tunde kept running while she looked. Anyone moving is out. Jumping or crouching counts as moving." },
  ];
  if (mode === "balls") {
    steps.push(
      { id: "grab", title: "Grab a ball", say: "In Ball Haunting you need a ball. There are fewer balls than players, so be quick. Some lie in the pens by the sides: in by the door." },
      { id: "fight", title: "Fight for the balls", say: "Fist, slap or push someone close to knock their ball loose. Never while she's looking: the attacker is shot." },
    );
  }
  steps.push(
    {
      id: "cross",
      title: "Cross the line",
      say: mode === "balls" ? "Carry your ball over the line. It drops in a basket and you are safe." : "Reach the line before the time runs out. Walking all the way won't make it.",
      hi: ".hud .minfo",
    },
    { id: "end", title: "That's the game", say: "That's the game. Watch Mama, not the beat. Good luck!" },
  );
  return steps;
}

/** Drives the three scripted people and says which step each moment shows. */
export class TutorialScript {
  private grabs = 0;
  private attacks = 0;
  private thiefDone = false;
  private turned = false;
  private crossed = false;

  constructor(private readonly mode: Mode) {}

  think(round: RedLightRound): void {
    const demo = round.get(DEMO);
    const victim = round.get(VICTIM);
    const thief = round.get(THIEF);
    const singing = round.phase === "sing" || round.phase === "hum" || round.phase === "turningBack";
    if (demo) this.model(round, demo, singing);
    // Tunde never stops, and is caught at her first stare (down the open middle, clear of any pen).
    if (victim?.status === "alive") round.setInput(VICTIM, Math.max(-0.3, Math.min(0.3, 0.08 - victim.x * 0.12)), -1);
    if (thief) this.thiefThink(round, thief, demo, singing);
  }

  /** The step this event shows, if any. */
  onEvent(e: RoundEvent, round: RedLightRound): string | null {
    switch (e.type) {
      case "phase":
        if (e.phase === "sing") return "sing";
        if (e.phase === "hum") return "hum";
        if (e.phase === "turning") {
          this.turned = true;
          return "turn";
        }
        return null;
      case "eliminated":
        return e.id === VICTIM ? "caught" : null;
      case "grab":
        return e.id === DEMO ? "grab" : null;
      case "attack":
        // Done once a slap has knocked Ada's ball loose; a miss means another go.
        if (e.id === THIEF && e.target === DEMO && e.dropped >= 0) this.thiefDone = true;
        return "fight";
      case "finished":
        if (e.id === DEMO) {
          this.crossed = true;
          return "cross";
        }
        return null;
      case "ended":
        return "end";
      default:
        void round;
        return null;
    }
  }

  /** The model crossed (or the round is over): the tutorial can wrap up. */
  get done(): boolean {
    return this.crossed;
  }

  get sawTurn(): boolean {
    return this.turned;
  }

  private model(round: RedLightRound, me: Contestant, singing: boolean): void {
    if (me.status !== "alive" || !singing) {
      round.setInput(DEMO, 0, 0);
      round.setButtons(DEMO, false, 0, me.inJump);
      return;
    }
    let tx = 0;
    let tz = round.course.finishZ - 3;
    let near = false;
    if (this.mode === "balls" && me.ball < 0) {
      // The nearest free ball — one in the open if there is one (a pen's door
      // takes time, and the short field has little to spare).
      let best: { x: number; z: number; d: number } | null = null;
      for (const b of round.balls) {
        if (b.holder >= 0 || b.basket >= 0) continue;
        if (b.noGrab === me.index && round.elapsed < b.waitUntil) continue;
        const d = Math.hypot(b.x - me.x, b.z - me.z) + (penAt(round.course.pens, b.x, b.z) ? 40 : 0);
        if (!best || d < best.d) best = { x: b.x, z: b.z, d };
      }
      if (best) best.d = Math.hypot(best.x - me.x, best.z - me.z);
      if (best) {
        tx = best.x;
        tz = best.z;
        near = best.d < 2.5;
        if (best.d <= BALLS.reach * 0.85 && round.phase !== "turningBack") round.setActions(DEMO, me.inAttack, ++this.grabs & 255);
      }
    }
    // In and out of a pen by its door.
    const w = route(round.course.pens, me.x, me.z, tx, tz);
    const dx = w.x - me.x;
    const dz = w.z - me.z;
    const len = Math.hypot(dx, dz) || 1;
    // Close to a door (or round a pen): steady, no sprinting.
    const door = (w.x !== tx || w.z !== tz) && len < 4;
    const waitForSlap = this.mode === "balls" && me.ball >= 0 && !this.thiefDone;
    // Ball in hand and Bisi still far behind: walk, so the slap is sure to come.
    const thief = round.get(THIEF);
    const lagging = waitForSlap && !!thief && thief.status === "alive" && Math.hypot(thief.x - me.x, thief.z - me.z) > 4;
    const mag = near || door ? MOVE.runAt * 0.7 : lagging ? MOVE.runAt * 0.6 : 1;
    round.setInput(DEMO, (dx / len) * mag, (dz / len) * mag);
    round.setButtons(DEMO, !near && !door && !waitForSlap && me.stamina > 0.35, 0, me.inJump);
  }

  private thiefThink(round: RedLightRound, me: Contestant, demo: Contestant | undefined, singing: boolean): void {
    if (me.status !== "alive" || this.thiefDone || !demo || demo.status !== "alive" || !singing) {
      round.setInput(THIEF, 0, 0);
      return;
    }
    // Keep a few steps behind Ada until she has a ball, then sprint up to her
    // (the stamina was saved for this: running alone never catches a runner).
    const d = Math.hypot(demo.x - me.x, demo.z - me.z) || 1;
    const w = route(round.course.pens, me.x, me.z, demo.x, demo.z);
    const dx = w.x - me.x;
    const dz = w.z - me.z;
    const l = Math.hypot(dx, dz) || 1;
    const chase = demo.ball >= 0;
    const mag = d > (chase ? 0 : 2.5) ? 1 : 0;
    round.setInput(THIEF, (dx / l) * mag, (dz / l) * mag);
    round.setButtons(THIEF, chase && d > ATTACK.range * 0.6, 0, me.inJump);
    if (chase && d < ATTACK.range * 0.8 && round.phase === "sing" && me.cool <= 0) {
      this.attacks = (this.attacks + 1) & 63;
      round.setActions(THIEF, (this.attacks << 2) | 2, me.inGrab);
    }
  }
}
