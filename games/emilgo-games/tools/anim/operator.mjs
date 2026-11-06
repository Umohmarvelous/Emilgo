// The operators' bodies and moves (v4 rework R2/R3), baked offline from the
// CC0 Quaternius Universal Animation Library (1 and 2): its male and female
// mannequins (good shoulders, a real physique, three-joint fingers) and its
// mocap-style clips, onto the game's own skeleton (src/world/human/skeleton.ts),
// so every procedural move, emote, fall and grip in the game plays on the new
// bodies unchanged and the clips play on every body (the scans too).
//
//   node tools/anim/operator.mjs            (needs tools/anim/in/: ual1.glb, ual2.glb, mannequin_f.glb)
//
// Out (src/world/human/op/):
//   op-m.bin, op-f.bin   the body at four detail levels, in the game's rest pose
//                        (standing, arms hanging, palms in), skinned to the game's
//                        bones, with a region per vertex (suit, seam, glove, boot,
//                        head, pad, belt, pocket, band) and the rest joints
//   op-clips.bin         the clips: per frame, every body bone's local rotation
//                        (int16 quaternions) and the hips' offset, plus each loop's
//                        stride and the phase its left heel lands at
//
// Retargeting: both rigs are posed into the game's rest pose first (the arms
// brought down from the T-pose). A bone's world rotation now, times the inverse
// of its world rotation in that rest pose, is the rotation the game's bone (which
// has no rest rotation) takes in the world; its local rotation follows from its
// parent's. Same proportions as the body, so nothing slides.

import { NodeIO } from "@gltf-transform/core";
import { MeshoptSimplifier } from "meshoptimizer";
import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const IN = join(here, "in");
const OUT = join(here, "../../src/world/human/op");
mkdirSync(OUT, { recursive: true });

// ── The game's skeleton (kept in step with skeleton.ts BONES) ────────────────
const BONES = [
  "root", "hips", "spine", "chest", "neck", "head", "clavL", "clavR", "upperArmL", "upperArmR", "foreArmL", "foreArmR",
  "handL", "handR", "thighL", "thighR", "shinL", "shinR", "footL", "footR",
  "thumb1L", "thumb2L", "index1L", "index2L", "middle1L", "middle2L", "ring1L", "ring2L", "pinky1L", "pinky2L",
  "thumb1R", "thumb2R", "index1R", "index2R", "middle1R", "middle2R", "ring1R", "ring2R", "pinky1R", "pinky2R",
  "jaw", "eyeL", "eyeR", "lidL", "lidR",
  "thumb3L", "index3L", "middle3L", "ring3L", "pinky3L", "thumb3R", "index3R", "middle3R", "ring3R", "pinky3R", "toeL", "toeR",
];
const PARENT = {
  root: null, hips: "root", spine: "hips", chest: "spine", neck: "chest", head: "neck", clavL: "chest", clavR: "chest",
  upperArmL: "clavL", upperArmR: "clavR", foreArmL: "upperArmL", foreArmR: "upperArmR", handL: "foreArmL", handR: "foreArmR",
  thighL: "hips", thighR: "hips", shinL: "thighL", shinR: "thighR", footL: "shinL", footR: "shinR",
  jaw: "head", eyeL: "head", eyeR: "head", lidL: "head", lidR: "head", toeL: "footL", toeR: "footR",
};
for (const s of ["L", "R"]) {
  for (const f of ["thumb", "index", "middle", "ring", "pinky"]) {
    PARENT[`${f}1${s}`] = `hand${s}`;
    PARENT[`${f}2${s}`] = `${f}1${s}`;
    PARENT[`${f}3${s}`] = `${f}2${s}`;
  }
}
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

// ── The two source rigs' names → the game's ──────────────────────────────────
function mapFor(kind) {
  const m = {};
  const F = ["thumb", "index", "middle", "ring", "pinky"];
  if (kind === "def") {
    Object.assign(m, { hips: "DEF-hips", spineA: "DEF-spine.001", spineB: "DEF-spine.002", chest: "DEF-spine.003", neck: "DEF-neck", head: "DEF-head" });
    for (const [s, S] of [["L", "L"], ["R", "R"]]) {
      Object.assign(m, {
        [`clav${s}`]: `DEF-shoulder.${S}`, [`upperArm${s}`]: `DEF-upper_arm.${S}`, [`foreArm${s}`]: `DEF-forearm.${S}`, [`hand${s}`]: `DEF-hand.${S}`,
        [`thigh${s}`]: `DEF-thigh.${S}`, [`shin${s}`]: `DEF-shin.${S}`, [`foot${s}`]: `DEF-foot.${S}`, [`toe${s}`]: `DEF-toe.${S}`,
      });
      for (const f of F) for (const k of [1, 2, 3]) m[`${f}${k}${s}`] = f === "thumb" ? `DEF-thumb.0${k}.${S}` : `DEF-f_${f}.0${k}.${S}`;
    }
  } else {
    Object.assign(m, { hips: "pelvis", spineA: "spine_01", spineB: "spine_02", chest: "spine_03", neck: "neck_01", head: "Head" });
    for (const [s, S] of [["L", "l"], ["R", "r"]]) {
      Object.assign(m, {
        [`clav${s}`]: `clavicle_${S}`, [`upperArm${s}`]: `upperarm_${S}`, [`foreArm${s}`]: `lowerarm_${S}`, [`hand${s}`]: `hand_${S}`,
        [`thigh${s}`]: `thigh_${S}`, [`shin${s}`]: `calf_${S}`, [`foot${s}`]: `foot_${S}`, [`toe${s}`]: `ball_${S}`,
      });
      for (const f of F) for (const k of [1, 2, 3]) m[`${f}${k}${s}`] = `${f}_0${k}_${S}`;
    }
  }
  return m;
}

// ── A rig: joints, bind locals, forward kinematics ────────────────────────────
function rigOf(doc) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const index = new Map(joints.map((j, i) => [j, i]));
  const names = joints.map((j) => j.getName());
  const kind = names.some((n) => n.startsWith("DEF-")) ? "def" : "ue";
  const parent = joints.map((j) => index.get(j.getParentNode()) ?? -1);
  // The joints' common base (Rig / Armature node and up).
  const top = joints.find((_, i) => parent[i] < 0).getParentNode();
  const base = new Matrix4().fromArray(top ? top.getWorldMatrix() : new Matrix4().toArray());
  const bindT = joints.map((j) => new Vector3(...j.getTranslation()));
  const bindR = joints.map((j) => new Quaternion(...j.getRotation()));
  const ibmArr = skin.getInverseBindMatrices().getArray();
  const ibm = joints.map((_, i) => new Matrix4().fromArray(ibmArr, i * 16));
  const order = [];
  const seen = new Set();
  const visit = (i) => {
    if (seen.has(i)) return;
    if (parent[i] >= 0) visit(parent[i]);
    seen.add(i);
    order.push(i);
  };
  joints.forEach((_, i) => visit(i));
  const byName = new Map(names.map((n, i) => [n, i]));
  return { doc, joints, names, kind, parent, base, bindT, bindR, ibm, order, byName, map: mapFor(kind) };
}

const _bq = new Quaternion();
/** World matrices, rotations and positions from local rotations (and translations). */
function fk(rig, locR, locT) {
  const n = rig.joints.length;
  const M = Array.from({ length: n }, () => new Matrix4());
  const Q = Array.from({ length: n }, () => new Quaternion());
  const P = Array.from({ length: n }, () => new Vector3());
  _bq.setFromRotationMatrix(new Matrix4().extractRotation(rig.base));
  for (const i of rig.order) {
    const l = new Matrix4().compose(locT[i], locR[i], new Vector3(1, 1, 1));
    const p = rig.parent[i];
    if (p >= 0) {
      M[i].multiplyMatrices(M[p], l);
      Q[i].multiplyQuaternions(Q[p], locR[i]);
    } else {
      M[i].multiplyMatrices(rig.base, l);
      Q[i].multiplyQuaternions(_bq, locR[i]);
    }
    P[i].setFromMatrixPosition(M[i]);
  }
  return { M, Q, P };
}

const J = (rig, name) => {
  const i = rig.byName.get(name);
  if (i === undefined) throw new Error(`no joint ${name}`);
  return i;
};
/** The first child joint of `i` (where its bone points). */
function childOf(rig, i, prefer) {
  const kids = rig.parent.map((p, k) => (p === i ? k : -1)).filter((k) => k >= 0);
  if (prefer) {
    const k = kids.find((c) => rig.names[c].includes(prefer));
    if (k !== undefined) return k;
  }
  return kids[0];
}

/**
 * The rig in the game's rest pose: the arms hanging a little out from the
 * body, straight, palms in; the legs straight down. Returns its local rotations.
 */
function restPose(rig) {
  const locR = rig.bindR.map((q) => q.clone());
  const locT = rig.bindT.map((t) => t.clone());
  const m = rig.map;
  const align = (jn, toward, dir) => {
    const i = J(rig, jn);
    const c = J(rig, toward);
    const w = fk(rig, locR, locT);
    const cur = w.P[c].clone().sub(w.P[i]).normalize();
    const d = new Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
    const nw = d.multiply(w.Q[i]);
    const p = rig.parent[i];
    const pq = p >= 0 ? w.Q[p].clone() : _bq.clone();
    locR[i].copy(pq.invert().multiply(nw));
  };
  for (const s of [1, -1]) {
    const L = s > 0 ? "L" : "R";
    const a = 0.13;
    const arm = new Vector3(s * Math.sin(a), -Math.cos(a), 0);
    align(m[`upperArm${L}`], m[`foreArm${L}`], arm);
    const fore = new Vector3(s * Math.sin(a * 0.55), -Math.cos(a * 0.55), 0.035);
    align(m[`foreArm${L}`], m[`hand${L}`], fore);
    align(m[`hand${L}`], m[`middle1${L}`], fore);
    align(m[`thigh${L}`], m[`shin${L}`], new Vector3(s * 0.012, -1, 0));
    align(m[`shin${L}`], m[`foot${L}`], new Vector3(0, -1, -0.01));
  }
  return { locR, locT };
}

// ── Clips ──────────────────────────────────────────────────────────────────────
function sampler(ch) {
  const s = ch.getSampler();
  return { t: s.getInput().getArray(), v: s.getOutput().getArray(), interp: s.getInterpolation(), path: ch.getTargetPath(), node: ch.getTargetNode() };
}
function sampleAt(sm, time, out) {
  const t = sm.t;
  const n = t.length;
  const w = sm.path === "rotation" ? 4 : 3;
  const cub = sm.interp === "CUBICSPLINE";
  const at = (k, o) => {
    const base = cub ? (k * 3 + 1) * w : k * w;
    for (let c = 0; c < w; c++) o[c] = sm.v[base + c];
  };
  if (time <= t[0]) return at(0, out), out;
  if (time >= t[n - 1]) return at(n - 1, out), out;
  let k = 0;
  while (k < n - 2 && t[k + 1] < time) k++;
  const u = (time - t[k]) / (t[k + 1] - t[k]);
  const a = new Array(w);
  const b = new Array(w);
  at(k, a);
  at(k + 1, b);
  if (sm.interp === "STEP") return at(k, out), out;
  if (w === 4) {
    const qa = new Quaternion(...a);
    const qb = new Quaternion(...b);
    qa.slerp(qb, u);
    out[0] = qa.x;
    out[1] = qa.y;
    out[2] = qa.z;
    out[3] = qa.w;
  } else for (let c = 0; c < 3; c++) out[c] = a[c] + (b[c] - a[c]) * u;
  return out;
}

const SPINE_MIX = 0.5;

/** The game bones' local rotations and the hips' offset for a rig posed by (locR, locT). */
function retargetFrame(rig, rest, locR, locT, scale) {
  const w = fk(rig, locR, locT);
  const m = rig.map;
  const D = (key) => {
    const i = J(rig, m[key]);
    return w.Q[i].clone().multiply(rest.Q[i].clone().invert());
  };
  const G = {};
  G.root = new Quaternion();
  G.hips = D("hips");
  G.spine = D("spineA").slerp(D("spineB"), SPINE_MIX);
  for (const b of BONES) {
    if (b === "root" || b === "hips" || b === "spine" || G[b]) continue;
    if (m[b]) G[b] = D(b);
  }
  const out = new Float32Array(BONES.length * 4);
  for (let k = 0; k < BONES.length; k++) {
    const b = BONES[k];
    let q;
    if (!G[b] || b === "root") q = new Quaternion();
    else {
      const p = PARENT[b];
      q = (G[p] ?? new Quaternion()).clone().invert().multiply(G[b]);
    }
    q.normalize();
    out[k * 4] = q.x;
    out[k * 4 + 1] = q.y;
    out[k * 4 + 2] = q.z;
    out[k * 4 + 3] = q.w;
  }
  const hi = J(rig, m.hips);
  const off = w.P[hi].clone().sub(rest.P[hi]).multiplyScalar(scale);
  return { q: out, hips: off, P: w.P };
}

function clipFrames(rig, rest, anim, fps, scale) {
  const sms = anim.listChannels().map(sampler).filter((s) => rig.joints.includes(s.node));
  let dur = 0;
  for (const s of sms) dur = Math.max(dur, s.t[s.t.length - 1]);
  const n = Math.max(1, Math.round(dur * fps) + 1);
  const frames = [];
  const tmp = [0, 0, 0, 0];
  for (let f = 0; f < n; f++) {
    const time = Math.min(dur, f / fps);
    const locR = rig.bindR.map((q) => q.clone());
    const locT = rig.bindT.map((t) => t.clone());
    for (const s of sms) {
      const i = rig.joints.indexOf(s.node);
      sampleAt(s, time, tmp);
      if (s.path === "rotation") locR[i].set(tmp[0], tmp[1], tmp[2], tmp[3]).normalize();
      else if (s.path === "translation") locT[i].set(tmp[0], tmp[1], tmp[2]);
    }
    frames.push(retargetFrame(rig, rest, locR, locT, scale));
  }
  return { dur, frames };
}

// ── Bodies ──────────────────────────────────────────────────────────────────────
const R = { suit: 0, seam: 1, glove: 2, boot: 3, head: 4, pad: 5, belt: 6, pocket: 7, band: 8, eye: 9, knuckle: 10, sole: 11 };

function bodyOf(rig, rest, scale, opts) {
  const root = rig.doc.getRoot();
  const m = rig.map;
  // Source joint → [game bone, weight share] (spine_02 split between spine and chest).
  const share = rig.names.map(() => []);
  const set = (src, b, w = 1) => {
    const i = rig.byName.get(src);
    if (i !== undefined) share[i].push([BI[b], w]);
  };
  for (const [b, src] of Object.entries(m)) {
    if (b === "spineA") set(src, "spine");
    else if (b === "spineB") {
      set(src, "spine", 0.55);
      set(src, "chest", 0.45);
    } else set(src, b);
  }
  // Unmapped joints (leaves, the root, twist helpers) take their nearest mapped ancestor's bone.
  for (let i = 0; i < rig.names.length; i++) {
    if (share[i].length) continue;
    let p = rig.parent[i];
    while (p >= 0 && !share[p].length) p = rig.parent[p];
    share[i] = p >= 0 ? share[p] : [[BI.hips, 1]];
  }
  // Skin matrices: bind → rest pose.
  const skinM = rig.joints.map((_, i) => new Matrix4().multiplyMatrices(rest.M[i], rig.ibm[i]));
  const pos = [];
  const nor = [];
  const reg = [];
  const ji = [];
  const jw = [];
  const idx = [];
  const domSrc = [];
  const v = new Vector3();
  const n = new Vector3();
  const tmpM = new Matrix4();
  const nm3 = new Matrix3();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const seam = (prim.getMaterial()?.getName() ?? "").includes("Joint");
      const P = prim.getAttribute("POSITION");
      const N = prim.getAttribute("NORMAL");
      const JS = prim.getAttribute("JOINTS_0");
      const WS = prim.getAttribute("WEIGHTS_0");
      const I = prim.getIndices();
      const base = pos.length / 3;
      const pj = [0, 0, 0, 0];
      const pw = [0, 0, 0, 0];
      const pv = [0, 0, 0];
      for (let k = 0; k < P.getCount(); k++) {
        P.getElement(k, pv);
        JS.getElement(k, pj);
        WS.getElement(k, pw);
        tmpM.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        const acc = new Map();
        let best = -1;
        let bw = -1;
        for (let c = 0; c < 4; c++) {
          const w = pw[c];
          if (w <= 0) continue;
          const e = skinM[pj[c]].elements;
          for (let q = 0; q < 16; q++) tmpM.elements[q] += e[q] * w;
          for (const [b, s] of share[pj[c]]) acc.set(b, (acc.get(b) ?? 0) + w * s);
          if (w > bw) {
            bw = w;
            best = pj[c];
          }
        }
        v.set(pv[0], pv[1], pv[2]).applyMatrix4(tmpM).multiplyScalar(scale);
        N.getElement(k, pv);
        n.set(pv[0], pv[1], pv[2]).applyMatrix3(nm3.getNormalMatrix(tmpM)).normalize();
        pos.push(v.x, v.y, v.z);
        nor.push(n.x, n.y, n.z);
        const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const tot = top.reduce((s, x) => s + x[1], 0) || 1;
        for (let c = 0; c < 4; c++) {
          ji.push(top[c] ? top[c][0] : 0);
          jw.push(top[c] ? top[c][1] / tot : 0);
        }
        domSrc.push(best);
        reg.push(seam ? R.seam : R.suit);
      }
      const ia = I.getArray();
      for (let k = 0; k < ia.length; k++) idx.push(base + ia[k]);
    }
  }
  // Weld: the mannequins' UV seams split vertices, which the simplifier treats as
  // borders it must keep. Same place (0.05 mm), same vertex; normals averaged.
  {
    const key = new Map();
    const remap = new Uint32Array(pos.length / 3);
    const np = [], nn = [], nr = [], nji = [], njw = [], nd = [];
    for (let k = 0; k < pos.length / 3; k++) {
      const q = `${Math.round(pos[k * 3] * 2e4)},${Math.round(pos[k * 3 + 1] * 2e4)},${Math.round(pos[k * 3 + 2] * 2e4)}`;
      let to = key.get(q);
      if (to === undefined) {
        to = np.length / 3;
        key.set(q, to);
        np.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        nn.push(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]);
        nr.push(reg[k]);
        for (let c = 0; c < 4; c++) nji.push(ji[k * 4 + c]), njw.push(jw[k * 4 + c]);
        nd.push(domSrc[k]);
      } else for (let c = 0; c < 3; c++) nn[to * 3 + c] += nor[k * 3 + c];
      remap[k] = to;
    }
    for (let k = 0; k < nn.length; k += 3) {
      const l = Math.hypot(nn[k], nn[k + 1], nn[k + 2]) || 1;
      nn[k] /= l; nn[k + 1] /= l; nn[k + 2] /= l;
    }
    const ni = [];
    for (let k = 0; k < idx.length; k += 3) {
      const a = remap[idx[k]], b = remap[idx[k + 1]], c = remap[idx[k + 2]];
      if (a !== b && b !== c && a !== c) ni.push(a, b, c);
    }
    pos.length = 0; pos.push(...np);
    nor.length = 0; nor.push(...nn);
    reg.length = 0; reg.push(...nr);
    ji.length = 0; ji.push(...nji);
    jw.length = 0; jw.push(...njw);
    domSrc.length = 0; domSrc.push(...nd);
    idx.length = 0; idx.push(...ni);
  }
  // The game's rest joints (scaled).
  const rj = {};
  const P = (name) => rest.P[J(rig, name)].clone().multiplyScalar(scale);
  rj.root = new Vector3(0, 0, 0);
  for (const [b, src] of Object.entries(m)) if (b !== "spineA" && b !== "spineB") rj[b] = P(src);
  rj.spine = P(m.spineA);
  // Face: the eyes on the front of the head at eye height, the jaw under them.
  const hd = rj.head;
  const top = Math.max(...pos.filter((_, k) => k % 3 === 1));
  const eyeY = hd.y + (top - hd.y) * 0.42;
  let front = -1e9;
  for (let k = 0; k < pos.length; k += 3) {
    if (Math.abs(pos[k + 1] - eyeY) < 0.012 && Math.abs(Math.abs(pos[k]) - 0.032 * scale) < 0.01 && pos[k + 2] > front) front = pos[k + 2];
  }
  const eyeR = 0.0118 * scale;
  void front;
  rj.jaw = new Vector3(0, eyeY - 0.07 * scale, hd.z + 0.02);
  // Regions from the dominant source joint and where the vertex is.
  const isAny = (i, keys) => keys.some((k) => m[k] && rig.byName.get(m[k]) === i);
  const descends = (i, key) => {
    const t = rig.byName.get(m[key]);
    for (let p = i; p >= 0; p = rig.parent[p]) if (p === t) return true;
    return false;
  };
  const ankleL = rj.footL.y;
  const wrist = { L: rj.handL, R: rj.handR };
  const kneeL = rj.shinL;
  const kneeR = rj.shinR;
  const elbowL = rj.foreArmL;
  const elbowR = rj.foreArmR;
  const waist = (rj.hips.y + rj.spine.y) / 2 + 0.035 * scale;
  const dist = (k, c) => Math.hypot(pos[k * 3] - c.x, pos[k * 3 + 1] - c.y, pos[k * 3 + 2] - c.z);
  const N = pos.length / 3;
  const push = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const d = domSrc[k];
    const x = pos[k * 3];
    const y = pos[k * 3 + 1];
    const z = pos[k * 3 + 2];
    const nz = nor[k * 3 + 2];
    const side = x >= 0 ? "L" : "R";
    let r = reg[k];
    if (descends(d, "handL") || descends(d, "handR") || dist(k, wrist[side]) < 0.055 * scale) {
      r = R.glove;
      // A gauntlet cuff over the end of the sleeve.
      const dw = dist(k, wrist[side]);
      push[k] = !descends(d, `hand${side}`) && dw > 0.025 * scale ? 0.0075 : 0.003;
      // Knuckle pads over the back of the fingers' first joints.
      const knk = rj[`index1${side}`];
      if (Math.abs(y - knk.y) < 0.03 && Math.abs(z - knk.z) < 0.045 && Math.sign(x) * nor[k * 3] > 0.35) r = R.knuckle;
    } else if (descends(d, "footL") || descends(d, "footR") || (y < ankleL + 0.19 * scale && (isAny(d, ["shinL", "shinR"]) || descends(d, "shinL") || descends(d, "shinR")))) {
      // Combat boots: a mid-calf shaft, the trousers bloused over its top, a rubber sole with a lip.
      const shaft = y > ankleL - 0.01 * scale;
      r = y < 0.032 * scale ? R.sole : R.boot;
      push[k] = y < 0.032 * scale ? 0.012 : shaft ? (y > ankleL + 0.15 * scale ? 0.016 : 0.011) : 0.007;
      if (shaft && y > ankleL + 0.15 * scale) r = R.suit;
    } else if (isAny(d, ["head", "neck"]) || descends(d, "head")) {
      r = R.head;
      push[k] = 0.002;
    } else if (r === R.suit) {
      // Knee and elbow pads (sewn in), the belt, thigh pockets, an armband on the left arm.
      const knee = x >= 0 ? kneeL : kneeR;
      const elb = x >= 0 ? elbowL : elbowR;
      if (Math.abs(y - knee.y - 0.015) < 0.045 * scale && nz > 0.45 && Math.abs(x - knee.x) < 0.05) {
        r = R.pad;
        push[k] = 0.011 * Math.min(1, nz * 1.6);
      } else if (Math.hypot(y - elb.y, z - elb.z + 0.03) < 0.04 * scale && nz < -0.3) {
        r = R.pad;
        push[k] = 0.007;
      } else if (Math.abs(y - waist) < 0.025 * scale && descends(d, "hips") && !isAny(d, ["thighL", "thighR"]) && !descends(d, "thighL") && !descends(d, "thighR")) {
        r = R.belt;
        push[k] = 0.007;
      } else if ((isAny(d, ["thighL", "thighR"]) || descends(d, "thighL") || descends(d, "thighR")) && y < rj.thighL.y - 0.12 * scale && y > rj.thighL.y - 0.3 * scale && Math.abs(x) - Math.abs(rj.thighL.x) > 0.04 && Math.abs(nor[k * 3]) > 0.55) {
        r = R.pocket;
        push[k] = 0.01;
      } else if (x > 0 && (isAny(d, ["upperArmL"]) || descends(d, "upperArmL")) && !descends(d, "foreArmL") && Math.abs(y - (rj.upperArmL.y - 0.11 * scale)) < 0.025 * scale) {
        r = R.band;
        push[k] = 0.004;
      }
    }
    reg[k] = r;
  }
  // Boots, not shoes: the mannequin's narrow pointed foot made wider and blunter, a taller toe box.
  for (let k = 0; k < N; k++) {
    if ((reg[k] !== R.boot && reg[k] !== R.sole) || !(descends(domSrc[k], "footL") || descends(domSrc[k], "footR"))) continue;
    const L = pos[k * 3] >= 0 ? "L" : "R";
    const f = rj[`foot${L}`];
    const fwd = pos[k * 3 + 2] - f.z;
    pos[k * 3] = f.x + (pos[k * 3] - f.x) * 1.16;
    if (fwd > 0.06 * scale) {
      // Blunt the point: pull the tip back a little, lift the top of the toe box.
      pos[k * 3 + 2] -= (fwd - 0.06 * scale) * 0.12;
      if (pos[k * 3 + 1] > 0.035 * scale) pos[k * 3 + 1] += 0.007 * scale * Math.min(1, (fwd - 0.06 * scale) / 0.05);
    }
  }
  // A rounder head under the knit (the male mannequin's skull is tall).
  if (rj.head.y > 1.5) {
    for (let k = 0; k < N; k++) {
      if (reg[k] !== R.head) continue;
      const dy = pos[k * 3 + 1] - rj.head.y;
      if (dy > 0.06) pos[k * 3 + 1] = rj.head.y + 0.06 + (dy - 0.06) * 0.9;
    }
  }
  // Clothes, not a mannequin: smooth the suit's muscles away (Taubin, so it
  // doesn't shrink) and give it a fabric's thickness (more round the chest and
  // back: a shirt over it); the neck gets a collar.
  {
    const clothed = (r) => r === R.suit || r === R.seam || r === R.pad || r === R.pocket || r === R.belt || r === R.band;
    const nbr = Array.from({ length: N }, () => new Set());
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k], b = idx[k + 1], c = idx[k + 2];
      nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
    }
    const step = (lam) => {
      const np = Float32Array.from(pos);
      for (let k = 0; k < N; k++) {
        if (!clothed(reg[k]) || !nbr[k].size) continue;
        let sx = 0, sy = 0, sz = 0;
        for (const j of nbr[k]) { sx += pos[j * 3]; sy += pos[j * 3 + 1]; sz += pos[j * 3 + 2]; }
        const m = nbr[k].size;
        np[k * 3] += (sx / m - pos[k * 3]) * lam;
        np[k * 3 + 1] += (sy / m - pos[k * 3 + 1]) * lam;
        np[k * 3 + 2] += (sz / m - pos[k * 3 + 2]) * lam;
      }
      for (let k = 0; k < pos.length; k++) pos[k] = np[k];
    };
    for (let it = 0; it < 8; it++) { step(0.55); step(-0.58); }
    const chestY = rj.chest.y;
    const neckY = rj.neck.y;
    for (let k = 0; k < N; k++) {
      if (!clothed(reg[k])) continue;
      const y = pos[k * 3 + 1] / scale;
      let t = 0.006;
      if (y > rj.hips.y / scale && y < neckY / scale) t += 0.008 * Math.min(1, Math.max(0, (y - rj.hips.y / scale) / 0.25));
      if (Math.abs(y - chestY / scale) < 0.12) t += 0.004;
      push[k] += t;
    }
    // A collar: the base of the neck, puffed out.
    for (let k = 0; k < N; k++) {
      const y = pos[k * 3 + 1];
      if (reg[k] === R.head && y < neckY + 0.035 * scale && y > neckY - 0.04 * scale) { push[k] += 0.009; reg[k] = R.seam; }
    }
  }
  // Puff the gear out a little along its normals (pads, belt, pockets, boots, gloves).
  for (let k = 0; k < N; k++) {
    if (!push[k]) continue;
    for (let c = 0; c < 3; c++) pos[k * 3 + c] += nor[k * 3 + c] * push[k] * scale;
  }
  // The eye slit, set back into the knit; the eyes go in it (after the pushes, on the final surface).
  {
    // The face's front where each eye goes: a ray along −z onto the head's triangles (the male head is low-poly).
    const rayFront = (x, y) => {
      let best = -1e9;
      for (let k = 0; k < idx.length; k += 3) {
        const a = idx[k], b = idx[k + 1], c = idx[k + 2];
        if (reg[a] !== R.head || reg[b] !== R.head || reg[c] !== R.head) continue;
        const ax = pos[a * 3], ay = pos[a * 3 + 1], bx = pos[b * 3], by = pos[b * 3 + 1], cx = pos[c * 3], cy = pos[c * 3 + 1];
        const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(den) < 1e-12) continue;
        const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
        const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
        const w = 1 - u - v;
        if (u < 0 || v < 0 || w < 0) continue;
        const z = u * pos[a * 3 + 2] + v * pos[b * 3 + 2] + w * pos[c * 3 + 2];
        if (z > best) best = z;
      }
      return best;
    };
    const fr = Math.max(rayFront(0.032 * scale, eyeY), rayFront(-0.032 * scale, eyeY));
    for (let k = 0; k < N; k++) {
      if (reg[k] !== R.head) continue;
      const dx = Math.abs(pos[k * 3]);
      const dy = Math.abs(pos[k * 3 + 1] - eyeY);
      if (dx < 0.062 * scale && dy < 0.02 * scale && pos[k * 3 + 2] > fr - 0.035) {
        const e = Math.max(0, 1 - Math.max(dx / (0.062 * scale), dy / (0.02 * scale)));
        pos[k * 3 + 2] -= 0.004 * Math.min(1, e * 3);
      }
    }
    if (process.env.DEBUG_EYES) {
      let zx = -1e9;
      for (let k = 0; k < N; k++) if (Math.abs(pos[k * 3 + 1] - eyeY) < 0.01 && Math.abs(pos[k * 3]) < 0.01) zx = Math.max(zx, pos[k * 3 + 2]);
      const bins = {};
      for (let k = 0; k < N; k++) if (pos[k * 3 + 1] > rj.head.y - 0.02) { const b = Math.round(pos[k * 3 + 1] * 50) / 50; bins[b] = Math.max(bins[b] ?? -9, pos[k * 3 + 2]); }
      console.log("front by height", Object.entries(bins).sort().map(([a, b]) => `${a}:${(+b).toFixed(3)}`).join(" "), "regions", [...new Set(reg.filter((_, k) => pos[k * 3 + 1] > rj.head.y + 0.05))]);
      console.log("eyes: eyeY", eyeY.toFixed(3), "front at 3.2 cm", fr.toFixed(3), "front at the middle", zx.toFixed(3), "head", rj.head.y.toFixed(3), rj.head.z.toFixed(3));
    }
    for (const s2 of [1, -1]) {
      const L = s2 > 0 ? "L" : "R";
      rj[`eye${L}`] = new Vector3(s2 * 0.032 * scale, eyeY, fr - 0.004 - eyeR * 0.5);
      rj[`lid${L}`] = rj[`eye${L}`].clone();
    }
  }
  // Normals again, from the smoothed shape (the old ones still carried the mannequin's muscles).
  {
    const nn = new Float32Array(N * 3);
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const o of [a, b, c]) { nn[o] += fx; nn[o + 1] += fy; nn[o + 2] += fz; }
    }
    for (let k = 0; k < N; k++) {
      const l = Math.hypot(nn[k * 3], nn[k * 3 + 1], nn[k * 3 + 2]) || 1;
      // Keep the old direction's sign (a face wound the other way).
      const dot = nn[k * 3] * nor[k * 3] + nn[k * 3 + 1] * nor[k * 3 + 1] + nn[k * 3 + 2] * nor[k * 3 + 2];
      const sg = dot < 0 ? -1 : 1;
      for (let c = 0; c < 3; c++) nor[k * 3 + c] = (nn[k * 3 + c] / l) * sg;
    }
  }
  // The eyeballs: small spheres on the eye bones (the balaclava's slit shows them).
  for (const s of [1, -1]) {
    const L = s > 0 ? "L" : "R";
    const c = rj[`eye${L}`];
    const base = pos.length / 3;
    const RS = 10;
    const RR = 7;
    for (let a = 0; a <= RR; a++) {
      const th = (a / RR) * Math.PI;
      for (let b = 0; b < RS; b++) {
        const ph = (b / RS) * Math.PI * 2;
        const nx = Math.sin(th) * Math.cos(ph);
        const nzz = Math.cos(th);
        const ny = Math.sin(th) * Math.sin(ph);
        // +Z (forward) is the pole, so the iris sits on it.
        pos.push(c.x + nx * eyeR, c.y + ny * eyeR, c.z + nzz * eyeR);
        nor.push(nx, ny, nzz);
        reg.push(R.eye);
        ji.push(BI[`eye${L}`], 0, 0, 0);
        jw.push(1, 0, 0, 0);
      }
    }
    for (let a = 0; a < RR; a++)
      for (let b = 0; b < RS; b++) {
        const p0 = base + a * RS + b;
        const p1 = base + a * RS + ((b + 1) % RS);
        const p2 = p0 + RS;
        const p3 = p1 + RS;
        idx.push(p0, p2, p1, p1, p2, p3);
      }
  }
  // Fill in any rest joint the rigs lack.
  for (const b of BONES) if (!rj[b]) rj[b] = rj[PARENT[b]].clone();
  // Colour and roughness per vertex (blended across a boundary triangle: no saw-teeth), and the armband's share.
  const PAL = {
    [R.suit]: [0.034, 0.036, 0.041, 0.88], [R.seam]: [0.024, 0.025, 0.028, 0.9], [R.pad]: [0.046, 0.048, 0.052, 0.72],
    [R.belt]: [0.024, 0.024, 0.026, 0.68], [R.pocket]: [0.04, 0.042, 0.047, 0.84], [R.band]: [0.034, 0.036, 0.041, 0.6],
    [R.glove]: [0.03, 0.028, 0.027, 0.5], [R.knuckle]: [0.062, 0.064, 0.067, 0.42], [R.boot]: [0.036, 0.032, 0.029, 0.64],
    [R.sole]: [0.016, 0.016, 0.016, 0.92], [R.head]: [0.022, 0.022, 0.024, 0.95], [R.eye]: [0.1, 0.1, 0.1, 0.15],
  };
  const NV = pos.length / 3;
  const pal = new Uint8Array(NV * 4);
  const acc = new Uint8Array(NV);
  for (let k = 0; k < NV; k++) {
    const c = PAL[reg[k]] ?? PAL[R.suit];
    for (let q = 0; q < 3; q++) pal[k * 4 + q] = Math.round(Math.min(1, c[q] / 0.1) * 255);
    pal[k * 4 + 3] = Math.round(c[3] * 255);
    acc[k] = reg[k] === R.band ? 255 : 0;
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), reg: new Uint8Array(reg), ji: new Uint8Array(ji), jw: new Float32Array(jw), idx: new Uint32Array(idx), rest: rj, pal, acc };
}


/** Detail levels by triangle target (meshopt), the eyes kept on every level but the far one. */
async function levels(body, targets) {
  await MeshoptSimplifier.ready;
  const out = [];
  const tris = body.idx.length / 3;
  for (const target of targets) {
    if (target >= tris) {
      out.push(body.idx);
      continue;
    }
    const [ix] = MeshoptSimplifier.simplify(body.idx, body.pos, 3, target * 3, 0.05, ["LockBorder"]);
    out.push(ix);
  }
  return out;
}

/** Pack: header JSON (rest joints, counts) + positions int16, normals int8, regions, joints, weights, indices per level. */
function packBody(body, lv) {
  // Keep only vertices some level uses (all of them: level 3 is the full mesh).
  const N = body.pos.length / 3;
  let mn = [1e9, 1e9, 1e9];
  let mx = [-1e9, -1e9, -1e9];
  for (let k = 0; k < N; k++)
    for (let c = 0; c < 3; c++) {
      mn[c] = Math.min(mn[c], body.pos[k * 3 + c]);
      mx[c] = Math.max(mx[c], body.pos[k * 3 + c]);
    }
  const P = new Int16Array(N * 3);
  for (let k = 0; k < N; k++) for (let c = 0; c < 3; c++) P[k * 3 + c] = Math.round(((body.pos[k * 3 + c] - mn[c]) / (mx[c] - mn[c])) * 65535 - 32768);
  const Nn = new Int8Array(N * 3);
  for (let k = 0; k < N * 3; k++) Nn[k] = Math.round(Math.max(-1, Math.min(1, body.nor[k])) * 127);
  const W = new Uint8Array(N * 4);
  for (let k = 0; k < N; k++) {
    let s = 0;
    for (let c = 0; c < 4; c++) s += (W[k * 4 + c] = Math.round(body.jw[k * 4 + c] * 255));
    W[k * 4] += 255 - s;
  }
  const lvIdx = lv.map((ix) => (N <= 65535 ? Uint16Array.from(ix) : Uint32Array.from(ix)));
  const rest = Object.fromEntries(Object.entries(body.rest).map(([k, v]) => [k, [+v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5)]]));
  const head = { v: 2, n: N, mn, mx, rest, levels: lvIdx.map((a) => a.length), wide: N > 65535 };
  const parts = [P, Nn, body.reg, body.ji, W, body.pal, body.acc, ...lvIdx];
  return pack(head, parts);
}

function pack(head, parts) {
  const hj = Buffer.from(JSON.stringify(head));
  const pad = (n) => (4 - (n % 4)) % 4;
  let size = 8 + hj.length + pad(hj.length);
  for (const p of parts) size += p.byteLength + pad(p.byteLength);
  const buf = Buffer.alloc(size);
  buf.write("EOP1", 0);
  buf.writeUInt32LE(hj.length, 4);
  hj.copy(buf, 8);
  let o = 8 + hj.length + pad(hj.length);
  for (const p of parts) {
    Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(buf, o);
    o += p.byteLength + pad(p.byteLength);
  }
  return buf;
}

// ── The clips we keep ──────────────────────────────────────────────────────────
const CLIPS = [
  // [file, source name, game name, fps, loop]
  ["ual1", "Idle_Loop", "idle", 15, true],
  ["ual1", "Death01", "death", 24, false],
  ["ual1", "Walk_Loop", "walk", 20, true],
  ["ual1", "Jog_Fwd_Loop", "jog", 24, true],
  ["ual1", "Sprint_Loop", "sprint", 24, true],
  ["ual1", "Crouch_Idle_Loop", "crouch", 12, true],
  ["ual1", "Crouch_Fwd_Loop", "crouchWalk", 20, true],
  ["ual1", "Jump_Start", "jumpStart", 30, false],
  ["ual1", "Jump_Loop", "jumpLoop", 12, true],
  ["ual1", "Jump_Land", "jumpLand", 30, false],
  ["ual1", "Roll", "roll", 30, false],
  ["ual1", "Pistol_Idle_Loop", "pistolIdle", 15, true],
  ["ual1", "Pistol_Aim_Neutral", "pistolAim", 10, false],
  ["ual1", "Pistol_Aim_Up", "pistolAimUp", 10, false],
  ["ual1", "Pistol_Aim_Down", "pistolAimDown", 10, false],
  ["ual1", "Pistol_Shoot", "pistolShoot", 30, false],
  ["ual1", "Pistol_Reload", "pistolReload", 24, false],
  ["ual1", "Idle_Torch_Loop", "torch", 15, true],
  ["ual1", "Hit_Chest", "hitChest", 30, false],
  ["ual1", "Hit_Head", "hitHead", 30, false],
  ["ual1", "Driving_Loop", "drive", 12, true],
  ["ual1", "Punch_Jab", "jab", 30, false],
  ["ual1", "Punch_Cross", "cross", 30, false],
  ["ual1", "Interact", "interact", 20, false],
  ["ual1", "PickUp_Table", "pickup", 24, false],
  ["ual2", "Zombie_Idle_Loop", "zIdle", 15, true],
  ["ual2", "Zombie_Walk_Fwd_Loop", "zWalk", 20, true],
  ["ual2", "Zombie_Scratch", "zScratch", 24, false],
  ["ual2", "Hit_Knockback", "knockback", 30, false],
  ["ual2", "Slide_Loop", "slide", 15, true],
  ["ual2", "OverhandThrow", "throw", 24, false],
  ["ual2", "Melee_Hook", "hook", 30, false],
  ["ual2", "Idle_FoldArms_Loop", "foldArms", 10, true],
];

/** The bones a clip carries: all but the root and the face (the face rig moves those). */
const FACE = new Set(["root", "jaw", "eyeL", "eyeR", "lidL", "lidR"]);
const KEEP = BONES.map((b, i) => (FACE.has(b) ? -1 : i)).filter((i) => i >= 0);

/** A unit quaternion in 32 bits: the largest component's index (2 bits), the other three in 10 bits each over ±1/√2. */
function packQ(a, o) {
  let x = a[o], y = a[o + 1], z = a[o + 2], w = a[o + 3];
  const v = [x, y, z, w];
  let big = 0;
  for (let c = 1; c < 4; c++) if (Math.abs(v[c]) > Math.abs(v[big])) big = c;
  const sgn = v[big] < 0 ? -1 : 1;
  let out = big;
  let sh = 2;
  for (let c = 0; c < 4; c++) {
    if (c === big) continue;
    const u = Math.round(((v[c] * sgn) / Math.SQRT1_2 * 0.5 + 0.5) * 1023);
    out |= Math.max(0, Math.min(1023, u)) << sh;
    sh += 10;
  }
  return out >>> 0;
}

/** A loop's stride (m per cycle) and the phase (0..1) its left heel lands at. */
function gaitOf(rig, frames, dur) {
  const fl = J(rig, rig.map.footL);
  const hi = J(rig, rig.map.hips);
  let best = -1e9;
  let at = 0;
  let mn = 1e9;
  let mx = -1e9;
  frames.forEach((f, k) => {
    const dz = f.P[fl].z - f.P[hi].z;
    if (dz > best) {
      best = dz;
      at = k;
    }
    mn = Math.min(mn, dz);
    mx = Math.max(mx, dz);
  });
  return { phase0: at / Math.max(1, frames.length - 1), stride: 2 * (mx - mn), dur };
}

async function main() {
  const io = new NodeIO();
  const docs = { ual1: await io.read(join(IN, "ual1.glb")), ual2: await io.read(join(IN, "ual2.glb")), f: await io.read(join(IN, "mannequin_f.glb")) };
  const rigs = { ual1: rigOf(docs.ual1), ual2: rigOf(docs.ual2), f: rigOf(docs.f) };
  const rests = {};
  for (const [k, rig] of Object.entries(rigs)) {
    const rp = restPose(rig);
    rests[k] = { ...fk(rig, rp.locR, rp.locT), loc: rp };
  }
  // Heights: the male to 1.80 m, the female to 1.69 m (the scans' heads are near there).
  const tallest = (rig, rest) => {
    let t = 0;
    for (const p of rest.P) t = Math.max(t, p.y);
    return t;
  };
  void tallest;
  const SCALE = { m: 1.8 / 1.83, f: 1.69 / 1.81 };

  // Bodies.
  const targets = [1300, 2600, 5200, 11000];
  for (const [body, rigKey] of [["m", "ual1"], ["f", "f"]]) {
    const b = bodyOf(rigs[rigKey], rests[rigKey], SCALE[body]);
    const lv = await levels(b, targets);
    const buf = packBody(b, lv);
    writeFileSync(join(OUT, `op-${body}.bin`), buf);
    console.log(`op-${body}.bin`, (buf.length / 1024).toFixed(0), "KB;", b.pos.length / 3, "vertices; triangles", lv.map((x) => x.length / 3).join(" / "));
    // Rest joints for the clip scale: hips height.
    if (body === "m") rests.mRest = b.rest;
  }

  // Clips (on the male rest, scaled like the male body; the female plays the same rotations).
  const head = { v: 2, bones: BONES.length, keep: KEEP, clips: [] };
  const parts = [];
  for (const [file, src, name, fps, loop] of CLIPS) {
    const rig = rigs[file];
    const anim = docs[file].getRoot().listAnimations().find((a) => a.getName() === src);
    if (!anim) {
      console.warn("missing clip", src);
      continue;
    }
    const { dur, frames } = clipFrames(rig, rests[file], anim, fps, SCALE.m);
    const q = new Uint32Array(frames.length * KEEP.length);
    const h = new Int16Array(frames.length * 3);
    frames.forEach((f, k) => {
      KEEP.forEach((b, j) => (q[k * KEEP.length + j] = packQ(f.q, b * 4)));
      h[k * 3] = Math.round(f.hips.x * 10000);
      h[k * 3 + 1] = Math.round(f.hips.y * 10000);
      h[k * 3 + 2] = Math.round(f.hips.z * 10000);
    });
    const g = loop ? gaitOf(rig, frames, dur) : { phase0: 0, stride: 0 };
    head.clips.push({ name, fps, n: frames.length, dur: +dur.toFixed(4), loop, phase0: +g.phase0.toFixed(4), stride: +(g.stride * SCALE.m).toFixed(4) });
    parts.push(q, h);
    console.log(name.padEnd(14), frames.length, "frames", dur.toFixed(2), "s", loop ? `stride ${(g.stride * SCALE.m).toFixed(2)} m, heel at ${g.phase0.toFixed(2)}` : "");
  }
  const buf = pack(head, parts);
  writeFileSync(join(OUT, "op-clips.bin"), buf);
  console.log("op-clips.bin", (buf.length / 1024).toFixed(0), "KB");
}

await main();
