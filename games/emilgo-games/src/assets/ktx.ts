// Compressed textures (v6 max, 3.4): the open worlds' atlases as KTX2 (Basis
// ETC1S), baked by tools/assets/atlases.ts. The GPU keeps them compressed (a
// quarter to an eighth of the memory of the atlases the browser composes from
// JPEGs), and the phone skips composing them. three's KTX2Loader transcodes to
// what the GPU takes (ASTC, ETC2, BC, PVRTC) in a worker.
//
// Nothing depends on it: no renderer yet, no support, the files not there, a
// failed fetch, and the world composes its atlases as before.

import { LinearMipmapLinearFilter, type Texture, type WebGLRenderer } from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

const BASE =
  (import.meta.env.VITE_LIB_BASE as string | undefined) ??
  (__HOST_BUILD__ === "emilgo" ? "https://milgogames.pages.dev/lib/" : `${import.meta.env.BASE_URL}lib/`);

let loader: KTX2Loader | null = null;
let list: Promise<Record<string, { file: string; kb: number }> | null> | null = null;

/** The renderer the textures are for (once: the loader asks it what the GPU can take). */
export function initKtx2(renderer: WebGLRenderer): void {
  if (loader) return;
  try {
    loader = new KTX2Loader().setTranscoderPath(`${BASE}basis/`).detectSupport(renderer);
  } catch {
    loader = null;
  }
}

function atlasList(): Promise<Record<string, { file: string; kb: number }> | null> {
  list ??= fetch(`${BASE}atlas/atlas.json`, { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && typeof j === "object" && j.atlases ? (j.atlases as Record<string, { file: string; kb: number }>) : null))
    .catch(() => null);
  return list;
}

/** A baked atlas ("walls-day.a.512"), compressed, or null (the world composes its own). */
export async function ktxAtlas(name: string, anisotropy = 4): Promise<Texture | null> {
  if (!loader) return null;
  const l = await atlasList();
  const e = l?.[name];
  if (!e) return null;
  try {
    const t = await loader.loadAsync(`${BASE}${e.file}`);
    t.minFilter = LinearMipmapLinearFilter;
    t.anisotropy = anisotropy;
    return t;
  } catch {
    return null;
  }
}
