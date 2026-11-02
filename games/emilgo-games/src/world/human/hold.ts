// Holding a gun (v4 Phase 2): after the animator has posed a body, its gun is
// placed off the right shoulder — shouldered and pointing where it aims, low
// and ready, or across the chest at a sprint — and both arms reach for it
// (two-bone IK: the elbow bent toward a pole), the fingers closed round the
// grips. The chest leans with the aim's pitch. Runs only when the body was
// posed this frame (the crowd's animation LOD), so it never adds up.
//
// Every gun is built along +z (the muzzle), +y up, from its butt (the
// pistol: from the back of its grip). Grip points are where the wrists go.

import { Matrix4, Quaternion, Vector3, type Bone, type Object3D } from "three";

import type { GunKind } from "../../config";
import type { BoneName } from "./skeleton";

/** What a body holds and how: 0 low and ready, 1 aiming, 2 across the chest (sprinting). */
export interface Hold {
  kind: GunKind;
  pitch: number;
  mode: 0 | 1 | 2;
  /** Written here: the gun relative to the body's mesh (the view puts it in the world each frame). */
  readonly local: Matrix4;
  /** Set once the hold has been worked out at least once. */
  ready: boolean;
}

export function newHold(kind: GunKind): Hold {
  return { kind, pitch: 0, mode: 0, local: new Matrix4(), ready: false };
}

/** The wrists' targets on each gun (gun space). */
const GRIPS: Record<GunKind, { r: [number, number, number]; l: [number, number, number] }> = {
  rifle: { r: [-0.012, -0.075, 0.265], l: [0.02, -0.02, 0.56] },
  smg: { r: [-0.01, -0.07, 0.2], l: [0.02, -0.01, 0.42] },
  shotgun: { r: [-0.012, -0.07, 0.25], l: [0.02, -0.02, 0.58] },
  pistol: { r: [-0.005, -0.03, -0.02], l: [0.035, -0.04, 0.0] },
};

/** The body a hold needs: its mesh and bones. */
export interface Holder {
  readonly mesh: Object3D;
  bone(name: BoneName): Bone;
}

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _want = new Vector3();
const _q = new Quaternion();
const _qw = new Quaternion();
const _qp = new Quaternion();
const _fwd = new Vector3();
const _left = new Vector3();
const _up = new Vector3(0, 1, 0);
const _sh = new Vector3();
const _shL = new Vector3();
const _butt = new Vector3();
const _dir = new Vector3();
const _gun = new Matrix4();
const _inv = new Matrix4();
const _S = new Vector3();
const _E = new Vector3();
const _W = new Vector3();
const _T = new Vector3();
const _P = new Vector3();
const _perp = new Vector3();
const _elbow = new Vector3();
const _end = new Vector3();
const _axis = new Vector3();
const _rT = new Vector3();
const _rP = new Vector3();
const _lT = new Vector3();
const _lP = new Vector3();

/** Turn `bone` so its child points at `to` (world). */
function aimBone(bone: Bone, child: Bone, to: Vector3): void {
  bone.updateWorldMatrix(true, true);
  const from = bone.getWorldPosition(_v1);
  const cur = child.getWorldPosition(_v2).sub(from).normalize();
  const want = _want.copy(to).sub(from).normalize();
  _q.setFromUnitVectors(cur, want);
  bone.getWorldQuaternion(_qw);
  _q.multiply(_qw);
  (bone.parent as Object3D).getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_q));
  bone.updateMatrix();
  bone.updateWorldMatrix(false, true);
}

/** Reach a hand's wrist to `target` with the elbow bent toward `pole` (world). */
function reach(h: Holder, side: "L" | "R", target: Vector3, pole: Vector3): void {
  const ua = h.bone(side === "L" ? "upperArmL" : "upperArmR");
  const fa = h.bone(side === "L" ? "foreArmL" : "foreArmR");
  const hd = h.bone(side === "L" ? "handL" : "handR");
  ua.updateWorldMatrix(true, true);
  ua.getWorldPosition(_S);
  fa.getWorldPosition(_E);
  hd.getWorldPosition(_W);
  const l1 = _S.distanceTo(_E);
  const l2 = _E.distanceTo(_W);
  const d = Math.min(l1 + l2 - 1e-4, _S.distanceTo(target));
  const dir = _T.copy(target).sub(_S).normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _P.copy(pole).sub(_S);
  _perp.copy(dir).multiplyScalar(_P.dot(dir));
  _perp.subVectors(_P, _perp).normalize();
  _elbow.copy(_S).addScaledVector(dir, a).addScaledVector(_perp, hgt);
  aimBone(ua, fa, _elbow);
  _end.copy(_S).addScaledVector(dir, d);
  aimBone(fa, hd, _end);
}

/** Turn a bone by a world-space rotation (its children follow). */
function turnWorld(bone: Bone, q: Quaternion): void {
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(_qw);
  const nq = _q.copy(q).multiply(_qw);
  (bone.parent as Object3D).getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(nq));
  bone.updateMatrix();
  bone.updateWorldMatrix(false, true);
}

const FINGERS = ["index", "middle", "ring", "pinky"] as const;

/** Close the fingers round a grip. */
function grip(h: Holder, side: "L" | "R", amount: number): void {
  const s = side === "L" ? 1 : -1;
  for (const f of FINGERS) {
    for (const k of [1, 2] as const) {
      const b = h.bone(`${f}${k}${side}` as BoneName);
      b.quaternion.setFromAxisAngle(_axis.set(0, 0, 1), -s * 1.2 * amount);
      b.updateMatrix();
    }
  }
  const th = h.bone(`thumb1${side}` as BoneName);
  th.quaternion.setFromAxisAngle(_axis.set(0, 1, 0), s * 0.6 * amount);
  th.updateMatrix();
}

/** Pose the arms round the gun and write where the gun is (relative to the body). */
export function applyHold(h: Holder, hold: Hold): void {
  const mesh = h.mesh;
  mesh.updateWorldMatrix(true, true);
  const s = mesh.scale.y;
  _fwd.set(0, 0, 1).applyQuaternion(mesh.quaternion);
  _left.set(1, 0, 0).applyQuaternion(mesh.quaternion);
  const pitch = Math.max(-0.9, Math.min(0.9, hold.pitch));
  // Aiming, the chest and head lean with the pitch (the arms come with them).
  if (hold.mode === 1 && Math.abs(pitch) > 0.01) {
    turnWorld(h.bone("chest"), _qw.setFromAxisAngle(_left, pitch * 0.55));
    turnWorld(h.bone("neck"), _qw.setFromAxisAngle(_left, pitch * 0.25));
  }
  h.bone("upperArmR").getWorldPosition(_sh);
  h.bone("upperArmL").getWorldPosition(_shL);
  const pistol = hold.kind === "pistol";
  if (hold.mode === 1) {
    // Shouldered (a pistol: out in front, both hands), along the aim.
    _dir.copy(_fwd).multiplyScalar(Math.cos(pitch)).addScaledVector(_up, -Math.sin(pitch));
    if (pistol) _butt.copy(_sh).lerp(_shL, 0.5).addScaledVector(_fwd, 0.36 * s).addScaledVector(_up, -0.05 * s).addScaledVector(_dir, 0.06 * s);
    else _butt.copy(_sh).addScaledVector(_left, 0.07 * s).addScaledVector(_fwd, 0.05 * s);
    _dir.addScaledVector(_left, pistol ? 0 : 0.04).normalize();
  } else if (hold.mode === 2) {
    // Across the chest, muzzle up and over the left shoulder.
    _butt.copy(_sh).addScaledVector(_left, 0.02 * s).addScaledVector(_up, -0.32 * s).addScaledVector(_fwd, 0.12 * s);
    _dir.copy(_fwd).multiplyScalar(0.55).addScaledVector(_up, 0.75).addScaledVector(_left, 0.38).normalize();
    if (pistol) _butt.addScaledVector(_up, 0.05 * s);
  } else {
    // Low ready: the muzzle down and in front.
    _butt.copy(_sh).addScaledVector(_left, 0.06 * s).addScaledVector(_up, -0.1 * s).addScaledVector(_fwd, 0.08 * s);
    _dir.copy(_fwd).addScaledVector(_up, -0.6).addScaledVector(_left, 0.3).normalize();
    if (pistol) _butt.addScaledVector(_fwd, 0.18 * s).addScaledVector(_left, 0.08 * s).addScaledVector(_up, -0.12 * s);
  }
  // +z of the gun along _dir (Matrix4.lookAt makes −z look at the target: swap eye and target).
  _v3.copy(_butt).add(_dir);
  _gun.lookAt(_v3, _butt, _up);
  _gun.scale(_S.set(s, s, s));
  _gun.setPosition(_butt);
  const G = GRIPS[hold.kind];
  // Poles: the right elbow out and down behind, the left out and down in front.
  _rT.set(G.r[0], G.r[1], G.r[2]).applyMatrix4(_gun);
  _rP.copy(_sh).addScaledVector(_left, -0.35).addScaledVector(_up, -0.5).addScaledVector(_fwd, -0.15);
  reach(h, "R", _rT, _rP);
  _lT.set(G.l[0], G.l[1], G.l[2]).applyMatrix4(_gun);
  _lP.copy(_shL).addScaledVector(_left, pistol ? 0.25 : 0.45).addScaledVector(_up, -0.6).addScaledVector(_fwd, 0.1);
  reach(h, "L", _lT, _lP);
  grip(h, "R", 1);
  grip(h, "L", 0.9);
  // Where the gun is, relative to the body (the body moves on between poses).
  _inv.copy(mesh.matrixWorld).invert();
  hold.local.multiplyMatrices(_inv, _gun);
  hold.ready = true;
}
