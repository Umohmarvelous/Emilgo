// The scanned trees' impostors to KTX2 (v6 max, 3.4). dev/impostor.ts renders
// each scan (Poly Haven, CC0, downloaded to tools/assets/in/trees/) into a colour
// and a normal atlas (tools/assets/in/impostors/<id>.{a,n}.png, <id>.json); this
// bakes them for the game, a copy per tier (512-px views; 256 for Low), Basis
// ETC1S in KTX2 with the colour's alpha kept (the leaves' cut-out):
//
//   npx tsx tools/assets/trees.ts [id …]     (ids: bake only those again; the rest keep their files)
//
// Out: assets-site/lib/trees/<id>.{a,n}.{512|256}.ktx2 and trees.json (each species' views, frame and files).
// The bake, for each id (with the dev server up):
//   node dev/cdp.mjs "http://localhost:5173/dev/impostor.html?id=<id>&views=12&tile=512[&node=0]" <out> <steps.json>
//   (fir_sapling_medium: node=0, the tallest of its three saplings)
//   (steps: wait for document.title "done", saveEval window.__impostor.a / .n / .metaUrl to the files above)

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { encodeToKTX2 } from "ktx2-encoder";

const here = dirname(fileURLToPath(import.meta.url));
const IN = join(here, "in/impostors");
const OUT = join(here, "../../assets-site/lib/trees");
mkdirSync(OUT, { recursive: true });

const decode = async (buf: Uint8Array) => {
  const r = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: r.info.width, height: r.info.height, data: new Uint8Array(r.data) };
};

const only = process.argv.slice(2);
const species: Record<string, unknown> = {};
for (const f of readdirSync(IN).filter((x) => x.endsWith(".json"))) {
  const id = f.replace(/\.json$/, "");
  const meta = JSON.parse(readFileSync(join(IN, f), "utf8")) as { views: number; cols: number; rows: number; tile: number; size: number; height: number };
  const files: Record<string, string> = {};
  for (const kind of ["a", "n"] as const) {
    const src = join(IN, `${id}.${kind}.png`);
    if (!existsSync(src)) continue;
    for (const tile of [512, 256]) {
      const name = `${id}.${kind}.${tile}.ktx2`;
      if (only.length && !only.includes(id) && existsSync(join(OUT, name))) {
        files[`${kind}.${tile}`] = `trees/${name}`;
        continue;
      }
      const w = meta.cols * tile;
      const png = await sharp(src).resize(w, meta.rows * tile, { kernel: "lanczos3" }).png().toBuffer();
      const t0 = Date.now();
      const ktx = await encodeToKTX2(new Uint8Array(png), {
        isUASTC: false,
        isYFlip: true,
        generateMipmap: true,
        qualityLevel: kind === "a" ? 190 : 200,
        isNormalMap: kind === "n",
        isSetKTX2SRGBTransferFunc: kind === "a",
        isKTX2File: true,
        imageDecoder: decode,
      });
      writeFileSync(join(OUT, name), ktx);
      files[`${kind}.${tile}`] = `trees/${name}`;
      console.log(name.padEnd(36), `${Math.round(ktx.length / 1024)} KB`, `${Date.now() - t0} ms`);
    }
  }
  species[id] = { views: meta.views, cols: meta.cols, rows: meta.rows, size: meta.size, height: meta.height, files };
}
writeFileSync(join(OUT, "trees.json"), JSON.stringify({ v: 1, species }, null, 1));
console.log(`trees.json: ${Object.keys(species).join(", ")}`);
