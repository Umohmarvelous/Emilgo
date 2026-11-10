// The boosters on screen (v6 max, 3.2: the owner's "transformation"), and the
// suit's other effect, camouflage (the solo Squad Disguise).
//
//   the rise     a body that takes a Strength or Speed Booster strikes the
//                power-up pose (animator "powerup"), its first half second in
//                slow motion (the animation's clock only: the rules never slow),
//                wrapped in a vortex of streaks (pickupFx, power mode). At the
//                end, a ground shockwave: a ring of light racing out and a pillar
//                of light. Your own rise is also the camera's: ffa.ts swings it
//                round you (the rig's arm keeps it out of walls).
//   the power    while it lasts: the eyes burn (the suit shader's eyes, and
//                two flame sprites over them), energy lines glow over the suit
//                (strength: fire cracks that pulse; speed: electric lines that
//                crawl), and an aura: strength, flames licking up round the body;
//                speed, crackling arcs, and after-images trailing the body as it
//                runs. All of it fades out over the last 0.6 s.
//
// How it stays cheap (a Tecno at 30 fps): no lights; additive blending, so it
// glows without them (High and Max's bloom carries it further); one instanced
// draw for every eye flame, one for every aura shell, one for the shockwaves;
// the after-images reuse the body's own skeleton and geometry (no copy, no
// skinning on the CPU), three per fast body, only near the camera, none on Low.

import {
  AdditiveBlending,
  CylinderGeometry,
  DetachedBindMode,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SkinnedMesh,
  Vector3,
} from "three";

import type { Match } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import type { GadgetsModule } from "../game/modules/gadgets";
import type { Tier } from "../graphics/tiers";
import type { Crowd } from "./crowd";
import type { PickupFx } from "./pickupFx";

/** Booster colours (linear; over 1 burns hot under additive blending). */
export const POWER_RGB = {
  1: [1.0, 0.36, 0.06] as const,
  2: [0.32, 0.78, 1.0] as const,
};
/** The rise: how long the pose plays (ffa.ts's camera uses it too) and when the shockwave goes. */
export const RISE_SECONDS = 1.5;

const RANGE = 70;
const MAX_BODIES = 10;
const MAX_SHOCKS = 6;
const GHOSTS = 3;
const MAX_GHOST_BODIES = 3;

const FLAME_VERT = /* glsl */ `
attribute vec4 aAt;    // x, y, z, size
attribute vec4 aCol;   // r, g, b, alpha
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
void main() {
  vUv = position.xy;
  vCol = aCol;
  vSeed = aAt.x * 3.1 + aAt.z * 1.7;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(0.0, 1.0, 0.0);
  // A tongue of flame: as wide as it's sized, twice as tall, rising from just under the eye.
  vec3 p = aAt.xyz + right * (position.x - 0.5) * aAt.w + up * (position.y - 0.12) * aAt.w * 2.2;
  gl_Position = aCol.a <= 0.0 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = vUv;
  float t = uTime * 3.2 + vSeed;
  // Narrowing upward, licked sideways by noise that rises.
  float wob = (n(vec2(p.y * 4.0 - t, vSeed)) - 0.5) * 0.35 * p.y;
  float x = (p.x - 0.5 - wob) / mix(0.5, 0.06, pow(p.y, 0.8));
  float body = (1.0 - smoothstep(0.55, 1.0, abs(x))) * smoothstep(0.0, 0.1, p.y) * (1.0 - smoothstep(0.55, 1.0, p.y + n(vec2(p.x * 5.0, p.y * 3.0 - t * 1.4)) * 0.35));
  float core = body * (1.0 - smoothstep(0.0, 0.45, abs(x))) * (1.0 - smoothstep(0.1, 0.5, p.y));
  vec3 c = vCol.rgb * body * 1.5 + vec3(1.0, 0.95, 0.85) * core * 1.2;
  gl_FragColor = vec4(c * vCol.a, 1.0);
}`;

const SHELL_VERT = /* glsl */ `
attribute vec4 aCol;   // r, g, b, alpha
attribute float aKind; // 1 strength, 2 speed
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
varying float vRim;
void main() {
  vUv = uv;
  vCol = aCol;
  vKind = aKind;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  // The shell glows at its edges, seen side-on (a silhouette of light), faint where it faces you.
  vec3 nv = normalize(mat3(modelViewMatrix * instanceMatrix) * normal);
  vRim = 1.0 - abs(dot(nv, normalize(-mv.xyz)));
  gl_Position = aCol.a <= 0.0 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * mv;
}`;

const SHELL_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
varying float vRim;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float u = vUv.x, y = vUv.y;
  vec3 c;
  float rim = 0.25 + 0.75 * pow(vRim, 1.5);
  float top = 1.0 - smoothstep(0.5, 0.95, y);
  if (vKind < 1.5) {
    // Strength: separate tongues of fire licking up round the body, hottest at the feet, glowing at the edges.
    float t = uTime * 1.6;
    float f = n(vec2(u * 14.0, y * 2.5 - t * 2.2)) * 0.65 + n(vec2(u * 33.0, y * 5.0 - t * 3.6)) * 0.35;
    float tongue = smoothstep(0.0, 0.12, f - (0.32 + y * 0.72));
    float base = pow(1.0 - y, 4.0) * 0.3;
    c = (vCol.rgb * (tongue * 1.5 + base) + vec3(1.0, 0.85, 0.5) * tongue * pow(1.0 - y, 3.0) * 0.5) * rim * top;
  } else {
    // Speed: arcs of electricity crawling over a faint shell, flickering.
    float t = floor(uTime * 14.0);
    float lane = floor(u * 9.0);
    float on = step(0.62, h(vec2(lane, t)));
    float path = 0.5 + (n(vec2(y * 9.0, lane * 3.7 + t)) - 0.5) * 0.9;
    float arc = on * (1.0 - smoothstep(0.0, 0.05, abs(fract(u * 9.0) - path))) * smoothstep(0.05, 0.25, y) * (1.0 - smoothstep(0.75, 1.0, y));
    float shell = 0.06 * (1.0 - y);
    c = (vCol.rgb * (arc * 1.8 + shell) + vec3(1.0) * arc * 0.6) * rim * top;
  }
  gl_FragColor = vec4(c * vCol.a, 1.0);
}`;

const SHOCK_VERT = /* glsl */ `
attribute vec4 aShock; // x, y, z, age 0…1 (−1: none)
attribute vec3 aCol;
varying vec2 vP;
varying float vAge;
varying vec3 vCol;
void main() {
  vP = position.xz;
  vAge = aShock.w;
  vCol = aCol;
  float r = mix(0.4, 7.5, sqrt(max(aShock.w, 0.0)));
  vec3 p = aShock.xyz + vec3(position.x * r, 0.06, position.z * r);
  gl_Position = aShock.w < 0.0 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const SHOCK_FRAG = /* glsl */ `
varying vec2 vP;
varying float vAge;
varying vec3 vCol;
void main() {
  float d = length(vP);
  float ring = smoothstep(0.7, 0.96, d) * (1.0 - smoothstep(0.96, 1.0, d));
  float fill = (1.0 - d) * 0.25 * (1.0 - vAge);
  float a = 1.0 - vAge;
  gl_FragColor = vec4((vCol * (ring * 2.2 + fill) + vec3(ring * 0.5)) * a, 1.0);
}`;

/** One quad per flame (x 0…1 across, y 0…1 up). */
function flameQuad(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** A flat disc, unit radius, in the xz plane. */
function shockDisc(): InstancedBufferGeometry {
  const ring = new RingGeometry(0, 1, 40, 1).rotateX(-Math.PI / 2);
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", ring.getAttribute("position"));
  g.setIndex(ring.getIndex());
  return g;
}

interface BodyFx {
  /** 0 none, 1 strength, 2 speed. */
  kind: number;
  /** 0 … 1: how strongly it shows (fades in and out). */
  a: number;
  camo: number;
  /** The rise's start (the view's clock), or −1. */
  rise: number;
  shocked: boolean;
  /** Where the body was, for the after-images (ring of the last 12 frames). */
  trail: Float32Array;
  trailN: number;
}

interface Shock {
  x: number;
  y: number;
  z: number;
  start: number;
  kind: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _eye = new Vector3();
const UP = new Vector3(0, 1, 0);

export class PowerView {
  readonly group = new Group();
  private readonly flames: Mesh;
  private readonly flameAt: InstancedBufferAttribute;
  private readonly flameCol: InstancedBufferAttribute;
  private readonly flameMat: ShaderMaterial;
  private readonly shells: InstancedMesh;
  private readonly shellCol: InstancedBufferAttribute;
  private readonly shellKind: InstancedBufferAttribute;
  private readonly shellMat: ShaderMaterial;
  private readonly shocks: Mesh;
  private readonly shockAt: InstancedBufferAttribute;
  private readonly shockCol: InstancedBufferAttribute;
  private readonly shockList: Shock[] = [];
  private readonly fx: BodyFx[] = [];
  private readonly ghosts: { mesh: SkinnedMesh[]; who: number }[] = [];
  private readonly ghostMat: MeshBasicMaterial[] = [];
  private time = 0;
  /** Called when a shockwave goes off (the mode's sound and flash): who, and which booster. */
  onShock: (who: number, kind: number) => void = () => {};
  /** Called when a booster wears off: who. */
  onFade: (who: number) => void = () => {};

  constructor(
    private readonly crowd: Crowd,
    private readonly pickFx: PickupFx | null,
    tier: Tier,
  ) {
    // Eye flames: two per body.
    const fq = flameQuad();
    this.flameAt = new InstancedBufferAttribute(new Float32Array(MAX_BODIES * 2 * 4), 4).setUsage(DynamicDrawUsage);
    this.flameCol = new InstancedBufferAttribute(new Float32Array(MAX_BODIES * 2 * 4), 4).setUsage(DynamicDrawUsage);
    fq.setAttribute("aAt", this.flameAt);
    fq.setAttribute("aCol", this.flameCol);
    fq.instanceCount = MAX_BODIES * 2;
    this.flameMat = new ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true });
    this.flames = new Mesh(fq, this.flameMat);
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 7;
    this.group.add(this.flames);

    // Aura shells: an open cylinder round each powered body.
    const shell = new CylinderGeometry(0.5, 0.42, 2.15, 20, 1, true).translate(0, 1.07, 0);
    this.shellMat = new ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true });
    this.shells = new InstancedMesh(shell, this.shellMat, MAX_BODIES);
    this.shellCol = new InstancedBufferAttribute(new Float32Array(MAX_BODIES * 4), 4).setUsage(DynamicDrawUsage);
    this.shellKind = new InstancedBufferAttribute(new Float32Array(MAX_BODIES), 1).setUsage(DynamicDrawUsage);
    this.shells.geometry.setAttribute("aCol", this.shellCol);
    this.shells.geometry.setAttribute("aKind", this.shellKind);
    this.shells.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shells.frustumCulled = false;
    this.shells.count = 0;
    this.shells.renderOrder = 6;
    this.group.add(this.shells);

    // Shockwaves.
    const sd = shockDisc();
    this.shockAt = new InstancedBufferAttribute(new Float32Array(MAX_SHOCKS * 4).fill(-1), 4).setUsage(DynamicDrawUsage);
    this.shockCol = new InstancedBufferAttribute(new Float32Array(MAX_SHOCKS * 3), 3).setUsage(DynamicDrawUsage);
    sd.setAttribute("aShock", this.shockAt);
    sd.setAttribute("aCol", this.shockCol);
    sd.instanceCount = MAX_SHOCKS;
    this.shocks = new Mesh(sd, new ShaderMaterial({ vertexShader: SHOCK_VERT, fragmentShader: SHOCK_FRAG, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true }));
    this.shocks.frustumCulled = false;
    this.shocks.visible = false;
    this.shocks.renderOrder = 6;
    this.group.add(this.shocks);

    // After-images: a faint blue copy of the body per step back.
    if (tier > 0) {
      for (let k = 0; k < GHOSTS; k++) {
        this.ghostMat.push(new MeshBasicMaterial({ color: 0x3fa8ff, transparent: true, opacity: 0.32 * (1 - k / GHOSTS), blending: AdditiveBlending, depthWrite: false }));
      }
    }
  }

  private of(i: number): BodyFx {
    while (this.fx.length <= i) this.fx.push({ kind: 0, a: 0, camo: 0, rise: -1, shocked: true, trail: new Float32Array(12 * 3), trailN: 0 });
    return this.fx[i];
  }

  /** The match's events: a booster taken starts that body's rise. */
  events(list: readonly MatchEvent[], m: Match, cam: Vector3): void {
    for (const e of list) {
      if (e.type !== "use" || (e.kind !== "strength-booster" && e.kind !== "speed-booster")) continue;
      const c = m.get(e.id);
      if (!c) continue;
      const kind = e.kind === "strength-booster" ? 1 : 2;
      const f = this.of(c.index);
      f.kind = kind;
      if (Math.hypot(c.x - cam.x, c.z - cam.z) > RANGE * 1.5) continue;
      f.rise = this.time;
      f.shocked = false;
      this.crowd.act(c.index, "powerup");
      // The first half second in slow motion: the animation's clock only.
      this.crowd.slowFall(c.index, 0.35, 0.5);
      const rgb = POWER_RGB[kind as 1 | 2];
      this.pickFx?.spawn(c.index, [rgb[0] * 1.6, rgb[1] * 1.6, rgb[2] * 1.6], true);
    }
  }

  /** Every frame. */
  update(dt: number, m: Match, cam: Vector3, me: number, firstPerson: boolean): void {
    this.time += dt;
    this.flameMat.uniforms.uTime.value = this.time;
    this.shellMat.uniforms.uTime.value = this.time;
    const g = m.module<GadgetsModule>("gadgets");
    const fa = this.flameAt.array as Float32Array;
    const fc = this.flameCol.array as Float32Array;
    const sc = this.shellCol.array as Float32Array;
    const sk = this.shellKind.array as Float32Array;
    fc.fill(0);
    let nf = 0;
    let ns = 0;
    let ghostBodies = 0;
    for (const c of m.contestants) {
      const i = c.index;
      const f = this.of(i);
      const alive = c.status === "alive";
      // What it has now, and how long is left (the last 0.6 s fades it).
      const str = alive ? m.effect(c, "strength") : 0;
      const spd = alive && m.effectValue(c, "speed") >= 1.3 ? m.effect(c, "speed") : 0;
      const left = Math.max(str, spd);
      const kind = str > 0 ? 1 : spd > 0 ? 2 : 0;
      if (kind) f.kind = kind;
      const want = left > 0 ? Math.min(1, left / 0.6) : 0;
      const before = f.a;
      f.a = want > f.a ? Math.min(want, f.a + dt * 3) : Math.max(want, f.a - dt * 2);
      if (before > 0 && f.a === 0 && left <= 0) this.onFade(i);
      const camoWant = alive && g && g.wearing.length > i && g.camo(i) ? 1 : 0;
      f.camo = camoWant > f.camo ? Math.min(1, f.camo + dt * 2) : Math.max(0, f.camo - dt * 2);
      // The shockwave at the end of the rise.
      if (f.rise >= 0 && !f.shocked && this.time - f.rise >= RISE_SECONDS) {
        f.shocked = true;
        this.shock(c.x, c.h + c.y, c.z, f.kind);
        this.onShock(i, f.kind);
      }
      if (f.rise >= 0 && this.time - f.rise > RISE_SECONDS + 1) f.rise = -1;
      // The suit (only when something shows or just stopped showing).
      if (f.a > 0 || f.camo > 0 || before > 0 || (this.lastCamo[i] ?? 0) > 0) {
        const rgb = POWER_RGB[(f.kind || 1) as 1 | 2];
        this.crowd.setFx(i, f.camo, f.kind || 1, rgb[0] * 1.4, rgb[1] * 1.4, rgb[2] * 1.4, f.a, this.time);
      }
      this.lastCamo[i] = f.camo;
      if (f.a <= 0.01 || !alive) {
        f.trailN = 0;
        continue;
      }
      const dx = c.x - cam.x;
      const dz = c.z - cam.z;
      if (dx * dx + dz * dz > RANGE * RANGE) continue;
      const rgb = POWER_RGB[f.kind as 1 | 2];
      // Eye flames (not your own in first person: they'd fill the lens).
      if (nf < MAX_BODIES * 2 && !(firstPerson && i === me) && this.crowd.eye(i, _eye)) {
        const hd = c.heading;
        const rx = Math.cos(hd) * 0.032;
        const rz = -Math.sin(hd) * 0.032;
        for (const s of [-1, 1]) {
          const o = nf * 4;
          fa[o] = _eye.x + rx * s + Math.sin(hd) * 0.02;
          fa[o + 1] = _eye.y - 0.11;
          fa[o + 2] = _eye.z + rz * s + Math.cos(hd) * 0.02;
          fa[o + 3] = 0.07 + 0.015 * f.kind;
          fc[o] = rgb[0] * 1.5;
          fc[o + 1] = rgb[1] * 1.5;
          fc[o + 2] = rgb[2] * 1.5;
          fc[o + 3] = f.a;
          nf++;
        }
      }
      // The aura shell.
      if (ns < MAX_BODIES && !(firstPerson && i === me)) {
        const lean = c.stance === 2 ? 0.4 : c.stance === 1 ? 0.72 : 1;
        this.shells.setMatrixAt(ns, _m.compose(_p.set(c.x, c.h + c.y, c.z), _q.setFromAxisAngle(UP, c.heading), _s.set(1, lean, 1)));
        sc[ns * 4] = rgb[0];
        sc[ns * 4 + 1] = rgb[1];
        sc[ns * 4 + 2] = rgb[2];
        sc[ns * 4 + 3] = f.a * (f.kind === 1 ? 0.9 : 1);
        sk[ns] = f.kind;
        ns++;
      }
      // Speed's after-images, while it runs.
      if (f.kind === 2 && this.ghostMat.length && ghostBodies < MAX_GHOST_BODIES) {
        const sp = Math.hypot(c.vx, c.vz);
        this.trail(f, c.x, c.h + c.y, c.z);
        if (sp > 3.5 && f.trailN >= 12) this.ghostsFor(ghostBodies++, i, f, c.heading, f.a * Math.min(1, (sp - 3.5) / 3));
      }
    }
    for (let k = ghostBodies; k < this.ghosts.length; k++) for (const gm of this.ghosts[k].mesh) gm.visible = false;
    this.flameAt.needsUpdate = this.flameCol.needsUpdate = true;
    this.flames.visible = nf > 0;
    this.shells.count = ns;
    if (ns) {
      this.shells.instanceMatrix.needsUpdate = true;
      this.shellCol.needsUpdate = this.shellKind.needsUpdate = true;
    }
    this.shockFrame();
  }
  private readonly lastCamo: number[] = [];

  /** Keep the last 12 positions (one a frame). */
  private trail(f: BodyFx, x: number, y: number, z: number): void {
    const t = f.trail;
    t.copyWithin(3, 0, 33);
    t[0] = x;
    t[1] = y;
    t[2] = z;
    f.trailN = Math.min(12, f.trailN + 1);
  }

  /** Three faint copies of body i, 3, 6 and 9 frames back, in the body's pose now. */
  private ghostsFor(slot: number, i: number, f: BodyFx, heading: number, a: number): void {
    const h = this.crowd.human(i);
    if (!h) return;
    while (this.ghosts.length <= slot) this.ghosts.push({ mesh: [], who: -1 });
    const gs = this.ghosts[slot];
    if (gs.who !== i || !gs.mesh.length) {
      for (const gm of gs.mesh) gm.removeFromParent();
      gs.mesh = this.ghostMat.map((mat) => {
        const s = new SkinnedMesh(h.mesh.geometry, mat);
        s.bind(h.mesh.skeleton, new Matrix4());
        s.bindMode = DetachedBindMode;
        s.frustumCulled = false;
        s.renderOrder = 4;
        this.group.add(s);
        return s;
      });
      gs.who = i;
    }
    gs.mesh.forEach((gm, k) => {
      const back = (k + 1) * 3;
      const t = f.trail;
      gm.geometry = h.mesh.geometry;
      gm.position.set(t[back * 3], t[back * 3 + 1], t[back * 3 + 2]);
      gm.quaternion.setFromAxisAngle(UP, heading);
      gm.scale.copy(h.mesh.scale);
      (gm.material as MeshBasicMaterial).opacity = 0.32 * (1 - k / GHOSTS) * a;
      gm.visible = a > 0.02;
    });
  }

  private shock(x: number, y: number, z: number, kind: number): void {
    if (this.shockList.length >= MAX_SHOCKS) this.shockList.shift();
    this.shockList.push({ x, y, z, start: this.time, kind });
  }

  private shockFrame(): void {
    const at = this.shockAt.array as Float32Array;
    const col = this.shockCol.array as Float32Array;
    at.fill(-1);
    for (let k = this.shockList.length - 1; k >= 0; k--) if (this.time - this.shockList[k].start > 0.7) this.shockList.splice(k, 1);
    this.shockList.forEach((s, k) => {
      at[k * 4] = s.x;
      at[k * 4 + 1] = s.y;
      at[k * 4 + 2] = s.z;
      at[k * 4 + 3] = (this.time - s.start) / 0.7;
      const rgb = POWER_RGB[(s.kind || 1) as 1 | 2];
      col[k * 3] = rgb[0] * 1.5;
      col[k * 3 + 1] = rgb[1] * 1.5;
      col[k * 3 + 2] = rgb[2] * 1.5;
    });
    this.shockAt.needsUpdate = this.shockCol.needsUpdate = true;
    this.shocks.visible = this.shockList.length > 0;
  }

  /** Your rise, if one is playing: seconds into it (−1: none). */
  riseOf(i: number): number {
    const f = this.fx[i];
    return f && f.rise >= 0 ? this.time - f.rise : -1;
  }

  dispose(m: Match): void {
    for (const c of m.contestants) {
      const f = this.fx[c.index];
      if (f && (f.a > 0 || f.camo > 0)) this.crowd.setFx(c.index, 0, 1, 1, 0.16, 0.04, 0, 0);
    }
    for (const gs of this.ghosts) for (const gm of gs.mesh) gm.removeFromParent();
    for (const mat of this.ghostMat) mat.dispose();
    this.flames.geometry.dispose();
    this.flameMat.dispose();
    this.shells.geometry.dispose();
    this.shellMat.dispose();
    this.shocks.geometry.dispose();
    (this.shocks.material as ShaderMaterial).dispose();
    this.group.removeFromParent();
  }
}
