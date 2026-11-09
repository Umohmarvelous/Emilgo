// The captain's armband (v6, the owner: "a difference that captain have than
// teammates ... like in football how captains have a ribbon they tie on their
// biceps"): a yellow band with a black C round the squad leader's left upper
// arm, riding that bone so it follows every move.
//
// Fitted to the body: the band's radius is the widest the arm's own skin gets
// round the band's line (the upper arm's vertices near it), plus a hair, so it
// sits on the sleeve without sinking in or floating. One small mesh, drawn
// only on leaders (a squad has one): a draw each, at most six on a field.

import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  type BufferGeometry,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";

import { BONES, type BoneName, type V3 } from "./skeleton";

let tex: CanvasTexture | null = null;

/** Yellow, a dark edge top and bottom, and a black C every quarter turn (one always faces you). */
function bandTexture(): CanvasTexture {
  if (tex) return tex;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 48;
  const x = c.getContext("2d")!;
  x.fillStyle = "#f2c230";
  x.fillRect(0, 0, 256, 48);
  x.fillStyle = "#1a1a1a";
  x.fillRect(0, 0, 256, 5);
  x.fillRect(0, 43, 256, 5);
  x.font = '900 30px Montserrat, "Arial Black", sans-serif';
  x.textAlign = "center";
  x.textBaseline = "middle";
  // Drawn mirrored: seen from outside the cylinder its U runs the other way, so the C reads right.
  for (const u of [32, 96, 160, 224]) {
    x.save();
    x.translate(u, 25);
    x.scale(-1, 1);
    x.fillText("C", 0, 0);
    x.restore();
  }
  tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Where along the upper arm the band sits: this share of the way from shoulder to elbow. */
const ALONG = 0.42;
const WIDTH = 0.055;

/**
 * The band for `side`'s upper arm of this body (its rest geometry and joints).
 * Returned positioned in the bone's own space: add it to that bone.
 */
export function armbandMesh(geometry: BufferGeometry, rest: Record<BoneName, V3>, side: "L" | "R" = "L"): Mesh {
  const bone = `upperArm${side}` as BoneName;
  const sh = rest[bone];
  const el = rest[`foreArm${side}` as BoneName];
  const a = new Vector3(sh.x, sh.y, sh.z);
  const axis = new Vector3(el.x - sh.x, el.y - sh.y, el.z - sh.z);
  const len = axis.length() || 0.28;
  axis.divideScalar(len);
  const at = a.clone().addScaledVector(axis, len * ALONG);

  // The arm's own thickness round that line: its upper-arm vertices within a band's width of it.
  const bi = BONES.indexOf(bone);
  const pos = geometry.attributes.position;
  const si = geometry.attributes.skinIndex;
  const sw = geometry.attributes.skinWeight;
  const v = new Vector3();
  let r = 0;
  if (pos && si && sw) {
    for (let i = 0; i < pos.count; i++) {
      // The vertex's main bone.
      let b = si.getX(i);
      let w = sw.getX(i);
      if (sw.getY(i) > w) (w = sw.getY(i)), (b = si.getY(i));
      if (sw.getZ(i) > w) (w = sw.getZ(i)), (b = si.getZ(i));
      if (sw.getW(i) > w) (w = sw.getW(i)), (b = si.getW(i));
      if (b !== bi) continue;
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(at);
      const along = v.dot(axis);
      if (Math.abs(along) > WIDTH * 0.6) continue;
      r = Math.max(r, v.addScaledVector(axis, -along).length());
    }
  }
  if (r <= 0.02 || r > 0.12) r = 0.05;
  const rad = r * 1.04 + 0.004;

  const geo = new CylinderGeometry(rad, rad, WIDTH, 16, 1, true);
  const mat = new MeshLambertMaterial({ map: bandTexture(), side: DoubleSide, emissive: 0x2a2000 });
  const mesh = new Mesh(geo, mat);
  // In the body's space, then into the bone's (its rest pose has no rotation: just take off where it sits).
  const body = new Matrix4().compose(at, new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis), new Vector3(1, 1, 1));
  mesh.matrix.makeTranslation(-sh.x, -sh.y, -sh.z).multiply(body);
  mesh.matrixAutoUpdate = false;
  mesh.name = "armband";
  mesh.castShadow = false;
  return mesh;
}
