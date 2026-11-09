// The live kill switch against a running server:
//   PORT=8798 DATA_DIR=/tmp/x ADMIN_TOKEN=<24+ chars> node server/dist/index.mjs &
//   GAME=ws://localhost:8798 ADMIN_TOKEN=<same> node server/dist/switchtest.mjs

import WebSocket from "ws";

import { NET } from "../../src/config";

const WS = process.env.GAME ?? "ws://localhost:8798";
const HTTP = WS.replace(/^ws/, "http");
const TOKEN = process.env.ADMIN_TOKEN ?? "";
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};
const post = (off: unknown, token = TOKEN) => fetch(`${HTTP}/modes`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ off }) });

const got: Record<string, unknown>[] = [];
const sock = new WebSocket(WS);
await new Promise((ok) => sock.once("open", ok));
sock.on("message", (d) => got.push(JSON.parse(String(d))));
sock.send(JSON.stringify({ t: "hello", v: NET.protocol, name: "Switch" }));
const wait = async (t: string, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const i = got.findIndex((m) => m.t === t);
    if (i >= 0) return got.splice(i, 1)[0];
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
};
const welcome = await wait("welcome");
check(Array.isArray(welcome?.off), "welcome says what's off");

check((await post(["hustle"], "wrong-token-wrong-token-wrong")).status === 404, "a wrong token: refused");
check((await post(["no-such-mode"])).status === 400, "an unknown mode: refused, nothing changes");
check((await post(["hold-the-flag"])).status === 200, "the right token: accepted");
check(JSON.stringify((await wait("modes"))?.off) === '["hold-the-flag"]', "the phone hears at once");
check(JSON.stringify(await (await fetch(`${HTTP}/modes`)).json()) === '{"off":["hold-the-flag"]}', "GET /modes says so");
sock.send(JSON.stringify({ t: "fq", m: "hold-the-flag" }));
check((await wait("err"))?.code === "mode_off", "the queue refuses it");
sock.send(JSON.stringify({ t: "create", size: 8, m: "hold-the-flag" }));
check((await wait("err"))?.code === "mode_off", "a private room refuses it");
await post([]);
await wait("modes");
sock.send(JSON.stringify({ t: "create", size: 8, m: "hold-the-flag" }));
const back = await wait("room");
check(!!back, "back on: it opens again");
sock.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
