// Dev only (concept renders): the guns and the melee backup, and the rarity
// finishes (Common → Mythic). Each gun is built from a few dozen parts
// (≈2–4K triangles near, one 300-triangle stand-in far), +Z the muzzle, +Y up,
// origin at the butt. Finishes swap materials only: one gun mesh, six looks.

import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, TorusGeometry, Vector2, type BufferGeometry, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { carbon, chipped, engraved, filigreeNormal, scratches, tex, paint, fbm } from "./tex";

export const RARITIES = [
  { id: "common", name: "Common", color: "#b9bcc2" },
  { id: "uncommon", name: "Uncommon", color: "#3ccf6e" },
  { id: "rare", name: "Rare", color: "#3a9bff" },
  { id: "epic", name: "Epic", color: "#b65cff" },
  { id: "legendary", name: "Legendary", color: "#ffb020" },
  { id: "mythic", name: "Mythic", color: "#ff3b30" },
] as const;
export type Rarity = (typeof RARITIES)[number]["id"];

interface Finish {
  body: Material;
  accent: Material;
  furniture: Material;
  glow: Material;
  glass: Material;
}

const rough = tex(scratches(512, 150, 900), { srgb: false });

export function finish(r: Rarity): Finish {
  const glowCol = RARITIES.find((x) => x.id === r)!.color;
  const glass = new MeshPhysicalMaterial({ color: 0x9fd8c0, roughness: 0.05, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.14, depthWrite: false });
  switch (r) {
    case "common":
      return {
        body: new MeshStandardMaterial({ color: 0x1e1f21, roughnessMap: rough, roughness: 0.55, metalness: 0.7 }),
        accent: new MeshStandardMaterial({ color: 0x2b2c2e, roughness: 0.6, metalness: 0.6 }),
        furniture: new MeshStandardMaterial({ color: 0x232322, roughness: 0.85 }),
        glow: new MeshStandardMaterial({ color: 0x111111, emissive: 0xff2222, emissiveIntensity: 4 }),
        glass,
      };
    case "uncommon":
      return {
        body: new MeshStandardMaterial({ map: tex(chipped(512, "#3d4a35", "#1b1c1d", 0.12, 9)), roughnessMap: rough, roughness: 0.6, metalness: 0.4 }),
        accent: new MeshStandardMaterial({ color: 0x23251f, roughness: 0.5, metalness: 0.7 }),
        furniture: new MeshStandardMaterial({ map: tex(chipped(512, "#55603f", "#2b2d26", 0.1, 7)), roughness: 0.8 }),
        glow: new MeshStandardMaterial({ color: 0x111111, emissive: glowCol, emissiveIntensity: 4 }),
        glass,
      };
    case "rare":
      return {
        body: new MeshPhysicalMaterial({ color: 0x13325e, roughness: 0.28, metalness: 0.9, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
        accent: new MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.2, metalness: 1 }),
        furniture: new MeshStandardMaterial({ map: tex(carbon(512), { repeat: [3, 3] }), roughness: 0.35, metalness: 0.2 }),
        glow: new MeshStandardMaterial({ color: 0x111111, emissive: glowCol, emissiveIntensity: 6 }),
        glass,
      };
    case "epic":
      return {
        body: new MeshPhysicalMaterial({ color: 0x3a1460, roughness: 0.18, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.7, iridescenceIOR: 1.6 }),
        accent: new MeshStandardMaterial({ map: tex(engraved(512, "#cfd3dc", 8), { repeat: [2, 2] }), normalMap: tex(filigreeNormal(512, 8, 5), { srgb: false, repeat: [2, 2] }), roughness: 0.25, metalness: 1 }),
        furniture: new MeshStandardMaterial({ color: 0x17101f, roughness: 0.4, metalness: 0.3 }),
        glow: new MeshStandardMaterial({ color: 0x111111, emissive: glowCol, emissiveIntensity: 8 }),
        glass,
      };
    case "legendary":
      return {
        body: new MeshPhysicalMaterial({ map: tex(engraved(1024, "#e8b54a", 7), { repeat: [2, 1] }), normalMap: tex(filigreeNormal(1024, 7, 7), { srgb: false, repeat: [2, 1] }), normalScale: new Vector2(1.2, 1.2), roughness: 0.22, metalness: 1, clearcoat: 0.5 }),
        accent: new MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.15, metalness: 0.9, clearcoat: 1 }),
        furniture: new MeshStandardMaterial({ map: tex(paint(512, 512, (u, v) => { const n = fbm(u * 2, v * 14, 4, 2) * 0.5 + 0.5; return [60 + n * 70, 26 + n * 30, 12 + n * 10]; }), { repeat: [1, 1] }), roughness: 0.35, metalness: 0 }),
        glow: new MeshStandardMaterial({ color: 0x111111, emissive: glowCol, emissiveIntensity: 9 }),
        glass,
      };
    case "mythic":
      return {
        body: new MeshPhysicalMaterial({
          color: 0x0d0b0b,
          roughness: 0.25,
          metalness: 1,
          clearcoat: 1,
          emissiveMap: tex(paint(1024, 512, (u, v) => { const n = fbm(u * 8 + fbm(u * 3, v * 3, 2, 3), v * 4, 4, 8); const k = Math.pow(Math.max(0, 1 - Math.abs(n) / 0.05), 2) * 255; return [k, k * 0.25, k * 0.08]; }), { repeat: [1, 1] }),
          emissive: 0xff3010,
          emissiveIntensity: 5,
        }),
        accent: new MeshStandardMaterial({ map: tex(engraved(512, "#d23a22", 9), { repeat: [2, 2] }), normalMap: tex(filigreeNormal(512, 9, 6), { srgb: false, repeat: [2, 2] }), roughness: 0.2, metalness: 1 }),
        furniture: new MeshStandardMaterial({ color: 0x140808, roughness: 0.3, metalness: 0.4 }),
        glow: new MeshStandardMaterial({ color: 0x111111, emissive: glowCol, emissiveIntensity: 10 }),
        glass,
      };
  }
}

const rb = (w: number, h: number, d: number, r = 0.004) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
const cyl = (r0: number, r1: number, l: number, seg = 20) => new CylinderGeometry(r0, r1, l, seg).rotateX(Math.PI / 2);

function part(g: BufferGeometry, m: Material, x: number, y: number, z: number, rx = 0): Mesh {
  const o = new Mesh(g, m);
  o.position.set(x, y, z);
  o.rotation.x = rx;
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Picatinny rail along z from z0 to z1 at height y. */
function rail(g: Group, m: Material, y: number, z0: number, z1: number, w = 0.022): void {
  g.add(part(rb(w, 0.006, z1 - z0, 0.001), m, 0, y, (z0 + z1) / 2));
  for (let z = z0 + 0.006; z < z1; z += 0.01) g.add(part(new BoxGeometry(w + 0.003, 0.004, 0.005), m, 0, y + 0.004, z));
}

/** Assault rifle: 0.86 m, holographic sight, light, angled foregrip. */
export function rifle(r: Rarity = "common"): Group {
  const F = finish(r);
  const g = new Group();
  g.name = "rifle";
  // Stock and buffer tube.
  g.add(part(rb(0.04, 0.085, 0.16, 0.01), F.furniture, 0, 0.0, 0.08));
  g.add(part(rb(0.044, 0.1, 0.02, 0.008), F.accent, 0, -0.004, 0.005));
  g.add(part(cyl(0.014, 0.014, 0.12), F.body, 0, 0.03, 0.2));
  // Lower and upper receivers.
  g.add(part(rb(0.032, 0.055, 0.2, 0.004), F.body, 0, 0.012, 0.33));
  g.add(part(rb(0.036, 0.05, 0.26, 0.004), F.body, 0, 0.06, 0.36));
  rail(g, F.accent, 0.088, 0.24, 0.47);
  // Magwell and a curved magazine.
  g.add(part(rb(0.03, 0.05, 0.07, 0.003), F.body, 0, -0.03, 0.39));
  for (let i = 0; i < 4; i++) g.add(part(rb(0.026, 0.055, 0.064, 0.004), F.accent, 0, -0.07 - i * 0.045, 0.395 + i * 0.012, -0.12 - i * 0.07));
  // Pistol grip.
  g.add(part(rb(0.03, 0.11, 0.04, 0.008), F.furniture, 0, -0.045, 0.29, 0.32));
  g.add(part(rb(0.006, 0.03, 0.05, 0.002), F.accent, 0, -0.01, 0.31));
  // Handguard (M-LOK slots as dark inserts) and the barrel.
  g.add(part(rb(0.045, 0.052, 0.34, 0.008), F.body, 0, 0.058, 0.66));
  for (let z = 0.53; z < 0.8; z += 0.045) for (const s of [-1, 1]) g.add(part(new BoxGeometry(0.002, 0.014, 0.03), F.furniture, s * 0.0231, 0.058, z));
  rail(g, F.accent, 0.088, 0.5, 0.82);
  g.add(part(cyl(0.008, 0.008, 0.14), F.body, 0, 0.06, 0.88));
  g.add(part(cyl(0.013, 0.013, 0.055), F.accent, 0, 0.06, 0.96));
  for (let i = 0; i < 3; i++) g.add(part(new TorusGeometry(0.0132, 0.0018, 6, 18), F.body, 0, 0.06, 0.94 + i * 0.016));
  // Angled foregrip, weapon light, sling loop.
  g.add(part(rb(0.026, 0.05, 0.06, 0.008), F.furniture, 0, 0.012, 0.6, 0.5));
  g.add(part(cyl(0.012, 0.012, 0.08), F.accent, 0.03, 0.06, 0.75));
  g.add(part(cyl(0.0125, 0.0125, 0.004), F.glass, 0.03, 0.06, 0.79));
  // Holographic sight.
  g.add(part(rb(0.04, 0.012, 0.075, 0.003), F.body, 0, 0.1, 0.32));
  g.add(part(rb(0.042, 0.05, 0.008, 0.003), F.accent, 0, 0.125, 0.295));
  g.add(part(rb(0.042, 0.05, 0.008, 0.003), F.accent, 0, 0.125, 0.355));
  g.add(part(rb(0.004, 0.05, 0.068, 0.002), F.accent, -0.019, 0.125, 0.325));
  g.add(part(rb(0.004, 0.05, 0.068, 0.002), F.accent, 0.019, 0.125, 0.325));
  g.add(part(rb(0.042, 0.004, 0.068, 0.002), F.accent, 0, 0.15, 0.325));
  g.add(part(new BoxGeometry(0.034, 0.038, 0.002), F.glass, 0, 0.124, 0.355));
  g.add(part(new BoxGeometry(0.004, 0.004, 0.001), F.glow, 0, 0.124, 0.354));
  return g;
}

/** SMG: compact, suppressed, folding stock, straight magazine. */
export function smg(r: Rarity = "common"): Group {
  const F = finish(r);
  const g = new Group();
  g.name = "smg";
  g.add(part(rb(0.012, 0.05, 0.16, 0.004), F.accent, 0, 0.02, 0.08));
  g.add(part(rb(0.03, 0.06, 0.012, 0.004), F.furniture, 0, 0.0, 0.006));
  g.add(part(rb(0.04, 0.07, 0.24, 0.008), F.body, 0, 0.04, 0.27));
  rail(g, F.accent, 0.078, 0.18, 0.37, 0.02);
  g.add(part(rb(0.026, 0.16, 0.034, 0.004), F.accent, 0, -0.07, 0.34));
  g.add(part(rb(0.03, 0.1, 0.04, 0.008), F.furniture, 0, -0.035, 0.22, 0.3));
  g.add(part(cyl(0.02, 0.02, 0.2), F.body, 0, 0.045, 0.49));
  for (let i = 0; i < 5; i++) g.add(part(new TorusGeometry(0.0202, 0.0016, 6, 20), F.accent, 0, 0.045, 0.41 + i * 0.04));
  g.add(part(rb(0.034, 0.03, 0.05, 0.004), F.body, 0, 0.088, 0.26));
  g.add(part(new BoxGeometry(0.004, 0.004, 0.001), F.glow, 0, 0.09, 0.286));
  return g;
}

/** Pump shotgun: tube magazine, ribbed forend, wood or polymer stock. */
export function shotgun(r: Rarity = "common"): Group {
  const F = finish(r);
  const g = new Group();
  g.name = "shotgun";
  g.add(part(rb(0.04, 0.09, 0.26, 0.016), F.furniture, 0, -0.012, 0.13, 0.08));
  g.add(part(rb(0.044, 0.07, 0.2, 0.006), F.body, 0, 0.03, 0.34));
  g.add(part(cyl(0.011, 0.011, 0.5), F.body, 0, 0.055, 0.68));
  g.add(part(cyl(0.012, 0.012, 0.42), F.accent, 0, 0.022, 0.64));
  g.add(part(rb(0.046, 0.044, 0.17, 0.01), F.furniture, 0, 0.026, 0.6));
  for (let z = 0.53; z < 0.68; z += 0.018) g.add(part(new BoxGeometry(0.048, 0.046, 0.004), F.accent, 0, 0.026, z));
  g.add(part(rb(0.012, 0.006, 0.48, 0.002), F.accent, 0, 0.069, 0.66));
  g.add(part(new BoxGeometry(0.003, 0.004, 0.003), F.glow, 0, 0.074, 0.9));
  g.add(part(rb(0.03, 0.06, 0.04, 0.01), F.body, 0, -0.01, 0.27, 0.2));
  return g;
}

/** Sidearm. */
export function pistol(r: Rarity = "common"): Group {
  const F = finish(r);
  const g = new Group();
  g.name = "pistol";
  g.add(part(rb(0.028, 0.032, 0.19, 0.005), F.body, 0, 0.11, 0.1));
  for (let z = 0.02; z < 0.07; z += 0.008) g.add(part(new BoxGeometry(0.029, 0.026, 0.003), F.accent, 0, 0.11, z));
  g.add(part(rb(0.026, 0.026, 0.15, 0.004), F.furniture, 0, 0.08, 0.1));
  g.add(part(rb(0.026, 0.11, 0.045, 0.008), F.furniture, 0, 0.025, 0.03, 0.22));
  g.add(part(new BoxGeometry(0.003, 0.004, 0.003), F.glow, 0, 0.13, 0.19));
  g.add(part(new BoxGeometry(0.008, 0.004, 0.003), F.glow, 0, 0.13, 0.016));
  return g;
}

/** The melee backup: a machete with a wrapped grip. */
export function machete(r: Rarity = "common"): Group {
  const F = finish(r);
  const g = new Group();
  g.name = "machete";
  const blade = new Mesh(
    new BoxGeometry(0.004, 0.05, 0.42, 1, 1, 8),
    r === "common" ? new MeshStandardMaterial({ color: 0x9ea2a6, roughnessMap: rough, roughness: 0.35, metalness: 1 }) : F.body,
  );
  const p = blade.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) / 0.42 + 0.5;
    p.setY(i, p.getY(i) * (1 + z * 0.5) + z * z * 0.02);
    if (p.getY(i) < 0) p.setX(i, p.getX(i) * 0.2);
  }
  blade.geometry.computeVertexNormals();
  blade.position.set(0, 0, 0.33);
  blade.castShadow = true;
  g.add(blade);
  g.add(part(rb(0.026, 0.03, 0.13, 0.01), F.furniture, 0, -0.004, 0.06));
  g.add(part(rb(0.03, 0.05, 0.012, 0.003), F.accent, 0, 0.002, 0.125));
  return g;
}
