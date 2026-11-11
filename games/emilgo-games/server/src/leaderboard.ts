// The leaderboard (v6 max, 3.12: "Leaderboard: a sorted set in Redis"). This
// week's XP per player, one board per copy of the game (Lagos Life's players
// and EMILGO's never share one: Vatar Developer Agreement §8.2, never linked).
// Every node adds to the same sorted set when REDIS_URL is set; one node keeps
// it in memory otherwise. A week's board lives two weeks, then goes.
//
//   add(key, name, xp)    a match's XP, on the player's profile key
//   top(kind, n, me)      the first n (display names), and where `me` stands

import type { Shared } from "./shared";

/** The ISO week a time falls in: "2026-W46" (weeks start on Monday, UTC). */
export function isoWeek(t = Date.now()): string {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thursday.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const KEEP_S = 14 * 86_400;

export interface BoardRow {
  name: string;
  xp: number;
  you?: boolean;
}

export class Leaderboard {
  constructor(private readonly shared: Shared) {}

  /** Which board a profile key is on ("ll:…" Lagos Life, "em:…" EMILGO). */
  static kindOf(key: string): "ll" | "em" {
    return key.startsWith("ll:") ? "ll" : "em";
  }

  private key(kind: string, week = isoWeek()): string {
    return `lb:xp:${kind}:${week}`;
  }

  /** A match's XP (a profile's: guests aren't on boards). Never on the match's path: fire and forget. */
  add(profileKey: string, name: string, xp: number): void {
    if (!profileKey || !(xp > 0)) return;
    const kind = Leaderboard.kindOf(profileKey);
    void this.shared.zincr(this.key(kind), profileKey, Math.round(xp), KEEP_S).catch(() => {});
    void this.shared.hset(`lb:names:${kind}`, profileKey, name.slice(0, 24)).catch(() => {});
  }

  async top(kind: "ll" | "em", n: number, me: string | null): Promise<{ week: string; rows: BoardRow[]; me: { place: number; xp: number } | null }> {
    const week = isoWeek();
    const key = this.key(kind, week);
    const top = await this.shared.ztop(key, Math.max(1, Math.min(50, n)));
    const names = await this.shared.hmget(`lb:names:${kind}`, top.map(([m]) => m));
    const rows = top.map(([m, xp], i) => ({ name: names[i] ?? "Player", xp, ...(m === me ? { you: true } : {}) }));
    const mine = me && Leaderboard.kindOf(me) === kind ? await this.shared.zrank(key, me) : null;
    return { week, rows, me: mine ? { place: mine.place + 1, xp: mine.score } : null };
  }
}
