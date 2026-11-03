// Dev only (v4 Phase 7): the asset pipeline. The game draws everything from
// low-poly code today; this is how the few vital scanned or modelled assets
// get in without making the game heavy:
//
//   node tools/assets/pipeline.mjs fetch      download the vital list (vital.json) from Poly Haven (CC0)
//   node tools/assets/pipeline.mjs build      for each: weld, dedup, prune, three LODs (meshopt simplify),
//                                             meshopt-compressed geometry, textures halved to WebP;
//                                             fails any model over the budget
//   node tools/assets/pipeline.mjs upload     put the built files on the CDN (Cloudflare R2: the owner's
//                                             bucket, R2_BUCKET; uses wrangler, already logged in)
//
// Output: tools/assets/out/<id>/<id>-lod<k>.glb and out/manifest.json, which
// the game reads from VITE_ASSET_CDN (src/assets/cdn.ts). Fab (Megascans) and
// Sketchfab come in through fab.mjs and sketchfab.mjs once the owner has the
// accounts; they land in tools/assets/in/ and this builds them the same way.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, meshopt, resample } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const here = dirname(fileURLToPath(import.meta.url));
const vital = JSON.parse(readFileSync(join(here, "vital.json"), "utf8"));
const IN = join(here, "in");
const OUT = join(here, "out");
const cmd = process.argv[2];

/** A fetch that tries again (a slow line times out now and then). */
async function grab(url, tries = 5) {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`${r.status}`);
      return r;
    } catch (e) {
      if (k >= tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 2000 * (k + 1)));
    }
  }
}

async function fetchAll() {
  mkdirSync(IN, { recursive: true });
  for (const m of vital.models) {
    if (m.source !== "polyhaven") continue;
    const dir = join(IN, m.id);
    if (existsSync(join(dir, `${m.id}.gltf`))) continue;
    try {
      const files = await (await grab(`https://api.polyhaven.com/files/${m.id}`)).json();
      const g = files?.gltf?.["1k"]?.gltf;
      if (!g) {
        console.log(`skip ${m.id}: no 1k glTF`);
        continue;
      }
      mkdirSync(dir, { recursive: true });
      // The buffers and textures first, the .gltf last: a model whose .gltf is there is whole.
      for (const [rel, inc] of Object.entries(g.include ?? {})) {
        const p = join(dir, rel);
        if (existsSync(p)) continue;
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, Buffer.from(await (await grab(inc.url)).arrayBuffer()));
      }
      writeFileSync(join(dir, `${m.id}.gltf`), Buffer.from(await (await grab(g.url)).arrayBuffer()));
      console.log(`fetched ${m.id}`);
    } catch (e) {
      console.log(`skip ${m.id}: ${e.message}`);
    }
  }
}

async function buildAll() {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  mkdirSync(OUT, { recursive: true });
  const manifest = { built: new Date().toISOString().slice(0, 10), models: {} };
  let over = 0;
  // `build <id>…` rebuilds just those (the manifest keeps the others).
  const only = process.argv.slice(3);
  if (only.length && existsSync(join(OUT, "manifest.json"))) manifest.models = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")).models;
  for (const m of vital.models) {
    if (only.length && !only.includes(m.id)) continue;
    const src = join(IN, m.id, `${m.id}.gltf`);
    if (!existsSync(src)) {
      console.log(`skip ${m.id}: not fetched`);
      continue;
    }
    const lods = [];
    // The model's size (metres, the source's scale): the game's solid for it comes from this.
    let size = null;
    for (let k = 0; k < m.lods.length; k++) {
      const doc = await io.read(src);
      if (k === 0) {
        const b = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
        size = [0, 1, 2].map((i) => Math.round((b.max[i] - b.min[i]) * 1000) / 1000);
      }
      await doc.transform(dedup(), weld(), prune(), resample(), simplify({ simplifier: MeshoptSimplifier, ratio: m.lods[k], error: (m.error ?? 0.002) * (k + 1) }), meshopt({ encoder: MeshoptEncoder, level: "high" }));
      // Textures: halved per LOD (the far ones need little).
      const sharp = await import("sharp").catch(() => null);
      if (sharp) {
        for (const t of doc.getRoot().listTextures()) {
          const img = t.getImage();
          if (!img) continue;
          const size = Math.max(64, 512 >> k);
          const out = await sharp.default(Buffer.from(img)).resize(size, size, { fit: "inside" }).webp({ quality: 78 }).toBuffer();
          t.setImage(new Uint8Array(out)).setMimeType("image/webp");
        }
      }
      mkdirSync(join(OUT, m.id), { recursive: true });
      const file = join(OUT, m.id, `${m.id}-lod${k}.glb`);
      await io.write(file, doc);
      const kb = Math.round(statSync(file).size / 1024);
      lods.push({ file: `${m.id}/${m.id}-lod${k}.glb`, kb });
    }
    const total = lods.reduce((a, l) => a + l.kb, 0);
    if (total > vital.budgetKB) over++;
    manifest.models[m.id] = { use: m.use, lods, total, license: "CC0", source: m.source, size, ...(m.loc ? { loc: m.loc, solid: !!m.solid } : {}) };
    console.log(`${total > vital.budgetKB ? "OVER" : "ok  "} ${m.id}: ${lods.map((l) => `${l.kb} KB`).join(" / ")}`);
  }
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  if (over) {
    console.log(`${over} over the ${vital.budgetKB} KB budget`);
    process.exitCode = 1;
  }
}

function uploadAll() {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    console.log("Set R2_BUCKET to the owner's Cloudflare R2 bucket (wrangler r2 bucket create emilgo-assets), then run again.");
    process.exitCode = 1;
    return;
  }
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const f of walk(OUT)) {
    const key = f.slice(OUT.length + 1);
    execFileSync("wrangler", ["r2", "object", "put", `${bucket}/${key}`, "--file", f, "--remote", "--cache-control", "public, max-age=31536000, immutable"], { stdio: "inherit" });
  }
}

if (cmd === "fetch") await fetchAll();
else if (cmd === "build") await buildAll();
else if (cmd === "upload") uploadAll();
else console.log("node tools/assets/pipeline.mjs fetch | build | upload");
