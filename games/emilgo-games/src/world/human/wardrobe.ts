// What a person can look like.
//
// Players are the scanned people (scanbody.ts): a real head, hands and feet
// in a hoodie and joggers. The hoodie is the only clothing there is — in the
// lobby, the waiting room and on the field (it replaced the outfits and the
// numbered match suit) — and players choose only its colour and design, and
// which body. The fields below the hoodie (skin, hair, outfit, extras) still
// dress the generated people: Mama, and everyone if the scans can't load.
//
// Outfits and hair are drawn from the reference photos in UPGRADE.md (the
// Ankara patch dress, the office blouse and pencil skirt, the striped bodycon,
// the weekend sweater, the cami and mom jeans, the beach stripe tank) plus a
// tactical "hero suit" for the welcome art. Every pattern is generated — no
// image files — and no real brand appears on any garment.
//
// Free items are free for everyone, everywhere. Shop items (the Gold and
// Midnight hoodies, the Ankara design; product ids outfit_gold, outfit_midnight,
// outfit_ankara from when they were outfits) are worn only by owners: the game
// server strips them from anyone who can't prove ownership.

import type { Rng } from "../../core/rng";

export type Body = "m" | "f";

export const SKIN_TONES = ["#3b2214", "#4a2912", "#5a3214", "#6b3e1f", "#7a4a26", "#8d5524", "#a0662f", "#c68642"] as const;
export const HAIR_COLORS = ["#141110", "#2b1d16", "#4a2f22", "#6b4430", "#b07a4f", "#d8b26e", "#8a1f2b", "#e9e4dc"] as const;

export type HairId = "afro" | "bun" | "lowcut" | "ponytail" | "braids" | "locs" | "fade" | "bald" | "pigtails";

export interface HairDef {
  id: HairId;
  name: string;
}

export const HAIRS: HairDef[] = [
  { id: "lowcut", name: "Low cut" },
  { id: "afro", name: "Afro" },
  { id: "bun", name: "Bun" },
  { id: "ponytail", name: "Sleek ponytail" },
  { id: "braids", name: "Box braids" },
  { id: "locs", name: "Short locs" },
  { id: "fade", name: "High-top fade" },
  { id: "bald", name: "Clean shave" },
];

export type ExtraId = "fila" | "gele" | "shades" | "glasses" | "headset" | "earrings" | "watch";

export interface ExtraDef {
  id: ExtraId;
  name: string;
  /** Shop product that unlocks it, if any. */
  product?: string;
  /** Head slot: only one of these at a time. */
  head?: boolean;
  /** Face slot. */
  face?: boolean;
}

export const EXTRAS: ExtraDef[] = [
  { id: "shades", name: "Shades", face: true },
  { id: "glasses", name: "Glasses", face: true },
  { id: "headset", name: "Headset", head: true },
  { id: "gele", name: "Gele", head: true },
  { id: "fila", name: "Fila cap", head: true, product: "cap_fila" },
  { id: "earrings", name: "Gold hoops" },
  { id: "watch", name: "Wristwatch" },
];
export const EXTRA_BY_ID = Object.fromEntries(EXTRAS.map((e) => [e.id, e])) as Record<ExtraId, ExtraDef>;

// ── Outfits ───────────────────────────────────────────────────────────────────

export type Pattern =
  | { kind: "plain"; color: string }
  | { kind: "stripes"; colors: string[]; width: number }
  | { kind: "ankara"; colors: string[]; motif: "circles" | "leaves" | "diamonds" | "waves" }
  | { kind: "patchwork"; palettes: string[][] }
  | { kind: "denim"; color: string }
  | { kind: "knit"; color: string }
  | { kind: "camo"; colors: string[] }
  | { kind: "jersey"; color: string; trim: string }
  | { kind: "sheen"; color: string; shine: string };

export interface Top {
  pattern: Pattern;
  sleeve: "none" | "strap" | "short" | "long";
  /** Neckline: crew, v, collar (blouse), scoop. */
  neck: "crew" | "v" | "collar" | "scoop";
  /** Where the top ends: at the waist, or longer (tunic/sweatshirt hem). */
  hem: "waist" | "hip";
  /** Contrast panel at the neckline (the Ankara yoke) and its pattern. */
  yoke?: Pattern;
  /** Bulk added to the torso and arms (sweaters, jackets), metres. */
  bulk?: number;
  /** Cuffs/collar trim colour. */
  trim?: string;
}

export interface Bottom {
  kind: "trousers" | "jeans" | "shorts" | "cargo" | "skirt" | "dress";
  pattern: Pattern;
  /** Hem: knee or ankle for trousers/skirts; thigh for shorts. */
  length: "thigh" | "knee" | "calf" | "ankle";
  /** A contrast band at the hem (the patchwork band on the Ankara dress). */
  band?: Pattern;
  belt?: string;
  /** Skirts and dresses only: how much it flares (0 pencil … 1 a-line). */
  flare?: number;
}

export interface Shoes {
  kind: "sneakers" | "heels" | "boots" | "sandals";
  color: string;
  sole: string;
}

export interface Outfit {
  id: string;
  name: string;
  blurb: string;
  top: Top;
  bottom: Bottom;
  shoes: Shoes;
  /** Tactical vest, gloves, knee pads. */
  gear?: { vest: string; gloves: string; pads?: string };
  /** The colour that stands for this outfit on the HUD track and minimap. */
  accent: string;
  /** Shop product id when it must be bought. */
  product?: string;
  /** Suits which body by default (both can wear anything). */
  fits?: Body;
  /** The match uniform: zip, piping, the player's number. Never chosen in Customise. */
  uniform?: boolean;
  /** The doll's pinafore: a bib and straps over the top (painted on the torso). */
  pinafore?: string;
  /** Knee socks, in this colour. */
  socks?: string;
}

const ANKARA_A = ["#f2a71b", "#0e5a8a", "#d7263d", "#f6f1e1", "#1b998b"];
const ANKARA_B = ["#e85d04", "#370617", "#ffba08", "#0f4c5c", "#fefae0"];
const ANKARA_C = ["#7b2cbf", "#ffd60a", "#2b9348", "#f8f9fa", "#d00000"];
const ANKARA_D = ["#00296b", "#fdc500", "#e63946", "#f1faee", "#2a9d8f"];

export const OUTFITS: Outfit[] = [
  {
    id: "street",
    name: "Street jersey",
    blurb: "The classic green. Free, always.",
    top: { pattern: { kind: "jersey", color: "#0a8a4a", trim: "#f2f2f2" }, sleeve: "short", neck: "v", hem: "hip" },
    bottom: { kind: "trousers", pattern: { kind: "plain", color: "#1f2a44" }, length: "ankle" },
    shoes: { kind: "sneakers", color: "#f4f4f4", sole: "#dcdcdc" },
    accent: "#0a8a4a",
  },
  {
    // IMG_7770: denim shift dress, Ankara yoke and short sleeve cuffs, patchwork hem band.
    id: "patch_dress",
    name: "Ankara patch dress",
    blurb: "Denim shift dress with an Ankara yoke and a patchwork hem.",
    top: { pattern: { kind: "denim", color: "#3d5a8a" }, sleeve: "short", neck: "scoop", hem: "hip", yoke: { kind: "ankara", colors: ANKARA_C, motif: "leaves" }, trim: "#e9b44c" },
    bottom: {
      kind: "dress",
      pattern: { kind: "denim", color: "#3d5a8a" },
      length: "knee",
      band: { kind: "patchwork", palettes: [ANKARA_A, ANKARA_B, ANKARA_C, ANKARA_D] },
      flare: 0.25,
    },
    shoes: { kind: "heels", color: "#efe6d8", sole: "#c9b9a4" },
    accent: "#3d5a8a",
    fits: "f",
  },
  {
    // IMG_7772: sleeveless collared blouse, grey pencil skirt.
    id: "office",
    name: "Office chic",
    blurb: "Pale blue sleeveless blouse and a grey pencil skirt.",
    top: { pattern: { kind: "plain", color: "#b9c4d8" }, sleeve: "none", neck: "collar", hem: "waist" },
    bottom: { kind: "skirt", pattern: { kind: "plain", color: "#5b5d66" }, length: "knee", flare: 0 },
    shoes: { kind: "heels", color: "#f2ede4", sole: "#d8d0c2" },
    accent: "#b9c4d8",
    fits: "f",
  },
  {
    // IMG_7773: sleeveless striped bodycon.
    id: "stripe_dress",
    name: "Stripe bodycon",
    blurb: "Sleeveless, knee-length, bold stripes.",
    top: { pattern: { kind: "stripes", colors: ["#efe9ee", "#5b5873", "#efe9ee", "#a33b3b"], width: 0.045 }, sleeve: "none", neck: "crew", hem: "hip" },
    bottom: { kind: "dress", pattern: { kind: "stripes", colors: ["#efe9ee", "#5b5873", "#efe9ee", "#a33b3b"], width: 0.045 }, length: "knee", flare: 0.05 },
    shoes: { kind: "heels", color: "#1d1a1a", sole: "#111111" },
    accent: "#5b5873",
    fits: "f",
  },
  {
    // IMG_7775: oversized sweatshirt with pockets, slim chinos.
    id: "sweater",
    name: "Weekend sweater",
    blurb: "Oversized dusty pink sweatshirt, slim chinos.",
    top: { pattern: { kind: "knit", color: "#c9a1ab" }, sleeve: "long", neck: "crew", hem: "hip", bulk: 0.018, trim: "#b8909a" },
    bottom: { kind: "trousers", pattern: { kind: "plain", color: "#55708f" }, length: "ankle" },
    shoes: { kind: "sneakers", color: "#f1f1f1", sole: "#e0e0e0" },
    accent: "#c9a1ab",
    fits: "m",
  },
  {
    // IMG_7776: cami top, high-waisted mom jeans with a gold buckle.
    id: "cami_jeans",
    name: "Cami and mom jeans",
    blurb: "Lilac cami, high-waisted jeans, gold buckle.",
    top: { pattern: { kind: "plain", color: "#a7a4d6" }, sleeve: "strap", neck: "scoop", hem: "waist" },
    bottom: { kind: "jeans", pattern: { kind: "denim", color: "#2f4f86" }, length: "ankle", belt: "#c9a227" },
    shoes: { kind: "heels", color: "#1a1a1a", sole: "#111111" },
    accent: "#a7a4d6",
    fits: "f",
  },
  {
    // IMG_7777: striped tank, pale shorts.
    id: "beach",
    name: "Beach stripe",
    blurb: "Striped tank, mint shorts. Bar Beach ready.",
    top: { pattern: { kind: "stripes", colors: ["#efe7e2", "#7d3b45"], width: 0.03 }, sleeve: "none", neck: "scoop", hem: "hip" },
    bottom: { kind: "shorts", pattern: { kind: "plain", color: "#b7dbd4" }, length: "thigh" },
    shoes: { kind: "sneakers", color: "#2b2b30", sole: "#c33d3d" },
    accent: "#7d3b45",
    fits: "m",
  },
  {
    // The welcome art: camo jacket, vest, gloves, cargo trousers, boots.
    id: "hero",
    name: "Hero suit",
    blurb: "Tactical camo, vest, gloves and boots. Main character energy.",
    top: { pattern: { kind: "camo", colors: ["#4a4630", "#2f2c1f", "#5f5a3c", "#1f1d15"] }, sleeve: "long", neck: "collar", hem: "hip", bulk: 0.014, trim: "#1f1d15" },
    bottom: { kind: "cargo", pattern: { kind: "camo", colors: ["#423e2a", "#2a271b", "#565036", "#1a1912"] }, length: "ankle" },
    shoes: { kind: "boots", color: "#2a241d", sole: "#151210" },
    gear: { vest: "#25231f", gloves: "#1b1a18", pads: "#2b2925" },
    accent: "#6b5a3e",
  },
  {
    id: "agbada",
    name: "Sunday agbada",
    blurb: "Flowing white agbada with gold embroidery.",
    top: { pattern: { kind: "sheen", color: "#f4f1ea", shine: "#d4a017" }, sleeve: "long", neck: "crew", hem: "hip", bulk: 0.03, trim: "#d4a017" },
    bottom: { kind: "trousers", pattern: { kind: "plain", color: "#f0ece2" }, length: "ankle" },
    shoes: { kind: "sandals", color: "#5a3a22", sole: "#2e1d10" },
    accent: "#f4f1ea",
    fits: "m",
  },
  // ── Shop (Lagos Life purchases) ──
  {
    id: "outfit_gold",
    name: "Gold Owambe outfit",
    blurb: "Shine like the celebrant. Everyone on the street sees it.",
    top: { pattern: { kind: "sheen", color: "#d4a017", shine: "#fff1b8" }, sleeve: "long", neck: "crew", hem: "hip", bulk: 0.02, trim: "#fff3d6" },
    bottom: { kind: "trousers", pattern: { kind: "plain", color: "#fff3d6" }, length: "ankle" },
    shoes: { kind: "sandals", color: "#c9a227", sole: "#6b5414" },
    accent: "#d4a017",
    product: "outfit_gold",
  },
  {
    id: "outfit_ankara",
    name: "Ankara Orange outfit",
    blurb: "Bright orange Ankara top, deep blue trousers. Loud and proud.",
    top: { pattern: { kind: "ankara", colors: ANKARA_B, motif: "circles" }, sleeve: "short", neck: "crew", hem: "hip" },
    bottom: { kind: "trousers", pattern: { kind: "plain", color: "#1a237e" }, length: "ankle" },
    shoes: { kind: "sneakers", color: "#ff6b35", sole: "#f4f4f4" },
    accent: "#ff6b35",
    product: "outfit_ankara",
  },
  {
    id: "outfit_midnight",
    name: "Midnight outfit",
    blurb: "All black with a purple shine. Mama barely sees you (she does).",
    top: { pattern: { kind: "sheen", color: "#1d1630", shine: "#7b4dff" }, sleeve: "long", neck: "v", hem: "hip", trim: "#7b4dff" },
    bottom: { kind: "trousers", pattern: { kind: "plain", color: "#111111" }, length: "ankle" },
    shoes: { kind: "boots", color: "#141414", sole: "#0a0a0a" },
    accent: "#2a1f4a",
    product: "outfit_midnight",
  },
];

/**
 * The match uniform (SPEC-V2 §1.3): everyone on the field wears the same black
 * tracksuit — white piping, a zip, their number on the chest and the back.
 * Your own outfit shows in the lobby, the waiting room and after the match.
 */
export const UNIFORM: Outfit = {
  id: "uniform",
  name: "Match suit",
  blurb: "The black suit everyone wears on the field.",
  top: { pattern: { kind: "plain", color: "#141417" }, sleeve: "long", neck: "collar", hem: "hip", bulk: 0.006, trim: "#1c1c20" },
  bottom: { kind: "trousers", pattern: { kind: "plain", color: "#141417" }, length: "ankle" },
  shoes: { kind: "sneakers", color: "#f0f0f0", sole: "#1a1a1a" },
  accent: "#e6e6e6",
  uniform: true,
};

/**
 * The doll's clothes (SPEC-V2, the owner's choice: a giant schoolgirl doll in
 * our own green and white — not the show's doll): a white collared shirt
 * under a green pinafore, white knee socks, black shoes.
 */
export const DOLL_DRESS: Outfit = {
  id: "doll_dress",
  name: "Doll's pinafore",
  blurb: "",
  top: { pattern: { kind: "plain", color: "#f4f1ea" }, sleeve: "short", neck: "collar", hem: "waist", trim: "#e8e2d6" },
  bottom: { kind: "dress", pattern: { kind: "plain", color: "#0a8a4a" }, length: "knee", flare: 0.55 },
  shoes: { kind: "sneakers", color: "#151515", sole: "#0b0b0b" },
  accent: "#0a8a4a",
  pinafore: "#0a8a4a",
  socks: "#f4f4f2",
};

export const OUTFIT_BY_ID: Record<string, Outfit> = Object.fromEntries([...OUTFITS, UNIFORM, DOLL_DRESS].map((o) => [o.id, o]));
export const FREE_OUTFITS = OUTFITS.filter((o) => !o.product);

// ── A whole look ──────────────────────────────────────────────────────────────

export interface Look {
  body: Body;
  skin: number;
  hair: HairId;
  hairColor: number;
  outfit: string;
  extras: ExtraId[];
  /** Height multiplier, 0.95–1.05. */
  height: number;
  /** The number on the match uniform (1–99); set by the game, never by a player. */
  num?: number;
  /** The doll's face: big round eyes, rosy cheeks, a small mouth. Never a player's. */
  doll?: boolean;
  /** Hoodie colour (HOODIE_COLORS index) and design: the only clothes there are. */
  hoodie: number;
  design: HoodieDesign;
}

// ── The hoodie (the only clothes: everyone, everywhere) ─────────────────────────

export interface HoodieColor {
  id: string;
  name: string;
  hex: string;
  /** Shop product that unlocks it. */
  product?: string;
  /** A satin sheen over the fleece (the paid colours). */
  satin?: boolean;
}

/** The colours. Indices are saved and sent: only ever add at the end. */
export const HOODIE_COLORS: readonly HoodieColor[] = [
  { id: "sage", name: "Sage", hex: "#7f8f73" },
  { id: "sand", name: "Sand", hex: "#d6c9b9" },
  { id: "black", name: "Black", hex: "#1d1d20" },
  { id: "grey", name: "Heather grey", hex: "#9b9da1" },
  { id: "white", name: "Off-white", hex: "#e9e7e1" },
  { id: "navy", name: "Navy", hex: "#23314f" },
  { id: "green", name: "EMILGO green", hex: "#0a8a4a" },
  { id: "maroon", name: "Maroon", hex: "#6b2533" },
  { id: "mustard", name: "Mustard", hex: "#c79a32" },
  { id: "sky", name: "Sky", hex: "#8db2d6" },
  { id: "rose", name: "Rose", hex: "#d4a3ab" },
  { id: "plum", name: "Plum", hex: "#4a3a72" },
  { id: "gold", name: "Gold", hex: "#d9ab3c", product: "outfit_gold", satin: true },
  { id: "midnight", name: "Midnight", hex: "#1c1733", product: "outfit_midnight", satin: true },
];

export type HoodieDesign = "plain" | "twotone" | "stripe" | "ankara" | "block";
export const HOODIE_DESIGNS: { id: HoodieDesign; name: string; product?: string }[] = [
  { id: "plain", name: "Plain" },
  { id: "twotone", name: "Two-tone" },
  { id: "stripe", name: "Chest stripe" },
  { id: "ankara", name: "Ankara", product: "outfit_ankara" },
  { id: "block", name: "Colour block" },
];
export const DESIGN_BY_ID = Object.fromEntries(HOODIE_DESIGNS.map((d) => [d.id, d])) as Record<HoodieDesign, (typeof HOODIE_DESIGNS)[number]>;
const FREE_HOODIES = HOODIE_COLORS.map((c, i) => (c.product ? -1 : i)).filter((i) => i >= 0);
const GREEN = HOODIE_COLORS.findIndex((c) => c.id === "green");

/**
 * The hoodie for an outfit (a look saved before the hoodie): the shop's three
 * become their hoodies, every other outfit the nearest free colour to its own.
 */
export function hoodieFromOutfit(outfit: string): { hoodie: number; design: HoodieDesign } {
  if (outfit === "outfit_gold") return { hoodie: HOODIE_COLORS.findIndex((c) => c.id === "gold"), design: "plain" };
  if (outfit === "outfit_midnight") return { hoodie: HOODIE_COLORS.findIndex((c) => c.id === "midnight"), design: "plain" };
  const accent = OUTFIT_BY_ID[outfit]?.accent;
  const design: HoodieDesign = outfit === "outfit_ankara" ? "ankara" : "plain";
  if (!accent || outfit === "uniform" || outfit === "doll_dress") return { hoodie: GREEN, design };
  const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const a = rgb(accent);
  let best = GREEN;
  let bd = Infinity;
  for (const i of FREE_HOODIES) {
    const b = rgb(HOODIE_COLORS[i].hex);
    const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { hoodie: best, design };
}

/** A shop product put on: a hoodie colour or the design it unlocks (null: not a hoodie product). */
export function wearProduct(look: Look, product: string): Look | null {
  const c = HOODIE_COLORS.findIndex((x) => x.product === product);
  if (c >= 0) return { ...look, hoodie: c };
  const d = HOODIE_DESIGNS.find((x) => x.product === product);
  return d ? { ...look, design: d.id } : null;
}

/** The doll: brown skin, a black bob with bangs and two pigtails, the pinafore. */
export const DOLL_LOOK: Look = { body: "f", skin: 5, hair: "pigtails", hairColor: 0, outfit: "doll_dress", extras: [], height: 1, doll: true, hoodie: 0, design: "plain" };

export const DEFAULT_LOOK: Look = { body: "m", skin: 4, hair: "lowcut", hairColor: 0, outfit: "street", extras: [], height: 1, hoodie: 6, design: "plain" };

/** Clamp anything (saved settings, the wire) into a valid look. */
export function cleanLook(raw: Partial<Look> | null | undefined, base: Look = DEFAULT_LOOK): Look {
  const r = raw ?? {};
  const body: Body = r.body === "f" ? "f" : r.body === "m" ? "m" : base.body;
  const int = (v: unknown, n: number, d: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : d);
  const hair = HAIRS.some((h) => h.id === r.hair) ? (r.hair as HairId) : base.hair;
  const outfit = typeof r.outfit === "string" && OUTFIT_BY_ID[r.outfit] ? r.outfit : base.outfit;
  const extras: ExtraId[] = [];
  let head = false;
  let face = false;
  for (const e of Array.isArray(r.extras) ? r.extras : base.extras) {
    const d = EXTRA_BY_ID[e as ExtraId];
    if (!d || extras.includes(d.id)) continue;
    if (d.head && head) continue;
    if (d.face && face) continue;
    head ||= !!d.head;
    face ||= !!d.face;
    extras.push(d.id);
  }
  const height = typeof r.height === "number" && r.height >= 0.95 && r.height <= 1.05 ? r.height : base.height;
  const num = Number.isInteger(r.num) && (r.num as number) >= 1 && (r.num as number) <= 99 ? (r.num as number) : undefined;
  // The hoodie: as given, else (a look from before the hoodie) from its outfit, else the base's.
  const old = typeof r.outfit === "string" ? hoodieFromOutfit(outfit) : { hoodie: base.hoodie, design: base.design };
  const hoodie = int(r.hoodie, HOODIE_COLORS.length, old.hoodie);
  const design = typeof r.design === "string" && r.design in DESIGN_BY_ID ? (r.design as HoodieDesign) : old.design;
  return {
    ...(num ? { num } : {}),
    ...(r.doll ? { doll: true } : {}),
    hoodie,
    design,
    body,
    skin: int(r.skin, SKIN_TONES.length, base.skin),
    hair,
    hairColor: int(r.hairColor, HAIR_COLORS.length, base.hairColor),
    outfit,
    extras,
    height,
  };
}

/** Remove anything that must be bought and isn't owned. */
export function ownedOnly(look: Look, owned: ReadonlySet<string>): Look {
  const o = OUTFIT_BY_ID[look.outfit];
  const hc = HOODIE_COLORS[look.hoodie];
  const d = DESIGN_BY_ID[look.design];
  return {
    ...look,
    hoodie: hc?.product && !owned.has(hc.product) ? GREEN : look.hoodie,
    design: d?.product && !owned.has(d.product) ? "plain" : look.design,
    outfit: o?.product && !owned.has(o.product) ? "street" : look.outfit,
    extras: look.extras.filter((e) => !EXTRA_BY_ID[e].product || owned.has(EXTRA_BY_ID[e].product!)),
  };
}

/** A believable stranger (CPU players, crowds). Never a shop item. */
export function randomLook(rng: Rng): Look {
  const body: Body = rng.next() < 0.5 ? "f" : "m";
  const outfits = FREE_OUTFITS.filter((o) => o.id !== "hero" && (!o.fits || o.fits === body || rng.next() < 0.15));
  const hairs: HairId[] = body === "f" ? ["afro", "bun", "ponytail", "braids", "locs", "lowcut"] : ["lowcut", "fade", "locs", "bald", "afro", "lowcut"];
  const extras: ExtraId[] = [];
  const r = rng.next();
  if (r < 0.12) extras.push("shades");
  else if (r < 0.2) extras.push("glasses");
  if (body === "f" && rng.next() < 0.35) extras.push("earrings");
  if (body === "f" && rng.next() < 0.12 && !extras.includes("shades")) extras.push("gele");
  if (rng.next() < 0.25) extras.push("watch");
  const free = HOODIE_DESIGNS.filter((d) => !d.product && d.id !== "plain");
  return cleanLook({
    hoodie: FREE_HOODIES[Math.floor(rng.next() * FREE_HOODIES.length)],
    design: rng.next() < 0.55 ? "plain" : rng.pick(free).id,
    body,
    skin: Math.floor(rng.next() * SKIN_TONES.length),
    hair: rng.pick(hairs),
    hairColor: rng.next() < 0.8 ? Math.floor(rng.next() * 2) : Math.floor(rng.next() * HAIR_COLORS.length),
    outfit: rng.pick(outfits).id,
    extras,
    height: 0.96 + rng.next() * 0.08,
  });
}

/** The same person in the match uniform: own body, skin, hair and height; no accessories. */
/** On the field: their own hoodie with their number on it (generated people: the numbered match suit). */
export function uniformLook(look: Look, num: number): Look {
  return { body: look.body, skin: look.skin, hair: look.hair, hairColor: look.hairColor, outfit: UNIFORM.id, extras: [], height: look.height, num, hoodie: look.hoodie, design: look.design };
}

/** A stable key for caching geometry: only what changes the SHAPE (generated people; index.ts keys the scanned by body and level). */
export function shapeKey(l: Look): string {
  const o = OUTFIT_BY_ID[l.outfit];
  const shapeExtras = l.extras.filter((e) => e !== "watch").sort().join("+");
  return [l.body, l.hair, o.bottom.kind, o.bottom.length, o.bottom.flare ?? 0, o.top.bulk ?? 0, o.shoes.kind, o.gear ? 1 : 0, shapeExtras, l.extras.includes("watch") ? "w" : ""].join("|");
}

/** A scanned person's paint: body, hoodie, number. */
export function scanPaintKey(l: Look): string {
  return ["scan", l.body, l.hoodie, l.design, l.num ?? ""].join("|");
}

/** A stable key for caching textures: everything that changes the PAINT (generated people). */
export function paintKey(l: Look): string {
  return [l.body, l.skin, l.hair, l.hairColor, l.outfit, l.extras.slice().sort().join("+"), l.num ?? "", l.doll ? "doll" : ""].join("|");
}
