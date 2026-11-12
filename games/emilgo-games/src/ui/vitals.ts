// v7 (3.1, the owner: "hud design of the entire game, make it look like most popular game look like cod, free
// fire and the rest but not entire copy their style"): the big shooters' vitals, in our own Field Kit style.
//
//   bottom centre   your name, armour as plates over a long health bar; the bar's damage trails behind it (a
//                   pale chip that drains a beat later), amber under 60%, red and beating under 30%
//   under the map   ALIVE and KILLS, the numbers every shooter keeps in sight
//
// The crosshair's arc (combat.ts, the owner's v4 pick) stays: this is the read at a glance from the edge.
// Transforms, opacity and text only, and only when something changed.

import { el } from "./dom";
import { t } from "./i18n";

export interface VitalsState {
  name: string;
  hp: number;
  hpMax: number;
  armour: number;
  armourMax: number;
  alive: number;
  kills: number;
}

/** A plate is 25 armour (as the Field Kit's carrier draws them). */
const PLATE = 25;

export class Vitals {
  readonly root = el("div", "vitals");
  /** Goes under the minimap (the HUD's top-right column). */
  readonly count = el("div", "vt-count");
  private readonly who = el("span", "vt-who");
  private readonly plates = el("div", "vt-plates");
  private readonly bar = el("div", "vt-bar");
  private readonly trail = el("i", "vt-trail");
  private readonly fill = el("i", "vt-fill");
  private readonly num = el("b", "vt-n");
  private readonly aliveN = el("b");
  private readonly killsN = el("b");
  private plateEls: HTMLElement[] = [];
  private last = "";
  private lastCount = "";
  private lastHp = -1;

  constructor() {
    this.root.hidden = true;
    this.count.hidden = true;
    this.root.setAttribute("aria-hidden", "true");
    const top = el("div", "vt-top");
    top.append(this.who, this.plates);
    this.bar.append(this.trail, this.fill);
    this.root.append(top, this.bar, this.num);
    const a = el("span", "vt-c");
    a.append(this.aliveN, el("i", "", t("Alive")));
    const k = el("span", "vt-c kills");
    k.append(this.killsN, el("i", "", t("Kills")));
    this.count.append(a, k);
  }

  show(on: boolean): void {
    if (this.root.hidden === !on) return;
    this.root.hidden = !on;
    this.count.hidden = !on;
  }

  update(s: VitalsState): void {
    const hp = Math.max(0, Math.min(s.hpMax, s.hp));
    const share = s.hpMax > 0 ? hp / s.hpMax : 0;
    const plates = Math.max(1, Math.round(s.armourMax / PLATE));
    const sig = `${s.name}|${Math.round(hp)}|${Math.round(s.armour)}|${plates}`;
    if (sig !== this.last) {
      this.last = sig;
      if (this.who.textContent !== s.name) this.who.textContent = s.name;
      if (this.plateEls.length !== plates) {
        this.plateEls = Array.from({ length: plates }, () => el("i"));
        this.plates.replaceChildren(...this.plateEls);
      }
      this.plateEls.forEach((p, j) => {
        const v = Math.max(0, Math.min(1, (s.armour - j * PLATE) / PLATE));
        p.style.setProperty("--v", v.toFixed(2));
        p.classList.toggle("empty", v <= 0);
      });
      this.fill.style.transform = `scaleX(${share.toFixed(3)})`;
      // The trail drains a beat after a hit (CSS delays its transition), and jumps up at once when healed.
      if (hp >= this.lastHp) this.trail.classList.add("snap");
      else this.trail.classList.remove("snap");
      this.trail.style.transform = `scaleX(${share.toFixed(3)})`;
      this.lastHp = hp;
      this.num.textContent = String(Math.ceil(hp));
      this.bar.classList.toggle("mid", share < 0.6 && share >= 0.3);
      this.bar.classList.toggle("low", share < 0.3);
    }
    const csig = `${s.alive}|${s.kills}`;
    if (csig !== this.lastCount) {
      this.lastCount = csig;
      this.aliveN.textContent = String(s.alive);
      if (this.killsN.textContent !== String(s.kills)) {
        this.killsN.textContent = String(s.kills);
        // A kill: the number pops.
        this.killsN.classList.remove("pop");
        void this.killsN.offsetWidth;
        this.killsN.classList.add("pop");
      }
    }
  }
}
