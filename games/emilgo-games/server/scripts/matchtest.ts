// End-to-end test of Lagos Life matches, against the FAKE platform
// (server/scripts/mockvatar.ts) and our real game server.
//
//   1. Two test players stake ₦1,000 each in a 2-seat match on the platform.
//   2. Both connect to our game server and ask to play it with their sessions.
//   3. The round is played (Ball Haunting, 1 ball for 2): A fetches the ball
//      and carries it over the line, stopping in time; B stands still.
//   4. Our server posts the SIGNED result; the platform verifies it with the
//      formula from the docs and settles: A wins the pot less 5%.
// And the attacks that must fail:
//   - a session the platform never issued         → "verify"
//   - a real player who isn't in the match         → "not_in_match"
//   - a result with a tampered body / stale clock  → 401 from the platform
//   - a webhook with a forged signature            → 401 from our server
//
//   node server/build-tools.mjs && node server/dist/matchtest.mjs
// Needs: mock platform on :8790 (WEBHOOK_URL=http://localhost:8787/vatar-webhook)
//        game server on :8787 with VATAR_SECRET=vtr_test_mock VATAR_RESULTS_SECRET=vtr_results_mock
//        VATAR_WEBHOOK_SECRET=vtr_whsec_test_mock VATAR_API=http://localhost:8790/api/games/v1

import { createHash, createHmac } from "node:crypto";
import WebSocket from "ws";

import { NET } from "../../src/config";
import { BALLS } from "../../src/config";
import { SNAP_STRIDE, phaseAt, type ServerMsg } from "../../src/net/protocol";
import { signResult } from "../src/vatar";

const PLATFORM = process.env.PLATFORM ?? "http://localhost:8790";
const GAME = process.env.GAME ?? "ws://localhost:8787";
const GAME_HTTP = GAME.replace(/^ws/, "http");

/** Unique per run: the fake platform remembers players by name. */
const RUN = Math.random().toString(36).slice(2, 6);

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

async function platform<T>(path: string, body?: object): Promise<{ status: number; json: T }> {
  const r = await fetch(PLATFORM + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return { status: r.status, json: (await r.json().catch(() => null)) as T };
}

interface TestPlayer {
  id: string;
  name: string;
  session: string;
}

async function newPlayer(name: string): Promise<TestPlayer> {
  const r = await platform<{ player: { id: string; name: string }; session: string }>("/mock/init", { name });
  return { id: r.json.player.id, name: r.json.player.name, session: r.json.session };
}

/** A game client that asks to play `matchId`. `run` decides how it plays. */
function gameClient(
  matchId: string,
  session: string,
  run: "runner" | "statue",
): Promise<{ errors: string[]; seat: string; vresult: { winner: string; posted: boolean } | null }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(GAME);
    const errors: string[] = [];
    let seat = "";
    let vresult: { winner: string; posted: boolean } | null = null;
    let turns = 0;
    let me = -1;
    let ball: { x: number; z: number } | null = null;
    let holding = false;
    let g = 0;
    let singing = false;
    let at: { x: number; z: number } | null = null;
    const finish = () => {
      clearInterval(steer);
      ws.close();
      resolve({ errors, seat, vresult });
    };
    const timer = setTimeout(finish, 150_000);
    // A careful human: while she sings, fetch the ball, then run for the line; stop the instant she turns.
    const steer = setInterval(() => {
      if (run !== "runner" || !singing || !at) return;
      if (!holding && ball) {
        const dx = ball.x - at.x;
        const dz = ball.z - at.z;
        const d = Math.hypot(dx, dz);
        if (d <= BALLS.reach * 0.8) {
          g = (g + 1) & 255;
          ws.send(JSON.stringify({ t: "in", x: 0, z: 0, g }));
        } else {
          const k = d < 3 ? 40 : 100;
          ws.send(JSON.stringify({ t: "in", x: Math.round((dx / d) * k), z: Math.round((dz / d) * k), g }));
        }
      } else {
        ws.send(JSON.stringify({ t: "in", x: 0, z: -100, g }));
      }
    }, 66);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: NET.protocol, name: "ignored" })));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      if (m.t === "welcome") ws.send(JSON.stringify({ t: "vmatch", id: matchId, session }));
      else if (m.t === "ping") ws.send(JSON.stringify({ t: "pong", s: m.s }));
      else if (m.t === "err") {
        errors.push(m.code);
        clearTimeout(timer);
        finish();
      } else if (m.t === "seat") seat = m.id;
      else if (m.t === "start") {
        me = m.start.roster.findIndex((r) => r.id === seat);
        const bp = m.start.bp ?? [];
        if (bp.length >= 2) ball = { x: bp[0] / 100, z: bp[1] / 100 };
      } else if (m.t === "snap" && me >= 0) {
        at = { x: m.p[me * SNAP_STRIDE] / 100, z: m.p[me * SNAP_STRIDE + 1] / 100 };
      } else if (m.t === "ev" && m.k === "grb" && m.i === me) {
        holding = true;
      } else if (m.t === "ev" && m.k === "drp") {
        holding = false;
        ball = { x: m.x / 100, z: m.z / 100 };
      } else if (m.t === "ev" && m.k === "ph" && run === "runner") {
        const ph = phaseAt(m.ph);
        singing = ph === "sing" || ph === "hum";
        if (ph === "turning") {
          turns++;
          ws.send(JSON.stringify({ t: "in", x: 0, z: 0, g }));
        }
      } else if (m.t === "vresult") {
        vresult = { winner: m.winner, posted: m.posted };
        clearTimeout(timer);
        setTimeout(finish, 300);
      }
    });
    void turns;
  });
}

/** Just the first answer to a vmatch request (for the attack cases). */
function askOnce(matchId: string, session: string): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(GAME);
    const t = setTimeout(() => {
      ws.close();
      resolve("timeout");
    }, 10_000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: NET.protocol, name: "x" })));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      if (m.t === "welcome") ws.send(JSON.stringify({ t: "vmatch", id: matchId, session }));
      if (m.t === "err" || m.t === "seat") {
        clearTimeout(t);
        ws.close();
        resolve(m.t === "err" ? m.code : "seated");
      }
    });
  });
}

async function main(): Promise<void> {
  console.log(`match test: platform ${PLATFORM}, game ${GAME}\n`);

  // ── The match ──
  const a = await newPlayer(`Ada ${RUN}`);
  const b = await newPlayer(`Bayo ${RUN}`);
  const outsider = await newPlayer(`Outsider ${RUN}`);
  const created = await platform<{ id: string; code: string; status: string }>("/mock/match/create", { session: a.session, stake: 1000, seats: 2 });
  check(created.status === 200 && created.json.status === "open", "A creates a ₦1,000 match (open)");

  console.log("\nattacks before the match starts:");
  check((await askOnce(created.json.id, a.session)) === "match_state", "playing a match that hasn't started → match_state");

  const joined = await platform<{ status: string }>("/mock/match/join", { session: b.session, code: created.json.code });
  check(joined.json.status === "playing", "B joins with the code → playing");

  console.log("\nattacks on a running match:");
  check((await askOnce(created.json.id, "vtr1.forged-token")) === "verify", "a forged session → verify");
  check((await askOnce(created.json.id, outsider.session)) === "not_in_match", "a real player not in the match → not_in_match");
  check((await askOnce("m_doesnotexist", a.session)) === "not_found", "an unknown match id → not_found");

  console.log("\nplaying the round (Ball Haunting: A fetches the ball and carries it over, B stands still)…");
  const [ra, rb] = await Promise.all([gameClient(created.json.id, a.session, "runner"), gameClient(created.json.id, b.session, "statue")]);
  check(!ra.errors.length && !rb.errors.length, "both seated without errors");
  check(ra.seat === a.id && rb.seat === b.id, "each client controls its own Lagos Life player id");
  check(ra.vresult?.posted === true, "our server posted the result");
  check(ra.vresult?.winner === a.id, "A (first across) is the winner");

  const results = await platform<{ matchId: string; winner: string; ok: boolean; why?: string }[]>("/mock/results");
  const mine = results.json.filter((r) => r.matchId === created.json.id);
  check(mine.length >= 1 && mine.every((r) => r.ok), "the platform accepted our signature (verified independently)");
  const after = await platform<{ status: string; winner: string; money: number } | null>(`/mock/match/current?session=${a.session}&last=${created.json.id}`);
  check(after.json?.status === "done" && after.json.winner === a.id, "the platform settled the match: done, winner A");
  check(after.json?.money === 100_000 - 1000 + 1900, `A's test money: 100,000 − 1,000 + 1,900 = 100,900 (got ${after.json?.money})`);

  // ── Signature attacks, straight at the platform ──
  console.log("\nsignature checks at the platform:");
  const m2 = await platform<{ id: string; code: string }>("/mock/match/create", { session: outsider.session, stake: 0, seats: 2 });
  const c = await newPlayer(`Chi ${RUN}`);
  await platform("/mock/match/join", { session: c.session, code: m2.json.code });
  const api = await fetch(`${PLATFORM}/api/games/v1/matches/${m2.json.id}`, { headers: { Authorization: "Bearer vtr_test_mock" } });
  const info = (await api.json()) as { nonce: string };
  const path = `/api/games/v1/matches/${m2.json.id}/result`;
  const post = (body: string, ts: string, sig: string) =>
    fetch(PLATFORM + path, {
      method: "POST",
      body,
      headers: { Authorization: "Bearer vtr_test_mock", "Content-Type": "application/json", "X-Vatar-Timestamp": ts, "X-Vatar-Signature": sig },
    }).then(async (r) => `${r.status} ${((await r.json()) as { error?: string }).error ?? "ok"}`);
  const ts = String(Math.floor(Date.now() / 1000));
  const honest = JSON.stringify({ winner: outsider.id });
  const tampered = JSON.stringify({ winner: c.id });
  check((await post(tampered, ts, signResult("vtr_results_mock", path, ts, info.nonce, honest))) === "401 bad_signature", "body changed after signing → 401 bad_signature");
  const old = String(Math.floor(Date.now() / 1000) - 400);
  check((await post(honest, old, signResult("vtr_results_mock", path, old, info.nonce, honest))) === "401 stale_timestamp", "timestamp 400 s old → 401 stale_timestamp");
  check((await post(honest, ts, signResult("vtr_results_WRONG", path, ts, info.nonce, honest))) === "401 bad_signature", "wrong results secret → 401 bad_signature");
  // Independent re-derivation of the docs' formula, to pin signResult to it.
  const sha = createHash("sha256").update(honest).digest("hex");
  const byHand = "v1=" + createHmac("sha256", "vtr_results_mock").update(["POST", path, ts, info.nonce, sha].join("\n")).digest("hex");
  check(byHand === signResult("vtr_results_mock", path, ts, info.nonce, honest), "signResult matches the docs' formula byte for byte");

  // ── Webhook forgery, at our server ──
  console.log("\nwebhook checks at our server:");
  const body = JSON.stringify({ id: "evt_x", type: "match.settled", mode: "test", data: {} });
  const forged = await fetch(GAME_HTTP + "/vatar-webhook", { method: "POST", body, headers: { "X-Vatar-Signature": "sha256=" + "0".repeat(64), "X-Vatar-Delivery": "evt_x" } });
  check(forged.status === 401, "a forged webhook signature → 401");
  const goodSig = "sha256=" + createHmac("sha256", "vtr_whsec_test_mock").update(body).digest("hex");
  const real = await fetch(GAME_HTTP + "/vatar-webhook", { method: "POST", body, headers: { "X-Vatar-Signature": goodSig, "X-Vatar-Delivery": "evt_y" } });
  check(real.status === 200, "a correctly signed webhook → 200");

  console.log(`\n${failures ? `${failures} FAILED` : "all passed"}`);
  process.exit(failures ? 1 : 0);
}

void main();
