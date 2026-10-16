// A FAKE Lagos Life platform, for local testing before we have sandbox keys.
// Development tooling only: never deployed, never bundled with the game.
//
// It plays both sides of the platform:
//   /api/games/v1/*   the server API exactly as documented (Bearer secret,
//                     sessions, matches, SIGNED results checked independently
//                     with the formula from the docs, 409/401 codes, webhooks)
//   /mock/*           what the world's game player does for the SDK (init,
//                     sessions, match create/join/quick/leave/current), so the
//                     dev-only mock SDK in the browser (?mockvatar) can play
//                     real matches through it
//
// It is written from the docs, independently of server/src/vatar.ts, so a
// signing mistake in our server shows up as a 401 here — not in production.
//
//   PORT=8790 WEBHOOK_URL=http://localhost:8787/vatar-webhook node server/dist/mockvatar.mjs
//
// Secrets (match the game server's env): vtr_test_mock / vtr_results_mock / vtr_whsec_test_mock

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { PRODUCTS } from "../../src/shop/catalog";

const PORT = Number(process.env.PORT ?? 8790);
const SECRET = process.env.VATAR_SECRET ?? "vtr_test_mock";
const RESULTS_SECRET = process.env.VATAR_RESULTS_SECRET ?? "vtr_results_mock";
const WEBHOOK_SECRET = process.env.VATAR_WEBHOOK_SECRET ?? "vtr_whsec_test_mock";
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "";
const BASE = "/api/games/v1";
const GAME_ID = "g_emilgo_mock";
const START_MONEY = 100_000;

interface Player {
  id: string;
  name: string;
  money: number;
}

interface Match {
  id: string;
  code: string;
  status: "open" | "playing" | "done" | "cancelled" | "void";
  stake: number;
  seats: number;
  players: string[]; // player ids
  winner: string | null;
  result: unknown;
  nonce: string;
  createdAt: number;
  startedAt: number | null;
  endsAt: number | null;
  settledAt: number | null;
}

const players = new Map<string, Player>();
const sessions = new Map<string, { playerId: string; exp: number }>();
const matches = new Map<string, Match>();
const byCode = new Map<string, Match>();
const current = new Map<string, string>(); // playerId → matchId
const resultsLog: { matchId: string; winner: string; ok: boolean; why?: string }[] = [];

// ── Purchases ──
// "The dashboard": every product in our catalog, at the catalog price, plus one
// product our build doesn't know (to test that it is refused, not lost).
const FOR_SALE = new Map<string, number>([...PRODUCTS.map((p) => [p.id, p.price] as [string, number]), ["future_item", 100]]);

interface Purchase {
  id: string;
  productId: string;
  playerId: string;
  amount: number;
  status: "paid" | "delivered" | "refunded";
  createdAt: number;
  deliveredAt?: number;
}
const purchases = new Map<string, Purchase>();
const purchaseView = (x: Purchase) => ({
  id: x.id,
  productId: x.productId,
  playerId: x.playerId,
  amount: x.amount,
  currency: "NGN",
  status: x.status,
  createdAt: x.createdAt,
  mode: "test",
});

const rid = (n = 9) => randomBytes(n).toString("base64url");

function issue(playerId: string): { session: string; exp: number } {
  const session = "vtr1." + rid(24);
  const exp = Date.now() + 15 * 60_000;
  sessions.set(session, { playerId, exp });
  return { session, exp };
}

function who(session: unknown): Player | null {
  const s = typeof session === "string" ? sessions.get(session) : undefined;
  if (!s || s.exp < Date.now()) return null;
  return players.get(s.playerId) ?? null;
}

/** The match as the game sees it through the SDK. */
function view(m: Match, me: string) {
  return {
    id: m.id,
    code: m.code,
    status: m.status,
    stake: m.stake,
    seats: m.seats,
    players: m.players.map((id) => ({ id, name: players.get(id)!.name })),
    me,
    winner: m.winner,
    result: m.result,
    endsAt: m.endsAt,
    mode: "test",
  };
}

/** The match as the server API returns it. */
function apiView(m: Match) {
  const pot = m.stake * m.players.length;
  return {
    id: m.id,
    status: m.status,
    stake: m.stake,
    seats: m.seats,
    players: m.players.map((id) => ({ playerId: id, name: players.get(id)!.name })),
    winner: m.winner,
    result: m.result,
    pot,
    payout: m.winner && m.winner !== "draw" ? Math.floor(pot * 0.95) : 0,
    mode: "test",
    nonce: m.nonce,
    createdAt: m.createdAt,
    startedAt: m.startedAt,
    endsAt: m.endsAt,
    settledAt: m.settledAt,
  };
}

function webhook(type: string, data: object): void {
  if (!WEBHOOK_URL) return;
  const id = "evt_" + rid(8);
  const body = JSON.stringify({ id, type, mode: "test", createdAt: Date.now(), data });
  const sig = "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  fetch(WEBHOOK_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", "X-Vatar-Event": type, "X-Vatar-Delivery": id, "X-Vatar-Signature": sig },
  })
    .then((r) => console.log(`webhook ${type} → ${r.status}`))
    .catch((e) => console.log(`webhook ${type} failed: ${e}`));
}

function join(m: Match, p: Player): string | null {
  if (m.status !== "open") return "not_open";
  if (m.players.includes(p.id)) return null;
  if (m.players.length >= m.seats) return "not_open";
  if (m.stake > 0 && p.money < m.stake) return "limit";
  p.money -= m.stake; // the world's confirm sheet: tapped "Confirm"
  m.players.push(p.id);
  current.set(p.id, m.id);
  if (m.players.length === m.seats) {
    m.status = "playing";
    m.startedAt = Date.now();
    m.endsAt = m.startedAt + 2 * 3600_000;
    webhook("match.started", { matchId: m.id, nonce: m.nonce, players: m.players });
  }
  return null;
}

function newMatch(p: Player, stake: number, seats: number): Match | string {
  if (!Number.isInteger(stake) || stake < 0 || stake > 100_000) return "limit";
  if (!Number.isInteger(seats) || seats < 2 || seats > 4) return "bad_request";
  let code = "";
  do code = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
  while (byCode.has(code));
  const m: Match = {
    id: "m_" + rid(8),
    code,
    status: "open",
    stake,
    seats,
    players: [],
    winner: null,
    result: null,
    nonce: rid(16),
    createdAt: Date.now(),
    startedAt: null,
    endsAt: null,
    settledAt: null,
  };
  matches.set(m.id, m);
  byCode.set(code, m);
  const err = join(m, p);
  return err ?? m;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function read(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok) => {
    const c: Buffer[] = [];
    req.on("data", (x: Buffer) => c.push(x));
    req.on("end", () => ok(Buffer.concat(c)));
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

const err = (res: ServerResponse, status: number, code: string) => send(res, status, { error: code, message: code });

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST" });
    return res.end();
  }
  const raw = await read(req);
  let body: Record<string, unknown> = {};
  try {
    if (raw.length) body = JSON.parse(raw.toString("utf8"));
  } catch {
    if (path.startsWith(BASE)) return err(res, 400, "bad_request");
  }

  // ── The documented server API ──
  if (path.startsWith(BASE + "/")) {
    if (req.headers.authorization !== `Bearer ${SECRET}`) return err(res, 401, "bad_secret");
    const rel = path.slice(BASE.length);

    if (req.method === "POST" && rel === "/session/verify") {
      const s = typeof body.session === "string" ? sessions.get(body.session) : undefined;
      if (!s) return err(res, 401, "invalid_token");
      if (s.exp < Date.now()) return err(res, 401, "expired");
      const p = players.get(s.playerId)!;
      return send(res, 200, { playerId: p.id, name: p.name, gameId: GAME_ID, exp: s.exp, mode: "test" });
    }

    const pm = rel.match(/^\/purchases\/([^/]+)(\/deliver)?$/);
    if (pm) {
      const x = purchases.get(decodeURIComponent(pm[1]));
      if (!x) return err(res, 404, "not_found");
      if (req.method === "GET" && !pm[2]) return send(res, 200, purchaseView(x));
      if (req.method === "POST" && pm[2]) {
        if (x.status === "refunded") return err(res, 409, "refunded");
        if (x.status !== "delivered") {
          x.status = "delivered";
          x.deliveredAt = Date.now();
        }
        return send(res, 200, { id: x.id, status: "delivered", deliveredAt: x.deliveredAt });
      }
    }

    const mm = rel.match(/^\/matches\/([^/]+)(\/result)?$/);
    if (mm) {
      const m = matches.get(decodeURIComponent(mm[1]));
      if (!m) return err(res, 404, "not_found");
      if (req.method === "GET" && !mm[2]) return send(res, 200, apiView(m));
      if (req.method === "POST" && mm[2]) {
        // Verify exactly as the docs describe — independently of our server's code.
        const ts = String(req.headers["x-vatar-timestamp"] ?? "");
        const got = String(req.headers["x-vatar-signature"] ?? "");
        const nowS = Math.floor(Date.now() / 1000);
        if (!/^\d+$/.test(ts) || Math.abs(nowS - Number(ts)) > 300) {
          resultsLog.push({ matchId: m.id, winner: String(body.winner), ok: false, why: "stale_timestamp" });
          return err(res, 401, "stale_timestamp");
        }
        const sha = createHash("sha256").update(raw).digest("hex");
        const want = "v1=" + createHmac("sha256", RESULTS_SECRET).update(["POST", path, ts, m.nonce, sha].join("\n")).digest("hex");
        const a = Buffer.from(want);
        const b = Buffer.from(got);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          resultsLog.push({ matchId: m.id, winner: String(body.winner), ok: false, why: "bad_signature" });
          return err(res, 401, "bad_signature");
        }
        const winner = body.winner;
        if (typeof winner !== "string" || (winner !== "draw" && !m.players.includes(winner))) return err(res, 400, "bad_request");
        if (m.status === "done") {
          if (m.winner === winner) return send(res, 200, apiView(m)); // a replay: same answer
          return err(res, 409, "already_settled");
        }
        if (m.status !== "playing") return err(res, 409, "not_playing");
        m.status = "done";
        m.winner = winner;
        m.settledAt = Date.now();
        const pot = m.stake * m.players.length;
        if (winner === "draw") for (const id of m.players) players.get(id)!.money += m.stake;
        else players.get(winner)!.money += Math.floor(pot * 0.95);
        m.result = { winner, pot, payout: winner === "draw" ? 0 : Math.floor(pot * 0.95), houseCut: winner === "draw" ? 0 : pot - Math.floor(pot * 0.95) };
        for (const id of m.players) current.delete(id);
        resultsLog.push({ matchId: m.id, winner, ok: true });
        console.log(`result settled ${m.id}: ${winner === "draw" ? "draw" : "winner"} (signature OK)`);
        webhook("match.settled", { matchId: m.id, winner });
        return send(res, 200, apiView(m));
      }
    }
    return err(res, 404, "not_found");
  }

  // ── The world's side of the SDK (mock only) ──
  if (path === "/mock/init" && req.method === "POST") {
    const name = String(body.name ?? "Tester").slice(0, 24) || "Tester";
    // The same Lagos Life account always gets the same per-game id: a reload is
    // the same player (here, "same account" = same test name).
    let p = [...players.values()].find((x) => x.name === name);
    if (!p) {
      p = { id: "t_" + rid(10), name, money: START_MONEY };
      players.set(p.id, p);
    }
    return send(res, 200, { player: { id: p.id, name: p.name, avatar: null }, ...issue(p.id), mode: "test" });
  }
  if (req.method === "GET" && path === "/mock/results") return send(res, 200, resultsLog);
  const p = who(body.session ?? url.searchParams.get("session"));
  if (path.startsWith("/mock/") && !p) return err(res, 401, "signed_out");
  if (p && req.method === "POST") {
    if (path === "/mock/session") return send(res, 200, issue(p.id));
    if (path === "/mock/match/create") {
      if (current.has(p.id) && matches.get(current.get(p.id)!)?.status === "open") return err(res, 409, "busy");
      const r = newMatch(p, Number(body.stake ?? 0), Number(body.seats ?? 2));
      return typeof r === "string" ? err(res, 400, r) : send(res, 200, view(r, p.id));
    }
    if (path === "/mock/match/join") {
      const m = byCode.get(String(body.code ?? "").toUpperCase());
      if (!m) return err(res, 404, "not_found");
      const e = join(m, p);
      return e ? err(res, 409, e) : send(res, 200, view(m, p.id));
    }
    if (path === "/mock/match/quick") {
      const stake = Number(body.stake ?? 0);
      let m = [...matches.values()].find((x) => x.status === "open" && x.stake === stake && x.seats === 2 && !x.players.includes(p.id));
      if (!m) {
        const r = newMatch(p, stake, 2);
        if (typeof r === "string") return err(res, 400, r);
        m = r;
      } else {
        const e = join(m, p);
        if (e) return err(res, 409, e);
      }
      return send(res, 200, view(m, p.id));
    }
    if (path === "/mock/match/leave") {
      const id = current.get(p.id);
      const m = id ? matches.get(id) : undefined;
      if (m && m.status === "open") {
        m.players = m.players.filter((x) => x !== p.id);
        p.money += m.stake; // leaving before the start gives the stake back
        current.delete(p.id);
        if (!m.players.length) m.status = "cancelled";
      }
      return send(res, 200, m ? view(m, p.id) : null);
    }
  }
  // The world's pay sheet: "Pay (test)". One-offs once per player.
  if (p && req.method === "POST" && path === "/mock/purchase") {
    const productId = String(body.productId ?? "");
    const price = FOR_SALE.get(productId);
    if (price === undefined) return err(res, 404, "not_for_sale");
    if (body.fail) return err(res, 402, "payment_failed");
    const already = [...purchases.values()].some((x) => x.playerId === p.id && x.productId === productId && x.status !== "refunded");
    if (already) return err(res, 409, "owned");
    const x: Purchase = { id: rid(10), productId, playerId: p.id, amount: price, status: "paid", createdAt: Date.now() };
    purchases.set(x.id, x);
    webhook("purchase.paid", { purchaseId: x.id, productId, playerId: p.id, amount: price, currency: "NGN" });
    return send(res, 200, { purchaseId: x.id, productId });
  }
  if (p && req.method === "GET" && path === "/mock/purchases") {
    const list = [...purchases.values()].filter((x) => x.playerId === p.id && x.status === "paid").map((x) => ({ purchaseId: x.id, productId: x.productId }));
    return send(res, 200, list);
  }
  if (req.method === "POST" && path === "/mock/refund") {
    const x = purchases.get(String(body.purchaseId ?? ""));
    if (!x) return err(res, 404, "not_found");
    x.status = "refunded";
    return send(res, 200, purchaseView(x));
  }
  if (p && req.method === "GET" && path === "/mock/match/current") {
    const id = current.get(p.id) ?? url.searchParams.get("last") ?? "";
    const m = matches.get(id);
    return send(res, 200, m && m.players.includes(p.id) ? { ...view(m, p.id), money: p.money } : null);
  }
  return err(res, 404, "not_found");
}).listen(PORT, () => console.log(`MOCK Lagos Life platform on :${PORT} (secrets: ${SECRET} / ${RESULTS_SECRET})`));
