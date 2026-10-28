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
import type { PropId, SwingKind } from "../modules/melee";
import type { Cause, Contestant } from "./body";
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
  | { type: "drop"; id: string | null; item: number; kind: ItemId; x: number; z: number; h: number; slot?: number }
  | { type: "use"; id: string; kind: ItemId; slot: number }
  | { type: "bag"; bag: number; id: string; x: number; z: number; h: number; kinds: ItemId[] }
  | { type: "loot"; id: string; bag: number; kinds: ItemId[]; left: number }
  | { type: "full"; id: string }
  // Airfall: the flare goes up where it will land; it lands; someone opens it.
  | { type: "flare"; crate: number; x: number; z: number; h: number; land: number }
  | { type: "landed"; crate: number }
  | { type: "open"; crate: number; id: string; kinds: ItemId[] }
  // ── Melee (Gidigbo, Phase 4) ──
  // A swing starts (everyone sees the wind-up); it misses, or lands.
  | { type: "swing"; id: string; kind: SwingKind; at: number }
  | { type: "miss"; id: string; kind: SwingKind }
  | { type: "hit"; id: string; tg: string; kind: SwingKind; w: number; kx: number; kz: number }
  | { type: "parry"; id: string; by: string }
  /** A grab's wind-up broken by a strike. */
  | { type: "broke"; id: string; by: string }
  | { type: "down"; id: string; s: number; why: "daze" | "trip" | "tackle" | "throw" | "ringout"; by: string | null }
  | { type: "up"; id: string }
  | { type: "clinch"; id: string; tg: string }
  | { type: "release"; id: string; tg: string; how: "throw" | "trip" | "drag" | "reverse" | "break" | "escape" }
  | { type: "prop"; id: string; prop: number; kind: PropId; how: "take" | "drop" | "break" | "throw"; x: number; z: number; h: number }
  | { type: "fly"; id: string; flight: number; x: number; z: number; h: number; dx: number; dz: number; back: boolean; prop: number }
  | { type: "landed-fly"; flight: number; x: number; z: number; h: number; hit: string | null }
  // ── Objectives (Phase 4: flags, drop zones, the rally point) ──
  | { type: "flag"; flag: number; how: "take" | "drop" | "found" | "home" | "deliver"; id: string | null; x: number; z: number; h: number }
  | { type: "search"; id: string; spot: number; found: boolean }
  /** Find the Flag's radio hint: the flag is somewhere in this circle. */
  | { type: "hint"; n: number; x: number; z: number; r: number }
  /** Hold the Flag: where a holder is now (everyone's map). */
  | { type: "ping"; id: string; x: number; z: number }
  /** Scarcity: the extraction gate opens. */
  | { type: "gate"; x: number; z: number }
  /** A drop zone (Steal & Reposition) moves: live from now until `until`. */
  | { type: "dz"; k: number; x: number; z: number; until: number }
  /** Someone (or a squad) won: the match ends. */
  | { type: "won"; id: string | null; squad: number };

export interface RuleModule {
  readonly id: ModuleId;
  /** Once the bodies are placed, before the first step. */
  init?(m: Match): void;
  /** Every fixed step of play, after the bodies have moved. */
  step?(m: Match, dt: number): void;
  /** Every event, from any module or the core, as it happens. */
  onEvent?(m: Match, e: MatchEvent): void;
  /** Every fixed step of play, BEFORE the bodies move (melee: buttons, wind-ups, a brace's slow). */
  pre?(m: Match, dt: number): void;
  /**
   * What an interact tap from c would take through this module, and how far
   * it is: the core gives the tap to the nearest (an item, a prop, a flag's
   * stash), so two modules never both take one tap.
   */
  reachFor?(m: Match, c: Contestant): { d: number; take: () => void } | null;
  /** The time is up (before the match ends): a "most" mode names its winner (Match.win). */
  timeUp?(m: Match): void;
  /** The mode's own measure for body i (seconds held, deliveries …): places and XP. */
  objective?(m: Match, i: number): number;
  /**
   * The online client's copy of the match (Match.mirror): the server's event
   * `e`, applied to this module's state. Nothing is decided on a phone.
   */
  apply?(m: Match, e: MatchEvent): void;
  /** The online client's copy, every step: what it can work out itself (the zone's circle now, the rally point). */
  view?(m: Match, dt: number): void;
}
