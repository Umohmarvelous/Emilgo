// Dev only (concept renders): the tactical operator and the armour ladder,
// built on the game's own scanned body (world/human) so every pose, emote and
// fall the game already has would play on it unchanged.
//
// The body keeps its real head (the scanned eyes, the lids, the blink); a
// balaclava with one slit leaves only the eyes and the bridge of the nose.
// Clothing is the body's own skin re-dressed by one material: camo fabric
// (tri-planar, glued to the bind pose so it never swims), gloves on the hands
// and boots on the feet, picked per vertex from the bone that moves it.
// Hard gear (helmet, plates, pouches, pads, pack) is separate meshes riding
// the bones: one merged draw per material at runtime.

import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Bone,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Human } from "../../../src/world/human";
import { BONES, type BoneName } from "../../../src/world/human/skeleton";
import { cleanLook } from "../../../src/world/human/wardrobe";
import { camo, canvas, chipped, grime, molleNormal, paint, scratches, tex, weaveNormal, fbm } from "./tex";
import { armourMats, boot, cape, cuirass, helm, pauldron, put, rotX, rotY, then, wrapPlate } from "./armour";

// ── Measuring the body ───────────────────────────────────────────────────────

export interface Box3s {
  min: Vector3;
  max: Vector3;
}
export interface Fit {
  /** Bone rest positions (mesh space). */
  rest: Record<BoneName, Vector3>;
  /** Per bone, the box of the vertices it moves most (mesh space, rest pose). */
  box: Partial<Record<BoneName, Box3s>>;
}

export function measure(h: Human): Fit {
  h.mesh.updateMatrixWorld(true);
  const rest = {} as Record<BoneName, Vector3>;
  const inv = new Matrix4().copy(h.mesh.matrixWorld).invert();
  for (const b of h.bones) rest[b.name as BoneName] = b.getWorldPosition(new Vector3()).applyMatrix4(inv);
  const g = h.mesh.geometry;
  const pos = g.attributes.position;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const box: Fit["box"] = {};
  for (let i = 0; i < pos.count; i++) {
    let bi = si.getX(i);
    let bw = sw.getX(i);
    for (const k of [1, 2, 3] as const) {
      const w = k === 1 ? sw.getY(i) : k === 2 ? sw.getZ(i) : sw.getW(i);
      if (w > bw) {
        bw = w;
        bi = k === 1 ? si.getY(i) : k === 2 ? si.getZ(i) : si.getW(i);
      }
    }
    const name = BONES[bi];
    const b = (box[name] ??= { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) });
    b.min.min(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    b.max.max(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  return { rest, box };
}

/** Put `obj` (built in mesh space, rest pose) on a bone so it rides it. */
export function ride(h: Human, fit: Fit, bone: BoneName, obj: Object3D): Object3D {
  const r = fit.rest[bone];
  obj.position.sub(r);
  h.bone(bone).add(obj);
  return obj;
}

// ── Materials ────────────────────────────────────────────────────────────────

export interface Kit {
  camo: string[];
  /** Plate carrier / pouches (cordura). */
  webbing: string;
  helmet: string;
  glove: string;
  boot: string;
  /** Metal hardware. */
  metal: string;
}

export const KITS: Record<string, Kit> = {
  // Ironwood: an original woodland-arid camo; ranger green webbing.
  ironwood: { camo: ["#5b5a43", "#7a6e50", "#3a3d2c", "#2a2722"], webbing: "#4b4c37", helmet: "#4a4b3a", glove: "#222220", boot: "#6e5a42", metal: "#2a2a2c" },
  // Ash: urban greys, black hardware.
  ash: { camo: ["#5d6066", "#7c7f83", "#3b3e43", "#24262a"], webbing: "#2b2d30", helmet: "#2f3134", glove: "#1b1b1c", boot: "#2b2a28", metal: "#1e1f21" },
  // Dune: arid tans, coyote gear.
  dune: { camo: ["#a08b68", "#bba57e", "#7d6a4e", "#5e5140"], webbing: "#8a7552", helmet: "#8b7a5c", glove: "#5a4a38", boot: "#9a8463", metal: "#3a3530" },
};

const texCache = new Map<string, Texture>();
function cached(key: string, make: () => Texture): Texture {
  let t = texCache.get(key);
  if (!t) texCache.set(key, (t = make()));
  return t;
}

/** The body's skin as a uniform: camo fabric, gloves, boots; the head stays the scan. */
export function dressBody(h: Human, kit: Kit, opts: { camoScale?: number; grime?: number; tint?: [number, number, number] } = {}): MeshPhysicalMaterial {
  const old = h.mesh.material as MeshStandardMaterial;
  const camoTex = cached(`camo:${kit.camo.join()}`, () => tex(camo(1024, kit.camo, 3)));
  const weave = cached("weave-h", () => {
    // A height texture for the fabric bump (weave + ripstop + creases).
    const c = paint(512, 512, (u, v) => {
      const x = u * 96;
      const y = v * 96;
      const over = (Math.floor(x) + Math.floor(y)) % 2 === 0;
      const wx = Math.sin((x % 1) * Math.PI);
      const wy = Math.sin((y % 1) * Math.PI);
      let hh = over ? wx * 0.6 + wy * 0.25 : wy * 0.6 + wx * 0.25;
      if (Math.floor(x) % 12 === 0 || Math.floor(y) % 12 === 0) hh += 0.3;
      const crease = fbm(u * 3, v * 9, 4, 3) * 0.5 + 0.5;
      const g = (hh * 0.35 + crease * 0.65) * 255;
      return [g, g, g];
    });
    return tex(c, { srgb: false });
  });
  const dirt = cached("grime", () => tex(grime(512, 0.55, 4), { srgb: false }));
  const m = new MeshPhysicalMaterial({ map: old.map, vertexColors: true, roughness: 0.6, metalness: 0, sheen: 0.4, sheenRoughness: 0.8, sheenColor: 0x9a9a8a });
  const gc = hexv(kit.glove);
  const bc = hexv(kit.boot);
  const tint = opts.tint ?? [1, 1, 1];
  m.onBeforeCompile = (s) => {
    s.uniforms.camoMap = { value: camoTex };
    s.uniforms.weaveMap = { value: weave };
    s.uniforms.dirtMap = { value: dirt };
    s.uniforms.gloveCol = { value: gc };
    s.uniforms.bootCol = { value: bc };
    s.uniforms.camoScale = { value: opts.camoScale ?? 1.6 };
    s.uniforms.dirtAmt = { value: opts.grime ?? 0.35 };
    s.uniforms.kitTint = { value: new Vector3(...tint) };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nflat varying float vRegion; varying vec3 vBind; varying vec3 vBindN;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vBind = position; vBindN = objectNormal;
        float bi = skinIndex.x; float bw = skinWeight.x;
        if (skinWeight.y > bw) { bw = skinWeight.y; bi = skinIndex.y; }
        if (skinWeight.z > bw) { bw = skinWeight.z; bi = skinIndex.z; }
        if (skinWeight.w > bw) { bw = skinWeight.w; bi = skinIndex.w; }
        vRegion = bi;`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        flat varying float vRegion; varying vec3 vBind; varying vec3 vBindN;
        uniform sampler2D camoMap, weaveMap, dirtMap; uniform vec3 gloveCol, bootCol, kitTint; uniform float camoScale, dirtAmt;
        vec3 tri3(sampler2D t, vec3 p, vec3 n) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
          return texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z;
        }
        vec3 perturb2(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd) {
          vec3 sx = normalize(dFdx(surf_pos)); vec3 sy = normalize(dFdy(surf_pos));
          vec3 R1 = cross(sy, surf_norm); vec3 R2 = cross(surf_norm, sx);
          float det = dot(sx, R1) * fd;
          vec3 g = sign(det) * (dHdxy.x * R1 + dHdxy.y * R2);
          return normalize(abs(det) * surf_norm - g);
        }
        int regionOf() { return int(vRegion + 0.5); }
        bool isHead() { int r = regionOf(); return r == 5 || r >= 40; }
        bool isHand() { int r = regionOf(); return r == 12 || r == 13 || (r >= 20 && r <= 39); }
        bool isFoot() { int r = regionOf(); return r == 18 || r == 19; }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (!isHead()) {
          vec3 cam = tri3(camoMap, vBind * camoScale, vBindN);
          cam = pow(cam, vec3(2.2)) * kitTint;
          vec3 base = isHand() ? gloveCol : isFoot() ? bootCol : cam;
          // Dust: heavier low on the legs and on the boots.
          float d = tri3(dirtMap, vBind * 1.3, vBindN).r * dirtAmt * (1.2 - smoothstep(0.3, 1.2, vBind.y));
          base = mix(base, vec3(0.32, 0.27, 0.2), clamp(d, 0.0, 0.7));
          diffuseColor.rgb = base;
        }
        #ifdef DEBUG_REGIONS
        diffuseColor.rgb = isHead() ? vec3(1.0, 0.0, 0.0) : isHand() ? vec3(0.0, 1.0, 0.0) : isFoot() ? vec3(0.0, 0.0, 1.0) : vec3(0.3);
        #endif`,
      )
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
        #ifdef USE_SHEEN
        if (isHead() || isHand() || isFoot()) material.sheenColor = vec3(0.0);
        #endif`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        if (!isHead()) roughnessFactor = isHand() ? 0.68 : isFoot() ? 0.78 : 0.92;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        if (!isHead()) {
          float hh = tri3(weaveMap, vBind * (isHand() ? 9.0 : 7.0), vBindN).r;
          normal = perturb2(-vViewPosition, normal, vec2(dFdx(hh), dFdy(hh)) * (isHand() ? 0.6 : 1.1), faceDirection);
        }`,
      );
  };
  if (location.search.includes("debug=regions")) m.defines = { DEBUG_REGIONS: "" };
  m.customProgramCacheKey = () => `dress:${kit.camo.join()}:${opts.camoScale ?? 1.6}:${tint.join()}`;
  h.mesh.material = m;
  return m;
}

function hexv(s: string): Vector3 {
  const n = parseInt(s.replace("#", ""), 16);
  const lin = (c: number) => Math.pow(c / 255, 2.2);
  return new Vector3(lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255));
}

export interface Mats {
  webbing: MeshStandardMaterial;
  pouch: MeshStandardMaterial;
  helmet: MeshPhysicalMaterial;
  metal: MeshStandardMaterial;
  black: MeshStandardMaterial;
  rubber: MeshStandardMaterial;
  bala: MeshStandardMaterial;
  patch: MeshStandardMaterial;
  plate: MeshPhysicalMaterial;
}

export function gearMats(kit: Kit): Mats {
  const molle = cached("molle", () => tex(molleNormal(512, 8, 5), { srgb: false, repeat: [2, 2] }));
  const weaveN = cached("weaveN", () => tex(weaveNormal(512, 96, 12, 3), { srgb: false, repeat: [3, 3] }));
  const rough = cached("scratch", () => tex(scratches(512, 200, 700), { srgb: false }));
  const dirt = cached("grime2", () => tex(grime(512, 0.5, 3)));
  const webbingTex = cached(`web:${kit.webbing}`, () => tex(chipped(512, kit.webbing, "#6f6553", 0.12, 5), { repeat: [2, 2] }));
  const helmTex = cached(`helm:${kit.helmet}`, () => tex(chipped(1024, kit.helmet, "#27282a", 0.1, 9)));
  const balaTex = cached(`bala:${kit.camo[3]}`, () => tex(camo(512, ["#262522", "#2e2c28", "#1d1c1a", "#33302b"], 2)));
  void dirt;
  const knit = cached("knit", () => tex(weaveNormal(512, 160, 0, 2), { srgb: false, repeat: [10, 10] }));
  return {
    webbing: new MeshStandardMaterial({ map: webbingTex, normalMap: molle, normalScale: new Vector2(1.2, 1.2), roughness: 0.92 }),
    pouch: new MeshStandardMaterial({ map: webbingTex, normalMap: weaveN, normalScale: new Vector2(0.8, 0.8), roughness: 0.9 }),
    helmet: new MeshPhysicalMaterial({ map: helmTex, roughnessMap: rough, roughness: 0.75, clearcoat: 0.35, clearcoatRoughness: 0.35, metalness: 0.0 }),
    metal: new MeshStandardMaterial({ color: kit.metal, roughnessMap: rough, roughness: 0.45, metalness: 0.85 }),
    black: new MeshStandardMaterial({ color: 0x18191b, roughness: 0.55, metalness: 0.2 }),
    rubber: new MeshStandardMaterial({ color: 0x141414, roughness: 0.85 }),
    bala: new MeshStandardMaterial({ map: balaTex, normalMap: knit, normalScale: new Vector2(0.35, 0.35), roughness: 0.97, side: DoubleSide, alphaTest: 0.5 }),
    patch: new MeshStandardMaterial({ map: patchTex(), roughness: 0.9 }),
    plate: new MeshPhysicalMaterial({ map: helmTex, roughnessMap: rough, roughness: 0.5, metalness: 0.3, clearcoat: 0.2 }),
  };
}

function patchTex(): Texture {
  return cached("patch", () => {
    const [c, g] = canvas(256, 128);
    g.fillStyle = "#2e3028";
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = "#55584a";
    g.lineWidth = 6;
    g.strokeRect(6, 6, 244, 116);
    g.fillStyle = "#9da08a";
    g.font = "900 54px Montserrat, Inter, sans-serif";
    g.textAlign = "center";
    g.fillText("EMILGO", 128, 84);
    return tex(c);
  });
}

// ── Pieces ───────────────────────────────────────────────────────────────────

const rbox = (w: number, h: number, d: number, r = 0.012, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.1, h / 2.1, d / 2.1));

function mesh(g: BufferGeometry, m: Material, x = 0, y = 0, z = 0): Mesh {
  const o = new Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** The head's points (mesh space, rest pose): the cranium's centre and half-sizes, and the radial shell. */
interface HeadInfo {
  c: Vector3;
  r: Vector3;
  /** Max radius per direction bin (normalised by r), for a face-hugging shell. */
  shell: Float32Array;
}
const SB_U = 72;
const SB_V = 36;
const headCache = new WeakMap<Fit, HeadInfo>();
let lastHuman: Human | null = null;

function headOf(fit: Fit): HeadInfo {
  const hit = headCache.get(fit);
  if (hit) return hit;
  const h = lastHuman!;
  const g = h.mesh.geometry;
  const pos = g.attributes.position;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const eyeY = (fit.rest.eyeL.y + fit.rest.eyeR.y) / 2;
  const pts: Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    let bi = si.getX(i);
    let bw = sw.getX(i);
    if (sw.getY(i) > bw) { bw = sw.getY(i); bi = si.getY(i); }
    if (sw.getZ(i) > bw) { bw = sw.getZ(i); bi = si.getZ(i); }
    if (sw.getW(i) > bw) { bw = sw.getW(i); bi = si.getW(i); }
    if (bi === 5 || bi >= 40) pts.push(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  // The cranium (above the eyes) sets the centre in x/z; the whole head sets y.
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const cmin = new Vector3(Infinity, Infinity, Infinity);
  const cmax = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of pts) {
    min.min(p);
    max.max(p);
    if (p.y > eyeY) { cmin.min(p); cmax.max(p); }
  }
  const c = new Vector3((cmin.x + cmax.x) / 2, (min.y + max.y) / 2, (cmin.z + cmax.z) / 2);
  const r = new Vector3((cmax.x - cmin.x) / 2, (max.y - min.y) / 2, (cmax.z - cmin.z) / 2);
  const shell = new Float32Array(SB_U * SB_V);
  for (const p of pts) {
    const d = p.clone().sub(c);
    const n = new Vector3(d.x / r.x, d.y / r.y, d.z / r.z);
    const len = n.length();
    n.divideScalar(len);
    const phi = (Math.atan2(n.z, -n.x) + Math.PI * 2) % (Math.PI * 2);
    const th = Math.acos(Math.max(-1, Math.min(1, n.y)));
    const bu = Math.min(SB_U - 1, Math.floor((phi / (Math.PI * 2)) * SB_U));
    const bv = Math.min(SB_V - 1, Math.floor((th / Math.PI) * SB_V));
    shell[bv * SB_U + bu] = Math.max(shell[bv * SB_U + bu], len);
  }
  // Fill holes and smooth: max over a 3×3 neighbourhood, then a blur.
  const filled = new Float32Array(shell.length);
  for (let v = 0; v < SB_V; v++)
    for (let u = 0; u < SB_U; u++) {
      let m = 0;
      for (let dv = -2; dv <= 2; dv++)
        for (let du = -2; du <= 2; du++) {
          const vv = Math.max(0, Math.min(SB_V - 1, v + dv));
          const uu = (u + du + SB_U) % SB_U;
          m = Math.max(m, shell[vv * SB_U + uu]);
        }
      filled[v * SB_U + u] = m || 0.9;
    }
  const out = new Float32Array(shell.length);
  for (let v = 0; v < SB_V; v++)
    for (let u = 0; u < SB_U; u++) {
      let s = 0;
      let k = 0;
      for (let dv = -1; dv <= 1; dv++)
        for (let du = -1; du <= 1; du++) {
          const vv = Math.max(0, Math.min(SB_V - 1, v + dv));
          s += filled[vv * SB_U + ((u + du + SB_U) % SB_U)];
          k++;
        }
      out[v * SB_U + u] = s / k;
    }
  const info = { c, r, shell: out };
  headCache.set(fit, info);
  return info;
}

function shellAt(info: HeadInfo, phi: number, th: number): number {
  const fu = (phi / (Math.PI * 2)) * SB_U - 0.5;
  const fv = (th / Math.PI) * SB_V - 0.5;
  const u0 = Math.floor(fu);
  const v0 = Math.max(0, Math.min(SB_V - 1, Math.floor(fv)));
  const v1 = Math.min(SB_V - 1, v0 + 1);
  const tu = fu - u0;
  const tv = Math.max(0, Math.min(1, fv - v0));
  const a = info.shell[v0 * SB_U + ((u0 + SB_U) % SB_U)];
  const b = info.shell[v0 * SB_U + ((u0 + 1 + SB_U) % SB_U)];
  const c = info.shell[v1 * SB_U + ((u0 + SB_U) % SB_U)];
  const d = info.shell[v1 * SB_U + ((u0 + 1 + SB_U) % SB_U)];
  return (a * (1 - tu) + b * tu) * (1 - tv) + (c * (1 - tu) + d * tu) * tv;
}

/** Direction (mesh space) from the head centre to the sphere's (u, v) param, and back. */
function toUV(info: HeadInfo, p: Vector3): [number, number] {
  const d = p.clone().sub(info.c);
  const n = new Vector3(d.x / info.r.x, d.y / info.r.y, d.z / info.r.z).normalize();
  const phi = (Math.atan2(n.z, -n.x) + Math.PI * 2) % (Math.PI * 2);
  return [phi / (Math.PI * 2), Math.acos(Math.max(-1, Math.min(1, n.y))) / Math.PI];
}

/** Balaclava: shrink-wrapped over the scanned head (a few mm of fabric), one slit for the eyes and the bridge of the nose, a neck tube into the collar. */
function balaclava(h: Human, fit: Fit, M: Mats): void {
  const info = headOf(fit);
  const { c, r } = info;
  const shell = new SphereGeometry(1, 96, 64);
  const p = shell.attributes.position;
  const uv = shell.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = uv.getX(i);
    const v = 1 - uv.getY(i);
    const phi = u * Math.PI * 2;
    const th = v * Math.PI;
    // Fabric thickness 5 mm, a little more over the hair at the back and top.
    let k = shellAt(info, phi, th);
    const nx = -Math.cos(phi) * Math.sin(th);
    const ny = Math.cos(th);
    const nz = Math.sin(phi) * Math.sin(th);
    const back = Math.max(0, -nz) * 0.006 + Math.max(0, ny) * 0.004;
    // Below the jaw, the fabric drapes straight down to the neck instead of following the chin under.
    if (ny < -0.55) k = Math.max(k, 0.85);
    const x = nx * r.x * k;
    const y = ny * r.y * k;
    const z = nz * r.z * k;
    const len = Math.hypot(x, y, z);
    const grow = (len + 0.005 + back) / len;
    p.setXYZ(i, x * grow, y * grow, z * grow);
  }
  shell.computeVertexNormals();
  // The slit, found from the real eyes.
  const eyeL = fit.rest.eyeL;
  const eyeR = fit.rest.eyeR;
  const outL = eyeL.clone().add(new Vector3(0.026, 0, 0));
  const outR = eyeR.clone().add(new Vector3(-0.026, 0, 0));
  const [uA] = toUV(info, outL);
  const [uB] = toUV(info, outR);
  const mid = eyeL.clone().add(eyeR).multiplyScalar(0.5);
  const [, vTop] = toUV(info, mid.clone().add(new Vector3(0, 0.014, 0.01)));
  const [, vBot] = toUV(info, mid.clone().add(new Vector3(0, -0.012, 0.01)));
  const [, vNose] = toUV(info, mid.clone().add(new Vector3(0, -0.02, 0.02)));
  const u0 = Math.min(uA, uB);
  const u1 = Math.max(uA, uB);
  const um = (u0 + u1) / 2;
  const hw = (u1 - u0) / 2;
  const vm = (vTop + vBot) / 2;
  const hv = Math.abs(vBot - vTop) / 2;
  const AW = 2048;
  const AH = 1024;
  const alpha = paint(AW, AH, (u, v) => {
    const du = (u - um) / hw;
    if (Math.abs(du) > 1.2) return [255, 255, 255];
    // The bottom edge dips at the middle for the bridge of the nose.
    const bridge = Math.max(0, 1 - Math.abs(du) * 2.4);
    const bottom = vm + hv + bridge * (Math.abs(vNose - vBot) * 0.6);
    const top = vm - hv - 0.15 * hv * (1 - du * du);
    const inside = Math.abs(du) < 1 - 0.18 * Math.pow((v - (top + bottom) / 2) / ((bottom - top) / 2), 6) && v > top && v < bottom;
    const a = inside ? 0 : 255;
    return [a, a, a];
  });
  const mat = M.bala.clone();
  mat.alphaMap = tex(alpha, { srgb: false, clamp: true });
  const o = mesh(shell, mat, c.x, c.y, c.z);
  ride(h, fit, "head", o);
  // The neck tube, from under the jaw into the collar.
  const nb = fit.box.neck;
  const nr = nb ? Math.max(nb.max.x - nb.min.x, nb.max.z - nb.min.z) / 2 + 0.012 : 0.07;
  const top = c.y - r.y * 0.75;
  const bot = fit.rest.neck.y - 0.05;
  const tube = new CylinderGeometry(nr * 0.82, nr * 0.95, Math.max(0.04, top - bot), 32, 1, true);
  const tm = mesh(tube, M.bala, c.x, (top + bot) / 2, c.z - 0.005);
  ride(h, fit, "neck", tm);
}

function helmet(h: Human, fit: Fit, M: Mats, style: "operator" | "plated" | "jugg" | "warlord" | "titan"): void {
  const { c, r } = headOf(fit);
  const g = new Group();
  g.position.copy(c);
  const sx = r.x * 1.2;
  const sy = r.y * 0.95;
  const sz = r.z * 1.17;
  const browY = (fit.rest.eyeL.y + fit.rest.eyeR.y) / 2 - c.y + 0.03;
  if (style === "operator" || style === "plated") {
    // High-cut ballistic helmet: a cap down to the brow at the front, cut high over the ears.
    const cap = new SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.53);
    const cp = cap.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i);
      let y = cp.getY(i);
      const z = cp.getZ(i);
      // Ear cut: raise the rim at the sides.
      const side = Math.abs(x) / Math.max(0.2, Math.hypot(x, z));
      if (y < 0.25) y = Math.max(y, 0.25 * side * side - 0.05);
      cp.setXYZ(i, x * sx, y * sy + browY + 0.01, z * sz + 0.006);
    }
    cap.computeVertexNormals();
    g.add(mesh(cap, M.helmet));
    // Rails (ARC) both sides.
    for (const s of [-1, 1]) {
      const rail = mesh(rbox(0.01, 0.018, 0.11, 0.004), M.black, s * sx * 0.96, browY + sy * 0.18, 0.0);
      rail.rotation.z = s * 0.22;
      g.add(rail);
      // Ear cups (comms) over the balaclava.
      const cup = mesh(new CylinderGeometry(0.038, 0.042, 0.03, 24), M.black, s * (r.x * 1.1), -r.y * 0.05, -0.006);
      cup.rotation.z = Math.PI / 2;
      g.add(cup);
      const band = mesh(new TorusGeometry(r.x * 1.12, 0.005, 6, 24, Math.PI), M.rubber, 0, -r.y * 0.05, -0.006);
      band.rotation.y = Math.PI / 2;
      if (s > 0) g.add(band);
    }
    // NVG shroud and mount at the front.
    g.add(mesh(rbox(0.038, 0.026, 0.014, 0.005), M.black, 0, browY + sy * 0.42, sz * 0.92));
    const mount = mesh(rbox(0.022, 0.03, 0.018, 0.005), M.metal, 0, browY + sy * 0.3, sz * 1.0);
    mount.rotation.x = 0.4;
    g.add(mount);
    // Velcro panels on top and the back, a strobe and a counterweight pouch.
    const top = mesh(rbox(0.08, 0.005, 0.1, 0.003), M.pouch, 0, sy + browY + 0.012, 0.0);
    g.add(top);
    g.add(mesh(rbox(0.085, 0.05, 0.03, 0.01), M.pouch, 0, browY + sy * 0.25, -sz * 0.98));
    g.add(mesh(rbox(0.022, 0.016, 0.022, 0.006), M.rubber, 0.03, sy + browY + 0.02, -0.04));
  } else {
    const AM = armourMats(style === "jugg" ? 2 : style === "warlord" ? 3 : 4, { plate: M.plate, metal: M.metal });
    const eyes: [Vector3, Vector3] = [fit.rest.eyeL.clone().sub(c), fit.rest.eyeR.clone().sub(c)];
    g.add(helm(style, r, eyes, AM));
  }
  ride(h, fit, "head", g);
}

/** The torso's box between two heights (vertices of the spine bones, arms excluded). */
function torsoBand(h: Human, y0: number, y1: number): Box3s {
  const g = h.mesh.geometry;
  const pos = g.attributes.position;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < y0 || y > y1) continue;
    let bi = si.getX(i);
    let bw = sw.getX(i);
    if (sw.getY(i) > bw) { bw = sw.getY(i); bi = si.getY(i); }
    if (sw.getZ(i) > bw) { bw = sw.getZ(i); bi = si.getZ(i); }
    if (sw.getW(i) > bw) { bw = sw.getW(i); bi = si.getW(i); }
    if (bi < 1 || bi > 4) continue;
    const v = new Vector3(pos.getX(i), y, pos.getZ(i));
    min.min(v);
    max.max(v);
  }
  return { min, max };
}

/** Plate carrier: front and back plates, cummerbund, straps, pouches, admin panel with our patch. */
function carrier(h: Human, fit: Fit, M: Mats, heavy = 0): void {
  const top = fit.rest.neck.y - 0.075;
  const bot = fit.rest.spine.y - 0.02;
  const ch = torsoBand(h, bot, top);
  const cx = (ch.min.x + ch.max.x) / 2;
  const front = ch.max.z;
  const back = ch.min.z;
  const width = Math.min(0.34, (ch.max.x - ch.min.x) * 0.78) + heavy * 0.06;
  const hgt = top - bot;
  const midY = (top + bot) / 2;
  const g = new Group();
  // Plates.
  const pf = mesh(rbox(width * 0.86, hgt, 0.045 + heavy * 0.03, 0.02), M.webbing, cx, midY, front + 0.024 + heavy * 0.012);
  const pb = mesh(rbox(width * 0.9, hgt * 1.05, 0.045 + heavy * 0.03, 0.02), M.webbing, cx, midY + 0.01, back - 0.024 - heavy * 0.012);
  g.add(pf, pb);
  // Cummerbund round the sides.
  const cumH = hgt * 0.42;
  for (const s of [-1, 1]) {
    const side = mesh(rbox(0.035, cumH, (front - back) * 0.85, 0.012), M.webbing, cx + s * (width * 0.5 + 0.01 + heavy * 0.03), bot + cumH * 0.6, (front + back) / 2);
    g.add(side);
    // Shoulder straps over the clavicles.
    const strapF = mesh(rbox(0.055, 0.12, 0.02, 0.008), M.webbing, cx + s * width * 0.3, top + 0.03, front - 0.01);
    strapF.rotation.x = -0.5;
    const strapT = mesh(rbox(0.055, 0.016, (front - back) * 0.8, 0.008), M.webbing, cx + s * width * 0.3, top + 0.075, (front + back) / 2);
    g.add(strapF, strapT);
  }
  // Three rifle magazine pouches, flap tops.
  for (let i = -1; i <= 1; i++) {
    const x = cx + i * width * 0.27;
    const pz = front + 0.065 + heavy * 0.02;
    const pouch = mesh(rbox(width * 0.24, hgt * 0.36, 0.05, 0.01), M.pouch, x, bot + hgt * 0.24, pz);
    const flap = mesh(rbox(width * 0.25, hgt * 0.08, 0.056, 0.01), M.pouch, x, bot + hgt * 0.43, pz + 0.002);
    const snap = mesh(new CylinderGeometry(0.006, 0.006, 0.004, 12), M.metal, x, bot + hgt * 0.4, pz + 0.032);
    snap.rotation.x = Math.PI / 2;
    g.add(pouch, flap, snap);
  }
  // Admin panel with our patch, a radio on the left, a tourniquet on the right strap.
  const admin = mesh(rbox(width * 0.5, hgt * 0.22, 0.03, 0.008), M.pouch, cx, bot + hgt * 0.68, front + 0.058 + heavy * 0.02);
  const patch = mesh(new BoxGeometry(width * 0.34, hgt * 0.12, 0.002), M.patch, cx, bot + hgt * 0.69, front + 0.075 + heavy * 0.02);
  g.add(admin, patch);
  const radio = mesh(rbox(0.06, 0.14, 0.04, 0.008), M.black, cx + width * 0.58 + heavy * 0.03, bot + hgt * 0.45, front - 0.03);
  const ant = mesh(new CylinderGeometry(0.004, 0.006, 0.22, 8), M.rubber, cx + width * 0.6 + heavy * 0.03, bot + hgt * 0.6 + 0.12, front - 0.05);
  ant.rotation.z = -0.2;
  const tq = mesh(rbox(0.045, 0.1, 0.035, 0.01), new MeshStandardMaterial({ color: 0x2a2d22, roughness: 0.9 }), cx - width * 0.3, top - 0.02, front + 0.03);
  g.add(radio, ant, tq);
  ride(h, fit, "chest", g);
}

/** Belt with pouches, a drop-leg holster, knee pads, assault pack. */
function lowerGear(h: Human, fit: Fit, M: Mats, pack = true): void {
  const hp = fit.box.hips!;
  const cx = (hp.min.x + hp.max.x) / 2;
  const cz = (hp.min.z + hp.max.z) / 2;
  const y = fit.rest.hips.y + 0.06;
  const rx = (hp.max.x - hp.min.x) / 2 + 0.018;
  const rz = (hp.max.z - hp.min.z) / 2 + 0.018;
  const belt = new CylinderGeometry(1, 1, 0.055, 40, 1, true);
  belt.scale(rx, 1, rz);
  const bm = mesh(belt, M.webbing.clone(), cx, y, cz);
  (bm.material as MeshStandardMaterial).side = DoubleSide;
  const g = new Group();
  g.add(bm);
  for (const [a, w] of [[0.6, 0.06], [2.4, 0.07], [-0.9, 0.05], [-2.2, 0.06]] as const) {
    g.add(mesh(rbox(w, 0.08, 0.04, 0.01), M.pouch, cx + Math.sin(a) * rx * 1.05, y - 0.01, cz + Math.cos(a) * rz * 1.05));
  }
  g.add(mesh(rbox(0.07, 0.035, 0.015, 0.006), M.metal, cx, y, cz + rz + 0.006));
  ride(h, fit, "hips", g);
  // Holster on the right thigh.
  const th = fit.box.thighR!;
  const hol = mesh(rbox(0.05, 0.17, 0.09, 0.012), M.black, th.min.x - 0.012, fit.rest.thighR.y - 0.14, (th.min.z + th.max.z) / 2 + 0.01);
  const pistol = mesh(rbox(0.03, 0.06, 0.1, 0.008), M.black, th.min.x - 0.014, fit.rest.thighR.y - 0.03, (th.min.z + th.max.z) / 2 + 0.02);
  ride(h, fit, "thighR", hol);
  ride(h, fit, "thighR", pistol);
  // Knee pads.
  for (const s of ["L", "R"] as const) {
    const shin = fit.box[`shin${s}` as BoneName]!;
    const knee = fit.rest[`shin${s}` as BoneName];
    const pad = mesh(rbox(0.1, 0.12, 0.05, 0.022), M.rubber, (shin.min.x + shin.max.x) / 2, knee.y - 0.02, shin.max.z + 0.012);
    ride(h, fit, `shin${s}` as BoneName, pad);
  }
  if (pack) {
    const ch = fit.box.chest!;
    const tb = torsoBand(h, fit.rest.spine.y, fit.rest.neck.y - 0.05);
    const pk = new Group();
    const body = mesh(rbox(0.27, 0.34, 0.12, 0.04), M.pouch, (ch.min.x + ch.max.x) / 2, fit.rest.chest.y - 0.06, tb.min.z - 0.1);
    const lid = mesh(rbox(0.25, 0.07, 0.13, 0.03), M.webbing, (ch.min.x + ch.max.x) / 2, fit.rest.chest.y + 0.12, tb.min.z - 0.1);
    pk.add(body, lid);
    for (const s of [-1, 1]) pk.add(mesh(rbox(0.05, 0.18, 0.05, 0.015), M.pouch, (ch.min.x + ch.max.x) / 2 + s * 0.155, fit.rest.chest.y - 0.1, tb.min.z - 0.1));
    ride(h, fit, "chest", pk);
  }
}

/** Armour for the higher tiers: pauldrons, vambraces, tassets, knee cops, greaves; a cuirass from tier 2; a cape from tier 3. */
function heavy(h: Human, fit: Fit, M: Mats, tier: number): void {
  const AM = armourMats(tier, { plate: M.plate, metal: M.metal });
  for (const s of ["L", "R"] as const) {
    const sign = s === "L" ? 1 : -1;
    const ua = `upperArm${s}` as BoneName;
    const sh = fit.rest[ua];
    const pd = pauldron(sign as 1 | -1, tier, AM);
    pd.position.copy(sh).add(new Vector3(sign * 0.01, 0.0, 0));
    ride(h, fit, ua, pd);
    // Vambrace on the outside of the forearm.
    const fa = `foreArm${s}` as BoneName;
    const fb = fit.box[fa]!;
    const flen = fb.max.y - fb.min.y;
    const vam = wrapPlate({ w: 0.15 + tier * 0.012, h: flen * 0.75, t: 0.01, bend: 0.05 + tier * 0.004, strips: 10, corner: 0.012, taper: 0.85 });
    const vm = put(vam, AM.plate, [(fb.min.x + fb.max.x) / 2 + sign * 0.02, (fb.min.y + fb.max.y) / 2 - 0.01, (fb.min.z + fb.max.z) / 2], rotY((sign * Math.PI) / 2));
    ride(h, fit, fa, vm);
    // Tassets over the thighs, knee cops, greaves.
    const th = `thigh${s}` as BoneName;
    const tb = fit.box[th]!;
    for (let k = 0; k < 2 + (tier >= 3 ? 1 : 0); k++) {
      const ts = wrapPlate({ w: 0.15 + tier * 0.012 - k * 0.01, h: 0.08, t: 0.01, bend: 0.12, strips: 8, corner: 0.01, taper: 0.9 });
      const tm = put(ts, k === 1 && tier >= 3 ? AM.trim : AM.plate, [(tb.min.x + tb.max.x) / 2 + sign * 0.015, fit.rest[th].y - 0.02 - k * 0.065, tb.max.z + 0.01 + k * 0.004], then(rotY(sign * 0.25), rotX(-0.1)));
      ride(h, fit, th, tm);
    }
    const shn = `shin${s}` as BoneName;
    const sb = fit.box[shn]!;
    const knee = fit.rest[shn];
    const cop = wrapPlate({ w: 0.11 + tier * 0.01, h: 0.1, t: 0.014, bend: 0.06, dome: 0.07, strips: 8, corner: 0.02 });
    ride(h, fit, shn, put(cop, tier >= 3 ? AM.trim : AM.plate, [(sb.min.x + sb.max.x) / 2, knee.y - 0.01, sb.max.z + 0.022]));
    const grv = wrapPlate({ w: 0.13 + tier * 0.01, h: (sb.max.y - sb.min.y) * 0.62, t: 0.012, bend: 0.06, strips: 10, corner: 0.015, taper: 0.8 });
    ride(h, fit, shn, put(grv, AM.plate, [(sb.min.x + sb.max.x) / 2, (sb.min.y + sb.max.y) / 2 - 0.02, sb.max.z + 0.012]));
  }
  if (tier >= 2) {
    const top = fit.rest.neck.y - 0.06;
    const bot = fit.rest.spine.y - 0.04;
    const tb = torsoBand(h, bot, top);
    const cu = cuirass(tb.max.x - tb.min.x, top - bot, tb.max.z - tb.min.z, tier, AM);
    cu.position.set((tb.min.x + tb.max.x) / 2, (top + bot) / 2, (tb.min.z + tb.max.z) / 2);
    ride(h, fit, "chest", cu);
  }
  if (tier >= 3) {
    const tb = torsoBand(h, fit.rest.spine.y, fit.rest.neck.y - 0.05);
    const cp = cape(0.62 + (tier - 3) * 0.12, 1.15, AM);
    cp.position.set((tb.min.x + tb.max.x) / 2, fit.rest.neck.y - 0.62, tb.min.z - 0.1);
    ride(h, fit, "chest", cp);
  }
}

/** Boots over the scanned feet (the scan has toes). */
function boots(h: Human, fit: Fit, kit: Kit, tier: number, M: Mats): void {
  const AM = armourMats(tier, { plate: M.plate, metal: M.metal });
  const leather = new MeshStandardMaterial({ map: tex(chipped(256, tier >= 3 ? "#1a1918" : kit.boot, "#2a241d", 0.15, 6)), normalMap: tex(weaveNormal(256, 64, 0, 2), { srgb: false, repeat: [2, 2] }), roughness: 0.8 });
  const sole = new MeshStandardMaterial({ color: 0x151413, roughness: 0.9 });
  for (const s of ["L", "R"] as const) {
    const fb = fit.box[`foot${s}` as BoneName]!;
    const len = fb.max.z - fb.min.z + 0.035;
    const wid = fb.max.x - fb.min.x + 0.03;
    const b = boot(len, wid, 0.085, leather, sole, tier >= 2, AM);
    b.position.set((fb.min.x + fb.max.x) / 2, fb.min.y - 0.004, (fb.min.z + fb.max.z) / 2 + 0.008);
    ride(h, fit, `foot${s}` as BoneName, b);
  }
}

// ── The operator and the ladder ─────────────────────────────────────────────

export interface Operator {
  h: Human;
  fit: Fit;
  mats: Mats;
}

export const TIERS = [
  { id: "t0", name: "Operator", scale: 1.0, bulk: 1.0, kit: "ironwood", helmet: "operator", plates: 0, note: "Base kit. Balaclava, high-cut helmet, plate carrier." },
  { id: "t1", name: "Plated", scale: 1.06, bulk: 1.05, kit: "ash", helmet: "plated", plates: 1, note: "Pauldrons, vambraces, tassets, greaves. +25 armour." },
  { id: "t2", name: "Juggernaut", scale: 1.15, bulk: 1.12, kit: "ash", helmet: "jugg", plates: 2, note: "Sealed helmet, chest core, bomb-suit bulk. +60 armour." },
  { id: "t3", name: "Warlord", scale: 1.27, bulk: 1.18, kit: "ash", helmet: "warlord", plates: 3, note: "Spiked black plate, horned helm, ember eyes. +100." },
  { id: "t4", name: "Titan", scale: 1.45, bulk: 1.24, kit: "ash", helmet: "titan", plates: 4, note: "Giant. Molten-gold plate, horned crown, sun core. +160." },
] as const;

export function operator(opts: { body?: "m" | "f"; kit?: keyof typeof KITS; tier?: number; seed?: number } = {}): Operator {
  const t = TIERS[opts.tier ?? 0];
  const look = cleanLook({ body: opts.body ?? "m", skin: 3, hair: "lowcut", outfit: "street", extras: [], height: 1 });
  look.hoodie = 2;
  const h = new Human(look, 2, { featured: true, seed: opts.seed ?? 0.4 });
  const fit = measure(h);
  lastHuman = h;
  const kit = KITS[opts.kit ?? t.kit];
  dressBody(h, kit, t.plates >= 3 ? { tint: [0.45, 0.45, 0.47] } : {});
  const mats = gearMats(kit);
  if (t.plates >= 3) {
    // Black-steel and, for the Titan, molten gold with cracks.
    const titan = t.plates >= 4;
    mats.plate = new MeshPhysicalMaterial({
      map: tex(chipped(1024, titan ? "#17140f" : "#1d1c1e", titan ? "#5a4320" : "#47403a", 0.12, 8)),
      roughnessMap: tex(scratches(512, 120, 900), { srgb: false }),
      roughness: titan ? 0.28 : 0.42,
      metalness: titan ? 0.9 : 0.85,
      clearcoat: 0.3,
      emissiveMap: titan ? tex(cracks(1024), {}) : null,
      emissive: titan ? 0xff7a10 : 0x000000,
      emissiveIntensity: titan ? 1.4 : 0,
    });
    mats.metal = new MeshStandardMaterial({ color: titan ? 0x2a1a0c : 0x2b2b2e, roughness: 0.3, metalness: 1 });
  } else if (t.plates >= 1) {
    mats.plate = new MeshPhysicalMaterial({ map: tex(chipped(1024, t.plates === 2 ? "#3f4a3a" : "#565c63", "#2a2b2d", 0.14, 8)), roughnessMap: tex(scratches(512, 150, 700), { srgb: false }), roughness: 0.5, metalness: 0.7, clearcoat: 0.25 });
  }
  if (t.plates < 2) balaclava(h, fit, mats);
  helmet(h, fit, mats, t.helmet);
  if (t.plates < 2) carrier(h, fit, mats, t.plates * 0.6);
  lowerGear(h, fit, mats, t.plates < 3);
  boots(h, fit, kit, t.plates, mats);
  if (t.plates > 0) heavy(h, fit, mats, t.plates);
  h.mesh.scale.set(t.scale * t.bulk, t.scale, t.scale * (1 + (t.bulk - 1) * 0.6));
  h.mesh.castShadow = true;
  return { h, fit, mats };
}

/** Molten cracks (emissive) for the Titan's plate. */
function cracks(size: number): HTMLCanvasElement {
  return paint(size, size, (u, v) => {
    const n = fbm(u * 6 + fbm(u * 2, v * 2, 2, 2) * 0.6, v * 6, 4, 6);
    const k = 1 - Math.min(1, Math.abs(n) / 0.035);
    const g = Math.pow(k, 2) * 255;
    return [g, g * 0.6, g * 0.15];
  });
}

// ── Posing (two-bone IK on the game's skeleton) ──────────────────────────────

const _v1 = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _qp = new Quaternion();

/** Turn `bone` so its child (or `tipLocal`) points at the world point `to`. */
export function aimBone(bone: Bone, child: Bone, to: Vector3): void {
  bone.updateWorldMatrix(true, true);
  const from = bone.getWorldPosition(_v1);
  const cur = child.getWorldPosition(_v2).sub(from).normalize();
  const want = to.clone().sub(from).normalize();
  _q.setFromUnitVectors(cur, want);
  const wq = bone.getWorldQuaternion(new Quaternion());
  const nq = _q.multiply(wq);
  (bone.parent as Object3D).getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(nq));
  bone.updateMatrix();
  bone.updateWorldMatrix(false, true);
}

/** Reach `hand` to `target` with the elbow bent toward `pole` (world). */
export function reach(h: Human, side: "L" | "R", target: Vector3, pole: Vector3): void {
  const ua = h.bone(`upperArm${side}`);
  const fa = h.bone(`foreArm${side}`);
  const hd = h.bone(`hand${side}`);
  ua.updateWorldMatrix(true, true);
  const S = ua.getWorldPosition(new Vector3());
  const E = fa.getWorldPosition(new Vector3());
  const Wr = hd.getWorldPosition(new Vector3());
  const l1 = S.distanceTo(E);
  const l2 = E.distanceTo(Wr);
  const d = Math.min(l1 + l2 - 1e-4, S.distanceTo(target));
  const dir = target.clone().sub(S).normalize();
  // Elbow on the circle round the shoulder→target line, toward the pole.
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const toPole = pole.clone().sub(S);
  const perp = toPole.sub(dir.clone().multiplyScalar(toPole.dot(dir))).normalize();
  const elbow = S.clone().addScaledVector(dir, a).addScaledVector(perp, hgt);
  aimBone(ua, fa, elbow);
  aimBone(fa, hd, S.clone().addScaledVector(dir, d));
}

/** Rotate a bone by a world-space quaternion (keeps children in step). */
export function turnWorld(bone: Bone, q: Quaternion): void {
  bone.updateWorldMatrix(true, false);
  const wq = bone.getWorldQuaternion(new Quaternion());
  const nq = q.clone().multiply(wq);
  (bone.parent as Object3D).getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.clone().invert().multiply(nq));
  bone.updateMatrix();
  bone.updateWorldMatrix(false, true);
}

/** Close the fingers round a grip. */
export function grip(h: Human, side: "L" | "R", amount = 1): void {
  const s = side === "L" ? 1 : -1;
  for (const f of ["index", "middle", "ring", "pinky"]) {
    for (const k of [1, 2]) {
      const b = h.bone(`${f}${k}${side}` as BoneName);
      b.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -s * 1.2 * amount);
      b.updateMatrix();
    }
  }
  const th = h.bone(`thumb1${side}` as BoneName);
  th.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), s * 0.6 * amount);
  th.updateMatrix();
}

export function boneIndex(name: BoneName): number {
  return BONES.indexOf(name);
}

/** Merge a group's meshes per material (what the game would ship: one draw per material). */
export function mergedCount(root: Object3D): { meshes: number; tris: number } {
  let meshes = 0;
  let tris = 0;
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && m.geometry) {
      meshes++;
      const g = m.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return { meshes, tris };
}

export { mergeGeometries };
