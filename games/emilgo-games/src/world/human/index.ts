// A person in the world: one skinned mesh, its bones, its animation state.
//
// Geometry is cached by SHAPE (body, hair, skirt, shoes…) and detail level, and
// textures by PAINT (skin, outfit, colours…), so twenty players in one uniform
// cost a handful of bodies, not twenty. The local player gets the tier's full
// texture size; everyone else one step down.
//
// Feet on the ground (SPEC-V2 §5.1): after every pose, the ground solver finds
// the lowest point of the body — from a few dozen hull points fixed to the
// bones — and moves the root so that point sits exactly on the ground. Walking,
// running, crouching, lying down, falling: nothing floats, nothing sinks. Only
// a real jump (the referee's height) or the cheer's hop leaves the ground.

import {
  Bone,
  type BufferGeometry,
  Matrix4,
  CanvasTexture,
  Color,
  DetachedBindMode,
  Euler,
  LinearMipmapLinearFilter,
  type Material,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Skeleton,
  SkinnedMesh,
  Sphere,
  Vector3,
} from "three";

import { computePose, newAnimState, Pose, stepGait, type ActionId, type AnimState, type EmoteId, type PoseId } from "./animator";
import { shadowOnly } from "../../graphics/shadowOnly";
import { buildBody, nearDetail, type BuiltBody, type Detail, type Tier } from "./mesh";
import { paintLook, TEX_SIZE } from "./paint";
import { FALL_TIME, type FallKind } from "./ragdoll";
import { packMesh } from "./pack";
import { armbandMesh } from "./armband";
import { BONES, PARENT, type BoneName } from "./skeleton";
import { applyHold, type Hold } from "./hold";
import { dressedGeometry, growthGeometry, zombieGeometry, type Kit } from "./gear";
import { dress } from "./dress";
import { rot } from "./rot";
import { normalMapFor } from "./normals";
import { loadScanLevel, onScanLevel, scanReady, scanStamp } from "./scanbody";
import { OUTFIT_BY_ID, paintKey, scanPaintKey, shapeKey, type Look } from "./wardrobe";
import { onOperatorsReady, operatorBody, operatorsReady } from "./op";
import { suitMaterial } from "./suit";
import type { FigurineDef } from "../../shop/figurines";

export type { Look } from "./wardrobe";
export type { ActionId, EmoteId, PoseId } from "./animator";
export type { Detail, Tier } from "./mesh";
export { nearDetail } from "./mesh";
export { loadScans } from "./scanbody";
export { loadOperators, operatorsReady } from "./op";

// ── Caches ────────────────────────────────────────────────────────────────────

interface Body extends BuiltBody {
  /** Ground-solver hull: [bone, x, y, z] per point, bone-local (rest pose has no rotation). */
  contacts: Float32Array;
  /**
   * Lying down, with the fingers (the hands can be flat under it): four
   * [bone, weight, x, y, z] per point, skinned as the GPU does — rigid points
   * left a body on its back a centimetre off the ground.
   */
  contactsAll: Float32Array;
}

const bodies = new Map<string, Body>();
const textures = new Map<string, { tex: CanvasTexture; users: number; last: number }>();
let maxAniso = 4;

export function setMaxAnisotropy(n: number): void {
  maxAniso = Math.max(1, Math.min(8, n));
}


function bodyFor(look: Look, level: Detail): Body {
  // Scanned: one shape per body and level, and the levels loaded so far are in the key (one arriving makes new shapes).
  const key = scanReady() ? `${level}|scan|${look.body}|${scanStamp()}` : `${level}|${shapeKey(look)}`;
  let b = bodies.get(key);
  if (!b) {
    const built = buildBody(look, level);
    b = { ...built, contacts: hullOf(built, MAIN_BONES, DIRS), contactsAll: hullOf(built, BONES.length, DIRS_DOWN, true) };
    bodies.set(key, b);
    // Bodies are small (tens of KB): keep up to 128 (shape × detail).
    if (bodies.size > 128) {
      const first = bodies.keys().next().value!;
      bodies.get(first)!.geometry.dispose();
      bodies.delete(first);
    }
  }
  return b;
}

/** The operator's body (op.ts) at a level, with its ground hull: one per body and level. */
function opBodyFor(look: Look, level: Detail): Body {
  const key = `${level}|op|${look.body}`;
  let b = bodies.get(key);
  if (!b) {
    const built = operatorBody(look.body, level);
    b = { ...built, contacts: hullOf(built, MAIN_BONES, DIRS), contactsAll: hullOf(built, BONES.length, DIRS_DOWN, true) };
    bodies.set(key, b);
  }
  return b;
}

function textureFor(look: Look, tier: Tier, size: number): CanvasTexture {
  const key = `${tier}|${size}|${scanReady() ? scanPaintKey(look) : paintKey(look)}`;
  let e = textures.get(key);
  if (!e) {
    const tex = new CanvasTexture(paintLook(look, tier, size));
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.anisotropy = Math.min(4, maxAniso);
    tex.flipY = true;
    e = { tex, users: 0, last: 0 };
    textures.set(key, e);
  }
  e.users++;
  e.last = performance.now();
  return e.tex;
}

function releaseTexture(tex: CanvasTexture): void {
  for (const [k, e] of textures) {
    if (e.tex !== tex) continue;
    e.users--;
    // Keep a few unused ones warm (next round's CPU players often repeat).
    if (e.users <= 0) {
      const idle = [...textures.entries()].filter(([, x]) => x.users <= 0).sort((a, b) => a[1].last - b[1].last);
      while (idle.length > 24) {
        const [ok, oe] = idle.shift()!;
        oe.tex.dispose();
        textures.delete(ok);
      }
    }
    void k;
    return;
  }
}

/** Main bones only: finger points move with the curl, the palm stands in for them. */
const MAIN_BONES = BONES.indexOf("footR") + 1;
/** Seconds after the shot when a fallen body has stopped moving (ragdoll.ts: the fall, then the settle). */
const REST_AT = FALL_TIME + 1.1;
/**
 * Directions (in each bone's rest frame) to take its extreme points along:
 * every face, edge and corner of a cube, so a bone lying at any angle — a body
 * on its back, its side, its face (ragdoll.ts) — has a point near its lowest.
 */
function cubeDirs(steps: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = -steps; i <= steps; i++)
    for (let j = -steps; j <= steps; j++)
      for (let k = -steps; k <= steps; k++) {
        // Only the cube's surface: one coordinate at the edge.
        if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== steps) continue;
        const l = Math.hypot(i, j, k);
        out.push([i / l, j / l, k / l]);
      }
  return out;
}
const DIRS = cubeDirs(1);
/** Lying down every surface faces the ground somewhere: sample it finer (98 directions). */
const DIRS_DOWN = cubeDirs(2);

/**
 * A few extreme points per bone (the first `bones`): whatever can touch the
 * ground first in any pose. `blend`: each point with its four skin weights
 * (Body.contactsAll), else on its dominant bone alone.
 */
function hullOf(b: BuiltBody, bones: number, dirs: readonly [number, number, number][], blend = false): Float32Array {
  const g = b.geometry;
  const pos = g.attributes.position;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const best: { i: number; d: number }[][] = Array.from({ length: bones }, () => dirs.map(() => ({ i: -1, d: -Infinity })));
  for (let i = 0; i < pos.count; i++) {
    // Dominant bone, if it holds most of the vertex.
    let bone = -1;
    let w = 0.5;
    for (let k = 0; k < 4; k++) {
      const wk = sw.getComponent(i, k);
      if (wk >= w) {
        w = wk;
        bone = si.getComponent(i, k);
      }
    }
    if (bone < 0 || bone >= bones) continue;
    const r = b.rest[BONES[bone]];
    const x = pos.getX(i) - r.x;
    const y = pos.getY(i) - r.y;
    const z = pos.getZ(i) - r.z;
    const row = best[bone];
    for (let d = 0; d < dirs.length; d++) {
      const v = x * dirs[d][0] + y * dirs[d][1] + z * dirs[d][2];
      if (v > row[d].d) row[d] = { i, d: v };
    }
  }
  const out: number[] = [];
  for (let bone = 0; bone < bones; bone++) {
    const seen = new Set<number>();
    for (const { i } of best[bone]) {
      if (i < 0 || seen.has(i)) continue;
      seen.add(i);
      if (!blend) {
        const r = b.rest[BONES[bone]];
        out.push(bone, pos.getX(i) - r.x, pos.getY(i) - r.y, pos.getZ(i) - r.z);
        continue;
      }
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += sw.getComponent(i, k);
      for (let k = 0; k < 4; k++) {
        const wk = sw.getComponent(i, k) / (sum || 1);
        const bk = si.getComponent(i, k);
        const r = b.rest[BONES[bk]];
        if (wk <= 0 || !r) out.push(0, 0, 0, 0, 0);
        else out.push(bk, wk, pos.getX(i) - r.x, pos.getY(i) - r.y, pos.getZ(i) - r.z);
      }
    }
  }
  return new Float32Array(out);
}

/** Everyone standing: a detail level arriving (scanbody.ts) switches them up. */
const people = new Set<Human>();
onScanLevel(() => {
  for (const h of people) h.refreshShape();
});
onOperatorsReady(() => {
  for (const h of people) h.upgradeToOp();
});

/** Fetch, in the background, the scanned detail levels this graphics tier draws (Low needs only what boot loaded). */
export function ensureScanLevels(tier: Tier): void {
  if (tier >= 1) loadScanLevel(2).catch(() => {});
  if (tier >= 2) loadScanLevel(3).catch(() => {});
}

/** Build every detail level a crowd member may switch to, ahead of the round. */
export function warmBodies(look: Look, tier: Tier): void {
  for (const l of lodLevels(tier)) bodyFor(look, l);
}

/** The levels distance LOD uses for a tier: near, middle, far. */
export function lodLevels(tier: Tier): [Detail, Detail, Detail] {
  const near = nearDetail(tier);
  return [near, Math.max(1, near - 1) as Detail, 0];
}

/** Paint ahead of time (idle moments), so a round start doesn't stall. */
export function warmLook(look: Look, tier: Tier, featured = false): void {
  bodyFor(look, nearDetail(tier));
  const size = featured ? TEX_SIZE[tier] : TEX_SIZE[Math.max(0, tier - 1)];
  releaseTexture(textureFor(look, tier, size));
}

// ── A person ──────────────────────────────────────────────────────────────────

const _e = new Euler(0, 0, 0, "ZYX");
/** Bodies heavier than this cast their shadow through a stand-in (castShadows). */
const STAND_IN_ABOVE = 8000;

/**
 * v6 max (3.7): growth's armour material, one for every body (per tier): machined gunmetal by vertex colour;
 * colours above 1 are light (the red visor, the reactor, the strips), so it glows without a real light.
 */
const armourMats: Partial<Record<number, Material>> = {};
function armourMaterial(tier: Tier): Material {
  const lit = tier === 0 ? 0 : 1;
  const have = armourMats[lit];
  if (have) return have;
  const mat = lit ? new MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.38 }) : new MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <color_fragment>", "#include <color_fragment>\nvec3 armourGlow = max(vColor.rgb - 1.0, 0.0);\ndiffuseColor.rgb = min(diffuseColor.rgb, vec3(1.0));")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += armourGlow * 0.55;");
  };
  mat.customProgramCacheKey = () => `armour1:${lit}`;
  armourMats[lit] = mat;
  return mat;
}
/**
 * v6 max (3.8): a figurine's armour: the same pieces in its own metal (the plates' greys become shades of it) and
 * its own light in place of growth's red. One material per figurine and tier; one program for all of them.
 */
const figMats = new Map<string, Material>();
function figArmourMaterial(tier: Tier, fig: FigurineDef): Material {
  const lit = tier === 0 ? 0 : 1;
  const key = `${fig.id}:${lit}`;
  const have = figMats.get(key);
  if (have) return have;
  const mat = lit ? new MeshStandardMaterial({ vertexColors: true, metalness: fig.metalness, roughness: 0.42 - fig.metalness * 0.22 }) : new MeshLambertMaterial({ vertexColors: true });
  const tint = new Color(fig.metal);
  const glow = new Color(fig.glow);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.figTint = { value: tint };
    sh.uniforms.figGlow = { value: glow };
    sh.fragmentShader = `uniform vec3 figTint;\nuniform vec3 figGlow;\n${sh.fragmentShader}`
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float figLight = max(max(vColor.r, vColor.g), vColor.b) - 1.0;
        vec3 armourGlow = figLight > 0.0 ? figGlow * (figLight + 0.4) : vec3(0.0);
        // The plates' greys (gunmetal ≈ 0.085 in linear) as shades of the figurine's metal.
        float figL = dot(min(vColor.rgb, vec3(1.0)), vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = figLight > 0.0 ? figGlow * 0.55 : min(figTint * clamp(figL / 0.085, 0.25, 2.2), vec3(1.0));`,
      )
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += armourGlow * 0.6;");
  };
  mat.customProgramCacheKey = () => `armourFig1:${lit}`;
  figMats.set(key, mat);
  return mat;
}
const _c1 = new Vector3();
const _c2 = new Vector3();
const _c3 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _axis = new Vector3();
const _m = new Matrix4();
const Y = new Vector3(0, 1, 0);

const PARENT_INDEX = BONES.map((b) => (PARENT[b] ? BONES.indexOf(PARENT[b]!) : -1));

export class Human {
  readonly mesh: SkinnedMesh;
  readonly bones: Bone[];
  readonly anim: AnimState;
  readonly pose = new Pose();
  readonly look: Look;
  readonly tier: Tier;
  private body: Body;
  private level: Detail;
  /** The detail level this body was last posed at, lying still (−1: not lying still). */
  private restedAt = -1;
  private readonly tex: CanvasTexture;
  private hipsRest: Vector3;
  private rootRest: Vector3;
  /** Wearing the operator's body (the black suit, v4 rework) instead of the scan. */
  private op = false;
  private opMat: Material | null = null;
  private baseMat: Material | null = null;
  /** Bone matrices in the mesh's own space (scratch: the ground solver, the skin). */
  private readonly local: Matrix4[] = Array.from({ length: BONES.length }, () => new Matrix4());
  /** Off the ground on purpose (the referee says it is jumping). */
  private airborne = false;
  /** Casting a real shadow (crowd.ts / the lobby decide who). */
  private shadow = false;
  /** At the High level the shadow comes from a Low stand-in that only the sun's shadow camera sees. */
  private standIn: SkinnedMesh | null = null;
  /** v6 max (3.7): growth's armour (an operator's), on the body's bones; its level. */
  private armour: SkinnedMesh | null = null;
  private armourLv = 0;
  /** Growth's level (0 … 3) as last set, and the figurine worn (3.8): its armour shows at least its own level. */
  private growthLv = 0;
  private fig: FigurineDef | null = null;
  /** The suit's effects as a booster last set them (setFx), and the figurine's own clock for its signature. */
  private readonly fxExt = { camo: 0, kind: 0, r: 0, g: 0, b: 0, a: 0, time: 0 };
  private figTime = 0;
  /** The backpack on the chest bone (open worlds), or null. */
  private pack: import("three").Mesh | null = null;
  /** v6: the captain's armband (the squad leader), and the body it was fitted to. */
  private band: import("three").Mesh | null = null;
  private bandFor: Body | null = null;
  /** Posed since the skin last read the bones. */
  private skinDirty = true;

  constructor(look: Look, tier: Tier, opts: { featured?: boolean; seed?: number; lit?: "standard" | "lambert" } = {}) {
    this.look = look;
    this.tier = tier;
    this.level = nearDetail(tier);
    this.body = bodyFor(look, this.level);
    const size = opts.featured ? TEX_SIZE[tier] : TEX_SIZE[Math.max(0, tier - 1)];
    this.tex = textureFor(look, tier, size);

    const rest = this.body.rest;
    this.bones = BONES.map((name) => {
      const b = new Bone();
      b.name = name;
      return b;
    });
    BONES.forEach((name, i) => {
      const parent = PARENT[name];
      const p = rest[name];
      if (parent) {
        const pp = rest[parent];
        this.bones[i].position.set(p.x - pp.x, p.y - pp.y, p.z - pp.z);
        this.bones[BONES.indexOf(parent)].add(this.bones[i]);
      } else {
        this.bones[i].position.set(p.x, p.y, p.z);
      }
    });
    this.hipsRest = this.bones[BONES.indexOf("hips")].position.clone();
    this.rootRest = this.bones[0].position.clone();
    // Bones' local matrices are rebuilt only when the body is posed (apply), not
    // by the renderer every frame: a body that isn't re-posed this frame (far
    // away, or down and still) costs no matrix work for its 40 bones.
    for (const b of this.bones) {
      b.matrixAutoUpdate = false;
      // Nobody reads a bone's Euler `rotation`: don't keep it in step with every
      // quaternion set (three.js would, at a matrix decomposition per bone per frame).
      b.quaternion._onChange(() => {});
      b.updateMatrix();
    }

    // Medium and High: a generated normal map adds weave, seams, folds and skin
    // detail without triangles (SPEC-V2 §5.2). Low: plain Lambert, cheapest.
    const scanned = !!this.body.geometry.attributes.color;
    const normalMap = tier > 0 && !scanned ? normalMapFor(look, TEX_SIZE[Math.max(0, tier - 1)]) : null;
    const mat: Material =
      (opts.lit ?? (tier === 0 ? "lambert" : "standard")) === "lambert"
        ? new MeshLambertMaterial({ map: this.tex, normalMap })
        : new MeshStandardMaterial({ map: this.tex, normalMap, roughness: 0.78, metalness: 0 });
    if (scanned) {
      // Hands and feet carry their colour per vertex; Low and Medium are faceted on purpose.
      (mat as MeshStandardMaterial).vertexColors = true;
      (mat as MeshStandardMaterial).flatShading = tier < 2;
    }
    const mesh = new SkinnedMesh(this.body.geometry, mat);
    mesh.add(this.bones[0]);
    mesh.bind(new Skeleton(this.bones));
    // The skin reads its bones in the mesh's own space, not the world's, so a
    // body that only moves keeps last frame's bone texture: three.js would
    // redo 40 matrix products and re-upload the texture every frame for every
    // body in view. Rebuilt only after a pose (updateSkin).
    mesh.bindMode = DetachedBindMode;
    mesh.skeleton.update = () => this.updateSkin();
    mesh.scale.setScalar(look.height);
    // Bound the whole reachable pose (arms up, lying down), not just the rest pose.
    mesh.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.6);
    this.mesh = mesh;
    this.anim = newAnimState(opts.seed ?? Math.random() * 100);
    people.add(this);
    const o = OUTFIT_BY_ID[look.outfit];
    this.anim.narrow = !scanned && o.bottom.kind === "skirt" && (o.bottom.flare ?? 0) < 0.1;
    if (scanned) this.anim.curlBias = 0.35;
    this.scanned = scanned;
  }
  private scanned = false;

  get triangles(): number {
    return this.trianglesAt(this.level);
  }

  /** The operator's kit and armour tier (v4), or null: as they are. */
  private gear: { kit: Kit; tier: number } | null = null;
  /** A zombie's kind (v4 Phase 5), or null. */
  private zkind: string | null = null;

  /** Rot the body as a zombie of `kind` (its pieces, the shuffle), or null: as they are. */
  setZombie(kind: string | null, blood = false): void {
    if (kind === this.zkind && (kind === null || (this.mesh.material as Material).userData.rotted === `rot:${blood}`)) return;
    this.zkind = kind;
    this.anim.undead = !!kind;
    // The zombies walk on the mocap clips too (the CC0 zombie idle and walk).
    this.anim.mocap = this.op || !!kind;
    rot(this.mesh.material as Material, !!kind, this.body.rest, blood);
    this.showGeometry();
  }

  /** Dress as a tactical operator (kit), with the armour tier's gear; null takes it all off. */
  setGear(kit: Kit | null, tier = 0): void {
    const same = this.gear && kit && this.gear.kit.id === kit.id && this.gear.tier === tier;
    if (same || (!kit && !this.gear)) return;
    this.gear = kit ? { kit, tier } : null;
    // v4 rework: the operator is its own body in a black suit (no armour, no camo);
    // the old dress (the scan re-coloured) only if the operators' files failed.
    this.applyOp(!!kit && operatorsReady());
    if (!this.op) dress(this.mesh.material as Material, kit, this.body.rest);
    this.showGeometry();
  }

  /** The operators' files arrived after this body was dressed: put the operator's body on now. */
  upgradeToOp(): void {
    if (!this.gear || this.op || this.zkind) return;
    dress(this.mesh.material as Material, null, this.body.rest);
    this.applyOp(true);
    this.showGeometry();
  }

  private applyOp(wantOp: boolean): void {
    if (wantOp !== this.op) {
      this.op = wantOp;
      this.body = this.bodyAt(this.level);
      this.rebone();
      if (wantOp) {
        this.baseMat ??= this.mesh.material as Material;
        this.opMat ??= suitMaterial(this.look, this.tier, this.body.rest);
        this.mesh.material = this.opMat;
      } else if (this.baseMat) this.mesh.material = this.baseMat;
      this.anim.mocap = wantOp || !!this.zkind;
      this.anim.curlBias = wantOp ? 0 : this.scanned ? 0.35 : 0;
      if (this.shadow) this.castShadows(true);
      // v6 max (3.8): armour and the suit's effects belong to the operator's body: on (or off) with it.
      this.armourLv = wantOp ? Math.max(this.growthLv, this.fig?.armour ?? 0) : 0;
      this.showArmour();
      this.applyFx();
    }
  }

  /** The body at a level: the operator's while dressed as one, else the look's own. */
  private bodyAt(level: Detail): Body {
    return this.op ? opBodyFor(this.look, level) : bodyFor(this.look, level);
  }

  /** Put the bones where this body's rest joints are (a body swap), and rebind. */
  private rebone(): void {
    const rest = this.body.rest;
    const sk = this.mesh.skeleton;
    BONES.forEach((name, i) => {
      const parent = PARENT[name];
      const p = rest[name];
      const b = this.bones[i];
      if (parent) {
        const pp = rest[parent];
        b.position.set(p.x - pp.x, p.y - pp.y, p.z - pp.z);
      } else b.position.set(p.x, p.y, p.z);
      b.quaternion.identity();
      b.updateMatrix();
      sk.boneInverses[i].makeTranslation(-p.x, -p.y, -p.z);
    });
    this.hipsRest = this.bones[BONES.indexOf("hips")].position.clone();
    this.rootRest = this.bones[0].position.clone();
    this.restedAt = -1;
    this.skinDirty = true;
  }

  get gearTier(): number {
    return this.gear ? this.gear.tier : -1;
  }

  /** The geometry for the body at this level: dressed with the gear, or bare. */
  private geometryFor(b: Body, level: Detail): BufferGeometry {
    if (this.op) return b.geometry;
    if (this.zkind) return zombieGeometry(b.geometry, b.rest, this.zkind, level);
    return this.gear ? dressedGeometry(b.geometry, b.rest, this.gear.tier, level, this.gear.kit) : b.geometry;
  }

  private showGeometry(): void {
    this.mesh.geometry = this.geometryFor(this.body, this.level);
    this.restedAt = -1;
    this.skinDirty = true;
  }

  /** Current geometry detail. */
  get detail(): Detail {
    return this.level;
  }

  /** Triangles this person would cost at a detail level (builds it if needed, cached). */
  trianglesAt(level: Detail): number {
    const b = this.bodyAt(level);
    if (this.op) return b.triangles;
    if (!this.gear && !this.zkind) return b.triangles;
    return (this.geometryFor(b, level).index?.count ?? 0) / 3;
  }

  /** A better scanned level arrived: same bones, finer geometry. */
  refreshShape(): void {
    if (this.op) return;
    const b = bodyFor(this.look, this.level);
    if (b === this.body) return;
    this.body = b;
    this.showGeometry();
    this.castShadows(this.shadow);
  }

  /**
   * Cast a real shadow, or not. A frame's triangles count every pass and the
   * shadow pass draws its casters again (more than once on High), so at the
   * High level (about 20K triangles) the shadow comes from the Low level: a
   * stand-in on the same bones that draws nothing on screen.
   */
  get castsShadow(): boolean {
    return this.shadow;
  }

  castShadows(on: boolean): void {
    this.shadow = on;
    const stand = on && this.body.triangles > STAND_IN_ABOVE;
    this.mesh.castShadow = on && !stand;
    if (!stand) {
      if (this.standIn) this.standIn.visible = false;
      return;
    }
    const low = this.bodyAt(1);
    if (!this.standIn) {
      const s = shadowOnly(new SkinnedMesh(low.geometry));
      s.castShadow = true;
      s.bind(this.mesh.skeleton, new Matrix4());
      s.bindMode = DetachedBindMode;
      s.boundingSphere = this.mesh.boundingSphere?.clone() ?? null;
      this.mesh.add(s);
      this.standIn = s;
    }
    this.standIn.geometry = low.geometry;
    this.standIn.visible = true;
  }

  /** Swap to another detail level (distance LOD); same bones, same paint. */
  setDetail(level: Detail): void {
    if (level === this.level) return;
    this.level = level;
    this.body = this.bodyAt(level);
    this.mesh.geometry = this.geometryFor(this.body, level);
    if (this.shadow) this.castShadows(true);
    if (this.armourLv > 0) this.showArmour();
  }

  /** Bone by name (camera eye, effects). */
  /** The gun held (v4 guns), or null: applied after each pose. */
  hold: Hold | null = null;
  /** A torch in the hand when nothing else is (Dead Streets). */
  torch = false;

  /** A shot just went off from this body's gun (the kick plays). */
  shot(): void {
    this.anim.shotT = 0;
  }

  /** A reload of `seconds` begins (the hands do it). */
  reload(seconds: number): void {
    this.anim.reloadT = 0;
    this.anim.reloadLen = Math.max(0.4, seconds);
  }

  bone(name: BoneName): Bone {
    return this.bones[BONES.indexOf(name)];
  }

  emote(id: EmoteId): void {
    if (this.anim.dead >= 0) return;
    this.anim.emote = id;
    this.anim.emoteT = 0;
  }

  setPose(id: PoseId | null): void {
    this.anim.pose = id;
  }

  /** Fist, slap, push or picking a ball up (plays once). */
  act(id: ActionId): void {
    if (this.anim.dead >= 0) return;
    this.anim.action = id;
    this.anim.actionT = 0;
  }

  /** Hands round a ball, or free. */
  setCarry(on: boolean): void {
    this.anim.carry = on;
  }

  /** Hit or shoved: stagger. `side` −1…1: which way the blow turned them. */
  hit(side: number): void {
    if (this.anim.dead >= 0) return;
    this.anim.hitT = 0.6;
    this.anim.hitSide = Math.max(-1, Math.min(1, side));
  }

  /** Down: a fall `fallDir` from the heading; `as` picks the fall (else the seed does). */
  kill(fallDir: number, as: FallKind | null = null): void {
    if (this.anim.dead >= 0) return;
    this.anim.dead = 0;
    this.anim.fall = 0;
    this.anim.fallDir = fallDir;
    this.anim.fallAs = as;
  }

  /** Up again (an open-world respawn): standing, no fall, nothing in hand. */
  revive(): void {
    const a = this.anim;
    a.dead = -1;
    a.fall = 0;
    a.fallAs = null;
    a.action = null;
    a.emote = null;
    a.hitT = 0;
    a.done = -1;
  }

  /**
   * Where a carried ball sits, in world space: between the palms when held
   * in both hands; tucked under the right arm (in the crook of the forearm,
   * against the ribs) on the move; part way between as it changes.
   */
  carryPoint(out: Vector3): Vector3 {
    this.mesh.updateWorldMatrix(true, true);
    const at = (b: BoneName, v: Vector3) => this.bone(b).getWorldPosition(v);
    // Palms: a little past the wrists, towards the knuckles.
    at("handL", _c1).lerp(at("middle1L", _c2), 0.6);
    at("handR", _c3).lerp(at("middle1R", _c2), 0.6);
    out.copy(_c1).add(_c3).multiplyScalar(0.5);
    const tuck = this.anim.carryTuck;
    if (tuck < 0.001) return out;
    // In the crook of the right arm, nudged in against the body.
    at("foreArmR", _c1).lerp(at("middle1R", _c2), 0.5);
    at("chest", _c2);
    _c1.x += (_c2.x - _c1.x) * 0.3;
    _c1.z += (_c2.z - _c1.z) * 0.3;
    _c1.y += 0.03 * this.look.height;
    return out.lerp(_c1, tuck);
  }

  /** Talk for a while (quick chat): the mouth moves. */
  talk(seconds: number): void {
    if (this.anim.dead >= 0) return;
    this.anim.talk = Math.max(this.anim.talk, seconds);
  }

  finish(): void {
    if (this.anim.done < 0) this.anim.done = 0;
  }

  /** Advance and pose. `speed` m/s on the ground; `stance` 0..2; `air` 0..1 (1: jumping); `slide` 0/1. */
  update(dt: number, speed: number, stance = 0, air = 0, slide = 0, moveYaw = 0): void {
    const a = this.anim;
    // v6 max (3.8): a figurine's signature runs on its own clock (a booster's, while one lasts, on the booster's).
    if (this.fig?.fx.kind) {
      this.figTime += dt;
      if (this.fxExt.a <= 0.001) this.applyFx();
    }
    a.moveYaw = moveYaw;
    // What the hands hold (v4 rework): the mocap's upper body follows it.
    const hd = this.hold;
    if (hd) {
      a.weapon = hd.kind === "pistol" ? 1 : 2;
      a.aimWant = hd.mode === 1 ? 1 : 0;
      a.aimPitch = hd.pitch;
    } else {
      a.weapon = this.torch ? 3 : 0;
      a.aimWant = 0;
    }
    // Down and still: the pose can't change any more, so it isn't worked out again
    // (twenty bodies on the field cost nothing). A new detail level re-poses once.
    if (a.dead > REST_AT && this.restedAt === this.level) {
      a.dead += dt;
      a.time += dt;
      return;
    }
    this.airborne = air > 0.5;
    a.slide += (slide - a.slide) * (1 - Math.exp(-dt * (slide > a.slide ? 18 : 8)));
    a.stance += (stance - a.stance) * (1 - Math.exp(-dt * 10));
    a.air += (air - a.air) * (1 - Math.exp(-dt * 14));
    a.sit += (a.sitWant - a.sit) * (1 - Math.exp(-dt * 12));
    // Seated, the legs don't walk however fast the car goes.
    stepGait(a, a.sitWant > 0 ? 0 : speed, dt);
    computePose(a, this.pose);
    this.apply();
    // A gun in the hands (v4): the arms round it, after the pose (never while down or falling).
    if (this.hold && a.dead < 0) applyHold(this, this.hold);
    this.restedAt = a.dead > REST_AT ? this.level : -1;
  }

  private apply(): void {
    const P = this.pose;
    const r = P.rot;
    for (let i = 1; i < this.bones.length; i++) {
      _e.set(r[i * 3], r[i * 3 + 1], r[i * 3 + 2], "ZYX");
      this.bones[i].quaternion.setFromEuler(_e);
    }
    const hips = this.bones[1];
    hips.position.set(this.hipsRest.x + P.hipsX, this.hipsRest.y + P.hipsY, this.hipsRest.z + P.hipsZ);
    // Root: lift, then tip over about a horizontal axis at tiltYaw (falls, prone).
    const root = this.bones[0];
    root.position.set(this.rootRest.x, this.rootRest.y + P.rootY, this.rootRest.z);
    if (P.tilt !== 0) {
      _axis.set(Math.cos(P.tiltYaw), 0, -Math.sin(P.tiltYaw));
      _q.setFromAxisAngle(_axis, P.tilt);
      root.quaternion.copy(_q);
    } else {
      root.quaternion.identity();
    }
    const done = this.ground(P.lift / this.look.height);
    // The ground solver built the main bones' matrices; the root moved after, and the rest are left.
    const B = this.bones;
    B[0].updateMatrix();
    for (let i = done; i < B.length; i++) B[i].updateMatrix();
    this.skinDirty = true;
    void _q2;
    void Y;
  }

  /** First person: no head in front of the lens. */
  /**
   * A colour over the whole body (multiplied) and a glow from it: an Ojuju's
   * ashen skin (Phase 6), a winning streak's glow. null: as they are.
   */
  tint(color: number | null, glow = 0x000000): void {
    const mat = this.mesh.material as MeshLambertMaterial;
    mat.color.setHex(color ?? 0xffffff);
    mat.emissive.setHex(glow);
  }

  /** v5 growth (0 … 3): the operator's suit shows it (burning eyes, red veins); the old dress, a red heat. */
  setFierce(level: number): void {
    const u = (this.opMat?.userData as { fierce?: { value: number } } | undefined)?.fierce;
    if (u) u.value = level;
    if (!this.op) this.tint(level > 0 ? 0xb8a8a8 : null, level > 0 ? 0x1a0402 * level : 0);
    // v6 max (3.7): and the robotic armour, more of it each level (a figurine's own, at least).
    this.growthLv = level;
    this.armourLv = this.op ? Math.max(level, this.fig?.armour ?? 0) : 0;
    this.showArmour();
  }

  /**
   * v6 max (3.8): wear a figurine (or none): its armour always on in its own metal and light, its signature on
   * the suit (lines, eyes, shimmer). Its suit colours and height come with the look (shop/figurines figurineLook).
   */
  setFigurine(fig: FigurineDef | null): void {
    if (this.fig === fig) return;
    this.fig = fig;
    this.armourLv = this.op ? Math.max(this.growthLv, fig?.armour ?? 0) : 0;
    if (this.armour) this.armour.material = fig ? figArmourMaterial(this.tier, fig) : armourMaterial(this.tier);
    this.showArmour();
    this.applyFx();
  }

  get figurine(): FigurineDef | null {
    return this.fig;
  }

  /** v6 max (3.7): growth's armour for the body's level now (or none). */
  private showArmour(): void {
    const lv = this.armourLv;
    if (lv <= 0 || !this.op) {
      if (this.armour) this.armour.visible = false;
      return;
    }
    const geo = growthGeometry(this.body.geometry, this.body.rest, lv, this.level);
    if (!this.armour) {
      const s = new SkinnedMesh(geo, this.fig ? figArmourMaterial(this.tier, this.fig) : armourMaterial(this.tier));
      s.bind(this.mesh.skeleton, new Matrix4());
      s.bindMode = DetachedBindMode;
      s.frustumCulled = false;
      s.castShadow = false;
      this.mesh.add(s);
      this.armour = s;
    }
    this.armour.geometry = geo;
    this.armour.visible = true;
  }

  /**
   * v6 max: the suit's effects (suit.ts): camouflage 0 … 1; a booster's power (kind 1 strength, 2 speed; its
   * glow colour; strength 0 … 1); the clock their animation runs on. Operators only (the old dress ignores them).
   */
  setFx(camo: number, kind: number, r: number, g: number, b: number, a: number, time: number): void {
    Object.assign(this.fxExt, { camo, kind, r, g, b, a, time });
    this.applyFx();
  }

  /** What the suit shows: a booster's power while it lasts, else the figurine's signature; the stronger shimmer. */
  private applyFx(): void {
    const u = this.opMat?.userData as { camo?: { value: number }; fxTime?: { value: number }; power?: { value: { set(x: number, y: number, z: number, w: number): void } }; powerKind?: { value: number } } | undefined;
    if (!u?.camo) return;
    const e = this.fxExt;
    const f = this.fig?.fx;
    u.camo.value = Math.max(e.camo, f?.camo ?? 0);
    if (e.a > 0.001 || !f || !f.kind) {
      u.fxTime!.value = e.time;
      u.power!.value.set(e.r, e.g, e.b, e.a);
      u.powerKind!.value = e.kind;
    } else {
      const g = this.fig!.glow;
      const n = parseInt(g.slice(1), 16);
      u.fxTime!.value = this.figTime;
      u.power!.value.set((((n >> 16) & 255) / 255) * 1.4, (((n >> 8) & 255) / 255) * 1.4, ((n & 255) / 255) * 1.4, f.a);
      u.powerKind!.value = f.kind;
    }
  }

  hideHead(on: boolean): void {
    const head = this.bone("head");
    const s = on ? 0.001 : 1;
    if (head.scale.x === s) return;
    head.scale.setScalar(s);
    head.updateMatrix();
    this.skinDirty = true;
  }

  /** A bone was turned by hand: the skin follows at the next render. */
  posed(): void {
    this.skinDirty = true;
  }

  /**
   * The skeleton's update, called by the renderer for a body in view. Bone
   * matrices relative to the mesh (the bones hang from it, bound at identity),
   * only when the body was posed since the last time.
   */
  private updateSkin(): void {
    if (!this.skinDirty) return;
    this.skinDirty = false;
    const B = this.bones;
    const L = this.local;
    const sk = this.mesh.skeleton;
    // Read at call time: the renderer swaps in a bigger array when it makes the texture.
    const out = sk.boneMatrices;
    for (let i = 0; i < B.length; i++) {
      const p = PARENT_INDEX[i];
      if (p < 0) L[i].copy(B[i].matrix);
      else L[i].multiplyMatrices(L[p], B[i].matrix);
      _m.multiplyMatrices(L[i], sk.boneInverses[i]).toArray(out, i * 16);
    }
    if (sk.boneTexture) sk.boneTexture.needsUpdate = true;
  }

  /**
   * Put the lowest point of the body on the ground (y = 0 in the mesh's own
   * space: wherever the owner placed the mesh). In the air, only stop the feet
   * going through the floor. `lift` (local units) is a deliberate hop.
   * Returns how many bones (from the first) it rebuilt the local matrix of.
   */
  private ground(lift: number): number {
    const B = this.bones;
    const L = this.local;
    // Lying down, the hands can be under the body: their fingers count too.
    const down = this.anim.dead >= 0;
    const n = down ? B.length : MAIN_BONES;
    for (let i = 0; i < n; i++) {
      B[i].updateMatrix();
      const p = PARENT_INDEX[i];
      if (p < 0) L[i].copy(B[i].matrix);
      else L[i].multiplyMatrices(L[p], B[i].matrix);
    }
    let min = Infinity;
    if (down) {
      const c = this.body.contactsAll;
      for (let k = 0; k < c.length; k += 20) {
        let y = 0;
        for (let j = k; j < k + 20; j += 5) {
          if (c[j + 1] <= 0) continue;
          const e = L[c[j]].elements;
          y += c[j + 1] * (e[1] * c[j + 2] + e[5] * c[j + 3] + e[9] * c[j + 4] + e[13]);
        }
        if (y < min) min = y;
      }
    } else {
      const c = this.body.contacts;
      for (let k = 0; k < c.length; k += 4) {
        const e = L[c[k]].elements;
        const y = e[1] * c[k + 1] + e[5] * c[k + 2] + e[9] * c[k + 3] + e[13];
        if (y < min) min = y;
      }
    }
    if (!Number.isFinite(min)) return n;
    const root = B[0];
    if (this.airborne) {
      if (min < 0) root.position.y -= min;
    } else {
      root.position.y += lift - min;
    }
    return n;
  }

  /** Wear a backpack, or not (SPEC-V3 §3.3: worn, so everyone sees you carry one). */
  wearPack(on: boolean): void {
    if (on && !this.pack) {
      this.pack = packMesh();
      this.bone("chest").add(this.pack);
    }
    if (this.pack) this.pack.visible = on;
  }

  /** Is the backpack drawn (worn, and near enough to matter)? */
  showPack(on: boolean): void {
    if (this.pack) this.pack.visible = on;
  }

  get wearsPack(): boolean {
    return !!this.pack;
  }

  /** v6: the captain's armband on the left upper arm (the squad's leader), or not. */
  setCaptain(on: boolean): void {
    if (on && this.band && this.bandFor !== this.body) {
      // The body changed under it (the operator's body, a new look): fit a new one.
      this.band.removeFromParent();
      this.band.geometry.dispose();
      (this.band.material as Material).dispose();
      this.band = null;
    }
    if (on && !this.band) {
      this.band = armbandMesh(this.body.geometry, this.body.rest, "L");
      this.bandFor = this.body;
      this.bone("upperArmL").add(this.band);
    }
    if (this.band) this.band.visible = on;
  }

  dispose(): void {
    this.pack?.removeFromParent();
    if (this.band) {
      this.band.removeFromParent();
      this.band.geometry.dispose();
      (this.band.material as Material).dispose();
    }
    people.delete(this);
    releaseTexture(this.tex);
    (this.mesh.material as Material).dispose();
    this.opMat?.dispose();
    this.baseMat?.dispose();
    this.mesh.skeleton.dispose();
    this.mesh.removeFromParent();
  }
}
