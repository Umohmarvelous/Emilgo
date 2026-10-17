// EMILGO Games server: one process, one WebSocket endpoint, many rooms.
//
//   GET  /health         200 "ok"            (load balancer / uptime checks)
//   GET  /metrics        JSON counters        (rooms, players, tick cost)
//   POST /vatar-webhook  Lagos Life events    (signed; nudges only, never trusted alone)
//   GET  /reports        player reports       (Authorization: Bearer $ADMIN_TOKEN; off if unset)
//   POST /shop/claim     { session, purchaseId } → verify with Lagos Life, give once, deliver
//   POST /shop/owned     { session } → what this player owns + a signed ticket
//   WS   /               the game protocol    (src/net/protocol.ts)
//
// Every room is stepped by ONE fixed 60 Hz loop. A round is tiny — at most a
// dozen runners for about a minute — so a single core hosts thousands of them;
// scale out by running more processes behind a sticky load balancer (see the
// README). Nothing is stored: restart the process and every room is gone.
//
// Environment:
//   PORT              default 8787
//   GAMES_ORIGINS    comma-separated allowed Origin headers (unset = allow all)
//   MAX_PEERS         default 20000 connections per process
//   MAX_PER_IP        default 32 connections per address
//   TRUST_PROXY       "1" to read the client address from CF-Connecting-IP / X-Forwarded-For
//   LAG_GRACE_CAP     seconds; default NET.lagGraceCap. 0 only to prove the fairness test
//
// Lagos Life matches (Phase 3) — server-side only, never in the game's code:
//   VATAR_SECRET          vtr_test_… (sandbox) or vtr_live_… (after approval)
//   VATAR_RESULTS_SECRET  signs match results
//   VATAR_WEBHOOK_SECRET  vtr_whsec_… — checks webhook signatures (optional)
//   VATAR_API             default https://lagoslife.app/api/games/v1
// Without VATAR_SECRET + VATAR_RESULTS_SECRET, match requests get "vatar_off".
//
//   ADMIN_TOKEN           long random string; unlocks GET /reports for moderators
//   DATA_DIR              where the ownership database lives (default ./data)
//   TICKET_SECRET         32+ chars; signs ownership tickets. Required when running several processes

import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import { NET } from "../../src/config";
import { cleanName, ERROR_TEXT, parseClient, type ClientMsg, type ErrorCode } from "../../src/net/protocol";
import { now } from "./clock";
import { Lobby } from "./lobby";
import { Peer } from "./peer";
import { allowedLook } from "../../src/shop/catalog";
import { Shop } from "./shop";
import { SqliteStore } from "./store";
import { VatarApi, vatarConfigFromEnv, webhookSigned } from "./vatar";

const PORT = Number(process.env.PORT ?? 8787);
const MAX_PEERS = Number(process.env.MAX_PEERS ?? 20000);
const MAX_PER_IP = Number(process.env.MAX_PER_IP ?? 32);
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const ORIGINS = (process.env.GAMES_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const vatarCfg = vatarConfigFromEnv(process.env);
const vatar = vatarCfg ? new VatarApi(vatarCfg) : null;
// Match events, without player ids or names: enough to operate, nothing to leak.
const lobby = new Lobby(vatar, (event, info) => console.log(`match ${event} ${JSON.stringify(info)}`));
const store = vatar ? new SqliteStore(`${process.env.DATA_DIR ?? "./data"}/emilgo-games.db`) : null;
const shop = vatar && store ? new Shop(vatar, store, process.env.TICKET_SECRET, (e, info) => console.log(`shop ${e} ${JSON.stringify(info)}`)) : null;
/** Shop HTTP calls per address: 30 a minute is plenty for a person, tight for a script. */
const shopCalls = new Map<string, number[]>();

/** Webhook delivery ids already handled (each delivery has its own id; retries repeat it). */
const deliveries = new Set<string>();
const peers = new Map<string, Peer>(); // by id
const byToken = new Map<string, Peer>();
const perIp = new Map<string, number>();
const tickCost: number[] = [];
const started = now();
let messagesIn = 0;

/**
 * Reports, kept in memory for whoever moderates (a person — see the README).
 * Room-scoped: what was said, by which display name, and why. No addresses,
 * no ids that outlive the process.
 */
interface Report {
  at: string;
  reason: string;
  name: string;
  lines: string[];
}
const reports: Report[] = [];

// ── HTTP ──────────────────────────────────────────────────────────────────────

const http = createServer((req, res) => {
  if (req.url === "/shop/claim" || req.url === "/shop/owned") {
    shopRoute(req, res, req.url);
    return;
  }
  if (req.url === "/vatar-webhook" && req.method === "POST") {
    webhook(req, res);
    return;
  }
  if (req.url === "/reports") {
    const token = process.env.ADMIN_TOKEN;
    const got = String(req.headers.authorization ?? "");
    if (!token || token.length < 24 || got !== `Bearer ${token}`) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(reports));
    return;
  }
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" }).end("ok");
    return;
  }
  if (req.url === "/metrics") {
    const sorted = [...tickCost].sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
    const body = {
      uptimeS: Math.round((now() - started) / 1000),
      peers: peers.size,
      connected: [...peers.values()].filter((p) => p.connected).length,
      ...lobby.stats(),
      tickMs: { p50: round2(pct(0.5)), p99: round2(pct(0.99)), max: round2(sorted[sorted.length - 1] ?? 0) },
      messagesIn,
      reports: reports.length,
      rssMb: Math.round(process.memoryUsage().rss / 1e6),
    };
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    return;
  }
  res.writeHead(404).end();
});

// ── WebSocket ─────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({
  server: http,
  maxPayload: NET.maxMessageBytes,
  perMessageDeflate: false, // CPU per message matters more than bytes at 6 KB/s
  verifyClient: ({ req, origin }: { req: IncomingMessage; origin: string }, done: (ok: boolean, code?: number) => void) => {
    if (ORIGINS.length && !ORIGINS.includes(origin)) return done(false, 403);
    if (peers.size >= MAX_PEERS) return done(false, 503);
    if ((perIp.get(addressOf(req)) ?? 0) >= MAX_PER_IP) return done(false, 429);
    done(true);
  },
});

wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
  const ip = addressOf(req);
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  let peer: Peer | null = new Peer(socket, ip);
  // Until hello, this connection is nobody. Five seconds to say who you are.
  const helloTimer = setTimeout(() => {
    if (peer && !peer.hello) socket.close(4000, "no hello");
  }, 5000);

  socket.on("message", (data, isBinary) => {
    if (!peer || isBinary) return;
    messagesIn++;
    peer.lastSeen = now();
    if (!peer.allow()) {
      if (peer.abusive) socket.close(4008, "rate");
      return;
    }
    const msg = parseClient(data.toString());
    if (!msg) return sendErr(peer, "bad");
    if (!peer.hello) {
      if (msg.t !== "hello") return;
      clearTimeout(helloTimer);
      peer = hello(peer, socket, msg);
      return;
    }
    handle(peer, msg);
  });

  socket.on("close", () => {
    clearTimeout(helloTimer);
    perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1));
    if (!perIp.get(ip)) perIp.delete(ip);
    if (!peer || peer.socket !== socket) return; // replaced by a resumed socket
    peer.detach();
    const room = lobby.roomOf(peer);
    if (room) room.dropped(peer);
    if (!peer.roomId) forget(peer);
  });

  socket.on("error", () => socket.terminate());
});

function hello(fresh: Peer, socket: WebSocket, msg: Extract<ClientMsg, { t: "hello" }>): Peer | null {
  if (msg.v !== NET.protocol) {
    fresh.send({ t: "err", code: "version", msg: ERROR_TEXT.version });
    socket.close(4001, "version");
    return null;
  }

  // Resume: the same player after a dropped connection keeps their seat.
  const old = msg.resume ? byToken.get(msg.resume) : undefined;
  if (old) {
    const previous = old.socket;
    old.attach(socket);
    if (previous && previous !== socket) previous.close(4002, "replaced");
    old.send({ t: "welcome", id: old.id, token: old.token, s: now(), name: old.name, ...counts() });
    pingSoon(old);
    lobby.roomOf(old)?.rejoined(old);
    return old;
  }

  fresh.hello = true;
  fresh.name = cleanName(msg.name, () => `Guest ${1000 + Math.floor(Math.random() * 9000)}`);
  peers.set(fresh.id, fresh);
  byToken.set(fresh.token, fresh);
  fresh.send({ t: "welcome", id: fresh.id, token: fresh.token, s: now(), name: fresh.name, ...counts() });
  pingSoon(fresh);
  return fresh;
}

function handle(peer: Peer, msg: ClientMsg): void {
  const room = lobby.roomOf(peer);
  switch (msg.t) {
    case "in":
      room?.input(peer, msg.x, msg.z, msg.b, msg.j, msg.a, msg.g);
      break;
    case "pong":
      peer.pong(msg.s);
      break;
    case "quick":
      sendErr(peer, lobby.quick(peer, msg.mode, msg.dist));
      break;
    case "create":
      sendErr(peer, lobby.create(peer, msg.size, msg.mode, msg.dist));
      break;
    case "join":
      sendErr(peer, lobby.join(peer, msg.code));
      break;
    case "start":
      if (room) sendErr(peer, room.requestStart(peer));
      break;
    case "leave":
      lobby.leave(peer);
      peer.send({ t: "left" });
      break;
    case "chat":
      room?.chat(peer, msg.text);
      break;
    case "emote":
      room?.emote(peer, msg.e);
      break;
    case "report": {
      const target = room?.peerInSeat(msg.id);
      if (!target || target === peer) break;
      reports.push({ at: new Date().toISOString(), reason: msg.reason, name: target.name, lines: [...target.recent] });
      if (reports.length > 500) reports.shift();
      console.log(`report ${msg.reason} (${reports.length} held)`);
      peer.send({ t: "note", text: "Reported. Thank you — we'll look at it." });
      break;
    }
    case "block": {
      const target = room?.peerInSeat(msg.id);
      if (!target || target === peer) break;
      peer.blocks.add(target.id);
      target.blocks.add(peer.id);
      peer.send({ t: "note", text: `Blocked ${target.name}. You won't see each other's messages or be matched together.` });
      break;
    }
    case "look": {
      // Only what a genuine ticket says you own is ever shown to anyone.
      const t = msg.ticket ? shop?.verify(msg.ticket) : null;
      peer.owned = new Set(t?.o ?? []);
      peer.look = allowedLook(msg.look, peer.owned);
      // The room shows everyone's look while they wait together.
      lobby.roomOf(peer)?.broadcastRoom();
      break;
    }
    case "vmatch":
      lobby
        .playMatch(peer, msg.id, msg.session)
        .then((code) => sendErr(peer, code))
        .catch(() => sendErr(peer, "verify"));
      break;
    case "hello":
      break;
  }
}

/**
 * Lagos Life webhooks: match.started, match.settled, purchase.paid. They are
 * nudges, never proof — nothing here grants or decides anything. We answer 2xx
 * fast (they allow 5 s), verify the signature in constant time, and drop
 * repeats by delivery id.
 */
function webhook(req: IncomingMessage, res: import("node:http").ServerResponse): void {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > 64 * 1024) req.destroy();
    else chunks.push(c);
  });
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    if (!vatarCfg?.webhookSecret) return void res.writeHead(503).end();
    if (!webhookSigned(raw, req.headers["x-vatar-signature"], vatarCfg.webhookSecret)) return void res.writeHead(401).end();
    const delivery = String(req.headers["x-vatar-delivery"] ?? "");
    if (delivery && deliveries.has(delivery)) return void res.writeHead(200).end();
    if (delivery) {
      deliveries.add(delivery);
      if (deliveries.size > 5000) deliveries.delete(deliveries.values().next().value!);
    }
    let evt: { type?: string; mode?: string; data?: { matchId?: string; id?: string; purchaseId?: string } } = {};
    try {
      evt = JSON.parse(raw.toString("utf8"));
    } catch {
      return void res.writeHead(400).end();
    }
    console.log(`webhook ${String(evt.type)} (${String(evt.mode)})`);
    res.writeHead(200).end();
    // A nudge only: the shop re-checks the purchase with the API before giving anything.
    if (evt.type === "purchase.paid" && typeof evt.data?.purchaseId === "string" && shop) void shop.onPaidWebhook(evt.data.purchaseId);
  });
}

/**
 * The shop's HTTP side. CORS is open: these calls carry no cookies and prove
 * who you are only with a Lagos Life session token in the body, which our
 * server checks with Lagos Life itself.
 */
function shopRoute(req: IncomingMessage, res: import("node:http").ServerResponse, path: string): void {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" };
  if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
  if (req.method !== "POST") return void res.writeHead(405, cors).end();
  const reply = (status: number, body: unknown): void => {
    res.writeHead(status, { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
  };
  if (!shop) return reply(503, { error: "shop_off" });
  const ip = addressOf(req);
  const t = Date.now();
  const calls = (shopCalls.get(ip) ?? []).filter((x) => t - x < 60_000);
  if (calls.length >= 30) return reply(429, { error: "rate_limited" });
  calls.push(t);
  shopCalls.set(ip, calls);
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > 4096) req.destroy();
    else chunks.push(c);
  });
  req.on("end", () => {
    let body: { session?: unknown; purchaseId?: unknown } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return reply(400, { error: "bad_request" });
    }
    const session = typeof body.session === "string" && body.session.length <= 900 ? body.session : null;
    if (!session) return reply(400, { error: "bad_request" });
    const work =
      path === "/shop/claim"
        ? typeof body.purchaseId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.purchaseId)
          ? shop.claim(session, body.purchaseId)
          : Promise.resolve({ ok: false as const, status: 400, error: "bad_request" })
        : shop.owned(session);
    work
      .then((r) => (r.ok ? reply(200, { owned: r.owned, ticket: r.ticket, granted: r.granted }) : reply(r.status, { error: r.error })))
      .catch(() => reply(500, { error: "error" }));
  });
}

function sendErr(peer: Peer, code: ErrorCode | null): void {
  if (code) peer.send({ t: "err", code, msg: ERROR_TEXT[code] });
}

/** Three quick pings so the first round already has a lag allowance. */
function pingSoon(peer: Peer): void {
  for (const ms of [50, 400, 800]) setTimeout(() => peer.connected && peer.ping(), ms);
}

function forget(peer: Peer): void {
  peers.delete(peer.id);
  byToken.delete(peer.token);
}

function addressOf(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    // Behind a Cloudflare tunnel every connection comes from cloudflared;
    // Cloudflare sets CF-Connecting-IP to the real player and overwrites any
    // copy the player sends.
    const cf = String(req.headers["cf-connecting-ip"] ?? "").trim();
    if (cf) return cf;
    const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress ?? "?";
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ── Loops ─────────────────────────────────────────────────────────────────────

const STEP = 1 / NET.tickHz;
let last = now();
let acc = 0;

// Runs at ~2× the tick rate so steps land close to on time; the accumulator
// keeps the referee on an exact 60 Hz however the timer jitters.
setInterval(() => {
  const t = now();
  acc += (t - last) / 1000;
  last = t;
  let steps = 0;
  const t0 = performance.now();
  while (acc >= STEP && steps < 5) {
    lobby.tick(STEP);
    acc -= STEP;
    steps++;
  }
  if (steps === 5) acc = 0; // never spiral after a stall
  if (steps) {
    tickCost.push((performance.now() - t0) / steps);
    if (tickCost.length > 600) tickCost.shift();
  }
}, 1000 / NET.tickHz / 2);

/** People on the server, and people in a round right now (the lobby's friends panel). */
function counts(): { on: number; pl: number } {
  let on = 0;
  for (const p of peers.values()) if (p.connected) on++;
  let pl = 0;
  for (const p of peers.values()) if (p.connected && lobby.roomOf(p)?.playing) pl++;
  return { on, pl };
}

// Every 15 s, tell those not mid-round how busy it is.
setInterval(() => {
  const c = counts();
  const msg = Buffer.from(JSON.stringify({ t: "stats", ...c }));
  for (const p of peers.values()) if (p.connected && !lobby.roomOf(p)?.playing) p.sendRaw(msg);
}, 15_000).unref();

setInterval(() => {
  const t = now();
  for (const peer of peers.values()) {
    if (peer.connected) {
      // A socket that has said nothing for 30 s is dead, whatever TCP thinks.
      if (t - peer.lastSeen > 30_000) peer.socket!.terminate();
      else peer.ping();
    } else if (peer.droppedAt && t - peer.droppedAt > NET.rejoinMs) {
      // Too late to rejoin: give up their seat for good.
      lobby.leave(peer);
      forget(peer);
    }
  }
}, NET.pingEveryMs);

http.listen(PORT, () => {
  console.log(`emilgo games server on :${PORT}${ORIGINS.length ? ` (origins: ${ORIGINS.join(", ")})` : ""}`);
  console.log(vatar ? `Lagos Life matches + shop: ON (${vatar.mode} mode, ${vatarCfg!.api})` : "Lagos Life matches + shop: off (no VATAR_SECRET / VATAR_RESULTS_SECRET)");
  if (vatar) void vatar.keyCheck().then((r) => console.log(r.detail));
  // Finish any delivery a crash interrupted, now and every five minutes.
  if (shop) {
    void shop.retryUndelivered();
    setInterval(() => void shop.retryUndelivered(), 5 * 60_000).unref();
  }
});

function shutdown(): void {
  store?.close();
  console.log("emilgo games server: shutting down");
  for (const peer of peers.values()) peer.socket?.close(1012, "restart");
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
