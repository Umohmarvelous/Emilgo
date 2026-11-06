// The live kill switch: which modes are off right now, kept across restarts in
// DATA_DIR/modes-off.json. The code's own switches (config.ts MODE_SWITCH,
// FEATURES) still win: this can only turn things off.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { MODE_SWITCH, setLiveOff } from "../../src/config";

const file = (): string => join(process.env.DATA_DIR || "./data", "modes-off.json");

/** Every id the switch knows: a mode, or a whole game. */
function known(id: unknown): id is string {
  return typeof id === "string" && (id in MODE_SWITCH || Object.values(MODE_SWITCH).some((f) => id in f));
}

/** At start: what the last run had off, plus MODES_OFF from the environment. */
export function loadSwitches(log: (line: string) => void = console.log): void {
  let saved: unknown = [];
  try {
    saved = JSON.parse(readFileSync(file(), "utf8"));
  } catch {
    /* no file yet: nothing's off */
  }
  const env = (process.env.MODES_OFF ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const list = [...new Set([...(Array.isArray(saved) ? saved : []), ...env])].filter(known);
  setLiveOff(list);
  if (list.length) log(`modes: off = ${list.join(", ")}`);
}

/** Set what's off and keep it. Null when the list isn't one (an unknown id is a typo: nothing changes). */
export function saveSwitches(list: unknown): string[] | null {
  if (!Array.isArray(list) || !list.every(known)) return null;
  const off = [...new Set(list as string[])];
  setLiveOff(off);
  try {
    mkdirSync(dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify(off));
  } catch (e) {
    console.error("modes: couldn't save the switch", e);
  }
  return off;
}
