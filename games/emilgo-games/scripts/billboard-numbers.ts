// v6 (the owner: "name every ads billboard with numbers like in Lagos Life (billboard 1, billboard 2 … ) and
// their location"): every board on the big world, numbered in the world's own order (the city's first, as they
// stand in its middle), with the place it stands in or nearest. Writes the numbers and names into the v6 billboard
// migration's slot rows:
//   npx tsx scripts/billboard-numbers.ts
// Run it again whenever the boards change (the numbers follow the world's order, so new boards go last).

import { readFileSync, writeFileSync } from "node:fs";

import { buildMaxWorld } from "../src/maps/open/max";

const w = buildMaxWorld();
const named = w.areas;
const where = (x: number, z: number): string => {
  const inside = named.filter((a) => Math.hypot(a.x - x, a.z - z) <= a.r).sort((a, b) => a.r - b.r)[0];
  if (inside) return inside.name;
  const best = [...named].sort((a, b) => Math.hypot(a.x - x, a.z - z) - a.r - (Math.hypot(b.x - x, b.z - z) - b.r))[0];
  return `near ${best.name}`;
};
const KIND: Record<string, string> = { road: "roadside", landmark: "landmark", plaza: "plaza entrance", route: "bus route", zone: "zone wall" };
const boards = w.boards ?? [];
const rows = boards.map((b, i) => {
  const n = i + 1;
  const map = b.id.startsWith("nw-") ? "naija-world" : "max-world";
  const label = `Billboard ${n} · ${where(b.x, b.z)} (${KIND[b.kind] ?? b.kind}${b.premium ? ", premium" : ""})`;
  return `  ('${b.id}', '${map}', '${b.kind}', ${b.premium ? "TRUE " : "FALSE"}, '${label.replace(/'/g, "''")}', ${n})`;
});
const block = `-- BEGIN generated: scripts/billboard-numbers.ts (${boards.length} boards)
INSERT INTO public.game_billboard_slots (id, map, kind, premium, label, number) VALUES
${rows.join(",\n")}
ON CONFLICT (id) DO UPDATE
  SET kind = EXCLUDED.kind, premium = EXCLUDED.premium, label = EXCLUDED.label, number = EXCLUDED.number;
-- END generated`;
const file = new URL("../../../supabase/migrations/migration_game_billboards_v6.sql", import.meta.url);
const sql = readFileSync(file, "utf8");
const out = sql.replace(/-- BEGIN generated[\s\S]*?-- END generated/, block);
writeFileSync(file, out);
console.log(`${boards.length} boards numbered (${boards.filter((b) => b.premium).length} premium)`);
