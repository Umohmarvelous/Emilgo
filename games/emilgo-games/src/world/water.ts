// Bodies in the water on screen (v6 max, 3.5: the owner's "a swim pose when
// the player enters a river, splashes and sound effects, keeping performance in
// mind").
//
//   swimming   a body in deep water (Space.floorAt says swim) is posed swimming
//              (animator: the front crawl), for every body, the phone's own
//              copy of the rule: remote bodies aren't sent the flag
//   entering   a splash as it goes in: a burst of white water thrown up and
//              falling back, two rings spreading; a big splash heard
//   moving     strokes: a ring at the body and spray from the hands every
//              stroke, a wake of rings behind; wading, rings at the legs. Your
//              own strokes heard, softly
//
// Cheap: two instanced draws (the rings, the spray), particles moved on the CPU
// (at most 96, a few floats each), nothing for bodies out of the water or far.

import {
  AdditiveBlending,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from "three";

import type { Sound } from "../audio/sound";
import type { Match } from "../game/core/match";
import { SWIM_FLOAT } from "../game/core/space";
import type { Crowd } from "./crowd";

const MAX_RINGS = 48;
const MAX_DROPS = 96;
const RANGE = 60;

const RING_VERT = /* glsl */ `
attribute vec4 aRing; // x, y, z, age 0…1 (−1: none)
attribute float aSize;
varying vec2 vP;
varying float vAge;
void main() {
  vP = position.xz;
  vAge = aRing.w;
  float r = mix(0.25, aSize, sqrt(max(aRing.w, 0.0)));
  vec3 p = aRing.xyz + vec3(position.x * r, 0.02, position.z * r);
  gl_Position = aRing.w < 0.0 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const RING_FRAG = /* glsl */ `
varying vec2 vP;
varying float vAge;
void main() {
  float d = length(vP);
  float ring = smoothstep(0.78, 0.93, d) * (1.0 - smoothstep(0.93, 1.0, d));
  float inner = smoothstep(0.5, 0.7, d) * (1.0 - smoothstep(0.7, 0.76, d)) * 0.35;
  float a = (1.0 - vAge) * (1.0 - vAge);
  gl_FragColor = vec4(vec3(0.85, 0.92, 0.95) * (ring + inner) * a * 0.55, 1.0);
}`;

interface Ring {
  x: number;
  y: number;
  z: number;
  start: number;
  life: number;
  size: number;
}

interface Drop {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  floor: number;
}

interface BodyWater {
  /** 0 dry, 1 wading, 2 swimming (last frame). */
  state: number;
  /** When the next stroke's ring and spray are due. */
  next: number;
  side: number;
}

const _m = new Matrix4();
const _v = new Vector3();

export class WaterFx {
  readonly group = new Group();
  private readonly rings: Mesh;
  private readonly ringAt: InstancedBufferAttribute;
  private readonly ringSize: InstancedBufferAttribute;
  private readonly ringList: Ring[] = [];
  private readonly drops: InstancedMesh;
  private readonly dropList: Drop[] = [];
  private readonly bodies: BodyWater[] = [];
  private time = 0;

  constructor(
    private readonly crowd: Crowd,
    private readonly sound: Sound | null,
  ) {
    const ring = new RingGeometry(0, 1, 32, 1).rotateX(-Math.PI / 2);
    const g = new InstancedBufferGeometry();
    g.setAttribute("position", ring.getAttribute("position"));
    g.setIndex(ring.getIndex());
    this.ringAt = new InstancedBufferAttribute(new Float32Array(MAX_RINGS * 4).fill(-1), 4).setUsage(DynamicDrawUsage);
    this.ringSize = new InstancedBufferAttribute(new Float32Array(MAX_RINGS), 1).setUsage(DynamicDrawUsage);
    g.setAttribute("aRing", this.ringAt);
    g.setAttribute("aSize", this.ringSize);
    g.instanceCount = MAX_RINGS;
    this.rings = new Mesh(g, new ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true }));
    this.rings.frustumCulled = false;
    this.rings.visible = false;
    this.rings.renderOrder = 3;
    this.group.add(this.rings);
    this.drops = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshBasicMaterial({ color: 0xdfeef4, transparent: true, opacity: 0.75, depthWrite: false }), MAX_DROPS);
    this.drops.instanceMatrix.setUsage(DynamicDrawUsage);
    this.drops.frustumCulled = false;
    this.drops.count = 0;
    this.group.add(this.drops);
  }

  /** Every frame: who is in the water, how they're posed, and what the water does round them. */
  update(dt: number, m: Match, cam: Vector3, me: number): void {
    this.time += dt;
    const space = m.world.space;
    for (const c of m.contestants) {
      const i = c.index;
      while (this.bodies.length <= i) this.bodies.push({ state: 0, next: 0, side: 1 });
      const b = this.bodies[i];
      const alive = c.status === "alive" && !m.seated(c);
      // The phone's own copy of the rule (remote bodies aren't sent it): deep water, swimming; else wading.
      const f = alive && c.y <= 0.3 ? space.floorAt(c.x, c.z, c.h + 0.3) : null;
      const state = !f ? 0 : f.swim ? 2 : f.water > 0.25 ? 1 : 0;
      const h = this.crowd.human(i);
      if (h) h.anim.swimWant = state === 2 ? 1 : 0;
      const near = Math.hypot(c.x - cam.x, c.z - cam.z) < RANGE;
      if (!f || state === 0) {
        b.state = state;
        continue;
      }
      const surface = state === 2 ? c.h + SWIM_FLOAT : f.h + f.water;
      const sp = Math.hypot(c.vx, c.vz);
      // Going in: the big splash.
      if (b.state === 0 && near) {
        const k = Math.min(1.4, 0.6 + sp / 6 + Math.max(0, -c.vy) / 8);
        this.splash(c.x, surface, c.z, k);
        if (i === me || Math.hypot(c.x - cam.x, c.z - cam.z) < 30) this.sound?.splash(i === me, true);
      }
      b.state = state;
      if (!near) continue;
      // Strokes and steps: a ring and spray, more often the faster it goes.
      if (sp > 0.4 && this.time >= b.next) {
        b.next = this.time + (state === 2 ? 0.55 : 0.4) * Math.max(0.6, 2.2 / Math.max(sp, 0.8));
        b.side = -b.side;
        const hd = c.heading;
        const fx = Math.sin(hd);
        const fz = Math.cos(hd);
        // Swimming: the hand going in, ahead and to the side; wading: the legs.
        const ax = state === 2 ? c.x + fx * 0.6 + fz * 0.25 * b.side : c.x;
        const az = state === 2 ? c.z + fz * 0.6 - fx * 0.25 * b.side : c.z;
        this.ring(ax, surface, az, state === 2 ? 1.2 : 0.9, 0.9);
        this.ring(c.x - fx * 0.7, surface, c.z - fz * 0.7, 1.6, 1.4);
        for (let k = 0; k < (state === 2 ? 5 : 3); k++) {
          this.drop(ax, surface + 0.05, az, (Math.random() - 0.5) * 1.2 + fx * sp * 0.2, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2 + fz * sp * 0.2, 0.035, surface);
        }
        if (i === me) this.sound?.stroke(state === 2);
      } else if (sp <= 0.4 && state === 2 && this.time >= b.next) {
        // Treading water: a slow ring.
        b.next = this.time + 1.4;
        this.ring(c.x, surface, c.z, 1.1, 1.8);
      }
    }
    this.frame(dt);
  }

  /** A body going in: white water thrown up in a crown, two rings. */
  private splash(x: number, y: number, z: number, k: number): void {
    for (let n = 0; n < Math.round(14 * k); n++) {
      const a = Math.random() * Math.PI * 2;
      const out = 0.8 + Math.random() * 1.6;
      this.drop(x, y + 0.1, z, Math.cos(a) * out * k, (2.2 + Math.random() * 2.6) * k, Math.sin(a) * out * k, 0.045 + Math.random() * 0.04, y);
    }
    this.ring(x, y, z, 2.6 * k, 1.1);
    this.ring(x, y, z, 1.4 * k, 0.8);
  }

  private ring(x: number, y: number, z: number, size: number, life: number): void {
    if (this.ringList.length >= MAX_RINGS) this.ringList.shift();
    this.ringList.push({ x, y, z, start: this.time, life, size });
  }

  private drop(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, floor: number): void {
    if (this.dropList.length >= MAX_DROPS) this.dropList.shift();
    this.dropList.push({ x, y, z, vx, vy, vz, age: 0, life: 1.4, size, floor });
  }

  private frame(dt: number): void {
    const at = this.ringAt.array as Float32Array;
    const sz = this.ringSize.array as Float32Array;
    at.fill(-1);
    for (let k = this.ringList.length - 1; k >= 0; k--) if (this.time - this.ringList[k].start > this.ringList[k].life) this.ringList.splice(k, 1);
    this.ringList.forEach((r, k) => {
      at[k * 4] = r.x;
      at[k * 4 + 1] = r.y;
      at[k * 4 + 2] = r.z;
      at[k * 4 + 3] = (this.time - r.start) / r.life;
      sz[k] = r.size;
    });
    this.ringAt.needsUpdate = this.ringSize.needsUpdate = true;
    this.rings.visible = this.ringList.length > 0;
    let n = 0;
    for (let k = this.dropList.length - 1; k >= 0; k--) {
      const d = this.dropList[k];
      d.age += dt;
      d.vy -= 9.8 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      // Back into the water: gone (a tiny ring where a big one lands).
      if (d.y < d.floor || d.age > d.life) {
        if (d.y < d.floor && d.size > 0.06) this.ring(d.x, d.floor, d.z, 0.4, 0.5);
        this.dropList.splice(k, 1);
      }
    }
    for (const d of this.dropList) {
      const s = d.size * (1 - d.age / d.life * 0.5);
      _m.makeScale(s, s * 1.4, s).setPosition(_v.set(d.x, d.y, d.z));
      this.drops.setMatrixAt(n++, _m);
    }
    this.drops.count = n;
    if (n) this.drops.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.rings.geometry.dispose();
    (this.rings.material as ShaderMaterial).dispose();
    this.drops.geometry.dispose();
    (this.drops.material as MeshBasicMaterial).dispose();
    this.group.removeFromParent();
  }
}
