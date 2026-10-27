// The shop: cosmetics only. Nothing here changes how the game plays — no speed,
// no extra grace, no hints — so nobody can buy a win, in a game where players
// can stake game money against each other.
//
// Lagos Life rules (docs, "The purchase flow" + review checklist §05/§06):
//  - Every product is created in the Lagos Life DEVELOPER DASHBOARD with the
//    same id as here. The dashboard's price is the price: players pay what
//    Lagos Life's own sheet shows. The `price` below must be set to match it
//    exactly, or the shop would be showing a dishonest price.
//  - Ids: a–z, 0–9, _ and -, up to 32 characters. Prices: whole naira,
//    ₦100–₦50,000. At most 20 products.
//  - All of these are ONE-OFF products: bought once per player, kept forever.
//    No consumables, no loot boxes, no timers, no "limited time" pressure.
//  - An item is ours to give only after OUR SERVER has checked the purchase
//    with Lagos Life (GET /purchases/{id}), given it once per purchaseId, and
//    marked it delivered. The game's word is never enough.

import { cleanLook, DEFAULT_LOOK, DESIGN_BY_ID, EXTRA_BY_ID, HOODIE_COLORS, OUTFIT_BY_ID, type ExtraId, type HoodieDesign, type Look } from "../world/human/wardrobe";

export type ProductKind = "hoodie" | "emotes" | "badge";

export interface Product {
  id: string;
  kind: ProductKind;
  name: string;
  blurb: string;
  /** Whole naira. MUST equal the price set in the Lagos Life dashboard. */
  price: number;
  /** Shop tile icon (ui/icons.ts). */
  icon: string;
}

export const PRODUCTS: Product[] = [
  // The hoodies (once outfits: the ids stay, so earlier purchases still count).
  { id: "outfit_gold", kind: "hoodie", name: "Gold hoodie", blurb: "A gold satin finish, joggers to match. Shine like the celebrant.", price: 500, icon: "outfit" },
  { id: "outfit_ankara", kind: "hoodie", name: "Ankara hoodie design", blurb: "Ankara print on the hood and the pocket, on any colour you pick.", price: 500, icon: "outfit" },
  { id: "outfit_midnight", kind: "hoodie", name: "Midnight hoodie", blurb: "Near black with a purple shine. Mama barely sees you (she does).", price: 500, icon: "outfit" },
  { id: "emotes_owambe", kind: "emotes", name: "Owambe emote pack", blurb: "Three dance emotes: Zanku, Shaku Shaku and Odogwu.", price: 300, icon: "emote" },
  { id: "badge_gold", kind: "badge", name: "Gold name badge", blurb: "A gold star and a gold frame on your name in every online chat.", price: 200, icon: "star" },
];

export const PRODUCT_BY_ID: Record<string, Product> = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

/**
 * The look sent to others online. Free choices travel as they are; anything
 * that must be bought is kept only if the sender's ticket proves they own it
 * (allowedLook, on the server).
 */
export interface WireLook {
  /** Hoodie colour (HOODIE_COLORS index) and design: what everyone sees. */
  hd?: number;
  ds?: string;
  /** Outfit id (free, or a shop product): the generated people's, and older builds'. */
  o?: string;
  /** Body: "m" | "f". */
  g?: string;
  /** Skin tone index. */
  s?: number;
  /** Hair id and hair colour index. */
  h?: string;
  hc?: number;
  /** Extras (fila, gele, shades…). */
  x?: string[];
  /** Height × 100 (95–105). */
  ht?: number;
  /** Gold name badge. */
  b?: 1;
}

/** Keep only what is valid and, for paid items, owned. Used by the server on everything a phone claims. */
export function allowedLook(want: WireLook | null | undefined, owned: ReadonlySet<string>): WireLook {
  if (!want) return {};
  const look = cleanLook(fromWire(want));
  const out: WireLook = {
    g: look.body,
    s: look.skin,
    h: look.hair,
    hc: look.hairColor,
    ht: Math.round(look.height * 100),
  };
  const o = OUTFIT_BY_ID[look.outfit];
  if (o && (!o.product || owned.has(o.product))) out.o = look.outfit;
  const hc = HOODIE_COLORS[look.hoodie];
  if (hc && (!hc.product || owned.has(hc.product))) out.hd = look.hoodie;
  const d = DESIGN_BY_ID[look.design];
  if (d && (!d.product || owned.has(d.product))) out.ds = look.design;
  const x = look.extras.filter((e) => !EXTRA_BY_ID[e].product || owned.has(EXTRA_BY_ID[e].product!));
  if (x.length) out.x = x;
  if (want.b && owned.has("badge_gold")) out.b = 1;
  return out;
}

export function toWireLook(look: Look, badge: boolean): WireLook {
  return { hd: look.hoodie, ds: look.design, o: look.outfit, g: look.body, s: look.skin, h: look.hair, hc: look.hairColor, x: look.extras.length ? look.extras : undefined, ht: Math.round(look.height * 100), b: badge ? 1 : undefined };
}

/** A look from the wire (anything missing → the default). */
export function fromWire(w: WireLook | undefined): Look {
  if (!w) return DEFAULT_LOOK;
  return cleanLook({
    hoodie: w.hd,
    design: w.ds as HoodieDesign | undefined,
    outfit: w.o,
    body: w.g as Look["body"],
    skin: w.s,
    hair: w.h as Look["hair"],
    hairColor: w.hc,
    extras: Array.isArray(w.x) ? (w.x.filter((e) => typeof e === "string") as ExtraId[]) : [],
    height: typeof w.ht === "number" ? w.ht / 100 : undefined,
  });
}

export const EMOTE_PACK = "emotes_owambe";
