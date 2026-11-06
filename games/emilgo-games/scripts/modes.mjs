#!/usr/bin/env node
// The live kill switch, from your terminal. No rebuild, no deploy; every phone
// hears at once. A match already running plays out; no new one starts.
//
//   node scripts/modes.mjs list
//   ADMIN_TOKEN=… node scripts/modes.mjs off hustle lights-out
//   ADMIN_TOKEN=… node scripts/modes.mjs on hustle
//   ADMIN_TOKEN=… node scripts/modes.mjs off survival     (a whole game: ffa, survival, rlgl)
//   ADMIN_TOKEN=… node scripts/modes.mjs clear
//
// SERVER=https://… picks another server (default: the Fly one). With several
// nodes, run it once per node.

const server = (process.env.SERVER || "https://emilgo-games.fly.dev").replace(/\/$/, "");
const [cmd, ...ids] = process.argv.slice(2);

async function now() {
  const r = await fetch(`${server}/modes`);
  if (!r.ok) throw new Error(`the server said ${r.status}: is it deployed with the switch yet?`);
  return (await r.json()).off;
}

async function set(off) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) throw new Error("set ADMIN_TOKEN first (the one you gave `fly secrets set`)");
  const r = await fetch(`${server}/modes`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ off }) });
  if (r.status === 400) throw new Error(`no such mode. Names are in src/config.ts, MODE_SWITCH.`);
  if (!r.ok) throw new Error(`refused (${r.status}): wrong ADMIN_TOKEN?`);
  return (await r.json()).off;
}

try {
  let off;
  if (cmd === "list" || !cmd) off = await now();
  else if (cmd === "off" && ids.length) off = await set([...new Set([...(await now()), ...ids])]);
  else if (cmd === "on" && ids.length) off = await set((await now()).filter((x) => !ids.includes(x)));
  else if (cmd === "clear") off = await set([]);
  else throw new Error("use: list | off <mode…> | on <mode…> | clear");
  console.log(off.length ? `Off now: ${off.join(", ")}` : "Everything is on.");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
