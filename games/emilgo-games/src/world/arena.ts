// The arena: a Lagos street closed off for the game.
//
// Black-and-yellow kerbs, pastel shopfronts with hand-painted signs, black
// rooftop water tanks, a tangle of NEPA wires on leaning poles, danfos parked in
// the side streets, palms in the plaza — and at the far end, under an iroko
// tree, Mama Gele's stage.
//
// Draw calls for all of this: 3. Everything vertex-coloured is merged into one
// mesh; the signs and road paint share one textured mesh; the wires are one
// line set. Layout comes from a fixed seed, so the street is the same every
// visit — players learn it.

import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type Texture,
} from "three";

import { DOLL_Z, FIELD } from "../config";
import { Rng } from "../core/rng";
import { atlasQuad, merge, moved, part, type V3 } from "./geo";
import { CELL, SHOP_SIGN_COUNT, cellUv } from "./textures";

const ROAD_HALF = 7; // asphalt edge
const FRONT_X = 11; // building facades
const STREET_NEAR = 20;
const STREET_FAR = DOLL_Z - 13;

const FACADES = ["#f2e3c6", "#d9e8d4", "#f6c9a8", "#cfe3f2", "#efe6a5", "#e8c1c5", "#d6d0e8", "#c9e6df", "#f0d2a2", "#fafafa", "#e3d5c3"];
const CANOPIES = ["#9aa5ad", "#c62828", "#1565c0", "#2e7d32", "#f9a825", "#8d6e63", "#9aa5ad"];

// Shared unit primitives, transformed per use by `part`.
const BOX = new BoxGeometry(1, 1, 1);
const CYL6 = new CylinderGeometry(1, 1, 1, 6);
const CYL10 = new CylinderGeometry(1, 1, 1, 10);

function box(color: string | number, size: V3, p: V3, r?: V3, shade = 1): BufferGeometry {
  return part(BOX, color, { p, r, s: size }, shade);
}

function cyl(color: string | number, radius: number, height: number, p: V3, r?: V3, smooth = false): BufferGeometry {
  return part(smooth ? CYL10 : CYL6, color, { p, r, s: [radius, height, radius] });
}

// ─── Props (built once, placed by `moved`) ───────────────────────────────────

/** A danfo: yellow, black stripes, built along +Z with its nose at +Z. */
function danfo(): BufferGeometry {
  const Y = "#ffc400";
  const K = "#151515";
  const G = "#26323a";
  const parts = [
    box(Y, [1.9, 1.45, 4.6], [0, 1.03, 0]),
    box(Y, [1.84, 0.55, 4.3], [0, 2.0, -0.12]),
    box(G, [1.93, 0.5, 3.4], [0, 1.98, -0.3]), // side windows band
    box(G, [1.6, 0.55, 0.06], [0, 1.95, 2.0], [-0.18, 0, 0]), // windscreen
    box(K, [1.93, 0.12, 4.62], [0, 1.18, 0]),
    box(K, [1.93, 0.1, 4.62], [0, 0.86, 0]),
    box(K, [1.95, 0.22, 0.2], [0, 0.42, 2.32]), // bumper
    box(K, [1.95, 0.22, 0.2], [0, 0.42, -2.32]),
    box("#fff8e1", [0.3, 0.18, 0.05], [0.62, 0.78, 2.31]),
    box("#fff8e1", [0.3, 0.18, 0.05], [-0.62, 0.78, 2.31]),
    box("#8d6e63", [1.5, 0.12, 2.2], [0, 2.33, -0.4]), // roof rack
  ];
  for (const [x, z] of [[0.9, 1.55], [-0.9, 1.55], [0.9, -1.5], [-0.9, -1.5]]) {
    parts.push(part(CYL10, K, { p: [x, 0.34, z], r: [0, 0, Math.PI / 2], s: [0.34, 0.26, 0.34] }));
  }
  return merge(parts);
}

function palm(rng: Rng): BufferGeometry {
  const h = rng.range(5.5, 7.5);
  const lean = rng.range(-0.12, 0.12);
  const parts: BufferGeometry[] = [];
  const segs = 4;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    parts.push(
      part(CYL6, "#8d6e63", {
        p: [lean * t * h * 0.6, (i + 0.5) * (h / segs), 0],
        r: [0, 0, -lean],
        s: [0.2 - t * 0.08, h / segs + 0.05, 0.2 - t * 0.08],
      }, i % 2 ? 0.9 : 1),
    );
  }
  const top: V3 = [lean * h * 0.6, h, 0];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const len = rng.range(2.2, 3.0);
    parts.push(
      part(new ConeGeometry(0.42, len, 4), k % 2 ? "#2e7d32" : "#43a047", {
        p: [top[0] + Math.sin(a) * len * 0.42, top[1] - 0.35, top[2] + Math.cos(a) * len * 0.42],
        r: [Math.PI / 2 + 0.55, a, 0],
        o: "YXZ",
        s: [1, 1, 0.16],
      }),
    );
  }
  parts.push(part(new IcosahedronGeometry(0.32, 0), "#5d4037", { p: [top[0], top[1] - 0.15, top[2]] }));
  return merge(parts);
}

function lamp(): BufferGeometry {
  return merge([
    cyl("#455a64", 0.07, 5.6, [0, 2.8, 0]),
    box("#455a64", [0.08, 0.08, 1.3], [0, 5.55, 0.6]),
    box("#263238", [0.32, 0.14, 0.5], [0, 5.48, 1.2]),
    box("#fff59d", [0.26, 0.04, 0.42], [0, 5.4, 1.2]),
  ]);
}

function pole(): BufferGeometry {
  return merge([
    cyl("#6d5a4b", 0.11, 8.6, [0, 4.3, 0]),
    box("#4e3d31", [1.8, 0.1, 0.1], [0, 8.2, 0]),
    box("#eceff1", [0.08, 0.14, 0.08], [0.75, 8.33, 0]),
    box("#eceff1", [0.08, 0.14, 0.08], [-0.75, 8.33, 0]),
    box("#37474f", [0.45, 0.6, 0.35], [0, 6.4, 0.2]), // transformer box
  ]);
}

function generator(): BufferGeometry {
  return merge([
    box("#d32f2f", [0.8, 0.5, 0.55], [0, 0.35, 0]),
    box("#212121", [0.84, 0.12, 0.58], [0, 0.66, 0]),
    box("#212121", [0.1, 0.3, 0.1], [0.3, 0.85, 0.15]),
  ]);
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export interface Arena {
  group: Group;
  /** Static, vertex-coloured: one draw call. */
  solid: Mesh;
}

export function buildArena(atlas: Texture): Arena {
  const rng = new Rng(20261013);
  const solid: BufferGeometry[] = [];
  const painted: BufferGeometry[] = []; // textured: signs + road paint
  const wires: number[] = [];

  // Ground, road and pavement. Everything players stand on is flush (y≈0):
  // the referee has no notion of height, so nothing may look like a step.
  solid.push(part(new PlaneGeometry(420, 420), "#c49a6c", { p: [0, -0.02, -60], r: [-Math.PI / 2, 0, 0] }));
  const roadLen = STREET_NEAR - FIELD.finishZ + 2;
  const roadMid = (STREET_NEAR + FIELD.finishZ - 2) / 2;
  solid.push(box("#3b3f45", [ROAD_HALF * 2, 0.02, roadLen], [0, 0, roadMid]));
  for (const s of [-1, 1]) {
    solid.push(box("#cfc6b8", [FRONT_X - ROAD_HALF, 0.02, STREET_NEAR - STREET_FAR], [s * (ROAD_HALF + (FRONT_X - ROAD_HALF) / 2), 0.004, (STREET_NEAR + STREET_FAR) / 2]));
    // Black-and-yellow kerb paint, one metre at a time.
    for (let z = STREET_NEAR; z > FIELD.finishZ - 2; z -= 1) {
      solid.push(box(Math.round(z) % 2 ? "#111111" : "#ffd000", [0.28, 0.03, 1], [s * (ROAD_HALF + 0.14), 0.012, z - 0.5]));
    }
    // White edge line.
    solid.push(box("#e9e9e9", [0.14, 0.03, roadLen], [s * (ROAD_HALF - 0.35), 0.012, roadMid]));
  }
  // Centre line: yellow dashes.
  for (let z = STREET_NEAR; z > FIELD.finishZ; z -= 6) {
    solid.push(box("#f2c200", [0.16, 0.03, 3], [0, 0.014, z - 1.5]));
  }

  // Start line, and the finish line as a chequer.
  solid.push(box("#ffffff", [FIELD.halfWidth * 2, 0.035, 0.45], [0, 0.016, FIELD.startZ]));
  const sq = 0.46;
  const n = Math.ceil((FIELD.halfWidth * 2) / sq);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < n; i++) {
      const x = -FIELD.halfWidth + (i + 0.5) * sq;
      solid.push(box((i + row) % 2 ? "#111111" : "#fafafa", [sq, 0.035, sq], [x, 0.016, FIELD.finishZ - row * sq + sq / 2]));
    }
  }

  // The plaza past the finish: safe ground, warm tiles.
  solid.push(box("#e6d8bf", [FRONT_X * 2, 0.02, 26], [0, 0.006, FIELD.finishZ - 14]));
  for (let i = 0; i < 18; i++) {
    const z = FIELD.finishZ - 2 - i * 1.4;
    solid.push(box("#d8c7a8", [FRONT_X * 2, 0.025, 0.06], [0, 0.01, z]));
  }

  // Road paint (textured).
  const paint = (cell: number, w: number, h: number, p: V3) =>
    painted.push(atlasQuad(w, h, cellUv(cell), { p, r: [-Math.PI / 2, 0, 0] }));
  paint(CELL.start, 6.5, 1.6, [0, 0.02, 1.3]);
  paint(CELL.finish, 7, 1.75, [0, 0.02, FIELD.finishZ - 2.4]);
  paint(CELL.noShaking, 6, 1.5, [0, 0.02, FIELD.finishZ / 2]);
  paint(CELL.waka, 4.2, 1.05, [-4, 0.02, -20]);
  paint(CELL.waka, 4.2, 1.05, [4, 0.02, -58]);

  // Start gantry with the game's banner — high, so it never hides the doll.
  for (const s of [-1, 1]) solid.push(cyl("#263238", 0.14, 10, [s * 9.7, 5, 0.4], undefined, true));
  solid.push(box("#263238", [19.8, 0.25, 0.25], [0, 9.9, 0.4]));
  painted.push(atlasQuad(9, 2.25, cellUv(CELL.banner), { p: [0, 8.7, 0.42] }));
  painted.push(atlasQuad(9, 2.25, cellUv(CELL.banner), { p: [0, 8.7, 0.38], r: [0, Math.PI, 0] }));

  // ── Buildings ──
  const GAP_NEAR = -24;
  const GAP_FAR = -36;
  let signIdx = 0;
  for (const s of [-1, 1]) {
    let z = STREET_NEAR;
    while (z > STREET_FAR) {
      // A side street on each side, with a danfo waiting in it.
      if (z <= GAP_NEAR && z > GAP_FAR) {
        solid.push(moved(DANFO, { p: [s * (FRONT_X + 4.5), 0, (GAP_NEAR + GAP_FAR) / 2], r: [0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0] }));
        solid.push(box("#3b3f45", [12, 0.02, GAP_NEAR - GAP_FAR], [s * (FRONT_X + 5), 0.002, (GAP_NEAR + GAP_FAR) / 2]));
        z = GAP_FAR;
        continue;
      }
      let w = rng.range(5, 9);
      // Never let a building run across the side street's mouth.
      if (z > GAP_NEAR && z - w < GAP_NEAR) w = z - GAP_NEAR;
      if (w < 2.5) {
        z = GAP_NEAR;
        continue;
      }
      const d = rng.range(6, 9);
      const floors = rng.int(2, 5);
      const h = floors * 3 + 0.4;
      const cz = z - w / 2;
      const cx = s * (FRONT_X + d / 2);
      const facade = rng.pick(FACADES);
      solid.push(box(facade, [d, h, w], [cx, h / 2, cz]));
      solid.push(box(facade, [d + 0.12, 0.7, w + 0.06], [cx, 0.35, cz], undefined, 0.72)); // dirty base
      solid.push(box(facade, [d + 0.2, 0.25, w + 0.2], [cx, h + 0.12, cz], undefined, 0.85)); // parapet

      // Windows on the floors above the shop.
      const cols = Math.max(1, Math.floor((w - 1) / 1.7));
      for (let f = 1; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          const wz = cz - w / 2 + (w / cols) * (c + 0.5);
          const lit = rng.chance(0.12);
          solid.push(box(lit ? "#ffe9a8" : "#2b3a4a", [0.08, 1.15, 0.9], [s * (FRONT_X - 0.03), f * 3 + 1.45, wz]));
          if (rng.chance(0.18)) {
            solid.push(box("#eceff1", [0.5, 0.45, 0.8], [s * (FRONT_X - 0.25), f * 3 + 0.7, wz])); // AC unit
          }
        }
        if (f === 1 && rng.chance(0.4)) {
          solid.push(box("#bdbdbd", [1.0, 0.12, w * 0.6], [s * (FRONT_X - 0.5), 3.05, cz]));
          solid.push(box("#616161", [0.05, 0.7, w * 0.6], [s * (FRONT_X - 0.98), 3.45, cz]));
        }
      }

      // Ground-floor shop: dark opening, canopy, sign.
      solid.push(box("#3e2c22", [0.08, 2.3, w * 0.72], [s * (FRONT_X - 0.03), 1.2, cz]));
      solid.push(box(rng.pick(CANOPIES), [1.7, 0.1, w * 0.86], [s * (FRONT_X - 0.8), 2.75, cz], [0, 0, s * 0.22]));
      if (rng.chance(0.85)) {
        const cell = signIdx++ % SHOP_SIGN_COUNT;
        const sw = Math.min(w * 0.85, 5.2);
        painted.push(atlasQuad(sw, sw / 4, cellUv(cell), { p: [s * (FRONT_X - 0.06), 3.35 + sw / 8, cz], r: [0, -s * Math.PI / 2, 0] }));
      }
      if (rng.chance(0.25)) solid.push(moved(GENERATOR, { p: [s * (FRONT_X + 0.6), 0, cz - w * 0.3] }));

      // Rooftop: black water tanks.
      if (rng.chance(0.65)) {
        solid.push(cyl("#1d2124", 0.6, 1.2, [cx + rng.range(-1, 1), h + 0.85, cz + rng.range(-1, 1)], undefined, true));
      }
      z -= w + rng.range(0, 0.4);
    }
  }

  // ── Street furniture inside the pavement band (beyond reach of players) ──
  for (const s of [-1, 1]) {
    let k = 0;
    for (let z = STREET_NEAR - 4; z > FIELD.finishZ - 10; z -= 14, k++) {
      solid.push(moved(POLE, { p: [s * 10.4, 0, z], r: [0, 0, s * 0.03] }));
      // Two wires per side to the next pole, sagging. Lagos does not do taut.
      const z2 = z - 14;
      if (z2 > FIELD.finishZ - 12) {
        for (const off of [0.75, -0.75]) addWire(wires, [s * 10.4 + off, 8.35, z], [s * 10.4 + off, 8.35, z2], 0.7);
      }
      // Now and then a wire straight across the road to the other side.
      if (k % 2 === 0) addWire(wires, [s * 10.4, 8.3, z], [-s * 10.4, 7.6, z - 5], 1.6);
      // Lamps between poles.
      solid.push(moved(LAMP, { p: [s * 9.9, 0, z - 7], r: [0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0] }));
    }
  }

  // Behind the start: parked danfos and palms where the crowd came from.
  solid.push(moved(DANFO, { p: [-5, 0, 15], r: [0, 0.3, 0] }));
  solid.push(moved(DANFO, { p: [5.5, 0, 16.5], r: [0, -0.2, 0] }));

  // Plaza palms.
  const palms: V3[] = [[-9, 0, FIELD.finishZ - 7], [9, 0, FIELD.finishZ - 7], [-9.5, 0, FIELD.finishZ - 17], [9.5, 0, FIELD.finishZ - 17], [-8.5, 0, 12], [8.5, 0, 12]];
  for (const p of palms) solid.push(moved(palm(rng), { p }));

  // ── Mama Gele's stage ──
  solid.push(cyl("#b0a493", 3.4, 0.5, [0, 0.25, DOLL_Z], undefined, true));
  solid.push(cyl("#8d816f", 3.6, 0.12, [0, 0.06, DOLL_Z], undefined, true));
  // The iroko behind her.
  const treeZ = DOLL_Z - 6.5;
  solid.push(part(new CylinderGeometry(0.7, 1.1, 9, 7), "#5d4037", { p: [0, 4.5, treeZ] }));
  solid.push(part(new CylinderGeometry(0.25, 0.4, 3.5, 5), "#5d4037", { p: [1.6, 7.2, treeZ], r: [0, 0, -0.7] }));
  solid.push(part(new CylinderGeometry(0.25, 0.4, 3.5, 5), "#5d4037", { p: [-1.6, 7.4, treeZ], r: [0, 0, 0.7] }));
  const crowns: [V3, number, string][] = [
    [[0, 11, treeZ], 4.2, "#2e7d32"],
    [[3.2, 9.8, treeZ + 0.5], 2.9, "#388e3c"],
    [[-3.3, 10.1, treeZ - 0.4], 3.1, "#33691e"],
    [[0.8, 13, treeZ - 0.6], 2.6, "#43a047"],
    [[-1.5, 9, treeZ + 1.6], 2.2, "#2e7d32"],
  ];
  for (const [p, r, c] of crowns) solid.push(part(new DodecahedronGeometry(r, 0), c, { p, s: [1, 0.72, 1] }));

  // A back wall closing the plaza, as every Lagos compound wall is: POST NO BILL.
  const wallZ = DOLL_Z - 12;
  solid.push(box("#efe3cf", [FRONT_X * 2 + 4, 3.2, 0.35], [0, 1.6, wallZ]));
  solid.push(box("#c9b9a0", [FRONT_X * 2 + 4.2, 0.25, 0.45], [0, 3.25, wallZ]));
  painted.push(atlasQuad(5.6, 1.4, cellUv(CELL.postNoBill), { p: [-6, 1.7, wallZ + 0.19] }));
  painted.push(atlasQuad(5.6, 1.4, cellUv(CELL.postNoBill), { p: [6, 1.7, wallZ + 0.19] }));

  // ── The far skyline (Lagos Island, roughly), softened by fog. ──
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-70, 70);
    const z = rng.range(DOLL_Z - 30, DOLL_Z - 90);
    const w = rng.range(6, 16);
    const h = rng.range(14, 58);
    const col = rng.pick(["#9fb3c8", "#a9bccc", "#b8c6d3", "#93a8bd"]);
    solid.push(box(col, [w, h, w * rng.range(0.6, 1.2)], [x, h / 2, z]));
    if (h > 40) solid.push(box(col, [w * 0.5, 6, w * 0.5], [x, h + 3, z], undefined, 0.92));
  }
  // And low roofs to either side, so the horizon is never bare.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 14; i++) {
      const w = rng.range(6, 12);
      const h = rng.range(5, 13);
      solid.push(box(rng.pick(["#d9c3a5", "#c8b49a", "#e0cfb5"]), [w, h, w], [s * rng.range(24, 60), h / 2, rng.range(25, -120)]));
    }
  }

  // ── Assemble ──
  const group = new Group();
  const solidMesh = new Mesh(merge(solid), new MeshLambertMaterial({ vertexColors: true }));
  solidMesh.matrixAutoUpdate = false;
  group.add(solidMesh);

  const paintedMesh = new Mesh(
    merge(painted, true),
    new MeshLambertMaterial({ map: atlas, transparent: false, alphaTest: 0.5 }),
  );
  paintedMesh.matrixAutoUpdate = false;
  group.add(paintedMesh);

  const wireGeo = new BufferGeometry();
  wireGeo.setAttribute("position", new Float32BufferAttribute(wires, 3));
  const wireMesh = new LineSegments(wireGeo, new LineBasicMaterial({ color: 0x1b1b1b }));
  wireMesh.matrixAutoUpdate = false;
  group.add(wireMesh);

  // Soft contact shadow under the doll's stage (cheap, unlit).
  const stageShadow = new Mesh(new CircleGeometry(4.2, 20), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
  stageShadow.rotation.x = -Math.PI / 2;
  stageShadow.position.set(0, 0.01, DOLL_Z);
  group.add(stageShadow);

  return { group, solid: solidMesh };
}

// Built once, placed many times.
const DANFO = danfo();
const LAMP = lamp();
const POLE = pole();
const GENERATOR = generator();

function addWire(out: number[], a: V3, b: V3, sag: number): void {
  const steps = 8;
  let prev = a;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
    out.push(...prev, ...p);
    prev = p;
  }
}
