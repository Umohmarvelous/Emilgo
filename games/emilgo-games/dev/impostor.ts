// Dev only (v6 max, 3.4): bake a scanned tree into an impostor. Not in any build.
//
//   /dev/impostor.html?id=island_tree_02&views=12&tile=512[&node=0]
//
// (node: keep only that one of the scene's top nodes: Poly Haven's fir scan stands three saplings in a row.)
// Loads tools/assets/in/trees/<id>/<id>.gltf (Poly Haven, CC0), stands it on y = 0 and renders it from `views`
// directions round it (level, orthographic, the same square frame every time) into two atlases: the colour
// (unlit, alpha cut out, the edges' colour spread into the empty space so mipmaps don't fringe) and the normals
// (in each view's own camera space: x right, y up, z toward the viewer), 4 views to a row.
// window.__impostor = { a, n: PNG data URLs, meta } once done; tools/assets/trees.ts takes them on.

import {
  Box3,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  SRGBColorSpace,
  type Material,
  type Texture,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const q = new URLSearchParams(location.search);
const id = q.get("id") ?? "island_tree_02";
const V = Number(q.get("views") ?? 12);
const TILE = Number(q.get("tile") ?? 512);
const NODE = q.get("node");
const COLS = 4;
const ROWS = Math.ceil(V / COLS);

const renderer = new WebGLRenderer({ canvas: document.getElementById("c") as HTMLCanvasElement, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(TILE, TILE, false);
renderer.setClearColor(0x000000, 0);

const NORMAL_VS = /* glsl */ `
varying vec3 vN;
varying vec2 vUv;
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const NORMAL_FS = /* glsl */ `
uniform sampler2D map;
uniform float hasMap;
varying vec3 vN;
varying vec2 vUv;
void main() {
  if (hasMap > 0.5 && texture2D(map, vUv).a < 0.5) discard;
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`;

async function main(): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync(`/tools/assets/in/trees/${id}/${id}.gltf`);
  const root = gltf.scene;
  if (NODE !== null) {
    const keep = root.children[Number(NODE)];
    for (const ch of [...root.children]) if (ch !== keep) root.remove(ch);
    keep.position.set(0, keep.position.y, 0);
  }
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  // Stand it on y = 0, its trunk's foot (the box's middle) at the origin.
  const c = box.getCenter(new Vector3());
  root.position.set(-c.x, -box.min.y, -c.z);
  root.updateMatrixWorld(true);
  const H = box.max.y - box.min.y;
  let R = 0;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.getAttribute("position");
    const v = new Vector3();
    for (let i = 0; i < p.count; i += 7) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      R = Math.max(R, Math.hypot(v.x, v.z));
    }
  });
  const S = Math.max(2 * R, H) * 1.02;
  const scene = new Scene();
  scene.add(root);
  // Two looks of every mesh: its colour, unlit; its normals.
  const meshes: { m: Mesh; albedo: Material; normal: Material }[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const src = (Array.isArray(m.material) ? m.material[0] : m.material) as Material & { map?: Texture | null; color?: { getHex(): number } };
    const map = src.map ?? null;
    meshes.push({
      m,
      albedo: new MeshBasicMaterial({ map, color: src.color?.getHex() ?? 0xffffff, alphaTest: 0.5, side: DoubleSide }),
      normal: new ShaderMaterial({ vertexShader: NORMAL_VS, fragmentShader: NORMAL_FS, uniforms: { map: { value: map }, hasMap: { value: map ? 1 : 0 } }, side: DoubleSide }),
    });
  });
  const cam = new OrthographicCamera(-S / 2, S / 2, S, 0, 0.1, S * 4);
  // The colour into an sRGB target (three encodes it on the way, as it does for the screen); the normals linear.
  const rtA = new WebGLRenderTarget(TILE, TILE, { samples: 4 });
  rtA.texture.colorSpace = SRGBColorSpace;
  const rtN = new WebGLRenderTarget(TILE, TILE, { samples: 4 });
  const buf = new Uint8Array(TILE * TILE * 4);
  const atlas = (pass: "albedo" | "normal"): HTMLCanvasElement => {
    for (const x of meshes) x.m.material = x[pass];
    const rt = pass === "albedo" ? rtA : rtN;
    const out = document.createElement("canvas");
    out.width = TILE * COLS;
    out.height = TILE * ROWS;
    const g = out.getContext("2d")!;
    const img = g.createImageData(TILE, TILE);
    for (let k = 0; k < V; k++) {
      const a = (k / V) * Math.PI * 2;
      cam.position.set(Math.sin(a) * S * 2, 0, Math.cos(a) * S * 2);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, TILE, TILE, buf);
      // The target's rows run bottom-up; the canvas's top-down.
      for (let y = 0; y < TILE; y++) img.data.set(buf.subarray((TILE - 1 - y) * TILE * 4, (TILE - y) * TILE * 4), y * TILE * 4);
      g.putImageData(img, (k % COLS) * TILE, Math.floor(k / COLS) * TILE);
    }
    renderer.setRenderTarget(null);
    return out;
  };
  const a = atlas("albedo");
  dilate(a, 12);
  const n = atlas("normal");
  // The normals' empty space: facing the viewer (flat), spread from the edges like the colour.
  dilate(n, 12, [128, 128, 255]);
  (window as unknown as { __impostor: unknown }).__impostor = {
    a: a.toDataURL("image/png"),
    n: n.toDataURL("image/png"),
    meta: { id, node: NODE === null ? undefined : Number(NODE), views: V, cols: COLS, rows: ROWS, tile: TILE, size: +S.toFixed(3), height: +H.toFixed(3), radius: +R.toFixed(3) },
  };
  const w = window as unknown as { __impostor: { meta: unknown; metaUrl?: string } };
  w.__impostor.metaUrl = `data:application/json;base64,${btoa(JSON.stringify(w.__impostor.meta))}`;
  document.title = "done";
}

/** Spread the opaque pixels' colour into the transparent ones round them (alpha stays 0), `n` pixels out. */
function dilate(c: HTMLCanvasElement, n: number, rest?: [number, number, number]): void {
  const g = c.getContext("2d")!;
  const im = g.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  const w = c.width;
  const h = c.height;
  let filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  for (let it = 0; it < n; it++) {
    const next = filled.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0, gg = 0, b = 0, k = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (!filled[j]) continue;
          r += d[j * 4];
          gg += d[j * 4 + 1];
          b += d[j * 4 + 2];
          k++;
        }
        if (k) {
          d[i * 4] = r / k;
          d[i * 4 + 1] = gg / k;
          d[i * 4 + 2] = b / k;
          next[i] = 1;
        }
      }
    }
    filled = next;
  }
  if (rest) for (let i = 0; i < w * h; i++) if (!filled[i]) d.set(rest, i * 4);
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] <= 127) d[i * 4 + 3] = 0;
  g.putImageData(im, 0, 0);
}

main().catch((e) => {
  document.title = `error: ${(e as Error).message}`;
  console.error(e);
});
