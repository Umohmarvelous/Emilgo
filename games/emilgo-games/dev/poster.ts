// Dev only: renders the welcome screen's hero art (src/ui/welcome.webp) from
// the game's own characters — a squad in hero suits on a burning Lagos street
// at night, smoke and embers, a low heroic camera. Inspired by the reference
// posters' mood (UPGRADE.md), drawn entirely with our own assets.
//   /dev/poster.html?w=1920&h=1080
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  SpotLight,
  SRGBColorSpace,
  WebGLRenderer,
  BoxGeometry,
  PCFSoftShadowMap,
} from "three";
import { Human } from "../src/world/human";
import { cleanLook } from "../src/world/human/wardrobe";
import { canvasTexture, glow, paving, tiled } from "../src/world/tex";

const q = new URLSearchParams(location.search);
const W = Number(q.get("w") ?? 1920);
const H = Number(q.get("h") ?? 1080);
const canvas = document.getElementById("c") as HTMLCanvasElement;
const r = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
r.setPixelRatio(1);
r.setSize(W, H);
r.outputColorSpace = SRGBColorSpace;
r.toneMapping = ACESFilmicToneMapping;
r.toneMappingExposure = 1.1;
r.shadowMap.enabled = true;
r.shadowMap.type = PCFSoftShadowMap;

const scene = new Scene();
scene.background = new Color(0x07090c);
scene.fog = new Fog(0x0c0705, 16, 70);

// Light: a hard warm rim from the fire behind, a cool key from the front left, green fill.
scene.add(new HemisphereLight(0x2a3440, 0x0a0503, 0.35));
const rimL = new DirectionalLight(0xff7a2a, 9);
rimL.position.set(-6, 5, -10);
const rimR = new DirectionalLight(0xff9a50, 7);
rimR.position.set(7, 4, -9);
const key = new SpotLight(0xd8e4ff, 220, 30, 0.5, 0.7, 1.2);
key.position.set(-3.5, 5, 7);
key.target.position.set(0, 1.2, 0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
const fill = new DirectionalLight(0x3aff9a, 0.55);
fill.position.set(6, 1.5, 6);
scene.add(rimL, rimR, key, key.target, fill);

// Street.
const ground = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ map: tiled(canvasTexture("paving", 512, paving), 26, 26), color: 0x6a5a4a, roughness: 0.35, metalness: 0.15 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// The burning skyline: dark blocks, lit windows, a fire glow behind.
const blockMat = new MeshBasicMaterial({ color: 0x050302, fog: false });
const winMat = new MeshBasicMaterial({ color: 0xffb060, fog: false });
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 26; i++) {
  const x = -30 + i * 2.4 + rnd() * 1.5;
  const h = 6 + rnd() * 14;
  const w = 2 + rnd() * 3;
  const b = new Mesh(new BoxGeometry(w, h, 3), blockMat);
  b.position.set(x, h / 2, -22 - rnd() * 10);
  scene.add(b);
  for (let k = 0; k < 5; k++) {
    if (rnd() < 0.6) continue;
    const win = new Mesh(new PlaneGeometry(0.3, 0.45), winMat);
    win.position.set(x + (rnd() - 0.5) * w * 0.7, 1.5 + rnd() * (h - 2), b.position.z + 1.51);
    scene.add(win);
  }
}
const fireGlow = (x: number, y: number, z: number, s: number, c: number, o: number) => {
  const m = new Mesh(new PlaneGeometry(s, s * 0.7), new MeshBasicMaterial({ map: canvasTexture("glow", 128, glow, false), color: c, transparent: true, opacity: o, blending: AdditiveBlending, depthWrite: false, fog: false }));
  m.position.set(x, y, z);
  scene.add(m);
};
fireGlow(-14, 6, -40, 60, 0xff4a10, 1);
fireGlow(16, 4, -42, 54, 0xff6a20, 1);
fireGlow(0, 10, -44, 90, 0x9a2a08, 0.8);

// Smoke: soft noise sprites, layered.
const smokeTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 70; i++) {
    const x = 128 + (rnd() - 0.5) * 140;
    const y = 128 + (rnd() - 0.5) * 120;
    const rr = 20 + rnd() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, "rgba(255,255,255,0.18)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
})();
for (let i = 0; i < 22; i++) {
  const s = 6 + rnd() * 10;
  const m = new Mesh(new PlaneGeometry(s, s), new MeshBasicMaterial({ map: smokeTex, color: i % 3 ? 0x2a2420 : 0x7a4a2a, transparent: true, opacity: 0.6, depthWrite: false, fog: false }));
  m.position.set((rnd() - 0.5) * 30, 1 + rnd() * 8, -8 - rnd() * 14);
  m.rotation.z = rnd() * 6;
  scene.add(m);
}

// Embers.
const n = 900;
const pos = new Float32Array(n * 3);
for (let i = 0; i < n; i++) {
  pos[i * 3] = (rnd() - 0.5) * 26;
  pos[i * 3 + 1] = rnd() * 9;
  pos[i * 3 + 2] = -rnd() * 18 + 3;
}
const eg = new BufferGeometry();
eg.setAttribute("position", new BufferAttribute(pos, 3));
scene.add(new Points(eg, new PointsMaterial({ size: 0.07, map: canvasTexture("glow", 32, glow, false), color: 0xffa040, transparent: true, blending: AdditiveBlending, depthWrite: false })));

// The squad.
const squad = [
  { look: { body: "m", skin: 2, hair: "fade", outfit: "hero", extras: ["headset"] }, x: 0, z: 0.4, ry: 0, pose: "hero" },
  { look: { body: "f", skin: 4, hair: "braids", outfit: "hero", extras: ["shades"] }, x: -1.3, z: -0.5, ry: 0.3, pose: "hip" },
  { look: { body: "m", skin: 6, hair: "lowcut", outfit: "hero", extras: [] }, x: 1.4, z: -0.5, ry: -0.3, pose: "hero" },
  { look: { body: "f", skin: 1, hair: "afro", outfit: "hero", extras: ["earrings"] }, x: -2.6, z: -1.5, ry: 0.45, pose: "relaxed" },
  { look: { body: "m", skin: 3, hair: "locs", outfit: "hero", extras: ["glasses"] }, x: 2.7, z: -1.6, ry: -0.42, pose: "hero" },
] as const;
const people = squad.map((p, i) => {
  const h = new Human(cleanLook(p.look as never), 2, { featured: true, seed: i * 3 + 1, lit: "standard" });
  h.mesh.position.set(p.x, 0, p.z);
  h.mesh.rotation.y = p.ry;
  h.mesh.castShadow = true;
  h.setPose(p.pose as never);
  scene.add(h.mesh);
  return h;
});

// Low, heroic camera; characters fill the lower two thirds (logo sits above).
const cam = new PerspectiveCamera(34, W / H, 0.1, 200);
cam.position.set(0, 0.85, 5.4);
cam.lookAt(0, 1.38, 0);

let t = 0;
let frames = 0;
function tick() {
  t += 1 / 60;
  for (const p of people) p.update(1 / 60, 0, 0, 0);
  r.render(scene, cam);
  if (++frames === 90) (window as unknown as { __ready: boolean }).__ready = true;
  requestAnimationFrame(tick);
}
tick();
(window as unknown as { __webp: () => string }).__webp = () => canvas.toDataURL("image/webp", 0.8);
