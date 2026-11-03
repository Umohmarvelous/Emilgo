// The big world's places as menu art (v4 Phase 9): real shots from the game
// (Max quality, the HUD hidden; 4–21 KB each), the week's "next drop", and
// this week's rotation. Welcome A and Lobby A put the next drop full-bleed
// behind everything (the owner: lobby B's background).

import cityUrl from "./places/city.webp?url";
import dunesUrl from "./places/dunes.webp?url";
import forestUrl from "./places/forest.webp?url";
import harbourUrl from "./places/harbour.webp?url";

export interface PlaceArt {
  id: string;
  name: string;
  line: string;
  url: string;
}

export const PLACE_ART: readonly PlaceArt[] = [
  { id: "harbour", name: "Harbour Yard", line: "Container canyons · cranes · the water", url: harbourUrl },
  { id: "forest", name: "Ironwood Forest", line: "Pines thick round a ranger tower", url: forestUrl },
  { id: "dunes", name: "Dune Sea", line: "Ridges to run over · a plane down", url: dunesUrl },
  { id: "city", name: "Naija City", line: "The market, the bus park, the rooftops", url: cityUrl },
];

/** Weeks since 5 Jan 2026 (a Monday): the same week everywhere. */
export function weekNo(now = Date.now()): number {
  return Math.floor((now - Date.UTC(2026, 0, 5)) / (7 * 86400e3));
}

/** This week's next drop. */
export function nextDrop(now = Date.now()): PlaceArt {
  return PLACE_ART[((weekNo(now) % PLACE_ART.length) + PLACE_ART.length) % PLACE_ART.length];
}

/** The art for a mode's map: the big world shows the week's drop, Naija World the city. */
export function artForMap(map: string, now = Date.now()): PlaceArt {
  return map.startsWith("max-world") ? nextDrop(now) : PLACE_ART[3];
}
