// Treasure Hunt on screen (v5): what game/modules/treasure.ts decides, drawn,
// heard and shown.
//
//   world    the boxes (wooden chests with iron bands; open ones lie open), a
//            treasure on the ground (a gold relic turning over a gold light),
//            treasures carried (small ones circling the carrier's head), the
//            upload machine (an ATM-like kiosk with a scanning screen and a
//            beacon you can see across the map) and its ring of light
//   moments  a box opened (a gold flash if it held one), a body that drops
//            its treasures (they burst out and fall round it), the upload
//            (the ring fills as it goes, the screen's bar with it)
//   HUD      the hold prompt (open a box), the objective line, the upload
//            panel in the middle of the screen, the map's marks and the
//            compass's pin
//
// Draws: 2 for the boxes, 1 for the relics, 2 for their glows, 6 for the
// machine (hidden past 260 m but for its beacon). Nothing allocated per frame.
//
// v7 (12 Nov, the owner: "no hint of where the treasures are"): no beams, no
// chests on the map, no compass to them. A closed box shows only by its own look
// and, close up and in sight (ORBIT_RANGE), a shining orbit of sparks round it
// (two crossed rings, one draw); real and empty boxes look the same.
//
// v7 (H3): the five treasures are things (TREASURE_KINDS: a diamond, gold bars,
// silver bars, an emerald, a ruby), each its own model (one draw each, hidden
// unless out). Found, it rises out of its chest and hangs there a moment before
// it goes with its finder; the feed names it; a strip under the objective shows
// which of the five you carry (lit) and your squad carries (ringed).

import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from "three";

import { TREASURE, TREASURE_KINDS, type TreasureKind } from "../config";
import type { Sound } from "../audio/sound";
import type { Match } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import type { GadgetsModule } from "../game/modules/gadgets";
import type { TreasureModule } from "../game/modules/treasure";
import type { ItemPin } from "../ui/hud";
import type { MapMark } from "../ui/minimap";
import type { PlayHudState } from "../ui/play";
import type { Hud } from "../ui/hud";
import { el } from "../ui/dom";
import { cdnOn, modelFor } from "../assets/cdn";
import type { Tier } from "../graphics/tiers";
import { t } from "../ui/i18n";
import { merge, part } from "./geo";

/** v7: a treasure's kind, by its index. */
export function kindOf(i: number): TreasureKind {
  return TREASURE_KINDS[((i % TREASURE_KINDS.length) + TREASURE_KINDS.length) % TREASURE_KINDS.length];
}

export interface TreasureViewOptions {
  hud: Hud;
  sound: Sound | null;
  /** Your body's index. */
  me: number;
  /** The UI layer (the upload panel goes there). */
  layer: HTMLElement;
  /** Graphics tier: Medium and up draw the boxes as a scanned CC0 chest (the site's model library). */
  tier: Tier;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _up = new Vector3(0, 1, 0);
const _e = new Euler();

/** v7: what each kind of treasure is called (the feed). */
export const TREASURE_KIND_NAME: Record<TreasureKind, string> = {
  diamond: "the diamond", gold: "the gold bars", silver: "the silver bars", emerald: "the emerald", ruby: "the ruby",
  sapphire: "the sapphire", pearl: "the pearls", crown: "the crown", amethyst: "the amethyst",
};

/** Boxes drawn within this of the camera. */
const BOX_RANGE = 140;
/** The machine's body drawn within this; its beacon always. */
const MACHINE_RANGE = 260;
/** v7: a find hangs over its chest this long (rising, then bobbing) before it goes with its finder. */
const RISE_S = 2.4;
const MAX_GLOWS = 16;
/** v7: a closed box's orbit drawn within this, when the eye can see it (checked every SIGHT_EVERY s a box). */
const ORBIT_RANGE = 35;
const SIGHT_EVERY = 0.3;
const MAX_ORBITS = 8;

// ── The things ──────────────────────────────────────────────────────────────

/** A wooden chest with iron bands and a brass lock; `open` lies its lid back. */
export function chestGeometry(open: boolean): BufferGeometry {
  const wood = 0x6b4426;
  const dark = 0x4a2e19;
  const iron = 0x2a2b2e;
  const brass = 0xc9a03a;
  const parts = [
    part(new BoxGeometry(0.72, 0.34, 0.44), wood, { p: [0, 0.17, 0] }),
    part(new BoxGeometry(0.74, 0.04, 0.46), dark, { p: [0, 0.02, 0] }),
    // Bands round the body.
    part(new BoxGeometry(0.05, 0.35, 0.455), iron, { p: [-0.24, 0.175, 0] }),
    part(new BoxGeometry(0.05, 0.35, 0.455), iron, { p: [0.24, 0.175, 0] }),
    // Corners.
    ...[-0.355, 0.355].flatMap((x) => [-0.215, 0.215].map((z) => part(new BoxGeometry(0.035, 0.36, 0.035), iron, { p: [x, 0.18, z] }))),
  ];
  // The lid: a half barrel, hinged at the back.
  const lid = [
    part(new CylinderGeometry(0.22, 0.22, 0.72, 10, 1, false, 0, Math.PI), wood, { r: [0, 0, Math.PI / 2], p: [0, 0, 0] }, 1.08),
    part(new CylinderGeometry(0.228, 0.228, 0.05, 10, 1, false, 0, Math.PI), iron, { r: [0, 0, Math.PI / 2], p: [-0.24, 0, 0] }),
    part(new CylinderGeometry(0.228, 0.228, 0.05, 10, 1, false, 0, Math.PI), iron, { r: [0, 0, Math.PI / 2], p: [0.24, 0, 0] }),
    part(new BoxGeometry(0.1, 0.12, 0.03), brass, { p: [0, -0.02, 0.225] }),
  ];
  // Closed: the lid sits on the body. Open: swung back 110° round the back edge.
  const lidGeo = merge(lid);
  if (open) {
    lidGeo.translate(0, 0, 0.22);
    lidGeo.applyMatrix4(new Matrix4().makeRotationX(-1.9));
    lidGeo.translate(0, 0.34, -0.22);
  } else lidGeo.translate(0, 0.34, 0);
  parts.push(lidGeo);
  if (open) parts.push(part(new BoxGeometry(0.64, 0.02, 0.36), 0x1a120b, { p: [0, 0.33, 0] }));
  else parts.push(part(new BoxGeometry(0.1, 0.12, 0.03), brass, { p: [0, 0.31, 0.225] }));
  return merge(parts);
}

/** v7 (H3): each treasure's model, about 0.3 m across, resting on y 0; and how it glows (its material's emissive). */
function kindGeometry(k: TreasureKind): BufferGeometry {
  const bars = (c: number) =>
    merge([
      ...[-0.052, 0.052].map((x) => part(new CylinderGeometry(0.05, 0.068, 0.07, 4, 1).rotateY(Math.PI / 4), c, { p: [x, 0.035, 0], s: [1, 1, 1.9] })),
      part(new CylinderGeometry(0.05, 0.068, 0.07, 4, 1).rotateY(Math.PI / 4), c, { p: [0, 0.105, 0], r: [0, Math.PI / 2, 0], s: [1, 1, 1.9] }, 1.1),
    ]);
  const brilliant = (c: number, r: number) =>
    merge([
      part(new CylinderGeometry(r, 0, r * 1.25, 8, 1), c, { p: [0, r * 0.625, 0] }),
      part(new CylinderGeometry(r * 0.62, r, r * 0.42, 8, 1), c, { p: [0, r * 1.46, 0] }, 1.15),
    ]);
  const step = (c: number) =>
    merge([
      part(new CylinderGeometry(0.1, 0.1, 0.26, 8, 1).rotateY(Math.PI / 8), c, { p: [0, 0.13, 0], s: [1, 1, 0.62] }),
      part(new CylinderGeometry(0.075, 0.075, 0.27, 8, 1).rotateY(Math.PI / 8), c, { p: [0, 0.13, 0.02], s: [1, 1, 0.62] }, 1.3),
    ]);
  switch (k) {
    case "diamond": return brilliant(0xd8f2ff, 0.15);
    case "gold": return bars(0xffc83a);
    case "silver": return bars(0xd9dde2);
    case "emerald": return step(0x1fbf6a);
    case "ruby": return merge([part(new IcosahedronGeometry(0.13, 0), 0xe0203a, { p: [0, 0.13, 0], s: [1, 1.15, 1] })]);
    case "sapphire": return merge([part(new IcosahedronGeometry(0.13, 0), 0x2050e0, { p: [0, 0.13, 0], s: [1, 1.15, 1] })]);
    case "pearl": return merge([part(new IcosahedronGeometry(0.12, 2), 0xf4efe6, { p: [0, 0.12, 0] })]);
    case "amethyst": return step(0x9a4ae0);
    case "crown":
      return merge([
        part(new CylinderGeometry(0.14, 0.14, 0.08, 12, 1, true), 0xffc83a, { p: [0, 0.04, 0] }),
        ...[0, 1, 2, 3, 4].map((j) => part(new CylinderGeometry(0, 0.035, 0.1, 4), 0xffc83a, { p: [Math.cos((j / 5) * Math.PI * 2) * 0.13, 0.13, Math.sin((j / 5) * Math.PI * 2) * 0.13] })),
        part(new IcosahedronGeometry(0.03, 0), 0xe0203a, { p: [0, 0.05, 0.14] }),
      ]);
  }
}
const KIND_GLOW: Record<TreasureKind, number> = {
  diamond: 0x4a6a8a, gold: 0x7a4a00, silver: 0x4a4f55, emerald: 0x0a5a2a, ruby: 0x6a0a14, sapphire: 0x0a1a6a, pearl: 0x5a5650, crown: 0x7a4a00, amethyst: 0x3a1060,
};
/** v7: a treasure's colour on the HUD's strip and the light it rises in. */
export const KIND_COLOUR: Record<TreasureKind, string> = {
  diamond: "#cfefff", gold: "#ffc83a", silver: "#d9dde2", emerald: "#2fd47e", ruby: "#f0304a", sapphire: "#4a7af0", pearl: "#f4efe6", crown: "#ffc83a", amethyst: "#b06af0",
};
/** v7: a treasure's icon (the HUD's strip), 24 × 24. */
export function kindIcon(k: TreasureKind, size = 22): string {
  const c = KIND_COLOUR[k];
  const body =
    k === "diamond" ? `<path d="M6 4h12l4 5-10 12L2 9z" fill="${c}"/><path d="M2 9h20M9 4l3 5 3-5M7 9l5 12 5-12" fill="none" stroke="#6f9fbf" stroke-width="1"/>` :
    k === "gold" || k === "silver" ? `<path d="M2 20l2-5h7l2 5zM11 20l2-5h7l2 5zM6.5 14l2-5h7l2 5z" fill="${c}" stroke="#0006" stroke-width=".8"/>` :
    k === "emerald" || k === "amethyst" ? `<path d="M8 3h8l4 4v10l-4 4H8l-4-4V7z" fill="${c}"/><path d="M9.5 6.5h5l2 2v7l-2 2h-5l-2-2v-7z" fill="#fff" opacity=".35"/>` :
    k === "pearl" ? `<circle cx="12" cy="12" r="8" fill="${c}"/><circle cx="9.5" cy="9.5" r="2.5" fill="#fff"/>` :
    k === "crown" ? `<path d="M3 18l1-10 5 4 3-7 3 7 5-4 1 10z" fill="${c}" stroke="#0006" stroke-width=".8"/>` :
    `<path d="M12 2l9 5v10l-9 5-9-5V7z" fill="${c}"/><path d="M12 6l5 3v6l-5 3-5-3V9z" fill="#fff" opacity=".3"/>`;
  return `<svg class="ico tk" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** The upload machine: an ATM-like kiosk on a plinth, scanner posts either side. Faces +z. */
function machineGeometry(): BufferGeometry {
  const steel = 0x8f979f;
  const gun = 0x2b2f35;
  const black = 0x15181c;
  return merge([
    part(new BoxGeometry(2.6, 0.16, 1.6), 0x8a8780, { p: [0, 0.08, 0] }),
    part(new BoxGeometry(1.0, 1.85, 0.78), gun, { p: [0, 0.16 + 0.925, -0.05] }),
    // The steel fascia, the screen's hood, the shelf and keypad.
    part(new BoxGeometry(0.9, 1.25, 0.04), steel, { p: [0, 0.16 + 0.95, 0.35] }),
    part(new BoxGeometry(0.82, 0.08, 0.2), black, { p: [0, 1.66, 0.42] }),
    part(new BoxGeometry(0.78, 0.05, 0.32), steel, { p: [0, 0.98, 0.5] }, 0.9),
    part(new BoxGeometry(0.3, 0.04, 0.2), black, { p: [0.15, 1.02, 0.5], r: [0.25, 0, 0] }),
    part(new BoxGeometry(0.16, 0.035, 0.03), black, { p: [-0.22, 0.86, 0.38] }),
    part(new BoxGeometry(0.34, 0.03, 0.03), black, { p: [0, 0.6, 0.38] }),
    // The header.
    part(new BoxGeometry(1.08, 0.36, 0.86), black, { p: [0, 2.2, -0.04] }),
    // The scanner posts.
    ...[-1.15, 1.15].flatMap((x) => [
      part(new BoxGeometry(0.14, 2.1, 0.14), gun, { p: [x, 1.21, 0.2] }),
      part(new BoxGeometry(0.2, 0.08, 0.2), black, { p: [x, 2.3, 0.2] }),
    ]),
  ]);
}

/** The machine's lit parts (unlit material): the header's sign, the card slot, the posts' strips. */
function machineLitGeometry(): BufferGeometry {
  return merge([
    part(new BoxGeometry(0.98, 0.12, 0.01), 0x38d6ff, { p: [0, 2.2, 0.395] }),
    part(new BoxGeometry(0.12, 0.012, 0.01), 0x59ff8e, { p: [-0.22, 0.86, 0.397] }),
    ...[-1.15, 1.15].map((x) => part(new BoxGeometry(0.03, 1.8, 0.01), 0x38d6ff, { p: [x, 1.2, 0.275] })),
  ]);
}

// ── Shaders ─────────────────────────────────────────────────────────────────

const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
/** The kiosk's screen: a grid, a scan line, a radar sweep; the upload's bar; green while it uploads. */
const SCREEN_FRAG = /* glsl */ `
uniform float time;
uniform float prog;
uniform float act;
varying vec2 vUv;
void main() {
  vec3 tint = mix(vec3(0.2, 0.8, 1.0), vec3(0.35, 1.0, 0.5), act);
  vec3 col = mix(vec3(0.015, 0.05, 0.1), vec3(0.015, 0.08, 0.04), act);
  vec2 g = abs(fract(vUv * vec2(16.0, 12.0)) - 0.5);
  col += tint * smoothstep(0.46, 0.5, max(g.x, g.y)) * 0.18;
  float s = fract(time * (0.4 + act * 0.8));
  col += tint * exp(-abs(vUv.y - (1.0 - s)) * 40.0) * 0.8;
  vec2 c = vUv - vec2(0.5, 0.6);
  c.x *= 1.35;
  float w = fract(time * 0.6);
  col += tint * smoothstep(0.012, 0.0, abs(length(c) - w * 0.35)) * (1.0 - w);
  float bar = step(0.12, vUv.x) * step(vUv.x, 0.88) * step(0.1, vUv.y) * step(vUv.y, 0.18);
  col += tint * bar * 0.12 + vec3(0.4, 1.0, 0.5) * bar * step(vUv.x, 0.12 + 0.76 * prog);
  col *= 0.85 + 0.15 * sin(vUv.y * 300.0);
  gl_FragColor = vec4(col, 1.0);
}`;

const FLAT_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
/** The ring: dashes that turn; the arc so far of an upload, bright green; `state` 0 idle, 1 someone near, 2 uploading. */
const RING_FRAG = /* glsl */ `
uniform float time;
uniform float prog;
uniform float state;
uniform float rad;
varying vec2 vP;
void main() {
  float a = atan(vP.y, vP.x) / 6.2831853 + 0.5;
  float r = length(vP) / rad;
  vec3 tint = state > 1.5 ? vec3(0.35, 1.0, 0.5) : state > 0.5 ? vec3(1.0, 0.72, 0.2) : vec3(0.2, 0.8, 1.0);
  float dash = step(0.35, fract(a * 36.0 + time * (0.15 + state * 0.2)));
  float edge = smoothstep(0.0, 0.25, 1.0 - abs(r - 0.985) / 0.015);
  float done = step(a, prog) * step(1.5, state);
  vec3 col = tint * (0.35 + 0.65 * dash) * edge + vec3(0.35, 1.0, 0.5) * done * edge * 1.2;
  col *= 0.75 + 0.25 * sin(time * 4.0);
  gl_FragColor = vec4(col, 1.0);
}`;
/** The ground inside the ring: a scan wave going out, faint. */
const DISC_FRAG = /* glsl */ `
uniform float time;
uniform float state;
uniform float rad;
varying vec2 vP;
void main() {
  float r = length(vP) / rad;
  vec3 tint = state > 1.5 ? vec3(0.35, 1.0, 0.5) : state > 0.5 ? vec3(1.0, 0.72, 0.2) : vec3(0.2, 0.8, 1.0);
  float w = fract(time * (0.35 + state * 0.25));
  float wave = smoothstep(0.06, 0.0, abs(r - w)) * (1.0 - w);
  float rim = smoothstep(0.6, 1.0, r) * 0.18;
  gl_FragColor = vec4(tint * (wave * 0.5 + rim) * (1.0 - smoothstep(0.98, 1.0, r)), 1.0);
}`;

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vC;
void main() {
  vUv = uv;
  vC = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
/** A column of light: bright at the foot, gone by the top (its colour carries its strength). */
const COLUMN_FRAG = /* glsl */ `
uniform float time;
varying vec2 vUv;
varying vec3 vC;
void main() {
  float up = pow(1.0 - vUv.y, 2.4);
  float band = 0.75 + 0.25 * sin(vUv.y * 22.0 - time * 3.0);
  gl_FragColor = vec4(vC * up * band * 0.6, 1.0);
}`;
/**
 * v7: a box's shining orbit: a thin ring with three comets of light racing round it, crackling. Per instance: r the
 * phase, g the speed, b the strength (it fades with distance).
 */
const ORBIT_FRAG = /* glsl */ `
uniform float time;
varying vec2 vUv;
varying vec3 vC;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float ring = exp(-pow((r - 0.8) / 0.04, 2.0));
  float sp = 2.0 + vC.g * 1.6;
  float glow = 0.0;
  for (int k = 0; k < 3; k++) {
    float head = time * sp + vC.r * 6.2831853 + float(k) * 2.0943951;
    float da = mod(head - a, 6.2831853);
    glow += exp(-da * 2.4);
  }
  float n = fract(sin(dot(floor(vec2(a * 24.0, time * 14.0)), vec2(12.9898, 78.233))) * 43758.5453);
  vec3 col = mix(vec3(1.0, 0.72, 0.25), vec3(1.0, 0.95, 0.75), glow) * ring * (0.2 + 2.4 * glow) * (0.75 + 0.5 * n);
  gl_FragColor = vec4(col * vC.b, 1.0);
}`;
const BEACON_FRAG = /* glsl */ `
uniform float time;
uniform vec3 tint;
varying vec2 vUv;
void main() {
  float up = pow(1.0 - vUv.y, 1.6);
  float band = 0.8 + 0.2 * sin(vUv.y * 60.0 - time * 4.0);
  gl_FragColor = vec4(tint * up * band * 0.5, 1.0);
}`;
const BEACON_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function glowMaterial(vert: string, frag: string, uniforms: Record<string, { value: unknown }>): ShaderMaterial {
  return new ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true });
}

function instanced(geo: BufferGeometry, mat: Material, n: number, colours = false): InstancedMesh {
  const m = new InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(DynamicDrawUsage);
  m.count = 0;
  m.frustumCulled = false;
  if (colours) {
    for (let i = 0; i < n; i++) m.setColorAt(i, _c.setRGB(0, 0, 0));
    m.instanceColor!.setUsage(DynamicDrawUsage);
  }
  return m;
}

/** A moment of light: a box that held a treasure, a body that dropped some. */
interface Flash {
  x: number;
  y: number;
  z: number;
  at: number;
  life: number;
  r: number;
}

/** A treasure in the air after its carrier fell: from the body to where it lands. */
interface Fall {
  x: number;
  y: number;
  z: number;
  at: number;
}

export class TreasureView {
  readonly group = new Group();
  private readonly o: TreasureViewOptions;
  private readonly closed: InstancedMesh;
  private readonly opened: InstancedMesh;
  /** v7 (H3): one model a treasure, by its index (hidden unless out). */
  private readonly relics: Mesh[] = [];
  private readonly relicMats: Material[] = [];
  private readonly columns: InstancedMesh;
  private readonly glowRings: InstancedMesh;
  /** v7 (H3): finds rising over their chests: treasure index → when, and the box. */
  private readonly rising = new Map<number, { at: number; box: number }>();
  /** v7 (H3): the strip of the five (which you and your squad carry). */
  private readonly carry = el("div", "tr-carry");
  private carrySig = "";
  /** v7: the closed boxes' orbits, close up. */
  private readonly orbits: InstancedMesh;
  /** v7: per box, when its line of sight was last checked and whether it was clear. */
  private sightAt = new Float64Array(0);
  private sightOk = new Uint8Array(0);
  private readonly machine = new Group();
  private readonly beacon: Mesh;
  private readonly screenMat: ShaderMaterial;
  private readonly ringMat: ShaderMaterial;
  private readonly discMat: ShaderMaterial;
  private readonly mats: ShaderMaterial[] = [];
  private readonly flashes: Flash[] = [];
  private readonly falls = new Map<number, Fall>();
  private placed = false;
  /** v5 (3.7): the boxes are the scanned chest (an opened one is gone: you can't see into a scan). */
  private scanned = false;
  private gone = false;
  private time = 0;
  /** The upload panel (middle of the screen) and what it shows now. */
  private readonly panel = el("div", "tr-upload");
  private readonly panelTitle = el("b");
  private readonly panelFill = el("i");
  private readonly panelPct = el("span", "pct");
  private readonly panelNote = el("small");
  private panelSig = "";
  private beepAt = 0;
  /** v6: rivals already called out as carrying all but one (once each). */
  private readonly warned = new Set<number>();

  constructor(o: TreasureViewOptions) {
    this.o = o;
    const solid = new MeshLambertMaterial({ vertexColors: true });
    this.closed = instanced(chestGeometry(false), solid, TREASURE.boxes + 8);
    this.opened = instanced(chestGeometry(true), solid, TREASURE.boxes + 8);
    for (const k of TREASURE_KINDS) {
      const mat = new MeshLambertMaterial({ vertexColors: true, emissive: KIND_GLOW[k] });
      this.relicMats.push(mat);
      const r = new Mesh(kindGeometry(k), mat);
      r.visible = false;
      this.relics.push(r);
    }
    const time = { value: 0 };
    const col = glowMaterial(GLOW_VERT, COLUMN_FRAG, { time });
    const ring = glowMaterial(GLOW_VERT, `uniform float time;\nvarying vec2 vUv;\nvarying vec3 vC;\nvoid main(){ gl_FragColor = vec4(vC * (0.8 + 0.2 * sin(time * 5.0)), 1.0); }`, { time });
    this.mats.push(col, ring);
    this.columns = instanced(new CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0), col, MAX_GLOWS, true);
    this.glowRings = instanced(new RingGeometry(0.9, 1, 40, 1).rotateX(-Math.PI / 2), ring, MAX_GLOWS, true);
    const orbit = glowMaterial(GLOW_VERT, ORBIT_FRAG, { time });
    this.mats.push(orbit);
    this.orbits = instanced(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), orbit, MAX_ORBITS * 2, true);
    this.group.add(this.closed, this.opened, ...this.relics, this.columns, this.glowRings, this.orbits);
    // v5 (3.7, realism): Medium and up, the scanned metal chest from the model library (CC0, Poly Haven) when the site has it.
    if (o.tier >= 1 && cdnOn()) {
      void modelFor("prop", 1, o.tier, "metal_tool_chest").then((m) => {
        if (!m || this.gone) return;
        const g = m.geometry.clone();
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        const k = 0.78 / Math.max(0.05, bb.max.x - bb.min.x, bb.max.z - bb.min.z);
        g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        g.scale(k, k, k);
        this.closed.geometry.dispose();
        this.closed.geometry = g;
        this.closed.material = m.material;
        this.scanned = true;
      });
    }

    // The machine.
    const body = new Mesh(machineGeometry(), new MeshLambertMaterial({ vertexColors: true }));
    const lit = new Mesh(machineLitGeometry(), new MeshBasicMaterial({ vertexColors: true }));
    this.screenMat = new ShaderMaterial({ uniforms: { time, prog: { value: 0 }, act: { value: 0 } }, vertexShader: SCREEN_VERT, fragmentShader: SCREEN_FRAG });
    const screen = new Mesh(new PlaneGeometry(0.66, 0.5), this.screenMat);
    screen.position.set(0, 1.32, 0.375);
    screen.rotation.x = -0.12;
    const rad = { value: TREASURE.ring };
    this.ringMat = glowMaterial(FLAT_VERT, RING_FRAG, { time, prog: { value: 0 }, state: { value: 0 }, rad });
    this.discMat = glowMaterial(FLAT_VERT, DISC_FRAG, { time, state: { value: 0 }, rad });
    const ringMesh = new Mesh(new RingGeometry(TREASURE.ring - 0.35, TREASURE.ring, 128, 1).rotateX(-Math.PI / 2), this.ringMat);
    const disc = new Mesh(new CircleGeometry(TREASURE.ring, 64).rotateX(-Math.PI / 2), this.discMat);
    ringMesh.position.y = 0.07;
    disc.position.y = 0.05;
    ringMesh.renderOrder = disc.renderOrder = 2;
    this.machine.add(body, lit, screen, ringMesh, disc);
    this.beacon = new Mesh(
      // From above the header up: it marks the spot from afar without hiding the kiosk close up.
      new CylinderGeometry(0.3, 0.45, 140, 12, 1, true).translate(0, 72.6, 0),
      glowMaterial(BEACON_VERT, BEACON_FRAG, { time, tint: { value: new Color(0.2, 0.8, 1.0) } }),
    );
    this.mats.push(this.screenMat, this.ringMat, this.discMat, this.beacon.material as ShaderMaterial);
    this.machine.visible = this.beacon.visible = false;
    this.group.add(this.machine, this.beacon);

    this.panel.dataset.ui = "1";
    const bar = el("div", "bar");
    bar.append(this.panelFill);
    const head = el("div", "head");
    head.append(this.panelTitle, this.panelPct);
    this.panel.append(head, bar, this.panelNote);
    o.layer.append(this.panel);
    this.carry.dataset.ui = "1";
    o.layer.append(this.carry);
  }

  private tm(m: Match): TreasureModule | null {
    return m.module<TreasureModule>("treasure");
  }

  /** The match's events since the last frame. */
  events(list: readonly MatchEvent[], m: Match, cam: Vector3): void {
    const tm = this.tm(m);
    if (!tm) return;
    const me = m.contestants[this.o.me];
    const hud = this.o.hud;
    const near = (x: number, z: number, range: number) => Math.max(0, 1 - Math.hypot(x - cam.x, z - cam.z) / range);
    const who = (id: string | null | undefined) => (id ? (m.get(id) ?? null) : null);
    let dropped: { name: string; n: number; mine: boolean } | null = null;
    for (const e of list) {
      if (e.type === "tbox") {
        const c = who(e.id);
        const b = tm.boxes[e.box];
        if (e.found >= 0 && b) {
          this.flashes.push({ x: b.x, y: b.h, z: b.z, at: this.time, life: 2.2, r: 0.7 });
          this.o.sound?.treasure(c === me, near(b.x, b.z, 70));
          // v7 (H3): it rises out of the chest; the feed names it. (The count is read after the "tre" that follows.)
          this.rising.set(e.found, { at: this.time, box: e.box });
          const what = t(TREASURE_KIND_NAME[kindOf(e.found)]);
          if (c === me) {
            const n = Math.min(tm.need, tm.count[me.index] + (tm.treasures[e.found]?.holder === me.index ? 0 : 1));
            hud.pushFeed(`${t("You found")} ${what}! ${n}/${tm.need}`, "safe");
            this.o.sound?.voice.say(n >= tm.need ? "tre_all" : "tre_found");
          }
          else if (c) hud.pushFeed(`${c.name} ${t("found")} ${what}`, m.sameSquad(c, me) ? "safe" : "info");
        } else if (c === me) {
          this.o.sound?.empty();
          hud.pushFeed(t("Empty box"));
        }
      } else if (e.type === "tre") {
        const c = who(e.id);
        if (e.how === "drop") {
          // They burst out of the body and fall round it.
          this.falls.set(e.t, { x: c?.x ?? e.x, y: (c?.h ?? e.h) + 1.2, z: c?.z ?? e.z, at: this.time });
          if (!dropped && c) dropped = { name: c.name, n: 0, mine: c === me };
          if (dropped) dropped.n++;
          if (dropped?.n === 1) this.flashes.push({ x: e.x, y: e.h, z: e.z, at: this.time, life: 1.6, r: 2.4 });
        } else if (e.how === "take") {
          if (c === me) {
            this.o.sound?.treasure(true);
            hud.pushFeed(`${t("You took")} ${t(TREASURE_KIND_NAME[kindOf(e.t)])}! ${tm.count[me.index]}/${tm.need}`, "safe");
            if (tm.count[me.index] >= tm.need) this.o.sound?.voice.say("tre_all");
          }
        } else if (e.how === "give") {
          if (c === me) hud.pushFeed(t("A squad mate handed you a treasure"), "safe");
          else if (c && m.sameSquad(c, me)) hud.pushFeed(t("Treasure handed to your leader"), "safe");
        }
      } else if (e.type === "upl") {
        const c = who(e.id);
        if (!c) continue;
        if (e.how === "start") {
          this.o.sound?.zoneAlert();
          this.o.sound?.voice.say(c === me ? "tre_upload" : m.sameSquad(c, me) ? "tre_upload" : "tre_enemy_upload");
          if (c === me) hud.pushFeed(t("Uploading: stay in the ring"), "safe");
          else hud.pushFeed(`${m.sameSquad(c, me) ? t("Your leader") : c.name} ${t("is uploading the treasures")}${m.sameSquad(c, me) ? "" : `: ${t("stop them")}`}`, m.sameSquad(c, me) ? "safe" : "out");
        } else if (e.how === "stop") {
          if (c === me) hud.pushFeed(t("Upload stopped"), "out");
          else if (!m.sameSquad(c, me)) hud.pushFeed(t("Their upload was stopped"), "safe");
        } else this.o.sound?.uploadBeep(1, true);
      }
    }
    if (dropped) {
      this.o.sound?.treasure(false, 0.6);
      if (dropped.mine) this.o.sound?.voice.say("tre_lost");
      hud.pushFeed(dropped.mine ? t("You dropped your treasures") : `${dropped.name} ${t("dropped")} ${dropped.n} ${dropped.n === 1 ? t("treasure") : t("treasures")}`, dropped.mine ? "out" : "info");
    }
  }

  /** What interact would do here: open a box (held), or what the ring needs. */
  target(m: Match): (NonNullable<PlayHudState["target"]> & { d: number }) | null {
    const tm = this.tm(m);
    const me = m.contestants[this.o.me];
    if (!tm || me.status !== "alive" || m.phase !== "play") return null;
    if (tm.inRing(me)) {
      const lead = tm.leaderOf(m, m.squads[me.index]);
      const label =
        tm.uploader === me.index ? t("Uploading… stay in the ring") :
        lead !== me.index && m.contestants.some((c) => m.squads[c.index] === m.squads[me.index] && c !== me) ? t("Only your leader can upload") :
        tm.count[me.index] < tm.need ? `${t("Need all")} ${tm.need} ${t("treasures")} (${tm.count[me.index]}/${tm.need})` : t("Uploading…");
      return { kind: "job", label, ico: "upload", progress: tm.uploader === me.index ? tm.uploaded / tm.uploadTime : 0, d: 0 };
    }
    const b = tm.boxFor(me);
    if (!b) return null;
    return { kind: "job", label: t("Hold to open the box"), ico: "chest", progress: tm.opening(me.index), d: Math.hypot(b.x - me.x, b.z - me.z) };
  }

  /** The objective line (top centre). */
  objectiveLine(m: Match): string {
    const tm = this.tm(m);
    if (!tm) return "";
    const me = m.contestants[this.o.me];
    const squad = (q: number) => m.contestants.reduce((a, c) => a + (m.squads[c.index] === q ? tm.count[c.index] : 0), 0);
    let best = 0;
    for (const q of new Set(m.squads)) if (q !== m.squads[me.index]) best = Math.max(best, squad(q));
    const mine = squad(m.squads[me.index]);
    if (tm.uploader === me.index) return t("Uploading: stay in the ring");
    if (tm.uploader >= 0 && tm.uploader !== me.index) {
      const c = m.contestants[tm.uploader];
      return m.sameSquad(c, me) ? t("Protect your leader at the machine") : `${t("Stop the upload at the machine")}!`;
    }
    if (mine >= tm.need) return t("All treasures found: get to the machine");
    return `${t("Treasures")}: ${t("you")} ${mine}/${tm.need} · ${t("best rival")} ${best}`;
  }

  /** Every frame. Returns the compass's pin. */
  update(dt: number, m: Match, camera: PerspectiveCamera, marks: MapMark[]): { pin: ItemPin | null } {
    const tm = this.tm(m);
    if (!tm) return { pin: null };
    this.time += dt;
    for (const mat of this.mats) if (mat.uniforms.time) mat.uniforms.time.value = this.time;
    const me = m.contestants[this.o.me];
    const cam = camera.position;
    const p = tm.machine;
    if (p && !this.placed) {
      this.placed = true;
      // Facing the middle of the world, where most come from.
      const b = m.world.space.bounds;
      const yaw = Math.atan2((b.x0 + b.x1) / 2 - p.x, (b.z0 + b.z1) / 2 - p.z);
      this.machine.position.set(p.x, p.h, p.z);
      this.machine.rotation.y = yaw;
      this.beacon.position.set(p.x, p.h, p.z);
      this.beacon.visible = true;
    }

    // ── Boxes ──
    let nc = 0;
    let no = 0;
    for (const b of tm.boxes) {
      const dx = b.x - cam.x;
      const dz = b.z - cam.z;
      if (dx * dx + dz * dz > BOX_RANGE * BOX_RANGE) continue;
      _m.compose(_p.set(b.x, b.h, b.z), _q.setFromAxisAngle(_up, b.index * 2.39), _s.set(1, 1, 1));
      if (!b.opened) this.closed.setMatrixAt(nc++, _m);
      else if (!this.scanned) this.opened.setMatrixAt(no++, _m);
    }
    this.closed.count = nc;
    this.opened.count = no;
    if (nc) this.closed.instanceMatrix.needsUpdate = true;
    if (no) this.opened.instanceMatrix.needsUpdate = true;

    // ── v7: a closed box's shining orbit, close up and in sight (no hint from far) ──
    if (this.sightAt.length !== tm.boxes.length) {
      this.sightAt = new Float64Array(tm.boxes.length).fill(-99);
      this.sightOk = new Uint8Array(tm.boxes.length);
    }
    let nr = 0;
    for (const b of tm.boxes) {
      if (b.opened || nr >= MAX_ORBITS * 2) continue;
      const d = Math.hypot(b.x - cam.x, b.z - cam.z);
      if (d >= ORBIT_RANGE) continue;
      if (this.time - this.sightAt[b.index] >= SIGHT_EVERY) {
        this.sightAt[b.index] = this.time;
        this.sightOk[b.index] = m.world.space.lineClear(cam.x, cam.z, b.x, b.z, b.h + 1) ? 1 : 0;
      }
      if (!this.sightOk[b.index]) continue;
      // Two rings of sparks round it, crossed and turning; fading in over the last 8 m.
      const k = Math.min(1, (ORBIT_RANGE - d) / 8);
      for (let j = 0; j < 2; j++) {
        _q.setFromEuler(_e.set(j ? 0.5 : -0.45, this.time * (j ? 0.7 : -0.5) + b.index, j ? 0.25 : -0.3));
        this.orbits.setMatrixAt(nr, _m.compose(_p.set(b.x, b.h + 0.3, b.z), _q, _s.set(1.5 + j * 0.25, 1, 1.5 + j * 0.25)));
        this.orbits.setColorAt(nr, _c.setRGB((b.index * 0.37 + j * 0.5) % 1, (b.index * 0.61) % 1, k));
        nr++;
      }
    }
    this.orbits.count = nr;
    if (nr) this.orbits.instanceMatrix.needsUpdate = this.orbits.instanceColor!.needsUpdate = true;

    // ── Relics, their light ──
    let nl = 0;
    const glow = (x: number, y: number, z: number, r: number, h: number, colour: string, k: number) => {
      if (nl >= MAX_GLOWS) return;
      _c.set(colour).multiplyScalar(k);
      this.columns.setMatrixAt(nl, _m.compose(_p.set(x, y, z), _q.identity(), _s.set(r, h, r)));
      this.columns.setColorAt(nl, _c);
      this.glowRings.setMatrixAt(nl, _m.compose(_p.set(x, y + 0.05, z), _q.identity(), _s.set(r * 1.6, 1, r * 1.6)));
      this.glowRings.setColorAt(nl, _c);
      nl++;
    };
    // v7 (H3): each treasure is its own model; hidden unless drawn this frame.
    for (const r of this.relics) r.visible = false;
    const gem = (i: number, x: number, y: number, z: number, s: number, spin: number) => {
      const r = this.relics[i % this.relics.length];
      r.visible = true;
      r.position.set(x, y, z);
      r.rotation.set(0, spin, 0);
      r.scale.setScalar(s);
    };
    let pin: ItemPin | null = null;
    let pinD = Infinity;
    const aim = (x: number, z: number, kind: ItemPin["kind"], weight = 0) => {
      const d = Math.hypot(x - me.x, z - me.z) + weight;
      if (d < pinD) {
        pinD = d;
        pin = { x, z, kind };
      }
    };
    const carriedBy = new Map<number, number>();
    for (const tr of tm.treasures) {
      // v7 (H3): a find rises out of its chest (ease out, then a bounce and a bob), turning, in its own light, before it
      // goes with its finder.
      const rise = this.rising.get(tr.index);
      if (rise) {
        const age = this.time - rise.at;
        const b = tm.boxes[rise.box];
        if (age >= RISE_S || !b) this.rising.delete(tr.index);
        else {
          const u = Math.min(1, age / 0.9);
          const up = 1 - (1 - u) * (1 - u) * (1 - u);
          const bounce = age > 0.9 ? Math.abs(Math.sin((age - 0.9) * 5)) * 0.18 * Math.exp(-(age - 0.9) * 2.2) : 0;
          const fade = age > RISE_S - 0.3 ? (RISE_S - age) / 0.3 : 1;
          gem(tr.index, b.x, b.h + 0.4 + up * 1.15 + bounce, b.z, (0.7 + 0.7 * up) * fade, age * 3.2);
          glow(b.x, b.h, b.z, 0.3, 6, KIND_COLOUR[kindOf(tr.index)], 0.55 * fade);
          continue;
        }
      }
      if (tr.box !== -1) continue;
      if (tr.holder >= 0) {
        const c = m.contestants[tr.holder];
        const k = carriedBy.get(tr.holder) ?? 0;
        carriedBy.set(tr.holder, k + 1);
        if (c === me || c.status !== "alive") continue;
        const dx = c.x - cam.x;
        const dz = c.z - cam.z;
        if (dx * dx + dz * dz > 60 * 60) continue;
        // Circling over the carrier's head.
        const a = this.time * 1.8 + (k * Math.PI * 2) / tm.need;
        gem(tr.index, c.x + Math.cos(a) * 0.45, c.h + c.y + 2.35, c.z + Math.sin(a) * 0.45, 0.75, a);
        continue;
      }
      // On the ground (or still falling there).
      const f = this.falls.get(tr.index);
      let x = tr.x;
      let y = tr.h + 0.55 + Math.sin(this.time * 2 + tr.index) * 0.08;
      let z = tr.z;
      if (f) {
        const u = (this.time - f.at) / 0.75;
        if (u >= 1) this.falls.delete(tr.index);
        else {
          x = f.x + (tr.x - f.x) * u;
          z = f.z + (tr.z - f.z) * u;
          y = f.y + (tr.h + 0.55 - f.y) * u + Math.sin(u * Math.PI) * 1.4;
        }
      }
      gem(tr.index, x, y - 0.15, z, 1.6, this.time * 1.5 + tr.index);
      glow(tr.x, tr.h, tr.z, 0.35, 26, "#ffb020", 1);
      marks.push({ x: tr.x, z: tr.z, kind: "flag" });
      aim(tr.x, tr.z, "flag");
    }
    // The moments of light.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      const u = (this.time - f.at) / f.life;
      if (u >= 1) {
        this.flashes.splice(i, 1);
        continue;
      }
      glow(f.x, f.y, f.z, f.r * (0.6 + u * 1.4), 18 * (1 - u * 0.5), "#ffd36a", (1 - u) * 0.9);
    }
    this.columns.count = this.glowRings.count = nl;
    if (nl) {
      this.columns.instanceMatrix.needsUpdate = this.glowRings.instanceMatrix.needsUpdate = true;
      this.columns.instanceColor!.needsUpdate = this.glowRings.instanceColor!.needsUpdate = true;
    }

    // ── The machine ──
    if (p) {
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      this.machine.visible = d < MACHINE_RANGE;
      const up = tm.uploader >= 0;
      const someoneNear = m.contestants.some((c) => c.status === "alive" && tm.inRing(c));
      const state = up ? 2 : someoneNear ? 1 : 0;
      const prog = up ? Math.min(1, tm.uploaded / tm.uploadTime) : 0;
      this.ringMat.uniforms.state.value = state;
      this.ringMat.uniforms.prog.value = prog;
      this.discMat.uniforms.state.value = state;
      this.screenMat.uniforms.act.value = up ? 1 : 0;
      this.screenMat.uniforms.prog.value = prog;
      (this.beacon.material as ShaderMaterial).uniforms.tint.value.setRGB(...((up ? [0.35, 1, 0.5] : someoneNear ? [1, 0.72, 0.2] : [0.2, 0.8, 1]) as [number, number, number]));
      marks.push({ x: p.x, z: p.z, kind: "goal", r: TREASURE.ring });
      // Carrying them all (or a squad's leader with them): the machine is where to go.
      const lead = tm.leaderOf(m, m.squads[me.index]);
      if (tm.count[me.index] >= tm.need || (up && tm.uploader !== me.index)) aim(p.x, p.z, "goal", -1000);
      else if (lead !== me.index && tm.count[me.index] > 0) {
        const l = m.contestants[lead];
        if (l && l.status === "alive") aim(l.x, l.z, "goal", -500);
      }
      if (up && tm.uploader !== me.index) marks.push({ x: p.x, z: p.z, kind: "ping" });
      // v6 (the owner said yes to the suggestion): a rival one treasure short of all of them shows on everyone's
      // map and compass, so the end of a match always has a fight. Called out once in the feed.
      for (const c of m.contestants) {
        if (c === me || c.status !== "alive" || m.sameSquad(c, me) || tm.count[c.index] < tm.need - 1) continue;
        // v6 max: camouflage hides even a carrier.
        if (m.module<GadgetsModule>("gadgets")?.camo(c.index)) continue;
        marks.push({ x: c.x, z: c.z, kind: "ping", label: c.name });
        aim(c.x, c.z, "hot", -200);
        if (!this.warned.has(c.index)) {
          this.warned.add(c.index);
          this.o.hud?.pushFeed(`${c.name} ${t("holds")} ${tm.count[c.index]}/${tm.need} ${t("treasures: on your compass")}`, "out");
          this.o.sound?.voice.say("tre_carrier");
        }
      }
      // A beep as the upload goes (yours, or near you).
      if (up && this.time - this.beepAt > 0.5 && (tm.uploader === me.index || d < 40)) {
        this.beepAt = this.time;
        this.o.sound?.uploadBeep(prog);
      }
      this.drawPanel(m, tm, prog);
    }
    this.drawCarry(m, tm);
    return { pin };
  }

  /** v7 (H3): the strip of the five: lit, you carry it; ringed, a squad mate does; dim, still out there. */
  private drawCarry(m: Match, tm: TreasureModule): void {
    const me = m.contestants[this.o.me];
    let sig = m.phase === "play" ? "p" : "";
    if (sig) for (const tr of tm.treasures) sig += tr.holder === me.index ? "2" : tr.holder >= 0 && m.sameSquad(m.contestants[tr.holder], me) ? "1" : "0";
    // v7 (H4): what the load costs you.
    const share = tm.speedShare(me.index);
    const laden = tm.laden(me.index);
    if (sig) sig += `|${share.toFixed(2)}|${laden ? 1 : 0}`;
    if (sig === this.carrySig) return;
    this.carrySig = sig;
    if (!sig) {
      this.carry.replaceChildren();
      return;
    }
    let html = "";
    tm.treasures.forEach((tr, j) => {
      const st = sig[j + 1];
      const k = kindOf(tr.index);
      html += `<i class="tk-slot${st === "2" ? " mine" : st === "1" ? " mate" : ""}" role="img" aria-label="${t(TREASURE_KIND_NAME[k])}${st === "2" ? `: ${t("you carry it")}` : st === "1" ? `: ${t("your squad carries it")}` : ""}">${kindIcon(k)}</i>`;
    });
    if (share < 1) {
      const cost = `−${Math.round((1 - share) * 100)}%`;
      html += `<b class="tr-heavy${laden ? " laden" : ""}" role="img" aria-label="${t("Heavy loot")}: ${cost}${laden ? `, ${t("no sprint")}` : ""}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7a3 3 0 1 1 6 0M5.5 9h13l2 11h-17z"/></svg>${cost}${laden ? `<small>${t("no sprint")}</small>` : ""}</b>`;
    }
    this.carry.innerHTML = html;
  }

  /** The upload panel in the middle of the screen: yours (green), a rival's (red), a mate's. */
  private drawPanel(m: Match, tm: TreasureModule, prog: number): void {
    const me = m.contestants[this.o.me];
    const up = tm.uploader;
    const c = up >= 0 ? m.contestants[up] : null;
    const mine = c === me;
    const mate = !!c && !mine && m.sameSquad(c, me);
    const sig = c ? `${mine ? "me" : mate ? "mate" : "rival"}` : "";
    if (sig !== this.panelSig) {
      this.panelSig = sig;
      this.panel.className = `tr-upload${c ? ` on ${sig}` : ""}`;
      this.panelTitle.textContent = mine ? t("Uploading treasures") : mate ? t("Your leader is uploading") : c ? `${c.name} ${t("is uploading")}` : "";
      this.panelNote.textContent = mine ? t("Stay in the ring. If you die, you lose them all.") : mate ? t("Protect them") : t("Stop them before it finishes");
    }
    if (c) {
      this.panelFill.style.transform = `scaleX(${prog.toFixed(3)})`;
      const pct = `${Math.floor(prog * 100)}%`;
      if (this.panelPct.textContent !== pct) this.panelPct.textContent = pct;
    }
  }

  /** A Map Print's marks: every chest not yet opened, and (starred, named) the ones a treasure is in. */
  printMarks(m: Match, marks: MapMark[]): void {
    const tm = this.tm(m);
    if (!tm) return;
    const real = new Set<number>();
    for (const tr of tm.treasures) if (tr.box >= 0) real.add(tr.box);
    for (const b of tm.boxes) {
      if (b.opened) continue;
      if (real.has(b.index)) marks.push({ x: b.x, z: b.z, kind: "treasure", label: t("Treasure") });
      else marks.push({ x: b.x, z: b.z, kind: "chest" });
    }
    for (const tr of tm.treasures) if (tr.holder >= 0 && tr.holder !== this.o.me) marks.push({ x: tr.x, z: tr.z, kind: "treasure" });
  }

  /** Does body i carry them all (marked over the head from far, like a flag's holder)? */
  carriesAll(m: Match, i: number): boolean {
    const tm = this.tm(m);
    return !!tm && tm.count[i] >= tm.need;
  }

  dispose(): void {
    this.gone = true;
    for (const r of this.relics) r.geometry.dispose();
    for (const mat of this.relicMats) mat.dispose();
    for (const mesh of [this.closed, this.opened, this.columns, this.glowRings, this.orbits]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    // The chests' own material (the scanned chest's belongs to the model library's cache: not ours to free).
    (this.opened.material as Material).dispose();
    this.machine.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
    });
    this.beacon.geometry.dispose();
    for (const mat of this.mats) mat.dispose();
    this.panel.remove();
    this.carry.remove();
  }
}
