// Items and the backpack (SPEC-V3 §3.3, §7, §10): a seeded scatter that
// changes every match, a 10-slot backpack, using and dropping from it, and the
// loot bag a body leaves where it dies.
//
//   Scatter   LOOT.perHectare × density items over the world, a quarter at
//             the named places (v6), the rest anywhere you can walk; never
//             closer than LOOT.spacing (two of a kind: LOOT.sameKind), only on
//             open, reachable ground, from the mode's table (only items whose
//             effect is built).
//   Pick up   v6 (the owner: "automatically pick ... when they get too close,
//             even walk through them"): walk within LOOT.auto of an item or a
//             loot bag and it's yours, if the backpack has room (no tap; the
//             phones play a pick-up pose). What you drop yourself waits until
//             you've walked away from it. A tap within LOOT.reach still takes
//             the nearest; a full backpack says so and leaves it.
//   Use       from the backpack: its effect, then the slot is empty.
//   Drop      from the backpack: on the ground in front of you.
//   Death     the backpack drops as a loot bag (it glows LOOT.bagGlow s on
//             phones); you come back with an empty one.

import { GROWTH, LOOT, POWER } from "../../config";
import { SpotGrid } from "../core/spotgrid";

/** The items' lookup grid (m). */
const ITEM_CELL = 8;
import { builtLoot, ITEM_DEFS, type ItemId, type LootTable } from "../../content/items";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import type { GadgetsModule } from "./gadgets";
import type { SurvivalModule } from "./survival";
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

  /** A backpack's slots in this match (Dead Streets' Pack Mule and the six-slot charm change it). */
  private size(m: Match): number {
    return m.module<SurvivalModule>("survival")?.slots(LOOT.slots) ?? LOOT.slots;
  }
  readonly bags: LootBag[] = [];
  packs: Pack[] = [];
  /** v5: each body's growth level (Titan Serum, 0 … GROWTH.max), lost on going down; whether they've used their Map Print. */
  growth = new Int8Array(0);
  /** v6: per body, the item it just dropped (not picked straight back up), or −1. */
  private noAuto = new Int32Array(0);
  printed = new Uint8Array(0);
  readonly table: string;
  readonly density: number;

  constructor(params: Record<string, unknown>) {
    this.table = typeof params.table === "string" ? params.table : "ffa-core";
    this.density = typeof params.density === "number" ? params.density : 1;
  }

  init(m: Match): void {
    this.packs = m.contestants.map(() => new Array<ItemId | null>(this.size(m)).fill(null));
    this.growth = new Int8Array(m.contestants.length);
    this.noAuto = new Int32Array(m.contestants.length).fill(-1);
    this.printed = new Uint8Array(m.contestants.length);
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
    const grid = new SpotGrid(Math.max(1, LOOT.spacing));
    // v6: the same kind kept further apart, so one street never holds three of one thing.
    const same2 = LOOT.sameKind * LOOT.sameKind;
    const kinds = new Map<ItemId, SpotGrid>();
    for (let n = 0; n < count; n++) {
      const kind = pick(loot, rng.next());
      let kindGrid = kinds.get(kind);
      if (!kindGrid) kinds.set(kind, (kindGrid = new SpotGrid(LOOT.sameKind)));
      const atPlace = places.length > 0 && rng.chance(LOOT.atPlaces);
      let spot: [number, number, number] | null = null;
      for (let t = 0; t < 12 && !spot; t++) {
        let cell: number;
        if (atPlace) {
          const p = places[rng.int(0, places.length - 1)];
          const a = rng.range(0, Math.PI * 2);
          // v6: out to well past the place's edge, spread evenly over the area (not bunched at its centre).
        const d = Math.sqrt(rng.next()) * (p.r + 30);
          cell = reach.cell(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d);
          if (cell < 0 || !reach.ground[cell]) continue;
        } else cell = reach.open[rng.int(0, reach.open.length - 1)];
        const [cx, cz] = reach.centre(cell);
        const x = cx + rng.range(-0.4, 0.4);
        const z = cz + rng.range(-0.4, 0.4);
        if (grid.any(x, z, LOOT.spacing, (sx, sz) => (sx - x) ** 2 + (sz - z) ** 2 < sp2)) continue;
        if (kindGrid.any(x, z, LOOT.sameKind, (sx, sz) => (sx - x) ** 2 + (sz - z) ** 2 < same2)) continue;
        spot = [x, z, reach.h[cell]];
      }
      if (!spot) continue;
      this.items.push({ index: this.items.length, kind, x: spot[0], z: spot[1], h: spot[2], taken: false });
      grid.add(spot[0], spot[1]);
      kindGrid.add(spot[0], spot[1]);
    }
  }

  /** v6 max: the power-up's rise: rooted while it plays (the phone's copy too: it predicts its own body). */
  pre(m: Match): void {
    for (const c of m.contestants) if (c.status === "alive" && m.effect(c, "rise") > 0) m.slow(c, 0);
  }

  view(m: Match): void {
    this.pre(m);
  }

  step(m: Match): void {
    for (const c of m.contestants) {
      const act = m.takePackAct(c);
      if (c.status !== "alive") continue;
      if (act >= 0) this.packAct(m, c, act);
      this.autoTake(m, c);
    }
  }

  /** v6: walk into an item or a loot bag and it goes in the backpack (when there's room). */
  private autoTake(m: Match, c: Contestant): void {
    if (m.seated(c) || c.stun > 0) return;
    const i = c.index;
    // Your own drop waits until you've stepped away from it.
    const own = this.noAuto[i];
    if (own >= 0) {
      const it = this.items[own];
      if (!it || it.taken || Math.hypot(it.x - c.x, it.z - c.z) > LOOT.auto * 2.2) this.noAuto[i] = -1;
    }
    const t = this.target(c, LOOT.auto);
    if (!t || (t.item && t.item.index === this.noAuto[i])) return;
    // A full backpack still takes a booster (it's used, not carried).
    if (!this.packs[i].includes(null) && !(t.item && ITEM_DEFS[t.item.kind].instant)) return;
    this.interact(m, c, t);
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
      this.growth[c.index] = 0;
      const kinds = this.packs[c.index].filter((k): k is ItemId => k !== null);
      this.packs[c.index] = new Array<ItemId | null>(this.size(m)).fill(null);
      if (!kinds.length) return;
      const bag: LootBag = { index: this.bags.length, id: c.id, x: e.x, z: e.z, h: e.h, at: m.elapsed, kinds };
      this.bags.push(bag);
      m.emit({ type: "bag", bag: bag.index, id: c.id, x: bag.x, z: bag.z, h: bag.h, kinds: kinds.slice() });
    } else if (e.type === "respawn") {
      const c = m.get(e.id);
      if (c) this.packs[c.index] = new Array<ItemId | null>(this.size(m)).fill(null);
    }
  }

  /** The nearest item or loot bag c could take now (the UI's prompt, and a tap's choice). */
  target(c: Contestant, reach: number = LOOT.reach): Target | null {
    const feet = c.h + c.y;
    let best: Target | null = null;
    let bestD: number = reach;
    // v4: only the grid cells within reach (the big world has thousands); ties go to the later item, as a full scan's did.
    let bestI = -1;
    const g = this.itemGrid();
    const q0 = Math.floor((c.x - reach) / ITEM_CELL);
    const q1 = Math.floor((c.x + reach) / ITEM_CELL);
    const r0 = Math.floor((c.z - reach) / ITEM_CELL);
    const r1 = Math.floor((c.z + reach) / ITEM_CELL);
    for (let q = q0; q <= q1; q++)
      for (let r = r0; r <= r1; r++) {
        const list = g.get(q * 65536 + r);
        if (!list) continue;
        for (const i of list) {
          const it = this.items[i];
          if (it.taken || Math.abs(it.h - feet) > LOOT.reachUp) continue;
          const d = Math.hypot(it.x - c.x, it.z - c.z);
          if (d < bestD || (d === bestD && i > bestI)) {
            bestD = d;
            bestI = i;
            best = { item: it };
          }
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

  /** The items by grid cell (built on first use: items never move, a drop goes in a bag). */
  private itemGrid(): Map<number, number[]> {
    if (this.grid && this.gridN === this.items.length) return this.grid;
    const g = new Map<number, number[]>();
    for (const it of this.items) {
      if (!it) continue;
      const k = Math.floor(it.x / ITEM_CELL) * 65536 + Math.floor(it.z / ITEM_CELL);
      let list = g.get(k);
      if (!list) g.set(k, (list = []));
      list.push(it.index);
    }
    this.grid = g;
    this.gridN = this.items.length;
    return g;
  }
  private grid: Map<number, number[]> | null = null;
  private gridN = -1;

  private interact(m: Match, c: Contestant, found?: Target): void {
    const t = found ?? this.target(c);
    if (!t) return;
    const pack = this.packs[c.index];
    if (t.item && ITEM_DEFS[t.item.kind].instant) {
      // v6 max: a booster works the moment it's touched (slot −1: it never enters the backpack).
      t.item.taken = true;
      m.emit({ type: "take", id: c.id, item: t.item.index, kind: t.item.kind, slot: -1 });
      this.power(m, c, t.item.kind);
      return;
    }
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
      // v6: not straight back into your own pack: it waits until you walk away (autoTake).
      this.noAuto[c.index] = this.add(m, kind, x, z, c.h, c.id, slot).index;
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
      case "grow":
        // Titan Serum: one level, up to the most (another stays in the pack).
        if (this.growth[c.index] >= GROWTH.max) return;
        this.growth[c.index]++;
        break;
      case "print":
        // The Map Print: once a match (another stays in the pack, useless).
        if (this.printed[c.index]) return;
        this.printed[c.index] = 1;
        m.setEffect(c, "print", fx.s);
        break;
      case "survival":
        // Dead Streets': survival.ts does it when it hears the "use" (if it would do anything now).
        if (!m.module<SurvivalModule>("survival")?.can(m, c, kind)) return;
        break;
      case "gadget":
        // The §10 items: gadgets.ts does it when it hears the "use" (if it can be done now).
        if (!m.module<GadgetsModule>("gadgets")?.can(m, c, kind)) return;
        break;
    }
    pack[slot] = null;
    m.emit({ type: "use", id: c.id, kind, slot });
  }

  /** v6 max (3.2): a booster taken: its effect, the rise, and the "use" every phone hears (slot −1). */
  private power(m: Match, c: Contestant, kind: ItemId): void {
    const fx = ITEM_DEFS[kind].effect;
    if (fx?.kind !== "power") return;
    powerOn(m, c, fx);
    m.emit({ type: "use", id: c.id, kind, slot: -1 });
  }

  /** Put an item on the ground (a drop from slot `slot`, a crate's overflow). */
  add(m: Match, kind: ItemId, x: number, z: number, h: number, by: string | null, slot = -1): GroundItem {
    const it: GroundItem = { index: this.items.length, kind, x, z, h, taken: false };
    this.items.push(it);
    this.grid = null;
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
        if (pack && e.slot >= 0) {
          while (pack.length <= e.slot) pack.push(null);
          pack[e.slot] = e.kind;
        }
        break;
      case "drop":
        if (!this.items[e.item]) {
          this.items[e.item] = { index: e.item, kind: e.kind, x: e.x, z: e.z, h: e.h, taken: false };
          this.grid = null;
        }
        if (pack && e.slot !== undefined && pack[e.slot] === e.kind) pack[e.slot] = null;
        break;
      case "use": {
        if (!pack || !c) break;
        if (e.slot >= 0) pack[e.slot] = null;
        const fx = ITEM_DEFS[e.kind].effect;
        if (fx?.kind === "power") powerOn(m, c, fx);
        if (fx?.kind === "slots") for (let i = 0; i < fx.add; i++) pack.push(null);
        else if (fx?.kind === "speed") m.setEffect(c, "speed", fx.s, fx.mult);
        else if (fx?.kind === "shield" || fx?.kind === "pepper" || fx?.kind === "iron") m.setEffect(c, fx.kind, fx.s);
        else if (fx?.kind === "grow") this.growth[c.index] = Math.min(GROWTH.max, this.growth[c.index] + 1);
        else if (fx?.kind === "print") {
          this.printed[c.index] = 1;
          m.setEffect(c, "print", fx.s);
        }
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
        if (c && e.type === "respawn") this.packs[c.index] = new Array<ItemId | null>(this.size(m)).fill(null);
        if (c && e.type === "eliminated") this.growth[c.index] = 0;
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

/** v6 max (3.2): a booster's effects on c: its power (the HUD's chip, the look), the speed, the rise. */
function powerOn(m: Match, c: Contestant, fx: { power: "strength" | "speed"; s: number }): void {
  m.setEffect(c, fx.power, fx.s);
  if (fx.power === "speed") m.setEffect(c, "speed", fx.s, POWER.speed.mult);
  m.setEffect(c, "rise", POWER.rise);
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
