// Items on the ground, loot bags and Airfall crates, drawn (SPEC-V3 §6.2, §7,
// §10.3). One instanced draw per kind of thing ("one draw per prefab"), only
// for what is near: beyond the tier's item distance nothing is drawn (the
// compass points to the nearest). Each item turns slowly over a short pillar
// of light so it reads from across a street: warm for everyday items, gold for
// Airfall's, green for a loot bag while it glows.
//
// Airfall: a red flare column stands where the crate will land from the moment
// it is announced; the crate drops the last few seconds under an Ankara-cloth
// parachute that settles beside it on landing. The flare burns until it's opened.

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  BoxGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  Vector3,
} from "three";

import { LOOT } from "../config";
import { ITEM_DEFS, type ItemId } from "../content/items";
import type { Tier } from "../graphics/tiers";
import { merge, part } from "./geo";
import { canvasTexture, shaft } from "./tex";
import { heatTexture } from "./zone";

/** What the view reads (the match's items and Airfall modules, or the online mirror). */
export interface ItemsState {
  readonly elapsed: number;
  readonly items: readonly { readonly kind: ItemId; readonly x: number; readonly z: number; readonly h: number; readonly taken: boolean }[];
  readonly bags: readonly { readonly x: number; readonly z: number; readonly h: number; readonly at: number; readonly kinds: readonly ItemId[] }[];
  readonly crates: readonly { readonly x: number; readonly z: number; readonly h: number; readonly land: number; readonly landed: boolean; readonly opened: boolean }[];
}

/** Items are drawn within this distance, by tier (metres). */
const ITEM_VIEW = [40, 55, 70] as const;
/** The crate falls for this long before it lands, from this high. */
const FALL_S = 8;
const FALL_H = 70;

type Look = "kola" | "zobo" | "big-bag" | "zone-shield" | "bundle";
const LOOKS: Look[] = ["kola", "zobo", "big-bag", "zone-shield", "bundle"];
const lookOf = (k: ItemId): Look => (k === "kola" || k === "zobo" || k === "big-bag" || k === "zone-shield" ? k : "bundle");

// ── The things themselves: small, low-poly, coloured per vertex ───────────────

function itemGeometry(l: Look): BufferGeometry {
  switch (l) {
    case "kola": {
      // A calabash bowl of kola nuts.
      const bowl = new SphereGeometry(0.16, 8, 3, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      return merge([
        part(bowl, 0xc98a3c, { p: [0, 0.16, 0] }),
        part(new IcosahedronGeometry(0.06, 0), 0xa53e2a, { p: [-0.05, 0.15, 0.02] }),
        part(new IcosahedronGeometry(0.055, 0), 0xe0bf6a, { p: [0.05, 0.15, -0.02] }),
        part(new IcosahedronGeometry(0.05, 0), 0x8f3322, { p: [0, 0.18, 0.05] }),
      ]);
    }
    case "zobo":
      // A flask of deep red zobo.
      return merge([
        part(new CylinderGeometry(0.065, 0.07, 0.22, 8), 0x5e0c1c, { p: [0, 0.11, 0] }),
        part(new CylinderGeometry(0.028, 0.05, 0.06, 8), 0x5e0c1c, { p: [0, 0.25, 0] }, 1.1),
        part(new CylinderGeometry(0.03, 0.03, 0.03, 8), 0xe8e4dc, { p: [0, 0.295, 0] }),
      ]);
    case "big-bag":
      // A big woven checked bag, zipped, with its two handles.
      return merge([
        part(new BoxGeometry(0.46, 0.26, 0.28), 0xece6da, { p: [0, 0.13, 0] }),
        part(new BoxGeometry(0.47, 0.05, 0.29), 0xb3262a, { p: [0, 0.07, 0] }),
        part(new BoxGeometry(0.47, 0.05, 0.29), 0x2a4f9a, { p: [0, 0.19, 0] }),
        part(new BoxGeometry(0.06, 0.27, 0.29), 0x2a4f9a, { p: [-0.12, 0.13, 0] }),
        part(new BoxGeometry(0.06, 0.27, 0.29), 0xb3262a, { p: [0.12, 0.13, 0] }),
        part(new BoxGeometry(0.2, 0.06, 0.02), 0x3a3530, { p: [0, 0.3, 0.06] }),
        part(new BoxGeometry(0.2, 0.06, 0.02), 0x3a3530, { p: [0, 0.3, -0.06] }),
      ]);
    case "zone-shield":
      // A white umbrella, open, laid on its side: shade from the sky.
      return merge([
        part(new ConeGeometry(0.34, 0.14, 8, 1, true), 0xf4f1ea, { p: [0, 0.3, 0], r: [0.5, 0, 0] }),
        part(new CylinderGeometry(0.012, 0.012, 0.42, 4), 0x2a2622, { p: [0, 0.2, 0.08], r: [0.5, 0, 0] }),
        part(new CylinderGeometry(0.02, 0.02, 0.08, 4), 0x2a2622, { p: [0, 0.03, 0.18], r: [0.5, 0, 0] }),
      ]);
    default:
      // A cloth bundle, tied at the top.
      return merge([
        part(new SphereGeometry(0.16, 6, 4), 0xd9662a, { p: [0, 0.13, 0], s: [1, 0.8, 1] }),
        part(new IcosahedronGeometry(0.05, 0), 0x1e4e9a, { p: [0, 0.26, 0] }),
      ]);
  }
}

function bagGeometry(): BufferGeometry {
  // The dead's loot: a big Ankara bundle with its knot.
  return merge([
    part(new SphereGeometry(0.3, 7, 4), 0x1f6e4a, { p: [0, 0.22, 0], s: [1, 0.75, 1] }),
    part(new SphereGeometry(0.31, 7, 4, 0, Math.PI * 2, 0.9, 0.5), 0xf0b628, { p: [0, 0.22, 0], s: [1, 0.75, 1] }),
    part(new IcosahedronGeometry(0.08, 0), 0xc4361f, { p: [0, 0.45, 0] }),
  ]);
}

function crateGeometry(): BufferGeometry {
  const wood = 0x8a6238;
  const slat = 0x6a4826;
  const parts = [part(new BoxGeometry(0.9, 0.7, 0.9), wood, { p: [0, 0.35, 0] })];
  for (const y of [0.08, 0.62]) {
    parts.push(part(new BoxGeometry(0.94, 0.08, 0.94), slat, { p: [0, y, 0] }));
  }
  parts.push(part(new BoxGeometry(0.94, 0.72, 0.1), slat, { p: [0, 0.35, 0], r: [0, Math.PI / 4, 0] }));
  return merge(parts);
}

/** An Ankara-cloth canopy: bold stripes by segment, open underneath; and its four lines to the crate. */
function chuteGeometry(): BufferGeometry {
  const colours = [0xe0662a, 0x1d4f9a, 0xf2c230, 0x2a8a4a, 0xc4361f, 0x1d4f9a, 0xf2c230, 0x2a8a4a];
  const parts: BufferGeometry[] = [];
  const n = colours.length;
  for (let i = 0; i < n; i++) {
    parts.push(part(new SphereGeometry(2.2, 2, 3, (i / n) * Math.PI * 2, (Math.PI * 2) / n, 0, Math.PI / 2.4), colours[i], { p: [0, 3.6, 0], s: [1, 0.55, 1] }));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const tx = Math.cos(a) * 1.8;
    const tz = Math.sin(a) * 1.8;
    const len = Math.hypot(tx - Math.cos(a) * 0.4, 3.9 - 0.7, tz - Math.sin(a) * 0.4);
    // A thin line from the crate's corner up to the canopy's rim.
    const g = part(new BoxGeometry(0.02, len, 0.02), 0x3a3530, { p: [0, len / 2, 0] });
    const dir = new Vector3(tx - Math.cos(a) * 0.4, 3.2, tz - Math.sin(a) * 0.4).normalize();
    g.applyMatrix4(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir)));
    g.translate(Math.cos(a) * 0.4, 0.7, Math.sin(a) * 0.4);
    parts.push(g);
  }
  return merge(parts);
}

const PILLAR_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vC;
void main() {
  vUv = uv;
  vC = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const PILLAR_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec3 vC;
void main() {
  gl_FragColor = vec4(vC * texture2D(map, vec2(vUv.x, 1.0 - vUv.y)).a, 1.0);
}`;

const FLARE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
/** Red smoke rising: soft at the edges, thinning upwards, a hot base. */
const FLARE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float time;
uniform float strength;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
  float n = texture2D(map, vec2(vUv.x * 2.0, vUv.y * 2.5 - time * 0.35)).r;
  float up = pow(1.0 - vUv.y, 1.3);
  float base = 1.0 + 2.0 * (1.0 - smoothstep(0.0, 0.05, vUv.y));
  float k = strength * edge * (0.45 + 0.9 * n) * up * base;
  gl_FragColor = vec4(vec3(1.0, 0.22, 0.08) * k, 1.0);
}`;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _up = new Vector3(0, 1, 0);
const _tilt = new Vector3(1, 0, 0.4).normalize();


const MAX_ITEMS = 48;
const MAX_BAGS = 16;
const MAX_CRATES = 3;

function instanced(geo: BufferGeometry, mat: Material, n: number, colours = false): InstancedMesh {
  const m = new InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(DynamicDrawUsage);
  m.count = 0;
  m.frustumCulled = false;
  if (colours) {
    for (let i = 0; i < n; i++) m.setColorAt(i, _c.setRGB(0, 0, 0));
    m.instanceColor!.setUsage(DynamicDrawUsage);
  }
  return m;
}

export class ItemsView {
  readonly group = new Group();
  private readonly kinds = new Map<Look, InstancedMesh>();
  private readonly bagMesh: InstancedMesh;
  private readonly crateMesh: InstancedMesh;
  private readonly chuteMesh: InstancedMesh;
  private readonly pillars: InstancedMesh;
  private readonly flares: { mesh: InstancedMesh; mat: ShaderMaterial };
  private readonly flareMat: ShaderMaterial;
  private readonly view: number;
  private time = 0;
  private readonly counts = new Map<Look, number>();

  constructor(tier: Tier) {
    this.view = ITEM_VIEW[tier];
    const solid = new MeshLambertMaterial({ vertexColors: true });
    for (const l of LOOKS) {
      const m = instanced(itemGeometry(l), solid, MAX_ITEMS);
      this.kinds.set(l, m);
      this.group.add(m);
    }
    this.bagMesh = instanced(bagGeometry(), solid, MAX_BAGS);
    this.crateMesh = instanced(crateGeometry(), solid, MAX_CRATES);
    const cloth = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    this.chuteMesh = instanced(chuteGeometry(), cloth, MAX_CRATES);
    // The pillars: two crossed quads, a vertical shaft of light.
    this.pillars = instanced(
      pillarGeometry(),
      new ShaderMaterial({
        uniforms: { map: { value: canvasTexture("shaft", 64, shaft, false) } },
        vertexShader: PILLAR_VERT,
        fragmentShader: PILLAR_FRAG,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
      MAX_ITEMS + MAX_BAGS + MAX_CRATES,
      true,
    );
    // The flare: one open tube per crate.
    this.flareMat = new ShaderMaterial({
      uniforms: { map: { value: heatTexture() }, time: { value: 0 }, strength: { value: 0.9 } },
      vertexShader: FLARE_VERT,
      fragmentShader: FLARE_FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.flares = { mesh: instanced(new CylinderGeometry(0.7, 0.4, 1, 8, 1, true).translate(0, 0.5, 0), this.flareMat, MAX_CRATES), mat: this.flareMat };
    this.group.add(this.bagMesh, this.crateMesh, this.chuteMesh, this.pillars, this.flares.mesh);
  }

  /** Every frame: what's near `cam`, turning and bobbing; crates falling; flares burning. */
  update(dt: number, s: ItemsState, cam: Vector3): void {
    this.time += dt;
    this.flareMat.uniforms.time.value = this.time;
    const v2 = this.view * this.view;
    for (const l of LOOKS) this.counts.set(l, 0);
    let pillars = 0;
    const t = this.time;
    const pillar = (x: number, y: number, z: number, r: number, g: number, b: number, scale = 1) => {
      if (pillars >= this.pillars.instanceMatrix.count) return;
      this.pillars.setMatrixAt(pillars, _m.compose(_p.set(x, y, z), _q.identity(), _s.set(scale, scale, scale)));
      this.pillars.setColorAt(pillars, _c.setRGB(r, g, b));
      pillars++;
    };

    // Items.
    for (let i = 0; i < s.items.length; i++) {
      const it = s.items[i];
      if (it.taken) continue;
      const dx = it.x - cam.x;
      const dz = it.z - cam.z;
      if (dx * dx + dz * dz > v2) continue;
      const l = lookOf(it.kind);
      const n = this.counts.get(l)!;
      if (n >= MAX_ITEMS) continue;
      const mesh = this.kinds.get(l)!;
      _q.setFromAxisAngle(_up, t * 0.8 + i * 1.7);
      mesh.setMatrixAt(n, _m.compose(_p.set(it.x, it.h + 0.12 + Math.sin(t * 2.2 + i) * 0.04, it.z), _q, _s.set(1.3, 1.3, 1.3)));
      this.counts.set(l, n + 1);
      if (ITEM_DEFS[it.kind].rare) pillar(it.x, it.h, it.z, 0.9, 0.62, 0.15);
      else pillar(it.x, it.h, it.z, 0.5, 0.4, 0.26);
    }
    for (const l of LOOKS) {
      const mesh = this.kinds.get(l)!;
      mesh.count = this.counts.get(l)!;
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }

    // Loot bags: green light while they glow.
    let bags = 0;
    for (let i = 0; i < s.bags.length && bags < MAX_BAGS; i++) {
      const b = s.bags[i];
      if (!b.kinds.length) continue;
      const dx = b.x - cam.x;
      const dz = b.z - cam.z;
      if (dx * dx + dz * dz > v2 * 1.5) continue;
      _q.setFromAxisAngle(_up, i * 2.1);
      this.bagMesh.setMatrixAt(bags++, _m.compose(_p.set(b.x, b.h, b.z), _q, _s.set(1, 1, 1)));
      const age = s.elapsed - b.at;
      if (age < LOOT.bagGlow) {
        const k = 0.7 + 0.3 * Math.sin(t * 4 + i);
        pillar(b.x, b.h, b.z, 0.2 * k, 0.9 * k, 0.4 * k, 1.4);
      }
    }
    this.bagMesh.count = bags;
    this.bagMesh.visible = bags > 0;
    this.bagMesh.instanceMatrix.needsUpdate = true;

    // Airfall: the flare from its announcement; the fall under the canopy; the canopy settling.
    let crates = 0;
    let chutes = 0;
    let flares = 0;
    for (let i = 0; i < s.crates.length && crates < MAX_CRATES; i++) {
      const k = s.crates[i];
      const toLand = k.land - s.elapsed;
      // The flare stands planted beside the landing spot until the crate is opened.
      if (!k.opened) this.flares.mesh.setMatrixAt(flares++, _m.compose(_p.set(k.x + 1.6, k.h, k.z + 1.6), _q.identity(), _s.set(1, 46, 1)));
      if (toLand > FALL_S) continue;
      const u = Math.max(0, toLand) / FALL_S;
      // Falling: high and swaying under the canopy, slowing near the ground.
      const y = k.h + FALL_H * u * u;
      const sway = toLand > 0 ? Math.sin(t * 1.3 + i) * 0.12 * u : 0;
      _q.setFromAxisAngle(_tilt, sway);
      this.crateMesh.setMatrixAt(crates++, _m.compose(_p.set(k.x, y, k.z), _q, _s.set(1, 1, 1)));
      const sinceLand = s.elapsed - k.land;
      if (sinceLand < 3) {
        // Landed: the canopy drifts off to one side and sinks, deflating flat on the ground, then it's gone.
        const flat = Math.max(0, Math.min(1, sinceLand / 1.2));
        const gone = Math.max(0, Math.min(1, (sinceLand - 2) / 1));
        _q.setFromAxisAngle(_up, i * 1.9);
        _p.set(k.x + Math.cos(i * 1.9) * 3.4 * flat, y - 3.2 * flat, k.z - Math.sin(i * 1.9) * 3.4 * flat);
        const w = (1 - 0.35 * flat) * (1 - gone);
        this.chuteMesh.setMatrixAt(chutes++, _m.compose(_p, _q, _s.set(w, Math.max(0.02, (1 - 0.95 * flat) * (1 - gone)), w)));
      }
      if (k.landed && !k.opened) pillar(k.x, k.h, k.z, 0.95, 0.6, 0.15, 1.6);
    }
    this.crateMesh.count = crates;
    this.crateMesh.visible = crates > 0;
    this.crateMesh.instanceMatrix.needsUpdate = true;
    this.chuteMesh.count = chutes;
    this.chuteMesh.visible = chutes > 0;
    this.chuteMesh.instanceMatrix.needsUpdate = true;
    this.flares.mesh.count = flares;
    this.flares.mesh.visible = flares > 0;
    this.flares.mesh.instanceMatrix.needsUpdate = true;

    this.pillars.count = pillars;
    this.pillars.visible = pillars > 0;
    this.pillars.instanceMatrix.needsUpdate = true;
    if (this.pillars.instanceColor) this.pillars.instanceColor.needsUpdate = true;
  }

  /** Draws and triangles now (the budget's breakdown). */
  stats(): { calls: number; tris: number } {
    let calls = 0;
    let tris = 0;
    this.group.traverse((o) => {
      const m = o as InstancedMesh;
      if (!m.isInstancedMesh || !m.visible || !m.count) return;
      calls++;
      tris += (m.geometry.attributes.position.count / 3) * m.count;
    });
    return { calls, tris };
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as InstancedMesh;
      if (m.isInstancedMesh) m.geometry.dispose();
    });
    this.flareMat.dispose();
  }
}

/** Two crossed upright quads (a light pillar seen from any side), with UVs. */
function pillarGeometry(): BufferGeometry {
  const a = new PlaneGeometry(0.7, 1.6).translate(0, 0.8, 0).toNonIndexed();
  const b = new PlaneGeometry(0.7, 1.6).translate(0, 0.8, 0).rotateY(Math.PI / 2).toNonIndexed();
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(new Float32Array([...(a.attributes.position.array as Float32Array), ...(b.attributes.position.array as Float32Array)]), 3));
  g.setAttribute("uv", new Float32BufferAttribute(new Float32Array([...(a.attributes.uv.array as Float32Array), ...(b.attributes.uv.array as Float32Array)]), 2));
  g.computeBoundingSphere();
  return g;
}
