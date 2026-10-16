// End-to-end test of the shop, against the FAKE platform (mockvatar.ts) and our
// real game server. What Lagos Life requires, checked one by one:
//   - a purchase is ours to give only after the server checks it with the API
//   - given once per purchaseId, then marked delivered
//   - someone else's purchase, a forged session, a refunded purchase: nothing
//   - a product this build doesn't know: refused AND left undelivered
//   - webhook purchase.paid: granted without the phone asking
// And what the game itself promises:
//   - online, others see only what a genuine ticket says you own
//   - pack emotes only from pack owners; gold chat names only for buyers
//
//   node server/build-tools.mjs && node server/dist/shoptest.mjs
// Writes the buyer's session to $SHOPTEST_OUT (if set) for the restart check.

import { writeFileSync } from "node:fs";
import WebSocket from "ws";

import { NET } from "../../src/config";
import type { ServerMsg } from "../../src/net/protocol";

const PLATFORM = process.env.PLATFORM ?? "http://localhost:8790";
const GAME = process.env.GAME ?? "ws://localhost:8787";
const GAME_HTTP = GAME.replace(/^ws/, "http");
const SECRET = process.env.VATAR_SECRET ?? "vtr_test_mock";

/** Unique per run: the fake platform remembers players by name. */
const RUN = Math.random().toString(36).slice(2, 6);

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

const post = async <T>(base: string, path: string, body: object) => {
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => null)) as T };
};
const apiGet = async (path: string) => {
  const r = await fetch(`${PLATFORM}/api/games/v1${path}`, { headers: { Authorization: `Bearer ${SECRET}` } });
  return (await r.json()) as Record<string, unknown>;
};

interface P {
  id: string;
  session: string;
}
async function player(name: string): Promise<P> {
  const r = await post<{ player: { id: string }; session: string }>(PLATFORM, "/mock/init", { name });
  return { id: r.json.player.id, session: r.json.session };
}
const buy = (p: P, productId: string) => post<{ purchaseId: string; error?: string }>(PLATFORM, "/mock/purchase", { session: p.session, productId });
const claim = (p: P, purchaseId: string) =>
  post<{ owned?: string[]; ticket?: string; granted?: boolean; error?: string }>(GAME_HTTP, "/shop/claim", { session: p.session, purchaseId });
const owned = (session: string) => post<{ owned?: string[]; ticket?: string; error?: string }>(GAME_HTTP, "/shop/owned", { session });

/** A game client: hello, optional look, then create/join, collecting what it hears. */
function client(name: string) {
  const ws = new WebSocket(GAME);
  const heard: ServerMsg[] = [];
  let resolveOpen!: () => void;
  const opened = new Promise<void>((r) => (resolveOpen = r));
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: NET.protocol, name })));
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    heard.push(m);
    if (m.t === "welcome") resolveOpen();
    if (m.t === "ping") ws.send(JSON.stringify({ t: "pong", s: m.s }));
  });
  return {
    heard,
    opened,
    send: (o: object) => ws.send(JSON.stringify(o)),
    close: () => ws.close(),
    waitFor: (pred: (m: ServerMsg) => boolean, ms = 10_000) =>
      new Promise<ServerMsg | null>((resolve) => {
        const t0 = Date.now();
        const tick = () => {
          const hit = heard.find(pred);
          if (hit) return resolve(hit);
          if (Date.now() - t0 > ms) return resolve(null);
          setTimeout(tick, 50);
        };
        tick();
      }),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log(`shop test: platform ${PLATFORM}, game ${GAME}\n`);
  const a = await player(`Ada ${RUN}`);
  const b = await player(`Bayo ${RUN}`);

  console.log("buying and claiming:");
  const gold = await buy(a, "outfit_gold");
  check(gold.status === 200, "A pays for the Gold outfit (test sheet)");
  const c1 = await claim(a, gold.json.purchaseId);
  // The webhook and the phone race to grant it; whichever wins, it is granted once.
  check(c1.status === 200 && c1.json.owned?.filter((x) => x === "outfit_gold").length === 1, "claim → outfit_gold owned (exactly once)");
  check((await apiGet(`/purchases/${gold.json.purchaseId}`)).status === "delivered", "Lagos Life now says delivered");
  const c2 = await claim(a, gold.json.purchaseId);
  check(c2.status === 200 && c2.json.granted === false && c2.json.owned?.filter((x) => x === "outfit_gold").length === 1, "claiming again gives nothing new");
  check((await buy(a, "outfit_gold")).json.error === "owned", "a one-off can't be bought twice (platform says owned)");

  console.log("\nwhat must be refused:");
  const c3 = await claim(b, gold.json.purchaseId);
  check(c3.status === 403 && c3.json.error === "not_yours", "B claiming A's purchase → 403 not_yours");
  const c4 = await post<{ error?: string }>(GAME_HTTP, "/shop/claim", { session: "vtr1.forged", purchaseId: gold.json.purchaseId });
  check(c4.status === 401, `a forged session → 401 (${c4.json.error})`);
  const fut = await buy(a, "future_item");
  const c5 = await claim(a, fut.json.purchaseId);
  check(c5.status === 422 && c5.json.error === "unknown_product", "a product this build doesn't sell → 422");
  check((await apiGet(`/purchases/${fut.json.purchaseId}`)).status === "paid", "…and it is NOT marked delivered (stays restorable)");
  const cap = await buy(a, "cap_fila");
  await post(PLATFORM, "/mock/refund", { session: a.session, purchaseId: cap.json.purchaseId });
  const c6 = await claim(a, cap.json.purchaseId);
  check(c6.status === 409 && c6.json.error === "refunded", "a refunded purchase → 409, nothing given");
  check(!(await owned(a.session)).json.owned?.includes("cap_fila"), "cap not owned after the refund");
  const c7 = await post<{ error?: string }>(GAME_HTTP, "/shop/claim", { session: a.session, purchaseId: "../../etc" });
  check(c7.status === 400, "a malformed purchase id → 400");

  console.log("\nwebhook nudge (no claim from the phone):");
  const badge = await buy(a, "badge_gold");
  const pack = await buy(a, "emotes_owambe");
  await sleep(1500);
  const o1 = await owned(a.session);
  check(!!o1.json.owned?.includes("badge_gold") && !!o1.json.owned?.includes("emotes_owambe"), "purchase.paid webhook → granted on its own");
  check((await apiGet(`/purchases/${badge.json.purchaseId}`)).status === "delivered", "…and marked delivered");
  void pack;

  console.log("\nonline: looks, tickets, emote pack, gold names:");
  const ticketA = o1.json.ticket!;
  const ca = client("Ada");
  const cb = client("Bayo");
  await Promise.all([ca.opened, cb.opened]);
  ca.send({ t: "look", ticket: ticketA, look: { o: "outfit_gold", x: ["fila"], b: 1 } });
  // B has nothing — and tries to wear gold with a forged ticket.
  cb.send({ t: "look", ticket: ticketA.slice(0, -4) + "AAAA", look: { o: "outfit_gold", b: 1 } });
  ca.send({ t: "create", size: 2 });
  const room = (await ca.waitFor((m) => m.t === "room" && !!m.room.code)) as Extract<ServerMsg, { t: "room" }> | null;
  cb.send({ t: "join", code: room!.room.code });
  await sleep(400);
  ca.send({ t: "chat", text: "hello from gold" });
  await sleep(1600);
  cb.send({ t: "chat", text: "hello from plain" });
  const goldLine = (await cb.waitFor((m) => m.t === "chat" && m.text === "hello from gold")) as Extract<ServerMsg, { t: "chat" }> | null;
  const plainLine = (await ca.waitFor((m) => m.t === "chat" && m.text === "hello from plain")) as Extract<ServerMsg, { t: "chat" }> | null;
  check(goldLine?.b === 1, "A's chat line carries the gold name");
  check(!!plainLine && plainLine.b === undefined, "B's doesn't (a forged ticket buys nothing)");
  const start = (await cb.waitFor((m) => m.t === "start", 15_000)) as Extract<ServerMsg, { t: "start" }> | null;
  const ra = start?.start.roster.find((r) => r.name === "Ada");
  const rb = start?.start.roster.find((r) => r.name === "Bayo");
  check(ra?.look?.o === "outfit_gold" && ra.look.b === 1, "round roster: A in the Gold outfit, gold name");
  check(!ra?.look?.x?.includes("fila"), "…but no cap (A's cap was refunded)");
  check((!rb?.look?.o || rb.look.o === "street") && !rb?.look?.b, "round roster: B plain, whatever B claimed");
  await sleep(4000); // into the round
  cb.send({ t: "emote", e: "zanku" });
  await sleep(1600);
  cb.send({ t: "emote", e: "wave" });
  await sleep(1600);
  ca.send({ t: "emote", e: "zanku" });
  const bZanku = await ca.waitFor((m) => m.t === "emote" && m.e === "zanku" && m.from !== ra?.id, 2500);
  const bWave = await ca.waitFor((m) => m.t === "emote" && m.e === "wave", 2500);
  const aZanku = await cb.waitFor((m) => m.t === "emote" && m.e === "zanku", 2500);
  check(!bZanku, "B's pack emote (not owned) is dropped by the server");
  check(!!bWave, "B's free emote goes through");
  check(!!aZanku, "A's pack emote (owned) goes through");
  ca.close();
  cb.close();

  if (process.env.SHOPTEST_OUT) writeFileSync(process.env.SHOPTEST_OUT, a.session);
  console.log(`\n${failures ? `${failures} FAILED` : "all passed"}`);
  process.exit(failures ? 1 : 0);
}

void main();
