// CP boosts (SPEC-V2 §7.7): small edges bought with CP, the in-game currency
// earned only by playing. Never with money. Shared by the phone and the
// server: the referee applies them, in Solo and free matches only — never in
// a staked Lagos Life match (the owner, 17 Oct 2026).
//
// Each purchase is a pack of BOOST_ROUNDS rounds. Switch on up to BOOST_SLOTS
// before a round; each one switched on uses a round when the round starts.
// Online the server takes a phone's word for which boosts it brings (CP lives
// on the phone, like your level), but it never allows more than BOOST_SLOTS:
// the most anyone can bring is what anyone can buy by playing.

export type BoostId =
  | "quick_feet"
  | "sprinter"
  | "second_wind"
  | "fast_breath"
  | "cool_head"
  | "iron_grip"
  | "quick_hands"
  | "thick_skin"
  | "rooted"
  | "long_arm"
  | "quick_fists"
  | "low_rider";

/** What a contestant's boosts change. 1 (or 0 for the additive ones) is no change. */
export interface BoostMods {
  /** Walk and run speed ×. */
  speed: number;
  /** Sprint speed ×. */
  sprint: number;
  /** Crouch and prone speed ×. */
  crouch: number;
  /** How long a full bar of stamina lasts ×. */
  stamina: number;
  /** How fast stamina refills ×. */
  refill: number;
  /** Extra seconds before her stare counts you (freeze resistance). */
  grace: number;
  /** Hits a round that don't knock your ball loose (ball grip). */
  grip: number;
  /** Time to pick a ball up ×. */
  grab: number;
  /** Time stunned when hit ×. */
  stun: number;
  /** How far a hit knocks you ×. */
  knock: number;
  /** Extra reach for your attacks, metres. */
  reach: number;
  /** Attack cooldowns ×. */
  cool: number;
}

export const NO_BOOST: Readonly<BoostMods> = Object.freeze({ speed: 1, sprint: 1, crouch: 1, stamina: 1, refill: 1, grace: 0, grip: 0, grab: 1, stun: 1, knock: 1, reach: 0, cool: 1 });

export interface Boost {
  id: BoostId;
  name: string;
  /** What it does, plainly, with the number. */
  blurb: string;
  /** CP for a pack of BOOST_ROUNDS rounds. */
  cp: number;
  icon: string;
  /** Only does anything in Ball Haunting. */
  balls?: true;
  mods: Partial<BoostMods>;
}

/** Boosts a player may switch on for one round. */
export const BOOST_SLOTS = 2;
/** Rounds in one pack. */
export const BOOST_ROUNDS = 3;

export const BOOSTS: readonly Boost[] = [
  { id: "quick_feet", name: "Quick Feet", blurb: "Walk and run 4% faster.", cp: 120, icon: "sprint", mods: { speed: 1.04 } },
  { id: "sprinter", name: "Sprinter", blurb: "Sprint 4% faster.", cp: 120, icon: "bolt", mods: { sprint: 1.04 } },
  { id: "second_wind", name: "Second Wind", blurb: "A full stamina bar lasts 25% longer.", cp: 80, icon: "timer", mods: { stamina: 1.25 } },
  { id: "fast_breath", name: "Fast Breath", blurb: "Stamina refills 25% faster.", cp: 80, icon: "refresh", mods: { refill: 1.25 } },
  { id: "cool_head", name: "Cool Head", blurb: "Freeze resistance: a tenth of a second more before her stare counts you.", cp: 150, icon: "eye", mods: { grace: 0.1 } },
  { id: "iron_grip", name: "Iron Grip", blurb: "Ball grip: the first hit each round doesn't knock your ball loose.", cp: 120, icon: "ball", balls: true, mods: { grip: 1 } },
  { id: "quick_hands", name: "Quick Hands", blurb: "Pick a ball up 40% faster.", cp: 60, icon: "grab", balls: true, mods: { grab: 0.6 } },
  { id: "thick_skin", name: "Thick Skin", blurb: "Stunned 30% shorter when hit.", cp: 80, icon: "body", mods: { stun: 0.7 } },
  { id: "rooted", name: "Rooted", blurb: "Knocked back 30% less.", cp: 80, icon: "push", mods: { knock: 0.7 } },
  { id: "long_arm", name: "Long Arm", blurb: "Your fist, slap and push reach 0.3 m further.", cp: 100, icon: "fist", mods: { reach: 0.3 } },
  { id: "quick_fists", name: "Quick Fists", blurb: "Attack again 20% sooner.", cp: 100, icon: "slap", mods: { cool: 0.8 } },
  { id: "low_rider", name: "Low Rider", blurb: "Crouch and crawl 20% faster.", cp: 60, icon: "crouch", mods: { crouch: 1.2 } },
];

export const BOOST_IDS: readonly BoostId[] = BOOSTS.map((b) => b.id);
export const BOOST_BY_ID: Record<BoostId, Boost> = Object.fromEntries(BOOSTS.map((b) => [b.id, b])) as Record<BoostId, Boost>;

/** The mods of a set of boosts (at most BOOST_SLOTS, unknown ids ignored). */
export function modsOf(ids: readonly string[] | undefined): Readonly<BoostMods> {
  const list = cleanBoostList(ids);
  if (!list.length) return NO_BOOST;
  const m: BoostMods = { ...NO_BOOST };
  for (const id of list) {
    const b = BOOST_BY_ID[id].mods;
    for (const k of Object.keys(b) as (keyof BoostMods)[]) {
      if (k === "grace" || k === "grip" || k === "reach") m[k] += b[k]!;
      else m[k] *= b[k]!;
    }
  }
  return Object.freeze(m);
}

/** Known ids, no repeats, at most BOOST_SLOTS. */
export function cleanBoostList(ids: readonly unknown[] | undefined): BoostId[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((x): x is BoostId => typeof x === "string" && (BOOST_IDS as string[]).includes(x)))].slice(0, BOOST_SLOTS);
}

/** Boost charges from a save: known ids, whole numbers 1…999. */
export function cleanBoosts(v: unknown): Partial<Record<BoostId, number>> {
  const out: Partial<Record<BoostId, number>> = {};
  if (!v || typeof v !== "object") return out;
  for (const id of BOOST_IDS) {
    const n = (v as Record<string, unknown>)[id];
    if (typeof n === "number" && Number.isFinite(n) && n >= 1) out[id] = Math.min(999, Math.floor(n));
  }
  return out;
}

/** Boosts on the wire: indexes into BOOSTS. */
export function boostsToWire(ids: readonly BoostId[]): number[] {
  return ids.map((id) => BOOST_IDS.indexOf(id)).filter((i) => i >= 0);
}
export function boostsFromWire(v: unknown): BoostId[] {
  return Array.isArray(v) ? cleanBoostList(v.map((i) => (Number.isInteger(i) ? BOOST_IDS[i as number] : undefined))) : [];
}

/** CP for one round (§7.7: earned only by playing). The tutorial earns none. */
export function cpForRound(r: { finished: boolean; first: boolean; online: boolean }): number {
  return 10 + (r.finished ? 15 : 0) + (r.first ? 10 : 0) + (r.online ? 5 : 0);
}
