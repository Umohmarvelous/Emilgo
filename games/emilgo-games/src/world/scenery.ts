// The big world's moving scenery (v4 Phase 8): the wind turbines' rotors
// turning (one instanced draw for every rotor in sight), and the places'
// sound emitters (audio/world.ts) taken from the layout.

import { BoxGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from "three";

import type { Emitter } from "../audio/world";
import type { OpenLayout } from "../maps/open/naija";
import { merge, part } from "./geo";

const HUB_Y = 46.8;
const _m = new Matrix4();
const _q = new Quaternion();
const _r = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _z = new Vector3(0, 0, 1);

/** A rotor: the hub and three blades, turning about its own +z. */
function rotorGeometry() {
  const parts = [part(new CylinderGeometry(0.9, 1.1, 1.6, 8), "#e0e0da", { r: [Math.PI / 2, 0, 0] })];
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    parts.push(part(new BoxGeometry(1.4, 21, 0.25), "#ececea", { p: [Math.sin(a) * 11, Math.cos(a) * 11, 0.4], r: [0, 0, -a] }));
  }
  return merge(parts);
}

export class Scenery {
  readonly group = new Group();
  private readonly rotors: InstancedMesh | null;
  private readonly turbines: { x: number; z: number; rot: number; phase: number }[];
  private time = 0;

  constructor(layout: OpenLayout) {
    this.turbines = layout.placements.filter((p) => p.prefab === "turbine").map((p, i) => ({ x: p.x, z: p.z, rot: p.rot, phase: i * 1.7 }));
    this.rotors = this.turbines.length ? new InstancedMesh(rotorGeometry(), new MeshLambertMaterial({ vertexColors: true }), this.turbines.length) : null;
    if (this.rotors) {
      this.rotors.frustumCulled = false;
      this.group.add(this.rotors);
    }
  }

  update(dt: number): void {
    this.time += dt;
    if (!this.rotors) return;
    this.turbines.forEach((t, i) => {
      // In front of the nacelle (its +z faces into the wind), a turn about every 3.3 s.
      _q.setFromAxisAngle(new Vector3(0, 1, 0), t.rot);
      _r.setFromAxisAngle(_z, this.time * 1.9 + t.phase);
      _p.set(0, HUB_Y, 2.6).applyQuaternion(_q).add(new Vector3(t.x, 0, t.z));
      _m.compose(_p, _q.clone().multiply(_r), _s);
      this.rotors!.setMatrixAt(i, _m);
    });
    this.rotors.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.rotors) {
      this.rotors.geometry.dispose();
      (this.rotors.material as MeshLambertMaterial).dispose();
    }
  }
}

/** What the places sound like, where (from the layout's placements). */
export function emittersOf(layout: OpenLayout): Emitter[] {
  const out: Emitter[] = [];
  let pine = 0;
  let mangrove = 0;
  let arena = false;
  for (const p of layout.placements) {
    switch (p.prefab) {
      case "turbine":
        out.push({ kind: "turbine", x: p.x, y: HUB_Y, z: p.z, range: 170 });
        break;
      case "club":
        out.push({ kind: "club", x: p.x, y: 2, z: p.z, range: 95 });
        break;
      case "generator":
        out.push({ kind: "generator", x: p.x, y: 0.6, z: p.z, range: 26 });
        break;
      case "flarestack":
        out.push({ kind: "flare", x: p.x, y: 35, z: p.z, range: 160 });
        break;
      case "crane":
        out.push({ kind: "water", x: p.x + 40, y: 0, z: p.z, range: 110 }, { kind: "gulls", x: p.x + 20, y: 20, z: p.z, range: 140 });
        break;
      case "pine":
        if (pine++ % 30 === 0) out.push({ kind: "birds", x: p.x, y: 8, z: p.z, range: 55 });
        break;
      case "mangrove":
        if (mangrove++ % 22 === 0) out.push({ kind: "frogs", x: p.x, y: 0.3, z: p.z, range: 45 });
        break;
      case "stand":
        if (!arena) {
          arena = true;
          out.push({ kind: "crowd", x: p.x - Math.sin(p.rot) * 52, y: 4, z: p.z - Math.cos(p.rot) * 52, range: 150 });
        }
        break;
    }
  }
  return out;
}
