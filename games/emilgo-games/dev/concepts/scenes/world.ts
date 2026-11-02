// Dev only (concept renders): the locations, the billboards, and the tiers.
//   biome-<id>   one vista per location (see BIOMES)
//   billboards   every board type on one city street (house content only)
//   tiers&tier=0..3   the same shot as Low / Medium / High / Max

import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  FogExp2,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
} from "three";
import { boardFace, canvas, fbm, perlin, tex } from "../lib/tex";
import { phMat, ruinStreet, spot, texturesReady } from "../lib/sets";
import { camera, done, draw, hdri, q, renderer, useSky, type Look } from "../lib/stage";
import { containers, crane, flare, forest, grass, groundMat, instance, neon, reseedW, rnd, rocks, scatter, sky, tank, terrain, towers, turbine, water, type HeightFn } from "../lib/world";
import { holdRifle, ready, settle, sunsetStreet } from "./characters";
import { operator } from "../lib/gear";

export const BIOMES = [
  { id: "forest", name: "Ironwood Forest", look: "Morning mist, god rays through the canopy, green-gold grade." },
  { id: "urban", name: "Glass District", look: "Shattered towers, wet streets that mirror the fires, smoke, amber dusk." },
  { id: "desert", name: "Dune Sea", look: "Hard noon sun, bleached contrast, long dune shadows, a dead convoy." },
  { id: "wind", name: "Windmere Ridge", look: "Rolling grass, turbines turning overhead (you hear them), clean blue light." },
  { id: "neon", name: "Neon Row", look: "Night. Rain-soaked club street, neon in every puddle, bass through the walls." },
  { id: "harbour", name: "Harbour Yard", look: "Container canyons, cranes, dusk over the water, horns from the ships." },
  { id: "snow", name: "Frostline", look: "Snow pass, white-out fog, a radar dome, cold blue grade, breath in the air." },
  { id: "refinery", name: "Black Refinery", look: "Flare stacks, burning tanks, oil smoke under a bruised sky." },
  { id: "airfield", name: "Old Airfield", look: "Runway, hangars, a broken airliner, late gold light, open sightlines." },
  { id: "stadium", name: "The Arena", look: "A ruined stadium bowl at dusk, floodlights, the final circle's favourite." },
  { id: "swamp", name: "Mangrove Sink", look: "Flooded dead forest, stilt houses, low fog, sound carries over water." },
] as const;

function smoke(scene: Scene, x: number, y: number, z: number, height = 60, color = 0x2a2522, opacity = 0.5): void {
  const [c, g] = canvas(128);
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.premultiplyAlpha = false;
  for (let i = 0; i < 26; i++) {
    const k = i / 26;
    const sp = new Sprite(new SpriteMaterial({ map: t, color, transparent: true, opacity: opacity * 0.35 * (1 - k * 0.7), depthWrite: false, fog: false, alphaTest: 0.01 }));
    sp.position.set(x + Math.sin(i * 0.7) * k * 8 + k * 12, y + k * height, z + Math.cos(i * 0.9) * k * 4);
    sp.scale.setScalar(6 + k * 30);
    scene.add(sp);
  }
}

const flat: HeightFn = () => 0;

async function biome(id: string, scene: Scene): Promise<{ cam: ReturnType<typeof camera>; look: Partial<Look> }> {
  reseedW(7);
  const cam = camera(45);
  if (id === "forest") {
    const s = await sky(scene, "kloofendal_misty_morning_puresky", { az: -Math.PI / 2 - 0.3, sunI: 2.6, sunColor: 0xffe2b0, fog: 0.022, fogColor: 0xc9cfc8, intensity: 0.9 });
    const h: HeightFn = (x, z) => fbm(x * 0.006, z * 0.006, 4, 64) * 9 + perlin(x * 0.05, z * 0.05) * 0.4;
    terrain(scene, 900, 220, h, groundMat("forest_ground_04", 220));
    const trees = scatter(2600, () => {
      const x = (rnd() - 0.5) * 520;
      const z = -rnd() * 520 + 12;
      return Math.abs(x) < 3 && z > -40 ? null : [x, z];
    }, h, 0.8, 1.5);
    forest(scene, "broad", trees.filter((_, i) => i % 3), [70, 110, 40]);
    forest(scene, "pine", trees.filter((_, i) => !(i % 3)).map((t) => ({ ...t, s: t.s * 1.2 })), [40, 70, 35]);
    rocks(scene, scatter(160, () => [(rnd() - 0.5) * 120, -rnd() * 160 + 8], h, 0.3, 1.6), "aerial_rocks_02", 0x7a8070);
    grass(scene, scatter(4000, () => [(rnd() - 0.5) * 40, -rnd() * 45 + 6], h, 0.6, 1.4) as never, [90, 130, 50]);
    cam.position.set(0.5, h(0.5, 8) + 1.7, 8);
    cam.lookAt(0, h(0, -30) + 3.5, -30);
    return { cam, look: { rays: { sun: s.sun, strength: 0.9, color: [1, 0.9, 0.7] }, exposure: 1.0, split: { shadow: [0.12, 0.2, 0.12], high: [1, 0.92, 0.7], amount: 0.14 } } };
  }
  if (id === "urban") {
    const skyT = await hdri("industrial_sunset_02_puresky");
    ruinStreet(scene, skyT, { fog: 0.006, fogColor: 0x8a6a52 });
    const s = await sky(scene, "industrial_sunset_02_puresky", { az: -Math.PI / 2 + 0.25, sunI: 3, sunColor: 0xffb070, intensity: 0.8, shadow: 90 });
    scene.fog = new FogExp2(0x8a6a52, 0.0055);
    const tw: Parameters<typeof towers>[1] = [];
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      tw.push({ p: new Vector3(side * (40 + rnd() * 120), 0, -150 - rnd() * 500), w: 24 + rnd() * 30, d: 24 + rnd() * 30, h: 60 + rnd() * 140, kind: rnd() < 0.5 ? "glass" : "ruin" });
    }
    towers(scene, tw);
    smoke(scene, -30, 10, -120, 120, 0x1f1a17, 0.55);
    smoke(scene, 50, 8, -200, 140, 0x2a2420, 0.5);
    cam.position.set(1.5, 1.7, 6);
    cam.lookAt(0, 6, -60);
    return { cam, look: { rays: { sun: s.sun, strength: 0.7, color: [1, 0.78, 0.5] }, exposure: 0.95 } };
  }
  if (id === "desert") {
    const s = await sky(scene, "syferfontein_6d_clear_puresky", { az: -Math.PI / 2 + 0.9, sunI: 5, sunColor: 0xfff0d8, fog: 0.0022, fogColor: 0xe8d6b8, intensity: 1.1, shadow: 120 });
    const h: HeightFn = (x, z) => {
      const ridge = 1 - Math.abs(perlin(x * 0.012 + z * 0.004, z * 0.006, 64));
      return Math.pow(ridge, 2.2) * 34 + fbm(x * 0.003, z * 0.003, 3, 64) * 14;
    };
    terrain(scene, 1600, 320, h, groundMat("sand_01", 180, 0xffcf8a));
    rocks(scene, scatter(60, () => [(rnd() - 0.5) * 300, -rnd() * 400], h, 0.6, 3.5), "aerial_rocks_02", 0xb08e6a);
    // A dead convoy: trucks half-buried along a track.
    const rust = phMat("rusty_metal_02", 1, { color: new Color(0x9a7a5a) } as never);
    for (let i = 0; i < 6; i++) {
      const x = -6 + i * 3.5;
      const z = -18 - i * 9;
      const y = h(x, z);
      const truck = new Group();
      const cab = new Mesh(new BoxGeometry(2.5, 2.4, 2.4), rust);
      cab.position.set(0, 1.4, 3.2);
      const bed = new Mesh(new BoxGeometry(2.5, 1.8, 6), rust);
      bed.position.set(0, 1.2, -1);
      truck.add(cab, bed);
      truck.position.set(x, y - 0.9, z);
      truck.rotation.set(0.08, 0.3 + i * 0.1, 0.12 * (i % 2 ? 1 : -1));
      truck.traverse((o) => ((o as Mesh).castShadow = (o as Mesh).receiveShadow = true));
      scene.add(truck);
    }
    cam.position.set(-26, h(-26, 14) + 6, 14);
    cam.lookAt(6, h(6, -40) + 0.5, -40);
    return { cam, look: { exposure: 1.05, contrast: 1.1, saturation: 1.0, split: { shadow: [0.18, 0.16, 0.2], high: [1, 0.95, 0.82], amount: 0.1 }, rays: null } };
  }
  if (id === "wind") {
    const s = await sky(scene, "kloofendal_48d_partly_cloudy_puresky", { az: Math.PI * 0.15, sunI: 3.4, fog: 0.0024, fogColor: 0xb7c6d6, intensity: 1, shadow: 140 });
    const h: HeightFn = (x, z) => fbm(x * 0.0035, z * 0.0035, 4, 64) * 40 + 20;
    terrain(scene, 2400, 240, h, groundMat("leafy_grass", 500, 0xc8d890));
    for (let i = 0; i < 14; i++) {
      const x = -260 + i * 42 + (rnd() - 0.5) * 20;
      const z = -160 - (i % 3) * 120 - rnd() * 60;
      const t = turbine(1, rnd() * Math.PI);
      t.position.set(x, h(x, z) - 1, z);
      t.rotation.y = 0.5;
      scene.add(t);
    }
    grass(scene, scatter(5000, () => [(rnd() - 0.5) * 50, -rnd() * 50 + 6], h, 0.7, 1.6) as never, [120, 140, 70]);
    rocks(scene, scatter(50, () => [(rnd() - 0.5) * 200, -rnd() * 200], h, 0.4, 1.8), "aerial_rocks_02", 0x9a9a90);
    cam.position.set(0, h(0, 10) + 1.8, 10);
    cam.lookAt(-20, h(-20, -150) + 40, -150);
    void s;
    return { cam, look: { exposure: 0.85, bloom: [0.25, 0.4, 1.0], rays: null, split: { shadow: [0.1, 0.16, 0.24], high: [1, 0.96, 0.9], amount: 0.1 } } };
  }
  if (id === "neon" || id === "billboards") {
    const skyT = await hdri("kloppenheim_02_puresky");
    ruinStreet(scene, skyT, { fog: 0.02, fogColor: 0x0c0a14, embers: false });
    await useSky(scene, "kloppenheim_02_puresky", { background: true, intensity: 0.15, bgIntensity: 0.25 });
    scene.fog = new FogExp2(0x100c18, 0.022);
    const signs: [string, string, number, number, number, number][] = [
      ["CLUB", "#ff2fa0", -11.9, 5.5, -10, 1],
      ["LIVE MUSIC", "#22d3ff", -11.9, 9, -24, 1],
      ["OPEN 24H", "#ffd23a", 11.9, 4.2, -14, -1],
      ["HOTEL", "#ff5a2a", 11.9, 12, -30, -1],
      ["DANCE", "#a35bff", -11.9, 4.4, -40, 1],
      ["BAR", "#3aff8a", 11.9, 6, -48, -1],
    ];
    for (const [t, col, x, y, z, side] of signs) {
      const s = neon(t, col, t.length * 0.9 + 1.5, 1.5);
      s.position.set(x, y, z);
      s.rotation.y = (side * Math.PI) / 2;
      scene.add(s);
      const l = new PointLight(new Color(col), 40, 16, 2);
      l.position.set(x + side * 1.2, y, z);
      scene.add(l);
    }
    // Street lamps.
    for (let z = -6; z > -90; z -= 14) {
      for (const sd of [-1, 1]) {
        const l = new PointLight(0xffc27a, 30, 14, 2);
        l.position.set(sd * 6.8, 6, z);
        scene.add(l);
        const pole = new Mesh(new CylinderGeometry(0.08, 0.1, 6, 8), new MeshStandardMaterial({ color: 0x222222 }));
        pole.position.set(sd * 7, 3, z);
        scene.add(pole);
        const bulb = new Mesh(new SphereGeometry(0.2, 10, 8), new MeshBasicMaterial({ color: new Color(0xffc27a).multiplyScalar(5) }));
        bulb.position.set(sd * 6.8, 6, z);
        scene.add(bulb);
      }
    }
    if (id === "billboards") {
      addBoards(scene);
      cam.fov = 58;
      cam.position.set(0.5, 3.2, 4);
      cam.lookAt(0, 9, -36);
      return { cam, look: { exposure: 1.1, bloom: [0.7, 0.5, 0.85], rays: null } };
    }
    cam.position.set(1.2, 1.7, 6);
    cam.lookAt(-1, 3.5, -40);
    return { cam, look: { exposure: 1.15, bloom: [0.8, 0.55, 0.85], rays: null, split: { shadow: [0.16, 0.08, 0.3], high: [1, 0.85, 0.95], amount: 0.18 }, saturation: 1.15 } };
  }
  if (id === "harbour") {
    const s = await sky(scene, "qwantani_dusk_2_puresky", { az: -Math.PI / 2 - 0.9, sunI: 2.2, sunColor: 0xffa060, fog: 0.0016, fogColor: 0x5a4a4a, intensity: 0.8, bg: 0.7, shadow: 120 });
    const quay = new Mesh(new PlaneGeometry(500, 300), groundMat("concrete_panels", 60));
    quay.rotation.x = -Math.PI / 2;
    quay.position.set(0, 0, -60);
    quay.receiveShadow = true;
    scene.add(quay);
    water(scene, 3000, -2.5, 0x0e1a20).position.z = -1650;
    const cols = [0xb83a2a, 0x2a5a8a, 0x2f7a4a, 0xc8a02a, 0x6a6e72, 0xd2692a];
    const spots: Parameters<typeof containers>[1] = [];
    for (let row = 0; row < 8; row++)
      for (let k = 0; k < 10; k++)
        for (let lv = 0; lv < 1 + Math.floor(rnd() * 4); lv++) {
          if (rnd() < 0.15) continue;
          spots.push({ p: new Vector3(-40 + k * 2.7 + (row % 2) * 30, lv * 2.6, -30 - row * 14), long: true, ry: 0, color: cols[Math.floor(rnd() * cols.length)] });
        }
    containers(scene, spots);
    for (const x of [-60, -10, 40]) {
      const c = crane(x === -10 ? 0x2a6aa8 : 0xd94b1e);
      c.position.set(x, 0, -180);
      scene.add(c);
    }
    const hull = new Mesh(new BoxGeometry(32, 18, 220), new MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.6, metalness: 0.3 }));
    hull.position.set(-20, 4, -240);
    hull.rotation.y = Math.PI / 2;
    hull.castShadow = true;
    scene.add(hull);
    cam.position.set(-12.5, 1.8, -12);
    cam.lookAt(-14, 9, -120);
    return { cam, look: { rays: { sun: s.sun, strength: 0.35, color: [1, 0.75, 0.5] }, exposure: 0.85 } };
  }
  if (id === "snow") {
    const s = await sky(scene, "snow_field_2_puresky", { az: Math.PI * 0.2, sunI: 2.6, fog: 0.006, fogColor: 0xd8e2ee, intensity: 1, shadow: 120 });
    const h: HeightFn = (x, z) => {
      const r = 1 - Math.abs(perlin(x * 0.004, z * 0.004, 64));
      return Math.pow(r, 2.2) * 140 * Math.min(1, Math.max(0, (-z - 60) / 200)) + fbm(x * 0.01, z * 0.01, 3, 64) * 6;
    };
    terrain(scene, 2400, 260, h, groundMat("snow_02", 300, 0xf2f6ff));
    forest(scene, "pine", scatter(900, () => [(rnd() - 0.5) * 500, -rnd() * 400 + 10], h, 0.9, 1.4), [190, 205, 210]);
    rocks(scene, scatter(80, () => [(rnd() - 0.5) * 200, -rnd() * 200], h, 0.5, 2.4), "dark_rock", 0x8a8f96);
    const dome = new Mesh(new SphereGeometry(9, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.6), new MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.5 }));
    const dx = 30;
    const dz = -180;
    dome.position.set(dx, h(dx, dz) + 14, dz);
    const towerM = new Mesh(new CylinderGeometry(6, 7, 14, 16), new MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.6 }));
    towerM.position.set(dx, h(dx, dz) + 7, dz);
    dome.castShadow = towerM.castShadow = true;
    scene.add(dome, towerM);
    cam.position.set(0, h(0, 10) + 1.8, 10);
    cam.lookAt(10, h(10, -120) + 12, -120);
    return { cam, look: { exposure: 0.95, saturation: 0.85, split: { shadow: [0.12, 0.18, 0.3], high: [0.95, 0.98, 1], amount: 0.14 }, rays: null } };
  }
  if (id === "refinery") {
    const s = await sky(scene, "wasteland_clouds_puresky", { az: -Math.PI / 2 + 0.6, sunI: 2.0, sunColor: 0xffb880, fog: 0.0035, fogColor: 0x3a302c, intensity: 0.6, bg: 0.6, shadow: 120 });
    const g = new Mesh(new PlaneGeometry(1200, 1200), groundMat("dry_mud_field_001", 200, 0x9a8a7a));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    scene.add(g);
    for (let i = 0; i < 9; i++) {
      const t = tank(10 + rnd() * 8, 12 + rnd() * 8);
      t.position.set(-90 + (i % 3) * 45 + rnd() * 6, 0, -80 - Math.floor(i / 3) * 50);
      scene.add(t);
    }
    for (const [x, z] of [[40, -120], [70, -180], [-120, -220]] as const) {
      const f = flare(60 + rnd() * 30);
      f.position.set(x, 0, z);
      scene.add(f);
      const l = new PointLight(0xff7a20, 220, 120, 2);
      l.position.set(x, 70, z);
      scene.add(l);
    }
    const pipeM = new MeshStandardMaterial({ color: 0x6a6158, roughness: 0.5, metalness: 0.6 });
    for (let i = 0; i < 8; i++) {
      const p = new Mesh(new CylinderGeometry(0.7, 0.7, 220, 12), pipeM);
      p.rotation.z = Math.PI / 2;
      p.position.set(0, 1 + i * 0.9 + (i % 2) * 2, -40 - i * 2);
      p.castShadow = true;
      scene.add(p);
    }
    cam.position.set(4, 2.2, 14);
    cam.lookAt(-10, 18, -120);
    return { cam, look: { rays: { sun: s.sun, strength: 0.25 }, exposure: 0.85, bloom: [0.5, 0.5, 0.95], split: { shadow: [0.2, 0.12, 0.1], high: [1, 0.82, 0.6], amount: 0.2 } } };
  }
  if (id === "airfield") {
    const s = await sky(scene, "qwantani_late_afternoon_puresky", { az: -Math.PI / 2 + 1.1, sunI: 3.4, sunColor: 0xffdcaa, fog: 0.0025, fogColor: 0xc8b8a0, intensity: 1, shadow: 150 });
    const g = new Mesh(new PlaneGeometry(3000, 3000), groundMat("sparse_grass", 500, 0xb0a070));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    scene.add(g);
    const run = new Mesh(new PlaneGeometry(45, 1800), phMat("asphalt_02", 1, {} as never));
    for (const t of [run.material.map, run.material.normalMap, run.material.roughnessMap]) t!.repeat.set(6, 240);
    run.rotation.x = -Math.PI / 2;
    run.position.set(0, 0.02, -700);
    run.receiveShadow = true;
    scene.add(run);
    for (let z = -20; z > -1500; z -= 30) {
      const dash = new Mesh(new PlaneGeometry(1, 14), new MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.7 }));
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(0, 0.03, z);
      scene.add(dash);
    }
    const corr = phMat("corrugated_iron", 1, { color: new Color(0x9a9a92), metalness: 0.5 } as never);
    for (let i = 0; i < 4; i++) {
      const hg = new Mesh(new CylinderGeometry(22, 22, 50, 32, 1, false, 0, Math.PI), corr);
      hg.rotation.z = Math.PI / 2;
      hg.rotation.y = Math.PI / 2;
      hg.position.set(-90, 0, -80 - i * 70);
      hg.castShadow = hg.receiveShadow = true;
      scene.add(hg);
    }
    // A broken airliner on the grass.
    const skin = new MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.6, metalness: 0.2 });
    const fus = new Mesh(new CylinderGeometry(3, 3, 48, 24), skin);
    fus.rotation.x = Math.PI / 2;
    fus.rotation.z = 0.15;
    fus.position.set(48, 2.6, -120);
    const wing = new Mesh(new BoxGeometry(44, 0.6, 7), skin);
    wing.position.set(48, 1.4, -118);
    wing.rotation.z = 0.12;
    const tail = new Mesh(new BoxGeometry(0.6, 9, 7), skin);
    tail.position.set(50, 7, -142);
    for (const m of [fus, wing, tail]) {
      m.castShadow = true;
      scene.add(m);
    }
    const tower = new Mesh(new BoxGeometry(8, 30, 8), phMat("concrete_panels", 2, {} as never));
    tower.position.set(80, 15, -300);
    tower.castShadow = true;
    scene.add(tower);
    cam.position.set(14, 1.8, 6);
    cam.lookAt(10, 6, -120);
    return { cam, look: { exposure: 0.85, bloom: [0.3, 0.4, 1.0], rays: { sun: s.sun, strength: 0.3 }, split: { shadow: [0.14, 0.14, 0.2], high: [1, 0.9, 0.72], amount: 0.14 } } };
  }
  if (id === "stadium") {
    const s = await sky(scene, "qwantani_dusk_2_puresky", { az: -Math.PI / 2 + 0.2, sunI: 0.8, sunColor: 0xff9a60, intensity: 0.45, bg: 0.6, fog: 0.0025, fogColor: 0x2a2430, shadow: 120 });
    const pitch = new Mesh(new PlaneGeometry(110, 75), groundMat("leafy_grass", 30, 0x7a9a50));
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    scene.add(pitch);
    const conc = phMat("concrete_panels", 4, {} as never);
    const [sc, sg] = canvas(256, 256);
    sg.fillStyle = "#2a2d33";
    sg.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 16; r++)
      for (let k = 0; k < 32; k++) {
        sg.fillStyle = rnd() < 0.12 ? "#1a1a1a" : r % 4 < 2 ? "#1f5fa8" : "#d8d8d8";
        sg.fillRect(k * 8 + 1, r * 16 + 6, 6, 8);
      }
    const seats = new MeshStandardMaterial({ map: tex(sc), roughness: 0.7 });
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      if (i > 40 && i < 46) continue;
      const rx = 78;
      const rz = 58;
      for (let tier = 0; tier < 3; tier++) {
        const b = new Mesh(new BoxGeometry(8.6, 6 + tier * 4, 11), [conc, conc, conc, conc, seats, conc]);
        b.position.set(Math.cos(a) * (rx + tier * 10), (6 + tier * 4) / 2 + tier * 3, Math.sin(a) * (rz + tier * 10) - 10);
        b.rotation.y = -a - Math.PI / 2;
        b.rotation.x = 0;
        b.castShadow = b.receiveShadow = true;
        scene.add(b);
      }
    }
    for (const [x, z] of [[-90, -70], [90, -70], [-90, 50], [90, 50]] as const) {
      const pole = new Mesh(new CylinderGeometry(0.8, 1.2, 50, 10), new MeshStandardMaterial({ color: 0x5a5a5a }));
      pole.position.set(x, 25, z - 10);
      scene.add(pole);
      const panel = new Mesh(new BoxGeometry(12, 6, 1), new MeshStandardMaterial({ color: 0x111111, emissive: 0xf4f0ff, emissiveIntensity: 3 }));
      panel.position.set(x * 0.95, 51, z * 0.95 - 10);
      panel.lookAt(0, 0, -10);
      scene.add(panel);
      const l = spot(scene, 0xf0f0ff, 2600, [x, 51, z - 10], [0, 0, -10], 0.7, 0.6, false);
      void l;
    }
    cam.position.set(-30, 1.8, 22);
    cam.lookAt(20, 14, -60);
    void s;
    return { cam, look: { exposure: 0.9, bloom: [0.6, 0.5, 0.9], rays: null } };
  }
  // swamp
  const s = await sky(scene, "kloofendal_overcast_puresky", { az: 0.5, sunI: 1.2, intensity: 0.7, bg: 0.75, fog: 0.014, fogColor: 0x5a645a, shadow: 80 });
  water(scene, 1200, 0, 0x16201a);
  const h: HeightFn = (x, z) => fbm(x * 0.02, z * 0.02, 3, 64) * 1.2 - 0.6;
  terrain(scene, 600, 160, h, groundMat("brown_mud_leaves_01", 140, 0x6a6a52));
  forest(scene, "dead", scatter(260, () => [(rnd() - 0.5) * 200, -rnd() * 220 + 10], h, 0.9, 1.6), [0, 0, 0]);
  const wood = phMat("brown_mud_leaves_01", 1, { color: new Color(0x5a4a3a) } as never);
  for (let i = 0; i < 6; i++) {
    const x = -30 + i * 14 + rnd() * 6;
    const z = -30 - rnd() * 60;
    const hut = new Group();
    const box = new Mesh(new BoxGeometry(6, 3.2, 5), phMat("corrugated_iron", 1, { color: new Color(0x8a7a6a) } as never));
    box.position.y = 3.6;
    hut.add(box);
    for (const [px, pz] of [[-2.6, -2], [2.6, -2], [-2.6, 2], [2.6, 2]]) {
      const post = new Mesh(new CylinderGeometry(0.12, 0.14, 3.2, 6), wood);
      post.position.set(px, 1.6, pz);
      hut.add(post);
    }
    hut.position.set(x, 0, z);
    hut.rotation.y = rnd();
    hut.traverse((o) => ((o as Mesh).castShadow = true));
    scene.add(hut);
  }
  cam.position.set(0, 1.6, 10);
  cam.lookAt(0, 3, -40);
  void s;
  void instance;
  return { cam, look: { exposure: 0.9, saturation: 0.85, rays: null, split: { shadow: [0.1, 0.16, 0.12], high: [0.95, 1, 0.9], amount: 0.14 } } };
}

/** Every board type on the street: unipole, rooftop, LED wall, gantry, bus shelter, mural. */
function addBoards(scene: Scene): void {
  const face = (kind: string, w: number, h: number) => {
    const t = tex(boardFace(1024, Math.round((1024 * h) / w), kind));
    return new MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.5 });
  };
  const steel = new MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.7 });
  // Unipole by the kerb.
  const pole = new Mesh(new CylinderGeometry(0.35, 0.45, 9, 12), steel);
  pole.position.set(5.5, 4.5, -18);
  const b1 = new Mesh(new BoxGeometry(8, 4, 0.3), steel);
  b1.position.set(5.5, 11, -18);
  const f1 = new Mesh(new PlaneGeometry(7.8, 3.8), face("ffa", 8, 4));
  f1.position.set(5.5, 11, -17.84);
  scene.add(pole, b1, f1);
  // Rooftop sign on the left block.
  const f2 = new Mesh(new PlaneGeometry(10, 3.4), face("dead", 10, 3.4));
  f2.position.set(-11.6, 24, -30);
  f2.rotation.y = Math.PI / 2;
  scene.add(f2);
  // LED wall down a facade.
  const f3 = new Mesh(new PlaneGeometry(9, 14), face("rank", 9, 14));
  f3.position.set(11.8, 12, -44);
  f3.rotation.y = -Math.PI / 2;
  scene.add(f3);
  // Gantry over the road.
  for (const x of [-7.5, 7.5]) {
    const leg = new Mesh(new BoxGeometry(0.5, 7, 0.5), steel);
    leg.position.set(x, 3.5, -62);
    scene.add(leg);
  }
  const beam = new Mesh(new BoxGeometry(15.5, 0.6, 0.6), steel);
  beam.position.set(0, 7, -62);
  scene.add(beam);
  const f4a = new Mesh(new PlaneGeometry(6, 2.2), face("daily", 6, 2.2));
  f4a.position.set(-3.4, 8.6, -61.6);
  const f4b = new Mesh(new PlaneGeometry(6, 2.2), face("app", 6, 2.2));
  f4b.position.set(3.4, 8.6, -61.6);
  scene.add(f4a, f4b);
  // Bus shelter panel.
  const sh = new Mesh(new BoxGeometry(4, 0.15, 1.8), steel);
  sh.position.set(-8.5, 2.6, -12);
  const f5 = new Mesh(new PlaneGeometry(1.4, 2), face("ad", 1.4, 2));
  f5.position.set(-7.0, 1.3, -11.2);
  f5.rotation.y = -Math.PI / 2 + 0.0;
  scene.add(sh, f5);
  // A painted mural.
  const f6 = new Mesh(new PlaneGeometry(14, 6), new MeshStandardMaterial({ map: tex(boardFace(1024, 440, "ffa")), roughness: 0.95 }));
  f6.position.set(-11.85, 5, -54);
  f6.rotation.y = Math.PI / 2;
  scene.add(f6);
}

async function tiers(scene: Scene, tier: number): Promise<{ cam: ReturnType<typeof camera>; look: Partial<Look>; raw: boolean }> {
  await ready();
  const { sun } = await sunsetStreet(scene);
  const op = operator({ kit: "ironwood" });
  scene.add(op.h.mesh);
  settle(op, 0.35);
  holdRifle(scene, op, "low");
  spot(scene, 0xdbe6ff, 150, [2.6, 2.4, 5.0], [0, 1.2, 0], 0.4, 0.8, false);
  const cam = camera(30);
  cam.position.set(1.35, 1.0, 4.6);
  cam.lookAt(0.05, 1.05, 0);
  if (tier === 0) {
    // Low: Lambert, no shadows, no post, 0.6 render scale, no mirror puddles.
    renderer.shadowMap.enabled = false;
    renderer.setPixelRatio(0.6);
    scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      if ((m as unknown as { isReflector?: boolean }).isReflector) m.visible = false;
      const mat = m.material as MeshStandardMaterial;
      if (mat && (mat as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial && !(mat as unknown as { onBeforeCompile?: unknown }).onBeforeCompile?.toString().includes("vRegion")) {
        m.material = new MeshLambertMaterial({ map: mat.map, color: mat.color, emissive: mat.emissive, emissiveMap: mat.emissiveMap, emissiveIntensity: mat.emissiveIntensity, alphaMap: mat.alphaMap, alphaTest: mat.alphaTest, transparent: mat.transparent, side: mat.side }) as unknown as Material;
      }
    });
    scene.environment = null;
    return { cam, look: {}, raw: true };
  }
  scene.traverse((o) => {
    if ((o as unknown as { isReflector?: boolean }).isReflector && tier < 3) o.visible = false;
  });
  if (tier === 1) return { cam, look: { ao: 0, bloom: [0, 0, 1], rays: null, dof: null, grain: 0, ca: 0, vignette: 0.3 }, raw: false };
  if (tier === 2) return { cam, look: { ao: 0, bloom: [0.4, 0.5, 0.95], rays: null, dof: null, grain: 0.03, ca: 0 }, raw: false };
  return { cam, look: { ao: 0.8, bloom: [0.45, 0.5, 0.95], rays: { sun, strength: 0.5, color: [1, 0.8, 0.55] }, dof: [4.6, 0.0009], exposure: 0.95 }, raw: false };
}

export default async function render(name: string): Promise<void> {
  const scene = new Scene();
  if (name === "tiers") {
    const t = Number(q.get("tier") ?? 3);
    const r = await tiers(scene, t);
    await texturesReady();
    draw({ scene, cam: r.cam, look: r.look, raw: r.raw });
    done({ tier: t });
    return;
  }
  const id = name === "billboards" ? "billboards" : name === "map" ? "harbour" : name.replace("biome-", "");
  const { cam, look } = await biome(id, scene);
  if (name === "map") {
    cam.fov = 40;
    cam.position.set(-10, 420, -70);
    cam.up.set(0, 0, -1);
    cam.lookAt(-10, 0, -71);
    scene.fog = null;
  }
  await texturesReady();
  draw({ scene, cam, look });
  done({ biome: id });
}

export { AdditiveBlending, PlaneGeometry };
