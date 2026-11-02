// Dev only (concept renders): the world kit for the location vistas. Every
// repeated thing is an InstancedMesh (one draw for a whole forest), every
// texture is a Poly Haven CC0 set or painted here; terrain is a displaced grid.
// The runtime version streams these per 64 m cell with 3–4 LODs (see PLAN).

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { phMat, phTex, sunDir } from "./sets";
import { canvas, fbm, normalFrom, perlin, tex } from "./tex";
import { hdri, useSky } from "./stage";

let seed = 11;
export const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
export const reseedW = (s: number) => (seed = s);

// ── Sky and sun ──────────────────────────────────────────────────────────────

export interface Sky {
  sun: Vector3;
  light: DirectionalLight;
}

/** HDRI sky and light, rotated so the sun sits at azimuth `az` (radians, 0 = +X, π/2 = +Z). */
export async function sky(scene: Scene, name: string, o: { az?: number; intensity?: number; sunI?: number; sunColor?: number; fog?: number; fogColor?: number; bg?: number; shadow?: number; hemi?: [number, number, number] } = {}): Promise<Sky> {
  const t = await hdri(name);
  const s = sunDir(t);
  const az = Math.atan2(s.z, s.x);
  const want = o.az ?? az;
  await useSky(scene, name, { background: true, intensity: o.intensity ?? 1, bgIntensity: o.bg ?? 1, rotation: want - az });
  const el = Math.asin(Math.max(-1, Math.min(1, s.y)));
  const dir = new Vector3(Math.cos(want) * Math.cos(el), Math.sin(el), Math.sin(want) * Math.cos(el));
  const light = new DirectionalLight(o.sunColor ?? 0xfff0dc, o.sunI ?? 3);
  light.position.copy(dir).multiplyScalar(300);
  light.castShadow = true;
  light.shadow.mapSize.set(4096, 4096);
  const sz = o.shadow ?? 60;
  const sc = light.shadow.camera;
  sc.left = -sz;
  sc.right = sz;
  sc.top = sz;
  sc.bottom = -sz;
  sc.near = 10;
  sc.far = 800;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.05;
  scene.add(light, light.target);
  if (o.hemi) scene.add(new HemisphereLight(o.hemi[0], o.hemi[1], o.hemi[2]));
  if (o.fog) scene.fog = new FogExp2(o.fogColor ?? 0xb0b8c0, o.fog);
  return { sun: dir.clone().multiplyScalar(2000), light };
}

// ── Terrain ──────────────────────────────────────────────────────────────────

export type HeightFn = (x: number, z: number) => number;

export function terrain(scene: Scene, size: number, seg: number, h: HeightFn, mat: Material): Mesh {
  const g = new PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, h(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const m = new Mesh(g, mat);
  m.receiveShadow = true;
  m.castShadow = true;
  scene.add(m);
  return m;
}

export function groundMat(name: string, repeat: number, tint?: number): MeshStandardMaterial {
  const m = phMat(name, repeat, {} as never);
  if (tint) m.color = new Color(tint);
  return m;
}

// ── Instancing ───────────────────────────────────────────────────────────────

export function instance(scene: Scene, geo: BufferGeometry, mat: Material | Material[], placements: { p: Vector3; s: number | Vector3; ry?: number; rx?: number; rz?: number }[], shadow = true): InstancedMesh {
  const im = new InstancedMesh(geo, mat, placements.length);
  const m = new Matrix4();
  const q = new Quaternion();
  placements.forEach((pl, i) => {
    q.setFromAxisAngle(new Vector3(0, 1, 0), pl.ry ?? 0);
    if (pl.rx || pl.rz) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pl.rx ?? 0)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pl.rz ?? 0));
    const s = typeof pl.s === "number" ? new Vector3(pl.s, pl.s, pl.s) : pl.s;
    m.compose(pl.p, q, s);
    im.setMatrixAt(i, m);
  });
  im.castShadow = shadow;
  im.receiveShadow = true;
  scene.add(im);
  return im;
}

// ── Vegetation ───────────────────────────────────────────────────────────────

/** A leafy card: hundreds of leaves on twigs, RGBA. */
function leafCard(hue: [number, number, number], needle = false): Texture {
  const [c, g] = canvas(512);
  const n = needle ? 900 : 520;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 230;
    const x = 256 + Math.cos(a) * r;
    const y = 256 + Math.sin(a) * r * 0.9;
    const k = 0.55 + rnd() * 0.6;
    g.fillStyle = `rgb(${Math.round(hue[0] * k)},${Math.round(hue[1] * k)},${Math.round(hue[2] * k)})`;
    g.save();
    g.translate(x, y);
    g.rotate(a + rnd() - 0.5);
    g.beginPath();
    if (needle) g.ellipse(0, 0, 14 + rnd() * 8, 1.6, 0, 0, Math.PI * 2);
    else g.ellipse(0, 0, 9 + rnd() * 7, 4 + rnd() * 3, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const t = tex(c, { clamp: true });
  return t;
}

/** Broadleaf or conifer: a trunk and crossed leaf cards, merged (≈ 300 triangles; far LOD a 2-card impostor). */
export function treeGeo(kind: "broad" | "pine" | "palm" | "dead"): { trunk: BufferGeometry; leaves: BufferGeometry | null } {
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(kind === "pine" ? 0.12 : 0.16, kind === "pine" ? 0.32 : 0.36, kind === "palm" ? 9 : 7, 8, 4);
  trunk.translate(0, kind === "palm" ? 4.5 : 3.5, 0);
  if (kind === "palm") {
    const p = trunk.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.pow(p.getY(i) / 9, 2) * 1.2);
  }
  if (kind === "dead") {
    for (let i = 0; i < 6; i++) {
      const b = new CylinderGeometry(0.03, 0.09, 2.6, 6);
      b.translate(0, 1.3, 0);
      b.rotateZ(0.6 + rnd() * 0.5);
      b.rotateY(rnd() * Math.PI * 2);
      b.translate(0, 3.5 + rnd() * 3, 0);
      parts.push(b);
    }
  }
  parts.push(trunk);
  const cards: BufferGeometry[] = [];
  if (kind === "broad") {
    for (let i = 0; i < 26; i++) {
      const c = new PlaneGeometry(3.2, 3.2);
      c.rotateY(rnd() * Math.PI);
      c.rotateX((rnd() - 0.5) * 0.9);
      const a = rnd() * Math.PI * 2;
      const r = rnd() * 1.8;
      c.translate(Math.cos(a) * r, 5.2 + rnd() * 3.2, Math.sin(a) * r);
      cards.push(c);
    }
  } else if (kind === "pine") {
    for (let lv = 0; lv < 8; lv++) {
      const y = 2.5 + lv * 0.95;
      const r = 2.3 * (1 - lv / 9);
      for (let i = 0; i < 4; i++) {
        const c = new PlaneGeometry(r * 2.2, 1.6);
        c.rotateX(-0.25);
        c.translate(0, 0, r * 0.4);
        c.rotateY((i / 4) * Math.PI * 2 + lv * 0.4);
        c.translate(0, y, 0);
        cards.push(c);
      }
    }
  } else if (kind === "palm") {
    for (let i = 0; i < 10; i++) {
      const c = new PlaneGeometry(4.2, 1.1, 6, 1);
      const p = c.attributes.position;
      for (let k = 0; k < p.count; k++) p.setY(k, p.getY(k) - Math.pow((p.getX(k) + 2.1) / 4.2, 2) * 1.4);
      c.translate(2.1, 0, 0);
      c.rotateY((i / 10) * Math.PI * 2);
      c.translate(1.2, 9, 0);
      cards.push(c);
    }
  }
  const tg = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  return { trunk: tg, leaves: cards.length ? mergeGeometries(cards.map((g) => g.toNonIndexed())) : null };
}

export function forest(scene: Scene, kind: "broad" | "pine" | "palm" | "dead", spots: { p: Vector3; s: number; ry: number }[], hue: [number, number, number]): void {
  const g = treeGeo(kind);
  const bark = phMat("brown_mud_leaves_01", 1, { color: new Color(kind === "dead" ? 0x4a4038 : 0x5a4a3c) } as never);
  instance(scene, g.trunk, bark, spots);
  if (g.leaves) {
    const leaf = new MeshStandardMaterial({ map: leafCard(hue, kind === "pine"), alphaTest: 0.45, side: DoubleSide, roughness: 0.85 });
    instance(scene, g.leaves, leaf, spots);
  }
}

export function rocks(scene: Scene, spots: { p: Vector3; s: number | Vector3; ry: number }[], texName = "aerial_rocks_02", tint = 0x9a948c): void {
  const geo = new IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const k = 1 + perlin(v.x * 2 + 3, v.z * 2 + v.y * 1.7) * 0.32;
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y * 0.7, v.z);
  }
  geo.computeVertexNormals();
  const m = phMat(texName, 1, { color: new Color(tint), flatShading: true } as never);
  instance(scene, geo, m, spots);
}

/** Grass tufts near the camera (cards). */
export function grass(scene: Scene, spots: { p: Vector3; s: number; ry: number }[], hue: [number, number, number]): void {
  const [c, g] = canvas(256);
  for (let i = 0; i < 160; i++) {
    const x = 20 + rnd() * 216;
    const k = 0.5 + rnd() * 0.6;
    g.strokeStyle = `rgb(${Math.round(hue[0] * k)},${Math.round(hue[1] * k)},${Math.round(hue[2] * k)})`;
    g.lineWidth = 2 + rnd() * 2;
    g.beginPath();
    g.moveTo(x, 256);
    g.quadraticCurveTo(x + (rnd() - 0.5) * 40, 160, x + (rnd() - 0.5) * 70, 30 + rnd() * 120);
    g.stroke();
  }
  const t = tex(c, { clamp: true });
  const a = new PlaneGeometry(1, 0.7);
  a.translate(0, 0.35, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const geo = mergeGeometries([a, b]);
  instance(scene, geo, new MeshStandardMaterial({ map: t, alphaTest: 0.4, side: DoubleSide, roughness: 0.9 }), spots, false);
}

// ── Structures ───────────────────────────────────────────────────────────────

const facadeCache = new Map<string, Texture>();
/** A tower facade: a grid of windows (some lit), floors and columns. */
export function facade(kind: "glass" | "concrete" | "ruin", lit = 0.08): Texture {
  const key = `${kind}:${lit}`;
  let t = facadeCache.get(key);
  if (t) return t;
  const [c, g] = canvas(512, 1024);
  g.fillStyle = kind === "glass" ? "#1d2a33" : kind === "concrete" ? "#8b8780" : "#6f6a64";
  g.fillRect(0, 0, 512, 1024);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 8; x++) {
      const r = rnd();
      const broken = kind === "ruin" && r < 0.25;
      g.fillStyle = broken ? "#050505" : r < lit ? `rgba(255,${180 + Math.round(rnd() * 60)},${110 + Math.round(rnd() * 80)},1)` : kind === "glass" ? `rgba(${60 + rnd() * 40},${90 + rnd() * 40},${110 + rnd() * 40},1)` : `rgba(${20 + rnd() * 20},${24 + rnd() * 20},${28 + rnd() * 20},1)`;
      g.fillRect(x * 64 + 8, y * 32 + 6, 48, 22);
    }
  if (kind !== "glass") {
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`;
      g.fillRect(rnd() * 512, rnd() * 1024, 2 + rnd() * 10, 2 + rnd() * 20);
    }
  }
  t = tex(c);
  facadeCache.set(key, t);
  return t;
}

export function towers(scene: Scene, spots: { p: Vector3; w: number; d: number; h: number; kind: "glass" | "concrete" | "ruin"; lit?: number }[]): void {
  for (const s of spots) {
    const map = facade(s.kind, s.lit ?? 0.08).clone();
    map.repeat.set(s.w / 24, s.h / 48);
    map.needsUpdate = true;
    const emissive = s.kind !== "ruin" && (s.lit ?? 0) > 0.15;
    const m = new MeshStandardMaterial({ map, roughness: s.kind === "glass" ? 0.15 : 0.8, metalness: s.kind === "glass" ? 0.6 : 0, emissiveMap: emissive ? map : null, emissive: emissive ? 0xffffff : 0x000000, emissiveIntensity: emissive ? 0.6 : 0 });
    const b = new Mesh(new BoxGeometry(s.w, s.h, s.d), m);
    b.position.set(s.p.x, s.p.y + s.h / 2, s.p.z);
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
    if (s.kind === "ruin") {
      // A shattered crown.
      for (let i = 0; i < 3; i++) {
        const chunk = new Mesh(new BoxGeometry(s.w * (0.3 + rnd() * 0.4), 2 + rnd() * 5, s.d * (0.3 + rnd() * 0.4)), m);
        chunk.position.set(s.p.x + (rnd() - 0.5) * s.w * 0.5, s.p.y + s.h + 1, s.p.z + (rnd() - 0.5) * s.d * 0.5);
        chunk.rotation.set(rnd() * 0.3, rnd(), rnd() * 0.3);
        chunk.castShadow = true;
        scene.add(chunk);
      }
    }
  }
}

/** Wind turbine: tower, nacelle, hub, three blades (blades turn at runtime). ≈ 700 triangles. */
export function turbine(scale = 1, bladeAngle = 0): Group {
  const g = new Group();
  const white = new MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.6, metalness: 0.05 });
  const tower = new Mesh(new CylinderGeometry(1.1, 2.0, 80, 20), white);
  tower.position.y = 40;
  g.add(tower);
  const nac = new Mesh(new BoxGeometry(3.2, 3.4, 9), white);
  nac.position.set(0, 81, -1.5);
  g.add(nac);
  const hub = new Mesh(new SphereGeometry(1.7, 16, 12), white);
  hub.position.set(0, 81, 3.4);
  g.add(hub);
  const rotor = new Group();
  rotor.position.set(0, 81, 3.8);
  rotor.rotation.z = bladeAngle;
  for (let i = 0; i < 3; i++) {
    const blade = new Mesh(new BoxGeometry(2.6, 44, 0.5), white);
    const p = blade.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const t = (p.getY(k) + 22) / 44;
      p.setX(k, p.getX(k) * (1 - t * 0.75));
    }
    blade.geometry.computeVertexNormals();
    blade.position.y = 23;
    const arm = new Group();
    arm.add(blade);
    arm.rotation.z = (i * Math.PI * 2) / 3;
    rotor.add(arm);
  }
  g.add(rotor);
  const blink = new Mesh(new SphereGeometry(0.35, 8, 6), new MeshBasicMaterial({ color: new Color(0xff2a20).multiplyScalar(6) }));
  blink.position.set(0, 83, -2);
  g.add(blink);
  g.scale.setScalar(scale);
  g.traverse((o) => ((o as Mesh).castShadow = (o as Mesh).receiveShadow = true));
  return g;
}

/** Shipping container (6 m or 12 m), corrugated sides, a colour. */
export function containers(scene: Scene, spots: { p: Vector3; long: boolean; ry: number; color: number }[]): void {
  const corr = normalFrom(256, 256, (u) => Math.sin(u * Math.PI * 2 * 24) * 0.5 + 0.5, 3);
  const nmap = tex(corr, { srgb: false, repeat: [2, 1] });
  const byColor = new Map<number, typeof spots>();
  for (const s of spots) (byColor.get(s.color) ?? byColor.set(s.color, []).get(s.color)!).push(s);
  for (const [color, list] of byColor) {
    const m = new MeshStandardMaterial({ color, normalMap: nmap, roughness: 0.6, metalness: 0.5, roughnessMap: phTex("rusty_metal_02", "rough", 1) });
    const longs = list.filter((s) => s.long);
    const shorts = list.filter((s) => !s.long);
    if (longs.length) instance(scene, new BoxGeometry(2.44, 2.6, 12.2), m, longs.map((s) => ({ p: s.p.clone().add(new Vector3(0, 1.3, 0)), s: 1, ry: s.ry })));
    if (shorts.length) instance(scene, new BoxGeometry(2.44, 2.6, 6.1), m, shorts.map((s) => ({ p: s.p.clone().add(new Vector3(0, 1.3, 0)), s: 1, ry: s.ry })));
  }
}

/** A gantry crane: legs, girder, boom, cab (boxes; ≈ 400 triangles). */
export function crane(color = 0xd94b1e): Group {
  const g = new Group();
  const m = new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.4 });
  for (const x of [-9, 9])
    for (const z of [-8, 8]) {
      const leg = new Mesh(new BoxGeometry(1.4, 46, 1.4), m);
      leg.position.set(x, 23, z);
      g.add(leg);
    }
  const girder = new Mesh(new BoxGeometry(22, 4, 3), m);
  girder.position.set(0, 46, 0);
  g.add(girder);
  const boom = new Mesh(new BoxGeometry(3, 3, 70), m);
  boom.position.set(0, 44, 22);
  g.add(boom);
  const cab = new Mesh(new BoxGeometry(4, 3, 4), new MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4 }));
  cab.position.set(0, 40, 12);
  g.add(cab);
  for (let z = -8; z <= 8; z += 4) {
    const brace = new Mesh(new BoxGeometry(0.4, 20, 0.4), m);
    brace.position.set(-9, 30, z);
    brace.rotation.x = 0.5;
    g.add(brace);
  }
  g.traverse((o) => ((o as Mesh).castShadow = (o as Mesh).receiveShadow = true));
  return g;
}

/** Oil storage tank with a walkway. */
export function tank(r = 14, h = 16): Group {
  const g = new Group();
  const m = phMat("rusty_metal_02", 2, { color: new Color(0xb8b2a8), metalness: 0.5 } as never);
  const t = new Mesh(new CylinderGeometry(r, r, h, 48), m);
  t.position.y = h / 2;
  g.add(t);
  const roof = new Mesh(new SphereGeometry(r, 48, 8, 0, Math.PI * 2, 0, 0.35), m);
  roof.position.y = h - r * Math.cos(0.35);
  g.add(roof);
  const rail = new Mesh(new TorusGeometry(r + 0.2, 0.08, 6, 64), new MeshStandardMaterial({ color: 0x2a2a2a }));
  rail.rotation.x = Math.PI / 2;
  rail.position.y = h + 1;
  g.add(rail);
  g.traverse((o) => ((o as Mesh).castShadow = (o as Mesh).receiveShadow = true));
  return g;
}

/** A flare stack with its flame. */
export function flare(height = 60): Group {
  const g = new Group();
  const m = new MeshStandardMaterial({ color: 0x5a5550, roughness: 0.6, metalness: 0.5 });
  const s = new Mesh(new CylinderGeometry(0.8, 1.4, height, 12), m);
  s.position.y = height / 2;
  g.add(s);
  const fl = new Mesh(new ConeGeometry(2.2, 9, 12, 1, true), new MeshBasicMaterial({ color: new Color(0xff7a20).multiplyScalar(8), transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide }));
  fl.position.y = height + 4;
  g.add(fl);
  const core = new Mesh(new ConeGeometry(1.1, 6, 12, 1, true), new MeshBasicMaterial({ color: new Color(0xffe0a0).multiplyScalar(12), transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide }));
  core.position.y = height + 3;
  g.add(core);
  return g;
}

/** Water: dark, glossy, rippled, reflecting the sky. */
export function water(scene: Scene, size: number, y: number, color = 0x0d1f26): Mesh {
  const n = normalFrom(512, 512, (u, v) => fbm(u * 8, v * 8, 4, 8) * 0.5 + 0.5, 1.5);
  const m = new MeshPhysicalMaterial({ color, roughness: 0.06, metalness: 0.0, normalMap: tex(n, { srgb: false, repeat: [size / 30, size / 30] }), clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.55 });
  const w = new Mesh(new PlaneGeometry(size, size), m);
  w.rotation.x = -Math.PI / 2;
  w.position.y = y;
  w.receiveShadow = true;
  scene.add(w);
  return w;
}

/** Neon sign: text glowing in a colour, on a dark backplate. */
export function neon(text: string, color: string, w = 6, h = 1.6): Mesh {
  const [c, g] = canvas(1024, Math.round((1024 * h) / w));
  g.fillStyle = "#050507";
  g.fillRect(0, 0, c.width, c.height);
  g.font = `900 ${Math.round(c.height * 0.62)}px Montserrat, Inter, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = color;
  g.shadowBlur = 30;
  g.fillStyle = color;
  g.fillText(text, c.width / 2, c.height / 2);
  g.shadowBlur = 0;
  g.fillStyle = "#ffffff";
  g.globalAlpha = 0.65;
  g.fillText(text, c.width / 2, c.height / 2);
  const t = tex(c);
  return new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 3.2, roughness: 0.4 }));
}

export function scatter(n: number, area: (i: number) => [number, number] | null, h: HeightFn, sMin: number, sMax: number): { p: Vector3; s: number; ry: number }[] {
  const out: { p: Vector3; s: number; ry: number }[] = [];
  for (let i = 0; i < n * 4 && out.length < n; i++) {
    const xz = area(i);
    if (!xz) continue;
    out.push({ p: new Vector3(xz[0], h(xz[0], xz[1]) - 0.05, xz[1]), s: sMin + rnd() * (sMax - sMin), ry: rnd() * Math.PI * 2 });
  }
  return out;
}

export { Float32BufferAttribute, Color };
