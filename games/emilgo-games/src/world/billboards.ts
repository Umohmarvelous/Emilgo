// The billboards on screen (SPEC-V3 §8). The boards' frames are part of the
// city (maps/open/billboards.ts, drawn with the prefabs); this draws what
// they show, and counts the seconds each one was on screen.
//
//   faces    one quad per board, all in one mesh and one draw, on one atlas
//            (a canvas of 16 cells). A slideshow swaps its board's UVs; a
//            new creative swaps them too. Nothing is drawn per board.
//   house    EMILGO Games' own boards, drawn in code (no made-up brands):
//            this week's modes, today's Daily Run, the fastest runs or Lagos
//            Life's own leaderboard, the ranks' rewards, the other mode, and
//            (in the EMILGO app and on the web only) the EMILGO app itself.
//            They fill every board in Lagos Life, and any board with nothing
//            booked anywhere else.
//   paid     the feed's creatives (net/ads.ts): premium ones fixed to their
//            boards for the match, the rest in turn on the boards they may
//            use, each for its cycle (10 s, 30 s, or the whole match).
//   video    one shared <video>, on the nearest board in view that has a film
//            (Medium and High; Low shows the poster). Muted unless the
//            player turned Ads audio on and the advertiser allows sound.
//   seen     four times a second: is each board on screen (in a drawn cell,
//            in the frustum, facing you, big enough to read, nothing solid in
//            the way)? Seconds add up per board and creative. No player id.
//   v6 max   (3.6) two-sided boards: a second quad on the back, the same ad
//            (either face counts, once). Portrait LED towers: their own cells,
//            painted upright and stored turned in the atlas (a creative shown
//            whole on a darkened copy of itself, the house boards laid out
//            tall), on their own material, lit at night.

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Frustum,
  Group,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Sphere,
  Vector3,
  VideoTexture,
  type PerspectiveCamera,
} from "three";

import type { Tier } from "../graphics/tiers";
import type { Space } from "../game/core/space";
import { facesOf, type BoardSlot } from "../maps/open/billboards";
import type { AdFeed, BoardAd, Seen } from "../net/ads";
import type { HostKind } from "../platform/types";
import { TIERS } from "../rank/ladder";
import { t } from "../ui/i18n";
import { fmtTime } from "../ui/dom";
import { HOODIE_DESIGNS } from "./human/wardrobe";

/** What the house boards say (all of it known on the phone, or sent with the match). */
export interface HouseInfo {
  kind: HostKind;
  /** The map's mode family: the other one gets a board. */
  family: "ffa" | "dead";
  /** This week's featured modes, in the player's language. */
  modes: { name: string; blurb: string }[];
  /** Today's Daily Run: its seed, and today's best times when known. */
  daily: { seed: number; top: number[] };
  /** Lagos Life's own leaderboard (its names: the world shows them); [] anywhere else. */
  top: { name: string; score: number }[];
  /** The fastest runs to the Mast (no names), when known. */
  runTop: number[];
}

type HouseKind = "modes" | "daily" | "top" | "ranks" | "other" | "app";

interface House {
  kind: HouseKind;
  /** Which of its kind (the modes board: which mode). */
  n: number;
}

/** What a board shows now: a house board, or a creative's picture. */
/** One face on screen: board `slot`'s front, or its back. */
interface Face {
  slot: number;
  f: { x: number; y: number; z: number; nx: number; nz: number; back: boolean };
  r: number;
}

interface Showing {
  house: House | null;
  ad: BoardAd | null;
  /** The atlas cell. */
  cell: number;
  /** A slideshow's cells in turn. */
  cells: number[];
  /** Seconds of the match when it changes (Infinity: never). */
  until: number;
}

const COLS = 4;
/** Rows of cells: twice as many when the world has portrait towers (their own, upright, cells). */
const ROWS = 4;
/** A slideshow's picture stays this long (s). */
const SLIDE_S = 5;
/** House boards change this often (s). */
const HOUSE_S = 20;
/** Smallest a board may look and still count as seen (its height on screen, px). */
const MIN_PX = 24;
/** The film plays on the nearest board in view within this (m). */
const VIDEO_NEAR = 55;
const TICK = 0.25;

const EMILGO_GREEN = "#009a43";
const GOLD = "#f5a623";

const ROMAN = ["I", "II", "III", "IV", "V"];

/** "pro-1" → "Pro I". */
function rankLabel(id: string): string {
  const m = /^([a-z]+)-(\d)$/.exec(id);
  const tier = m ? TIERS.find((x) => x.id === m[1]) : null;
  return tier && m ? `${tier.name} ${ROMAN[Number(m[2]) - 1] ?? m[2]}` : id;
}

/** Text that fits `w`: the font shrinks until it does. */
function fit(g: CanvasRenderingContext2D, text: string, size: number, w: number, weight = 700): number {
  let s = size;
  for (; s > 8; s -= 1) {
    g.font = `${weight} ${s}px Poppins, "Helvetica Neue", Arial, sans-serif`;
    if (g.measureText(text).width <= w) break;
  }
  return s;
}

function line(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, w: number, color: string, weight = 700): void {
  fit(g, text, size, w, weight);
  g.fillStyle = color;
  g.fillText(text, x, y);
}

/** The house boards a match gets, in turn order. */
function houseList(info: HouseInfo): House[] {
  const out: House[] = [];
  info.modes.slice(0, 3).forEach((_, n) => out.push({ kind: "modes", n }));
  out.push({ kind: "daily", n: 0 });
  if (info.top.length || info.runTop.length) out.push({ kind: "top", n: 0 });
  out.push({ kind: "ranks", n: 0 }, { kind: "ranks", n: 1 });
  out.push({ kind: "other", n: 0 });
  // The EMILGO app is advertised in the EMILGO app and on the web, never in Lagos Life.
  if (info.kind !== "lagoslife") out.push({ kind: "app", n: 0 });
  return out;
}

/** Words over as many lines as they need (a tall board's blurbs). */
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, w: number, color: string, weight = 600): void {
  g.font = `${weight} ${size}px Poppins, "Helvetica Neue", Arial, sans-serif`;
  g.fillStyle = color;
  let row = "";
  let at = y;
  for (const word of text.split(" ")) {
    const next = row ? `${row} ${word}` : word;
    if (row && g.measureText(next).width > w) {
      g.fillText(row, x, at);
      at += size * 1.2;
      row = word;
    } else row = next;
  }
  if (row) g.fillText(row, x, at);
}

/** Paint one house board into a cell (w × h at x, y); taller than wide: the portrait tower's layout. */
function paintHouse(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, b: House, info: HouseInfo, night: boolean): void {
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  const pad = w * 0.06;
  const tw = w - pad * 2;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  const grad = (a: string, c: string) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, a);
    gr.addColorStop(1, c);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  };
  const tall = h > w;
  const footer = (text: string, color = "rgba(255,255,255,0.75)") => line(g, text, pad, h - h * 0.08, tall ? h * 0.04 : h * 0.075, tw, color, 600);
  // A blurb: one shrinking line on a wide board, wrapped lines on a tall one.
  const say = (text: string, y: number, size: number, color: string, weight = 600) => (tall ? wrap(g, text, pad, y, size * 0.5, tw, color, weight) : line(g, text, pad, y, size, tw, color, weight));
  switch (b.kind) {
    case "modes": {
      const m = info.modes[b.n % Math.max(1, info.modes.length)];
      grad(night ? "#062a1c" : "#00553a", night ? "#0b3d2a" : "#008751");
      g.fillStyle = GOLD;
      g.fillRect(0, 0, w * 0.018, h);
      line(g, t("THIS WEEK IN FREE FOR ALL"), pad, h * 0.2, h * 0.08, tw, GOLD, 700);
      line(g, m?.name ?? "Free For All", pad, h * 0.45, h * 0.2, tw, "#ffffff", 800);
      say(m?.blurb ?? "", h * 0.63, h * 0.085, "rgba(255,255,255,0.9)", 500);
      footer("EMILGO Games");
      break;
    }
    case "daily": {
      grad("#1a0606", "#4a0c0c");
      line(g, t("TODAY'S DAILY RUN"), pad, h * 0.2, h * 0.08, tw, "#ff8a6a", 700);
      line(g, `${t("Seed")} ${info.daily.seed}`, pad, h * 0.45, h * 0.18, tw, "#ffffff", 800);
      const best = info.daily.top[0];
      say(best ? `${t("Best today")} ${fmtTime(best)}` : t("Same city, same dead, for everyone"), h * 0.63, h * 0.085, "rgba(255,255,255,0.9)", 500);
      footer("Dead Streets · EMILGO Games");
      break;
    }
    case "top": {
      grad(night ? "#0d1420" : "#13223a", night ? "#141e30" : "#1e3a5f");
      const ll = info.top.length > 0;
      line(g, ll ? t("TOP THIS WEEK") : t("FASTEST TO THE MAST"), pad, h * 0.18, h * 0.08, tw, GOLD, 700);
      const rows = ll ? info.top.slice(0, 3).map((r, i) => `${i + 1}. ${r.name} · ${r.score}`) : info.runTop.slice(0, 3).map((s, i) => `${i + 1}. ${fmtTime(s)}`);
      rows.forEach((r, i) => line(g, r, pad, h * (0.38 + i * 0.16), h * 0.12, tw, "#ffffff", 700));
      footer(ll ? "Lagos Life · EMILGO Games" : "Dead Streets · EMILGO Games");
      break;
    }
    case "ranks": {
      const ranked = HOODIE_DESIGNS.filter((d) => d.rank);
      const pick = ranked[(b.n * 3 + 1) % ranked.length];
      grad("#2a1c00", "#5a3c00");
      g.fillStyle = GOLD;
      g.fillRect(0, h - h * 0.03, w, h * 0.03);
      line(g, t("RANK REWARD"), pad, h * 0.2, h * 0.08, tw, GOLD, 700);
      line(g, rankLabel(pick?.rank ?? "pro-1"), pad, h * 0.44, h * 0.18, tw, "#ffffff", 800);
      say(`${t("unlocks")} ${pick?.name ?? ""}`, h * 0.62, h * 0.09, "rgba(255,255,255,0.92)", 500);
      footer("EMILGO Games");
      break;
    }
    case "other": {
      if (info.family === "ffa") {
        grad("#0a0a0a", "#3a0a0a");
        line(g, "DEAD STREETS", pad, h * 0.36, h * 0.2, tw, "#e8e0d0", 800);
        say(t("Cross the dead city. Reach the Mast."), h * 0.56, h * 0.09, "#ff8a6a", 600);
      } else {
        grad("#00553a", "#008751");
        line(g, "FREE FOR ALL", pad, h * 0.36, h * 0.2, tw, "#ffffff", 800);
        say(t("Twelve players. Melee only. One city."), h * 0.56, h * 0.09, GOLD, 600);
      }
      footer("EMILGO Games");
      break;
    }
    case "app": {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, w, h);
      g.fillStyle = EMILGO_GREEN;
      g.fillRect(0, 0, w, h * 0.12);
      g.fillStyle = GOLD;
      g.fillRect(0, h * 0.12, w, h * 0.02);
      line(g, "EMILGO", pad, h * 0.46, h * 0.22, tw, EMILGO_GREEN, 800);
      if (tall) say(`${t("Live-tracked trips and fare payment")} ${t("for drivers, passengers and parks")}`, h * 0.6, h * 0.085, "#1a1a1a", 600);
      else {
        line(g, t("Live-tracked trips and fare payment"), pad, h * 0.64, h * 0.085, tw, "#1a1a1a", 600);
        line(g, t("for drivers, passengers and parks"), pad, h * 0.77, h * 0.075, tw, "#4a4a4a", 500);
      }
      break;
    }
  }
  g.restore();
}

/** A creative on a tall board: whole, in the middle, over a darkened, cover-fitted copy of itself (digital signage's way). */
function paintTall(g: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, w: number, h: number): void {
  paintImage(g, img, 0, 0, w, h);
  g.fillStyle = "rgba(6,8,10,0.62)";
  g.fillRect(0, 0, w, h);
  const iw = img.width || 1;
  const ih = img.height || 1;
  const k = Math.min(w / iw, h / ih);
  g.drawImage(img, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
}

/** A picture, cover-fitted into a cell. */
function paintImage(g: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number): void {
  const iw = img.width || 1;
  const ih = img.height || 1;
  const k = Math.max(w / iw, h / ih);
  const sw = w / k;
  const sh = h / k;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  g.restore();
}

export class BillboardView {
  readonly group = new Group();
  private readonly canvas = document.createElement("canvas");
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: CanvasTexture;
  private readonly geo = new BufferGeometry();
  private readonly mat: MeshBasicMaterial;
  /** v6 max (3.6): the portrait towers' LED faces: their own material, lit at night. */
  private readonly lit: MeshBasicMaterial;
  private readonly uv: BufferAttribute;
  private readonly cw: number;
  private readonly ch: number;
  private readonly cells: number;
  private readonly house: House[];
  /** Cells by owner: "h:<i>" a house board, "<url>" a picture; "ph:<i>", "p:<url>" their upright copies (towers). */
  private readonly cellOf = new Map<string, number>();
  private nextCell = 0;
  /** Is there a wide board / a tower at all (which copies a picture needs). */
  private readonly wide: boolean;
  private readonly tall: boolean;
  private readonly showing: Showing[];
  /** Each board's turn through its rotation and through the house boards (they start offset, so neighbours differ). */
  private readonly turn: number[];
  private readonly houseTurn: number[];
  private readonly faces: Face[] = [];
  /** Each board's faces (their places in `faces`). */
  private readonly facesOfSlot: number[][];
  private readonly seconds: Float32Array;
  /** The tick each board was last counted in (a board seen by both faces counts once). */
  private readonly countedAt: Float64Array;
  private readonly seenBy = new Map<string, number>();
  private readonly ready = new Map<string, boolean>();
  private dirty = false;
  private uploadAt = 0;
  private time = 0;
  private tickAt = 0;
  private dim = 0;
  private disposed = false;
  // The film (made when a feed books one).
  private video: HTMLVideoElement | null = null;
  private vtex: VideoTexture | null = null;
  private vmesh: Mesh | null = null;
  private vslot = -1;
  private vsrc = "";
  private readonly frustum = new Frustum();
  private readonly pv = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly v3 = new Vector3();

  constructor(
    private readonly slots: readonly BoardSlot[],
    private readonly opts: {
      readonly tier: Tier;
      night: boolean;
      info: HouseInfo;
      feed: AdFeed | null;
      space: Space;
      /** Is the city cell at (x, z) drawn now (in range, and not hidden by the PVS)? */
      cellOn: (x: number, z: number) => boolean;
      /** Ads audio: on, and its volume (0…1, the master already in). */
      audio: () => { on: boolean; vol: number };
    },
  ) {
    const tier = opts.tier;
    this.cw = tier === 0 ? 256 : 512;
    this.ch = this.cw / 2;
    this.tall = slots.some((b) => b.portrait);
    this.wide = slots.some((b) => !b.portrait);
    const rows = this.tall && this.wide ? ROWS * 2 : ROWS;
    this.cells = COLS * rows;
    this.canvas.width = this.cw * COLS;
    this.canvas.height = this.ch * rows;
    this.g = this.canvas.getContext("2d")!;
    this.g.fillStyle = "#1a1c1e";
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.minFilter = LinearMipmapLinearFilter;
    this.tex.anisotropy = tier === 0 ? 1 : 4;
    this.mat = new MeshBasicMaterial({ map: this.tex, color: new Color(1, 1, 1) });
    this.lit = new MeshBasicMaterial({ map: this.tex, color: new Color(1, 1, 1) });
    this.house = houseList(opts.info);
    this.house.forEach((_, i) => {
      if (this.wide) this.houseCell(i, false);
      if (this.tall) this.houseCell(i, true);
    });
    // Every face, one quad each: the wide boards' first, then the towers' (a group each: two materials, two draws).
    this.facesOfSlot = slots.map(() => []);
    for (const tall of [false, true]) {
      slots.forEach((b, i) => {
        if (b.portrait !== tall) return;
        for (const f of facesOf(b)) {
          this.facesOfSlot[i].push(this.faces.length);
          this.faces.push({ slot: i, f, r: Math.hypot(b.w, b.h) / 2 });
        }
      });
    }
    const n = this.faces.length;
    const pos = new Float32Array(n * 12);
    const idx: number[] = [];
    let wideFaces = 0;
    this.faces.forEach(({ slot, f }, j) => {
      const b = slots[slot];
      if (!b.portrait) wideFaces++;
      // A back face runs the other way along the board (it reads right from behind).
      const s = f.back ? -1 : 1;
      const tx = Math.cos(b.rot) * s;
      const tz = -Math.sin(b.rot) * s;
      const hw = b.w / 2;
      const hh = b.h / 2;
      const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      corners.forEach(([u, v], k) => pos.set([f.x + tx * u, f.y + v, f.z + tz * u], j * 12 + k * 3));
      idx.push(j * 4, j * 4 + 1, j * 4 + 2, j * 4, j * 4 + 2, j * 4 + 3);
    });
    this.geo.setAttribute("position", new BufferAttribute(pos, 3));
    this.uv = new BufferAttribute(new Float32Array(n * 8), 2);
    this.uv.setUsage(DynamicDrawUsage);
    this.geo.setAttribute("uv", this.uv);
    this.geo.setIndex(idx);
    this.geo.addGroup(0, wideFaces * 6, 0);
    this.geo.addGroup(wideFaces * 6, (n - wideFaces) * 6, 1);
    this.geo.computeBoundingSphere();
    const faces = new Mesh(this.geo, [this.mat, this.lit]);
    faces.frustumCulled = false;
    faces.matrixAutoUpdate = false;
    this.group.add(faces);
    this.seconds = new Float32Array(slots.length);
    this.countedAt = new Float64Array(slots.length).fill(-1);
    this.turn = slots.map((_, i) => i);
    this.houseTurn = slots.map((_, i) => i);
    // What each board shows first; the pictures load behind (house boards until they arrive).
    this.showing = slots.map((_, i) => this.pick(i, 0));
    this.showing.forEach((s, i) => this.setUv(i, s.cell));
    this.setFeed(opts.feed);
    this.applyDim();
  }

  /**
   * This match's creatives (the feed comes while the match starts): their
   * pictures load, and every board looks again (house boards until they arrive).
   */
  setFeed(feed: AdFeed | null): void {
    this.opts.feed = feed;
    for (const ad of feed?.ads ?? []) {
      const urls = ad.format === "video" ? [ad.poster!] : ad.images;
      // Only the copies its boards need: a booking on towers alone needs no wide copy, and the other way round.
      const on = this.slots.filter((b) => (ad.premium ? ad.slots.includes(b.id) : !ad.slots.length || ad.slots.includes(b.id)));
      const wide = on.some((b) => !b.portrait);
      const tall = on.some((b) => b.portrait);
      for (const u of urls) this.load(u, wide, tall);
    }
    for (const s of this.showing) s.until = Math.min(s.until, this.time + 0.5);
    // The film: Medium and High only, and only if a film is booked.
    if (this.opts.tier > 0 && !this.video && (feed?.ads ?? []).some((a) => a.format === "video")) {
      const v = document.createElement("video");
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.crossOrigin = "anonymous";
      v.preload = "none";
      v.setAttribute("playsinline", "");
      this.video = v;
      this.vtex = new VideoTexture(v);
      this.vtex.colorSpace = SRGBColorSpace;
      this.vmesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: this.vtex }));
      this.vmesh.visible = false;
      this.group.add(this.vmesh);
      this.applyDim();
    }
  }

  /** The house board's cell (drawn once); `tall`: its upright copy for the towers. */
  private houseCell(i: number, tall: boolean): number {
    const key = `${tall ? "ph" : "h"}:${i}`;
    let c = this.cellOf.get(key);
    if (c !== undefined) return c;
    c = Math.min(this.nextCell++, this.cells - 1);
    this.cellOf.set(key, c);
    const [x, y] = this.cellXY(c);
    if (tall) {
      const up = this.upright();
      paintHouse(up.getContext("2d")!, 0, 0, up.width, up.height, this.house[i], this.opts.info, this.opts.night);
      this.putUpright(up, c);
    } else paintHouse(this.g, x, y, this.cw, this.ch, this.house[i], this.opts.info, this.opts.night);
    this.dirty = true;
    return c;
  }

  /** A canvas the shape of a tower's face (a cell stood on end). */
  private upright(): HTMLCanvasElement {
    const up = document.createElement("canvas");
    up.width = this.ch;
    up.height = this.cw;
    return up;
  }

  /** An upright picture into cell c, turned a quarter (its top along the cell's left): setUv turns it back. */
  private putUpright(up: HTMLCanvasElement, c: number): void {
    const [x, y] = this.cellXY(c);
    this.g.save();
    this.g.translate(x, y + this.ch);
    this.g.rotate(-Math.PI / 2);
    this.g.drawImage(up, 0, 0);
    this.g.restore();
  }

  private cellXY(c: number): [number, number] {
    return [(c % COLS) * this.cw, Math.floor(c / COLS) * this.ch];
  }

  /** Load a picture into a cell of its own (if there's one left): a wide copy, an upright one, or both. */
  private load(url: string, wide: boolean, tall: boolean): void {
    const wc = wide && !this.cellOf.has(url) && this.nextCell < this.cells ? this.nextCell++ : -1;
    const tc = tall && !this.cellOf.has(`p:${url}`) && this.nextCell < this.cells ? this.nextCell++ : -1;
    if (wc < 0 && tc < 0) return;
    if (wc >= 0) {
      this.cellOf.set(url, wc);
      this.ready.set(url, false);
    }
    if (tc >= 0) {
      this.cellOf.set(`p:${url}`, tc);
      this.ready.set(`p:${url}`, false);
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      if (this.disposed) return;
      // Through a scratch canvas first: a picture from a host that refuses CORS
      // would taint the atlas, and a tainted atlas can never be uploaded again.
      if (wc >= 0) {
        const scratch = document.createElement("canvas");
        scratch.width = this.cw;
        scratch.height = this.ch;
        const sg = scratch.getContext("2d")!;
        try {
          paintImage(sg, img, 0, 0, this.cw, this.ch);
          sg.getImageData(0, 0, 1, 1);
          const [x, y] = this.cellXY(wc);
          this.g.drawImage(scratch, x, y);
          this.ready.set(url, true);
        } catch {
          this.ready.set(url, false);
        }
      }
      if (tc >= 0) {
        const up = this.upright();
        const ug = up.getContext("2d")!;
        try {
          paintTall(ug, img, up.width, up.height);
          ug.getImageData(0, 0, 1, 1);
          this.putUpright(up, tc);
          this.ready.set(`p:${url}`, true);
        } catch {
          this.ready.set(`p:${url}`, false);
        }
      }
      this.dirty = true;
    };
    img.onerror = () => {
      this.ready.set(url, false);
      this.ready.set(`p:${url}`, false);
    };
    img.src = url;
  }

  /** The creatives that may go on board i: its premium booking, else the rotation that may use it. */
  private poolFor(i: number): { premium: BoardAd | null; pool: BoardAd[] } {
    const id = this.slots[i].id;
    const ads = this.opts.feed?.ads ?? [];
    const premium = ads.find((a) => a.premium && a.slots.includes(id)) ?? null;
    if (premium) return { premium, pool: [] };
    return { premium: null, pool: ads.filter((a) => !a.premium && (!a.slots.length || a.slots.includes(id))) };
  }

  /** What board i shows from second `at` of the match. */
  private pick(i: number, at: number): Showing {
    const { premium, pool } = this.poolFor(i);
    const tall = this.slots[i].portrait;
    const ad = premium ?? (pool.length ? pool[this.turn[i]++ % pool.length] : null);
    if (ad) {
      const urls = (ad.format === "video" ? [ad.poster!] : ad.images).map((u) => (tall ? `p:${u}` : u));
      const cells = urls.map((u) => (this.ready.get(u) ? this.cellOf.get(u)! : -1)).filter((c) => c >= 0);
      if (cells.length) {
        const until = premium || ad.cycle === 0 ? Infinity : at + ad.cycle;
        return { house: null, ad, cell: cells[0], cells, until };
      }
      // Not loaded (yet): a house board meanwhile, and look again soon.
    }
    if (ad && !premium) this.turn[i]--; // its turn comes again once it has loaded
    // Waiting for a picture: the same house board meanwhile (no flicker every 2 s).
    const h = (ad ? this.houseTurn[i] : this.houseTurn[i]++) % this.house.length;
    return { house: this.house[h], ad: null, cell: this.houseCell(h, tall), cells: [], until: ad ? at + 2 : at + HOUSE_S };
  }

  private setUv(i: number, c: number): void {
    const [x, y] = this.cellXY(c);
    const W = this.canvas.width;
    const H = this.canvas.height;
    // Two pixels in from the cell's edge: the mipmaps don't bleed in the neighbour.
    const u0 = (x + 2) / W;
    const u1 = (x + this.cw - 2) / W;
    const v1 = 1 - (y + 2) / H;
    const v0 = 1 - (y + this.ch - 2) / H;
    const a = this.uv.array as Float32Array;
    // A tower's cell holds its picture turned a quarter (putUpright): its corners turn back.
    const uv = this.slots[i].portrait ? [u1, v0, u1, v1, u0, v1, u0, v0] : [u0, v0, u1, v0, u1, v1, u0, v1];
    for (const j of this.facesOfSlot[i]) a.set(uv, j * 8);
    this.uv.needsUpdate = true;
  }

  /** Lights Out (0 as built … 1 a power cut): the boards go dark with the city. */
  setDim(k: number): void {
    this.dim = Math.max(0, Math.min(1, k));
    this.applyDim();
  }

  private applyDim(): void {
    const base = this.opts.night ? 0.55 : 0.94;
    const k = base * (1 - 0.85 * this.dim);
    this.mat.color.setRGB(k, k, k);
    // The towers' LEDs: full at night (brighter than the lit boards), and out in a power cut.
    const led = (this.opts.night ? 1.15 : 1) * (1 - 0.92 * this.dim);
    this.lit.color.setRGB(led, led, led);
    (this.vmesh?.material as MeshBasicMaterial | undefined)?.color.setRGB(k, k, k);
  }

  /** Per frame: what each board shows, the film, and the seconds on screen. */
  update(dt: number, cam: PerspectiveCamera): void {
    this.time += dt;
    // Pictures that arrived: one upload, at most twice a second.
    if (this.dirty && this.time >= this.uploadAt) {
      this.tex.needsUpdate = true;
      this.dirty = false;
      this.uploadAt = this.time + 0.5;
    }
    for (let i = 0; i < this.showing.length; i++) {
      const s = this.showing[i];
      if (this.time >= s.until) {
        this.showing[i] = this.pick(i, this.time);
        this.setUv(i, this.showing[i].cell);
      } else if (s.cells.length > 1) {
        const c = s.cells[Math.floor(this.time / SLIDE_S) % s.cells.length];
        if (c !== s.cell) {
          s.cell = c;
          this.setUv(i, c);
        }
      }
    }
    if (this.time < this.tickAt) return;
    this.tickAt = this.time + TICK;
    cam.updateMatrixWorld();
    this.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const px = window.innerHeight / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const c = cam.position;
    let near = -1;
    let nearD = VIDEO_NEAR;
    for (let j = 0; j < this.faces.length; j++) {
      const { slot: i, f, r } = this.faces[j];
      const b = this.slots[i];
      if (this.countedAt[i] === this.tickAt) continue; // its other face was counted this tick
      const dx = f.x - c.x;
      const dz = f.z - c.z;
      const d = Math.hypot(dx, dz, f.y - c.y);
      if (dx * f.nx + dz * f.nz >= 0) continue; // its back is to you
      if ((b.h / Math.max(1, d)) * px < MIN_PX) continue;
      if (!this.opts.cellOn(f.x, f.z)) continue;
      this.sphere.set(this.v3.set(f.x, f.y, f.z), r);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      // Nothing solid in the way: the sight line half way up, to just in front of the face.
      const y = c.y + (f.y - c.y) * 0.5;
      if (!this.opts.space.lineClear(c.x, c.z, f.x + f.nx * 0.8, f.z + f.nz * 0.8, y)) continue;
      this.seconds[i] += TICK;
      this.countedAt[i] = this.tickAt;
      const ad = this.showing[i].ad;
      if (ad) {
        const key = `${b.id}|${ad.id}`;
        this.seenBy.set(key, (this.seenBy.get(key) ?? 0) + TICK);
        // The film plays on wide faces (a tower shows its poster).
        if (ad.format === "video" && !b.portrait && d < nearD) {
          near = j;
          nearD = d;
        }
      }
    }
    this.film(near, nearD);
  }

  /** The shared film on face `j` (−1: none in view). */
  private film(j: number, d: number): void {
    const v = this.video;
    const m = this.vmesh;
    if (!v || !m) return;
    if (j < 0) {
      if (this.vslot >= 0) {
        v.pause();
        m.visible = false;
        this.vslot = -1;
      }
      return;
    }
    const { slot: i, f } = this.faces[j];
    const ad = this.showing[i].ad!;
    if (j !== this.vslot) {
      const b = this.slots[i];
      m.position.set(f.x + f.nx * 0.01, f.y, f.z + f.nz * 0.01);
      m.rotation.set(0, b.rot + (f.back ? Math.PI : 0), 0);
      m.scale.set(b.w, b.h, 1);
      this.vslot = j;
      if (this.vsrc !== ad.video) {
        this.vsrc = ad.video!;
        v.src = ad.video!;
      }
      m.visible = true;
      void v.play().catch(() => {
        // Sound not allowed yet: play muted.
        v.muted = true;
        void v.play().catch(() => (m.visible = false));
      });
    }
    const a = this.opts.audio();
    const loud = a.on && ad.audio;
    v.muted = !loud;
    v.volume = loud ? Math.max(0, Math.min(1, a.vol * (1 - d / VIDEO_NEAR))) : 0;
  }

  /** The match's seconds on screen per paid board, for the report. */
  seen(): Seen[] {
    const out: Seen[] = [];
    for (const [k, s] of this.seenBy) {
      const [slot, ad] = k.split("|");
      out.push([slot, ad, s]);
    }
    return out;
  }

  /** Seconds each board was on screen (house boards too; the dev page and the tests). */
  boardSeconds(): { id: string; s: number; ad: string | null }[] {
    return this.slots.map((b, i) => ({ id: b.id, s: this.seconds[i], ad: this.showing[i].ad?.id ?? null }));
  }

  dispose(): void {
    this.disposed = true;
    this.geo.dispose();
    this.mat.dispose();
    this.lit.dispose();
    this.tex.dispose();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
    }
    this.vtex?.dispose();
    if (this.vmesh) {
      this.vmesh.geometry.dispose();
      (this.vmesh.material as MeshBasicMaterial).dispose();
    }
  }
}
