// End-to-end test of Ball Haunting online (protocol 4): real game server,
// scripted players, every message checked as a phone would see it.
//
//   A creates a private Ball Haunting room (100 m); B and C join with the code.
//   While she sings, A walks to the nearest ball and grabs it; B walks up to A
//   and pushes; C stands still the whole time, then drops its connection and
//   comes back. What must hold:
//     - the room and the start say Ball Haunting, 100 m, with 2 balls for 3
//     - A's grab, B's push (landing on A, knocking A's ball loose) and the drop
//       arrive as events, in that order
//     - snapshots are 5 numbers a player and carry no balls
//     - C, back after a drop, gets a full sync: balls, everyone's progress
//     - nobody standing still is ever caught
//
//   node server/build-tools.mjs && node server/dist/ballstest.mjs
//   GAME=ws://localhost:8797 (default ws://localhost:8787)
//   CODE_FILE=/path   join the room whose code is in this file instead of
//                     creating one (a browser is the third player: C is skipped)

import { existsSync, readFileSync } from "node:fs";

import WebSocket from "ws";

import { BALLS, NET, ballCount } from "../../src/config";
import { BALL_STRIDE, OUTCOME_STRIDE, SNAP_STRIDE, phaseAt, type ServerMsg, type SnapMsg, type StartInfo } from "../../src/net/protocol";

const GAME = process.env.GAME ?? "ws://localhost:8787";
const CODE_FILE = process.env.CODE_FILE;

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Role = "grabber" | "pusher" | "statue";

interface Client {
  role: Role;
  ws: WebSocket;
  id: string;
  token: string;
  code: string | null;
  start: StartInfo | null;
  snaps: SnapMsg[];
  events: Extract<ServerMsg, { t: "ev" }>[];
  sync: Extract<ServerMsg, { t: "sync" }>["sync"] | null;
  room: Extract<ServerMsg, { t: "room" }>["room"] | null;
  phase: string;
  me: number;
  /** Where each ball is, as this phone knows it (start, then drop events). */
  balls: { x: number; z: number; holder: number }[];
  a: number;
  g: number;
}

function connect(role: Role, resume?: string, reuse?: Client): Promise<Client> {
  return new Promise((resolve) => {
    const ws = new WebSocket(GAME);
    const c: Client = reuse ?? { role, ws, id: "", token: "", code: null, start: null, snaps: [], events: [], sync: null, room: null, phase: "", me: -1, balls: [], a: 0, g: 0 };
    c.ws = ws;
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: NET.protocol, name: role, ...(resume ? { resume } : {}) })));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      switch (m.t) {
        case "welcome":
          c.id = m.id;
          c.token = m.token;
          resolve(c);
          break;
        case "ping":
          ws.send(JSON.stringify({ t: "pong", s: m.s }));
          break;
        case "room":
          c.room = m.room;
          if (m.room.code) c.code = m.room.code;
          break;
        case "start":
          c.start = m.start;
          c.me = m.start.roster.findIndex((r) => r.id === c.id);
          c.balls = [];
          for (let i = 0; i + 1 < (m.start.bp ?? []).length; i += 2) c.balls.push({ x: m.start.bp![i] / 100, z: m.start.bp![i + 1] / 100, holder: -1 });
          break;
        case "sync":
          c.sync = m.sync;
          break;
        case "snap":
          c.snaps.push(m);
          if (c.snaps.length > 400) c.snaps.shift();
          break;
        case "ev":
          c.events.push(m);
          if (m.k === "ph") c.phase = phaseAt(m.ph);
          if (m.k === "grb" && c.balls[m.b]) c.balls[m.b].holder = m.i;
          if (m.k === "drp" && c.balls[m.b]) c.balls[m.b] = { x: m.x / 100, z: m.z / 100, holder: -1 };
          if (m.k === "bnk" && c.balls[m.b]) c.balls[m.b].holder = -2;
          break;
        default:
          break;
      }
    });
  });
}

const send = (c: Client, o: object) => c.ws.readyState === 1 && c.ws.send(JSON.stringify(o));

/** Where contestant i is in this client's latest snapshot. */
function pos(c: Client, i: number): { x: number; z: number } | null {
  const s = c.snaps[c.snaps.length - 1];
  if (!s) return null;
  return { x: s.p[i * SNAP_STRIDE] / 100, z: s.p[i * SNAP_STRIDE + 1] / 100 };
}

/** Walk towards (tx, tz); stop within `near` metres. Returns the distance. */
function walk(c: Client, tx: number, tz: number, near: number): number {
  const p = pos(c, c.me);
  if (!p) return Infinity;
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d <= near) {
    send(c, { t: "in", x: 0, z: 0, a: c.a, g: c.g });
    return d;
  }
  // A walk-speed push near the target, a run further off.
  const k = d < 3 ? 40 : 100;
  send(c, { t: "in", x: Math.round((dx / d) * k), z: Math.round((dz / d) * k), a: c.a, g: c.g });
  return d;
}

function still(c: Client): void {
  send(c, { t: "in", x: 0, z: 0, a: c.a, g: c.g });
}

async function main(): Promise<void> {
  console.log(`ball haunting test → ${GAME}${CODE_FILE ? ` (joining the room in ${CODE_FILE})` : ""}\n`);

  const A = await connect("grabber");
  const B = await connect("pusher");
  const C = CODE_FILE ? null : await connect("statue");

  let code: string;
  if (CODE_FILE) {
    for (let i = 0; i < 600 && !existsSync(CODE_FILE); i++) await sleep(200);
    code = readFileSync(CODE_FILE, "utf8").trim();
    send(A, { t: "join", code });
  } else {
    send(A, { t: "create", size: 3, mode: "balls", dist: 100 });
    for (let i = 0; i < 50 && !A.code; i++) await sleep(100);
    code = A.code ?? "";
  }
  await sleep(300);
  send(B, { t: "join", code });
  if (C) send(C, { t: "join", code });

  console.log("room:");
  for (let i = 0; i < 100 && !A.start; i++) await sleep(100);
  check(!!A.room && A.room.mode === "balls" && A.room.dist === 100, `the room plays ${A.room?.mode} at ${A.room?.dist} m`);
  const st = A.start;
  check(!!st && st.mode === "balls" && st.dist === 100, "the start says Ball Haunting, 100 m");
  check(!!st && (st.bp?.length ?? 0) === ballCount(3) * 2, `${ballCount(3)} balls for 3 players, positions in the start`);
  if (!st) {
    console.log("\nno round started");
    process.exit(1);
  }

  // Wait for the song.
  for (let i = 0; i < 100 && A.phase !== "sing"; i++) await sleep(100);

  console.log("\nplay:");
  let grabbed = -1;
  let pushed = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000 && !(grabbed >= 0 && pushed && A.events.some((e) => e.k === "drp"))) {
    await sleep(1000 / NET.inputHz);
    const singing = A.phase === "sing" || A.phase === "turningBack";
    if (!singing) {
      still(A);
      still(B);
      continue;
    }
    // A: to the nearest free ball, grab at arm's length.
    if (grabbed < 0) {
      const me = pos(A, A.me);
      if (me) {
        let best = -1;
        let bd = Infinity;
        A.balls.forEach((b, i) => {
          const d = b.holder === -1 ? Math.hypot(b.x - me.x, b.z - me.z) : Infinity;
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        if (best >= 0) {
          const d = walk(A, A.balls[best].x, A.balls[best].z, BALLS.reach * 0.6);
          if (d <= BALLS.reach * 0.8) {
            A.g = (A.g + 1) & 255;
            still(A);
          }
        }
      }
      const g = A.events.find((e) => e.k === "grb" && e.i === A.me);
      if (g && g.k === "grb") grabbed = g.b;
      still(B);
    } else if (!pushed) {
      // B: up to A, then push.
      still(A);
      const a = pos(B, A.me);
      if (a) {
        const d = walk(B, a.x, a.z, 1.3);
        if (d <= 1.6) {
          B.a = ((((B.a >> 2) + 1) & 63) << 2) | 3;
          still(B);
          pushed = true;
        }
      }
    } else {
      still(A);
      still(B);
    }
  }
  still(A);
  still(B);
  await sleep(400);

  const grb = A.events.findIndex((e) => e.k === "grb" && e.i === A.me);
  const atk = A.events.findIndex((e) => e.k === "atk" && e.i === B.me);
  const drp = A.events.findIndex((e) => e.k === "drp");
  const atkEv = A.events[atk];
  check(grb >= 0, "A's grab arrives as an event");
  check(atk > grb && atkEv?.k === "atk" && atkEv.kind === 3 && atkEv.tg === A.me && atkEv.db === grabbed, "B's push lands on A and knocks A's ball loose");
  check(drp > atk, "then the ball drops (with where it landed)");
  check(atkEv?.k === "atk" && Math.hypot(atkEv.kx ?? 0, atkEv.kz ?? 0) > 100, `A's slide comes with the push (${atkEv?.k === "atk" ? Math.round(Math.hypot(atkEv.kx ?? 0, atkEv.kz ?? 0)) : 0} cm/s)`);

  console.log("\nsnapshots:");
  const s = A.snaps[A.snaps.length - 1];
  check(!!s && s.p.length === 3 * SNAP_STRIDE, `${SNAP_STRIDE} numbers a player (${s?.p.length} for 3)`);
  check(!!s && s.b === undefined, "no balls in snapshots (they travel as events)");

  if (C) {
    console.log("\nreconnect:");
    const token = C.token;
    C.ws.terminate();
    await sleep(800);
    await connect("statue", token, C);
    for (let i = 0; i < 30 && !C.sync; i++) await sleep(100);
    const sy = C.sync;
    check(!!sy, "C comes back to a sync");
    check(!!sy && (sy.snap.b?.length ?? 0) === ballCount(3) * BALL_STRIDE, "the sync carries every ball");
    const h = sy?.snap.b?.[grabbed * BALL_STRIDE + 2];
    check(h === 0, `…including A's ball, free on the ground (state ${h})`);
    check(!!sy && sy.outcomes.length === 3 * OUTCOME_STRIDE && sy.outcomes[A.me * OUTCOME_STRIDE + 4] > 0, "outcomes carry everyone's distance run");
    check(!!sy && sy.snap.st[C.me] === "a", "C, standing still the whole time, is still in");
  }

  check(!A.events.some((e) => e.k === "out" && (e.i === A.me || e.i === B.me) && e.c !== 0), "no one was ruled out for anything but moving");

  for (const c of [A, B, C]) c?.ws.close();
  console.log(`\n${failures ? `${failures} FAILED` : "all passed"}`);
  process.exit(failures ? 1 : 0);
}

void main();
