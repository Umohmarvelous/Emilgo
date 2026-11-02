// Dev only (concept renders): every texture the concept gear, zombies, guns
// and loot use, painted in code. Nothing here is loaded from disk, so a
// texture's cost is known before it ships: on a phone these become small
// ETC/ASTC KTX2 files, baked once.

import { CanvasTexture, ClampToEdgeWrapping, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

// ── Noise ────────────────────────────────────────────────────────────────────

const P = new Uint8Array(512);
{
  let s = 1234567;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h: number, x: number, y: number) => ((h & 1 ? -x : x) + (h & 2 ? -y : y)) * 0.7071;

/** Tileable 2D Perlin noise, period `per` (cells), about −1…1. */
export function perlin(x: number, y: number, per = 256): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const X0 = ((xi % per) + per) % per;
  const Y0 = ((yi % per) + per) % per;
  const X1 = (X0 + 1) % per;
  const Y1 = (Y0 + 1) % per;
  const u = fade(xf);
  const v = fade(yf);
  const a = grad(P[P[X0] + Y0], xf, yf);
  const b = grad(P[P[X1] + Y0], xf - 1, yf);
  const c = grad(P[P[X0] + Y1], xf, yf - 1);
  const d = grad(P[P[X1] + Y1], xf - 1, yf - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.41;
}

/** Fractal noise, tileable over `per` base cells. */
export function fbm(x: number, y: number, oct = 5, per = 8, lac = 2, gain = 0.5): number {
  let a = 0;
  let amp = 1;
  let f = 1;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    a += perlin(x * f, y * f, per * f) * amp;
    n += amp;
    amp *= gain;
    f *= lac;
  }
  return a / n;
}

let seed = 99;
export function rnd(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
export function reseed(s: number): void {
  seed = Math.max(1, Math.floor(s) % 2147483647);
}

// ── Canvas helpers ───────────────────────────────────────────────────────────

export function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

export function tex(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: number | [number, number]; clamp?: boolean; aniso?: number } = {}): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? LinearSRGBColorSpace : SRGBColorSpace;
  t.wrapS = t.wrapT = opts.clamp ? ClampToEdgeWrapping : RepeatWrapping;
  const r = opts.repeat ?? 1;
  if (Array.isArray(r)) t.repeat.set(r[0], r[1]);
  else t.repeat.set(r, r);
  t.anisotropy = opts.aniso ?? 8;
  t.needsUpdate = true;
  return t;
}

/** Per-pixel painter: fn(u, v) → [r, g, b] (0…255) or [r, g, b, a]. */
export function paint(w: number, h: number, fn: (u: number, v: number, x: number, y: number) => number[]): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = fn(x / w, y / h, x, y);
      const i = (y * w + x) * 4;
      d[i] = px[0];
      d[i + 1] = px[1];
      d[i + 2] = px[2];
      d[i + 3] = px.length > 3 ? px[3] : 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** A height function (0…1, tileable) to a tangent-space normal map. */
export function normalFrom(w: number, h: number, height: (u: number, v: number) => number, strength = 2): HTMLCanvasElement {
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) H[y * w + x] = height(x / w, y / h);
  return paint(w, h, (_u, _v, x, y) => {
    const l = H[y * w + ((x - 1 + w) % w)];
    const r = H[y * w + ((x + 1) % w)];
    const t = H[((y - 1 + h) % h) * w + x];
    const b = H[((y + 1) % h) * w + x];
    let nx = (l - r) * strength;
    let ny = (b - t) * strength;
    const nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len;
    ny /= len;
    return [(nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, (nz / len) * 0.5 * 255 + 127.5];
  });
}

const hex = (s: string): [number, number, number] => {
  const n = parseInt(s.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix3 = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ── Fabric ───────────────────────────────────────────────────────────────────

/**
 * Original camouflage ("Ironwood"): four organic layers from fractal noise,
 * stretched slightly vertically like brush strokes. Not any army's pattern.
 */
export function camo(size: number, palette: string[], scale = 3, seedOff = 0): HTMLCanvasElement {
  const cols = palette.map(hex);
  return paint(size, size, (u, v) => {
    const n1 = fbm(u * scale + seedOff, v * scale * 0.7, 4, Math.round(scale));
    const n2 = fbm(u * scale * 1.7 + 40 + seedOff, v * scale * 1.3 + 10, 4, Math.round(scale * 1.7));
    const n3 = fbm(u * scale * 3.1 + 80, v * scale * 2.2 + 30 + seedOff, 3, Math.round(scale * 3.1));
    let c = cols[0];
    if (n1 > 0.05) c = cols[1];
    if (n2 > 0.18) c = cols[2];
    if (n3 > 0.32 && cols[3]) c = cols[3];
    // Fibre: a faint per-pixel grain so flat colours don't look printed.
    const g = (rnd() - 0.5) * 10;
    return [c[0] + g, c[1] + g, c[2] + g];
  });
}

/** A woven fabric's normal map: ripstop (a grid every few threads over a plain weave). */
export function weaveNormal(size: number, threads = 96, ripstop = 12, strength = 3): HTMLCanvasElement {
  return normalFrom(
    size,
    size,
    (u, v) => {
      const x = u * threads;
      const y = v * threads;
      const over = (Math.floor(x) + Math.floor(y)) % 2 === 0;
      const wx = Math.sin((x % 1) * Math.PI);
      const wy = Math.sin((y % 1) * Math.PI);
      let h = over ? wx * 0.6 + wy * 0.25 : wy * 0.6 + wx * 0.25;
      if (ripstop && (Math.floor(x) % ripstop === 0 || Math.floor(y) % ripstop === 0)) h += 0.35;
      return h * 0.5 + fbm(u * 8, v * 8, 3, 8) * 0.15;
    },
    strength,
  );
}

/** Kevlar / cordura basket weave with webbing (MOLLE rows every `rows`). */
export function molleNormal(size: number, rows = 8, strength = 4): HTMLCanvasElement {
  return normalFrom(
    size,
    size,
    (u, v) => {
      const yy = v * rows;
      const band = yy % 1;
      // Webbing rows: raised strips 1" tall with stitched edges.
      const strip = sstep(0.1, 0.16, band) * (1 - sstep(0.84, 0.9, band));
      const stitch = (Math.abs(band - 0.2) < 0.02 || Math.abs(band - 0.8) < 0.02) && Math.floor(u * 160) % 2 === 0 ? -0.25 : 0;
      // Bar tacks: the webbing is sewn down every 1.5".
      const tack = Math.abs(((u * 10) % 1) - 0.5) < 0.03 ? -0.4 : 0;
      const weave = Math.sin(u * size * 0.9) * Math.sin(v * size * 0.9) * 0.08;
      return strip * 0.8 + (strip > 0.5 ? stitch + tack : 0) + weave;
    },
    strength,
  );
}

/** Dirt, dust and wear: a 0…1 mask, dense at the bottom (boots, knees) and in crevices. */
export function grime(size: number, amount = 0.5, scale = 4): HTMLCanvasElement {
  return paint(size, size, (u, v) => {
    const n = fbm(u * scale + 7, v * scale + 3, 5, scale) * 0.5 + 0.5;
    const s = fbm(u * scale * 6, v * scale * 6, 3, scale * 6) * 0.5 + 0.5;
    const m = clamp01((n - (1 - amount)) * 2.2) * (0.6 + s * 0.4);
    const g = m * 255;
    return [g, g, g];
  });
}

// ── Hard surfaces ────────────────────────────────────────────────────────────

/** Roughness for worn paint/metal: scratches, scuffs, polished edges (0 smooth … 255 rough). */
export function scratches(size: number, base = 170, count = 900): HTMLCanvasElement {
  const [c, g] = canvas(size);
  const n = paint(size, size, (u, v) => {
    const k = fbm(u * 6, v * 6, 4, 6) * 0.5 + 0.5;
    const r = base + (k - 0.5) * 60;
    return [r, r, r];
  });
  g.drawImage(n, 0, 0);
  reseed(41);
  for (let i = 0; i < count; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const a = rnd() * Math.PI;
    const l = 4 + rnd() * size * 0.06;
    g.strokeStyle = `rgba(40,40,40,${0.25 + rnd() * 0.5})`;
    g.lineWidth = 0.5 + rnd() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rnd() * 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return c;
}

/** Painted metal/polymer albedo with chipped edges showing bare metal or primer underneath. */
export function chipped(size: number, paintHex: string, underHex: string, chips = 0.18, scale = 7): HTMLCanvasElement {
  const pc = hex(paintHex);
  const uc = hex(underHex);
  return paint(size, size, (u, v) => {
    const n = fbm(u * scale, v * scale, 5, scale) * 0.5 + 0.5;
    const t = sstep(1 - chips, 1 - chips + 0.04, n);
    const d = (fbm(u * 3 + 9, v * 3, 3, 3) * 0.5 + 0.5) * 18 - 9;
    const c = mix3(pc, uc, t);
    return [c[0] + d, c[1] + d, c[2] + d];
  });
}

export function carbon(size: number): HTMLCanvasElement {
  return paint(size, size, (u, v) => {
    const x = Math.floor(u * 64);
    const y = Math.floor(v * 64);
    const dir = (Math.floor(x / 2) + Math.floor(y / 2)) % 2;
    const s = dir ? Math.sin(u * 64 * Math.PI) : Math.sin(v * 64 * Math.PI);
    const l = 20 + s * s * 26;
    return [l, l, l + 2];
  });
}

// ── Flesh (zombies) ──────────────────────────────────────────────────────────

/** Rotting skin: grey-green base, bruising, purple veins, open lesions (albedo). */
export function rot(size: number, tone = 0, scale = 5): HTMLCanvasElement {
  const base = mix3(hex("#7d8a6a"), hex("#6e6a5a"), tone);
  const bruise = hex("#4b3443");
  const lesion = hex("#5a1612");
  const pale = hex("#a7a68e");
  return paint(size, size, (u, v) => {
    const n = fbm(u * scale, v * scale, 5, scale) * 0.5 + 0.5;
    const b = fbm(u * scale * 0.6 + 20, v * scale * 0.6, 4, Math.max(1, Math.round(scale * 0.6))) * 0.5 + 0.5;
    // Veins: thin dark ridges of a warped noise.
    const w = fbm(u * scale * 2 + fbm(u * 3, v * 3, 2, 3), v * scale * 2, 4, scale * 2);
    const vein = 1 - sstep(0.0, 0.04, Math.abs(w));
    const les = sstep(0.7, 0.76, fbm(u * scale * 1.5 + 50, v * scale * 1.5 + 50, 4, Math.round(scale * 1.5)) * 0.5 + 0.5);
    let c = mix3(base, pale, sstep(0.55, 0.9, n) * 0.5);
    c = mix3(c, bruise, sstep(0.55, 0.85, b) * 0.6);
    c = mix3(c, hex("#2d2436"), vein * 0.55);
    c = mix3(c, lesion, les);
    return c;
  });
}

/** The same skin's height: lesions sink, veins and sores rise. */
export function rotNormal(size: number, scale = 5): HTMLCanvasElement {
  return normalFrom(
    size,
    size,
    (u, v) => {
      const w = fbm(u * scale * 2 + fbm(u * 3, v * 3, 2, 3), v * scale * 2, 4, scale * 2);
      const vein = 1 - sstep(0.0, 0.05, Math.abs(w));
      const les = sstep(0.68, 0.78, fbm(u * scale * 1.5 + 50, v * scale * 1.5 + 50, 4, Math.round(scale * 1.5)) * 0.5 + 0.5);
      const pores = fbm(u * 60, v * 60, 2, 60) * 0.1;
      return vein * 0.3 - les * 0.7 + pores;
    },
    5,
  );
}

/** Blood splatter decal (RGBA): a main blot, satellite drops and drips. */
export function bloodDecal(size: number, s = 3, fresh = 0.6): HTMLCanvasElement {
  const [c, g] = canvas(size);
  reseed(s * 131 + 7);
  const col = (a: number) => `rgba(${Math.round(70 + fresh * 60)},${Math.round(4 + fresh * 6)},${Math.round(6 + fresh * 4)},${a})`;
  const cx = size / 2;
  const cy = size / 2;
  for (let k = 0; k < 3; k++) {
    g.fillStyle = col(0.85);
    g.beginPath();
    const r = size * (0.16 + rnd() * 0.08);
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.2) {
      const rr = r * (0.75 + perlin(Math.cos(a) * 2 + k * 3, Math.sin(a) * 2) * 0.45);
      const x = cx + Math.cos(a) * rr + (rnd() - 0.5) * size * 0.1;
      const y = cy + Math.sin(a) * rr + (rnd() - 0.5) * size * 0.1;
      if (a === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.fill();
  }
  for (let i = 0; i < 60; i++) {
    const a = rnd() * Math.PI * 2;
    const d = size * (0.2 + rnd() * 0.3);
    g.fillStyle = col(0.6 + rnd() * 0.4);
    g.beginPath();
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + rnd() * size * 0.018, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 6; i++) {
    const x = cx + (rnd() - 0.5) * size * 0.3;
    const y0 = cy + size * 0.05;
    const len = size * (0.12 + rnd() * 0.3);
    const grd = g.createLinearGradient(0, y0, 0, y0 + len);
    grd.addColorStop(0, col(0.85));
    grd.addColorStop(1, col(0));
    g.fillStyle = grd;
    g.fillRect(x, y0, 2 + rnd() * 4, len);
  }
  return c;
}

// ── Treasure (legendary loot) ────────────────────────────────────────────────

/** Engraved filigree (height): scrolls and leaves; drives a normal map and the gold's cavity dirt. */
export function filigreeHeight(u: number, v: number, density = 6): number {
  const x = u * density;
  const y = v * density;
  const cx = Math.floor(x) + 0.5;
  const cy = Math.floor(y) + 0.5;
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx);
  const spiral = Math.abs(((a / (Math.PI * 2) + r * 2.4 + (Math.floor(x) + Math.floor(y)) * 0.25) % 0.25) - 0.125) < 0.02 && r < 0.48 ? 1 : 0;
  const border = Math.abs(r - 0.47) < 0.015 ? 1 : 0;
  const leaf = Math.abs(dx * dy) < 0.004 && r < 0.3 ? 0.7 : 0;
  return Math.max(spiral, border, leaf);
}

export function filigreeNormal(size: number, density = 6, strength = 6): HTMLCanvasElement {
  return normalFrom(size, size, (u, v) => filigreeHeight(u, v, density), strength);
}

/** Gold/silver albedo with dark engraving cavities. */
export function engraved(size: number, metalHex: string, density = 6): HTMLCanvasElement {
  const m = hex(metalHex);
  return paint(size, size, (u, v) => {
    const h = filigreeHeight(u, v, density);
    const n = fbm(u * 5, v * 5, 3, 5) * 0.5 + 0.5;
    const c = mix3(m, [m[0] * 0.35, m[1] * 0.3, m[2] * 0.25], h * 0.85);
    return [c[0] * (0.92 + n * 0.12), c[1] * (0.92 + n * 0.12), c[2] * (0.92 + n * 0.12)];
  });
}

// ── Signs and screens ────────────────────────────────────────────────────────

/** A board's face: our own house content only (no made-up brands). */
export function boardFace(w: number, h: number, kind: string): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const sky = (a: string, b: string) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, a);
    grd.addColorStop(1, b);
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  };
  const text = (s: string, x: number, y: number, size: number, color = "#fff", weight = 900, align: CanvasTextAlign = "left", font = "Montserrat, Inter, sans-serif") => {
    g.font = `${weight} ${size}px ${font}`;
    g.textAlign = align;
    g.fillStyle = color;
    g.fillText(s, x, y);
  };
  if (kind === "dead") {
    sky("#2a0204", "#090102");
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(160,10,10,${0.05 + rnd() * 0.1})`;
      g.beginPath();
      g.arc(rnd() * w, rnd() * h, rnd() * h * 0.3, 0, Math.PI * 2);
      g.fill();
    }
    text("DEAD STREETS", w * 0.06, h * 0.42, h * 0.22, "#f1e3d0");
    text("SURVIVE THE NIGHT · NEW SEASON", w * 0.06, h * 0.62, h * 0.08, "#ff5a3c", 700);
    text("EMILGO GAMES", w * 0.06, h * 0.86, h * 0.07, "#ffffffaa", 800);
  } else if (kind === "ffa") {
    sky("#0b2d1a", "#04110a");
    g.strokeStyle = "rgba(0,200,100,0.25)";
    for (let i = 0; i < 18; i++) {
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(w * 0.62 + i * 14, 0);
      g.lineTo(w * 0.42 + i * 14, h);
      g.stroke();
    }
    text("FREE FOR ALL", w * 0.06, h * 0.42, h * 0.2, "#ffffff");
    text("12 PLAYERS · ONE FLAG · NO MERCY", w * 0.06, h * 0.6, h * 0.075, "#22d07a", 700);
    text("PLAY NOW · EMILGO GAMES", w * 0.06, h * 0.84, h * 0.07, "#f5a623", 800);
  } else if (kind === "rank") {
    sky("#1c1405", "#0a0702");
    text("TITAN", w * 0.5, h * 0.5, h * 0.3, "#f5c14a", 900, "center");
    text("THE NEW TOP RANK · EARN IT", w * 0.5, h * 0.7, h * 0.08, "#ffffffcc", 700, "center");
  } else if (kind === "app") {
    sky("#009a43", "#00602a");
    text("EMILGO", w * 0.07, h * 0.48, h * 0.26, "#ffffff");
    text("RIDE · PAY · TRACK — ON THE EMILGO APP", w * 0.07, h * 0.68, h * 0.07, "#eafff2", 700);
  } else if (kind === "daily") {
    sky("#101828", "#05080f");
    text("DAILY RUN", w * 0.06, h * 0.38, h * 0.16, "#8fd3ff");
    text("SEED 2611 · BEST 08:41", w * 0.06, h * 0.58, h * 0.1, "#ffffff", 800, "left", "JetBrains Mono, monospace");
    text("EMILGO GAMES", w * 0.06, h * 0.84, h * 0.07, "#ffffff88", 800);
  } else {
    sky("#1b1b1f", "#0b0b0d");
    text("YOUR AD HERE", w * 0.5, h * 0.5, h * 0.16, "#ffffff", 900, "center");
    text("advertise · EMILGO", w * 0.5, h * 0.68, h * 0.07, "#f5a623", 700, "center");
  }
  return c;
}
