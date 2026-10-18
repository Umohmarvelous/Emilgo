// Load test: N scripted players connect, quick-match into rooms of 20, and play
// real rounds against the server — run while she sings, stop after a human-ish
// reaction when she turns, flinch now and then. Half play Ball Haunting at
// 100 m: they grab at balls and throw fists, slaps and pushes while she sings,
// so the referee's fighting and the ball snapshots are under load too. They
// re-queue after each round so the load stays up for the whole run.
//
//   npm run loadtest -- --clients 1200 --seconds 90 --url ws://localhost:8787
//
// Run the server with MAX_PER_IP raised (every client comes from one address):
//   MAX_PER_IP=100000 npm run server:start
//
// These scripted clients are a test tool only. They never exist in a real room.

import WebSocket from "ws";

import { FLOW, NET } from "../../src/config";
import { phaseAt, type ServerMsg } from "../../src/net/protocol";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const CLIENTS = Number(args.get("clients") ?? 600);
const SECONDS = Number(args.get("seconds") ?? 75);
const URL_ = args.get("url") ?? "ws://localhost:8787";
const HTTP = URL_.replace(/^ws/, "http");

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
};

function bot(n: number): void {
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
  ws.on("error", () => stats.failed++);
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

async function metrics(): Promise<string> {
  try {
    const r = await fetch(`${HTTP}/metrics`);
    const m = (await r.json()) as Record<string, unknown> & { tickMs: { p50: number; p99: number; max: number } };
    return `server: peers ${m.connected} · rooms ${m.rooms} (${m.playing} playing) · tick p50 ${m.tickMs.p50}ms p99 ${m.tickMs.p99}ms max ${m.tickMs.max}ms · rss ${m.rssMb}MB`;
  } catch {
    return "server: metrics unavailable";
  }
}

async function main(): Promise<void> {
  console.log(`load test: ${CLIENTS} clients → ${URL_} for ${SECONDS}s`);
  const t0 = Date.now();
  // Ramp up: 50 connections every 100 ms, like a crowd arriving, not a wall.
  for (let i = 0; i < CLIENTS; i++) {
    bot(i);
    if (i % 50 === 49) await new Promise((r) => setTimeout(r, 100));
  }
  const iv = setInterval(async () => {
    const s = Math.round((Date.now() - t0) / 1000);
    console.log(`t+${s}s · connected ${stats.connected}/${CLIENTS} · rounds ${stats.rounds} · in ${(stats.bytesIn / 1e6).toFixed(1)}MB · ${await metrics()}`);
  }, 10_000);

  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(iv);
  const gaps = [...stats.snapGapMs].sort((a, b) => a - b);
  const pct = (p: number) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? 0;
  const outcomes = stats.finished + stats.caught + stats.timedOut || 1;
  console.log("\n── result ──");
  console.log(`clients connected ${stats.connected}/${CLIENTS}, failed ${stats.failed}`);
  console.log(`player-rounds ${stats.rounds}: finished ${pct100(stats.finished / outcomes)} · caught ${pct100(stats.caught / outcomes)} · time up ${pct100(stats.timedOut / outcomes)}`);
  console.log(`snapshot spacing at clients: p50 ${pct(0.5)}ms · p99 ${pct(0.99)}ms (target ${Math.round(1000 / NET.snapshotHz)}ms)`);
  console.log(`downstream per client: ${((stats.bytesIn / Math.max(1, stats.connected)) / SECONDS / 1024).toFixed(1)} KB/s`);
  console.log(await metrics());
  process.exit(0);
}

function pct100(v: number): string {
  return `${Math.round(v * 100)}%`;
}

void main();
