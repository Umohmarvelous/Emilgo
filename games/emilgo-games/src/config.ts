// Every gameplay number in one place. The rules engine reads these, the server
// will read the same file in Phase 2, so a tuning change cannot leave the client
// and the referee disagreeing about what "moving" means.
//
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
}

export function courseFor(mode: Mode, distance: Distance, halfWidth: number = FIELD.halfWidth): Course {
  return {
    mode,
    distance,
    finishZ: -distance,
    safeZ: -distance - 4,
    dollZ: -distance - 11,
    timeLimit: TIME_LIMIT[distance],
    halfWidth,
    backLimitZ: FIELD.backLimitZ,
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

// Hard mode, by design. Mama's song never tells you when it ends: it plays at
// its own tempo and she cuts it wherever she likes — 0.7 s in, or deep into the
// second verse. Sometimes she stops singing and DOESN'T turn (a feint). The one
// rule that keeps it fair: nobody is ever caught until she has visibly turned
// to face them, plus a short grace.
export const RULES = {
  /** 5 → 1 in the centre, each number a bass drop (SPEC-V2 §1.3). */
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
   * The warning hum (SPEC-V2 §2.2): 3 seconds of Mama humming under the song
   * before every turn. Some hums are FAKE (the owner's choice, 17 Oct 2026): she
   * hums, then sings on and doesn't turn. Players who froze lose time; nobody is
   * ever caught during a hum. A fake never comes twice in a row, nor before
   * her first real turn.
   */
  hum: { length: 3, fakeChance: 0.38 },
  /** Doll turning to face the field — still safe to be moving. Varies: some turns snap. */
  turning: { min: 0.35, max: 0.55 },
  /**
   * Once she is facing you, how long before movement counts: forgiveness for a
   * human thumb. Online, each player also gets their own measured lag on top.
   */
  grace: 0.2,
  watch: { min: 1.5, max: 5 },
  /** Doll turning back to the wall: safe, and the moment to get a head start. */
  turningBack: 0.4,
  /** Speed above this while she watches is "moving". */
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
  /** … Mama close up, the balls and baskets (Ball Haunting only), the laser guns … */
  doll: 2.4,
  balls: 2.2,
  lasers: 2.2,
  /** … then back behind the players. */
  behind: 1.4,
} as const;

/** How long the walkout and field preview last for this mode (the countdown follows). */
export function walkoutLength(mode: Mode): number {
  return FLOW.walk + FLOW.sweep * FLOW.sweeps + FLOW.doll + (mode === "balls" ? FLOW.balls : 0) + FLOW.lasers + FLOW.behind;
}

export const PRACTICE = {
  /** Solo vs AI: a full field of 20 (SPEC-V2 §2.5). */
  bots: 19,
} as const;

/** Online play. Server and client both read these. */
export const NET = {
  /**
   * 7: the match flow — ready marks and a 2 s loading in the room, the
   * walkout (phase 0, skippable once everyone is in the arena), a 5 s
   * countdown. 6: the slide (a flag in snapshots). 5: the warning hum (phase 2 is "hum",
   * 3 s, sometimes fake); no automatic shoves. (4: modes and distances, balls
   * and baskets, fist / slap / push, rooms of 20. 3: jump, crouch, prone,
   * sprint, the map, rich looks.)
   */
  protocol: 7,
  tickHz: 60,
  /** Server → client state broadcasts per second. */
  snapshotHz: 15,
  /** Most stick updates a client sends per second (a STOP is always sent at once). */
  inputHz: 20,
  /** Other runners are drawn this far in the past, between two snapshots. */
  interpDelayMs: 120,
  pingEveryMs: 2000,
  /**
   * Most detection grace a player's lag can buy (seconds). A player's allowance
   * is their own measured round trip: faking lag only delays their own view, so
   * it gains nothing — the cap just bounds the worst connections.
   */
  lagGraceCap: 0.35,
  maxMessageBytes: 1024,
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
