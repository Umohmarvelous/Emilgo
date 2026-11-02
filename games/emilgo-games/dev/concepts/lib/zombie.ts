// Dev only (concept renders): Dead Streets' zombies on the game's scanned
// bodies. One material does the work: the scan's face goes grey-green with
// veins and lesions, the eyes milky, blood round the mouth; clothes go dirty
// and torn, and through the tears you see raw flesh (the inside of the same
// surface, drawn as wound). Exposed bone (ribs, a forearm) is extra meshes on
// the bones. Eight kinds, each its own silhouette.

import { CylinderGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3, DoubleSide, type Material } from "three";
import { Human } from "../../../src/world/human";
import type { BoneName } from "../../../src/world/human/skeleton";
import { cleanLook } from "../../../src/world/human/wardrobe";
import { aimBone, measure, reach, ride, turnWorld, type Fit } from "./gear";
import { horn, put, rotX, rotY } from "./armour";
import { bloodDecal, fbm, grime, paint, rot, rotNormal, tex } from "./tex";
import { Quaternion } from "three";

export type ZKind = "shambler" | "runner" | "crawler" | "bloater" | "screamer" | "brute" | "lurker" | "masked";
export const ZKINDS: { id: ZKind; name: string; note: string }[] = [
  { id: "shambler", name: "Shambler", note: "Slow, everywhere. Arms out, jaw slack." },
  { id: "runner", name: "Okada Runner", note: "Fast. Hold the torch on its face to stagger it." },
  { id: "crawler", name: "Crawler", note: "Legs gone. Only the low beam finds it." },
  { id: "bloater", name: "Ata Bloater", note: "Swollen with pepper gas. Shoot from range." },
  { id: "screamer", name: "Screamer", note: "Calls the horde. Cut it down first." },
  { id: "brute", name: "Agbero Brute", note: "Charges. Side-step into a wall." },
  { id: "lurker", name: "Pool Lurker", note: "Waits in the pools, grabs ankles." },
  { id: "masked", name: "Masked", note: "Cracked gas mask: no torch stun, head shots only." },
];

let rotTex: ReturnType<typeof tex> | null = null;
let rotN: ReturnType<typeof tex> | null = null;
let bloodT: ReturnType<typeof tex> | null = null;
let dirtT: ReturnType<typeof tex> | null = null;
let tearT: ReturnType<typeof tex> | null = null;

/** Turn a scanned body into a zombie: face, eyes, skin, torn and bloodied clothes. */
export function dressZombie(h: Human, eyes: [Vector3, Vector3], opts: { tear?: number; blood?: number; tone?: number } = {}): MeshPhysicalMaterial {
  rotTex ??= tex(rot(1024, 0.3, 5));
  rotN ??= tex(rotNormal(1024, 5), { srgb: false });
  bloodT ??= tex(bloodDecal(512, 3, 0.5));
  dirtT ??= tex(grime(512, 0.6, 3), { srgb: false });
  tearT ??= tex(
    paint(512, 512, (u, v) => {
      const n = fbm(u * 5, v * 5, 5, 5) * 0.5 + 0.5;
      const g = n * 255;
      return [g, g, g];
    }),
    { srgb: false },
  );
  const old = h.mesh.material as MeshStandardMaterial;
  const m = new MeshPhysicalMaterial({ map: old.map, vertexColors: true, roughness: 0.7 });
  m.onBeforeCompile = (s) => {
    s.uniforms.rotMap = { value: rotTex };
    s.uniforms.rotNor = { value: rotN };
    s.uniforms.bloodMap = { value: bloodT };
    s.uniforms.dirtMap = { value: dirtT };
    s.uniforms.tearMap = { value: tearT };
    s.uniforms.tear = { value: opts.tear ?? 0.25 };
    s.uniforms.bloodAmt = { value: opts.blood ?? 0.6 };
    s.uniforms.eyeA = { value: eyes[0] };
    s.uniforms.eyeB = { value: eyes[1] };
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
        uniform sampler2D rotMap, rotNor, bloodMap, dirtMap, tearMap; uniform float tear, bloodAmt; uniform vec3 eyeA, eyeB;
        vec3 tri3(sampler2D t, vec3 p, vec3 n) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
          return texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z;
        }
        int regionOf() { return int(vRegion + 0.5); }
        bool isHead() { int r = regionOf(); return r == 5 || r == 40 || r >= 43; }
        bool isEye() { int r = regionOf(); return r == 41 || r == 42; }
        bool isSkin() { int r = regionOf(); return r == 12 || r == 13 || (r >= 18 && r <= 39); }
        float bloodMask() {
          // Down the chin and the chest, on the hands, splashes elsewhere.
          vec3 mp = vec3((eyeA.x + eyeB.x) * 0.5, eyeA.y - 0.072, eyeA.z + 0.012);
          vec3 dm = vBind - mp; dm.y = dm.y > 0.0 ? dm.y * 2.5 : dm.y * 0.45;
          float mouth = smoothstep(0.05, 0.012, length(dm));
          float chest = smoothstep(0.24, 0.0, abs(vBind.x)) * step(0.0, vBindN.z) * smoothstep(0.85, 1.45, vBind.y);
          float spl = tri3(bloodMap, vBind * 2.2, vBindN).r;
          return clamp(max(mouth * 2.0, chest * smoothstep(0.25, 0.6, spl) * 0.9) + smoothstep(0.45, 0.8, spl) * 0.6, 0.0, 1.0) * bloodAmt;
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 rotC = pow(tri3(rotMap, vBind * 3.0, vBindN), vec3(2.2));
        float bl = bloodMask();
        if (isEye()) {
          diffuseColor.rgb = vec3(0.55, 0.56, 0.42);
        } else if (isHead() || isSkin()) {
          float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          float hair = smoothstep(0.03, 0.06, vBind.y - eyeA.y) * step(vBindN.y, 2.0) * (isHead() ? 1.0 : 0.0);
          vec3 dead = mix(vec3(l) * vec3(0.8, 0.9, 0.75), rotC, 0.92) * 1.15;
          dead = mix(dead, vec3(l) * 0.35, hair);
          // Sunken, bruised sockets round the eyes.
          float sock = max(smoothstep(0.042, 0.012, distance(vBind, eyeA)), smoothstep(0.042, 0.012, distance(vBind, eyeB)));
          dead = mix(dead, vec3(0.03, 0.01, 0.02), sock * 0.92);
          diffuseColor.rgb = mix(dead, vec3(0.09, 0.005, 0.005), bl * 0.95);
        } else {
          // Clothes: grey, filthy; torn patches show the wound beneath; blood soaking down.
          float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          vec3 cloth = mix(vec3(l), diffuseColor.rgb, 0.3) * 0.075;
          float d = tri3(dirtMap, vBind * 1.5, vBindN).r;
          cloth = mix(cloth, vec3(0.05, 0.04, 0.03), d * 0.8);
          float n = tri3(tearMap, vBind * 2.4, vBindN).r;
          float torn = smoothstep(1.0 - tear, 1.0 - tear + 0.015, n);
          float fray = smoothstep(1.0 - tear - 0.04, 1.0 - tear, n) * (1.0 - torn);
          vec3 wound = mix(vec3(0.055, 0.006, 0.005), rotC * vec3(0.35, 0.18, 0.15), 0.4);
          cloth = mix(cloth, vec3(0.02, 0.015, 0.01), fray);
          cloth = mix(cloth, wound, torn);
          diffuseColor.rgb = mix(cloth, vec3(0.07, 0.003, 0.003), bl);
        }`,
      )
      .replace(
        "#include <alphamap_fragment>",
        `#include <alphamap_fragment>
        #ifdef DEBUG_REGIONS
        diffuseColor.rgb = isEye() ? vec3(1.0, 1.0, 0.0) : isHead() ? vec3(1.0, 0.0, 0.0) : isSkin() ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
        #endif`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = isEye() ? 0.1 : mix((isHead() || isSkin()) ? 0.66 : 0.95, 0.42, bloodMask());`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        if ((isHead() || isSkin()) && !isEye() && vBind.y - eyeA.y < 0.04) {
          vec3 rn = tri3(rotNor, vBind * 3.0, vBindN) * 2.0 - 1.0;
          normal = normalize(normal + vec3(rn.xy, 0.0) * 0.25);
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        if (isEye()) totalEmissiveRadiance = vec3(0.35, 0.38, 0.25);`,
      );
  };
  if (location.search.includes("debug=regions")) m.defines = { DEBUG_REGIONS: "" };
  m.customProgramCacheKey = () => `zombie:${opts.tear ?? 0.25}:${opts.blood ?? 0.6}`;
  h.mesh.material = m;
  return m;
}

const bone = new MeshStandardMaterial({ color: 0xcdbf9e, roughness: 0.55 });
const gore = new MeshPhysicalMaterial({ color: 0x3a0505, roughness: 0.25, clearcoat: 0.6 });

/** Exposed ribs through a torn side of the chest. */
function ribs(h: Human, fit: Fit, side: 1 | -1): void {
  const ch = fit.box.chest!;
  const g = new Group();
  for (let i = 0; i < 5; i++) {
    const y = fit.rest.chest.y + 0.08 - i * 0.045;
    const r = 0.11 - Math.abs(i - 2) * 0.006;
    const rib = new Mesh(new TorusGeometry(r, 0.0075, 6, 16, Math.PI * 0.55), bone);
    rib.position.set((ch.min.x + ch.max.x) / 2, y, (ch.min.z + ch.max.z) / 2);
    rib.rotation.x = Math.PI / 2 - 0.25;
    rib.rotation.z = side > 0 ? -0.15 : Math.PI + 0.15;
    rib.castShadow = true;
    g.add(rib);
  }
  const wound = new Mesh(new SphereGeometry(0.075, 16, 12), gore);
  wound.position.set((ch.min.x + ch.max.x) / 2 + side * 0.1, fit.rest.chest.y - 0.02, (ch.min.z + ch.max.z) / 2 + 0.02);
  wound.scale.set(0.5, 1.4, 1.1);
  g.add(wound);
  ride(h, fit, "chest", g);
}

/** A bare forearm bone where the flesh is gone. */
function armBone(h: Human, fit: Fit, s: "L" | "R"): void {
  const fa = fit.box[`foreArm${s}` as BoneName]!;
  const len = (fa.max.y - fa.min.y) * 0.6;
  const b = new Mesh(new CylinderGeometry(0.011, 0.013, len, 8), bone);
  b.position.set((fa.min.x + fa.max.x) / 2 + (s === "L" ? 0.03 : -0.03), (fa.min.y + fa.max.y) / 2, (fa.min.z + fa.max.z) / 2 + 0.02);
  ride(h, fit, `foreArm${s}` as BoneName, b);
}

/** A cracked gas mask (the Masked): a rubber face, two dark lenses, one cracked, a filter. */
function gasMask(h: Human, fit: Fit): void {
  const head = fit.box.head!;
  const c = head.min.clone().add(head.max).multiplyScalar(0.5);
  const r = head.max.clone().sub(head.min).multiplyScalar(0.5);
  const g = new Group();
  const rubber = new MeshStandardMaterial({ color: 0x1b1d1a, roughness: 0.6 });
  const face = new SphereGeometry(1, 24, 16, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.25, Math.PI * 0.55);
  face.scale(r.x * 1.12, r.y * 1.0, r.z * 1.12);
  g.add(put(face, rubber, [c.x, c.y - 0.01, c.z], rotY(Math.PI)));
  const lens = new MeshPhysicalMaterial({ color: 0x0a0c0a, roughness: 0.05, clearcoat: 1, emissive: 0x404a20, emissiveIntensity: 0.5 });
  for (const e of [fit.rest.eyeL, fit.rest.eyeR]) {
    const l = put(new CylinderGeometry(0.024, 0.024, 0.012, 20), lens, [e.x, e.y + 0.004, c.z + r.z * 1.08]);
    l.quaternion.copy(rotX(Math.PI / 2));
    g.add(l);
    const ring = put(new TorusGeometry(0.025, 0.004, 6, 20), rubber, [e.x, e.y + 0.004, c.z + r.z * 1.1]);
    g.add(ring);
  }
  const filt = put(new CylinderGeometry(0.03, 0.034, 0.05, 20), rubber, [c.x, c.y - r.y * 0.55, c.z + r.z * 1.1]);
  filt.quaternion.copy(rotX(Math.PI / 2 - 0.4));
  g.add(filt);
  ride(h, fit, "head", g);
}

/** The bloater's swollen belly, pocked with pustules. */
function belly(h: Human, fit: Fit): void {
  const sp = fit.rest.spine;
  const tb = fit.box.spine ?? fit.box.chest!;
  const m = new MeshPhysicalMaterial({ map: rotTex!, normalMap: rotN!, roughness: 0.4, clearcoat: 0.4, color: 0x8a9076 });
  const b = put(new SphereGeometry(1, 32, 24), m, [sp.x, sp.y - 0.02, tb.max.z - 0.07]);
  b.scale.set(0.19, 0.2, 0.13);
  const g = new Group();
  g.add(b);
  const pus = new MeshPhysicalMaterial({ color: 0xc9b24a, roughness: 0.2, clearcoat: 1, emissive: 0x4a3a00, emissiveIntensity: 0.4 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 1.6 - 0.8;
    const p = put(new SphereGeometry(0.012 + (i % 3) * 0.006, 10, 8), pus, [sp.x + Math.sin(a) * 0.15, sp.y - 0.03 + Math.cos(i * 1.7) * 0.1, tb.max.z + 0.03 + Math.cos(a) * 0.035]);
    g.add(p);
  }
  ride(h, fit, "spine", g);
}

export interface Zombie {
  h: Human;
  fit: Fit;
  kind: ZKind;
}

export function zombie(kind: ZKind, seed = 1): Zombie {
  const body = seed % 3 === 1 ? "f" : "m";
  const look = cleanLook({ body, skin: (seed * 3) % 8, hair: "lowcut", outfit: "street", extras: [], height: 1 });
  look.hoodie = [3, 1, 5, 7, 2, 0, 4, 8][seed % 8];
  look.design = (["plain", "twotone", "stripe", "plain", "block"] as const)[seed % 5];
  const h = new Human(look, 2, { featured: true, seed: seed * 0.37 });
  const fit = measure(h);
  dressZombie(h, [fit.rest.eyeL.clone(), fit.rest.eyeR.clone()], { tear: kind === "brute" ? 0.3 : kind === "crawler" ? 0.5 : 0.4, blood: kind === "screamer" ? 1 : 0.8 });
  if (kind === "shambler" || kind === "crawler" || kind === "brute") ribs(h, fit, seed % 2 ? 1 : -1);
  if (kind === "runner" || kind === "lurker") armBone(h, fit, seed % 2 ? "L" : "R");
  if (kind === "masked") gasMask(h, fit);
  if (kind === "bloater") belly(h, fit);
  const sc = kind === "brute" ? 1.22 : kind === "bloater" ? 1.05 : 1;
  h.mesh.scale.set(sc * (kind === "brute" ? 1.12 : kind === "bloater" ? 1.18 : 1), sc, sc * (kind === "bloater" ? 1.15 : 1));
  h.mesh.castShadow = true;
  return { h, fit, kind };
}

/** Pose a zombie (and settle the gait); `t` (0…1) picks a moment of an action where it has one. */
export function poseZombie(z: Zombie, yaw = 0, t = 0.5): void {
  const h = z.h;
  h.mesh.rotation.y = yaw;
  const speed = z.kind === "runner" ? 6 : z.kind === "crawler" ? 0.4 : z.kind === "lurker" ? 0 : z.kind === "brute" ? 2.6 : 0.9;
  const stance = z.kind === "crawler" ? 2 : 0;
  for (let s = 0; s < 1.4 + t * 0.6; s += 1 / 60) h.update(1 / 60, speed, stance);
  h.mesh.updateMatrixWorld(true);
  const fwd = new Vector3(0, 0, 1).applyQuaternion(h.mesh.quaternion);
  const left = new Vector3(1, 0, 0).applyQuaternion(h.mesh.quaternion);
  const up = new Vector3(0, 1, 0);
  const at = (b: BoneName) => h.bone(b).getWorldPosition(new Vector3());
  const tilt = (b: BoneName, axis: Vector3, a: number) => turnWorld(h.bone(b), new Quaternion().setFromAxisAngle(axis, a));
  const sc = h.mesh.scale.y;
  // Hunch.
  if (z.kind !== "crawler") tilt("spine", left, z.kind === "brute" ? 0.32 : z.kind === "runner" ? 0.4 : 0.18);
  if (z.kind === "shambler" || z.kind === "masked" || z.kind === "bloater") {
    // Arms out, reaching; head lolling to one side.
    const ch = at("chest");
    reach(h, "R", ch.clone().addScaledVector(fwd, 0.55 * sc).addScaledVector(left, -0.18 * sc).addScaledVector(up, 0.02), at("upperArmR").addScaledVector(up, -0.3).addScaledVector(left, -0.3));
    reach(h, "L", ch.clone().addScaledVector(fwd, 0.5 * sc).addScaledVector(left, 0.22 * sc).addScaledVector(up, -0.08), at("upperArmL").addScaledVector(up, -0.3).addScaledVector(left, 0.3));
    tilt("head", fwd, 0.35);
    tilt("head", left, 0.15);
  } else if (z.kind === "screamer") {
    // Head thrown back, arms flung wide, jaw open.
    tilt("spine", left, -0.35);
    tilt("head", left, -0.5);
    const ch = at("chest");
    reach(h, "R", ch.clone().addScaledVector(left, -0.6 * sc).addScaledVector(up, 0.15).addScaledVector(fwd, 0.1), at("upperArmR").addScaledVector(up, -0.4));
    reach(h, "L", ch.clone().addScaledVector(left, 0.6 * sc).addScaledVector(up, 0.12).addScaledVector(fwd, 0.1), at("upperArmL").addScaledVector(up, -0.4));
  } else if (z.kind === "brute") {
    const ch = at("chest");
    reach(h, "R", ch.clone().addScaledVector(fwd, 0.3 * sc).addScaledVector(left, -0.42 * sc).addScaledVector(up, -0.35), at("upperArmR").addScaledVector(left, -0.5));
    reach(h, "L", ch.clone().addScaledVector(fwd, 0.35 * sc).addScaledVector(left, 0.42 * sc).addScaledVector(up, -0.3), at("upperArmL").addScaledVector(left, 0.5));
    tilt("head", left, 0.25);
  } else if (z.kind === "lurker") {
    // Waist-deep, reaching up out of the water.
    const ch = at("chest");
    reach(h, "R", ch.clone().addScaledVector(fwd, 0.4).addScaledVector(up, 0.25).addScaledVector(left, -0.15), at("upperArmR").addScaledVector(left, -0.4));
    reach(h, "L", ch.clone().addScaledVector(fwd, 0.45).addScaledVector(up, 0.1).addScaledVector(left, 0.2), at("upperArmL").addScaledVector(left, 0.4));
    tilt("head", left, 0.3);
  } else if (z.kind === "runner") {
    tilt("head", left, -0.2);
  }
  // Slack or snarling jaw.
  const jaw = h.bone("jaw");
  jaw.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), z.kind === "screamer" ? 0.55 : z.kind === "masked" ? 0 : 0.28);
  jaw.updateMatrix();
  // Fingers clawed.
  for (const s of ["L", "R"] as const)
    for (const f of ["index", "middle", "ring", "pinky"])
      for (const k of [1, 2]) {
        const b = h.bone(`${f}${k}${s}` as BoneName);
        b.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), (s === "L" ? -1 : 1) * (k === 1 ? 0.5 : 0.9));
        b.updateMatrix();
      }
  h.posed();
  void aimBone;
}

export function rubbleMat(): Material {
  return new MeshStandardMaterial({ color: 0x3a3632, roughness: 0.9 });
}

export { horn };
