// The items (SPEC-V3 §10.1 and the Airfall loot, §10.3) and the loot tables a
// mode names (`items.table`). Data, shared by the server and the phones.
//
// An item's `effect` is what using it does. An item whose effect needs a
// system that isn't built yet (melee, flags, squads, vehicles) has none: it is
// listed so the tables are complete, but it is never scattered or put in a
// crate until its phase gives it an effect, exactly as a mode stays "Soon"
// until its modules are built.

import type { ModuleId, Text } from "./modes";

export type ItemId =
  | "kola" | "pepper-soup" | "zobo" | "iron-wrapper" | "big-bag" | "smoke-pot" | "banana-peel"
  | "pepper-powder" | "megaphone" | "slipper" | "decoy-flag" | "talking-drum" | "aso-ebi"
  | "golden-slipper" | "zone-shield" | "jerrycan" | "danfo-key";

export type ItemEffect =
  /** Faster for a while: run and sprint × mult. */
  | { kind: "speed"; mult: number; s: number }
  /** Takes `take` (0…1) off your exposure meter at once. */
  | { kind: "exposure"; take: number }
  /** More backpack slots for the rest of this life. */
  | { kind: "slots"; add: number }
  /** No exposure at all for a while: the sky can't see you. */
  | { kind: "shield"; s: number }
  /** Melee (Phase 4): +20% knockback and wobble (Pepper Soup), bracing without slowing (Iron Wrapper). */
  | { kind: "pepper"; s: number }
  | { kind: "iron"; s: number }
  /** Thrown forward: a stun where it lands on someone; `back`: it comes home to your backpack. */
  | { kind: "throw"; back: boolean };

export interface ItemDef {
  id: ItemId;
  name: Text;
  /** One line: what it does. */
  what: Text;
  /** null: not usable yet (its phase isn't built), so it is never handed out. */
  effect: ItemEffect | null;
  /** Airfall loot. */
  rare?: boolean;
  /** Only handed out in modes with this module (melee items need melee). */
  needs?: ModuleId;
}

const def = (id: ItemId, en: string, pcm: string, what: string, whatPcm: string, effect: ItemEffect | null, rare = false, needs?: ModuleId): ItemDef => ({
  id,
  name: { en, pcm },
  what: { en: what, pcm: whatPcm },
  effect,
  rare,
  ...(needs ? { needs } : {}),
});

export const ITEM_DEFS: Record<ItemId, ItemDef> = {
  kola: def("kola", "Kola Rush", "Kola Rush", "+15% speed for 10 s", "+15% speed for 10 seconds", { kind: "speed", mult: 1.15, s: 10 }),
  zobo: def("zobo", "Zobo Flask", "Zobo Bottle", "Takes 40% off your exposure", "E go remove 40% from your exposure", { kind: "exposure", take: 0.4 }),
  "big-bag": def("big-bag", "Big Bag", "Big Bag", "+2 backpack slots", "+2 space for your bag", { kind: "slots", add: 2 }),
  "zone-shield": def("zone-shield", "Zone Shield", "Zone Shield", "The sky can't see you for 30 s", "Sky no fit see you for 30 seconds", { kind: "shield", s: 30 }, true),
  // Melee's (Phase 4).
  "pepper-soup": def("pepper-soup", "Pepper Soup", "Pepper Soup", "+20% knockback for 15 s", "+20% push for 15 seconds", { kind: "pepper", s: 15 }, false, "melee"),
  "iron-wrapper": def("iron-wrapper", "Iron Wrapper", "Iron Wrapper", "Brace without slowing for 10 s", "Brace and no slow down for 10 seconds", { kind: "iron", s: 10 }, false, "melee"),
  slipper: def("slipper", "Flying Slipper", "Flying Slipper", "A thrown stun", "Throw am, e go stun", { kind: "throw", back: false }, false, "melee"),
  "golden-slipper": def("golden-slipper", "Golden Slipper", "Golden Slipper", "A thrown stun that comes back", "Throw am, e go stun, e go come back", { kind: "throw", back: true }, true, "melee"),
  // The FFA extras (Phase 6), vehicles (Phase 5).
  "smoke-pot": def("smoke-pot", "Harmattan Smoke Pot", "Harmattan Smoke Pot", "Breaks line of sight", "E go block people eye", null),
  "banana-peel": def("banana-peel", "Banana Peel", "Banana Peel", "A trip trap", "Trap wey go make person fall", null),
  "pepper-powder": def("pepper-powder", "Pepper Powder", "Pepper Powder", "A sneeze stagger in a cone", "E go make dem sneeze shake", null),
  megaphone: def("megaphone", "Megaphone", "Megaphone", "A push wave, slow wind-up", "Push wave, e dey take time", null),
  "decoy-flag": def("decoy-flag", "Decoy Flag", "Fake Flag", "A flag that isn't", "Flag wey no be flag", null),
  "talking-drum": def("talking-drum", "Talking Drum", "Talking Drum", "Shows the nearest rival for 5 s", "E go show the person wey near pass for 5 seconds", null),
  "aso-ebi": def("aso-ebi", "Aso-ebi Disguise", "Aso-ebi Disguise", "Wear a rival squad's colour for 20 s", "Wear another squad colour for 20 seconds", null),
  jerrycan: def("jerrycan", "Fuel Jerrycan", "Fuel Jerrycan", "Fuel for a car", "Fuel for motor", null, true),
  "danfo-key": def("danfo-key", "Danfo Key", "Danfo Key", "Calls a vehicle to the road nearby", "E go call motor come the road wey near", null, true),
};

/** A loot table: items and their weights. */
export type LootTable = readonly (readonly [ItemId, number])[];

export const LOOT_TABLES: Record<string, LootTable> = {
  "ffa-core": [
    ["kola", 4], ["zobo", 4], ["big-bag", 1.5], ["pepper-soup", 3], ["iron-wrapper", 2], ["smoke-pot", 2], ["banana-peel", 3],
    ["pepper-powder", 2], ["megaphone", 1], ["slipper", 3], ["decoy-flag", 1], ["talking-drum", 1.5], ["aso-ebi", 1],
  ],
  airfall: [["golden-slipper", 1], ["zone-shield", 1], ["jerrycan", 1], ["danfo-key", 1]],
};

/**
 * The table's items that can be handed out in this build (their effect is
 * built), with weights; `has` says which modules the mode runs (an item that
 * needs melee stays out of a mode without it).
 */
export function builtLoot(table: string, has: (id: ModuleId) => boolean = () => true): LootTable {
  return (LOOT_TABLES[table] ?? []).filter(([id]) => {
    const d = ITEM_DEFS[id];
    return d.effect !== null && (!d.needs || has(d.needs));
  });
}

export function isItem(id: unknown): id is ItemId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(ITEM_DEFS, id);
}
