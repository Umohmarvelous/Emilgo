// Fairness test: does lag change who gets caught?
//
// Seven scripted players share one private room. Each has an artificial
// one-way delay (both directions) and lets go of the stick a fixed time after
// IT sees Mama start to turn. If lag compensation works, the outcome of the
// first stare depends only on reaction time, never on lag.
//
// The numbers: her turn takes 0.35–0.55 s, then 0.2 s grace, so movement
// counts from 0.55–0.75 s after the turn starts. Braking from a run takes
// ~0.16 s. So, on the server's clock:
//   reaction 250/300 ms, any lag ≤ 200 ms each way → stopped before detection
//   reaction 250 ms, 200 ms lag, compensation OFF   → stops at 0.81 s → caught
//   reaction 850 ms → still moving at 1.0 s+ → caught at any lag
//
//   npm run test:fairness            (against ws://localhost:8787)

import WebSocket from "ws";

import { NET } from "../../src/config";
import { phaseAt, type ServerMsg } from "../../src/net/protocol";

const URL_ = process.argv[2] ?? "ws://localhost:8787";

interface Spec {
  lag: number; // one-way ms
  reaction: number; // ms after seeing the turn
  expect: "safe" | "caught";
}

const SPECS: Spec[] = [
  { lag: 0, reaction: 250, expect: "safe" },
  { lag: 0, reaction: 300, expect: "safe" },
  { lag: 100, reaction: 300, expect: "safe" },
  { lag: 200, reaction: 250, expect: "safe" }, // caught without compensation
  { lag: 150, reaction: 250, expect: "safe" },
  { lag: 0, reaction: 850, expect: "caught" },
  { lag: 200, reaction: 850, expect: "caught" },
];

type Outcome = "safe" | "caught";

interface Player {
  joined: Promise<string | null>; // resolves with the room code (owner) or null
  result: Promise<Outcome>;
  send(o: object): void;
}

function player(spec: Spec, joinCode: Promise<string> | null): Player {
  const ws = new WebSocket(URL_);
  // Artificial lag, both ways.
  const later = (fn: () => void) => (spec.lag ? setTimeout(fn, spec.lag) : fn());
  const send = (o: object) => later(() => ws.readyState === 1 && ws.send(JSON.stringify(o)));

  let resolveJoined: (code: string | null) => void = () => {};
  let resolveResult: (o: Outcome) => void = () => {};
  const joined = new Promise<string | null>((r) => (resolveJoined = r));
  const result = new Promise<Outcome>((r) => (resolveResult = r));

  let myId = "";
  let me = -1;
  let watches = 0;
  let caught = false;

  ws.on("open", () => send({ t: "hello", v: NET.protocol, name: `Lag${spec.lag} R${spec.reaction}` }));
  ws.on("message", (data) =>
    later(() => {
      const m = JSON.parse(data.toString()) as ServerMsg;
      switch (m.t) {
        case "welcome":
          myId = m.id;
          if (joinCode) void joinCode.then((code) => send({ t: "join", code }));
          else send({ t: "create", size: NET.crowdMax });
          break;
        case "ping":
          send({ t: "pong", s: m.s });
          break;
        case "room":
          if (m.room.players.some((p) => p.id === myId)) resolveJoined(m.room.code);
          break;
        case "start":
          me = m.start.roster.findIndex((r) => r.id === myId);
          break;
        case "ev":
          if (m.k === "ph") {
            const ph = phaseAt(m.ph);
            if (watches === 0 && ph === "sing") send({ t: "in", x: 0, z: -100 });
            if (watches === 0 && ph === "turning") setTimeout(() => send({ t: "in", x: 0, z: 0 }), spec.reaction);
            if (ph === "watch") watches++;
            if (ph === "turningBack" && watches === 1) resolveResult(caught ? "caught" : "safe");
          } else if (m.k === "out" && m.i === me && watches <= 1) {
            caught = true;
            resolveResult("caught");
          }
          break;
      }
    }),
  );
  return { joined, result, send };
}

async function main(): Promise<void> {
  console.log(`fairness test → ${URL_}`);
  const owner = player(SPECS[0], null);
  const code = owner.joined.then((c) => c!);
  const others = SPECS.slice(1).map((s) => player(s, code));
  await Promise.all([owner.joined, ...others.map((p) => p.joined)]);

  // Let every player's lag be measured (the server pings at 50/400/800 ms and
  // every 2 s), then the owner starts the round.
  await new Promise((r) => setTimeout(r, 3000));
  owner.send({ t: "start" });

  const outcomes = await Promise.all([owner, ...others].map((p) => p.result));
  let pass = 0;
  console.log("\n lag (one-way)  reaction  expected  got");
  outcomes.forEach((got, i) => {
    const s = SPECS[i];
    const ok = got === s.expect;
    if (ok) pass++;
    console.log(` ${String(s.lag).padStart(8)} ms  ${String(s.reaction).padStart(5)} ms  ${s.expect.padEnd(8)}  ${got}${ok ? "" : "   ✗ MISMATCH"}`);
  });
  console.log(`\n${pass}/${outcomes.length} as expected`);
  process.exit(pass === outcomes.length ? 0 : 1);
}

void main();
