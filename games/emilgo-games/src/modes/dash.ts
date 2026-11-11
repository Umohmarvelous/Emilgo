// Horde Dash on screen (v6 max, 3.1): the rules are game/runner/dash.ts; this
// draws the road out of the dead city at golden hour, the runner (you, as you
// dress) and the horde behind (Dead Streets' runners), and reads swipes and
// keys. Our own art: danfo buses, road barriers, cones, sign gantries, Owo
// coins, the three power-ups, the Safe Gate.
//
// Cheap on purpose: every kind of thing is one instanced draw (buses, barriers,
// cones, gantries, coins, buildings, lamps); only what's near is updated.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { Rng } from "../core/rng";
import { buildCourse, DASH, laneX, newDash, stepDash, type Course, type Dash, type DashEvent, type DashInput, type ObKind } from "../game/runner/dash";
import { LOOKS } from "../graphics/grade";
import type { Contestant } from "../game/core/body";
import { FIGURINE_BY_ID } from "../shop/figurines";
import { el, fmtTime } from "../ui/dom";
import { t } from "../ui/i18n";
import { icon } from "../ui/icons";
import { KITS } from "../world/human/gear";
import { randomLook } from "../world/human/wardrobe";
import type { ModeHost } from "./types";

export interface DashResult {
  finished: boolean;
  seconds: number;
  metres: number;
  coins: number;
  level: number;
  length: number;
}

const GOLDEN = LOOKS.golden;
const _m = new Matrix4();
const _v = new Vector3();

/** Boxes merged into one geometry, each with its colour (vertex colours). */
function boxes(parts: [w: number, h: number, d: number, x: number, y: number, z: number, color: string][]): BufferGeometry {
  const geos = parts.map(([w, h, d, x, y, z, c]) => {
    const g = new BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    const col = new Color(c);
    const n = g.getAttribute("position").count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
    g.setAttribute("color", new Float32BufferAttribute(arr, 3));
    // Every part the same attributes (position, normal, colour), so they merge.
    g.deleteAttribute("uv");
    return g;
  });
  return mergeGeometries(geos)!;
}

function coloured(g: BufferGeometry, c: string): BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const col = new Color(c);
  const n = ng.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
  ng.setAttribute("color", new Float32BufferAttribute(arr, 3));
  ng.deleteAttribute("uv");
  return ng;
}

/** Our danfo: yellow, two black bands, dark windows, a roof rack, wheels; 9 m long, its front at +z = 0. */
function busGeometry(): BufferGeometry {
  const Y = "#f2b705";
  const K = "#1b1b1d";
  const W = "#2a3440";
  const g = boxes([
    [2.3, 2.3, 9, 0, 1.55, 4.5, Y],
    [2.34, 0.16, 9.02, 0, 1.05, 4.5, K],
    [2.34, 0.12, 9.02, 0, 2.35, 4.5, K],
    [2.36, 0.62, 7.6, 0, 1.8, 5.0, W],
    [2.0, 0.7, 0.06, 0, 1.85, -0.02, W],
    [1.9, 0.18, 6.5, 0, 2.8, 5.0, "#3a3a3a"],
    [2.2, 0.35, 0.2, 0, 0.62, -0.05, "#9aa0a6"],
    [0.32, 0.14, 0.06, -0.8, 1.15, -0.03, "#fff6c8"],
    [0.32, 0.14, 0.06, 0.8, 1.15, -0.03, "#fff6c8"],
  ]);
  const wheels = [1.2, 7.4].flatMap((z) =>
    [-1.1, 1.1].map((x) => {
      const w = new CylinderGeometry(0.45, 0.45, 0.3, 12).rotateZ(Math.PI / 2);
      w.translate(x, 0.45, z);
      return coloured(w, "#111111");
    }),
  );
  return mergeGeometries([g, ...wheels])!;
}

/** A road barrier: red and white boards on two feet, across a lane. */
function barrierGeometry(): BufferGeometry {
  const parts: [number, number, number, number, number, number, string][] = [];
  for (let k = 0; k < 6; k++) parts.push([0.36, 0.32, 0.1, -0.9 + k * 0.36, 0.72, 0, k % 2 ? "#f4f4f2" : "#d32222"]);
  parts.push([0.08, 0.9, 0.08, -0.95, 0.45, 0, "#5a5a5a"], [0.08, 0.9, 0.08, 0.95, 0.45, 0, "#5a5a5a"], [0.5, 0.06, 0.5, -0.95, 0.03, 0, "#3a3a3a"], [0.5, 0.06, 0.5, 0.95, 0.03, 0, "#3a3a3a"]);
  return boxes(parts);
}

/** Three cones across a lane. */
function conesGeometry(): BufferGeometry {
  const geos = [-0.75, 0, 0.75].flatMap((x) => {
    const c = new ConeGeometry(0.24, 0.72, 10);
    c.translate(x, 0.36, 0);
    const band = new CylinderGeometry(0.135, 0.165, 0.1, 10);
    band.translate(x, 0.42, 0);
    const base = new BoxGeometry(0.5, 0.05, 0.5);
    base.translate(x, 0.025, 0);
    return [coloured(c, "#ff6a13"), coloured(band, "#f5f5f5"), coloured(base, "#222222")];
  });
  return mergeGeometries(geos)!;
}

/** A sign gantry over a lane: two posts and a green board from 1.15 m up. */
function gantryGeometry(): BufferGeometry {
  return boxes([
    [0.14, 2.6, 0.14, -1.2, 1.3, 0, "#6b7177"],
    [0.14, 2.6, 0.14, 1.2, 1.3, 0, "#6b7177"],
    [2.5, 1.0, 0.12, 0, 1.72, 0, "#0f6b3c"],
    [2.3, 0.08, 0.13, 0, 1.95, 0, "#f2f2f2"],
    [0.9, 0.08, 0.13, -0.5, 1.6, 0, "#f2f2f2"],
    [0.6, 0.08, 0.13, 0.6, 1.45, 0, "#f2f2f2"],
    [2.6, 0.12, 0.16, 0, 2.55, 0, "#555b61"],
  ]);
}

/** The road's surface: asphalt, the lanes' dashes, the kerbs' edge (a tile 4 m long). */
function roadTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3b3a38";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.fillStyle = "#e9e3cf";
  for (const x of [256 / 3, (256 * 2) / 3]) g.fillRect(x - 2, 30, 4, 110);
  g.fillStyle = "#f2c230";
  g.fillRect(2, 0, 5, 256);
  g.fillRect(249, 0, 5, 256);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The Safe Gate's banner. */
function bannerTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0a8a4a";
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = "#f5a623";
  g.fillRect(0, 108, 512, 20);
  g.fillStyle = "#ffffff";
  g.font = "800 64px Poppins, Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(t("SAFE GATE"), 256, 58);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

interface Body {
  x: number;
  z: number;
  y: number;
  h: number;
  vx: number;
  vz: number;
  heading: number;
  stance: number;
  sprinting: boolean;
  slide: number;
  status: "alive";
  tac?: number;
}

export class DashMode {
  readonly group = new Group();
  over = false;
  private readonly course: Course;
  private readonly d: Dash = newDash();
  private readonly input: DashInput = { left: false, right: false, jump: false, slide: false };
  private readonly obsMesh: Partial<Record<ObKind, InstancedMesh>> = {};
  private readonly obsIdx: Partial<Record<ObKind, number[]>> = {};
  private readonly coins: InstancedMesh;
  private readonly pows: Group[] = [];
  private readonly bodies: Body[];
  private readonly hud = el("div", "dash-hud");
  private readonly bar = el("i", "dash-fill");
  private readonly hordeDot = el("i", "dash-horde");
  private readonly coinEl = el("b", "dash-coins num");
  private readonly timeEl = el("b", "dash-time num");
  private readonly chips = el("div", "dash-chips");
  private readonly warn = el("div", "dash-warn");
  private readonly hint = el("div", "dash-hint");
  private readonly endEl = el("div", "dash-end glass");
  private countdown = 3.2;
  private camX = 0;
  private camY = 3.4;
  private time = 0;
  private touchAt: { x: number; y: number; t: number } | null = null;
  private readonly keyDown = (e: KeyboardEvent) => this.onKey(e);
  private readonly ptrDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.(".dash-end, .pause-btn, button")) return;
    this.touchAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  private readonly ptrUp = (e: PointerEvent) => this.onSwipe(e);
  private stepAt = 0;

  constructor(
    private readonly host: ModeHost,
    private readonly opts: { seed: number; level: number; best: number; onEnd: (r: DashResult) => void; onAgain: () => void; onLeave: () => void },
  ) {
    const h = host;
    this.course = buildCourse(opts.seed, opts.level);
    const L = this.course.length;
    // Light and air: golden hour, the haze of the Harmattan down the road.
    h.scene.add(this.group);
    h.scene.fog = new Fog(0xd7a676, 40, 190);
    h.renderer.setClearColor(0xe3b582);
    h.camera.far = 260;
    h.camera.updateProjectionMatrix();
    // The low sun behind you (it lights your back and the road ahead, the facades side on).
    const sun = new DirectionalLight(0xffd7a0, 2.4);
    sun.position.set(25, 30, -45);
    this.group.add(sun, sun.target, new HemisphereLight(0xffe7c8, 0x6a5646, 1.25));
    // The road, the kerbs, the verges.
    const roadW = DASH.laneW * 3 + 0.6;
    const roadTex = roadTexture();
    roadTex.repeat.set(1, (L + 200) / 4);
    const road = new Mesh(new PlaneGeometry(roadW, L + 200).rotateX(-Math.PI / 2), new MeshLambertMaterial({ map: roadTex }));
    road.position.set(0, 0, (L + 200) / 2 - 60);
    this.group.add(road);
    for (const s of [-1, 1]) {
      const kerb = new Mesh(new BoxGeometry(3.2, 0.18, L + 200), new MeshLambertMaterial({ color: 0x9d968a }));
      kerb.position.set(s * (roadW / 2 + 1.6), 0.09, (L + 200) / 2 - 60);
      const verge = new Mesh(new PlaneGeometry(60, L + 200).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: 0x8a7458 }));
      verge.position.set(s * (roadW / 2 + 3.2 + 30), 0.01, (L + 200) / 2 - 60);
      this.group.add(kerb, verge);
    }
    // The dead city on both sides: blocks of flats and shops, every 9–14 m (one draw), lamps (one draw).
    const r = new Rng(opts.seed ^ 0xb10c);
    const n = Math.ceil((L + 240) / 9) * 2;
    const blocks = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new MeshLambertMaterial({ color: 0xffffff }), n);
    const lamps = new InstancedMesh(boxes([[0.12, 6, 0.12, 0, 3, 0, "#3d3f42"], [1.4, 0.1, 0.18, -0.6, 5.95, 0, "#3d3f42"], [0.4, 0.12, 0.25, -1.2, 5.88, 0, "#fff2c8"]]), new MeshLambertMaterial({ vertexColors: true }), Math.ceil((L + 240) / 30) * 2);
    let bi = 0;
    let li = 0;
    const tones = [0xd8c2a6, 0xc9ae92, 0xe2d4bf, 0xb8a58f, 0xece0cc, 0xc4b8ac, 0xa9b4ae, 0xd7b48e];
    for (const s of [-1, 1]) {
      for (let z = -60; z < L + 180 && bi < n; z += 9 + r.range(0, 5)) {
        const w = 6 + r.range(0, 6);
        const hgt = 5 + r.range(0, 16);
        const d = 7 + r.range(0, 6);
        _m.makeScale(d, hgt, w).setPosition(s * (roadW / 2 + 5 + d / 2 + r.range(0, 3)), 0, z);
        blocks.setMatrixAt(bi, _m);
        blocks.setColorAt(bi, new Color(tones[r.int(0, tones.length - 1)]));
        bi++;
      }
      for (let z = -40; z < L + 180 && li < lamps.count; z += 30) {
        _m.makeRotationY(s > 0 ? 0 : Math.PI).setPosition(s * (roadW / 2 + 0.9), 0, z);
        lamps.setMatrixAt(li++, _m);
      }
    }
    blocks.count = bi;
    lamps.count = li;
    this.group.add(blocks, lamps);
    // Obstacles: one instanced draw per kind.
    const geo: Record<ObKind, BufferGeometry> = { bus: busGeometry(), barrier: barrierGeometry(), cones: conesGeometry(), gantry: gantryGeometry() };
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
    for (const kind of ["bus", "barrier", "cones", "gantry"] as const) {
      const list = this.course.obs.map((o, i) => (o.kind === kind ? i : -1)).filter((i) => i >= 0);
      if (!list.length) continue;
      const im = new InstancedMesh(geo[kind], mat, list.length);
      list.forEach((oi, k) => {
        const o = this.course.obs[oi];
        _m.makeTranslation(laneX(o.lane), 0, o.z);
        im.setMatrixAt(k, _m);
      });
      im.frustumCulled = false;
      this.obsMesh[kind] = im;
      this.obsIdx[kind] = list;
      this.group.add(im);
    }
    // Owo coins: one draw for every coin (the sky's too: room for them).
    const coinGeo = new CylinderGeometry(0.34, 0.34, 0.08, 18).rotateX(Math.PI / 2);
    this.coins = new InstancedMesh(coinGeo, new MeshStandardMaterial({ color: 0xf5c542, emissive: 0x6a4a00, metalness: 0.8, roughness: 0.3 }), this.course.coins.length + 40);
    this.coins.frustumCulled = false;
    this.group.add(this.coins);
    // Power-ups: a magnet (red horseshoe), a jet pack (twin tanks), a shield (a blue hexagon), each in a glow.
    const glow = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    for (const p of this.course.pows) {
      const g = new Group();
      if (p.kind === "magnet") {
        const m = new Mesh(new TorusGeometry(0.32, 0.1, 8, 20, Math.PI), new MeshStandardMaterial({ color: 0xd32222, metalness: 0.5, roughness: 0.4 }));
        m.rotation.z = Math.PI;
        g.add(m);
      } else if (p.kind === "jet") {
        for (const x of [-0.16, 0.16]) {
          const tank = new Mesh(new CylinderGeometry(0.13, 0.13, 0.62, 12), new MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.8, roughness: 0.25 }));
          tank.position.x = x;
          g.add(tank);
        }
      } else {
        g.add(new Mesh(new CylinderGeometry(0.4, 0.4, 0.08, 6).rotateX(Math.PI / 2), new MeshStandardMaterial({ color: 0x3a8dff, emissive: 0x0a2a66, metalness: 0.4, roughness: 0.3 })));
      }
      const halo = new Mesh(new PlaneGeometry(1.5, 1.5), glow);
      g.add(halo);
      g.position.set(laneX(p.lane), 1.2, p.z);
      g.userData.halo = halo;
      this.pows.push(g);
      this.group.add(g);
    }
    // The Safe Gate.
    const gate = new Group();
    for (const s of [-1, 1]) {
      const pylon = new Mesh(new BoxGeometry(0.9, 7, 0.9), new MeshLambertMaterial({ color: 0x0a8a4a }));
      pylon.position.set(s * (roadW / 2 + 0.6), 3.5, 0);
      gate.add(pylon);
    }
    const banner = new Mesh(new PlaneGeometry(roadW + 2, 2.2), new MeshBasicMaterial({ map: bannerTexture(), side: DoubleSide }));
    banner.position.set(0, 6, 0);
    banner.rotation.y = Math.PI;
    gate.add(banner);
    gate.position.z = L;
    this.group.add(gate);
    // You and the horde: you as you dress (your figurine too), four of Dead Streets' runners behind.
    const look = h.myLook();
    const lr = new Rng(opts.seed ^ 0x2a);
    h.crowd.setup([look, ...[0, 1, 2, 3].map((i) => randomLook(new Rng(opts.seed * 31 + i * 977)))], 0);
    h.crowd.setGear(0, KITS[look.hoodie % KITS.length], 0);
    h.crowd.setFigurine(0, h.settings.figs.includes(h.settings.fig) ? (FIGURINE_BY_ID[h.settings.fig] ?? null) : null);
    for (let i = 1; i <= 4; i++) h.crowd.setZombie(i, (["runner", "shambler", "runner", "brute"] as const)[i - 1], lr.next() < 0.5);
    h.crowd.hideMyHead = false;
    this.bodies = [0, 1, 2, 3, 4].map(() => ({ x: 0, z: 0, y: 0, h: 0, vx: 0, vz: 0, heading: 0, stance: 0, sprinting: true, slide: 0, status: "alive" as const }));
    // The screen: progress to the gate (the horde a red dot behind you), Owo, the clock, power-ups, the warning.
    const prog = el("div", "dash-prog");
    prog.append(this.bar, this.hordeDot);
    const top = el("div", "dash-top");
    top.append(prog);
    const stats = el("div", "dash-stats");
    stats.innerHTML = "";
    const coinBox = el("span", "dash-stat");
    coinBox.innerHTML = `<i class="dash-owo"></i>`;
    coinBox.append(this.coinEl);
    const timeBox = el("span", "dash-stat");
    timeBox.innerHTML = icon("timer", "", 14);
    timeBox.append(this.timeEl);
    stats.append(coinBox, timeBox);
    this.hint.innerHTML = `${esc(t("Swipe left and right to change lane"))}<br>${esc(t("Up to jump · down to slide"))}<br><small>${esc(t("Keys: ← → or A D · ↑ W Space · ↓ S"))}</small>`;
    const quit = el("button", "dash-quit ibtn glass");
    quit.innerHTML = icon("close", "", 18);
    quit.setAttribute("aria-label", t("Leave the run"));
    quit.addEventListener("click", () => this.opts.onLeave());
    this.hud.append(top, stats, this.chips, this.warn, this.hint, this.endEl, quit);
    this.hud.dataset.ui = "1";
    h.ui.append(this.hud);
    h.controls.enabled = false;
    h.controls.showActions(false);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("pointerdown", this.ptrDown);
    window.addEventListener("pointerup", this.ptrUp);
    this.placeCoins();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.over || this.host.paused) return;
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") this.input.left = true;
    else if (k === "arrowright" || k === "d") this.input.right = true;
    else if (k === "arrowup" || k === "w" || k === " ") this.input.jump = true;
    else if (k === "arrowdown" || k === "s") this.input.slide = true;
    else return;
    e.preventDefault();
  }

  private onSwipe(e: PointerEvent): void {
    const a = this.touchAt;
    this.touchAt = null;
    if (!a || this.over || this.host.paused) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    const far = Math.max(24, Math.min(innerWidth, innerHeight) * 0.05);
    if (Math.hypot(dx, dy) < far) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) this.input.left = true;
      else this.input.right = true;
    } else if (dy < 0) this.input.jump = true;
    else this.input.slide = true;
  }

  /** Fixed step (60 Hz). */
  update(dt: number): void {
    if (this.over || this.host.paused) return;
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      if (Math.ceil(this.countdown) !== before && this.countdown > 0) this.host.sound.countTick(false);
      if (this.countdown <= 0) {
        this.host.sound.countTick(true);
        this.hint.classList.add("gone");
      }
      // The input asked for during the count is kept for the first step (a swipe at "go").
      return;
    }
    stepDash(this.d, this.course, dt, this.input);
    this.input.left = this.input.right = this.input.jump = this.input.slide = false;
    for (const e of this.d.events.splice(0)) this.onEvent(e);
  }

  private onEvent(e: DashEvent): void {
    const s = this.host.sound;
    switch (e.type) {
      case "jump":
        s.jump();
        this.host.haptic("select");
        break;
      case "land":
        s.land();
        break;
      case "lane":
        this.host.haptic("select");
        break;
      case "coin":
        s.pickup();
        break;
      case "pow":
        s.powerUp(e.kind === "jet" ? 2 : 1);
        this.host.haptic("success");
        break;
      case "shield":
        s.powerShock(1, 1);
        this.host.haptic("warning");
        this.hideObstacles();
        break;
      case "stumble":
        s.thud(1);
        s.hurt?.(false);
        this.host.haptic("error");
        this.hideObstacles();
        break;
      case "finish":
        s.victory();
        this.end(true);
        break;
      case "caught":
        s.crash(1);
        s.scream(1);
        this.host.haptic("error");
        this.end(false);
        break;
    }
  }

  /** Obstacles knocked aside (a stumble, a shield): gone from the road. */
  private hideObstacles(): void {
    for (const kind of Object.keys(this.obsMesh) as ObKind[]) {
      const im = this.obsMesh[kind]!;
      this.obsIdx[kind]!.forEach((oi, k) => {
        if (!this.course.obs[oi].gone) return;
        _m.makeScale(0, 0, 0);
        im.setMatrixAt(k, _m);
      });
      im.instanceMatrix.needsUpdate = true;
    }
  }

  /** The coins near enough to see, spinning; the rest (and the taken) hidden. */
  private placeCoins(): void {
    const cs = this.course.coins;
    let n = 0;
    const z = this.d.z;
    for (const c of cs) {
      if (c.taken || c.z < z - 4 || c.z > z + 150) continue;
      if (n >= this.coins.count) break;
      _m.makeRotationY(this.time * 3 + c.z * 0.4).setPosition(laneX(c.lane), c.y + Math.sin(this.time * 4 + c.z) * 0.05, c.z);
      this.coins.setMatrixAt(n++, _m);
    }
    this.coins.count = n;
    this.coins.instanceMatrix.needsUpdate = true;
  }

  /** Every frame: the bodies, the camera, the coins, the screen; then draw. */
  render(dt: number): void {
    const h = this.host;
    const d = this.d;
    this.time += dt;
    const running = !this.over && this.countdown <= 0 && !h.paused;
    const pace = running ? d.speed * (d.stumbleT > 0 ? 0.55 : 1) : 0;
    // You.
    const me = this.bodies[0];
    me.x = d.x;
    me.z = d.z;
    me.y = d.y;
    me.vz = this.over && d.done === "caught" ? 0 : pace;
    me.vx = 0;
    me.slide = d.slideT > 0 ? 1 : 0;
    me.tac = pace > 12 ? 1 : 0;
    // The horde, at its gap behind you (spread across the road, each its own lurch).
    for (let i = 1; i <= 4; i++) {
      const b = this.bodies[i];
      // Drawn closer than they are (the gap shrunk), so a stumble brings them into view behind you.
      const lag = 1.2 + (d.gap - 1.2) * 0.45 + (i - 1) * 1.1;
      b.z = d.z - lag + Math.sin(this.time * 2 + i) * 0.3;
      b.x = laneX((i - 1) % 3) * 0.8 + Math.sin(this.time * 1.3 + i * 2) * 0.4;
      b.vz = running ? 6.2 : 0;
      b.heading = 0;
    }
    if (this.over && d.done === "caught") {
      // They reach you.
      for (let i = 1; i <= 4; i++) this.bodies[i].z = d.z - 0.9 - (i - 1) * 0.5;
    }
    h.crowd.update(dt, this.bodies as unknown as Contestant[], h.camera.position);
    // The camera: behind and above, easing across with you, higher on the jet pack.
    this.camX += (d.x * 0.7 - this.camX) * Math.min(1, dt * 6);
    const wantY = d.jetT > 0 ? 7.6 : 3.3 + d.y * 0.4;
    this.camY += (wantY - this.camY) * Math.min(1, dt * 3);
    const shake = d.stumbleT > 0 ? Math.sin(this.time * 60) * 0.06 : 0;
    h.camera.position.set(this.camX + shake, this.camY, d.z - 6.8);
    h.camera.lookAt(_v.set(d.x * 0.85, 1.3 + d.y * 0.55, d.z + 7));
    // Coins and power-ups.
    this.placeCoins();
    for (let k = 0; k < this.pows.length; k++) {
      const p = this.course.pows[k];
      const g = this.pows[k];
      g.visible = !p.taken && p.z > d.z - 4 && p.z < d.z + 160;
      if (!g.visible) continue;
      g.rotation.y = this.time * 2;
      g.position.y = 1.2 + Math.sin(this.time * 3 + k) * 0.12;
      (g.userData.halo as Group).lookAt(h.camera.position);
    }
    // The screen.
    const L = this.course.length;
    this.bar.style.transform = `scaleX(${Math.min(1, d.z / L).toFixed(4)})`;
    this.hordeDot.style.left = `${(Math.max(0, d.z - d.gap) / L) * 100}%`;
    this.coinEl.textContent = String(d.coins);
    this.timeEl.textContent = fmtTime(d.t);
    const chips: string[] = [];
    if (d.magnetT > 0) chips.push(`<span class="dash-chip magnet">${icon("target", "", 13)}${t("Magnet")} ${Math.ceil(d.magnetT)}</span>`);
    if (d.jetT > 0) chips.push(`<span class="dash-chip jet">${icon("bolt", "", 13)}${t("Jet pack")} ${Math.ceil(d.jetT)}</span>`);
    if (d.shieldT > 0) chips.push(`<span class="dash-chip shield">${icon("brace", "", 13)}${t("Shield")} ${Math.ceil(d.shieldT)}</span>`);
    const key = chips.join("");
    if (this.chips.dataset.k !== key) {
      this.chips.dataset.k = key;
      this.chips.innerHTML = key;
    }
    this.warn.classList.toggle("on", running && d.gap < 7);
    this.hud.classList.toggle("counting", this.countdown > 0);
    if (this.countdown > 0) this.warn.dataset.n = String(Math.ceil(this.countdown));
    // Footfalls at pace.
    if (running && d.y <= 0 && d.slideT <= 0 && this.time >= this.stepAt) {
      this.stepAt = this.time + 3.1 / Math.max(6, pace);
      h.sound.step("concrete", Math.min(1, pace / 15));
    }
    h.draw(GOLDEN);
  }

  private end(finished: boolean): void {
    if (this.over) return;
    this.over = true;
    const d = this.d;
    const r: DashResult = { finished, seconds: d.t, metres: Math.min(d.z, this.course.length), coins: d.coins, level: this.opts.level, length: this.course.length };
    this.opts.onEnd(r);
    const best = finished && (!this.opts.best || d.t < this.opts.best);
    this.endEl.innerHTML = `<b class="h">${esc(t(finished ? "SAFE!" : d.done === "caught" && d.events.length === 0 ? "CAUGHT" : "CAUGHT"))}</b>
      <span class="small">${finished ? `${esc(t("At the Safe Gate in"))} <b class="num">${fmtTime(d.t)}</b>${best ? ` · ${esc(t("your best"))}` : ""}` : `${Math.round(d.z)} m ${esc(t("of"))} ${this.course.length} m`}</span>
      <span class="dash-endrow"><i class="dash-owo"></i><b class="num">${d.coins}</b> ${esc(t("Owo"))}</span>
      <span class="dash-cp" data-cp></span>
      <span class="dash-acts"><button class="btn primary" data-dash="again">${icon("refresh", "", 16)}${esc(t("Run again"))}</button><button class="btn secondary" data-dash="leave">${icon("home", "", 16)}${esc(t("Lobby"))}</button></span>`;
    this.endEl.classList.add("on");
    this.endEl.querySelector('[data-dash="again"]')?.addEventListener("click", () => this.opts.onAgain());
    this.endEl.querySelector('[data-dash="leave"]')?.addEventListener("click", () => this.opts.onLeave());
  }

  /** The CP line on the end card (the session pays it). */
  showPay(text: string): void {
    const e = this.endEl.querySelector<HTMLElement>("[data-cp]");
    if (e) e.textContent = text;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("pointerdown", this.ptrDown);
    window.removeEventListener("pointerup", this.ptrUp);
    this.hud.remove();
    this.group.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      const mat = m.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        x.map?.dispose();
        x.dispose();
      }
    });
    this.group.removeFromParent();
    this.host.crowd.setup([], 0);
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

