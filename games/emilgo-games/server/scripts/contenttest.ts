// Mode definitions and the content manifest (SPEC-V3 §1.3), no server needed:
// the built-in manifest is clean; bad modes are dropped (and only they); the
// menu follows rank and Ball Haunt's switch; a signed manifest opens with the
// right key and not after a single byte changes.
//
//   node server/build-tools.mjs && node server/dist/contenttest.mjs

import { generateKeyPairSync } from "node:crypto";

import { catalog } from "../../src/content/catalog";
import { openSigned } from "../../src/content/load";
import { BUILTIN_MANIFEST, MODULE_IDS, type ModeDef } from "../../src/content/modes";
import { checkManifest, modeErrors } from "../../src/content/validate";
import { divisionStart } from "../../src/rank/ladder";
import { signManifest } from "../src/content";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

console.log("the built-in manifest:");
const own = checkManifest(BUILTIN_MANIFEST)!;
check(own.dropped.length === 0, `every mode is valid (${own.dropped.map((d) => `${d.id}: ${d.errors.join(", ")}`).join("; ") || "none dropped"})`);
const ffa = BUILTIN_MANIFEST.modes.filter((m) => m.family === "ffa" && !m.tags?.includes("staked"));
check(ffa.length === 10, "ten Free For All modes at launch");
check(BUILTIN_MANIFEST.modes.some((m) => m.tags?.includes("staked") && m.players.max <= 4), "the staked duel: 2–4 seats");
check(BUILTIN_MANIFEST.modes.some((m) => m.family === "survival"), "Dead Streets is there");
check(own.manifest.rotation.length >= 3 && own.manifest.rotation.length <= 4, "a featured rotation of 3–4");

console.log("\nbad modes are dropped, alone:");
const base = BUILTIN_MANIFEST.modes[0];
const bad = (patch: Partial<ModeDef> | ((m: ModeDef) => void), why: string) => {
  const m = structuredClone(base) as ModeDef;
  if (typeof patch === "function") patch(m);
  else Object.assign(m, patch);
  check(modeErrors(m).length > 0, why);
};
bad((m) => ((m.modules as Record<string, unknown>).jetpacks = {}), "an unknown module");
bad((m) => ((m.modules.flags as Record<string, unknown>).claimHold = 9999), "a number out of range");
bad((m) => ((m.modules.zone as Record<string, unknown>).phases = [[0, 2, 1, 1]]), "a zone smaller than a person");
bad((m) => ((m.modules.flags as Record<string, unknown>).fly = true), "a setting the module doesn't have");
bad({ minRank: "emperor-1" }, "a rank that doesn't exist");
bad({ players: { min: 2, max: 30, squad: [1, 4] } }, "more players than a room holds");
bad({ tags: ["staked"], players: { min: 2, max: 12, squad: [1, 4] } }, "a staked mode over 4 seats");
bad({ ranked: { "flags.claimHold": -1 } }, "a Ranked override out of range");
bad({ time: 5 }, "a five-second match");
const mixed = checkManifest({ ...BUILTIN_MANIFEST, modes: [...BUILTIN_MANIFEST.modes, { ...base, id: "broken", modules: { warp: {} } }, base] })!;
check(mixed.manifest.modes.length === BUILTIN_MANIFEST.modes.length && mixed.dropped.length === 2, "one bad mode and a duplicate dropped; the rest kept");
check(checkManifest({ format: 2, modes: [] }) === null && checkManifest("nonsense") === null, "a file that isn't a manifest is refused whole");

console.log("\nthe menu follows the rank:");
const all = new Set<string>(MODULE_IDS);
const ffaPlay = (xp: number) => catalog(BUILTIN_MANIFEST, { xp, built: all }).filter((e) => e.def.family === "ffa" && e.state === "play").length;
check(ffaPlay(0) === 5, "Rookie sees 5 to play");
check(ffaPlay(divisionStart(3)) === 8, "Pro I unlocks 3 more (8)");
check(ffaPlay(divisionStart(6)) === 10, "Legendary I unlocks the last 2 (10)");
const lockedAt = catalog(BUILTIN_MANIFEST, { xp: 0, built: all }).find((e) => e.def.id === "lights-out");
check(lockedAt?.state === "locked" && lockedAt.unlocksAt === "Legendary I", "a locked mode says what opens it");
const now = catalog(BUILTIN_MANIFEST, { xp: 0, ballHaunt: true });
check(now.filter((e) => e.def.family === "ffa").every((e) => e.state === "soon"), "this build: Free For All shows as coming (its modules aren't built yet)");
check(now.some((e) => e.def.id === "ball-haunting" && e.state === "play"), "Ball Haunt on: playable");
check(!catalog(BUILTIN_MANIFEST, { xp: 0, ballHaunt: false }).some((e) => e.def.family === "rlgl"), "Ball Haunt off: not in the menu at all");
check(!now.some((e) => e.def.tags?.includes("staked")), "the staked duel stays off the normal menu");

console.log("\nsigned manifests:");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pub = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64");
const weekly = { ...BUILTIN_MANIFEST, issued: "2026-11-04", rotation: ["hustle", "scarcity", "lights-out"] };
const signed = JSON.parse(signManifest(JSON.stringify(weekly), privateKey));
const opened = await openSigned(signed, pub);
check(opened?.issued === "2026-11-04" && opened.rotation[0] === "hustle", "the right key opens it");
const tampered = { ...signed, body: signed.body.replace('"claimHold":10', '"claimHold":11') };
check((await openSigned(tampered, pub)) === null, "one changed number: refused");
const other = (generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64");
check((await openSigned(signed, other)) === null, "another key: refused");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
