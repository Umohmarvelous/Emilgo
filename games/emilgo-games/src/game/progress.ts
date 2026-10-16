// Levels and daily challenges — kept on the device, for fun, worth nothing.
// No currency, no rewards that cost money, no streak pressure: a level is just
// a number next to your name, and the day's three challenges are something to
// aim at (UPGRADE.md: lobby2's challenge column).

/** XP needed to go from level n to n+1. */
export function xpForLevel(n: number): number {
  return 400 + 100 * n;
}

export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (left >= xpForLevel(level) && level < 200) {
    left -= xpForLevel(level);
    level++;
  }
  return { level, into: left, need: xpForLevel(level) };
}

/** XP for one round. */
export function xpForRound(r: { finished: boolean; first: boolean; watches: number; online: boolean }): number {
  return 40 + (r.finished ? 120 : 0) + (r.first ? 60 : 0) + Math.min(10, r.watches) * 6 + (r.online ? 30 : 0);
}

export type ChallengeKind = "rounds" | "cross" | "first" | "watches" | "emotes" | "online" | "sprint";

export interface ChallengeDef {
  kind: ChallengeKind;
  label: string;
  goal: number;
}

const POOL: ChallengeDef[] = [
  { kind: "rounds", label: "Play 3 rounds", goal: 3 },
  { kind: "cross", label: "Cross the line 2 times", goal: 2 },
  { kind: "first", label: "Cross first once", goal: 1 },
  { kind: "watches", label: "Freeze through 8 stares", goal: 8 },
  { kind: "emotes", label: "Use 3 emotes", goal: 3 },
  { kind: "online", label: "Play 1 online round", goal: 1 },
  { kind: "sprint", label: "Sprint 100 m", goal: 100 },
];

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today's three, the same all day, different tomorrow. */
export function dailyFor(day: string): ChallengeDef[] {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619);
  const idx = POOL.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, 13).map((i) => POOL[i]);
}

/** Make sure `daily` is today's (resetting progress on a new day) and return the defs. */
export function ensureDaily(daily: { day: string; progress: number[] }): ChallengeDef[] {
  const d = today();
  if (daily.day !== d) {
    daily.day = d;
    daily.progress = [0, 0, 0];
  }
  return dailyFor(d);
}

/** Add progress of a kind; returns the labels of challenges just completed. */
export function addProgress(daily: { day: string; progress: number[] }, kind: ChallengeKind, amount: number): string[] {
  const defs = ensureDaily(daily);
  const done: string[] = [];
  defs.forEach((c, i) => {
    if (c.kind !== kind) return;
    const before = daily.progress[i] ?? 0;
    const after = Math.min(c.goal, before + amount);
    daily.progress[i] = after;
    if (before < c.goal && after >= c.goal) done.push(c.label);
  });
  return done;
}
