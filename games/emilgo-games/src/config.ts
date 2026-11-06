// Every gameplay number in one place. The rules engine reads these, the server
// will read the same file in Phase 2, so a tuning change cannot leave the client
// and the referee disagreeing about what "moving" means.
//
import { pensFor, wallsOf, type Pen, type Wall } from "./game/pens";

// World axes: the field runs along -Z. Contestants start just behind z = 0,
// the finish line is at FIELD.finishZ, and the doll stands beyond it facing +Z.

export const FIELD = {
  /** Start line. Progress is measured as distance past it. */
  startZ: 0,
  /** Finish line. Crossing it (z <= finishZ) is safe. 120 m: at 6 m/s a short track is over before it starts. */
  finishZ: -120,
  /** Contestants are kept inside |x| <= halfWidth. Buildings start past it. */
  halfWidth: 9.2,
  /** Spawn band behind the start line. */
  spawnNearZ: 2.4,
  spawnFarZ: 7.0,
  /** Nobody may wander further back than this. */
  backLimitZ: 9,
  /** Finished contestants walk on into the safe zone and stop here. */
  safeZ: -124,
} as const;

export const DOLL_Z = -131;

/**
 * Switches the developer flips in code (SPEC-V3). Ball Haunt (Red Light,
 * Green Light) is hidden now that Free For All plays (Phase 4): not in any
 * menu, refused by the server (its tests run one with BALL_HAUNT=1), and its
 * eye in the sky is never made. Phase 11 rebuilt it (Mama gone, the song from
 * the sky, the shared sky laser); it stays hidden until this is switched on.
 *
 * v5: Free For All and Dead Streets each have a switch too. `false` takes that
 * game out of every menu, the lobby and the server. How to use them: README,
 * "Showing and hiding a mode". Leave at least one of the three on.
 */
export const FEATURES: { ballHaunt: boolean; freeForAll: boolean; deadStreets: boolean } = {
  ballHaunt: false,
  freeForAll: true,
  deadStreets: true,
};

/** Is this game family switched on? (Ball Haunt's rooms can also be opened by a test server: see lobby.ts.) */
export function familyOn(f: "ffa" | "survival" | "rlgl"): boolean {
  return f === "ffa" ? FEATURES.freeForAll : f === "survival" ? FEATURES.deadStreets : FEATURES.ballHaunt;
}

// ── Modes and distances (SPEC-V2 §2.1) ───────────────────────────────────────

/** Classic Run: just reach the line. Ball Haunting: reach it holding a ball. */
export type Mode = "classic" | "balls";
export const MODES: readonly Mode[] = ["classic", "balls"];
export const MODE_NAME: Record<Mode, string> = { classic: "Classic Run", balls: "Ball Haunting" };

export type Distance = 100 | 200 | 300;
export const DISTANCES: readonly Distance[] = [100, 200, 300];
export const DEFAULT_DISTANCE: Distance = 200;
/** Fixed per distance — players can't change it (about 2.2 × the time to run it). */
export const TIME_LIMIT: Record<Distance, number> = { 100: 45, 200: 80, 300: 120 };
/**
 * Lagos Life's match API carries only stake and seats — no way to say which
 * mode — so every staked match plays this, and says so before anyone stakes.
 * Ball Haunting with the balls scaled to the seats (1 for 2, 2 for 3, 3 for 4),
 * as the owner chose (SPEC-V2, 17 Oct 2026).
 */
export const STAKED: { mode: Mode; distance: Distance } = { mode: "balls", distance: 200 };

/** One round's ground: where the line is, where she stands, how long you have. */
export interface Course {
  mode: Mode;
  distance: Distance;
  /** Crossing it (z <= finishZ) is safe (in Ball Haunting: with a ball). */
  finishZ: number;
  /** Finished contestants walk on into the safe zone and stop here. */
  safeZ: number;
  dollZ: number;
  timeLimit: number;
  /** The field's half width (the map decides: a street is narrower than a desert). */
  halfWidth: number;
  backLimitZ: number;
  /** Ball Haunting's pens along the edges, and their walls (game/pens.ts; none in Classic Run). */
  pens: readonly Pen[];
  walls: readonly Wall[];
}

export function courseFor(mode: Mode, distance: Distance, halfWidth: number = FIELD.halfWidth): Course {
  const pens = pensFor(mode, distance, halfWidth);
  return {
    mode,
    distance,
    finishZ: -distance,
    safeZ: -distance - 4,
    dollZ: -distance - 11,
    timeLimit: TIME_LIMIT[distance],
    halfWidth,
    backLimitZ: FIELD.backLimitZ,
    pens,
    walls: wallsOf(pens),
  };
}

export const DEFAULT_COURSE: Course = courseFor("classic", DEFAULT_DISTANCE);

// ── Balls, baskets and fighting (SPEC-V2 §2.3–2.4, §4.4) ─────────────────────

export const BALLS = {
  /** 13 balls for 20 players: always fewer balls than players. */
  perPlayer: 0.65,
  /** How close you must be to pick one up, metres. */
  reach: 1.3,
  /** Picking up takes this long — and counts as moving while she watches. */
  grabTime: 0.35,
  /** The attacker can't take the ball they knocked loose for this long, seconds. */
  attackerWait: 3,
  /** Balls lie between these fractions of the course. */
  from: 0.12,
  to: 0.72,
  /** Of the balls, this share (rounded down) lies inside the pens: go in and find them. */
  inPens: 0.5,
  /** Baskets just past the safe line. */
  baskets: 3,
  basketBeyond: 2.4,
} as const;

/** How many balls for this many players: 20 → 13, 4 → 3, 2 → 1. */
export function ballCount(players: number): number {
  return Math.max(1, Math.min(players - 1, Math.round(players * BALLS.perPlayer)));
}

export type AttackKind = "fist" | "slap" | "push";
export const ATTACK_KINDS: readonly AttackKind[] = ["fist", "slap", "push"];

export const ATTACK = {
  /** Attack buttons show, and land, within this distance. */
  range: 2,
  /**
   * cooldown: seconds before you can attack again; stun: the target can't
   * control their runner; knock: how far the target slides, metres.
   * Every attack knocks a held ball loose.
   */
  kinds: {
    fist: { cooldown: 1.6, stun: 0.8, knock: 1.0 },
    slap: { cooldown: 0.8, stun: 0.35, knock: 0.35 },
    push: { cooldown: 1.2, stun: 0.25, knock: 2.4 },
  } satisfies Record<AttackKind, { cooldown: number; stun: number; knock: number }>,
  /** The attacker's swing: counts as moving while she watches (the attacker is shot). */
  swing: 0.35,
  /** After a hit's slide ends, the doll forgives the target this much longer. */
  forgive: 0.2,
} as const;


export const MOVE = {
  walk: 2, // m/s (a small push)
  run: 6, // m/s (a full push)
  sprint: 9, // m/s (sprint button or a double-tap, while stamina lasts)
  crouch: 1.5,
  prone: 0.5,
  /** Stick deflection at which walking becomes running. */
  runAt: 0.72,
  accel: 18, // m/s²
  /** Braking is deliberately sharper than accelerating: letting go must stop you. */
  decel: 28, // m/s²
  /** In the air you keep your speed; steering is weak. */
  airAccel: 4,
  turnRate: 11, // rad/s
  radius: 0.34, // body radius for spacing
  /** Jump: 1.2 m high under 20 m/s² gravity → take-off speed √(2gh). */
  gravity: 20,
  jumpHeight: 1.2,
  /** Seconds of sprint from full stamina, and to refill it from empty. */
  sprintFor: 4.5,
  refillIn: 6,
  /** Stamina refills only after this long without sprinting. */
  refillDelay: 0.8,
  /** Sprint can restart once stamina is back above this. */
  sprintMin: 0.2,
  /** Changing stance takes this long — and counts as moving while she watches. */
  stanceTime: 0.3,
  /**
   * The slide (SPEC-V2 §7.4 #8): crouch while sprinting and you slide on,
   * low, for this long, slowing from sprint to a crouch; you can't steer.
   */
  slideTime: 0.75,
} as const;

/** Stance: 0 standing, 1 crouching, 2 prone. */
export type Stance = 0 | 1 | 2;

/** A sing length: pick a band by weight, then a length inside it. */
export interface SingBands {
  bands: readonly (readonly [number, number])[];
  weights: readonly number[];
}

// Hard mode, by design. The song from the sky never tells you when it ends: it
// plays at its own tempo and is cut wherever the referee likes — 0.7 s in, or
// deep into the second verse. Sometimes the hum comes and the song plays on (a
// feint). The one rule that keeps it fair: nobody is ever caught until the eye
// has visibly opened, plus a short grace. (The phases keep the doll's names:
// "turning" is the eye opening, "turningBack" it closing.)
export const RULES = {
  /** 5 → 1 in the centre, each number a timer tick (SPEC-V3: no bass drops). */
  countdown: 5,
  timeLimit: 45,
  /** The opening song: long enough to get going, never the same length twice. */
  firstSing: { bands: [[1.6, 3], [3, 6]], weights: [0.5, 0.5] } satisfies SingBands,
  /** Short, medium and long songs, mixed so nobody can count them. */
  sing: { bands: [[0.7, 1.8], [1.8, 4.2], [4.2, 7]], weights: [0.35, 0.4, 0.25] } satisfies SingBands,
  /** In the last `lateAt` seconds she sings shorter, more often. */
  lateAt: 15,
  singLate: { bands: [[0.5, 1.2], [1.2, 2.6], [2.6, 4]], weights: [0.45, 0.4, 0.15] } satisfies SingBands,
  /**
   * The warning hum (SPEC-V2 §2.2): 3 seconds of humming under the song before
   * every cut. Some hums are FAKE (the owner's choice, 17 Oct 2026): the hum
   * comes, then the song plays on and the eye stays shut. Players who froze lose time; nobody is
   * ever caught during a hum. A fake never comes twice in a row, nor before
   * the first real cut.
   */
  hum: { length: 3, fakeChance: 0.38 },
  /** The eye opening as the song cuts — still safe to be moving. Varies: some open in a blink. */
  turning: { min: 0.35, max: 0.55 },
  /**
   * Once the eye is open, how long before movement counts: forgiveness for a
   * human thumb. Online, each player also gets their own measured lag on top.
   */
  grace: 0.2,
  watch: { min: 1.5, max: 5 },
  /** The eye closing as the song comes back: safe, and the moment to get a head start. */
  turningBack: 0.4,
  /** Speed above this while the eye watches is "moving". */
  tolerance: 0.2, // m/s
} as const;

/**
 * The match flow before play (SPEC-V2 §1.2–1.3), seconds. The referee holds
 * everyone still through the walkout, so its length is part of the rules:
 * server and phones must agree on it.
 */
export const FLOW = {
  /** Waiting room → walkout: everyone ready, then this long loading. */
  loading: 2,
  /** From the tunnel to their places, filmed from the front, side, behind and overhead. The skip button shows after this. */
  walk: 9,
  /** The field preview: four sweeps … */
  sweep: 1.6,
  sweeps: 4,
  /** … the eye in the sky close up, the balls and baskets (Ball Haunting only), along the field's edge … */
  sky: 2.4,
  balls: 2.2,
  edge: 2.2,
  /** … then back behind the players. */
  behind: 1.4,
} as const;

/** How long the walkout and field preview last for this mode (the countdown follows). */
export function walkoutLength(mode: Mode): number {
  return FLOW.walk + FLOW.sweep * FLOW.sweeps + FLOW.sky + (mode === "balls" ? FLOW.balls : 0) + FLOW.edge + FLOW.behind;
}

/**
 * The final two (SPEC-V2 §2.8): when a third-last runner goes and two are
 * left, the whole room slows — the referee's own clock runs at `scale` for
 * `seconds` of real time — so it stays fair for both (one screen can't slow
 * down alone online).
 */
export const FINAL = { scale: 0.4, seconds: 2.5 } as const;

export const PRACTICE = {
  /** Solo vs AI: a full field of 20 (SPEC-V2 §2.5). */
  bots: 19,
} as const;

// ── Shared gameplay for the open worlds (SPEC-V3 §7, Phase 3) ────────────────

/**
 * The zone (SPEC-V3 §7, §9). A mode's zone phases are [start s, radius m,
 * close over s, exposure rate]; the rate fills the meter at rate × `fill` a
 * second outside the circle, so 1.0 takes 10 s and 4 takes 2.5 s.
 */
export const ZONE = {
  /** The next circle shows this long before it starts closing, seconds. */
  warn: 30,
  fill: 0.1,
  /** Back inside, the meter drains at this a second. */
  drain: 0.125,
  /** The sky laser's slow descent (the warning) before it hits, seconds. */
  laser: 1.2,
} as const;

/** Items and the backpack (SPEC-V3 §3.3, §7). */
export const LOOT = {
  /** Backpack slots. */
  slots: 10,
  /** Pick-up reach, metres, and the most height between your feet and the item. */
  reach: 1.6,
  reachUp: 1.0,
  /** Items scattered per hectare of the world at density 1. */
  perHectare: 8,
  /** The closest two scattered items may lie, metres. */
  spacing: 5,
  /** The share scattered at the named places (the rest anywhere you can walk). */
  atPlaces: 0.55,
  /** A loot bag glows (and shows on the compass) this long, seconds. */
  bagGlow: 60,
} as const;

/** Airfall (SPEC-V3 §10.3): at most 3 a match, a mode's gap apart. */
export const AIRFALL = {
  /** The flare goes up this long before the crate lands, seconds. */
  flare: 20,
  /** Hold to open, seconds; reach, metres. */
  open: 3,
  reach: 2,
  /** No crate lands in the last this-many seconds of a match. */
  minLeft: 45,
  /** What a crate holds: rare items, then core items. */
  rare: 1,
  core: 2,
  /** Spectators' vote (SPEC-V3 §10.6): three spots offered this long before the flare; the most votes wins it. */
  vote: 25,
  options: 3,
} as const;

/** Respawning in the open worlds: a start this far from everyone else when one exists, metres. */
export const RESPAWN = { clear: 25 } as const;

/**
 * Gidigbo, Free For All's melee (SPEC-V3 §4). Wobble is a 0–1 meter: full is
 * Dazed. Times in seconds, distances in metres.
 */
export const MELEE = {
  /** Strikes land within this, in a frontal cone of ±cone radians (120° in all). */
  range: 2,
  cone: Math.PI / 3,
  /** Before a swing you turn to the nearest rival this close. */
  autoFace: 2,
  /** A press during a cooldown or a wind-up is kept this long, then dropped. */
  buffer: 0.15,
  /** Online: the target is judged where it was this long ago at most (the attacker's lag). */
  rewind: 0.15,
  histTicks: 12,
  /** The cooldown after a grab, a trip, a charge or a throw. */
  coolOther: 1.0,
  kinds: {
    slap: { windup: 0.08, cool: 0.6, wobble: 0.12, knock: 0.35, stun: 0.3 },
    fist: { windup: 0.35, cool: 1.2, wobble: 0.34, knock: 1.0, stun: 0.6 },
    push: { windup: 0.12, cool: 1.0, wobble: 0.06, knock: 2.4, stun: 0.35 },
  } satisfies Record<AttackKind, { windup: number; cool: number; wobble: number; knock: number; stun: number }>,
  wobble: {
    /** It drains this fast once nobody has hit you for drainAfter. */
    drainAfter: 1.5,
    drain: 0.5,
    /** Each OTHER attacker within crowdWindow cuts a hit's wobble by this share (no 3-on-1 stun-locks). */
    crowd: 0.35,
    crowdWindow: 1,
  },
  /** Dazed: down this long. Then no hit lands for `immune`. */
  daze: 1.6,
  immune: 1.5,
  brace: {
    /** Bracing: this much of your speed (Iron Wrapper: no slow). */
    slow: 0.6,
    /** Knockback and wobble × cut. */
    cut: 0.5,
    /** Brace pressed this soon before a strike lands: a parry. */
    parry: 0.25,
    /** A parried attacker staggers this long, and takes this much wobble. */
    stagger: 0.6,
    parryWobble: 0.15,
  },
  grab: {
    windup: 0.3,
    range: 1.4,
    /** The finishers unlock after this long holding; the clinch breaks after max. */
    min: 1.2,
    max: 3,
    /** The held body this far in front of the grabber; both move at this share of speed. */
    hold: 0.7,
    drag: 0.6,
    dragFor: 3,
    throw: 3,
    throwStun: 0.9,
    throwWobble: 0.25,
    throwDown: 1.2,
    /** The held player's stick against the finisher's direction below this (a cosine): a reversal. */
    escape: -0.5,
  },
  trip: { windup: 0.15, range: 1.8, down: 1.2 },
  /** A slide into someone within this is a tackle. */
  tackle: 0.9,
  charge: { windup: 0.1, dash: 0.35, speed: 9, reach: 1.1, stamina: 0.4, wobble: 0.3, knock: 2.8, stun: 0.6, miss: 0.4, sidestep: 3 },
  ringOut: { gutter: 3, gutterDrop: 0.4, roof: 1, roofDrop: 1.5 },
  /** A squad mate's help (§10.8): tap within `reach` of them down, the rest of it × `cut`. A gutter rescue (§10.20) from `rescue`, a moment's `lift`. */
  help: { reach: 1.8, cut: 0.5, rescue: 2.2, lift: 1 },
  /** Pepper Soup: knockback and wobble × this. */
  pepper: 1.2,
  /** Street props: how many, and how close to take one. */
  props: { count: 36, reach: 1.6 },
  prop: {
    chair: { uses: 3, windup: 0.3, cool: 1.1, reach: 0.2, wobble: 0.45, knock: 1.4, stun: 0.7, sweep: false, blind: 0, thrown: false },
    bucket: { uses: 1, windup: 0.15, cool: 0.8, reach: 0, wobble: 0.1, knock: 0.4, stun: 0.5, sweep: false, blind: 1, thrown: false },
    broom: { uses: 4, windup: 0.2, cool: 0.8, reach: 1.0, wobble: 0.12, knock: 1.2, stun: 0.4, sweep: false, blind: 0, thrown: false },
    pestle: { uses: 3, windup: 0.55, cool: 1.5, reach: 0.3, wobble: 0.55, knock: 1.2, stun: 0.8, sweep: false, blind: 0, thrown: false },
    bench: { uses: 2, windup: 0.5, cool: 1.6, reach: 0.4, wobble: 0.2, knock: 1.8, stun: 0.6, sweep: true, blind: 0, thrown: false },
    slipper: { uses: 2, windup: 0.1, cool: 0.8, reach: 0, wobble: 0.15, knock: 0.5, stun: 0.8, sweep: false, blind: 0, thrown: true },
  },
  /** A thrown slipper: m/s, how far, how close to hit. */
  slipper: { speed: 16, range: 14, radius: 0.6, knock: 0.5, stun: 0.8, wobble: 0.15 },
} as const;

/** Flags (SPEC-V3 §9: Find the Flag, Hold the Flag, Steal & Reposition, Scarcity, the Flag Duel). */
export const FLAGS = {
  /** Walk within this of a loose flag to take it; a dropped flag can't be retaken by its dropper for noRetake. */
  touch: 1.1,
  noRetake: 1.5,
  /** Find the Flag: search a stash spot (an interact tap) within this. */
  search: 2,
  stashes: 40,
  /** The hints' circles, radius by hint (the last is the district). */
  hintR: [90, 55, 30],
  /** Hold the Flag: a second flag from this many players. */
  extraAt: 9,
  /** Scarcity: the extraction gate's radius. */
  gate: 4,
  /** Hold the Flag's bounty (§10.10): seconds held taken from the leader you Daze. */
  bounty: 5,
} as const;

/** Steal & Reposition's drop zones. */
export const DROPZONES = { radius: 5, minApart: 60 } as const;

/**
 * Guns (v4 Phase 2): Free For All is a shooter. Everyone spawns with a
 * pistol; the assault rifle, SMG and shotgun are loot in six rarities. Hits
 * are hitscan, judged by the server with the target rewound by the shooter's
 * lag (at most `rewind`). 100 health plus armour; armour takes `share` of
 * each hit until it's gone. Spread (radians, a cone's half-angle) is the
 * stance's base, more on the move or in the air, plus a bloom that grows with
 * each shot and drains. Damage falls from `dmg` at `near` m to × `low` at `far`.
 * `recoil`: the view's kick a shot (radians up; the phone's camera only).
 */
export const GUNS = {
  hp: 100,
  /** `item`: every backpack item taken is armour too (v4: "every item becomes extra armour"). */
  armour: { max: 150, plate: 25, share: 0.7, item: 10 },
  /** Health comes back `rate` a second once nothing has hurt you for `after` s. */
  regen: { after: 6, rate: 8 },
  rewind: 0.15,
  histTicks: 12,
  /** The eye by stance (m above the floor) and the camera's shoulder offset, as the phone's camera has them. */
  eye: [1.6, 1.05, 0.45] as readonly number[],
  shoulder: 0.5,
  /** A body: a cylinder of `r` (prone: `proneR`) up to its head, a head ball of `head` m round. */
  body: { r: 0.34, proneR: 0.5, head: 0.17 },
  kinds: {
    pistol: { dmg: 24, head: 1.8, rate: 4, mag: 12, reserve: 48, reload: 1.3, range: 50, near: 12, far: 35, low: 0.6, hip: 0.03, ads: 0.008, move: 0.025, bloom: 0.012, most: 0.07, drain: 0.12, pellets: 1, recoil: 0.02, zoom: 0.82, speed: 1 },
    rifle: { dmg: 26, head: 1.6, rate: 10, mag: 30, reserve: 120, reload: 2.2, range: 100, near: 30, far: 75, low: 0.7, hip: 0.04, ads: 0.004, move: 0.03, bloom: 0.006, most: 0.06, drain: 0.1, pellets: 1, recoil: 0.016, zoom: 0.62, speed: 0.93 },
    smg: { dmg: 19, head: 1.4, rate: 14, mag: 32, reserve: 160, reload: 1.8, range: 45, near: 10, far: 30, low: 0.55, hip: 0.032, ads: 0.012, move: 0.015, bloom: 0.004, most: 0.06, drain: 0.14, pellets: 1, recoil: 0.011, zoom: 0.76, speed: 0.98 },
    shotgun: { dmg: 13, head: 1.25, rate: 1.4, mag: 6, reserve: 30, reload: 2.6, range: 24, near: 5, far: 16, low: 0.3, hip: 0.085, ads: 0.065, move: 0.02, bloom: 0, most: 0.09, drain: 0.2, pellets: 8, recoil: 0.06, zoom: 0.86, speed: 0.95 },
  },
  /** Rarities: Common, Uncommon, Rare, Epic, Legendary, Mythic. Damage × `dmg`, magazine × (1 + `mag`). */
  rarity: { dmg: [1, 1.05, 1.1, 1.17, 1.25, 1.35], mag: [0, 0, 0.15, 0.25, 0.4, 0.5], odds: [36, 26, 18, 11, 6, 3] },
  /** Melee as backup: health off a landed blow, by kind. */
  melee: { fist: 18, slap: 7, push: 4, grab: 0, trip: 10, charge: 14, prop: 26, throw: 20 } as Record<string, number>,
  /** Loot on the ground (per 10,000 m² of the world's bounds) and what a broken crate gives. */
  loot: { guns: 2.4, ammo: 2, plates: 2, crates: 2.6, drums: 1.2, crateGives: [0.55, 0.3, 0.15] as readonly number[] },
  /** Breakables: a crate's and a drum's health; a drum blows (radius, damage at its heart, falling to nothing at the edge). */
  crate: { hp: 60, half: 0.45 },
  drum: { hp: 35, r: 0.32, tall: 0.9, blast: 5, blastDmg: 85 },
  /** A car: what a bullet does to it (VEHICLES' damage, 0–100) per health it would have done; its blast hurts. */
  car: { perDmg: 0.12, blast: 6, blastDmg: 90 },
  /** Friendly fire off; a pickup is in reach this close. */
  reach: 1.8,
} as const;
export type GunKind = keyof typeof GUNS.kinds;
export const GUN_KINDS = Object.keys(GUNS.kinds) as GunKind[];
export const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"] as const;

/** Squad Rally's moving point. */
export const RALLY = { speed: 1.4, radius: 9 } as const;

/**
 * Vehicles (SPEC-V3 §5; Phase 5). Arcade, forward only. Each kind is a box
 * on the ground (len × wid), solid to the world as a row of circles; seats in
 * its own frame (+z is the nose; the driver sits left, Nigerian roads drive
 * on the right).
 */
export const VEHICLES = {
  kinds: {
    // top m/s, accel and brake m/s², turn: the most rad/s, minR: the tightest circle (m), grip: the most sideways m/s².
    danfo: { len: 4.8, wid: 2.0, floor: 0.55, top: 10.5, accel: 3.0, brake: 7, turn: 1.1, minR: 6.5, grip: 6.5, circles: [-1.6, 0, 1.6], r: 1.0, seats: [[-0.45, 1.35], [0.45, 1.35]] },
    keke: { len: 2.8, wid: 1.35, floor: 0.35, top: 9, accel: 3.6, brake: 6, turn: 1.8, minR: 3.2, grip: 5.5, circles: [-0.55, 0.55], r: 0.68, seats: [[0, 0.55], [0, -0.45]] },
    tokunbo: { len: 4.4, wid: 1.8, floor: 0.3, top: 13, accel: 4.2, brake: 8, turn: 1.4, minR: 5.2, grip: 8, circles: [-1.4, 0, 1.4], r: 0.9, seats: [[-0.4, 0.15], [0.4, 0.15]] },
  },
  /** A stick past this steers and drives; past `brakeAt` radians from the nose, it brakes (there's no reverse). */
  deadStick: 0.15,
  brakeAt: 1.9,
  /** No driver, no fuel, or no throttle: slowing like this. */
  coast: 2.6,
  /** Above this (m/s) the sky can't see you: no exposure, no laser (SPEC-V3 §5). */
  hidden: 4,
  fuel: {
    /** Seconds of driving in a full tank; the beeps; a fuel boy's top-up; a Fuel Jerrycan's. */
    full: 30,
    beeps: [0.2, 0.1],
    boy: 10,
    can: 15,
    /** Stop within this of a fuel boy (slower than `still`) for his top-up, once a match each. */
    boyR: 4,
  },
  /** Slower than this (m/s): you can get in or out on your feet, a hijack can start, a fuel boy can serve. */
  still: 2,
  /** Get in from this close to a door (the car's side by the seat). */
  door: 2.1,
  /** Out at speed: a tumble (down this long). */
  tumble: 1.2,
  damage: {
    /** A sudden loss of speed over `impact` m/s costs `perImpact` a m/s; sideways g over `lateral` m/s², `perG` a second each; scraping a wall, `scrape` a second. */
    impact: 2.5,
    perImpact: 6,
    lateral: 6,
    perG: 3,
    scrape: 4,
    /** clean → scratched → smoking → on fire (out of 100). */
    states: [15, 45, 75],
    /** On fire: it blows after 10–15 s; "GET OUT" this long before. */
    fire: [10, 15],
    warn: 3,
    /** The blast: everyone this close is knocked away; the occupants are thrown out and down this long. */
    blast: 5.5,
    blastKnock: 3,
    blastWobble: 0.5,
    blastDown: 2.4,
  },
  /** Somebody in the way is pushed aside (never hurt): knockback base + per m/s, stun, wobble at top speed. */
  push: { knock: 0.8, perSpeed: 0.28, stun: 0.5, wobble: 0.5, every: 0.6, slow: 0.85 },
  /** Hold interact this long at the driver's door to pull them out; they're stunned and drop what they hold. */
  hijack: { hold: 0.6, stun: 1 },
  /** Beeps, the horn and the alarm (seconds between). */
  horn: 0.35,
  alarm: 8,
  /** A Danfo Key calls a danfo to a road this far away (m); no more than `max` cars in a match. */
  call: [10, 45],
  max: 4,
  /** Starting cars: on a road at least this far from the middle of the starts, this far from each other. */
  far: 100,
  apart: 50,
} as const;

export type VehicleKind = keyof typeof VEHICLES.kinds;

/**
 * Hustle (SPEC-V3 §9 #6; Phase 6). Jobs pay Owo (a score, never ₦); what you
 * carry isn't safe until it's banked in an Esusu box.
 */
export const ECONOMY = {
  /** Hold-jobs: seconds of work and the pay. Carry-jobs: the pay on delivery, and a load slows you. */
  jobs: {
    water: { hold: 3, pay: 15 },
    wash: { hold: 5, pay: 25 },
    fix: { hold: 6, pay: 30 },
    parcel: { pay: 40, slow: 1 },
    load: { pay: 60, slow: 0.8 },
  },
  /** Stations on the map; a station rests this long after a job; a sabotaged one is broken this long. */
  stations: 14,
  rest: 12,
  broken: 30,
  /** Work within this of a station; deliver within this of the drop; bank within this of a box. */
  reach: 2.2,
  drop: 3,
  /** A carry-job's drop is this far from its station. */
  dropFrom: [50, 120],
  /** Esusu boxes. */
  banks: 4,
  /** Spilled Owo lies this long; anyone can scoop it. */
  bagLife: 40,
  /** Daze the leader: this much from them to you (§10.10's bounty). */
  bounty: 20,
} as const;

export type JobKind = keyof typeof ECONOMY.jobs;

/** The Harmattan sandstorm (SPEC-V3 §10.4; Phase 6), Free For All on the whole city only. */
export const HARMATTAN = {
  /** Storms a match (1, or 2 in a match of 7 minutes or more), each this long; the siren this long before. */
  long: 40,
  siren: 3,
  /** Seen this far in it (m). */
  see: 25,
  /**
   * The wind's push on everyone on foot, m/s. 0 since the v4 rework (the
   * owner: "why does my 3d model move backward when the dust comes"): the
   * storm is haze, sound and lost footprints only; nobody is pushed.
   */
  wind: 0,
  /** None in the first or the last of a match (s). */
  margin: 75,
} as const;

/** The danfo traffic hazard (SPEC-V3 §10.14; Phase 6): an empty bus sweeps the main road on a schedule. */
export const TRAFFIC = {
  /** The first run starts this far in (s); then one every `every` s, each up to `jitter` s late. */
  first: 50,
  every: 75,
  jitter: 12,
  /** Its speed (m/s) and its horn this long before it sets off (s). */
  speed: 10,
  horn: 2.5,
  /** The bus's footprint (m): a danfo's. */
  len: 4.8,
  wid: 2.0,
  /** Shoved this far (m), with this much wobble, this long stunned; once a body each `every` s. */
  knock: 3.6,
  wobble: 0.55,
  stun: 0.6,
  again: 0.8,
} as const;

/** Rooftop zip-lines (SPEC-V3 §10.21; Phase 6): two in the city, roof to street, one way. */
export const ZIPS = {
  /** How many, and their length on the ground (m). */
  count: 2,
  min: 22,
  max: 42,
  /** Grab it from this close on the roof (m); ride at this speed (m/s), hanging this far under the cable. */
  reach: 1.6,
  speed: 11,
  hang: 1.9,
  /** The frame on the roof the cable starts from: your feet this high off the roof as you set off (m). */
  frame: 2.6,
  /** The cable clears what's under it by this much plus the hang (m); the two lines at least this far apart. */
  clear: 0.5,
  apart: 90,
} as const;

/** Dead Streets (SPEC-V3 §3; Phase 7): the rules' numbers. */
export const SURVIVAL = {
  /** Zombies awake at once (the rules: the same for everyone, whatever the phone draws). */
  cap: 20,
  /** A zombie: rises over `rise` s; shambles at `walk`, lunges at `lunge` m/s within `lungeR` m for `lungeS` s. */
  rise: 2.5,
  walk: 1.7,
  lunge: 3.6,
  lungeR: 2.6,
  lungeS: 0.55,
  hp: 100,
  /** Its claw: within `reach` m, every `every` s, this much health. */
  claw: { reach: 1.15, every: 1.3, dmg: 9 },
  /** The flow field: rebuilt this often (s) within this radius (m) of you. */
  flow: { every: 0.25, r: 40 },
  /** The director: spawns `near`–`far` m from you, out of sight. Build, peak, relief (s), and the gap between spawns in each. */
  spawn: { near: 16, far: 34, build: 40, peak: 18, relief: 20, gaps: [3.2, 1.1, 9] },
  /** You: health, armour takes `armourShare` of a hit; the bleed after `bleedAfter` s (the mode can say). */
  you: { hp: 100, armourShare: 0.5, ammo: 24, torch: 100 },
  /** Weapons. Gun: within `range` m and `cone` rad of where you face; `dmg` a body shot, a head kills (likelier close). Cutlass and shove. */
  gun: { range: 28, cone: 0.35, dmg: 50, every: 0.32, headNear: 0.6, headFar: 0.15 },
  cutlass: { reach: 1.9, cone: 1.0, dmg: 40, every: 0.55, stagger: 0.6, knock: 0.6 },
  shove: { reach: 1.7, cone: 1.2, dmg: 5, every: 0.8, stagger: 1.2, knock: 3 },
  /** A barricade or a hedge breaks after this many blows; a gate's things are picked up from this close. */
  blows: 3,
  reach: 1.6,
  /** Sanctuary: health back a second, at most this much a visit. */
  heal: { rate: 1.5, most: 15 },
  /** At the Mast: the run is done this close. */
  finish: 6,
  /** The sky laser at 0 health: this long after. */
  laser: 1.2,
  // ── Phase 8 (§3.4) ──
  /** The eight kinds: walk and lunge (m/s), health, and how the director weighs them early and late in the run. */
  kinds: {
    shambler: { walk: 1.7, lunge: 3.6, hp: 100, early: 10, late: 4 },
    runner: { walk: 3.8, lunge: 5.2, hp: 70, early: 1, late: 3 },
    crawler: { walk: 1.1, lunge: 2.4, hp: 60, early: 1, late: 2 },
    bloater: { walk: 1.2, lunge: 1.8, hp: 60, early: 0.5, late: 1.5 },
    screamer: { walk: 1.6, lunge: 3, hp: 50, early: 0.3, late: 1 },
    brute: { walk: 1.5, lunge: 6.5, hp: 240, early: 0, late: 1 },
    lurker: { walk: 0.8, lunge: 1.5, hp: 80, early: 0, late: 0 },
    masked: { walk: 1.9, lunge: 3.8, hp: 100, early: 0, late: 1 },
  },
  /** Torch stun: the beam on a Runner's face this long staggers it this long, for this much battery. */
  beam: { hold: 0.6, stagger: 1.6, cost: 3, range: 12, cone: 0.42 },
  /** A Bloater's gas: within r when it bursts, slowed ×k for s. A Screamer screams after `scream` s awake, bringing `brings`. A Brute charges from 4–14 m and is stunned by a wall. */
  gas: { r: 2.6, s: 4, k: 0.6 },
  scream: { after: 4, brings: 4 },
  brute: { from: 4, to: 14, stun: 3, dmg: 25 },
  /** Noise: what each thing adds, how fast it fades (a second), and the spawn gap it takes off at most. */
  noise: { sprint: 0.6, shot: 4, blow: 2, fade: 0.35, most: 0.7 },
  /** The bounty zombie: about this far along it carries the gold key; the vault is a little further on. */
  bounty: { at: 0.35, vault: 0.5 },
  caches: 8,
  /** The Last Stand at the Mast: hold within r for s while the gate grinds open. */
  stand: { s: 45, r: 15 },
  /** Medals: finish in under these (s); flawless is no damage taken. */
  medals: { gold: 540, silver: 660, bronze: 780 },
  /** Rank weapons (§3.4 #8). Dane gun: a spread at close range, slow; Thunder Pestle: knocks a group down, slow; Gen-Set Torch: a flame jet, loud. */
  dane: { range: 12, cone: 0.6, dmg: 70, every: 1.1, most: 3, rounds: 2 },
  pestle: { reach: 2.4, cone: 1.4, dmg: 45, every: 1.2, stagger: 1.5, knock: 2.5 },
  flame: { range: 7, cone: 0.5, dmg: 35, every: 0.4 },
} as const;

export type ZombieKind = keyof typeof SURVIVAL.kinds;
export const ZOMBIE_KINDS = Object.keys(SURVIVAL.kinds) as ZombieKind[];
export type RunWeapon = "pistol" | "dane" | "pestle" | "flame";
export type RunPerk = "breath" | "quiet" | "eagle" | "mule" | "steady";
export type RunCharm = "notorch" | "melee" | "six";
export type RunMutator = "haze" | "runners" | "onebullet" | "notorch";
/** Juju charms' XP (§3.4 #21), multiplied, ×1.5 at most. */
export const CHARM_XP: Record<RunCharm, number> = { notorch: 1.15, melee: 1.2, six: 1.15 };
/** The rank each weapon needs (§2.4): Dane gun Pro, Thunder Pestle Legendary, Gen-Set Torch Master. */
export const WEAPON_RANK: Record<RunWeapon, string> = { pistol: "rookie-1", dane: "pro-1", pestle: "legendary-1", flame: "master-1" };

/** Compound Wars (SPEC-V3 §9 #7; Phase 6): the courtyard's rooms and doors. */
export const ROOMS = {
  /** Tap a door from this close (either side); hold this long inside to jam it shut, for `jam` s. */
  reach: 1.6,
  jamHold: 1.5,
  jam: 20,
  /** The fuse box darkens a room for `dark` s (it scores nothing); then it rests `rest` s. */
  dark: 20,
  rest: 40,
  /** Keys: walk onto one; the locked rooms (the best two) open with one. */
  keys: 2,
} as const;

/** Riddles of the Elders (SPEC-V3 §9 #9; Phase 6). */
export const RIDDLES_CFG = {
  /** Take a token from this close; the bench counts from this close. */
  reach: 2.2,
  bench: 4,
  /** Kola-nut tokens at places that answer nothing, as well as the answers. */
  decoys: 5,
} as const;

/**
 * Lights Out (SPEC-V3 §9 #10; Phase 6). Your lamp lights a cone in front of
 * you; a rival kept in it (in sight) for the mode's `findHold` is found.
 */
export const BLACKOUT = {
  /** The lamp: half-angle (radians) and reach (m), and in a power cut. Crouched or prone in a cut, half the reach finds you. */
  cone: 0.42,
  reach: 12,
  cutReach: 8,
  /** A power cut lasts this long. */
  cut: 25,
  /** Within this of a running generator you're lit (found from the full reach); touching it shocks you. */
  genLight: 5,
  genTouch: 1.3,
  shock: { stun: 1.0, wobble: 0.4, knock: 1.6 },
  /** How often finding is judged (steps). */
  every: 3,
} as const;

/** The §10.1 items' numbers (Phase 6: modules/gadgets.ts). Seconds, metres, radians. */
export const GADGETS = {
  smoke: { s: 12, r: 6 },
  /** Dropped `behind` you; trips a rival running over it within r; its dropper is safe for `safe` s. */
  peel: { s: 60, r: 0.6, behind: 0.9, safe: 1.5, down: 1.2 },
  /** A cone `cone` radians either side, r deep: a stagger and some wobble (brace halves it). */
  powder: { r: 4.5, cone: 0.6, stun: 0.9, wobble: 0.25 },
  /** Winds up, then pushes everyone within r. */
  wave: { windup: 0.8, r: 6, knock: 2.6, stun: 0.5, wobble: 0.15 },
  decoy: { s: 60, r: 1.1, stun: 1.2, wobble: 0.2 },
  drum: { s: 5, range: 160 },
  disguise: { s: 20 },
  /** The power-emote cards (§10.2). Zanku: rivals within r facing you (within `face` rad) wobble ×more for s; you're rooted for s. */
  zanku: { s: 3, r: 6, face: 1.05, more: 1.2 },
  /** Shaku: s of no knockback, then `slow` s at × `k` speed. */
  shaku: { s: 2, slow: 2, k: 0.5 },
  /** Odogwu: rooted s, your squad's objective × `more` while you pose within r of it. */
  odogwu: { s: 4, r: 8, more: 1.1 },
  /** Breakdance: trips every rival within r (jumping or bracing beats it); then you're Dazed `daze` s. */
  sweep: { r: 1.9, down: 1.2, daze: 1.6 },
} as const;
export const VEHICLE_KINDS: readonly VehicleKind[] = ["danfo", "keke", "tokunbo"];

/** Squads in Free For All (SPEC-V3 §7: a squad-coloured trim and a small diamond, no names). */
export const SQUAD_COLORS = ["#f5b82e", "#38b6ff", "#ff5a5f", "#59d98e"] as const;

/** Online play. Server and client both read these. */
export const NET = {
  /**
   * 12 (SPEC-V3 Phase 4): Free For All — the public queue (fq), private rooms
   * by mode (create m), parties; the match's start (ffa), snapshots (msnap),
   * events (mev) and rejoin (msync), net/matchWire.ts; brace, interact and the
   * backpack in "in"; errors locked and lead.
   * 11 (SPEC-V3 Phase 1): rank — "id" (who I am: a Lagos Life session or an
   * EMILGO account's token) and "rank" (total XP, what a round earned); the
   * error mode_off (Ball Haunt switched off).
   * 10: menus and social — CP boosts in free rooms (roster bo), data saver
   * (half the snapshots), friends: presence, requests, invites.
   * 9: Ball Haunting's pens (solid walls in the shared movement code; the
   * Desert Field 48 m wide in Ball Haunting).
   * 8: the final two (the referee's clock slows; event fn2), highlight
   * moments for the play of the game (event hl).
   * 7: the match flow — ready marks and a 2 s loading in the room, the
   * walkout (phase 0, skippable once everyone is in the arena), a 5 s
   * countdown. 6: the slide (a flag in snapshots). 5: the warning hum (phase 2 is "hum",
   * 3 s, sometimes fake); no automatic shoves. (4: modes and distances, balls
   * and baskets, fist / slap / push, rooms of 20. 3: jump, crouch, prone,
   * sprint, the map, rich looks.)
   */
  // 15 (v4): guns: the aim (y, p) and the gun buttons (w) in "in", and the guns events.
  protocol: 15,
  tickHz: 60,
  /** Server → client state broadcasts per second. */
  snapshotHz: 15,
  /** Most stick updates a client sends per second (a STOP is always sent at once). */
  inputHz: 20,
  /** Other runners are drawn this far in the past, between two snapshots. */
  interpDelayMs: 120,
  pingEveryMs: 2000,
  /**
   * The server pings every 2 s and sends 15 snapshots a second mid-round, so
   * this long without a word means the link is dead (a tunnel, Wi-Fi to
   * mobile data), whatever TCP thinks: drop it and resume the seat.
   */
  silentMs: 6500,
  /**
   * Most detection grace a player's lag can buy (seconds). A player's allowance
   * is their own measured round trip: faking lag only delays their own view, so
   * it gains nothing — the cap just bounds the worst connections.
   */
  lagGraceCap: 0.35,
  /** Big enough for a list of 100 friend ids ("me"). */
  maxMessageBytes: 2560,
  nameMax: 20,
  /** Play with New People: once two are waiting, start after this long (or at once when 20). */
  quickFillMs: 60000,
  /** Friendly rooms hold a full field (SPEC-V2 §2.5). */
  crowdMax: 20,
  /** Private room sizes: 2–4 match Lagos Life's match seats; up to a full field of 20. */
  privateSizes: [2, 3, 4, 8, 12, 20] as readonly number[],
  /** A dropped player can rejoin their round for this long. */
  rejoinMs: 20000,
  /** Six letters, like Lagos Life match codes. No I/O to avoid misreading. */
  codeAlphabet: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  codeLength: 6,
} as const;

/** Score for the leaderboard: whole numbers only (Vatar keeps the best). */
export function scoreFor(opts: { finished: boolean; timeLeft: number; progress: number; first: boolean; distance?: number }): number {
  if (opts.finished) {
    return 1000 + Math.round(opts.timeLeft * 10) + (opts.first ? 200 : 0);
  }
  const travelled = Math.max(0, Math.min(1, opts.progress / (opts.distance ?? -FIELD.finishZ)));
  return Math.round(travelled * 600);
}
