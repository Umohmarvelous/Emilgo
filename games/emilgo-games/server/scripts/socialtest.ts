// End-to-end test of Phase 7's server side (protocol 10): friends, the
// preferences the server acts on, and data saver. Real game server, scripted
// phones.
//
//   A and B connect and say who they are (friend ids). B lists A, A doesn't
//   list B yet: neither sees the other (friendship must be mutual). A asks B
//   (in a room together), B accepts, A adds B: now both see each other. With
//   B's friend requests off, C's request is refused. A makes a private room
//   and invites B: B gets the code. A stranger can't invite B.
//   A brings two boosts (and claims a third): the round's roster carries
//   exactly two for A, none for B. B has data saver on: B gets about half of
//   A's snapshots.
//
//   node server/build-tools.mjs && GAME=ws://localhost:8797 node server/dist/socialtest.mjs

import WebSocket from "ws";

import { NET } from "../../src/config";
import type { ServerMsg } from "../../src/net/protocol";
import { BOOST_IDS, BOOST_SLOTS, boostsFromWire } from "../../src/shop/boosts";

const GAME = process.env.GAME ?? "ws://localhost:8787";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Phone {
  name: string;
  ws: WebSocket;
  id: string;
  fid: string;
  got: ServerMsg[];
  snaps: number;
}

function fid(seed: string): string {
  return (seed.repeat(16) + "AAAAAAAAAAAAAAAA").slice(0, 16);
}

function connect(name: string): Promise<Phone> {
  return new Promise((resolve) => {
    const ws = new WebSocket(GAME);
    const p: Phone = { name, ws, id: "", fid: fid(name), got: [], snaps: 0 };
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: NET.protocol, name })));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      if (m.t === "ping") ws.send(JSON.stringify({ t: "pong", s: m.s }));
      if (m.t === "snap") p.snaps++;
      else p.got.push(m);
      if (m.t === "welcome") {
        p.id = m.id;
        resolve(p);
      }
    });
  });
}
const send = (p: Phone, o: object) => p.ws.send(JSON.stringify(o));
function last<T extends ServerMsg["t"]>(p: Phone, t: T): Extract<ServerMsg, { t: T }> | undefined {
  for (let i = p.got.length - 1; i >= 0; i--) if (p.got[i].t === t) return p.got[i] as Extract<ServerMsg, { t: T }>;
  return undefined;
}
const notes = (p: Phone) => p.got.filter((m): m is Extract<ServerMsg, { t: "note" }> => m.t === "note").map((m) => m.text);

const A = await connect("Ada");
const B = await connect("Bisi");
const C = await connect("Chidi");

console.log("presence (mutual only):");
send(A, { t: "me", fid: A.fid, friends: [] });
send(B, { t: "me", fid: B.fid, friends: [A.fid] });
send(C, { t: "me", fid: C.fid, friends: [B.fid] });
await sleep(200);
check(!!last(B, "fr") && !last(B, "fr")!.on.includes(A.fid), "B lists A, A doesn't list B: B doesn't see A");
check(!last(A, "fr")!.on.includes(B.fid), "and A doesn't see B");

console.log("\nrequests:");
send(A, { t: "create", size: 4 });
await sleep(150);
const code = last(A, "room")?.room.code;
send(B, { t: "join", code });
send(C, { t: "join", code });
await sleep(200);
send(A, { t: "freq", id: B.id });
await sleep(150);
const req = last(B, "freq");
check(!!req && req.fid === A.fid && req.name === "Ada", "B gets A's request, with A's friend id");
check(notes(A).includes("Friend request sent."), "A is told it went");
send(B, { t: "facc", id: req!.id });
await sleep(150);
const acc = last(A, "facc");
check(!!acc && acc.fid === B.fid, "B says yes: A is told B's friend id");
// A forges an accept for C, who never asked: nothing happens.
const before = C.got.length;
send(A, { t: "facc", id: C.id });
await sleep(150);
check(!C.got.slice(before).some((m) => m.t === "facc"), "an accept nobody asked for goes nowhere");
send(A, { t: "me", fid: A.fid, friends: [B.fid] });
await sleep(200);
check(last(A, "fr")!.rm.includes(B.fid) && last(B, "fr")!.rm.includes(A.fid), "now both see each other (in a room)");

send(B, { t: "prefs", bo: [], ds: true, fr: false });
await sleep(100);
send(C, { t: "freq", id: B.id });
await sleep(150);
check(notes(C).some((n) => n.includes("isn't taking friend requests")) && last(B, "freq")?.fid !== C.fid, "B's friend requests off: C's is refused");

console.log("\ninvites:");
send(B, { t: "leave" });
await sleep(150);
send(A, { t: "inv", fid: B.fid });
await sleep(150);
const inv = last(B, "inv");
check(!!inv && inv.code === code && inv.fid === A.fid, `A invites B: B gets the room code (${inv?.code})`);
const before2 = B.got.filter((m) => m.t === "inv").length;
send(C, { t: "inv", fid: B.fid });
await sleep(150);
check(B.got.filter((m) => m.t === "inv").length === before2 && notes(C).some((n) => n.includes("not online")), "C (not B's friend) can't invite B");

console.log("\nboosts and data saver:");
send(B, { t: "join", code });
// Three claimed, two count (and only in free rooms).
send(A, { t: "prefs", bo: [0, 4, 5], ds: false, fr: true });
await sleep(150);
for (const p of [A, B, C]) send(p, { t: "ready", on: true });
const t0 = Date.now();
while (!last(A, "start") && Date.now() - t0 < 8000) await sleep(100);
const start = last(A, "start")?.start;
const ra = start?.roster.find((r) => r.id === A.id);
const rb = start?.roster.find((r) => r.id === B.id);
check(!!start && boostsFromWire(ra?.bo).join() === [BOOST_IDS[0], BOOST_IDS[4]].join() && boostsFromWire(ra?.bo).length === BOOST_SLOTS, `A's boosts in the roster: ${boostsFromWire(ra?.bo).join(", ")} (the third claim dropped)`);
check(!!rb && !rb.bo, "B brought none");
A.snaps = B.snaps = 0;
await sleep(4000);
const ratio = B.snaps / Math.max(1, A.snaps);
check(A.snaps > 40 && ratio > 0.4 && ratio < 0.6, `data saver: B got ${B.snaps} snapshots to A's ${A.snaps}`);

for (const p of [A, B, C]) p.ws.close();
console.log(`\n${failures ? `${failures} FAILED` : "all passed"}`);
process.exit(failures ? 1 : 0);
