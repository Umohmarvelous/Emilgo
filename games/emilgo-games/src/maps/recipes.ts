// The 24 maps, as recipes for the kit. Every map is the same game — a run of
// 100, 200 or 300 m to Mama Gele's stage — dressed as a different place. The
// run itself is always flat and clear (the referee has no notion of height);
// everything a recipe builds stands outside the field's half width.
//
//   behind the start   z  +9 … +40       (where the crowd came from)
//   the run            z  +9 … FAR       (FAR = the line − 4: follows the course)
//   the plaza / stage  past the line     (Mama at the course's dollZ)
//   the closure        CLOSE = dollZ − 12 (what stands behind her)
//   backdrop           far beyond        (written for the 120 m street; the
//                                         kit moves it back with the course)
//
// Names are generic: no real brand, business or person appears anywhere.

import { DOLL_Z, FIELD, type Course } from "../config";
import type { Painter } from "../world/tex";
import { asphalt, cobble, concrete, dirt, grass, leaves, paving, rock, sand, snow, tile } from "../world/tex";
import { barrel, bones, cactus, grassPatch, pricklyPear, signpost, skull, tyre, wreck } from "./desert";
import type { Kit } from "./kit";

export interface Recipe {
  /** The run's surface, and everything else's. */
  track: { paint: Painter; name: string; tile: number; color: string };
  ground: { paint: Painter; name: string; tile: number; color: string };
  course: { edge: string; line: string; plaza: string; stage: string; markings: boolean };
  gantry: string;
  /** Height of the ground outside the run (dunes, hills, snowfields). */
  terrain?: (x: number, z: number) => number;
  water?: { kind: "sea" | "river" | "lava" | "pool"; x0: number; x1: number; z0: number; z1: number; y?: number }[];
  lampColor?: string;
  build(k: Kit, night: boolean): void;
}

const SIDES = [-1, 1] as const;
const NEAR = 30;
let FAR: number = FIELD.finishZ - 4;
let CLOSE: number = DOLL_Z - 12;

/** Lay the next recipe out for this course (call before `build`). */
export function useCourse(c: Course): void {
  FAR = c.finishZ - 4;
  CLOSE = c.dollZ - 12;
}
const T = (paint: Painter, name: string, tile: number, color = "#ffffff") => ({ paint, name, tile, color });
const course = (edge: string, line: string, plaza: string, stage: string, markings = true) => ({ edge, line, plaza, stage, markings });
/** Smooth noise for terrain (a few sines; cheap and good enough at this scale). */
const wave = (x: number, z: number) => Math.sin(x * 0.09 + z * 0.05) * 0.5 + Math.sin(x * 0.031 - z * 0.07) * 0.35 + Math.sin(x * 0.17 + z * 0.13) * 0.15;
/** 0 on the run, rising to 1 by |x| = 26 (terrain never touches the track). */
const away = (x: number) => Math.max(0, Math.min(1, (Math.abs(x) - 13) / 13));
/** The Desert Field: flat across the field (|x| < 20), dunes rising beyond. */
const desertGround = (x: number, z: number) => {
  const a = Math.max(0, Math.min(1, (Math.abs(x) - 20) / 34));
  return a * a * (2.5 + wave(x * 0.8, z * 0.8) * 3.5 + Math.abs(Math.sin(x * 0.04 + z * 0.01)) * 4);
};

/** Lamps both sides every `step` metres. */
function lamps(k: Kit, x: number, step: number, style: "modern" | "classic" | "caged" | "lantern" = "modern", y?: number): void {
  for (const s of SIDES) for (let z = NEAR - 6; z > FAR; z -= step) k.lamp([s * x, y ?? 0, z], s as 1 | -1, style);
}

export const RECIPES: Record<string, Recipe> = {
  // ── Nigerian urban ──────────────────────────────────────────────────────

  "market-square": {
    track: T(paving, "paving", 6, "#e8dccb"),
    ground: T(dirt, "dirt", 8, "#c99a6a"),
    course: course("#ffd000", "#ffffff", "#d8c7a8", "#b0a493"),
    gantry: "#263238",
    build(k, night) {
      const r = k.rng;
      const covers = ["#d7263d", "#1b6ec2", "#f2a71b", "#2b9348", "#7b2cbf", "#e85d04"];
      const goods = ["#d62828", "#f77f00", "#fcbf49", "#2b9348", "#7f5539", "#e9c46a", "#bc4749"];
      for (const s of SIDES) {
        for (let z = NEAR - 4; z > FAR; z -= 4.2) {
          k.stall([s * r.range(11.5, 13), 0, z], s > 0 ? -Math.PI / 2 : Math.PI / 2, r.pick(covers), goods);
          if (r.chance(0.35)) k.stall([s * r.range(16, 18), 0, z - 1.5], r.range(0, 6), r.pick(covers), goods);
          if (r.chance(0.2)) k.box("#c9b48a", [0.6, 0.5, 0.45], [s * 10.6, 0.25, z - 2], "detail");
        }
        // Zinc-roofed sheds behind the stalls.
        k.row(NEAR, FAR, (z, w) => {
          k.building({ s, front: 21, z, w, d: 7, floors: 1, floorH: 3.4, color: "#d9c9a8", tex: "plaster", roof: "zinc", windows: null, shop: { canopy: r.pick(covers) } });
        }, 6, 10, [0.5, 2]);
        for (let z = NEAR - 10; z > FAR; z -= 24) k.palm([s * 15, 0, z], r.range(6, 8));
      }
      lamps(k, 10.2, 18, "modern");
      // The plaza: a two-storey shopping block behind Mama.
      k.building({ s: 1, front: -14, z: CLOSE + 1, w: 2, d: 28, floors: 2, color: "#e8d9b8", tex: "plaster", roof: "flat", windows: { color: "#2b3a4a", lit: "#ffe9a8", litChance: night ? 0.6 : 0.05 } });
      k.solid("#e8d9b8", [30, 6.5, 6], [0, 3.25, CLOSE - 2]);
      for (let i = -3; i <= 3; i++) k.glow(night ? "#ffe9a8" : "#2b3a4a", [2, 1.2, 0.1], [i * 4, 4.5, CLOSE + 1.05]);
      k.skyline(["#c8b49a", "#d9c3a5", "#b8a68e"], -170, -230, 22, 8, 26, 90, night ? "#ffd98a" : null);
    },
  },

  "university-campus": {
    track: T(paving, "paving", 5, "#d9d4c8"),
    ground: T(grass, "grass", 6, "#ffffff"),
    course: course("#ffffff", "#ffffff", "#cfc8b8", "#bdb3a2"),
    gantry: "#1f3b57",
    build(k, night) {
      const r = k.rng;
      for (const s of SIDES) {
        // Faculty blocks set back across the lawn, with column porticoes.
        k.row(NEAR, FAR - 6, (z, w) => {
          k.building({ s, front: 24, z, w, d: 12, floors: r.int(3, 4), floorH: 3.4, color: "#e9e4d6", tex: "concrete", texTile: 6, roof: "flat", trim: "#0e5a8a", windows: { color: "#26394d", lit: "#fff3c4", litChance: night ? 0.5 : 0.03, frame: "#0e5a8a", tall: true } });
          for (let c = 0; c < 4; c++) k.cyl("#f4f1ea", 0.28, 6.5, [s * 23.2, 3.25, z - w * 0.2 - c * (w * 0.2)], "main", { sides: 10 });
        }, 18, 26, [4, 8]);
        for (let z = NEAR - 4; z > FAR; z -= 10) k.tree([s * 13, 0, z], r.range(7, 9), ["#3b7a2a", "#4a8a33", "#2f6b26"]);
        for (let z = NEAR - 9; z > FAR; z -= 20) {
          k.box("#6d4c33", [0.5, 0.45, 1.8], [s * 11.2, 0.45, z], "detail");
          k.box("#3a3a3a", [0.5, 0.06, 1.8], [s * 11.2, 0.22, z], "detail");
        }
      }
      k.danfo([-16, 0, -40], 0.1);
      lamps(k, 10.4, 20, "classic");
      // Senate building with a clock tower.
      k.solid("#efe9db", [34, 9, 8], [0, 4.5, CLOSE - 3]);
      k.solid("#efe9db", [6, 26, 6], [0, 13, CLOSE - 2]);
      k.glow(night ? "#fff2c0" : "#f8f8f8", [3, 3, 0.1], [0, 21, CLOSE + 1.06]);
      k.box("#1f3b57", [0.15, 1.2, 0.08], [0, 21.3, CLOSE + 1.15], "main");
      k.cone("#9c4a32", 4.4, 4, [0, 28, CLOSE - 2], "main", undefined, 6);
      for (const x of [-6, 6]) {
        k.cyl("#c0c0c0", 0.06, 9, [x, 4.5, CLOSE + 4], "main");
        k.box(x < 0 ? "#008751" : "#0e5a8a", [0.04, 1.2, 1.8], [x, 8.3, CLOSE + 4.9], "main");
      }
      k.skyline(["#9fb3c8", "#a9bccc"], -180, -240, 12, 10, 30, 90);
    },
  },

  "beach-road": {
    track: T(sand, "sand", 6, "#efd9a8"),
    ground: T(sand, "sand", 8, "#ffffff"),
    course: course("#ffffff", "#ffffff", "#e7d3a8", "#c9b48a", false),
    gantry: "#24323a",
    water: [{ kind: "sea", x0: -400, x1: -26, z0: 120, z1: -400 }],
    terrain: (x) => (x < 0 ? -away(x) * 1.2 : away(x) * 0.6),
    build(k, night) {
      const r = k.rng;
      const brollies = ["#e63946", "#ffb703", "#219ebc", "#2b9348", "#f1faee"];
      // Sea side: umbrellas, loungers, palms.
      for (let z = NEAR - 2; z > FAR; z -= 7) {
        const x = -r.range(12, 20);
        k.cyl("#f2f2f2", 0.04, 2.3, [x, 1.15, z], "main");
        k.cone(r.pick(brollies), 1.5, 0.6, [x, 2.4, z], "main");
        k.box("#f4f1ea", [0.7, 0.12, 1.9], [x + 1.2, 0.3, z + 0.4], "detail", [0.15, 0, 0]);
        if (r.chance(0.6)) k.palm([-r.range(22, 26), 0, z - 3], r.range(7, 9.5));
      }
      // Land side: beach bars on stilts, parked cars, low buildings.
      k.row(NEAR, FAR, (z, w) => {
        if (r.chance(0.3)) {
          k.car([r.range(13, 15), 0, z - w / 2], r.range(-0.3, 0.3), r.pick(["#c62828", "#1565c0", "#f5f5f5", "#2e7d32"]));
          return;
        }
        k.building({ s: 1, front: 18, z, w, d: 7, floors: r.int(1, 2), color: r.pick(["#f6c9a8", "#cfe3f2", "#fafafa", "#efe6a5"]), tex: "plaster", roof: r.chance(0.5) ? "zinc" : "flat", windows: { color: "#2b3a4a", lit: "#ffe9a8", litChance: night ? 0.55 : 0.05, shutter: "#2a9d8f" }, shop: { canopy: r.pick(brollies) } });
      }, 6, 10, [1, 4]);
      for (let z = NEAR - 8; z > FAR; z -= 16) k.palm([12, 0, z], r.range(7, 8.5));
      // Lifeguard tower behind Mama, then the sea.
      for (const x of [-1.2, 1.2]) for (const z of [-1.2, 1.2]) k.cyl("#e9e4dc", 0.1, 4, [x + 6, 2, CLOSE + z], "main");
      k.solid("#e63946", [3, 2, 3], [6, 5, CLOSE]);
      k.cone("#f1faee", 2.4, 1, [6, 6.5, CLOSE], "main", undefined, 6);
      k.fence(0, CLOSE + 6, CLOSE - 1, "rope");
    },
  },

  "estate-close": {
    track: T(paving, "paving", 5, "#cfc6b8"),
    ground: T(grass, "grass", 6, "#d8e8c8"),
    course: course("#ffffff", "#ffffff", "#d9cdb8", "#b0a493"),
    gantry: "#2a2a33",
    build(k, night) {
      const r = k.rng;
      for (const s of SIDES) {
        k.fence(s * 11, NEAR, FAR, "wall", "#e8dfcf");
        k.row(NEAR, FAR, (z, w) => {
          const cz = z - w / 2;
          // Duplex: two volumes, balcony, a car in the drive.
          k.building({ s, front: 16, z, w, d: 10, floors: 2, floorH: 3.3, color: r.pick(["#f4ede0", "#e8dcc8", "#f1e4d0", "#dfe7ea"]), tex: "plaster", roof: "tiles", roofColor: r.pick(["#7a3b2a", "#3b3b42", "#5a4a3a"]), windows: { color: "#26323d", lit: "#ffe7b0", litChance: night ? 0.6 : 0.04, frame: "#f8f8f8" }, balcony: "#cfcfcf", ac: true });
          k.car([s * 13.6, 0, cz + r.range(-1.5, 1.5)], s > 0 ? -Math.PI / 2 : Math.PI / 2, r.pick(["#1d1d1d", "#f2f2f2", "#5a5f66", "#7a1c1c"]), r.chance(0.5) ? "suv" : "sedan");
          // Gate in the wall.
          k.box("#1c1c1f", [0.12, 2.4, 3.2], [s * 11, 1.2, cz], "main");
          if (r.chance(0.6)) k.blob(r.pick(["#d63384", "#c2185b", "#e85d9e"]), [1, 0.9, 1.4], [s * 10.6, 1.9, cz + 2.4]);
        }, 13, 16, [1.5, 3]);
        for (let z = NEAR - 8; z > FAR; z -= 22) k.palm([s * 10.2, 0, z], r.range(6.5, 7.5));
      }
      lamps(k, 10.4, 16, "modern");
      // The estate's back gate and guard house.
      k.fence(-8, CLOSE + 1, CLOSE - 1, "wall", "#e8dfcf");
      k.solid("#e8dfcf", [16, 3, 0.4], [-9, 1.5, CLOSE]);
      k.solid("#e8dfcf", [16, 3, 0.4], [9, 1.5, CLOSE]);
      k.box("#1c1c1f", [4.6, 2.8, 0.15], [0, 1.4, CLOSE], "main");
      k.solid("#f4ede0", [3, 2.8, 3], [7, 1.4, CLOSE + 3]);
      k.glow(night ? "#ffe7b0" : "#2b3a4a", [0.1, 1, 1.6], [5.45, 1.6, CLOSE + 3]);
      k.skyline(["#c8b49a", "#d9c3a5"], -170, -220, 14, 6, 14, 90, night ? "#ffd98a" : null);
    },
  },

  "motor-park": {
    track: T(asphalt, "asphalt", 6, "#c8c4bc"),
    ground: T(dirt, "dirt", 8, "#d4a678"),
    course: course("#ffd000", "#ffffff", "#c9b9a0", "#a8987e"),
    gantry: "#263238",
    build(k, night) {
      const r = k.rng;
      for (const s of SIDES) {
        // Long zinc sheds full of danfos.
        for (let z = NEAR - 2; z > FAR; z -= 20) {
          const cz = z - 9;
          k.box("#8a6a52", [9, 0.12, 18], [s * 17, 3.3, cz], "mass", [0, 0, s * 0.08]);
          for (let pz = z; pz > z - 18; pz -= 6) for (const px of [12.8, 21.2]) k.cyl("#5a5248", 0.08, 3.3, [s * px, 1.65, pz], "main", { sides: 6 });
          for (let d = 0; d < 3; d++) k.danfo([s * r.range(14.5, 19), 0, z - 3 - d * 5.5], s > 0 ? -Math.PI / 2 + r.range(-0.2, 0.2) : Math.PI / 2 + r.range(-0.2, 0.2));
          // Ticket kiosk and a stack of tyres at the front of each shed.
          k.box("#c62828", [1.6, 2.2, 1.4], [s * 11.6, 1.1, z - 1], "main");
          k.glow(night ? "#ffe2a6" : "#2b3a4a", [0.08, 0.6, 1], [s * 10.78, 1.5, z - 1]);
          for (let t = 0; t < 4; t++) k.cyl("#1c1c1c", 0.4, 0.24, [s * 11, 0.12 + t * 0.24, z - 4], "detail");
          k.cyl(r.pick(["#1b6ec2", "#d7263d", "#2b9348"]), 0.03, 2.2, [s * 11.2, 1.1, z - 7], "main");
          k.cone(r.pick(["#1b6ec2", "#d7263d", "#ffd000"]), 1.3, 0.5, [s * 11.2, 2.3, z - 7], "main");
        }
      }
      lamps(k, 10.3, 20, "modern");
      // Terminal building: a long block, its name board, buses waiting.
      k.solid("#e0cfb5", [32, 6, 8], [0, 3, CLOSE - 2]);
      k.box("#16203c", [14, 1.6, 0.2], [0, 6.6, CLOSE + 2.1], "main");
      k.box("#ffd000", [13.2, 1.2, 0.22], [0, 6.6, CLOSE + 2.12], "main");
      for (let i = -3; i <= 3; i++) k.box(night ? "#ffe2a6" : "#3e2c22", [2.6, 2.4, 0.1], [i * 4.4, 1.3, CLOSE + 2.05], night ? "glow" : "main");
      k.skyline(["#c8b49a", "#d9c3a5", "#b8a68e"], -170, -230, 20, 6, 22, 100);
    },
  },

  // ── Nigerian rural ──────────────────────────────────────────────────────

  "village-square": {
    track: T(dirt, "dirt", 6, "#e0b48a"),
    ground: T(dirt, "dirt", 8, "#c78f5e"),
    course: course("#ffffff", "#f2f2f2", "#c99a6a", "#a8825a", false),
    gantry: "#5a4028",
    terrain: (x, z) => away(x) * (1.5 + wave(x, z) * 1.2),
    build(k) {
      const r = k.rng;
      for (const s of SIDES) {
        for (let z = NEAR - 4; z > FAR; z -= r.range(9, 13)) {
          // A compound: two or three huts round a yard, a low fence.
          const cx = s * r.range(15, 19);
          k.hut([cx, 0, z], r.range(1.8, 2.4));
          if (r.chance(0.7)) k.hut([cx + s * 4.2, 0, z - 3.5], r.range(1.6, 2.1));
          k.fence(s * 11.2, z + 2, z - 5, "wood");
          // Mortar and pestle, a drying rack, a clay pot.
          k.cyl("#6b4a2e", 0.35, 0.7, [cx - s * 3, 0.35, z + 1.5], "detail");
          k.cyl("#5a3d26", 0.06, 1.6, [cx - s * 3, 1, z + 1.5], "detail", { r: [0.2, 0, 0.1] });
          k.box("#8a6a3a", [0.08, 1.4, 2.6], [cx - s * 3.6, 0.7, z - 2], "detail");
          k.ball("#9c5a32", 0.35, [cx + s * 1.8, 0.3, z + 2.2], "detail");
        }
        for (let z = NEAR - 12; z > FAR; z -= 28) k.palm([s * r.range(12, 14), 0, z], r.range(6, 8));
      }
      k.baobab([-14, 0, -60], 1.1);
      k.baobab([16, 0, -95], 0.95);
      // The chief's compound wall and the great baobab behind Mama.
      k.solid("#a5714a", [32, 2.6, 0.6], [0, 1.3, CLOSE]);
      k.box("#3b2416", [3.2, 2.4, 0.1], [0, 1.2, CLOSE + 0.35], "main");
      k.baobab([0, 0, CLOSE - 9], 1.5);
      for (let i = 0; i < 9; i++) k.farBox("#8a7a4e", [r.range(12, 26), r.range(2, 5), 6], [r.range(-90, 90), 1, r.range(-170, -220)]);
    },
  },

  farmland: {
    track: T(dirt, "dirt", 6, "#d9a879"),
    ground: T(dirt, "dirt", 7, "#b07a4a"),
    course: course("#ffffff", "#f2f2f2", "#c99a6a", "#a8825a", false),
    gantry: "#5a4028",
    terrain: (x, z) => away(x) * (0.6 + wave(x * 0.6, z * 0.6) * 0.8),
    build(k) {
      const r = k.rng;
      for (const s of SIDES) {
        // Fields all the way to the line, whatever the distance.
        for (let block = 0; NEAR - block * 38 - 32 > FAR - 30; block++) {
          const z0 = NEAR - block * 38;
          const z1 = z0 - 32;
          const maize = (block + (s > 0 ? 1 : 0)) % 2 === 0;
          for (let row = 0; row < 6; row++) {
            const x = s * (12 + row * 2.4);
            if (maize) {
              for (let z = z0; z > z1; z -= 1.8) {
                const h = r.range(1.6, 2.3);
                k.cyl("#7a8f3a", 0.04, h, [x + r.range(-0.2, 0.2), h / 2, z], "main", { sides: 6 });
                k.cone(r.pick(["#5f8f2a", "#6fa034", "#4f7f24"]), 0.45, h * 0.7, [x, h * 0.75, z], "foliage", undefined, 6);
              }
            } else {
              k.box("#7a4a2a", [1.1, 0.45, z0 - z1], [x, 0.22, (z0 + z1) / 2], "main");
              for (let z = z0 - 1; z > z1; z -= 2.2) k.cone("#4f7f24", 0.35, 0.8, [x, 0.8, z], "foliage", undefined, 6);
            }
          }
        }
      }
      // A scarecrow, a farm hut, a baobab in the field.
      k.cyl("#6b4a2e", 0.06, 2.4, [14, 1.2, -48], "main");
      k.box("#6b4a2e", [0.06, 0.06, 1.6], [14, 2, -48], "main");
      k.box("#c62828", [0.4, 0.7, 0.9], [14, 1.8, -48], "main");
      k.ball("#d8c9a8", 0.22, [14, 2.55, -48], "main");
      k.cone("#a88a4c", 0.4, 0.3, [14, 2.8, -48], "main");
      k.hut([-24, 0, -80], 2.4);
      k.baobab([24, 0, -100], 1);
      k.hut([0, 0, CLOSE - 4], 3);
      k.fence(-12, CLOSE + 4, CLOSE - 8, "wood");
      k.fence(12, CLOSE + 4, CLOSE - 8, "wood");
      k.mountains("#7f8f6a", null, -230, 10, 300, 18, 40);
    },
  },

  riverside: {
    track: T(dirt, "dirt", 6, "#b89070"),
    ground: T(grass, "grass", 6, "#b8c8a0"),
    course: course("#ffffff", "#f2f2f2", "#a88866", "#8a7058", false),
    gantry: "#4a3a28",
    water: [{ kind: "river", x0: -60, x1: -18, z0: 120, z1: -400, y: -0.5 }],
    terrain: (x, z) => (x < 0 ? -away(x) * 0.6 : away(x) * (1 + wave(x, z))),
    build(k, night) {
      const r = k.rng;
      // River bank: canoes pulled up, net poles, mangrove roots.
      for (let z = NEAR - 4; z > FAR; z -= r.range(8, 12)) {
        k.box("#5a3a22", [0.9, 0.4, 5], [-r.range(13, 16), 0.2, z], "main", [0, r.range(-0.3, 0.3), 0]);
        k.box("#3a2414", [0.7, 0.1, 4.6], [-14.5, 0.42, z], "detail");
        for (let p = 0; p < 3; p++) k.cyl("#6b5a45", 0.05, 2.4, [-r.range(19, 24), 1.2, z - p * 1.4], "main");
        k.bush([-r.range(11.5, 13), 0, z - 4], 0.9, "#2f5a2a");
      }
      // Stilt houses on the dry side.
      k.row(NEAR, FAR, (z, w) => {
        const cz = z - w / 2;
        for (const dx of [-2, 2]) for (const dz of [-w / 2 + 0.6, w / 2 - 0.6]) k.cyl("#5a4a38", 0.12, 1.6, [16 + dx, 0.8, cz + dz], "main", { sides: 6 });
        k.texBox("wood", "#c8a878", [5, 2.8, w - 0.8], [16, 3, cz], 3);
        k.cone("#8a6a52", Math.max(3.5, w * 0.55), 1.6, [16, 5.2, cz], "mass", undefined, 6);
        k.glow(night ? "#ffcf80" : "#2b2214", [0.08, 0.9, 0.9], [13.45, 3, cz]);
      }, 7, 9, [3, 6]);
      // A jetty behind Mama, out over the water.
      k.box("#7a5a3a", [24, 0.3, 4], [-6, 0.4, CLOSE], "main");
      for (let x = -16; x <= 4; x += 4) k.cyl("#4a3a28", 0.15, 2, [x, -0.4, CLOSE + 1.8], "main");
      k.tree([8, 0, CLOSE - 2], 10, ["#2f6b26", "#3b7a2a"]);
      k.mountains("#5f7a5a", null, -240, 10, 320, 14, 32);
    },
  },

  "forest-path": {
    track: T(leaves, "leaves", 5, "#e0d0b8"),
    ground: T(leaves, "leaves", 6, "#ffffff"),
    course: course("#ffffff", "#f2f2f2", "#6b5a40", "#5a4a38", false),
    gantry: "#3b2e20",
    terrain: (x, z) => away(x) * (1 + wave(x, z) * 1.5),
    build(k) {
      const r = k.rng;
      for (const s of SIDES) {
        for (let z = NEAR; z > FAR - 6; z -= r.range(3.5, 6)) {
          const x = s * r.range(11, 24);
          const pick = r.next();
          if (pick < 0.55) k.tree([x, 0, z], r.range(12, 18), ["#1f4f1f", "#2a5f24", "#245a20", "#356b2a"], "#4a3a2a");
          else if (pick < 0.75) k.palm([x, 0, z], r.range(8, 11));
          else k.bigLeaves([x, 0, z], r.range(1, 1.6));
          if (r.chance(0.5)) k.bush([s * r.range(10.5, 12), 0, z - 1.5], r.range(0.8, 1.3), r.pick(["#2a5a24", "#3a6b2a"]));
          if (r.chance(0.12)) k.box("#4a3a2a", [0.6, 0.6, 5], [s * r.range(12, 16), 0.3, z], "main", [0, r.range(-0.6, 0.6), Math.PI / 2 * 0]);
        }
      }
      // The great iroko behind Mama.
      k.cyl("#4a3a2a", 1.6, 16, [0, 8, CLOSE - 4], "mass", { sides: 10, top: 0.6 });
      for (let i = 0; i < 6; i++) k.blob(r.pick(["#1f4f1f", "#2a5f24"]), [6, 4, 6], [r.range(-6, 6), r.range(15, 21), CLOSE - 4 + r.range(-4, 4)]);
      for (let i = 0; i < 40; i++) k.farCone(r.pick(["#1f3f1f", "#24461f", "#1a361a"]), r.range(5, 9), r.range(16, 28), [r.range(-120, 120), 8, r.range(-160, -260)], 6);
    },
  },

  // ── International urban ─────────────────────────────────────────────────

  "new-york": {
    track: T(asphalt, "asphalt", 6, "#a8a8a8"),
    ground: T(concrete, "concrete", 5, "#c8c4bc"),
    course: course("#ffffff", "#ffffff", "#b0aca4", "#8a8680"),
    gantry: "#1c1c1f",
    lampColor: "#ffd28a",
    build(k, night) {
      const r = k.rng;
      for (const s of SIDES) {
        k.row(NEAR, FAR, (z, w) => {
          k.building({ s, front: 12.5, z, w, d: 10, floors: r.int(4, 7), floorH: 3.2, color: r.pick(["#9a5a42", "#8a4a38", "#a8664a", "#7a4434"]), tex: "brick", texTile: 3, roof: "flat", trim: "#d8d0c4", windows: { color: "#1c2630", lit: "#e8b860", litChance: night ? 0.3 : 0.06, frame: "#e8e2d6", tall: true }, fireEscape: r.chance(0.7), shop: r.chance(0.5) ? { canopy: r.pick(["#14532d", "#7f1d1d", "#1e3a8a", "#1c1c1f"]) } : null, ac: true });
        }, 7, 11, [0, 0.2]);
        for (let z = NEAR - 6; z > FAR; z -= r.range(10, 18)) if (r.chance(0.7)) k.car([s * 10.6, 0, z], r.chance(0.5) ? 0 : Math.PI, "#f5c400", "cab");
        for (let z = NEAR - 12; z > FAR; z -= 30) k.cyl("#b71c1c", 0.18, 0.75, [s * 10.2, 0.37, z], "detail");
        for (let z = NEAR - 20; z > FAR; z -= 40) k.tree([s * 10.3, 0, z], 6, ["#3b6b2a", "#4a7a33"]);
      }
      lamps(k, 10.2, 18, "modern");
      k.building({ s: 1, front: -16, z: CLOSE + 2, w: 6, d: 32, floors: 12, floorH: 3.2, color: "#8a4a38", tex: "brick", texTile: 3, windows: null });
      k.skyline(["#5a6070", "#6a7080", "#4a5060", "#7a8090"], -170, -260, 40, 40, 140, 120, night ? "#ffd98a" : "#9fb3c8");
    },
  },

  "tokyo-alley": {
    track: T(asphalt, "asphalt", 6, "#8a8a92"),
    ground: T(asphalt, "asphalt", 6, "#7a7a80"),
    course: course("#ffffff", "#ffffff", "#6a6a72", "#5a5a62"),
    gantry: "#1c1c22",
    lampColor: "#ff9a6a",
    build(k, night) {
      const r = k.rng;
      const neon = ["#ff4d8d", "#3ad6ff", "#ffd23a", "#7cff6a", "#b26bff", "#ff6a3a"];
      for (const s of SIDES) {
        k.row(NEAR, FAR, (z, w) => {
          const floors = r.int(3, 6);
          const cz = z - w / 2;
          k.building({ s, front: 11, z, w, d: 8, floors, floorH: 3, color: r.pick(["#d8d2c8", "#b8b4ac", "#cfc8bc", "#a8a49c", "#e0d8cc"]), tex: "concrete", texTile: 4, roof: "flat", windows: { color: "#2a2e38", lit: "#fff0d0", litChance: night ? 0.5 : 0.1 }, shop: { canopy: r.pick(["#7f1d1d", "#1c1c1f", "#3a3a40"]), open: "#ffe8c0" }, ac: true });
          // Vertical neon sign boards, a vending machine, lanterns.
          k.glow(r.pick(neon), [0.6, Math.min(floors * 2.4, 8), 0.12], [s * 10.6, 4 + Math.min(floors * 1.2, 4), cz + r.range(-w / 3, w / 3)]);
          if (r.chance(0.4)) k.glow(r.pick(["#e8f4ff", "#ffe8e8"]), [0.8, 1.8, 1], [s * 10.6, 0.9, cz - w / 2 + 0.8]);
          if (r.chance(0.6)) for (let i = 0; i < 3; i++) k.lamp([s * 10.7, 2.9, cz - 1 + i], s as 1 | -1, "lantern");
        }, 4, 7, [0, 0.1]);
      }
      // Wires and lantern strings across the lane.
      for (let z = NEAR - 10; z > FAR; z -= 12) for (let x = -9; x <= 9; x += 1.5) k.lamp([x, 6.2 + Math.cos(x * 0.18) * 0.4, z], 1, "lantern");
      k.building({ s: 1, front: -12, z: CLOSE + 2, w: 5, d: 24, floors: 8, floorH: 3, color: "#c8c0b4", tex: "concrete", windows: { color: "#2a2e38", lit: "#fff0d0", litChance: 0.4 } });
      k.glow("#ff4d8d", [12, 1.4, 0.2], [0, 8, CLOSE + 2.2]);
      k.skyline(["#3a3a48", "#4a4a58", "#2e2e3a"], -170, -260, 46, 30, 110, 120, "#ff9ad0");
    },
  },

  "london-square": {
    track: T(cobble, "cobble", 4, "#bcb8b2"),
    ground: T(cobble, "cobble", 4, "#a8a49e"),
    course: course("#f2f2f2", "#ffffff", "#9a968e", "#7a766e"),
    gantry: "#1c1c1f",
    lampColor: "#ffe2a6",
    build(k, night) {
      const r = k.rng;
      for (const s of SIDES) {
        k.row(NEAR, FAR, (z, w) => {
          k.building({ s, front: 14, z, w, d: 9, floors: r.int(3, 4), floorH: 3.3, color: r.pick(["#9a5240", "#8a4a3a", "#a86a50"]), tex: "brick", texTile: 3, roof: "pitched", roofColor: "#3e4248", trim: "#f2efe8", windows: { color: "#1c2630", lit: "#ffe2a6", litChance: night ? 0.5 : 0.06, frame: "#f2efe8", tall: true }, shop: r.chance(0.35) ? { canopy: r.pick(["#1c3a2a", "#2a1c3a", "#3a1c1c"]) } : null });
        }, 6, 8, [0, 0.1]);
        k.fence(s * 11.5, NEAR, FAR, "iron");
        for (let z = NEAR - 8; z > FAR; z -= 16) k.tree([s * 12.5, 0, z], 10, ["#4a6a2a", "#5a7a33", "#3e5f24"], "#6b5a4a");
      }
      k.bus([-12.5, 0, -30], 0.05);
      k.box("#c4161c", [1, 2.5, 1], [10.8, 1.25, -64], "main");
      k.glow(night ? "#fff2c0" : "#bcd0e0", [1.02, 1.6, 0.8], [10.8, 1.4, -64]);
      lamps(k, 11, 16, "classic");
      // The clock tower.
      k.solid("#d8c9a0", [8, 38, 8], [0, 19, CLOSE - 6]);
      for (const zz of [CLOSE - 1.95]) {
        k.glow(night ? "#fff6d0" : "#f4f1ea", [4.4, 4.4, 0.1], [0, 30, zz]);
        k.box("#1c1c1f", [0.18, 1.8, 0.08], [0, 30.5, zz + 0.08], "main");
      }
      k.cone("#3e4a3a", 6, 9, [0, 42.5, CLOSE - 6], "main", undefined, 6);
      k.solid("#d8c9a0", [36, 10, 6], [0, 5, CLOSE - 2]);
      k.skyline(["#7a7e86", "#8a8e96", "#6a6e76"], -180, -260, 24, 14, 50, 110, night ? "#ffe2a6" : null);
    },
  },

  "dubai-mall": {
    track: T(tile, "tile", 3, "#ffffff"),
    ground: T(tile, "tile", 3, "#e8e2d6"),
    course: course("#c9a227", "#c9a227", "#e8e2d6", "#d8d0c0"),
    gantry: "#c9c2b0",
    water: [{ kind: "pool", x0: -16, x1: -12, z0: -20, z1: -50, y: 0.05 }, { kind: "pool", x0: 12, x1: 16, z0: -60, z1: -90, y: 0.05 }],
    build(k, night) {
      const r = k.rng;
      for (const s of SIDES) {
        k.row(NEAR, FAR, (z, w) => {
          const h = r.range(30, 90);
          const cz = z - w / 2;
          k.texBox("glass", r.pick(["#ffffff", "#e8f4ff", "#fff4e0"]), [14, h, w], [s * 25, h / 2, cz], 6);
          k.colliders.push({ x: s * 25, z: cz, hx: 7, hz: w / 2, h });
          k.box("#e8e2d6", [15, 1.2, w + 0.5], [s * 25, h + 0.6, cz], "main");
          // Arcade: columns and a shaded walkway in front.
          for (let c = z - 1; c > z - w; c -= 4) k.cyl("#f4f1ea", 0.3, 6, [s * 17.5, 3, c], "main", { sides: 16 });
          k.box("#f4f1ea", [3.6, 0.4, w], [s * 17.5, 6.2, cz], "main");
          k.glow(night ? "#fff0c8" : "#d8e8f4", [0.1, 4, w * 0.8], [s * 18.05, 2.2, cz]);
        }, 18, 28, [3, 6]);
        for (let z = NEAR - 6; z > FAR; z -= 12) {
          k.cyl("#d8d0c0", 0.9, 0.7, [s * 11.5, 0.35, z], "main", { sides: 16 });
          k.palm([s * 11.5, 0.6, z], r.range(6, 8));
        }
      }
      // The needle tower, far behind Mama.
      k.farBox("#bcd0e0", [14, 180, 14], [0, 90, -240]);
      k.farBox("#d8e8f4", [9, 120, 9], [0, 240, -240]);
      k.farCone("#e8f4ff", 4, 60, [0, 330, -240], 6);
      k.solid("#e8e2d6", [36, 8, 6], [0, 4, CLOSE - 2]);
      k.glow(night ? "#fff0c8" : "#cfe4f4", [30, 5, 0.1], [0, 3.5, CLOSE + 1.05]);
      k.skyline(["#a8bccc", "#bcd0e0", "#94aabc"], -190, -280, 30, 60, 160, 160, night ? "#fff0c8" : null);
    },
  },

  "paris-cafe": {
    track: T(cobble, "cobble", 4, "#d8d0c4"),
    ground: T(cobble, "cobble", 4, "#c8c0b4"),
    course: course("#ffffff", "#ffffff", "#c8bca8", "#a8a090"),
    gantry: "#2a2a2e",
    lampColor: "#ffd890",
    build(k, night) {
      const r = k.rng;
      for (const s of SIDES) {
        k.row(NEAR, FAR, (z, w) => {
          k.building({ s, front: 15, z, w, d: 10, floors: 5, floorH: 3.2, color: "#efe6d2", tex: "plaster", texTile: 5, roof: "pitched", roofColor: "#5a6370", trim: "#f6f0e2", windows: { color: "#2a3038", lit: "#ffd890", litChance: night ? 0.5 : 0.05, frame: "#f6f0e2", tall: true }, balcony: "#1c1c1f", shop: { canopy: r.pick(["#7a1c2b", "#1c3a5a", "#2a4a2a"]) } });
        }, 10, 14, [0, 0.1]);
        // Café terraces: round tables, little chairs, parasols.
        for (let z = NEAR - 4; z > FAR; z -= 6) {
          const x = s * r.range(11.5, 13);
          k.cyl("#2a2a2a", 0.4, 0.04, [x, 0.75, z], "detail", { sides: 10 });
          k.cyl("#2a2a2a", 0.03, 0.75, [x, 0.37, z], "detail");
          for (const dz of [-0.6, 0.6]) k.box("#8a5a32", [0.4, 0.45, 0.4], [x, 0.45, z + dz], "detail");
          if (r.chance(0.5)) {
            k.cyl("#e8e2d6", 0.03, 2.3, [x, 1.15, z], "main");
            k.cone("#7a1c2b", 1.3, 0.5, [x, 2.4, z], "main");
          }
        }
        for (let z = NEAR - 10; z > FAR; z -= 14) k.tree([s * 10.6, 0, z], 9, ["#5a7a2a", "#6a8a33", "#4e6f24"], "#8a7a5a");
      }
      lamps(k, 10.2, 14, "classic");
      // The lattice tower far behind Mama (a generic iron tower).
      for (let i = 0; i < 4; i++) {
        const w = 26 - i * 6.5;
        k.farBox("#6a5a48", [w, 2, w], [0, 6 + i * 22, -260]);
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.farBox("#6a5a48", [1.6, 24, 1.6], [x * w * 0.42, i * 22 + 12, -260 + z * w * 0.42], [z * 0.08 * (4 - i), 0, -x * 0.08 * (4 - i)]);
      }
      k.farCone("#6a5a48", 3, 20, [0, 98, -260], 6);
      k.solid("#efe6d2", [36, 15, 8], [0, 7.5, CLOSE - 3]);
      k.skyline(["#d8d0c0", "#c8c0b0"], -170, -230, 20, 14, 24, 110, night ? "#ffd890" : null);
    },
  },

  "rio-favela": {
    track: T(dirt, "dirt", 5, "#d0a07a"),
    ground: T(dirt, "dirt", 6, "#b07a52"),
    course: course("#ffffff", "#ffffff", "#c0906a", "#a07a58", false),
    gantry: "#3a2a2a",
    terrain: (x, z) => away(x) * (6 + Math.abs(x) * 0.25 + wave(x, z) * 2),
    build(k, night) {
      const r = k.rng;
      const paint = ["#e63946", "#f4a261", "#2a9d8f", "#e9c46a", "#8ab17d", "#457b9d", "#f28482", "#ffb703", "#f1faee", "#cdb4db"];
      for (const s of SIDES) {
        // Houses stacked up the hill, higher the further out.
        for (let ring = 0; ring < 6; ring++) {
          const x = s * (12 + ring * 6);
          const base = ring === 0 ? 0 : 6 + ring * 6 * 0.25 * 1 + ring * 1.4;
          for (let z = NEAR - r.range(0, 4); z > FAR - 10; z -= r.range(4.5, 7)) {
            const h = r.range(3, 7);
            const w = r.range(3.5, 6);
            const y = (ring === 0 ? 0 : base) + h / 2;
            k.box(r.pick(paint), [5, h, w], [x, y, z], "mass");
            if (ring < 3) {
              const lit = night && r.chance(0.55);
              (lit ? k.glow.bind(k) : (c: string, sz: [number, number, number], p: [number, number, number]) => k.box(c, sz, p, "main"))(lit ? "#ffd98a" : "#2a2e38", [0.08, 1, 0.8], [x - s * 2.52, y + h * 0.15, z]);
            }
            if (r.chance(0.35)) k.cyl("#2b6cff", 0.5, 0.9, [x, y + h / 2 + 0.45, z], "detail");
          }
        }
      }
      // Wires across the lane.
      for (let z = NEAR - 6; z > FAR; z -= 9) k.box("#1b1b1b", [24, 0.04, 0.04], [0, 7 + r.range(-0.5, 0.5), z], "detail", [0, 0, r.range(-0.05, 0.05)]);
      lamps(k, 10.6, 22, "modern");
      // The hill behind, a big statue on top (generic, arms open).
      k.farCone("#5a7a4a", 70, 90, [0, 43, -240], 10);
      k.farBox("#e8e4dc", [3, 14, 3], [0, 95, -240]);
      k.farBox("#e8e4dc", [18, 2.4, 2.4], [0, 99, -240]);
      k.solid("#e9c46a", [30, 7, 6], [0, 3.5, CLOSE - 2]);
    },
  },

  // ── International nature ────────────────────────────────────────────────

  // SPEC-V2 §6.1: a large open desert field. Sand with grass patches, dunes
  // beyond the field, distant mountains, and 26 details round its edge (cacti,
  // abandoned cars, bones, tyres, drums, a signpost, rocks, a dead tree). The
  // field itself stays open: 32 m wide, nothing to hide behind.
  "desert-field": {
    track: T(sand, "sand", 6, "#ecd2a0"),
    ground: T(sand, "sand", 8, "#e8c890"),
    course: course("#ffffff", "#ffffff", "#dcbc88", "#a89070", false),
    gantry: "#5a4028",
    terrain: (x, z) => desertGround(x, z),
    build(k) {
      const r = k.rng;
      const hw = 16;
      const y = (x: number, z: number) => desertGround(x, z);
      // Mountains on the horizon, two ranges.
      k.mountains("#b48c64", null, -250, 10, 460, 26, 64);
      k.mountains("#c8a47a", null, -300, 8, 620, 40, 90);
      // 26 details round the field: placed in order along it, both sides.
      const kinds = ["cactus", "cactus", "wreck", "skull", "cactus", "tyre", "rocks", "barrel", "bones", "cactus", "pear", "rocks", "wreck", "cactus", "barrel", "skull", "sign", "rocks", "cactus", "tyre", "bones", "deadtree", "barrel", "rocks", "pear", "cactus"];
      const z0 = NEAR - 8;
      const span = z0 - (FAR - 6);
      kinds.forEach((kind, i) => {
        const s = i % 2 ? 1 : -1;
        const z = z0 - (i + r.range(0.1, 0.9)) * (span / kinds.length);
        const x = s * (hw + r.range(3, kind === "wreck" ? 12 : 16));
        const at: [number, number, number] = [x, y(x, z), z];
        switch (kind) {
          case "cactus":
            cactus(k, at, r.range(3, 5.2), r.chance(0.7) ? 2 : 1);
            break;
          case "pear":
            pricklyPear(k, at);
            break;
          case "wreck":
            wreck(k, at, r.range(0, Math.PI * 2));
            break;
          case "skull":
            skull(k, at, r.range(0, Math.PI * 2));
            break;
          case "bones":
            bones(k, at, r.range(0, Math.PI * 2));
            break;
          case "tyre":
            tyre(k, at);
            break;
          case "barrel":
            barrel(k, at);
            barrel(k, [at[0] + 0.8, at[1], at[2] + 0.4]);
            break;
          case "sign":
            signpost(k, at, s > 0 ? -0.6 : 0.6);
            break;
          case "deadtree":
            k.deadTree(at, 5.5, "#5a4632");
            break;
          default:
            for (let j = 0; j < 3; j++) k.rock([at[0] + r.range(-1.5, 1.5), at[1], at[2] + r.range(-1.5, 1.5)], r.range(0.5, 1.6), r.pick(["#a8805a", "#94704e", "#b48a62"]));
        }
      });
      // Grass patches: some on the field (they don't get in the way), more round it.
      for (let z = NEAR - 4; z > FAR - 10; z -= r.range(5, 11)) {
        const onField = r.chance(0.45);
        const x = onField ? r.range(-hw + 1, hw - 1) : r.pick([-1, 1]) * r.range(hw + 1, hw + 26);
        grassPatch(k, [x, y(x, z), z], r.range(0.6, 1.6));
      }
      // Far scrub on the dunes.
      for (let i = 0; i < 24; i++) {
        const x = r.pick([-1, 1]) * r.range(hw + 24, 90);
        const z = r.range(FAR - 20, NEAR + 30);
        k.bush([x, y(x, z), z], r.range(0.3, 0.6), "#8a8a4a");
      }
    },
  },

  "snowy-mountains": {
    track: T(snow, "snow", 5, "#ffffff"),
    ground: T(snow, "snow", 6, "#f4f8fb"),
    course: course("#2a6ac8", "#c62828", "#e8eef4", "#c8d0d8", false),
    gantry: "#3a2a1a",
    lampColor: "#ffd28a",
    terrain: (x, z) => away(x) * (2 + wave(x, z) * 3 + Math.abs(x) * 0.12),
    build(k, night) {
      const r = k.rng;
      for (const s of SIDES) {
        for (let z = NEAR; z > FAR - 4; z -= r.range(3, 6)) k.pine([s * r.range(11.5, 26), 0, z], r.range(7, 12), true);
        // Log cabins.
        for (let z = NEAR - 12; z > FAR; z -= 40) {
          k.texBox("wood", "#a8784a", [6, 3, 5], [s * 16, 1.5, z], 2);
          k.cone("#f4f8fb", 4.6, 2.2, [s * 16, 4.1, z], "mass", undefined, 6);
          k.glow(night ? "#ffcf80" : "#2b2214", [0.08, 1, 1.2], [s * 12.95, 1.5, z]);
          k.cyl("#4a3a2a", 0.3, 1.6, [s * 17.5, 4.6, z - 1], "detail");
        }
        k.fence(s * 11, NEAR, FAR, "wood", "#6a4a2a");
      }
      lamps(k, 10.6, 22, "classic");
      k.texBox("wood", "#a8784a", [16, 6, 8], [0, 3, CLOSE - 3], 2);
      k.cone("#f4f8fb", 11, 4, [0, 8, CLOSE - 3], "mass", undefined, 6);
      k.mountains("#8a98a8", "#f4f8fb", -200, 12, 360, 60, 140);
    },
  },

  "tropical-jungle": {
    track: T(leaves, "mud", 5, "#c8a888"),
    ground: T(leaves, "leaves", 6, "#d8e0c0"),
    course: course("#ffffff", "#f2f2f2", "#5a4a32", "#4a4030", false),
    gantry: "#2a3a1a",
    terrain: (x, z) => away(x) * (1.5 + wave(x, z) * 2),
    build(k) {
      const r = k.rng;
      for (const s of SIDES) {
        for (let z = NEAR; z > FAR - 6; z -= r.range(2.5, 4.5)) {
          const x = s * r.range(10.5, 26);
          const pick = r.next();
          if (pick < 0.4) k.bigLeaves([x, 0, z], r.range(1.2, 2.2));
          else if (pick < 0.65) k.tree([x, 0, z], r.range(14, 22), ["#1f5f1f", "#2a6f24", "#246a20", "#2f7a2a"], "#5a4a32");
          else if (pick < 0.85) k.palm([x, 0, z], r.range(8, 12));
          else k.rock([x, 0, z], r.range(1, 2.4), "#5a6050");
          // Vines hanging from the canopy.
          if (r.chance(0.25)) k.cyl("#2a5a1a", 0.04, r.range(4, 8), [x, r.range(6, 9), z], "foliage");
        }
      }
      // A waterfall behind Mama: a rock face with falling water.
      k.solid("#4a5048", [40, 22, 8], [0, 11, CLOSE - 6]);
      k.glow("#dff2ff", [5, 20, 0.2], [0, 10, CLOSE - 1.9]);
      k.glow("#ffffff", [8, 0.6, 3], [0, 0.4, CLOSE - 1]);
      for (let i = 0; i < 12; i++) k.bigLeaves([r.range(-18, 18), 0, CLOSE + r.range(-1, 4)], 1.8);
      for (let i = 0; i < 50; i++) k.farCone(r.pick(["#1f4f1f", "#24561f"]), r.range(6, 10), r.range(18, 30), [r.range(-130, 130), 8, r.range(-170, -260)], 6);
    },
    water: [{ kind: "pool", x0: -6, x1: 6, z0: CLOSE + 1, z1: CLOSE - 2, y: 0.08 }],
  },

  "volcanic-island": {
    track: T(rock, "rock", 5, "#c8c0b8"),
    ground: T(rock, "rock", 6, "#9a928a"),
    course: course("#ff6a2a", "#ffffff", "#3a3430", "#2a2624", false),
    gantry: "#1a1414",
    water: [
      { kind: "lava", x0: -40, x1: -15, z0: 20, z1: -60, y: 0.15 },
      { kind: "lava", x0: 15, x1: 50, z0: -40, z1: -110, y: 0.15 },
    ],
    terrain: (x, z) => away(x) * (1 + wave(x, z) * 2.5),
    build(k) {
      const r = k.rng;
      for (const s of SIDES) {
        for (let z = NEAR; z > FAR; z -= r.range(4, 8)) {
          k.rock([s * r.range(11, 22), 0, z], r.range(0.8, 2.6), r.pick(["#2a2624", "#3a3430", "#1e1a18"]));
          if (r.chance(0.25)) k.deadTree([s * r.range(12, 20), 0, z - 2], r.range(5, 8), "#1e1a18");
        }
      }
      // The volcano itself, glowing at the top, and a lava fall behind Mama.
      k.farCone("#2a2220", 120, 160, [0, 72, -300], 10);
      k.farGlowBox("#ff5a1f", [30, 6, 30], [0, 150, -300]);
      k.farGlowBox("#ff7a2a", [6, 120, 2], [10, 80, -240]);
      k.solid("#1e1a18", [36, 10, 6], [0, 5, CLOSE - 3]);
      k.glow("#ff5a1f", [3, 9, 0.2], [-8, 5, CLOSE - 0.1]);
      k.glow("#ff7a2a", [2, 9, 0.2], [9, 5, CLOSE - 0.1]);
    },
  },

  // ── Special / spooky ────────────────────────────────────────────────────

  "abandoned-hospital": {
    track: T(concrete, "concrete", 5, "#a8aca8"),
    ground: T(concrete, "concrete", 5, "#8a8e8a"),
    course: course("#d8e0c8", "#e8e8e8", "#7a7e7a", "#6a6e6a"),
    gantry: "#2a2e2c",
    lampColor: "#c8f0a8",
    build(k) {
      const r = k.rng;
      for (const s of SIDES) {
        // Long wings, broken windows, some lit a sickly green.
        k.row(NEAR, FAR, (z, w) => {
          k.building({ s, front: 15, z, w, d: 14, floors: 3, floorH: 3.6, color: "#b8bcb4", tex: "concrete", texTile: 5, roof: "flat", windows: { color: "#14181a", lit: "#b8f0a0", litChance: 0.12, frame: "#d8dcd4" } });
        }, 20, 30, [0, 0.2]);
        for (let z = NEAR - 6; z > FAR; z -= r.range(8, 14)) {
          // Gurneys and wheelchairs left outside.
          const x = s * r.range(11, 13.5);
          if (r.chance(0.6)) {
            k.box("#d8dcd8", [0.8, 0.12, 2], [x, 0.85, z], "main", [0, r.range(-0.4, 0.4), 0]);
            for (const dz of [-0.85, 0.85]) k.box("#5a5e5a", [0.06, 0.8, 0.06], [x, 0.4, z + dz], "detail");
          } else {
            k.box("#3a3e3a", [0.6, 0.06, 0.6], [x, 0.5, z], "main");
            k.box("#3a3e3a", [0.6, 0.6, 0.06], [x, 0.8, z - 0.3], "main");
            for (const dx of [-0.32, 0.32]) k.cyl("#2a2a2a", 0.3, 0.05, [x + dx, 0.32, z], "detail", { r: [0, 0, Math.PI / 2] });
          }
        }
        k.fence(s * 11, NEAR, FAR, "iron", "#3a3e3a");
      }
      for (const s of SIDES) for (let z = NEAR - 6; z > FAR; z -= 14) k.lamp([s * 14.9, 4.2, z], s as 1 | -1, "caged");
      // The main block with a red cross, dark.
      k.solid("#b8bcb4", [40, 14, 10], [0, 7, CLOSE - 4]);
      k.box("#7a1c1c", [1.2, 4, 0.2], [0, 11, CLOSE + 1.1], "main");
      k.box("#7a1c1c", [4, 1.2, 0.2], [0, 11, CLOSE + 1.1], "main");
      for (let i = -4; i <= 4; i++) k.box("#14181a", [2.2, 2, 0.1], [i * 4, 6, CLOSE + 1.05], "main");
      k.glow("#b8f0a0", [2.2, 2, 0.1], [8, 6, CLOSE + 1.06]);
    },
  },

  "dark-forest": {
    track: T(leaves, "leaves", 5, "#a89880"),
    ground: T(leaves, "leaves", 6, "#8a8070"),
    course: course("#c8d8ff", "#d8d8e8", "#3a3428", "#2a2620", false),
    gantry: "#1a1814",
    terrain: (x, z) => away(x) * (1 + wave(x, z) * 1.5),
    build(k) {
      const r = k.rng;
      for (const s of SIDES) {
        for (let z = NEAR; z > FAR - 6; z -= r.range(2.5, 4.5)) {
          const x = s * r.range(11, 26);
          k.deadTree([x, 0, z], r.range(7, 13), r.pick(["#1e1a16", "#2a241e", "#16120e"]));
          if (r.chance(0.3)) k.bush([s * r.range(10.5, 13), 0, z - 1], r.range(0.7, 1.2), "#1c2a1a");
          // Eyes in the dark between the trees.
          if (r.chance(0.18)) {
            const ex = s * r.range(14, 22);
            const ey = r.range(0.8, 2.2);
            for (const d of [-0.12, 0.12]) k.glow("#ffd23a", [0.08, 0.05, 0.05], [ex, ey, z + d]);
            k.eyes.push([ex, ey, z]);
          }
        }
      }
      // A huge gnarled tree behind Mama.
      k.deadTree([0, 0, CLOSE - 5], 18, "#16120e");
      k.deadTree([-8, 0, CLOSE - 3], 12, "#1e1a16");
      k.deadTree([9, 0, CLOSE - 4], 13, "#1e1a16");
      for (let i = 0; i < 60; i++) k.farBox(r.pick(["#0e1410", "#121a14", "#0a0e0c"]), [0.8, r.range(14, 26), 0.8], [r.range(-120, 120), 8, r.range(-150, -240)]);
    },
  },

  "haunted-mansion": {
    track: T(dirt, "gravel", 5, "#a8a49a"),
    ground: T(grass, "grass", 6, "#6a7058"),
    course: course("#d8c8a8", "#d8d0c0", "#5a5448", "#4a463e", false),
    gantry: "#1a1618",
    lampColor: "#ffc870",
    build(k) {
      const r = k.rng;
      for (const s of SIDES) {
        k.fence(s * 11, NEAR, FAR, "iron", "#141214");
        k.fence(s * 12.5, NEAR, FAR, "hedge", "#2a3220");
        for (let z = NEAR - 4; z > FAR; z -= r.range(5, 9)) {
          // Old stones in the long grass.
          const x = s * r.range(15, 24);
          k.box("#8a8a84", [0.8, r.range(0.9, 1.4), 0.2], [x, 0.55, z], "main", [r.range(-0.15, 0.15), 0, r.range(-0.12, 0.12)]);
          if (r.chance(0.35)) k.deadTree([s * r.range(16, 26), 0, z - 2], r.range(7, 11));
        }
      }
      for (const s of SIDES) for (let z = NEAR - 10; z > FAR; z -= 20) k.lamp([s * 10.6, 0, z], s as 1 | -1, "classic", "#141214");
      // The mansion: wings, a tower, flickering windows.
      k.solid("#3a3640", [40, 12, 10], [0, 6, CLOSE - 6]);
      k.solid("#3a3640", [10, 22, 10], [0, 11, CLOSE - 6]);
      k.cone("#1a1820", 8, 10, [0, 27, CLOSE - 6], "mass", undefined, 6);
      for (const x of [-15, 15]) k.cone("#1a1820", 7, 6, [x, 15, CLOSE - 6], "mass", undefined, 6);
      for (let i = -4; i <= 4; i++) for (let f = 0; f < 2; f++) {
        if (r.chance(0.3)) k.glow("#ffc870", [1.6, 2.2, 0.1], [i * 4, 3 + f * 5, CLOSE - 0.95]);
        else k.box("#0e0c10", [1.6, 2.2, 0.1], [i * 4, 3 + f * 5, CLOSE - 0.95], "main");
      }
      k.glow("#ffc870", [2, 3, 0.1], [0, 16, CLOSE - 0.95]);
      k.box("#2a1a12", [3, 4, 0.12], [0, 2, CLOSE - 0.94], "main");
    },
  },

  "underground-bunker": {
    track: T(concrete, "concrete", 4, "#b8b8b0"),
    ground: T(concrete, "concrete", 4, "#8a8a84"),
    course: course("#f5c400", "#f5c400", "#6a6a64", "#5a5a54"),
    gantry: "#2a2a28",
    lampColor: "#ffd27a",
    build(k) {
      const r = k.rng;
      for (const s of SIDES) {
        // Tall concrete walls the whole way, ribs every 8 m, pipes along them.
        for (let z = NEAR + 10; z > CLOSE - 2; z -= 8) {
          k.texBox("concrete", "#c8c8c0", [3, 16, 8.02], [s * 13, 8, z - 4], 4);
          k.box("#6a6a64", [0.8, 16, 0.6], [s * 11.4, 8, z], "main");
          k.lamp([s * 11.2, 6.5, z - 4], s as 1 | -1, "caged");
        }
        k.colliders.push({ x: s * 13, z: -55, hx: 1.5, hz: 100, h: 16 });
        for (const y of [3.2, 3.7, 9]) k.cyl(r.pick(["#5a6a5a", "#7a5a3a", "#5a5a6a"]), 0.18, CLOSE - NEAR - 10, [s * 11.3, y, (NEAR + 10 + CLOSE) / 2], "main", { r: [Math.PI / 2, 0, 0], sides: 6 });
        // Hazard stripes along the floor, crates, barrels.
        for (let z = NEAR; z > FAR; z -= 2) k.box(Math.round(z / 2) % 2 ? "#111111" : "#f5c400", [0.4, 0.03, 1], [s * 10.2, 0.015, z - 0.5], "main");
        for (let z = NEAR - 6; z > FAR; z -= r.range(7, 12)) {
          if (r.chance(0.5)) k.box("#5a4a2a", [1.2, 1.2, 1.2], [s * 11, 0.6, z], "main", [0, r.range(0, 1), 0]);
          else k.cyl(r.pick(["#2a4a2a", "#4a2a2a", "#2a2a4a"]), 0.35, 1, [s * 10.9, 0.5, z], "main");
        }
      }
      // Catwalk beams overhead.
      for (let z = NEAR - 4; z > FAR; z -= 16) {
        k.box("#3a3a38", [26, 0.4, 1.2], [0, 14, z], "main");
        k.box("#2a2a28", [26, 0.06, 0.06], [0, 15.1, z - 0.55], "detail");
      }
      // The blast door.
      k.solid("#4a4a46", [30, 16, 3], [0, 8, CLOSE - 1]);
      k.cyl("#6a6a60", 6, 1, [0, 6.5, CLOSE + 0.9], "main", { r: [Math.PI / 2, 0, 0], sides: 16 });
      k.cyl("#4a4a46", 4.5, 1.2, [0, 6.5, CLOSE + 1], "main", { r: [Math.PI / 2, 0, 0], sides: 16 });
      k.glow("#ff3a2a", [0.6, 0.6, 0.2], [-8, 12, CLOSE + 0.6]);
      k.glow("#ff3a2a", [0.6, 0.6, 0.2], [8, 12, CLOSE + 0.6]);
    },
  },
};
