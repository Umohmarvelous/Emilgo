// Potholes with water (SPEC-V2 §6.1): puddles across the field that reflect
// the sky, ripple, and splash when someone runs through them.
//
//   Low, Medium  the water mirrors the sky's colours (a gradient from the
//                reflected direction) with a sun glint: no extra pass.
//   High         a real reflection: the sky, the clouds, Mama, the mountains
//                and the laser towers are drawn once more, mirrored in the
//                ground plane, into a small texture (only what's on the
//                REFLECT layer: about ten draw calls).
//
// Every puddle lies in the same plane, so one mirror serves them all, and all
// of them are one mesh. Splashes are a ring in the water (up to 8 at once) and
// a burst of droplets (one pooled draw call). Visual only: the referee never
// sees puddles.

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";

import type { Course } from "../config";
import { Rng } from "../core/rng";
import { canvasTexture, glow } from "../world/tex";

/** Objects on this layer are drawn into the puddles' mirror (High). */
export const REFLECT_LAYER = 1;
const Y = 0.018;
const RIPPLES = 8;
const DROPS = 72;

interface Puddle {
  x: number;
  z: number;
  r: number;
}

/** Where puddles go: across the field, never on the start line, the finish or the plaza. */
function place(course: Course, seed: number): Puddle[] {
  const rng = new Rng(seed ^ 0x2545f491);
  const n = Math.round((course.distance / 100) * 7);
  const out: Puddle[] = [];
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 20; t++) {
      const x = rng.range(-course.halfWidth + 1.5, course.halfWidth - 1.5);
      const z = rng.range(course.finishZ + 6, -8);
      const r = rng.range(0.55, 1.35);
      if (out.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r + 2)) {
        out.push({ x, z, r });
        break;
      }
    }
  }
  return out;
}

/** An irregular, rounded blob: a fan of 18 radii, smoothed. */
function blob(p: Puddle, rng: Rng, grow: number, y: number, pos: number[], idx: number[]): void {
  const n = 18;
  const raw = Array.from({ length: n }, () => rng.range(0.75, 1.15));
  const rad = raw.map((v, i) => (v + raw[(i + 1) % n] + raw[(i + n - 1) % n]) / 3);
  const base = pos.length / 3;
  pos.push(p.x, y, p.z);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = p.r * rad[i] * grow;
    pos.push(p.x + Math.cos(a) * r, y, p.z + Math.sin(a) * r * 0.8);
  }
  for (let i = 0; i < n; i++) idx.push(base, base + 1 + ((i + 1) % n), base + 1 + i);
}

export interface SkyColours {
  top: Color;
  horizon: Color;
  sunDir: Vector3;
  sunColor: Color;
  night: boolean;
}

export class Potholes {
  readonly group = new Group();
  private readonly puddles: Puddle[];
  private readonly water: ShaderMaterial;
  private readonly ripples: Vector4[] = Array.from({ length: RIPPLES }, () => new Vector4(0, 0, -99, 0));
  private nextRipple = 0;
  private time = 0;
  private readonly last = new Map<number, number>();
  // Droplets.
  private readonly drops: Points;
  private readonly dPos = new Float32Array(DROPS * 3);
  private readonly dVel = new Float32Array(DROPS * 3);
  private readonly dLife = new Float32Array(DROPS);
  private nextDrop = 0;
  // The mirror (High).
  private readonly mirror: { rt: WebGLRenderTarget; cam: PerspectiveCamera; tm: Matrix4 } | null;

  constructor(course: Course, seed: number, sky: SkyColours, real: boolean) {
    this.puddles = place(course, seed);
    const rng = new Rng(seed ^ 0x9e3779b9);
    const wp: number[] = [];
    const wi: number[] = [];
    const rp: number[] = [];
    const ri: number[] = [];
    for (const p of this.puddles) {
      // The water, and a darker, damp rim of mud a little wider.
      const shape = rng.next() * 1e9;
      blob(p, new Rng(shape), 1, Y, wp, wi);
      blob(p, new Rng(shape), 1.28, Y - 0.004, rp, ri);
    }
    const geo = (pos: number[], idx: number[]) => {
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    };
    if (this.puddles.length) {
      const rim = new Mesh(geo(rp, ri), new MeshBasicMaterial({ color: 0x1a1208, transparent: true, opacity: 0.26, depthWrite: false }));
      rim.renderOrder = 1;
      this.group.add(rim);
    }

    this.mirror = real
      ? { rt: new WebGLRenderTarget(512, 256, { type: HalfFloatType, samples: 0 }), cam: new PerspectiveCamera(), tm: new Matrix4() }
      : null;
    this.water = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTop: { value: sky.top.clone() },
        uHorizon: { value: sky.horizon.clone() },
        uSun: { value: sky.sunDir.clone().normalize() },
        uSunColor: { value: sky.sunColor.clone().multiplyScalar(sky.night ? 0.4 : 1) },
        uMud: { value: new Color(0x2a2016) },
        uRip: { value: this.ripples },
        uMirror: { value: this.mirror?.rt.texture ?? null },
        uTm: { value: this.mirror?.tm ?? new Matrix4() },
        fogColor: { value: new Color() },
        fogNear: { value: 1 },
        fogFar: { value: 1000 },
      },
      defines: this.mirror ? { MIRROR: 1, RIPPLES } : { RIPPLES },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        #ifdef MIRROR
        uniform mat4 uTm;
        varying vec4 vM;
        #endif
        #include <fog_pars_vertex>
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          #ifdef MIRROR
          vM = uTm * w;
          #endif
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uTop, uHorizon, uSun, uSunColor, uMud;
        uniform vec4 uRip[RIPPLES];
        varying vec3 vW;
        #ifdef MIRROR
        uniform sampler2D uMirror;
        varying vec4 vM;
        #endif
        #include <fog_pars_fragment>
        void main() {
          vec2 p = vW.xz;
          // Small wind ripples…
          vec2 g = vec2(sin(p.x * 6.0 + uTime * 1.7) + sin((p.x + p.y) * 9.0 - uTime * 2.3) * 0.5, cos(p.y * 7.0 - uTime * 1.3) + cos((p.x - p.y) * 8.0 + uTime * 2.1) * 0.5) * 0.012;
          // …and the rings of splashes.
          for (int i = 0; i < RIPPLES; i++) {
            vec4 r = uRip[i];
            float age = uTime - r.z;
            if (age < 0.0 || age > 1.6) continue;
            vec2 d = p - r.xy;
            float dist = length(d) + 1e-4;
            float ring = dist - age * 0.9;
            float wave = cos(ring * 28.0) * exp(-ring * ring * 60.0) * exp(-age * 2.2) * r.w;
            g += (d / dist) * wave * 0.22;
          }
          vec3 n = normalize(vec3(g.x, 1.0, g.y));
          vec3 v = normalize(cameraPosition - vW);
          vec3 refl = reflect(-v, n);
          float fres = 0.25 + 0.75 * pow(1.0 - max(dot(n, v), 0.0), 3.0);
          #ifdef MIRROR
          vec4 m = vM;
          m.xy += g * 18.0 * m.w;
          vec3 sky = texture2DProj(uMirror, m).rgb;
          #else
          vec3 sky = mix(uHorizon, uTop, smoothstep(0.0, 0.6, refl.y));
          #endif
          vec3 col = mix(uMud, sky, fres);
          col += uSunColor * pow(max(dot(refl, uSun), 0.0), 120.0) * 1.4;
          gl_FragColor = vec4(col, 0.9);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    if (this.puddles.length) {
      const water = new Mesh(geo(wp, wi), this.water);
      water.renderOrder = 2;
      this.group.add(water);
    }

    // Droplets.
    const dg = new BufferGeometry();
    dg.setAttribute("position", new Float32BufferAttribute(this.dPos, 3));
    this.drops = new Points(
      dg,
      new ShaderMaterial({
        uniforms: { uMap: { value: canvasTexture("glow", 32, glow, false) }, uScale: { value: 400 } },
        vertexShader: /* glsl */ `
          uniform float uScale;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = position.y < -50.0 ? 0.0 : 0.05 * uScale / max(1.0, -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          void main() { float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(0.85, 0.9, 1.0, a * 0.8); }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.drops.frustumCulled = false;
    this.dPos.fill(-100);
    this.group.add(this.drops);
  }

  /** Point size scale (on resize). */
  setScale(px: number, fovDeg: number): void {
    (this.drops.material as ShaderMaterial).uniforms.uScale.value = px / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * Someone at (x, z), moving at `speed`: if they're in a puddle and haven't
   * splashed in the last third of a second, splash. Returns true on a splash.
   */
  step(who: number, x: number, z: number, speed: number): boolean {
    if (speed < 0.8) return false;
    const last = this.last.get(who) ?? -1;
    if (this.time - last < 0.33) return false;
    for (const p of this.puddles) {
      const dx = x - p.x;
      const dz = (z - p.z) / 0.8;
      if (dx * dx + dz * dz > p.r * p.r * 0.8) continue;
      this.last.set(who, this.time);
      this.splash(x, z, Math.min(1, speed / 6));
      return true;
    }
    return false;
  }

  private splash(x: number, z: number, k: number): void {
    this.ripples[this.nextRipple].set(x, z, this.time, 0.6 + k * 0.6);
    this.nextRipple = (this.nextRipple + 1) % RIPPLES;
    const n = Math.round(6 + k * 8);
    for (let i = 0; i < n; i++) {
      const j = this.nextDrop;
      this.nextDrop = (this.nextDrop + 1) % DROPS;
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 1.4 * k;
      this.dPos.set([x + Math.cos(a) * 0.12, Y + 0.02, z + Math.sin(a) * 0.12], j * 3);
      this.dVel.set([Math.cos(a) * s, 1.4 + Math.random() * 1.8 * k, Math.sin(a) * s], j * 3);
      this.dLife[j] = 0.45 + Math.random() * 0.25;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.water.uniforms.uTime.value = this.time;
    let live = false;
    for (let i = 0; i < DROPS; i++) {
      if (this.dLife[i] <= 0) continue;
      live = true;
      this.dLife[i] -= dt;
      const o = i * 3;
      this.dVel[o + 1] -= 9.8 * dt;
      this.dPos[o] += this.dVel[o] * dt;
      this.dPos[o + 1] += this.dVel[o + 1] * dt;
      this.dPos[o + 2] += this.dVel[o + 2] * dt;
      if (this.dLife[i] <= 0 || this.dPos[o + 1] < 0) {
        this.dLife[i] = 0;
        this.dPos[o + 1] = -100;
      }
    }
    if (live || this.wasLive) (this.drops.geometry.attributes.position as Float32BufferAttribute).needsUpdate = true;
    this.wasLive = live;
  }
  private wasLive = false;

  /**
   * High: draw the mirrored view into the puddles' texture. Call just before
   * the frame is drawn, with the frame's camera.
   */
  renderMirror(renderer: WebGLRenderer, scene: Scene, camera: Camera & PerspectiveCamera): void {
    const M = this.mirror;
    if (!M || !this.puddles.length) return;
    const cam = M.cam;
    cam.fov = camera.fov;
    cam.aspect = camera.aspect;
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateProjectionMatrix();
    // Reflect the eye and where it looks in the plane y = Y.
    camera.getWorldPosition(_eye);
    camera.getWorldDirection(_dir);
    _look.copy(_eye).add(_dir);
    _eye.y = 2 * Y - _eye.y;
    _look.y = 2 * Y - _look.y;
    cam.position.copy(_eye);
    // The camera's up, reflected in the plane (as three's Reflector does).
    cam.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    cam.up.y = -cam.up.y;
    cam.lookAt(_look);
    cam.updateMatrixWorld();
    cam.layers.set(REFLECT_LAYER);
    M.tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    M.tm.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // Size: about a third of the screen.
    const w = Math.max(256, Math.round(renderer.domElement.width / 3));
    const h = Math.max(128, Math.round(renderer.domElement.height / 3));
    if (M.rt.width !== w || M.rt.height !== h) M.rt.setSize(w, h);
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    this.group.visible = false;
    renderer.setRenderTarget(M.rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    this.group.visible = true;
    renderer.shadowMap.autoUpdate = prevShadow;
  }

  dispose(): void {
    this.mirror?.rt.dispose();
    this.group.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      (m.material as { dispose?: () => void } | undefined)?.dispose?.();
    });
  }
}

const _eye = new Vector3();
const _dir = new Vector3();
const _look = new Vector3();
