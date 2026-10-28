// Dev only: walk Naija World. Not in any build.
//
//   /dev/open.html?tier=0|1|2            WASD / arrows, Shift sprint, Space jump, C crouch, Z prone, drag to look
//   &auto=1                              walk a fixed tour of the city (the perf gate drives this)
//   &at=x,z                              start there
//   &night=1
//   &play=1                              SPEC-V3 Phase 3's shared gameplay: Find the Flag's zone, items
//                                        and Airfall on a real match (E pick up / hold to open, B or Tab
//                                        the backpack, 1–0 use a slot, Shift+1–0 drop it)
//   &fast=4                              …with the zone and Airfall that many times sooner
//   &seed=n                              …and this match seed
//
// Twelve people are in it (you and eleven who wander). window.__open holds the
// numbers: frame rate, draw calls, triangles, cells drawn and cut by the PVS;
// with play=1, window.__play the match's (and window.__match the match itself).
import { ACESFilmicToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";

import { DEFAULT_COURSE } from "../src/config";
import { Rng } from "../src/core/rng";
import { freshMotion, moveContestant, type Contestant } from "../src/game/core/body";
import { tierSpec } from "../src/graphics/tiers";
import { buildNaijaWorld } from "../src/maps/open/naija";
import { buildOpenWorld, buildOpenWorldIdle } from "../src/maps/open/build";
import { NO_BOOST } from "../src/shop/boosts";
import { CameraRig } from "../src/world/camera";
import { Crowd } from "../src/world/crowd";
import { loadScans } from "../src/world/human";
import { randomLook } from "../src/world/human/wardrobe";
import { Hud } from "../src/ui/hud";
import { Grade, gradeLights, LOOKS, vignetteCss, type LookId } from "../src/graphics/grade";
import { Post } from "../src/graphics/post";
import { BUILTIN_MANIFEST } from "../src/content/modes";
import { Match, settingsOf } from "../src/game/core/match";
import type { ZoneModule } from "../src/game/modules/zone";
import type { ItemsModule } from "../src/game/modules/items";
import { Sound } from "../src/audio/sound";
import { PlayHud } from "../src/ui/play";
import { MatchScene } from "../src/world/matchScene";
import type { MapMark } from "../src/ui/hud";

const q = new URLSearchParams(location.search);
const tierQ = q.get("tier") ?? "1";
const spec = { ...tierSpec(tierQ === "0" ? "low" : tierQ === "2" ? "high" : "medium") };
if (q.get("noshadow")) spec.shadows = false;
if (q.get("lambert")) spec.pbr = false;
const auto = q.get("auto") === "1";
const out = document.getElementById("hud")!;

const t0 = performance.now();
await loadScans();
const tScans = performance.now();
const layout = buildNaijaWorld();
const tLayout = performance.now();
// &idle=1: built in slices between frames, as the game will (the longest frame gap while it builds is kept).
let stall = 0;
let warmMs = 0;
let lastTick = performance.now();
let building = true;
const tick = () => {
  const now = performance.now();
  stall = Math.max(stall, now - lastTick);
  if (now - lastTick > 100) ((window as unknown as { __gaps: string[] }).__gaps ??= []).push(`${Math.round(now - lastTick)} ms at ${Math.round(now - t0)} ms`);
  lastTick = now;
  if (building) requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
const world = q.get("idle") ? await buildOpenWorldIdle(layout, spec, { night: q.get("night") === "1" }) : buildOpenWorld(layout, spec, { night: q.get("night") === "1" });
setTimeout(() => (building = false), 3000);
const tWorld = performance.now();
(window as unknown as { __world: unknown }).__world = world;

const canvas = document.getElementById("c") as HTMLCanvasElement;
const r = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
r.setPixelRatio(Math.min(spec.maxPixelRatio, devicePixelRatio));
r.setSize(innerWidth, innerHeight);
r.outputColorSpace = SRGBColorSpace;
r.toneMapping = ACESFilmicToneMapping;
r.toneMappingExposure = 1.0;
r.shadowMap.enabled = spec.shadows;
r.info.autoReset = false;
const scene = new Scene();
scene.fog = world.fog;
scene.background = world.clear;
scene.add(world.group);

// The film look (graphics/grade.ts): Naija World's Harmattan grade on every tier.
const look = LOOKS[(q.get("look") as LookId) ?? "naija"] ?? LOOKS.naija;
const grade = new Grade(spec.tier);
grade.set(look, r);
const post = spec.fancy ? new Post() : null;
post?.setLook(look, r);
if (spec.tier === 0) {
  gradeLights(world.group, look);
  document.getElementById("veil")!.style.background = vignetteCss(look);
}
const camera = new PerspectiveCamera(65, innerWidth / innerHeight, 0.1, world.view + 40);
const rig = new CameraRig(camera);
rig.wallX = Infinity;
rig.dollZ = -1e6;
rig.near = (x, z, rr) => world.space.camBoxes(x, z, rr);

// ── People ──
const rng = new Rng(3);
const crowd = new Crowd(12);
crowd.tier = spec.tier;
crowd.blobShadows = !spec.shadows;
crowd.setup(Array.from({ length: 12 }, () => randomLook(rng)), 0);
scene.add(crowd.group);
if (q.get("idle")) {
  const tw = performance.now();
  await world.warm(r, scene, camera);
  warmMs = Math.round(performance.now() - tw);
}
const at = q.get("at")?.split(",").map(Number);
// ── The shared gameplay (play=1): a real match, its zone, items and Airfall ──
const playOn = q.get("play") === "1";
const fast = Math.max(1, Number(q.get("fast") ?? 1));
let match: Match | null = null;
if (playOn) {
  const ftf = BUILTIN_MANIFEST.modes.find((m) => m.id === "find-the-flag")!;
  const settings = settingsOf(ftf);
  settings.modules = { zone: settings.modules.zone, items: settings.modules.items, airfall: settings.modules.airfall };
  if (fast > 1) {
    const z = settings.modules.zone as { phases: number[][] };
    z.phases = z.phases.map(([s0, r0, o0, k0]) => [s0 / fast, r0, o0 / fast, k0]);
    const a = settings.modules.airfall as { gap: number[] };
    a.gap = a.gap.map((g) => g / fast);
  }
  match = new Match({
    seed: Number(q.get("seed") ?? 1),
    world: { space: world.space, spawns: layout.spawns, places: [...layout.landmarks.map((l) => ({ x: l.x, z: l.z, r: 18 })), ...layout.areas.map((a) => ({ x: a.x, z: a.z, r: a.r }))] },
    settings,
    contestants: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: i ? `P${i}` : "You", bot: i > 0 })),
    countdown: 1,
  });
  (window as unknown as { __match: Match }).__match = match;
}
const people: Contestant[] = match ? match.contestants : Array.from({ length: 12 }, (_, i) => {
  const [x, z] = i === 0 ? (at ?? (auto ? [60, 2] : layout.spawns[0])) : layout.spawns[i];
  return {
    id: `p${i}`, name: "P", bot: i > 0, index: i, x, z, vx: 0, vz: 0, heading: 0, status: "alive", finishTime: -1, place: 0,
    eliminatedAt: -1, cause: null, inX: 0, inZ: 0, progress: 0, graceBonus: 0, ...freshMotion(), bst: NO_BOOST,
  } as Contestant;
});
// The others start near you, so there's someone to see (in play, everyone keeps their own start).
if (match && at) {
  people[0].x = at[0];
  people[0].z = at[1];
}
for (let i = 1; i < 12 && !match; i++) {
  const a = (i / 11) * Math.PI * 2;
  people[i].x = people[0].x + Math.cos(a) * (6 + i);
  people[i].z = people[0].z + Math.sin(a) * (6 + i);
}

// ── Input ──
const keys = new Set<string>();
addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));
let drag: [number, number] | null = null;
canvas.addEventListener("pointerdown", (e) => (drag = [e.clientX, e.clientY]));
addEventListener("pointerup", () => (drag = null));
addEventListener("pointermove", (e) => {
  if (!drag) return;
  rig.orbit(0, 0, 0, e.clientX - drag[0], e.clientY - drag[1]);
  drag = [e.clientX, e.clientY];
});
addEventListener("resize", () => {
  r.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// The tour, down the middle of the roads: the market, the mosque, the bus park, the church, then
// west along Market Road to the village, the baobab, the river and the estate, and back.
const TOUR: [number, number][] = [[60, -90], [0, -90], [0, -150], [120, -150], [120, 75], [60, 75], [60, 145], [120, 145], [120, 0], [-40, 0], [-135, 0], [-135, -120], [-135, 0], [-110, 0], [-110, 120], [-110, 0], [0, 0], [0, 75], [-60, 75], [-60, 185], [-60, 75], [60, 75], [60, 0]];
let leg = 0;

// The game's own HUD: the compass (landmark pins) and the minimap.
const hud = new Hud();
document.getElementById("ui")!.append(hud.root);
hud.show(true);

// play=1: the open world's HUD, its scene and its sounds.
const sound = new Sound();
addEventListener("pointerdown", () => sound.unlock());
addEventListener("keydown", () => sound.unlock());
const play = new PlayHud();
let pressN = 0;
let holdE = false;
let packN = 0;
const ms = match
  ? new MatchScene({
      tier: spec.tier,
      view: world.view,
      ground: "dust",
      crowd,
      hud,
      play,
      sound,
      me: 0,
      printsAt: (x, z, feet) => {
        const s0 = world.space.surfaceAt(x, z, feet);
        return s0 !== "puddle" && s0 !== "metal";
      },
    })
  : null;
if (match && ms) {
  (window as unknown as { __ms: MatchScene }).__ms = ms;
  hud.root.append(play.root);
  scene.add(ms.group);
  play.onInteract = (down) => {
    if (down) pressN = (pressN + 1) & 255;
    holdE = down;
    match!.setInteract("p0", pressN, holdE);
  };
  play.onUse = (slot) => match!.setPack("p0", (++packN << 5) | slot);
  play.onDrop = (slot) => match!.setPack("p0", (++packN << 5) | 16 | slot);
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "KeyE") play.onInteract(true);
    else if (e.code === "KeyB" || e.code === "Tab") {
      e.preventDefault();
      play.openPack(!play.packOpen);
    } else if (/^Digit\d$/.test(e.code)) {
      const d = Number(e.code.slice(5));
      play.key(d === 0 ? 9 : d - 1, e.shiftKey);
    }
  });
  addEventListener("keyup", (e) => {
    if (e.code === "KeyE") play.onInteract(false);
  });
  addEventListener("resize", () => ms.laser.setViewport(innerHeight));
}
const minimap = hud.map;
minimap.setTerrain(world.terrain);
minimap.reach = 80;
minimap.names = layout.landmarks;

// ── Loop ──
const frames: number[] = [];
let last = performance.now();
let acc = 0;
const focus = new Vector3();
let split = 0;
let statN = 0;
const marks = people.slice(1) as unknown as { x: number; z: number; kind: "other" }[];
for (const m of marks) (m as { kind: string }).kind = "other";
let worldOnly = { calls: 0, tris: 0 };
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frames.push(dt);
  if (frames.length > 240) frames.shift();
  const me = people[0];
  if (auto) {
    const [tx, tz] = TOUR[leg % TOUR.length];
    const dx = tx - me.x;
    const dz = tz - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 4) leg++;
    me.inX = dx / Math.max(1e-6, d);
    me.inZ = dz / Math.max(1e-6, d);
    me.inSprint = true;
    // Face the way you go: the camera turns behind you.
    const want = Math.atan2(-me.inX, -me.inZ);
    let dy = want - rig.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    rig.yaw += dy * Math.min(1, dt * 3);
  } else {
    // The stick in camera space: forward is where the camera looks.
    const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const s = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const fx = -Math.sin(rig.yaw);
    const fz = -Math.cos(rig.yaw);
    let ix = fx * f - fz * s;
    let iz = fz * f + fx * s;
    const l = Math.hypot(ix, iz);
    if (l > 1) {
      ix /= l;
      iz /= l;
    }
    me.inX = ix;
    me.inZ = iz;
    me.inSprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    me.inStance = keys.has("KeyZ") ? 2 : keys.has("KeyC") ? 1 : 0;
    if (keys.has("Space")) {
      me.inJump = (me.inJump + 1) & 255;
      keys.delete("Space");
    }
  }
  // The others wander (in play, back towards the safe circle when they're outside it, and they pick things up).
  const zoneM = match?.module<ZoneModule>("zone") ?? null;
  for (let i = 1; i < 12; i++) {
    const c = people[i];
    if (match) {
      const safe = zoneM?.safe();
      if (safe && Math.hypot(c.x - safe.x, c.z - safe.z) > safe.r * 0.8 && rng.chance(dt * 1.5)) {
        const dx = safe.x - c.x + rng.range(-20, 20);
        const dz = safe.z - c.z + rng.range(-20, 20);
        const l = Math.hypot(dx, dz) || 1;
        match.setInput(c.id, dx / l, dz / l);
        match.setButtons(c.id, rng.chance(0.4), 0, c.inJump);
        continue;
      }
      if (rng.chance(dt * 0.6)) {
        const a = rng.range(0, Math.PI * 2);
        match.setInput(c.id, Math.cos(a) * 0.7, Math.sin(a) * 0.7);
      }
      if (rng.chance(dt * 0.5)) match.setInteract(c.id, Math.floor(match.elapsed * 7) & 255, false);
      continue;
    }
    if (rng.chance(dt * 0.6)) {
      const a = rng.range(0, Math.PI * 2);
      c.inX = Math.cos(a) * 0.7;
      c.inZ = Math.sin(a) * 0.7;
    }
  }
  acc += dt;
  while (acc >= 1 / 60) {
    if (match) {
      match.setInput("p0", me.inX, me.inZ);
      match.setButtons("p0", me.inSprint, me.inStance, me.inJump);
      match.step(1 / 60);
      ms!.events(match.drain(), match, camera.position);
    } else for (const c of people) moveContestant(c, 1 / 60, DEFAULT_COURSE, world.space);
    acc -= 1 / 60;
  }
  rig.follow(false, { x: me.x, z: me.z, y: me.y, stance: me.stance, ground: me.h });
  rig.update(dt, { x: me.x, z: me.z, y: me.y, stance: me.stance, ground: me.h });
  focus.set(me.x, me.h, me.z);
  world.update(dt, focus, camera.position);
  crowd.update(dt, people, camera.position);
  const sky = q.get("sky");
  if (sky) {
    // An overview: high above a point, looking down at it.
    const [ox, oz, oh] = sky.split(",").map(Number);
    camera.position.set(ox + oh * 0.6, oh, oz + oh * 0.6);
    camera.lookAt(ox, 0, oz);
    camera.far = 2000;
    camera.updateProjectionMatrix();
    scene.fog = null;
    world.update(0, focus.set(ox, 0, oz), new Vector3(ox, 0, oz));
  }
  // Once a second: the world alone, without the people, for the budget's breakdown.
  if (++split % 60 === 0) {
    crowd.group.visible = false;
    r.info.reset();
    r.render(scene, camera);
    worldOnly = { calls: r.info.render.calls, tris: r.info.render.triangles };
    crowd.group.visible = true;
  }
  r.info.reset();
  if (post) post.render(r, scene, camera);
  else grade.render(r, scene, camera);
  let pin = null;
  let drawMarks: MapMark[] = marks as unknown as MapMark[];
  if (match && ms) {
    drawMarks = [];
    for (let i = 1; i < 12; i++) drawMarks.push({ x: people[i].x, z: people[i].z, kind: people[i].status === "alive" ? "other" : "out" });
    pin = ms.update(dt, match, camera.position, drawMarks).pin;
  }
  minimap.draw({ x: me.x, z: me.z, heading: me.heading, out: me.status !== "alive" }, drawMarks, null, rig.yaw);
  hud.setCompass(rig.yaw, me, null, layout.landmarks, pin);
  if (++statN % 15) {
    requestAnimationFrame(frame);
    return;
  }
  const sorted = [...frames].sort((a, b) => a - b);
  const fps = frames.length / frames.reduce((a, b) => a + b, 0);
  const p95 = 1 / sorted[Math.floor(sorted.length * 0.95)];
  const st = world.stats();
  const info = {
    tier: spec.name,
    fps: Math.round(fps),
    p95fps: Math.round(p95),
    calls: r.info.render.calls,
    tris: r.info.render.triangles,
    world: worldOnly,
    cells: st.cells,
    pvsCut: st.pvsCut,
    pvsMean: +world.pvs.mean.toFixed(1),
    pvsMax: world.pvs.max,
    pvsMs: Math.round(world.pvs.ms),
    buildMs: { scans: Math.round(tScans - t0), layout: Math.round(tLayout - tScans), world: Math.round(tWorld - tLayout), longestFrame: Math.round(stall), warm: warmMs },
    at: [Math.round(me.x), Math.round(me.z), +me.h.toFixed(2)],
    leg,
  };
  (window as unknown as { __open: typeof info }).__open = info;
  if (match && ms) {
    const z = match.module<ZoneModule>("zone")!;
    const it = match.module<ItemsModule>("items")!;
    (window as unknown as { __play: unknown }).__play = {
      phase: match.phase,
      t: +match.elapsed.toFixed(1),
      alive: match.aliveCount,
      zone: { x: Math.round(z.now.x), z: Math.round(z.now.z), r: Math.round(z.now.r) },
      exposure: +z.exposureOf(0).toFixed(2),
      me: me.status,
      pack: it.packs[0].filter((k) => k),
      items: ms.items.stats(),
      left: it.items.filter((x) => !x.taken).length,
    };
  }
  out.textContent = JSON.stringify(info);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Triangles per prefab, by level, over the whole city (the budget's breakdown).
import { PrefabKit } from "../src/maps/open/art";
{
  const k = new PrefabKit(1);
  const by: Record<string, { n: number; near: number; mid: number; far: number; atlas: number }> = {};
  const tri = (gs: import("three").BufferGeometry[]) => gs.reduce((a, g) => a + g.attributes.position.count / 3, 0);
  for (const p of layout.placements) {
    const { chunk: c } = k.draw(p, false);
    const b = (by[p.prefab] ??= { n: 0, near: 0, mid: 0, far: 0, atlas: 0 });
    b.n++;
    b.far += tri(c.mass) + tri(c.foliage) + tri(c.far);
    b.mid += tri(c.mass) + tri(c.main) + tri(c.foliage);
    b.near += tri(c.mass) + tri(c.main) + tri(c.detail) + tri(c.foliage);
    b.atlas += tri(c.atlas);
  }
  (window as unknown as { __prefabTris: unknown }).__prefabTris = Object.entries(by).sort((a, b) => b[1].near - a[1].near).map(([id, v]) => `${id} ×${v.n}: near ${Math.round(v.near)} mid ${Math.round(v.mid)} far ${Math.round(v.far)} atlas ${Math.round(v.atlas)}`);
}
