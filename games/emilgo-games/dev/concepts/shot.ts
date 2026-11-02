// Dev only: one concept render per page load.
//   /dev/concepts/shot.html?scene=<name>&w=1600&h=900
// The screenshot driver waits for window.__done.
import "@fontsource/montserrat/900.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/inter/800.css";
import { fail, q } from "./lib/stage";

const SCENES: Record<string, () => Promise<{ default: (name: string) => Promise<void> }>> = {
  operator: () => import("./scenes/characters"),
  "operator-turn": () => import("./scenes/characters"),
  "operator-face": () => import("./scenes/characters"),
  armour: () => import("./scenes/characters"),
  "tps-ffa": () => import("./scenes/characters"),
  ads: () => import("./scenes/characters"),
  win: () => import("./scenes/characters"),
  "tps-dead": () => import("./scenes/zombies"),
  zombies: () => import("./scenes/zombies"),
  "zombie-close": () => import("./scenes/zombies"),
  "zombie-rise": () => import("./scenes/zombies"),
  weapons: () => import("./scenes/loot"),
  rarity: () => import("./scenes/loot"),
  loot: () => import("./scenes/loot"),
  billboards: () => import("./scenes/world"),
  map: () => import("./scenes/world"),
  tiers: () => import("./scenes/world"),
};

const name = q.get("scene") ?? "operator";
(async () => {
  await document.fonts.ready;
  const key = name.startsWith("biome-") ? "biome" : name;
  const load = SCENES[key] ?? (() => import("./scenes/world"));
  const mod = await load();
  await mod.default(name);
})().catch(fail);
