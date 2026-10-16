// Procedural textures, painted on canvases at startup: no image downloads.
// Each is drawn once and cached by name and size. Sizes follow the graphics
// tier (256 / 512 / 1024).
//
// The look comes from the Inside Life references (UPGRADE.md): interlocking
// pavers, rusty corrugated zinc, sun-faded plaster, painted wood.

import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

export type Painter = (g: CanvasRenderingContext2D, s: number, rnd: () => number) => void;

const cache = new Map<string, CanvasTexture>();
let aniso = 4;

export function setTextureAnisotropy(n: number): void {
  aniso = Math.max(1, Math.min(8, n));
}

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

export function canvasTexture(name: string, size: number, paint: Painter, repeat = true): CanvasTexture {
  const key = `${name}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  paint(g, size, prng(name.length * 7919 + size));
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  cache.set(key, t);
  return t;
}

/** A clone sharing the image, with its own repeat. */
export function tiled(t: Texture, rx: number, ry: number): Texture {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

function noise(g: CanvasRenderingContext2D, s: number, rnd: () => number, n: number, light: string, dark: string, size = 1.5): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rnd() < 0.5 ? light : dark;
    const r = size * (0.5 + rnd());
    g.fillRect(rnd() * s, rnd() * s, r, r);
  }
}

// ── The palette of surfaces ───────────────────────────────────────────────────

/** Interlocking pavers (the Inside Life streets): grey-beige "I" blocks, worn. */
export const paving: Painter = (g, s, rnd) => {
  g.fillStyle = "#8a8174";
  g.fillRect(0, 0, s, s);
  const n = 8;
  const w = s / n;
  const h = w / 2;
  for (let row = 0; row < n * 2; row++) {
    for (let col = -1; col <= n; col++) {
      const x = col * w + (row % 2 ? w / 2 : 0);
      const y = row * h;
      const tone = 0.85 + rnd() * 0.25;
      const base = [168, 158, 142].map((c) => Math.round(c * tone));
      g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      g.beginPath();
      // The "I" / dog-bone shape: notched in the middle of the long sides.
      const m = w * 0.12;
      g.moveTo(x + 2, y + 2);
      g.lineTo(x + w * 0.4, y + 2);
      g.lineTo(x + w * 0.5, y + 2 + m);
      g.lineTo(x + w * 0.6, y + 2);
      g.lineTo(x + w - 2, y + 2);
      g.lineTo(x + w - 2, y + h - 2);
      g.lineTo(x + w * 0.6, y + h - 2);
      g.lineTo(x + w * 0.5, y + h - 2 - m);
      g.lineTo(x + w * 0.4, y + h - 2);
      g.lineTo(x + 2, y + h - 2);
      g.closePath();
      g.fill();
      // A little top light on each block.
      g.fillStyle = "rgba(255,255,255,0.08)";
      g.fillRect(x + 3, y + 3, w - 6, h * 0.25);
    }
  }
  noise(g, s, rnd, s * 6, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.08)");
  // Dirt and oil stains.
  for (let i = 0; i < 6; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const r = s * (0.05 + rnd() * 0.12);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(60,45,30,0.25)");
    gr.addColorStop(1, "rgba(60,45,30,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
};

/** Rusty corrugated zinc roofing. Ridges run along V. */
export const zinc: Painter = (g, s, rnd) => {
  for (let x = 0; x < s; x++) {
    const k = 0.5 + 0.5 * Math.sin((x / s) * Math.PI * 2 * 12);
    const v = Math.round(110 + k * 70);
    g.fillStyle = `rgb(${v},${Math.round(v * 0.92)},${Math.round(v * 0.86)})`;
    g.fillRect(x, 0, 1, s);
  }
  // Rust: streaks down from the top, blotches.
  for (let i = 0; i < 40; i++) {
    const x = rnd() * s;
    const len = s * (0.2 + rnd() * 0.8);
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, `rgba(${140 + rnd() * 40},${60 + rnd() * 20},20,0.55)`);
    gr.addColorStop(1, "rgba(140,60,20,0)");
    g.fillStyle = gr;
    g.fillRect(x, 0, s * (0.01 + rnd() * 0.04), len);
  }
  for (let i = 0; i < 30; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const r = s * (0.02 + rnd() * 0.08);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${120 + rnd() * 50},${50 + rnd() * 20},18,0.6)`);
    gr.addColorStop(1, "rgba(120,50,18,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Sheet overlaps.
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.fillRect(0, s * 0.5, s, 2);
};

/** Sun-faded plaster with grime collecting at the bottom. Tint with the material colour. */
export const plaster: Painter = (g, s, rnd) => {
  g.fillStyle = "#e8e2d6";
  g.fillRect(0, 0, s, s);
  noise(g, s, rnd, s * 10, "rgba(255,255,255,0.12)", "rgba(80,60,40,0.08)", 2);
  for (let i = 0; i < 10; i++) {
    const x = rnd() * s;
    const gr = g.createLinearGradient(0, s * 0.4, 0, s);
    gr.addColorStop(0, "rgba(90,70,50,0)");
    gr.addColorStop(1, "rgba(90,70,50,0.18)");
    g.fillStyle = gr;
    g.fillRect(x, s * 0.4, s * (0.03 + rnd() * 0.1), s * 0.6);
  }
  // Cracks.
  g.strokeStyle = "rgba(70,55,40,0.35)";
  g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let x = rnd() * s;
    let y = rnd() * s;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rnd() - 0.5) * s * 0.08;
      y += rnd() * s * 0.06;
      g.lineTo(x, y);
    }
    g.stroke();
  }
};

/** Painted planks (kiosks, doors, stalls). */
export const wood: Painter = (g, s, rnd) => {
  const planks = 6;
  for (let i = 0; i < planks; i++) {
    const tone = 0.8 + rnd() * 0.3;
    g.fillStyle = `rgb(${Math.round(150 * tone)},${Math.round(110 * tone)},${Math.round(70 * tone)})`;
    g.fillRect(0, (i * s) / planks, s, s / planks);
    g.strokeStyle = "rgba(40,25,10,0.25)";
    for (let k = 0; k < 8; k++) {
      g.beginPath();
      const y = (i * s) / planks + rnd() * (s / planks);
      g.moveTo(0, y);
      g.bezierCurveTo(s * 0.3, y + (rnd() - 0.5) * 6, s * 0.6, y + (rnd() - 0.5) * 6, s, y);
      g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, ((i + 1) * s) / planks - 2, s, 2);
  }
};

/** Asphalt with faded patches. */
export const asphalt: Painter = (g, s, rnd) => {
  g.fillStyle = "#4a4845";
  g.fillRect(0, 0, s, s);
  noise(g, s, rnd, s * 18, "rgba(255,255,255,0.07)", "rgba(0,0,0,0.12)", 1.4);
  for (let i = 0; i < 8; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const r = s * (0.08 + rnd() * 0.15);
    g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.08)";
    g.beginPath();
    g.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
};

/** Grass / lawn. */
export const grass: Painter = (g, s, rnd) => {
  g.fillStyle = "#5b7a34";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < s * 14; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const v = rnd();
    g.strokeStyle = v < 0.33 ? "rgba(140,170,70,0.5)" : v < 0.66 ? "rgba(60,90,30,0.5)" : "rgba(170,160,80,0.35)";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 5);
    g.stroke();
  }
};

/** Sand. */
export const sand: Painter = (g, s, rnd) => {
  g.fillStyle = "#d8c08e";
  g.fillRect(0, 0, s, s);
  noise(g, s, rnd, s * 20, "rgba(255,255,255,0.1)", "rgba(120,90,50,0.1)", 1.2);
  g.strokeStyle = "rgba(150,120,70,0.15)";
  for (let y = 0; y < s; y += s / 24) {
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= s; x += s / 16) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 3);
    g.stroke();
  }
};

/** Bark for palms and baobabs: vertical ridges and rings. */
export const bark: Painter = (g, s, rnd) => {
  g.fillStyle = "#7d6a55";
  g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 2 + rnd() * 4) {
    g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.18)";
    g.fillRect(x, 0, 1 + rnd() * 2, s);
  }
  for (let y = 0; y < s; y += s / 10) {
    g.fillStyle = "rgba(40,30,20,0.25)";
    g.fillRect(0, y + rnd() * 4, s, 2);
  }
};

/** Leaves: a dense, dappled canopy colour (alpha-free; used on rounded blobs). */
export const foliage: Painter = (g, s, rnd) => {
  g.fillStyle = "#3f6b2a";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < s * 3; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const r = 2 + rnd() * 5;
    const v = rnd();
    g.fillStyle = v < 0.3 ? "rgba(120,170,60,0.55)" : v < 0.7 ? "rgba(40,80,25,0.5)" : "rgba(170,190,90,0.35)";
    g.beginPath();
    g.ellipse(x, y, r, r * 0.6, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
};

/** A palm frond (alpha). Rib along V, leaflets either side. */
export const frond: Painter = (g, s) => {
  g.clearRect(0, 0, s, s);
  g.strokeStyle = "#5b6e2a";
  g.lineWidth = s * 0.02;
  g.beginPath();
  g.moveTo(s / 2, s);
  g.lineTo(s / 2, 0);
  g.stroke();
  for (let y = s * 0.05; y < s * 0.98; y += s * 0.035) {
    const len = s * 0.48 * Math.sin((y / s) * Math.PI) + s * 0.05;
    for (const d of [-1, 1]) {
      g.strokeStyle = y % 2 ? "#4c7a2a" : "#5f8f33";
      g.lineWidth = s * 0.018;
      g.beginPath();
      g.moveTo(s / 2, y);
      g.quadraticCurveTo(s / 2 + d * len * 0.6, y - s * 0.02, s / 2 + d * len, y + s * 0.05);
      g.stroke();
    }
  }
};

/** A street mural: bold shapes, a face in profile, Lagos colours. No words. */
export const mural: Painter = (g, s, rnd) => {
  g.fillStyle = "#f0e2c4";
  g.fillRect(0, 0, s, s);
  const colors = ["#e85d04", "#008751", "#ffd700", "#0e5a8a", "#d7263d", "#7b2cbf", "#1b998b"];
  for (let i = 0; i < 18; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    g.globalAlpha = 0.85;
    g.beginPath();
    const x = rnd() * s;
    const y = rnd() * s;
    if (rnd() < 0.5) g.arc(x, y, s * (0.05 + rnd() * 0.15), 0, Math.PI * 2);
    else {
      g.moveTo(x, y);
      g.lineTo(x + s * 0.3 * (rnd() - 0.5), y + s * 0.4 * rnd());
      g.lineTo(x + s * 0.3 * rnd(), y - s * 0.2 * rnd());
    }
    g.fill();
  }
  g.globalAlpha = 1;
  // A big face in profile, gele on top.
  g.fillStyle = "#3b2214";
  g.beginPath();
  g.moveTo(s * 0.42, s * 0.85);
  g.bezierCurveTo(s * 0.3, s * 0.7, s * 0.32, s * 0.45, s * 0.45, s * 0.38);
  g.lineTo(s * 0.5, s * 0.46);
  g.lineTo(s * 0.47, s * 0.5);
  g.lineTo(s * 0.5, s * 0.56);
  g.lineTo(s * 0.47, s * 0.6);
  g.bezierCurveTo(s * 0.5, s * 0.7, s * 0.55, s * 0.8, s * 0.6, s * 0.85);
  g.fill();
  g.fillStyle = "#ffd700";
  g.beginPath();
  g.ellipse(s * 0.47, s * 0.33, s * 0.2, s * 0.1, -0.3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#e85d04";
  g.lineWidth = s * 0.012;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.ellipse(s * 0.47, s * 0.33, s * (0.04 + i * 0.035), s * (0.02 + i * 0.018), -0.3, 0, Math.PI * 2);
    g.stroke();
  }
};

/** Danfo bodywork: yellow with the two black stripes and windows (wraps a box). */
export const danfoSkin: Painter = (g, s) => {
  g.fillStyle = "#f5bd02";
  g.fillRect(0, 0, s, s);
  g.fillStyle = "#151515";
  g.fillRect(0, s * 0.62, s, s * 0.05);
  g.fillRect(0, s * 0.72, s, s * 0.035);
  // Windows band (top third).
  g.fillStyle = "#2a3540";
  for (let i = 0; i < 5; i++) g.fillRect(s * (0.06 + i * 0.185), s * 0.12, s * 0.16, s * 0.28);
  g.fillStyle = "rgba(255,255,255,0.15)";
  for (let i = 0; i < 5; i++) g.fillRect(s * (0.07 + i * 0.185), s * 0.13, s * 0.05, s * 0.26);
  // Dust low down.
  const gr = g.createLinearGradient(0, s * 0.7, 0, s);
  gr.addColorStop(0, "rgba(120,90,50,0)");
  gr.addColorStop(1, "rgba(120,90,50,0.45)");
  g.fillStyle = gr;
  g.fillRect(0, s * 0.7, s, s * 0.3);
};

/** A glow (soft round spot) for lamps, light shafts, sun. */
export const glow: Painter = (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.35, "rgba(255,255,255,0.35)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
};

/** A vertical light shaft: bright core fading to the sides and the bottom. */
export const shaft: Painter = (g, s) => {
  g.clearRect(0, 0, s, s);
  const h = g.createLinearGradient(0, 0, s, 0);
  h.addColorStop(0, "rgba(255,255,255,0)");
  h.addColorStop(0.5, "rgba(255,255,255,1)");
  h.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = h;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = "destination-in";
  const v = g.createLinearGradient(0, 0, 0, s);
  v.addColorStop(0, "rgba(0,0,0,1)");
  v.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = v;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = "source-over";
};

/** The Nigerian flag: green, white, green. */
export const flagNg: Painter = (g, s) => {
  g.fillStyle = "#008751";
  g.fillRect(0, 0, s, s);
  g.fillStyle = "#ffffff";
  g.fillRect(s / 3, 0, s / 3, s);
};

// ── Surfaces for the 24 maps ─────────────────────────────────────────────────

/** Red-brown brick, offset courses, mortar lines. Tint with the material colour. */
export const brick: Painter = (g, s, rnd) => {
  g.fillStyle = "#c9c2b6";
  g.fillRect(0, 0, s, s);
  const rows = 16;
  const h = s / rows;
  const w = h * 2.1;
  for (let r = 0; r < rows; r++) {
    for (let x = -w + (r % 2) * (w / 2); x < s + w; x += w) {
      const t = 0.75 + rnd() * 0.35;
      g.fillStyle = `rgb(${Math.round(176 * t)},${Math.round(92 * t)},${Math.round(70 * t)})`;
      g.fillRect(x + 1.5, r * h + 1.5, w - 3, h - 3);
    }
  }
  noise(g, s, rnd, s * 8, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.1)", 1.5);
};

/** A curtain wall of glass panes: sky reflections, mullions. */
export const glassFacade: Painter = (g, s, rnd) => {
  const gr = g.createLinearGradient(0, 0, s, s);
  gr.addColorStop(0, "#9fc3dd");
  gr.addColorStop(0.5, "#4f7894");
  gr.addColorStop(1, "#203e55");
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
  const n = 8;
  const c = s / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.14})`;
      g.fillRect(x * c + 2, y * c + 2, c - 4, c - 4);
      if (rnd() < 0.08) {
        g.fillStyle = "rgba(255,236,170,0.5)";
        g.fillRect(x * c + 3, y * c + 3, c - 6, c - 6);
      }
    }
  }
  g.fillStyle = "#1c2630";
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * c - 1.5, 0, 3, s);
    g.fillRect(0, i * c - 1.5, s, 3);
  }
};

/** Board-marked concrete. */
export const concrete: Painter = (g, s, rnd) => {
  g.fillStyle = "#9a9894";
  g.fillRect(0, 0, s, s);
  noise(g, s, rnd, s * 16, "rgba(255,255,255,0.08)", "rgba(0,0,0,0.12)", 1.6);
  g.fillStyle = "rgba(0,0,0,0.12)";
  for (let y = 0; y < s; y += s / 4) g.fillRect(0, y, s, 2);
  for (let i = 0; i < 6; i++) {
    const x = rnd() * s;
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, "rgba(60,50,40,0.18)");
    gr.addColorStop(1, "rgba(60,50,40,0)");
    g.fillStyle = gr;
    g.fillRect(x, 0, 4 + rnd() * 10, s);
  }
};

/** Cobblestones (Paris, London). */
export const cobble: Painter = (g, s, rnd) => {
  g.fillStyle = "#3e3b38";
  g.fillRect(0, 0, s, s);
  const n = 14;
  const c = s / n;
  for (let y = 0; y < n; y++) {
    for (let x = -1; x <= n; x++) {
      const ox = (y % 2) * c * 0.5;
      const t = 0.7 + rnd() * 0.4;
      g.fillStyle = `rgb(${Math.round(128 * t)},${Math.round(122 * t)},${Math.round(116 * t)})`;
      g.beginPath();
      g.ellipse(x * c + ox + c / 2, y * c + c / 2, c * 0.44, c * 0.4, rnd(), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.08)";
      g.beginPath();
      g.ellipse(x * c + ox + c * 0.42, y * c + c * 0.4, c * 0.2, c * 0.14, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
};

/** Red-brown laterite earth, footworn (villages, farms, favela lanes). */
export const dirt: Painter = (g, s, rnd) => {
  g.fillStyle = "#9a6a43";
  g.fillRect(0, 0, s, s);
  noise(g, s, rnd, s * 22, "rgba(255,220,180,0.1)", "rgba(60,30,10,0.14)", 1.8);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${90 + rnd() * 40},${70 + rnd() * 30},${50 + rnd() * 20},0.6)`;
    g.beginPath();
    g.ellipse(rnd() * s, rnd() * s, 1 + rnd() * 3, 1 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
};

/** Packed snow with blue shade and a little sparkle. */
export const snow: Painter = (g, s, rnd) => {
  g.fillStyle = "#eef3f8";
  g.fillRect(0, 0, s, s);
  noise(g, s, rnd, s * 10, "rgba(255,255,255,0.6)", "rgba(150,175,205,0.18)", 2.5);
  for (let i = 0; i < s; i++) {
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.fillRect(rnd() * s, rnd() * s, 1, 1);
  }
};

/** Dark volcanic rock / basalt. */
export const rock: Painter = (g, s, rnd) => {
  g.fillStyle = "#3a3634";
  g.fillRect(0, 0, s, s);
  noise(g, s, rnd, s * 20, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.2)", 2.2);
  g.strokeStyle = "rgba(0,0,0,0.35)";
  for (let i = 0; i < 18; i++) {
    let x = rnd() * s;
    let y = rnd() * s;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rnd() - 0.5) * s * 0.12;
      y += (rnd() - 0.5) * s * 0.12;
      g.lineTo(x, y);
    }
    g.stroke();
  }
};

/** Polished stone tiles (the mall). */
export const tile: Painter = (g, s, rnd) => {
  const n = 4;
  const c = s / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const t = 0.92 + rnd() * 0.08;
      g.fillStyle = `rgb(${Math.round(232 * t)},${Math.round(226 * t)},${Math.round(214 * t)})`;
      g.fillRect(x * c, y * c, c, c);
      // Veins.
      g.strokeStyle = "rgba(160,150,135,0.25)";
      g.beginPath();
      g.moveTo(x * c + rnd() * c, y * c);
      g.bezierCurveTo(x * c + rnd() * c, y * c + c * 0.3, x * c + rnd() * c, y * c + c * 0.7, x * c + rnd() * c, y * c + c);
      g.stroke();
    }
  }
  g.fillStyle = "rgba(90,85,80,0.5)";
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * c - 1, 0, 2, s);
    g.fillRect(0, i * c - 1, s, 2);
  }
};

/** Forest floor: dark earth, fallen leaves, twigs. */
export const leaves: Painter = (g, s, rnd) => {
  g.fillStyle = "#3b2e20";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < s * 3; i++) {
    const v = rnd();
    g.fillStyle = v < 0.3 ? "rgba(120,80,30,0.7)" : v < 0.6 ? "rgba(70,60,25,0.7)" : v < 0.8 ? "rgba(150,110,45,0.6)" : "rgba(50,70,30,0.6)";
    g.beginPath();
    g.ellipse(rnd() * s, rnd() * s, 2 + rnd() * 4, 1 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "rgba(30,20,10,0.6)";
  for (let i = 0; i < 25; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 30);
    g.stroke();
  }
};

/** Thatch: straw strands. */
export const thatch: Painter = (g, s, rnd) => {
  g.fillStyle = "#a88a4c";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < s * 6; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    g.strokeStyle = rnd() < 0.5 ? "rgba(210,180,110,0.6)" : "rgba(110,85,40,0.6)";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 3, y + 6 + rnd() * 10);
    g.stroke();
  }
};

/** Mud wall: smoothed by hand, a little cracked. */
export const mud: Painter = (g, s, rnd) => {
  g.fillStyle = "#a5714a";
  g.fillRect(0, 0, s, s);
  noise(g, s, rnd, s * 12, "rgba(255,210,170,0.12)", "rgba(80,40,20,0.12)", 3);
  g.strokeStyle = "rgba(70,40,20,0.35)";
  for (let i = 0; i < 8; i++) {
    let x = rnd() * s;
    let y = rnd() * s;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (rnd() - 0.5) * 20;
      y += rnd() * 14;
      g.lineTo(x, y);
    }
    g.stroke();
  }
};

/** Soft cumulus clouds on transparent, for the sky layer (tiles horizontally). */
export const clouds: Painter = (g, s, rnd) => {
  g.clearRect(0, 0, s, s);
  for (let i = 0; i < 46; i++) {
    const cx = rnd() * s;
    const cy = s * (0.2 + rnd() * 0.6);
    const r = s * (0.03 + rnd() * 0.08);
    for (const dx of [-s, 0, s]) {
      const gr = g.createRadialGradient(cx + dx, cy, 0, cx + dx, cy, r);
      gr.addColorStop(0, "rgba(255,255,255,0.55)");
      gr.addColorStop(0.6, "rgba(255,255,255,0.25)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(cx + dx, cy, r * 1.8, r, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
};
