// The room directory (v4 Phase 10): which node a phone is sent to.
//   node server/dist/dirtest.mjs
import { Directory, type Beat } from "../src/directory";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};

let now = 0;
const dir = new Directory(() => now);
const beat = (shard: string, peers: number, extra: Partial<Beat> = {}) =>
  dir.beat({ shard, url: `wss://node-${shard}.test`, peers, cap: 2000, rooms: 0, playing: 0, tickP99: 2, rssMb: 100, draining: false, ...extra });

check("no nodes: nobody to send to", dir.pick() === null);
beat("A", 1500);
beat("B", 200);
beat("C", 900);
check("quick play goes to the emptiest node", dir.pick()?.shard === "B");
// A burst: the directory counts who it sent since the last beat, so it spreads.
const sent = new Map<string, number>();
for (let i = 0; i < 2000; i++) {
  const n = dir.pick();
  if (n) sent.set(n.shard, (sent.get(n.shard) ?? 0) + 1);
}
check(`a burst of 2,000 spreads (A ${sent.get("A") ?? 0}, B ${sent.get("B") ?? 0}, C ${sent.get("C") ?? 0})`, (sent.get("B") ?? 0) > (sent.get("C") ?? 0) && (sent.get("C") ?? 0) > 0);
check("nobody past a node's cap", (sent.get("A") ?? 0) <= 500);
beat("A", 1500);
beat("B", 200);
beat("C", 900);
check("a code goes to the node its first letter names", dir.pick("CXYZQW")?.shard === "C");
check("a code on no live node: not found", dir.pick("ZABCDE") === null);
const m1 = dir.pick("v:match-123")?.shard;
check("a Lagos Life match: the same node every time", dir.pick("v:match-123")?.shard === m1 && dir.pick("v:match-123")?.shard === m1);
const spread = new Set<string>();
for (let i = 0; i < 60; i++) spread.add(dir.pick(`v:m${i}`)?.shard ?? "");
check("matches spread over the nodes", spread.size === 3);
beat("B", 200, { tickP99: 20 });
check("a node with long ticks is passed over", dir.pick()?.shard === "C");
beat("B", 200, { draining: true });
beat("C", 900);
check("a draining node gets no quick play", dir.pick()?.shard === "C");
check("a draining node keeps its codes (mid-match rejoins)", dir.pick("BABCDE")?.shard === "B");
beat("B", 200);
// Rendezvous: B leaving moves only B's matches.
const before = new Map<string, string>();
for (let i = 0; i < 60; i++) before.set(`v:k${i}`, dir.pick(`v:k${i}`)!.shard);
now += 7000;
beat("A", 1500);
beat("C", 900);
check("a node that stops beating is gone", dir.live().every((n) => n.shard !== "B"));
let moved = 0;
for (const [k, s] of before) if (s !== "B" && dir.pick(k)?.shard !== s) moved++;
check("only the gone node's matches move", moved === 0);
let threw = false;
try {
  dir.beat({ shard: "A", url: "wss://impostor.test", peers: 0, cap: 10, rooms: 0, playing: 0, tickP99: 0, rssMb: 0, draining: false });
} catch {
  threw = true;
}
check("a second node can't take a live node's letter", threw);
console.log(`\ndirectory: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
