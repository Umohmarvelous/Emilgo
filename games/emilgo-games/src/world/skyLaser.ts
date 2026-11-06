// The sky laser (SPEC-V3 §7): how the open worlds take a life. A white-hot
// column comes slowly down out of the clouds for ZONE.laser seconds (the
// warning: everyone sees it, a ring closes on the ground where it will land,
// and it follows its target), then hits at once: the column flares, a burst of
// white smoke, a heat flash and a scorch mark that fades over a minute. The
// body's fall is picked from the beam's angle (crowd.ts `strike`).
//
//   columns   two instanced tubes for every beam at once: a hard core and a
//             soft glow shell, both additive (bloom takes them further on High)
//   ring      the warning on the ground (one instanced draw)
//   smoke     soft points, pooled (one draw)
//   flash     a glow sprite per hit, pooled
//   scorch    a decal pool (decals.ts)
//
// Each beam slants a little off vertical from its own direction, fixed by the
// strike's key, so every phone draws it, and drops the body, the same way.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";

import { ZONE } from "../config";
import type { Tier } from "../graphics/tiers";
import { DecalPool } from "./decals";
import { canvasTexture, glow, type Painter } from "./tex";

/** How high the beam starts, metres: far enough that its top is lost in the sky. */
const SKY = 420;
const MAX = 6;
const PUFFS = 36;
/** Seconds the column stays after the hit, fading. */
const AFTER = 0.7;

const TUBE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
varying float vY;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vC = instanceColor;
  vY = uv.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/** Soft-edged by the view angle (a tube seen side-on glows in its middle), brightest low down. */
const TUBE_FRAG = /* glsl */ `
uniform float power;
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
varying float vY;
void main() {
  float f = pow(abs(dot(normalize(vN), normalize(vV))), power);
  float low = (0.55 + 0.45 * (1.0 - vY)) * (1.0 - smoothstep(0.55, 1.0, vY));
  gl_FragColor = vec4(vC * f * low, 1.0);
}`;

const SMOKE_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float scale;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * scale / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const SMOKE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 color;
varying float vAlpha;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(color, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

/** A scorch: soot, darkest in the middle, ragged at the edge. */
const scorch: Painter = (g, s, rnd) => {
  g.clearRect(0, 0, s, s);
  for (let k = 0; k < 26; k++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * s * 0.22;
    const r = s * (0.12 + rnd() * 0.16);
    const x = s / 2 + Math.cos(a) * d;
    const y = s / 2 + Math.sin(a) * d;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(14,10,8,0.5)");
    gr.addColorStop(1, "rgba(14,10,8,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.2);
  gr.addColorStop(0, "rgba(6,4,3,0.95)");
  gr.addColorStop(1, "rgba(6,4,3,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
};

/** The warning ring: a bright rim with a soft inner glow. */
const ringPaint: Painter = (g, s) => {
  g.clearRect(0, 0, s, s);
  const gr = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
  gr.addColorStop(0, "rgba(255,255,255,0)");
  gr.addColorStop(0.75, "rgba(255,255,255,0.25)");
  gr.addColorStop(0.9, "rgba(255,255,255,1)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
};

interface Strike {
  on: boolean;
  /** Seconds since it started coming down. */
  t: number;
  /** Seconds it takes to come down. */
  warn: number;
  hit: boolean;
  /** Where it will land (followed until the hit). */
  target: () => { x: number; y: number; z: number } | null;
  ground: Vector3;
  /** Unit vector up the beam, towards its source. */
  up: Vector3;
  fromYaw: number;
  lean: number;
}

interface Puff {
  on: boolean;
  p: Vector3;
  v: Vector3;
  age: number;
  life: number;
  size: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _a = new Vector3();
const _Y = new Vector3(0, 1, 0);
const _c = new Color();
const ZERO = new Matrix4().makeScale(0, 0, 0);

/** The beam's direction and slant for a strike, from its key (the same on every phone). */
export function beamAngles(key: string): { fromYaw: number; lean: number } {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const u = ((h >>> 0) % 10007) / 10007;
  const w = ((Math.imul(h, 2654435761) >>> 0) % 9973) / 9973;
  // v5: nearly straight down, from high up (a beam from orbit doesn't slant much): at most ~7°.
  return { fromYaw: u * Math.PI * 2, lean: w < 0.25 ? w * 0.1 : 0.03 + (w - 0.25) * 0.12 };
}

export class SkyLaser {
  readonly group = new Group();
  private readonly strikes: Strike[] = [];
  private readonly core: InstancedMesh;
  private readonly shell: InstancedMesh;
  private readonly ring: InstancedMesh;
  private readonly puffs: Puff[] = [];
  private readonly smoke: Points;
  private readonly smokePos: Float32Array;
  private readonly smokeSize: Float32Array;
  private readonly smokeAlpha: Float32Array;
  private readonly flashes: { s: Sprite; t: number }[] = [];
  private readonly scorch: DecalPool;
  private time = 0;
  /** A hit landed this frame near the camera: for the screen's heat flash (0 … 1). */
  heat = 0;

  constructor(tier: Tier) {
    const tube = new CylinderGeometry(1, 1, 1, tier === 0 ? 8 : 12, 1, true);
    tube.translate(0, 0.5, 0);
    const tubeMat = (power: number) =>
      new ShaderMaterial({
        uniforms: { power: { value: power } },
        vertexShader: TUBE_VERT,
        fragmentShader: TUBE_FRAG,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
    this.core = new InstancedMesh(tube, tubeMat(0.6), MAX);
    this.shell = new InstancedMesh(tube, tubeMat(2.2), MAX);
    const ringGeo = new PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new InstancedMesh(
      ringGeo,
      new ShaderMaterial({
        uniforms: { map: { value: canvasTexture("laser-ring", 128, ringPaint, false) } },
        vertexShader: `varying vec2 vUv; varying vec3 vC; void main(){ vUv = uv; vC = instanceColor; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vC; void main(){ gl_FragColor = vec4(vC * texture2D(map, vUv).a, 1.0); }`,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
      MAX,
    );
    for (const mesh of [this.core, this.shell, this.ring]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      for (let i = 0; i < MAX; i++) {
        mesh.setMatrixAt(i, ZERO);
        mesh.setColorAt(i, _c.setRGB(0, 0, 0));
      }
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
    }
    for (let i = 0; i < MAX; i++) {
      this.strikes.push({ on: false, t: 0, warn: ZONE.laser, hit: false, target: () => null, ground: new Vector3(), up: new Vector3(0, 1, 0), fromYaw: 0, lean: 0 });
    }

    // Smoke.
    const n = MAX * PUFFS;
    this.smokePos = new Float32Array(n * 3);
    this.smokeSize = new Float32Array(n);
    this.smokeAlpha = new Float32Array(n);
    for (let i = 0; i < n; i++) this.puffs.push({ on: false, p: new Vector3(), v: new Vector3(), age: 0, life: 1, size: 1 });
    const sg = new BufferGeometry();
    // BufferAttribute (not Float32BufferAttribute, which copies): these arrays are written every frame.
    sg.setAttribute("position", new BufferAttribute(this.smokePos, 3).setUsage(DynamicDrawUsage));
    sg.setAttribute("aSize", new BufferAttribute(this.smokeSize, 1).setUsage(DynamicDrawUsage));
    sg.setAttribute("aAlpha", new BufferAttribute(this.smokeAlpha, 1).setUsage(DynamicDrawUsage));
    this.smoke = new Points(
      sg,
      new ShaderMaterial({
        uniforms: { map: { value: canvasTexture("glow", 64, glow, false) }, color: { value: new Color(0xf4efe8) }, scale: { value: 300 } },
        vertexShader: SMOKE_VERT,
        fragmentShader: SMOKE_FRAG,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.smoke.frustumCulled = false;
    this.smoke.visible = false;
    this.group.add(this.smoke);

    // Heat flashes.
    const flashMap = canvasTexture("glow", 64, glow, false) as CanvasTexture;
    for (let i = 0; i < 3; i++) {
      const s = new Sprite(new SpriteMaterial({ map: flashMap, color: 0xfff1d8, blending: AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      this.flashes.push({ s, t: Infinity });
      this.group.add(s);
    }

    this.scorch = new DecalPool(canvasTexture("scorch", 128, scorch, false), 12, new Color(1, 1, 1), 60, 20);
    this.group.add(this.scorch.mesh);
  }

  /** Point sizes follow the screen's height (call on resize). */
  setViewport(heightPx: number): void {
    (this.smoke.material as ShaderMaterial).uniforms.scale.value = heightPx * 0.9;
  }

  /**
   * Start a beam coming down on `target` (followed until it hits, `warn`
   * seconds later). `key` fixes its slant. Returns the beam's angles (the
   * fall reads them).
   */
  strike(key: string, target: () => { x: number; y: number; z: number } | null, warn: number = ZONE.laser): { fromYaw: number; lean: number } {
    const ang = beamAngles(key);
    let s = this.strikes.find((k) => !k.on);
    if (!s) s = this.strikes.reduce((a, b) => (a.t > b.t ? a : b));
    s.on = true;
    s.t = 0;
    s.warn = Math.max(0.05, warn);
    s.hit = false;
    s.target = target;
    s.fromYaw = ang.fromYaw;
    s.lean = ang.lean;
    s.up.set(Math.sin(ang.lean) * Math.sin(ang.fromYaw), Math.cos(ang.lean), Math.sin(ang.lean) * Math.cos(ang.fromYaw));
    const p = target();
    if (p) s.ground.set(p.x, p.y, p.z);
    return ang;
  }

  clear(): void {
    for (const s of this.strikes) s.on = false;
    for (const p of this.puffs) p.on = false;
    for (const f of this.flashes) {
      f.t = Infinity;
      f.s.visible = false;
    }
    this.scorch.clear();
  }

  /** `cam`: for the heat flash on the screen when a hit is close. */
  update(dt: number, cam: Vector3): void {
    this.time += dt;
    this.heat = Math.max(0, this.heat - dt * 2.5);
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const s = this.strikes[i];
      if (!s.on) {
        this.core.setMatrixAt(i, ZERO);
        this.shell.setMatrixAt(i, ZERO);
        this.ring.setMatrixAt(i, ZERO);
        continue;
      }
      any = true;
      s.t += dt;
      if (!s.hit) {
        const p = s.target();
        if (p) s.ground.set(p.x, p.y, p.z);
      }
      if (!s.hit && s.t >= s.warn) this.hit(s, cam);
      const len = SKY / s.up.y;
      // Coming down: the bottom of the column falls from the clouds to the ground (eased in: slow, then faster).
      const u = s.hit ? 1 : Math.min(1, s.t / s.warn);
      const down = s.hit ? 1 : u * u * (3 - 2 * u) * 0.9 + 0.1 * u;
      const top = _a.copy(s.ground).addScaledVector(s.up, len);
      const bottom = _v.copy(top).addScaledVector(s.up, -len * down);
      const after = s.hit ? Math.max(0, 1 - (s.t - s.warn) / AFTER) : 1;
      const flick = 0.9 + 0.1 * Math.sin(this.time * 60 + i);
      _q.setFromUnitVectors(_Y, s.up);
      const shown = len * down;
      // v5: thin like a real beam. Never under a pixel or so, however far you stand from it.
      const minR = cam.distanceTo(s.ground) * 0.0012;
      // The core: a thread while it comes down, a little fuller on the hit.
      const rc = Math.max(minR, s.hit ? 0.08 + 0.1 * after : 0.025 + 0.02 * u);
      this.core.setMatrixAt(i, _m.compose(bottom, _q, _s.set(rc, shown, rc)));
      this.core.setColorAt(i, _c.setRGB(1, 0.96, 0.9).multiplyScalar((s.hit ? 2.4 * after : 0.9 + 0.6 * u) * flick));
      // The shell: from the first instant a faint shaft the whole way down (so
      // everyone, looking level, sees where it will land), brightening as the core comes.
      const rs = Math.max(minR * 4, s.hit ? 0.3 + 0.35 * (1 - after) : 0.14 + 0.08 * u);
      _v.copy(s.ground);
      this.shell.setMatrixAt(i, _m.compose(s.hit ? bottom : _v, _q, _s.set(rs, s.hit ? shown : len, rs)));
      this.shell.setColorAt(i, _c.setRGB(1, 0.72, 0.5).multiplyScalar((s.hit ? 0.7 * after : 0.1 + 0.3 * u * u) * flick));
      // The ring closes on where it will land, pulsing faster as it comes.
      if (!s.hit) {
        const r = 2.2 - 1.7 * u;
        _q.identity();
        _v.set(s.ground.x, s.ground.y + 0.04, s.ground.z);
        this.ring.setMatrixAt(i, _m.compose(_v, _q, _s.set(r, 1, r)));
        this.ring.setColorAt(i, _c.setRGB(1, 0.45, 0.2).multiplyScalar((0.8 + 0.9 * u) * (0.75 + 0.25 * Math.sin(this.time * (14 + 26 * u)))));
      } else this.ring.setMatrixAt(i, ZERO);
      if (s.hit && after <= 0) s.on = false;
    }
    for (const mesh of [this.core, this.shell, this.ring]) {
      mesh.visible = any;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Smoke: up and out, slowing, growing, fading.
    let puffs = 0;
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i];
      if (p.on) {
        p.age += dt;
        if (p.age >= p.life) p.on = false;
      }
      if (!p.on) {
        this.smokeAlpha[i] = 0;
        continue;
      }
      puffs++;
      p.v.multiplyScalar(Math.exp(-dt * 1.6));
      p.v.y += dt * 0.6;
      p.p.addScaledVector(p.v, dt);
      const k = p.age / p.life;
      this.smokePos[i * 3] = p.p.x;
      this.smokePos[i * 3 + 1] = p.p.y;
      this.smokePos[i * 3 + 2] = p.p.z;
      this.smokeSize[i] = p.size * (1 + k * 2.2);
      this.smokeAlpha[i] = 0.55 * Math.min(1, p.age * 8) * (1 - k) * (1 - k);
    }
    this.smoke.visible = puffs > 0;
    if (puffs) {
      const g = this.smoke.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
      g.attributes.aAlpha.needsUpdate = true;
    }

    for (const f of this.flashes) {
      if (!Number.isFinite(f.t)) continue;
      f.t += dt;
      const k = f.t / 0.45;
      if (k >= 1) {
        f.t = Infinity;
        f.s.visible = false;
        continue;
      }
      const size = 1 + 3.2 * Math.min(1, f.t / 0.08);
      f.s.scale.set(size, size, 1);
      f.s.material.opacity = 1 - k;
    }
    this.scorch.update(dt);
  }

  private hit(s: Strike, cam: Vector3): void {
    s.hit = true;
    const g = s.ground;
    // White smoke from the ground, thrown out and up.
    let made = 0;
    for (const p of this.puffs) {
      if (p.on) continue;
      p.on = true;
      p.age = 0;
      p.life = 1.6 + Math.random() * 1.4;
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 1.8;
      p.p.set(g.x + Math.cos(a) * 0.3, g.y + 0.2 + Math.random() * 0.6, g.z + Math.sin(a) * 0.3);
      p.v.set(Math.cos(a) * sp, 1 + Math.random() * 2.5, Math.sin(a) * sp);
      p.size = 0.45 + Math.random() * 0.7;
      if (++made >= PUFFS) break;
    }
    const f = this.flashes.find((x) => !Number.isFinite(x.t)) ?? this.flashes[0];
    f.t = 0;
    f.s.position.set(g.x, g.y + 1, g.z);
    f.s.visible = true;
    this.scorch.add(g.x, g.y, g.z, Math.random() * Math.PI * 2, 1.5, 1.5);
    const d = cam.distanceTo(g);
    this.heat = Math.max(this.heat, d < 30 ? 1 - d / 30 : 0);
  }

  dispose(): void {
    for (const m of [this.core, this.shell, this.ring]) {
      (m.material as ShaderMaterial).dispose();
    }
    this.core.geometry.dispose();
    this.ring.geometry.dispose();
    this.smoke.geometry.dispose();
    (this.smoke.material as ShaderMaterial).dispose();
    for (const f of this.flashes) f.s.material.dispose();
    this.scorch.dispose();
  }
}
