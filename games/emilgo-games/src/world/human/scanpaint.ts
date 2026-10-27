// The scanned people's texture: the baked head, and the hoodie and joggers
// painted in their colour and design.
//
// Fleece reads as a soft, slightly speckled surface with ribbed cuffs and hem
// band; the kangaroo pocket, the dropped shoulder seams and the side seams are
// stitched in. Designs: plain, two-tone (contrast hood, cuffs, band, pocket),
// a chest stripe, an Ankara pocket and hood, a colour block. On the field the
// player's number goes on the back and small on the chest.

import { ankara, hash, prng, Region, shade } from "./paint";
import { HEAD_PAD, SCELL, SUV, headImages } from "./scanbody";
import type { Tier } from "./mesh";
import { HOODIE_COLORS, type HoodieDesign, type Look } from "./wardrobe";

type Ctx = CanvasRenderingContext2D;

/** A colour that stands out against `hex` (light hoodies get black trim, dark ones off-white). */
function contrast(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return l > 140 ? "#1d1d20" : "#ece9e2";
}

const ANKARA = ["#e85d04", "#370617", "#ffba08", "#0f4c5c", "#fefae0"];

/** Hoodie colour for a look: its own, or (older saves) the nearest to its old outfit. */
export function hoodieHex(look: Look): string {
  return HOODIE_COLORS[look.hoodie]?.hex ?? HOODIE_COLORS[0].hex;
}

export function paintScanLook(look: Look, tier: Tier, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const main = hoodieHex(look);
  const design: HoodieDesign = look.design ?? "plain";
  const alt = contrast(main);
  const rnd = prng(hash(`${look.hoodie}|${design}`));
  const detail = tier === 2 ? 1 : tier === 1 ? 0.5 : 0.2;

  g.fillStyle = main;
  g.fillRect(0, 0, size, size);

  paintHead(g, size, look);
  const trim = design === "twotone" ? alt : shade(main, 0.9);
  // Palette: hood, pocket, strings, a white cell for the skin parts.
  const cells: [number, string][] = [
    [SCELL.hood, design === "twotone" || design === "block" ? alt : shade(main, 0.97)],
    [SCELL.pocket, design === "twotone" ? alt : main],
    [SCELL.string, design === "twotone" ? main : "#efeee9"],
    [SCELL.tip, "#ffffff"],
    [SCELL.inner, shade(main, 0.7)],
    [SCELL.cuff, trim],
    [SCELL.band, trim],
    [SCELL.mouth, "#2a0c0a"],
    [SCELL.teeth, "#d9d2c3"],
  ];
  const [pu0, pv0, pu1, pv1] = SUV.palette;
  const cw = ((pu1 - pu0) / 8) * size;
  const ch = ((pv1 - pv0) / 4) * size;
  for (const [cell, col] of cells) {
    g.fillStyle = col;
    g.fillRect(pu0 * size + (cell % 8) * cw, (1 - pv1) * size + (3 - Math.floor(cell / 8)) * ch, cw, ch);
  }
  // An Ankara hood: the print shows on the hood (palette cell can't carry it, so the hood uses its own cell colour).
  if (design === "ankara") {
    g.fillStyle = ANKARA[0];
    g.fillRect(pu0 * size + SCELL.hood * cw, (1 - pv1) * size + 3 * ch, cw, ch);
  }

  const sheen = !!HOODIE_COLORS[look.hoodie]?.satin;
  paintTorso(g, size, look, main, alt, design, trim, rnd, detail, sheen);
  paintSleeves(g, size, main, alt, design, trim, rnd, detail, sheen);
  paintJoggers(g, size, main, design, rnd, detail, sheen);
  return canvas;
}

function paintHead(g: Ctx, size: number, look: Look): void {
  const img = headImages[look.body];
  if (!img) return;
  const [u0, v0, u1, v1] = SUV.head;
  const x = u0 * size;
  const y = (1 - v1) * size;
  const w = (u1 - u0) * size;
  const h = (v1 - v0) * size;
  const turn = w / (1 + 2 * HEAD_PAD);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.imageSmoothingQuality = "high";
  // The projection wraps round the back of the head: draw a turn either side
  // too, each a pixel wider so no seam of the background shows between them.
  for (const k of [-1, 1, 0]) g.drawImage(img, x + HEAD_PAD * turn + k * turn - 1, y, turn + 2, h);
  g.restore();
}

/** Soft fleece: tiny speckles and a faint knit grain. */
/** The paid colours: soft satin highlights running round the fabric. */
function satin(g: Ctx, w: number, h: number): void {
  const gr = g.createLinearGradient(0, 0, w, h * 0.35);
  for (let k = 0; k <= 8; k++) gr.addColorStop(k / 8, k % 2 ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.06)");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}

function fleece(g: Ctx, base: string, w: number, h: number, rnd: () => number, detail: number): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const n = Math.round(w * h * 4000 * detail);
  for (let i = 0; i < n; i++) {
    g.fillStyle = rnd() < 0.5 ? shade(base, 1.04, 0.18) : shade(base, 0.95, 0.18);
    g.fillRect(rnd() * w, rnd() * h, 0.003, 0.003);
  }
}

/** Ribbing: fine vertical ribs over a band. */
function rib(g: Ctx, col: string, x: number, y: number, w: number, h: number): void {
  g.fillStyle = col;
  g.fillRect(x, y, w, h);
  g.fillStyle = shade(col, 0.82, 0.55);
  for (let xx = x; xx < x + w; xx += 0.008) g.fillRect(xx, y, 0.003, h);
  // The band's edge casts a soft line on the fabric.
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(x, y + h, w, 0.006);
}

function stitch(g: Ctx, col: string, pts: [number, number][]): void {
  g.strokeStyle = col;
  g.lineWidth = 0.0035;
  g.setLineDash([0.008, 0.006]);
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.setLineDash([]);
}

/** Torso region in metres: circumference × height (from the hem). */
const TORSO_W = 1.12;
const TORSO_H = 0.64;
/** Heights on the torso region (metres from the hem). */
const BAND = 0.065;

function paintTorso(g: Ctx, size: number, look: Look, main: string, alt: string, design: HoodieDesign, trim: string, rnd: () => number, detail: number, sheen: boolean): void {
  const R = new Region(g, size, SUV.torso, TORSO_W, TORSO_H);
  const front = TORSO_W / 2;
  R.draw((g) => {
    fleece(g, main, TORSO_W, TORSO_H, rnd, detail);
    if (sheen) satin(g, TORSO_W, TORSO_H);
    if (design === "block") {
      // Upper body in the contrast colour, a clean seam across the chest.
      fleece(g, alt, TORSO_W, TORSO_H, rnd, detail * 0.5);
      g.fillStyle = main;
      g.fillRect(0, 0, TORSO_W, TORSO_H * 0.55);
      stitch(g, shade(main, 0.7), [[0, TORSO_H * 0.55], [TORSO_W, TORSO_H * 0.55]]);
    }
    if (design === "stripe") {
      g.fillStyle = alt;
      g.fillRect(0, TORSO_H * 0.66, TORSO_W, 0.055);
      g.fillStyle = shade(alt === "#1d1d20" ? "#c79a32" : "#0a8a4a", 1);
      g.fillRect(0, TORSO_H * 0.66 + 0.062, TORSO_W, 0.014);
    }
    // Soft folds: shade low at the sides and under the chest.
    const sh = g.createLinearGradient(0, 0, 0, TORSO_H);
    sh.addColorStop(0, "rgba(0,0,0,0.16)");
    sh.addColorStop(0.35, "rgba(0,0,0,0.02)");
    sh.addColorStop(0.8, "rgba(255,255,255,0.04)");
    sh.addColorStop(1, "rgba(0,0,0,0.1)");
    g.fillStyle = sh;
    g.fillRect(0, 0, TORSO_W, TORSO_H);
    for (const sx of [TORSO_W * 0.25, TORSO_W * 0.75]) {
      const gr = g.createLinearGradient(sx - 0.08, 0, sx + 0.08, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(0.5, "rgba(0,0,0,0.12)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(sx - 0.08, 0, 0.16, TORSO_H);
      stitch(g, shade(main, 0.75), [[sx, BAND], [sx, TORSO_H * 0.84]]);
    }
    // Ribbed hem band.
    rib(g, design === "block" ? main : trim, 0, 0, TORSO_W, BAND);
    // Kangaroo pocket: a wide patch above the band, curved openings at the sides.
    const pb = BAND + 0.02;
    const pt = pb + 0.15;
    const pw = 0.14;
    const pocketCol = design === "twotone" ? alt : main;
    g.save();
    g.beginPath();
    g.moveTo(front - pw - 0.01, pb);
    g.lineTo(front + pw + 0.01, pb);
    g.quadraticCurveTo(front + pw - 0.01, pt - 0.05, front + pw - 0.045, pt);
    g.lineTo(front - pw + 0.045, pt);
    g.quadraticCurveTo(front - pw + 0.01, pt - 0.05, front - pw - 0.01, pb);
    g.closePath();
    g.clip();
    if (design === "ankara") ankara(g, ANKARA, "circles", front - pw - 0.02, pb, pw * 2 + 0.04, pt - pb, rnd, 0.05);
    else {
      g.fillStyle = pocketCol;
      g.fillRect(front - pw - 0.02, pb, pw * 2 + 0.04, pt - pb);
    }
    // The pocket's top edge throws a shadow onto it.
    const ps = g.createLinearGradient(0, pt, 0, pb);
    ps.addColorStop(0, "rgba(255,255,255,0.08)");
    ps.addColorStop(1, "rgba(0,0,0,0.12)");
    g.fillStyle = ps;
    g.fillRect(front - pw - 0.02, pb, pw * 2 + 0.04, pt - pb);
    g.restore();
    stitch(g, shade(pocketCol, 0.65), [[front - pw - 0.01, pb + 0.004], [front - pw + 0.01, pt - 0.05], [front - pw + 0.045, pt - 0.004], [front + pw - 0.045, pt - 0.004], [front + pw - 0.01, pt - 0.05], [front + pw + 0.01, pb + 0.004]]);
    // Openings: dark slits along the curved sides.
    g.strokeStyle = "rgba(0,0,0,0.45)";
    g.lineWidth = 0.007;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(front + s * (pw + 0.01), pb + 0.01);
      g.quadraticCurveTo(front + s * (pw - 0.01), pt - 0.05, front + s * (pw - 0.045), pt);
      g.stroke();
    }
    // Shoulder seams (dropped, around the arm hole) and the neck rib.
    for (const sx of [TORSO_W * 0.25, TORSO_W * 0.75]) {
      g.strokeStyle = shade(main, 0.72);
      g.lineWidth = 0.004;
      g.beginPath();
      g.ellipse(sx, TORSO_H * 0.86, 0.12, 0.06, 0, 0, Math.PI * 2);
      g.stroke();
    }
    rib(g, design === "twotone" || design === "block" ? alt : trim, 0, TORSO_H - 0.03, TORSO_W, 0.03);
    // The player's number on the field: big on the back, small on the chest.
    if (look.num) {
      g.fillStyle = contrast(main);
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.save();
      g.translate(0, TORSO_H * 0.62);
      g.scale(1, -1);
      g.font = "bold 0.2px Montserrat, Arial, sans-serif";
      g.fillText(String(look.num), 0.001, 0);
      g.fillText(String(look.num), TORSO_W - 0.001, 0);
      g.font = "bold 0.06px Montserrat, Arial, sans-serif";
      g.fillText(String(look.num), front + 0.09, -0.1);
      g.restore();
    }
  });
}

const ARM_W = 0.44;
const ARM_H = 0.62;

function paintSleeves(g: Ctx, size: number, main: string, alt: string, design: HoodieDesign, trim: string, rnd: () => number, detail: number, sheen: boolean): void {
  for (const rect of [SUV.armL, SUV.armR]) {
    const R = new Region(g, size, rect, ARM_W, ARM_H);
    R.draw((g) => {
      fleece(g, main, ARM_W, ARM_H, rnd, detail);
      if (sheen) satin(g, ARM_W, ARM_H);
      if (design === "block") {
        g.fillStyle = alt;
        g.fillRect(0, ARM_H * 0.62, ARM_W, ARM_H * 0.38);
      }
      if (design === "stripe") {
        g.fillStyle = alt;
        g.fillRect(0, ARM_H * 0.7, ARM_W, 0.04);
      }
      const sh = g.createLinearGradient(0, 0, ARM_W, 0);
      sh.addColorStop(0, "rgba(0,0,0,0.14)");
      sh.addColorStop(0.5, "rgba(0,0,0,0)");
      sh.addColorStop(1, "rgba(0,0,0,0.14)");
      g.fillStyle = sh;
      g.fillRect(0, 0, ARM_W, ARM_H);
      // Seam down the back of the sleeve.
      stitch(g, shade(main, 0.75), [[0.004, 0.06], [0.004, ARM_H]]);
      rib(g, trim, 0, 0, ARM_W, 0.055);
    });
  }
}

const LEG_W = 0.64;
const LEG_H = 0.86;

function paintJoggers(g: Ctx, size: number, main: string, design: HoodieDesign, rnd: () => number, detail: number, sheen: boolean): void {
  // A matching set, one shade deeper (the green reference photo).
  const col = design === "block" ? shade(main, 0.78) : shade(main, 0.9);
  for (const rect of [SUV.legL, SUV.legR]) {
    const R = new Region(g, size, rect, LEG_W, LEG_H);
    R.draw((g) => {
      // The legs' paint is spread thinner than the body's: fewer, fainter speckles.
      fleece(g, col, LEG_W, LEG_H, rnd, detail * 0.12);
      if (sheen) satin(g, LEG_W, LEG_H);
      // Knee and ankle folds.
      for (const [y, a] of [
        [0.1, 0.12],
        [0.13, 0.1],
        [0.42, 0.08],
        [0.45, 0.06],
      ] as const) {
        g.fillStyle = `rgba(0,0,0,${a})`;
        g.fillRect(0, y, LEG_W, 0.012);
      }
      const sh = g.createLinearGradient(0, 0, LEG_W, 0);
      sh.addColorStop(0, "rgba(0,0,0,0.14)");
      sh.addColorStop(0.5, "rgba(0,0,0,0)");
      sh.addColorStop(1, "rgba(0,0,0,0.14)");
      g.fillStyle = sh;
      g.fillRect(0, 0, LEG_W, LEG_H);
      // Side seams (outer side of each leg is a quarter turn round).
      // Side seams: a faint fold line, not a stitched track.
      g.fillStyle = "rgba(0,0,0,0.07)";
      for (const sx of [LEG_W * 0.25, LEG_W * 0.75]) g.fillRect(sx - 0.002, 0.07, 0.004, LEG_H);
      rib(g, shade(col, 0.92), 0, 0, LEG_W, 0.06);
    });
  }
}
