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

import { cleanLook, DEFAULT_LOOK, EXTRA_BY_ID, OUTFIT_BY_ID, type ExtraId, type Look } from "../world/human/wardrobe";

export type ProductKind = "outfit" | "cap" | "emotes" | "badge";

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
  { id: "outfit_gold", kind: "outfit", name: "Gold Owambe outfit", blurb: "Shine like the celebrant. Everyone on the street sees it.", price: 500, icon: "outfit" },
  { id: "outfit_ankara", kind: "outfit", name: "Ankara Orange outfit", blurb: "Bright orange Ankara top, deep blue trousers. Loud and proud.", price: 500, icon: "outfit" },
  { id: "outfit_midnight", kind: "outfit", name: "Midnight outfit", blurb: "All black with a purple shine. Mama barely sees you (she does).", price: 500, icon: "outfit" },
  { id: "cap_fila", kind: "cap", name: "Fila cap", blurb: "The classic folded cap. Matches whatever you're wearing.", price: 300, icon: "cap" },
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
  /** Outfit id (free, or a shop product). */
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
  const x = look.extras.filter((e) => !EXTRA_BY_ID[e].product || owned.has(EXTRA_BY_ID[e].product!));
  if (x.length) out.x = x;
  if (want.b && owned.has("badge_gold")) out.b = 1;
  return out;
}

export function toWireLook(look: Look, badge: boolean): WireLook {
  return { o: look.outfit, g: look.body, s: look.skin, h: look.hair, hc: look.hairColor, x: look.extras.length ? look.extras : undefined, ht: Math.round(look.height * 100), b: badge ? 1 : undefined };
}

/** A look from the wire (anything missing → the default). */
export function fromWire(w: WireLook | undefined): Look {
  if (!w) return DEFAULT_LOOK;
  return cleanLook({
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
