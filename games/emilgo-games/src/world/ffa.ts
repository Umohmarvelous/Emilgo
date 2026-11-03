// Free For All on screen (SPEC-V3 §4, §9, Phase 4), beside the shared match
// scene (matchScene.ts: the zone, items, Airfall): what melee and the flag
// modes add, drawn, heard and shown.
//
//   world     the flags (planted, or in someone's hands), the street props
//             (on the ground, in hands, a slipper in the air), the goal
//             rings (drop zones, the rally point, the extraction gate): one
//             instanced draw per kind
//   bodies    melee's events played on the people: the swing, the hit, the
//             fall and the get-up, the clinch
//   over      over each head nearby: the Wobble meter, a brace's shield; a
//             squad mate's diamond (no names, SPEC-V3 §7), the flag's
//             holder marked from anywhere
//   HUD       the objective line, the interact prompt (search a stash, pick
//             up a prop), the compass's objective pin, the map's marks

import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshLambertMaterial,
  type PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from "three";

import { DROPZONES, RALLY, SQUAD_COLORS } from "../config";
import type { Contestant } from "../game/core/body";
import type { Match } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import type { CaptureModule } from "../game/modules/capture";
import type { DropzonesModule } from "../game/modules/dropzones";
import type { FlagsModule } from "../game/modules/flags";
import type { GadgetsModule } from "../game/modules/gadgets";
import { PROP_IDS, type MeleeModule, type PropId, type SwingKind } from "../game/modules/melee";
import type { Sound } from "../audio/sound";
import type { Hud, ItemPin, MapMark } from "../ui/hud";
import { el, fmtTime } from "../ui/dom";
import { t } from "../ui/i18n";
import { gameSize } from "../ui/rotate";
import type { Crowd } from "./crowd";
import type { ActionId } from "./human/animator";
import { merge, part } from "./geo";

/** What interact would do in Free For All (beside the items and crates). */
export interface FfaTarget {
  kind: "stash" | "prop" | "mate";
  d: number;
  prop?: PropId;
  /** A squad mate to help: up, or out of a gutter. */
  how?: "up" | "rescue";
}

export interface FfaViewOptions {
  crowd: Crowd;
  hud: Hud;
  sound: Sound | null;
  /** Your body's index. */
  me: number;
  /** Where the meters over heads go (the UI layer). */
  layer: HTMLElement;
  /** The places, by name: a radio hint names the nearest. */
  places: readonly { name: string; x: number; z: number }[];
}

export const PROP_NAME: Record<PropId, string> = { chair: "Plastic chair", bucket: "Bucket", broom: "Broom", pestle: "Pestle", bench: "Bench", slipper: "Slipper" };

/** A swing as the body plays it. */
const SWING_ANIM: Record<SwingKind, ActionId> = { fist: "fist", slap: "slap", push: "push", grab: "grab", trip: "slap", charge: "push", prop: "fist", throw: "push" };

// ── The things: small, low-poly, coloured per vertex ─────────────────────────

function propGeometry(k: PropId): BufferGeometry {
  switch (k) {
    case "chair": {
      // A white plastic party chair.
      const c = 0xf2f0ea;
      const parts = [part(new BoxGeometry(0.44, 0.04, 0.42), c, { p: [0, 0.44, 0] }), part(new BoxGeometry(0.44, 0.42, 0.04), c, { p: [0, 0.66, -0.2], r: [-0.12, 0, 0] })];
      for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) parts.push(part(new CylinderGeometry(0.02, 0.025, 0.44, 5), c, { p: [x, 0.22, z] }, 0.92));
      return merge(parts);
    }
    case "bucket":
      // A blue plastic bucket and its handle.
      return merge([
        part(new CylinderGeometry(0.17, 0.13, 0.3, 10, 1, true), 0x2a64c8, { p: [0, 0.15, 0] }),
        part(new CylinderGeometry(0.13, 0.13, 0.01, 10), 0x2a64c8, { p: [0, 0.005, 0] }, 0.8),
        part(new BoxGeometry(0.34, 0.012, 0.012), 0x1c1c1c, { p: [0, 0.33, 0] }),
      ]);
    case "broom":
      // A short palm-frond broom, tied at the top.
      return merge([
        part(new CylinderGeometry(0.035, 0.11, 0.62, 7), 0xc9a45a, { p: [0, 0.31, 0] }),
        part(new CylinderGeometry(0.04, 0.04, 0.08, 7), 0x8a2a22, { p: [0, 0.56, 0] }),
      ]);
    case "pestle":
      // A wooden pestle for the mortar: long, heavy at both ends.
      return merge([
        part(new CylinderGeometry(0.035, 0.035, 0.9, 7), 0x8a5a32, { p: [0, 0.45, 0] }),
        part(new CylinderGeometry(0.06, 0.05, 0.16, 7), 0x7a4a26, { p: [0, 0.08, 0] }),
        part(new CylinderGeometry(0.05, 0.06, 0.14, 7), 0x7a4a26, { p: [0, 0.83, 0] }),
      ]);
    case "bench": {
      // A plain wooden bench.
      const w = 0x9a6a3a;
      return merge([
        part(new BoxGeometry(1.2, 0.05, 0.26), w, { p: [0, 0.42, 0] }),
        part(new BoxGeometry(0.05, 0.42, 0.22), w, { p: [-0.5, 0.21, 0] }, 0.85),
        part(new BoxGeometry(0.05, 0.42, 0.22), w, { p: [0.5, 0.21, 0] }, 0.85),
      ]);
    }
    default:
      // A rubber slipper: the sole and its strap.
      return merge([
        part(new BoxGeometry(0.11, 0.025, 0.27), 0x1f7a4a, { p: [0, 0.012, 0] }),
        part(new BoxGeometry(0.1, 0.04, 0.03), 0xe8e4dc, { p: [0, 0.04, 0.05] }),
      ]);
  }
}

/** The displacement feed's line for a knockdown (§10.9), or "" when there's nothing to tell. */
export function displacement(why: string, by: string | null, tg: string, gutter: boolean): string {
  if (why === "blast") return `${tg} ${t("was blown out of a car")}`;
  if (why === "tumble") return `${tg} ${t("tumbled out of a moving car")}`;
  if (!by) return why === "ringout" ? `${tg} ${gutter ? t("fell in the gutter") : t("fell off a roof")}` : "";
  switch (why) {
    case "ringout":
      return gutter ? `${by} ${t("dumped")} ${tg} ${t("in the gutter")}` : `${by} ${t("knocked")} ${tg} ${t("off the roof")}`;
    case "throw":
      return `${by} ${t("threw")} ${tg}`;
    case "tackle":
      return `${by} ${t("flattened")} ${tg}`;
    case "trip":
      return `${by} ${t("tripped")} ${tg}`;
    case "hijack":
      return `${by} ${t("pulled")} ${tg} ${t("out of a car")}`;
    case "daze":
      return `${by} ${t("dazed")} ${tg}`;
    default:
      return "";
  }
}

/** A knockdown's worth as the play of the game (§10.11): the more it moved someone somewhere bad, the more. */
export const PLAY_SCORE: Record<string, number> = { ringout: 5, hijack: 4, blast: 4, throw: 3, tackle: 3, daze: 2, trip: 1, tumble: 1 };

/** A flag: a pole and a gold cloth with a green band. */
function flagGeometry(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.025, 0.03, 1.9, 6), 0x3a3530, { p: [0, 0.95, 0] }),
    part(new PlaneGeometry(0.7, 0.42), 0xffc23a, { p: [0.36, 1.66, 0] }),
    part(new PlaneGeometry(0.7, 0.1), 0x1f8a4a, { p: [0.36, 1.5, 0.002] }),
    part(new CylinderGeometry(0.05, 0.05, 0.05, 6), 0xffc23a, { p: [0, 1.92, 0] }),
  ]);
}

const RING_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vC;
void main() {
  vUv = uv;
  vC = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
/** A column of light: bright at the foot, gone by the top; `time` makes it breathe. */
const COLUMN_FRAG = /* glsl */ `
uniform float time;
varying vec2 vUv;
varying vec3 vC;
void main() {
  float up = pow(1.0 - vUv.y, 2.2);
  float band = 0.75 + 0.25 * sin(vUv.y * 18.0 - time * 3.0);
  gl_FragColor = vec4(vC * up * band * 0.55, 1.0);
}`;
const RING_FRAG = /* glsl */ `
uniform float time;
varying vec2 vUv;
varying vec3 vC;
void main() {
  gl_FragColor = vec4(vC * (0.8 + 0.2 * sin(time * 4.0)), 1.0);
}`;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _v = new Vector3();
const _up = new Vector3(0, 1, 0);
const _tip = new Vector3(1, 0, 0);

const MAX_PROPS = 24;
const MAX_FLAGS = 6;
const MAX_GOALS = 6;
/** Meters over heads within this (metres); squad mates and the flag's holder further. */
const HEAD_RANGE = 30;
const FAR_RANGE = 220;

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

interface Head {
  root: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  sig: string;
}

export class FfaView {
  readonly group = new Group();
  private readonly o: FfaViewOptions;
  private readonly props = new Map<PropId, InstancedMesh>();
  private readonly flagMesh: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly columns: InstancedMesh;
  private readonly glowMats: ShaderMaterial[] = [];
  private readonly heads: Head[] = [];
  private readonly headLayer = el("div", "ffa-heads");
  private time = 0;
  /** The newest radio hints (the map draws them), and the holders' pings (each shown 4 s). */
  private readonly hints: { x: number; z: number; r: number }[] = [];
  private readonly pings: { x: number; z: number; until: number }[] = [];

  constructor(o: FfaViewOptions) {
    this.o = o;
    const solid = new MeshLambertMaterial({ vertexColors: true });
    for (const k of PROP_IDS) {
      const m = instanced(propGeometry(k), solid, MAX_PROPS);
      this.props.set(k, m);
      this.group.add(m);
    }
    this.flagMesh = instanced(flagGeometry(), new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }), MAX_FLAGS);
    const glow = (frag: string) => {
      const mat = new ShaderMaterial({ uniforms: { time: { value: 0 } }, vertexShader: RING_VERT, fragmentShader: frag, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true });
      this.glowMats.push(mat);
      return mat;
    };
    // A ring 1 m across (scaled to the goal), flat on the ground; a column 1 m wide, 1 m tall (scaled).
    this.rings = instanced(new RingGeometry(0.94, 1, 48, 1).rotateX(-Math.PI / 2), glow(RING_FRAG), MAX_GOALS + MAX_FLAGS, true);
    this.columns = instanced(new CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0), glow(COLUMN_FRAG), MAX_GOALS + MAX_FLAGS, true);
    this.group.add(this.flagMesh, this.rings, this.columns);
    this.headLayer.dataset.ui = "1";
    o.layer.append(this.headLayer);
    o.hud.map.hints = this.hints;
  }

  /** The match's events since the last frame. */
  events(list: readonly MatchEvent[], m: Match, cam: Vector3): void {
    const crowd = this.o.crowd;
    const me = m.contestants[this.o.me];
    const near = (x: number, z: number, range: number) => Math.max(0, 1 - Math.hypot(x - cam.x, z - cam.z) / range);
    const body = (id: string | null) => (id ? (m.get(id) ?? null) : null);
    for (const e of list) {
      switch (e.type) {
        case "swing": {
          const c = body(e.id);
          if (!c) break;
          crowd.act(c.index, SWING_ANIM[e.kind]);
          if (near(c.x, c.z, 30) > 0) this.o.sound?.strike(e.kind === "fist" || e.kind === "slap" ? e.kind : "push", false);
          break;
        }
        case "hit": {
          const a = body(e.id);
          const b = body(e.tg);
          if (!b) break;
          crowd.hit(b.index, b, a ? b.x - a.x : e.kx, a ? b.z - a.z : e.kz);
          if (near(b.x, b.z, 35) > 0) this.o.sound?.strike(e.kind === "fist" || e.kind === "slap" ? e.kind : "push", true);
          if (b === me) this.o.hud.flashRed();
          break;
        }
        case "parry": {
          const a = body(e.id);
          if (a && near(a.x, a.z, 30) > 0) this.o.sound?.parry();
          if (e.by === me.id) this.o.hud.pushFeed(t("Parried"), "safe");
          else if (e.id === me.id) this.o.hud.pushFeed(t("Parried: you're staggered"), "out");
          break;
        }
        case "broke":
          if (e.id === me.id) this.o.hud.pushFeed(t("Your grab was broken"));
          break;
        case "down": {
          const c = body(e.id);
          if (!c) break;
          const by = body(e.by);
          // Away from whoever put them down (or backwards).
          crowd.kill(c.index, c, by ? by.x : c.x + Math.sin(c.heading), by ? by.z : c.z + Math.cos(c.heading));
          crowd.setCarry(c.index, false);
          this.o.sound?.thud(near(c.x, c.z, 40));
          if (c === me) this.o.hud.pushFeed(e.why === "daze" ? t("Dazed") : e.why === "ringout" ? t("Into the gutter") : t("Down"), "out");
          else {
            // The displacement feed (§10.9): who put whom where, not who killed whom.
            const line = displacement(e.why, by?.name ?? null, c.name, c.h < -0.3);
            if (line) this.o.hud.pushFeed(line, by === me ? "safe" : m.sameSquad(c, me) ? "out" : "info");
          }
          break;
        }
        case "helpup": {
          const a = body(e.id);
          const b = body(e.tg);
          if (!a || !b) break;
          if (b === me) this.o.hud.pushFeed(`${a.name} ${e.how === "rescue" ? t("pulled you out") : t("helped you up")}`, "safe");
          else if (a === me) this.o.hud.pushFeed(e.how === "rescue" ? t("You pulled them out") : t("You helped them up"), "safe");
          break;
        }
        case "danfo": {
          const c = body(e.tg);
          if (!c) break;
          this.o.sound?.thud(near(c.x, c.z, 40));
          if (c === me) this.o.hud.pushFeed(t("The danfo shoved you off the road"), "out");
          break;
        }
        case "bounty": {
          const a = body(e.id);
          const b = body(e.tg);
          if (a && b) this.o.hud.pushFeed(`${a === me ? t("You") : a.name} ${t("took the leader's bounty from")} ${b.name}: ${Math.round(e.v)} s`, a === me ? "safe" : "info");
          break;
        }
        case "up": {
          const c = body(e.id);
          if (c) crowd.revive(c.index);
          break;
        }
        case "clinch": {
          const a = body(e.id);
          const b = body(e.tg);
          if (a) crowd.setCarry(a.index, true);
          if (b === me) this.o.hud.pushFeed(t("Grabbed: push your stick to escape"), "out");
          else if (a === me) this.o.hud.pushFeed(t("Clinch: Throw, Trip or Drag"), "safe");
          break;
        }
        case "release": {
          const a = body(e.id);
          if (a && e.how !== "drag") crowd.setCarry(a.index, false);
          if (e.how === "reverse" && e.tg === me.id) this.o.hud.pushFeed(t("Reversal"), "safe");
          break;
        }
        case "prop": {
          const c = body(e.id);
          if (c) crowd.setCarry(c.index, e.how === "take");
          if (c === me && e.how === "take") this.o.sound?.pickup();
          if (c === me && e.how === "break") this.o.hud.pushFeed(`${t(PROP_NAME[e.kind])}: ${t("broken")}`);
          break;
        }
        case "flag": {
          const c = body(e.id);
          if (c) crowd.setCarry(c.index, e.how === "take" || e.how === "found");
          if (e.how === "take" || e.how === "found") {
            this.o.sound?.flag(c === me);
            if (c === me) this.o.hud.pushFeed(e.how === "found" ? t("You found the flag") : t("You have the flag"), "safe");
            else if (c) this.o.hud.pushFeed(e.how === "found" ? `${c.name} ${t("found the flag")}` : `${c.name} ${t("has the flag")}`, m.sameSquad(c, me) ? "safe" : "info");
          } else if (e.how === "deliver" && c) this.o.hud.pushFeed(c === me ? t("Delivered") : `${c.name} ${t("delivered a flag")}`, c === me ? "safe" : "info");
          break;
        }
        case "search":
          if (e.id === me.id && !e.found) {
            this.o.sound?.empty();
            this.o.hud.pushFeed(t("Nothing here"));
          }
          break;
        case "hint": {
          this.hints.push({ x: e.x, z: e.z, r: e.r });
          this.o.sound?.radio();
          this.o.hud.pushFeed(`${t("Radio")}: ${this.hintLine(e.x, e.z)}`);
          break;
        }
        case "ping":
          this.pings.push({ x: e.x, z: e.z, until: m.elapsed + 4 });
          break;
        case "gate":
          this.o.hud.pushFeed(t("The gate is open: get there with a flag"), "safe");
          this.o.sound?.zoneAlert();
          break;
        case "dz":
          if (m.elapsed > 1) this.o.hud.pushFeed(t("A drop zone moved"));
          break;
        default:
          break;
      }
    }
  }

  /** A hint in the radio's words: the flag is near the place nearest the circle's middle. */
  private hintLine(x: number, z: number): string {
    let best: { name: string; x: number; z: number } | null = null;
    let d = Infinity;
    for (const p of this.o.places) {
      const k = Math.hypot(p.x - x, p.z - z);
      if (k < d) {
        d = k;
        best = p;
      }
    }
    return best ? t("Oya, the flag dey hide for {place} side o!").replace("{place}", best.name) : t("The flag is in the circle on your map");
  }

  /** What interact would do here (the nearest wins, as the server decides). */
  target(m: Match): FfaTarget | null {
    const me = m.contestants[this.o.me];
    if (me.status !== "alive") return null;
    const f = m.module<FlagsModule>("flags");
    const mel = m.module<MeleeModule>("melee");
    let out: FfaTarget | null = null;
    const s = f?.stashFor(me);
    if (s && Math.abs(s.h - (me.h + me.y)) <= 1.2) out = { kind: "stash", d: Math.hypot(s.x - me.x, s.z - me.z) };
    const p = mel?.propFor(me);
    if (p) {
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (!out || d < out.d) out = { kind: "prop", d, prop: p.kind };
    }
    const mate = mel?.mateFor(m, me);
    if (mate) return { kind: "mate", d: mate.d, how: mate.how };
    return out;
  }

  /** Every frame. Returns the compass's objective pin. */
  update(dt: number, m: Match, camera: PerspectiveCamera, marks: MapMark[], firstPerson: boolean): { goal: ItemPin | null } {
    this.time += dt;
    for (const mat of this.glowMats) mat.uniforms.time.value = this.time;
    const crowd = this.o.crowd;
    const me = m.contestants[this.o.me];
    const flags = m.module<FlagsModule>("flags");
    const mel = m.module<MeleeModule>("melee");
    const dz = m.module<DropzonesModule>("dropzones");
    const cap = m.module<CaptureModule>("capture");

    // ── Props ──
    const counts = new Map<PropId, number>();
    const put = (k: PropId, x: number, y: number, z: number, yaw: number, tilt = 0) => {
      const n = counts.get(k) ?? 0;
      if (n >= MAX_PROPS) return;
      const mesh = this.props.get(k)!;
      _q.setFromAxisAngle(_up, yaw);
      if (tilt) _q.multiply(new Quaternion().setFromAxisAngle(_tip, tilt));
      mesh.setMatrixAt(n, _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)));
      counts.set(k, n + 1);
    };
    if (mel) {
      for (const p of mel.props) {
        if (p.holder === -2 || p.holder === -3) continue;
        if (p.holder >= 0) {
          const c = m.contestants[p.holder];
          if (c.status !== "alive" || (firstPerson && c === me)) continue;
          const at = crowd.hands(p.holder, _v);
          if (at) put(p.kind, at.x, at.y - 0.3, at.z, c.heading, p.kind === "broom" || p.kind === "pestle" ? 1.1 : 0);
          continue;
        }
        const dx = p.x - camera.position.x;
        const dz2 = p.z - camera.position.z;
        if (dx * dx + dz2 * dz2 > 60 * 60) continue;
        put(p.kind, p.x, p.h, p.z, p.index * 1.3, p.kind === "broom" || p.kind === "pestle" ? Math.PI / 2 : 0);
      }
      // A slipper in the air, spinning.
      for (const f of mel.flights) {
        if (!f || f.done || f.left <= 0) continue;
        const kind = mel.props[f.prop]?.kind ?? "slipper";
        put(kind, f.x, f.h + 1.2, f.z, this.time * 18, 0.4);
      }
    }
    for (const k of PROP_IDS) {
      const mesh = this.props.get(k)!;
      mesh.count = counts.get(k) ?? 0;
      if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
    }

    // ── Flags, goals ──
    let flagsN = 0;
    let glows = 0;
    const glow = (x: number, y: number, z: number, r: number, h: number, colour: string) => {
      if (glows >= this.rings.instanceMatrix.count) return;
      _c.set(colour);
      this.rings.setMatrixAt(glows, _m.compose(_p.set(x, y + 0.06, z), _q.identity(), _s.set(r, 1, r)));
      this.rings.setColorAt(glows, _c);
      this.columns.setMatrixAt(glows, _m.compose(_p.set(x, y, z), _q.identity(), _s.set(r, h, r)));
      this.columns.setColorAt(glows, _c);
      glows++;
    };
    let goal: ItemPin | null = null;
    let goalD = Infinity;
    const aim = (x: number, z: number, kind: ItemPin["kind"], weight = 0) => {
      const d = Math.hypot(x - me.x, z - me.z) + weight;
      if (d < goalD) {
        goalD = d;
        goal = { x, z, kind };
      }
    };
    if (flags) {
      for (const f of flags.flags) {
        if (f.hidden) continue;
        let x = f.x;
        let y = f.h;
        let z = f.z;
        let yaw = this.time * 0.6;
        if (f.holder >= 0) {
          const c = m.contestants[f.holder];
          marks.push({ x: c.x, z: c.z, kind: "flag" });
          if (c !== me) aim(c.x, c.z, m.sameSquad(c, me) ? "flag" : "hot");
          if (firstPerson && c === me) continue;
          const at = crowd.hands(f.holder, _v);
          if (at) {
            x = at.x;
            y = at.y - 0.9;
            z = at.z;
          } else y = c.h;
          yaw = c.heading - Math.PI / 2;
        } else {
          marks.push({ x, z, kind: "flag" });
          aim(x, z, "flag");
          glow(x, y, z, 0.7, 24, "#ffc23a");
        }
        if (flagsN < MAX_FLAGS) this.flagMesh.setMatrixAt(flagsN++, _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, yaw), _s.set(1, 1, 1)));
      }
      if (flags.gate) {
        glow(flags.gate.x, m.world.space.floorAt(flags.gate.x, flags.gate.z, 2).h, flags.gate.z, 4, 40, "#59d98e");
        marks.push({ x: flags.gate.x, z: flags.gate.z, kind: "goal", r: 4 });
        if (flags.heldBy(me.index)) aim(flags.gate.x, flags.gate.z, "goal", -1000);
      }
    }
    if (dz) {
      for (const d of dz.zones) {
        if (m.elapsed >= d.until && m.phase === "play") continue;
        glow(d.x, m.world.space.floorAt(d.x, d.z, 2).h, d.z, DROPZONES.radius, 30, "#ffd36a");
        marks.push({ x: d.x, z: d.z, kind: "goal", r: DROPZONES.radius });
        // Carrying a flag: the nearest drop zone is where to go.
        if (flags?.heldBy(me.index)) aim(d.x, d.z, "goal", -1000);
      }
    }
    if (cap) {
      glow(cap.x, m.world.space.floorAt(cap.x, cap.z, 2).h, cap.z, cap.radius || RALLY.radius, 34, "#38b6ff");
      marks.push({ x: cap.x, z: cap.z, kind: "goal", r: cap.radius || RALLY.radius });
      aim(cap.x, cap.z, "goal", -1000);
    }
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      if (m.elapsed > p.until) this.pings.splice(i, 1);
      else marks.push({ x: p.x, z: p.z, kind: "ping" });
    }
    this.flagMesh.count = flagsN;
    if (flagsN) this.flagMesh.instanceMatrix.needsUpdate = true;
    this.rings.count = this.columns.count = glows;
    if (glows) {
      this.rings.instanceMatrix.needsUpdate = this.columns.instanceMatrix.needsUpdate = true;
      this.rings.instanceColor!.needsUpdate = this.columns.instanceColor!.needsUpdate = true;
    }
    // Squad mates on the map.
    for (const c of m.contestants) if (c !== me && c.status === "alive" && this.looksMate(m, c)) marks.push({ x: c.x, z: c.z, kind: "mate" });

    this.overheads(m, camera, firstPerson);
    return { goal };
  }

  /** A squad mate to your eyes: yours, or a rival in your squad's Aso-ebi (Phase 6). */
  private looksMate(m: Match, c: Contestant): boolean {
    const me = m.contestants[this.o.me];
    if (c === me) return false;
    if (m.sameSquad(c, me)) return true;
    const g = m.module<GadgetsModule>("gadgets");
    return !!g && g.wearing[c.index] >= 0 && g.wearing[c.index] === m.squads[me.index];
  }

  /** The meters over heads. */
  private overheads(m: Match, camera: PerspectiveCamera, firstPerson: boolean): void {
    const mel = m.module<MeleeModule>("melee");
    const flags = m.module<FlagsModule>("flags");
    const me = m.contestants[this.o.me];
    const { w, h } = gameSize();
    while (this.heads.length < m.contestants.length) {
      const root = el("div", "fhead");
      const bar = el("i", "wob");
      const fill = el("b");
      bar.append(fill);
      root.append(bar, el("i", "mate"), el("i", "brace"), el("i", "carry"));
      this.headLayer.append(root);
      this.heads.push({ root, bar, fill, sig: "" });
    }
    for (const c of m.contestants) {
      const hd = this.heads[c.index];
      const mate = this.looksMate(m, c);
      const holder = !!flags?.heldBy(c.index);
      const d = Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
      const wob = mel ? mel.wobble[c.index] : 0;
      const brace = mel ? mel.brace[c.index] : false;
      const show = c.status === "alive" && !(firstPerson && c === me) && (d < HEAD_RANGE || ((mate || holder) && d < FAR_RANGE));
      let on = false;
      if (show) {
        _v.set(c.x, c.h + c.y + (c.stance === 2 ? 0.7 : c.stance === 1 ? 1.5 : 2.05), c.z).project(camera);
        on = _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05;
        if (on) hd.root.style.transform = `translate(${((_v.x + 1) / 2) * w}px, ${((1 - _v.y) / 2) * h}px)`;
      }
      const near = d < HEAD_RANGE;
      const sig = `${on ? 1 : 0}${mate ? 1 : 0}${holder ? 1 : 0}${near && (wob > 0.02 || brace) ? 1 : 0}${brace ? 1 : 0}${m.squads[c.index]}${m.module<GadgetsModule>("gadgets")?.wearing[c.index] ?? -1}`;
      if (sig !== hd.sig) {
        hd.sig = sig;
        hd.root.classList.toggle("on", on);
        hd.root.classList.toggle("is-mate", mate);
        hd.root.classList.toggle("is-holder", holder);
        hd.root.classList.toggle("is-hit", near && (wob > 0.02 || brace));
        hd.root.classList.toggle("is-brace", brace);
        const g = m.module<GadgetsModule>("gadgets");
        const shown = g ? g.shownSquad(m, c.index) : m.squads[c.index];
        hd.root.style.setProperty("--sq", SQUAD_COLORS[shown % SQUAD_COLORS.length]);
      }
      if (on && near) {
        hd.fill.style.transform = `scaleX(${Math.min(1, wob).toFixed(2)})`;
        hd.bar.classList.toggle("hot", wob > 0.7);
      }
    }
  }

  /** The objective line (top centre), for the HUD. */
  objectiveLine(m: Match, measures?: readonly number[]): string {
    const flags = m.module<FlagsModule>("flags");
    const cap = m.module<CaptureModule>("capture");
    const me = m.contestants[this.o.me];
    const mine = (i: number) => measures?.[i] ?? m.objective(i);
    const squadOf = (q: number) => m.contestants.filter((c) => m.squads[c.index] === q).reduce((a, c) => a + mine(c.index), 0);
    const bestOther = () => {
      let b = 0;
      for (const q of new Set(m.squads)) if (q !== m.squads[me.index]) b = Math.max(b, squadOf(q));
      return b;
    };
    if (cap) {
      const inNow = (q: number) => m.contestants.filter((c) => m.squads[c.index] === q && c.status === "alive" && cap.isInside(c.x, c.z)).length;
      let lead = 0;
      for (const q of new Set(m.squads)) if (q !== m.squads[me.index]) lead = Math.max(lead, inNow(q));
      return `${t("Rally point")}: ${t("your squad")} ${inNow(m.squads[me.index])} · ${t("best rival")} ${lead}`;
    }
    if (!flags) return "";
    if (flags.claimHold > 0) {
      const f = flags.flags[0];
      if (!f || f.hidden) return t("Find the flag: search the stash spots");
      if (f.holder < 0) return t("The flag is loose: grab it");
      const c = m.contestants[f.holder];
      const left = Math.max(0, flags.claimHold - flags.claim[f.holder]);
      if (c === me) return `${t("Hold it")}: ${Math.ceil(left)} s`;
      return `${m.sameSquad(c, me) ? t("Your squad has it") : `${c.name} ${t("has it")}`}: ${Math.ceil(left)} s`;
    }
    if (flags.extractAt > 0) {
      const open = flags.gate ? t("Gate open") : `${t("Gate opens in")} ${fmtTime(Math.max(0, flags.extractAt - m.elapsed))}`;
      return `${flags.heldBy(me.index) ? t("You have a flag") : t("Get a flag")} · ${open}`;
    }
    if (flags.ping > 0) return `${t("Held")}: ${t("you")} ${Math.floor(squadOf(m.squads[me.index]))} s · ${t("best rival")} ${Math.floor(bestOther())} s`;
    const target = m.module<DropzonesModule>("dropzones")?.target ?? 5;
    return `${t("Deliveries")}: ${t("you")} ${squadOf(m.squads[me.index])} · ${t("best rival")} ${bestOther()} / ${target}`;
  }

  dispose(): void {
    for (const mesh of this.props.values()) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.flagMesh.geometry.dispose();
    this.flagMesh.dispose();
    this.rings.geometry.dispose();
    this.columns.geometry.dispose();
    for (const mat of this.glowMats) mat.dispose();
    this.headLayer.remove();
    this.o.hud.map.hints = [];
  }
}
