// Read-only check of the REAL Lagos Life API with our keys, before trusting it
// with players. Three harmless calls; prints status codes and error codes only,
// never a key. Nothing is created, bought or settled.
//
//   node server/build-tools.mjs && node --env-file=server/.env server/dist/apicheck.mjs
//
// What we expect (from the docs, and what server/src/vatar.ts relies on):
//   GET  /purchases/__keycheck__   404 not_found  (the secret works)
//   POST /session/verify (junk)    401            (sessions really are checked)
//   GET  /matches/__keycheck__     404 not_found, or 403 if matches are off

import { VatarApi, VatarError, vatarConfigFromEnv } from "../src/vatar";

const cfg = vatarConfigFromEnv(process.env);
if (!cfg) {
  console.log("no VATAR_SECRET / VATAR_RESULTS_SECRET in the environment");
  process.exit(1);
}
const api = new VatarApi(cfg);
console.log(`api ${cfg.api}, ${api.mode} mode\n`);

let surprises = 0;
async function probe(label: string, run: () => Promise<unknown>, want: (e: VatarError) => boolean): Promise<void> {
  try {
    await run();
    console.log(`  ✗ ${label}: answered 200 (expected an error)`);
    surprises++;
  } catch (e) {
    const err = e instanceof VatarError ? e : new VatarError(0, "network", String(e));
    const ok = want(err);
    if (!ok) surprises++;
    const msg = err.message && err.message !== err.code ? ` — ${err.message.slice(0, 120)}` : "";
    console.log(`  ${ok ? "✓" : "✗"} ${label}: ${err.http || "no answer"} ${err.code}${msg}`);
  }
}

await probe("purchase that doesn't exist", () => api.getPurchase("__keycheck__"), (e) => e.http === 404);
await probe("junk session", () => api.verifySession("vtr1.junk"), (e) => e.http === 401);
await probe("match that doesn't exist", () => api.getMatch("__keycheck__"), (e) => e.http === 404 || e.http === 403);

console.log(`\n${surprises ? `${surprises} differ from what the server expects` : "the real API answers as the server expects"}`);
process.exit(surprises ? 1 : 0);
