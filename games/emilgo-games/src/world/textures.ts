// The only texture in the game: one canvas atlas, painted at startup, holding
// the shop signs and the words painted on the road. Drawing it costs a few
// milliseconds and zero network, which is why it is a canvas and not a PNG.
//
// Every sign is invented. No real brand, business, agency or person appears
// anywhere in the street (Vatar Developer Agreement §3.3 and §4(i)).

import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from "three";

const COLS = 2;
const ROWS = 8;
const CW = 512;
const CH = 128;

export type Cell = [number, number, number, number];

interface SignSpec {
  text: string;
  bg: string | null; // null = transparent (paint on the road)
  fg: string;
  border?: string;
  sub?: string;
}

export const SIGNS: SignSpec[] = [
  { text: "IYA BASIRA KITCHEN", bg: "#c62828", fg: "#fff8e1", border: "#ffd54f", sub: "AMALA • EWEDU • GBEGIRI" },
  { text: "GOD'S GRACE ELECTRONICS", bg: "#1565c0", fg: "#ffeb3b", border: "#ffffff" },
  { text: "NO SHAKING BARBING SALON", bg: "#2e7d32", fg: "#ffffff", border: "#c8e6c9", sub: "LOW CUT • SKIN FADE" },
  { text: "MAMA T PROVISIONS", bg: "#f9a825", fg: "#16203c", border: "#16203c" },
  { text: "ALHAJI SUYA SPOT", bg: "#4e342e", fg: "#ffb74d", border: "#ffb74d", sub: "HOT • HOT • HOT" },
  { text: "OGA LANRE VULCANISER", bg: "#37474f", fg: "#ffd600", border: "#ffd600" },
  { text: "MADAM CHI FABRICS", bg: "#6a1b9a", fg: "#ffffff", border: "#ffd54f", sub: "ANKARA • LACE • GELE" },
  { text: "FINE BOY PHONE REPAIRS", bg: "#00838f", fg: "#ffffff", border: "#b2ebf2" },
  { text: "EKO CHOP & CHILL", bg: "#ef6c00", fg: "#ffffff", border: "#fff3e0" },
  { text: "BLESSED HANDS TAILORING", bg: "#ad1457", fg: "#ffffff", border: "#f8bbd0" },
  { text: "START", bg: null, fg: "#ffffff" },
  { text: "FINISH", bg: null, fg: "#ffffff" },
  { text: "POST NO BILL", bg: null, fg: "#b71c1c" },
  { text: "EMILGO GAMES", bg: "#16203c", fg: "#ffd700", border: "#12b76a", sub: "RED LIGHT • GREEN LIGHT" },
  { text: "NO SHAKING", bg: null, fg: "#ffd700" },
  { text: "WAKA!", bg: null, fg: "#ffffff" },
];

export const SHOP_SIGN_COUNT = 10;
export const CELL = {
  start: 10,
  finish: 11,
  postNoBill: 12,
  banner: 13,
  noShaking: 14,
  waka: 15,
} as const;

/** UV rectangle [u0, v0, u1, v1] for a cell index (v0 = bottom). */
export function cellUv(index: number): Cell {
  const c = index % COLS;
  const r = Math.floor(index / COLS);
  const inset = 1 / (CW * COLS); // half a texel, against bleeding
  return [c / COLS + inset, 1 - (r + 1) / ROWS + inset, (c + 1) / COLS - inset, 1 - r / ROWS - inset];
}

export function buildAtlas(maxAnisotropy: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = CW * COLS;
  canvas.height = CH * ROWS;
  const g = canvas.getContext("2d")!;
  const font = (px: number) => `900 ${px}px ui-rounded, "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif`;

  SIGNS.forEach((s, i) => {
    const x = (i % COLS) * CW;
    const y = Math.floor(i / COLS) * CH;
    g.save();
    g.beginPath();
    g.rect(x, y, CW, CH);
    g.clip();

    if (s.bg) {
      g.fillStyle = s.bg;
      g.fillRect(x, y, CW, CH);
      if (s.border) {
        g.strokeStyle = s.border;
        g.lineWidth = 8;
        g.strokeRect(x + 8, y + 8, CW - 16, CH - 16);
      }
    }

    // Shrink the type until it fits: long names get smaller, never clipped.
    const main = s.sub ? 52 : 74;
    let px = main;
    g.font = font(px);
    while (g.measureText(s.text).width > CW - 48 && px > 20) {
      px -= 2;
      g.font = font(px);
    }
    g.fillStyle = s.fg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (!s.bg) {
      // Road paint: slightly worn, so it reads as paint and not UI.
      g.globalAlpha = 0.92;
    }
    g.fillText(s.text, x + CW / 2, y + (s.sub ? CH * 0.42 : CH / 2));
    if (s.sub) {
      g.font = font(24);
      g.globalAlpha = 0.9;
      g.fillText(s.sub, x + CW / 2, y + CH * 0.76);
    }
    g.restore();
  });

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}
