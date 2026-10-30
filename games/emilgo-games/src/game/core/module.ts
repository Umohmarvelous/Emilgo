// A rule module (SPEC-V3 §1.1): one kind of rule a mode can switch on — the
// zone, items, Airfall, later melee, flags, vehicles, zombies. A mode is a
// list of modules and their numbers (content/modes.ts); the match core
// (match.ts) runs the bodies and the clock and calls each module in turn.
//
// Modules are pure, like the rest of src/game: no three.js, no DOM, no clock.
// All their randomness comes from the match's seeded streams, so the server
// and every phone referee the same match.

import type { VehicleKind } from "../../config";
import type { ItemId } from "../../content/items";
import type { ModuleId } from "../../content/modes";
import type { GadgetKind } from "../modules/gadgets";
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
  | { type: "down"; id: string; s: number; why: DownWhy; by: string | null }
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
  | { type: "won"; id: string | null; squad: number }
  // ── Vehicles (Phase 5) ──
  /** A car arrives: parked at the start, or called by a Danfo Key. `hd`: its heading. */
  | { type: "car"; car: number; kind: VehicleKind; x: number; z: number; h: number; hd: number }
  /** Someone gets in (seat 0 drives, 1 rides) or out (seat −1, standing at x, z). */
  | { type: "seat"; car: number; id: string; seat: number; x: number; z: number }
  /** Pulling a driver out: started, given up, or done (they're out, you drive). */
  | { type: "hijack"; car: number; id: string; how: "start" | "stop" | "done" }
  | { type: "horn"; car: number }
  /** An empty car bumped: its alarm goes. */
  | { type: "alarm"; car: number }
  /** The tank, in seconds of driving: a fuel boy's or a jerrycan's top-up, a low-fuel beep, empty (it stalls). */
  | { type: "fuel"; car: number; s: number; why: "boy" | "can" | "beep" | "empty"; stand?: number }
  /** Worse: 1 scratched, 2 smoking, 3 on fire (it blows at `blow`, seconds of play), 4 blown up. */
  | { type: "wreck"; car: number; state: number; blow?: number }
  /** Somebody in a car's way, pushed aside: their slide and wobble now. */
  | { type: "bump"; car: number; tg: string; kx: number; kz: number; w: number }
  /** The sky's laser missed: they were driving too fast to see. */
  | { type: "dodge"; id: string }
  // ── The §10 items (Phase 6, gadgets.ts) ──
  /** Something an item did or left: a smoke cloud, a peel, a decoy (n: its index), the powder, a megaphone's wind-up and wave, a slip, a pop, a sneeze, a wave lost. */
  | { type: "gadget"; kind: GadgetKind; n: number; id: string | null; x: number; z: number; h: number; hd?: number }
  /** A Talking Drum: who it showed to whom (tg null: nobody near), until when. */
  | { type: "reveal"; id: string; tg: string | null; until: number }
  /** Aso-ebi: the squad someone now wears (−1: their own again). */
  | { type: "disguise"; id: string; squad: number; until: number }
  // ── Chase & Reverse (Phase 6, tag.ts) ──
  /** Someone turned Ojuju (by an Ojuju's touch, or at the start), or cured back to human (by a charm's carrier). */
  | { type: "turn"; id: string; ojuju: boolean; by: string | null }
  /** A Reverse charm: dropped (the start of them, or by a carrier), taken, used on an Ojuju. */
  | { type: "charm"; charm: number; how: "drop" | "take" | "use"; id: string | null; x: number; z: number; h: number }
  // ── Lights Out (Phase 6, blackout.ts) ──
  /** Found: id kept tg in their lamp long enough (tg is out). */
  | { type: "found"; id: string; tg: string }
  /** A running generator shocked someone who touched it. */
  | { type: "shock"; id: string; x: number; z: number };

/** Why someone went down: melee's reasons, then a car's (pulled out, thrown by a blast, out at speed). */
export type DownWhy = "daze" | "trip" | "tackle" | "throw" | "ringout" | "hijack" | "blast" | "tumble";

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
