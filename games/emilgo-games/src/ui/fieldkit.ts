// HUD A, "Field Kit" (v4 Phase 3, the owner's pick), for Free For All and
// Dead Streets. Diegetic first: what an operator would carry.
//
//   top left      the wrist watch: the zone's clock (Free For All) or the
//                 run's (Dead Streets) in amber, an arc of how much is left,
//                 and a line under it (zone · players left, bleed in …);
//                 beside it the plate carrier: armour as plates (25 each,
//                 a part-plate cracked) and a line (armour, the torch)
//   right         the radio: the feed, left of the minimap (the old game's,
//                 kept as it was)
//   the edges     from HUD C: red when hurt (a flash on each hit, a steady
//                 pulse under 30 health), orange heat outside the zone
//   in the world  a zombie's health over its head while it's being shot
//
// The centre (health and armour round the crosshair) and the weapon are the
// gun HUD's (combat.ts). Transforms and opacity only.

import { el } from "./dom";
import { t } from "./i18n";

export interface FieldKitState {
  /** The watch: its big number, the line under it, how much is left (0 … 1), urgent. */
  watch: { big: string; line: string; arc: number; urgent: boolean };
  /** Armour points and the most (a plate is 25). */
  armour: number;
  armourMax: number;
  /** The line under the plates ("ARMOUR 75", "TORCH 48%"). */
  tag: string;
  /** Health 0 … 1 (the red edge), outside the zone 0 … 1 (the orange). */
  health: number;
  heat: number;
  doomed: boolean;
}

/** A bar over a zombie: where on screen (px), its life (0 … 1), shown or not. */
export interface ZombieBar {
  x: number;
  y: number;
  v: number;
  on: boolean;
  /** Masked: only a head shot puts it down. */
  masked: boolean;
}

const PLATE = 25;
const BARS = 10;

export class FieldKit {
  readonly root = el("div", "fieldkit-layer");
  private readonly watch = el("div", "fk-watch");
  private readonly arc = el("div", "fk-arc");
  private readonly big = el("div", "fk-t");
  private readonly line = el("div", "fk-l");
  private readonly rig = el("div", "fk-rig");
  private readonly plates = el("div", "fk-plates");
  private readonly tag = el("div", "fk-tag");
  private readonly hurtEl = el("div", "fk-hurt");
  private readonly flashEl = el("div", "fk-flash");
  private readonly heatEl = el("div", "fk-heat");
  private readonly bars: HTMLElement[] = [];
  private last = "";
  private platesKey = "";

  constructor() {
    this.watch.append(this.arc, el("div", "fk-face"), this.big, this.line);
    this.rig.append(this.plates, this.tag);
    this.root.append(this.heatEl, this.hurtEl, this.flashEl, this.watch, this.rig);
    for (let k = 0; k < BARS; k++) {
      const b = el("div", "fk-zbar");
      b.append(el("i"));
      this.bars.push(b);
      this.root.append(b);
    }
    this.root.hidden = true;
  }

  show(on: boolean): void {
    this.root.hidden = !on;
  }

  update(s: FieldKitState): void {
    const key = `${s.watch.big}|${s.watch.line}|${s.watch.urgent}`;
    if (key !== this.last) {
      this.last = key;
      this.big.textContent = s.watch.big;
      this.line.textContent = s.watch.line.toUpperCase();
      this.watch.classList.toggle("urgent", s.watch.urgent);
    }
    this.arc.style.setProperty("--a", `${Math.round(Math.max(0, Math.min(1, s.watch.arc)) * 100)}%`);
    // Plates: whole, cracked (part), gone.
    const n = Math.ceil(s.armourMax / PLATE);
    let pk = "";
    for (let k = 0; k < n; k++) {
      const v = Math.max(0, Math.min(1, (s.armour - k * PLATE) / PLATE));
      pk += v >= 0.999 ? "f" : v > 0.01 ? "c" : "o";
    }
    if (pk !== this.platesKey) {
      this.platesKey = pk;
      this.plates.innerHTML = [...pk].map((c) => `<i class="${c === "f" ? "" : c === "c" ? "cracked" : "off"}"></i>`).join("");
    }
    this.tag.textContent = s.tag;
    // Hurt: a steady red below 60 health, pulsing below 30.
    const low = s.health < 0.6 ? (0.6 - s.health) / 0.6 : 0;
    this.hurtEl.style.opacity = (low * 0.85).toFixed(2);
    this.hurtEl.classList.toggle("pulse", s.health < 0.3 && s.health > 0);
    this.heatEl.style.opacity = Math.min(1, s.heat).toFixed(2);
    this.heatEl.classList.toggle("doomed", s.doomed);
  }

  /** A hit on you: the edge flashes red. */
  hurt(): void {
    const f = this.flashEl;
    f.classList.remove("on");
    void f.offsetWidth;
    f.classList.add("on");
  }

  /** The zombies' bars this frame (the nearest few being shot). */
  zombies(list: readonly ZombieBar[]): void {
    for (let k = 0; k < BARS; k++) {
      const b = this.bars[k];
      const z = list[k];
      if (!z || !z.on) {
        if (!b.classList.contains("hide")) b.classList.add("hide");
        continue;
      }
      b.classList.remove("hide");
      b.style.transform = `translate(${z.x.toFixed(1)}px, ${z.y.toFixed(1)}px)`;
      (b.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, z.v)).toFixed(3)})`;
      b.classList.toggle("low", z.v < 0.3);
      b.classList.toggle("masked", z.masked);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/** "Players left" in the watch's line. */
export function leftLine(n: number): string {
  return `${n} ${t("left")}`;
}
