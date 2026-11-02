// Dev only (v4 Phase 7): bring a Sketchfab model in, once the owner has an
// account. Waits for the owner's token (never in the repo):
//
//   SKETCHFAB_TOKEN=… node tools/assets/sketchfab.mjs <model-uid> [<uid> …]
//
// Only downloadable models under CC0 or CC-BY are taken; CC-BY ones are
// written to tools/assets/in/CREDITS.md (the game's credits must show them).
// They land in tools/assets/in/<uid>/ and pipeline.mjs build compresses them.

import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.SKETCHFAB_TOKEN;
const uids = process.argv.slice(2);
const IN = join(dirname(fileURLToPath(import.meta.url)), "in");
if (!token) {
  console.log("Needs SKETCHFAB_TOKEN (the owner's API token, from sketchfab.com/settings/password). Nothing downloaded.");
  process.exit(1);
}
for (const uid of uids) {
  const info = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}`)).json();
  const lic = info?.license?.slug ?? "";
  if (!info?.isDownloadable || !["cc0", "by"].includes(lic)) {
    console.log(`skip ${uid}: ${info?.isDownloadable ? `licence ${lic || "unknown"}` : "not downloadable"}`);
    continue;
  }
  const dl = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${token}` } })).json();
  const url = dl?.glb?.url ?? dl?.gltf?.url;
  if (!url) {
    console.log(`skip ${uid}: no glTF download`);
    continue;
  }
  mkdirSync(join(IN, uid), { recursive: true });
  writeFileSync(join(IN, uid, `${uid}.${dl.glb ? "glb" : "zip"}`), Buffer.from(await (await fetch(url)).arrayBuffer()));
  if (lic === "by") appendFileSync(join(IN, "CREDITS.md"), `- "${info.name}" by ${info.user?.displayName ?? "?"} (CC-BY 4.0), ${info.viewerUrl}\n`);
  console.log(`got ${uid} (${lic})`);
}
