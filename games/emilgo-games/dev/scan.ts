// Dev only: preview sheets of the scanned people — every movement, at every
// detail level, for review before anything goes in the game.
//   /dev/scan.html?body=m|f&level=0..3&set=moves|emotes|poses&cols=6&cam=front|side|back|face|hand|feet
import { ACESFilmicToneMapping, AmbientLight, CanvasTexture, Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { Human, type Detail, type Tier } from "../src/world/human";
import { loadScanLevel, loadScans } from "../src/world/human/scanbody";
import { cleanLook, type Look } from "../src/world/human/wardrobe";
import { EMOTE_SECONDS, EMOTES } from "../src/social/emotes";

const q = new URLSearchParams(location.search);
await loadScans();
await Promise.all([loadScanLevel(2), loadScanLevel(3)]);
const body = (q.get("body") ?? "m") as "m" | "f";
const level = Number(q.get("level") ?? 3) as Detail;
const set = q.get("set") ?? "moves";
const cam = q.get("cam") ?? "front";
const hoodie = Number(q.get("hoodie") ?? (body === "m" ? 0 : 1));
const design = (q.get("design") ?? "plain") as Look["design"];

interface State {
  name: string;
  /** Seconds to simulate before the snapshot. */
  at: number;
  seed?: number;
  setup?: (h: Human) => void;
  /** Per-step drive: speed m/s, stance, air, slide. */
  drive?: (h: Human, t: number) => [number, number?, number?, number?];
  yaw?: number;
  /** Detail level for this cell (else the page's). */
  level?: Detail;
  /** Look overrides for this cell. */
  look?: Partial<Look>;
  /** A fixed expression. */
  face?: Human["anim"]["face"];
}

const MOVES: State[] = [
  { name: "Idle", at: 2 },
  { name: "Walk", at: 2.15, drive: () => [2] },
  { name: "Run", at: 2.1, drive: () => [6] },
  { name: "Sprint", at: 2.05, drive: () => [9] },
  { name: "Stop (statue hold)", at: 2.25, drive: (_h, t) => [t < 2 ? 9 : 0] },
  { name: "Crouch", at: 2, drive: () => [0, 1] },
  { name: "Crouch walk", at: 2.2, drive: () => [1.4, 1] },
  { name: "Prone", at: 2, drive: () => [0, 2] },
  { name: "Prone crawl", at: 2.3, drive: () => [0.5, 2] },
  { name: "Jump", at: 2, drive: (_h, t) => [3, 0, t > 1.7 ? 1 : 0] },
  { name: "Slide", at: 2, drive: (_h, t) => [t < 1.6 ? 9 : 5, 1, 0, t > 1.6 ? 1 : 0] },
  { name: "Fist", at: 1.2, setup: (h) => setTimeout0(h, 1.0, () => h.act("fist")) },
  { name: "Slap", at: 1.2, setup: (h) => setTimeout0(h, 1.0, () => h.act("slap")) },
  { name: "Push", at: 1.26, setup: (h) => setTimeout0(h, 1.0, () => h.act("push")) },
  { name: "Grab ball", at: 1.25, setup: (h) => setTimeout0(h, 1.0, () => h.act("grab")) },
  { name: "Carry ball", at: 2, setup: (h) => h.setCarry(true) },
  { name: "Carry ball, walk", at: 2.2, setup: (h) => h.setCarry(true), drive: () => [2] },
  { name: "Carry ball, run", at: 2.1, setup: (h) => h.setCarry(true), drive: () => [6] },
  { name: "Hit: impact", at: 1.07, setup: (h) => setTimeout0(h, 1.0, () => h.hit(0.8)) },
  { name: "Hit: step back", at: 1.24, setup: (h) => setTimeout0(h, 1.0, () => h.hit(0.8)) },
  { name: "Hit: recover", at: 1.44, setup: (h) => setTimeout0(h, 1.0, () => h.hit(0.8)) },
  { name: "Death: forward (mid)", at: 1.55, seed: 0, setup: (h) => setTimeout0(h, 1.0, () => h.kill(0)) },
  { name: "Death: forward (down)", at: 4, seed: 0, setup: (h) => setTimeout0(h, 1.0, () => h.kill(0)) },
  { name: "Death: spin (mid)", at: 1.6, seed: 0.03, setup: (h) => setTimeout0(h, 1.0, () => h.kill(0)) },
  { name: "Death: spin (down)", at: 4, seed: 0.03, setup: (h) => setTimeout0(h, 1.0, () => h.kill(0)) },
  { name: "Death: crumple (knees)", at: 1.45, seed: 0.07, setup: (h) => setTimeout0(h, 1.0, () => h.kill(0)) },
  { name: "Death: crumple (mid)", at: 1.7, seed: 0.07, setup: (h) => setTimeout0(h, 1.0, () => h.kill(0)) },
  { name: "Death: backward (mid)", at: 1.55, seed: 0, setup: (h) => setTimeout0(h, 1.0, () => h.kill(Math.PI)) },
  { name: "Death: backward (down)", at: 4, seed: 0, setup: (h) => setTimeout0(h, 1.0, () => h.kill(Math.PI)) },
  { name: "Death: crumple (down)", at: 4, seed: 0.07, setup: (h) => setTimeout0(h, 1.0, () => h.kill(0)) },
  { name: "Finish (cheer)", at: 1.9, setup: (h) => setTimeout0(h, 1.0, () => h.finish()) },
];
const EMOTE_STATES: State[] = EMOTES.map((e) => ({ name: `Emote: ${e.label}`, at: 1 + EMOTE_SECONDS * 0.45, setup: (h: Human) => setTimeout0(h, 1, () => h.emote(e.id)) }));
const POSE_STATES: State[] = (["relaxed", "hip", "hair", "hero", "arms"] as const).map((p) => ({ name: `Lobby pose: ${p}`, at: 2, setup: (h: Human) => h.setPose(p) }));
const HANDS: State[] = [
  { name: "Open (rest)", at: 1 },
  { name: "Fist (punch wind-up)", at: 1.13, setup: (h) => setTimeout0(h, 1.0, () => h.act("fist")) },
  { name: "Relaxed (carry)", at: 2, setup: (h) => h.setCarry(true) },
  { name: "Point / wave", at: 1 + EMOTE_SECONDS * 0.4, setup: (h) => setTimeout0(h, 1, () => h.emote("wave")) },
];
const STILL: State[] = [{ name: "Front", at: 1 }, { name: "Three-quarter", at: 1, yaw: 0.7 }, { name: "Side", at: 1, yaw: Math.PI / 2 }, { name: "Back", at: 1, yaw: Math.PI }];
const LV_NAMES = ["far", "Low", "Medium", "High"];
const LEVELS_SET: State[] = ([3, 2, 1, 0] as Detail[]).flatMap((lv) => [
  { name: `${LV_NAMES[lv]} · front`, at: 1, level: lv },
  { name: `${LV_NAMES[lv]} · three-quarter`, at: 1, level: lv, yaw: 0.7 },
]);
const FACE_STATES: State[] = [
  { name: "Open", at: 1, face: { lids: 0, jaw: 0, yaw: 0, pitch: 0 } },
  { name: "Blink (shut)", at: 1, face: { lids: 1, jaw: 0, yaw: 0, pitch: 0 } },
  { name: "Half-shut", at: 1, face: { lids: 0.5, jaw: 0, yaw: 0, pitch: 0 } },
  { name: "Look left", at: 1, face: { lids: 0, jaw: 0, yaw: 0.45, pitch: 0 } },
  { name: "Look right", at: 1, face: { lids: 0, jaw: 0, yaw: -0.45, pitch: 0 } },
  { name: "Look up", at: 1, face: { lids: 0, jaw: 0, yaw: 0, pitch: -0.3 } },
  { name: "Look down", at: 1, face: { lids: 0, jaw: 0, yaw: 0, pitch: 0.3 } },
  { name: "Talk", at: 1, face: { lids: 0, jaw: 0.1, yaw: 0, pitch: 0 } },
  { name: "Shout", at: 1, face: { lids: 0.3, jaw: 0.3, yaw: 0, pitch: 0 } },
  { name: "Laugh (emote)", at: 1 + EMOTE_SECONDS * 0.4, setup: (h) => setTimeout0(h, 1, () => h.emote("laugh")) },
  { name: "Three-quarter", at: 1, yaw: 0.7, face: { lids: 0, jaw: 0.12, yaw: 0.3, pitch: 0 } },
  { name: "Side", at: 1, yaw: Math.PI / 2, face: { lids: 0, jaw: 0.12, yaw: 0, pitch: 0 } },
];
const FACE_ANIM: State[] = [
  { name: "Face: idle", at: 1 },
  { name: "Face: talking", at: 1, setup: (h) => h.talk(30) },
];
const DESIGN_IDS = ["plain", "twotone", "stripe", "ankara", "block"] as const;
const WARDROBE: State[] = Array.from({ length: 12 }, (_, i) => ({
  name: `${["Sage", "Sand", "Black", "Grey", "Off-white", "Navy", "EMILGO green", "Maroon", "Mustard", "Sky", "Rose", "Plum"][i]} · ${DESIGN_IDS[i % 5]}`,
  at: 1,
  look: { hoodie: i, design: DESIGN_IDS[i % 5], body: (i % 2 ? "f" : "m") as "m" | "f" },
}));
const picked = set === "faceanim" ? FACE_ANIM : set === "face" ? FACE_STATES : set === "wardrobe" ? WARDROBE : set === "hands" ? HANDS : set === "levels" ? LEVELS_SET : set === "still" ? STILL : set === "emotes" ? EMOTE_STATES : set === "poses" ? POSE_STATES : set === "all" ? [...MOVES, ...EMOTE_STATES, ...POSE_STATES] : MOVES;
// only=Name,Name: just those (by name); frames=N&fps=F: one state as N frames (an animation strip); views=yaws.
const only = q.get("only")?.split("|").map((s) => s.trim().toLowerCase());
const frames = Number(q.get("frames") ?? 0);
const fps = Number(q.get("fps") ?? 24);
const views = q.get("views")?.split(",").map(Number);
let states = only ? (set === "all" ? [...MOVES, ...EMOTE_STATES, ...POSE_STATES] : picked).filter((s) => only.some((o) => s.name.toLowerCase() === o)) : picked;
if (views) states = states.flatMap((s) => views.map((y) => ({ ...s, name: `${s.name} · ${Math.round((y * 180) / Math.PI)}°`, yaw: y })));
const from = q.get("from");
if (frames) states = Array.from({ length: frames }, (_, i) => ({ ...states[0], name: "", at: (from ? Number(from) : states[0].at) + i / fps }));

/** One-off timers in simulated time. */
const timers = new Map<Human, { at: number; fn: () => void }[]>();
function setTimeout0(h: Human, at: number, fn: () => void) {
  (timers.get(h) ?? timers.set(h, []).get(h)!).push({ at, fn });
}

const cols = Number(q.get("cols") ?? 5);
const rows = Math.ceil(states.length / cols);
const W = innerWidth;
const H = innerHeight;
const cw = Math.floor(W / cols);
const chh = Math.floor(H / rows);
const r = new WebGLRenderer({ canvas: document.getElementById("c") as HTMLCanvasElement, antialias: true, preserveDrawingBuffer: true });
r.setPixelRatio(1);
r.setSize(W, H);
r.outputColorSpace = SRGBColorSpace;
r.toneMapping = ACESFilmicToneMapping;
r.toneMappingExposure = 1.05;
r.setScissorTest(true);
r.autoClear = false;
const tier = Math.max(0, Math.min(2, level - 1)) as Tier;
const look = cleanLook({ body, skin: 4, hair: "lowcut", outfit: "street", extras: [], height: 1 });
look.hoodie = hoodie;
look.design = design;
if (q.get("num")) look.num = Number(q.get("num"));

let tris = 0;
const lab = document.createElement("canvas");
lab.width = W;
lab.height = H;
const g = lab.getContext("2d")!;
states.forEach((st, i) => {
  const scene = new Scene();
  scene.background = new Color(0x6f7f8f);
  scene.add(new HemisphereLight(0xdfefff, 0x6a5040, 1.2));
  const key = new DirectionalLight(0xfff0dd, 2.4);
  key.position.set(3, 5, 6);
  scene.add(key);
  const rim = new DirectionalLight(0xbfd8ff, 1.4);
  rim.position.set(-4, 3, -5);
  scene.add(rim);
  scene.add(new AmbientLight(0xffffff, 0.15));
  const floor = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial({ color: 0x8a8378, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const lv = st.level ?? level;
  const tr = Math.max(0, Math.min(2, lv - 1)) as Tier;
  const h = new Human(st.look ? { ...look, ...st.look } : look, tr, { featured: true, seed: st.seed ?? 0.5 });
  if (lv !== tr + 1) h.setDetail(lv);
  tris = h.triangles;
  h.mesh.rotation.y = st.yaw ?? (cam === "side" ? Math.PI / 2 : cam === "back" ? Math.PI : cam === "three" ? 0.6 : 0);
  scene.add(h.mesh);
  st.setup?.(h);
  if (st.face) h.anim.face = st.face;
  const dt = 1 / 60;
  let t = 0;
  while (t < st.at) {
    for (const tm of timers.get(h) ?? []) if (tm.at <= t && tm.at > t - dt) tm.fn();
    const [sp, stance, air, slide] = st.drive?.(h, t) ?? [0];
    h.update(dt, sp, stance ?? 0, air ?? 0, slide ?? 0);
    t += dt;
  }
  // A carried ball, where the game puts it.
  if (h.anim.carry) {
    const ball = new Mesh(new SphereGeometry(0.12, 20, 14), new MeshStandardMaterial({ color: 0xd9822b, roughness: 0.6 }));
    h.carryPoint(ball.position);
    scene.add(ball);
  }
  const c = new PerspectiveCamera(30, cw / chh, 0.05, 50);
  const lying = cam !== "fall" && (st.name.includes("(down)") || st.name.startsWith("Prone"));
  const wide = cam !== "fall" && (st.name.includes("(mid)") || st.name === "Slide");
  if (cam === "face" || cam === "close-face") {
    c.fov = cam === "face" ? 18 : 9;
    h.mesh.updateMatrixWorld(true);
    const hy = h.bone("head").getWorldPosition(new Vector3()).y;
    c.position.set(0, hy + 0.1, 1.1);
    c.lookAt(0, hy + 0.09, 0);
  } else if (cam === "mouth") {
    c.fov = 7;
    h.mesh.updateMatrixWorld(true);
    const hy = h.bone("head").getWorldPosition(new Vector3()).y;
    c.position.set(0, hy + 0.02, 1.1);
    c.lookAt(0, hy + 0.02, 0);
  } else if (cam === "hand") {
    h.mesh.updateMatrixWorld(true);
    const hp = h.bone("handR").getWorldPosition(new Vector3());
    const tip = h.bone("middle2R").getWorldPosition(new Vector3());
    const mid = hp.clone().lerp(tip, 0.5);
    c.fov = 16;
    c.position.set(mid.x - 0.25, mid.y + 0.1, mid.z + 0.6);
    c.lookAt(mid);
  } else if (cam === "feet") {
    c.fov = 18;
    c.position.set(0.5, 0.4, 1.3);
    c.lookAt(0, 0.1, 0);
  } else if (lying) {
    // Frame the body where it lies.
    h.mesh.updateMatrixWorld(true);
    const hp = h.bone("hips").getWorldPosition(new Vector3());
    const hd = h.bone("head").getWorldPosition(new Vector3());
    const mid = hp.clone().add(hd).multiplyScalar(0.5);
    c.position.set(mid.x + 0.6, 2.6, mid.z + 2.6);
    c.lookAt(mid.x, 0.15, mid.z);
  } else if (wide) {
    c.position.set(0, 1.1, 5.6);
    c.lookAt(0, 0.7, 0);
  } else if (cam === "fall") {
    c.position.set(0.75, 1.5, 6.4);
    c.lookAt(0.75, 0.55, 0);
  } else if (cam === "close") {
    c.position.set(0, 1.25, 2.6);
    c.lookAt(0, 1.1, 0);
  } else {
    c.position.set(0, 1.0, 4.4);
    c.lookAt(0, 0.88, 0);
  }
  c.updateProjectionMatrix();
  const x = (i % cols) * cw;
  const y = H - (Math.floor(i / cols) + 1) * chh;
  r.setViewport(x, y, cw, chh);
  r.setScissor(x, y, cw, chh);
  r.clear();
  r.render(scene, c);
  g.fillStyle = "rgba(0,0,0,.5)";
  g.fillRect(x, H - y - chh, cw, 20);
  g.fillStyle = "#fff";
  g.font = "bold 13px sans-serif";
  g.fillText(st.name, x + 6, H - y - chh + 14);
});
if (!frames) {
g.fillStyle = "rgba(0,0,0,.6)";
g.fillRect(W - 330, H - 22, 330, 22);
g.fillStyle = "#ffd166";
g.font = "bold 13px sans-serif";
const LV = ["far", "Low", "Medium", "High"][level];
g.fillText(`${body === "m" ? "Man" : "Woman"} · ${LV} level · ${tris.toLocaleString()} triangles`, W - 322, H - 7);
}
const tex = new CanvasTexture(lab);
tex.colorSpace = SRGBColorSpace;
const os = new Scene();
os.add(new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })));
r.setViewport(0, 0, W, H);
r.setScissor(0, 0, W, H);
r.render(os, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
(window as any).__tris = tris;
(window as any).__ready = true;
