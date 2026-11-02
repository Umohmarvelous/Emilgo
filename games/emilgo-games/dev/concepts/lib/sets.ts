// Dev only (concept renders): small sets to stand things in — a dark hangar
// with a wet floor and a lit doorway, a night street, a product plinth.

import {
  AdditiveBlending,
  IcosahedronGeometry,
  BufferGeometry,
  Group,
  Points,
  PointsMaterial,
  CylinderGeometry,
  Float32BufferAttribute,
  Vector3,
  BoxGeometry,
  Color,
  DoubleSide,
  FogExp2,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SpotLight,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  type Scene,
  type Texture,
} from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { paint, fbm, tex } from "./tex";

const loader = new TextureLoader();
const cache = new Map<string, Texture>();
const waits: Promise<void>[] = [];

/** A Poly Haven texture set (CC0) from the cache folder. */
export function phTex(name: string, kind: "diff" | "nor" | "rough", repeat = 1): Texture {
  const key = `${name}:${kind}:${repeat}`;
  let t = cache.get(key);
  if (!t) {
    let ok!: () => void;
    waits.push(new Promise<void>((r) => (ok = r)));
    t = loader.load(`/dev/concepts/.cache/tex/${name}_${kind}.jpg`, () => ok(), undefined, () => {
      console.warn("missing texture", name, kind);
      ok();
    });
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (kind === "diff") t.colorSpace = SRGBColorSpace;
    cache.set(key, t);
  }
  return t;
}

export function phMat(name: string, repeat = 1, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({ map: phTex(name, "diff", repeat), normalMap: phTex(name, "nor", repeat), roughnessMap: phTex(name, "rough", repeat), roughness: 1, ...extra } as never);
}

/** Wait for every texture asked for so far (loaded or missing). */
export async function texturesReady(): Promise<void> {
  await Promise.all(waits);
}

/** A wet concrete floor: puddles are holes in the concrete over a dark mirror. */
export function wetFloor(scene: Scene, size = 30, repeat = 8, wet = 0.45, mirrorRes = 1024): void {
  const puddles = paint(1024, 1024, (u, v) => {
    const n = fbm(u * 3 + 11, v * 3 + 5, 5, 3) * 0.5 + 0.5;
    const a = n > 1 - wet ? 0 : 255;
    return [a, a, a];
  });
  const alpha = tex(puddles, { srgb: false, repeat: 1 });
  const floor = new Mesh(new PlaneGeometry(size, size), phMat("concrete_floor_worn_001", repeat, { alphaMap: alpha, alphaTest: 0.5 } as never));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  floor.receiveShadow = true;
  scene.add(floor);
  const mirror = new Reflector(new PlaneGeometry(size, size), { textureWidth: mirrorRes, textureHeight: mirrorRes, color: new Color(0x4a4a4a), clipBias: 0.003 });
  mirror.rotation.x = -Math.PI / 2;
  scene.add(mirror);
}

/** The hangar: walls of rusted sheet, a bright doorway behind (the god-ray source), haze. */
export function hangar(scene: Scene, opts: { door?: number; fog?: number; warm?: boolean } = {}): { door: Mesh } {
  scene.background = new Color(0x0d0c0b);
  scene.fog = new FogExp2(opts.warm === false ? 0x0e1116 : 0x15110d, opts.fog ?? 0.055);
  wetFloor(scene, 40, 10, 0.4);
  const wall = phMat("rusty_metal_sheet", 4, { color: new Color(0x6a6560) } as never);
  const back = new Mesh(new PlaneGeometry(40, 14), wall);
  back.position.set(0, 7, -9);
  back.receiveShadow = true;
  scene.add(back);
  for (const s of [-1, 1]) {
    const side = new Mesh(new PlaneGeometry(30, 14), wall);
    side.position.set(s * 12, 7, 2);
    side.rotation.y = -s * Math.PI / 2;
    scene.add(side);
  }
  // The doorway: an over-bright opening (sky beyond), the bloom and the rays come from it.
  const door = new Mesh(new PlaneGeometry(4.2, 6), new MeshBasicMaterial({ color: new Color(opts.warm === false ? 0x9fc4ff : 0xffd2a0).multiplyScalar(opts.door ?? 6) }));
  door.position.set(-5.6, 3, -8.95);
  scene.add(door);
  // Crates and drums in the haze.
  const crate = phMat("rusty_metal_02", 1);
  for (const [x, z, w, h] of [[-5.5, -5, 1.6, 1.4], [-6.2, -3.2, 1.2, 1], [4.8, -6, 2.4, 2.4], [6.6, -3.8, 1.4, 1.2], [3.4, -7.4, 1.2, 1.2]] as const) {
    const m = new Mesh(new BoxGeometry(w, h, w), crate);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  return { door };
}

/** A spotlight with its target, shadows on. */
export function spot(scene: Scene, color: number, intensity: number, at: [number, number, number], to: [number, number, number], angle = 0.5, pen = 0.6, shadow = true): SpotLight {
  const s = new SpotLight(color, intensity, 0, angle, pen, 2);
  s.position.set(...at);
  s.target.position.set(...to);
  s.castShadow = shadow;
  s.shadow.mapSize.set(2048, 2048);
  s.shadow.bias = -0.0002;
  s.shadow.normalBias = 0.02;
  scene.add(s, s.target);
  return s;
}

/** A soft light shaft (an additive open cone) for the haze. */
export function shaft(scene: Scene, color: number, from: [number, number, number], to: [number, number, number], r0: number, r1: number, opacity = 0.06): Mesh {
  const A = new Vector3(...from);
  const B = new Vector3(...to);
  const len = A.distanceTo(B);
  const geo = new CylinderGeometry(r0, r1, len, 40, 8, true);
  // Fade along the length and at the rim (vertex colours drive the opacity).
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / len + 0.5;
    const f = Math.pow(t, 1.5);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f;
  }
  geo.setAttribute("color", new Float32BufferAttribute(col, 3));
  const m = new Mesh(geo, new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, vertexColors: true, fog: false }));
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), A.clone().sub(B).normalize());
  scene.add(m);
  return m;
}

/** A plinth for products (guns, loot): dark, slightly glossy, a soft rim. */
export function plinth(scene: Scene, color = 0x0b0c0e): void {
  scene.background = new Color(color);
  const floor = new Mesh(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.35, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

export const v2 = (x: number, y: number) => new Vector2(x, y);

// ── The ruined street (hero shots, the ladder, HUD backdrops) ────────────────

/** Brightest direction of an equirect HDR (the sun), as a unit vector in three's equirect convention. */
export function sunDir(t: Texture): Vector3 {
  const img = t.image as { data: ArrayLike<number>; width: number; height: number };
  const { data, width, height } = img;
  const half = data instanceof Uint16Array;
  const f = (h: number) => {
    if (!half) return h;
    const s = (h & 0x8000) >> 15;
    const e = (h & 0x7c00) >> 10;
    const m = h & 0x03ff;
    return (s ? -1 : 1) * (e === 0 ? Math.pow(2, -14) * (m / 1024) : e === 31 ? 65504 : Math.pow(2, e - 15) * (1 + m / 1024));
  };
  let best = -1;
  let bi = 0;
  for (let i = 0; i < width * height; i++) {
    const l = f(data[i * 4] as number) + f(data[i * 4 + 1] as number) + f(data[i * 4 + 2] as number);
    if (l > best) {
      best = l;
      bi = i;
    }
  }
  const x = bi % width;
  const y = Math.floor(bi / width);
  const u = (x + 0.5) / width;
  const v = 1 - (y + 0.5) / height;
  const phi = (u - 0.5) * Math.PI * 2;
  const lat = (v - 0.5) * Math.PI;
  return new Vector3(Math.cos(lat) * Math.cos(phi), Math.sin(lat), Math.cos(lat) * Math.sin(phi)).normalize();
}

export interface Street {
  sun: Vector3;
}

/** Wet asphalt, kerbs, ruined blocks receding into haze, wrecks and debris, embers. */
export function ruinStreet(scene: Scene, sky: Texture, opts: { fog?: number; fogColor?: number; width?: number; embers?: boolean } = {}): Street {
  const fogCol = new Color(opts.fogColor ?? 0x6b5446);
  scene.fog = new FogExp2(fogCol.getHex(), opts.fog ?? 0.018);
  // Road and pavements.
  const road = new Mesh(new PlaneGeometry(14, 260), phMat("asphalt_02", 1, {} as never));
  for (const t of [road.material.map, road.material.normalMap, road.material.roughnessMap]) t!.repeat.set(4, 74);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.003, -100);
  road.receiveShadow = true;
  const puddles = paint(512, 2048, (u, v) => {
    const n = fbm(u * 3 + 3, v * 12, 5, 3) * 0.5 + 0.5;
    const a = n > 0.62 ? 0 : 255;
    return [a, a, a];
  });
  road.material.alphaMap = tex(puddles, { srgb: false });
  road.material.alphaTest = 0.5;
  scene.add(road);
  const mirror = new Reflector(new PlaneGeometry(14, 260), { textureWidth: 1024, textureHeight: 1024, color: new Color(0x3a3a3a), clipBias: 0.003 });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.set(0, 0, -100);
  scene.add(mirror);
  const walk = phMat("concrete_floor_worn_001", 1, {} as never);
  for (const t of [walk.map, walk.normalMap, walk.roughnessMap]) t!.repeat.set(2, 60);
  for (const s of [-1, 1]) {
    const pv = new Mesh(new BoxGeometry(5, 0.16, 260), walk);
    pv.position.set(s * 9.5, 0.08, -100);
    pv.receiveShadow = true;
    scene.add(pv);
  }
  // Blocks: plaster and brick, broken tops, dark windows.
  const facades = ["plastered_wall", "brick_wall_001", "concrete_panels"].map((n) => phMat(n, 1, {} as never));
  const win = new MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.2, metalness: 0.4, emissive: 0x000000 });
  const litWin = new MeshStandardMaterial({ color: 0x0a0a0b, emissive: 0xffa040, emissiveIntensity: 1.6 });
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (const s of [-1, 1]) {
    let z = 6;
    while (z > -230) {
      const w = 8 + r() * 10;
      const h = 9 + r() * 22;
      const d = 10 + r() * 6;
      const m = facades[Math.floor(r() * facades.length)].clone();
      for (const k of ["map", "normalMap", "roughnessMap"] as const) {
        const t = (m[k] as Texture).clone();
        t.repeat.set(w / 4, h / 4);
        t.needsUpdate = true;
        (m as never as Record<string, Texture>)[k] = t;
      }
      const b = new Mesh(new BoxGeometry(d, h, w), m);
      b.position.set(s * (12 + d / 2), h / 2, z - w / 2);
      b.castShadow = b.receiveShadow = true;
      scene.add(b);
      // Windows on the street face.
      const rows = Math.floor(h / 3.2);
      const cols = Math.floor(w / 2.6);
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) {
          if (r() < 0.12) continue;
          const wm = new Mesh(new PlaneGeometry(1.1, 1.6), r() < 0.05 ? litWin : win);
          wm.position.set(s * (12 - 0.02), 2.2 + i * 3.2, z - 1.3 - j * 2.6);
          wm.rotation.y = -s * Math.PI / 2;
          scene.add(wm);
        }
      // A broken corner on some.
      if (r() < 0.45) {
        const chunk = new Mesh(new BoxGeometry(d * 0.6, 3 + r() * 4, w * 0.5), m);
        chunk.position.set(s * (12 + d * 0.3), h + 0.5, z - w * 0.3);
        chunk.rotation.set(r() * 0.3, r(), r() * 0.4);
        chunk.castShadow = true;
        scene.add(chunk);
      }
      z -= w + 0.5 + r() * 2;
    }
  }
  // Debris, barriers, a burnt car.
  const rubble = phMat("concrete_floor_worn_001", 1, { color: new Color(0x8a8580) } as never);
  for (let i = 0; i < 70; i++) {
    const sz = 0.12 + r() * 0.45;
    const geo = new IcosahedronGeometry(sz, 1);
    const gp = geo.attributes.position;
    for (let k = 0; k < gp.count; k++) {
      const f = 0.7 + r() * 0.5;
      gp.setXYZ(k, gp.getX(k) * f, gp.getY(k) * f * 0.6, gp.getZ(k) * f);
    }
    geo.computeVertexNormals();
    const m = new Mesh(geo, rubble);
    m.position.set((r() - 0.5) * 22, sz * 0.25, -3 - r() * 60);
    m.rotation.set(r(), r() * 3, r());
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  const burnt = new MeshStandardMaterial({ color: 0x1b1715, roughness: 0.8, metalness: 0.4 });
  const car = new Group();
  const body = new Mesh(new BoxGeometry(1.9, 0.8, 4.3), burnt);
  body.position.y = 0.55;
  const cab = new Mesh(new BoxGeometry(1.7, 0.6, 2.2), burnt);
  cab.position.set(0, 1.2, -0.2);
  car.add(body, cab);
  car.position.set(4.2, 0, -9);
  car.rotation.y = 0.5;
  car.traverse((o) => ((o as Mesh).castShadow = (o as Mesh).receiveShadow = true));
  scene.add(car);
  if (opts.embers !== false) {
    const n = 500;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (r() - 0.5) * 16;
      p[i * 3 + 1] = r() * 7;
      p[i * 3 + 2] = 3 - r() * 30;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(p, 3));
    scene.add(new Points(g, new PointsMaterial({ color: new Color(0xffa040).multiplyScalar(6), size: 0.035, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false })));
  }
  const sun = sunDir(sky);
  return { sun };
}

/** A clean studio: a dark grey cove (floor curving up into the wall), for reading a design. */
export function studio(scene: Scene, color = 0x2a2c30): void {
  scene.background = new Color(color);
  const geo = new PlaneGeometry(40, 20, 1, 40);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + 10; // 0 … 20 along the sheet
    const r = 3;
    let yy = 0;
    let zz = 0;
    if (y < 8) {
      zz = 8 - y;
    } else if (y < 8 + (Math.PI / 2) * r) {
      const a = (y - 8) / r;
      zz = -Math.sin(a) * r;
      yy = r - Math.cos(a) * r;
    } else {
      zz = -r;
      yy = r + (y - 8 - (Math.PI / 2) * r);
    }
    p.setXYZ(i, p.getX(i), yy, zz - 4);
  }
  geo.computeVertexNormals();
  const m = new Mesh(geo, new MeshStandardMaterial({ color, roughness: 0.92 }));
  m.receiveShadow = true;
  scene.add(m);
}
