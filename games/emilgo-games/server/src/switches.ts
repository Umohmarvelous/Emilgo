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

// ── v8 (A8): the owner's billboards switch ──
// Off by default. While off: no paid ads in any match (every board shows the house's own), the portal says
// billboards aren't open, nothing can be booked, and the lobby's Advertise button is hidden. The owner turns it on
// or off at any time, kept across restarts in DATA_DIR/billboards.json:
//   curl -X POST https://<server>/billboards -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"on":true}'
// BILLBOARDS=on (or off) in the environment sets it at start, over the saved value.

const boardsFile = (): string => join(process.env.DATA_DIR || "./data", "billboards.json");
let boardsOn = false;

export function loadBillboardSwitch(log: (line: string) => void = console.log): void {
  try {
    boardsOn = JSON.parse(readFileSync(boardsFile(), "utf8"))?.on === true;
  } catch {
    boardsOn = false;
  }
  const env = (process.env.BILLBOARDS ?? "").trim().toLowerCase();
  if (env === "on" || env === "1" || env === "true") boardsOn = true;
  else if (env === "off" || env === "0" || env === "false") boardsOn = false;
  log(`billboards: ${boardsOn ? "on" : "off"}`);
}

export function billboardsOn(): boolean {
  return boardsOn;
}

export function setBillboards(on: boolean): void {
  boardsOn = on;
  try {
    mkdirSync(dirname(boardsFile()), { recursive: true });
    writeFileSync(boardsFile(), JSON.stringify({ on }));
  } catch (e) {
    console.error("billboards: couldn't save the switch", e);
  }
}

/** What the phones are told is off: the modes, and "billboards" while the switch is off (the lobby hides Advertise). */
export function offForPhones(off: readonly string[]): string[] {
  return boardsOn ? [...off] : [...off, "billboards"];
}
