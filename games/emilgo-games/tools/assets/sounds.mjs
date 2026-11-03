// Dev only (v4 Phase 8): build the sample layer for the CDN.
//
//   node tools/assets/sounds.mjs        encode every sound listed in sounds.json that has a source
//                                       (a Kenney file in tools/assets/in/sfx/, or a Freesound CC0 id with
//                                       FREESOUND_TOKEN) to Opus 48 kbps mono: out/sfx/<name>.webm, and
//                                       out/sfx/manifest.json; pipeline.mjs upload puts them on R2
//
// Needs ffmpeg (brew install ffmpeg). A Freesound id is checked to be CC0 before it's used.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const list = JSON.parse(readFileSync(join(here, "sounds.json"), "utf8")).sounds;
const IN = join(here, "in", "sfx");
const OUT = join(here, "out", "sfx");
mkdirSync(OUT, { recursive: true });
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  console.log("Needs ffmpeg (brew install ffmpeg).");
  process.exit(1);
}
const token = process.env.FREESOUND_TOKEN;
const manifest = { sounds: {} };
for (const [name, src] of Object.entries(list)) {
  let file = null;
  if (src.kenney && existsSync(join(IN, src.kenney))) file = join(IN, src.kenney);
  else if (src.freesound && token) {
    const info = await (await fetch(`https://freesound.org/apiv2/sounds/${src.freesound}/?token=${token}`)).json();
    if (!/publicdomain\/zero/.test(info?.license ?? "")) {
      console.log(`skip ${name}: Freesound ${src.freesound} isn't CC0`);
      continue;
    }
    file = join(IN, `${name}.${info.type ?? "wav"}`);
    mkdirSync(IN, { recursive: true });
    writeFileSync(file, Buffer.from(await (await fetch(info.previews["preview-hq-ogg"])).arrayBuffer()));
  }
  if (!file) {
    console.log(`skip ${name}: no source yet (the synthesised sound plays)`);
    continue;
  }
  const out = join(OUT, `${name}.webm`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-ac", "1", "-c:a", "libopus", "-b:a", "48k", out]);
  manifest.sounds[name] = `${name}.webm`;
  console.log(`ok ${name}`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
