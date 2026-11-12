// A rule module (SPEC-V3 §1.1): one kind of rule a mode can switch on — the
// zone, items, Airfall, melee, flags, vehicles, zombies, Ball Haunt's song. A mode is a
// list of modules and their numbers (content/modes.ts); the match core
// (match.ts) runs the bodies and the clock and calls each module in turn.
//
// Modules are pure, like the rest of src/game: no three.js, no DOM, no clock.
// All their randomness comes from the match's seeded streams, so the server
// and every phone referee the same match.

import type { AttackKind, VehicleKind } from "../../config";
import type { ItemId } from "../../content/items";
import type { ModuleId } from "../../content/modes";
import type { GadgetKind } from "../modules/gadgets";
import type { PropId, SwingKind } from "../modules/melee";
import type { Phase } from "../phases";
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
  | { type: "flare"; crate: number; x: number; z: number; h: number; land: number; votes?: number[] }
  /** The spectators' vote on where crate lands (§10.6): the spots offered, open until `until` (seconds of play). */
  | { type: "vote"; crate: number; xs: number[]; zs: number[]; until: number }
  /** A spectator's vote cast (counts so far). */
  | { type: "ballot"; crate: number; id: string; pick: number; votes: number[] }
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
  // ── Treasure Hunt (v5): a box opened (found: the treasure in it, −1 empty); a treasure moves; the upload ──
  | { type: "tbox"; box: number; id: string; found: number; trap?: boolean }
  | { type: "tre"; t: number; how: "find" | "take" | "give" | "drop" | "loose"; id: string | null; x: number; z: number; h: number; by?: string }
  | { type: "upl"; id: string; how: "start" | "stop" | "done" }
  /** A Map Print (v5): which box each treasure still in one is in. Only to the seat that used it (Match.whisper). */
  | { type: "tmap"; t: number[]; b: number[] }
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
  | { type: "gadget"; kind: GadgetKind; n: number; id: string | null; x: number; z: number; h: number; hd?: number; k?: number }
  /** A Talking Drum: who it showed to whom (tg null: nobody near), until when. */
  | { type: "reveal"; id: string; tg: string | null; until: number; all?: boolean }
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
  | { type: "shock"; id: string; x: number; z: number }
  // ── Hustle (Phase 6, economy.ts) ──
  /** A job: a hold-job started, stopped or done (owo: its pay); a carry-job taken, delivered or lost; a station sabotaged. */
  | { type: "job"; id: string; station: number; how: "start" | "stop" | "done" | "take" | "deliver" | "lost" | "sabotage"; owo: number }
  /** Someone's Owo now, and why it changed. */
  | { type: "owo"; id: string; carried: number; banked: number; why: "job" | "bank" | "spill" | "pick" | "bounty" }
  /** Spilled Owo on the ground (a bag), and scooped up. */
  | { type: "spill"; bag: number; x: number; z: number; h: number; owo: number }
  | { type: "scoop"; bag: number; id: string }
  // ── Riddles of the Elders (Phase 6, riddles.ts) ──
  /** Riddle k is asked (its id in content/riddles.ts, the language it's asked in). */
  | { type: "riddle"; k: number; id: string; lang: string }
  /** A kola-nut token taken: the right answer to riddle k, or wrong (no tokens for a while). */
  | { type: "token"; id: string; token: number; riddle: number; right: boolean }
  // ── Compound Wars (Phase 6, rooms.ts) ──
  /** A door opened or shut (by id), its lock, jammed until (0: not). */
  | { type: "door"; room: number; open: boolean; locked: boolean; jam: number; id: string | null }
  /** A key: taken, dropped, used on a locked door. */
  | { type: "key"; key: number; how: "take" | "drop" | "use"; id: string | null; x: number; z: number; h: number }
  /** The fuse box: a room dark until. */
  | { type: "fuse"; room: number; until: number; id: string }
  // ── The extras (§10; Phase 6) ──
  /** A squad mate helped tg up (half the Daze left) or pulled them out of a gutter. */
  | { type: "helpup"; id: string; tg: string; how: "up" | "rescue" }
  /** A bounty on the leader (Hold the Flag): id Dazed them and took `v` of their measure. */
  | { type: "bounty"; id: string; tg: string; v: number }
  /** The danfo sweeping the main road shoved tg: their slide and wobble now. */
  | { type: "danfo"; tg: string; kx: number; kz: number; w: number }
  /** Onto a rooftop zip-line, or off at its foot (at: seconds of play). */
  | { type: "zip"; id: string; zip: number; how: "on" | "off"; at: number }
  // ── Dead Streets (Phase 7, survival.ts) ──
  /** A zombie rises out of the ground (it can't move for SURVIVAL.rise s). */
  | { type: "zrise"; id: string; x: number; z: number; h: number; kind?: string; bounty?: boolean }
  /** A zombie is put down (by whom; a head shot). */
  | { type: "zdie"; id: string; by: string | null; head: boolean }
  /** A zombie's claw lands: tg's health and armour now. */
  | { type: "claw"; id: string; tg: string; hp: number; armour: number }
  /** A shot (tg: who it hit, or nobody), and the rounds left. */
  | { type: "shot"; id: string; tg: string | null; head: boolean; ammo: number }
  /** A melee blow (the cutlass or a shove) on a zombie, or on a gate. */
  | { type: "blow"; id: string; tg: string | null; gate: number; kind: "cutlass" | "shove" }
  /** A gate: hit (blows so far), a key or fuel picked up, opened. */
  | { type: "dgate"; gate: number; how: "hit" | "key" | "fuel" | "open"; id: string | null; n: number }
  /** An obstacle's hazard caught someone (health now). */
  | { type: "hazard"; hz: number; id: string; hp: number }
  /** Health back (an item, a sanctuary), armour on, ammo, battery: the runner's numbers now. */
  | { type: "kit"; id: string; hp: number; armour: number; ammo: number; torch: number; why: "item" | "sanctuary" }
  // ── Dead Streets' extras (Phase 8) ──
  /** A find: a cache opened, lore read (n: which piece), the vault opened, the bounty's gold key (k −1); the items it gave. */
  | { type: "find"; id: string; k: number; kind: "cache" | "lore" | "vault" | "key" | "egg"; n: number; items: ItemId[] }
  /** The torch staggered a Runner (or a wall stopped a Brute). */
  | { type: "beam"; id: string }
  /** A Bloater burst; a Screamer screamed; a Brute charges; a Lurker has your legs; a horde comes (the drum). */
  | { type: "gas"; id: string; x: number; z: number }
  | { type: "scream"; id: string }
  | { type: "charge"; id: string }
  | { type: "grabbed"; id: string }
  | { type: "horde"; id: string }
  /** The Last Stand at the Mast: hold until `until` (seconds of play). */
  | { type: "stand"; id: string; until: number }
  // ── Ball Haunt (Phase 11, doll.ts and balls.ts) ──
  /** The cycle moves on: the song, the hum, the eye opening, watching, closing (the doll's names). */
  | { type: "doll"; phase: Exclude<Phase, "walkout" | "countdown" | "ended">; duration: number }
  /** Over the line, safe: the time it took and the place. */
  | { type: "finished"; id: string; time: number; place: number }
  /** A swing. `target` is who it landed on (null: it missed); `dropped` the ball it knocked loose, or −1. */
  | { type: "attack"; id: string; kind: AttackKind; target: string | null; dropped: number }
  | { type: "grab"; id: string; ball: number }
  /** A ball rolls loose (knocked out of someone's hands, or theirs as they fall). */
  | { type: "ball"; ball: number; x: number; z: number }
  | { type: "bank"; id: string; ball: number; basket: number }
  // ── Guns (v4 Phase 2, guns.ts) ──
  /** A shot: the gun (GUN_KINDS index), where its first pellet ended, what it hit (HIT_KINDS index), the rounds left. */
  | { type: "fire"; id: string; g: number; x: number; y: number; z: number; hit: number; mag: number }
  /** Damage on a body: health and armour now, a head shot, how much. */
  | { type: "dmg"; tg: string; by: string | null; hp: number; ar: number; head: boolean; amt: number }
  /** Out by a gun, a blow or a blast: who did it. */
  | { type: "kill"; tg: string; by: string | null; how: string; head: boolean }
  /** A reload starts (done at `at`) or is done; the slot's magazine and spare rounds. */
  | { type: "reload"; id: string; how: "start" | "done"; s: number; mag: number; res: number; at: number }
  /** The other slot in hand. */
  | { type: "swap"; id: string; s: number }
  /** A pickup in play (a dropped gun, a crate's gift): kind, gun, rarity, where; a dropped gun's rounds (−1 full). */
  | { type: "pick"; p: number; kind: "gun" | "ammo" | "plate"; g: number; r: number; x: number; z: number; h: number; mag: number; res: number }
  /** A pickup taken: the taker's health, armour, primary (gun, rarity, magazine, spare) and the pistol's spare rounds now. */
  | { type: "ptake"; p: number; id: string; hp: number; ar: number; g1: number; r1: number; mag: number; res: number; res0: number }
  /** A crate or drum broken. */
  | { type: "brk"; b: number; by: string | null; x: number; z: number; h: number };

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
