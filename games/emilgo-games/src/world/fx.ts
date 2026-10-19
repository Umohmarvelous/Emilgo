// Elimination effects, pooled so a crowd of catches never allocates.
//
//   blood   the splatter, the splats and the pools under the bodies (blood.ts)
//   beams   the red flash from Mama's eyes to whoever moved (one draw call)

import { AdditiveBlending, CylinderGeometry, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from "three";

import { Blood } from "./blood";

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

export class Effects {
  readonly group = new Group();
  readonly blood = new Blood();
  private readonly beamMesh: InstancedMesh;
  private beamT = 0;
  private readonly beamFrom = [new Vector3(), new Vector3()];
  private readonly beamTo = new Vector3();

  constructor() {
    const beamGeo = new CylinderGeometry(1, 1, 1, 5, 1, true);
    beamGeo.translate(0, 0.5, 0); // pivot at one end
    this.beamMesh = new InstancedMesh(
      beamGeo,
      new MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
      2,
    );
    this.beamMesh.frustumCulled = false;
    this.beamMesh.visible = false;
    this.group.add(this.blood.group, this.beamMesh);
  }

  setBlood(on: boolean): void {
    this.blood.setOn(on);
  }

  /** The shot's splatter: `count` drops from `origin`, mostly along `away` (unit, horizontal). */
  burst(origin: Vector3, away: Vector3, count: number, lasting = true): void {
    this.blood.burst(origin, away, count, lasting);
  }

  /** Eye beams from both eyes to `to`, for a fraction of a second. */
  beam(eyeL: Vector3, eyeR: Vector3, to: Vector3): void {
    this.beamFrom[0].copy(eyeL);
    this.beamFrom[1].copy(eyeR);
    this.beamTo.copy(to);
    this.beamT = 0.28;
  }

  clear(): void {
    this.blood.clear();
    this.beamT = 0;
    this.beamMesh.visible = false;
  }

  update(dt: number): void {
    this.blood.update(dt);
    if (this.beamT > 0) {
      this.beamT -= dt;
      this.beamMesh.visible = this.beamT > 0;
      const w = 0.05 + this.beamT * 0.12;
      for (let k = 0; k < 2; k++) {
        const from = this.beamFrom[k];
        _v.subVectors(this.beamTo, from);
        const len = _v.length();
        _q.setFromUnitVectors(_up, _v.normalize());
        _s.set(w, len, w);
        _m.compose(from, _q, _s);
        this.beamMesh.setMatrixAt(k, _m);
      }
      this.beamMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
