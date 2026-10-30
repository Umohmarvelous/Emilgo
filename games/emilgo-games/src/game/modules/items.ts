// Items and the backpack (SPEC-V3 §3.3, §7, §10): a seeded scatter that
// changes every match, a 10-slot backpack, using and dropping from it, and the
// loot bag a body leaves where it dies.
//
//   Scatter   LOOT.perHectare × density items over the world, a little over
//             half at the named places, the rest anywhere you can walk; never
//             closer than LOOT.spacing, only on open, reachable ground, from
//             the mode's table (only items whose effect is built).
//   Pick up   an interact tap within LOOT.reach: the nearest item or loot bag.
//             A full backpack says so and leaves it.
//   Use       from the backpack: its effect, then the slot is empty.
//   Drop      from the backpack: on the ground in front of you.
//   Death     the backpack drops as a loot bag (it glows LOOT.bagGlow s on
//             phones); you come back with an empty one.

import { LOOT } from "../../config";
import { builtLoot, ITEM_DEFS, type ItemId, type LootTable } from "../../content/items";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import type { GadgetsModule } from "./gadgets";
import type { TagModule } from "./tag";
import type { VehiclesModule } from "./vehicles";

export interface GroundItem {
  readonly index: number;
  readonly kind: ItemId;
  readonly x: number;
  readonly z: number;
  /** The floor it lies on. */
  readonly h: number;
  taken: boolean;
}

export interface LootBag {
  readonly index: number;
  /** Whose it was. */
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly h: number;
  /** Seconds of play when it was dropped. */
  readonly at: number;
  kinds: ItemId[];
}

export type Pack = (ItemId | null)[];

/** What an interact tap would take now. */
export type Target = { item: GroundItem; bag?: undefined } | { bag: LootBag; item?: undefined };

export class ItemsModule implements RuleModule {
  readonly id = "items" as const;
  readonly items: GroundItem[] = [];
  readonly bags: LootBag[] = [];
  packs: Pack[] = [];
  readonly table: string;
  readonly density: number;

  constructor(params: Record<string, unknown>) {
    this.table = typeof params.table === "string" ? params.table : "ffa-core";
    this.density = typeof params.density === "number" ? params.density : 1;
  }

  init(m: Match): void {
    this.packs = m.contestants.map(() => new Array<ItemId | null>(LOOT.slots).fill(null));
    this.scatter(m);
  }

  private scatter(m: Match): void {
    const loot = builtLoot(this.table, (id) => m.module(id) !== null);
    if (!loot.length || this.density <= 0) return;
    const rng = m.rng("items");
    const reach = m.reach;
    if (!reach.open.length) return;
    const b = m.world.space.bounds;
    const count = Math.round((LOOT.perHectare * (b.x1 - b.x0) * (b.z1 - b.z0) * this.density) / 10000);
    const places = m.world.places;
    const sp2 = LOOT.spacing * LOOT.spacing;
    for (let n = 0; n < count; n++) {
      const atPlace = places.length > 0 && rng.chance(LOOT.atPlaces);
      let spot: [number, number, number] | null = null;
      for (let t = 0; t < 12 && !spot; t++) {
        let cell: number;
        if (atPlace) {
          const p = places[rng.int(0, places.length - 1)];
          const a = rng.range(0, Math.PI * 2);
          const d = Math.sqrt(rng.next()) * (p.r + 8);
          cell = reach.cell(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d);
          if (cell < 0 || !reach.ground[cell]) continue;
        } else cell = reach.open[rng.int(0, reach.open.length - 1)];
        const [cx, cz] = reach.centre(cell);
        const x = cx + rng.range(-0.4, 0.4);
        const z = cz + rng.range(-0.4, 0.4);
        if (this.items.some((it) => (it.x - x) ** 2 + (it.z - z) ** 2 < sp2)) continue;
        spot = [x, z, reach.h[cell]];
      }
      if (!spot) continue;
      this.items.push({ index: this.items.length, kind: pick(loot, rng.next()), x: spot[0], z: spot[1], h: spot[2], taken: false });
    }
  }

  step(m: Match): void {
    for (const c of m.contestants) {
      const act = m.takePackAct(c);
      if (c.status !== "alive") continue;
      if (act >= 0) this.packAct(m, c, act);
    }
  }

  /** An interact tap's candidate: the nearest item or loot bag (the core picks between modules). */
  reachFor(m: Match, c: Contestant): { d: number; take: () => void } | null {
    const t = this.target(c);
    if (!t) return null;
    const p = t.item ?? t.bag;
    return { d: Math.hypot(p.x - c.x, p.z - c.z), take: () => this.interact(m, c) };
  }

  onEvent(m: Match, e: MatchEvent): void {
    if (e.type === "eliminated") {
      const c = m.get(e.id);
      if (!c) return;
      const kinds = this.packs[c.index].filter((k): k is ItemId => k !== null);
      this.packs[c.index] = new Array<ItemId | null>(LOOT.slots).fill(null);
      if (!kinds.length) return;
      const bag: LootBag = { index: this.bags.length, id: c.id, x: e.x, z: e.z, h: e.h, at: m.elapsed, kinds };
      this.bags.push(bag);
      m.emit({ type: "bag", bag: bag.index, id: c.id, x: bag.x, z: bag.z, h: bag.h, kinds: kinds.slice() });
    } else if (e.type === "respawn") {
      const c = m.get(e.id);
      if (c) this.packs[c.index] = new Array<ItemId | null>(LOOT.slots).fill(null);
    }
  }

  /** The nearest item or loot bag c could take now (the UI's prompt, and a tap's choice). */
  target(c: Contestant): Target | null {
    const feet = c.h + c.y;
    let best: Target | null = null;
    let bestD: number = LOOT.reach;
    for (const it of this.items) {
      if (it.taken || Math.abs(it.h - feet) > LOOT.reachUp) continue;
      const d = Math.hypot(it.x - c.x, it.z - c.z);
      if (d <= bestD) {
        bestD = d;
        best = { item: it };
      }
    }
    for (const bag of this.bags) {
      if (!bag.kinds.length || Math.abs(bag.h - feet) > LOOT.reachUp) continue;
      const d = Math.hypot(bag.x - c.x, bag.z - c.z);
      if (d <= bestD) {
        bestD = d;
        best = { bag };
      }
    }
    return best;
  }

  private interact(m: Match, c: Contestant): void {
    const t = this.target(c);
    if (!t) return;
    const pack = this.packs[c.index];
    if (t.item) {
      const slot = pack.indexOf(null);
      if (slot < 0) {
        m.emit({ type: "full", id: c.id });
        return;
      }
      pack[slot] = t.item.kind;
      t.item.taken = true;
      m.emit({ type: "take", id: c.id, item: t.item.index, kind: t.item.kind, slot });
      return;
    }
    const bag = t.bag;
    const took: ItemId[] = [];
    while (bag.kinds.length) {
      const slot = pack.indexOf(null);
      if (slot < 0) break;
      pack[slot] = bag.kinds.shift()!;
      took.push(pack[slot]!);
    }
    if (!took.length) m.emit({ type: "full", id: c.id });
    else m.emit({ type: "loot", id: c.id, bag: bag.index, kinds: took, left: bag.kinds.length });
  }

  private packAct(m: Match, c: Contestant, act: number): void {
    const pack = this.packs[c.index];
    const slot = act & 15;
    const kind = pack[slot];
    if (!kind) return;
    if (act & 16) {
      // Dropped in front of you, or at your feet when that's somewhere you couldn't reach.
      pack[slot] = null;
      let x = c.x + Math.sin(c.heading) * 0.8;
      let z = c.z + Math.cos(c.heading) * 0.8;
      if (!m.reach.at(x, z)) {
        x = c.x;
        z = c.z;
      }
      this.add(m, kind, x, z, c.h, c.id, slot);
      return;
    }
    const fx = ITEM_DEFS[kind].effect;
    if (!fx) return;
    // Chase & Reverse: the Ojuju can't use items.
    if (m.module<TagModule>("tag")?.isOjuju(c.index)) return;
    switch (fx.kind) {
      case "speed":
        m.setEffect(c, "speed", fx.s, fx.mult);
        break;
      case "shield":
        m.setEffect(c, "shield", fx.s);
        break;
      case "slots":
        // One Big Bag a life: a second stays in the pack.
        if (pack.length >= LOOT.slots + fx.add) return;
        for (let i = 0; i < fx.add; i++) pack.push(null);
        break;
      case "exposure":
        // The zone takes it off the meter when it hears the "use".
        break;
      case "pepper":
      case "iron":
        m.setEffect(c, fx.kind, fx.s);
        break;
      case "throw":
        // Melee throws it when it hears the "use"; not while knocked down or held.
        if (c.stun > 0 || m.seated(c)) return;
        break;
      case "fuel":
        // Vehicles fill the car when they hear the "use": only with a car to fill.
        if (!m.module<VehiclesModule>("vehicles")?.fuelTarget(m, c)) return;
        break;
      case "call":
        if (!m.module<VehiclesModule>("vehicles")?.canCall(m, c)) return;
        break;
      case "gadget":
        // The §10 items: gadgets.ts does it when it hears the "use" (if it can be done now).
        if (!m.module<GadgetsModule>("gadgets")?.can(m, c, kind)) return;
        break;
    }
    pack[slot] = null;
    m.emit({ type: "use", id: c.id, kind, slot });
  }

  /** Put an item on the ground (a drop from slot `slot`, a crate's overflow). */
  add(m: Match, kind: ItemId, x: number, z: number, h: number, by: string | null, slot = -1): GroundItem {
    const it: GroundItem = { index: this.items.length, kind, x, z, h, taken: false };
    this.items.push(it);
    m.emit({ type: "drop", id: by, item: it.index, kind, x, z, h, ...(slot >= 0 ? { slot } : {}) });
    return it;
  }

  /** The online client's copy: the server's events, applied. */
  apply(m: Match, e: MatchEvent): void {
    const c = "id" in e && e.id ? m.get(e.id) : undefined;
    const pack = c ? this.packs[c.index] : null;
    switch (e.type) {
      case "take":
        if (e.item >= 0 && this.items[e.item]) this.items[e.item].taken = true;
        if (pack) {
          while (pack.length <= e.slot) pack.push(null);
          pack[e.slot] = e.kind;
        }
        break;
      case "drop":
        if (!this.items[e.item]) this.items[e.item] = { index: e.item, kind: e.kind, x: e.x, z: e.z, h: e.h, taken: false };
        if (pack && e.slot !== undefined && pack[e.slot] === e.kind) pack[e.slot] = null;
        break;
      case "use": {
        if (!pack || !c) break;
        pack[e.slot] = null;
        const fx = ITEM_DEFS[e.kind].effect;
        if (fx?.kind === "slots") for (let i = 0; i < fx.add; i++) pack.push(null);
        else if (fx?.kind === "speed") m.setEffect(c, "speed", fx.s, fx.mult);
        else if (fx?.kind === "shield" || fx?.kind === "pepper" || fx?.kind === "iron") m.setEffect(c, fx.kind, fx.s);
        break;
      }
      case "bag":
        this.bags[e.bag] = { index: e.bag, id: e.id, x: e.x, z: e.z, h: e.h, at: m.elapsed, kinds: e.kinds.slice() };
        if (pack) pack.fill(null);
        break;
      case "loot": {
        const bag = this.bags[e.bag];
        if (bag) for (const k of e.kinds) bag.kinds.splice(bag.kinds.indexOf(k), 1);
        if (pack) for (const k of e.kinds) {
          const slot = pack.indexOf(null);
          if (slot >= 0) pack[slot] = k;
        }
        break;
      }
      case "eliminated":
      case "respawn":
        if (c && e.type === "respawn") this.packs[c.index] = new Array<ItemId | null>(LOOT.slots).fill(null);
        break;
    }
  }

  /** Straight into c's backpack (a crate): what doesn't fit lands round them. */
  give(m: Match, c: Contestant, kinds: readonly ItemId[]): void {
    const pack = this.packs[c.index];
    let spill = 0;
    for (const kind of kinds) {
      const slot = pack.indexOf(null);
      if (slot >= 0) {
        pack[slot] = kind;
        m.emit({ type: "take", id: c.id, item: -1, kind, slot });
        continue;
      }
      const a = c.heading + Math.PI + (spill++ - 1) * 0.7;
      let x = c.x + Math.sin(a) * 1.1;
      let z = c.z + Math.cos(a) * 1.1;
      if (!m.reach.at(x, z)) {
        x = c.x;
        z = c.z;
      }
      this.add(m, kind, x, z, c.h, null);
    }
  }

  /** c already carries one of `kind` (the compass leaves that kind out). */
  carries(i: number, kind: ItemId): boolean {
    return this.packs[i]?.includes(kind) ?? false;
  }
}

/** A weighted pick from a table, with u uniform in [0, 1). */
export function pick(table: LootTable, u: number): ItemId {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = u * total;
  for (const [id, w] of table) {
    r -= w;
    if (r < 0) return id;
  }
  return table[table.length - 1][0];
}
