// The open worlds' texture atlases, laid out (v6 max, 3.4: shared by build.ts, which composes them in the
// browser, and tools/assets/atlases.ts, which bakes them to KTX2 ahead of time; both must agree).
//
//   walls   4 × 2 tiles in TEX_KINDS order (art.ts): plaster, concrete, brick, wood, mud, zinc, glass, thatch
//   ground  4 × 2 tiles in GROUND_KINDS order (build.ts), the eighth spare

import type { TexName } from "../../assets/library";

/** The wall atlas's eight tiles as library textures (TEX_KINDS order), day and night. */
export const WALL_LIB: Record<"day" | "night", (TexName | null)[]> = {
  // plaster, concrete, brick, wood, mud (now render), zinc (now steel sheet), glass (a tower's facade), thatch (now roof tiles)
  day: ["plaster", "concrete", "brick", "planks", "paintedConcrete", "corrugated", "glassTower", "roofTiles"],
  night: ["plaster", "concrete", "brick", "planks", "paintedConcrete", "rustSheet", "nightOffice", "roofTiles"],
};

/** The ground atlas's textures (GROUND_KINDS order: asphalt, laterite, paving, grass, earth, sand, snow). */
export const GROUND_LIB: Record<"day" | "night", TexName[]> = {
  day: ["asphalt", "gravel", "paving", "grass", "dirt", "sand", "snow"],
  night: ["roadDamaged", "gravel", "paving", "grassSparse", "mud", "sand", "snow"],
};

/** The ground atlas's empty eighth tile, and the flat normal. */
export const GROUND_FILL = "#7a766e";
export const NORMAL_FILL = "rgb(128,128,255)";
