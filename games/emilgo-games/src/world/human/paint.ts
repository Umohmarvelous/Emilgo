// A person's texture, painted on a canvas: skin, face, clothes, hair.
//
// Every region is painted in its own coordinates (metres round and along the
// body part), so an Ankara motif is the same size on a sleeve as on a chest,
// and a neckline sits where a neck actually is. Patterns are generated from a
// seed, so the same look always gets the same cloth.
//
// Sizes per tier: 256 / 512 / 1024 (UPGRADE.md, graphics tiers).

import { HEAD_EPS, HEAD_GRID, PALETTE_COLS, PALETTE_ROWS, UV, CELL, headWarpU, headWarpV, type Rect } from "./layout";
import { FACE, skirtSpan, type Tier } from "./mesh";
import { PROPORTIONS, restPositions, type Proportions } from "./skeleton";
import { HAIR_COLORS, OUTFIT_BY_ID, SKIN_TONES, type Look, type Outfit, type Pattern } from "./wardrobe";

export const TEX_SIZE = [256, 512, 1024] as const;

type Ctx = CanvasRenderingContext2D;

// ── Colour helpers ────────────────────────────────────────────────────────────

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb(r: number, g: number, b: number, a = 1): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}
/** Multiply (k < 1 darker) or lift towards white (k > 1). */
function shade(hex: string, k: number, a = 1): string {
  const [r, g, b] = hexRgb(hex);
  if (k <= 1) return rgb(r * k, g * k, b * k, a);
  const t = k - 1;
  return rgb(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t, a);
}
/** Like shade() but returns a #hex, for colours that are shaded again later. */
function shadeHex(hex: string, k: number): string {
  const [r, g, b] = hexRgb(hex);
  const f = (c: number) => Math.round(k <= 1 ? c * k : c + (255 - c) * (k - 1)).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexRgb(a);
  const [r2, g2, b2] = hexRgb(b);
  return rgb(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** Tiny seeded PRNG (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ── Regions ───────────────────────────────────────────────────────────────────

/**
 * A rectangle of the canvas with a metric coordinate system: x in metres round
 * the part (0 = back seam, circumference = full width), y in metres along it.
 */
class Region {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  constructor(
    readonly g: Ctx,
    size: number,
    rect: Rect,
    /** Metres round the part (width) and along it (height). */
    readonly mw: number,
    readonly mh: number,
  ) {
    this.x0 = rect[0] * size;
    this.w = (rect[2] - rect[0]) * size;
    // Canvas y grows downwards; v grows upwards.
    this.y0 = (1 - rect[3]) * size;
    this.h = (rect[3] - rect[1]) * size;
  }
  /** Run `fn` clipped to this region, in metres (y measured from the region's BOTTOM edge). */
  draw(fn: (g: Ctx) => void): void {
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(this.x0, this.y0, this.w, this.h);
    g.clip();
    g.translate(this.x0, this.y0 + this.h);
    g.scale(this.w / this.mw, -this.h / this.mh);
    fn(g);
    g.restore();
  }
}

// ── Patterns (drawn in metres) ────────────────────────────────────────────────

function fillPattern(g: Ctx, pat: Pattern, x: number, y: number, w: number, h: number, rnd: () => number, detail: number): void {
  switch (pat.kind) {
    case "plain":
    case "knit":
    case "sheen": {
      const base = pat.color;
      g.fillStyle = base;
      g.fillRect(x, y, w, h);
      if (pat.kind === "knit") {
        // Ribbing: soft vertical lines.
        g.fillStyle = shade(base, 0.9, 0.5);
        for (let xx = x; xx < x + w; xx += 0.008) g.fillRect(xx, y, 0.0025, h);
      }
      if (pat.kind === "sheen") {
        const gr = g.createLinearGradient(x, y, x + w * 0.25, y + h);
        gr.addColorStop(0, shade(base, 1.18, 0.0));
        gr.addColorStop(0.5, shade(base, 1.25, 0.35));
        gr.addColorStop(1, shade(base, 0.85, 0.0));
        g.fillStyle = gr;
        for (let k = 0; k < 4; k++) g.fillRect(x + (k / 4) * w, y, w / 8, h);
      }
      if (detail > 0) weave(g, base, x, y, w, h, rnd, detail);
      return;
    }
    case "stripes": {
      let i = 0;
      for (let yy = y; yy < y + h; yy += pat.width) {
        g.fillStyle = pat.colors[i % pat.colors.length];
        // Thin accent stripes are a quarter width.
        const thin = pat.colors.length > 2 && i % pat.colors.length === pat.colors.length - 1;
        g.fillRect(x, yy, w, thin ? pat.width * 0.3 : pat.width);
        if (thin) yy -= pat.width * 0.7;
        i++;
      }
      return;
    }
    case "denim": {
      g.fillStyle = pat.color;
      g.fillRect(x, y, w, h);
      // Twill: fine diagonal lines, lighter and darker.
      g.lineWidth = 0.0012;
      for (let d = -h; d < w + h; d += 0.004) {
        g.strokeStyle = rnd() < 0.5 ? shade(pat.color, 1.15, 0.35) : shade(pat.color, 0.82, 0.35);
        g.beginPath();
        g.moveTo(x + d, y);
        g.lineTo(x + d + h * 0.6, y + h);
        g.stroke();
      }
      if (detail > 0) weave(g, pat.color, x, y, w, h, rnd, detail);
      return;
    }
    case "camo": {
      g.fillStyle = pat.colors[0];
      g.fillRect(x, y, w, h);
      // Digital camo: clusters of small squares.
      const s = 0.012;
      const n = Math.ceil((w * h) / (s * s) / 6);
      for (let i = 0; i < n; i++) {
        const cx = x + rnd() * w;
        const cy = y + rnd() * h;
        g.fillStyle = pat.colors[1 + Math.floor(rnd() * (pat.colors.length - 1))];
        const k = 1 + Math.floor(rnd() * 4);
        for (let j = 0; j < k; j++) g.fillRect(Math.round((cx + (rnd() - 0.5) * s * 3) / s) * s, Math.round((cy + (rnd() - 0.5) * s * 3) / s) * s, s, s);
      }
      return;
    }
    case "jersey": {
      g.fillStyle = pat.color;
      g.fillRect(x, y, w, h);
      // Mesh texture and side panels in the trim colour.
      g.fillStyle = shade(pat.color, 0.9, 0.4);
      for (let yy = y; yy < y + h; yy += 0.01) for (let xx = x + ((yy * 100) % 2) * 0.005; xx < x + w; xx += 0.01) g.fillRect(xx, yy, 0.003, 0.003);
      return;
    }
    case "ankara":
      ankara(g, pat.colors, pat.motif, x, y, w, h, rnd);
      return;
    case "patchwork": {
      // Rectangles of different Ankara prints, like the hem of IMG_7770.
      let xx = x;
      while (xx < x + w) {
        const pw = 0.035 + rnd() * 0.05;
        let yy = y;
        while (yy < y + h) {
          const ph = 0.04 + rnd() * 0.06;
          const pal = pat.palettes[Math.floor(rnd() * pat.palettes.length)];
          const motifs = ["circles", "leaves", "diamonds", "waves"] as const;
          g.save();
          g.beginPath();
          g.rect(xx, yy, pw, ph);
          g.clip();
          ankara(g, pal, motifs[Math.floor(rnd() * 4)], xx, yy, pw, ph, rnd, 0.035);
          g.restore();
          g.strokeStyle = "rgba(20,15,10,0.35)";
          g.lineWidth = 0.0015;
          g.strokeRect(xx, yy, pw, ph);
          yy += ph;
        }
        xx += pw;
      }
      return;
    }
  }
}

/** Fine cloth noise, only where there are enough pixels to see it. */
function weave(g: Ctx, base: string, x: number, y: number, w: number, h: number, rnd: () => number, detail: number): void {
  const n = Math.round(w * h * 9000 * detail);
  for (let i = 0; i < n; i++) {
    g.fillStyle = rnd() < 0.5 ? shade(base, 1.08, 0.25) : shade(base, 0.9, 0.25);
    g.fillRect(x + rnd() * w, y + rnd() * h, 0.003, 0.003);
  }
}

function ankara(g: Ctx, c: string[], motif: "circles" | "leaves" | "diamonds" | "waves", x: number, y: number, w: number, h: number, rnd: () => number, tile = 0.07): void {
  g.fillStyle = c[0];
  g.fillRect(x, y, w, h);
  const ox = rnd() * tile;
  for (let ty = y - tile; ty < y + h + tile; ty += tile) {
    const row = Math.round((ty - y) / tile);
    for (let tx = x - tile + (row % 2) * tile * 0.5 - ox; tx < x + w + tile; tx += tile) {
      const cx = tx + tile / 2;
      const cy = ty + tile / 2;
      switch (motif) {
        case "circles":
          for (let k = 3; k >= 1; k--) {
            g.fillStyle = c[k % c.length === 0 ? 1 : k % c.length];
            g.beginPath();
            g.arc(cx, cy, (tile * 0.42 * k) / 3, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = c[4 % c.length];
          g.beginPath();
          g.arc(cx, cy, tile * 0.06, 0, Math.PI * 2);
          g.fill();
          break;
        case "leaves":
          for (let k = 0; k < 4; k++) {
            g.fillStyle = c[1 + (k % (c.length - 1))];
            g.beginPath();
            g.ellipse(cx, cy, tile * 0.36, tile * 0.12, (k * Math.PI) / 4 + row * 0.3, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = c[0];
          g.beginPath();
          g.arc(cx, cy, tile * 0.07, 0, Math.PI * 2);
          g.fill();
          break;
        case "diamonds":
          g.fillStyle = c[1];
          g.beginPath();
          g.moveTo(cx, cy - tile * 0.45);
          g.lineTo(cx + tile * 0.32, cy);
          g.lineTo(cx, cy + tile * 0.45);
          g.lineTo(cx - tile * 0.32, cy);
          g.fill();
          g.fillStyle = c[2];
          g.beginPath();
          g.moveTo(cx, cy - tile * 0.25);
          g.lineTo(cx + tile * 0.17, cy);
          g.lineTo(cx, cy + tile * 0.25);
          g.lineTo(cx - tile * 0.17, cy);
          g.fill();
          g.fillStyle = c[3 % c.length];
          g.fillRect(cx - tile * 0.04, cy - tile * 0.04, tile * 0.08, tile * 0.08);
          break;
        case "waves":
          g.strokeStyle = c[1 + (row % (c.length - 1))];
          g.lineWidth = tile * 0.14;
          g.beginPath();
          g.moveTo(tx, cy);
          g.bezierCurveTo(tx + tile * 0.25, cy + tile * 0.35, tx + tile * 0.75, cy - tile * 0.35, tx + tile, cy);
          g.stroke();
          break;
      }
    }
  }
}

// ── The painter ───────────────────────────────────────────────────────────────

export function paintLook(look: Look, tier: Tier, size: number = TEX_SIZE[tier]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const p = PROPORTIONS[look.body];
  const o = OUTFIT_BY_ID[look.outfit];
  const skin = SKIN_TONES[look.skin];
  const hairC = HAIR_COLORS[look.hairColor];
  const rnd = prng(hash(look.outfit + look.body + look.skin));
  const detail = tier === 2 ? 1 : tier === 1 ? 0.35 : 0;

  g.fillStyle = skin;
  g.fillRect(0, 0, size, size);

  palette(g, size, look, o, skin, hairC);
  paintHead(g, size, look, p, skin, hairC, tier);
  paintTorso(g, size, look, p, o, skin, rnd, detail);
  paintArms(g, size, p, o, skin, rnd, detail);
  paintLegs(g, size, p, o, skin, rnd, detail);
  if (o.bottom.kind === "skirt" || o.bottom.kind === "dress") paintSkirt(g, size, p, o, rnd, detail);
  paintHair(g, size, look, hairC, rnd);
  if (o.uniform) paintUniform(g, size, look, p);
  return canvas;
}

/**
 * The match uniform's marks: white piping down the outside of the sleeves and
 * trouser legs, a zip up the front, the number on the left chest and big on
 * the back. Drawn in pixels (text can't go through Region's flipped space).
 */
function paintUniform(g: Ctx, size: number, look: Look, p: Proportions): void {
  const [circ, len, y0] = torsoSize(p);
  const px = (rect: Rect, u: number, v: number): [number, number] => [(rect[0] + u * (rect[2] - rect[0])) * size, (1 - (rect[1] + v * (rect[3] - rect[1]))) * size];
  const T = UV.torso;
  const tw = (T[2] - T[0]) * size;
  const th = (T[3] - T[1]) * size;
  const mx = tw / circ; // px per metre round
  const my = th / len; // px per metre up
  const vOf = (y: number) => (y - y0) / len;
  const piping = "#e9e9e9";

  // Zip: from the waistband to the collar, a pull near the top.
  const [zx, zTop] = px(T, 0.5, 0.985);
  const [, zBot] = px(T, 0.5, vOf(p.waistY + 0.01));
  g.fillStyle = "rgba(200,200,205,0.85)";
  g.fillRect(zx - Math.max(0.6, 0.002 * mx), zTop, Math.max(1.2, 0.004 * mx), zBot - zTop);
  g.fillRect(zx - 0.006 * mx, zTop + 0.04 * my, 0.012 * mx, 0.022 * my);

  // Piping on the shoulders down the sleeves (the outer side of each arm).
  for (const [rect, u] of [[UV.armL, UNIFORM_ARM_U.L], [UV.armR, UNIFORM_ARM_U.R]] as const) {
    const w = (rect[2] - rect[0]) * size;
    const x = rect[0] * size + u * w;
    g.fillStyle = piping;
    g.fillRect(x - w * 0.035, (1 - rect[3]) * size, w * 0.07, (rect[3] - rect[1]) * size * 0.985);
  }
  for (const [rect, u] of [[UV.legL, UNIFORM_LEG_U.L], [UV.legR, UNIFORM_LEG_U.R]] as const) {
    const w = (rect[2] - rect[0]) * size;
    const x = rect[0] * size + u * w;
    g.fillStyle = piping;
    g.fillRect(x - w * 0.025, (1 - rect[3]) * size, w * 0.05, (rect[3] - rect[1]) * size);
  }

  // The number: small on the left chest, big across the back.
  const num = String(look.num ?? 0).padStart(2, "0");
  const text = (u: number, v: number, hM: number) => {
    const [x, y] = px(T, u, v);
    const hPx = hM * my;
    g.save();
    g.translate(x, y);
    // The torso's u runs right-to-left seen from outside: mirror the text.
    g.scale(-mx / my, 1);
    g.font = `800 ${Math.round(hPx)}px Montserrat, Inter, Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#f2f2f2";
    g.fillText(num, 0, 0);
    g.restore();
  };
  text(UNIFORM_CHEST_U, vOf(p.chestY + 0.02), 0.06);
  // The back centre is the seam (u = 0 = 1): draw it on both edges, each half shows.
  text(0, vOf(p.chestY - 0.01), 0.15);
  text(1, vOf(p.chestY - 0.01), 0.15);
}

/** Where the uniform's marks sit round each part (u from the back seam). */
const UNIFORM_ARM_U = { L: 0.25, R: 0.75 };
const UNIFORM_LEG_U = { L: 0.25, R: 0.75 };
const UNIFORM_CHEST_U = 0.42;

function palette(g: Ctx, size: number, look: Look, o: Outfit, skin: string, hairC: string): void {
  const [u0, v0, u1, v1] = UV.palette;
  const cw = ((u1 - u0) * size) / PALETTE_COLS;
  const ch = ((v1 - v0) * size) / PALETTE_ROWS;
  const gele = look.outfit === "outfit_gold" ? "#d4a017" : o.accent === "#0a8a4a" ? "#c9a227" : o.accent;
  const colors: Record<number, string> = {
    [CELL.skin]: skin,
    [CELL.lips]: mix(skin, "#6b2a2a", 0.35),
    [CELL.shoe]: o.shoes.color,
    [CELL.sole]: o.shoes.sole,
    [CELL.gold]: "#d4a52a",
    [CELL.metal]: "#b8bcc2",
    [CELL.black]: "#141414",
    [CELL.white]: "#f2f2f2",
    [CELL.lensDark]: "#1b2630",
    [CELL.hair]: hairC,
    [CELL.vest]: o.gear?.vest ?? "#25231f",
    [CELL.gloves]: o.gear?.gloves ?? skin,
    [CELL.pads]: o.gear?.pads ?? "#2b2925",
    [CELL.belt]: o.bottom.belt ? "#3b2a1c" : "#2a2420",
    [CELL.cap]: "#8d1c2b",
    [CELL.gele]: gele,
    [CELL.headset]: "#2b2d31",
    [CELL.strap]: o.shoes.color,
    [CELL.skinDark]: shade(skin, 0.8),
    [CELL.nail]: mix(skin, "#f0d9c8", 0.4),
    [CELL.pouch]: "#3a362e",
    [CELL.geleShine]: shade(gele, 1.25),
    [CELL.capFold]: shade("#8d1c2b", 0.75),
    [CELL.laces]: "#f5f5f5",
  };
  for (const [cell, color] of Object.entries(colors)) {
    const c = Number(cell) % PALETTE_COLS;
    const r = Math.floor(Number(cell) / PALETTE_COLS);
    g.fillStyle = color;
    // Rows count up from the bottom of the block (v grows up).
    g.fillRect(u0 * size + c * cw, (1 - v0) * size - (r + 1) * ch, cw, ch);
  }
}

// ── Face ──────────────────────────────────────────────────────────────────────

function paintHead(g: Ctx, size: number, look: Look, p: Proportions, skin: string, hairC: string, tier: Tier): void {
  const rect = UV.head;
  const [rings, seg] = HEAD_GRID[tier + 1];
  const x0 = rect[0] * size;
  const w = (rect[2] - rect[0]) * size;
  const yTop = (1 - rect[3]) * size;
  const h = (rect[3] - rect[1]) * size;
  // The mesh interpolates UVs LINEARLY between its vertices; so must we.
  const colU = (phi: number) => {
    const x = (phi / (Math.PI * 2)) * seg;
    const j = Math.max(0, Math.min(seg - 1, Math.floor(x)));
    const f = x - j;
    const a = headWarpU((j / seg) * Math.PI * 2);
    const b = headWarpU(((j + 1) / seg) * Math.PI * 2);
    return a + (b - a) * f;
  };
  const span = Math.PI - 2 * HEAD_EPS;
  const rowV = (el: number) => {
    const th = Math.PI / 2 - el;
    const t = (Math.PI - HEAD_EPS - th) / span; // 0 bottom .. 1 top
    const x = Math.max(0, Math.min(1, t)) * (rings - 1);
    const i = Math.min(rings - 2, Math.floor(x));
    const f = x - i;
    const el0 = Math.PI / 2 - (Math.PI - HEAD_EPS - (i / (rings - 1)) * span);
    const el1 = Math.PI / 2 - (Math.PI - HEAD_EPS - ((i + 1) / (rings - 1)) * span);
    const a = headWarpV(el0);
    const b = headWarpV(el1);
    return a + (b - a) * f;
  };
  /** (azimuth from the front, elevation) → canvas px. */
  const at = (az: number, el: number): [number, number] => [x0 + colU(az + Math.PI) * w, yTop + (1 - rowV(el)) * h];
  const path = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([a, e], i) => {
      const [x, y] = at(a, e);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
  };
  const ellipse = (az: number, el: number, ra: number, re: number, n = 20): [number, number][] =>
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return [az + Math.cos(t) * ra, el + Math.sin(t) * re] as [number, number];
    });
  // Soft spot: a radial gradient centred on a face point, sized in px from its angular radius.
  const soft = (az: number, el: number, r: number, color: string, alpha: number) => {
    const [x, y] = at(az, el);
    const [x2] = at(az + r, el);
    const rad = Math.max(1, Math.abs(x2 - x));
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const [cr, cg, cb] = hexRgb(color);
    gr.addColorStop(0, rgb(cr, cg, cb, alpha));
    gr.addColorStop(1, rgb(cr, cg, cb, 0));
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };

  const f = look.body === "f";
  const dark = shadeHex(skin, 0.72);
  const deep = shadeHex(skin, 0.55);

  // Base: skin, a little darker under the jaw and at the back.
  g.fillStyle = skin;
  g.fillRect(x0, yTop, w, h);
  // Under the jaw only (below the chin line), a touch darker.
  const [, chinPx] = at(0, FACE.chinEl - 0.12);
  const under = g.createLinearGradient(0, chinPx, 0, yTop + h);
  under.addColorStop(0, rgb(...hexRgb(skin), 0));
  under.addColorStop(1, shade(skin, 0.8));
  g.fillStyle = under;
  g.fillRect(x0, chinPx, w, yTop + h - chinPx);

  // Cheek warmth, forehead sheen.
  soft(0.55, -0.2, 0.3, f ? "#b85a4a" : "#8a4a32", f ? 0.12 : 0.05);
  soft(-0.55, -0.2, 0.3, f ? "#b85a4a" : "#8a4a32", f ? 0.12 : 0.05);

  // The doll's face: big round eyes, rosy cheeks, a small closed mouth.
  if (look.doll) {
    for (const s of [1, -1]) {
      const ea = s * FACE.eyeAz * 1.05;
      const ee = FACE.eyeEl + 0.02;
      soft(ea, ee, 0.24, "#2a1810", 0.16);
      path(ellipse(ea, ee, 0.165, 0.15, 28));
      g.fillStyle = "#f6f2ec";
      g.fill();
      g.save();
      path(ellipse(ea, ee, 0.165, 0.15, 28));
      g.clip();
      path(ellipse(ea + s * 0.01, ee - 0.01, 0.112, 0.118, 24));
      g.fillStyle = "#2a170c";
      g.fill();
      path(ellipse(ea + s * 0.01, ee - 0.01, 0.06, 0.064, 20));
      g.fillStyle = "#050302";
      g.fill();
      // Two catchlights: the glassy look of a doll's eyes.
      path(ellipse(ea + s * 0.01 - 0.04, ee + 0.035, 0.026, 0.028, 12));
      g.fillStyle = "rgba(255,255,255,0.95)";
      g.fill();
      path(ellipse(ea + s * 0.01 + 0.035, ee - 0.045, 0.012, 0.013, 10));
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.fill();
      g.restore();
      // A heavy upper lash line and three painted lashes at the outer corner.
      const lid: [number, number][] = [];
      for (let i = 0; i <= 20; i++) {
        const t = (i / 20) * Math.PI;
        lid.push([ea - Math.cos(t) * 0.17, ee + Math.sin(t) * 0.155]);
      }
      path(lid);
      g.strokeStyle = "#0e0806";
      g.lineWidth = Math.max(1.5, w * 0.009);
      g.lineCap = "round";
      g.stroke();
      for (let k = 0; k < 3; k++) {
        const t = 0.15 + k * 0.12;
        const a0: [number, number] = [ea + s * Math.cos(t * Math.PI) * 0.17 * -1, ee + Math.sin(t * Math.PI) * 0.155];
        path([a0, [a0[0] + s * 0.05, a0[1] + 0.05 - k * 0.012]]);
        g.lineWidth = Math.max(1, w * 0.005);
        g.stroke();
      }
      // Thin high brows.
      const brow: [number, number][] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        brow.push([ea - s * 0.14 + s * 0.28 * t, FACE.browEl + 0.07 + Math.sin(t * Math.PI) * 0.03]);
      }
      path(brow);
      g.strokeStyle = shade(hairC, 0.9);
      g.lineWidth = Math.max(1, w * 0.0045);
      g.stroke();
      // Rosy cheeks.
      soft(s * 0.5, -0.3, 0.17, "#e05a6a", 0.42);
    }
    // A button nose: two tiny nostrils.
    for (const s of [1, -1]) {
      path(ellipse(s * 0.045, FACE.noseEl - 0.06, 0.016, 0.01, 10));
      g.fillStyle = rgb(...hexRgb(deep), 0.7);
      g.fill();
    }
    // A small closed mouth, a little pout.
    const mE = FACE.mouthEl + 0.04;
    path(ellipse(0, mE + 0.012, 0.085, 0.026, 20));
    g.fillStyle = "#b8384a";
    g.fill();
    path(ellipse(0, mE - 0.016, 0.075, 0.03, 20));
    g.fillStyle = "#c84a5a";
    g.fill();
    soft(0, mE - 0.02, 0.05, "#ffffff", 0.18);
    void dark;
    void p;
    return;
  }

  for (const s of [1, -1]) {
    const ea = s * FACE.eyeAz;
    const ee = FACE.eyeEl;
    // Socket shading.
    soft(ea, ee + 0.01, 0.2, "#2a1810", 0.18);
    // Almond eye: corners pointed, upper lid arched.
    const ew = 0.135;
    const eh = 0.06;
    const almond: [number, number][] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      almond.push([ea - s * ew + s * 2 * ew * t, ee + Math.sin(t * Math.PI) * eh * (1 + 0.15 * (1 - t))]);
    }
    for (let i = 16; i >= 0; i--) {
      const t = i / 16;
      almond.push([ea - s * ew + s * 2 * ew * t, ee - Math.sin(t * Math.PI) * eh * 0.72]);
    }
    path(almond);
    g.fillStyle = "#efe7de";
    g.fill();
    // Iris, pupil, light.
    g.save();
    path(almond);
    g.clip();
    path(ellipse(ea + s * 0.008, ee + 0.002, 0.058, 0.062));
    g.fillStyle = look.skin >= 6 ? "#4a2d1a" : "#3a2112";
    g.fill();
    path(ellipse(ea + s * 0.008, ee + 0.002, 0.027, 0.029));
    g.fillStyle = "#0a0605";
    g.fill();
    path(ellipse(ea + s * 0.008 - 0.02, ee + 0.026, 0.011, 0.012, 10));
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.fill();
    // Upper lid shadow on the eyeball.
    const [, ly] = at(ea, ee + eh);
    const [, ly2] = at(ea, ee + eh * 0.2);
    const lid = g.createLinearGradient(0, ly, 0, ly2);
    lid.addColorStop(0, "rgba(40,20,10,0.55)");
    lid.addColorStop(1, "rgba(40,20,10,0)");
    g.fillStyle = lid;
    g.fill();
    g.restore();
    // Lash line (upper), thicker on women with a small flick at the outer corner.
    const lash: [number, number][] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      lash.push([ea - s * ew + s * 2 * ew * t, ee + Math.sin(t * Math.PI) * eh * (1 + 0.15 * (1 - t))]);
    }
    if (f) lash.push([ea + s * ew * 1.28, ee + eh * 0.55]);
    path(lash);
    g.strokeStyle = "#120a07";
    g.lineWidth = Math.max(1, w * (f ? 0.007 : 0.0045));
    g.lineCap = "round";
    g.lineJoin = "round";
    g.stroke();
    // Lower lid, faint.
    path(almond.slice(17));
    g.strokeStyle = rgb(...hexRgb(deep), 0.5);
    g.lineWidth = Math.max(1, w * 0.0025);
    g.stroke();
    // Crease above the eye.
    const crease: [number, number][] = [];
    for (let i = 2; i <= 14; i++) {
      const t = i / 16;
      crease.push([ea - s * ew + s * 2 * ew * t, ee + eh * 1.55 + Math.sin(t * Math.PI) * eh * 0.5]);
    }
    path(crease);
    g.strokeStyle = rgb(...hexRgb(deep), 0.45);
    g.lineWidth = Math.max(1, w * 0.003);
    g.stroke();
    // Brow.
    const brow: [number, number][] = [];
    const bw = f ? 0.12 : 0.13;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const arch = f ? Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.03 : Math.sin(t * Math.PI) * 0.015;
      brow.push([ea - s * bw * 0.85 + s * 2 * bw * t, FACE.browEl + arch - t * 0.012]);
    }
    for (let i = 12; i >= 0; i--) {
      const t = i / 12;
      const arch = f ? Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.03 : Math.sin(t * Math.PI) * 0.015;
      const thick = (f ? 0.018 : 0.03) * (1 - t * 0.55);
      brow.push([ea - s * bw * 0.85 + s * 2 * bw * t, FACE.browEl + arch - t * 0.012 - thick]);
    }
    path(brow);
    g.fillStyle = shade(look.hair === "bald" && !f ? "#1a1210" : hairC === "#e9e4dc" ? "#9a948c" : hairC, 0.9);
    g.fill();
  }

  // Nose: shaded sides, a highlight down the bridge, broad nostrils.
  soft(0.11, FACE.noseEl + 0.05, 0.1, "#2a1810", 0.22);
  soft(-0.11, FACE.noseEl + 0.05, 0.1, "#2a1810", 0.22);
  soft(0, FACE.noseEl + 0.08, 0.06, "#ffffff", 0.12);
  for (const s of [1, -1]) {
    path(ellipse(s * 0.075, FACE.noseEl - 0.07, 0.03, 0.016, 12));
    g.fillStyle = rgb(...hexRgb(deep), 0.85);
    g.fill();
    soft(s * 0.12, FACE.noseEl - 0.05, 0.05, "#2a1810", 0.18);
  }

  // Lips: full, a cupid's bow, the lower lip catching light.
  const lip = f ? mix(skin, "#7a2c35", 0.5) : mix(skin, "#5a2a26", 0.35);
  const mE = FACE.mouthEl;
  const mw = 0.27;
  const upper: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const a = -mw + 2 * mw * t;
    const bow = Math.abs(t - 0.5) < 0.1 ? -0.006 : 0;
    upper.push([a, mE + 0.004 + Math.sin(t * Math.PI) * 0.046 + bow]);
  }
  for (let i = 20; i >= 0; i--) {
    const t = i / 20;
    upper.push([-mw + 2 * mw * t, mE + Math.sin(t * Math.PI) * 0.006]);
  }
  path(upper);
  g.fillStyle = lip;
  g.fill();
  const lower: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    lower.push([-mw * 0.92 + 2 * mw * 0.92 * t, mE - Math.sin(t * Math.PI) * 0.006]);
  }
  for (let i = 20; i >= 0; i--) {
    const t = i / 20;
    lower.push([-mw * 0.92 + 2 * mw * 0.92 * t, mE - 0.004 - Math.sin(t * Math.PI) * 0.06]);
  }
  path(lower);
  g.fill();
  soft(0, mE - 0.035, 0.12, "#ffffff", 0.14);
  // Mouth line.
  const line: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    line.push([-mw * 0.98 + 2 * mw * 0.98 * t, mE + Math.sin(t * Math.PI) * 0.004 - (Math.abs(t - 0.5) > 0.45 ? 0.004 : 0)]);
  }
  path(line);
  g.strokeStyle = rgb(...hexRgb(deep), 0.9);
  g.lineWidth = Math.max(1, w * 0.0035);
  g.stroke();

  // Beard shadow on some men (low cuts look sharper with it).
  if (!f && (look.skin + look.hairColor + look.hair.length) % 3 === 0) {
    g.save();
    path([
      [-0.85, -0.25],
      [-0.6, -0.55],
      [-0.3, -0.8],
      [0.3, -0.8],
      [0.6, -0.55],
      [0.85, -0.25],
      [0.7, -0.6],
      [0.3, -0.95],
      [-0.3, -0.95],
      [-0.7, -0.6],
    ]);
    g.fillStyle = rgb(...hexRgb("#120c0a"), 0.28);
    g.fill();
    g.restore();
  }
  void dark;
  void p;
}

// ── Torso, arms, legs, skirt ──────────────────────────────────────────────────

function torsoSize(p: Proportions): [number, number, number, number] {
  const r = p.torso;
  const y0 = r[0][0];
  const y1 = r[r.length - 1][0];
  // Average circumference, roughly.
  let c = 0;
  for (const [, rx, f, b] of r) c += Math.PI * (rx + (f + b) / 2);
  return [c / r.length, y1 - y0, y0, y1];
}

function paintTorso(g: Ctx, size: number, look: Look, p: Proportions, o: Outfit, skin: string, rnd: () => number, detail: number): void {
  const [circ, len, y0] = torsoSize(p);
  const R = new Region(g, size, UV.torso, circ, len);
  const Y = (y: number) => y - y0; // body height → region metres
  const front = circ / 2; // x of the front centre line
  const top = o.top;
  const bot = o.bottom;
  const dress = bot.kind === "dress";
  const [skTop] = dress || bot.kind === "skirt" ? skirtSpan(p, o) : [0];

  R.draw((g) => {
    // Skin first.
    g.fillStyle = skin;
    g.fillRect(0, 0, circ, len);

    // Bottom garment up to the waist (or to where a dress's skirt begins).
    const waist = bot.kind === "jeans" ? p.waistY + 0.03 : p.waistY + 0.005;
    if (bot.kind !== "dress") {
      const upTo = bot.kind === "skirt" ? skTop + 0.012 : waist;
      fillPattern(g, bot.pattern, 0, 0, circ, Y(upTo), rnd, detail);
      if (bot.belt) {
        g.fillStyle = "#3b2a1c";
        g.fillRect(0, Y(waist) - 0.03, circ, 0.026);
        g.fillStyle = bot.belt;
        g.fillRect(front - 0.022, Y(waist) - 0.034, 0.044, 0.032);
        g.fillStyle = "#3b2a1c";
        g.fillRect(front - 0.012, Y(waist) - 0.026, 0.024, 0.016);
      } else if (bot.kind === "jeans" || bot.kind === "trousers" || bot.kind === "cargo") {
        // Waistband and fly seam.
        g.fillStyle = shade(bot.pattern.kind === "plain" || bot.pattern.kind === "denim" ? bot.pattern.color : "#3a3a3a", 0.85);
        g.fillRect(0, Y(waist) - 0.03, circ, 0.03);
        g.fillStyle = "rgba(0,0,0,0.25)";
        g.fillRect(front - 0.002, Y(p.hipY - 0.05), 0.004, Y(waist) - Y(p.hipY - 0.05) - 0.03);
      }
    }

    // The top.
    const hemY = top.hem === "hip" ? (bot.kind === "dress" ? 0.8 : p.hipY + 0.04) : bot.kind === "skirt" ? skTop + 0.01 : waist - 0.012;
    const fromY = dress ? p.torso[0][0] - 0.05 : hemY;
    const neckY = p.torso[p.torso.length - 1][0];
    const coverTop = top.sleeve === "strap" ? p.chestY + 0.07 : neckY + 0.02;
    fillPattern(g, top.pattern, 0, Y(fromY), circ, Y(coverTop) - Y(fromY), rnd, detail);
    if (dress && bot.pattern.kind !== top.pattern.kind) fillPattern(g, bot.pattern, 0, Y(fromY), circ, Y(skTop) - Y(fromY), rnd, detail);

    // Sleeveless: bare shoulders around the arm holes (sides of the upper torso).
    if (top.sleeve === "none" || top.sleeve === "strap") {
      g.fillStyle = skin;
      for (const sx of [circ * 0.25, circ * 0.75]) {
        g.beginPath();
        g.ellipse(sx, Y(p.shoulderY + 0.02), circ * 0.07, 0.085, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (top.sleeve === "strap") {
      // Straps over the shoulders, front and back.
      g.fillStyle = shade((top.pattern as { color?: string }).color ?? "#999999", 0.95);
      for (const sx of [circ * 0.16, circ * 0.34, circ * 0.66, circ * 0.84]) g.fillRect(sx - 0.006, Y(p.chestY + 0.06), 0.012, Y(neckY + 0.05) - Y(p.chestY + 0.06));
    }

    // Neckline (front centre): skin cut-out.
    g.fillStyle = skin;
    const nTop = Y(neckY + 0.03);
    if (top.neck === "v") {
      g.beginPath();
      g.moveTo(front - 0.06, nTop);
      g.lineTo(front, Y(p.chestY + 0.03));
      g.lineTo(front + 0.06, nTop);
      g.fill();
      if (top.pattern.kind === "jersey" || top.trim) {
        g.strokeStyle = top.pattern.kind === "jersey" ? top.pattern.trim : top.trim!;
        g.lineWidth = 0.012;
        g.beginPath();
        g.moveTo(front - 0.064, nTop);
        g.lineTo(front, Y(p.chestY + 0.022));
        g.lineTo(front + 0.064, nTop);
        g.stroke();
      }
    } else if (top.neck === "scoop") {
      g.beginPath();
      g.ellipse(front, nTop, 0.085, Y(neckY + 0.03) - Y(p.chestY + 0.06), 0, 0, Math.PI * 2);
      g.fill();
    } else if (top.neck === "crew") {
      g.beginPath();
      g.ellipse(front, nTop, 0.055, 0.035, 0, 0, Math.PI * 2);
      g.fill();
      if (top.trim) {
        g.strokeStyle = top.trim;
        g.lineWidth = 0.01;
        g.beginPath();
        g.ellipse(front, nTop, 0.06, 0.04, 0, Math.PI, Math.PI * 2);
        g.stroke();
      }
    } else if (top.neck === "collar") {
      g.beginPath();
      g.moveTo(front - 0.04, nTop);
      g.lineTo(front, Y(neckY - 0.06));
      g.lineTo(front + 0.04, nTop);
      g.fill();
      // Collar points.
      g.fillStyle = shade((top.pattern as { color?: string }).color ?? "#cccccc", 0.92);
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(front + s * 0.004, Y(neckY - 0.055));
        g.lineTo(front + s * 0.06, Y(neckY - 0.02));
        g.lineTo(front + s * 0.045, nTop);
        g.lineTo(front + s * 0.02, nTop);
        g.fill();
      }
      // Buttons.
      g.fillStyle = "rgba(255,255,255,0.75)";
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.arc(front, Y(neckY - 0.08 - k * 0.07), 0.005, 0, Math.PI * 2);
        g.fill();
      }
    }

    // The doll's pinafore: a bib to the chest, a band at the waist, straps over the shoulders.
    if (o.pinafore) {
      const c = o.pinafore;
      g.fillStyle = c;
      g.fillRect(front - 0.1, Y(fromY), 0.2, Y(p.chestY + 0.035) - Y(fromY));
      g.fillRect(0, Y(fromY), circ, Y(skTop + 0.08) - Y(fromY));
      for (const x of [front - 0.09, front + 0.07, 0.025, circ - 0.045]) g.fillRect(x, Y(p.chestY + 0.02), 0.02, Y(neckY + 0.03) - Y(p.chestY + 0.02));
      // Two buttons where the straps meet the bib.
      g.fillStyle = "#f2f2f2";
      for (const x of [front - 0.08, front + 0.08]) {
        g.beginPath();
        g.arc(x, Y(p.chestY + 0.02), 0.009, 0, Math.PI * 2);
        g.fill();
      }
      // A seam under the bib's top edge.
      g.fillStyle = shade(c, 0.8);
      g.fillRect(front - 0.1, Y(p.chestY + 0.03), 0.2, 0.004);
    }

    // Ankara yoke round the neckline (IMG_7770).
    if (top.yoke) {
      g.save();
      g.beginPath();
      g.ellipse(front, nTop, 0.13, Y(neckY + 0.03) - Y(p.chestY - 0.02), 0, 0, Math.PI * 2);
      g.ellipse(front, nTop, 0.085, Y(neckY + 0.03) - Y(p.chestY + 0.06), 0, 0, Math.PI * 2, true);
      g.clip("evenodd");
      fillPattern(g, top.yoke, front - 0.14, Y(p.chestY - 0.05), 0.28, 0.25, rnd, 0);
      g.restore();
    }

    // Embroidery on sheen tops (agbada, owambe gold): a panel down the chest.
    if (top.pattern.kind === "sheen") {
      g.strokeStyle = top.pattern.shine;
      g.lineWidth = 0.004;
      for (let k = 0; k < 6; k++) {
        const yy = Y(neckY - 0.04 - k * 0.035);
        g.beginPath();
        g.arc(front, yy, 0.02 + (k % 2) * 0.008, 0, Math.PI * 2);
        g.stroke();
      }
      g.strokeRect(front - 0.05, Y(p.chestY - 0.12), 0.1, Y(neckY - 0.02) - Y(p.chestY - 0.12));
    }

    // Jersey side panels.
    if (top.pattern.kind === "jersey") {
      g.fillStyle = top.pattern.trim;
      for (const sx of [circ * 0.25, circ * 0.75]) g.fillRect(sx - 0.012, Y(hemY), 0.024, Y(p.shoulderY - 0.1) - Y(hemY));
    }

    // Sweatshirt / tunic: a hem band, front pocket for the sweater.
    if (top.hem === "hip" && top.pattern.kind === "knit") {
      g.fillStyle = shade(top.pattern.color, 0.92);
      g.fillRect(0, Y(hemY), circ, 0.04);
      g.strokeStyle = shade(top.pattern.color, 0.8);
      g.lineWidth = 0.003;
      g.strokeRect(front - 0.09, Y(hemY + 0.05), 0.18, 0.11);
    }

    // Shading: a gentle top light, darker low at the sides.
    const sh = g.createLinearGradient(0, 0, 0, len);
    sh.addColorStop(0, "rgba(0,0,0,0.12)");
    sh.addColorStop(0.5, "rgba(0,0,0,0)");
    sh.addColorStop(1, "rgba(255,255,255,0.04)");
    g.fillStyle = sh;
    g.fillRect(0, 0, circ, len);
  });
  void look;
}

function paintArms(g: Ctx, size: number, p: Proportions, o: Outfit, skin: string, rnd: () => number, detail: number): void {
  const rest = restPositions(p);
  const len = rest.upperArmL.y + 0.025 - (rest.handL.y - 0.01);
  const circ = Math.PI * 2 * p.arm[1];
  const upper = p.upperArm / len; // fraction of the arm that is upper arm
  for (const rect of [UV.armL, UV.armR]) {
    const R = new Region(g, size, rect, circ, len);
    R.draw((g) => {
      g.fillStyle = skin;
      g.fillRect(0, 0, circ, len);
      const sl = o.top.sleeve;
      // y measured up from the wrist.
      const from = sl === "long" ? 0.012 : sl === "short" ? len - upper * len * 0.55 : len;
      if (from < len) {
        fillPattern(g, o.top.pattern, 0, from, circ, len - from, rnd, detail);
        // Cuff or hem.
        g.fillStyle = o.top.trim ?? shade((o.top.pattern as { color?: string }).color ?? "#888888", 0.85);
        if (o.top.pattern.kind === "jersey") g.fillStyle = o.top.pattern.trim;
        g.fillRect(0, from, circ, sl === "long" ? 0.03 : 0.015);
        if (o.top.yoke && sl === "short") {
          // The Ankara cuffs of IMG_7770.
          g.save();
          g.beginPath();
          g.rect(0, from, circ, 0.035);
          g.clip();
          fillPattern(g, o.top.yoke, 0, from, circ, 0.035, rnd, 0);
          g.restore();
        }
      }
      const sh = g.createLinearGradient(0, 0, circ, 0);
      sh.addColorStop(0, "rgba(0,0,0,0.12)");
      sh.addColorStop(0.5, "rgba(0,0,0,0)");
      sh.addColorStop(1, "rgba(0,0,0,0.12)");
      g.fillStyle = sh;
      g.fillRect(0, 0, circ, len);
    });
  }
}

function paintLegs(g: Ctx, size: number, p: Proportions, o: Outfit, skin: string, rnd: () => number, detail: number): void {
  const top = p.hipY + 0.07;
  const bottom = p.ankleY - 0.015;
  const len = top - bottom;
  const circ = Math.PI * 2 * p.leg[0];
  const b = o.bottom;
  for (const [rect, side] of [[UV.legL, 1], [UV.legR, -1]] as const) {
    const R = new Region(g, size, rect, circ, len);
    const Y = (y: number) => y - bottom;
    R.draw((g) => {
      g.fillStyle = skin;
      g.fillRect(0, 0, circ, len);
      if (b.kind === "skirt" || b.kind === "dress") {
        // Under the skirt the thighs wear the skirt's cloth: if a stride pokes
        // through, it reads as fabric, not skin.
        const [, hemY] = skirtSpan(p, o);
        fillPattern(g, b.pattern, 0, Y(hemY + 0.03), circ, len - Y(hemY + 0.03), rnd, 0);
        // Bare legs below; a sheen down the shin.
        const gr = g.createLinearGradient(circ * 0.4, 0, circ * 0.6, 0);
        gr.addColorStop(0, "rgba(255,255,255,0)");
        gr.addColorStop(0.5, "rgba(255,255,255,0.07)");
        gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr;
        g.fillRect(0, 0, circ, len);
        // Knee socks, with a ribbed top.
        if (o.socks) {
          const top = Y(p.hipY - p.thigh - 0.05);
          g.fillStyle = o.socks;
          g.fillRect(0, 0, circ, top);
          g.fillStyle = shade(o.socks, 0.9);
          for (let x = 0; x < circ; x += 0.008) g.fillRect(x, top - 0.035, 0.0025, 0.035);
        }
        return;
      }
      const hem = b.length === "thigh" ? p.hipY - p.thigh * 0.45 : b.length === "knee" ? p.hipY - p.thigh - 0.04 : b.length === "calf" ? p.hipY - p.thigh - 0.18 : bottom;
      fillPattern(g, b.pattern, 0, Y(hem), circ, len - Y(hem), rnd, detail);
      const base = b.pattern.kind === "plain" || b.pattern.kind === "denim" ? b.pattern.color : "#555555";
      // Side seam (outer side: +X on the left leg is u = 0.25).
      g.fillStyle = shade(base, 0.8, 0.8);
      const outer = side === 1 ? circ * 0.25 : circ * 0.75;
      g.fillRect(outer - 0.0015, Y(hem), 0.003, len - Y(hem));
      if (b.kind === "jeans") {
        // Orange-gold stitching beside the seam and on the hem.
        g.fillStyle = "rgba(201,140,60,0.8)";
        for (let yy = Y(hem); yy < len; yy += 0.008) g.fillRect(outer + 0.004, yy, 0.0015, 0.004);
        g.fillRect(0, Y(hem) + 0.012, circ, 0.0015);
        // Front pocket curve near the top.
        g.strokeStyle = "rgba(201,140,60,0.8)";
        g.lineWidth = 0.002;
        g.beginPath();
        g.arc(circ * 0.5 + side * 0.04, len - 0.01, 0.05, Math.PI, Math.PI * 1.5);
        g.stroke();
      }
      if (b.kind === "cargo") {
        // Cargo pocket on the outer thigh.
        g.fillStyle = shade(b.pattern.kind === "camo" ? b.pattern.colors[0] : base, 0.85);
        g.fillRect(outer - 0.045, Y(p.hipY - p.thigh * 0.62), 0.09, 0.12);
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(outer - 0.045, Y(p.hipY - p.thigh * 0.62) + 0.1, 0.09, 0.02);
      }
      if (b.length === "thigh") {
        // Rolled hem on shorts.
        g.fillStyle = shade(base, 0.9);
        g.fillRect(0, Y(hem), circ, 0.018);
      }
      if (b.length === "ankle") {
        g.fillStyle = shade(base, 0.85);
        g.fillRect(0, Y(hem), circ, 0.015);
      }
      // Knee creases.
      g.fillStyle = "rgba(0,0,0,0.08)";
      g.fillRect(circ * 0.42, Y(p.hipY - p.thigh) - 0.01, circ * 0.16, 0.008);
    });
  }
}

function paintSkirt(g: Ctx, size: number, p: Proportions, o: Outfit, rnd: () => number, detail: number): void {
  const [topY, hemY] = skirtSpan(p, o);
  const len = topY - hemY;
  const circ = Math.PI * 2 * (p.hipX + p.leg[1] + 0.06);
  const R = new Region(g, size, UV.skirt, circ, len);
  R.draw((g) => {
    fillPattern(g, o.bottom.pattern, 0, 0, circ, len, rnd, detail);
    if (o.bottom.band) {
      g.save();
      g.beginPath();
      g.rect(0, 0, circ, 0.1);
      g.clip();
      fillPattern(g, o.bottom.band, 0, 0, circ, 0.1, rnd, 0);
      g.restore();
      g.fillStyle = "rgba(0,0,0,0.2)";
      g.fillRect(0, 0.1, circ, 0.003);
    }
    if (o.bottom.kind === "skirt" && o.bottom.flare === 0) {
      // Pencil skirt: a back slit and a waistband.
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(-0.002, 0, 0.004, 0.09);
      g.fillStyle = shade((o.bottom.pattern as { color?: string }).color ?? "#555555", 0.85);
      g.fillRect(0, len - 0.025, circ, 0.025);
    }
    // Folds: soft vertical shading.
    for (let k = 0; k < 10; k++) {
      const x = (k / 10) * circ + rnd() * 0.02;
      const gr = g.createLinearGradient(x - 0.03, 0, x + 0.03, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(0.5, `rgba(0,0,0,${0.05 + (o.bottom.flare ?? 0) * 0.15})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x - 0.03, 0, 0.06, len);
    }
  });
}

function paintHair(g: Ctx, size: number, look: Look, hairC: string, rnd: () => number): void {
  const [u0, v0, u1, v1] = UV.hair;
  const x0 = u0 * size;
  const y0 = (1 - v1) * size;
  const w = (u1 - u0) * size;
  const h = (v1 - v0) * size;
  g.save();
  g.beginPath();
  g.rect(x0, y0, w, h);
  g.clip();
  g.fillStyle = hairC;
  g.fillRect(x0, y0, w, h);
  const hl = shade(hairC, hairC === "#141110" || hairC === "#2b1d16" ? 1.08 : 1.18, 0.5);
  const lo = shade(hairC, 0.6, 0.7);
  const id = look.hair;
  const n = Math.round(w * h * (id === "afro" ? 0.08 : 0.05));
  if (id === "afro" || id === "locs" || id === "fade") {
    // Coils: tiny rings, light on top, dark under.
    for (let i = 0; i < n; i++) {
      const x = x0 + rnd() * w;
      const y = y0 + rnd() * h;
      const r = Math.max(0.8, w * (0.008 + rnd() * 0.01));
      g.strokeStyle = rnd() < 0.5 ? hl : lo;
      g.lineWidth = Math.max(0.6, r * 0.45);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (id === "braids") {
    for (let x = x0; x < x0 + w; x += w * 0.06) {
      for (let y = y0; y < y0 + h; y += w * 0.05) {
        g.fillStyle = lo;
        g.beginPath();
        g.ellipse(x, y, w * 0.022, w * 0.03, 0.6, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = hl;
        g.fillRect(x - w * 0.006, y - w * 0.02, w * 0.004, w * 0.012);
      }
    }
  } else {
    // Sleek or short: fine strands front to back, a band of shine.
    for (let i = 0; i < n; i++) {
      const x = x0 + rnd() * w;
      const y = y0 + rnd() * h;
      g.fillStyle = rnd() < 0.5 ? hl : lo;
      g.fillRect(x, y, Math.max(0.6, w * 0.004), Math.max(1, h * (id === "lowcut" ? 0.01 : 0.06)));
    }
    if (id === "ponytail" || id === "bun") {
      const gr = g.createLinearGradient(0, y0 + h * 0.3, 0, y0 + h * 0.5);
      gr.addColorStop(0, "rgba(255,255,255,0)");
      gr.addColorStop(0.5, "rgba(255,255,255,0.18)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(x0, y0, w, h);
    }
  }
  g.restore();
}
