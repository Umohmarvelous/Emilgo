// The laser guns (SPEC-V2 §2.2, §6.1): towers round the field's edge, each
// with a turret that tracks the runners while Mama watches, and fires at
// whoever she catches.
//
//   towers   one merged mesh: four splayed legs, cross braces, a platform
//   turrets  one instanced mesh (head, barrel, red lens), aimed per frame
//
// Idle, the turrets sweep slowly; while she turns and stares, each locks on to
// the nearest runner still in play (smoothly: models never shake). On a catch
// the tower nearest the offender snaps on and its muzzle is where the beam
// starts.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";

import type { Course } from "../config";
import type { Contestant } from "../game/rules";
import type { TierSpec } from "../graphics/tiers";
import { merge, part, type V3 } from "./geo";
import { canvasTexture, glow } from "./tex";

const TOWER_H = 6.5;
const RANGE = 90;

interface Turret {
  pos: Vector3;
  yaw: number;
  pitch: number;
  wantYaw: number;
  wantPitch: number;
  /** The way it faces when idle (towards the field). */
  home: number;
  sweep: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _qx = new Quaternion();
const _one = new Vector3(1, 1, 1);
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

export class Lasers {
  readonly group = new Group();
  /** The towers in 50 m pieces (so only nearby ones need to cast shadows), and where each stands. */
  readonly pieces: { mesh: Mesh; z: number }[] = [];
  private readonly turrets: Turret[] = [];
  private heads: InstancedMesh | null = null;
  private time = 0;
  private readonly mats: Material[] = [];

  /** Build for this course (call each round's world). At night each tower shows a red beacon. */
  constructor(course: Course, spec: TierSpec, night = false) {
    const sides = [-1, 1];
    const spots: { x: number; z: number }[] = [];
    const x = course.halfWidth + 2.6;
    for (let z = -12; z > course.finishZ + 4; z -= 30) for (const s of sides) spots.push({ x: s * x, z });
    // Two more flanking Mama.
    for (const s of sides) spots.push({ x: s * 6.5, z: course.dollZ + 3 });

    // Budget: ≈ 180 triangles a tower and ≈ 240 a turret, 22 of each on a 300 m field.
    const seg = spec.tier === 0 ? 6 : 8;
    const steel = "#3a3f46";
    const byChunk = new Map<number, BufferGeometry[]>();
    for (const p of spots) {
      const k = Math.floor(p.z / 50);
      let parts = byChunk.get(k);
      if (!parts) byChunk.set(k, (parts = []));
      // Legs splay out to a 1.6 m base.
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        parts.push(part(new CylinderGeometry(0.06, 0.08, TOWER_H, 5, 1, true), steel, { p: [p.x + dx * 0.55, TOWER_H / 2, p.z + dz * 0.55], r: [dz * 0.06, 0, -dx * 0.06] }));
      }
      // Braces and the platform.
      for (const h of [2.4, 4.8]) {
        parts.push(part(new BoxGeometry(1.2, 0.07, 0.07), steel, { p: [p.x, h, p.z - 0.5] }));
        parts.push(part(new BoxGeometry(1.2, 0.07, 0.07), steel, { p: [p.x, h, p.z + 0.5] }));
        parts.push(part(new BoxGeometry(0.07, 0.07, 1.2), steel, { p: [p.x - 0.5, h, p.z] }));
        parts.push(part(new BoxGeometry(0.07, 0.07, 1.2), steel, { p: [p.x + 0.5, h, p.z] }));
      }
      parts.push(part(new BoxGeometry(1.5, 0.16, 1.5), "#2a2e34", { p: [p.x, TOWER_H, p.z] }));
      parts.push(part(new CylinderGeometry(0.32, 0.4, 0.3, seg + 4), "#22262b", { p: [p.x, TOWER_H + 0.22, p.z] }));
      const home = Math.atan2(-p.x, (course.finishZ * 0.5 - p.z) * 0.15);
      this.turrets.push({ pos: new Vector3(p.x, TOWER_H + 0.6, p.z), yaw: home, pitch: -0.25, wantYaw: home, wantPitch: -0.25, home, sweep: Math.random() * 6 });
    }
    const lit = (o: { vertexColors: true }) => (spec.pbr ? new MeshStandardMaterial({ ...o, roughness: 0.55, metalness: 0.5 }) : new MeshLambertMaterial(o));
    const towerMat = lit({ vertexColors: true });
    this.mats.push(towerMat);
    for (const [k, parts] of byChunk) {
      const towers = new Mesh(merge(parts), towerMat);
      this.group.add(towers);
      this.pieces.push({ mesh: towers, z: (k + 0.5) * 50 });
    }

    // The turret: a rounded head, a long barrel along +Z, a red lens at its muzzle.
    const head = merge([
      part(new SphereGeometry(0.34, seg + 2, seg - 2), "#2c3036", { s: [1, 0.78, 1.1] }),
      part(new BoxGeometry(0.5, 0.12, 0.5), "#1c1f24", { p: [0, -0.2, 0] }),
      part(new CylinderGeometry(0.07, 0.09, 1.1, seg, 1, true), "#15171a", { p: [0, 0.02, 0.62], r: [Math.PI / 2, 0, 0] }),
      part(new SphereGeometry(0.075, 6, 4), "#ff2a2a", { p: [0, 0.02, 1.18] }),
      part(new SphereGeometry(0.06, 6, 4), "#ff4040", { p: [0.18, 0.12, 0.26] }),
    ]);
    const headMat = lit({ vertexColors: true });
    this.mats.push(headMat);
    if (night) {
      // Red beacons on the platforms: the field's only lights after dark.
      const pts = new Float32Array(spots.length * 3);
      spots.forEach((p, i) => pts.set([p.x, TOWER_H + 0.35, p.z], i * 3));
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(pts, 3));
      const beacon = new Points(g, new PointsMaterial({ color: 0xff3a2a, size: 2.4, map: canvasTexture("glow", 64, glow, false), transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false }));
      beacon.frustumCulled = false;
      this.mats.push(beacon.material as Material);
      this.group.add(beacon);
    }
    this.heads = new InstancedMesh(head, headMat, this.turrets.length);
    this.heads.instanceMatrix.setUsage(DynamicDrawUsage);
    // The towers cast the shadow; the small heads aren't worth a second draw.
    this.heads.castShadow = false;
    this.heads.frustumCulled = false;
    this.group.add(this.heads);
    this.place();
  }

  /** Everything here also shows in the puddles' mirror. */
  setLayer(layer: number): void {
    this.group.traverse((o) => o.layers.enable(layer));
  }

  /**
   * Per frame. While she's turning or watching, each turret tracks the nearest
   * runner in play; otherwise it sweeps slowly round its home direction.
   */
  update(dt: number, alert: boolean, list: readonly Contestant[]): void {
    this.time += dt;
    for (const t of this.turrets) {
      let target: Contestant | null = null;
      if (alert) {
        let best = RANGE;
        for (const c of list) {
          if (c.status !== "alive") continue;
          const d = Math.hypot(c.x - t.pos.x, c.z - t.pos.z);
          if (d < best) {
            best = d;
            target = c;
          }
        }
      }
      if (target) this.aim(t, target.x, 1.2, target.z);
      else {
        t.wantYaw = t.home + Math.sin(this.time * 0.25 + t.sweep) * 0.6;
        t.wantPitch = -0.18;
      }
      // Smooth: a fixed fraction per second, no overshoot.
      const k = 1 - Math.exp(-dt * (alert ? 6 : 1.5));
      t.yaw += wrap(t.wantYaw - t.yaw) * k;
      t.pitch += (t.wantPitch - t.pitch) * k;
    }
    this.place();
  }

  /**
   * Fire at a point (a caught runner's chest): the nearest tower snaps on.
   * Returns the muzzle, where the beam starts.
   */
  fireAt(to: Vector3, out: Vector3): Vector3 {
    let t = this.turrets[0];
    let best = Infinity;
    for (const q of this.turrets) {
      const d = q.pos.distanceToSquared(to);
      if (d < best) {
        best = d;
        t = q;
      }
    }
    if (!t) return out.copy(to);
    this.aim(t, to.x, to.y, to.z);
    t.yaw = t.wantYaw;
    t.pitch = t.wantPitch;
    this.place();
    // Muzzle: 1.18 m along the barrel from the head's centre.
    _q.setFromAxisAngle(Y, t.yaw).multiply(_qx.setFromAxisAngle(X, -t.pitch));
    return out.set(0, 0.02, 1.18).applyQuaternion(_q).add(t.pos);
  }

  private aim(t: Turret, x: number, y: number, z: number): void {
    const dx = x - t.pos.x;
    const dz = z - t.pos.z;
    t.wantYaw = Math.atan2(dx, dz);
    t.wantPitch = Math.atan2(y - t.pos.y, Math.hypot(dx, dz));
  }

  private place(): void {
    const h = this.heads;
    if (!h) return;
    this.turrets.forEach((t, i) => {
      _q.setFromAxisAngle(Y, t.yaw).multiply(_qx.setFromAxisAngle(X, -t.pitch));
      _m.compose(t.pos, _q, _one);
      h.setMatrixAt(i, _m);
    });
    h.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => (o as Mesh).geometry?.dispose?.());
    for (const m of this.mats) m.dispose();
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export type { V3 };
