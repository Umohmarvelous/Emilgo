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

import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
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

import { TREASURE } from "../config";
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

/** Boxes drawn within this of the camera. */
const BOX_RANGE = 140;
/** The machine's body drawn within this; its beacon always. */
const MACHINE_RANGE = 260;
const MAX_GEMS = 12;
const MAX_GLOWS = 16;

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

/** The relic: a cut gold gem on a small gold collar. */
function gemGeometry(): BufferGeometry {
  return merge([
    part(new IcosahedronGeometry(0.2, 0), 0xffc83a, { s: [1, 1.35, 1] }),
    part(new CylinderGeometry(0.13, 0.13, 0.04, 12), 0xd99a1e, { p: [0, 0, 0] }, 0.9),
  ]);
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
  private readonly gems: InstancedMesh;
  private readonly columns: InstancedMesh;
  private readonly glowRings: InstancedMesh;
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
    this.gems = instanced(gemGeometry(), new MeshLambertMaterial({ vertexColors: true, emissive: 0x7a4a00 }), MAX_GEMS);
    const time = { value: 0 };
    const col = glowMaterial(GLOW_VERT, COLUMN_FRAG, { time });
    const ring = glowMaterial(GLOW_VERT, `uniform float time;\nvarying vec2 vUv;\nvarying vec3 vC;\nvoid main(){ gl_FragColor = vec4(vC * (0.8 + 0.2 * sin(time * 5.0)), 1.0); }`, { time });
    this.mats.push(col, ring);
    this.columns = instanced(new CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0), col, MAX_GLOWS, true);
    this.glowRings = instanced(new RingGeometry(0.9, 1, 40, 1).rotateX(-Math.PI / 2), ring, MAX_GLOWS, true);
    this.group.add(this.closed, this.opened, this.gems, this.columns, this.glowRings);
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
          if (c === me) {
            hud.pushFeed(`${t("Treasure found")}! ${tm.count[me.index]}/${tm.need}`, "safe");
            this.o.sound?.voice.say(tm.count[me.index] >= tm.need ? "tre_all" : "tre_found");
          }
          else if (c) hud.pushFeed(`${c.name} ${t("found a treasure")}`, m.sameSquad(c, me) ? "safe" : "info");
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
            hud.pushFeed(`${t("Treasure taken")}! ${tm.count[me.index]}/${tm.need}`, "safe");
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

    // ── Relics, their light ──
    let ng = 0;
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
    const gem = (x: number, y: number, z: number, s: number, spin: number) => {
      if (ng >= MAX_GEMS) return;
      this.gems.setMatrixAt(ng++, _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, spin), _s.set(s, s, s)));
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
        gem(c.x + Math.cos(a) * 0.45, c.h + c.y + 2.35, c.z + Math.sin(a) * 0.45, 0.45, a);
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
      gem(x, y, z, 1, this.time * 1.5 + tr.index);
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
    this.gems.count = ng;
    if (ng) this.gems.instanceMatrix.needsUpdate = true;
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
    return { pin };
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
    for (const mesh of [this.closed, this.opened, this.gems, this.columns, this.glowRings]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    // The chests' own material (the scanned chest's belongs to the model library's cache: not ours to free).
    (this.opened.material as Material).dispose();
    (this.gems.material as Material).dispose();
    this.machine.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
    });
    this.beacon.geometry.dispose();
    for (const mat of this.mats) mat.dispose();
    this.panel.remove();
  }
}
