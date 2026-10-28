// Flat marks on the ground that fade (SPEC-V3 §7): the sky laser's scorch,
// your footprints. One pool is one draw call: an instanced quad lying on the
// floor, each instance with its own opacity, the oldest reused when it fills.
// The ground isn't lit under a mark: it is darkened by it (normal blending of
// a dark, soft-edged picture), so a mark reads the same at noon and at night.

import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  type Texture,
  Vector3,
} from "three";

const VERT = /* glsl */ `
varying vec2 vUv;
varying float vA;
void main() {
  vUv = uv;
  vA = instanceColor.r;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 tint;
varying vec2 vUv;
varying float vA;
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(tint * t.rgb, t.a * vA);
  if (gl_FragColor.a < 0.01) discard;
}`;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const ZERO = new Matrix4().makeScale(0, 0, 0);
const _tint = new Color();

export class DecalPool {
  readonly mesh: InstancedMesh;
  private readonly age: Float32Array;
  private readonly alpha: Float32Array;
  private next = 0;
  private live = 0;

  /**
   * `life`: seconds a mark lasts; it fades over its last `fade` seconds.
   * `tint` multiplies the picture (dust, mud, soot).
   */
  constructor(map: Texture, readonly max: number, tint: Color, readonly life: number, readonly fade: number) {
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new ShaderMaterial({
      uniforms: { map: { value: map }, tint: { value: tint } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.age = new Float32Array(max).fill(Infinity);
    this.alpha = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, _tint.setRGB(0, 0, 0));
    }
    this.mesh.instanceColor!.setUsage(DynamicDrawUsage);
    this.mesh.visible = false;
  }

  /** A mark at (x, y, z), turned `yaw`, `w` × `l` metres, at full strength `alpha`. */
  add(x: number, y: number, z: number, yaw: number, w: number, l: number, alpha = 1): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    if (!Number.isFinite(this.age[i])) this.live++;
    this.age[i] = 0;
    this.alpha[i] = alpha;
    _q.setFromAxisAngle(_up, yaw);
    this.mesh.setMatrixAt(i, _m.compose(_p.set(x, y + 0.02, z), _q, _s.set(w, 1, l)));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    if (!this.live) return;
    const col = this.mesh.instanceColor!;
    for (let i = 0; i < this.max; i++) {
      if (!Number.isFinite(this.age[i])) continue;
      this.age[i] += dt;
      const left = this.life - this.age[i];
      if (left <= 0) {
        this.age[i] = Infinity;
        this.live--;
        this.mesh.setMatrixAt(i, ZERO);
        this.mesh.instanceMatrix.needsUpdate = true;
        col.setX(i, 0);
        continue;
      }
      col.setX(i, this.alpha[i] * Math.min(1, left / this.fade));
    }
    col.needsUpdate = true;
    this.mesh.visible = this.live > 0;
  }

  /** Every mark gone (a sandstorm wipes the footprints; a new match). */
  clear(): void {
    for (let i = 0; i < this.max; i++) {
      this.age[i] = Infinity;
      this.mesh.setMatrixAt(i, ZERO);
    }
    this.live = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
