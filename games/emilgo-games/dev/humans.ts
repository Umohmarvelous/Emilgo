// Dev only: a line-up of people, for screenshots. Not in any build.
//   /dev/humans.html?tier=1&set=outfits|hair|tiers|face|poses&pose=hair&cam=front|back|face
// Players are the scanned people; &gen=1 shows the generated ones instead (Mama, and the fallback).
import { ACESFilmicToneMapping, AmbientLight, Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer } from "three";
import { Human, loadScans, type Tier } from "../src/world/human";
import { loadScanLevel } from "../src/world/human/scanbody";
import { DOLL_LOOK, FREE_OUTFITS, HAIRS, OUTFITS, cleanLook, uniformLook, type Look } from "../src/world/human/wardrobe";

const q = new URLSearchParams(location.search);
if (!q.get("gen")) {
  await loadScans();
  await Promise.all([loadScanLevel(2), loadScanLevel(3)]);
}
if (q.get("uvdebug")) (globalThis as { __uvDebug?: boolean }).__uvDebug = true;
const tier = Number(q.get("tier") ?? 1) as Tier;
const set = q.get("set") ?? "outfits";
const cam = q.get("cam") ?? "front";
const r = new WebGLRenderer({ canvas: document.getElementById("c") as HTMLCanvasElement, antialias: true });
r.setPixelRatio(Math.min(2, devicePixelRatio));
r.setSize(innerWidth, innerHeight);
r.outputColorSpace = SRGBColorSpace;
r.toneMapping = ACESFilmicToneMapping;
r.toneMappingExposure = 1.05;
const scene = new Scene();
scene.background = new Color(0x6f7f8f);
scene.add(new HemisphereLight(0xdfefff, 0x6a5040, 1.2));
const key = new DirectionalLight(0xfff0dd, 2.4);
key.position.set(3, 5, 6);
scene.add(key);
const rim = new DirectionalLight(0xbfd8ff, 1.6);
rim.position.set(-4, 3, -5);
scene.add(rim);
scene.add(new AmbientLight(0xffffff, 0.15));
const floor = new Mesh(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: 0x8a8378, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const looks: Look[] = [];
const base = (o: Partial<Look>) => cleanLook({ body: "m", skin: 4, hair: "lowcut", hairColor: 0, outfit: "street", extras: [], height: 1, ...o });
if (set === "outfits") {
  for (const o of OUTFITS) looks.push(base({ outfit: o.id, body: o.fits ?? (looks.length % 2 ? "f" : "m"), skin: looks.length % 8, hair: o.fits === "f" ? "afro" : "lowcut" }));
} else if (set === "hair") {
  HAIRS.forEach((h, i) => looks.push(base({ hair: h.id, body: i % 2 ? "f" : "m", skin: (i * 3) % 8, outfit: FREE_OUTFITS[i % FREE_OUTFITS.length].id, extras: i === 2 ? ["earrings"] : i === 4 ? ["glasses"] : i === 6 ? ["headset"] : [] })));
  looks.push(base({ body: "f", extras: ["gele", "earrings"], outfit: "patch_dress", skin: 2 }));
  looks.push(base({ body: "m", extras: ["fila", "shades", "watch"], outfit: "outfit_ankara", skin: 6 }));
} else if (set === "tiers") {
  for (const t of [0, 1, 2]) looks.push(base({ body: "f", hair: "afro", outfit: "patch_dress", skin: 3 }));
} else if (set === "move") {
  for (let i = 0; i < 7; i++) looks.push(base({ body: i % 2 ? "f" : "m", hair: i % 2 ? "braids" : "lowcut", outfit: ["street", "cami_jeans", "hero", "sweater", "beach", "office", "outfit_ankara"][i], skin: i }));
} else if (set === "afro") {
  looks.push(base({ body: "f", hair: "afro", outfit: "patch_dress", skin: 3 }));
  looks.push(base({ body: "f", hair: "afro", outfit: "patch_dress", skin: 3 }));
} else if (set === "face") {
  looks.push(base({ body: "f", hair: "bun", outfit: "office", skin: 3, extras: ["earrings"] }));
  looks.push(base({ body: "m", hair: "lowcut", outfit: "sweater", skin: 5 }));
} else if (set === "doll") {
  looks.push(DOLL_LOOK, DOLL_LOOK);
} else if (set === "uniform") {
  const hs = ["afro", "lowcut", "braids", "fade", "bun"] as const;
  for (let i = 0; i < 5; i++) looks.push(uniformLook(base({ body: i % 2 ? "f" : "m", hair: hs[i], skin: (i * 3) % 8 }), [7, 18, 3, 12, 20][i]));
} else if (set === "poses") {
  for (const p of ["relaxed", "hip", "hair", "hero", "arms"]) looks.push(base({ body: p === "hero" || p === "arms" ? "m" : "f", hair: "afro", outfit: p === "hero" ? "hero" : "patch_dress", skin: 3 }));
}
const people: Human[] = [];
const gap = set === "face" ? 0.5 : 0.85;
looks.forEach((l, i) => {
  const t = set === "tiers" ? (i as Tier) : tier;
  const h = new Human(l, t, { featured: true, seed: i });
  h.mesh.position.x = (i - (looks.length - 1) / 2) * gap;
  if (cam === "back") h.mesh.rotation.y = Math.PI;
  if (set === "afro" && i === 1) h.mesh.rotation.y = Math.PI / 2;
  if (cam === "side" || (set === "move" && q.get("cam") !== "front")) h.mesh.rotation.y = Math.PI / 2;
  if (set === "poses") h.setPose((["relaxed", "hip", "hair", "hero", "arms"] as const)[i]);
  if (q.get("pose")) h.setPose(q.get("pose") as never);
  if (q.get("emote")) h.emote(q.get("emote") as never);
  if (set === "doll") {
    h.bone("head").scale.setScalar(1.28);
    if (i === 1) h.mesh.rotation.y = Math.PI * 0.75;
  }
  if (q.get("nonormal")) ((h.mesh.material as unknown) as { normalMap: unknown }).normalMap = null;
  scene.add(h.mesh);
  people.push(h);
});
const w = (looks.length - 1) * gap + 1;
const camera = new PerspectiveCamera(set === "face" ? 20 : 35, innerWidth / innerHeight, 0.05, 100);
if (set === "face" || set === "afro" || cam === "face") {
  camera.position.set(0, 1.6, 1.6);
  camera.lookAt(0, 1.58, 0);
} else if (q.get("zoom") === "hand") {
  camera.fov = 22;
  camera.position.set(0.9, 0.95, 1.1);
  camera.lookAt(0.2, 0.8, 0);
} else if (q.get("zoom") === "feet") {
  camera.fov = 25;
  camera.position.set(0.6, 0.35, 1.3);
  camera.lookAt(0, 0.12, 0);
} else {
  const d = Math.max(3.2, (w / 2) / Math.tan((35 * Math.PI) / 360) / (innerWidth / innerHeight) + 1.2);
  camera.position.set(0, 1.05, d);
  camera.lookAt(0, 0.9, 0);
}
const speed = Number(q.get("speed") ?? 0);
const stance = Number(q.get("stance") ?? 0);
let last = performance.now();
let tris = 0;
for (const p of people) tris += p.triangles;
console.log("TRIS", people.map((p) => p.triangles).join(","), "total", tris);
(window as any).__ready = false;
let frames = 0;
function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (set === "move") {
    // walk, run, sprint, crouch, crouch-walk, prone crawl, caught
    const sp = [2, 6, 9, 0, 1.4, 0.5, 0];
    const st = [0, 0, 0, 1, 1, 2, 0];
    people.forEach((p, i) => {
      if (i === 6 && p.anim.dead < 0 && now > 1500) p.kill(0.6);
      p.update(dt, sp[i], st[i]);
    });
  } else for (const p of people) p.update(dt, speed, stance);
  r.render(scene, camera);
  if (++frames > 20) (window as any).__ready = true;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
(window as any).__info = { calls: () => r.info.render.calls, tris: () => r.info.render.triangles };
if (q.get("tex")) {
  // Show the first person's painted texture over the scene.
  import("../src/world/human/paint").then(({ paintLook }) => {
    const c = paintLook(looks[Number(q.get("tex")) || 0], tier, 512);
    c.style.cssText = "position:fixed;left:0;top:0;width:600px;height:600px;image-rendering:pixelated;outline:1px solid #fff";
    document.body.append(c);
  });
}
// Winding check: a face whose normal disagrees with its vertices' normals is inside-out.
{
  let bad = 0;
  let all = 0;
  for (const h of people) {
    const g = h.mesh.geometry;
    const P = g.attributes.position.array as Float32Array;
    const N = g.attributes.normal.array as Float32Array;
    const I = g.index!.array;
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const nx = N[a] + N[b] + N[c], ny = N[a + 1] + N[b + 1] + N[c + 1], nz = N[a + 2] + N[b + 2] + N[c + 2];
      const d = fx * nx + fy * ny + fz * nz;
      if (Math.hypot(fx, fy, fz) < 1e-12) continue;
      all++;
      if (d < 0) bad++;
    }
  }
  console.log("WINDING bad", bad, "of", all);
}

// Dev: the first person's normal map as a PNG data URL (window.__nm()).
(window as unknown as { __nm: () => string }).__nm = () => {
  const t = (people[0].mesh.material as unknown as { normalMap: { image: { data: Uint8Array; width: number; height: number } } }).normalMap;
  const { data, width, height } = t.image;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d")!;
  const img = g.createImageData(width, height);
  for (let y = 0; y < height; y++) img.data.set(data.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
  g.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
};
