// The figurines (v6 max, 3.8; the owner: "more action figurine builds, up to 5
// new figurines for sale in the store, bought with CP; players can preview them
// but cannot use them in game"). Five characters of our own, each a whole build
// on the operator's body: its suit (colour and pattern), its armour (growth's
// robotic pieces, always on, in its own metal and light), and its signature
// (energy lines over the suit, burning eyes, a camouflage shimmer). Anyone can
// try one on in the Store; only an owner plays as it. CP is earned only by
// playing (shop/boosts.ts), so a figurine is earned too.
//
// Ids are kept for ever (saves and the wire carry them); new figurines go last.

import type { Look } from "../world/human/wardrobe";
import { HOODIE_COLORS } from "../world/human/wardrobe";

export interface FigurineDef {
  id: string;
  name: string;
  /** Its role, in two words, and its line in the Store. */
  role: string;
  blurb: string;
  /** Price in CP. */
  cp: number;
  /** The suit: a free colour (HOODIE_COLORS id) and a free pattern, so every phone shows it. */
  hoodie: string;
  design: Look["design"];
  /** Height (0.95–1.05). */
  height: number;
  /** Armour: growth's pieces at this level (1 helmet and caps, 2 full helmet and chest plate, 3 crest and plates). */
  armour: number;
  /** The armour's metal (its plates take this colour) and its light (visors, cores, strips). */
  metal: string;
  glow: string;
  /** Shine: 0 matte … 1 mirror. */
  metalness: number;
  /** The signature on the suit: energy lines (1 fire cracks, 2 crawling electric), how strong; a camouflage shimmer. */
  fx: { kind: 0 | 1 | 2; a: number; camo: number };
}

export const FIGURINES: readonly FigurineDef[] = [
  {
    id: "vanguard", name: "Vanguard", role: "Heavy assault", cp: 1500,
    blurb: "Steel-blue plate from helmet to chest, cyan light in the visor and the reactor. First through the door.",
    hoodie: "navy", design: "plates", height: 1.04, armour: 2, metal: "#7f97b8", glow: "#46e0ff", metalness: 0.6, fx: { kind: 0, a: 0, camo: 0 },
  },
  {
    id: "specter", name: "Specter", role: "Recon", cp: 2000,
    blurb: "A woodland suit that shimmers like heat haze, a dark visor with a green eye. Seen last, if at all.",
    hoodie: "olive", design: "woodland", height: 0.98, armour: 1, metal: "#3a4232", glow: "#7dff6a", metalness: 0.2, fx: { kind: 0, a: 0, camo: 0.6 },
  },
  {
    id: "voltage", name: "Voltage", role: "Runner", cp: 2500,
    blurb: "White chrome caps and electric lines crawling over an arctic suit. You'll hear the crackle before you see it.",
    hoodie: "arctic", design: "stripe", height: 1, armour: 1, metal: "#e8eef4", glow: "#4aa8ff", metalness: 0.75, fx: { kind: 2, a: 0.32, camo: 0 },
  },
  {
    id: "inferno", name: "Inferno", role: "Warlord", cp: 3000,
    blurb: "Charcoal war crest and spiked plates, the suit split by burning cracks, the eyes on fire.",
    hoodie: "black", design: "plates", height: 1.03, armour: 3, metal: "#3a302b", glow: "#ff6a1a", metalness: 0.45, fx: { kind: 1, a: 0.38, camo: 0 },
  },
  {
    id: "sovereign", name: "Sovereign", role: "Champion", cp: 4000,
    blurb: "Polished gold from crest to knee over crimson, a white light in every seam. For those who've won it all.",
    hoodie: "crimson", design: "twotone", height: 1.02, armour: 3, metal: "#f2c14e", glow: "#fff4cc", metalness: 0.85, fx: { kind: 0, a: 0, camo: 0 },
  },
];

export const FIGURINE_BY_ID: Readonly<Record<string, FigurineDef>> = Object.fromEntries(FIGURINES.map((f) => [f.id, f]));

/** A look as the figurine dresses it (its suit and height; the face, skin and hair stay the player's). */
export function figurineLook(look: Look, fig: FigurineDef | null | undefined): Look {
  if (!fig) return look;
  const hoodie = HOODIE_COLORS.findIndex((c) => c.id === fig.hoodie);
  return { ...look, hoodie: hoodie >= 0 ? hoodie : look.hoodie, design: fig.design, height: fig.height };
}

/** A figurine's colours as 0…1 RGB (the effects take numbers). */
export function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Saved figurines, checked: the owned ones (known ids) and the one worn (owned, or none). */
export function cleanFigurines(owned: unknown, worn: unknown): { figs: string[]; fig: string } {
  const figs = Array.isArray(owned) ? [...new Set(owned.filter((f): f is string => typeof f === "string" && !!FIGURINE_BY_ID[f]))] : [];
  return { figs, fig: typeof worn === "string" && figs.includes(worn) ? worn : "" };
}
