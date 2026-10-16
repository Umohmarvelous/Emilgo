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
  countdown: 3,
  timeLimit: 45,
  /** The opening song: long enough to get going, never the same length twice. */
  firstSing: { bands: [[1.6, 3], [3, 6]], weights: [0.5, 0.5] } satisfies SingBands,
  /** Short, medium and long songs, mixed so nobody can count them. */
  sing: { bands: [[0.7, 1.8], [1.8, 4.2], [4.2, 7]], weights: [0.35, 0.4, 0.25] } satisfies SingBands,
  /** In the last `lateAt` seconds she sings shorter, more often. */
  lateAt: 15,
  singLate: { bands: [[0.5, 1.2], [1.2, 2.6], [2.6, 4]], weights: [0.45, 0.4, 0.15] } satisfies SingBands,
  /**
   * The feint: the song stops, she does NOT turn, then sings on from where she
   * stopped. Players who freeze at the silence lose time; nobody is ever caught
   * during one. Never twice in a row, never before the first real turn.
   */
  feint: { chance: 0.38, min: 0.5, max: 1.3 },
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

export const PRACTICE = {
  bots: 11,
} as const;

/** Online play. Server and client both read these. */
export const NET = {
  /** 3: jump, crouch, prone and sprint (buttons in, height and stance out), the map, rich looks. */
  protocol: 3,
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
  /** Quick match: once two are waiting, start after this long (or when full). */
  quickFillMs: 15000,
  /** Friendly crowd rooms. */
  crowdMax: 12,
  /** Private room sizes: 2–4 match Lagos Life's match seats; 12 is a friendly crowd. */
  privateSizes: [2, 3, 4, 12] as readonly number[],
  /** A dropped player can rejoin their round for this long. */
  rejoinMs: 20000,
  /** Six letters, like Lagos Life match codes. No I/O to avoid misreading. */
  codeAlphabet: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  codeLength: 6,
} as const;

/** Score for the leaderboard: whole numbers only (Vatar keeps the best). */
export function scoreFor(opts: { finished: boolean; timeLeft: number; progress: number; first: boolean }): number {
  if (opts.finished) {
    return 1000 + Math.round(opts.timeLeft * 10) + (opts.first ? 200 : 0);
  }
  const travelled = Math.max(0, Math.min(1, opts.progress / -FIELD.finishZ));
  return Math.round(travelled * 600);
}
