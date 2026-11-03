// Load test: N scripted players connect, quick-match into rooms of 20, and play
// real rounds against the server — run while she sings, stop after a human-ish
// reaction when she turns, flinch now and then. Half play Ball Haunting at
// 100 m: they grab at balls and throw fists, slaps and pushes while she sings,
// so the referee's fighting and the ball snapshots are under load too. They
// re-queue after each round so the load stays up for the whole run.
//
//   npm run loadtest -- --clients 1200 --seconds 90 --url ws://localhost:8787
//
// Free For All (SPEC-V3 Phase 4): --ffa find-the-flag puts a share of the
// clients (--share, default all) in that mode's public queue instead: rooms of
// 12 running the match core; they wander, sprint, swing, search and re-queue
// after each match. Red Light, Green Light needs BALL_HAUNT=1 on the server
// while FEATURES.ballHaunt is off.
//
// Run the server with MAX_PER_IP raised (every client comes from one address):
//   MAX_PER_IP=100000 npm run server:start
//
// v4 (Phase 10): the Free For All clients shoot (the aim's yaw and pitch, the
// trigger in bursts, reloads), so the hitscan, the lag rewind and the breakables
// are under load. --ffa takes a list (find-the-flag,max-royale: the clients
// split across them). --dir http://localhost:8800 asks the room directory
// where each client goes (many server processes); --procs N spreads the clients
// over N load processes (one Node process can't drive 10,000 sockets alone).
// --menu 0.8 keeps that share in the menus (connected, answering pings, in no
// room): most of a live crowd at any moment, and the only way one laptop holds
// 10,000 sockets with the rest really playing.
//
//   node server/scripts/cluster.mjs 6        (a directory + 6 nodes on this machine)
//   node server/dist/loadtest.mjs --clients 10000 --seconds 180 --dir http://localhost:8800 --ffa find-the-flag,max-royale --procs 4
//
// These scripted clients are a test tool only. They never exist in a real room.

import { fork } from "node:child_process";

import WebSocket from "ws";

import { FLOW, NET } from "../../src/config";
import { phaseAt, type ServerMsg } from "../../src/net/protocol";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const CLIENTS = Number(args.get("clients") ?? 600);
const SECONDS = Number(args.get("seconds") ?? 75);
const URL_ = args.get("url") ?? "ws://localhost:8787";
const HTTP = URL_.replace(/^ws/, "http");
const FFA = args.get("ffa") ?? "";
const FFA_MODES = FFA.split(",").filter(Boolean);
const SHARE = FFA ? Number(args.get("share") ?? 1) : 0;
const DIR = args.get("dir") ?? "";
const PROCS = Math.max(1, Number(args.get("procs") ?? 1));
/** The share of clients in the menus (connected, answering pings, not in a room): most of a live crowd at any moment. */
const MENU = Number(args.get("menu") ?? 0);
const WORKER = args.has("worker") ? Number(args.get("worker")) : -1;

const stats = {
  connected: 0,
  failed: 0,
  rounds: 0,
  finished: 0,
  caught: 0,
  timedOut: 0,
  bytesIn: 0,
  msgsIn: 0,
  snapGapMs: [] as number[],
  matches: 0,
  ffaGapMs: [] as number[],
  shots: 0,
  hits: 0,
  kills: 0,
  refused: 0,
};

/** Where a client connects: the one server, or the node the directory picks. */
async function whereTo(): Promise<string> {
  if (!DIR) return URL_;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`${DIR}/dir/pick`);
      if (r.ok) return ((await r.json()) as { url: string }).url;
    } catch {
      /* try again */
    }
    await new Promise((r) => setTimeout(r, 300 + i * 500));
  }
  stats.refused++;
  return URL_;
}

function bot(n: number): void {
  if (MENU && (n % 100) / 100 >= 1 - MENU) return void menuBot(n);
  if (FFA && (n % 100) / 100 < SHARE) return void ffaBot(n);
  const ws = new WebSocket(URL_);
  let me = -1;
  let myId = "";
  let phase = "countdown";
  let phaseAtMs = 0;
  let reaction = 0.3;
  let flinchAt = Infinity;
  let lastSnap = 0;
  let sent = { x: 0, z: 0 };
  let timer: NodeJS.Timeout | null = null;
  const balls = n % 2 === 1;
  const queue = balls ? { t: "quick", mode: "balls", dist: 100 } : { t: "quick", mode: "classic", dist: 200 };
  let a = 0;
  let g = 0;
  let ready = false;

  const send = (o: object) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  const input = (x: number, z: number, force = false) => {
    if (!force && x === sent.x && z === sent.z) return;
    sent = { x, z };
    send({ t: "in", x, z, a, g });
  };

  ws.on("open", () => {
    stats.connected++;
    send({ t: "hello", v: NET.protocol, name: `Load ${n}` });
  });
  ws.on("error", (e) => {
    if (++stats.failed <= 3) console.log(`connect error: ${e.message}`);
  });
  ws.on("message", (data) => {
    const raw = data.toString();
    stats.bytesIn += raw.length;
    stats.msgsIn++;
    const m = JSON.parse(raw) as ServerMsg;
    switch (m.t) {
      case "welcome":
        myId = m.id;
        send(queue);
        break;
      case "ping":
        send({ t: "pong", s: m.s });
        break;
      case "room":
        // Tick ready in the waiting room, like a person who's keen to play.
        if (m.room.state === "lobby" && !ready && !m.room.map) {
          ready = true;
          setTimeout(() => send({ t: "ready", on: true }), 300 + Math.random() * 2000);
        }
        break;
      case "start":
        stats.rounds++;
        ready = false;
        // Most skip the walkout as soon as they can; the rest watch it to the end.
        if (m.start.wo && Math.random() < 0.8) setTimeout(() => send({ t: "skip" }), FLOW.walk * 1000 + Math.random() * 3000);
        me = m.start.roster.findIndex((r) => r.id === myId);
        sent = { x: 0, z: 0 };
        lastSnap = 0; // spacing is measured within a round, not across the wait between rounds
        if (timer) clearInterval(timer);
        timer = setInterval(think, 1000 / NET.inputHz);
        break;
      case "snap": {
        const t = Date.now();
        if (lastSnap) stats.snapGapMs.push(t - lastSnap);
        if (stats.snapGapMs.length > 20000) stats.snapGapMs.splice(0, 10000);
        lastSnap = t;
        break;
      }
      case "ev":
        if (m.k === "ph") {
          phase = phaseAt(m.ph);
          phaseAtMs = Date.now();
          reaction = 0.15 + Math.random() * 0.45;
          flinchAt = phase === "watch" && Math.random() < 0.08 ? Math.random() * 2000 : Infinity;
        } else if (m.k === "out" && m.i === me) {
          if (m.c === 0) stats.caught++;
          else stats.timedOut++;
        } else if (m.k === "fin" && m.i === me) {
          stats.finished++;
        } else if (m.k === "end") {
          if (timer) clearInterval(timer);
          timer = null;
          lastSnap = 0;
          // Back in the queue after a pause, like a person reading results.
          setTimeout(() => send(queue), 1500 + Math.random() * 3000);
        }
        break;
    }
  });

  function think(): void {
    const since = (Date.now() - phaseAtMs) / 1000;
    const run = () => input(Math.round((Math.random() - 0.5) * 20), -100);
    if (balls && phase === "sing" && Math.random() < 0.08) {
      // A grab or a swing every so often (the referee ignores the ones out of reach).
      if (Math.random() < 0.5) g = (g + 1) & 255;
      else a = ((((a >> 2) + 1) & 63) << 2) | (1 + Math.floor(Math.random() * 3));
      input(sent.x, sent.z, true);
      return;
    }
    if (phase === "sing") run();
    else if (phase === "turning") since < reaction ? run() : input(0, 0);
    else if (phase === "watch") since * 1000 > flinchAt && since * 1000 < flinchAt + 250 ? run() : input(0, 0);
    else input(0, 0);
  }
}

/** A client in the menus: connected (through the directory), says hello, answers pings, plays nothing. */
async function menuBot(n: number): Promise<void> {
  const ws = new WebSocket(await whereTo(), { perMessageDeflate: false });
  const send = (o: object) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  ws.on("open", () => {
    stats.connected++;
    send({ t: "hello", v: NET.protocol, name: `Menu ${n}` });
  });
  ws.on("error", (e) => {
    if (++stats.failed <= 3) console.log(`connect error: ${e.message}`);
  });
  ws.on("message", (data) => {
    const raw = data.toString();
    stats.bytesIn += raw.length;
    stats.msgsIn++;
    const m = JSON.parse(raw) as ServerMsg;
    if (m.t === "ping") send({ t: "pong", s: m.s });
  });
}

/** A Free For All client: the public queue, then wandering, sprinting, swinging, searching and shooting until the match ends. */
async function ffaBot(n: number): Promise<void> {
  const mode = FFA_MODES[n % FFA_MODES.length];
  const ws = new WebSocket(await whereTo(), { perMessageDeflate: false });
  const queue = { t: "fq", m: mode };
  const inp = { x: 0, z: 0, b: 0, a: 0, g: 0, i: 0, k: 0, y: 0, p: 0, w: 0 };
  let timer: NodeJS.Timeout | null = null;
  let lastSnap = 0;
  let turnAt = 0;
  let burstTo = 0;
  let reloads = 0;
  let myId = "";
  let me = -1;
  const send = (o: object) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  ws.on("open", () => {
    stats.connected++;
    send({ t: "hello", v: NET.protocol, name: `Load ${n}` });
  });
  ws.on("error", (e) => {
    if (++stats.failed <= 3) console.log(`connect error: ${e.message}`);
  });
  ws.on("message", (data) => {
    const raw = data.toString();
    stats.bytesIn += raw.length;
    stats.msgsIn++;
    // Snapshots are most of the traffic: counted, not parsed (a phone parses its own; a load box would melt).
    if (raw.startsWith('{"t":"msnap"')) {
      const t = Date.now();
      if (lastSnap) stats.ffaGapMs.push(t - lastSnap);
      if (stats.ffaGapMs.length > 20000) stats.ffaGapMs.splice(0, 10000);
      lastSnap = t;
      return;
    }
    const m = JSON.parse(raw) as ServerMsg;
    switch (m.t) {
      case "welcome":
        myId = m.id;
        send(queue);
        break;
      case "ping":
        send({ t: "pong", s: m.s });
        break;
      case "start":
        if (!m.start.ffa) break;
        stats.matches++;
        me = m.start.roster.findIndex((r) => r.id === myId);
        lastSnap = 0;
        if (timer) clearInterval(timer);
        timer = setInterval(think, 1000 / NET.inputHz);
        break;
      case "mev":
        // Bodies go by their roster index on the wire.
        for (const e of m.e as { k: string; by?: number; id?: number }[]) {
          if (e.k === "fire" && e.id === me) stats.shots++;
          else if (e.k === "dmg" && e.by === me) stats.hits++;
          else if (e.k === "kill" && e.by === me) stats.kills++;
        }
        if (m.e.some((e) => e.k === "ended")) {
          if (timer) clearInterval(timer);
          timer = null;
          lastSnap = 0;
          setTimeout(() => send(queue), 1500 + Math.random() * 3000);
        }
        break;
    }
  });
  function think(): void {
    const t = Date.now();
    if (t > turnAt) {
      // A new heading every few seconds; now and then a stop.
      turnAt = t + 1500 + Math.random() * 4000;
      const a = Math.random() * Math.PI * 2;
      const stop = Math.random() < 0.15;
      inp.x = stop ? 0 : Math.round(Math.cos(a) * 100);
      inp.z = stop ? 0 : Math.round(Math.sin(a) * 100);
      inp.b = Math.random() < 0.4 ? 1 : 0;
    }
    // Guns: the aim sweeps; the trigger in bursts (about a third of the time), a reload now and then.
    inp.y = Math.round(Math.atan2(Math.sin(inp.y / 1000 + (Math.random() - 0.5) * 0.2), Math.cos(inp.y / 1000 + (Math.random() - 0.5) * 0.2)) * 1000);
    inp.p = Math.round((Math.random() - 0.5) * 120);
    if (t > burstTo + 1200 && Math.random() < 0.06) burstTo = t + 400 + Math.random() * 1400;
    if (Math.random() < 0.004) reloads = (reloads + 1) & 15;
    inp.w = (t < burstTo ? 1 : 0) | (reloads << 2);
    if (Math.random() < 0.02) inp.a = ((((inp.a >> 2) + 1) & 63) << 2) | (1 + Math.floor(Math.random() * 3));
    if (Math.random() < 0.01) inp.g = (inp.g + 1) & 255;
    if (Math.random() < 0.04) inp.i = (inp.i + 1) & 255;
    send({ t: "in", ...inp });
  }
}

async function metrics(): Promise<string> {
  try {
    if (DIR) {
      // Every node the directory knows, then each one's own counters.
      const d = (await (await fetch(`${DIR}/dir/nodes`)).json()) as { nodes: { shard: string; url: string }[] };
      const all = await Promise.all(
        d.nodes.map(async (n) => {
          const m = (await (await fetch(`${n.url.replace(/^ws/, "http")}/metrics`)).json()) as { connected: number; rooms: number; playing: number; tickMs: { p50: number; p99: number; max: number }; rssMb: number };
          return { shard: n.shard, ...m };
        }),
      );
      const sum = (f: (m: (typeof all)[number]) => number) => all.reduce((s, m) => s + f(m), 0);
      const worst = all.reduce((w, m) => Math.max(w, m.tickMs.p99), 0);
      return `servers: ${all.length} nodes · peers ${sum((m) => m.connected)} · rooms ${sum((m) => m.rooms)} (${sum((m) => m.playing)} playing) · tick p50 ${all.map((m) => m.tickMs.p50).join("/")}ms · worst p99 ${worst}ms · rss ${sum((m) => m.rssMb)}MB`;
    }
    const r = await fetch(`${HTTP}/metrics`);
    const m = (await r.json()) as Record<string, unknown> & { tickMs: { p50: number; p99: number; max: number } };
    return `server: peers ${m.connected} · rooms ${m.rooms} (${m.playing} playing) · tick p50 ${m.tickMs.p50}ms p99 ${m.tickMs.p99}ms max ${m.tickMs.max}ms · rss ${m.rssMb}MB`;
  } catch {
    return "server: metrics unavailable";
  }
}

type Stats = typeof stats;

/** A worker's share of the clients (indices k, k + PROCS, …), its counters to the parent every 2 s. */
async function worker(k: number): Promise<void> {
  // Counters from the first second (the ramp takes a while at 10,000).
  const report = () => process.send?.({ ...stats, snapGapMs: stats.snapGapMs.slice(-4000), ffaGapMs: stats.ffaGapMs.slice(-4000) });
  setInterval(report, 2000);
  let i = 0;
  for (let n = k; n < CLIENTS; n += PROCS) {
    bot(n);
    if (++i % Math.max(1, Math.round(50 / PROCS)) === 0) await new Promise((r) => setTimeout(r, 100));
  }
}

function merge(parts: Stats[]): Stats {
  const out: Stats = { connected: 0, failed: 0, rounds: 0, finished: 0, caught: 0, timedOut: 0, bytesIn: 0, msgsIn: 0, snapGapMs: [], matches: 0, ffaGapMs: [], shots: 0, hits: 0, kills: 0, refused: 0 };
  for (const p of parts) {
    for (const key of Object.keys(out) as (keyof Stats)[]) {
      if (Array.isArray(out[key])) (out[key] as number[]).push(...(p[key] as number[]));
      else (out[key] as number) += p[key] as number;
    }
  }
  return out;
}

async function main(): Promise<void> {
  if (WORKER >= 0) return worker(WORKER);
  console.log(`load test: ${CLIENTS} clients → ${DIR ? `the directory ${DIR}` : URL_} for ${SECONDS}s${PROCS > 1 ? ` from ${PROCS} processes` : ""}${FFA ? ` · Free For All: ${FFA_MODES.join(", ")}` : ""}`);
  const t0 = Date.now();
  let view = (): Stats => stats;
  const kids: ReturnType<typeof fork>[] = [];
  if (PROCS > 1) {
    const latest: Stats[] = [];
    for (let k = 0; k < PROCS; k++) {
      const c = fork(process.argv[1], [...process.argv.slice(2), "--worker", String(k)], { stdio: "inherit" });
      c.on("message", (m) => (latest[k] = m as Stats));
      kids.push(c);
    }
    view = () => merge(latest.filter(Boolean));
  } else {
    // Ramp up: 50 connections every 100 ms, like a crowd arriving, not a wall.
    for (let i = 0; i < CLIENTS; i++) {
      bot(i);
      if (i % 50 === 49) await new Promise((r) => setTimeout(r, 100));
    }
  }
  const iv = setInterval(async () => {
    const s = Math.round((Date.now() - t0) / 1000);
    const v = view();
    console.log(`t+${s}s · connected ${v.connected}/${CLIENTS} · rounds ${v.rounds} · matches ${v.matches} · shots ${v.shots} · in ${(v.bytesIn / 1e6).toFixed(1)}MB · ${await metrics()}`);
  }, 10_000);

  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(iv);
  const st = view();
  const gaps = [...st.snapGapMs].sort((a, b) => a - b);
  const pct = (p: number) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? 0;
  const outcomes = st.finished + st.caught + st.timedOut || 1;
  console.log("\n── result ──");
  console.log(`clients connected ${st.connected}/${CLIENTS}, failed ${st.failed}${DIR ? `, directory refused ${st.refused}` : ""}`);
  if (st.rounds) console.log(`player-rounds ${st.rounds}: finished ${pct100(st.finished / outcomes)} · caught ${pct100(st.caught / outcomes)} · time up ${pct100(st.timedOut / outcomes)}`);
  if (st.rounds) console.log(`snapshot spacing at clients: p50 ${pct(0.5)}ms · p99 ${pct(0.99)}ms (target ${Math.round(1000 / NET.snapshotHz)}ms)`);
  if (FFA) {
    const fg = [...st.ffaGapMs].sort((a, b) => a - b);
    const fp = (p: number) => fg[Math.min(fg.length - 1, Math.floor(fg.length * p))] ?? 0;
    console.log(`Free For All (${FFA_MODES.join(", ")}): player-matches ${st.matches} · shots ${st.shots} · hits ${st.hits} · kills ${st.kills} · snapshot spacing p50 ${fp(0.5)}ms · p99 ${fp(0.99)}ms (target ${Math.round(1000 / NET.snapshotHz)}ms)`);
  }
  console.log(`downstream per client: ${((st.bytesIn / Math.max(1, st.connected)) / SECONDS / 1024).toFixed(1)} KB/s`);
  console.log(await metrics());
  for (const c of kids) c.kill();
  process.exit(0);
}

function pct100(v: number): string {
  return `${Math.round(v * 100)}%`;
}

void main();
