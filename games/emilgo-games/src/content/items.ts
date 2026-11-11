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
  | "golden-slipper" | "zone-shield" | "jerrycan" | "danfo-key"
  | "zanku" | "shaku" | "odogwu" | "breakdance"
  | "bandage" | "medkit" | "ammo" | "armour" | "battery" | "nv"
  | "titan-serum" | "map-print"
  // v6 max (3.2): the boosters, taken the moment you touch them.
  | "strength-booster" | "speed-booster";

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
  | { kind: "throw"; back: boolean }
  /** Vehicles (Phase 5): fuel for the car you're in or beside; a danfo called to the nearest road. */
  | { kind: "fuel" }
  | { kind: "call" }
  /** The §10 items (Phase 6): what each does is in modules/gadgets.ts. */
  | { kind: "gadget" }
  /** Dead Streets' (Phase 7): what each does is in modules/survival.ts. */
  | { kind: "survival" }
  /** v5: one level of growth (config GROWTH): less damage taken, a fiercer look. */
  | { kind: "grow" }
  /** v5: the whole map, live, for `s` seconds; once a match. */
  | { kind: "print"; s: number }
  /** v6 max (3.2): a booster: strength (more damage) or speed (much faster), for `s` seconds (config POWER). */
  | { kind: "power"; power: "strength" | "speed"; s: number };

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
  /** How to beat it (SPEC-V3 §10.1: "every item has a counter"), shown on its first use. */
  counter?: Text;
  /** v6 max: used the moment it's picked up (the boosters), never carried. */
  instant?: boolean;
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
  kola: def("kola", "Adrenaline Shot", "Adrenaline Shot", "+15% speed for 10 s", "+15% speed for 10 seconds", { kind: "speed", mult: 1.15, s: 10 }),
  zobo: def("zobo", "Field Flask", "Field Bottle", "Takes 40% off your exposure", "E go remove 40% from your exposure", { kind: "exposure", take: 0.4 }),
  "big-bag": def("big-bag", "Big Bag", "Big Bag", "+2 backpack slots", "+2 space for your bag", { kind: "slots", add: 2 }),
  "zone-shield": def("zone-shield", "Zone Shield", "Zone Shield", "The sky can't see you for 30 s", "Sky no fit see you for 30 seconds", { kind: "shield", s: 30 }, true),
  // Melee's (Phase 4).
  "pepper-soup": def("pepper-soup", "Hot Ration", "Hot Ration", "+20% knockback for 15 s", "+20% push for 15 seconds", { kind: "pepper", s: 15 }, false, "melee"),
  "iron-wrapper": def("iron-wrapper", "Iron Guard", "Iron Guard", "Brace without slowing for 10 s", "Brace and no slow down for 10 seconds", { kind: "iron", s: 10 }, false, "melee"),
  slipper: def("slipper", "Throwing Boot", "Throwing Boot", "A thrown stun", "Throw am, e go stun", { kind: "throw", back: false }, false, "melee"),
  "golden-slipper": def("golden-slipper", "Golden Boot", "Golden Boot", "A thrown stun that comes back", "Throw am, e go stun, e go come back", { kind: "throw", back: true }, true, "melee"),
  // The FFA extras (Phase 6), vehicles (Phase 5).
  // The FFA extras (Phase 6: modules/gadgets.ts).
  "smoke-pot": { ...def("smoke-pot", "Smoke Canister", "Smoke Canister", "A cloud for 12 s: nobody sees in or out, not auto-shoot, not a scanner", "Smoke for 12 seconds: nobody fit see inside, auto-shoot and scanner no go see you", { kind: "gadget" }), counter: { en: "Walk out of the cloud", pcm: "Waka comot from the smoke" } },
  "banana-peel": { ...def("banana-peel", "Banana Peel", "Banana Peel", "Dropped behind you: trips whoever runs over it", "Drop am for your back: who run pass am go fall", { kind: "gadget" }, false, "melee"), counter: { en: "Walk or crouch past it, or jump it", pcm: "Waka slow or bend pass am, or jump am" } },
  "pepper-powder": { ...def("pepper-powder", "Pepper Spray", "Pepper Spray", "A sneeze stagger in a cone in front", "E go make dem sneeze shake for your front", { kind: "gadget" }, false, "melee"), counter: { en: "Brace, or stay behind them", pcm: "Brace, or stay for their back" } },
  megaphone: { ...def("megaphone", "Megaphone", "Megaphone", "A push wave all round, after a slow wind-up", "Push wave for everywhere, e dey take time", { kind: "gadget" }, false, "melee"), counter: { en: "Hit them while it winds up", pcm: "Hit dem before e ready" } },
  // v6 max: the decoy and the disguise work in every mode (Treasure Hunt first); the scanner finds everyone in range.
  "decoy-flag": { ...def("decoy-flag", "Decoy Flag", "Fake Flag", "A trap at your feet: a fake flag (a fake chest in Treasure Hunt). Whoever springs it is stunned 2 s and marked for you 8 s", "Trap for your leg: fake flag (fake box for Treasure Hunt). Who touch am go hang 2 seconds, and you go see am 8 seconds", { kind: "gadget" }), counter: { en: "A decoy isn't on the compass, and a real chest never glows pink", pcm: "Fake one no dey for compass" } },
  "talking-drum": { ...def("talking-drum", "Pulse Scanner", "Pulse Scanner", "A sweep: every rival within 160 m shows for 6 s", "E go sweep: every enemy wey dey inside 160 m go show for 6 seconds", { kind: "gadget" }), counter: { en: "Hide in smoke, camouflage, or drive fast", pcm: "Hide for smoke, wear camo, or drive fast" } },
  "aso-ebi": { ...def("aso-ebi", "Squad Disguise", "Squad Disguise", "20 s in a rival squad's colour (they see a mate; auto-shoot spares you). Solo: camouflage, off every sensor", "20 seconds for another squad colour (dem go think say na their person). Solo: camo, no sensor go see you", { kind: "gadget" }), counter: { en: "It ends the moment you shoot or swing", pcm: "E go end once you shoot or attack" } },
  // Power-emote cards (§10.2): a dance with an effect, never free.
  zanku: { ...def("zanku", "Wobble Bait", "Wobble Bait", "Dance: rivals near who watch you wobble 20% more for 3 s; you can't move", "Dance: who dey look you go shake 20% more for 3 seconds; you no fit waka", { kind: "gadget" }, false, "melee"), counter: { en: "Don't look: turn away, or hit them from behind", pcm: "No look am: turn your back, or hit am from back" } },
  shaku: { ...def("shaku", "Shuffle Shield", "Shuffle Shield", "2 s nobody can knock you back, then 2 s slow", "2 seconds nobody fit push you, then 2 seconds slow", { kind: "gadget" }, false, "melee"), counter: { en: "Wait it out, then hit them while they're slow", pcm: "Wait make e finish, then hit dem as dem slow" } },
  odogwu: { ...def("odogwu", "Hero Pose", "Hero Pose", "At an objective: +10% for your squad for 4 s; you're rooted", "For objective: +10% for your squad for 4 seconds; you no fit move", { kind: "gadget" }, false, "melee"), counter: { en: "A posing body can't move: push them off it", pcm: "Person wey dey pose no fit move: push am comot" } },
  breakdance: { ...def("breakdance", "Breakdance Sweep", "Breakdance Sweep", "Trips everyone round you; you're Dazed after", "E go trip everybody round you; you go hang after", { kind: "gadget" }, false, "melee"), counter: { en: "Jump it, brace, or stand back and hit them after", pcm: "Jump am, brace, or stand far then hit dem after" } },
  // Dead Streets' (Phase 7: modules/survival.ts).
  bandage: def("bandage", "Bandage", "Bandage", "+25 health", "+25 health", { kind: "survival" }, false, "survival"),
  medkit: def("medkit", "First-aid Kit", "First-aid Box", "+60 health", "+60 health", { kind: "survival" }, false, "survival"),
  ammo: def("ammo", "Ammo Box", "Bullet Box", "+12 rounds", "+12 bullets", { kind: "survival" }, false, "survival"),
  armour: def("armour", "Armour Plates", "Armour Plates", "+50 armour: takes half of every hit", "+50 armour: e go take half of every hit", { kind: "survival" }, false, "survival"),
  battery: def("battery", "Battery", "Battery", "Fills your torch", "E go full your torch", { kind: "survival" }, false, "survival"),
  nv: def("nv", "Night Vision", "Night Vision", "See in the dark for 60 s", "See for dark for 60 seconds", { kind: "survival" }, false, "survival"),
  // v5 (3.2): growth, and the Map Print.
  "titan-serum": { ...def("titan-serum", "Titan Serum", "Titan Serum", "Grow one level (to 3): you take less damage and look fiercer. Lost when you go down", "Grow one level (reach 3): bullet no go do you like before, you go look strong. E go go when you fall", { kind: "grow" }), counter: { en: "Shoot them more, or knock them down: they lose it all", pcm: "Shoot dem more, or knock dem down: everything go comot" } },
  "map-print": { ...def("map-print", "Map Print", "Map Print", "The whole map for 20 s: everyone and everything hidden, live. Once a match", "The whole map for 20 seconds: everybody and everything wey hide, live. Once for one match", { kind: "print", s: 20 }, true), counter: { en: "Keep moving: it shows where you are, not where you'll be", pcm: "Dey move: e dey show where you dey now, no be where you go reach" } },
  // v6 max (3.2): the boosters: walked into, they transform you at once (the pose, the camera round you, the aura).
  "strength-booster": { ...def("strength-booster", "Strength Booster", "Strength Booster", "Taken at once: 25 s of power. Your guns hit 35% harder, your blows 50%; heavy steps", "E go work sharp sharp: 25 seconds of power. Your gun go hit 35% harder, your hand 50%", { kind: "power", power: "strength", s: 25 }), instant: true, counter: { en: "Keep your distance: their speed is the same, and the fire shows where they are", pcm: "Stay far: dem no fast pass before, and the fire dey show where dem dey" } },
  "speed-booster": { ...def("speed-booster", "Speed Booster", "Speed Booster", "Taken at once: 20 s much faster, sprinting twice as long", "E go work sharp sharp: 20 seconds you go fast well well, sprint go last double", { kind: "power", power: "speed", s: 20 }), instant: true, counter: { en: "Lead your shots: the sparks show where they're going", pcm: "Shoot for front of dem: the spark dey show where dem dey go" } },
  // Vehicles' (Phase 5).
  jerrycan: def("jerrycan", "Fuel Jerrycan", "Fuel Jerrycan", "+15 s of fuel for the car you're in or beside", "+15 seconds fuel for the motor wey you dey inside or near", { kind: "fuel" }, true, "vehicles"),
  "danfo-key": def("danfo-key", "Van Key", "Van Key", "Calls a minibus to the road nearby", "E go call minibus come the road wey near", { kind: "call" }, true, "vehicles"),
};

/** A loot table: items and their weights. */
export type LootTable = readonly (readonly [ItemId, number])[];

export const LOOT_TABLES: Record<string, LootTable> = {
  // v5: the old items are out of the loot (the owner: "remove old items like the pepper soup"): Hot Ration, Iron Guard,
  // Banana Peel, Pepper Spray, Megaphone, the Throwing and Golden Boots and the four dance cards.
  // v6 (the owner: "leave only these items"): Smoke Canister, Decoy Flag, Pulse Scanner, Squad Disguise, with v5's
  // Titan Serum and Map Print. Out: Adrenaline Shot, Field Flask, Big Bag, Zone Shield, Fuel Jerrycan, Van Key.
  // Their rules stay in the code, unused (a mode could still name them in its own table).
  // v6 max: the two boosters join (3.2).
  // v7 (the owner: "Remove the smoke canister item"): out of both tables; its rule and look stay in the code, unused.
  "ffa-core": [["decoy-flag", 1.2], ["talking-drum", 2.4], ["aso-ebi", 1.6], ["titan-serum", 2], ["map-print", 0.5], ["strength-booster", 1.1], ["speed-booster", 1.3]],
  airfall: [["titan-serum", 1.4], ["map-print", 1], ["talking-drum", 0.5], ["strength-booster", 0.9], ["speed-booster", 0.9]],
  "ds-core": [["bandage", 5], ["medkit", 1.5], ["ammo", 6], ["armour", 1.2], ["battery", 3], ["nv", 0.8]],
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
