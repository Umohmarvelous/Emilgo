// The billboards (SPEC-V3 §8), end to end.
//
//   Offline (no server): the boards stand in both worlds where nothing else
//   is (clear of every other solid, every road and every start, apart from
//   each other), with stable ids, built the same every time, their solids on
//   the end (Spooky World's gates still point at their own solids). The
//   phone's side: Lagos Life never asks and never reports; a feed is checked
//   field by field (http elsewhere than this machine, a bad id, a slideshow
//   with no pictures: dropped); offline it plays the kept copy for a day,
//   with no token. The server's side: Lagos Life refused, an unknown map
//   refused, creatives cleaned and kept to the map's boards, a token taken
//   once, a forged or old one refused, seconds only for boards on the map and
//   creatives served for it, added up with nothing about who, then sent.
//   Online (GAME set): the same over HTTP against the real server.
//
//   node server/build-tools.mjs && node server/dist/adstest.mjs
//   GAME=ws://localhost:8797 node server/dist/adstest.mjs

import { existsSync, readFileSync } from "node:fs";

import { buildNaijaWorld } from "../../src/maps/open/naija";
import { buildSpookyWorld } from "../../src/maps/open/spooky";
import { BOARD_DEPTH, faceOf } from "../../src/maps/open/billboards";
import { adsUrl, checkFeed, fetchFeed, reportSeen } from "../../src/net/ads";
import { Billboards, boardIds, type AdsBackend, type SeenRow } from "../src/ads";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

console.log("the boards in the worlds:");
const naija = buildNaijaWorld();
const spooky = buildSpookyWorld();
for (const L of [naija, spooky]) {
  const boards = L.boards ?? [];
  const name = L.id;
  check(boards.length >= (L === naija ? 10 : 6), `${name}: ${boards.length} boards`);
  const pre = L === naija ? "nw" : "sw";
  check(boards.every((b, i) => new RegExp(`^${pre}-\\d{2}$`).test(b.id) && (i === 0 || b.id > boards[i - 1].id)), `${name}: ids in order (${boards.map((b) => b.id.slice(3)).join(" ")})`);
  check(boards.some((b) => b.premium), `${name}: premium boards (${boards.filter((b) => b.premium).map((b) => b.id).join(", ")})`);
  const again = (L === naija ? buildNaijaWorld() : buildSpookyWorld()).boards ?? [];
  check(JSON.stringify(again) === JSON.stringify(boards), `${name}: built the same again`);
  // Their solids: two each, the last ones.
  const n = boards.length * 2;
  const tail = L.solids.slice(-n);
  const before = L.solids.slice(0, -n);
  check(boards.every((b, i) => Math.hypot(tail[i * 2 + 1].x - b.x, tail[i * 2 + 1].z - b.z) < 0.01), `${name}: each board's pole and panel are on the end of the solids`);
  // Nothing else where a pole stands or a panel hangs.
  let clash = "";
  for (const b of boards) {
    for (const s of before) {
      if (s.kind === "pit") continue;
      const d = Math.hypot(s.x - b.x, s.z - b.z);
      if (d > Math.hypot(s.hx, s.hz) + b.w / 2 + 1) continue;
      // The panel's footprint against the solid (in the solid's axes, corner samples).
      const c = Math.cos(b.rot);
      const sn = Math.sin(b.rot);
      for (let u = -b.w / 2; u <= b.w / 2; u += 0.5) {
        for (const v of [-BOARD_DEPTH / 2, BOARD_DEPTH / 2]) {
          const x = b.x + u * c + v * sn;
          const z = b.z - u * sn + v * c;
          const oc = Math.cos(s.rot);
          const os = Math.sin(s.rot);
          const lx = (x - s.x) * oc - (z - s.z) * os;
          const lz = (x - s.x) * os + (z - s.z) * oc;
          const tall = s.y1 > b.y - 1.5 || Math.abs(u) < 0.5;
          if (tall && Math.abs(lx) < s.hx && Math.abs(lz) < s.hz) clash ||= `${b.id} in a solid at ${s.x.toFixed(1)},${s.z.toFixed(1)}`;
        }
      }
    }
  }
  check(!clash, `${name}: no board stands in anything (${clash || "clear"})`);
  const onRoad = boards.filter((b) => {
    const g = L.groundAt(b.x, b.z);
    return L.roads.some((r) => {
      const dx = r.x1 - r.x0;
      const dz = r.z1 - r.z0;
      const t = Math.max(0, Math.min(1, ((b.x - r.x0) * dx + (b.z - r.z0) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(r.x0 + dx * t - b.x, r.z0 + dz * t - b.z) < r.w / 2 + 0.5;
    }) && (g === "asphalt" || g === "laterite");
  });
  check(!onRoad.length, `${name}: no pole on a road (${onRoad.map((b) => b.id).join(", ") || "none"})`);
  const nearStart = boards.filter((b) => L.spawns.some(([x, z]) => Math.hypot(x - b.x, z - b.z) < 5));
  check(!nearStart.length, `${name}: no board on a start`);
  let close = Infinity;
  for (let i = 0; i < boards.length; i++) for (let j = i + 1; j < boards.length; j++) close = Math.min(close, Math.hypot(boards[i].x - boards[j].x, boards[i].z - boards[j].z));
  check(close >= 16, `${name}: boards at least 16 m apart (closest ${close.toFixed(1)} m)`);
  const faces = boards.map(faceOf);
  check(faces.every((f, i) => Math.abs(Math.hypot(f.nx, f.nz) - 1) < 1e-9 && f.y > boards[i].y), `${name}: each face is up on its pole, facing out`);
}
{
  const run = spooky.run;
  const ok = run.gates.every((g) => Math.hypot(spooky.solids[g.solid].x - g.x, spooky.solids[g.solid].z - g.z) < 3);
  check(ok, `Spooky World: the ${run.gates.length} gates still point at their own solids`);
  check(boardIds("naija-world")?.size === naija.boards?.length && boardIds("spooky-world")?.size === spooky.boards?.length && boardIds("nowhere") === null, "the server knows the same boards per map");
  // The ad stack's list of boards (supabase/migrations/migration_game_billboards.sql) is the same list.
  const sql = new URL("../../../../supabase/migrations/migration_game_billboards.sql", import.meta.url);
  if (existsSync(sql)) {
    const text = readFileSync(sql, "utf8");
    const rows = [...text.matchAll(/\('([a-z]{2}-\d{2})', '([a-z-]+)', '([a-z]+)', (TRUE|FALSE) ?, '/g)].map((m) => `${m[1]} ${m[2]} ${m[3]} ${m[4] === "TRUE"}`);
    const game = [...(naija.boards ?? []).map((b) => `${b.id} naija-world ${b.kind} ${b.premium}`), ...(spooky.boards ?? []).map((b) => `${b.id} spooky-world ${b.kind} ${b.premium}`)];
    check(JSON.stringify(rows) === JSON.stringify(game), `the ad stack lists the same ${game.length} boards (${rows.length} in the migration)`);
  } else check(false, "the billboards migration is where it should be");
}

console.log("the phone:");
const AD = "0f3c9a2e-1111-4a5b-9c8d-0123456789ab";
const AD2 = "0f3c9a2e-2222-4a5b-9c8d-0123456789ab";
const good = {
  v: 1,
  map: "naija-world",
  tok: "abcdefghijklmnop_xyz_ABCDEFGHIJKLMNOPQRSTUV",
  ads: [
    { id: AD, format: "static", images: ["https://cdn.example.org/a.jpg"], cycle: 10, audio: false, slots: [], premium: false },
    { id: AD2, format: "slideshow", images: ["https://cdn.example.org/1.jpg", "https://cdn.example.org/2.jpg"], cycle: 30, audio: false, slots: ["nw-02"], premium: true },
    { id: "not-a-uuid", format: "static", images: ["https://cdn.example.org/a.jpg"] },
    { id: AD, format: "static", images: ["http://cdn.example.org/a.jpg"] },
    { id: AD, format: "slideshow", images: [] },
    { id: AD, format: "video", video: "https://cdn.example.org/a.mp4", poster: null },
  ],
};
{
  const f = checkFeed(good, "naija-world");
  check(f?.ads.length === 2 && f.ads[1].premium && f.ads[0].cycle === 10, `a feed is checked field by field: 2 of 6 kept (${f?.ads.length})`);
  check(checkFeed({ ...good, map: "spooky-world" }, "naija-world") === null, "a feed for another map is refused");
  check(adsUrl("lagoslife", "wss://games.example", "naija-world") === null, "Lagos Life: no ads address at all");
  check(adsUrl("web", "wss://games.example", "naija-world") === "https://games.example/ads/v1/match?map=naija-world&host=web", "the web: our server's ads address");
  const mem = new Map<string, string>();
  const store = { load: (k: string) => mem.get(k) ?? null, save: (k: string, v: string) => void mem.set(k, v) };
  let asked = 0;
  const fake = (body: unknown, ok = true) => async () => {
    asked++;
    return { ok, json: async () => body } as Response;
  };
  check((await fetchFeed(store, "lagoslife", "wss://games.example", "naija-world", fake(good))) === null && asked === 0, "Lagos Life never asks for ads");
  const live = await fetchFeed(store, "web", "wss://games.example", "naija-world", fake(good));
  check(!!live?.tok && live.ads.length === 2 && asked === 1, "the web asks at match start, and gets a token");
  const offline = async (): Promise<Response> => {
    throw new Error("offline");
  };
  const kept = await fetchFeed(store, "web", "wss://games.example", "naija-world", offline);
  check(kept?.ads.length === 2 && kept.tok === null, "offline: the kept copy, with no token (it can't be reported twice)");
  const raw = JSON.parse(mem.get("ads.v1.naija-world")!);
  mem.set("ads.v1.naija-world", JSON.stringify({ ...raw, at: Date.now() - 25 * 3600_000 }));
  check((await fetchFeed(store, "web", "wss://games.example", "naija-world", offline)) === null, "a copy over a day old: house boards");
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const post = async (url: string, init?: RequestInit): Promise<Response> => {
    sent.push({ url, body: JSON.parse(String(init?.body)) });
    return { ok: true } as Response;
  };
  check(!reportSeen("lagoslife", "wss://games.example", live, [["nw-01", AD, 9]], post) && !sent.length, "Lagos Life never reports");
  check(!reportSeen("web", "wss://games.example", kept, [["nw-01", AD, 9]], post), "a kept copy is never reported (no token)");
  reportSeen("web", "wss://games.example", live, [["nw-01", AD, 9.3], ["nw-02", AD2, 0.5]], post);
  const b = sent[0]?.body;
  check(
    sent.length === 1 && sent[0].url === "https://games.example/ads/v1/seen" && JSON.stringify(Object.keys(b).sort()) === JSON.stringify(["host", "map", "seen", "tok", "v"]) && JSON.stringify(b.seen) === JSON.stringify([["nw-01", AD, 9.5]]),
    `the report: board, creative, seconds (under a second dropped), nothing about who (${JSON.stringify(b)})`,
  );
}

console.log("the server:");
{
  const [B1, B2] = (naija.boards ?? []).map((b) => b.id);
  let now = Date.UTC(2026, 10, 2, 12, 0, 0);
  const recorded: SeenRow[][] = [];
  const backend: AdsBackend = {
    next: async (map) =>
      map === "naija-world"
        ? [
            { id: AD, format: "static", images: ["https://cdn.example.org/a.jpg"], cycle: 10, slots: [] },
            { id: AD2, format: "static", images: ["https://cdn.example.org/b.jpg"], cycle: 0, slots: [B2, "sw-01"], premium: true },
            { id: "0f3c9a2e-3333-4a5b-9c8d-0123456789ab", format: "static", images: ["https://cdn.example.org/c.jpg"], slots: ["sw-01"] },
            { id: "0f3c9a2e-4444-4a5b-9c8d-0123456789ab", format: "video", video: "javascript:alert(1)", poster: "https://cdn.example.org/p.jpg" },
          ]
        : [],
    record: async (rows) => void recorded.push(rows),
  };
  const bb = new Billboards(backend, () => {}, undefined, () => now);
  const ll = await bb.feed("naija-world", "lagoslife");
  check(ll.status === 403, "Lagos Life refused by the server too (403)");
  check((await bb.feed("the-moon", "web")).status === 404, "an unknown map: 404");
  const f = (await bb.feed("naija-world", "web")) as { status: number; body: { ads: { id: string; slots: string[]; premium: boolean }[]; tok: string } };
  const ids = f.body.ads.map((a) => a.id);
  check(f.status === 200 && ids.length === 2 && ids[0] === AD && ids[1] === AD2, `creatives cleaned: booked elsewhere and bad films dropped (${ids.length} of 4)`);
  check(JSON.stringify(f.body.ads[1].slots) === JSON.stringify([B2]) && f.body.ads[1].premium, "a booking keeps only this map's boards");
  const tok = f.body.tok;
  const report = (t: string, seen: unknown[], extra: Record<string, unknown> = {}) => bb.seen({ v: 1, map: "naija-world", host: "web", tok: t, seen, ...extra });
  check(report(tok, [[B1, AD, 12]], { host: "lagoslife" }).status === 403, "a Lagos Life report: refused");
  const r1 = report(tok, [[B1, AD, 12], [B2, AD2, 30], ["nw-99", AD, 5], [B1, "0f3c9a2e-9999-4a5b-9c8d-0123456789ab", 5], [B2, AD, 5000], [B1, AD, 12]]);
  check(r1.status === 204 && (r1.body as { counted: number }).counted === 2, `seconds counted only for this map's boards and served creatives, once each (${(r1.body as { counted: number }).counted} of 6)`);
  check(report(tok, [[B1, AD, 12]]).status === 409, "the same token again: refused");
  check(report(tok.slice(0, -2) + "zz", [[B1, AD, 12]]).status === 409, "a forged token: refused");
  const old = ((await bb.feed("naija-world", "web")) as { body: { tok: string } }).body.tok;
  now += 4 * 3600_000;
  check(report(old, [[B1, AD, 12]]).status === 409, "a token over 3 hours old: refused");
  const w = bb.waiting();
  check(w.length === 2 && w.every((r) => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(["ad", "day", "map", "secs", "slot", "views"])), "added up by day, map, board and creative: nothing about who");
  await bb.flush();
  check(recorded.length === 1 && recorded[0].length === 2 && bb.waiting().length === 0, "sent on, and the count starts again");
  const none = new Billboards(null, () => {});
  const nf = (await none.feed("spooky-world", "emilgo")) as { status: number; body: { ads: unknown[]; tok: string } };
  check(nf.status === 200 && nf.body.ads.length === 0 && !!nf.body.tok, "no ad stack: no creatives (house boards everywhere)");
}

const GAME = process.env.GAME;
if (GAME) {
  console.log("online:");
  const http = GAME.replace(/^ws/, "http").replace(/\/+$/, "");
  const ll = await fetch(`${http}/ads/v1/match?map=naija-world&host=lagoslife`);
  check(ll.status === 403, `GET for Lagos Life: ${ll.status}`);
  const res = await fetch(`${http}/ads/v1/match?map=spooky-world&host=web`);
  const body = (await res.json()) as { v: number; map: string; ads: unknown[]; tok: string };
  check(res.status === 200 && body.v === 1 && body.map === "spooky-world" && Array.isArray(body.ads) && !!body.tok, `GET for the web: ${res.status}, ${body.ads?.length} creatives, a token`);
  check(res.headers.get("access-control-allow-origin") === "*", "open CORS (no cookies, nothing about who)");
  const post = (b: unknown) => fetch(`${http}/ads/v1/seen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const r1 = await post({ v: 1, map: "spooky-world", host: "web", tok: body.tok, seen: [] });
  check(r1.status === 204, `a report: ${r1.status}`);
  const r2 = await post({ v: 1, map: "spooky-world", host: "web", tok: body.tok, seen: [] });
  check(r2.status === 409, `the same token again: ${r2.status}`);
  const r3 = await post({ v: 1, map: "spooky-world", host: "lagoslife", tok: body.tok, seen: [] });
  check(r3.status === 403, `a Lagos Life report: ${r3.status}`);
  const m = (await (await fetch(`${http}/metrics`)).json()) as { ads?: { refused: number; feeds: number } };
  check(!!m.ads && m.ads.refused >= 2 && m.ads.feeds >= 1, `the metrics count it (${JSON.stringify(m.ads)})`);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
