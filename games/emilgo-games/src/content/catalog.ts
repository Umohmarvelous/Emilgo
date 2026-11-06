// Which modes a player sees, and in what state (SPEC-V3 §1.2, §2.4, §9):
// playable, locked behind a rank, coming (this build lacks a module), or not
// shown at all (Ball Haunt while its switch is off).

import { familyOn, FEATURES, modeOn } from "../config";
import { divisionStart, rankOf } from "../rank/ladder";
import { BUILT, type Family, type Manifest, type ModeDef } from "./modes";
import { divisionIndex } from "./validate";

export type ModeState = "play" | "locked" | "soon";

export interface ModeEntry {
  def: ModeDef;
  state: ModeState;
  /** For "locked": the rank that opens it ("Pro I"). */
  unlocksAt?: string;
}

export interface CatalogOptions {
  /** The player's total rank XP. */
  xp: number;
  /** Ball Haunt's switch (FEATURES.ballHaunt unless a test says otherwise). */
  ballHaunt?: boolean;
  /** A test server: the modes tagged "dev" too. */
  dev?: boolean;
  /** The modules this build can play (BUILT unless a test says otherwise). */
  built?: ReadonlySet<string>;
}

/** Can this build play the mode at all (every module it needs is built)? */
export function buildable(def: ModeDef, built: ReadonlySet<string> = BUILT): boolean {
  return Object.keys(def.modules).every((m) => built.has(m));
}

/** Every mode the player should see, in the manifest's order. Ball Haunt is left out while it's off. */
export function catalog(manifest: Manifest, o: CatalogOptions): ModeEntry[] {
  const on = o.ballHaunt ?? FEATURES.ballHaunt;
  const k = rankOf(o.xp).k;
  const out: ModeEntry[] = [];
  for (const def of manifest.modes) {
    if (def.family === "rlgl" && !on) continue;
    if (def.family !== "rlgl" && !familyOn(def.family)) continue;
    if (!modeOn(def.id)) continue; // the kill switch (config MODE_SWITCH, or the live one)
    if (def.tags?.includes("dev") && !o.dev) continue;
    if (def.tags?.includes("staked")) continue; // the staked duel has its own path (Lagos Life match)
    const need = divisionIndex(def.minRank);
    if (!buildable(def, o.built)) out.push({ def, state: "soon" });
    else if (k < need) out.push({ def, state: "locked", unlocksAt: rankOf(divisionStart(need)).name });
    else out.push({ def, state: "play" });
  }
  return out;
}

/** The modes of one family that can be played now. */
export function playable(manifest: Manifest, family: Family, o: CatalogOptions): ModeDef[] {
  return catalog(manifest, o)
    .filter((e) => e.def.family === family && e.state === "play")
    .map((e) => e.def);
}

export interface GameEntry {
  id: Family;
  name: string;
  state: ModeState;
  /** "10 modes", "Unlocks at Pro I". */
  sub: string;
}

const FAMILY_NAME: Record<Family, string> = { survival: "Dead Streets", ffa: "Free For All", rlgl: "Ball Haunt" };

/** The Play menu's strip of games: one entry per family the player can see (SPEC-V3: Ball Haunt only while it's on). */
export function games(manifest: Manifest, o: CatalogOptions): GameEntry[] {
  const list = catalog(manifest, o);
  const order: Family[] = ["survival", "ffa", "rlgl"];
  const out: GameEntry[] = [];
  for (const f of order) {
    const mine = list.filter((e) => e.def.family === f);
    if (!mine.length) continue;
    const play = mine.filter((e) => e.state === "play").length;
    const state: ModeState = play ? "play" : mine.some((e) => e.state === "locked") ? "locked" : "soon";
    const sub = mine.length > 1 ? `${mine.length} modes` : "";
    out.push({ id: f, name: FAMILY_NAME[f], state, sub });
  }
  // What can be played comes first (on a phone held upright the strip scrolls sideways).
  return out.sort((a, b) => Number(b.state === "play") - Number(a.state === "play"));
}
