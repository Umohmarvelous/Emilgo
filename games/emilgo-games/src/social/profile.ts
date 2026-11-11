// The player's profile and direct messages (v6 max, 3.11: "the player's
// profile: every stat, the awards, the history, part of it public; text chat in
// the lobby, the match and the profile; direct messages"). Pure: no DOM.
//
//   history   the last 30 matches on this phone (mode, place, kills, CP, when)
//   card      the public part: what others see when they open your profile
//             (your rank, worn badge, matches, wins, kills, head shots, badges,
//             commends, your form). Private: name, rank and badge only
//   threads   direct messages with friends, kept on this phone: the last 60
//             lines each. They pass only between friends who list each other
//             (the server checks), cleaned like chat: no numbers, links,
//             handles or addresses. Report and block in every thread

import type { WireCard } from "../net/protocol";
import { badgeCount, badgeOf, type AwardState } from "../rank/awards";

export interface MatchRecord {
  /** The mode's name ("Treasure Hunt"). */
  mode: string;
  won: boolean;
  place: number;
  sides: number;
  kills: number;
  cp: number;
  online: boolean;
  /** When it ended (ms since 1970). */
  at: number;
}

export const HISTORY_MAX = 30;

export function addHistory(list: MatchRecord[], r: MatchRecord): MatchRecord[] {
  return [r, ...list].slice(0, HISTORY_MAX);
}

export function cleanHistory(v: unknown): MatchRecord[] {
  if (!Array.isArray(v)) return [];
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return v
    .filter((r) => r && typeof r === "object" && typeof r.mode === "string")
    .slice(0, HISTORY_MAX)
    .map((r) => ({ mode: String(r.mode).slice(0, 40), won: r.won === true, place: n(r.place), sides: n(r.sides), kills: n(r.kills), cp: n(r.cp), online: r.online === true, at: n(r.at) }));
}

export interface DmLine {
  me: boolean;
  text: string;
  at: number;
  /** Mine: held for when they come on, or not sent (why). */
  held?: boolean;
  fail?: string;
  /** Mine, waiting for the server's word (its number). */
  n?: number;
}

export interface DmThread {
  name: string;
  lines: DmLine[];
  unread: number;
}

export const DM_LINES = 60;
export const DM_THREADS = 40;

export function cleanDms(v: unknown): Record<string, DmThread> {
  const out: Record<string, DmThread> = {};
  if (!v || typeof v !== "object") return out;
  for (const [fid, t] of Object.entries(v as Record<string, unknown>).slice(0, DM_THREADS)) {
    const th = t as Partial<DmThread> | null;
    if (!/^[A-Za-z0-9_-]{16}$/.test(fid) || !th || typeof th.name !== "string" || !Array.isArray(th.lines)) continue;
    out[fid] = {
      name: th.name.slice(0, 40),
      unread: Math.max(0, Math.min(99, Math.floor(Number(th.unread)) || 0)),
      lines: th.lines
        .filter((l): l is DmLine => !!l && typeof l.text === "string" && typeof l.at === "number")
        .slice(-DM_LINES)
        // A line that never heard back before the phone closed: not sent.
        .map((l) => ({ me: l.me === true, text: l.text.slice(0, 200), at: l.at, ...(l.held ? { held: true } : {}), ...(l.fail || l.n !== undefined ? { fail: l.fail ?? "Not sent" } : {}) })),
    };
  }
  return out;
}

/** A line into a thread (made when it's the first); the oldest go past DM_LINES, the quietest threads past DM_THREADS. */
export function addDm(threads: Record<string, DmThread>, fid: string, name: string, line: DmLine): DmThread {
  const th = threads[fid] ?? { name, lines: [], unread: 0 };
  th.name = name || th.name;
  th.lines = [...th.lines, line].slice(-DM_LINES);
  if (!line.me) th.unread = Math.min(99, th.unread + 1);
  threads[fid] = th;
  const keys = Object.keys(threads);
  if (keys.length > DM_THREADS) {
    const last = (k: string) => threads[k].lines[threads[k].lines.length - 1]?.at ?? 0;
    keys.sort((a, b) => last(a) - last(b));
    for (const k of keys.slice(0, keys.length - DM_THREADS)) delete threads[k];
  }
  return th;
}

export function unreadDms(threads: Record<string, DmThread>): number {
  return Object.values(threads).reduce((a, t) => a + t.unread, 0);
}

/** My public card, from what the phone keeps. */
export function myCard(s: { awards: AwardState; honour: number; form: string; cardPublic: boolean }, rank: number): WireCard {
  const a = s.awards;
  return {
    r: rank,
    ...(badgeOf(a) ? { aw: badgeOf(a) } : {}),
    m: a.stats.matches,
    w: a.stats.wins,
    k: a.stats.kills,
    hs: a.stats.heads,
    b: badgeCount(a).got,
    h: s.honour,
    ...(s.form ? { f: s.form.slice(0, 5) } : {}),
    ...(s.cardPublic ? {} : { p: 1 as const }),
  };
}
