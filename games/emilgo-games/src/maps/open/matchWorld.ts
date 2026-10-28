// An open world as a match needs it (game/core/match.ts MatchWorld): the
// solids, the starts, the places worth finding, Find the Flag's stash spots,
// Squad Rally's route and, for a mode on part of the world, its arena. Pure:
// the server and the phones build the same one from the same layout.

import type { MatchWorld } from "../../game/core/match";
import type { Space } from "../../game/core/space";
import type { OpenLayout } from "./naija";
import type { PrefabId } from "./prefabs";

/** Where a flag can be hidden: inside a danfo, a water tank, under a stall, by the bell tower … */
const STASH_PREFABS: ReadonlySet<PrefabId> = new Set<PrefabId>(["danfo", "kiosk", "wreck", "generator", "busstop", "borehole", "carriage", "okada", "hut", "watertower", "church", "market", "suya", "mechanic", "carpenter", "barber"]);

/**
 * Squad Rally's route: down the middle of Naija World's main roads (the city
 * tour of the dev page): the market, the mosque, the bus park, the church,
 * then west along Market Road to the village, the baobab, the river and the
 * estate, and back. A loop.
 */
export const NAIJA_ROUTE: readonly (readonly [number, number])[] = [
  [60, -90], [0, -90], [0, -150], [120, -150], [120, 75], [60, 75], [60, 145], [120, 145], [120, 0], [-40, 0], [-135, 0],
  [-135, -120], [-135, 0], [-110, 0], [-110, 120], [-110, 0], [0, 0], [0, 75], [-60, 75], [-60, 185], [-60, 75], [60, 75], [60, 0],
];

/** Parts of a world a mode can be played on ("naija-world:market"): a circle. */
const ARENAS: Record<string, { x: number; z: number; r: number }> = {
  market: { x: 30, z: -40, r: 80 },
};

export function matchWorldOf(layout: OpenLayout, space: Space, map = layout.id): MatchWorld {
  const part = map.includes(":") ? map.slice(map.indexOf(":") + 1) : "";
  const arena = ARENAS[part];
  const inArena = (x: number, z: number, k = 1) => !arena || Math.hypot(x - arena.x, z - arena.z) <= arena.r * k;
  const places = [...layout.landmarks.map((l) => ({ x: l.x, z: l.z, r: 18 })), ...layout.areas.map((a) => ({ x: a.x, z: a.z, r: a.r }))].filter((p) => inArena(p.x, p.z));
  const stash = layout.placements.filter((p) => STASH_PREFABS.has(p.prefab) && inArena(p.x, p.z, 0.9)).map((p) => ({ x: p.x, z: p.z, h: 0 }));
  // The starts: the city's own, those inside the arena first (a world's first start seeds its walk grid).
  let spawns = layout.spawns.filter(([x, z]) => inArena(x, z, 0.85));
  if (arena && spawns.length < 4) spawns = [...spawns, ...layout.spawns.filter(([x, z]) => !inArena(x, z, 0.85)).sort((a, b) => Math.hypot(a[0] - arena.x, a[1] - arena.z) - Math.hypot(b[0] - arena.x, b[1] - arena.z)).slice(0, 4 - spawns.length)];
  return { space, spawns, places, stash, route: NAIJA_ROUTE, ...(arena ? { arena } : {}) };
}
