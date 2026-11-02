// Dev only (v4 Phase 7): Megascans through Fab, once the owner has the
// account and its licence. Fab has no public download API, so the owner
// exports from Fab (or Quixel Bridge) as glTF at 1k–2k into a folder, then:
//
//   FAB_LICENCE=standard node tools/assets/fab.mjs <folder-of-exports>
//
// Each export is copied into tools/assets/in/<id>/ with a licence note, and
// pipeline.mjs build compresses it like the rest. Refuses without
// FAB_LICENCE (who holds the licence must say so: it isn't CC0).

import { cpSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const lic = process.env.FAB_LICENCE;
const from = process.argv[2];
const IN = join(dirname(fileURLToPath(import.meta.url)), "in");
if (!lic || !from || !existsSync(from)) {
  console.log("Needs FAB_LICENCE (the owner's Fab licence: standard or professional) and a folder of glTF exports. Nothing copied.");
  process.exit(1);
}
for (const d of readdirSync(from)) {
  const src = join(from, d);
  const id = basename(d).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  mkdirSync(join(IN, id), { recursive: true });
  cpSync(src, join(IN, id), { recursive: true });
  writeFileSync(join(IN, id, "LICENCE.txt"), `Fab / Megascans, ${lic} licence, held by the owner. Not CC0: never redistribute the source files.\n`);
  console.log(`in: ${id}`);
}
