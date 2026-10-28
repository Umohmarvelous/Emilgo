// The rank ladder (SPEC-V3 §2): one ladder for every mode, read by the phones
// AND the server. A rank is worked out from a player's total XP and nothing
// else, so adding a tier never moves anyone: it is one more name in TIERS.
//
// Cost of a division, in hours of skilled Free For All play at XP_PER_HOUR:
//   Rookie 0.5, 1, 1.5 · Pro 5, 7, 10 · Legendary 20, 25, 35
//   from Master on, every division of tier t costs 45 + 15·(t − 3) hours
// so Legendary I takes about 25 hours and Master I about 105 (the owner's
// "20–30 hours" and "100+ hours"), and a tier added later already has a price.

/** What a skilled player earns in an hour of Free For All (about 5.5 matches × 270). */
export const XP_PER_HOUR = 1500;

export interface Tier {
  id: string;
  name: string;
}

/** The named tiers, lowest first. New tiers go on the end; nothing else changes. */
export const TIERS: readonly Tier[] = [
  { id: "rookie", name: "Rookie" },
  { id: "pro", name: "Pro" },
  { id: "legendary", name: "Legendary" },
  { id: "master", name: "Master" },
  { id: "grandmaster", name: "Grandmaster" },
  { id: "mythic", name: "Mythic" },
  { id: "titan", name: "Titan" },
];

/** Divisions per tier (I, II, III). */
export const DIVISIONS = 3;

/** Hours for each division of the first three tiers (hand-set: quick at first, then slow). */
const EARLY_HOURS: readonly number[] = [0.5, 1, 1.5, 5, 7, 10, 20, 25, 35];

/** Hours to climb out of division `k` (0 = Rookie I), for any k: the formula runs on past the named tiers. */
export function divisionHours(k: number): number {
  if (k < EARLY_HOURS.length) return EARLY_HOURS[k];
  const tier = Math.floor(k / DIVISIONS);
  return 45 + 15 * (tier - 3);
}

/** XP to climb out of division k. */
export function divisionCost(k: number): number {
  return Math.round(divisionHours(k) * XP_PER_HOUR);
}

/** Total XP at which division k begins (0 for Rookie I). */
export function divisionStart(k: number): number {
  let total = 0;
  for (let i = 0; i < k; i++) total += divisionCost(i);
  return total;
}

const ROMAN = ["I", "II", "III", "IV", "V"];

export interface Rank {
  /** 0-based division index across the whole ladder (0 = Rookie I). */
  k: number;
  tier: Tier;
  /** 1-based division within the tier. */
  division: number;
  /** "Legendary II". */
  name: string;
  /** XP into this division, and the XP the division costs. */
  into: number;
  need: number;
  /** True at the top named division: further XP is banked until a new tier is added. */
  top: boolean;
}

/** The last division that has a name. */
export const TOP_DIVISION = TIERS.length * DIVISIONS - 1;

export function rankOf(xp: number): Rank {
  let left = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  let k = 0;
  while (k < TOP_DIVISION && left >= divisionCost(k)) {
    left -= divisionCost(k);
    k++;
  }
  const tier = TIERS[Math.floor(k / DIVISIONS)];
  const division = (k % DIVISIONS) + 1;
  return {
    k,
    tier,
    division,
    name: `${tier.name} ${ROMAN[division - 1]}`,
    into: left,
    need: divisionCost(k),
    top: k === TOP_DIVISION,
  };
}

/** Did going from `before` to `after` XP cross into a new division? Returns the new rank if so. */
export function rankUp(before: number, after: number): Rank | null {
  const a = rankOf(before);
  const b = rankOf(after);
  return b.k > a.k ? b : null;
}
