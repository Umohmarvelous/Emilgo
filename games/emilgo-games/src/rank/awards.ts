// Awards (v6 max, 3.10: "badges, achievements, milestones, shown on the
// character and the profile"). Pure: no DOM; the phone keeps them, as it keeps
// CP and the day's challenges (game/session.ts), from what each match did.
//
//   milestones    a running count with four steps (Bronze, Silver, Gold,
//                 Diamond): matches, wins, kills, head shots, treasures found…
//   achievements  one match's feat, once: five kills in a match, a flawless
//                 win, both boosters at once, a run to the Mast under 7 min…
//   badges        every step and feat reached is a badge; one is worn: over
//                 the head in a match, beside the name in the lobby, on the
//                 profile. Each pays CP once, when it's reached (CP is earned
//                 only by playing: an award is reached only by playing).
//
// Ids are kept for ever (saves and the wire carry them); new awards go last.

export const AWARD_TIERS = ["Bronze", "Silver", "Gold", "Diamond"] as const;
/** CP for reaching each milestone step, and for an achievement (its own figure when it has one). */
export const TIER_CP = [25, 50, 100, 250] as const;
export const FEAT_CP = 40;

/** What is counted, over every match. */
export const STAT_IDS = [
  "matches", "wins", "podiums", "kills", "heads", "treasures", "uploads", "crates", "items", "downs", "helps", "swum", "runs", "seconds",
] as const;
export type StatId = (typeof STAT_IDS)[number];

/** What one match did, from the phone's own view of it (modes/ffa.ts tallies it). */
export interface MatchFeats {
  /** The mode's id ("treasure-hunt", "dead-streets"…). */
  mode: string;
  online: boolean;
  ranked: boolean;
  won: boolean;
  /** 1 = first; 0 unknown. Sides: squads (or players) in the match. */
  place: number;
  sides: number;
  seconds: number;
  kills: number;
  heads: number;
  /** Times you went down for good (eliminated / killed). */
  deaths: number;
  treasures: number;
  uploads: number;
  crates: number;
  items: number;
  /** The boosters taken this match ("strength-booster", "speed-booster"). */
  boosters: string[];
  /** Rivals knocked down with your hands. */
  downs: number;
  helps: number;
  /** Metres swum. */
  swum: number;
  /** A Dead Streets run. */
  run?: { finished: boolean; seconds: number; kills: number; heads: number; hurt: number };
  /** The hour on the phone's clock when it ended (0–23). */
  hour: number;
}

export interface AwardDef {
  id: string;
  name: string;
  blurb: string;
  /** An icon from ui/icons.ts. */
  icon: string;
  /** A milestone: the count, and its four steps. */
  stat?: StatId;
  steps?: readonly [number, number, number, number];
  /** Shown as (the count over its unit): "m", "h". */
  unit?: "m" | "h";
  /** An achievement: did this match do it? (`s`: the counts with this match in, `streak`: wins in a row now). */
  feat?: (f: MatchFeats, s: AwardState, streak: number) => boolean;
  cp?: number;
}

const BOOST_IDS = ["strength-booster", "speed-booster"];

export const AWARDS: readonly AwardDef[] = [
  // ── Milestones ──
  { id: "veteran", name: "Veteran", blurb: "Matches played", icon: "star", stat: "matches", steps: [10, 50, 250, 1000] },
  { id: "champion", name: "Champion", blurb: "Matches won", icon: "trophy", stat: "wins", steps: [1, 10, 50, 250] },
  { id: "podium", name: "On the Podium", blurb: "Top-three finishes", icon: "medal", stat: "podiums", steps: [5, 25, 100, 500] },
  { id: "marksman", name: "Marksman", blurb: "Rivals taken out", icon: "target", stat: "kills", steps: [25, 250, 1000, 5000] },
  { id: "headhunter", name: "Head Hunter", blurb: "Head-shot kills", icon: "sight", stat: "heads", steps: [10, 100, 500, 2500] },
  { id: "seeker", name: "Treasure Seeker", blurb: "Treasures found", icon: "chest", stat: "treasures", steps: [5, 50, 250, 1000] },
  { id: "banker", name: "Banker", blurb: "Treasures uploaded", icon: "upload", stat: "uploads", steps: [1, 20, 100, 500] },
  { id: "scavenger", name: "Scavenger", blurb: "Airfall crates opened", icon: "crate", stat: "crates", steps: [5, 50, 200, 1000] },
  { id: "gadgeteer", name: "Gadgeteer", blurb: "Items used", icon: "bolt", stat: "items", steps: [10, 100, 500, 2500] },
  { id: "brawler", name: "Brawler", blurb: "Rivals knocked down by hand", icon: "fist", stat: "downs", steps: [10, 100, 500, 2500] },
  { id: "lifeline", name: "Lifeline", blurb: "Squad mates helped up", icon: "heal", stat: "helps", steps: [5, 50, 250, 1000] },
  { id: "swimmer", name: "River Rat", blurb: "Metres swum", icon: "wave", stat: "swum", steps: [100, 1000, 10000, 50000], unit: "m" },
  { id: "survivor", name: "Survivor", blurb: "Dead Streets runs to the Mast", icon: "flag", stat: "runs", steps: [1, 10, 50, 200] },
  { id: "dedicated", name: "Dedicated", blurb: "Hours played", icon: "timer", stat: "seconds", steps: [3600, 36000, 180000, 720000], unit: "h" },
  // ── Achievements ──
  { id: "rampage", name: "Rampage", blurb: "5 kills in one match", icon: "fire", feat: (f) => f.kills >= 5 },
  { id: "massacre", name: "Unstoppable Force", blurb: "10 kills in one match", icon: "slay", feat: (f) => f.kills >= 10, cp: 75 },
  { id: "sharpshooter", name: "Sharpshooter", blurb: "3 head-shot kills in one match", icon: "sight", feat: (f) => f.heads >= 3 },
  { id: "flawless", name: "Flawless", blurb: "Win without going down (4 sides or more)", icon: "crown", feat: (f) => f.won && f.deaths === 0 && f.sides >= 4, cp: 75 },
  { id: "clutch", name: "Last One Standing", blurb: "Win against 8 sides or more", icon: "crown", feat: (f) => f.won && f.sides >= 8, cp: 75 },
  { id: "hoarder", name: "Hoarder", blurb: "Find 5 treasures in one Treasure Hunt", icon: "chest", feat: (f) => f.mode === "treasure-hunt" && f.treasures >= 5 },
  { id: "hunt-king", name: "King of the Hunt", blurb: "Win a Treasure Hunt", icon: "crown", feat: (f) => f.mode === "treasure-hunt" && f.won },
  { id: "overcharged", name: "Overcharged", blurb: "Both boosters in one match", icon: "flex", feat: (f) => BOOST_IDS.every((b) => f.boosters.includes(b)) },
  { id: "hot-streak", name: "Hot Streak", blurb: "3 wins in a row", icon: "fire", feat: (f, _s, streak) => f.won && streak >= 3 },
  { id: "dynasty", name: "Dynasty", blurb: "5 wins in a row", icon: "trophy", feat: (f, _s, streak) => f.won && streak >= 5, cp: 100 },
  { id: "ranked-win", name: "Ranked Victor", blurb: "Win a ranked match", icon: "medal", feat: (f) => f.won && f.ranked, cp: 75 },
  { id: "speedrun", name: "Mast Sprinter", blurb: "Reach the Mast in under 7 minutes", icon: "timer", feat: (f) => !!f.run?.finished && f.run.seconds < 420, cp: 75 },
  { id: "untouched", name: "Untouched", blurb: "Reach the Mast without a scratch", icon: "brace", feat: (f) => !!f.run?.finished && f.run.hurt <= 0, cp: 100 },
  { id: "night-owl", name: "Night Owl", blurb: "Finish a match between midnight and 4 am", icon: "moon", feat: (f) => f.hour >= 0 && f.hour < 4 },
  { id: "explorer", name: "Explorer", blurb: "Play 5 different modes", icon: "map", feat: (_f, s) => s.modes.length >= 5 },
  { id: "deep-end", name: "In the Deep End", blurb: "Swim 100 m in one match", icon: "wave", feat: (f) => f.swum >= 100 },
];

export const AWARD_BY_ID: Readonly<Record<string, AwardDef>> = Object.fromEntries(AWARDS.map((a) => [a.id, a]));

/** What the phone keeps. */
export interface AwardState {
  stats: Record<StatId, number>;
  /** Reached: a milestone's step (1 … 4), an achievement's 1. */
  got: Record<string, number>;
  /** The modes played (Explorer). */
  modes: string[];
  /** Wins in a row, on this phone. */
  streak: number;
  /** The badge worn: "<id>" (a milestone's best step), or "" none. */
  wear: string;
  /** Reached but not looked at yet (the Awards button's dot). */
  fresh: string[];
}

export function freshAwards(): AwardState {
  return { stats: Object.fromEntries(STAT_IDS.map((k) => [k, 0])) as Record<StatId, number>, got: {}, modes: [], streak: 0, wear: "", fresh: [] };
}

/** One award reached: which, its step (1 … 4; an achievement 1), the CP it pays. */
export interface Unlock {
  id: string;
  tier: number;
  cp: number;
}

/** A milestone's step for a count (0: not yet). */
export function stepOf(def: AwardDef, n: number): number {
  if (!def.steps) return 0;
  let k = 0;
  while (k < 4 && n >= def.steps[k]) k++;
  return k;
}

/** A count in its unit (hours, metres), for the screen. */
export function shown(def: AwardDef, n: number): number {
  return def.unit === "h" ? Math.floor(n / 3600) : Math.floor(n);
}

/**
 * One match in: the counts go up, and what it reached comes out (each pays
 * once). Quitting in the first minute counts nothing (no farming by walking out).
 */
export function recordMatch(s: AwardState, f: MatchFeats): Unlock[] {
  if (f.seconds < 60 && !f.won && !f.run?.finished) return [];
  const add = (k: StatId, v: number) => (s.stats[k] = Math.max(0, (s.stats[k] ?? 0) + Math.max(0, Number.isFinite(v) ? v : 0)));
  add("matches", 1);
  if (f.won) add("wins", 1);
  if (f.place > 0 && f.place <= 3 && f.sides > 3) add("podiums", 1);
  add("kills", f.kills + (f.run?.kills ?? 0));
  add("heads", f.heads + (f.run?.heads ?? 0));
  add("treasures", f.treasures);
  add("uploads", f.uploads);
  add("crates", f.crates);
  add("items", f.items);
  add("downs", f.downs);
  add("helps", f.helps);
  add("swum", f.swum);
  if (f.run?.finished) add("runs", 1);
  add("seconds", Math.min(3600, f.seconds));
  if (f.mode && !s.modes.includes(f.mode)) s.modes = [...s.modes, f.mode].slice(0, 40);
  // A run has no rivals to beat: it neither makes nor breaks a streak.
  if (!f.run) s.streak = f.won ? s.streak + 1 : 0;
  const out: Unlock[] = [];
  for (const def of AWARDS) {
    const had = s.got[def.id] ?? 0;
    if (def.stat) {
      const now = stepOf(def, s.stats[def.stat]);
      for (let k = had + 1; k <= now; k++) out.push({ id: def.id, tier: k, cp: TIER_CP[k - 1] });
      if (now > had) s.got[def.id] = now;
    } else if (!had && def.feat?.(f, s, s.streak)) {
      s.got[def.id] = 1;
      out.push({ id: def.id, tier: 1, cp: def.cp ?? FEAT_CP });
    }
  }
  for (const u of out) if (!s.fresh.includes(u.id)) s.fresh.push(u.id);
  return out;
}

/** The badge a wire look carries: "<id>.<step>" for a reached award; anything else, none. */
export function badgeOf(s: AwardState): string {
  const k = s.got[s.wear] ?? 0;
  return s.wear && k > 0 ? `${s.wear}.${k}` : "";
}

/** A wire badge, checked: [def, step] or null. */
export function parseBadge(v: unknown): [AwardDef, number] | null {
  if (typeof v !== "string" || v.length > 24) return null;
  const m = /^([a-z-]+)\.([1-4])$/.exec(v);
  const def = m ? AWARD_BY_ID[m[1]] : undefined;
  if (!m || !def) return null;
  const k = Number(m[2]);
  return def.stat || k === 1 ? [def, k] : null;
}

/** How many badges there are to reach (every milestone step and every achievement), and how many are. */
export function badgeCount(s: AwardState): { got: number; all: number } {
  let got = 0;
  let all = 0;
  for (const d of AWARDS) {
    all += d.stat ? 4 : 1;
    got += s.got[d.id] ?? 0;
  }
  return { got, all };
}

/** A saved state, checked (an edited or broken save keeps what's valid). */
export function cleanAwards(v: unknown): AwardState {
  const out = freshAwards();
  const a = v as Partial<AwardState> | null;
  if (!a || typeof a !== "object") return out;
  for (const k of STAT_IDS) {
    const n = Number(a.stats?.[k]);
    out.stats[k] = Number.isFinite(n) && n > 0 ? Math.min(1e9, n) : 0;
  }
  for (const def of AWARDS) {
    const n = Math.floor(Number(a.got?.[def.id]));
    if (Number.isFinite(n) && n > 0) out.got[def.id] = Math.min(def.stat ? 4 : 1, n);
  }
  out.modes = Array.isArray(a.modes) ? a.modes.filter((m): m is string => typeof m === "string" && m.length < 40).slice(0, 40) : [];
  out.streak = Math.max(0, Math.floor(Number(a.streak)) || 0);
  out.wear = typeof a.wear === "string" && out.got[a.wear] ? a.wear : "";
  out.fresh = Array.isArray(a.fresh) ? a.fresh.filter((id): id is string => typeof id === "string" && !!out.got[id]) : [];
  return out;
}

/** A bot's badge (practice and filled seats): about half wear one, mostly low steps, as real players would. */
export function botBadge(seed: number, i: number): string {
  let a = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (r() < 0.5) return "";
  const pick = AWARDS[Math.floor(r() * AWARDS.length)];
  const k = pick.stat ? 1 + Math.floor(r() * r() * 4) : 1;
  return `${pick.id}.${k}`;
}
