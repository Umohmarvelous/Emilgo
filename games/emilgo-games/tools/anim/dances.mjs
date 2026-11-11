// International dances (v6 max, 3.9; the owner: "add more international dance
// steps with the exact dance step"): real motion capture from the CMU Graphics
// Lab Motion Capture Database (mocap.cs.cmu.edu: "free for all uses … you may
// include this data in commercially-sold products, but you may not resell this
// data directly"; created with funding from NSF EIA-0196217), baked onto the
// game's skeleton the way tools/anim/operator.mjs bakes the UAL clips.
//
//   node tools/anim/dances.mjs      (needs tools/anim/in/cmu/: the .asf and .amc files below;
//                                    curl http://mocap.cs.cmu.edu/subjects/<s>/<s>.asf and <s>_<n>.amc)
//
// Out: src/world/human/op/op-dances.bin, the same format as op-clips.bin (op.ts reads both).
//
// How: an ASF/AMC take gives each bone's rotation relative to the skeleton's
// default pose (C·R·C⁻¹ down the chain). The default pose is brought to the
// game's rest pose (arms hanging a little out, legs straight), so a bone's world
// rotation now times the inverse of its rest rotation is the rotation the
// game's bone takes in the world; its local rotation follows from its parent's.
// The dancer is turned to face +z on average and kept on the spot (the hips
// still sway and drop); a loop is found where the end matches the start and
// cross-faded so it plays without a seam.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Euler, Quaternion, Vector3 } from "three";

const here = dirname(fileURLToPath(import.meta.url));
const IN = join(here, "in/cmu");
const OUT = join(here, "../../src/world/human/op/op-dances.bin");

// The game's skeleton (kept in step with skeleton.ts BONES and operator.mjs).
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
for (const s of ["L", "R"]) for (const f of ["thumb", "index", "middle", "ring", "pinky"]) {
  PARENT[`${f}1${s}`] = `hand${s}`;
  PARENT[`${f}2${s}`] = `${f}1${s}`;
  PARENT[`${f}3${s}`] = `${f}2${s}`;
}
const FACE = new Set(["root", "jaw", "eyeL", "eyeR", "lidL", "lidR"]);
const KEEP = BONES.map((b, i) => (FACE.has(b) ? -1 : i)).filter((i) => i >= 0);

/** The game's bones → the CMU skeleton's (each a rotation at the bone's start). */
const MAP = {
  hips: "root", chest: "thorax", neck: "lowerneck", head: "head",
  clavL: "lclavicle", upperArmL: "lhumerus", foreArmL: "lradius", handL: "lwrist",
  clavR: "rclavicle", upperArmR: "rhumerus", foreArmR: "rradius", handR: "rwrist",
  thighL: "lfemur", shinL: "ltibia", footL: "lfoot", toeL: "ltoes",
  thighR: "rfemur", shinR: "rtibia", footR: "rfoot", toeR: "rtoes",
};

/** The game male's hips above its ankles (op-m.bin rest: hips 0.902, ankles 0.101). */
const GAME_HIP_TO_ANKLE = 0.801;

// ── The dances we keep ─────────────────────────────────────────────────────────
// [take, game name, the take's frame rate, seconds used (from, to), loop length (min, max), loop]
// A loop is searched for in the window; a one-off (loop false) plays the whole window once.
const DANCES = [
  ["93_08", "charleston", 120, [1, 30], [2.2, 4.5], true],
  ["141_12", "twist", 120, [0.5, 30], [1.6, 3.6], true],
  ["60_01", "salsa", 60, [2, 40], [2.4, 4.8], true],
  ["55_02", "lambada", 120, [2, 60], [2.4, 4.8], true],
  // The squat kicks (the take stands for its first 4.5 s).
  ["90_30", "kazachok", 120, [5.0, 9.4], [1.4, 3.6], true],
  ["90_28", "breaking", 120, [0.3, 4.3], [0, 0], false],
  ["05_06", "ballet", 120, [2.0, 7.2], [0, 0], false],
];
const FPS = 30;

// ── ASF / AMC ──────────────────────────────────────────────────────────────────
const D2R = Math.PI / 180;
/** "X first, then Y, then Z about the fixed axes" (ASF's XYZ): three's ZYX order. */
const rotXYZ = (x, y, z) => new Quaternion().setFromEuler(new Euler(x * D2R, y * D2R, z * D2R, "ZYX"));

function readAsf(file) {
  const t = readFileSync(file, "utf8");
  const bones = new Map();
  const root = { name: "root", dir: new Vector3(), len: 0, C: new Quaternion(), dof: ["tx", "ty", "tz", "rx", "ry", "rz"], children: [], parent: null };
  bones.set("root", root);
  const data = t.slice(t.indexOf(":bonedata"), t.indexOf(":hierarchy"));
  for (const block of data.split("begin").slice(1)) {
    const g = (k) => new RegExp(`^\\s*${k}\\s+(.*)$`, "m").exec(block)?.[1].trim();
    const name = g("name");
    const dir = new Vector3(...g("direction").split(/\s+/).map(Number));
    const len = Number(g("length"));
    const ax = g("axis").split(/\s+/);
    const C = rotXYZ(Number(ax[0]), Number(ax[1]), Number(ax[2]));
    const dof = (g("dof") ?? "").split(/\s+/).filter(Boolean);
    bones.set(name, { name, dir, len, C, dof, children: [], parent: null });
  }
  const hier = t.slice(t.indexOf(":hierarchy"));
  for (const line of hier.split("\n")) {
    const w = line.trim().split(/\s+/);
    if (w.length < 2 || w[0] === "begin" || w[0] === ":hierarchy") continue;
    const p = bones.get(w[0]);
    if (!p) continue;
    for (const c of w.slice(1)) {
      const b = bones.get(c);
      if (!b) continue;
      b.parent = p;
      p.children.push(b);
    }
  }
  const order = [];
  const visit = (b) => {
    order.push(b);
    for (const c of b.children) visit(c);
  };
  visit(root);
  return { bones, order };
}

function readAmc(file) {
  const frames = [];
  let cur = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#") || s.startsWith(":")) continue;
    if (/^\d+$/.test(s)) {
      cur = new Map();
      frames.push(cur);
      continue;
    }
    if (!cur) continue;
    const w = s.split(/\s+/);
    cur.set(w[0], w.slice(1).map(Number));
  }
  return frames;
}

/** One frame's world rotations (relative to the default pose) and joint positions (each bone's start). */
function pose(skel, frame) {
  const W = new Map();
  const start = new Map();
  const end = new Map();
  for (const b of skel.order) {
    const v = frame.get(b.name) ?? [];
    if (b.name === "root") {
      const [tx, ty, tz, rx, ry, rz] = v;
      W.set("root", rotXYZ(rx, ry, rz));
      const p = new Vector3(tx, ty, tz);
      start.set("root", p);
      end.set("root", p.clone());
      continue;
    }
    const r = { rx: 0, ry: 0, rz: 0 };
    b.dof.forEach((d, i) => (r[d] = v[i] ?? 0));
    const R = rotXYZ(r.rx, r.ry, r.rz);
    const w = W.get(b.parent.name).clone().multiply(b.C).multiply(R).multiply(b.C.clone().invert());
    W.set(b.name, w);
    const s = end.get(b.parent.name).clone();
    start.set(b.name, s);
    end.set(b.name, s.clone().add(b.dir.clone().applyQuaternion(w).multiplyScalar(b.len)));
  }
  return { W, start, end };
}

/**
 * The default pose brought to the game's rest pose: each bone's world rotation (relative to the default pose)
 * with the arms hanging a little out from the body, straight, palms in; the legs straight down.
 */
function restAlign(skel) {
  const A = new Map();
  const target = new Map();
  const a = 0.13;
  for (const s of [1, -1]) {
    const L = s > 0 ? "l" : "r";
    const arm = new Vector3(s * Math.sin(a), -Math.cos(a), 0).normalize();
    const fore = new Vector3(s * Math.sin(a * 0.55), -Math.cos(a * 0.55), 0.035).normalize();
    target.set(`${L}humerus`, arm);
    target.set(`${L}radius`, fore);
    target.set(`${L}wrist`, fore);
    target.set(`${L}hand`, fore);
    target.set(`${L}femur`, new Vector3(s * 0.012, -1, 0).normalize());
    target.set(`${L}tibia`, new Vector3(0, -1, -0.01).normalize());
  }
  for (const b of skel.order) {
    const w = b.parent ? A.get(b.parent.name).clone() : new Quaternion();
    const t = target.get(b.name);
    if (t && b.dir.lengthSq() > 0) {
      const cur = b.dir.clone().applyQuaternion(w).normalize();
      w.premultiply(new Quaternion().setFromUnitVectors(cur, t));
    }
    A.set(b.name, w);
  }
  // Where the hips stand above the floor in that pose (the lowest point: the toes' tips).
  let minY = 0;
  const end = new Map([["root", new Vector3()]]);
  for (const b of skel.order) {
    if (b.name === "root") continue;
    const e = end.get(b.parent.name).clone().add(b.dir.clone().applyQuaternion(A.get(b.name)).multiplyScalar(b.len));
    end.set(b.name, e);
    minY = Math.min(minY, e.y);
  }
  const ankle = end.get("ltibia");
  return { A, hipY: -minY, hipToAnkle: -ankle.y };
}

/** A frame on the game's skeleton: local rotations (BONES × 4) and the hips' offset (game metres). */
function retarget(skel, rest, P, yaw, centre, scale) {
  const Yinv = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -yaw);
  const D = (cmu) => Yinv.clone().multiply(P.W.get(cmu)).multiply(rest.A.get(cmu).clone().invert());
  const G = { root: new Quaternion() };
  for (const [g, c] of Object.entries(MAP)) G[g] = D(c);
  G.spine = D("lowerback").slerp(D("upperback"), 0.5);
  const q = new Float32Array(BONES.length * 4);
  BONES.forEach((b, k) => {
    let r = new Quaternion();
    if (G[b] && b !== "root") r = (G[PARENT[b]] ?? new Quaternion()).clone().invert().multiply(G[b]);
    r.normalize();
    q.set([r.x, r.y, r.z, r.w], k * 4);
  });
  const p = P.start.get("root");
  const off = new Vector3(p.x - centre.x, p.y - rest.hipY, p.z - centre.z).applyQuaternion(Yinv).multiplyScalar(scale);
  return { q, hips: off };
}

// ── Loops ──────────────────────────────────────────────────────────────────────
const qd = (a, b, o) => 1 - Math.abs(a[o] * b[o] + a[o + 1] * b[o + 1] + a[o + 2] * b[o + 2] + a[o + 3] * b[o + 3]);

/** How different two frames are (every bone's rotation, the hips' height). */
function frameDist(f, g) {
  let d = 0;
  for (const k of KEEP) d += qd(f.q, g.q, k * 4);
  return d + Math.abs(f.hips.y - g.hips.y) * 4;
}

/** The best loop [i, j) in frames: the end like the start, as long as allowed, moving. */
function bestLoop(frames, minN, maxN) {
  let best = { i: 0, j: Math.min(frames.length - 1, maxN), score: Infinity };
  for (let i = 0; i + minN < frames.length; i += 2) {
    for (let j = i + minN; j <= Math.min(frames.length - 1, i + maxN); j += 1) {
      const d = frameDist(frames[i], frames[j]);
      // A little for length (a longer loop shows more of the dance).
      const score = d - (j - i) * 0.0006;
      if (score < best.score) best = { i, j, score };
    }
  }
  return best;
}

/** The last `n` frames eased into the loop's first ones, so it wraps without a seam. */
function crossfade(loop, n) {
  const out = loop.map((f) => ({ q: f.q.slice(), hips: f.hips.clone() }));
  const L = out.length;
  const a = new Quaternion();
  const b = new Quaternion();
  for (let k = 0; k < n; k++) {
    const u = (k + 1) / (n + 1);
    const w = u * u * (3 - 2 * u);
    const f = out[L - n + k];
    const g = loop[k];
    for (let bi = 0; bi < BONES.length; bi++) {
      a.fromArray(f.q, bi * 4);
      b.fromArray(g.q, bi * 4);
      a.slerp(b, w);
      a.toArray(f.q, bi * 4);
    }
    f.hips.lerp(g.hips, w);
  }
  return out;
}

// ── Packing (op-clips.bin's format) ─────────────────────────────────────────────
function packQ(a, o) {
  const v = [a[o], a[o + 1], a[o + 2], a[o + 3]];
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
const pad = (n) => (4 - (n % 4)) % 4;
function pack(head, parts) {
  const json = Buffer.from(JSON.stringify(head));
  const size = 8 + json.length + pad(json.length) + parts.reduce((s, p) => s + p.byteLength + pad(p.byteLength), 0);
  const buf = Buffer.alloc(size);
  buf.write("EOP1", 0);
  buf.writeUInt32LE(json.length, 4);
  json.copy(buf, 8);
  let o = 8 + json.length + pad(json.length);
  for (const p of parts) {
    Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(buf, o);
    o += p.byteLength + pad(p.byteLength);
  }
  return buf;
}

// ── Main ───────────────────────────────────────────────────────────────────────
const head = { v: 2, bones: BONES.length, keep: KEEP, clips: [] };
const parts = [];
for (const [take, name, srcFps, [from, to], [minS, maxS], loop] of DANCES) {
  const subject = take.split("_")[0];
  const skel = readAsf(join(IN, `${subject}.asf`));
  const amc = readAmc(join(IN, `${take}.amc`));
  const rest = restAlign(skel);
  const scale = GAME_HIP_TO_ANKLE / rest.hipToAnkle;
  // The take's rate → 30 fps, within the window.
  const step = srcFps / FPS;
  const posed = [];
  for (let k = Math.round(from * srcFps); k < Math.min(amc.length, Math.round(to * srcFps)); k += step) posed.push(pose(skel, amc[Math.round(k)]));
  // Facing: the hips' average heading over the window; centre: their average place.
  let sx = 0;
  let sz = 0;
  const centre = new Vector3();
  for (const P of posed) {
    const f = new Vector3(0, 0, 1).applyQuaternion(P.W.get("root"));
    sx += f.x;
    sz += f.z;
    centre.add(P.start.get("root"));
  }
  centre.multiplyScalar(1 / posed.length);
  const yaw = Math.atan2(sx, sz);
  let frames = posed.map((P) => retarget(skel, rest, P, yaw, centre, scale));
  const L = loop ? bestLoop(frames, Math.round(minS * FPS), Math.round(maxS * FPS)) : { i: 0, j: frames.length, score: 0 };
  // Re-centre on the loop itself (it may sit off the window's middle).
  let loopFrames = frames.slice(L.i, L.j);
  const c = loopFrames.reduce((s, f) => s.add(new Vector3(f.hips.x, 0, f.hips.z)), new Vector3()).multiplyScalar(1 / loopFrames.length);
  // An emote dances on the spot: travel (jetés, salsa's steps) is eased into 35 cm round the spot.
  const R = 0.35;
  loopFrames = loopFrames.map((f) => {
    const h = f.hips.clone().sub(c);
    const r = Math.hypot(h.x, h.z);
    if (r > 1e-6) {
      const k = (R * Math.tanh(r / R)) / r;
      h.x *= k;
      h.z *= k;
    }
    return { q: f.q, hips: h };
  });
  frames = loop ? crossfade(loopFrames, Math.min(8, Math.floor(loopFrames.length / 4))) : loopFrames;
  // Looping: the first frame again at the end (op.ts wraps over n − 1).
  if (loop) frames.push({ q: frames[0].q.slice(), hips: frames[0].hips.clone() });
  const q = new Uint32Array(frames.length * KEEP.length);
  const h = new Int16Array(frames.length * 3);
  frames.forEach((f, k) => {
    KEEP.forEach((b, j) => (q[k * KEEP.length + j] = packQ(f.q, b * 4)));
    h[k * 3] = Math.max(-32767, Math.min(32767, Math.round(f.hips.x * 10000)));
    h[k * 3 + 1] = Math.max(-32767, Math.min(32767, Math.round(f.hips.y * 10000)));
    h[k * 3 + 2] = Math.max(-32767, Math.min(32767, Math.round(f.hips.z * 10000)));
  });
  const dur = (frames.length - 1) / FPS;
  head.clips.push({ name, fps: FPS, n: frames.length, dur: +dur.toFixed(4), loop, phase0: 0, stride: 0 });
  parts.push(q, h);
  console.log(name.padEnd(11), take, `${(L.i / FPS + from).toFixed(2)}–${(L.j / FPS + from).toFixed(2)} s`, `${dur.toFixed(2)} s loop`, `seam ${L.score.toFixed(3)}`, `scale ${scale.toFixed(4)}`);
}
const buf = pack(head, parts);
writeFileSync(OUT, buf);
console.log("op-dances.bin", (buf.length / 1024).toFixed(0), "KB");
