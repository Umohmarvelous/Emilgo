// The asset library on the client (v4 rework R4): the CC0 photo textures and
// HDR skies (tools/assets/library.mjs builds them into the site's /lib/). The
// web build reads them from its own site; the EMILGO app's single-file copy
// from the game's site (milgogames.pages.dev). Offline, or if a file fails,
// nothing breaks: each user falls back to the textures the game draws itself.

import { DataTexture, EquirectangularReflectionMapping, FloatType, HalfFloatType, LinearFilter, SRGBColorSpace, Texture, TextureLoader } from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

import type { Tier } from "../graphics/tiers";

const BASE =
  (import.meta.env.VITE_LIB_BASE as string | undefined) ??
  (__HOST_BUILD__ === "emilgo" ? "https://milgogames.pages.dev/lib/" : `${import.meta.env.BASE_URL}lib/`);

export type TexName =
  | "asphalt" | "asphaltWorn" | "roadDamaged" | "gravel" | "paving" | "cobble" | "grass" | "grassSparse" | "dirt" | "forest" | "leaves" | "mud"
  | "dryMud" | "sand" | "snow" | "rock" | "cliff" | "darkRock" | "rockWall"
  | "plaster" | "paintedConcrete" | "concrete" | "panels" | "brick" | "planks" | "metal" | "corrugated" | "rust" | "rustSheet" | "roofTiles"
  | "glassTower" | "glassGrid" | "brickFacade" | "concreteFacade" | "nightOffice" | "nightTower";

export type SkyName = "day" | "clear" | "afternoon" | "dusk" | "sunset" | "overcast" | "misty" | "wasteland" | "snowfield" | "high" | "moon" | "night";

/** The texture size a tier loads: Low 256, Medium 512, High and Max 1024. */
export function texSize(tier: Tier): 256 | 512 | 1024 {
  return tier === 0 ? 256 : tier === 1 ? 512 : 1024;
}

let probe: Promise<boolean> | null = null;
/** Is the library there (one small request, once)? */
export function libraryOn(): Promise<boolean> {
  probe ??= fetch(`${BASE}library.json`, { cache: "force-cache" })
    .then((r) => r.ok)
    .catch(() => false);
  return probe;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
function image(url: string): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((res) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.decoding = "async";
      const t = setTimeout(() => res(null), 15000);
      im.onload = () => {
        clearTimeout(t);
        res(im);
      };
      im.onerror = () => {
        clearTimeout(t);
        res(null);
      };
      im.src = url;
    });
    images.set(url, p);
  }
  return p;
}

/** A set's albedo and normal at a size, or null (not there: draw your own). */
export async function texSet(name: TexName, size: 256 | 512 | 1024): Promise<{ a: HTMLImageElement; n: HTMLImageElement } | null> {
  if (!(await libraryOn())) return null;
  const [a, n] = await Promise.all([image(`${BASE}tex/${name}.a.${size}.jpg`), image(`${BASE}tex/${name}.n.${size}.jpg`)]);
  return a && n ? { a, n } : null;
}

/** Just the albedo (Low draws no normals). */
export async function texAlbedo(name: TexName, size: 256 | 512 | 1024): Promise<HTMLImageElement | null> {
  if (!(await libraryOn())) return null;
  return image(`${BASE}tex/${name}.a.${size}.jpg`);
}

const skies = new Map<string, Promise<{ bg: Texture | null; env: DataTexture | null }>>();
/** A sky: its picture (the background) and, for lit tiers, its small HDR (the light). */
export function sky(name: SkyName, withEnv: boolean): Promise<{ bg: Texture | null; env: DataTexture | null }> {
  const key = `${name}|${withEnv}`;
  let p = skies.get(key);
  if (!p) {
    p = (async () => {
      if (!(await libraryOn())) return { bg: null, env: null };
      const bg = await new TextureLoader().loadAsync(`${BASE}sky/${name}.jpg`).catch(() => null);
      if (bg) {
        bg.colorSpace = SRGBColorSpace;
        bg.mapping = EquirectangularReflectionMapping;
        bg.minFilter = LinearFilter;
        bg.generateMipmaps = false;
      }
      let env: DataTexture | null = null;
      if (withEnv) {
        const L = new HDRLoader();
        L.setDataType(HalfFloatType);
        env = await L.loadAsync(`${BASE}sky/${name}.hdr`).catch(() => null);
        if (env) env.mapping = EquirectangularReflectionMapping;
      }
      return { bg, env };
    })();
    skies.set(key, p);
  }
  return p;
}

void FloatType;
