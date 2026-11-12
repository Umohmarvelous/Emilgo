// The daily reward chest (v6 2.11; the owner said yes to v5's suggestion: "a daily reward chest on the rewards
// screen"). Once a day the results screen offers a chest; opening it pays CP. Days in a row climb a 7-day ladder,
// then start it again; a missed day starts it again from day 1.
//
// CP is earned only by playing (SPEC-V6, the CP system): the chest only appears after a match, never in the
// lobby. Kept on the phone like CP itself. Pure: no DOM.
//
// v7 (2.7): the ladder follows the day streak (rank/awards.ts countDay: days in a row with a counted match, a
// shield keeping it over one missed day) when it's given, so the chest and the streak never disagree.

import { today } from "./progress";

/** CP for day 1 … 7 of a streak (a match pays 10–60; boosts cost 60–150 for 3 rounds). */
export const CHEST_CP = [20, 25, 30, 40, 50, 60, 100] as const;

export interface ChestState {
  /** The day the chest was last opened (today()'s format), or "". */
  day: string;
  /** Days in a row it was opened, up to that day (1 … 7). */
  streak: number;
}

/** The day before `day` (YYYY-MM-DD), by the calendar. */
export function dayBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Today's chest, if it hasn't been opened yet: which day of the ladder it is (1 … 7) and its CP. v7: `run`, the day
 * streak counted today (1 …): the ladder's day follows it.
 */
export function chestOffer(s: ChestState, now = today(), run = 0): { day: number; cp: number } | null {
  if (s.day === now) return null;
  const was = s.day && s.day === dayBefore(now) ? s.streak : 0;
  const day = run > 0 ? ((run - 1) % CHEST_CP.length) + 1 : (was % CHEST_CP.length) + 1;
  return { day, cp: CHEST_CP[day - 1] };
}

/** Open today's chest: the CP to pay (0 when it was already opened today). Updates `s`. */
export function openChest(s: ChestState, now = today(), run = 0): number {
  const o = chestOffer(s, now, run);
  if (!o) return 0;
  s.day = now;
  s.streak = o.day;
  return o.cp;
}

/** A saved chest, checked (an edited or broken save starts fresh). */
export function cleanChest(v: unknown): ChestState {
  const c = v as Partial<ChestState> | null;
  if (!c || typeof c.day !== "string" || !/^(\d{4}-\d{2}-\d{2})?$/.test(c.day)) return { day: "", streak: 0 };
  const streak = Math.floor(Number(c.streak));
  return { day: c.day, streak: Number.isFinite(streak) ? Math.max(0, Math.min(CHEST_CP.length, streak)) : 0 };
}
