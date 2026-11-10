// Growth (v5, 3.2) on screen: a body that has taken Titan Serum looks fiercer
// at each level, never bigger (the owner's answer: same size).
//
//   level 1   the eyes burn red through the mask
//   level 2   the suit darker, red veins glowing through it
//   level 3   the veins brighter, and embers rising round them
//
// The look is the suit's own shader (human/suit.ts `fierce`: no extra draw);
// the embers are one instanced draw for everyone at level 3 within sight.

import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";

import { GROWTH } from "../config";
import type { Match } from "../game/core/match";
import type { ItemsModule } from "../game/modules/items";
import type { Crowd } from "./crowd";

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();

const RANGE = 70;
const MAX_AURAS = 12;

const AURA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
/** Rising embers: streaks that climb and fade, flickering round the body. */
const AURA_FRAG = /* glsl */ `
uniform float time;
varying vec2 vUv;
void main() {
  float col = floor(vUv.x * 28.0);
  float seed = fract(sin(col * 12.9898) * 43758.5453);
  float y = fract(vUv.y * 1.2 - time * (0.35 + seed * 0.5) - seed);
  float ember = smoothstep(0.0, 0.05, y) * smoothstep(0.22, 0.05, y) * step(0.55, seed);
  float base = pow(1.0 - vUv.y, 3.0) * 0.35;
  float fade = 1.0 - vUv.y;
  vec3 c = vec3(1.0, 0.3, 0.07) * (ember * 0.9 + base * 0.12) * fade;
  gl_FragColor = vec4(c, 1.0);
}`;

export class GrowthView {
  readonly group = new Group();
  private readonly auras: InstancedMesh;
  private readonly mat: ShaderMaterial;
  private readonly shown: number[] = [];
  private time = 0;

  constructor(private readonly crowd: Crowd) {
    this.mat = new ShaderMaterial({ uniforms: { time: { value: 0 } }, vertexShader: AURA_VERT, fragmentShader: AURA_FRAG, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true });
    this.auras = new InstancedMesh(new CylinderGeometry(0.42, 0.34, 2.1, 18, 1, true).translate(0, 1.05, 0), this.mat, MAX_AURAS);
    this.auras.instanceMatrix.setUsage(DynamicDrawUsage);
    this.auras.frustumCulled = false;
    this.auras.count = 0;
    this.group.add(this.auras);
  }

  /** Every frame. */
  update(dt: number, m: Match, cam: Vector3, me: number, firstPerson: boolean): void {
    this.time += dt;
    const items = m.module<ItemsModule>("items");
    if (!items) return;
    this.mat.uniforms.time.value = this.time;
    let n = 0;
    for (const c of m.contestants) {
      const i = c.index;
      const lv = c.status === "alive" ? (items.growth[i] ?? 0) : 0;
      if (this.shown[i] !== lv) {
        this.shown[i] = lv;
        this.crowd.setFierce(i, lv);
      }
      if (lv < GROWTH.max || n >= MAX_AURAS || (firstPerson && i === me)) continue;
      const dx = c.x - cam.x;
      const dz = c.z - cam.z;
      if (dx * dx + dz * dz > RANGE * RANGE) continue;
      this.auras.setMatrixAt(n++, _m.compose(_p.set(c.x, c.h + c.y, c.z), _q.identity(), _s.set(1, c.stance === 2 ? 0.4 : c.stance === 1 ? 0.7 : 1, 1)));
    }
    this.auras.count = n;
    if (n) this.auras.instanceMatrix.needsUpdate = true;
  }

  dispose(m: Match): void {
    for (const c of m.contestants) if (this.shown[c.index] > 0) this.crowd.setFierce(c.index, 0);
    this.auras.geometry.dispose();
    this.mat.dispose();
  }
}
