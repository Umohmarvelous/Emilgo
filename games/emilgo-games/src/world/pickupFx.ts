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
/** Segments along a streak. */
const SEG = 10;
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
attribute vec3 aColor;
varying float vU;
varying float vSide;
varying float vA;
varying vec3 vC;

const float LIFE = ${LIFE.toFixed(3)};
const float SNAP = ${SNAP.toFixed(3)};

vec3 orbit(float t, vec4 s) {
  // A vortex: the spin speeds up as it goes.
  float ang = s.x + s.z * t + sign(s.z) * 2.4 * t * t;
  // In at the end: the radius closes, the height settles on the chest.
  float k = clamp((t - LIFE) / SNAP, 0.0, 1.0);
  float r = s.y * (1.0 - 0.3 * smoothstep(0.0, LIFE, t)) * (1.0 - k * k);
  // Weaving up and down the body, each streak on its own tilt.
  float h = 0.75 * sin(t * (1.6 + s.w * 1.4) + s.w * 6.283) - 0.15;
  float tilt = (s.w - 0.5) * 0.9;
  h += sin(ang) * tilt * r;
  h *= 1.0 - k;
  return vec3(cos(ang) * r, h, sin(ang) * r);
}

void main() {
  float age = uTime - aFx.x;
  float u = position.x;
  float side = position.y;
  // The trail: where the head was up to 0.3 s ago, so each streak draws an arc of its own orbit. Before the
  // start there is no path yet: that part of the trail folds onto the start (and is dark).
  float tr = age - u * 0.3;
  float tt = max(tr, 0.0);
  vec3 c = aFx.yzw;
  vec3 p = c + orbit(tt, aSeed);
  vec3 q = c + orbit(tt - 0.015, aSeed);
  vec3 tang = p - q;
  tang = length(tang) > 1e-5 ? normalize(tang) : vec3(0.0, 1.0, 0.0);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 across = cross(tang, toCam);
  across = length(across) > 1e-5 ? normalize(across) : vec3(1.0, 0.0, 0.0);
  // A line of light: a thin bright core inside a soft halo (the ribbon is the halo's width), narrowing to the tail.
  // A comet: pointed at the head, widest just behind it, narrowing to the tail.
  float w = 0.085 * (1.0 - 0.65 * u) * mix(0.15, 1.0, smoothstep(0.0, 0.12, u));
  p += across * side * w;
  vU = u;
  vSide = side;
  vC = aColor;
  float k = clamp((age - LIFE) / SNAP, 0.0, 1.0);
  float a = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(LIFE + SNAP * 0.7, LIFE + SNAP, age));
  vA = a * smoothstep(0.0, 0.04, tr) * (1.0 + 1.5 * k);
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
  float halo = (1.0 - vSide * vSide) * 0.3;
  float tail = pow(1.0 - vU, 0.8);
  float k = tail * vA;
  gl_FragColor = vec4(vC * (core * 1.7 + halo) * k + vec3(1.0) * core * core * k * 0.55, 1.0);
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

export class PickupFx {
  readonly group = new Group();
  private readonly streaks: Mesh;
  private readonly flash: Mesh | null;
  private readonly sMat: ShaderMaterial;
  private readonly fMat: ShaderMaterial | null;
  private readonly seed: InstancedBufferAttribute;
  private readonly fx: InstancedBufferAttribute;
  private readonly col: InstancedBufferAttribute;
  private readonly fFx: InstancedBufferAttribute | null;
  private readonly fCol: InstancedBufferAttribute | null;
  private readonly per: number;
  private readonly slots: Fx[] = Array.from({ length: MAX_FX }, () => ({ who: -1, start: -99 }));
  private time = 0;
  private readonly at = new Vector3();

  constructor(tier: Tier) {
    this.per = STREAKS_BY_TIER[Math.min(2, tier)];
    const g = ribbonGeometry();
    const n = MAX_FX * MAX_STREAKS;
    this.seed = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.fx = new InstancedBufferAttribute(new Float32Array(n * 4).fill(-99), 4);
    this.col = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
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
   * `power` (a booster's rise): a vortex: twice the streaks (two slots), wider and faster.
   */
  spawn(who: number, rgb: readonly [number, number, number], power = false): void {
    if (power) {
      this.one(who, rgb, 1.25, 1.6);
      this.one(who, rgb, 0.85, 2.1);
      return;
    }
    this.one(who, rgb, 1, 1);
  }

  private one(who: number, rgb: readonly [number, number, number], wide: number, fast: number): void {
    // A free slot, or the oldest.
    let k = 0;
    for (let i = 1; i < MAX_FX; i++) if (this.slots[i].start < this.slots[k].start) k = i;
    const s = this.slots[k];
    s.who = who;
    s.start = this.time;
    const seed = this.seed.array as Float32Array;
    const col = this.col.array as Float32Array;
    const fx = this.fx.array as Float32Array;
    for (let j = 0; j < MAX_STREAKS; j++) {
      const i = k * MAX_STREAKS + j;
      const on = j < this.per;
      seed[i * 4] = (j / this.per) * Math.PI * 2 + Math.random() * 0.6;
      seed[i * 4 + 1] = (0.3 + Math.random() * 0.22) * wide;
      // Most turn one way (a vortex), a few the other (the weave).
      seed[i * 4 + 2] = (j % 4 === 3 ? -1 : 1) * (4 + Math.random() * 2.5) * fast;
      seed[i * 4 + 3] = Math.random();
      // Some streaks whiter, some deeper: the colour breathes.
      const w = 0.75 + Math.random() * 0.5;
      col[i * 3] = rgb[0] * w;
      col[i * 3 + 1] = rgb[1] * w;
      col[i * 3 + 2] = rgb[2] * w;
      fx[i * 4] = on ? this.time : -99;
    }
    this.seed.needsUpdate = this.col.needsUpdate = this.fx.needsUpdate = true;
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
    if (this.fMat) this.fMat.uniforms.uTime.value = this.time;
    let live = false;
    const fx = this.fx.array as Float32Array;
    const ffx = this.fFx ? (this.fFx.array as Float32Array) : null;
    for (let k = 0; k < MAX_FX; k++) {
      const s = this.slots[k];
      if (s.who < 0) continue;
      if (this.time - s.start > PICKUP_FX_SECONDS) {
        s.who = -1;
        continue;
      }
      if (!chest(s.who, this.at)) continue;
      live = true;
      for (let j = 0; j < this.per; j++) {
        const i = (k * MAX_STREAKS + j) * 4;
        fx[i + 1] = this.at.x;
        fx[i + 2] = this.at.y;
        fx[i + 3] = this.at.z;
      }
      if (ffx) {
        ffx[k * 4 + 1] = this.at.x;
        ffx[k * 4 + 2] = this.at.y;
        ffx[k * 4 + 3] = this.at.z;
      }
    }
    if (live) {
      this.fx.needsUpdate = true;
      if (this.fFx) this.fFx.needsUpdate = true;
    }
    this.streaks.visible = live;
    if (this.flash) this.flash.visible = live;
  }

  dispose(): void {
    this.streaks.geometry.dispose();
    this.sMat.dispose();
    if (this.flash) {
      this.flash.geometry.dispose();
      this.fMat?.dispose();
    }
  }
}
