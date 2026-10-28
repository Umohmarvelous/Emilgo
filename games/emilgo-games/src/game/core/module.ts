// A rule module (SPEC-V3 §1.1): one kind of rule a mode can switch on — the
// zone, items, Airfall, later melee, flags, vehicles, zombies. A mode is a
// list of modules and their numbers (content/modes.ts); the match core
// (match.ts) runs the bodies and the clock and calls each module in turn.
//
// Modules are pure, like the rest of src/game: no three.js, no DOM, no clock.
// All their randomness comes from the match's seeded streams, so the server
// and every phone referee the same match.

import type { ItemId } from "../../content/items";
import type { ModuleId } from "../../content/modes";
import type { Cause } from "./body";
import type { Match } from "./match";

export type MatchPhase = "walkout" | "countdown" | "play" | "ended";

export type MatchEvent =
  | { type: "phase"; phase: MatchPhase; duration: number }
  | { type: "eliminated"; id: string; cause: Cause; x: number; z: number; h: number }
  | { type: "respawn"; id: string; x: number; z: number }
  | { type: "ended" }
  // The zone: the next circle (it closes from `at`, over `over` seconds of play) …
  | { type: "zone"; phase: number; x: number; z: number; r: number; at: number; over: number }
  // … and the sky laser coming down on someone (it hits at `hitAt`, seconds of play).
  | { type: "laser"; id: string; hitAt: number }
  // Items: into a backpack, onto the ground, used; a loot bag dropped and looted; a full pack.
  | { type: "take"; id: string; item: number; kind: ItemId; slot: number }
  | { type: "drop"; id: string | null; item: number; kind: ItemId; x: number; z: number; h: number }
  | { type: "use"; id: string; kind: ItemId; slot: number }
  | { type: "bag"; bag: number; id: string; x: number; z: number; h: number; kinds: ItemId[] }
  | { type: "loot"; id: string; bag: number; kinds: ItemId[]; left: number }
  | { type: "full"; id: string }
  // Airfall: the flare goes up where it will land; it lands; someone opens it.
  | { type: "flare"; crate: number; x: number; z: number; h: number; land: number }
  | { type: "landed"; crate: number }
  | { type: "open"; crate: number; id: string; kinds: ItemId[] };

export interface RuleModule {
  readonly id: ModuleId;
  /** Once the bodies are placed, before the first step. */
  init?(m: Match): void;
  /** Every fixed step of play, after the bodies have moved. */
  step?(m: Match, dt: number): void;
  /** Every event, from any module or the core, as it happens. */
  onEvent?(m: Match, e: MatchEvent): void;
}
