// Mode definitions as data (SPEC-V3 §1.3). A mode is a combination of rule
// modules and numbers, never code: a new combination ships in the content
// manifest any week; a new kind of rule (a module) needs a release. The phones
// and the server read the same definitions, so they referee the same game.
//
// Every module here is known to the validator (its numbers are checked);
// `BUILT` says which ones this build can actually play. A mode that needs a
// module this build doesn't have is shown as "coming" (or "update the game"),
// never started.

/** The rule modules (SPEC-V3 §1.1). */
export const MODULE_IDS = [
  "doll", "balls", "zone", "items", "airfall", "vehicles", "melee",
  "flags", "dropzones", "capture", "economy", "rooms", "tag", "riddles", "blackout", "survival",
  // The §10 items' effects in the world (Phase 6): rides along with `items`, never named by a mode.
  "gadgets",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/** The modules this build can play. Grows phase by phase (SPEC-V3 §13). */
export const BUILT: ReadonlySet<ModuleId> = new Set<ModuleId>(["doll", "balls", "zone", "items", "airfall", "vehicles", "melee", "flags", "dropzones", "capture", "gadgets", "tag"]);

export type Family = "ffa" | "survival" | "rlgl";
export type Text = { en: string; pcm?: string };

export type WinKind =
  /** First to the event (claim the flag, reach the Mast). */
  | "first"
  /** Most of a measure at the time limit (seconds held, Owo, points). */
  | "most"
  /** Last one standing (with a condition: holding a flag, not found, human). */
  | "last"
  /** The squad with the most members in the point at the end. */
  | "squad-most"
  /** Red Light, Green Light: first across the line. */
  | "line";

export interface ModeDef {
  id: string;
  /** Bumped whenever the definition changes (rooms agree on id@v). */
  v: number;
  family: Family;
  name: Text;
  /** One line under the name: the win condition, plainly. */
  blurb: Text;
  /** The rank division that unlocks it ("rookie-1", "pro-1", "legendary-1"). */
  minRank: string;
  players: { min: number; max: number; squad: [number, number] };
  /** The world it is played in. */
  map: string;
  /** Time limit, seconds. */
  time: number;
  respawn: { on: boolean; delay?: number };
  modules: Partial<Record<ModuleId, Record<string, unknown>>>;
  win: { kind: WinKind; measure?: string; event?: string };
  /** Ranked overrides: "module.key" → value (Ranked also doubles XP). */
  ranked?: Record<string, unknown>;
  /** "staked" marks the Lagos Life staked format (2–4 seats). */
  tags?: string[];
}

export interface Manifest {
  /** Format version of this file. */
  format: 1;
  /** Issue date, YYYY-MM-DD: a phone keeps the newest it has verified. */
  issued: string;
  modes: ModeDef[];
  /** Public matchmaking's featured modes this week (SPEC-V3 §9: a rotation of 3–4). */
  rotation: string[];
}

const ZONE_FFA = { phases: [[60, 180, 40, 1.0], [180, 110, 40, 1.5], [300, 60, 40, 2.5], [420, 25, 40, 4]] };
const ZONE_TIGHT = { phases: [[45, 150, 35, 1.5], [150, 80, 35, 2.5], [270, 35, 35, 4], [390, 12, 30, 6]] };
const ITEMS = { table: "ffa-core", density: 0.8 };
const AIRFALL = { max: 3, gap: [180, 240] };
const CARS = { count: [1, 2], kinds: ["danfo", "keke", "tokunbo"] };
const MELEE = { set: "gidigbo" };
const SOLO_OR_SQUAD = { min: 6, max: 12, squad: [1, 4] as [number, number] };
const RANKED = { "zone.scale": 0.85, "items.density": 0.6 };

/**
 * The launch manifest, built into the game (offline, and the fallback when no
 * newer verified one has been fetched). SPEC-V3 §9 and §3.
 */
export const BUILTIN_MANIFEST: Manifest = {
  format: 1,
  issued: "2026-10-28",
  // Hustle joins the rotation with its module (economy, Phase 6).
  rotation: ["find-the-flag", "hold-the-flag", "steal-reposition", "squad-rally"],
  modes: [
    // ── Free For All (Naija World) ──
    {
      id: "find-the-flag", v: 2, family: "ffa", minRank: "rookie-1", players: SOLO_OR_SQUAD, map: "naija-world", time: 540,
      name: { en: "Find the Flag", pcm: "Find Di Flag" },
      blurb: { en: "Find the one hidden flag and hold it for 10 s.", pcm: "Find the one flag wey dem hide, hold am for 10 seconds." },
      respawn: { on: true, delay: 6 },
      modules: { zone: ZONE_FFA, items: ITEMS, vehicles: CARS, airfall: AIRFALL, melee: MELEE, flags: { count: 1, spots: "stash", claimHold: 10, hints: [90, 180, 270] } },
      win: { kind: "first", event: "flags.claimed" },
      ranked: { ...RANKED, "respawn.on": false, "flags.claimHold": 20, "flags.hints": [180] },
    },
    {
      id: "hold-the-flag", v: 2, family: "ffa", minRank: "rookie-1", players: SOLO_OR_SQUAD, map: "naija-world", time: 480,
      name: { en: "Hold the Flag", pcm: "Hold Di Flag" },
      blurb: { en: "Most seconds holding the flag, all match long.", pcm: "Who hold the flag pass for the whole match, win." },
      respawn: { on: true, delay: 6 },
      modules: { zone: ZONE_FFA, items: ITEMS, vehicles: CARS, airfall: AIRFALL, melee: MELEE, flags: { count: 1, extraAt: 9, holderSlow: 0.1, ping: 10 } },
      win: { kind: "most", measure: "flags.held" },
      ranked: { ...RANKED, "respawn.on": false, "flags.ping": 5 },
    },
    {
      id: "steal-reposition", v: 2, family: "ffa", minRank: "rookie-1", players: SOLO_OR_SQUAD, map: "naija-world", time: 540,
      name: { en: "Steal & Reposition", pcm: "Thief Am, Move Am" },
      blurb: { en: "Deliver flags to the drop zones. First to 5.", pcm: "Carry flag reach the drop zone. First to reach 5." },
      respawn: { on: true, delay: 6 },
      modules: { zone: ZONE_FFA, items: ITEMS, vehicles: CARS, airfall: AIRFALL, melee: MELEE, flags: { count: 4 }, dropzones: { live: 3, life: 60, target: 5 } },
      win: { kind: "first", event: "dropzones.target" },
      ranked: { ...RANKED, "respawn.on": false, "dropzones.life": 45 },
    },
    {
      id: "squad-rally", v: 2, family: "ffa", minRank: "rookie-1", players: { min: 8, max: 12, squad: [4, 4] }, map: "naija-world", time: 480,
      name: { en: "Squad Rally", pcm: "Squad Rally" },
      blurb: { en: "Most of your squad inside the moving point at the end.", pcm: "Squad wey get pass people inside the moving point for end, win." },
      respawn: { on: true, delay: 8 },
      modules: { zone: ZONE_FFA, items: ITEMS, vehicles: CARS, airfall: AIRFALL, melee: MELEE, capture: { moving: true, speed: 1.4, radius: 9, doubleLast: 60 } },
      win: { kind: "squad-most", measure: "capture.inside" },
      ranked: { ...RANKED, "respawn.on": false, "capture.radius": 7 },
    },
    {
      id: "hustle", v: 1, family: "ffa", minRank: "rookie-1", players: SOLO_OR_SQUAD, map: "naija-world", time: 600,
      name: { en: "Hustle", pcm: "Hustle" },
      blurb: { en: "Do jobs across the city. Most Owo banked wins.", pcm: "Do work round the city. Who bank pass Owo, win." },
      respawn: { on: true, delay: 6 },
      modules: { zone: ZONE_FFA, items: ITEMS, airfall: AIRFALL, vehicles: CARS, melee: MELEE, economy: { spill: 0.5, leaderPing: 30, banks: "esusu" } },
      win: { kind: "most", measure: "economy.banked" },
      ranked: { ...RANKED, "respawn.on": false, "economy.spill": 0.7 },
    },
    {
      id: "scarcity", v: 2, family: "ffa", minRank: "pro-1", players: SOLO_OR_SQUAD, map: "naija-world", time: 600,
      name: { en: "Scarcity", pcm: "Scarcity" },
      blurb: { en: "Three flags, twelve players. Last standing with one wins.", pcm: "Three flag for twelve people. Last person wey still hold one, win." },
      respawn: { on: false },
      modules: { zone: ZONE_TIGHT, items: ITEMS, vehicles: CARS, airfall: AIRFALL, melee: MELEE, flags: { count: 3, extractAt: 360 } },
      win: { kind: "last", measure: "flags.holding" },
      ranked: { ...RANKED, "zone.scale": 0.8 },
    },
    {
      id: "chase-reverse", v: 1, family: "ffa", minRank: "pro-1", players: SOLO_OR_SQUAD, map: "naija-world", time: 420,
      name: { en: "Chase & Reverse", pcm: "Pursue & Reverse" },
      blurb: { en: "Run from the Ojuju. Tagged, you become one. Last human wins.", pcm: "Run from Ojuju. If e touch you, you don turn Ojuju. Last human win." },
      respawn: { on: false },
      modules: { zone: ZONE_FFA, items: ITEMS, vehicles: CARS, melee: MELEE, tag: { start: 1, chaserSpeed: 1.08, cures: 2, curesAt: 180 } },
      win: { kind: "last", measure: "tag.human" },
      ranked: { ...RANKED, "tag.cures": 1 },
    },
    {
      id: "compound-wars", v: 1, family: "ffa", minRank: "pro-1", players: SOLO_OR_SQUAD, map: "naija-world", time: 480,
      name: { en: "Compound Wars", pcm: "Compound Wars" },
      blurb: { en: "Hold the best rooms in the compound. Most points wins.", pcm: "Hold the fine rooms for compound. Who get pass points, win." },
      respawn: { on: true, delay: 5 },
      modules: { zone: { phases: [[30, 60, 30, 1.5], [240, 40, 30, 2.5]] }, items: ITEMS, melee: MELEE, rooms: { count: 8, values: [1, 1, 2, 2, 3, 3, 4, 5], fuse: true, keys: true } },
      win: { kind: "most", measure: "rooms.points" },
      ranked: { ...RANKED, "respawn.on": false },
    },
    {
      id: "riddles-elders", v: 1, family: "ffa", minRank: "legendary-1", players: SOLO_OR_SQUAD, map: "naija-world", time: 600,
      name: { en: "Riddles of the Elders", pcm: "Elders Riddle" },
      blurb: { en: "Solve 3 riddles across the city, then return to the Elders.", pcm: "Answer 3 riddle for inside city, come back meet the Elders." },
      respawn: { on: true, delay: 6 },
      modules: { zone: ZONE_FFA, items: ITEMS, vehicles: CARS, melee: MELEE, riddles: { every: 90, need: 3, wrongCost: 20, langs: ["yo", "ig", "ha", "pcm"] } },
      win: { kind: "first", event: "riddles.returned" },
      ranked: { ...RANKED, "respawn.on": false, "riddles.wrongCost": 35 },
    },
    {
      id: "lights-out", v: 1, family: "ffa", minRank: "legendary-1", players: SOLO_OR_SQUAD, map: "naija-world", time: 480,
      name: { en: "Lights Out", pcm: "Light Don Go" },
      blurb: { en: "Power cuts. Keep someone in your light 1.5 s to find them. Last hidden wins.", pcm: "Light don go. Hold person for your light 1.5 seconds to catch am. Last person wey hide, win." },
      respawn: { on: false },
      modules: { zone: ZONE_FFA, items: ITEMS, melee: MELEE, blackout: { every: [60, 90], dim: 0.15, findHold: 1.5 } },
      win: { kind: "last", measure: "blackout.hidden" },
      ranked: { ...RANKED, "blackout.findHold": 1.2 },
    },
    // ── The staked duel (Lagos Life, 2–4 seats: SPEC-V3 Answers) ──
    {
      id: "flag-duel", v: 1, family: "ffa", minRank: "rookie-1", players: { min: 2, max: 4, squad: [1, 1] }, map: "naija-world:market", time: 300,
      name: { en: "Flag Duel", pcm: "Flag Duel" },
      blurb: { en: "Staked: first to find the flag and hold it 10 s wins.", pcm: "Stake: first person wey find flag hold am 10 seconds, win." },
      respawn: { on: true, delay: 5 },
      modules: { zone: { phases: [[45, 70, 30, 1.5], [150, 35, 30, 3]] }, items: ITEMS, melee: MELEE, flags: { count: 1, spots: "stash", claimHold: 10, hints: [60, 120] } },
      win: { kind: "first", event: "flags.claimed" },
      tags: ["staked"],
    },
    // ── Dead Streets (Spooky World) ──
    {
      id: "dead-streets", v: 1, family: "survival", minRank: "rookie-1", players: { min: 1, max: 1, squad: [1, 1] }, map: "spooky-world", time: 900,
      name: { en: "Dead Streets", pcm: "Dead Streets" },
      blurb: { en: "Cross the dead city to the Mast. Fast, and alive.", pcm: "Cross the dead city reach the Mast. Quick quick, and alive." },
      respawn: { on: false },
      modules: { survival: { bleedAfter: 720, bleedRate: 0.01, route: 1400, zombies: [14, 20, 24] }, items: { table: "ds-core", density: 1 } },
      win: { kind: "first", event: "survival.mast" },
      ranked: { "survival.bleedAfter": 660, "items.density": 0.75 },
    },
    // ── Ball Haunt (hidden by FEATURES.ballHaunt; SPEC-V2 until Phase 11) ──
    {
      id: "classic-run", v: 1, family: "rlgl", minRank: "rookie-1", players: { min: 1, max: 20, squad: [1, 1] }, map: "any", time: 80,
      name: { en: "Classic Run", pcm: "Classic Run" },
      blurb: { en: "Reach the line. Freeze when she turns.", pcm: "Reach the line. Stand still when she turn." },
      respawn: { on: false },
      modules: { doll: {} },
      win: { kind: "line" },
    },
    {
      id: "ball-haunting", v: 1, family: "rlgl", minRank: "rookie-1", players: { min: 1, max: 20, squad: [1, 1] }, map: "any", time: 80,
      name: { en: "Ball Haunting", pcm: "Ball Haunting" },
      blurb: { en: "Reach the line holding a ball.", pcm: "Reach the line with ball for hand." },
      respawn: { on: false },
      modules: { doll: {}, balls: {} },
      win: { kind: "line" },
    },
  ],
};
