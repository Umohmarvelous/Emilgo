// An open world, built for the screen (SPEC-V3 §6.2): the layout's prefabs
// drawn and filed into 50 m cells (8 × 8 for Naija World), each cell merged
// into a three-level LOD, its textured walls in one atlas draw; one painted
// ground; the gutters and the river; the Harmattan haze at the tier's view
// distance (cells past it are not drawn at all); and a potentially-visible set
// per cell, baked here by casting rays against the buildings' masses.
//
// Draw calls stay flat however big the city: about three per visible cell,
// plus the ground, the water and the sky.

import {
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
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
  RepeatWrapping,
  ShaderMaterial,
  Float32BufferAttribute,
  Vector3,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";

import type { TierSpec } from "../../graphics/tiers";
import { Space } from "../../game/core/space";
import { merge, type V3 } from "../../world/geo";
import { canvasTexture, concrete, glassFacade, mud, plaster, thatch, wood, zinc, brick, sand, type Painter } from "../../world/tex";
import { Sky } from "../sky";
import type { TexKind } from "../kit";
import { emptyChunk, PrefabKit, TEX_KINDS, TEX_STRIDE, type OpenChunk } from "./art";
import { EDGE, GUTTER, SURFACE_OF, type OpenLayout } from "./naija";
import type { TerrainShot } from "../../ui/minimap";

export const CELL = 50;
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

/** Eight wall textures side by side (4 × 2) in one canvas. */
function* atlasTexture(tile: number): Generator<void, CanvasTexture> {
  const c = document.createElement("canvas");
  c.width = tile * 4;
  c.height = tile * 2;
  const g = c.getContext("2d")!;
  for (let i = 0; i < TEX_KINDS.length; i++) {
    const t = canvasTexture(TEX_KINDS[i], tile, PAINTERS[TEX_KINDS[i]]);
    g.drawImage(t.image as HTMLCanvasElement, (i % 4) * tile, Math.floor(i / 4) * tile);
    yield;
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/**
 * The atlas material: the UV's integer part over TEX_STRIDE picks the tile,
 * its fraction repeats inside it. Gradients come from the unwrapped UV, so the
 * tile edges don't show a seam of the wrong mip level.
 */
function atlasMaterial(spec: TierSpec, map: CanvasTexture): Material {
  const m = spec.pbr ? new MeshStandardMaterial({ map, vertexColors: true, roughness: 0.85, metalness: 0 }) : new MeshLambertMaterial({ map, vertexColors: true });
  m.onBeforeCompile = (sh) => {
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
      #endif`,
    );
  };
  m.customProgramCacheKey = () => "open-atlas";
  return m;
}

// ── The ground: one painted picture of the whole city ──────────────────────────

/** Paint the ground: earth, grass, paving, roads and their lines; holes where the gutters and river are. */
function* paintGround(L: OpenLayout, px: number, forMap: boolean): Generator<void, HTMLCanvasElement> {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  const k = px / (L.half * 2);
  g.setTransform(k, 0, 0, k, L.half * k, L.half * k);
  const rnd = mulberry(7);
  // The base: red-brown earth in the town, paler in the bush.
  g.fillStyle = "#a8805a";
  g.fillRect(-L.half, -L.half, L.half * 2, L.half * 2);
  // Grass and earth as the layout says (sampled on a 3 m grid, then softened).
  for (let z = -L.half, row = 0; z < L.half; z += 3, row++) {
    for (let x = -L.half; x < L.half; x += 3) {
      const kind = L.groundAt(x + 1.5, z + 1.5);
      if (kind === "asphalt" || kind === "laterite") continue;
      g.fillStyle = kind === "grass" ? (rnd() < 0.5 ? "#7a8a48" : "#6f8242") : kind === "paving" ? (rnd() < 0.5 ? "#b8ac98" : "#aea290") : kind === "sand" ? "#d0b080" : rnd() < 0.5 ? "#a8805a" : "#9e7650";
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
  // Roads: laterite first, tar over it.
  for (const pass of ["laterite", "asphalt"] as const) {
    for (const r of L.roads) {
      if (r.kind !== pass) continue;
      g.strokeStyle = pass === "asphalt" ? "#4a4845" : "#b0603a";
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
  // The bus park's lot and the market's floor.
  g.fillStyle = "#4e4c48";
  g.fillRect(92 - 21, 110 - 27, 42, 54);
  g.fillStyle = "#9e9484";
  g.fillRect(30 - 23, -40 - 31, 46, 62);
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
function riverMaterial(time: { value: number }, sky: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: time, uSky: { value: sky.clone() }, fogColor: { value: new Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
    vertexShader: `varying vec3 vW;
      #include <fog_pars_vertex>
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSky; varying vec3 vW;
      #include <fog_pars_fragment>
      void main() {
        float r = sin(vW.x * 0.8 + vW.z * 0.3 - uTime * 1.2) * 0.5 + sin(vW.z * 1.4 - uTime * 0.9) * 0.5;
        vec3 v = normalize(cameraPosition - vW);
        vec3 col = mix(vec3(0.20, 0.22, 0.12), uSky * 0.8, pow(1.0 - v.y, 3.0) * 0.6) + r * 0.025;
        gl_FragColor = vec4(col, 0.9);
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
  const g = steps(L, spec, opts);
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
  const g = steps(L, spec, opts);
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

function* steps(L: OpenLayout, spec: TierSpec, opts: { night?: boolean }): Generator<void, OpenWorld> {
  const night = !!opts.night;
  const view = VIEW[spec.tier];
  const group = new Group();
  const uTime = { value: 0 };
  const space = new Space(L.solids, { x0: -L.half, z0: -L.half, x1: L.half, z1: L.half }, (x, z) => SURFACE_OF[L.groundAt(x, z)]);

  // ── Light: a Harmattan afternoon. Warm, dusty, a pale sun through the haze. ──
  const haze = new Color(night ? 0x1a1814 : 0xcdb894);
  const sunDir = new Vector3(0.55, 0.62, 0.35).normalize();
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
  const hemi = new HemisphereLight(night ? 0x6a7ab0 : 0xf2e0c4, 0x6a5038, night ? 1.3 : 1.25);
  const sun = new DirectionalLight(0xffd8a8, night ? 1.2 : 2.3);
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
  const gcan = yield* paintGround(L, gpx, false);
  const gtex = new CanvasTexture(gcan);
  gtex.colorSpace = SRGBColorSpace;
  gtex.minFilter = LinearMipmapLinearFilter;
  gtex.anisotropy = 4;
  const grain = canvasTexture("sand", 128, sand);
  grain.wrapS = grain.wrapT = RepeatWrapping;
  const gg = new PlaneGeometry(L.half * 2, L.half * 2, 1, 1);
  gg.rotateX(-Math.PI / 2);
  const ground = new Mesh(gg, groundMaterial(spec, gtex, grain));
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
  let drawn0 = 0;
  for (const p of L.placements) {
    // Small batches: the big landmarks take a few ms each.
    if (++drawn0 % 6 === 0) yield;
    const { chunk } = kit.draw(p, night);
    const c = chunks[cellIndex(p.x, p.z)];
    c.mass.push(...chunk.mass);
    c.main.push(...chunk.main);
    c.detail.push(...chunk.detail);
    c.foliage.push(...chunk.foliage);
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
        gk.box(s.water !== undefined && s.hx > 2 ? "#5a4a34" : "#5a5854", [s.hx * 2, 0.1, s.hz * 2], [s.x, s.y1 - 0.05, s.z], "mass", r);
        if (s.water !== undefined && s.hx <= 2) gk.box("#3a3a2a", [s.hx * 2 - 0.02, 0.02, s.hz * 2], [s.x, (s.water ?? s.y1) - 0.01, s.z], "main", r);
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
        gk.box("#d8d4c8", [r.median, 0.3, seg], [x, 0.15, z], "mass", [0, rot, 0]);
        for (let b = 0; b < seg; b += 2) gk.box(b % 4 ? "#e8c040" : "#1a1a1a", [r.median + 0.02, 0.06, 1], [x + Math.sin(rot) * (b - seg / 2 + 0.5), 0.27, z + Math.cos(rot) * (b - seg / 2 + 0.5)], "detail", [0, rot, 0]);
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
    // Beyond: the same red earth to the haze, and a ragged line of bush trees.
    const fk = new PrefabKit(13);
    fk.scratch = emptyChunk();
    const out = new PlaneGeometry(H * 2 + 1400, H * 2 + 1400, 1, 1);
    out.rotateX(-Math.PI / 2);
    out.translate(0, -0.03, 0);
    fk.put(out.toNonIndexed(), "mass", 0);
    paintOne(out, fk.scratch.mass[fk.scratch.mass.length - 1], "#9a7450");
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
  const wmat = riverMaterial(uTime, haze);
  for (const rv of L.rivers) {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i + 1 < rv.pts.length; i++) {
      const [ax, az] = rv.pts[i];
      const [bx, bz] = rv.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az) + 2;
      const g = new PlaneGeometry(rv.w + 0.6, len);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(bx - ax, bz - az));
      g.translate((ax + bx) / 2, -rv.depth + rv.water, (az + bz) / 2);
      parts.push(g.toNonIndexed());
    }
    const geo = new BufferGeometry();
    let count = 0;
    for (const p of parts) count += p.attributes.position.count;
    const pos = new Float32Array(count * 3);
    let o = 0;
    for (const p of parts) {
      pos.set(p.attributes.position.array as Float32Array, o);
      o += p.attributes.position.array.length;
    }
    geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    const m = new Mesh(geo, wmat);
    m.renderOrder = 2;
    water.add(m);
  }
  group.add(water);

  // Merge each cell into its LOD and its atlas, foliage and glow draws.
  const vc = spec.pbr ? new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: DoubleSide }) : new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const atlas = atlasMaterial(spec, yield* atlasTexture(spec.tier === 0 ? 256 : 512));
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
    const cell: CellMeshes = { i, cx, cz, objects: [], casters: [] };
    const mk = (gs: BufferGeometry[], mat: Material, uv = false): Mesh | null => {
      if (!gs.length) return null;
      const m = new Mesh(merge(gs, uv), mat);
      m.position.set(cx, 0, cz);
      m.receiveShadow = spec.shadows;
      return m;
    };
    const all = [...ch.mass, ...ch.main, ...ch.detail, ...ch.foliage];
    if (all.length) {
      const lod = new LOD();
      lod.position.set(cx, 0, cz);
      const lvl = (gs: BufferGeometry[]) => {
        const m = new Mesh(merge(gs), vc);
        m.receiveShadow = spec.shadows;
        return m;
      };
      const full = lvl(all);
      lod.addLevel(full, 0);
      lod.addLevel(lvl([...ch.mass, ...ch.main, ...ch.foliage]), near);
      lod.addLevel(lvl([...ch.mass, ...ch.foliage, ...ch.far]), mid);
      cell.objects.push(lod);
      cell.casters.push(full);
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
    cells.push(cell);
  }
  // Scratch geometries are merged copies now.
  for (const ch of chunks) for (const list of [ch.mass, ch.main, ch.detail, ch.foliage, ch.glow, ch.atlas, ch.far]) for (const g of list) g.dispose();

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

  return {
    layout: L,
    space,
    group,
    fog,
    clear,
    view,
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
