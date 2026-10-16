// The skeleton: bone names, their rest positions, and body proportions.
//
// Rest pose: standing, facing +Z, arms hanging at the sides (palms in), legs
// straight. Bones carry NO rest rotation, so an animation is just a rotation
// per bone: about X swings a limb forward (negative) or back (positive), about
// Z swings it out to the side. The character's left side is +X.
//
// Measurements are metres for a 1.0 height multiplier.

export const BONES = [
  "root",
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "clavL",
  "clavR",
  "upperArmL",
  "upperArmR",
  "foreArmL",
  "foreArmR",
  "handL",
  "handR",
  "thighL",
  "thighR",
  "shinL",
  "shinR",
  "footL",
  "footR",
  // Fingers: thumb, index, middle, ring, pinky × 2 segments, each hand.
  "thumb1L", "thumb2L", "index1L", "index2L", "middle1L", "middle2L", "ring1L", "ring2L", "pinky1L", "pinky2L",
  "thumb1R", "thumb2R", "index1R", "index2R", "middle1R", "middle2R", "ring1R", "ring2R", "pinky1R", "pinky2R",
] as const;

export type BoneName = (typeof BONES)[number];
export const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

export const PARENT: Record<BoneName, BoneName | null> = {
  root: null,
  hips: "root",
  spine: "hips",
  chest: "spine",
  neck: "chest",
  head: "neck",
  clavL: "chest",
  clavR: "chest",
  upperArmL: "clavL",
  upperArmR: "clavR",
  foreArmL: "upperArmL",
  foreArmR: "upperArmR",
  handL: "foreArmL",
  handR: "foreArmR",
  thighL: "hips",
  thighR: "hips",
  shinL: "thighL",
  shinR: "thighR",
  footL: "shinL",
  footR: "shinR",
  thumb1L: "handL", thumb2L: "thumb1L", index1L: "handL", index2L: "index1L", middle1L: "handL", middle2L: "middle1L",
  ring1L: "handL", ring2L: "ring1L", pinky1L: "handL", pinky2L: "pinky1L",
  thumb1R: "handR", thumb2R: "thumb1R", index1R: "handR", index2R: "index1R", middle1R: "handR", middle2R: "middle1R",
  ring1R: "handR", ring2R: "ring1R", pinky1R: "handR", pinky2R: "pinky1R",
};

/** A torso ring: height, half-width, front depth, back depth. */
export type Ring = [y: number, rx: number, rzF: number, rzB: number];

export interface Proportions {
  hipY: number;
  hipX: number;
  thigh: number;
  shin: number;
  ankleY: number;
  waistY: number;
  chestY: number;
  shoulderY: number;
  shoulderX: number;
  neckBaseY: number;
  headBaseY: number;
  /** Head ellipsoid radii (x, y, z) and centre height. */
  head: [number, number, number];
  headY: number;
  upperArm: number;
  foreArm: number;
  palm: number;
  finger: number;
  /** How far the arms hang out from vertical at rest (radians). */
  armRest: number;
  torso: Ring[];
  /** Limb radii: top → bottom (thigh, knee, calf, ankle). */
  leg: number[];
  /** Arm radii: shoulder, biceps, elbow, forearm, wrist. */
  arm: number[];
  neck: number;
  foot: [len: number, width: number, height: number];
}

export const PROPORTIONS: Record<"m" | "f", Proportions> = {
  m: {
    hipY: 0.92,
    hipX: 0.092,
    thigh: 0.43,
    shin: 0.41,
    ankleY: 0.08,
    waistY: 1.06,
    chestY: 1.3,
    shoulderY: 1.43,
    shoulderX: 0.19,
    neckBaseY: 1.49,
    headBaseY: 1.555,
    head: [0.094, 0.118, 0.108],
    headY: 1.648,
    upperArm: 0.29,
    foreArm: 0.255,
    palm: 0.095,
    finger: 0.085,
    armRest: 0.09,
    torso: [
      [0.84, 0.085, 0.06, 0.07],
      [0.88, 0.15, 0.085, 0.1],
      [0.95, 0.168, 0.095, 0.112],
      [1.03, 0.155, 0.095, 0.092],
      [1.12, 0.158, 0.1, 0.09],
      [1.22, 0.172, 0.112, 0.094],
      [1.31, 0.183, 0.116, 0.096],
      [1.38, 0.19, 0.1, 0.092],
      [1.44, 0.165, 0.075, 0.078],
      [1.48, 0.085, 0.055, 0.06],
    ],
    leg: [0.088, 0.074, 0.06, 0.066, 0.042],
    arm: [0.058, 0.05, 0.04, 0.042, 0.03],
    neck: 0.066,
    foot: [0.26, 0.05, 0.075],
  },
  f: {
    hipY: 0.9,
    hipX: 0.098,
    thigh: 0.42,
    shin: 0.4,
    ankleY: 0.078,
    waistY: 1.03,
    chestY: 1.24,
    shoulderY: 1.37,
    shoulderX: 0.168,
    neckBaseY: 1.43,
    headBaseY: 1.485,
    head: [0.089, 0.112, 0.104],
    headY: 1.574,
    upperArm: 0.275,
    foreArm: 0.24,
    palm: 0.088,
    finger: 0.078,
    armRest: 0.12,
    torso: [
      [0.82, 0.088, 0.06, 0.075],
      [0.86, 0.165, 0.085, 0.118],
      [0.93, 0.18, 0.092, 0.122],
      [1.01, 0.138, 0.084, 0.082],
      [1.1, 0.14, 0.09, 0.084],
      [1.18, 0.148, 0.128, 0.088],
      [1.25, 0.152, 0.122, 0.088],
      [1.32, 0.165, 0.09, 0.084],
      [1.38, 0.146, 0.068, 0.07],
      [1.42, 0.075, 0.05, 0.054],
    ],
    leg: [0.094, 0.07, 0.056, 0.06, 0.038],
    arm: [0.05, 0.043, 0.035, 0.037, 0.027],
    neck: 0.058,
    foot: [0.235, 0.045, 0.068],
  },
};

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Each bone's rest position in model space. */
export function restPositions(p: Proportions): Record<BoneName, V3> {
  const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
  const out = {} as Record<BoneName, V3>;
  out.root = v(0, 0, 0);
  out.hips = v(0, p.hipY + 0.02, 0);
  out.spine = v(0, p.waistY, 0);
  out.chest = v(0, p.chestY, 0);
  out.neck = v(0, p.neckBaseY, -0.01);
  out.head = v(0, p.headBaseY, 0);
  for (const s of [1, -1] as const) {
    const L = s === 1 ? "L" : "R";
    out[`clav${L}`] = v(s * 0.04, p.shoulderY - 0.01, -0.01);
    const sh = v(s * p.shoulderX, p.shoulderY, -0.005);
    out[`upperArm${L}`] = sh;
    const a = p.armRest;
    const elbow = v(sh.x + s * Math.sin(a) * p.upperArm, sh.y - Math.cos(a) * p.upperArm, sh.z);
    out[`foreArm${L}`] = elbow;
    const a2 = a * 0.6;
    const wrist = v(elbow.x + s * Math.sin(a2) * p.foreArm, elbow.y - Math.cos(a2) * p.foreArm, elbow.z + 0.012);
    out[`hand${L}`] = wrist;
    // Fingers: knuckles across the palm (front to back along Z), pointing down.
    const knuckleY = wrist.y - p.palm;
    const xs = wrist.x + s * 0.004;
    const fz = [0.024, 0.008, -0.008, -0.022];
    const names = ["index", "middle", "ring", "pinky"] as const;
    const lens = [0.95, 1.05, 0.98, 0.78];
    names.forEach((n, i) => {
      out[`${n}1${L}`] = v(xs, knuckleY + (i === 1 ? -0.002 : i === 3 ? 0.008 : 0), wrist.z + fz[i]);
      out[`${n}2${L}`] = v(xs, knuckleY - p.finger * 0.55 * lens[i], wrist.z + fz[i]);
    });
    out[`thumb1${L}`] = v(wrist.x - s * 0.008, wrist.y - 0.028, wrist.z + 0.03);
    out[`thumb2${L}`] = v(wrist.x - s * 0.006, wrist.y - 0.062, wrist.z + 0.052);
    const hip = v(s * p.hipX, p.hipY, 0);
    out[`thigh${L}`] = hip;
    out[`shin${L}`] = v(hip.x * 0.92, hip.y - p.thigh, 0.004);
    out[`foot${L}`] = v(hip.x * 0.88, p.ankleY, -0.01);
  }
  return out;
}

/** Finger length multipliers, by finger (index, middle, ring, pinky). */
export const FINGER_LENGTH = [0.95, 1.05, 0.98, 0.78];
