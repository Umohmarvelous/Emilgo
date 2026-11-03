// The asset CDN (v4 Phase 7): the few vital models the pipeline built
// (tools/assets/pipeline.mjs: CC0, three LODs, meshopt-compressed, WebP
// textures), served from the owner's Cloudflare R2 behind VITE_ASSET_CDN.
// Nothing here is needed to play: without a CDN (offline, the app's copy,
// Lagos Life) the game draws its own low-poly things, as it always has.
//
// Models load once, on demand, and stay in an LRU under the tier's GPU
// budget (Low 120 MB, Medium 200 MB, High 350 MB).

import { BufferAttribute, type BufferGeometry, type Material } from "three";

import type { Tier } from "../graphics/tiers";

export interface CdnModel {
  geometry: BufferGeometry;
  material: Material;
  bytes: number;
  /** Each mesh on its own, set on its own origin (centred, standing on y = 0): a set's variants (rock_moss_set_01). */
  parts: BufferGeometry[];
  /** The whole model as it was made, mesh by mesh with its own material, centred and standing on y = 0 (a prop). */
  meshes: { geometry: BufferGeometry; material: Material }[];
}

interface Manifest {
  models: Record<string, { use: string; lods: { file: string; kb: number }[] }>;
}

const BUDGET_MB = [120, 200, 350] as const;
// v4 rework: without the owner's CDN, the site's own library serves the models (tools/assets/out → assets-site/lib/models).
const LIB = __HOST_BUILD__ === "emilgo" ? "https://milgogames.pages.dev/lib/models" : `${import.meta.env.BASE_URL}lib/models`;
const base = ((import.meta.env.VITE_ASSET_CDN as string | undefined) ?? LIB).replace(/\/$/, "");
let manifest: Promise<Manifest | null> | null = null;
const cache = new Map<string, Promise<CdnModel | null>>();
const used: string[] = [];
let bytes = 0;

/** Is there a CDN at all (the build says so)? */
export function cdnOn(): boolean {
  return !!base;
}

function loadManifest(): Promise<Manifest | null> {
  if (!manifest) manifest = cdnOn() ? fetch(`${base}/manifest.json`).then((r) => (r.ok ? r.json() : null), () => null) : Promise.resolve(null);
  return manifest;
}

/**
 * The model the pipeline built for `use` ("crate", "drum", "rock" …) at LOD
 * `lod` (0 near … 2 far), merged to one geometry and one material, or null.
 */
export async function modelFor(use: string, lod: 0 | 1 | 2, tier: Tier, id?: string): Promise<CdnModel | null> {
  const m = await loadManifest();
  if (!m) return null;
  // Of the models for a use, the lightest at that LOD (the phone pays for every byte).
  const kb = (v: Manifest["models"][string]) => v.lods[Math.min(lod, v.lods.length - 1)].kb;
  const entry = Object.entries(m.models)
    .filter(([k, v]) => v.use === use && (!id || k === id))
    .sort((a, b) => kb(a[1]) - kb(b[1]))[0];
  if (!entry) return null;
  const file = entry[1].lods[Math.min(lod, entry[1].lods.length - 1)].file;
  let p = cache.get(file);
  if (!p) {
    p = load(`${base}/${file}`, tier);
    cache.set(file, p);
  }
  used.splice(used.indexOf(file) >>> 0, used.includes(file) ? 1 : 0);
  used.push(file);
  return p;
}

async function load(url: string, tier: Tier): Promise<CdnModel | null> {
  try {
    const [{ GLTFLoader }, { MeshoptDecoder }, { mergeGeometries }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      import("three/examples/jsm/utils/BufferGeometryUtils.js"),
    ]);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const geos: BufferGeometry[] = [];
    const mats: Material[] = [];
    let material: Material | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const mesh = o as import("three").Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
      // No morph targets (a prop drawn instanced has no influences: three.js would read undefined).
      g.morphAttributes = {};
      g.morphTargetsRelative = false;
      // The pipeline quantizes (KHR_mesh_quantization: int16 positions, int8 normals, uint16 UVs): to
      // float first, or the node's scale would clip the positions and the meshes wouldn't merge.
      for (const k of Object.keys(g.attributes)) {
        const a = g.getAttribute(k);
        if (a.array instanceof Float32Array && !a.normalized && !(a as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) continue;
        const n = a.itemSize;
        const f = new Float32Array(a.count * n);
        for (let i = 0; i < a.count; i++) {
          f[i * n] = a.getX(i);
          if (n > 1) f[i * n + 1] = a.getY(i);
          if (n > 2) f[i * n + 2] = a.getZ(i);
          if (n > 3) f[i * n + 3] = a.getW(i);
        }
        g.setAttribute(k, new BufferAttribute(f, n));
      }
      g.applyMatrix4(mesh.matrixWorld);
      geos.push(g);
      mats.push(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
      material ??= mats[mats.length - 1];
    });
    if (!geos.length || !material) return null;
    const parts = geos.map((g) => {
      const p = g.clone();
      p.computeBoundingBox();
      const b = p.boundingBox!;
      p.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      p.computeBoundingBox();
      p.computeBoundingSphere();
      return p;
    });
    const geometry = geos.length === 1 ? geos[0].clone() : mergeGeometries(geos, false);
    if (!geometry) return null;
    // The whole model, centred on its footprint and standing on y = 0 (the merge above copied, so these move alone).
    geometry.computeBoundingBox();
    const wb = geometry.boundingBox!;
    const meshes = geos.map((g, i) => {
      g.translate(-(wb.min.x + wb.max.x) / 2, -wb.min.y, -(wb.min.z + wb.max.z) / 2);
      g.computeBoundingSphere();
      return { geometry: g, material: mats[i] };
    });
    const size = (geometry.attributes.position.count * 32) / 1e6 + 1;
    bytes += size;
    // Over the tier's budget: forget the least recently used (their next use loads again).
    while (bytes > BUDGET_MB[tier] && used.length > 1) {
      const old = used.shift()!;
      const was = await cache.get(old);
      cache.delete(old);
      if (was) {
        bytes -= was.bytes;
        was.geometry.dispose();
        for (const g of was.parts) g.dispose();
        for (const m of was.meshes) m.geometry.dispose();
      }
    }
    return { geometry, material, bytes: size, parts, meshes };
  } catch {
    return null;
  }
}
