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
  const e = (await atlasList())?.[name];
  return e ? ktxFile(e.file, anisotropy) : null;
}

/** v6 max (3.4): any KTX2 file in the library (its path under lib/), or null. */
export async function ktxFile(path: string, anisotropy = 4): Promise<Texture | null> {
  if (!loader) return null;
  try {
    const t = await loader.loadAsync(`${BASE}${path}`);
    t.minFilter = LinearMipmapLinearFilter;
    t.anisotropy = anisotropy;
    return t;
  } catch {
    return null;
  }
}

/** Can this phone take the library's KTX2 files at all (a renderer was given and it set up)? */
export function ktxOn(): boolean {
  return !!loader;
}

/** A JSON file in the library (once), or null. */
const jsons = new Map<string, Promise<unknown>>();
export function libJson(path: string): Promise<unknown> {
  let p = jsons.get(path);
  if (!p) {
    p = fetch(`${BASE}${path}`, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    jsons.set(path, p);
  }
  return p;
}
