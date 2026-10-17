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
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  LOD,
  type Material,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  SpotLight,
  type Texture,
  Vector3,
  type BufferGeometry,
} from "three";

import { DEFAULT_COURSE, FIELD, type Course } from "../config";
import type { TierSpec } from "../graphics/tiers";
import type { Collider } from "../world/camera";
import { buildArena } from "../world/arena";
import { Lasers } from "../world/lasers";
import { atlasQuad, merge } from "../world/geo";
import {
  brick,
  canvasTexture,
  concrete,
  glassFacade,
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
import { RECIPES, useCourse } from "./recipes";
import { mapOf, skyParts, type MapInfo, type SkyState, type TimeOfDay, type Weather } from "./registry";
import { Birds } from "./birds";
import { Potholes, REFLECT_LAYER } from "./potholes";
import { Sky } from "./sky";
import { Air } from "./weather";

export interface World {
  readonly info: MapInfo;
  readonly sky: SkyState;
  readonly weather: Weather;
  readonly time: TimeOfDay;
  readonly night: boolean;
  readonly group: Group;
  readonly fog: Fog;
  readonly clear: Color;
  readonly colliders: Collider[];
  readonly air: Air;
  /** The field kit every map carries (SPEC-V2 §6.1). */
  readonly lasers: Lasers;
  readonly potholes: Potholes | null;
  /** Per frame: weather follows the camera, the shadow box follows `focus`, water moves. */
  update(dt: number, focus: Vector3, cam: Vector3): void;
  /** High: the puddles' mirror pass, just before the frame. */
  beforeRender(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void;
  /** Particle sizes depend on the screen. */
  setScale(px: number, fovDeg: number): void;
  dispose(): void;
}

const TEX: Record<TexKind, Painter> = { brick, plaster, glass: glassFacade, concrete, wood, mud, thatch, zinc };
/** Ground and wall textures per tier (SPEC-V2 §6.3: 256 / 512 / 1024). */
const TEX_SIZE = [256, 512, 1024] as const;

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
    // A faint fade at the far edge only (SPEC-V2): nothing pops in, nothing is lost.
    fogNear: far * 0.55,
    fogFar: far,
    night: false,
    lampsOn: false,
    cloudTint: new Color(0xffffff),
    cloudCover: 0.55,
  };
  if (!own && time === "day") {
    L.skyTop.set(0x5f9fdc);
    L.skyHorizon.set(0xcfe2ee);
  }
  if (time === "sunset") {
    // Low sun behind Mama: she stands against it.
    if (!own) {
      L.skyTop.set(0x4a5c9a);
      L.skyHorizon.set(0xffb070);
    }
    L.hemiSky.set(0xffc898);
    L.hemiGround.set(0x5a4434);
    L.hemi = 1.0;
    L.sunColor.set(0xffa860);
    L.sun = 2.6;
    L.sunDir.set(0.45, 0.16, -0.88).normalize();
    L.cloudTint.set(0xffc8a0);
    L.cloudCover = 0.6;
  } else if (time === "sunrise") {
    // Low sun behind the runners, a pink sky over Mama, a cool fresh light.
    L.skyTop.set(0x7f9fd0);
    L.skyHorizon.set(0xf6c2b0);
    L.hemiSky.set(0xd8d0e8);
    L.hemiGround.set(0x6a5a50);
    L.hemi = 1.15;
    L.sunColor.set(0xffcf9a);
    L.sun = 2.3;
    L.sunDir.set(-0.5, 0.2, 0.84).normalize();
    L.cloudTint.set(0xffd8cc);
    L.cloudCover = 0.5;
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
    L.cloudTint.set(0x3a4058);
    L.cloudCover = 0.4;
  }
  if (weather === "rain") {
    const grey = (c: Color, k: number, to: number) => c.lerp(new Color(to), k);
    grey(L.skyTop, 0.7, L.night ? 0x1a1e26 : 0x6a7280);
    grey(L.skyHorizon, 0.65, L.night ? 0x262a34 : 0x8a929c);
    L.sun *= 0.3;
    L.hemi *= 0.9;
    L.fogNear = far * 0.4;
    L.lampsOn = true;
    L.cloudTint.set(L.night ? 0x20242c : 0x8a9098);
    L.cloudCover = 0.95;
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

/**
 * Build a map for a round. `skyState` is the final state (light / dark mode
 * already applied); null is the map's own. The view reaches past Mama however
 * long the run (the doll is never lost in the fog).
 */
export function buildWorld(id: string, skyState: SkyState | null, spec: TierSpec, atlas: Texture, course: Course = DEFAULT_COURSE): World {
  const info = mapOf(id);
  const state = skyState ?? info.sky;
  const { time, weather: w } = skyParts(state);
  const reach = Math.max(spec.far, -course.dollZ + 90);
  const L = lighting(info, time, w, reach);
  const texSize = TEX_SIZE[spec.tier];
  const recipe = RECIPES[info.id];
  const group = new Group();
  const uTime = { value: 0 };
  const colliders: Collider[] = [];
  const disposables: { dispose(): void }[] = [];

  // ── Sky ──
  const sky = new Sky(
    { top: L.skyTop, horizon: L.skyHorizon, below: L.skyBelow, sunDir: L.sunDir, sunColor: L.sunColor, night: L.night, rain: w === "rain", cloudTint: L.cloudTint, cloudCover: L.cloudCover },
    spec.fancy,
  );
  group.add(sky.group);
  disposables.push(sky);

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
    sun.shadow.camera.layers.enable(SHADOW_LAYER);
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
    spot.position.set(0, 14, course.dollZ + 14);
    spot.target.position.set(0, 2.5, course.dollZ);
    group.add(spot, spot.target);
  }

  // ── Ground and run ──
  const flat = !recipe; // Lagos Street brings its own ground
  if (recipe) {
    // From well behind the start to well past Mama, whatever the distance.
    const gsz = 520;
    const zNear = 200;
    const zFar = course.dollZ - 260;
    const glen = zNear - zFar;
    // Dunes and hills are broad: a 10 m grid is plenty (≈ 8K triangles for a 300 m run).
    const seg = recipe.terrain ? Math.round(gsz / 10) : 1;
    const gg = new PlaneGeometry(gsz, glen, seg, recipe.terrain ? Math.round(glen / 10) : 1);
    gg.rotateX(-Math.PI / 2);
    gg.translate(0, 0, (zNear + zFar) / 2);
    if (recipe.terrain) {
      const p = gg.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, recipe.terrain(p.getX(i), p.getZ(i)));
      gg.computeVertexNormals();
    }
    const gtex = tiled(canvasTexture(recipe.ground.name, texSize, recipe.ground.paint), gsz / recipe.ground.tile, glen / recipe.ground.tile);
    const gmat = spec.pbr ? new MeshStandardMaterial({ map: gtex, color: recipe.ground.color, roughness: 0.95 }) : new MeshLambertMaterial({ map: gtex, color: recipe.ground.color });
    const ground = new Mesh(gg, gmat);
    ground.receiveShadow = spec.shadows;
    group.add(ground);

    const tw = course.halfWidth * 2 + 0.8;
    const tl = course.backLimitZ + 12 - (course.finishZ - 1);
    const tg = new PlaneGeometry(tw, tl);
    tg.rotateX(-Math.PI / 2);
    tg.translate(0, 0.004, course.backLimitZ + 12 - tl / 2);
    const ttex = tiled(canvasTexture(recipe.track.name, texSize, recipe.track.paint), tw / recipe.track.tile, tl / recipe.track.tile);
    const wet = w === "rain";
    const trackColor = new Color(recipe.track.color).multiplyScalar(wet ? 0.72 : 1);
    const tmat = spec.pbr ? new MeshStandardMaterial({ map: ttex, color: trackColor, roughness: wet ? 0.28 : 0.9, metalness: wet ? 0.1 : 0 }) : new MeshLambertMaterial({ map: ttex, color: trackColor });
    const track = new Mesh(tg, tmat);
    track.receiveShadow = spec.shadows;
    group.add(track);

    const crs = new Mesh(merge([...courseParts(recipe.course, course), ...gantryParts(recipe.gantry, course.halfWidth)]), vcMaterial(spec));
    crs.receiveShadow = spec.shadows;
    group.add(crs);

    // Painted words and the banner (shared atlas).
    const painted = merge(
      [
        atlasQuad(6.5, 1.6, cellUv(CELL.start), { p: [0, 0.02, 1.3], r: [-Math.PI / 2, 0, 0] }),
        atlasQuad(7, 1.75, cellUv(CELL.finish), { p: [0, 0.02, course.finishZ - 2.4], r: [-Math.PI / 2, 0, 0] }),
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
  /**
   * Scenery pieces that may cast shadows, where they stand, and how close the
   * runner must be. Full detail casts only from the stretch you're in (High);
   * further out — and always on Medium — a stand-in of the buildings' volumes
   * casts instead (drawn into the shadow map only, never to the screen).
   */
  const casters: { mesh: Object3D; z: number; within: number }[] = [];
  const near = spec.tier === 0 ? 40 : spec.tier === 1 ? 55 : 60;
  const proxyMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  if (flat) {
    const arena = buildArena(atlas, course);
    for (const s of arena.solid) {
      s.mesh.receiveShadow = spec.shadows;
      // The long road and pavements only receive.
      if (Number.isFinite(s.z)) casters.push({ ...s, within: spec.tier === 2 ? 40 : 30 });
    }
    group.add(arena.group);
  } else {
    // Lay the recipe out for this course; the far backdrop moves back with Mama.
    useCourse(course);
    kit.back = course.finishZ - FIELD.finishZ;
    kit.tier = spec.tier;
    recipe.build(kit, L.night || w === "rain");
    colliders.push(...kit.colliders);
    const vc = vcMaterial(spec);
    const fol = foliageMaterial(spec);
    const glowMat = new MeshBasicMaterial({ vertexColors: true });
    const texMats = new Map<TexKind, Material>();
    const mid = spec.tier === 0 ? 90 : spec.tier === 1 ? 120 : 130;
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
        m.receiveShadow = spec.shadows;
        if (spec.tier === 2 && parts.length === ch.mass.length + ch.main.length + ch.detail.length) casters.push({ mesh: m, z: cz, within: 30 });
        return m;
      };
      if (ch.mass.length + ch.main.length + ch.detail.length) {
        lod.addLevel(lvl([...ch.mass, ...ch.main, ...ch.detail]), 0);
        if (ch.main.length || ch.detail.length) lod.addLevel(lvl([...ch.mass, ...ch.main]), near);
        if (ch.detail.length || ch.main.length) lod.addLevel(lvl(ch.mass), mid);
        group.add(lod);
        if (spec.shadows && ch.mass.length) {
          const proxy = new Mesh(merge(ch.mass), proxyMat);
          proxy.position.z = cz;
          // Only the sun's shadow camera sees this layer: no cost on screen.
          proxy.layers.set(SHADOW_LAYER);
          group.add(proxy);
          casters.push({ mesh: proxy, z: cz, within: 90 });
          // High: the stand-in covers what the detailed piece doesn't.
          if (spec.tier === 2) casters.push({ mesh: proxy, z: cz, within: -30 });
        }
      }
      if (ch.foliage.length) {
        const m = new Mesh(merge(ch.foliage), fol);
        casters.push({ mesh: m, z: cz, within: spec.tier === 2 ? 40 : 30 });
        group.add(m);
      }
      if (ch.glow.length) group.add(new Mesh(merge(ch.glow), glowMat));
      for (const [kind, gs] of Object.entries(ch.tex) as [TexKind, BufferGeometry[]][]) {
        if (!gs.length) continue;
        let m = texMats.get(kind);
        if (!m) {
          m = texMaterial(spec, kind, Math.min(512, texSize));
          texMats.set(kind, m);
        }
        const mesh = new Mesh(merge(gs, true), m);
        mesh.receiveShadow = spec.shadows;
        casters.push({ mesh, z: cz, within: spec.tier === 2 ? 30 : 0 });
        group.add(mesh);
      }
    }
    if (kit.far.length) {
      // The far backdrop: hazed towards the horizon's colour, never fogged away
      // (the mountains stay on the horizon however far the run goes).
      const farGeo = merge(kit.far);
      const col = farGeo.attributes.color;
      const hz = L.skyHorizon;
      for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) + (hz.r - col.getX(i)) * 0.45, col.getY(i) + (hz.g - col.getY(i)) * 0.45, col.getZ(i) + (hz.b - col.getZ(i)) * 0.45);
      const farMat = new MeshLambertMaterial({ vertexColors: true, fog: false });
      group.add(new Mesh(farGeo, farMat));
    }
    if (kit.farGlow.length) group.add(new Mesh(merge(kit.farGlow), glowMat));
  }

  const air = new Air(w, {
    particles: spec.particles,
    lamps: kit.lamps,
    lampColor: new Color(recipe?.lampColor ?? "#ffe0a0"),
    lampsOn: L.lampsOn,
  });
  group.add(air.group);
  disposables.push(air);

  // ── The field kit: laser towers, puddles, birds ──
  const lasers = new Lasers(course, spec, L.night);
  group.add(lasers.group);
  for (const p of lasers.pieces) casters.push({ mesh: p.mesh, z: p.z, within: 45 });
  disposables.push(lasers);
  const potholes = DRY.has(info.id) ? null : new Potholes(course, hash(info.id), { top: L.skyTop, horizon: L.skyHorizon, sunDir: L.sunDir, sunColor: L.sunColor, night: L.night }, spec.fancy);
  if (potholes) {
    group.add(potholes.group);
    disposables.push(potholes);
  }
  const birds = !L.night && w === "clear" && !INDOOR.has(info.id) ? new Birds(hash(info.id), course.finishZ / 2) : null;
  if (birds) {
    group.add(birds.group);
    disposables.push(birds);
  }
  // What the puddles mirror (High): the sky and the far backdrop (and Mama, in the session).
  if (spec.fancy) {
    sky.group.traverse((x) => x.layers.enable(REFLECT_LAYER));
    group.traverse((x) => {
      if ((x as Mesh).isMesh && ((x as Mesh).material as Material & { fog?: boolean }).fog === false && x.parent === group) x.layers.enable(REFLECT_LAYER);
    });
  }

  const fog = new Fog(L.skyHorizon.clone(), L.fogNear, L.fogFar);
  const clear = L.skyHorizon.clone();

  return {
    info,
    sky: state,
    weather: w,
    time,
    night: L.night,
    group,
    fog,
    clear,
    colliders,
    air,
    lasers,
    potholes,
    update(dt, focus, cam) {
      uTime.value += dt;
      air.update(dt, cam);
      sky.update(dt, cam);
      potholes?.update(dt);
      birds?.update(dt);
      // Keep the shadow map's box on the action, and only nearby scenery in it.
      sun.position.set(focus.x + L.sunDir.x * 60, L.sunDir.y * 60, focus.z + L.sunDir.z * 60);
      sun.target.position.set(focus.x, 0, focus.z);
      if (spec.shadows) {
        for (const c of casters) c.mesh.castShadow = false;
        for (const c of casters) {
          const d = Math.abs(c.z - focus.z);
          // within > 0: cast when closer than it; within < 0: cast when FURTHER than −within (High's stand-ins).
          if (c.within > 0 ? d < c.within : c.within < 0 && d >= -c.within && d < 90) c.mesh.castShadow = true;
        }
      }
    },
    setScale(px, fov) {
      air.setScale(px, fov);
      potholes?.setScale(px, fov);
    },
    beforeRender(renderer, scene, camera) {
      potholes?.renderMirror(renderer, scene, camera);
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

/** Shadow stand-ins live here: the sun's shadow camera sees it, the screen doesn't. */
const SHADOW_LAYER = 2;

/** No puddles on polished or covered floors. */
const DRY = new Set(["dubai-mall", "underground-bunker", "abandoned-hospital"]);
/** No sky for birds. */
const INDOOR = new Set(["underground-bunker"]);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

