// The pickup light (v6, the owner's "VFX orbit around player"): a body that
// picks something up is wrapped for 1.5 s in streaks of light in the item's
// colour that spiral and weave round it, faster and faster, then snap into
// the chest in a flash.
//
// How it stays cheap enough for a Tecno at 30 fps:
//   - ONE instanced draw for every streak of every pickup on screen (and one
//     for the flashes). Each streak is a ribbon of SEG segments; its whole
//     path (the spin, the weave up the body, the trail, the snap inward) is
//     worked out in the vertex shader from a few numbers per streak (its
//     angle, radius, speed and weave) and the time. No particle physics on
//     the CPU: per frame it only moves each pickup's centre with its body
//     (STREAKS × 4 floats) and sets one time uniform.
//   - Additive blending: the streaks add light, so they glow without a single
//     real light (High and Max's bloom makes them bloom further).
//   - Ribbons face the camera in the shader, so a streak reads from any side.
//   - Low draws fewer streaks per pickup and no flash.
//
// v7 (2.8, the owner: "more new design ... more cinematic and epic ... like
// an electric spark or charge"): four designs, each item its own (STYLE_OF):
//   vortex  the v6 comets spiralling in, now crackling
//   gyro    three rings of charge at three tilts, turning like a gyroscope
//           as they climb from the feet to the chest
//   helix   two strands twisting up the body and out over the head
//   storm   lightning: jagged bolts that strike between points round the
//           body and strike again elsewhere, flickering
// Every streak jitters across itself and flickers (a fresh noise ~28 times a
// second), a white-hot core in a halo of the item's colour; and sparks fly
// off the charge and burst out at the snap (one more instanced draw, their
// flight worked out in the vertex shader too).

import {
  AdditiveBlending,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

import type { Tier } from "../graphics/tiers";

/** Pickups that can glow at once (the oldest gives way). */
const MAX_FX = 6;
/** Streaks per pickup, by tier (Low, Medium, High+). */
const STREAKS_BY_TIER = [9, 14, 18] as const;
const MAX_STREAKS = 18;
/** Segments along a streak (v7: 14, for the bolts' jags). */
const SEG = 14;
/** v7: sparks per pickup, by tier (Low, Medium, High+). */
const SPARKS_BY_TIER = [10, 18, 28] as const;
const MAX_SPARKS = 28;

/** v7 (2.8): the orbit's design. */
export type OrbitStyle = "vortex" | "gyro" | "helix" | "storm";
const STYLE_CODE: Record<OrbitStyle, number> = { vortex: 0, gyro: 1, helix: 2, storm: 3 };
/** The orbit, then the snap into the chest, then the flash's fade (seconds). */
const LIFE = 1.5;
const SNAP = 0.2;
const FADE = 0.35;
export const PICKUP_FX_SECONDS = LIFE + SNAP + FADE;

const STREAK_VERT = /* glsl */ `
uniform float uTime;
// position.x: 0 head … 1 tail along the streak; position.y: −1 / +1 across it.
attribute vec4 aSeed;       // start angle, radius, spin (rad/s), weave (0..1)
attribute vec4 aFx;         // start time, centre x, y, z
attribute vec4 aColor;      // rgb, the design (0 vortex, 1 gyro, 2 helix, 3 storm)
varying float vU;
varying float vSide;
varying float vA;
varying vec3 vC;

const float LIFE = ${LIFE.toFixed(3)};
const float SNAP = ${SNAP.toFixed(3)};

float hash(float n) { return fract(sin(n) * 43758.5453); }

vec3 orbit(float t, vec4 s, float mode) {
  float k = clamp((t - LIFE) / SNAP, 0.0, 1.0);
  if (mode < 0.5) {
    // A vortex: the spin speeds up as it goes.
    float ang = s.x + s.z * t + sign(s.z) * 2.4 * t * t;
    float r = s.y * (1.0 - 0.3 * smoothstep(0.0, LIFE, t)) * (1.0 - k * k);
    float h = 0.75 * sin(t * (1.6 + s.w * 1.4) + s.w * 6.283) - 0.15;
    float tilt = (s.w - 0.5) * 0.9;
    h += sin(ang) * tilt * r;
    h *= 1.0 - k;
    return vec3(cos(ang) * r, h, sin(ang) * r);
  }
  if (mode < 1.5) {
    // A gyroscope: three rings (by s.w), each on its own tilt, turning about the body as they climb to the chest.
    float ring = floor(s.w * 2.999);
    float ang = s.x + s.z * 1.3 * t;
    float r = s.y * 1.25 * (1.0 - k * k);
    vec3 p = vec3(cos(ang) * r, 0.0, sin(ang) * r);
    float tx = 0.35 + ring * 0.55;
    p = vec3(p.x, -p.z * sin(tx), p.z * cos(tx));
    float ty = ring * 2.094 + t * (1.4 + ring * 0.5);
    p = vec3(p.x * cos(ty) - p.z * sin(ty), p.y, p.x * sin(ty) + p.z * cos(ty));
    p.y += mix(-0.95, 0.05, smoothstep(0.0, LIFE * 0.75, t)) * (1.0 - k);
    return p;
  }
  // A helix: two strands (by s.w) climbing from the feet past the head, twisting.
  float strand = step(0.5, s.w);
  float y = mix(-1.05, 1.15, fract(s.x * 0.159 + t * 0.62));
  float ang = strand * 3.1416 + y * 6.5 - t * 5.0;
  float r = s.y * (0.9 + 0.25 * sin(y * 3.0)) * (1.0 - k * k);
  return vec3(cos(ang) * r, y * (1.0 - k), sin(ang) * r);
}

void main() {
  float age = uTime - aFx.x;
  float u = position.x;
  float side = position.y;
  float mode = aColor.w;
  vec3 c = aFx.yzw;
  float k = clamp((age - LIFE) / SNAP, 0.0, 1.0);
  float a = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(LIFE + SNAP * 0.7, LIFE + SNAP, age));
  // A fresh noise ~28 times a second: the charge crackles and flickers.
  float tick = floor(uTime * 28.0);
  float id = aSeed.x * 17.0 + aSeed.w * 131.0;
  vec3 p;
  vec3 tang;
  float w;
  float tr = age;
  if (mode > 2.5) {
    // Lightning: a bolt from one point round the body to another; it strikes again elsewhere ~8 times a second.
    float strike = floor(age * (7.0 + aSeed.w * 4.0) + aSeed.w * 9.0);
    float h1 = hash(strike * 1.7 + id);
    float h2 = hash(strike * 3.1 + id * 0.7);
    float h3 = hash(strike * 5.3 + id * 1.3);
    float rr = aSeed.y * 1.6 * (1.0 - k * k);
    float a1 = h1 * 6.283;
    float a2 = a1 + 1.2 + h2 * 2.5;
    vec3 A = vec3(cos(a1) * rr, (h2 - 0.5) * 1.9, sin(a1) * rr) * (1.0 - k);
    vec3 B = vec3(cos(a2) * rr * 0.6, (h3 - 0.5) * 1.6, sin(a2) * rr * 0.6) * (1.0 - k);
    p = c + mix(A, B, u);
    tang = normalize(B - A + vec3(1e-4));
    vec3 toCam0 = normalize(cameraPosition - p);
    vec3 n0 = normalize(cross(tang, toCam0) + vec3(1e-5));
    // The jags: three octaves of noise across the bolt, pinned at its ends.
    float seg = floor(u * ${SEG}.0 + 0.5);
    float j = (hash(seg + strike * 7.0 + id) - 0.5) * 0.22 + (hash(seg * 2.3 + tick + id) - 0.5) * 0.08;
    p += n0 * j * sin(3.1416 * u) * length(B - A);
    w = 0.03;
    a *= 0.55 + 0.9 * hash(tick + id * 3.0);
    tr = age;
  } else {
    // The trail: where the head was a moment ago, so each streak draws an arc of its own path (the gyro's longer).
    float trail = mode > 0.5 && mode < 1.5 ? 0.55 : 0.3;
    tr = age - u * trail;
    float tt = max(tr, 0.0);
    p = c + orbit(tt, aSeed, mode);
    vec3 q = c + orbit(tt - 0.015, aSeed, mode);
    tang = p - q;
    tang = length(tang) > 1e-5 ? normalize(tang) : vec3(0.0, 1.0, 0.0);
    // A comet: pointed at the head, widest just behind it, narrowing to the tail (the gyro's rings even).
    w = mode > 0.5 && mode < 1.5 ? 0.055 * (1.0 - 0.4 * u) : 0.085 * (1.0 - 0.65 * u) * mix(0.15, 1.0, smoothstep(0.0, 0.12, u));
    a *= smoothstep(0.0, 0.04, tr) * (0.75 + 0.5 * hash(tick + id));
  }
  vec3 toCam = normalize(cameraPosition - p);
  vec3 across = cross(tang, toCam);
  across = length(across) > 1e-5 ? normalize(across) : vec3(1.0, 0.0, 0.0);
  // The crackle: every streak trembles across itself (not at its head).
  if (mode < 2.5) p += across * (hash(floor(u * ${SEG}.0) + tick * 1.3 + id) - 0.5) * 0.07 * u;
  p += across * side * w;
  vU = u;
  vSide = side;
  vC = aColor.rgb;
  vA = a * (1.0 + 1.5 * k);
  // An unused or finished streak (the whole ribbon at once, never a single vertex): behind the camera, nothing drawn.
  gl_Position = a <= 0.0 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const STREAK_FRAG = /* glsl */ `
varying float vU;
varying float vSide;
varying float vA;
varying vec3 vC;
void main() {
  float core = exp(-vSide * vSide * 14.0);
  float halo = (1.0 - vSide * vSide) * 0.35;
  float tail = pow(1.0 - vU * 0.85, 0.8);
  float k = tail * vA;
  // A white-hot core (a touch of electric blue in it) inside the item's colour.
  gl_FragColor = vec4(vC * (core * 1.7 + halo) * k + vec3(0.85, 0.92, 1.0) * core * core * k * 0.75, 1.0);
}`;

/**
 * v7 (2.8): sparks thrown off the charge: each a short streak along its own flight (out, up, falling), white turning
 * to the item's colour as it cools. Thrown all through the orbit, and a burst at the snap.
 */
const SPARK_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aSp;     // thrown at (s after the start), bearing, up speed, out speed
attribute vec4 aFx;     // the pickup's start time, centre x, y, z
attribute vec3 aColor;
varying vec2 vP;
varying float vA;
varying vec3 vC;
void main() {
  float age = uTime - aFx.x - aSp.x;
  float life = 0.4 + fract(aSp.y * 7.13) * 0.3;
  float on = step(0.0, age) * step(age, life) * step(-90.0, aFx.x);
  float k = clamp(age / life, 0.0, 1.0);
  vec3 dir = vec3(cos(aSp.y), 0.0, sin(aSp.y));
  vec3 v = dir * aSp.w + vec3(0.0, aSp.z, 0.0);
  vec3 o = aFx.yzw + dir * 0.4 + vec3(0.0, (fract(aSp.y * 3.17) - 0.5) * 1.3, 0.0);
  vec3 p = o + v * age + vec3(0.0, -4.9, 0.0) * age * age;
  vec3 vel = v + vec3(0.0, -9.8, 0.0) * age;
  vec3 t = length(vel) > 1e-4 ? normalize(vel) : vec3(0.0, 1.0, 0.0);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 across = normalize(cross(t, toCam) + vec3(1e-5));
  float len = 0.05 + length(vel) * 0.028;
  p += t * position.y * len + across * position.x * 0.016;
  vP = position.xy;
  vA = on * (1.0 - k * k);
  vC = mix(vec3(1.0, 0.97, 0.9), aColor, k);
  gl_Position = on <= 0.0 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const SPARK_FRAG = /* glsl */ `
varying vec2 vP;
varying float vA;
varying vec3 vC;
void main() {
  float c = (1.0 - vP.x * vP.x) * (1.0 - abs(vP.y) * 0.6);
  gl_FragColor = vec4(vC * c * vA * 2.2, 1.0);
}`;

const FLASH_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aFx;
attribute vec3 aColor;
varying vec2 vP;
varying float vA;
varying vec3 vC;
const float LIFE = ${LIFE.toFixed(3)};
const float SNAP = ${SNAP.toFixed(3)};
const float FADE = ${FADE.toFixed(3)};
void main() {
  float age = uTime - aFx.x - LIFE - SNAP * 0.6;
  float k = clamp(age / FADE, 0.0, 1.0);
  float size = mix(0.2, 1.1, sqrt(k));
  vA = (age < 0.0 ? 0.0 : 1.0 - k);
  vP = position.xy;
  vC = aColor;
  vec3 c = aFx.yzw;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = c + (right * position.x + up * position.y) * size;
  gl_Position = vA <= 0.0 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FLASH_FRAG = /* glsl */ `
varying vec2 vP;
varying float vA;
varying vec3 vC;
void main() {
  float d = length(vP);
  float body = pow(max(0.0, 1.0 - d), 3.0);
  float ring = smoothstep(0.08, 0.0, abs(d - 0.75)) * 0.8;
  gl_FragColor = vec4((vC * (body * 1.6 + ring) + vec3(body * body)) * vA, 1.0);
}`;

/** One ribbon: SEG+1 pairs of vertices; each vertex's position is (u along it, side across it, 0). */
function ribbonGeometry(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  const pos: number[] = [];
  for (let i = 0; i <= SEG; i++) for (const s of [-1, 1]) pos.push(i / SEG, s, 0);
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(idx);
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  return g;
}

function quadGeometry(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

interface Fx {
  /** The body it follows (−1: none). */
  who: number;
  start: number;
}

/** v7 (2.8): each item's own design (any other: by its name). */
const STYLE_OF: Readonly<Record<string, OrbitStyle>> = {
  "med-kit": "helix", medkit: "helix", nv: "helix", "titan-serum": "helix",
  ammo: "gyro", armour: "gyro", "map-print": "gyro",
  battery: "storm", "strength-booster": "storm", "speed-booster": "storm",
};
const STYLES: readonly OrbitStyle[] = ["vortex", "gyro", "helix", "storm"];

/** v7 (2.8): an item's orbit design. */
export function styleOf(kind: string): OrbitStyle {
  const s = STYLE_OF[kind];
  if (s) return s;
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  return STYLES[h % STYLES.length];
}

export class PickupFx {
  readonly group = new Group();
  private readonly streaks: Mesh;
  private readonly flash: Mesh | null;
  private readonly sparks: Mesh;
  private readonly sMat: ShaderMaterial;
  private readonly fMat: ShaderMaterial | null;
  private readonly pMat: ShaderMaterial;
  private readonly seed: InstancedBufferAttribute;
  private readonly fx: InstancedBufferAttribute;
  private readonly col: InstancedBufferAttribute;
  private readonly fFx: InstancedBufferAttribute | null;
  private readonly fCol: InstancedBufferAttribute | null;
  private readonly pSp: InstancedBufferAttribute;
  private readonly pFx: InstancedBufferAttribute;
  private readonly pCol: InstancedBufferAttribute;
  private readonly per: number;
  private readonly perSpark: number;
  private readonly slots: Fx[] = Array.from({ length: MAX_FX }, () => ({ who: -1, start: -99 }));
  private time = 0;
  private readonly at = new Vector3();

  constructor(tier: Tier) {
    this.per = STREAKS_BY_TIER[Math.min(2, tier)];
    this.perSpark = SPARKS_BY_TIER[Math.min(2, tier)];
    const g = ribbonGeometry();
    const n = MAX_FX * MAX_STREAKS;
    this.seed = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.fx = new InstancedBufferAttribute(new Float32Array(n * 4).fill(-99), 4);
    this.col = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    g.setAttribute("aSeed", this.seed);
    g.setAttribute("aFx", this.fx);
    g.setAttribute("aColor", this.col);
    g.instanceCount = n;
    this.sMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      // The ribbon turns to face the camera, but its triangles' winding flips along the orbit: draw both sides.
      side: DoubleSide,
    });
    this.streaks = new Mesh(g, this.sMat);
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.streaks.renderOrder = 5;
    this.group.add(this.streaks);
    // v7 (2.8): the sparks: one instanced draw for all of them.
    const sq = quadGeometry();
    const ns = MAX_FX * MAX_SPARKS;
    this.pSp = new InstancedBufferAttribute(new Float32Array(ns * 4), 4);
    this.pFx = new InstancedBufferAttribute(new Float32Array(ns * 4).fill(-99), 4);
    this.pCol = new InstancedBufferAttribute(new Float32Array(ns * 3), 3);
    sq.setAttribute("aSp", this.pSp);
    sq.setAttribute("aFx", this.pFx);
    sq.setAttribute("aColor", this.pCol);
    sq.instanceCount = ns;
    this.pMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.sparks = new Mesh(sq, this.pMat);
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    this.sparks.renderOrder = 5;
    this.group.add(this.sparks);
    if (tier > 0) {
      const q = quadGeometry();
      this.fFx = new InstancedBufferAttribute(new Float32Array(MAX_FX * 4).fill(-99), 4);
      this.fCol = new InstancedBufferAttribute(new Float32Array(MAX_FX * 3), 3);
      q.setAttribute("aFx", this.fFx);
      q.setAttribute("aColor", this.fCol);
      q.instanceCount = MAX_FX;
      this.fMat = new ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: FLASH_VERT,
        fragmentShader: FLASH_FRAG,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: DoubleSide,
      });
      this.flash = new Mesh(q, this.fMat);
      this.flash.frustumCulled = false;
      this.flash.visible = false;
      this.flash.renderOrder = 6;
      this.group.add(this.flash);
    } else {
      this.flash = null;
      this.fMat = null;
      this.fFx = null;
      this.fCol = null;
    }
  }

  /**
   * A body picked something up: its light, in `rgb` (the item's colour; values over 1 burn hotter). v6 max:
   * `power` (a booster's rise): a vortex: twice the streaks (two slots), wider and faster. v7: `style`, the design
   * (styleOf the item); a booster's rise is a storm round a vortex.
   */
  spawn(who: number, rgb: readonly [number, number, number], power = false, style: OrbitStyle = "vortex"): void {
    if (power) {
      this.one(who, rgb, 1.25, 1.6, "vortex");
      this.one(who, rgb, 0.85, 2.1, "storm");
      return;
    }
    this.one(who, rgb, 1, 1, style);
  }

  private one(who: number, rgb: readonly [number, number, number], wide: number, fast: number, style: OrbitStyle): void {
    // A free slot, or the oldest.
    let k = 0;
    for (let i = 1; i < MAX_FX; i++) if (this.slots[i].start < this.slots[k].start) k = i;
    const s = this.slots[k];
    s.who = who;
    s.start = this.time;
    const mode = STYLE_CODE[style];
    const seed = this.seed.array as Float32Array;
    const col = this.col.array as Float32Array;
    const fx = this.fx.array as Float32Array;
    // A storm needs fewer, brighter bolts; the gyro's three rings share the streaks.
    const per = mode === 3 ? Math.max(5, Math.round(this.per * 0.6)) : this.per;
    for (let j = 0; j < MAX_STREAKS; j++) {
      const i = k * MAX_STREAKS + j;
      const on = j < per;
      seed[i * 4] = (j / per) * Math.PI * 2 + Math.random() * 0.6;
      seed[i * 4 + 1] = (0.3 + Math.random() * 0.22) * wide;
      // Most turn one way (a vortex), a few the other (the weave).
      seed[i * 4 + 2] = (j % 4 === 3 ? -1 : 1) * (4 + Math.random() * 2.5) * fast;
      // The gyro's ring and the helix's strand come from the weave: spread them evenly.
      seed[i * 4 + 3] = mode === 1 ? ((j % 3) + 0.5) / 3 : mode === 2 ? (j % 2) * 0.5 + 0.25 : Math.random();
      // Some streaks whiter, some deeper: the colour breathes.
      const w = 0.75 + Math.random() * 0.5;
      col[i * 4] = rgb[0] * w;
      col[i * 4 + 1] = rgb[1] * w;
      col[i * 4 + 2] = rgb[2] * w;
      col[i * 4 + 3] = mode;
      fx[i * 4] = on ? this.time : -99;
    }
    this.seed.needsUpdate = this.col.needsUpdate = this.fx.needsUpdate = true;
    // The sparks: two thirds thrown through the orbit, a third in a burst at the snap.
    const sp = this.pSp.array as Float32Array;
    const pf = this.pFx.array as Float32Array;
    const pc = this.pCol.array as Float32Array;
    for (let j = 0; j < MAX_SPARKS; j++) {
      const i = k * MAX_SPARKS + j;
      const burst = j >= this.perSpark * 0.66;
      sp[i * 4] = burst ? LIFE + SNAP * 0.8 + Math.random() * 0.05 : Math.random() * LIFE * 0.95;
      sp[i * 4 + 1] = Math.random() * Math.PI * 2;
      sp[i * 4 + 2] = burst ? 1.5 + Math.random() * 2.5 : 0.8 + Math.random() * 2.2;
      sp[i * 4 + 3] = burst ? 2.5 + Math.random() * 2.5 : 1.2 + Math.random() * 1.8;
      pf[i * 4] = j < this.perSpark ? this.time : -99;
      pc[i * 3] = rgb[0];
      pc[i * 3 + 1] = rgb[1];
      pc[i * 3 + 2] = rgb[2];
    }
    this.pSp.needsUpdate = this.pFx.needsUpdate = this.pCol.needsUpdate = true;
    if (this.fCol && this.fFx) {
      const fc = this.fCol.array as Float32Array;
      fc[k * 3] = rgb[0];
      fc[k * 3 + 1] = rgb[1];
      fc[k * 3 + 2] = rgb[2];
      (this.fFx.array as Float32Array)[k * 4] = this.time;
      this.fCol.needsUpdate = this.fFx.needsUpdate = true;
    }
  }

  /** Every frame: the clock, and each live pickup's centre on its body (`chest` fills it; false: gone). */
  update(dt: number, chest: (who: number, out: Vector3) => boolean): void {
    this.time += dt;
    this.sMat.uniforms.uTime.value = this.time;
    this.pMat.uniforms.uTime.value = this.time;
    if (this.fMat) this.fMat.uniforms.uTime.value = this.time;
    let live = false;
    const fx = this.fx.array as Float32Array;
    const pf = this.pFx.array as Float32Array;
    const ffx = this.fFx ? (this.fFx.array as Float32Array) : null;
    for (let k = 0; k < MAX_FX; k++) {
      const s = this.slots[k];
      if (s.who < 0) continue;
      if (this.time - s.start > PICKUP_FX_SECONDS + 0.3) {
        s.who = -1;
        continue;
      }
      if (!chest(s.who, this.at)) continue;
      live = true;
      for (let j = 0; j < MAX_STREAKS; j++) {
        const i = (k * MAX_STREAKS + j) * 4;
        fx[i + 1] = this.at.x;
        fx[i + 2] = this.at.y;
        fx[i + 3] = this.at.z;
      }
      for (let j = 0; j < this.perSpark; j++) {
        const i = (k * MAX_SPARKS + j) * 4;
        pf[i + 1] = this.at.x;
        pf[i + 2] = this.at.y;
        pf[i + 3] = this.at.z;
      }
      if (ffx) {
        ffx[k * 4 + 1] = this.at.x;
        ffx[k * 4 + 2] = this.at.y;
        ffx[k * 4 + 3] = this.at.z;
      }
    }
    if (live) {
      this.fx.needsUpdate = true;
      this.pFx.needsUpdate = true;
      if (this.fFx) this.fFx.needsUpdate = true;
    }
    this.streaks.visible = live;
    this.sparks.visible = live;
    if (this.flash) this.flash.visible = live;
  }

  dispose(): void {
    this.streaks.geometry.dispose();
    this.sMat.dispose();
    this.sparks.geometry.dispose();
    this.pMat.dispose();
    if (this.flash) {
      this.flash.geometry.dispose();
      this.fMat?.dispose();
    }
  }
}
