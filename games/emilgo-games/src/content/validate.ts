// The content manifest's gatekeeper (SPEC-V3 §1.3). A manifest is data from
// the network: the phones and the server both run it through here, and a mode
// with an unknown module or a number out of range is dropped, never played.
// One bad mode doesn't take the others with it.

import { DIVISIONS, TIERS } from "../rank/ladder";
import { MODULE_IDS, type Manifest, type ModeDef, type ModuleId } from "./modes";

type Spec =
  | ["num", number, number]
  | ["int", number, number]
  | ["bool"]
  | ["str", RegExp]
  | ["list", Spec, number]
  | ["tuple", Spec[]];

/** What each module may be given, and the ranges that keep a match sane. */
const SCHEMAS: Record<ModuleId, Record<string, Spec>> = {
  doll: {},
  balls: {},
  // [start at s, radius m, shrink over s, exposure per s]
  zone: { phases: ["list", ["tuple", [["num", 0, 1800], ["num", 3, 1400], ["num", 5, 300], ["num", 0.1, 20]]], 8], clock: ["bool"] },
  items: { table: ["str", /^[a-z0-9-]{1,32}$/], density: ["num", 0, 2] },
  airfall: { max: ["int", 0, 3], gap: ["tuple", [["num", 60, 600], ["num", 60, 600]]] },
  vehicles: { count: ["tuple", [["int", 0, 8], ["int", 0, 8]]], kinds: ["list", ["str", /^(danfo|keke|tokunbo)$/], 3] },
  melee: { set: ["str", /^[a-z0-9-]{1,32}$/], props: ["num", 0, 2] },
  flags: {
    count: ["int", 1, 6],
    spots: ["str", /^[a-z-]{1,24}$/],
    claimHold: ["num", 1, 60],
    hints: ["list", ["num", 10, 1200], 6],
    extraAt: ["int", 2, 12],
    holderSlow: ["num", 0, 0.5],
    ping: ["num", 1, 60],
    extractAt: ["num", 30, 1200],
  },
  dropzones: { live: ["int", 1, 6], life: ["num", 10, 300], target: ["int", 1, 20] },
  capture: { moving: ["bool"], speed: ["num", 0, 6], radius: ["num", 3, 30], doubleLast: ["num", 0, 300] },
  economy: { spill: ["num", 0, 1], leaderPing: ["num", 5, 300], banks: ["str", /^[a-z-]{1,24}$/] },
  rooms: { count: ["int", 2, 16], values: ["list", ["int", 1, 10], 16], fuse: ["bool"], keys: ["bool"] },
  tag: { start: ["int", 1, 4], chaserSpeed: ["num", 0.8, 1.3], cures: ["int", 0, 6], curesAt: ["num", 0, 1200] },
  riddles: { every: ["num", 30, 600], need: ["int", 1, 6], wrongCost: ["num", 0, 120], langs: ["list", ["str", /^(yo|ig|ha|pcm|en)$/], 5] },
  blackout: { every: ["tuple", [["num", 20, 600], ["num", 20, 600]]], dim: ["num", 0, 1], findHold: ["num", 0.5, 5] },
  treasure: { need: ["int", 1, 9], boxes: ["int", 1, 80], upload: ["num", 1, 60], area: ["num", 60, 800], heavy: ["num", 0, 0.1], heavyAt: ["int", 0, 9], traps: ["num", 0, 1], ringShrink: ["bool"], pickpocket: ["bool"], pulse: ["num", 0, 600], pulseAt: ["int", 1, 9], bounty: ["bool"] },
  gadgets: {},
  harmattan: {},
  traffic: {},
  zips: {},
  guns: { royale: ["bool"] },
  survival: { bleedAfter: ["num", 120, 1800], bleedRate: ["num", 0, 0.1], route: ["num", 200, 5000], zombies: ["tuple", [["int", 1, 40], ["int", 1, 40], ["int", 1, 40]]] },
};

function fits(v: unknown, s: Spec): boolean {
  switch (s[0]) {
    case "num":
      return typeof v === "number" && Number.isFinite(v) && v >= s[1] && v <= s[2];
    case "int":
      return Number.isInteger(v) && (v as number) >= s[1] && (v as number) <= s[2];
    case "bool":
      return typeof v === "boolean";
    case "str":
      return typeof v === "string" && s[1].test(v);
    case "list":
      return Array.isArray(v) && v.length <= s[2] && v.every((x) => fits(x, s[1]));
    case "tuple":
      return Array.isArray(v) && v.length === s[1].length && v.every((x, i) => fits(x, s[1][i]));
  }
}

/** "rookie-1" → the ladder's division index, or −1 if no such division. */
export function divisionIndex(id: string): number {
  const m = /^([a-z]+)-([1-9])$/.exec(id);
  if (!m) return -1;
  const tier = TIERS.findIndex((t) => t.id === m[1]);
  const div = Number(m[2]);
  return tier < 0 || div > DIVISIONS ? -1 : tier * DIVISIONS + div - 1;
}

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const WINS = new Set(["first", "most", "last", "squad-most", "line"]);

/** The reasons a mode is unfit (empty: fine). */
export function modeErrors(m: unknown): string[] {
  const e: string[] = [];
  if (!m || typeof m !== "object") return ["not an object"];
  const d = m as Partial<ModeDef>;
  if (typeof d.id !== "string" || !ID.test(d.id)) e.push("id");
  if (!Number.isInteger(d.v) || (d.v as number) < 1) e.push("v");
  if (d.family !== "ffa" && d.family !== "survival" && d.family !== "rlgl") e.push("family");
  for (const k of ["name", "blurb"] as const) {
    const t = d[k];
    if (!t || typeof t.en !== "string" || !t.en || t.en.length > 120 || (t.pcm !== undefined && (typeof t.pcm !== "string" || t.pcm.length > 160))) e.push(k);
  }
  if (typeof d.minRank !== "string" || divisionIndex(d.minRank) < 0) e.push("minRank");
  const p = d.players;
  if (!p || !fits(p.min, ["int", 1, 32]) || !fits(p.max, ["int", 1, 32]) || p.min > p.max || !fits(p.squad, ["tuple", [["int", 1, 4], ["int", 1, 4]]]) || p.squad[0] > p.squad[1]) e.push("players");
  if (typeof d.map !== "string" || !/^[a-z0-9:-]{2,40}$/.test(d.map)) e.push("map");
  if (!fits(d.time, ["num", 30, 1800])) e.push("time");
  if (!d.respawn || typeof d.respawn.on !== "boolean" || (d.respawn.delay !== undefined && !fits(d.respawn.delay, ["num", 0, 60]))) e.push("respawn");
  if (!d.win || !WINS.has(d.win.kind)) e.push("win");
  const mods = d.modules;
  if (!mods || typeof mods !== "object" || !Object.keys(mods).length) e.push("modules");
  else {
    for (const [id, params] of Object.entries(mods)) {
      if (!(MODULE_IDS as readonly string[]).includes(id)) {
        e.push(`module ${id}: unknown`);
        continue;
      }
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        e.push(`module ${id}: params`);
        continue;
      }
      const schema = SCHEMAS[id as ModuleId];
      for (const [k, v] of Object.entries(params)) {
        if (!schema[k]) e.push(`${id}.${k}: unknown`);
        else if (!fits(v, schema[k])) e.push(`${id}.${k}: out of range`);
      }
    }
  }
  // Ranked overrides: each must name a real setting and stay in its range.
  for (const [path, v] of Object.entries(d.ranked ?? {})) {
    const [head, key] = path.split(".");
    if (head === "respawn" && key === "on") {
      if (typeof v !== "boolean") e.push(`ranked ${path}`);
    } else if (key === "scale") {
      if (!fits(v, ["num", 0.5, 1])) e.push(`ranked ${path}`);
    } else {
      const spec = (SCHEMAS as Record<string, Record<string, Spec>>)[head]?.[key];
      if (!spec || !fits(v, spec)) e.push(`ranked ${path}`);
    }
  }
  if (d.tags !== undefined && !fits(d.tags, ["list", ["str", /^[a-z-]{1,24}$/], 8])) e.push("tags");
  if (d.tags?.includes("staked") && d.players && d.players.max > 4) e.push("staked: 2–4 seats only (Lagos Life)");
  return e;
}

export interface Checked {
  manifest: Manifest;
  /** Modes dropped, with why. */
  dropped: { id: string; errors: string[] }[];
}

/** Check a manifest from anywhere. Null when the file itself is unusable. */
export function checkManifest(raw: unknown): Checked | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Manifest>;
  if (r.format !== 1 || typeof r.issued !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.issued) || !Array.isArray(r.modes) || r.modes.length > 64) return null;
  const modes: ModeDef[] = [];
  const dropped: Checked["dropped"] = [];
  const seen = new Set<string>();
  for (const m of r.modes) {
    const errors = modeErrors(m);
    const id = typeof (m as ModeDef)?.id === "string" ? (m as ModeDef).id : "?";
    if (!errors.length && seen.has(id)) errors.push("duplicate id");
    if (errors.length) dropped.push({ id, errors });
    else {
      seen.add(id);
      modes.push(m as ModeDef);
    }
  }
  const rotation = Array.isArray(r.rotation) ? r.rotation.filter((x): x is string => typeof x === "string" && seen.has(x)).slice(0, 6) : [];
  return { manifest: { format: 1, issued: r.issued, modes, rotation }, dropped };
}
