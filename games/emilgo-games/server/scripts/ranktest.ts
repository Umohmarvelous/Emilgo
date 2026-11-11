// The rank ladder and profiles (SPEC-V3 §1.4, §2), end to end.
//
//   Offline (no server): the ladder's thresholds match the spec's table, a rank
//   past the last tier banks its XP, the XP formulas, a short round pays in
//   proportion, the profile store adds and deletes, and the EMILGO token check
//   accepts a good token and refuses a forged, expired or anonymous one.
//   Online (GAME set): Ada proves who she is (an EMILGO token signed with the
//   server's SUPABASE_JWT_SECRET), Bisi is a guest. They play a Classic Run
//   round in a private room (both skip the walkout and walk, so nobody crosses
//   and the clock runs out). Ada's XP is stored and sent; Bisi only hears
//   what the round earned. A forged token is refused (off).
//
//   node server/build-tools.mjs && node server/dist/ranktest.mjs
//   GAME=ws://localhost:8797 RANK_SECRET=<the server's SUPABASE_JWT_SECRET> node server/dist/ranktest.mjs

import { allowedLook, toWireLook } from "../../src/shop/catalog";
import { cleanFigurines, FIGURINES, figurineLook } from "../../src/shop/figurines";
import { cleanLook } from "../../src/world/human/wardrobe";
import { HOODIE_DESIGNS } from "../../src/world/human/wardrobe";
import { divisionIndex } from "../../src/content/validate";
import { createHmac } from "node:crypto";
import WebSocket from "ws";

import { NET } from "../../src/config";
import { PHASES } from "../../src/game/rules";
import type { ServerMsg } from "../../src/net/protocol";
import { divisionStart, rankOf, rankUp, TOP_DIVISION } from "../../src/rank/ladder";
import { matchXp, runXp } from "../../src/rank/xp";
import { badgeOf, botBadge, cleanAwards, freshAwards, parseBadge, recordMatch, TIER_CP, type MatchFeats } from "../../src/rank/awards";
import { Identity, SqliteProfiles } from "../src/profiles";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log("the ladder:");
const table: [string, number][] = [
  ["Rookie I", 0], ["Rookie II", 750], ["Rookie III", 2250], ["Pro I", 4500], ["Pro II", 12000], ["Pro III", 22500],
  ["Legendary I", 37500], ["Legendary II", 67500], ["Legendary III", 105000], ["Master I", 157500], ["Master II", 225000],
  ["Master III", 292500], ["Grandmaster I", 360000], ["Mythic I", 630000], ["Titan I", 967500], ["Titan III", 1237500],
];
for (const [name, xp] of table) check(rankOf(xp).name === name && (xp === 0 || rankOf(xp - 1).name !== name), `${name} starts at ${xp.toLocaleString()} XP`);
check(divisionStart(6) / 1500 === 25 && divisionStart(9) / 1500 === 105, "Legendary I at 25 h, Master I at 105 h of skilled play");
const way = rankOf(5e7);
check(way.top && way.name === "Titan III" && way.into === 5e7 - divisionStart(TOP_DIVISION), "past the last tier: Titan III, the XP banked");
check(divisionStart(TOP_DIVISION + 1) - divisionStart(TOP_DIVISION) === 135000, "a tier added later already has a price");
check(rankUp(4400, 4600)?.name === "Pro I" && rankUp(4600, 4700) === null, "rank up is told once");
check(rankOf(-5).name === "Rookie I" && rankOf(NaN).name === "Rookie I", "nonsense XP is Rookie I");

console.log("\nXP:");
const full = { players: 12, place: 1, won: true, stayed: true, objective: 100, objectiveTop: 100 };
check(matchXp(full) === 430, "a full win: 60 + 120 + 150 + 100 = 430");
check(matchXp({ ...full, stayed: false }) === 0, "a quitter earns nothing");
check(matchXp({ ...full, ranked: true }) === 860, "Ranked doubles it");
check(matchXp({ ...full, firstToday: true }) === 530, "first match of the day: +100");
check(matchXp({ ...full, seconds: 60 }) === Math.round(430 * 60 / 480), "a one-minute round pays an eighth");
check(matchXp({ ...full, place: 12, won: false, objective: 0 }) === 60, "last place who stayed: 60");
check(runXp({ finished: true, seconds: 360, route: 1, kills: 99, headshots: 99, lore: 9 }) === 300, "the best Dead Streets run: 300");
check(runXp({ finished: false, seconds: 900, route: 0.5, kills: 0, headshots: 0, lore: 0 }) === 40, "half the route, no kills: 40");

console.log("\nprofiles:");
const store = new SqliteProfiles(":memory:");
store.award("em:abc", 200, true, "2026-10-28");
const p = store.award("em:abc", 50, false, "2026-10-29");
check(p.xp === 250 && p.matches === 2 && p.wins === 1 && p.lastDay === "2026-10-29", "awards add up");
for (const won of [true, true, true]) store.award("em:abc", 10, won, "2026-10-30");
check(store.get("em:abc")!.streak === 3, "three wins in a row: a streak of 3 (§10.18)");
check(store.award("em:abc", 10, false, "2026-10-30").streak === 0, "a loss ends it");
check(store.commend("em:abc") === 1 && store.commend("em:abc") === 2 && store.commend("em:new") === 1, "commends count up, and a first commend makes the profile (§10.12)");
check(store.remove("em:abc") && store.get("em:abc") === null, "deleted on request");

console.log("\nrank rewards (§2.4):");
{
  const want = { hd: 0, ds: "armour", g: "m", s: 2, h: "afro", hc: 0, ht: 100 };
  const xpAt = (id: string) => divisionStart(divisionIndex(id));
  check(allowedLook(want, new Set(), 0).ds === undefined, "a Rookie can't wear the Armour design (the server strips it)");
  check(allowedLook(want, new Set(), xpAt("master-1")).ds === "armour", "from Master I it shows");
  check(allowedLook({ ...want, ds: "plain" }, new Set(), 0).ds === "plain", "the plain hoodie for everyone");
  check(HOODIE_DESIGNS.filter((d) => d.rank).length === 10, "ten rank designs, Rookie to Titan (v5: Hex weave and Multi-terrain)");
  check(allowedLook({ ...want, mk: 1 }, new Set(), 0).mk === 1 && allowedLook(want, new Set(), 0).mk === undefined, "the closed mask goes out to everyone; the open face is the default");
}

console.log("\nEMILGO tokens:");
const SECRET = process.env.RANK_SECRET ?? "test-supabase-jwt-secret-0123456789abcdef";
function jwt(claims: object, secret = SECRET): string {
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const b = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${h}.${b}.${createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url")}`;
}
const exp = Math.floor(Date.now() / 1000) + 3600;
const good = jwt({ sub: "user-1", aud: "authenticated", role: "authenticated", exp });
const id = new Identity(null, { url: null, secret: SECRET });
const key = await id.verify("em", good).catch(() => "");
check(key.startsWith("em:") && !key.includes("user-1"), "a real token gives a profile key (the user id is never stored)");
check((await id.verify("em", good).catch(() => "")) === key, "the same account, the same key");
const refused = async (t: string) => id.verify("em", t).then(() => false, () => true);
check(await refused(jwt({ sub: "user-1", aud: "authenticated", exp }, "wrong-secret-wrong-secret-wrong")), "a forged token is refused");
check(await refused(jwt({ sub: "user-1", aud: "authenticated", exp: exp - 7200 })), "an expired token is refused");
check(await refused(jwt({ aud: "authenticated", role: "anon", exp })), "an anonymous token is refused");
check(await id.verify("ll", good).then(() => false, () => true), "a Lagos Life claim needs Lagos Life (none here)");

console.log("\nawards (v6 max, 3.10):");
{
  const base: MatchFeats = { mode: "treasure-hunt", online: true, ranked: false, won: false, place: 5, sides: 8, seconds: 400, kills: 0, heads: 0, deaths: 1, treasures: 0, uploads: 0, crates: 0, items: 0, boosters: [], downs: 0, helps: 0, swum: 0, hour: 14 };
  const s = freshAwards();
  check(recordMatch(s, { ...base, seconds: 30, kills: 30 }).length === 0 && s.stats.matches === 0, "a match left in its first minute counts nothing");
  const first = recordMatch(s, { ...base, won: true, place: 1, kills: 6, heads: 3, deaths: 0, treasures: 5, boosters: ["strength-booster", "speed-booster"] });
  const ids = first.map((u) => u.id).sort();
  check(["champion", "flawless", "hoarder", "hunt-king", "overcharged", "rampage", "sharpshooter", "seeker", "clutch"].every((id) => ids.includes(id)), `one big match reaches the right awards (${ids.join(", ")})`);
  check(first.every((u) => u.cp > 0) && first.find((u) => u.id === "champion")?.cp === TIER_CP[0], "each pays CP; a first step pays the Bronze figure");
  check(recordMatch(s, { ...base, won: true, place: 1, kills: 6 }).every((u) => u.id !== "rampage" && u.id !== "champion"), "an achievement pays once; a milestone only at its next step");
  for (let i = 0; i < 9; i++) recordMatch(s, { ...base, kills: 2 });
  check(s.got.veteran === 1 && s.stats.matches === 11, `ten matches: Veteran Bronze (${s.stats.matches} matches)`);
  const many = recordMatch(s, { ...base, kills: 999 });
  check(many.filter((u) => u.id === "marksman").length === 2 && s.got.marksman === 3 && many.some((u) => u.id === "massacre"), "a count that jumps past two steps pays both (Silver and Gold)");
  const st = freshAwards();
  recordMatch(st, { ...base, won: true });
  recordMatch(st, { ...base, won: true });
  check(recordMatch(st, { ...base, won: true }).some((u) => u.id === "hot-streak"), "three wins in a row: Hot Streak");
  check(recordMatch(freshAwards(), { ...base, mode: "dead-streets", run: { finished: true, seconds: 400, kills: 3, heads: 1, hurt: 0 } }).filter((u) => ["survivor", "speedrun", "untouched"].includes(u.id)).length === 3, "a quick clean run: Survivor, Mast Sprinter, Untouched");
  s.wear = "veteran";
  check(badgeOf(s) === "veteran.1" && parseBadge("veteran.1")?.[1] === 1 && parseBadge("rampage.3") === null && parseBadge("nope.1") === null && parseBadge("<b>") === null, "badges on the wire are checked for shape");
  const back = cleanAwards(JSON.parse(JSON.stringify({ ...s, wear: "night-owl", got: { ...s.got, nope: 3, veteran: 99 } })));
  check(back.wear === "" && back.got.veteran === 4 && !("nope" in back.got) && back.stats.kills === s.stats.kills, "a saved state is cleaned (no unreached badge worn, steps capped, unknown ids dropped)");
  check(allowedLook({ aw: "veteran.2" }, new Set()).aw === "veteran.2" && allowedLook({ aw: "veteran.9" }, new Set()).aw === undefined, "the server passes a well-formed badge on the look, drops a bad one");
  const bots = Array.from({ length: 40 }, (_, i) => botBadge(7, i));
  check(bots.every((b) => b === "" || parseBadge(b)) && bots.filter(Boolean).length > 8 && bots.filter(Boolean).length < 32, `bots wear a badge about half the time (${bots.filter(Boolean).length} of 40)`);
}

console.log("\nfigurines (v6 max, 3.8):");
{
  check(FIGURINES.length === 5 && new Set(FIGURINES.map((f) => f.id)).size === 5 && FIGURINES.every((f) => f.cp >= 1000), "five figurines, each its own id, each a real CP goal");
  // Every phone must show a figurine's suit: its colour and pattern are free ones (the server strips paid or rank ones).
  const plain = cleanLook({});
  const kept = FIGURINES.every((f) => {
    const look = figurineLook(plain, f);
    const wire = allowedLook(toWireLook(look, false, "", f.id), new Set(), 0);
    return wire.fg === f.id && wire.hd === look.hoodie && wire.ds === f.design;
  });
  check(kept, "a figurine's suit, pattern and id reach everyone (no ticket, no rank needed)");
  check(allowedLook({ fg: "not-a-fig" }, new Set()).fg === undefined, "an unknown figurine is dropped");
  const c = cleanFigurines(["vanguard", "nope", "vanguard", 5], "inferno");
  check(c.figs.join() === "vanguard" && c.fig === "", "a saved list keeps known ids once; a figurine not owned isn't worn");
}

const GAME = process.env.GAME;
if (GAME) {
  console.log("\nonline: a round, two players, one ranked:");
  interface Phone {
    ws: WebSocket;
    got: ServerMsg[];
  }
  const connect = (name: string) =>
    new Promise<Phone>((resolve) => {
      const ws = new WebSocket(GAME);
      const ph: Phone = { ws, got: [] };
      ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: NET.protocol, name })));
      ws.on("message", (d) => {
        const m = JSON.parse(d.toString()) as ServerMsg;
        if (m.t === "ping") ws.send(JSON.stringify({ t: "pong", s: m.s }));
        if (m.t !== "snap") ph.got.push(m);
        if (m.t === "welcome") resolve(ph);
        // Through the walkout as soon as it can be skipped; then walk forward slowly.
        if (m.t === "ev" && m.k === "ph" && m.ph === PHASES.indexOf("countdown")) setTimeout(() => ws.send(JSON.stringify({ t: "in", x: 0, z: -20 })), 5200);
      });
    });
  const send = (ph: Phone, o: object) => ph.ws.send(JSON.stringify(o));
  const ranks = (ph: Phone) => ph.got.filter((m): m is Extract<ServerMsg, { t: "rank" }> => m.t === "rank");

  const ada = await connect("Ada");
  const bisi = await connect("Bisi");
  const eve = await connect("Eve");
  const sub = `rank-${Date.now()}`;
  send(ada, { t: "id", k: "em", tok: jwt({ sub, aud: "authenticated", role: "authenticated", exp }) });
  send(eve, { t: "id", k: "em", tok: jwt({ sub, aud: "authenticated", exp }, "not-the-servers-secret-0123456789") });
  await sleep(400);
  check(ranks(ada)[0]?.xp === 0 && !ranks(ada)[0]?.off, "Ada is known: a new profile, 0 XP");
  check(ranks(eve)[0]?.off === 1, "a forged token: unranked");
  eve.ws.close();

  send(ada, { t: "create", size: 2, mode: "classic", dist: 100 });
  await sleep(300);
  const room = ada.got.find((m) => m.t === "room") as Extract<ServerMsg, { t: "room" }> | undefined;
  send(bisi, { t: "join", code: room?.room.code });
  await sleep(300);
  send(ada, { t: "ready", on: true });
  send(bisi, { t: "ready", on: true });
  // Skip the walkout once it allows (after the walk).
  const skipper = setInterval(() => {
    send(ada, { t: "skip" });
    send(bisi, { t: "skip" });
  }, 1000);
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000 && !(ranks(ada).some((r) => r.gain !== undefined) && ranks(bisi).some((r) => r.gain !== undefined))) await sleep(250);
  clearInterval(skipper);
  const a = ranks(ada).find((r) => r.gain !== undefined);
  const b = ranks(bisi).find((r) => r.gain !== undefined);
  check(!!a && a.gain! > 0 && a.xp === a.gain && !a.off, `Ada's round is stored: +${a?.gain} XP, total ${a?.xp} (first of the day included)`);
  check(!!b && b.gain! > 0 && b.off === 1 && b.xp === undefined, `Bisi, a guest, hears +${b?.gain} XP for this device only`);
  check(!!a && !!b && a.gain! < 430, "a short round pays well under a full match");
  ada.ws.close();
  bisi.ws.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
