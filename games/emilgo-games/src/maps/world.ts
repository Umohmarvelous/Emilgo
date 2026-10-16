// A map, built: the place around the 120 m run, its sky, sun and fog for the
// time of day, its weather, and the boxes the camera must not pass through.
//
// Lagos Street is the original hand-built street (world/arena); the other 23
// are recipes (maps/recipes) built with the kit (maps/kit). All of them get the
// same sky, light and weather system here.
//
// Draw calls: one LOD mesh per 50 m chunk (+ its foliage, glow and textured
// walls), the ground, the run, the course markings, the sky, the clouds and the
// weather — about 40 for a whole map, whatever is in it.

import {
  AdditiveBlending,
  BackSide,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  LOD,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SpotLight,
  type Texture,
  Vector3,
  type BufferGeometry,
} from "three";

import { DOLL_Z, FIELD } from "../config";
import type { TierSpec } from "../graphics/tiers";
import type { Collider } from "../world/camera";
import { buildArena } from "../world/arena";
import { atlasQuad, merge } from "../world/geo";
import {
  brick,
  canvasTexture,
  concrete,
  glassFacade,
  glow,
  mud,
  plaster,
  thatch,
  tiled,
  wood,
  zinc,
  type Painter,
} from "../world/tex";
import { CELL, cellUv } from "../world/textures";
import { CHUNK, Kit, Z0, courseParts, gantryParts, type TexKind } from "./kit";
import { RECIPES } from "./recipes";
import { mapOf, type MapInfo, type TimeOfDay, type Weather } from "./registry";
import { Air } from "./weather";

export interface World {
  readonly info: MapInfo;
  readonly weather: Weather;
  readonly time: TimeOfDay;
  readonly group: Group;
  readonly fog: Fog;
  readonly clear: Color;
  readonly colliders: Collider[];
  readonly air: Air;
  /** Per frame: weather follows the camera, the shadow box follows `focus`, water moves. */
  update(dt: number, focus: Vector3, cam: Vector3): void;
  /** Particle sizes depend on the screen. */
  setScale(px: number, fovDeg: number): void;
  dispose(): void;
}

const TEX: Record<TexKind, Painter> = { brick, plaster, glass: glassFacade, concrete, wood, mud, thatch, zinc };

// ── Light by time of day ──────────────────────────────────────────────────────

interface Lighting {
  skyTop: Color;
  skyHorizon: Color;
  skyBelow: Color;
  hemiSky: Color;
  hemiGround: Color;
  hemi: number;
  sunColor: Color;
  sun: number;
  /** Sun direction (towards the sun). */
  sunDir: Vector3;
  fogNear: number;
  fogFar: number;
  night: boolean;
  lampsOn: boolean;
  cloudTint: Color;
  cloudCover: number;
}

function lighting(info: MapInfo, time: TimeOfDay, weather: Weather, far: number): Lighting {
  const [top, horizon, ground] = info.colors.map((c) => new Color(c));
  const own = time === info.time; // the map's palette was drawn for its own time
  const L: Lighting = {
    skyTop: top.clone(),
    skyHorizon: horizon.clone(),
    skyBelow: ground.clone().multiplyScalar(0.8),
    hemiSky: new Color(0xdfefff),
    hemiGround: ground.clone(),
    hemi: 1.3,
    sunColor: new Color(0xfff2dc),
    sun: 2.6,
    sunDir: new Vector3(0.45, 0.82, 0.35).normalize(),
    fogNear: 45,
    fogFar: far,
    night: false,
    lampsOn: false,
    cloudTint: new Color(0xffffff),
    cloudCover: 0.75,
  };
  if (time === "golden") {
    if (!own) {
      L.skyTop.set(0x5a6fa8);
      L.skyHorizon.set(0xffc178);
    }
    L.hemiSky.set(0xffd2a0);
    L.hemi = 0.95;
    L.sunColor.set(0xffb46a);
    L.sun = 2.8;
    L.sunDir.set(0.55, 0.22, -0.8).normalize();
    L.cloudTint.set(0xffd8b0);
  } else if (time === "dusk") {
    if (!own) {
      L.skyTop.set(0x2a2f5a);
      L.skyHorizon.set(0xe8875a);
    }
    L.hemiSky.set(0xa898c8);
    L.hemiGround.set(0x4a3a3a);
    L.hemi = 1.25;
    L.sunColor.set(0xff9a6a);
    L.sun = 1.7;
    L.sunDir.set(-0.6, 0.08, -0.8).normalize();
    L.lampsOn = true;
    L.cloudTint.set(0xe0a090);
  } else if (time === "night") {
    if (!own) {
      L.skyTop.set(0x070b1a);
      L.skyHorizon.set(0x1c2440);
    }
    L.skyBelow.set(0x05060a);
    // Night still has to READ: a strong cool moon and sky fill, like a game's night, not a real one.
    L.hemiSky.set(0x6a7ab0);
    L.hemiGround.set(0x22222e);
    L.hemi = 1.45;
    L.sunColor.set(0xb8ccff);
    L.sun = 1.5;
    L.sunDir.set(-0.3, 0.75, 0.55).normalize();
    L.night = true;
    L.lampsOn = true;
    L.fogNear = 25;
    L.fogFar = far * 0.75;
    L.cloudTint.set(0x3a4058);
    L.cloudCover = 0.5;
  }
  const grey = (c: Color, k: number, to: number) => c.lerp(new Color(to), k);
  switch (weather) {
    case "rain": {
      const g = L.night ? 0x1a1e26 : 0x6a7280;
      grey(L.skyTop, 0.7, g);
      grey(L.skyHorizon, 0.65, L.night ? 0x262a34 : 0x8a929c);
      L.sun *= 0.3;
      L.hemi *= 0.9;
      L.fogNear = 18;
      L.fogFar = 115;
      L.cloudTint.set(L.night ? 0x20242c : 0x8a9098);
      L.cloudCover = 0.95;
      break;
    }
    default:
      break;
  }
  return L;
}

// ── Materials ─────────────────────────────────────────────────────────────────

function vcMaterial(spec: TierSpec): Material {
  return spec.pbr ? new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }) : new MeshLambertMaterial({ vertexColors: true });
}

/** Leaves and fronds: two-sided, and still (SPEC-V2: no wind sway). */
function foliageMaterial(spec: TierSpec): Material {
  const m = vcMaterial(spec);
  (m as MeshStandardMaterial).side = DoubleSide;
  return m;
}

function texMaterial(spec: TierSpec, kind: TexKind, size: number): Material {
  const map = canvasTexture(kind, size, TEX[kind]);
  map.wrapS = map.wrapT = RepeatWrapping;
  return spec.pbr
    ? new MeshStandardMaterial({ map, vertexColors: true, roughness: kind === "glass" ? 0.2 : 0.85, metalness: kind === "glass" ? 0.35 : kind === "zinc" ? 0.3 : 0 })
    : new MeshLambertMaterial({ map, vertexColors: true });
}

/** Water: a scrolling ripple pattern with a sun glint; lava glows instead. */
function waterMaterial(kind: "sea" | "river" | "lava" | "pool", time: { value: number }, sky: Color, sun: Vector3): ShaderMaterial {
  const base = kind === "lava" ? new Color(0xff5a1f) : kind === "river" ? new Color(0x4a5a38) : kind === "pool" ? new Color(0x3ab0c8) : new Color(0x1f5f7a);
  return new ShaderMaterial({
    uniforms: { uTime: time, uBase: { value: base }, uSky: { value: sky.clone() }, uSun: { value: sun.clone() }, uLava: { value: kind === "lava" ? 1 : 0 }, fogColor: { value: new Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
    vertexShader: `varying vec3 vW;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uBase; uniform vec3 uSky; uniform vec3 uSun; uniform float uLava; varying vec3 vW;
      #include <fog_pars_fragment>
      float h(vec2 p){ return sin(p.x*0.9 + uTime*1.3)*0.5 + sin(p.y*1.3 - uTime*1.1)*0.35 + sin((p.x+p.y)*2.7 + uTime*2.0)*0.15; }
      void main(){
        vec2 p = vW.xz;
        vec3 n = normalize(vec3(h(p + vec2(0.3,0.0)) - h(p - vec2(0.3,0.0)), 2.0, h(p + vec2(0.0,0.3)) - h(p - vec2(0.0,0.3))));
        vec3 v = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 col = mix(uBase, uSky, fres * 0.75);
        float spec = pow(max(dot(reflect(-normalize(uSun), n), v), 0.0), 80.0);
        col += spec * 0.9;
        if (uLava > 0.5) {
          float c = 0.5 + 0.5 * sin(p.x * 0.7 + uTime * 0.6) * sin(p.y * 0.5 - uTime * 0.4);
          col = mix(vec3(0.35, 0.05, 0.0), vec3(1.0, 0.55, 0.12), smoothstep(0.2, 0.9, c + h(p) * 0.3));
        }
        gl_FragColor = vec4(col, uLava > 0.5 ? 1.0 : 0.92);
        #include <fog_fragment>
      }`,
    transparent: kind !== "lava",
    fog: true,
  });
}

// ── The world ─────────────────────────────────────────────────────────────────

export function buildWorld(id: string, weather: Weather | null, spec: TierSpec, atlas: Texture, timePick: TimeOfDay | null = null): World {
  const info = mapOf(id);
  const w: Weather = weather ?? info.weather;
  const time = timePick ?? info.time;
  const L = lighting(info, time, w, Math.max(150, spec.far));
  const recipe = RECIPES[info.id];
  const group = new Group();
  const uTime = { value: 0 };
  const colliders: Collider[] = [];
  const disposables: { dispose(): void }[] = [];

  // ── Sky ──
  const skyGeo = new SphereGeometry(380, 24, 12);
  const pos = skyGeo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 380;
    if (y > 0.18) c.copy(L.skyHorizon).lerp(L.skyTop, Math.min(1, (y - 0.18) / 0.62));
    else if (y > 0) c.copy(L.skyHorizon);
    else c.copy(L.skyHorizon).lerp(L.skyBelow, Math.min(1, -y * 5));
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  skyGeo.setAttribute("color", new Float32BufferAttribute(cols, 3));
  const skyMat = new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false });
  const sky = new Mesh(skyGeo, skyMat);
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  group.add(sky);
  // Sun or moon on the sky.
  const disc = new Mesh(
    new PlaneGeometry(L.night ? 22 : 46, L.night ? 22 : 46),
    new MeshBasicMaterial({ map: canvasTexture("glow", 128, glow, false), color: L.night ? 0xdfe8ff : L.sunColor, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, opacity: w === "clear" ? 1 : 0.25 }),
  );
  disc.position.copy(L.sunDir).multiplyScalar(340);
  disc.lookAt(0, 0, 0);
  disc.renderOrder = -1;
  group.add(disc);

  // ── Light ──
  const hemi = new HemisphereLight(L.hemiSky, L.hemiGround, L.hemi);
  // Fill from the camera's side so faces and clothes read against a dark street.
  const fill = new DirectionalLight(L.night ? 0x9fb0e0 : 0xffe8d0, L.night ? 0.9 : L.lampsOn ? 0.7 : 0.25);
  fill.position.set(0, 6, 30);
  group.add(fill);
  const sun = new DirectionalLight(L.sunColor, L.sun);
  sun.position.copy(L.sunDir).multiplyScalar(60);
  group.add(hemi, sun, sun.target);
  if (spec.shadows && L.sun > 0.5) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(spec.shadowSize, spec.shadowSize);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -18;
    sc.right = sc.top = 18;
    sc.near = 1;
    sc.far = 160;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
  }
  // After dark, in fog or rain, Mama gets her own light: you must SEE her turn.
  if (L.night || L.lampsOn || w !== "clear") {
    const spot = new SpotLight(0xfff0d8, L.night ? 160 : 90, 40, 0.5, 0.5, 1.4);
    spot.position.set(0, 14, DOLL_Z + 14);
    spot.target.position.set(0, 2.5, DOLL_Z);
    group.add(spot, spot.target);
  }

  // ── Ground and run ──
  const flat = !recipe; // Lagos Street brings its own ground
  if (recipe) {
    const gsz = 520;
    const seg = recipe.terrain ? 130 : 1;
    const gg = new PlaneGeometry(gsz, gsz, seg, seg);
    gg.rotateX(-Math.PI / 2);
    gg.translate(0, 0, -60);
    if (recipe.terrain) {
      const p = gg.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, recipe.terrain(p.getX(i), p.getZ(i)));
      gg.computeVertexNormals();
    }
    const gtex = tiled(canvasTexture(recipe.ground.name, spec.tier === 2 ? 512 : 256, recipe.ground.paint), gsz / recipe.ground.tile, gsz / recipe.ground.tile);
    const gmat = spec.pbr ? new MeshStandardMaterial({ map: gtex, color: recipe.ground.color, roughness: 0.95 }) : new MeshLambertMaterial({ map: gtex, color: recipe.ground.color });
    const ground = new Mesh(gg, gmat);
    ground.receiveShadow = spec.shadows;
    group.add(ground);

    const tw = FIELD.halfWidth * 2 + 0.8;
    const tl = FIELD.backLimitZ + 12 - (FIELD.finishZ - 1);
    const tg = new PlaneGeometry(tw, tl);
    tg.rotateX(-Math.PI / 2);
    tg.translate(0, 0.004, FIELD.backLimitZ + 12 - tl / 2);
    const ttex = tiled(canvasTexture(recipe.track.name, spec.tier === 2 ? 512 : 256, recipe.track.paint), tw / recipe.track.tile, tl / recipe.track.tile);
    const wet = w === "rain";
    const trackColor = new Color(recipe.track.color).multiplyScalar(wet ? 0.72 : 1);
    const tmat = spec.pbr ? new MeshStandardMaterial({ map: ttex, color: trackColor, roughness: wet ? 0.28 : 0.9, metalness: wet ? 0.1 : 0 }) : new MeshLambertMaterial({ map: ttex, color: trackColor });
    const track = new Mesh(tg, tmat);
    track.receiveShadow = spec.shadows;
    group.add(track);

    const crs = new Mesh(merge([...courseParts(recipe.course), ...gantryParts(recipe.gantry)]), vcMaterial(spec));
    crs.receiveShadow = spec.shadows;
    group.add(crs);

    // Painted words and the banner (shared atlas).
    const painted = merge(
      [
        atlasQuad(6.5, 1.6, cellUv(CELL.start), { p: [0, 0.02, 1.3], r: [-Math.PI / 2, 0, 0] }),
        atlasQuad(7, 1.75, cellUv(CELL.finish), { p: [0, 0.02, FIELD.finishZ - 2.4], r: [-Math.PI / 2, 0, 0] }),
        atlasQuad(9, 2.25, cellUv(CELL.banner), { p: [0, 8.7, 0.42] }),
        atlasQuad(9, 2.25, cellUv(CELL.banner), { p: [0, 8.7, 0.38], r: [0, Math.PI, 0] }),
      ],
      true,
    );
    group.add(new Mesh(painted, new MeshLambertMaterial({ map: atlas, alphaTest: 0.5 })));

    // Water, lava, pools.
    for (const wtr of recipe.water ?? []) {
      const wg = new PlaneGeometry(wtr.x1 - wtr.x0, wtr.z0 - wtr.z1, 1, 1);
      wg.rotateX(-Math.PI / 2);
      wg.translate((wtr.x0 + wtr.x1) / 2, wtr.y ?? 0, (wtr.z0 + wtr.z1) / 2);
      const wm = new Mesh(wg, waterMaterial(wtr.kind, uTime, L.skyHorizon, L.sunDir));
      wm.renderOrder = 2;
      group.add(wm);
    }
  }

  // ── The place itself ──
  const kit = new Kit(hash(info.id));
  if (flat) {
    const arena = buildArena(atlas);
    arena.solid.receiveShadow = spec.shadows;
    arena.solid.castShadow = spec.shadows;
    group.add(arena.group);
  } else {
    recipe.build(kit, L.night || time === "dusk");
    colliders.push(...kit.colliders);
    const vc = vcMaterial(spec);
    const fol = foliageMaterial(spec);
    const glowMat = new MeshBasicMaterial({ vertexColors: true });
    const texMats = new Map<TexKind, Material>();
    const near = spec.tier === 0 ? 45 : 75;
    const mid = spec.tier === 0 ? 110 : 165;
    for (const [i, ch] of kit.chunks) {
      const cz = Z0 - (i + 0.5) * CHUNK;
      const shift = (gs: BufferGeometry[]) => gs.map((g) => g.translate(0, 0, -cz));
      shift(ch.mass);
      shift(ch.main);
      shift(ch.detail);
      const lod = new LOD();
      lod.position.set(0, 0, cz);
      const lvl = (parts: BufferGeometry[]): Object3D => {
        if (!parts.length) return new Object3D();
        const m = new Mesh(merge(parts), vc);
        m.castShadow = m.receiveShadow = spec.shadows;
        return m;
      };
      if (ch.mass.length + ch.main.length + ch.detail.length) {
        lod.addLevel(lvl([...ch.mass, ...ch.main, ...ch.detail]), 0);
        if (ch.main.length || ch.detail.length) lod.addLevel(lvl([...ch.mass, ...ch.main]), near);
        if (ch.detail.length || ch.main.length) lod.addLevel(lvl(ch.mass), mid);
        group.add(lod);
      }
      if (ch.foliage.length) {
        const m = new Mesh(merge(ch.foliage), fol);
        m.castShadow = spec.shadows;
        group.add(m);
      }
      if (ch.glow.length) group.add(new Mesh(merge(ch.glow), glowMat));
      for (const [kind, gs] of Object.entries(ch.tex) as [TexKind, BufferGeometry[]][]) {
        if (!gs.length) continue;
        let m = texMats.get(kind);
        if (!m) {
          m = texMaterial(spec, kind, spec.tier === 2 ? 512 : 256);
          texMats.set(kind, m);
        }
        const mesh = new Mesh(merge(gs, true), m);
        mesh.castShadow = mesh.receiveShadow = spec.shadows;
        group.add(mesh);
      }
    }
    if (kit.far.length) group.add(new Mesh(merge(kit.far), vc));
    if (kit.farGlow.length) group.add(new Mesh(merge(kit.farGlow), glowMat));
  }

  const air = new Air(w, {
    particles: spec.particles,
    night: L.night,
    cloudTint: L.cloudTint,
    cloudCover: L.cloudCover,
    lamps: kit.lamps,
    lampColor: new Color(recipe?.lampColor ?? "#ffe0a0"),
    lampsOn: L.lampsOn,
  });
  group.add(air.group);
  disposables.push(air);

  const fog = new Fog(L.skyHorizon.clone(), L.fogNear, L.fogFar);
  const clear = L.skyHorizon.clone();

  return {
    info,
    weather: w,
    time,
    group,
    fog,
    clear,
    colliders,
    air,
    update(dt, focus, cam) {
      uTime.value += dt;
      air.update(dt, cam);
      // Keep the shadow map's box on the action.
      sun.position.set(focus.x + L.sunDir.x * 60, L.sunDir.y * 60, focus.z + L.sunDir.z * 60);
      sun.target.position.set(focus.x, 0, focus.z);
    },
    setScale(px, fov) {
      air.setScale(px, fov);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose?.();
      });
    },
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

