// The asset CDN (v4 Phase 7): the few vital models the pipeline built
// (tools/assets/pipeline.mjs: CC0, three LODs, meshopt-compressed, WebP
// textures), served from the owner's Cloudflare R2 behind VITE_ASSET_CDN.
// Nothing here is needed to play: without a CDN (offline, the app's copy,
// Lagos Life) the game draws its own low-poly things, as it always has.
//
// Models load once, on demand, and stay in an LRU under the tier's GPU
// budget (Low 120 MB, Medium 200 MB, High 350 MB).

import type { BufferGeometry, Material } from "three";

import type { Tier } from "../graphics/tiers";

export interface CdnModel {
  geometry: BufferGeometry;
  material: Material;
  bytes: number;
}

interface Manifest {
  models: Record<string, { use: string; lods: { file: string; kb: number }[] }>;
}

const BUDGET_MB = [120, 200, 350] as const;
const base = ((import.meta.env.VITE_ASSET_CDN as string | undefined) ?? "").replace(/\/$/, "");
let manifest: Promise<Manifest | null> | null = null;
const cache = new Map<string, Promise<CdnModel | null>>();
const used: string[] = [];
let bytes = 0;

/** Is there a CDN at all (the build says so)? */
export function cdnOn(): boolean {
  return /^https?:\/\//.test(base);
}

function loadManifest(): Promise<Manifest | null> {
  if (!manifest) manifest = cdnOn() ? fetch(`${base}/manifest.json`).then((r) => (r.ok ? r.json() : null), () => null) : Promise.resolve(null);
  return manifest;
}

/**
 * The model the pipeline built for `use` ("crate", "drum", "rock" …) at LOD
 * `lod` (0 near … 2 far), merged to one geometry and one material, or null.
 */
export async function modelFor(use: string, lod: 0 | 1 | 2, tier: Tier): Promise<CdnModel | null> {
  const m = await loadManifest();
  if (!m) return null;
  const entry = Object.entries(m.models).find(([, v]) => v.use === use);
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
    let material: Material | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const mesh = o as import("three").Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
      geos.push(g);
      material ??= Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    });
    if (!geos.length || !material) return null;
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!geometry) return null;
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
      }
    }
    return { geometry, material, bytes: size };
  } catch {
    return null;
  }
}
