// The minimap (SPEC-V2 §3.2, §7.6): top right, round, faded at the edge,
// slightly see-through, over the map's own terrain — a top-down picture of the
// place, taken once at the start of the round. It turns with your view (up is
// where you look) and is centred on you. Tap it for the full map: the whole
// field, north up (the finish at the top), everyone on it.
//
// Marks: you (an arrow), runners (white), the safe (white rings), the out
// (grey), the eye (white; red while it watches), balls and baskets.

import { gameSize } from "./rotate";
import { el } from "./dom";

export interface MapMark {
  x: number;
  z: number;
  /**
   * Free For All adds: a flag (gold; held or on the ground), a goal ring of
   * radius `r` (a drop zone, the rally point, the gate), a squad mate
   * (green), a flag holder's ping (red). Vehicles add a car (r 0: blown
   * up) and a fuel boy still selling.
   */
  kind: "other" | "out" | "safe" | "ball" | "basket" | "crate" | "flag" | "goal" | "mate" | "ping" | "car" | "fuel" | "job" | "rival" | "chest" | "treasure" | "loot";
  r?: number;
  /** The full map writes it beside the mark (a Map Print's names). */
  label?: string;
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
  /** Metres from the centre to the rim of the small map (open worlds see further). */
  reach = REACH;
  /** Open worlds: the places named on the full map. */
  names: readonly { name: string; x: number; z: number }[] = [];
  /** Open worlds: the zone now (outside it shaded) and the next circle (dashed). */
  zone: { now: { x: number; z: number; r: number }; next: { x: number; z: number; r: number } | null } | null = null;
  /** A Map Print's seconds left (v5): its banner on the full map. */
  print = 0;
  /** Find the Flag: the radio hints, each a circle the flag is somewhere in (the newest drawn strongest). */
  hints: { x: number; z: number; r: number }[] = [];

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
  draw(me: { x: number; z: number; heading: number; out: boolean }, marks: readonly MapMark[], doll: { x: number; z: number; watching: boolean } | null, yaw: number): void {
    const now = performance.now();
    if (now - this.at < 66) return;
    this.at = now;
    const g = this.g;
    const W = this.canvas.width;
    const k = W / 2 / this.reach; // px per metre
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
    const r = 1.1 * (this.reach / REACH); // metres (a dot ≈ 2 m across on the field's map)
    if (this.zone) this.zoneMark(g, me, this.reach * 2, 1 / k);
    this.hintMarks(g, 1 / k);
    for (const m of marks) this.mark(g, m, r);
    if (doll) this.dollMark(g, doll, r * 1.8);
    // You: an arrow at the centre pointing where you face (relative to the view).
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.arrow(g, W / 2, W / 2, me.heading + yaw, W * 0.075, me.out);
    if (this.expanded) this.drawBig(me, marks, doll);
  }

  private mark(g: CanvasRenderingContext2D, m: MapMark, r: number): void {
    g.beginPath();
    if (m.kind === "rival") {
      // A Map Print (v5): a rival, red with a dark rim.
      g.fillStyle = "#ff4a3a";
      g.strokeStyle = "#000";
      g.lineWidth = r * 0.3;
      g.arc(m.x, m.z, r * 1.1, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      return;
    }
    if (m.kind === "chest" || m.kind === "loot") {
      // A Map Print: an unopened chest (brown), an item on the ground (pale).
      g.fillStyle = m.kind === "chest" ? "#9a6a3a" : "rgba(230,230,220,0.8)";
      g.rect(m.x - r * 0.7, m.z - r * 0.5, r * 1.4, r);
      g.fill();
      return;
    }
    if (m.kind === "treasure") {
      // A treasure (a Map Print shows where they hide): a gold star.
      g.fillStyle = "#ffc23a";
      g.strokeStyle = "#000";
      g.lineWidth = r * 0.3;
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const q = k % 2 ? r * 0.8 : r * 2;
        g.lineTo(m.x + Math.cos(a) * q, m.z + Math.sin(a) * q);
      }
      g.closePath();
      g.fill();
      g.stroke();
      return;
    }
    if (m.kind === "basket") {
      g.fillStyle = "#c08a4a";
      g.rect(m.x - r, m.z - r, r * 2, r * 2);
      g.fill();
      return;
    }
    if (m.kind === "goal") {
      // A drop zone, the rally point, the gate: a gold ring its own size, a dot in the middle.
      g.strokeStyle = "#ffd36a";
      g.lineWidth = r * 0.55;
      g.arc(m.x, m.z, Math.max(r * 2, m.r ?? r * 3), 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.fillStyle = "#ffd36a";
      g.arc(m.x, m.z, r * 0.6, 0, Math.PI * 2);
      g.fill();
      return;
    }
    if (m.kind === "flag") {
      // A flag: a gold pennant on a pole.
      g.fillStyle = "#ffc23a";
      g.strokeStyle = "#000";
      g.lineWidth = r * 0.3;
      g.moveTo(m.x - r * 0.7, m.z + r * 1.4);
      g.lineTo(m.x - r * 0.7, m.z - r * 1.6);
      g.lineTo(m.x + r * 1.5, m.z - r * 0.9);
      g.lineTo(m.x - r * 0.7, m.z - r * 0.2);
      g.closePath();
      g.fill();
      g.stroke();
      return;
    }
    if (m.kind === "ping") {
      g.strokeStyle = "#ff4a3a";
      g.lineWidth = r * 0.5;
      g.arc(m.x, m.z, r * 2.4, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.fillStyle = "#ff4a3a";
      g.arc(m.x, m.z, r, 0, Math.PI * 2);
      g.fill();
      return;
    }
    if (m.kind === "car") {
      // A car (vehicles): a rounded white body with a dark windscreen; a blown-up one grey.
      g.fillStyle = m.r === 0 ? "rgba(140,140,140,0.7)" : "#f5f5f5";
      g.strokeStyle = "#000";
      g.lineWidth = r * 0.3;
      g.rect(m.x - r * 0.9, m.z - r * 1.4, r * 1.8, r * 2.8);
      g.fill();
      g.stroke();
      return;
    }
    if (m.kind === "job") {
      // A Hustle station: a green diamond (grey while it rests or is broken: r 0).
      g.fillStyle = m.r === 0 ? "rgba(150,150,150,0.7)" : "#3ee08a";
      g.strokeStyle = "#000";
      g.lineWidth = r * 0.25;
      g.moveTo(m.x, m.z - r * 1.2);
      g.lineTo(m.x + r * 1.0, m.z);
      g.lineTo(m.x, m.z + r * 1.2);
      g.lineTo(m.x - r * 1.0, m.z);
      g.closePath();
      g.fill();
      g.stroke();
      return;
    }
    if (m.kind === "fuel") {
      // A fuel boy: a small yellow jerrycan.
      g.fillStyle = "#ffd21a";
      g.strokeStyle = "#000";
      g.lineWidth = r * 0.25;
      g.rect(m.x - r * 0.7, m.z - r * 0.8, r * 1.4, r * 1.6);
      g.fill();
      g.stroke();
      return;
    }
    if (m.kind === "crate") {
      // An Airfall crate (or its flare): a gold square.
      g.fillStyle = "#ffb52a";
      g.strokeStyle = "#000";
      g.lineWidth = r * 0.3;
      g.rect(m.x - r * 1.1, m.z - r * 1.1, r * 2.2, r * 2.2);
      g.fill();
      g.stroke();
      return;
    }
    g.arc(m.x, m.z, m.kind === "ball" ? r * 0.55 : r, 0, Math.PI * 2);
    if (m.kind === "safe") {
      g.strokeStyle = "#ffffff";
      g.lineWidth = r * 0.5;
      g.stroke();
    } else {
      g.fillStyle = m.kind === "out" ? "rgba(140,140,140,0.6)" : m.kind === "ball" ? "#ff6a2a" : m.kind === "mate" ? "#3ee08a" : "#ffffff";
      g.fill();
    }
  }

  /** The zone in world units: outside the circle shaded red, its edge, the next circle dashed. `px`: metres per pixel. */
  private zoneMark(g: CanvasRenderingContext2D, at: { x: number; z: number }, span: number, px: number): void {
    const z = this.zone!;
    const n = z.now;
    g.beginPath();
    g.rect(at.x - span, at.z - span, span * 2, span * 2);
    g.arc(n.x, n.z, n.r, 0, Math.PI * 2, true);
    g.fillStyle = "rgba(190,60,30,0.28)";
    g.fill("evenodd");
    g.beginPath();
    g.arc(n.x, n.z, n.r, 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,140,90,0.95)";
    g.lineWidth = 1.6 * px;
    g.stroke();
    if (z.next) {
      g.beginPath();
      g.arc(z.next.x, z.next.z, z.next.r, 0, Math.PI * 2);
      g.setLineDash([5 * px, 4 * px]);
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 1.3 * px;
      g.stroke();
      g.setLineDash([]);
    }
  }

  /** The radio hints: dashed gold circles, older ones fainter. `px`: metres per pixel. */
  private hintMarks(g: CanvasRenderingContext2D, px: number): void {
    const n = this.hints.length;
    this.hints.forEach((h, i) => {
      g.beginPath();
      g.arc(h.x, h.z, h.r, 0, Math.PI * 2);
      g.setLineDash([4 * px, 3 * px]);
      g.strokeStyle = i === n - 1 ? "rgba(255,200,80,0.95)" : "rgba(255,200,80,0.4)";
      g.lineWidth = 1.4 * px;
      g.stroke();
      g.setLineDash([]);
      if (i === n - 1) {
        g.fillStyle = "rgba(255,200,80,0.12)";
        g.fill();
      }
    });
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

  /** The full map: the whole field, north up (the finish at the top). */
  private drawBig(me: { x: number; z: number; heading: number; out: boolean }, marks: readonly MapMark[], doll: { x: number; z: number; watching: boolean } | null): void {
    const t = this.terrain;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const span = t ? t.z1 - t.z0 : 140;
    const wide = t ? t.x1 - t.x0 : 60;
    // As big as fits: 86% of the height, or (a phone held upright, a square world) 94% of the width.
    const { w: sw, h: sh } = gameSize();
    const k = Math.min((sh * 0.86 * dpr) / span, (sw * 0.94 * dpr) / wide);
    const H = Math.round(span * k);
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
    if (this.zone) this.zoneMark(g, { x: x0 + wide / 2, z: z0 + span / 2 }, Math.max(wide, span), 1 / k);
    this.hintMarks(g, 1 / k);
    for (const m of marks) this.mark(g, m, r);
    if (doll) this.dollMark(g, doll, r * 1.8);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.names.length) {
      g.font = `600 ${Math.round(10 * dpr)}px Montserrat, sans-serif`;
      g.textAlign = "center";
      g.lineWidth = 3 * dpr;
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.fillStyle = "#fff4e0";
      // A name that would cover one already written moves below its point, or is left out.
      const used: [number, number, number, number][] = [];
      const lh = 12 * dpr;
      for (const n of this.names) {
        const w2 = g.measureText(n.name).width / 2 + 2 * dpr;
        const x = (n.x - x0) * k;
        for (const y of [(n.z - z0) * k, (n.z - z0) * k + lh, (n.z - z0) * k - lh]) {
          const box: [number, number, number, number] = [x - w2, y - lh * 0.8, x + w2, y + lh * 0.2];
          if (used.some((u) => box[0] < u[2] && box[2] > u[0] && box[1] < u[3] && box[3] > u[1])) continue;
          used.push(box);
          g.strokeText(n.name, x, y);
          g.fillText(n.name, x, y);
          break;
        }
      }
    }
    // v7 (the owner: icons, no labels): the marks speak for themselves; a Map Print shows only its seconds.
    g.lineWidth = 3 * dpr;
    g.strokeStyle = "rgba(0,0,0,0.75)";
    if (this.print > 0) {
      const txt = `${Math.ceil(this.print)} s`;
      g.font = `800 ${Math.round(12 * dpr)}px Montserrat, sans-serif`;
      g.textAlign = "center";
      g.strokeText(txt, W / 2, 18 * dpr);
      g.fillStyle = "#ffd36a";
      g.fillText(txt, W / 2, 18 * dpr);
    }
    this.arrow(g, (me.x - x0) * k, (me.z - z0) * k, me.heading, Math.max(8, r * k * 2.2), me.out);
  }
}
