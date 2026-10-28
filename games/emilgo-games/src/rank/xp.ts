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
  ranked?: boolean;
  /** The first counted match of the player's day (the server knows). */
  firstToday?: boolean;
  /**
   * How long the match ran, seconds. Shorter than a full match (8 min) pays
   * in proportion, so a string of one-minute rounds can't out-earn real play.
   */
  seconds?: number;
}

/** A full match: XP is paid in proportion below this. */
export const FULL_MATCH_S = 480;

/** Free For All (and, until it is hidden, an online Red Light, Green Light round). */
export function matchXp(f: MatchFacts): number {
  if (!f.stayed) return 0;
  const n = Math.max(1, f.players);
  const placement = n > 1 ? (120 * (n - Math.min(n, Math.max(1, f.place)))) / (n - 1) : 0;
  const objective = f.objectiveTop > 0 ? 100 * clamp01(f.objective / f.objectiveTop) : 0;
  const play = Math.min(40, 4 * (f.displacements ?? 0) + 6 * (f.steals ?? 0) + 5 * (f.crates ?? 0) + 3 * (f.assists ?? 0));
  let xp = 60 + placement + (f.won ? 150 : 0) + objective + play;
  if (f.seconds !== undefined) xp *= Math.min(1, Math.max(0.1, f.seconds / FULL_MATCH_S));
  if (f.ranked) xp *= 2;
  if (f.firstToday) xp += 100;
  return Math.round(xp);
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
