// Free For All (SPEC-V3 Phase 4): Gidigbo melee, the flags, the drop zones and
// the rally point, every mode's win, squads and places, and the phone's copy
// of a match (the mirror) keeping step with the server's from its events.
// Headless, on Naija World, as the server runs it.
//
// With GAME=ws://… it also plays over the network: 12 people in a public
// queue, a party kept together as a squad, a match to the end, XP from the
// server, a mode a rank hasn't opened refused.
//
//   node server/build-tools.mjs && node server/dist/ffatest.mjs
//   GAME=ws://localhost:8797 node server/dist/ffatest.mjs

import { FLAGS, MELEE, RALLY } from "../../src/config";
import { BUILTIN_MANIFEST } from "../../src/content/modes";
import type { Contestant } from "../../src/game/core/body";
import { Match, settingsOf, type MatchSettings } from "../../src/game/core/match";
import type { MatchEvent } from "../../src/game/core/module";
import { Space } from "../../src/game/core/space";
import type { CaptureModule } from "../../src/game/modules/capture";
import type { DropzonesModule } from "../../src/game/modules/dropzones";
import type { FlagsModule } from "../../src/game/modules/flags";
import type { ItemsModule } from "../../src/game/modules/items";
import type { MeleeModule } from "../../src/game/modules/melee";
import type { ZoneModule } from "../../src/game/modules/zone";
import { matchWorldOf } from "../../src/maps/open/matchWorld";
import { buildNaijaWorld, SURFACE_OF } from "../../src/maps/open/naija";
import { online } from "./ffanet";

let failures = 0;
export function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

const DT = 1 / 60;
const layout = buildNaijaWorld();
const space = new Space(layout.solids, { x0: -layout.half, z0: -layout.half, x1: layout.half, z1: layout.half }, (x, z) => SURFACE_OF[layout.groundAt(x, z)]);
const world = matchWorldOf(layout, space);
const def = (id: string) => BUILTIN_MANIFEST.modes.find((m) => m.id === id)!;

/** A mode's settings, changed by `patch` (shorter times, no zone) so a test needn't wait minutes. */
function mode(id: string, patch: (s: MatchSettings) => void = () => {}): MatchSettings {
  const s = settingsOf(def(id));
  patch(s);
  return s;
}
function newMatch(seed: number, settings: MatchSettings, n = 12, squads?: number[], w = world): Match {
  return new Match({ seed, world: w, settings, contestants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false, ...(squads ? { squad: squads[i] } : {}) })) });
}
function runFor(m: Match, s: number, out: MatchEvent[] = [], each?: () => void): MatchEvent[] {
  let guard = 0;
  while (m.phase !== "play" && guard++ < 1e5) {
    m.step(DT);
    out.push(...m.drain());
  }
  const end = m.elapsed + s;
  while (m.elapsed < end - 1e-9 && !m.over && guard++ < 2e6) {
    each?.();
    m.step(DT);
    out.push(...m.drain());
  }
  return out;
}
/** A quiet, open, flat spot (the bush by the cassava farm), clear for 10 m west and 14 m east. */
const YARD: [number, number] = [-168, -176];
function put(m: Match, id: string, x: number, z: number, heading = 0): Contestant {
  const c = m.get(id)!;
  c.x = x;
  c.z = z;
  c.vx = c.vz = 0;
  c.inX = c.inZ = 0;
  c.h = space.floorAt(x, z, 0).h;
  c.y = c.vy = 0;
  c.heading = heading;
  return c;
}
/** Everyone else far away, out of reach, so a test is between the bodies it names. */
function clear(m: Match, keep: string[]): void {
  let k = 0;
  for (const c of m.contestants) if (!keep.includes(c.id)) put(m, c.id, 60 + (k % 6) * 8, 160 + Math.floor(k++ / 6) * 8);
}
let atk = 0;
const swing = (m: Match, id: string, kind: 1 | 2 | 3) => m.setActions(id, ((++atk & 63) << 2) | kind, m.get(id)!.inGrab);
const grab = (m: Match, id: string) => m.setActions(id, m.get(id)!.inAttack, (m.get(id)!.inGrab + 1) & 255);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
/** No zone, no Airfall, a long clock: just the bodies (and the module under test). */
const bare = (id: string, extra: (s: MatchSettings) => void = () => {}) =>
  mode(id, (s) => {
    delete s.modules.zone;
    delete s.modules.airfall;
    s.time = 600;
    extra(s);
  });
const [YX, YZ] = YARD;
/** East (+x) as a heading. */
const EAST = Math.PI / 2;

console.log("melee (Gidigbo):");
{
  const m = newMatch(1, bare("find-the-flag"));
  runFor(m, 0.1);
  clear(m, ["p0", "p1"]);
  const a = put(m, "p0", YX, YZ, EAST);
  const b = put(m, "p1", YX + 1.2, YZ, -EAST);
  const mel = m.module<MeleeModule>("melee")!;
  swing(m, "p0", 2);
  const ev = runFor(m, 0.05);
  check(ev.some((e) => e.type === "swing" && e.kind === "slap") && !ev.some((e) => e.type === "hit"), "a slap: a wind-up first …");
  const ev2 = runFor(m, 0.1);
  check(ev2.some((e) => e.type === "hit" && e.kind === "slap") && near(mel.wobble[b.index], MELEE.kinds.slap.wobble, 0.01), `… then it lands: wobble ${mel.wobble[b.index].toFixed(2)} (${MELEE.kinds.slap.wobble})`);
  runFor(m, 1.5);
  const bx = b.x;
  put(m, "p0", b.x - 1.2, b.z, EAST);
  runFor(m, 0.6);
  swing(m, "p0", 3);
  runFor(m, 1.2);
  check(b.x - bx > 1.6, `a push shoves ${(b.x - bx).toFixed(1)} m (${MELEE.kinds.push.knock} m, then a slide)`);
  void a;
}
{
  // Wind-up timing, measured from events.
  const m = newMatch(2, bare("find-the-flag"));
  runFor(m, 0.1);
  clear(m, ["p0", "p1"]);
  put(m, "p0", YX, YZ, EAST);
  put(m, "p1", YX + 1.2, YZ, -EAST);
  swing(m, "p0", 1);
  const t0 = m.elapsed;
  let at = -1;
  for (let k = 0; k < 60 && at < 0; k++) {
    m.step(DT);
    for (const e of m.drain()) if (e.type === "hit") at = m.elapsed - t0;
  }
  check(Math.abs(at - MELEE.kinds.fist.windup) < 0.04, `a fist lands ${at.toFixed(2)} s after the press (wind-up ${MELEE.kinds.fist.windup} s)`);
  // Out of reach: a miss.
  runFor(m, 2);
  put(m, "p0", YX, YZ, EAST);
  put(m, "p1", YX + MELEE.range + 0.8, YZ, -EAST);
  swing(m, "p0", 2);
  const ev = runFor(m, 0.3);
  check(ev.some((e) => e.type === "miss") && !ev.some((e) => e.type === "hit"), "out of reach: a miss");
}
{
  // Full wobble: Dazed — down 1.6 s, the flag dropped, then 1.5 s nobody can hit you.
  const m = newMatch(3, bare("hold-the-flag"));
  runFor(m, 0.1);
  clear(m, ["p0", "p1"]);
  const flags = m.module<FlagsModule>("flags")!;
  const f = flags.flags[0];
  const b = put(m, "p1", f.x, f.z, 0);
  runFor(m, 0.2);
  check(f.holder === b.index, "walking onto a loose flag takes it");
  const mel = m.module<MeleeModule>("melee")!;
  mel.wobble[b.index] = 0.95;
  put(m, "p0", b.x - 1.2, b.z, EAST);
  b.heading = -EAST;
  swing(m, "p0", 2);
  const ev = runFor(m, 0.2);
  const down = ev.find((e) => e.type === "down");
  check(down?.type === "down" && down.why === "daze" && near(down.s, MELEE.daze), `full: Dazed, down ${MELEE.daze} s`);
  check(f.holder === -1 && ev.some((e) => e.type === "flag" && e.how === "drop"), "… and the flag drops where they fall");
  const ev2 = runFor(m, MELEE.daze + 0.1);
  check(ev2.some((e) => e.type === "up"), "they get up");
  put(m, "p0", b.x - 1.2, b.z, EAST);
  m.get("p0")!.cool = 0;
  swing(m, "p0", 3);
  const ev3 = runFor(m, 0.4);
  check(!ev3.some((e) => e.type === "hit"), `then ${MELEE.immune} s no hit lands`);
}
{
  // Two on one: the second attacker's hit counts less; and the meter drains after a pause.
  const m = newMatch(4, bare("find-the-flag"));
  runFor(m, 0.1);
  clear(m, ["p0", "p1", "p2"]);
  const b = put(m, "p1", YX, YZ, 0);
  put(m, "p0", YX - 1.2, YZ, EAST);
  put(m, "p2", YX + 1.2, YZ, -EAST);
  const mel = m.module<MeleeModule>("melee")!;
  swing(m, "p0", 2);
  runFor(m, 0.15);
  const w1 = mel.wobble[b.index];
  put(m, "p1", YX, YZ, 0);
  swing(m, "p2", 2);
  runFor(m, 0.15);
  const w2 = mel.wobble[b.index] - w1;
  check(near(w2, MELEE.kinds.slap.wobble * (1 - MELEE.wobble.crowd), 0.01), `a second attacker within 1 s: ${(w2 / MELEE.kinds.slap.wobble * 100).toFixed(0)}% of the wobble (no 3-on-1 stun-locks)`);
  const before = mel.wobble[b.index];
  runFor(m, MELEE.wobble.drainAfter + 0.2);
  check(mel.wobble[b.index] < before - 0.05, "the meter drains once nobody has hit you for 1.5 s");
}
{
  // Brace: knockback halved; pressed just in time, a parry.
  const m = newMatch(5, bare("find-the-flag"));
  runFor(m, 0.1);
  clear(m, ["p0", "p1"]);
  const b = put(m, "p1", YX + 1.2, YZ, -EAST);
  const a = put(m, "p0", YX, YZ, EAST);
  const mel = m.module<MeleeModule>("melee")!;
  m.setBrace("p1", true);
  runFor(m, 0.5);
  swing(m, "p0", 2);
  runFor(m, 0.15);
  check(near(mel.wobble[b.index], MELEE.kinds.slap.wobble * MELEE.brace.cut, 0.01), `bracing: half the wobble (${mel.wobble[b.index].toFixed(2)})`);
  m.setBrace("p1", false);
  runFor(m, 1.5);
  put(m, "p1", YX + 1.2, YZ, -EAST);
  put(m, "p0", YX, YZ, EAST);
  const wb = mel.wobble[b.index];
  swing(m, "p0", 1);
  runFor(m, MELEE.kinds.fist.windup - 0.1);
  m.setBrace("p1", true);
  const ev = runFor(m, 0.2);
  check(ev.some((e) => e.type === "parry") && !ev.some((e) => e.type === "hit" && e.tg === "p1") && mel.wobble[b.index] <= wb + 1e-9 && a.stun > 0, "a brace just before the fist lands: a parry — they're untouched, the attacker staggers");
}
{
  // Grab → clinch → Throw; the escape mind-game; a strike breaks a grab's wind-up.
  const m = newMatch(6, bare("find-the-flag"));
  runFor(m, 0.1);
  clear(m, ["p0", "p1"]);
  const b = put(m, "p1", YX + 1, YZ, -EAST);
  put(m, "p0", YX, YZ, EAST);
  m.setBrace("p1", true);
  grab(m, "p0");
  const ev = runFor(m, MELEE.grab.windup + 0.05);
  check(ev.some((e) => e.type === "clinch"), "a grab goes through a brace: a clinch");
  m.setBrace("p1", false);
  swing(m, "p0", 1);
  const early = runFor(m, 0.1);
  check(!early.some((e) => e.type === "release"), `the finishers wait ${MELEE.grab.min} s`);
  runFor(m, MELEE.grab.min);
  const bx = b.x;
  m.setInput("p0", 1, 0);
  swing(m, "p0", 1);
  const ev2 = runFor(m, 1.5, [], () => m.setInput("p0", 0, 0));
  const thrown = ev2.find((e) => e.type === "release");
  check(thrown?.type === "release" && thrown.how === "throw" && b.x - bx > 2 && ev2.some((e) => e.type === "down" && e.id === "p1"), `Throw: ${(b.x - bx).toFixed(1)} m the way the stick points, and down`);
}
{
  const m = newMatch(7, bare("find-the-flag"));
  runFor(m, 0.1);
  clear(m, ["p0", "p1"]);
  const a = put(m, "p0", YX, YZ, EAST);
  put(m, "p1", YX + 1, YZ, -EAST);
  grab(m, "p0");
  runFor(m, MELEE.grab.windup + MELEE.grab.min + 0.1);
  // The held player pulls the opposite way to the throw (the throw goes +x; they pull −x).
  m.setInput("p1", -1, 0);
  m.setInput("p0", 1, 0);
  swing(m, "p0", 1);
  const ev = runFor(m, 0.3, [], () => m.setInput("p0", 0, 0));
  const r = ev.find((e) => e.type === "release");
  check(r?.type === "release" && r.how === "reverse" && ev.some((e) => e.type === "down" && e.id === "p0"), "their secret direction against the throw's: a reversal — the grabber goes down");
  void a;
}
{
  const m = newMatch(8, bare("find-the-flag"));
  runFor(m, 0.1);
  clear(m, ["p0", "p1"]);
  put(m, "p0", YX, YZ, EAST);
  put(m, "p1", YX + 1.2, YZ, -EAST);
  grab(m, "p0");
  runFor(m, 0.05);
  swing(m, "p1", 2);
  const ev = runFor(m, 0.4);
  check(ev.some((e) => e.type === "broke") && !ev.some((e) => e.type === "clinch"), "a slap during the grab's wind-up breaks it (strike beats grab)");
}
{
  // Trip (crouched), beaten by a jump; a shoulder charge (sprinting) costs stamina.
  const m = newMatch(9, bare("find-the-flag"));
  runFor(m, 0.1);
  clear(m, ["p0", "p1"]);
  const a = put(m, "p0", YX, YZ, EAST);
  put(m, "p1", YX + 1.3, YZ, -EAST);
  m.setButtons("p0", false, 1, a.inJump);
  runFor(m, 0.5);
  swing(m, "p0", 2);
  const ev = runFor(m, 0.4);
  const d = ev.find((e) => e.type === "down");
  const mel = m.module<MeleeModule>("melee")!;
  check(d?.type === "down" && d.why === "trip" && mel.wobble[1] === 0, "crouched, an attack is a sweep: a knockdown, no wobble");
  m.setButtons("p0", false, 0, a.inJump);
  runFor(m, 3.5);
  put(m, "p0", YX, YZ, EAST);
  put(m, "p1", YX + 1.3, YZ, -EAST);
  m.setButtons("p0", false, 1, a.inJump);
  runFor(m, 0.5);
  swing(m, "p0", 2);
  m.setButtons("p1", false, 0, (m.get("p1")!.inJump + 1) & 255);
  const ev2 = runFor(m, 0.4);
  check(!ev2.some((e) => e.type === "down"), "jumping over it beats a trip");
  m.setButtons("p0", false, 0, a.inJump);
  runFor(m, 2);
  put(m, "p0", YX - 8, YZ, EAST);
  put(m, "p1", YX - 3.5, YZ, -EAST);
  a.stamina = 1;
  m.setInput("p0", 1, 0);
  m.setButtons("p0", true, 0, a.inJump);
  runFor(m, 0.25);
  swing(m, "p0", 1);
  const ev3 = runFor(m, 0.8);
  m.setInput("p0", 0, 0);
  const sw = ev3.find((e) => e.type === "swing");
  check(sw?.type === "swing" && sw.kind === "charge" && a.stamina < 0.75 && ev3.some((e) => e.type === "hit" && e.kind === "charge"), `sprinting, it's a shoulder charge: it lands, and costs ${MELEE.charge.stamina * 100}% stamina`);
}
{
  // Squadmates can't hit each other.
  const m = newMatch(10, bare("find-the-flag"), 4, [0, 0, 1, 1]);
  runFor(m, 0.1);
  clear(m, ["p0", "p1"]);
  put(m, "p0", YX, YZ, EAST);
  put(m, "p1", YX + 1.2, YZ, -EAST);
  swing(m, "p0", 2);
  const ev = runFor(m, 0.3);
  check(!ev.some((e) => e.type === "hit"), "squadmates can't hit each other");
}
{
  // Street props: a chair in your hands, three hits and it breaks; a slipper thrown across the yard.
  const m = newMatch(11, bare("find-the-flag"));
  runFor(m, 0.1);
  const mel = m.module<MeleeModule>("melee")!;
  check(mel.props.length >= MELEE.props.count * 0.8, `${mel.props.length} street props at the places (chairs, buckets, brooms, pestles, benches, slippers)`);
  const chair = mel.props.find((p) => p.kind === "chair")!;
  clear(m, ["p0", "p1"]);
  put(m, "p0", chair.x - 0.5, chair.z, EAST);
  m.setInteract("p0", 1, false);
  runFor(m, 0.1);
  check(mel.hand[0] === chair.index, "an interact tap picks up the chair");
  const a = m.get("p0")!;
  let hits = 0;
  for (let k = 0; k < 3; k++) {
    put(m, "p1", a.x + 1.4, a.z, -EAST);
    mel.immune[1] = -1;
    mel.down[1] = -1;
    m.get("p1")!.stun = 0;
    a.cool = 0;
    swing(m, "p0", 1);
    for (const e of runFor(m, 0.6)) if (e.type === "hit" && e.kind === "prop") hits++;
    mel.wobble[1] = 0;
  }
  check(hits === 3 && mel.hand[0] === -1 && chair.holder === -2, "three hits and it breaks");
  const slip = mel.props.find((p) => p.kind === "slipper" && p.holder === -1)!;
  put(m, "p0", slip.x, slip.z, EAST);
  m.setInteract("p0", 2, false);
  runFor(m, 0.1);
  put(m, "p1", m.get("p0")!.x + 8, m.get("p0")!.z, -EAST);
  mel.immune[1] = -1;
  a.cool = 0;
  swing(m, "p0", 1);
  const ev = runFor(m, 1.2);
  check(ev.some((e) => e.type === "fly") && ev.some((e) => e.type === "hit" && e.kind === "throw" && e.tg === "p1"), "a slipper thrown 8 m hits");
}

console.log("Find the Flag:");
{
  const m = newMatch(21, mode("find-the-flag"));
  runFor(m, 0.1);
  const flags = m.module<FlagsModule>("flags")!;
  check(flags.stashes.length === FLAGS.stashes && flags.flags[0].hidden, `the flag hidden in 1 of ${flags.stashes.length} stash spots`);
  const wrong = flags.stashes.find((s) => s.index !== flags.secret)!;
  clear(m, ["p0"]);
  put(m, "p0", wrong.x, wrong.z, 0);
  m.setInteract("p0", 1, false);
  const ev = runFor(m, 0.1);
  check(ev.some((e) => e.type === "search" && !e.found), "searching the wrong spot: empty");
  const right = flags.stashes[flags.secret];
  put(m, "p0", right.x, right.z, 0);
  m.setInteract("p0", 2, false);
  const ev2 = runFor(m, 0.1);
  check(ev2.some((e) => e.type === "search" && e.found) && flags.flags[0].holder === 0, "the right one: the flag is yours");
  const ev3 = runFor(m, 10.2);
  const won = ev3.find((e) => e.type === "won");
  check(won?.type === "won" && won.id === "p0" && m.over, "held 10 s: claimed, the match is won");
  const st = m.standings();
  check(st.find((s) => s.id === "p0")?.place === 1 && st.filter((s) => s.place === 1).length === 1, "the winner is first");
}
{
  const m = newMatch(22, mode("find-the-flag"));
  const ev = runFor(m, 275);
  const hints = ev.filter((e): e is Extract<MatchEvent, { type: "hint" }> => e.type === "hint");
  const f = m.module<FlagsModule>("flags")!.flags[0];
  check(hints.length === 3 && hints.every((h, k) => h.r === FLAGS.hintR[k] && Math.hypot(h.x - f.x, h.z - f.z) <= h.r), `radio hints at 1:30, 3:00, 4:30, each a smaller circle round it (${hints.map((h) => h.r).join(", ")} m)`);
}

console.log("Hold the Flag:");
{
  const m = newMatch(31, bare("hold-the-flag", (s) => (s.time = 30)), 12);
  runFor(m, 0.1);
  const flags = m.module<FlagsModule>("flags")!;
  check(flags.flags.length === 2, `two flags with ${FLAGS.extraAt}+ players`);
  clear(m, ["p0", "p1"]);
  const f = flags.flags[0];
  put(m, "p0", f.x, f.z, 0);
  const pings: number[] = [];
  const ev = runFor(m, 25, [], () => {});
  for (const e of ev) if (e.type === "ping" && e.id === "p0") pings.push(Math.round(m.elapsed));
  check(ev.filter((e) => e.type === "ping" && e.id === "p0").length === 2, "the holder pings on the map every 10 s");
  runFor(m, 6);
  const won = m.winner;
  check(m.over && won?.id === "p0", `time up: the most seconds held wins (${flags.held[0].toFixed(0)} s)`);
}
{
  const m = newMatch(32, bare("hold-the-flag"), 6);
  runFor(m, 0.1);
  clear(m, ["p0", "p1"]);
  const f = m.module<FlagsModule>("flags")!.flags[0];
  const a = put(m, "p0", f.x, f.z, 0);
  const b = put(m, "p1", f.x + 30, f.z, 0);
  runFor(m, 0.2);
  m.setInput("p0", 1, 0);
  m.setInput("p1", 1, 0);
  const ax = a.x;
  const bx = b.x;
  runFor(m, 2);
  const ratio = (a.x - ax) / (b.x - bx);
  check(Math.abs(ratio - 0.9) < 0.04, `the holder runs ${(100 - ratio * 100).toFixed(0)}% slower`);
}

console.log("Steal & Reposition:");
{
  const m = newMatch(41, bare("steal-reposition"), 6);
  runFor(m, 0.1);
  const flags = m.module<FlagsModule>("flags")!;
  const dz = m.module<DropzonesModule>("dropzones")!;
  check(flags.flags.length === 4 && dz.zones.length === 3, "four flags, three drop zones");
  clear(m, ["p0"]);
  let delivered = 0;
  for (let k = 0; k < 5 && !m.over; k++) {
    const f = flags.flags.find((x) => x.holder < 0)!;
    put(m, "p0", f.x, f.z, 0);
    runFor(m, 0.1);
    const z = dz.zones.find((x) => x.until > m.elapsed + 1)!;
    put(m, "p0", z.x, z.z, 0);
    for (const e of runFor(m, 0.1)) if (e.type === "flag" && e.how === "deliver") delivered++;
  }
  check(delivered === 5 && m.winner?.id === "p0", "five deliveries: the match is won");
}
{
  const m = newMatch(42, bare("steal-reposition"), 6);
  const ev = runFor(m, 130);
  const moves = ev.filter((e) => e.type === "dz");
  check(moves.length >= 3 + 4, `each drop zone moves after ${def("steal-reposition").modules.dropzones!.life} s (${moves.length} placings in 130 s)`);
}

console.log("Squad Rally:");
{
  const squads = Array.from({ length: 12 }, (_, i) => Math.floor(i / 4));
  const m = newMatch(51, bare("squad-rally", (s) => (s.time = 20)), 12, squads);
  runFor(m, 0.1);
  const cap = m.module<CaptureModule>("capture")!;
  const x0 = cap.x;
  const z0 = cap.z;
  runFor(m, 10);
  const moved = Math.hypot(cap.x - x0, cap.z - z0);
  check(Math.abs(moved - RALLY.speed * 10) < 1, `the point drives the roads at ${RALLY.speed} m/s (${moved.toFixed(1)} m in 10 s)`);
  // Squad 2: three inside at the end; squad 0: two.
  clear(m, []);
  const keepIn = (ids: string[]) => () => ids.forEach((id, k) => put(m, id, cap.x + (k - 1) * 1.5, cap.z + (k % 2), 0));
  const ids = ["p8", "p9", "p10", "p0", "p1"];
  runFor(m, 11, [], keepIn(ids));
  check(m.over && m.winner?.squad === 2, "time up: the squad with the most members inside wins");
  const st = m.standings();
  check(st.filter((s) => s.squad === 2).every((s) => s.place === 1 && s.won) && st.filter((s) => s.squad === 0).every((s) => s.place === 2), "squadmates share their squad's place");
}

console.log("Scarcity:");
{
  const m = newMatch(61, bare("scarcity", (s) => (s.time = 400)), 6);
  runFor(m, 0.1);
  const flags = m.module<FlagsModule>("flags")!;
  check(flags.flags.length === 3 && !m.settings.respawn.on, "three flags, no respawns");
  clear(m, ["p0"]);
  const f = flags.flags[0];
  put(m, "p0", f.x, f.z, 0);
  const ev = runFor(m, 361, [], () => {
    const c = m.get("p0")!;
    if (flags.gate) put(m, "p0", flags.gate.x, flags.gate.z, 0);
    else put(m, "p0", c.x, c.z, 0);
  });
  check(ev.some((e) => e.type === "gate") && m.winner?.id === "p0", "at 6:00 the gate opens: in with a flag, you win");
}
{
  const m = newMatch(62, bare("scarcity"), 4);
  runFor(m, 0.1);
  const flags = m.module<FlagsModule>("flags")!;
  clear(m, ["p0"]);
  put(m, "p0", flags.flags[1].x, flags.flags[1].z, 0);
  runFor(m, 0.2);
  for (const id of ["p1", "p2", "p3"]) m.eliminate(m.get(id)!, "zone");
  runFor(m, 0.1);
  check(m.winner?.id === "p0", "the last one standing with a flag wins");
}

console.log("the Flag Duel (staked, on the market):");
{
  const dw = matchWorldOf(layout, space, "naija-world:market");
  const m = newMatch(71, mode("flag-duel"), 4, undefined, dw);
  runFor(m, 0.1);
  const z = m.module<ZoneModule>("zone")!;
  const flags = m.module<FlagsModule>("flags")!;
  const ar = dw.arena!;
  check(m.contestants.every((c) => Math.hypot(c.x - ar.x, c.z - ar.z) <= ar.r) && flags.stashes.every((s) => Math.hypot(s.x - ar.x, s.z - ar.z) <= ar.r), `everyone starts, and every stash spot is, inside the market's ${ar.r} m`);
  check(near(z.now.r, ar.r) && z.rate > 0, "outside it the sky hunts you from the start");
}

console.log("the phone's copy (mirror):");
{
  // The server's match and a phone's copy fed only its events (and positions): the same state.
  const s = mode("steal-reposition");
  const srv = newMatch(81, s);
  const ph = new Match({ seed: 81, world, settings: mode("steal-reposition"), contestants: srv.contestants.map((c) => ({ id: c.id, name: c.name, bot: false })), mirror: true });
  const items = srv.module<ItemsModule>("items")!;
  const pitems = ph.module<ItemsModule>("items")!;
  check(items.items.length === pitems.items.length && items.items.every((it, k) => it.kind === pitems.items[k].kind && near(it.x, pitems.items[k].x)), `the same scatter from the seed (${items.items.length} items)`);
  const mel = srv.module<MeleeModule>("melee")!;
  const pmel = ph.module<MeleeModule>("melee")!;
  check(mel.props.length === pmel.props.length && mel.props.every((p, k) => p.kind === pmel.props[k].kind), `the same street props (${mel.props.length})`);
  let n = 0;
  let k = 0;
  const rng = { v: 7, next() { this.v = (this.v * 16807) % 2147483647; return this.v / 2147483647; } };
  for (let f = 0; f < 60 * 90; f++) {
    if (f % 20 === 0) for (const c of srv.contestants) {
      srv.setInput(c.id, rng.next() * 2 - 1, rng.next() * 2 - 1);
      if (rng.next() < 0.3) srv.setInteract(c.id, ++k & 255, false);
      if (rng.next() < 0.2) srv.setActions(c.id, ((++k & 63) << 2) | (1 + Math.floor(rng.next() * 3)), c.inGrab);
      if (rng.next() < 0.05) srv.setPack(c.id, ((++k & 511) << 5) | Math.floor(rng.next() * 3));
    }
    srv.step(DT);
    ph.step(DT);
    for (const c of srv.contestants) Object.assign(ph.contestants[c.index], { x: c.x, z: c.z, h: c.h, y: c.y, heading: c.heading });
    for (const e of srv.drain()) {
      ph.applyRemote(e);
      n++;
    }
    ph.drain();
    ph.elapsed = srv.elapsed;
  }
  const sf = srv.module<FlagsModule>("flags")!;
  const pf = ph.module<FlagsModule>("flags")!;
  const same =
    JSON.stringify(items.packs) === JSON.stringify(pitems.packs) &&
    items.items.every((it, j) => it.taken === pitems.items[j]?.taken) &&
    sf.flags.every((f, j) => f.holder === pf.flags[j].holder) &&
    srv.contestants.every((c) => c.status === ph.contestants[c.index].status) &&
    mel.props.every((p, j) => p.holder === pmel.props[j].holder) &&
    Array.from(mel.hand).join() === Array.from(pmel.hand).join();
  check(same, `90 s of 12 people fighting, picking up and using: the copy matches from ${n} events (packs, ground items, flags, props, who's out)`);
}

// ── Cost ──
{
  const m = newMatch(91, mode("find-the-flag"));
  runFor(m, 1);
  const t = performance.now();
  let k = 0;
  for (let f = 0; f < 60 * 60; f++) {
    if (f % 30 === 0) for (const c of m.contestants) {
      m.setInput(c.id, Math.sin(f + c.index), Math.cos(f * 1.3 + c.index));
      m.setActions(c.id, ((++k & 63) << 2) | (1 + (k % 3)), c.inGrab);
    }
    m.step(DT);
    m.drain();
  }
  const ms = (performance.now() - t) / 3600;
  check(ms < 0.6, `a 12-player step of Find the Flag with melee costs ${(ms * 1000).toFixed(0)} µs`);
}

if (process.env.GAME) failures += await online(process.env.GAME, check);
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
