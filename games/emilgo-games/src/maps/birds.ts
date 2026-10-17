// Birds (SPEC-V2 §6.1): small flocks crossing the sky now and then — swallow-
// sized, dark against the light, never circling (no vultures: §10). Daylight,
// sunrise and sunset only; none in the rain or at night.
//
// One instanced mesh for every bird. Wings flap in the vertex shader (each
// bird at its own pace), so the only CPU work is one matrix per bird.

import {
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three";

import { Rng } from "../core/rng";

const FLOCKS = 3;
const PER = 7;

/** A bird: a body and two swept wings; the `aWing` attribute says how far out each vertex is. */
function birdGeometry(): BufferGeometry {
  const p: number[] = [];
  const w: number[] = [];
  const tri = (a: number[], b: number[], c: number[], wa: number, wb: number, wc: number) => {
    p.push(...a, ...b, ...c);
    w.push(wa, wb, wc);
  };
  // Body (a thin diamond), nose along +Z.
  tri([0, 0, 0.32], [0.06, 0, 0], [0, 0.04, -0.28], 0, 0, 0);
  tri([0, 0, 0.32], [0, 0.04, -0.28], [-0.06, 0, 0], 0, 0, 0);
  tri([0, 0.04, -0.28], [0.06, 0, 0], [0, 0, 0.32], 0, 0, 0);
  // Tail fork.
  tri([0, 0.02, -0.24], [0.1, 0.02, -0.46], [0, 0.02, -0.34], 0, 0.1, 0);
  tri([0, 0.02, -0.24], [0, 0.02, -0.34], [-0.1, 0.02, -0.46], 0, 0, 0.1);
  // Wings: root to a swept tip, both faces.
  for (const s of [1, -1]) {
    const root1 = [0.05 * s, 0.01, 0.12];
    const root2 = [0.05 * s, 0.01, -0.08];
    const elbow = [0.32 * s, 0.03, 0.02];
    const tip = [0.6 * s, 0.02, -0.18];
    tri(root1, elbow, root2, 0, 0.55, 0);
    tri(root1, root2, elbow, 0, 0, 0.55);
    tri(elbow, tip, root2, 0.55, 1, 0);
    tri(elbow, root2, tip, 0.55, 0, 1);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(p, 3));
  g.setAttribute("aWing", new Float32BufferAttribute(w, 1));
  g.computeVertexNormals();
  return g;
}

interface Flock {
  /** Where it is, where it's heading (unit), how fast. */
  at: Vector3;
  dir: Vector3;
  speed: number;
  /** Seconds before it appears (when waiting off-stage). */
  wait: number;
  active: boolean;
  /** Each bird's place in the flock. */
  offs: Vector3[];
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const UP = new Vector3(0, 1, 0);

export class Birds {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
  private readonly flocks: Flock[] = [];
  private readonly rng: Rng;
  private readonly uTime = { value: 0 };
  private time = 0;

  /** `centreZ`: the middle of the field (flocks cross near it). */
  constructor(seed: number, private readonly centreZ: number) {
    this.rng = new Rng(seed ^ 0x51ed27);
    const geo = birdGeometry();
    const phase = new Float32Array(FLOCKS * PER);
    for (let i = 0; i < phase.length; i++) phase[i] = this.rng.range(0, 6.28);
    geo.setAttribute("aPhase", new InstancedBufferAttribute(phase, 1));
    const mat = new MeshLambertMaterial({ color: 0x24221f });
    mat.side = 2; // both sides: seen from below
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aWing;\nattribute float aPhase;\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float f = sin(uTime * 11.0 + aPhase);
          transformed.y += f * aWing * 0.32;
          transformed.x *= 1.0 - abs(f) * aWing * 0.12;`,
        );
    };
    this.mesh = new InstancedMesh(geo, mat, FLOCKS * PER);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    for (let f = 0; f < FLOCKS; f++) {
      const offs: Vector3[] = [];
      for (let i = 0; i < PER; i++) {
        // A loose V.
        const row = Math.ceil(i / 2);
        const side = i === 0 ? 0 : i % 2 ? 1 : -1;
        offs.push(new Vector3(side * row * 1.4 + this.rng.range(-0.4, 0.4), this.rng.range(-0.6, 0.6), -row * 1.3 + this.rng.range(-0.4, 0.4)));
      }
      this.flocks.push({ at: new Vector3(), dir: new Vector3(), speed: 0, wait: f * 6 + this.rng.range(1, 5), active: false, offs });
    }
    this.hideAll();
  }

  private hideAll(): void {
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < FLOCKS * PER; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** A flock enters from one side, crosses near the field, and leaves. */
  private launch(f: Flock): void {
    const r = this.rng;
    const side = r.chance(0.5) ? 1 : -1;
    const z = this.centreZ + r.range(-120, 120);
    f.at.set(side * 260, r.range(28, 60), z);
    const to = new Vector3(-side * 260, f.at.y + r.range(-8, 8), this.centreZ + r.range(-160, 160));
    f.dir.subVectors(to, f.at).normalize();
    f.speed = r.range(8, 12);
    f.active = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.uTime.value = this.time;
    this.flocks.forEach((f, fi) => {
      if (!f.active) {
        f.wait -= dt;
        if (f.wait <= 0) this.launch(f);
        _m.makeScale(0, 0, 0);
        for (let i = 0; i < PER; i++) this.mesh.setMatrixAt(fi * PER + i, _m);
        return;
      }
      f.at.addScaledVector(f.dir, f.speed * dt);
      if (Math.abs(f.at.x) > 280) {
        f.active = false;
        f.wait = this.rng.range(6, 18);
      }
      const yaw = Math.atan2(f.dir.x, f.dir.z);
      _q.setFromAxisAngle(UP, yaw);
      f.offs.forEach((o, i) => {
        _p.copy(o).applyQuaternion(_q).add(f.at);
        _p.y += Math.sin(this.time * 0.8 + i) * 0.3;
        _s.setScalar(1.6);
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(fi * PER + i, _m);
      });
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
  }
}
