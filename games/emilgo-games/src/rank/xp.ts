// XP for a match or a run (SPEC-V3 §2.2–2.3). The server works these out from
// what it refereed (a phone never says how much XP it earned); the formulas
// live here so the results screen can explain them.

export interface MatchFacts {
  /** Players in the match (humans; a solo run is 1). */
  players: number;
  /** 1 = best. Squads use the squad's place. */
  place: number;
  won: boolean;
  /** Still there at the end (a quitter earns nothing). */
  stayed: boolean;
  /** The mode's own measure for this player, and the best anyone managed (0 if none). */
  objective: number;
  objectiveTop: number;
  /** Shoves that moved a rival somewhere bad, ball/flag steals, Airfall crates opened, help-ups. */
  displacements?: number;
  steals?: number;
  crates?: number;
  assists?: number;
  /** Rivals killed (v5: kills are rewarded too). */
  kills?: number;
  /** v7 (H10): Treasure Hunt bounties claimed (the leader killed). */
  bounties?: number;
  ranked?: boolean;
  /** The first counted match of the player's day (the server knows). */
  firstToday?: boolean;
  /**
   * How long the match ran, seconds. Shorter than a full match (8 min) pays
   * in proportion, so a string of one-minute rounds can't out-earn real play.
   */
  seconds?: number;
}

/** XP per rival killed, and the most kills can earn in a match. */
export const KILL_XP = 8;
export const KILL_XP_CAP = 80;

/** v7 (H10): XP per bounty claimed, and the most claims that pay in a match. */
export const BOUNTY_XP = 40;
export const BOUNTY_MAX = 3;

/** A full match: XP is paid in proportion below this. */
export const FULL_MATCH_S = 480;

/** Free For All (and, until it is hidden, an online Red Light, Green Light round). */
export function matchXp(f: MatchFacts): number {
  if (!f.stayed) return 0;
  return Math.round(xpParts(f).reduce((a, p) => a + p.xp, 0));
}

/** One line of the rewards screen: what earned it, and how much (unrounded). */
export interface XpPart {
  label: string;
  xp: number;
  /** "×3" (kills), "×2" (ranked): shown beside the label. */
  note?: string;
}

/** matchXp, line by line, for the rewards screen (v5: "a screen for acquiring rewards"). The lines add up to matchXp. */
export function xpParts(f: MatchFacts): XpPart[] {
  if (!f.stayed) return [];
  const n = Math.max(1, f.players);
  const out: XpPart[] = [{ label: "Match played", xp: 60 }];
  const placement = n > 1 ? (120 * (n - Math.min(n, Math.max(1, f.place)))) / (n - 1) : 0;
  if (placement > 0) out.push({ label: "Placement", xp: placement });
  if (f.won) out.push({ label: "Victory", xp: 150 });
  const objective = f.objectiveTop > 0 ? 100 * clamp01(f.objective / f.objectiveTop) : 0;
  if (objective > 0) out.push({ label: "Objective", xp: objective });
  const kills = f.kills ?? 0;
  if (kills > 0) out.push({ label: "Kills", xp: Math.min(KILL_XP_CAP, KILL_XP * kills), note: `×${kills}` });
  const bounties = Math.min(BOUNTY_MAX, f.bounties ?? 0);
  if (bounties > 0) out.push({ label: "Bounty", xp: BOUNTY_XP * bounties, note: `×${bounties}` });
  const play = Math.min(40, 4 * (f.displacements ?? 0) + 6 * (f.steals ?? 0) + 5 * (f.crates ?? 0) + 3 * (f.assists ?? 0));
  if (play > 0) out.push({ label: "Big plays", xp: play });
  const base = out.reduce((a, p) => a + p.xp, 0);
  const share = f.seconds !== undefined ? Math.min(1, Math.max(0.1, f.seconds / FULL_MATCH_S)) : 1;
  if (share < 1) out.push({ label: "Short match", xp: base * share - base, note: `${Math.round(share * 100)}%` });
  if (f.ranked) out.push({ label: "Ranked", xp: base * share, note: "×2" });
  if (f.firstToday) out.push({ label: "First match today", xp: 100 });
  return out;
}

export interface RunFacts {
  finished: boolean;
  /** Seconds from the start to the Mast (finished runs). */
  seconds: number;
  /** 0…1 along the route (runs that didn't finish). */
  route: number;
  kills: number;
  headshots: number;
  lore: number;
  /** Juju charms taken (voluntary handicaps): 1 … 1.5. */
  charm?: number;
  ranked?: boolean;
  firstToday?: boolean;
}

/** Dead Streets: deliberately below Free For All per hour (the owner: FFA ranks you faster). */
export function runXp(f: RunFacts): number {
  let xp = f.finished ? 100 + 80 * clamp01((720 - f.seconds) / 360) : 80 * clamp01(f.route);
  xp += Math.min(60, 1.5 * f.kills) + Math.min(45, 1.5 * f.headshots) + Math.min(15, 5 * f.lore);
  xp *= Math.min(1.5, Math.max(1, f.charm ?? 1));
  if (f.ranked) xp *= 2;
  if (f.firstToday) xp += 100;
  return Math.round(xp);
}

/** Dead Streets' leaderboard number (separate from XP: the board is about speed and skill). */
export function runScore(f: RunFacts): number {
  if (!f.finished) return Math.round(20 * Math.max(0, f.route) * 1400);
  return Math.max(1, Math.round(10000 - 5 * f.seconds + 25 * f.kills + 40 * f.headshots + 100 * f.lore));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
