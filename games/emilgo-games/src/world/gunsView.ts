// Guns, drawn (v4 Phase 2): the guns in everyone's hands (the arms round them:
// human/hold.ts), the loot on the ground (a gun turning over a pillar in its
// rarity's colour, ammo boxes, armour plates), the crates and fuel drums, and
// the shots: a streak from the muzzle, a flash, a puff where it struck, a
// drum's blast. One instanced draw per kind of thing, only what is near.
//
// The guns are low-poly and coloured per vertex like the rest of the street;
// a rarity tints the body (instance colour) and lights its glow strips.

import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Camera,
} from "three";

import type { Sound } from "../audio/sound";
import { GUN_KINDS, GUNS, type GunKind } from "../config";
import type { Match } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import { HIT_KINDS, type GunsModule } from "../game/modules/guns";
import type { VehiclesModule } from "../game/modules/vehicles";
import type { Tier } from "../graphics/tiers";
import type { Crowd } from "./crowd";
import { merge, part } from "./geo";
import { cdnOn, modelFor } from "../assets/cdn";
import { newHold, type Hold } from "./human/hold";

/** Rarity colours, Common → Mythic (the HUD's too). */
export const RARITY_HEX = [0xb9bcc2, 0x3ccf6e, 0x3a9bff, 0xb65cff, 0xffb020, 0xff3b30] as const;
export const RARITY_CSS = ["#b9bcc2", "#3ccf6e", "#3a9bff", "#b65cff", "#ffb020", "#ff3b30"] as const;
/** The tint each rarity gives a gun's body (× its grey). */
const TINT: readonly [number, number, number][] = [
  [0.62, 0.64, 0.68],
  [0.42, 0.8, 0.48],
  [0.36, 0.58, 1.15],
  [0.78, 0.42, 1.15],
  [1.7, 1.2, 0.45],
  [1.35, 0.3, 0.26],
];
/** The muzzle in each gun's own space. */
const MUZZLE: Record<GunKind, [number, number, number]> = { pistol: [0, 0.11, 0.21], rifle: [0, 0.06, 0.99], smg: [0, 0.045, 0.6], shotgun: [0, 0.055, 0.93] };
/** Guns, loot and breakables are drawn this near, by tier (metres); people's guns a little further. */
const VIEW = [45, 60, 80] as const;
const HELD_VIEW = [50, 70, 90] as const;
const MAX_TRACERS = 48;
const MAX_FLASH = 24;
const MAX_PUFFS = 64;

const BODY = 0x5a5c60;
const DARK = 0x141516;
const GRIP = 0x1c1c1a;
/** A glow strip: drawn bright (its colour goes over 1 and the material lifts it). */
function glow(g: BufferGeometry): BufferGeometry {
  const c = g.attributes.color.array as Float32Array;
  for (let i = 0; i < c.length; i++) c[i] = 3;
  return g;
}

function gunGeometry(k: GunKind): BufferGeometry {
  const B = (w: number, h: number, d: number, color: number, p: [number, number, number], r: [number, number, number] = [0, 0, 0]) => part(new BoxGeometry(w, h, d), color, { p, r });
  const C = (r: number, len: number, color: number, p: [number, number, number], seg = 6) => part(new CylinderGeometry(r, r, len, seg), color, { p, r: [Math.PI / 2, 0, 0] });
  switch (k) {
    case "rifle":
      return merge([
        B(0.04, 0.085, 0.16, GRIP, [0, 0, 0.08]),
        C(0.014, 0.12, DARK, [0, 0.03, 0.2]),
        B(0.032, 0.055, 0.2, BODY, [0, 0.012, 0.33]),
        B(0.036, 0.05, 0.26, BODY, [0, 0.06, 0.36]),
        B(0.026, 0.12, 0.06, DARK, [0, -0.07, 0.4], [-0.25, 0, 0]),
        B(0.03, 0.11, 0.04, GRIP, [0, -0.045, 0.29], [0.32, 0, 0]),
        B(0.045, 0.052, 0.34, BODY, [0, 0.058, 0.66]),
        B(0.02, 0.008, 0.6, DARK, [0, 0.088, 0.55]),
        C(0.009, 0.16, DARK, [0, 0.06, 0.9]),
        C(0.013, 0.05, DARK, [0, 0.06, 0.97]),
        B(0.026, 0.05, 0.06, GRIP, [0, 0.012, 0.6], [0.5, 0, 0]),
        B(0.042, 0.05, 0.07, DARK, [0, 0.125, 0.325]),
        glow(B(0.006, 0.006, 0.3, 0, [0.024, 0.06, 0.66])),
        glow(B(0.006, 0.006, 0.3, 0, [-0.024, 0.06, 0.66])),
      ]);
    case "smg":
      return merge([
        B(0.012, 0.05, 0.16, DARK, [0, 0.02, 0.08]),
        B(0.03, 0.06, 0.012, GRIP, [0, 0, 0.006]),
        B(0.04, 0.07, 0.24, BODY, [0, 0.04, 0.27]),
        B(0.026, 0.16, 0.034, DARK, [0, -0.07, 0.34]),
        B(0.03, 0.1, 0.04, GRIP, [0, -0.035, 0.22], [0.3, 0, 0]),
        C(0.02, 0.2, DARK, [0, 0.045, 0.49], 8),
        B(0.034, 0.03, 0.05, DARK, [0, 0.088, 0.26]),
        glow(B(0.005, 0.005, 0.18, 0, [0.021, 0.05, 0.27])),
      ]);
    case "shotgun":
      return merge([
        B(0.04, 0.09, 0.26, GRIP, [0, -0.012, 0.13], [0.08, 0, 0]),
        B(0.044, 0.07, 0.2, BODY, [0, 0.03, 0.34]),
        C(0.012, 0.5, DARK, [0, 0.055, 0.68]),
        C(0.012, 0.42, BODY, [0, 0.022, 0.64]),
        B(0.046, 0.046, 0.17, GRIP, [0, 0.026, 0.6]),
        B(0.03, 0.06, 0.04, GRIP, [0, -0.01, 0.27], [0.2, 0, 0]),
        glow(B(0.005, 0.005, 0.16, 0, [0.024, 0.03, 0.34])),
      ]);
    default:
      return merge([
        B(0.028, 0.032, 0.19, BODY, [0, 0.11, 0.1]),
        B(0.026, 0.026, 0.15, GRIP, [0, 0.08, 0.1]),
        B(0.026, 0.11, 0.045, GRIP, [0, 0.025, 0.03], [0.22, 0, 0]),
        glow(B(0.004, 0.004, 0.003, 0, [0, 0.13, 0.19])),
      ]);
  }
}

function ammoGeometry(): BufferGeometry {
  return merge([
    part(new BoxGeometry(0.42, 0.22, 0.24), 0x4b5a32, { p: [0, 0.11, 0] }),
    part(new BoxGeometry(0.44, 0.04, 0.26), 0x2e3820, { p: [0, 0.23, 0] }),
    part(new BoxGeometry(0.12, 0.03, 0.05), 0xd8b23a, { p: [0, 0.26, 0] }),
    part(new BoxGeometry(0.2, 0.1, 0.005), 0xe8d9a0, { p: [0, 0.12, 0.121] }),
  ]);
}

function plateGeometry(): BufferGeometry {
  return merge([
    part(new BoxGeometry(0.3, 0.38, 0.04), 0x5c6149, { p: [0, 0.2, 0], r: [-0.25, 0, 0] }),
    part(new BoxGeometry(0.32, 0.05, 0.05), 0x2b2d24, { p: [0, 0.39, -0.05], r: [-0.25, 0, 0] }),
    glow(part(new BoxGeometry(0.2, 0.012, 0.01), 0, { p: [0, 0.27, 0.035], r: [-0.25, 0, 0] })),
  ]);
}

function crateGeometry(): BufferGeometry {
  const h = GUNS.crate.half;
  return merge([
    part(new BoxGeometry(h * 2, h * 2, h * 2), 0x56623a, { p: [0, h, 0] }),
    part(new BoxGeometry(h * 2 + 0.03, 0.06, h * 2 + 0.03), 0x343b22, { p: [0, h * 2 - 0.03, 0] }),
    part(new BoxGeometry(h * 2 + 0.03, 0.06, h * 2 + 0.03), 0x343b22, { p: [0, 0.03, 0] }),
    part(new BoxGeometry(0.3, 0.12, 0.01), 0xe7d79a, { p: [0, h * 1.2, h + 0.01] }),
    part(new BoxGeometry(0.01, 0.12, 0.3), 0xe7d79a, { p: [h + 0.01, h * 1.2, 0] }),
  ]);
}

function drumGeometry(): BufferGeometry {
  const r = GUNS.drum.r;
  const t = GUNS.drum.tall;
  return merge([
    part(new CylinderGeometry(r, r, t, 10), 0xb3291f, { p: [0, t / 2, 0] }),
    part(new CylinderGeometry(r + 0.012, r + 0.012, 0.04, 10), 0x5c1510, { p: [0, t * 0.33, 0] }),
    part(new CylinderGeometry(r + 0.012, r + 0.012, 0.04, 10), 0x5c1510, { p: [0, t * 0.66, 0] }),
    part(new CylinderGeometry(r * 0.98, r, 0.02, 10), 0x6e1a12, { p: [0, t, 0] }),
    part(new BoxGeometry(0.16, 0.16, 0.01), 0xf2c230, { p: [0, t * 0.5, r + 0.004], r: [0, 0, Math.PI / 4] }),
  ]);
}

/** Vertex colours, lit; a colour over 1 glows (the rarity strips). */
function gunMaterial(tier: Tier): Material {
  const m = tier === 0 ? new MeshLambertMaterial({ vertexColors: true }) : new MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.42 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance += max(vColor.rgb - 1.0, vec3(0.0)) * 0.6;\n#endif");
  };
  return m;
}

const PILLAR_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vC;
void main() {
  vUv = uv;
  vC = instanceColor;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, position.y, 0.0, 1.0);
  // Facing the camera about the vertical: a soft column from any side.
  mv.x += position.x * length(instanceMatrix[0].xyz);
  gl_Position = projectionMatrix * mv;
}`;
const PILLAR_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vC;
void main() {
  float side = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float k = pow(side, 2.2) * pow(1.0 - vUv.y, 1.4) * (0.35 + 0.65 * smoothstep(0.0, 0.08, vUv.y));
  gl_FragColor = vec4(vC * k, 1.0);
}`;

/** Camera-facing soft sprites (flashes and puffs): colour and fade in the instance colour. */
const SPRITE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vC;
void main() {
  vUv = uv;
  vC = instanceColor;
  vec4 mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  float s = length(instanceMatrix[0].xyz);
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
}`;
const FLASH_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vC;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float star = pow(max(0.0, cos(a * 3.0)), 6.0) * (1.0 - r) * 1.4;
  float k = max(0.0, 1.0 - r * 1.6) + star;
  gl_FragColor = vec4(vC * k, 1.0);
}`;
const PUFF_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vC;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float k = smoothstep(1.0, 0.2, r);
  gl_FragColor = vec4(vC * k, 1.0);
}`;
/** A streak: bright core along x, fading at its tail (x = 0) and across. */
const TRACER_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vC;
void main() {
  vUv = uv;
  vC = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const TRACER_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vC;
void main() {
  float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float k = pow(across, 3.0) * vUv.x;
  gl_FragColor = vec4(vC * k, 1.0);
}`;

function additive(vert: string, frag: string): ShaderMaterial {
  return new ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: AdditiveBlending });
}

interface Tracer {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  t: number;
  len: number;
  mine: boolean;
}
interface Spark {
  x: number; y: number; z: number;
  t: number;
  life: number;
  size: number;
  grow: number;
  r: number; g: number; b: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _c = new Color();
const _up = new Vector3(0, 1, 0);
const ZERO = new Matrix4().makeScale(0, 0, 0);

export interface GunsViewOpts {
  crowd: Crowd;
  sound: Sound;
  tier: Tier;
  me: number;
  blood: boolean;
}

export class GunsView {
  readonly group = new Group();
  private readonly guns: InstancedMesh[];
  private readonly ammo: InstancedMesh;
  private readonly plates: InstancedMesh;
  private readonly crates: InstancedMesh;
  private readonly drums: InstancedMesh;
  private readonly pillars: InstancedMesh;
  private readonly tracers: InstancedMesh;
  private readonly flashes: InstancedMesh;
  private readonly puffs: InstancedMesh;
  private readonly light: PointLight | null;
  private lightT = 0;
  private readonly holds: (Hold | null)[] = [];
  private readonly tr: Tracer[] = [];
  private readonly fl: Spark[] = [];
  private readonly pf: Spark[] = [];
  private time = 0;
  /** Where your muzzle was last frame (your own streaks start there). */
  private readonly myMuzzle = new Vector3();
  private myMuzzleOk = false;
  /** Your aim's pitch and whether you're aiming (the session's camera). */
  myPitch = 0;
  myAiming = false;

  constructor(private readonly o: GunsViewOpts) {
    const mat = gunMaterial(o.tier);
    this.guns = GUN_KINDS.map((k) => this.inst(gunGeometry(k), mat, 40, true));
    const lit = o.tier === 0 ? new MeshLambertMaterial({ vertexColors: true }) : new MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.8 });
    this.ammo = this.inst(ammoGeometry(), lit, 48);
    // Its own material: the guns' carries instance colours, and one material on both kinds of mesh makes three.js re-pick its program every draw.
    this.plates = this.inst(plateGeometry(), gunMaterial(o.tier), 48);
    this.crates = this.inst(crateGeometry(), lit, 80);
    this.drums = this.inst(drumGeometry(), o.tier === 0 ? lit : new MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.45 }), 40);
    const pillar = new PlaneGeometry(0.7, 2.6);
    pillar.translate(0, 1.3, 0);
    this.pillars = this.inst(pillar, additive(PILLAR_VERT, PILLAR_FRAG), 96, true);
    const strip = new PlaneGeometry(1, 1);
    strip.translate(0.5, 0, 0);
    this.tracers = this.inst(strip, additive(TRACER_VERT, TRACER_FRAG), MAX_TRACERS, true);
    this.flashes = this.inst(new PlaneGeometry(1, 1), additive(SPRITE_VERT, FLASH_FRAG), MAX_FLASH, true);
    this.puffs = this.inst(new PlaneGeometry(1, 1), additive(SPRITE_VERT, PUFF_FRAG), MAX_PUFFS, true);
    for (const m of [this.pillars, this.tracers, this.flashes, this.puffs]) {
      m.renderOrder = 5;
      m.frustumCulled = false;
    }
    // With an asset CDN (v4 Phase 7): the scanned crate and drum take over from the low-poly ones.
    if (cdnOn() && o.tier >= 1) {
      for (const [use, mesh, fit] of [["crate", this.crates, GUNS.crate.half * 2], ["drum", this.drums, GUNS.drum.tall]] as const) {
        void modelFor(use, 1, o.tier).then((m) => {
          if (!m) return;
          m.geometry.computeBoundingBox();
          const bb = m.geometry.boundingBox!;
          const k = fit / Math.max(0.01, bb.max.y - bb.min.y);
          m.geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
          m.geometry.scale(k, k, k);
          mesh.geometry = m.geometry;
          mesh.material = m.material;
        });
      }
    }
    // One muzzle light, always there (switching lights on and off rebuilds every shader).
    this.light = o.tier >= 1 ? new PointLight(0xffc477, 0, 9, 2) : null;
    if (this.light) this.group.add(this.light);
  }

  private inst(g: BufferGeometry, mat: Material, n: number, colour = false): InstancedMesh {
    const m = new InstancedMesh(g, mat, n);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.visible = false;
    if (colour) {
      m.setColorAt(0, _c.set(1, 1, 1));
      m.instanceColor!.setUsage(DynamicDrawUsage);
    }
    this.group.add(m);
    return m;
  }

  // ── Events ──

  events(list: readonly MatchEvent[], m: Match, cam: Vector3): void {
    const g = m.module<GunsModule>("guns");
    if (!g) return;
    for (const e of list) {
      if (e.type === "fire") {
        const c = m.get(e.id);
        if (!c) continue;
        const kind = GUN_KINDS[e.g] ?? "pistol";
        const mine = c.index === this.o.me;
        // The streak from the muzzle (yours: where your gun is now; theirs: their gun, or about their chest).
        const from = this.muzzleOf(c.index, kind, _a) ?? _a.set(c.x, c.h + c.y + 1.4, c.z);
        const d = from.distanceTo(_b.set(e.x, e.y, e.z));
        const near = Math.max(0, 1 - from.distanceTo(cam) / 140);
        this.o.sound.gunshot(kind, mine ? 1 : near, mine);
        this.flash(from.x, from.y, from.z, kind === "shotgun" ? 0.55 : 0.38);
        const pellets = GUNS.kinds[kind].pellets;
        for (let p = 0; p < Math.min(pellets, 3); p++) {
          const jit = p === 0 ? 0 : 0.6;
          this.tracer(from, _v.set(e.x + (Math.random() - 0.5) * jit, e.y + (Math.random() - 0.5) * jit, e.z + (Math.random() - 0.5) * jit), mine);
        }
        const hit = HIT_KINDS[e.hit] ?? "none";
        if (hit !== "none") {
          const pv = Math.max(0, 1 - _b.distanceTo(cam) / 40);
          if (hit === "body" || hit === "head") {
            if (this.o.blood) this.puff(e.x, e.y, e.z, 0.35, 0.5, 0.55, 0.05, 0.04);
            else this.puff(e.x, e.y, e.z, 0.3, 0.45, 0.45, 0.42, 0.36);
          } else if (hit === "car" || hit === "drum") {
            this.puff(e.x, e.y, e.z, 0.18, 0.18, 1.6, 1.1, 0.4);
            this.o.sound.impact(pv, true);
          } else {
            this.puff(e.x, e.y, e.z, 0.32, 0.6, 0.5, 0.45, 0.38);
            this.o.sound.impact(pv, false);
          }
        }
        void d;
      } else if (e.type === "brk") {
        const b = g.breakables[e.b];
        if (!b) continue;
        const near = Math.max(0, 1 - Math.hypot(b.x - cam.x, b.z - cam.z) / 120);
        if (b.kind === "drum") {
          this.flash(b.x, b.h + 0.8, b.z, 4.5);
          for (let k = 0; k < 10; k++) this.puff(b.x + (Math.random() - 0.5) * 2, b.h + 0.4 + Math.random() * 2, b.z + (Math.random() - 0.5) * 2, 1 + Math.random(), 1.6, 1.4, 0.5 + Math.random() * 0.3, 0.12);
          this.o.sound.explosion(near);
          this.lightT = 0.25;
          if (this.light) this.light.position.set(b.x, b.h + 1.5, b.z);
        } else {
          for (let k = 0; k < 5; k++) this.puff(b.x + (Math.random() - 0.5), b.h + 0.4 + Math.random() * 0.6, b.z + (Math.random() - 0.5), 0.5, 0.9, 0.5, 0.4, 0.28);
          this.o.sound.crash(near * 0.7);
        }
      } else if (e.type === "wreck" && e.state === 4) {
        // A car's blast: the vehicles view has its own fire; the flash is ours.
        const car = m.module<VehiclesModule>("vehicles")?.cars[e.car];
        if (car) this.flash(car.x, car.h + 1.2, car.z, 6);
      }
    }
  }

  private flash(x: number, y: number, z: number, size: number): void {
    if (this.fl.length >= MAX_FLASH) this.fl.shift();
    this.fl.push({ x, y, z, t: 0, life: size > 2 ? 0.22 : 0.05, size, grow: size > 2 ? 1.6 : 0, r: 1.6, g: 1.15, b: 0.55 });
    if (this.light && size < 2) {
      this.light.position.set(x, y, z);
      this.lightT = Math.max(this.lightT, 0.05);
    }
  }

  private puff(x: number, y: number, z: number, size: number, life: number, r: number, g: number, b: number): void {
    if (this.pf.length >= MAX_PUFFS) this.pf.shift();
    this.pf.push({ x, y, z, t: 0, life, size, grow: size * 1.6, r, g, b });
  }

  private tracer(a: Vector3, b: Vector3, mine: boolean): void {
    if (this.tr.length >= MAX_TRACERS) this.tr.shift();
    this.tr.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, t: 0, len: a.distanceTo(b), mine });
  }

  /** Where a body's muzzle is now (null: its gun isn't drawn). */
  private muzzleOf(i: number, kind: GunKind, out: Vector3): Vector3 | null {
    const hold = this.holds[i];
    const h = this.o.crowd.human(i);
    if (i === this.o.me && this.myMuzzleOk) return out.copy(this.myMuzzle);
    if (!hold?.ready || !h || h.hold !== hold) return null;
    const mz = MUZZLE[kind];
    _m.multiplyMatrices(h.mesh.matrixWorld, hold.local);
    return out.set(mz[0], mz[1], mz[2]).applyMatrix4(_m);
  }

  // ── Frame ──

  update(dt: number, m: Match, camera: Camera): void {
    this.time += dt;
    const g = m.module<GunsModule>("guns");
    if (!g) return;
    const cam = camera.position;
    const tier = this.o.tier;
    const crowd = this.o.crowd;
    const counts = [0, 0, 0, 0];
    let pillars = 0;
    const tintOf = (r: number) => _c.setRGB(...TINT[Math.max(0, Math.min(5, r))]);

    // The guns in everyone's hands.
    this.myMuzzleOk = false;
    for (const c of m.contestants) {
      const i = c.index;
      const h = crowd.human(i);
      if (!h) continue;
      const slot = g.slot[i] ?? 0;
      const gi = g.gun[i]?.[slot] ?? -1;
      const near = Math.hypot(c.x - cam.x, c.z - cam.z) < HELD_VIEW[tier];
      const show = gi >= 0 && c.status === "alive" && !m.seated(c) && near && c.act <= 0 && c.stun <= 0.2;
      if (!show) {
        if (h.hold) h.hold = null;
        continue;
      }
      const kind = GUN_KINDS[gi];
      let hold = this.holds[i];
      if (!hold || hold.kind !== kind) {
        hold = newHold(kind);
        this.holds[i] = hold;
      }
      const mine = i === this.o.me;
      const aiming = mine ? this.myAiming || m.elapsed - g.aimedAt[i] < 1.2 : m.elapsed - g.aimedAt[i] < 1.2;
      hold.mode = aiming ? 1 : c.sprinting ? 2 : 0;
      hold.pitch = mine ? this.myPitch : 0;
      // A changed hold is posed by the next animation step (the crowd's), never twice.
      h.hold = hold;
      if (!hold.ready) continue;
      const mesh = this.guns[gi];
      const n = counts[gi]++;
      if (n >= mesh.instanceMatrix.count) continue;
      _m.multiplyMatrices(h.mesh.matrixWorld, hold.local);
      mesh.setMatrixAt(n, _m);
      mesh.setColorAt(n, tintOf(g.rarity[i][slot]));
      if (mine) {
        const mz = MUZZLE[kind];
        this.myMuzzle.set(mz[0], mz[1], mz[2]).applyMatrix4(_m);
        this.myMuzzleOk = true;
      }
    }

    // Loot on the ground: guns turning over their pillar; ammo and plates.
    const view = VIEW[tier];
    let ammo = 0;
    let plates = 0;
    const spin = this.time * 0.9;
    for (const p of g.pickups) {
      if (p.taken) continue;
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (d > view) continue;
      if (p.kind === "gun") {
        const mesh = this.guns[p.gun];
        const n = counts[p.gun]++;
        if (n >= mesh.instanceMatrix.count) continue;
        const bob = 0.45 + Math.sin(this.time * 2 + p.index) * 0.05;
        _q.setFromAxisAngle(_up, spin + p.index);
        _p.set(p.x, p.h + bob, p.z);
        // Centred on its middle as it turns.
        _v.set(0, 0, -0.4).applyQuaternion(_q);
        _p.add(_v);
        _m.compose(_p, _q, _s.set(1.15, 1.15, 1.15));
        mesh.setMatrixAt(n, _m);
        mesh.setColorAt(n, tintOf(p.rarity));
        if (pillars < this.pillars.instanceMatrix.count) {
          _m.compose(_p.set(p.x, p.h, p.z), _q.identity(), _s.set(1, 1, 1));
          this.pillars.setMatrixAt(pillars, _m);
          this.pillars.setColorAt(pillars++, _c.set(RARITY_HEX[p.rarity]).multiplyScalar(0.45 + p.rarity * 0.08));
        }
      } else {
        const mesh = p.kind === "ammo" ? this.ammo : this.plates;
        const n = p.kind === "ammo" ? ammo++ : plates++;
        if (n >= mesh.instanceMatrix.count) continue;
        _q.setFromAxisAngle(_up, p.index * 1.7 + (p.kind === "plate" ? spin * 0.5 : 0));
        _m.compose(_p.set(p.x, p.h, p.z), _q, _s.set(1, 1, 1));
        mesh.setMatrixAt(n, _m);
        if (pillars < this.pillars.instanceMatrix.count) {
          _m.compose(_p, _q.identity(), _s.set(0.55, 0.45, 1));
          this.pillars.setMatrixAt(pillars, _m);
          this.pillars.setColorAt(pillars++, p.kind === "ammo" ? _c.setRGB(0.4, 0.36, 0.18) : _c.setRGB(0.18, 0.32, 0.5));
        }
      }
    }
    this.finish(this.ammo, ammo);
    this.finish(this.plates, plates);

    // Crates and drums.
    let crates = 0;
    let drums = 0;
    for (const b of g.breakables) {
      if (b.broken) continue;
      if (Math.hypot(b.x - cam.x, b.z - cam.z) > view + 15) continue;
      const mesh = b.kind === "crate" ? this.crates : this.drums;
      const n = b.kind === "crate" ? crates++ : drums++;
      if (n >= mesh.instanceMatrix.count) continue;
      // A hit crate leans a little (it's taking damage).
      const hurt = 1 - b.hp / (b.kind === "crate" ? GUNS.crate.hp : GUNS.drum.hp);
      _q.setFromAxisAngle(_up, b.index * 2.3 + hurt * 0.2);
      _m.compose(_p.set(b.x, b.h, b.z), _q, _s.set(1, 1 - hurt * 0.06, 1));
      mesh.setMatrixAt(n, _m);
    }
    this.finish(this.crates, crates);
    this.finish(this.drums, drums);
    for (let k = 0; k < this.guns.length; k++) this.finish(this.guns[k], counts[k], true);
    this.finish(this.pillars, pillars, true);

    // The shots.
    let n = 0;
    for (let k = this.tr.length - 1; k >= 0; k--) {
      const t = this.tr[k];
      t.t += dt;
      const dur = Math.max(0.035, t.len / 420);
      const u = t.t / dur;
      if (u > 1.15) {
        this.tr.splice(k, 1);
        continue;
      }
      const head = Math.min(1, u) * t.len;
      const tail = Math.max(0, head - Math.min(7, t.len * 0.6));
      _a.set(t.ax, t.ay, t.az);
      _z.set(t.bx - t.ax, t.by - t.ay, t.bz - t.az).normalize();
      const from = _b.copy(_a).addScaledVector(_z, tail);
      const len = Math.max(0.01, head - tail);
      // Width across the streak, facing the camera.
      _y.subVectors(cam, from).cross(_z).normalize().multiplyScalar(t.mine ? 0.022 : 0.03);
      _x.copy(_z).multiplyScalar(len);
      _v.crossVectors(_x, _y).normalize();
      _m.makeBasis(_x, _y, _v).setPosition(from);
      this.tracers.setMatrixAt(n, _m);
      const fade = u > 1 ? 1 - (u - 1) / 0.15 : 1;
      this.tracers.setColorAt(n++, _c.setRGB(1.6 * fade, 1.2 * fade, 0.6 * fade));
    }
    this.finish(this.tracers, n, true);
    n = 0;
    for (let k = this.fl.length - 1; k >= 0; k--) {
      const f = this.fl[k];
      f.t += dt;
      if (f.t > f.life) {
        this.fl.splice(k, 1);
        continue;
      }
      const u = f.t / f.life;
      const s = f.size * (1 + f.grow * u) * (0.85 + Math.random() * 0.3);
      _m.makeScale(s, s, s).setPosition(f.x, f.y, f.z);
      this.flashes.setMatrixAt(n, _m);
      const k2 = 1 - u;
      this.flashes.setColorAt(n++, _c.setRGB(f.r * k2, f.g * k2, f.b * k2));
    }
    this.finish(this.flashes, n, true);
    n = 0;
    for (let k = this.pf.length - 1; k >= 0; k--) {
      const f = this.pf[k];
      f.t += dt;
      if (f.t > f.life) {
        this.pf.splice(k, 1);
        continue;
      }
      const u = f.t / f.life;
      const s = f.size + f.grow * u;
      f.y += dt * 0.4;
      _m.makeScale(s, s, s).setPosition(f.x, f.y, f.z);
      this.puffs.setMatrixAt(n, _m);
      const k2 = (1 - u) * (1 - u) * 0.6;
      this.puffs.setColorAt(n++, _c.setRGB(f.r * k2, f.g * k2, f.b * k2));
    }
    this.finish(this.puffs, n, true);
    if (this.light) {
      this.lightT -= dt;
      this.light.intensity = this.lightT > 0 ? (this.lightT > 0.1 ? 60 : 14) : 0;
    }
  }

  private finish(mesh: InstancedMesh, n: number, colour = false): void {
    for (let k = n; k < mesh.count; k++) mesh.setMatrixAt(k, ZERO);
    mesh.count = n;
    mesh.visible = n > 0;
    if (n > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      if (colour && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    // The crowd outlives the match: nobody keeps holding a gun in the lobby.
    for (let i = 0; i < 128; i++) {
      const h = this.o.crowd.human(i);
      if (h) h.hold = null;
    }
    this.group.traverse((o) => {
      const mm = o as InstancedMesh;
      if (mm.isInstancedMesh) {
        mm.geometry.dispose();
        (mm.material as Material).dispose();
        mm.dispose();
      }
    });
    this.group.clear();
  }
}
