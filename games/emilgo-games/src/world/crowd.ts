// The contestants: one generated, skinned person each (world/human).
//
// The referee moves contestants; this only dresses and animates them. Walk,
// run and sprint come from how fast each one actually moved; a sudden stop
// holds the stride for a moment (the statue look); a catch is a fall away from
// Mama; crossing the line is a cheer. Everything here is presentation — the
// referee never reads it.

import { CircleGeometry, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from "three";

import type { Contestant } from "../game/rules";
import type { EmoteId } from "../social/emotes";
import { Human, lodLevels, warmBodies, type ActionId, type Look, type Tier } from "./human";
import { OUTFIT_BY_ID } from "./human/wardrobe";

export type { Look } from "./human";

const SINK_AFTER = 4.6;
/**
 * Distance LOD (SPEC-V2 §5.2, §8): the whole crowd shares a triangle budget
 * per tier, so twenty people bunched at the start line never push a frame past
 * 100,000 triangles. Nearest first: each gets the best detail its distance
 * allows that still leaves the rest room at the far level.
 */
const CROWD_BUDGET = [28000, 32000, 32000] as const;
const NEAR_M = 20;
const MID_M = 45;
/**
 * Real shadows only from the nearest few: the shadow pass draws them again, and
 * those triangles count against the frame's 100K too. The rest keep a blob.
 */
const SHADOW_MAX = [0, 3, 2] as const;

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const ZERO = new Matrix4().makeScale(0, 0, 0);
const UP = new Vector3(0, 1, 0);

/** The colour that stands for a look on the HUD track and minimap. */
export function accentOf(look: Look): string {
  return OUTFIT_BY_ID[look.outfit]?.accent ?? "#0a8a4a";
}

export class Crowd {
  readonly group = new Group();
  private people: (Human | null)[] = [];
  private readonly shadows: InstancedMesh;
  private hidden: boolean[] = [];
  private n = 0;
  /** Index of the local player (full-size texture, first-person hiding), or -1. */
  featured = -1;
  /** Graphics tier for the next setup(). */
  tier: Tier = 1;
  /** Blob shadows (off when the renderer draws real shadows). */
  blobShadows = true;
  /** Hide the local player's head (first person). */
  hideMyHead = false;
  private lodClock = 0;
  private readonly order: number[] = [];
  private readonly dist: number[] = [];

  constructor(private readonly max: number) {
    const shadowGeo = new CircleGeometry(0.42, 14);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadows = new InstancedMesh(shadowGeo, new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false }), max);
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 1;
    this.group.add(this.shadows);
  }

  /** New round: who is in it and what they wear. */
  setup(looks: Look[], featured = this.featured): void {
    for (const p of this.people) p?.dispose();
    this.featured = featured;
    this.n = Math.min(looks.length, this.max);
    this.people = looks.slice(0, this.n).map((l, i) => {
      warmBodies(l, this.tier);
      const h = new Human(l, this.tier, { featured: i === featured, seed: i * 1.37 + 0.5 });
      h.mesh.castShadow = !this.blobShadows;
      this.group.add(h.mesh);
      return h;
    });
    this.hidden = new Array(this.n).fill(false);
    this.shadows.count = this.n;
  }

  setShadows(real: boolean): void {
    this.blobShadows = !real;
    for (const p of this.people) if (p) p.mesh.castShadow = real;
    this.shadows.count = this.n;
  }

  human(i: number): Human | null {
    return this.people[i] ?? null;
  }

  /** Start the fall: away from the doll at (dollX, dollZ). */
  kill(i: number, c: Contestant, dollX: number, dollZ: number): void {
    const h = this.people[i];
    if (!h) return;
    const away = Math.atan2(c.x - dollX, c.z - dollZ);
    h.kill(away - c.heading);
  }

  /** Play an emote on contestant i (upper body only — the feet never move). */
  emote(i: number, id: EmoteId): void {
    const h = this.people[i];
    if (!h || this.hidden[i]) return;
    h.emote(id);
  }

  finish(i: number): void {
    this.people[i]?.finish();
  }

  /** Fist, slap, push or a pick-up. */
  act(i: number, id: ActionId): void {
    if (!this.hidden[i]) this.people[i]?.act(id);
  }

  setCarry(i: number, on: boolean): void {
    this.people[i]?.setCarry(on);
  }

  /** Hit or shoved from world direction (dx, dz): stagger, turned by the blow. */
  hit(i: number, c: Contestant, dx: number, dz: number): void {
    // Which side the blow lands on, relative to where they face.
    const side = Math.sin(Math.atan2(dx, dz) - c.heading);
    this.people[i]?.hit(side);
  }

  /** Between the hands (a carried ball). */
  hands(i: number, out: Vector3): Vector3 | null {
    const h = this.people[i];
    if (!h || this.hidden[i]) return null;
    h.mesh.updateWorldMatrix(true, true);
    const l = h.bone("handL").getWorldPosition(_v);
    h.bone("handR").getWorldPosition(out);
    return out.add(l).multiplyScalar(0.5);
  }

  /** Where a contestant's chest is now, following the fall (effects, camera). */
  chest(c: Contestant, out: Vector3): Vector3 {
    const h = this.people[c.index];
    if (!h) return out.set(c.x, 1.25, c.z);
    h.mesh.updateWorldMatrix(true, true);
    return h.bone("chest").getWorldPosition(out);
  }

  /** Eye position of contestant i (first-person camera). */
  eye(i: number, out: Vector3): Vector3 | null {
    const h = this.people[i];
    if (!h) return null;
    h.mesh.updateWorldMatrix(true, true);
    return h.bone("head").localToWorld(out.set(0, 0.11, 0.06));
  }

  /**
   * Who gets how much detail: the NEAR_MAX nearest within NEAR_M metres get the
   * tier's full body, the rest within MID_M one step down, the far field the
   * light one. You always get full detail. A couple of metres of hysteresis
   * stop anyone flickering between levels at a boundary.
   */
  private updateLod(cam: Vector3): void {
    const [near, mid, far] = lodLevels(this.tier);
    this.order.length = 0;
    for (let i = 0; i < this.n; i++) {
      const h = this.people[i];
      if (!h || this.hidden[i]) continue;
      this.dist[i] = h.mesh.position.distanceTo(cam);
      this.order.push(i);
    }
    // You first, then nearest first.
    this.order.sort((a, b) => (a === this.featured ? -1 : b === this.featured ? 1 : this.dist[a] - this.dist[b]));
    let left: number = CROWD_BUDGET[this.tier];
    let rest = 0;
    for (const i of this.order) rest += this.people[i]!.trianglesAt(far);
    this.order.forEach((i, rank) => {
      const h = this.people[i]!;
      const d = this.dist[i];
      const pad = (lvl: number) => (h.detail >= lvl ? 2 : 0);
      const want = i === this.featured || d < NEAR_M + pad(near) ? near : d < MID_M + pad(mid) ? mid : far;
      rest -= h.trianglesAt(far);
      // The best level allowed by distance that still leaves everyone after this one their far level.
      let lvl = far;
      for (const l of [near, mid, far]) {
        if (l > want) continue;
        if (i === this.featured || h.trianglesAt(l) + rest <= left) {
          lvl = l;
          break;
        }
      }
      h.setDetail(lvl);
      left -= h.trianglesAt(lvl);
      if (!this.blobShadows) h.mesh.castShadow = rank < SHADOW_MAX[this.tier];
    });
  }

  update(dt: number, list: readonly Contestant[], cam?: Vector3): void {
    if (cam && (this.lodClock -= dt) <= 0) {
      this.lodClock = 0.25;
      this.updateLod(cam);
    }
    for (let i = 0; i < this.n; i++) {
      const c = list[i];
      const h = this.people[i];
      if (!c || !h) continue;
      if (this.hidden[i]) continue;

      // Speed from actual travel (the referee's velocity can lag a frame).
      const speed = Math.hypot(c.vx, c.vz);
      h.mesh.position.set(c.x, c.y ?? 0, c.z);
      h.mesh.quaternion.setFromAxisAngle(UP, c.heading);
      h.update(dt, speed, c.stance ?? 0, (c.y ?? 0) > 0.03 ? 1 : 0, c.slide > 0 ? 1 : 0);

      // First person: no head in front of the lens.
      if (i === this.featured) h.bone("head").scale.setScalar(this.hideMyHead ? 0.001 : 1);

      // Caught long ago: sink away and disappear.
      const a = h.anim;
      if (a.dead > SINK_AFTER) {
        h.mesh.position.y -= (a.dead - SINK_AFTER) * 0.22;
        if (a.dead > SINK_AFTER + 2.2) {
          this.hidden[i] = true;
          h.mesh.visible = false;
          this.shadows.setMatrixAt(i, ZERO);
          continue;
        }
      }

      // A blob for everyone not casting a real shadow (Low, and all but the nearest few).
      if (this.blobShadows || !h.mesh.castShadow) {
        const lie = a.dead >= 0 ? a.fall : 0;
        const dir = c.heading + a.fallDir;
        _q.setFromAxisAngle(UP, dir);
        _s.set(1 + lie * 0.2, 1, 1 + lie * 1.6);
        const off = lie * 0.8;
        const lift = Math.max(0, c.y ?? 0);
        _s.multiplyScalar(1 / (1 + lift * 1.5));
        _v.set(c.x + Math.sin(dir) * off, 0.018, c.z + Math.cos(dir) * off);
        _m.compose(_v, _q, _s);
        this.shadows.setMatrixAt(i, _m);
      } else {
        this.shadows.setMatrixAt(i, ZERO);
      }
    }
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  get triangles(): number {
    let t = 0;
    for (const p of this.people) if (p) t += p.triangles;
    return t;
  }

  dispose(): void {
    for (const p of this.people) p?.dispose();
    this.people = [];
    this.n = 0;
    this.shadows.count = 0;
  }
}
