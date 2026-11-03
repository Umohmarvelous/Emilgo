// Vehicles on screen (SPEC-V3 §5; Phase 5): the danfo, the keke and the
// tokunbo, built from boxes like the city's parked cars; the fuel boys'
// stands; what happens to a car, seen and heard.
//
//   a car       its body (one draw, tinted as it gets worse), its windows
//               (one draw, see-through: the people inside show), and a far
//               copy past FAR_M (a few boxes). Wheels for every car are one
//               instanced draw; they turn with the speed, the front ones
//               steer. The body leans in a turn and dips under the brakes.
//   damage      scratched, then smoke from the engine, then fire and black
//               smoke, then the blast: a flash, flying panels, a shake for
//               anyone near; the wreck stays, charred.
//   people      a rider sits in their seat (crowd.setSeat), the driver's
//               hands on the wheel.
//   stands      each fuel boy's table, umbrella and jerrycans (gone once he
//               has sold them).
//
// Budget (§5): a car is well under 2–3K triangles and 3 draws near; far, one.

import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three";

import type { Sound } from "../audio/sound";
import { TRAFFIC, VEHICLES, type VehicleKind } from "../config";
import type { Match } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import { carPoint, type Car } from "../game/modules/drive";
import type { TrafficModule } from "../game/modules/traffic";
import type { VehiclesModule } from "../game/modules/vehicles";
import type { MapMark } from "../ui/minimap";
import type { CameraRig } from "./camera";
import type { Crowd } from "./crowd";
import { merge, part, type V3 } from "./geo";

/** Past this (m) a car is drawn as its far copy. */
const FAR_M = 70;
const MAX_CARS = VEHICLES.max;
const MAX_WHEELS = MAX_CARS * 4;
const MAX_PUFFS = 96;
const MAX_FLAMES = 48;
const MAX_BITS = 40;

/** How far above its floor a seated body is drawn (the seat's height in each kind). */
export const SEAT_LIFT: Record<VehicleKind, number> = { danfo: 0.42, keke: 0.22, tokunbo: -0.02 };

/** Where each kind's wheels are (x, z, radius, width), front ones first (they steer). */
const WHEELS: Record<VehicleKind, { at: [number, number][]; r: number; w: number; front: number }> = {
  danfo: { at: [[0.86, 1.52], [-0.86, 1.52], [0.86, -1.5], [-0.86, -1.5]], r: 0.38, w: 0.26, front: 2 },
  keke: { at: [[0, 1.05], [0.6, -0.78], [-0.6, -0.78]], r: 0.27, w: 0.16, front: 1 },
  tokunbo: { at: [[0.8, 1.36], [-0.8, 1.36], [0.8, -1.34], [-0.8, -1.34]], r: 0.33, w: 0.22, front: 2 },
};

/** Where smoke and fire come out (the engine): the front of a danfo or a tokunbo, the back of a keke. */
const ENGINE: Record<VehicleKind, V3> = { danfo: [0, 1.4, 2.0], keke: [0, 0.9, -1.1], tokunbo: [0, 0.95, 1.6] };

/** Tokunbo colours (second-hand imports: silver, black, white, navy, wine). */
const TOKUNBO_COLORS = ["#b8bcc2", "#1d1f22", "#e9e9e6", "#23324d", "#6b1f2a", "#8a8f96"];
/** What each kind is called on screen (v4 rework: the ids stay; the names are global). */
export const VEHICLE_NAME: Record<VehicleKind, string> = { danfo: "Minibus", keke: "Trike", tokunbo: "Sedan" };

const BOX = new BoxGeometry(1, 1, 1);
const CYL = new CylinderGeometry(1, 1, 1, 12);
const K = "#151515";
const SEAT = "#5d4037";
const LAMP = "#fff6d0";
const TAIL = "#b3201c";

const box = (color: string, s: V3, p: V3, r?: V3): BufferGeometry => part(BOX, color, { p, s, ...(r ? { r } : {}) });

// ─── The kinds, built along +Z (nose at +Z), from the ground up ──────────────

function danfo(): { body: BufferGeometry; glass: BufferGeometry; far: BufferGeometry } {
  // v4 rework: a white city minibus (the yellow danfo's place; the same size and seats).
  const Y = "#e4e6e8";
  const parts = [
    box(K, [1.8, 0.22, 4.4], [0, 0.32, 0]),
    box(Y, [1.95, 1.2, 4.7], [0, 0.98, 0]),
    // A grey band down both sides.
    box("#5a6068", [1.97, 0.1, 4.72], [0, 1.22, 0]),
    box("#3a3e44", [1.97, 0.08, 4.72], [0, 0.78, 0]),
    // The upper cabin's frame: roof, pillars, the band under the windows.
    box(Y, [1.9, 0.1, 4.5], [0, 2.32, -0.05]),
    box(Y, [1.92, 0.12, 4.52], [0, 1.6, -0.05]),
    ...[-2.2, -1.1, 0, 1.1, 2.12].flatMap((z) => [box(Y, [0.08, 0.72, 0.1], [0.94, 1.96, z]), box(Y, [0.08, 0.72, 0.1], [-0.94, 1.96, z])]),
    box(Y, [1.86, 0.72, 0.08], [0, 1.96, -2.28]),
    // The conductor's door, open on the right.
    box("#1e1e1e", [0.03, 1.5, 0.95], [0.99, 1.25, 0.35]),
    // Bumpers, grille, lamps, mirrors.
    box(K, [1.99, 0.24, 0.18], [0, 0.46, 2.4]),
    box(K, [1.99, 0.24, 0.18], [0, 0.46, -2.4]),
    box(K, [1.0, 0.3, 0.04], [0, 0.78, 2.36]),
    box(LAMP, [0.32, 0.2, 0.05], [0.66, 0.86, 2.36]),
    box(LAMP, [0.32, 0.2, 0.05], [-0.66, 0.86, 2.36]),
    box(TAIL, [0.22, 0.3, 0.05], [0.74, 0.95, -2.36]),
    box(TAIL, [0.22, 0.3, 0.05], [-0.74, 0.95, -2.36]),
    box(K, [0.06, 0.24, 0.16], [1.1, 1.78, 1.95]),
    box(K, [0.06, 0.24, 0.16], [-1.1, 1.78, 1.95]),
    box(K, [0.24, 0.04, 0.04], [1.0, 1.7, 1.95]),
    box(K, [0.24, 0.04, 0.04], [-1.0, 1.7, 1.95]),
    // Wheel arches.
    ...[1.52, -1.5].flatMap((z) => [box(K, [0.06, 0.5, 0.95], [0.98, 0.5, z]), box(K, [0.06, 0.5, 0.95], [-0.98, 0.5, z])]),
    // Roof bars.
    box("#2a2e32", [0.05, 0.08, 2.4], [0.74, 2.4, -0.4]),
    box("#2a2e32", [0.05, 0.08, 2.4], [-0.74, 2.4, -0.4]),
    // Seats, seen through the windows.
    box(SEAT, [1.7, 0.14, 0.5], [0, 0.9, 1.35]),
    box(SEAT, [1.7, 0.5, 0.1], [0, 1.2, 1.08]),
    ...[0.2, -0.75, -1.7].flatMap((z) => [box(SEAT, [1.7, 0.14, 0.5], [0, 0.9, z]), box(SEAT, [1.7, 0.5, 0.1], [0, 1.2, z - 0.27])]),
    box(K, [0.36, 0.06, 0.36], [-0.45, 1.45, 1.75], [-0.9, 0, 0]),
  ];
  const glass = [
    box("#26323a", [1.72, 0.66, 0.05], [0, 1.95, 2.26], [-0.16, 0, 0]),
    box("#26323a", [0.04, 0.62, 4.36], [0.95, 1.96, -0.05]),
    box("#26323a", [0.04, 0.62, 4.36], [-0.95, 1.96, -0.05]),
    box("#26323a", [1.8, 0.6, 0.04], [0, 1.96, -2.3]),
  ];
  const far = merge([box(Y, [1.95, 1.95, 4.7], [0, 1.32, 0]), box("#3a4650", [1.97, 0.6, 4.3], [0, 1.96, 0]), box("#5a6068", [1.97, 0.1, 4.72], [0, 1.22, 0])]);
  return { body: merge(parts), glass: merge(glass), far };
}

function keke(): { body: BufferGeometry; glass: BufferGeometry; far: BufferGeometry } {
  // v4 rework: a utility trike in olive and black (the keke's place: the same seats and wheels).
  const G = "#4a5238";
  const Y = "#22262a";
  const parts = [
    box(K, [1.2, 0.12, 2.3], [0, 0.36, -0.05]),
    // The nose and its single front wheel's fork.
    box(G, [0.72, 0.85, 0.45], [0, 0.82, 1.12]),
    box(G, [0.9, 0.12, 0.8], [0, 0.46, 0.75]),
    box(K, [0.08, 0.5, 0.08], [0, 0.55, 1.1]),
    box(LAMP, [0.22, 0.16, 0.05], [0, 1.0, 1.36]),
    box(K, [0.66, 0.05, 0.05], [0, 1.18, 0.85]),
    // The canopy: roof, back, the four posts.
    box(Y, [1.35, 0.08, 2.3], [0, 1.92, -0.12]),
    box(Y, [1.32, 0.9, 0.05], [0, 1.46, -1.22]),
    box(K, [0.05, 0.85, 0.05], [0.64, 1.5, 1.0]),
    box(K, [0.05, 0.85, 0.05], [-0.64, 1.5, 1.0]),
    box(K, [0.05, 1.4, 0.05], [0.64, 1.2, -1.2]),
    box(K, [0.05, 1.4, 0.05], [-0.64, 1.2, -1.2]),
    // The back: engine box under the bench, mudguards.
    box(G, [1.3, 0.5, 1.0], [0, 0.66, -0.75]),
    box(K, [0.25, 0.08, 0.6], [0.6, 0.62, -0.78]),
    box(K, [0.25, 0.08, 0.6], [-0.6, 0.62, -0.78]),
    box(TAIL, [0.16, 0.12, 0.04], [0.5, 0.75, -1.26]),
    box(TAIL, [0.16, 0.12, 0.04], [-0.5, 0.75, -1.26]),
    // Seats.
    box(SEAT, [0.45, 0.1, 0.4], [0, 0.72, 0.5]),
    box(SEAT, [1.15, 0.12, 0.5], [0, 0.96, -0.5]),
    box(SEAT, [1.15, 0.45, 0.08], [0, 1.2, -0.78]),
  ];
  const glass = [box("#26323a", [0.95, 0.6, 0.04], [0, 1.52, 1.02], [-0.15, 0, 0])];
  const far = merge([box(G, [1.3, 0.9, 2.6], [0, 0.8, 0]), box(Y, [1.35, 0.1, 2.3], [0, 1.92, -0.12]), box(Y, [1.3, 0.9, 0.05], [0, 1.46, -1.22])]);
  return { body: merge(parts), glass: merge(glass), far };
}

function tokunbo(color: string): { body: BufferGeometry; glass: BufferGeometry; far: BufferGeometry } {
  const parts = [
    box(K, [1.7, 0.18, 4.2], [0, 0.3, 0]),
    box(color, [1.8, 0.58, 4.4], [0, 0.66, 0]),
    // The bonnet and boot a little lower than the waist.
    box(color, [1.74, 0.1, 1.3], [0, 0.98, 1.5]),
    box(color, [1.74, 0.1, 0.9], [0, 0.98, -1.7]),
    // The cabin: roof and pillars round the glass.
    box(color, [1.58, 0.07, 1.95], [0, 1.47, -0.25]),
    ...[0.68, -1.15].flatMap((z) => [box(color, [0.07, 0.48, 0.1], [0.8, 1.22, z]), box(color, [0.07, 0.48, 0.1], [-0.8, 1.22, z])]),
    box(color, [0.07, 0.48, 0.08], [0.8, 1.22, -0.25]),
    box(color, [0.07, 0.48, 0.08], [-0.8, 1.22, -0.25]),
    // Door seams, bumpers, lamps, grille, mirrors.
    box(K, [1.82, 0.4, 0.02], [0, 0.66, -0.25]),
    box(K, [1.84, 0.2, 0.14], [0, 0.42, 2.22]),
    box(K, [1.84, 0.2, 0.14], [0, 0.42, -2.22]),
    box(K, [0.8, 0.16, 0.04], [0, 0.72, 2.21]),
    box(LAMP, [0.34, 0.13, 0.04], [0.62, 0.78, 2.21]),
    box(LAMP, [0.34, 0.13, 0.04], [-0.62, 0.78, 2.21]),
    box(TAIL, [0.4, 0.14, 0.04], [0.6, 0.82, -2.21]),
    box(TAIL, [0.4, 0.14, 0.04], [-0.6, 0.82, -2.21]),
    box(K, [0.14, 0.1, 0.16], [0.96, 1.08, 0.62]),
    box(K, [0.14, 0.1, 0.16], [-0.96, 1.08, 0.62]),
    ...[1.36, -1.34].flatMap((z) => [box(K, [0.05, 0.36, 0.82], [0.91, 0.5, z]), box(K, [0.05, 0.36, 0.82], [-0.91, 0.5, z])]),
    // Seats.
    box(SEAT, [0.6, 0.12, 0.5], [0.4, 0.6, 0.15]),
    box(SEAT, [0.6, 0.12, 0.5], [-0.4, 0.6, 0.15]),
    box(SEAT, [0.6, 0.55, 0.1], [0.4, 0.92, -0.12]),
    box(SEAT, [0.6, 0.55, 0.1], [-0.4, 0.92, -0.12]),
    box(SEAT, [1.5, 0.12, 0.5], [0, 0.6, -0.95]),
    box(K, [0.34, 0.06, 0.34], [-0.4, 1.0, 0.62], [-1.0, 0, 0]),
  ];
  const glass = [
    box("#26323a", [1.5, 0.5, 0.04], [0, 1.24, 0.72], [-0.6, 0, 0]),
    box("#26323a", [1.5, 0.45, 0.04], [0, 1.22, -1.2], [0.55, 0, 0]),
    box("#26323a", [0.03, 0.42, 1.8], [0.8, 1.22, -0.25]),
    box("#26323a", [0.03, 0.42, 1.8], [-0.8, 1.22, -0.25]),
  ];
  const far = merge([box(color, [1.8, 0.7, 4.4], [0, 0.7, 0]), box("#3a4650", [1.6, 0.5, 2.0], [0, 1.25, -0.25])]);
  return { body: merge(parts), glass: merge(glass), far };
}

/** A fuel boy's stand: a table, his umbrella; the jerrycans apart (they go when he's sold out). */
function standGeometry(): BufferGeometry {
  return merge([
    box("#8d6e63", [1.0, 0.06, 0.6], [0, 0.72, 0]),
    ...[[0.45, 0.25], [-0.45, 0.25], [0.45, -0.25], [-0.45, -0.25]].map(([x, z]) => box("#6d4c41", [0.05, 0.7, 0.05], [x, 0.35, z])),
    part(CYL, "#9e9e9e", { p: [0.55, 1.15, -0.2], s: [0.025, 2.3, 0.025] }),
    part(new ConeGeometry(1, 0.45, 8), "#e53935", { p: [0.55, 2.35, -0.2], s: [1.1, 1, 1.1] }),
    part(new ConeGeometry(1, 0.46, 8), "#fdd835", { p: [0.55, 2.34, -0.2], s: [1.06, 1, 1.06], r: [0, Math.PI / 8, 0] }),
  ]);
}

function cansGeometry(): BufferGeometry {
  const cans: BufferGeometry[] = [];
  for (const [x, z] of [[-0.25, 0], [0.1, 0.05], [0.35, -0.05]]) {
    cans.push(box("#f9c80e", [0.24, 0.36, 0.16], [x, 0.93, z]), box("#c62828", [0.05, 0.06, 0.05], [x + 0.07, 1.14, z]));
  }
  cans.push(box("#f9c80e", [0.26, 0.38, 0.17], [-0.7, 0.19, 0.45]), part(new ConeGeometry(0.1, 0.16, 8), "#4caf50", { p: [0.25, 0.83, 0.2], r: [Math.PI, 0, 0] }));
  return merge(cans);
}

// ─── The view ────────────────────────────────────────────────────────────────

interface CarDraw {
  readonly car: Car;
  readonly root: Group;
  readonly body: Mesh;
  readonly glass: Mesh;
  readonly far: Mesh;
  readonly mat: MeshLambertMaterial;
  spin: number;
  roll: number;
  pitch: number;
  lastSpeed: number;
  smokeT: number;
  shown: number;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  dark: boolean;
}

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  age: number;
}

export interface VehicleViewOptions {
  crowd: Crowd;
  sound: Sound | null;
  rig: CameraRig;
  /** Your index. */
  me: number;
  /** The fuel boys' stands. */
  stands: readonly { x: number; z: number; rot: number }[];
}

const _m = new Matrix4();
const _r = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _e = new Vector3();
const _c = new Color();
const ZERO = new Matrix4().makeScale(0, 0, 0);
const BODY_TINT = [0xffffff, 0xd9d9d9, 0xbababa, 0x8a7d74, 0x2b2622];

export class VehicleView {
  readonly group = new Group();
  private readonly o: VehicleViewOptions;
  private readonly draws: CarDraw[] = [];
  private readonly glassMat = new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false });
  private readonly wheels: InstancedMesh;
  private readonly puffs: InstancedMesh;
  private readonly flames: InstancedMesh;
  private readonly bits: InstancedMesh;
  private readonly flash: Mesh;
  /** Headlights (a sandstorm, a power cut): two cones of light ahead of each car. */
  private readonly beams: InstancedMesh;
  private lights = false;
  /** The traffic danfo (made when it first runs) and whether this run's horn has gone. */
  private bus: { root: Group; body: Mesh; far: Mesh } | null = null;
  private busHorn = false;
  private readonly stands: InstancedMesh;
  private readonly cans: InstancedMesh;
  private readonly smoke: Puff[] = [];
  private readonly fire: Puff[] = [];
  private readonly debris: Bit[] = [];
  private flashT = 0;
  private readonly seated: number[] = [];
  private time = 0;
  private readonly geos = new Map<string, { body: BufferGeometry; glass: BufferGeometry; far: BufferGeometry }>();

  constructor(o: VehicleViewOptions) {
    this.o = o;
    const wheel = merge([part(CYL, "#1a1a1a", { r: [0, 0, Math.PI / 2] }), part(CYL, "#9e9e9e", { r: [0, 0, Math.PI / 2], s: [0.5, 1.02, 0.5] })]);
    this.wheels = instanced(wheel, new MeshLambertMaterial({ vertexColors: true }), MAX_WHEELS);
    this.puffs = instanced(new IcosahedronGeometry(1, 0), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), MAX_PUFFS, true);
    this.flames = instanced(new IcosahedronGeometry(1, 0), new MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }), MAX_FLAMES);
    this.bits = instanced(merge([box("#2b2622", [0.5, 0.06, 0.4], [0, 0, 0])]), new MeshLambertMaterial({ vertexColors: true }), MAX_BITS);
    this.flash = new Mesh(new IcosahedronGeometry(1, 1), new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    this.flash.visible = false;
    const beam = new ConeGeometry(1.6, 9, 12, 1, true).translate(0, -4.5, 0).rotateX(-Math.PI / 2);
    this.beams = instanced(beam as unknown as BufferGeometry, new MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false }), MAX_CARS * 2);
    const lit = new MeshLambertMaterial({ vertexColors: true });
    this.stands = instanced(standGeometry(), lit, Math.max(1, o.stands.length));
    this.cans = instanced(cansGeometry(), lit, Math.max(1, o.stands.length));
    o.stands.forEach((s, i) => {
      _m.makeRotationY(s.rot).setPosition(s.x, 0, s.z);
      this.stands.setMatrixAt(i, _m);
      this.cans.setMatrixAt(i, _m);
    });
    this.stands.count = this.cans.count = o.stands.length;
    this.group.add(this.wheels, this.puffs, this.flames, this.bits, this.flash, this.stands, this.cans, this.beams);
  }

  private geometry(car: Car): { body: BufferGeometry; glass: BufferGeometry; far: BufferGeometry } {
    const key = car.kind === "tokunbo" ? `tokunbo${car.index % TOKUNBO_COLORS.length}` : car.kind;
    let g = this.geos.get(key);
    if (!g) {
      g = car.kind === "danfo" ? danfo() : car.kind === "keke" ? keke() : tokunbo(TOKUNBO_COLORS[car.index % TOKUNBO_COLORS.length]);
      this.geos.set(key, g);
    }
    return g;
  }

  private add(car: Car): CarDraw {
    const g = this.geometry(car);
    const mat = new MeshLambertMaterial({ vertexColors: true });
    const root = new Group();
    const body = new Mesh(g.body, mat);
    const glass = new Mesh(g.glass, this.glassMat);
    const far = new Mesh(g.far, mat);
    for (const mesh of [body, glass, far]) mesh.matrixAutoUpdate = true;
    body.castShadow = true;
    far.visible = false;
    root.add(body, glass, far);
    this.group.add(root);
    const d: CarDraw = { car, root, body, glass, far, mat, spin: 0, roll: 0, pitch: 0, lastSpeed: car.speed, smokeT: 0, shown: -1 };
    this.draws[car.index] = d;
    return d;
  }

  /** The match's events since the last frame: horns, alarms, beeps, crashes, the blast. */
  events(list: readonly MatchEvent[], m: Match, cam: Vector3): void {
    const v = m.module<VehiclesModule>("vehicles");
    if (!v) return;
    const s = this.o.sound;
    const me = m.contestants[this.o.me];
    const near = (car: Car | undefined, range: number) => (car ? Math.max(0, 1 - Math.hypot(car.x - cam.x, car.z - cam.z) / range) : 0);
    for (const e of list) {
      switch (e.type) {
        case "horn":
          s?.horn(near(v.cars[e.car], 60));
          break;
        case "alarm":
          s?.carAlarm(near(v.cars[e.car], 50));
          break;
        case "seat":
          s?.carDoor(near(v.cars[e.car], 30));
          break;
        case "fuel":
          if (e.why === "beep" && v.cars[e.car]?.seats.includes(me.index)) s?.fuelBeep(e.s <= VEHICLES.fuel.full * VEHICLES.fuel.beeps[1] ? 2 : 1);
          break;
        case "bump":
          s?.crash(near(v.cars[e.car], 40) * 0.6);
          break;
        case "wreck": {
          const car = v.cars[e.car];
          if (!car) break;
          if (e.state >= 4) this.blast(car, cam);
          else if (e.state >= 1) s?.crash(near(car, 40));
          break;
        }
        default:
          break;
      }
    }
  }

  /** The blast: a flash, flying panels, a fireball, a shake for anyone near. */
  private blast(car: Car, cam: Vector3): void {
    this.flash.position.set(car.x, car.h + 1.2, car.z);
    this.flash.visible = true;
    this.flashT = 0.45;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 4 + Math.random() * 6;
      this.addBit({ x: car.x, y: car.h + 1, z: car.z, vx: Math.cos(a) * sp, vy: 5 + Math.random() * 6, vz: Math.sin(a) * sp, rx: Math.random() * 9, ry: Math.random() * 9, age: 0 });
    }
    for (let i = 0; i < 14; i++) {
      this.addPuff(this.fire, MAX_FLAMES, car.x + (Math.random() - 0.5) * 2, car.h + 1 + Math.random(), car.z + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.2, 0.9, false, 3);
      this.addPuff(this.smoke, MAX_PUFFS, car.x + (Math.random() - 0.5) * 2, car.h + 1.5, car.z + (Math.random() - 0.5) * 2, 1 + Math.random() * 1.4, 3.5, true, 1.5);
    }
    const d = Math.hypot(car.x - cam.x, car.z - cam.z);
    const k = Math.max(0, 1 - d / 45);
    if (k > 0) this.o.rig.kick(0.6 + k * 1.6);
    this.o.sound?.explosion(Math.max(0.15, k));
  }

  private addPuff(list: Puff[], max: number, x: number, y: number, z: number, size: number, life: number, dark: boolean, rise: number): void {
    if (list.length >= max) list.shift();
    list.push({ x, y, z, vx: (Math.random() - 0.5) * 0.6, vy: rise * (0.6 + Math.random() * 0.6), vz: (Math.random() - 0.5) * 0.6, age: 0, life, size, dark });
  }

  private addBit(b: Bit): void {
    if (this.debris.length >= MAX_BITS) this.debris.shift();
    this.debris.push(b);
  }

  /** Every frame: the cars where the match has them, their wheels, their smoke; the riders seated; the map. */
  update(dt: number, m: Match, cam: Vector3, marks: MapMark[]): void {
    this.time += dt;
    this.busUpdate(m, cam, marks);
    const v = m.module<VehiclesModule>("vehicles");
    const cars = v?.cars ?? [];
    let w = 0;
    for (const car of cars) {
      if (!car) continue;
      const d = this.draws[car.index] ?? this.add(car);
      // Lean into a turn, dip under the brakes, rock when it hits something.
      const accel = dt > 0 ? (car.speed - d.lastSpeed) / dt : 0;
      d.lastSpeed = car.speed;
      const wantRoll = Math.max(-0.08, Math.min(0.08, -car.turn * car.speed * 0.012));
      const wantPitch = Math.max(-0.06, Math.min(0.06, -accel * 0.008));
      d.roll += (wantRoll - d.roll) * (1 - Math.exp(-dt * 6));
      d.pitch += (wantPitch - d.pitch) * (1 - Math.exp(-dt * 6));
      d.root.position.set(car.x, car.h, car.z);
      d.root.rotation.set(d.pitch, car.heading, d.roll, "YXZ");
      // Near: the full car; far: its box.
      const dist = Math.hypot(car.x - cam.x, car.z - cam.z);
      const farOff = dist > FAR_M;
      d.body.visible = !farOff;
      d.glass.visible = !farOff && car.state < 4;
      d.far.visible = farOff;
      if (d.shown !== car.state) {
        d.shown = car.state;
        d.mat.color.setHex(BODY_TINT[Math.min(4, car.state)]);
      }
      // An alarm going: the body flashes amber.
      const alarm = m.elapsed >= car.alarmAt && m.elapsed - car.alarmAt < 6 && Math.sin(m.elapsed * 12) > 0 ? 0.35 : 0;
      d.mat.emissive.setRGB(alarm, alarm * 0.6, 0);
      // Wheels: turn with the road, the front ones steer; flat on a wreck.
      d.spin += (car.speed * dt) / WHEELS[car.kind].r;
      const W = WHEELS[car.kind];
      const steer = Math.max(-0.5, Math.min(0.5, car.turn * 0.6));
      W.at.forEach(([lx, lz], i) => {
        if (w >= MAX_WHEELS) return;
        if (farOff) {
          this.wheels.setMatrixAt(w++, ZERO);
          return;
        }
        const [x, z] = carPoint(car, lx, lz);
        _q.setFromAxisAngle(_e.set(0, 1, 0), car.heading + (i < W.front ? steer : 0));
        _m.makeRotationX(d.spin);
        const r = car.state >= 4 ? W.r * 0.7 : W.r;
        _s.set(W.w, r, r);
        _v.set(x, car.h + r, z);
        _r.makeRotationFromQuaternion(_q).multiply(_m).scale(_s).setPosition(_v);
        this.wheels.setMatrixAt(w++, _r);
      });
      // Smoke from a sick engine, fire and black smoke from a burning one, a wreck smouldering.
      d.smokeT -= dt;
      if (car.state >= 2 && d.smokeT <= 0 && dist < 120) {
        const [ex, ey, ez] = ENGINE[car.kind];
        const [x, z] = carPoint(car, ex, ez);
        d.smokeT = car.state === 2 ? 0.16 : car.state === 3 ? 0.07 : 0.4;
        this.addPuff(this.smoke, MAX_PUFFS, x, car.h + ey, z, car.state >= 3 ? 0.5 : 0.35, car.state === 4 ? 4 : 2.2, car.state >= 3, 1.4);
        if (car.state === 3) this.addPuff(this.fire, MAX_FLAMES, x + (Math.random() - 0.5) * 0.6, car.h + ey - 0.1, z + (Math.random() - 0.5) * 0.6, 0.35 + Math.random() * 0.3, 0.5, false, 1.8);
      }
      // On the map: every car (a wreck grey).
      marks.push({ x: car.x, z: car.z, kind: "car", r: car.state >= 4 ? 0 : 1 });
    }
    // Headlights: from each lamp, ahead, a little down.
    let b = 0;
    if (this.lights) {
      for (const car of cars) {
        if (!car || car.state >= 4 || b + 2 > MAX_CARS * 2) continue;
        const k = VEHICLES.kinds[car.kind];
        for (const side of car.kind === "keke" ? [0] : [-1, 1]) {
          const [x, z] = carPoint(car, side * k.wid * 0.33, k.len / 2);
          _q.setFromAxisAngle(_e.set(0, 1, 0), car.heading);
          _r.makeRotationX(0.12);
          _m.makeRotationFromQuaternion(_q).multiply(_r).setPosition(x, car.h + 0.8, z);
          this.beams.setMatrixAt(b++, _m);
        }
      }
    }
    this.beams.count = b;
    this.beams.instanceMatrix.needsUpdate = true;
    for (let i = w; i < this.wheels.count; i++) this.wheels.setMatrixAt(i, ZERO);
    this.wheels.count = Math.max(w, 1);
    this.wheels.instanceMatrix.needsUpdate = true;

    // The riders, seated (and back on their feet when they get out).
    const crowd = this.o.crowd;
    for (const c of m.contestants) {
      const seat = m.seatOf(c);
      const car = seat >= 0 ? cars[seat] : undefined;
      const want = car ? (car.seats[0] === c.index ? 2 : 1) : 0;
      if ((this.seated[c.index] ?? 0) === want) continue;
      this.seated[c.index] = want;
      crowd.setSeat(c.index, car ? { lift: SEAT_LIFT[car.kind], driver: want === 2 } : null);
    }

    // The fuel boys: sold out, the cans are gone; still selling, a mark on the map.
    this.o.stands.forEach((st, i) => {
      if (v?.used[i]) this.cans.setMatrixAt(i, ZERO);
      else marks.push({ x: st.x, z: st.z, kind: "fuel" });
    });
    this.cans.instanceMatrix.needsUpdate = true;

    this.puffsUpdate(dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      const u = Math.max(0, this.flashT / 0.45);
      this.flash.scale.setScalar(2 + (1 - u) * 5);
      (this.flash.material as MeshBasicMaterial).opacity = u;
      if (this.flashT <= 0) this.flash.visible = false;
    }
  }

  private puffsUpdate(dt: number): void {
    const run = (list: Puff[], mesh: InstancedMesh, grow: number) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += dt;
        if (p.age >= p.life) list.splice(i, 1);
      }
      list.forEach((p, i) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const u = p.age / p.life;
        const size = p.size * (1 + u * grow) * (u > 0.7 ? (1 - u) / 0.3 : 1);
        _m.makeScale(size, size, size).setPosition(p.x, p.y, p.z);
        mesh.setMatrixAt(i, _m);
        if (mesh.instanceColor) mesh.setColorAt(i, _c.setHex(p.dark ? 0x2a2a2a : 0x9a9a9a));
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    run(this.smoke, this.puffs, 2.2);
    run(this.fire, this.flames, -0.5);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const b = this.debris[i];
      b.age += dt;
      b.vy -= 18 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < 0.05) {
        b.y = 0.05;
        b.vx *= 0.5;
        b.vz *= 0.5;
        b.vy = Math.abs(b.vy) * 0.25;
      }
      if (b.age > 8) this.debris.splice(i, 1);
    }
    this.debris.forEach((b, i) => {
      _q.setFromAxisAngle(_e.set(1, 0, 0), b.rx * Math.min(b.age, 1.2));
      _m.makeRotationFromQuaternion(_q).setPosition(b.x, b.y, b.z);
      this.bits.setMatrixAt(i, _m);
    });
    this.bits.count = this.debris.length;
    this.bits.instanceMatrix.needsUpdate = true;
  }

  /** The danfo that sweeps the main road (§10.14): its horn, then the bus on its way. */
  private busUpdate(m: Match, cam: Vector3, marks: MapMark[]): void {
    const tr = m.module<TrafficModule>("traffic");
    if (!tr) return;
    const nx = tr.next(m);
    if (nx >= 0 && nx <= TRAFFIC.horn && !this.busHorn) {
      this.busHorn = true;
      const o = tr.road;
      if (o) this.o.sound?.horn(Math.max(0.25, 1 - Math.hypot((o.x0 + o.x1) / 2 - cam.x, (o.z0 + o.z1) / 2 - cam.z) / 160));
    }
    if (nx > TRAFFIC.horn) this.busHorn = false;
    const b = tr.bus(m);
    // Made at the start (hidden), so its first run doesn't stall a frame building it.
    if (!this.bus) {
      const g = danfo();
      const mat = new MeshLambertMaterial({ vertexColors: true });
      this.bus = { root: new Group(), body: new Mesh(g.body, mat), far: new Mesh(g.far, mat) };
      this.bus.body.castShadow = true;
      this.bus.root.add(this.bus.body, new Mesh(g.glass, this.glassMat), this.bus.far);
      this.group.add(this.bus.root);
    }
    this.bus.root.visible = !!b;
    if (!b) return;
    this.bus.root.position.set(b.x, b.h, b.z);
    this.bus.root.rotation.set(0, b.hd, 0);
    const farOff = Math.hypot(b.x - cam.x, b.z - cam.z) > FAR_M;
    this.bus.body.visible = !farOff;
    this.bus.far.visible = farOff;
    marks.push({ x: b.x, z: b.z, kind: "car", r: 1 });
  }

  /** Headlights on (a sandstorm, a power cut) or off. */
  setLights(on: boolean): void {
    this.lights = on;
  }

  /** Draws and triangles (the perf gate). */
  get stats(): { calls: number; triangles: number } {
    let calls = 0;
    let tris = 0;
    for (const d of this.draws) {
      if (!d) continue;
      for (const mesh of [d.body, d.glass, d.far]) {
        if (!mesh.visible) continue;
        calls++;
        tris += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;
      }
    }
    return { calls, triangles: Math.round(tris) };
  }

  dispose(): void {
    for (const c of this.seated.keys()) if (this.seated[c]) this.o.crowd.setSeat(c, null);
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mat = mesh.material as MeshLambertMaterial | MeshLambertMaterial[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat.dispose();
      }
    });
    this.group.removeFromParent();
  }
}

function instanced(geo: BufferGeometry, mat: MeshLambertMaterial | MeshBasicMaterial, count: number, colors = false): InstancedMesh {
  const m = new InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  if (colors) m.setColorAt(0, new Color(1, 1, 1));
  return m;
}
