// Dev only (concept renders): guns and loot.
//   weapons  rifle, SMG, shotgun, sidearm, machete (product shot)
//   rarity   the rifle in all six finishes, Common → Mythic
//   loot     the armour pickups as treasures, each in its rarity's light pillar, and the Airfall chest

import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Object3D,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { machete, pistol, RARITIES, rifle, shotgun, smg, finish, type Rarity } from "../lib/arms";
import { horn, put, rotX, rotY, rotZ, then, wrapPlate } from "../lib/armour";
import { plinth, spot, texturesReady, wetFloor } from "../lib/sets";
import { camera, done, draw, useSky } from "../lib/stage";
import { canvas, engraved, filigreeNormal, tex } from "../lib/tex";

function pillar(scene: Scene, x: number, z: number, hex: string, height = 7): void {
  const col = new Color(hex);
  const beam = new Mesh(
    new CylinderGeometry(0.16, 0.34, height, 32, 1, true),
    new MeshBasicMaterial({ color: col.clone().multiplyScalar(0.9), transparent: true, opacity: 0.05, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
  );
  beam.position.set(x, height / 2, z);
  scene.add(beam);
  const core = new Mesh(new CylinderGeometry(0.02, 0.04, height, 16, 1, true), new MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6), transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false, fog: false }));
  core.position.set(x, height / 2, z);
  scene.add(core);
  const ring = new Mesh(new RingGeometry(0.34, 0.42, 48), new MeshBasicMaterial({ color: col.clone().multiplyScalar(1.5), transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.015, z);
  scene.add(ring);
  const light = new PointLight(col, 1.6, 4, 2);
  light.position.set(x, 0.8, z);
  scene.add(light);
}

/** The six armour pickups, one per rarity. Each ≈ 1–3K triangles, one or two materials. */
function relic(r: Rarity): Group {
  const g = new Group();
  const F = finish(r);
  const glowHex = RARITIES.find((x) => x.id === r)!.color;
  const glow = new MeshStandardMaterial({ color: 0x050505, emissive: glowHex, emissiveIntensity: 6 });
  if (r === "common") {
    // Kevlar insert: a soft armour panel, stitched.
    const panel = put(new RoundedBoxGeometry(0.26, 0.32, 0.03, 4, 0.03), new MeshStandardMaterial({ color: 0x3a3c38, roughness: 0.9 }), [0, 0, 0]);
    g.add(panel);
    g.add(put(new RoundedBoxGeometry(0.2, 0.06, 0.034, 2, 0.01), new MeshStandardMaterial({ color: 0x2a2b28, roughness: 0.9 }), [0, 0.08, 0]));
  } else if (r === "uncommon") {
    // Steel plate with a green-anodised edge.
    g.add(put(wrapPlate({ w: 0.26, h: 0.32, t: 0.018, bend: 0.3, dome: 0.5, taper: 0.8, strips: 10, corner: 0.03 }), new MeshStandardMaterial({ color: 0x8a9096, roughness: 0.35, metalness: 1 }), [0, 0, 0]));
    g.add(put(wrapPlate({ w: 0.28, h: 0.34, t: 0.008, bend: 0.3, dome: 0.5, taper: 0.8, strips: 10, corner: 0.03 }), F.body, [0, 0, -0.012]));
  } else if (r === "rare") {
    // Ceramic plate: white, a hex pattern, blue core strip.
    const hexTex = canvas(256);
    const c2 = hexTex[1];
    c2.fillStyle = "#e9edf2";
    c2.fillRect(0, 0, 256, 256);
    c2.strokeStyle = "#9aa7b8";
    c2.lineWidth = 2;
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 12; x++) {
        const cx = x * 24 + (y % 2) * 12;
        const cy = y * 21;
        c2.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          c2[k ? "lineTo" : "moveTo"](cx + Math.cos(a) * 11, cy + Math.sin(a) * 11);
        }
        c2.closePath();
        c2.stroke();
      }
    g.add(put(wrapPlate({ w: 0.27, h: 0.33, t: 0.022, bend: 0.32, dome: 0.5, taper: 0.78, strips: 10, corner: 0.035 }), new MeshPhysicalMaterial({ map: tex(hexTex[0]), roughness: 0.25, clearcoat: 1 }), [0, 0, 0]));
    g.add(put(new RoundedBoxGeometry(0.03, 0.22, 0.03, 2, 0.01), glow, [0, 0, 0.02]));
  } else if (r === "epic") {
    // Reactive core: a violet orb held in an engraved silver cage.
    g.add(put(new IcosahedronGeometry(0.1, 3), new MeshPhysicalMaterial({ color: 0x2a0a40, emissive: glowHex, emissiveIntensity: 4, roughness: 0.1, clearcoat: 1, transmission: 0 }), [0, 0, 0]));
    for (let i = 0; i < 3; i++) {
      const ring = put(new TorusGeometry(0.14, 0.012, 10, 48), F.accent, [0, 0, 0]);
      ring.quaternion.copy(then(rotX(Math.PI / 2), rotY((i * Math.PI) / 3)));
      g.add(ring);
    }
    g.add(put(new CylinderGeometry(0.09, 0.12, 0.04, 6), F.accent, [0, -0.17, 0]));
  } else if (r === "legendary") {
    // Warlord crest: a gold filigree shield with a ruby.
    const gold = new MeshPhysicalMaterial({ map: tex(engraved(512, "#e8b54a", 5)), normalMap: tex(filigreeNormal(512, 5, 7), { srgb: false }), roughness: 0.2, metalness: 1, clearcoat: 0.5 });
    g.add(put(wrapPlate({ w: 0.28, h: 0.34, t: 0.02, bend: 0.25, dome: 0.4, taper: 0.35, strips: 12, corner: 0.04 }), gold, [0, 0, 0]));
    g.add(put(wrapPlate({ w: 0.3, h: 0.36, t: 0.01, bend: 0.25, dome: 0.4, taper: 0.35, strips: 12, corner: 0.04 }), new MeshPhysicalMaterial({ color: 0x0c0a08, roughness: 0.2, metalness: 1, clearcoat: 1 }), [0, 0, -0.012]));
    g.add(put(new OctahedronGeometry(0.045, 0), new MeshPhysicalMaterial({ color: 0x8a0010, emissive: 0xff1a2a, emissiveIntensity: 2.5, roughness: 0.05, clearcoat: 1 }), [0, 0.03, 0.04]));
    for (const s of [-1, 1]) g.add(put(horn([new Vector3(s * 0.12, 0.12, 0), new Vector3(s * 0.18, 0.2, 0.02), new Vector3(s * 0.16, 0.28, 0.06)], 0.018, 0.002, 12, 8), gold, [0, 0, 0]));
  } else {
    // Titan heart: a molten obsidian crystal gripped by golden claws.
    g.add(put(new OctahedronGeometry(0.12, 1), new MeshPhysicalMaterial({ color: 0x0b0605, emissive: 0xff4a12, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.4, clearcoat: 1, flatShading: true }), [0, 0, 0]));
    const gold = new MeshPhysicalMaterial({ color: 0xd8a443, roughness: 0.2, metalness: 1, clearcoat: 0.6 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const base = new Vector3(Math.cos(a) * 0.1, -0.15, Math.sin(a) * 0.1);
      const mid = new Vector3(Math.cos(a) * 0.16, -0.02, Math.sin(a) * 0.16);
      const tip = new Vector3(Math.cos(a) * 0.08, 0.12, Math.sin(a) * 0.08);
      g.add(put(horn([base, mid, tip], 0.02, 0.003, 16, 8), gold, [0, 0, 0]));
    }
    g.add(put(new CylinderGeometry(0.1, 0.14, 0.05, 8), gold, [0, -0.17, 0]));
  }
  return g;
}

/** The Airfall chest: steel and gold, glowing seams. */
function chest(): Group {
  const g = new Group();
  const steel = new MeshPhysicalMaterial({ color: 0x1b1d20, roughness: 0.35, metalness: 0.9, clearcoat: 0.4 });
  const gold = new MeshPhysicalMaterial({ map: tex(engraved(512, "#e2ad45", 6)), normalMap: tex(filigreeNormal(512, 6, 6), { srgb: false }), roughness: 0.22, metalness: 1 });
  const glow = new MeshStandardMaterial({ color: 0x050505, emissive: 0xffb020, emissiveIntensity: 7 });
  g.add(put(new RoundedBoxGeometry(0.9, 0.45, 0.55, 3, 0.04), steel, [0, 0.225, 0]));
  const lid = new CylinderGeometry(0.275, 0.275, 0.9, 24, 1, false, 0, Math.PI);
  g.add(put(lid, steel, [0, 0.45, 0], then(rotZ(Math.PI / 2), rotX(0))));
  for (const x of [-0.38, 0, 0.38]) {
    g.add(put(new RoundedBoxGeometry(0.07, 0.47, 0.57, 2, 0.01), gold, [x, 0.226, 0]));
    const band = new TorusGeometry(0.28, 0.022, 8, 24, Math.PI);
    g.add(put(band, gold, [x, 0.45, 0], rotY(Math.PI / 2)));
  }
  g.add(put(new RoundedBoxGeometry(0.88, 0.012, 0.012, 1, 0.004), glow, [0, 0.452, 0.278]));
  g.add(put(new RoundedBoxGeometry(0.12, 0.14, 0.03, 2, 0.01), gold, [0, 0.38, 0.29]));
  return g;
}

function hover(scene: Scene, o: Object3D, x: number, y: number, z: number, yaw = 0.4): void {
  o.position.set(x, y, z);
  o.rotation.y = yaw;
  o.traverse((m) => ((m as Mesh).castShadow = true));
  scene.add(o);
}

export default async function render(name: string): Promise<void> {
  const scene = new Scene();
  const cam = camera(30);

  if (name === "weapons" || name === "rarity") {
    scene.background = new Color(0x0b0c0f);
    await useSky(scene, "photo_studio_01", { background: false, intensity: 0.9 });
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 4, 3);
    key.castShadow = true;
    scene.add(key);
    spot(scene, 0xffb060, 60, [-3, 2, -3], [0, 0.6, 0], 0.6, 0.6, false);
    spot(scene, 0x80b0ff, 40, [3, 1.5, -2], [0, 0.6, 0], 0.6, 0.6, false);
    if (name === "weapons") {
      const items: [Group, number, number][] = [
        [rifle("common"), 0.0, 1.05],
        [smg("common"), -0.62, 0.62],
        [shotgun("common"), 0.55, 0.6],
        [pistol("common"), -0.5, 0.2],
        [machete("common"), 0.5, 0.18],
      ];
      for (const [g, x, y] of items) {
        g.rotation.y = Math.PI / 2;
        g.rotation.z = 0.0;
        const box = new Group();
        box.add(g);
        g.position.z = 0;
        box.position.set(x, y, 0);
        box.rotation.x = 0.0;
        box.traverse((m) => ((m as Mesh).castShadow = true));
        scene.add(box);
        // Centre each gun on its own length.
        g.position.x = -0.0;
      }
      // Lay the guns across the frame (muzzle right), centred by length.
      scene.children.filter((c) => c instanceof Group).forEach((b) => {
        const gun = (b as Group).children[0] as Group;
        const len = gun.name === "rifle" ? 0.98 : gun.name === "shotgun" ? 0.92 : gun.name === "smg" ? 0.6 : gun.name === "machete" ? 0.55 : 0.2;
        gun.position.x = -len / 2;
      });
      cam.fov = 26;
      cam.position.set(0, 0.62, 3.2);
      cam.lookAt(0, 0.6, 0);
      draw({ scene, cam, look: { bloom: [0.4, 0.4, 0.9], vignette: 0.45, ao: 0.6 } });
      done();
      return;
    }
    RARITIES.forEach((r, i) => {
      const g = rifle(r.id);
      g.rotation.y = Math.PI / 2;
      g.position.set(-0.49, 0, 0);
      const box = new Group();
      box.add(g);
      box.position.set((i % 2) * 1.1 - 0.55, 1.3 - Math.floor(i / 2) * 0.45, 0);
      box.traverse((m) => ((m as Mesh).castShadow = true));
      scene.add(box);
      const bar = new Mesh(new PlaneGeometry(0.9, 0.012), new MeshBasicMaterial({ color: new Color(r.color).multiplyScalar(2) }));
      bar.position.set(box.position.x, box.position.y - 0.12, 0);
      scene.add(bar);
    });
    cam.fov = 32;
    cam.position.set(0, 0.85, 3.4);
    cam.lookAt(0, 0.85, 0);
    draw({ scene, cam, look: { bloom: [0.6, 0.45, 0.85], vignette: 0.4, ao: 0.5 } });
    done();
    return;
  }

  // Loot: night, wet ground, six pickups in their pillars, the chest in front.
  scene.background = new Color(0x07080b);
  scene.fog = new FogExp2(0x0a0b10, 0.06);
  wetFloor(scene, 40, 10, 0.5, 1024);
  await useSky(scene, "dikhololo_night", { background: false, intensity: 0.4 });
  await texturesReady();
  const moon = new DirectionalLight(0x9fb4ff, 0.5);
  moon.position.set(-4, 8, -6);
  scene.add(moon);
  RARITIES.forEach((r, i) => {
    const x = (i - 2.5) * 0.95;
    const z = -1.8 - Math.abs(i - 2.5) * 0.25;
    pillar(scene, x, z, r.color);
    const rl = relic(r.id);
    rl.scale.setScalar(1.35);
    hover(scene, rl, x, 0.8, z, 0.5 - i * 0.15);
  });
  const ch = chest();
  hover(scene, ch, 0, 0, 0.35, -0.35);
  pillar(scene, 0, 0.35, "#ffb020", 9);
  cam.fov = 36;
  cam.position.set(0, 1.1, 3.1);
  cam.lookAt(0, 0.68, -1.2);
  draw({ scene, cam, look: { bloom: [0.45, 0.5, 0.95], exposure: 1.0, vignette: 0.45 } });
  done();
}

export { SphereGeometry };
