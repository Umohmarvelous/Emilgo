// The services split (v6 max, 3.12), offline: no Redis, no deploy needed.
//
//   the Redis client   against a small RESP server here (the commands the
//                      services use: strings, lists in a MULTI, sorted sets,
//                      hashes, publish/subscribe, AUTH from the URL)
//   two nodes          two Presence objects sharing one store: a friend on the
//                      other node shows online, a message crosses, one for a
//                      friend who is off waits and arrives on another node
//   the leaderboard    a week's XP, two copies of the game kept apart
//   analytics          batched lines, nothing that says who
//   the profile service  started on its own; a node's client warms, awards,
//                      commends, deletes; a wrong secret is refused
//
//   npx tsx server/scripts/servicestest.ts

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ServerMsg } from "../../src/net/protocol";
import { Analytics } from "../src/analytics";
import { isoWeek, Leaderboard } from "../src/leaderboard";
import type { Peer } from "../src/peer";
import { Presence } from "../src/presence";
import { HttpProfiles } from "../src/profiles";
import { encode, parseReply, type Reply } from "../src/redis";
import { MemoryShared, RedisShared, type Shared } from "../src/shared";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log("RESP:");
{
  const b = encode(["SET", "k", "héllo"]);
  check(b.toString() === "*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$6\r\nhéllo\r\n", "commands are encoded with byte lengths (UTF-8)");
  const r = parseReply(Buffer.from("*3\r\n$5\r\nhello\r\n:42\r\n$-1\r\n"));
  check(!!r && JSON.stringify(r[0]) === JSON.stringify(["hello", 42, null]), "arrays, bulk strings, integers and nil are read");
  check(parseReply(Buffer.from("$5\r\nhel")) === null, "a reply still arriving waits");
}

// ── A tiny RESP server: enough Redis for the services ──
function fakeRedis(password: string): Promise<{ url: string; close(): void }> {
  const kv = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const zsets = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Map<string, string>>();
  const subs = new Map<string, Set<Socket>>();
  const reply = (v: Reply | Error): string => {
    if (v instanceof Error) return `-${v.message}\r\n`;
    if (v === null) return "$-1\r\n";
    if (typeof v === "number") return `:${v}\r\n`;
    if (Array.isArray(v)) return `*${v.length}\r\n${v.map((x) => reply(x)).join("")}`;
    return `$${Buffer.byteLength(v)}\r\n${v}\r\n`;
  };
  const run = (sock: Socket & { authed?: boolean; tx?: string[][] | null }, a: string[]): Reply | Error => {
    const c = a[0].toUpperCase();
    if (c === "AUTH") {
      sock.authed = a[a.length - 1] === password;
      return sock.authed ? "OK" : new Error("WRONGPASS");
    }
    if (!sock.authed) return new Error("NOAUTH");
    if (c === "MULTI") {
      sock.tx = [];
      return "OK";
    }
    if (c === "EXEC") {
      const tx = sock.tx ?? [];
      sock.tx = null;
      return tx.map((x) => {
        const v = run(sock, x);
        return v instanceof Error ? v.message : v;
      });
    }
    if (sock.tx) {
      sock.tx.push(a);
      return "QUEUED";
    }
    switch (c) {
      case "SET":
        kv.set(a[1], a[2]);
        return "OK";
      case "MGET":
        return a.slice(1).map((k) => kv.get(k) ?? null);
      case "DEL":
        return [kv.delete(a[1]), lists.delete(a[1])].filter(Boolean).length;
      case "EXPIRE":
        return 1;
      case "RPUSH": {
        const l = lists.get(a[1]) ?? [];
        l.push(a[2]);
        lists.set(a[1], l);
        return l.length;
      }
      case "LTRIM": {
        const l = lists.get(a[1]) ?? [];
        lists.set(a[1], l.slice(Number(a[2])));
        return "OK";
      }
      case "LRANGE":
        return [...(lists.get(a[1]) ?? [])];
      case "ZINCRBY": {
        const z = zsets.get(a[1]) ?? new Map<string, number>();
        z.set(a[3], (z.get(a[3]) ?? 0) + Number(a[2]));
        zsets.set(a[1], z);
        return String(z.get(a[3]));
      }
      case "ZREVRANGE": {
        const s = [...(zsets.get(a[1]) ?? new Map<string, number>())].sort((x, y) => y[1] - x[1]).slice(Number(a[2]), Number(a[3]) + 1);
        return s.flatMap(([m, v]) => [m, String(v)]);
      }
      case "ZREVRANK": {
        const s = [...(zsets.get(a[1]) ?? new Map<string, number>())].sort((x, y) => y[1] - x[1]);
        const i = s.findIndex(([m]) => m === a[2]);
        return i < 0 ? null : i;
      }
      case "ZSCORE": {
        const v = zsets.get(a[1])?.get(a[2]);
        return v === undefined ? null : String(v);
      }
      case "HSET": {
        const h = hashes.get(a[1]) ?? new Map<string, string>();
        h.set(a[2], a[3]);
        hashes.set(a[1], h);
        return 1;
      }
      case "HMGET":
        return a.slice(2).map((f) => hashes.get(a[1])?.get(f) ?? null);
      case "PUBLISH": {
        const to = subs.get(a[1]) ?? new Set();
        for (const s of to) s.write(reply(["message", a[1], a[2]]));
        return to.size;
      }
      case "SUBSCRIBE":
        for (const ch of a.slice(1)) {
          const set = subs.get(ch) ?? new Set<Socket>();
          set.add(sock);
          subs.set(ch, set);
          sock.write(reply(["subscribe", ch, set.size]));
        }
        return null;
      default:
        return new Error(`unknown ${c}`);
    }
  };
  const server = createServer((sock) => {
    let buf: Buffer = Buffer.alloc(0);
    sock.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const r = parseReply(buf);
        if (!r) break;
        buf = buf.subarray(r[1]);
        const out = run(sock, (r[0] as string[]).map(String));
        if (!(Array.isArray(r[0]) && String(r[0][0]).toUpperCase() === "SUBSCRIBE")) sock.write(reply(out));
      }
    });
    sock.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
    resolve({ url: `redis://:${password}@127.0.0.1:${port}`, close: () => server.close() });
  }));
}

console.log("\nthe Redis client and the shared store:");
const fake = await fakeRedis("s3cret-pass");
{
  const r = new RedisShared(fake.url);
  await r.setJson("pres:A", { n: "A", f: ["B"] }, 90);
  const [a, none] = await r.getJson(["pres:A", "pres:Z"]);
  check(JSON.stringify(a) === JSON.stringify({ n: "A", f: ["B"] }) && none === null, "JSON keys in and out (AUTH from the URL)");
  for (let i = 0; i < 25; i++) await r.push("held:B", { i }, 86400, 20);
  const drained = (await r.drain("held:B")) as { i: number }[];
  check(drained.length === 20 && drained[0].i === 5 && drained[19].i === 24 && (await r.drain("held:B")).length === 0, "a list keeps the newest 20 and drains once (in a MULTI)");
  await r.zincr("lb:t", "a", 50, 60);
  await r.zincr("lb:t", "b", 80, 60);
  await r.zincr("lb:t", "a", 40, 60);
  const top = await r.ztop("lb:t", 5);
  check(JSON.stringify(top) === JSON.stringify([["a", 90], ["b", 80]]) && (await r.zrank("lb:t", "b"))?.place === 1, "sorted sets add up and rank");
  const got: unknown[] = [];
  r.subscribe("dm:A", (m) => got.push(m));
  await sleep(150);
  r.publish("dm:A", { to: "x", text: "hi" });
  await sleep(150);
  check(got.length === 1 && (got[0] as { text: string }).text === "hi", "publish and subscribe (a connection of its own)");
  r.close();
}

console.log("\ntwo nodes, one store:");
function fakePeer(name: string, _fid: string, friends: string[]): Peer & { got: ServerMsg[] } {
  const got: ServerMsg[] = [];
  return {
    id: name, name, fid: "", friendFids: new Set(friends), connected: true, acceptsDms: true, acceptsReqs: true, asked: new Set<string>(), got,
    send: (m: ServerMsg) => got.push(m),
    blockedWith: () => false,
    allowChat: () => true,
  } as unknown as Peer & { got: ServerMsg[] };
}
async function twoNodes(shared: Shared, label: string): Promise<void> {
  const lobby = { roomOf: () => undefined };
  const n1 = new Presence(lobby, shared, "A");
  const n2 = new Presence(lobby, shared, "B");
  const FA = "AAAAAAAAAAAAAAAA";
  const FB = "BBBBBBBBBBBBBBBB";
  const ada = fakePeer("Ada", FA, [FB]);
  const bisi = fakePeer("Bisi", FB, [FA]);
  n1.identify(ada, FA, [FB]);
  n2.identify(bisi, FB, [FA]);
  await sleep(100);
  await n1.tell(ada);
  const fr = [...ada.got].reverse().find((m) => m.t === "fr") as Extract<ServerMsg, { t: "fr" }> | undefined;
  check(!!fr && fr.on.includes(FB), `${label}: Ada (node A) sees Bisi (node B) online`);
  n1.dm(ada, FB, "see you in the Hunt", 1);
  await sleep(150);
  const dm = bisi.got.find((m) => m.t === "dm") as Extract<ServerMsg, { t: "dm" }> | undefined;
  check(dm?.text === "see you in the Hunt" && dm.fid === FA, `${label}: a message crosses nodes`);
  check(ada.got.some((m) => m.t === "dmack" && m.ok === 1), `${label}: and the sender hears it went`);
  // Bisi goes; a message waits; Bisi comes back on node A.
  (bisi as { connected: boolean }).connected = false;
  n2.forget(bisi);
  await sleep(100);
  n1.dm(ada, FB, "still on for tonight?", 2);
  await sleep(150);
  check(ada.got.some((m) => m.t === "dmack" && m.n === 2 && m.held === 1), `${label}: Bisi off: it's held`);
  const back = fakePeer("Bisi", FB, [FA]);
  n1.identify(back, FB, [FA]);
  await sleep(150);
  check(back.got.some((m) => m.t === "dm" && m.text === "still on for tonight?"), `${label}: Bisi back (on the other node): it arrives`);
  const ev = await n1.evidence(FA, FB);
  check(ev.length === 2 && ev[1].includes("tonight"), `${label}: the lines passed are kept for a report (${ev.length})`);
  const stranger = fakePeer("Chidi", "CCCCCCCCCCCCCCCC", [FB]);
  n2.identify(stranger, "CCCCCCCCCCCCCCCC", [FB]);
  await sleep(50);
  n2.dm(stranger, FB, "hey", 3);
  await sleep(150);
  check(!back.got.some((m) => m.t === "dm" && m.text === "hey") && stranger.got.some((m) => m.t === "dmack" && !!m.why), `${label}: a stranger's message never crosses`);
}
await twoNodes(new MemoryShared(), "memory");
await twoNodes(new RedisShared(fake.url), "redis");

console.log("\nthe leaderboard:");
{
  check(isoWeek(Date.UTC(2026, 10, 11)) === "2026-W46" && isoWeek(Date.UTC(2027, 0, 1)) === "2026-W53" && isoWeek(Date.UTC(2026, 0, 1)) === "2026-W01", "ISO weeks (2026-W46 today; New Year's Day 2027 is still 2026-W53)");
  const lb = new Leaderboard(new MemoryShared());
  lb.add("em:" + "a".repeat(40), "Ada", 300);
  lb.add("em:" + "b".repeat(40), "Bisi", 500);
  lb.add("em:" + "a".repeat(40), "Ada", 400);
  lb.add("ll:live:p1", "Tunde", 900);
  await sleep(20);
  const b = await lb.top("em", 10, "em:" + "a".repeat(40));
  check(b.rows.length === 2 && b.rows[0].name === "Ada" && b.rows[0].xp === 700 && b.rows[0].you === true && b.me?.place === 1, "a week's XP adds up, highest first, and you're marked");
  const l = await lb.top("ll", 10, null);
  check(l.rows.length === 1 && l.rows[0].name === "Tunde", "Lagos Life's board and EMILGO's never mix");
}

console.log("\nanalytics:");
{
  const dir = mkdtempSync(join(tmpdir(), "an-"));
  const a = new Analytics({ dir }, "A", 1e9);
  a.track("match_end", { mode: "treasure-hunt", players: 12, id: "secret-player", name: "Ada", fid: "AAAA" });
  await a.close();
  const file = readdirSync(dir).find((f) => f.endsWith(".ndjson"));
  const line = file ? JSON.parse(readFileSync(join(dir, file), "utf8").trim()) : null;
  check(!!line && line.e === "match_end" && line.mode === "treasure-hunt" && line.players === 12 && !("id" in line) && !("name" in line) && !("fid" in line), "a batch is written; ids and names never are");
}

console.log("\nthe profile service:");
{
  const dir = mkdtempSync(join(tmpdir(), "pf-"));
  const port = 8810 + Math.floor(Math.random() * 100);
  const secret = "a-long-service-secret-123";
  const child = spawn(process.execPath, ["--import", "tsx", "server/src/profileMain.ts"], { env: { ...process.env, PORT: String(port), SERVICE_SECRET: secret, DATA_DIR: dir }, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${url}/health`)).ok) break;
    } catch {
      await sleep(200);
    }
  }
  const key = "em:" + "c".repeat(40);
  const pc = new HttpProfiles(url, secret);
  await pc.warm(key);
  check(pc.get(key) === null, "a new player: no profile yet");
  const p1 = pc.award(key, 250, true, "2026-11-11");
  check(p1.xp === 250 && p1.wins === 1 && p1.streak === 1, "an award shows at once on the node");
  await sleep(300);
  const other = new HttpProfiles(url, secret);
  await other.warm(key);
  check(other.get(key)?.xp === 250 && other.get(key)?.matches === 1, "and is stored: another node sees it");
  other.commend(key);
  await sleep(300);
  await pc.warm(key);
  check(pc.get(key)?.honour === 1, "a commend from any node counts once");
  const bad = await fetch(`${url}/v1/profiles/${key}`, { headers: { Authorization: "Bearer wrong" } });
  check(bad.status === 401, "a wrong secret is refused");
  const wild = await fetch(`${url}/v1/profiles/${key}/award`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ xp: 1e9, won: true, day: "2026-11-11" }) });
  check(wild.status === 400, "a wild award is refused, not stored");
  pc.remove(key);
  await sleep(300);
  await other.warm(key);
  const gone = await fetch(`${url}/v1/profiles/${key}`, { headers: { Authorization: `Bearer ${secret}` } });
  check(gone.status === 404, "deleted on request");
  child.kill("SIGTERM");
}

fake.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
