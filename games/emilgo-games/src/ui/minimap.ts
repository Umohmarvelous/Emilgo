// The minimap (SPEC-V2 §3.2, §7.6): top right, round, faded at the edge,
// slightly see-through, over the map's own terrain — a top-down picture of the
// place, taken once at the start of the round. It turns with your view (up is
// where you look) and is centred on you. Tap it for the full map: the whole
// field, north up (Mama at the top), everyone on it.
//
// Marks: you (an arrow), runners (white), the safe (white rings), the out
// (grey), Mama (white; red while she watches), balls and baskets.

import { el } from "./dom";

export interface MapMark {
  x: number;
  z: number;
  kind: "other" | "out" | "safe" | "ball" | "basket";
}

export interface TerrainShot {
  image: HTMLCanvasElement;
  /** World rectangle the picture covers. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const SIZE = { small: 96, medium: 124, large: 156 } as const;
/** Metres from the centre to the rim of the small map. */
const REACH = 46;

export class Minimap {
  readonly root = el("button", "minimap");
  private readonly canvas = el("canvas");
  private readonly g: CanvasRenderingContext2D;
  private readonly big = el("div", "bigmap");
  private readonly bigCanvas = el("canvas");
  private readonly bg: CanvasRenderingContext2D;
  private terrain: TerrainShot | null = null;
  private px = 124;
  private at = 0;
  expanded = false;

  constructor(parent: HTMLElement) {
    this.root.dataset.ui = "1";
    this.root.setAttribute("aria-label", "Map (tap to expand)");
    this.root.append(this.canvas);
    this.g = this.canvas.getContext("2d")!;
    this.big.dataset.ui = "1";
    this.big.setAttribute("role", "dialog");
    this.big.setAttribute("aria-label", "Map");
    this.big.append(this.bigCanvas);
    this.bg = this.bigCanvas.getContext("2d")!;
    this.root.addEventListener("click", () => this.expand(true));
    this.big.addEventListener("click", () => this.expand(false));
    parent.append(this.big);
    this.setSize("medium");
  }

  setSize(s: keyof typeof SIZE): void {
    this.px = SIZE[s];
    this.root.style.width = this.root.style.height = `${this.px}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.canvas.height = Math.round(this.px * dpr);
  }

  setTerrain(t: TerrainShot | null): void {
    this.terrain = t;
  }

  expand(on: boolean): void {
    this.expanded = on;
    this.big.classList.toggle("visible", on);
  }

  /**
   * Draw. `yaw` is the camera's (up on the map = where you look). Throttled to
   * 15 Hz; the full map, when open, redraws with it.
   */
  draw(me: { x: number; z: number; heading: number; out: boolean }, marks: readonly MapMark[], doll: { x: number; z: number; watching: boolean }, yaw: number): void {
    const now = performance.now();
    if (now - this.at < 66) return;
    this.at = now;
    const g = this.g;
    const W = this.canvas.width;
    const k = W / 2 / REACH; // px per metre
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    g.fillStyle = "rgba(20,20,20,0.55)";
    g.fillRect(0, 0, W, W);
    // World → map: rotate so that the camera's forward is up, centred on you.
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const a = k * c;
    const b = k * s;
    g.setTransform(a, b, -b, a, W / 2 - (a * me.x - b * me.z), W / 2 - (b * me.x + a * me.z));
    const t = this.terrain;
    if (t) {
      g.globalAlpha = 0.95;
      g.drawImage(t.image, t.x0, t.z0, t.x1 - t.x0, t.z1 - t.z0);
      g.globalAlpha = 1;
    }
    const r = 1.1; // metres (a dot ≈ 2 m across)
    for (const m of marks) this.mark(g, m, r);
    this.dollMark(g, doll, r * 1.8);
    // You: an arrow at the centre pointing where you face (relative to the view).
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.arrow(g, W / 2, W / 2, me.heading + yaw, W * 0.075, me.out);
    if (this.expanded) this.drawBig(me, marks, doll);
  }

  private mark(g: CanvasRenderingContext2D, m: MapMark, r: number): void {
    g.beginPath();
    if (m.kind === "basket") {
      g.fillStyle = "#c08a4a";
      g.rect(m.x - r, m.z - r, r * 2, r * 2);
      g.fill();
      return;
    }
    g.arc(m.x, m.z, m.kind === "ball" ? r * 0.55 : r, 0, Math.PI * 2);
    if (m.kind === "safe") {
      g.strokeStyle = "#ffffff";
      g.lineWidth = r * 0.5;
      g.stroke();
    } else {
      g.fillStyle = m.kind === "out" ? "rgba(140,140,140,0.6)" : m.kind === "ball" ? "#ff6a2a" : "#ffffff";
      g.fill();
    }
  }

  private dollMark(g: CanvasRenderingContext2D, d: { x: number; z: number; watching: boolean }, r: number): void {
    g.beginPath();
    g.moveTo(d.x, d.z - r);
    g.lineTo(d.x + r, d.z);
    g.lineTo(d.x, d.z + r);
    g.lineTo(d.x - r, d.z);
    g.closePath();
    g.fillStyle = d.watching ? "#e5292a" : "#ffffff";
    g.fill();
    g.strokeStyle = "#000000";
    g.lineWidth = r * 0.2;
    g.stroke();
  }

  private arrow(g: CanvasRenderingContext2D, x: number, y: number, rot: number, s: number, out: boolean): void {
    g.save();
    g.translate(x, y);
    // Heading h faces (sin h, cos h) in x/z; on the map +z is down, so the arrow points down at h = 0.
    g.rotate(-rot + Math.PI);
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s * 0.72, s * 0.75);
    g.lineTo(0, s * 0.38);
    g.lineTo(-s * 0.72, s * 0.75);
    g.closePath();
    g.fillStyle = out ? "#8a8a8a" : "#ffffff";
    g.fill();
    g.strokeStyle = "#000000";
    g.lineWidth = Math.max(1, s * 0.16);
    g.stroke();
    g.restore();
  }

  /** The full map: the whole field, north up (Mama at the top). */
  private drawBig(me: { x: number; z: number; heading: number; out: boolean }, marks: readonly MapMark[], doll: { x: number; z: number; watching: boolean }): void {
    const t = this.terrain;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const H = Math.round(window.innerHeight * 0.86 * dpr);
    const span = t ? t.z1 - t.z0 : 140;
    const wide = t ? t.x1 - t.x0 : 60;
    const k = H / span;
    const W = Math.round(wide * k);
    if (this.bigCanvas.width !== W || this.bigCanvas.height !== H) {
      this.bigCanvas.width = W;
      this.bigCanvas.height = H;
      this.bigCanvas.style.width = `${W / dpr}px`;
      this.bigCanvas.style.height = `${H / dpr}px`;
    }
    const g = this.bg;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const x0 = t ? t.x0 : -wide / 2;
    const z0 = t ? t.z0 : -span;
    g.setTransform(k, 0, 0, k, -x0 * k, -z0 * k);
    if (t) g.drawImage(t.image, t.x0, t.z0, t.x1 - t.x0, t.z1 - t.z0);
    const r = Math.max(1.4, 3 / k);
    for (const m of marks) this.mark(g, m, r);
    this.dollMark(g, doll, r * 1.8);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.arrow(g, (me.x - x0) * k, (me.z - z0) * k, me.heading, Math.max(8, r * k * 2.2), me.out);
  }
}
