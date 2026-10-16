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
  Matrix4,
  CanvasTexture,
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

import { computePose, newAnimState, Pose, stepGait, type AnimState, type EmoteId, type PoseId } from "./animator";
import { buildBody, nearDetail, type BuiltBody, type Detail, type Tier } from "./mesh";
import { paintLook, TEX_SIZE } from "./paint";
import { BONES, PARENT, type BoneName } from "./skeleton";
import { normalMapFor } from "./normals";
import { OUTFIT_BY_ID, paintKey, shapeKey, type Look } from "./wardrobe";

export type { Look } from "./wardrobe";
export type { EmoteId, PoseId } from "./animator";
export type { Detail, Tier } from "./mesh";
export { nearDetail } from "./mesh";

// ── Caches ────────────────────────────────────────────────────────────────────

interface Body extends BuiltBody {
  /** Ground-solver hull: [bone, x, y, z] per point, bone-local (rest pose has no rotation). */
  contacts: Float32Array;
}

const bodies = new Map<string, Body>();
const textures = new Map<string, { tex: CanvasTexture; users: number; last: number }>();
let maxAniso = 4;

export function setMaxAnisotropy(n: number): void {
  maxAniso = Math.max(1, Math.min(8, n));
}

function bodyFor(look: Look, level: Detail): Body {
  const key = `${level}|${shapeKey(look)}`;
  let b = bodies.get(key);
  if (!b) {
    const built = buildBody(look, level);
    b = { ...built, contacts: hullOf(built) };
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

function textureFor(look: Look, tier: Tier, size: number): CanvasTexture {
  const key = `${tier}|${size}|${paintKey(look)}`;
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
const DIRS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [0.7, -0.7, 0], [-0.7, -0.7, 0], [0, -0.7, 0.7], [0, -0.7, -0.7],
];

/** A few extreme points per bone: whatever can touch the ground first in any pose. */
function hullOf(b: BuiltBody): Float32Array {
  const g = b.geometry;
  const pos = g.attributes.position;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const best: { i: number; d: number }[][] = Array.from({ length: MAIN_BONES }, () => DIRS.map(() => ({ i: -1, d: -Infinity })));
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
    if (bone < 0 || bone >= MAIN_BONES) continue;
    const r = b.rest[BONES[bone]];
    const x = pos.getX(i) - r.x;
    const y = pos.getY(i) - r.y;
    const z = pos.getZ(i) - r.z;
    const row = best[bone];
    for (let d = 0; d < DIRS.length; d++) {
      const v = x * DIRS[d][0] + y * DIRS[d][1] + z * DIRS[d][2];
      if (v > row[d].d) row[d] = { i, d: v };
    }
  }
  const out: number[] = [];
  for (let bone = 0; bone < MAIN_BONES; bone++) {
    const seen = new Set<number>();
    for (const { i } of best[bone]) {
      if (i < 0 || seen.has(i)) continue;
      seen.add(i);
      const r = b.rest[BONES[bone]];
      out.push(bone, pos.getX(i) - r.x, pos.getY(i) - r.y, pos.getZ(i) - r.z);
    }
  }
  return new Float32Array(out);
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
const _q = new Quaternion();
const _q2 = new Quaternion();
const _axis = new Vector3();
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
  private readonly tex: CanvasTexture;
  private readonly hipsRest: Vector3;
  private readonly rootRest: Vector3;
  /** Bone matrices in the mesh's own space (ground solver scratch). */
  private readonly local: Matrix4[] = Array.from({ length: MAIN_BONES }, () => new Matrix4());
  /** Off the ground on purpose (the referee says it is jumping). */
  private airborne = false;

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

    // Medium and High: a generated normal map adds weave, seams, folds and skin
    // detail without triangles (SPEC-V2 §5.2). Low: plain Lambert, cheapest.
    const normalMap = tier > 0 ? normalMapFor(look, TEX_SIZE[Math.max(0, tier - 1)]) : null;
    const mat: Material =
      (opts.lit ?? (tier === 0 ? "lambert" : "standard")) === "lambert"
        ? new MeshLambertMaterial({ map: this.tex, normalMap })
        : new MeshStandardMaterial({ map: this.tex, normalMap, roughness: 0.78, metalness: 0 });
    const mesh = new SkinnedMesh(this.body.geometry, mat);
    mesh.add(this.bones[0]);
    mesh.bind(new Skeleton(this.bones));
    mesh.scale.setScalar(look.height);
    // Bound the whole reachable pose (arms up, lying down), not just the rest pose.
    mesh.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.6);
    this.mesh = mesh;
    this.anim = newAnimState(opts.seed ?? Math.random() * 100);
    const o = OUTFIT_BY_ID[look.outfit];
    this.anim.narrow = o.bottom.kind === "skirt" && (o.bottom.flare ?? 0) < 0.1;
  }

  get triangles(): number {
    return this.body.triangles;
  }

  /** Current geometry detail. */
  get detail(): Detail {
    return this.level;
  }

  /** Swap to another detail level (distance LOD); same bones, same paint. */
  setDetail(level: Detail): void {
    if (level === this.level) return;
    this.level = level;
    this.body = bodyFor(this.look, level);
    this.mesh.geometry = this.body.geometry;
  }

  /** Bone by name (camera eye, effects). */
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

  kill(fallDir: number): void {
    if (this.anim.dead >= 0) return;
    this.anim.dead = 0;
    this.anim.fall = 0;
    this.anim.fallDir = fallDir;
  }

  finish(): void {
    if (this.anim.done < 0) this.anim.done = 0;
  }

  /** Advance and pose. `speed` m/s on the ground; `stance` 0..2; `air` 0..1 (1: jumping). */
  update(dt: number, speed: number, stance = 0, air = 0): void {
    const a = this.anim;
    this.airborne = air > 0.5;
    a.stance += (stance - a.stance) * (1 - Math.exp(-dt * 10));
    a.air += (air - a.air) * (1 - Math.exp(-dt * 14));
    stepGait(a, speed, dt);
    computePose(a, this.pose);
    this.apply();
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
    this.ground(P.lift / this.look.height);
    void _q2;
    void Y;
  }

  /**
   * Put the lowest point of the body on the ground (y = 0 in the mesh's own
   * space: wherever the owner placed the mesh). In the air, only stop the feet
   * going through the floor. `lift` (local units) is a deliberate hop.
   */
  private ground(lift: number): void {
    const B = this.bones;
    const L = this.local;
    for (let i = 0; i < MAIN_BONES; i++) {
      B[i].updateMatrix();
      const p = PARENT_INDEX[i];
      if (p < 0) L[i].copy(B[i].matrix);
      else L[i].multiplyMatrices(L[p], B[i].matrix);
    }
    const c = this.body.contacts;
    let min = Infinity;
    for (let k = 0; k < c.length; k += 4) {
      const e = L[c[k]].elements;
      const y = e[1] * c[k + 1] + e[5] * c[k + 2] + e[9] * c[k + 3] + e[13];
      if (y < min) min = y;
    }
    if (!Number.isFinite(min)) return;
    const root = B[0];
    if (this.airborne) {
      if (min < 0) root.position.y -= min;
    } else {
      root.position.y += lift - min;
    }
  }

  dispose(): void {
    releaseTexture(this.tex);
    (this.mesh.material as Material).dispose();
    this.mesh.skeleton.dispose();
    this.mesh.removeFromParent();
  }
}
