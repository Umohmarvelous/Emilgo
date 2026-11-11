// The open worlds' texture atlases baked to KTX2 (v6 max, 3.4; SPEC-V6
// "Performance": "Textures 1024 px on phones; KTX2 + Basis: take: KTX2 cuts GPU
// memory about 4×, the biggest single win left for low phones").
//
// The browser composes the wall and ground atlases from the library's JPEGs
// (maps/open/build.ts); a 1024-px tile makes a 4096 × 2048 atlas, 44 MB of GPU
// memory with its mipmaps, twice over with the normals. Baked here, the same
// atlases as Basis ETC1S in KTX2: the GPU keeps them compressed (a quarter to an
// eighth of the memory), the download is smaller than the JPEGs, the phone does
// no compositing. A copy per tier (256, 512, 1024-px tiles); Low takes no normals.
//
//   npx tsx tools/assets/atlases.ts       (after library.mjs; needs assets-site/lib/tex/)
//
// Out: assets-site/lib/atlas/{walls|ground}-{day|night}.{a|n}.{tile}.ktx2, atlas.json, and the Basis
// transcoder three's KTX2Loader runs (assets-site/lib/basis/). Same layouts as atlasLists.ts.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { encodeToKTX2 } from "ktx2-encoder";

import { GROUND_LIB, WALL_LIB } from "../../src/maps/open/atlasLists";

const here = dirname(fileURLToPath(import.meta.url));
const LIB = join(here, "../../assets-site/lib");
const TEX = join(LIB, "tex");
const OUT = join(LIB, "atlas");
const BASIS = join(LIB, "basis");
mkdirSync(OUT, { recursive: true });
mkdirSync(BASIS, { recursive: true });

const decode = async (buf: Uint8Array) => {
  const r = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: r.info.width, height: r.info.height, data: new Uint8Array(r.data) };
};

/** One atlas: 4 × 2 tiles of `tile` px from the library's pictures (a fill where one is missing). */
async function compose(names: (string | null)[], kind: "a" | "n", tile: number, fill: { r: number; g: number; b: number }): Promise<Buffer | null> {
  const layers: sharp.OverlayOptions[] = [];
  let found = 0;
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (!n) continue;
    const file = join(TEX, `${n}.${kind}.${tile}.jpg`);
    if (!existsSync(file)) continue;
    found++;
    layers.push({ input: await sharp(file).resize(tile, tile).toBuffer(), left: (i % 4) * tile, top: Math.floor(i / 4) * tile });
  }
  if (!found) return null;
  return sharp({ create: { width: tile * 4, height: tile * 2, channels: 3, background: fill } }).composite(layers).png().toBuffer();
}

const made: Record<string, { file: string; kb: number }> = {};
for (const key of ["day", "night"] as const) {
  for (const tile of [256, 512, 1024]) {
    for (const [what, names, fillA] of [
      ["walls", WALL_LIB[key], { r: 160, g: 156, b: 150 }],
      ["ground", GROUND_LIB[key], { r: 0x7a, g: 0x76, b: 0x6e }],
    ] as const) {
      for (const kind of tile === 256 ? (["a"] as const) : (["a", "n"] as const)) {
        const png = await compose([...names], kind, tile, kind === "n" ? { r: 128, g: 128, b: 255 } : fillA);
        if (!png) continue;
        const t0 = Date.now();
        // Flipped as the browser's canvas textures are (flipY), so the shaders' tile maths stay as they are.
        const ktx = await encodeToKTX2(new Uint8Array(png), {
          isUASTC: false,
          isYFlip: true,
          generateMipmap: true,
          qualityLevel: kind === "a" ? 160 : 200,
          isNormalMap: kind === "n",
          isSetKTX2SRGBTransferFunc: kind === "a",
          isKTX2File: true,
          imageDecoder: decode,
        });
        const name = `${what}-${key}.${kind}.${tile}.ktx2`;
        writeFileSync(join(OUT, name), ktx);
        made[`${what}-${key}.${kind}.${tile}`] = { file: `atlas/${name}`, kb: Math.round(ktx.length / 1024) };
        console.log(name.padEnd(30), `${Math.round(ktx.length / 1024)} KB`, `${Date.now() - t0} ms`);
      }
    }
  }
}
writeFileSync(join(OUT, "atlas.json"), JSON.stringify({ v: 1, atlases: made }, null, 1));
// The transcoder (three's, so it matches the loader).
const req = createRequire(import.meta.url);
// (three's package.json isn't exported: from its main file up to the package's root.)
const basisDir = join(dirname(req.resolve("three")), "../examples/jsm/libs/basis");
for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) copyFileSync(join(basisDir, f), join(BASIS, f));
console.log("atlas.json and the transcoder written");
