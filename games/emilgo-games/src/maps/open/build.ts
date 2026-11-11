// An open world, built for the screen (SPEC-V3 §6.2): the layout's prefabs
// drawn and filed into 50 m cells (8 × 8 for Naija World), each cell merged
// into a three-level LOD, its textured walls in one atlas draw; one painted
// ground; the gutters and the river; the Harmattan haze at the tier's view
// distance (cells past it are not drawn at all); and a potentially-visible set
// per cell, baked here by casting rays against the buildings' masses.
//
// Draw calls stay flat however big the city: about three per visible cell,
// plus the ground, the water and the sky.

import { GROUND_LIB, WALL_LIB } from "./atlasLists";
import { ktxAtlas } from "../../assets/ktx";
import { impostorMesh, loadImpostors, speciesOf, type ImpostorSet, type Species } from "./impostors";
import { PROPS } from "./propTable";
import {
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Quaternion,
  SphereGeometry,
  type DataTexture,
  type Texture,
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
  CanvasTexture,
  SRGBColorSpace,
  LinearMipmapLinearFilter,
  NearestFilter,
  RepeatWrapping,
  ShaderMaterial,
  Float32BufferAttribute,
  Vector3,
  type Camera,
  type Scene,
  type WebGLRenderer,
  type BufferAttribute,
} from "three";

import type { TierSpec } from "../../graphics/tiers";
import { Space } from "../../game/core/space";
import { merge, type V3 } from "../../world/geo";
import { canvasTexture, concrete, glassFacade, mud, plaster, thatch, wood, zinc, brick, sand, type Painter } from "../../world/tex";
import { Sky } from "../sky";
import type { TexKind } from "../kit";
import { emptyChunk, PrefabKit, TEX_KINDS, TEX_STRIDE, type OpenChunk, type TreeAt } from "./art";
import { EDGE, GUTTER, pondRadius, SURFACE_OF, type GroundKind, type OpenLayout, type Pond } from "./naija";
import { sky as librarySky, texAlbedo, texSet, texSize, type SkyName, type TexName } from "../../assets/library";
import { modelFor, type CdnModel } from "../../assets/cdn";
import type { Placement } from "./prefabs";
import type { TerrainShot } from "../../ui/minimap";

export const CELL = 50;
const _up = new Vector3(0, 1, 0);
const _sc = new Vector3();
const _at = new Vector3();
const _q = new Quaternion();
const _m4 = new Matrix4();
/** View distance by tier (SPEC-V3 §6.2): beyond it, haze, and nothing drawn. */
export const VIEW = [110, 160, 220] as const;
/** The PVS holds while the camera is below this; higher up (a roof, the mast) it sees everything in range. */
const PVS_EYE = 3.0;

export interface OpenWorld {
  readonly layout: OpenLayout;
  readonly space: Space;
  readonly group: Group;
  readonly fog: Fog;
  readonly clear: Color;
  readonly view: number;
  /** The minimap's picture of the whole city. */
  readonly terrain: TerrainShot;
  /** Per frame: which cells are drawn, LODs, the shadow casters near `focus`. */
  update(dt: number, focus: Vector3, cam: Vector3): void;
  /**
   * Darken the city (Lights Out, Phase 6): 0 as built … 1 a power cut at
   * night. Lights, haze and the sky follow; `clear` is updated, so the mode
   * sets the renderer's clear colour from it again.
   */
  setDim(k: number): void;
  /** The Harmattan (Phase 6): 0 clear … 1 a sandstorm (dusty haze, `see` metres of view). */
  setDust(k: number, see: number): void;
  /** What's drawn now (for the dev page and the perf gate). */
  stats(): { cells: number; pvsCut: number };
  /** The HDR sky's light (an equirect HDR), for the lit tiers' environment; null without the library. */
  readonly skyEnv: Texture | null;
  /** Is the cell at (x, z) drawn this frame (in range, not hidden by the PVS)? The billboards count what's seen with it. */
  cellOn(x: number, z: number): boolean;
  /** Compile every shader off the main thread where the browser can (before the first frame). */
  warm(renderer: WebGLRenderer, scene: Scene, camera: Camera): Promise<void>;
  /** Baked PVS: how many cells each cell can see, on average and at most. */
  readonly pvs: { mean: number; max: number; ms: number };
  dispose(): void;
}

const PAINTERS: Record<TexKind, Painter> = { plaster, concrete, brick, wood, mud, zinc, glass: glassFacade, thatch };

// ── The atlas ─────────────────────────────────────────────────────────────────

/**
 * Eight wall textures side by side (4 × 2) in one canvas. v4 rework: the
 * library's CC0 photo textures where it has them (a normal atlas beside it on
 * the lit tiers), the game's own drawn ones where it doesn't.
 */
function* atlasTexture(tile: number, lib: WorldLibrary | null): Generator<void, { map: CanvasTexture; normal: CanvasTexture | null }> {
  const c = document.createElement("canvas");
  c.width = tile * 4;
  c.height = tile * 2;
  const g = c.getContext("2d")!;
  const nc = lib?.walls.some((w) => w?.n) ? document.createElement("canvas") : null;
  const ng = nc?.getContext("2d") ?? null;
  if (nc && ng) {
    nc.width = tile * 4;
    nc.height = tile * 2;
    ng.fillStyle = "rgb(128,128,255)";
    ng.fillRect(0, 0, nc.width, nc.height);
  }
  for (let i = 0; i < TEX_KINDS.length; i++) {
    const x = (i % 4) * tile;
    const y = Math.floor(i / 4) * tile;
    const own = lib?.walls[i];
    if (own) {
      g.drawImage(own.a, x, y, tile, tile);
      if (own.n && ng) ng.drawImage(own.n, x, y, tile, tile);
    } else {
      const t = canvasTexture(TEX_KINDS[i], tile, PAINTERS[TEX_KINDS[i]]);
      g.drawImage(t.image as HTMLCanvasElement, x, y);
    }
    yield;
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  let n: CanvasTexture | null = null;
  if (nc) {
    n = new CanvasTexture(nc);
    n.minFilter = LinearMipmapLinearFilter;
    n.anisotropy = 4;
  }
  return { map: t, normal: n };
}

// ── The library (v4 rework R4): the CC0 photo textures for the walls and the ground ──

/** The wall atlas's eight tiles as library textures (TEX_KINDS order), day and night. */
// (v6 max: WALL_LIB and GROUND_LIB live in atlasLists.ts, shared with the KTX2 bake.)
/** The ground kinds in the ground atlas's order (4 × 2), their textures, and metres per repeat. */
export const GROUND_KINDS: GroundKind[] = ["asphalt", "laterite", "paving", "grass", "earth", "sand", "snow"];

const GROUND_REP = [7, 6, 4, 5, 6, 7, 6];
/** How much of each kind's own colour shows (the photo dirt and gravel are warm; a city's verges are grey). */
const GROUND_SAT = [1, 0.45, 1, 0.9, 0.4, 1, 1];

export interface WorldLibrary {
  /** v6 max (3.4): the scanned trees as impostors (impostors.ts), when they came. */
  trees?: ImpostorSet | null;
  /** v6 max (3.4): the wall and ground atlases baked to KTX2 (tools/assets/atlases.ts), when they came. */
  atlases?: { walls: { a: Texture; n: Texture | null } | null; ground: { a: Texture; n: Texture | null } | null };
  walls: ({ a: HTMLImageElement; n: HTMLImageElement | null } | null)[];
  ground: ({ a: HTMLImageElement; n: HTMLImageElement | null } | null)[];
  /** The scanned CC0 rocks (Poly Haven, the pipeline's) for the "rock" prefab, Medium and up: mossy on grass, bare granite on sand. */
  rocks: { grass: CdnModel | null; sand: CdnModel | null };
  /** The CC0 props this layout places (by table index), Medium and up: each drawn as its model, instanced per cell. */
  props: Map<number, CdnModel>;
  /** The HDR sky (Poly Haven, CC0): its picture, its light, and the colour at its horizon (the haze matches it). */
  sky: { bg: Texture; env: DataTexture | null; horizon: Color; sun: Vector3 } | null;
}

/** Where the sky's sun is (its brightest patch), as a direction; kept at least 20° up so shadows stay short. */
function sunOf(tex: Texture): Vector3 {
  const im = tex.image as HTMLImageElement;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.drawImage(im, 0, 0, 128, 64);
  const d = g.getImageData(0, 0, 128, 32).data;
  let best = -1;
  let at = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    if (l > best) {
      best = l;
      at = i / 4;
    }
  }
  const u = ((at % 128) + 0.5) / 128;
  const v = 1 - (Math.floor(at / 128) + 0.5) / 64;
  // The sky sphere's own mapping (SphereGeometry, mirrored to be seen from inside): azimuth 2πu from +x toward +z.
  const phi = u * Math.PI * 2;
  const th = Math.max(0.35, (v - 0.5) * Math.PI);
  return new Vector3(Math.cos(th) * Math.cos(phi), Math.sin(th), Math.cos(th) * Math.sin(phi)).normalize();
}

/** Which sky each world wears (v4 rework): a clear afternoon for the cities, a moonlit night for Dead Streets. */
const SKY_OF: Record<"day" | "night", SkyName> = { day: "day", night: "night" };

/** The average colour of a sky picture's horizon row (where the fog meets it). */
function horizonOf(tex: Texture): Color {
  const im = tex.image as HTMLImageElement;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 32;
  const g = c.getContext("2d")!;
  g.drawImage(im, 0, 0, 64, 32);
  const d = g.getImageData(0, 15, 64, 2).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    gg += d[i + 1];
    b += d[i + 2];
  }
  const n = d.length / 4;
  return new Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, SRGBColorSpace);
}

/** Fetch what a world of this tier draws with (null: the library isn't there). */
export async function loadWorldLibrary(spec: TierSpec, night: boolean, L?: OpenLayout): Promise<WorldLibrary | null> {
  const size = texSize(spec.tier);
  const get = async (n: TexName | null) => {
    if (!n) return null;
    if (!spec.pbr) {
      const a = await texAlbedo(n, size);
      return a ? { a, n: null } : null;
    }
    const s = await texSet(n, size);
    return s ? { a: s.a, n: s.n } : null;
  };
  const key = night ? "night" : "day";
  const rockLod = spec.tier >= 2 ? 1 : 2;
  const rockOf = (use: string) => (spec.tier >= 1 ? modelFor(use, rockLod, spec.tier).catch(() => null) : Promise.resolve(null));
  // The props this layout uses (v4 rework R9), High and Max only (their draws cost Medium its 30 fps floor
  // on a slow phone; Medium draws each solid one as a plain crate in the cell's own mesh): the middle LOD.
  const used = spec.tier >= 2 && L ? [...new Set(L.placements.filter((p) => p.prefab === "prop").map((p) => p.v & 255))] : [];
  const propModels = Promise.all(used.map((i) => (PROPS[i] ? modelFor("prop", rockLod, spec.tier, PROPS[i].id).catch(() => null) : Promise.resolve(null))));
  // v6 max (3.4): the baked atlases, compressed, first (all of a set or none of it); the pictures only where they didn't come.
  const baked = async (what: "walls" | "ground"): Promise<{ a: Texture; n: Texture | null } | null> => {
    const [a, nm] = await Promise.all([ktxAtlas(`${what}-${key}.a.${size}`, what === "ground" ? 8 : 4), spec.pbr ? ktxAtlas(`${what}-${key}.n.${size}`, what === "ground" ? 8 : 4) : Promise.resolve(null)]);
    if (!a || (spec.pbr && !nm)) {
      a?.dispose();
      nm?.dispose();
      return null;
    }
    return { a, n: nm };
  };
  const [bw, bg, trees] = await Promise.all([baked("walls"), baked("ground"), loadImpostors(spec).catch(() => null)]);
  const [walls, ground, sk, grassRock, sandRock, pm] = await Promise.all([
    bw ? Promise.resolve(WALL_LIB[key].map(() => null)) : Promise.all(WALL_LIB[key].map(get)),
    bg ? Promise.resolve(GROUND_LIB[key].map(() => null)) : Promise.all(GROUND_LIB[key].map(get)),
    librarySky(SKY_OF[key], spec.pbr),
    rockOf("rocks"),
    rockOf("rock"),
    propModels,
  ]);
  if (!ground.some(Boolean) && !walls.some(Boolean) && !bw && !bg) return null;
  const props = new Map<number, CdnModel>();
  used.forEach((idx, j) => pm[j]?.meshes.length && props.set(idx, pm[j]!));
  return { walls, ground, atlases: { walls: bw, ground: bg }, trees, rocks: { grass: grassRock, sand: sandRock }, props, sky: sk.bg ? { bg: sk.bg, env: sk.env, horizon: horizonOf(sk.bg), sun: sunOf(sk.bg) } : null };
}

/**
 * v5 (3.7, the realism pass): the trees' crowns (the foliage, drawn apart
 * with this material) get clumps of needles and leaves from their position in the world,
 * with no texture and no new draw: dark gaps, lit tips, the surface bumped so
 * light falls through unevenly. Only the leaves pay for it (two noise
 * lookups a pixel). High and Max only: it cost Medium a quarter of its frame
 * rate on a slowed phone (48 → 35 fps), so Medium keeps flat leaves.
 */
function detailed(m: MeshStandardMaterial): MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldD;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorldD = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWorldD;
        float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float dNoise(vec3 x) {
          vec3 i = floor(x), f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dHash(i), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float dLeafy = 0.0; float dH = 0.0;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 c0 = diffuseColor.rgb;
          // Only leaves are drawn with this material (the foliage bucket): every pixel is a leaf.
          dLeafy = 1.0;
          vec3 p = vWorldD;
          if (dLeafy > 0.0) {
            float clump = dNoise(p * 2.3);
            float fine = dNoise(p * 9.0 + clump * 2.0);
            dH = clump * 0.6 + fine * 0.4;
            // Gaps between the clumps go dark; the tips catch the sun, a touch yellower.
            vec3 leaf = c0 * (0.45 + 0.95 * smoothstep(0.25, 0.85, dH));
            leaf = mix(leaf, leaf * vec3(1.12, 1.1, 0.8), smoothstep(0.7, 0.95, fine) * 0.6);
            diffuseColor.rgb = mix(c0, leaf, dLeafy);
          }
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        if (dLeafy > 0.0) {
          // The clumps' bump (screen-space derivatives of the height): light falls unevenly through a crown.
          vec3 sp = -vViewPosition;
          vec3 sx = normalize(dFdx(sp)), sy = normalize(dFdy(sp));
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec2 dh = vec2(dFdx(dH), dFdy(dH)) * 0.9 * dLeafy;
          vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
          normal = normalize(abs(det) * normal - g);
        }`,
      );
  };
  m.customProgramCacheKey = () => "open-vc-detail-2";
  return m;
}

/**
 * v6 max (3.4, baked light on the walls): the light the sky can't reach at a wall's foot. Every upright face darkens
 * toward the ground (the ground under it does too: bakeGroundLight's contact shade), most in the sky's light, a
 * little in the sun's (what the ground would bounce up), gone 2.4 m up. Worked out per pixel from the height, so
 * it costs the phone nothing to build and a few sums a pixel to draw; floors, roofs and the ground don't take it.
 * Chained onto the material's own shader changes.
 */
function footShade<M extends Material>(m: M, name: string): M {
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vFootY; varying float vFootNy;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vFootY = (modelMatrix * vec4(transformed, 1.0)).y;
        vFootNy = normalize(mat3(modelMatrix) * objectNormal).y;`,
      );
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vFootY; varying float vFootNy;").replace(
      "#include <aomap_fragment>",
      `#include <aomap_fragment>
      {
        float upright = 1.0 - smoothstep(0.45, 0.85, abs(vFootNy));
        float foot = 1.0 - (1.0 - smoothstep(0.0, 2.4, vFootY)) * 0.55 * upright;
        reflectedLight.indirectDiffuse *= foot;
        reflectedLight.directDiffuse *= mix(1.0, foot, 0.35);
      }`,
    );
  };
  m.customProgramCacheKey = () => `${name}+foot`;
  return m;
}

/**
 * The atlas material: the UV's integer part over TEX_STRIDE picks the tile,
 * its fraction repeats inside it. Gradients come from the unwrapped UV, so the
 * tile edges don't show a seam of the wrong mip level.
 */
function atlasMaterial(spec: TierSpec, map: Texture, normal: Texture | null = null): Material {
  const m = spec.pbr ? new MeshStandardMaterial({ map, vertexColors: true, roughness: 0.85, metalness: 0 }) : new MeshLambertMaterial({ map, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    if (normal && spec.pbr) {
      // The photo walls' relief: the normal atlas, sampled where the map is (screen-space tangents).
      sh.uniforms.uWallN = { value: normal };
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D uWallN;\nvec2 gAuv; vec2 gDx; vec2 gDy;")
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          {
            vec3 tn = textureGrad(uWallN, gAuv, gDx, gDy).xyz * 2.0 - 1.0;
            vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
            vec2 st0 = gDx * vec2(4.0, 2.0), st1 = gDy * vec2(4.0, 2.0);
            vec3 N = normal;
            vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
            vec3 T = q1perp * st0.x + q0perp * st1.x;
            vec3 B = q1perp * st0.y + q0perp * st1.y;
            float det = max(dot(T, T), dot(B, B));
            float sc = det == 0.0 ? 0.0 : inversesqrt(det);
            normal = normalize(mat3(T * sc, B * sc, N) * vec3(tn.xy * 0.9, tn.z));
          }`,
        );
    }
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
        float kind = floor(vMapUv.x / ${TEX_STRIDE.toFixed(1)});
        vec2 local = vec2(vMapUv.x - kind * ${TEX_STRIDE.toFixed(1)}, vMapUv.y);
        vec2 tileAt = vec2(mod(kind, 4.0), floor(kind / 4.0));
        vec2 inset = vec2(0.5 / ${(map.image as HTMLCanvasElement).width.toFixed(1)}, 0.5 / ${(map.image as HTMLCanvasElement).height.toFixed(1)});
        vec2 f = clamp(fract(local), inset * 4.0, 1.0 - inset * 4.0);
        // Row 0 is the canvas's top half (flipY: v = 1 at the top).
        vec2 auv = vec2((tileAt.x + f.x) / 4.0, (1.0 - tileAt.y + f.y) / 2.0);
        vec4 sampledDiffuseColor = textureGrad(map, auv, dFdx(local) / vec2(4.0, 2.0), dFdy(local) / vec2(4.0, 2.0));
        diffuseColor *= sampledDiffuseColor;
        ${normal && spec.pbr ? "gAuv = auv; gDx = dFdx(local) / vec2(4.0, 2.0); gDy = dFdy(local) / vec2(4.0, 2.0);" : ""}
      #endif`,
    );
  };
  m.customProgramCacheKey = () => (normal && spec.pbr ? "open-atlas-n" : "open-atlas");
  return m;
}

// ── The ground: one painted picture of the whole city ──────────────────────────

/** Paint the ground: earth, grass, paving, roads and their lines; holes where the gutters and river are. */
/**
 * v6 max (3.4): light baked into the ground picture (it multiplies the ground's colour: 0.5 is "as is").
 *
 *   contact   every solid standing on the ground (a building, a wall, a container, a big prop) darkens the ground
 *             next to it, most at its foot and fading out over 2.4 m: the light the sky can't reach there
 *   sun       on tiers without shadow maps, by day: each building's shadow cast across the ground from the sun's
 *             direction (its height, at most 30 m long), drawn into one layer so overlaps don't double up, then
 *             laid on at the strength a shadow has (the sky's light only)
 */
function* bakeGroundLight(c: HTMLCanvasElement, L: OpenLayout, px: number, sun: Vector3, night: boolean, castSun: boolean): Generator<void, void> {
  const g = c.getContext("2d")!;
  const k = px / (L.half * 2);
  const stand = L.solids.filter((so) => so.kind === "box" && so.y0 < 0.6 && so.y1 - so.y0 >= 1.2 && so.hx * so.hz > 0.15);
  const rect = (ctx: CanvasRenderingContext2D, so: (typeof stand)[number], grow: number) => {
    ctx.save();
    ctx.translate(so.x, so.z);
    ctx.rotate(-so.rot);
    ctx.fillRect(-so.hx - grow, -so.hz - grow, (so.hx + grow) * 2, (so.hz + grow) * 2);
    ctx.restore();
  };
  // Sun shadows: one layer (hulls of each footprint and its shadow's end), then onto the ground at a shadow's depth.
  if (castSun && !night && sun.y > 0.15) {
    const layer = document.createElement("canvas");
    layer.width = layer.height = px;
    const sg = layer.getContext("2d")!;
    sg.setTransform(k, 0, 0, k, L.half * k, L.half * k);
    sg.fillStyle = "#000";
    const sx = -sun.x / sun.y;
    const sz = -sun.z / sun.y;
    let n = 0;
    for (const so of stand) {
      const h = Math.min(so.y1, 30 / Math.max(0.3, Math.hypot(sx, sz)));
      const ox = sx * h;
      const oz = sz * h;
      const cs = Math.cos(so.rot);
      const sn = -Math.sin(so.rot);
      const pts: [number, number][] = [];
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        // The solid's +x is (cos rot, −sin rot); its +z, (sin rot, cos rot).
        const x = so.x + cs * so.hx * a + Math.sin(so.rot) * so.hz * b;
        const z = so.z + sn * so.hx * a + Math.cos(so.rot) * so.hz * b;
        pts.push([x, z], [x + ox, z + oz]);
      }
      const hull = convexHull(pts);
      sg.beginPath();
      hull.forEach(([x, z], i) => (i ? sg.lineTo(x, z) : sg.moveTo(x, z)));
      sg.closePath();
      sg.fill();
      if (++n % 300 === 0) yield;
    }
    g.save();
    // (Pixel for pixel: paintGround leaves its world transform on the context.)
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 0.42;
    g.drawImage(layer, 0, 0);
    g.restore();
    yield;
  }
  // Under the trees: the crown's soft shade (two discs, the inner darker).
  {
    g.save();
    g.setTransform(k, 0, 0, k, L.half * k, L.half * k);
    g.fillStyle = "rgba(0,0,0,0.09)";
    let n = 0;
    for (const p of L.placements) {
      const r = p.prefab === "baobab" ? 4.2 : p.prefab === "pine" || p.prefab === "snowpine" ? 2.2 : p.prefab === "tree" || p.prefab === "palm" ? 2.6 : 0;
      if (!r) continue;
      for (const rr of [r * 1.35, r * 0.75]) {
        g.beginPath();
        g.arc(p.x, p.z, rr, 0, Math.PI * 2);
        g.fill();
      }
      if (++n % 500 === 0) yield;
    }
    g.restore();
  }
  // Contact shade: rings round each foot, lightest outside.
  g.save();
  g.setTransform(k, 0, 0, k, L.half * k, L.half * k);
  g.fillStyle = "rgba(0,0,0,0.075)";
  let n = 0;
  for (const so of stand) {
    for (const grow of [2.4, 1.5, 0.9, 0.45]) rect(g, so, grow);
    if (++n % 400 === 0) yield;
  }
  g.restore();
}

/** The convex hull of points (monotone chain), counter-clockwise. */
function convexHull(pts: [number, number][]): [number, number][] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function* paintGround(L: OpenLayout, px: number, forMap: boolean, neutral = false): Generator<void, HTMLCanvasElement> {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  const k = px / (L.half * 2);
  g.setTransform(k, 0, 0, k, L.half * k, L.half * k);
  const rnd = mulberry(7);
  // The base (v4 rework: no red laterite; grey earth, green grass).
  // `neutral`: the photo textures carry the colour; this picture only lightens and darkens them (wear, lines).
  g.fillStyle = neutral ? "#808080" : "#8a8070";
  g.fillRect(-L.half, -L.half, L.half * 2, L.half * 2);
  // Grass and earth as the layout says (sampled on a 3 m grid, then softened).
  for (let z = -L.half, row = 0; z < L.half; z += 3, row++) {
    for (let x = -L.half; x < L.half; x += 3) {
      const kind = L.groundAt(x + 1.5, z + 1.5);
      if (kind === "asphalt" || kind === "laterite") continue;
      if (neutral) g.fillStyle = rnd() < 0.5 ? "#848484" : "#7a7a7a";
      else g.fillStyle = kind === "grass" ? (rnd() < 0.5 ? "#6c8248" : "#627a42") : kind === "paving" ? (rnd() < 0.5 ? "#a8a8a2" : "#9e9e98") : kind === "sand" ? "#c8b48c" : kind === "snow" ? "#e4e8ee" : rnd() < 0.5 ? "#857a6a" : "#7c7262";
      g.fillRect(x - 0.4, z - 0.4, 3.8, 3.8);
    }
    if (row % 10 === 9) yield;
  }
  // Dust and wear.
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = rnd() < 0.5 ? "rgba(255,240,210,0.08)" : "rgba(60,40,20,0.08)";
    const r = 1 + rnd() * 6;
    g.beginPath();
    g.ellipse(-L.half + rnd() * L.half * 2, -L.half + rnd() * L.half * 2, r, r * (0.4 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  yield;
  // Roads: gravel first, tar over it.
  for (const pass of ["laterite", "asphalt"] as const) {
    for (const r of L.roads) {
      if (r.kind !== pass) continue;
      g.strokeStyle = neutral ? "#808080" : pass === "asphalt" ? "#4a4845" : "#8a8276";
      g.lineWidth = r.w;
      g.lineCap = "butt";
      g.beginPath();
      g.moveTo(r.x0, r.z0);
      g.lineTo(r.x1, r.z1);
      g.stroke();
    }
  }
  // Tar wear and patches, the centre lines.
  for (const r of L.roads) {
    if (r.kind !== "asphalt") continue;
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    const ux = (r.x1 - r.x0) / len;
    const uz = (r.z1 - r.z0) / len;
    for (let s = 0; s < len; s += 6) {
      if (rnd() < 0.35) {
        g.fillStyle = rnd() < 0.5 ? "rgba(30,28,26,0.35)" : "rgba(120,110,100,0.18)";
        const off = (rnd() - 0.5) * r.w * 0.7;
        g.beginPath();
        g.ellipse(r.x0 + ux * s - uz * off, r.z0 + uz * s + ux * off, 0.6 + rnd() * 1.6, 0.4 + rnd(), rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.strokeStyle = "rgba(235,230,210,0.75)";
    g.lineWidth = Math.max(0.15, 1.2 / k);
    g.setLineDash(r.median ? [] : [3, 4]);
    for (const off of r.median ? [-r.w / 2 + 0.4, r.w / 2 - 0.4] : [0]) {
      g.beginPath();
      g.moveTo(r.x0 - uz * off, r.z0 + ux * off);
      g.lineTo(r.x1 - uz * off, r.z1 + ux * off);
      g.stroke();
    }
    g.setLineDash([]);
  }
  // The transit hub's lot and the arcade's floor.
  if (!neutral) {
    g.fillStyle = "#4e4c48";
    g.fillRect(92 - 21, 110 - 27, 42, 54);
    g.fillStyle = "#9e9c96";
    g.fillRect(30 - 23, -40 - 31, 46, 62);
  }
  yield;
  if (forMap) {
    // The minimap: building footprints over the ground, darker, and the river in blue.
    for (const s of L.solids) {
      if (s.kind !== "box" || s.y1 < 1.6 || s.y0 > 0.5) continue;
      g.save();
      g.translate(s.x, s.z);
      g.rotate(-s.rot);
      g.fillStyle = s.y1 > 6 ? "#5a524a" : "#6e655a";
      g.fillRect(-s.hx, -s.hz, s.hx * 2, s.hz * 2);
      g.restore();
    }
    g.strokeStyle = "#3a6a8a";
    for (const rv of L.rivers) {
      g.lineWidth = rv.w;
      g.beginPath();
      rv.pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
      g.stroke();
    }
    // v6 max (3.3): the swamp's standing water, its ragged shore.
    g.fillStyle = "#4a6e7e";
    for (const pd of L.ponds ?? []) {
      g.beginPath();
      for (let k = 0; k <= 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        const rr = pondRadius(pd, a);
        const x = pd.x + Math.cos(a) * rr;
        const z = pd.z + Math.sin(a) * rr;
        if (k) g.lineTo(x, z);
        else g.moveTo(x, z);
      }
      g.fill();
    }
    return c;
  }
  // Holes: the ground opens where the gutters and the river are (alpha-tested).
  g.globalCompositeOperation = "destination-out";
  for (const gt of L.gutters) {
    g.save();
    g.translate(gt.x, gt.z);
    g.rotate(-gt.rot);
    g.fillStyle = "#000";
    const hw = GUTTER.w / 2 + GUTTER.wall * 0.5;
    g.fillRect(-hw, -gt.len / 2, hw * 2, gt.len);
    g.restore();
  }
  // But not under the slabs that cross them.
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "#8a8680";
  for (const sl of L.slabs) {
    g.save();
    g.translate(sl.x, sl.z);
    g.rotate(-sl.rot);
    g.fillRect(-(GUTTER.w / 2 + GUTTER.wall + 0.05), -0.9, (GUTTER.w / 2 + GUTTER.wall + 0.05) * 2, 1.8);
    g.restore();
  }
  g.globalCompositeOperation = "destination-out";
  for (const rv of L.rivers) {
    g.lineWidth = rv.w + 0.2;
    g.lineCap = "square";
    g.beginPath();
    rv.pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";
  return c;
}

/** Each pixel's ground kind (GROUND_KINDS index × 30 + 15 in red), from the layout itself: no blending, so no kind is made up at an edge. */
function* kindMap(L: OpenLayout, px: number): Generator<void, HTMLCanvasElement> {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  const img = g.createImageData(px, px);
  const m = (L.half * 2) / px;
  for (let y = 0; y < px; y++) {
    const z = -L.half + (y + 0.5) * m;
    for (let x = 0; x < px; x++) {
      const k = GROUND_KINDS.indexOf(L.groundAt(-L.half + (x + 0.5) * m, z));
      const o = (y * px + x) * 4;
      img.data[o] = Math.max(0, k) * 30 + 15;
      img.data[o + 3] = 255;
    }
    if (y % 64 === 63) yield;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** The ground's photo textures side by side (4 × 2; one cell spare), and their normals. */
function groundAtlas(lib: WorldLibrary, tile: number): { a: CanvasTexture; n: CanvasTexture | null } {
  const mk = (pick: (x: { a: HTMLImageElement; n: HTMLImageElement | null }) => HTMLImageElement | null, fill: string) => {
    const c = document.createElement("canvas");
    c.width = tile * 4;
    c.height = tile * 2;
    const g = c.getContext("2d")!;
    g.fillStyle = fill;
    g.fillRect(0, 0, c.width, c.height);
    lib.ground.forEach((s, i) => {
      const im = s ? pick(s) : null;
      if (im) g.drawImage(im, (i % 4) * tile, Math.floor(i / 4) * tile, tile, tile);
    });
    const t = new CanvasTexture(c);
    t.minFilter = LinearMipmapLinearFilter;
    t.anisotropy = 8;
    return t;
  };
  const a = mk((s) => s.a, "#7a766e");
  a.colorSpace = SRGBColorSpace;
  const n = lib.ground.some((s) => s?.n) ? mk((s) => s.n, "rgb(128,128,255)") : null;
  return { a, n };
}

/**
 * The textured ground (v4 rework): each kind from its photo texture, blended
 * between neighbouring kinds over the kind map's four nearest texels (one on
 * Low), the neutral picture over it for the road lines and the wear.
 */
function texturedGround(spec: TierSpec, macro: CanvasTexture, kinds: CanvasTexture, atlas: { a: Texture; n: Texture | null }, half: number, kpx: number): Material {
  const m = spec.pbr ? new MeshStandardMaterial({ map: macro, roughness: 0.93, alphaTest: 0.5 }) : new MeshLambertMaterial({ map: macro, alphaTest: 0.5 });
  const taps = spec.tier === 0 ? 1 : 4;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uKind: { value: kinds }, uGA: { value: atlas.a }, uGN: { value: atlas.n }, uHalf: { value: half }, uKN: { value: kpx }, uRep: { value: GROUND_REP }, uSat: { value: GROUND_SAT } });
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vGround;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvGround = (modelMatrix * vec4(position, 1.0)).xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uKind; uniform sampler2D uGA; uniform sampler2D uGN; uniform float uHalf; uniform float uKN; uniform float uRep[7]; uniform float uSat[7];
        varying vec2 vGround;
        vec3 gN = vec3(0.0, 0.0, 1.0);
        vec3 desat(vec3 c, int k) { float l = dot(c, vec3(0.3, 0.59, 0.11)); return mix(vec3(l), c, uSat[k]); }
        vec2 tileUv(int k, out vec2 dx, out vec2 dy) {
          vec2 w = vGround / uRep[k];
          dx = dFdx(w) / vec2(4.0, 2.0); dy = dFdy(w) / vec2(4.0, 2.0);
          vec2 f = clamp(fract(w), 0.004, 0.996);
          float col = mod(float(k), 4.0); float row = floor(float(k) / 4.0);
          return vec2((col + f.x) / 4.0, (1.0 - row + f.y) / 2.0);
        }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec2 kt = vec2((vGround.x + uHalf) / (2.0 * uHalf), 1.0 - (vGround.y + uHalf) / (2.0 * uHalf));
          vec3 acc = vec3(0.0); vec3 nacc = vec3(0.0);
          ${
            taps === 1
              ? `{ int k = int(texture2D(uKind, kt).r * 255.0 / 30.0); vec2 dx, dy; vec2 uv = tileUv(k, dx, dy); acc = desat(textureGrad(uGA, uv, dx, dy).rgb, k); ${atlas.n ? "nacc = textureGrad(uGN, uv, dx, dy).xyz;" : ""} }`
              : `vec2 f = kt * uKN - 0.5; vec2 i0 = floor(f); vec2 fw = fract(f);
                 for (int j = 0; j < 4; j++) {
                   vec2 off = vec2(float(j - (j / 2) * 2), float(j / 2));
                   float w = (off.x > 0.5 ? fw.x : 1.0 - fw.x) * (off.y > 0.5 ? fw.y : 1.0 - fw.y);
                   int k = int(texture2D(uKind, (i0 + off + 0.5) / uKN).r * 255.0 / 30.0);
                   vec2 dx, dy; vec2 uv = tileUv(k, dx, dy);
                   acc += desat(textureGrad(uGA, uv, dx, dy).rgb, k) * w;
                   ${atlas.n ? "nacc += textureGrad(uGN, uv, dx, dy).xyz * w;" : ""}
                 }`
          }
          // The neutral picture (0.5 = as is) lightens and darkens: lines, wear, patches.
          diffuseColor.rgb = acc * clamp(diffuseColor.rgb * 2.0, 0.0, 1.6);
          gN = nacc * 2.0 - 1.0;
        }`,
      );
    if (spec.pbr && atlas.n)
      sh.fragmentShader = sh.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        // A flat ground: tangent along +x, bitangent along −z (the texture's v), the normal up.
        normal = normalize((viewMatrix * vec4(normalize(vec3(gN.x, gN.z, -gN.y) * vec3(0.8, 1.0, 0.8)), 0.0)).xyz);`,
      );
  };
  m.customProgramCacheKey = () => `open-ground-tex-${taps}-${!!atlas.n}`;
  return m;
}

/** A pond's water: a fan out to three rings (8 m in, 3 m in, the shore), uv.x 0.5 → 0.1 → 0 toward the shore. */
function pondGeometry(pd: Pond): BufferGeometry {
  const N = 64;
  const Y = 0.14;
  const rings: [number, number][] = [[-8, 0.5], [-3, 0.1], [0, 0]];
  const pos: number[] = [];
  const uv: number[] = [];
  const at = (k: number, ring: number): [number, number, number, number, number] => {
    const a = (k / N) * Math.PI * 2;
    const rr = Math.max(0.5, pondRadius(pd, a) + rings[ring][0]);
    const x = pd.x + Math.cos(a) * rr;
    const z = pd.z + Math.sin(a) * rr;
    return [x, Y, z, rings[ring][1], z];
  };
  const push = (v: [number, number, number, number, number]) => {
    pos.push(v[0], v[1], v[2]);
    uv.push(v[3], v[4]);
  };
  const mid: [number, number, number, number, number] = [pd.x, Y, pd.z, 0.5, pd.z];
  for (let k = 0; k < N; k++) {
    // The middle: a fan (wound so the face looks up).
    push(mid);
    push(at(k + 1, 0));
    push(at(k, 0));
    for (let ring = 0; ring < 2; ring++) {
      const a0 = at(k, ring);
      const a1 = at(k + 1, ring);
      const b0 = at(k, ring + 1);
      const b1 = at(k + 1, ring + 1);
      push(a0);
      push(a1);
      push(b0);
      push(a1);
      push(b1);
      push(b0);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

/** Give a geometry's copy (`g`, already filed) a plain colour and normals: the ground beyond the wall. */
function paintOne(_src: BufferGeometry, g: BufferGeometry, color: string): void {
  g.computeVertexNormals();
  const c = new Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.deleteAttribute("uv");
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The ground material: the painted city, with a fine grain over it so it holds up close. */
function groundMaterial(spec: TierSpec, map: CanvasTexture, grain: CanvasTexture): Material {
  const m = spec.pbr ? new MeshStandardMaterial({ map, roughness: 0.95, alphaTest: 0.5 }) : new MeshLambertMaterial({ map, alphaTest: 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrain = { value: grain };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vGround;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvGround = (modelMatrix * vec4(position, 1.0)).xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uGrain;\nvarying vec2 vGround;")
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= 0.55 + 0.9 * texture2D(uGrain, vGround * 0.25).rgb;");
  };
  m.customProgramCacheKey = () => "open-ground";
  return m;
}

/** The river: a slow brown-green ripple with a little sky in it. */
function riverMaterial(time: { value: number }, sky: Color, sun: Vector3 = new Vector3(0.55, 0.62, 0.35).normalize(), tier = 1, pond = false): ShaderMaterial {
  // (v6 max, 3.3: `pond`, the swamp's still water: the ripples laid out over the ground, not down a stream, and calmer.)
  // v6 max (3.5): water that reads as water, faked the way a game engine does: no reflection pass, no
  // refraction. Two layers of waves drift down the river (uv: across 0…1, along in metres) and bend the normal;
  // the sky's colour comes back off it by the Fresnel term (more at a glancing look); the sun leaves a glint;
  // the water is a deep green-brown looking down, lighter over the shallows at the banks, with a lip of foam
  // there that shifts with the flow. Low: one wave layer, no glint.
  return new ShaderMaterial({
    uniforms: { uTime: time, uSky: { value: sky.clone() }, uSun: { value: sun.clone().normalize() }, fogColor: { value: new Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
    defines: { HQ: tier > 0 ? 1 : 0 },
    vertexShader: `varying vec3 vW; varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSky; uniform vec3 uSun; varying vec3 vW; varying vec2 vUv;
      #include <fog_pars_fragment>
      float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
      // The height of the waves at p (metres), drifting down the river.
      float wav(vec2 p) {
        float h = vn(p * 0.55 + vec2(0.0, -uTime * 0.55)) * 0.6;
        #if HQ
        h += vn(p * 1.7 + vec2(uTime * 0.12, -uTime * 1.1)) * 0.3 + vn(p * 4.3 + vec2(-uTime * 0.2, -uTime * 1.6)) * 0.1;
        #endif
        return h;
      }
      void main() {
        vec2 p = ${pond ? "vW.xz * 0.45" : "vec2(vUv.x * 8.0, vUv.y)"};
        float e = 0.08;
        float h0 = wav(p);
        vec3 n = normalize(vec3((wav(p + vec2(e, 0.0)) - h0) / e * ${pond ? "0.12" : "0.35"}, 1.0, (wav(p + vec2(0.0, e)) - h0) / e * ${pond ? "0.12" : "0.35"}));
        vec3 v = normalize(cameraPosition - vW);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        // How near a bank (0 in the middle, 1 at the edge): the shallows and the foam.
        float edge = abs(vUv.x - 0.5) * 2.0;
        vec3 deep = mix(vec3(0.05, 0.075, 0.06), vec3(0.16, 0.17, 0.11), smoothstep(0.55, 1.0, edge));
        vec3 col = mix(deep, uSky * 0.95, clamp(fres * 1.15, 0.0, 0.85));
        #if HQ
        vec3 r = reflect(-v, n);
        float glint = pow(max(dot(r, uSun), 0.0), 220.0) * 6.0 + pow(max(dot(r, uSun), 0.0), 24.0) * 0.18;
        col += vec3(1.0, 0.96, 0.85) * glint;
        #endif
        float foam = smoothstep(0.86, 0.98, edge + (vn(vec2(vUv.y * 1.3 - uTime * 0.8, vUv.x * 20.0)) - 0.5) * 0.12);
        col = mix(col, vec3(0.82, 0.85, 0.8), foam * ${pond ? "0.15" : "0.55"});
        gl_FragColor = vec4(col, mix(0.86, 0.97, fres));
        #include <fog_fragment>
      }`,
    transparent: true,
    fog: true,
  });
}

// ── The PVS ───────────────────────────────────────────────────────────────────

interface Occluder {
  x: number;
  z: number;
  hx: number;
  hz: number;
  c: number;
  s: number;
  y1: number;
}

/**
 * For every cell, the cells it can see. Rays from points in the cell at the
 * camera's height go to points in the other cell, low and at its tallest; a
 * cell is hidden only if every ray is stopped by a building's mass.
 */
function* bakePvs(L: OpenLayout, n: number, tops: Float32Array, reach: number): Generator<void, Uint8Array[]> {
  const occ: Occluder[] = [];
  for (const s of L.solids) {
    if (s.kind !== "box" || s.y0 > 0.3 || s.y1 < 3 || s.hx < 2 || s.hz < 2) continue;
    occ.push({ x: s.x, z: s.z, hx: s.hx, hz: s.hz, c: Math.cos(s.rot), s: Math.sin(s.rot), y1: s.y1 });
  }
  // A 10 m grid of occluders for the rays to walk.
  const G = 10;
  const gn = Math.ceil((L.half * 2) / G);
  const grid: number[][] = Array.from({ length: gn * gn }, () => []);
  occ.forEach((o, i) => {
    const ex = Math.abs(o.c) * o.hx + Math.abs(o.s) * o.hz;
    const ez = Math.abs(o.s) * o.hx + Math.abs(o.c) * o.hz;
    const q0 = Math.max(0, Math.floor((o.x - ex + L.half) / G));
    const q1 = Math.min(gn - 1, Math.floor((o.x + ex + L.half) / G));
    const r0 = Math.max(0, Math.floor((o.z - ez + L.half) / G));
    const r1 = Math.min(gn - 1, Math.floor((o.z + ez + L.half) / G));
    for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) grid[r * gn + q].push(i);
  });
  const stamp = new Int32Array(occ.length);
  let tick = 0;
  /** Does the segment a→b pass through an occluder? */
  const blocked = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean => {
    tick++;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(len / (G * 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const q = Math.floor((ax + (bx - ax) * t + L.half) / G);
      const r = Math.floor((az + (bz - az) * t + L.half) / G);
      if (q < 0 || r < 0 || q >= gn || r >= gn) continue;
      for (const oi of grid[r * gn + q]) {
        if (stamp[oi] === tick) continue;
        stamp[oi] = tick;
        const o = occ[oi];
        // The segment in the occluder's axes: a 2D slab test, then the heights.
        const lax = (ax - o.x) * o.c - (az - o.z) * o.s;
        const laz = (ax - o.x) * o.s + (az - o.z) * o.c;
        const lbx = (bx - o.x) * o.c - (bz - o.z) * o.s;
        const lbz = (bx - o.x) * o.s + (bz - o.z) * o.c;
        let t0 = 0;
        let t1 = 1;
        const dx = lbx - lax;
        const dz = lbz - laz;
        let ok = true;
        for (const [p, d, h] of [[lax, dx, o.hx], [laz, dz, o.hz]] as const) {
          if (Math.abs(d) < 1e-9) {
            if (Math.abs(p) > h) ok = false;
          } else {
            let u0 = (-h - p) / d;
            let u1 = (h - p) / d;
            if (u0 > u1) [u0, u1] = [u1, u0];
            t0 = Math.max(t0, u0);
            t1 = Math.min(t1, u1);
          }
          if (!ok || t0 > t1) break;
        }
        if (!ok || t0 > t1) continue;
        // The ray's lowest height while inside: under the roof means stopped.
        const y = Math.min(ay + (by - ay) * t0, ay + (by - ay) * t1);
        if (y < o.y1) return true;
      }
    }
    return false;
  };
  const out: Uint8Array[] = [];
  const at = (i: number): [number, number] => [-L.half + ((i % n) + 0.5) * CELL, -L.half + (Math.floor(i / n) + 0.5) * CELL];
  const pts = [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45], [0, 0], [0, -0.45], [0, 0.45], [-0.45, 0], [0.45, 0]];
  for (let a = 0; a < n * n; a++) {
    const vis = new Uint8Array(n * n);
    const [ax, az] = at(a);
    for (let b = 0; b < n * n; b++) {
      if (a === b) {
        vis[b] = 1;
        continue;
      }
      const [bx, bz] = at(b);
      const gap = Math.max(0, Math.abs(bx - ax) - CELL) ** 2 + Math.max(0, Math.abs(bz - az) - CELL) ** 2;
      if (gap > reach * reach) continue;
      // Neighbours are always visible.
      if (Math.abs(bx - ax) <= CELL && Math.abs(bz - az) <= CELL) {
        vis[b] = 1;
        continue;
      }
      let seen = false;
      for (const [pu, pv] of pts) {
        for (const [qu, qv] of pts) {
          for (const qy of [1.5, Math.max(1.5, tops[b] - 0.3)]) {
            if (!blocked(ax + pu * CELL, PVS_EYE, az + pv * CELL, bx + qu * CELL, qy, bz + qv * CELL)) {
              seen = true;
              break;
            }
          }
          if (seen) break;
        }
        if (seen) break;
      }
      vis[b] = seen ? 1 : 0;
    }
    out.push(vis);
    yield;
  }
  return out;
}

// ── The world ─────────────────────────────────────────────────────────────────

interface CellMeshes {
  i: number;
  cx: number;
  cz: number;
  objects: Object3D[];
  casters: Mesh[];
}

/** Build it all now (tests, the dev page). */
export function buildOpenWorld(L: OpenLayout, spec: TierSpec, opts: { night?: boolean } = {}): OpenWorld {
  const g = steps(L, spec, opts, null);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/**
 * Build it in slices of `slice` ms between frames (SPEC-V3 §6.2: the world is
 * built after the lobby is up, in idle time), so the lobby never stalls.
 */
export async function buildOpenWorldIdle(L: OpenLayout, spec: TierSpec, opts: { night?: boolean } = {}, slice = 8): Promise<OpenWorld> {
  // The library's textures first (v4 rework R4); without them the game's own.
  const lib = await loadWorldLibrary(spec, !!opts.night, L).catch(() => null);
  const g = steps(L, spec, opts, lib);
  for (;;) {
    const t = performance.now();
    for (;;) {
      const r = g.next();
      if (r.done) return r.value;
      if (performance.now() - t > slice) break;
    }
    await new Promise<void>((res) => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => res(), { timeout: 50 }) : setTimeout(res, 0)));
  }
}

/** After the GPU has it, drop the JS copy (the world never changes its shapes). */
function dropCopy(this: { array: unknown }): void {
  this.array = new Float32Array(0);
}

/**
 * v5: once a shape is on the GPU, the JS copy goes (on a phone both are the same
 * RAM, so it was held twice). Only the merged shapes this world owns: a library
 * model is shared with the next world, so it keeps its copy.
 */
function freeWhenUploaded(group: Group): void {
  group.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (m as unknown as InstancedMesh).isInstancedMesh || !m.geometry) return;
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    for (const k of Object.keys(g.attributes)) (g.attributes[k] as BufferAttribute).onUpload(dropCopy);
    g.index?.onUpload(dropCopy);
  });
}

function* steps(L: OpenLayout, spec: TierSpec, opts: { night?: boolean }, lib: WorldLibrary | null): Generator<void, OpenWorld> {
  const night = !!opts.night;
  const view = VIEW[spec.tier];
  const group = new Group();
  const uTime = { value: 0 };
  const space = new Space(L.solids, { x0: -L.half, z0: -L.half, x1: L.half, z1: L.half }, (x, z) => SURFACE_OF[L.groundAt(x, z)]);

  // ── Light (v4 rework): with the HDR sky, a clear afternoon whose haze is its horizon; without it, the old warm haze. ──
  const photo = lib?.sky ?? null;
  const haze = photo ? photo.horizon.clone().lerp(new Color(night ? 0x10131c : 0xb8c4cc), 0.35) : new Color(night ? 0x1a1814 : 0xcdb894);
  const sunDir = photo && !night ? photo.sun.clone() : new Vector3(0.55, 0.62, 0.35).normalize();
  const sky = new Sky(
    {
      top: new Color(night ? 0x0a0c16 : 0x9aa6b0),
      horizon: haze.clone(),
      below: new Color(0x6a5a44),
      sunDir,
      sunColor: new Color(0xffd8a0),
      night,
      rain: false,
      cloudTint: new Color(0xf0dcc0),
      cloudCover: 0.25,
    },
    spec.fancy,
  );
  group.add(sky.group);
  if (photo) {
    // The photo sky: a sphere round the camera (inside the far plane, unfogged), in place of the drawn dome.
    for (const c of sky.group.children) c.visible = false;
    const sm = new MeshBasicMaterial({ map: photo.bg, fog: false, depthWrite: false });
    const sg = new SphereGeometry(view * 0.94, 32, 16);
    sg.scale(-1, 1, 1);
    const sphere = new Mesh(sg, sm);
    sphere.renderOrder = -10;
    sphere.frustumCulled = false;
    sky.group.add(sphere);
  }
  const hemi = new HemisphereLight(photo ? (night ? 0x5a6a90 : 0xdfe8f2) : night ? 0x6a7ab0 : 0xf2e0c4, photo ? (night ? 0x202024 : 0x5a5650) : 0x6a5038, night ? 1.3 : 1.25);
  const sun = new DirectionalLight(photo ? (night ? 0xb8c8ff : 0xfff2e0) : 0xffd8a8, night ? 1.2 : 2.3);
  sun.position.copy(sunDir).multiplyScalar(60);
  group.add(hemi, sun, sun.target);
  if (spec.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(spec.shadowSize, spec.shadowSize);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -20;
    sc.right = sc.top = 20;
    sc.near = 1;
    sc.far = 140;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
  }

  // ── Ground ──
  const gpx = spec.tier === 0 ? 1024 : 2048;
  const textured = !!lib && (lib.ground.some(Boolean) || !!lib.atlases?.ground);
  const gcan = yield* paintGround(L, gpx, false, textured);
  // v6 max (3.4): light baked into the ground: contact shade round everything that stands on it, and (Low, which
  // has no shadow maps; by day) the buildings' shadows from the sun.
  yield* bakeGroundLight(gcan, L, gpx, sunDir, night, !spec.shadows);
  const gtex = new CanvasTexture(gcan);
  gtex.colorSpace = SRGBColorSpace;
  gtex.minFilter = LinearMipmapLinearFilter;
  gtex.anisotropy = 4;
  const gg = new PlaneGeometry(L.half * 2, L.half * 2, 1, 1);
  gg.rotateX(-Math.PI / 2);
  let gmat: Material;
  if (textured) {
    // About 0.4 m a texel in a city, 1 m on the big world.
    const kpx = Math.min(2048, Math.max(512, Math.round((L.half * 2) / (L.half > 400 ? 1 : 0.4))));
    const kc = yield* kindMap(L, kpx);
    const kt = new CanvasTexture(kc);
    kt.magFilter = kt.minFilter = NearestFilter;
    kt.generateMipmaps = false;
    gmat = texturedGround(spec, gtex, kt, lib!.atlases?.ground ?? groundAtlas(lib!, texSize(spec.tier)), L.half, kpx);
  } else {
    const grain = canvasTexture("sand", 128, sand);
    grain.wrapS = grain.wrapT = RepeatWrapping;
    gmat = groundMaterial(spec, gtex, grain);
  }
  const ground = new Mesh(gg, gmat);
  ground.receiveShadow = spec.shadows;
  group.add(ground);
  yield;
  const mapCan = yield* paintGround(L, 512, true);
  yield;
  const terrain: TerrainShot = { image: mapCan, x0: -L.half, x1: L.half, z0: -L.half, z1: L.half };

  // ── Cells ──
  const n = Math.ceil((L.half * 2) / CELL);
  const chunks: OpenChunk[] = Array.from({ length: n * n }, () => emptyChunk());
  const tops = new Float32Array(n * n);
  const cellIndex = (x: number, z: number) => Math.min(n - 1, Math.max(0, Math.floor((z + L.half) / CELL))) * n + Math.min(n - 1, Math.max(0, Math.floor((x + L.half) / CELL)));
  const kit = new PrefabKit(1957);
  kit.tier = spec.tier;
  kit.splitLeaves = spec.pbr && spec.tier >= 2;
  // The scanned rocks stand in for the drawn ones (Medium and up, with the library).
  const rockSet = lib && (lib.rocks.grass || lib.rocks.sand) ? lib.rocks : null;
  if (rockSet) kit.skip = new Set(["rock"]);
  // v6 max (3.4): the scanned trees: the kit notes each tree for its impostor draw instead of building it.
  const treeSet = lib?.trees ?? null;
  kit.impostors = !!treeSet;
  const treesIn: TreeAt[][] = [];
  const rocksIn: Placement[][] = [];
  // The props with a model: drawn instanced below, not by the kit.
  const propSet = lib && lib.props.size ? lib.props : null;
  if (propSet) kit.props = new Set(propSet.keys());
  const propsIn: Placement[][] = [];
  let drawn0 = 0;
  for (const p of L.placements) {
    // Small batches: the big landmarks take a few ms each.
    if (++drawn0 % 6 === 0) yield;
    if (rockSet && p.prefab === "rock") (rocksIn[cellIndex(p.x, p.z)] ??= []).push(p);
    if (propSet && p.prefab === "prop" && propSet.has(p.v & 255)) (propsIn[cellIndex(p.x, p.z)] ??= []).push(p);
    const { chunk, trees } = kit.draw(p, night);
    for (const t of trees) (treesIn[cellIndex(t.x, t.z)] ??= []).push(t);
    const c = chunks[cellIndex(p.x, p.z)];
    c.mass.push(...chunk.mass);
    c.main.push(...chunk.main);
    c.detail.push(...chunk.detail);
    c.foliage.push(...chunk.foliage);
    c.leaves.push(...chunk.leaves);
    c.glow.push(...chunk.glow);
    c.atlas.push(...chunk.atlas);
    c.far.push(...chunk.far);
  }
  for (const s of L.solids) {
    const i = cellIndex(s.x, s.z);
    tops[i] = Math.max(tops[i], s.kind === "ramp" ? Math.max(s.y1, s.y2 ?? s.y1) : s.y1);
  }
  // The gutters' walls and floors, the slabs, the expressway's median, the river's banks.
  {
    const gk = new PrefabKit(5);
    gk.scratch = emptyChunk();
    for (const s of L.solids) {
      const r: V3 = [0, s.rot, 0];
      const i = cellIndex(s.x, s.z);
      const before = gk.scratch;
      gk.scratch = chunks[i];
      if (s.kind === "pit") {
        // The floor of a gutter or the river bed.
        gk.box(s.water !== undefined && s.hx > 2 ? "#5a4a34" : "#6a6a66", [s.hx * 2, 0.1, s.hz * 2], [s.x, s.y1 - 0.05, s.z], "mass", r);
        if (s.water !== undefined && s.hx <= 2) gk.box("#2e3438", [s.hx * 2 - 0.02, 0.02, s.hz * 2], [s.x, (s.water ?? s.y1) - 0.01, s.z], "main", r);
      } else if (s.y0 === -0.25) {
        gk.box("#8a8680", [s.hx * 2, 0.27, s.hz * 2], [s.x, -0.115, s.z], "main", r); // a slab
      } else if (s.y0 < 0) {
        // A gutter wall or a river bank: up to a hair over the ground, covering the hole's edge.
        const wide = s.surface === "sand";
        gk.box(wide ? "#8a6a4a" : "#a8a49c", [s.hx * 2 + (wide ? 0.5 : 0), s.y1 - s.y0 + 0.03, s.hz * 2], [s.x, (s.y0 + s.y1 + 0.03) / 2, s.z], "mass", r);
      }
      gk.scratch = before;
    }
    for (const r of L.roads) {
      if (!r.median) continue;
      const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      const rot = Math.atan2(r.x1 - r.x0, r.z1 - r.z0);
      // Filed per cell along it, so each piece culls with its cell.
      for (let s = 0; s < len; s += CELL / 2) {
        const seg = Math.min(CELL / 2, len - s);
        const t = (s + seg / 2) / len;
        const x = r.x0 + (r.x1 - r.x0) * t;
        const z = r.z0 + (r.z1 - r.z0) * t;
        gk.scratch = chunks[cellIndex(x, z)];
        // A plain concrete kerb with a grass strip on top (v4 rework: no painted stripes).
        gk.box("#c4c2bc", [r.median, 0.3, seg], [x, 0.15, z], "mass", [0, rot, 0]);
        gk.box("#56683e", [r.median - 0.3, 0.04, seg], [x, 0.31, z], "main", [0, rot, 0]);
      }
    }
  }
  // The wall round the city, in 25 m lengths (each culls with its cell), and the land beyond it.
  {
    const ek = new PrefabKit(11);
    const H = L.half;
    for (let a = -H; a < H; a += 25) {
      for (const [x, z, alongX] of [[a + 12.5, -H + EDGE.t / 2, true], [a + 12.5, H - EDGE.t / 2, true], [-H + EDGE.t / 2, a + 12.5, false], [H - EDGE.t / 2, a + 12.5, false]] as const) {
        ek.scratch = chunks[cellIndex(x, z)];
        ek.texBox("concrete", "#bdb3a0", alongX ? [25, EDGE.h, EDGE.t] : [EDGE.t, EDGE.h, 25], [x, EDGE.h / 2, z], 2.5);
        ek.box("#a89e8c", alongX ? [25, 0.15, EDGE.t + 0.1] : [EDGE.t + 0.1, 0.15, 25], [x, EDGE.h + 0.07, z], "main");
        // Piers every 5 m.
        for (let p = -10; p <= 10; p += 5) ek.box("#a89e8c", alongX ? [0.5, EDGE.h + 0.25, EDGE.t + 0.2] : [EDGE.t + 0.2, EDGE.h + 0.25, 0.5], [x + (alongX ? p : 0), (EDGE.h + 0.25) / 2, z + (alongX ? 0 : p)], "main");
      }
    }
    // Beyond: fields to the haze (v4 rework: no red earth), and a ragged line of trees.
    // Four strips round the wall, none under the city: the drains and the river show their own floors.
    const fk = new PrefabKit(13);
    fk.scratch = emptyChunk();
    const F = 700;
    for (const [w, d, x, z] of [[H * 2 + F * 2, F, 0, H + F / 2], [H * 2 + F * 2, F, 0, -H - F / 2], [F, H * 2, H + F / 2, 0], [F, H * 2, -H - F / 2, 0]]) {
      const out = new PlaneGeometry(w, d, 1, 1);
      out.rotateX(-Math.PI / 2);
      out.translate(x, -0.03, z);
      fk.put(out.toNonIndexed(), "mass", 0);
      paintOne(out, fk.scratch.mass[fk.scratch.mass.length - 1], "#6c7052");
      out.dispose();
    }
    const rr = mulberry(19);
    for (let i = 0; i < 220; i++) {
      const a = rr() * Math.PI * 2;
      const side = Math.floor(rr() * 4);
      const t = (rr() * 2 - 1) * (H + 30);
      const d = H + 8 + rr() * 50;
      const x = side === 0 ? t : side === 1 ? -t : side === 2 ? d : -d;
      const z = side === 0 ? d : side === 1 ? -d : side === 2 ? t : -t;
      const h = 6 + rr() * 6;
      fk.cyl("#5a4636", 0.3, h * 0.55, [x, h * 0.27, z], "mass", { sides: 6 });
      fk.blob(rr() < 0.5 ? "#4a5a2e" : "#56663a", [h * 0.35, h * 0.24, h * 0.35], [x + Math.cos(a), h * 0.72, z + Math.sin(a)], "mass");
    }
    const beyond = new Mesh(merge(fk.scratch.mass), new MeshLambertMaterial({ vertexColors: true }));
    beyond.receiveShadow = false;
    group.add(beyond);
  }

  // The river's water, one plane per stretch.
  const water = new Group();
  const wmat = riverMaterial(uTime, haze, sunDir, spec.tier);
  for (const rv of L.rivers) {
    const parts: BufferGeometry[] = [];
    // v6 max (3.5): uv across the river (0…1) and down it in metres, for the flow and the foam at the banks.
    let along = 0;
    for (let i = 0; i + 1 < rv.pts.length; i++) {
      const [ax, az] = rv.pts[i];
      const [bx, bz] = rv.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az) + 2;
      const g = new PlaneGeometry(rv.w + 0.6, len, 1, Math.max(1, Math.round(len / 20)));
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setY(k, along + (1 - uv.getY(k)) * len);
      along += len - 2;
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(bx - ax, bz - az));
      g.translate((ax + bx) / 2, -rv.depth + rv.water, (az + bz) / 2);
      parts.push(g.toNonIndexed());
    }
    const geo = new BufferGeometry();
    let count = 0;
    for (const p of parts) count += p.attributes.position.count;
    const pos = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    let o = 0;
    let ou = 0;
    for (const p of parts) {
      pos.set(p.attributes.position.array as Float32Array, o);
      uvs.set(p.attributes.uv.array as Float32Array, ou);
      o += p.attributes.position.array.length;
      ou += p.attributes.uv.array.length;
    }
    geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    const m = new Mesh(geo, wmat);
    m.renderOrder = 2;
    water.add(m);
  }
  // v6 max (3.3): the swamp's standing water: a sheet a hand over the ground, the river's water material (its
  // shallows and foam toward the shore: uv.x runs 0.5 in the middle to 0 at the shore).
  const pmat = L.ponds?.length ? riverMaterial(uTime, haze, sunDir, spec.tier, true) : null;
  for (const pd of L.ponds ?? []) {
    const m = new Mesh(pondGeometry(pd), pmat!);
    m.renderOrder = 2;
    water.add(m);
  }
  group.add(water);

  // Merge each cell into its LOD and its atlas, foliage and glow draws.
  // v6 max (3.4): the walls' foot in shade (footShade) on the plain and the photo walls alike.
  const vc = footShade(spec.pbr ? new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: DoubleSide }) : new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }), "open-vc");
  // v5 (3.7): High and Max, the leaves in their own material (needle clumps).
  const leafMat = spec.pbr && spec.tier >= 2 ? detailed(new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: DoubleSide })) : null;
  // v6 max (3.4): the baked KTX2 atlas when it came (compressed on the GPU); else composed here, as before.
  const at = lib?.atlases?.walls ? { map: lib.atlases.walls.a, normal: lib.atlases.walls.n } : yield* atlasTexture(lib ? texSize(spec.tier) : spec.tier === 0 ? 256 : 512, lib);
  const atlasM = atlasMaterial(spec, at.map, at.normal);
  const atlas = footShade(atlasM, atlasM.customProgramCacheKey());
  const glowMat = new MeshBasicMaterial({ vertexColors: true });
  const near = spec.tier === 0 ? 45 : spec.tier === 1 ? 60 : 70;
  const mid = spec.tier === 0 ? 95 : spec.tier === 1 ? 130 : 160;
  const cells: CellMeshes[] = [];
  yield;
  for (let i = 0; i < n * n; i++) {
    yield;
    const ch = chunks[i];
    const cx = -L.half + ((i % n) + 0.5) * CELL;
    const cz = -L.half + (Math.floor(i / n) + 0.5) * CELL;
    const rel = (gs: BufferGeometry[]) => {
      for (const g of gs) g.translate(-cx, 0, -cz);
      return gs;
    };
    rel(ch.mass);
    rel(ch.main);
    rel(ch.detail);
    rel(ch.foliage);
    rel(ch.glow);
    rel(ch.atlas);
    rel(ch.far);
    rel(ch.leaves);
    const cell: CellMeshes = { i, cx, cz, objects: [], casters: [] };
    const mk = (gs: BufferGeometry[], mat: Material, uv = false): Mesh | null => {
      if (!gs.length) return null;
      const m = new Mesh(merge(gs, uv), mat);
      m.position.set(cx, 0, cz);
      m.receiveShadow = spec.shadows;
      return m;
    };
    // High and Max: the leaves are their own draw, in the leaf material (needle clumps); elsewhere, merged with the rest.
    const leafSplit = !!leafMat && ch.leaves.length > 0;
    const fol = ch.foliage;
    const all = [...ch.mass, ...ch.main, ...ch.detail, ...fol];
    if (all.length || ch.far.length) {
      const lod = new LOD();
      lod.position.set(cx, 0, cz);
      const lvl = (gs: BufferGeometry[]) => {
        if (!gs.length) return new Object3D();
        const m = new Mesh(merge(gs), vc);
        m.receiveShadow = spec.shadows;
        return m;
      };
      const full = lvl(all);
      lod.addLevel(full, 0);
      lod.addLevel(lvl([...ch.mass, ...ch.main, ...fol]), near);
      lod.addLevel(lvl([...ch.mass, ...fol, ...ch.far]), mid);
      cell.objects.push(lod);
      if ((full as Mesh).isMesh) cell.casters.push(full as Mesh);
      group.add(lod);
    }
    if (leafSplit) {
      // Near and middle distance: the leaves; far, nothing (the far stand-ins above take over).
      const lod = new LOD();
      lod.position.set(cx, 0, cz);
      const leaves = new Mesh(merge(ch.leaves), leafMat!);
      leaves.receiveShadow = spec.shadows;
      lod.addLevel(leaves, 0);
      lod.addLevel(new Object3D(), mid);
      cell.objects.push(lod);
      cell.casters.push(leaves);
      group.add(lod);
    }
    const am = mk(ch.atlas, atlas, true);
    if (am) {
      cell.objects.push(am);
      cell.casters.push(am);
      group.add(am);
    }
    const gm = mk(ch.glow, glowMat);
    if (gm) {
      cell.objects.push(gm);
      group.add(gm);
    }
    // v6 max (3.4): the cell's trees: one impostor draw per scanned kind.
    const ts = treesIn[i];
    if (treeSet && ts?.length) {
      const bySp = new Map<Species, TreeAt[]>();
      for (const t of ts) {
        const sp = speciesOf(t, treeSet);
        const e = bySp.get(sp) ?? [];
        e.push(t);
        bySp.set(sp, e);
      }
      for (const [sp, list] of bySp) {
        const imp = treeSet[sp];
        if (!imp) continue;
        const im = impostorMesh(spec, sp, imp, list, uTime);
        im.position.set(0, 0, 0);
        cell.objects.push(im);
        group.add(im);
      }
    }
    // The cell's rocks: an instanced draw per shape, each sized and turned as its drawn rock was.
    const rs = rocksIn[i];
    if (rockSet && rs?.length) {
      const groups = new Map<BufferGeometry, { m: CdnModel; ps: Placement[] }>();
      for (const p of rs) {
        const m = (L.groundAt(p.x, p.z) === "sand" || L.groundAt(p.x, p.z) === "snow" ? rockSet.sand : rockSet.grass) ?? rockSet.grass ?? rockSet.sand!;
        const g = m.parts.length ? m.parts[p.v % m.parts.length] : m.geometry;
        const e = groups.get(g) ?? { m, ps: [] };
        e.ps.push(p);
        groups.set(g, e);
      }
      for (const [g, { m, ps }] of groups) {
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        const bw = Math.max(0.01, bb.max.x - bb.min.x, bb.max.z - bb.min.z);
        const im = new InstancedMesh(g, m.material, ps.length);
        ps.forEach((p, j) => {
          const s = 1.2 + (p.v % 7) * 0.4;
          const k = (s * 2.1) / bw;
          _sc.set(k, k * (0.8 + ((p.v >> 3) % 5) * 0.1), k);
          _q.setFromAxisAngle(_up, ((p.v >> 6) % 628) / 100 + p.rot);
          _at.set(p.x, bb.min.y * -_sc.y - 0.1 * s, p.z);
          im.setMatrixAt(j, _m4.compose(_at, _q, _sc));
        });
        im.computeBoundingSphere();
        im.receiveShadow = spec.shadows;
        cell.objects.push(im);
        cell.casters.push(im);
        group.add(im);
      }
    }
    // The cell's props: one instanced draw per model mesh, each turned as placed (its solid is the table's box).
    const pr = propsIn[i];
    if (propSet && pr?.length) {
      const byIdx = new Map<number, Placement[]>();
      for (const p of pr) {
        const e = byIdx.get(p.v & 255) ?? [];
        e.push(p);
        byIdx.set(p.v & 255, e);
      }
      for (const [idx, ps] of byIdx) {
        const m = propSet.get(idx)!;
        for (const { geometry, material } of m.meshes) {
          const im = new InstancedMesh(geometry, material, ps.length);
          _sc.set(1, 1, 1);
          ps.forEach((p, j) => {
            _q.setFromAxisAngle(_up, p.rot);
            _at.set(p.x, 0, p.z);
            im.setMatrixAt(j, _m4.compose(_at, _q, _sc));
          });
          im.computeBoundingSphere();
          im.receiveShadow = spec.shadows;
          cell.objects.push(im);
          cell.casters.push(im);
          group.add(im);
        }
      }
    }
    cells.push(cell);
  }
  // Scratch geometries are merged copies now.
  for (const ch of chunks) for (const list of [ch.mass, ch.main, ch.detail, ch.foliage, ch.glow, ch.atlas, ch.far, ch.leaves]) for (const g of list) g.dispose();
  // v4: the world stands still (only the sky and the sun follow the camera): its matrices are worked out once, not
  // every frame (4,000+ objects on Naija Max: an eighth of a slow phone's frame).
  group.updateMatrixWorld(true);
  for (const c of group.children) {
    if (c === sky.group || c === sun || c === sun.target || c === hemi) continue;
    c.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.matrixWorldAutoUpdate = false;
    });
  }

  const t0 = performance.now();
  const pvs = yield* bakePvs(L, n, tops, view);
  const pvsMs = performance.now() - t0;
  let sum = 0;
  let max = 0;
  for (const v of pvs) {
    let c = 0;
    for (const b of v) c += b;
    sum += c;
    max = Math.max(max, c);
  }

  const fog = new Fog(haze.clone(), view * 0.3, view);
  let drawn = 0;
  let cut = 0;
  const onCell = new Uint8Array(n * n);
  const clear = haze.clone();
  const cutSky = new Color(0x080a12);
  const dustSky = new Color(0xc9a46a);
  const lit = { hemi: hemi.intensity, sun: sun.intensity };
  const air: { dim: number; dust: number; see: number } = { dim: 0, dust: 0, see: view };
  const fogNear = fog.near;
  const fogFar = fog.far;
  const mix = () => {
    fog.color.copy(haze).lerp(dustSky, air.dust).lerp(cutSky, air.dim);
    clear.copy(fog.color);
    fog.near = fogNear + (2 - fogNear) * air.dust;
    fog.far = fogFar + (air.see - fogFar) * air.dust;
    sky.group.visible = air.dim < 0.5 && air.dust < 0.6;
  };

  freeWhenUploaded(group);

  return {
    layout: L,
    space,
    group,
    fog,
    clear,
    view,
    skyEnv: photo?.env ?? null,
    setDim(k) {
      const d = Math.max(0, Math.min(1, k));
      hemi.intensity = lit.hemi * (1 - 0.82 * d);
      sun.intensity = lit.sun * (1 - 0.95 * d);
      air.dim = d;
      mix();
    },
    setDust(k, see) {
      air.dust = Math.max(0, Math.min(1, k));
      air.see = see;
      sun.intensity = lit.sun * (1 - 0.95 * air.dim) * (1 - 0.6 * air.dust);
      mix();
    },
    terrain,
    pvs: { mean: sum / pvs.length, max, ms: pvsMs },
    update(dt, focus, cam) {
      uTime.value += dt;
      sky.update(dt, cam);
      const here = cellIndex(cam.x, cam.z);
      const usePvs = cam.y < PVS_EYE;
      drawn = 0;
      cut = 0;
      for (const c of cells) {
        // Distance from the camera to the cell's square.
        const dx = Math.max(0, Math.abs(cam.x - c.cx) - CELL / 2);
        const dz = Math.max(0, Math.abs(cam.z - c.cz) - CELL / 2);
        let on = dx * dx + dz * dz < view * view;
        if (on && usePvs && !pvs[here][c.i]) {
          on = false;
          cut++;
        }
        if (on) drawn++;
        onCell[c.i] = on ? 1 : 0;
        for (const o of c.objects) o.visible = on;
      }
      sun.position.set(focus.x + sunDir.x * 60, sunDir.y * 60, focus.z + sunDir.z * 60);
      sun.target.position.set(focus.x, 0, focus.z);
      if (spec.shadows) {
        for (const c of cells) {
          const dx = Math.max(0, Math.abs(focus.x - c.cx) - CELL / 2);
          const dz = Math.max(0, Math.abs(focus.z - c.cz) - CELL / 2);
          const cast = dx < 24 && dz < 24;
          for (const m of c.casters) m.castShadow = cast;
        }
      }
    },
    stats: () => ({ cells: drawn, pvsCut: cut }),
    cellOn: (x, z) => onCell[cellIndex(x, z)] === 1,
    async warm(renderer, scene, camera) {
      // Everything on for the compile, so no material is missed; the next update() hides what's out of view.
      for (const c of cells) for (const o of c.objects) o.visible = true;
      await renderer.compileAsync(scene, camera);
    },
    dispose() {
      sky.dispose();
      gtex.dispose();
      group.traverse((o) => (o as Mesh).geometry?.dispose?.());
    },
  };
}
