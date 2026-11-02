// What changes by the week and the day (SPEC-V3 §10.13, §3.4 #10–12), on its
// own so the lobby can say it without loading the matches' code: the weekly
// Free For All and Dead Streets mutators and their names, the Daily Run's seed,
// a run's medal. Pure; the server uses the same functions.

import { SURVIVAL, type RunMutator } from "../config";

/** The weekly mutators (§10.13): Juju Day (low gravity), Rainy Season (slippery), Market Day (double items). */
export type Mutator = "juju" | "rainy" | "market";
export const MUTATORS: readonly Mutator[] = ["juju", "rainy", "market"];

export const MUTATOR_NAME = { juju: "Juju Day: low gravity", rainy: "Rainy Season: slippery ground", market: "Market Day: double items" } as const;

/**
 * This week's mutator: none, Market Day, Juju Day, Rainy Season in turn, by
 * the week of the year (UTC). The server says which in a match's start, so a
 * phone's copy plays the same week.
 */
export function weeklyMutator(ms: number): Mutator | undefined {
  const week = Math.floor((ms / 86_400_000 + 3) / 7);
  return ([undefined, "market", "juju", "rainy"] as const)[((week % 4) + 4) % 4];
}

export const RUN_MUTATOR_NAME: Record<string, string> = { haze: "Harmattan Haze", runners: "Double Runners", onebullet: "One Bullet", notorch: "No Torch" };

/** This week's run mutator (§3.4 #11): none, Harmattan Haze, Double Runners, One Bullet, No Torch in turn (Monday to Sunday, UTC). */
export function runMutator(ms: number): RunMutator | undefined {
  const week = Math.floor((ms / 86_400_000 + 3) / 7);
  return ([undefined, "haze", "runners", "onebullet", "notorch"] as const)[((week % 5) + 5) % 5];
}

/** The Daily Run's seed (§3.4 #10): one for everyone, from the UTC day. */
export function dailySeed(day: string): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619);
  return ((h >>> 0) % 2147483646) + 1;
}

/** A finished run's medal (§3.4 #12), by its time; none for a run that didn't reach the Mast. */
export function medalOf(t: { finished: boolean; seconds: number }): "gold" | "silver" | "bronze" | null {
  if (!t.finished) return null;
  const M = SURVIVAL.medals;
  return t.seconds <= M.gold ? "gold" : t.seconds <= M.silver ? "silver" : t.seconds <= M.bronze ? "bronze" : null;
}
