// The gun HUD (v4 Phase 2), in HUD A's Field Kit style with HUD C's centre:
//
//   centre        the crosshair (its ticks open with the spread), inside an
//                 arc of your health (left) and armour (right) — the owner's
//                 pick: C's arc, in A, at the centre; the reload's progress
//                 round it; hit markers (white body, gold head, red kill);
//                 a red sliver on a wider ring toward whoever hit you
//   by the arc    the rounds in the magazine / spare
//   bottom right  the weapon: rounds big, its name and rarity, the magazine's
//                 LED strip (blinks when low); tap it to swap
//
// Everything is transforms and opacity (no layout per frame).

import { RARITY_NAMES } from "../config";
import { RARITY_CSS } from "../world/gunsView";
import { el } from "./dom";
import { t } from "./i18n";

const R = 40;
const C = 2 * Math.PI * R;
/** Health takes 140° of the ring on the left, armour 100° on the right. */
const HP_SPAN = 140 / 360;
const AR_SPAN = 100 / 360;

const GUN_NAMES: Record<string, string> = { pistol: "Pistol", rifle: "Assault rifle", smg: "SMG", shotgun: "Shotgun" };

export interface CombatState {
  hp: number;
  hpMax: number;
  armour: number;
  armourMax: number;
  kind: string;
  rarity: number;
  mag: number;
  magMax: number;
  res: number;
  /** 0 … 1 while reloading, −1 otherwise. */
  reload: number;
  /** The crosshair's gap, px. */
  gap: number;
  ads: boolean;
  /** A primary carried (swap offered). */
  two: boolean;
  /** Dead Streets: the right arc is the torch's battery (amber), not armour. */
  torch?: boolean;
}

export class CombatHud {
  readonly root = el("div", "combat");
  private readonly ring: SVGSVGElement;
  private readonly hpArc: SVGCircleElement;
  private readonly arArc: SVGCircleElement;
  private readonly rlArc: SVGCircleElement;
  private readonly ticks: HTMLElement[] = [];
  private readonly hit: HTMLElement;
  private readonly dmg: HTMLElement;
  private readonly small: HTMLElement;
  readonly weapon: HTMLButtonElement;
  private readonly wN: HTMLElement;
  private readonly wName: HTMLElement;
  private readonly led: HTMLElement;
  private readonly kill: HTMLElement;
  private last = "";
  private hitTimer = 0;
  private dmgTimer = 0;
  private killTimer = 0;
  /** Tap the weapon panel: the other gun. */
  onSwap: (() => void) | null = null;

  constructor() {
    this.root.hidden = true;
    const ns = "http://www.w3.org/2000/svg";
    this.ring = document.createElementNS(ns, "svg");
    this.ring.setAttribute("viewBox", "-50 -50 100 100");
    this.ring.classList.add("c-ring");
    const arc = (cls: string) => {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("r", String(R));
      c.setAttribute("class", cls);
      this.ring.append(c);
      return c;
    };
    arc("c-track hp");
    arc("c-track ar");
    this.hpArc = arc("c-hp");
    this.arArc = arc("c-ar");
    this.rlArc = arc("c-rl");
    const xh = el("div", "c-xh");
    for (let k = 0; k < 4; k++) {
      const i = el("i", `t${k}`);
      this.ticks.push(i);
      xh.append(i);
    }
    xh.append(el("b", "c-dot"));
    this.hit = el("div", "c-hit");
    this.hit.innerHTML = "<i></i><i></i><i></i><i></i>";
    this.dmg = el("div", "c-dmg");
    this.small = el("div", "c-small");
    this.kill = el("div", "c-kill");
    this.weapon = el("button", "c-weapon") as HTMLButtonElement;
    this.weapon.dataset.ui = "1";
    this.weapon.setAttribute("aria-label", "Swap weapon");
    this.wN = el("div", "n");
    this.wName = el("div", "w");
    this.led = el("div", "led");
    this.weapon.append(this.wN, this.wName, this.led);
    this.weapon.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onSwap?.();
    });
    // The static parts of the arcs: their tracks (health left, armour right).
    const track = this.ring.querySelectorAll<SVGCircleElement>(".c-track");
    this.place(track[0], HP_SPAN, 1, 110);
    this.place(track[1], AR_SPAN, 1, -50);
    this.root.append(this.ring, xh, this.hit, this.dmg, this.small, this.kill, this.weapon);
  }

  /** An arc of `span` (a share of the circle) filled to `v`, starting at `fromDeg` (0 = right, clockwise). */
  private place(c: SVGCircleElement, span: number, v: number, fromDeg: number): void {
    const len = C * span * Math.max(0, Math.min(1, v));
    c.style.strokeDasharray = `${len} ${C}`;
    c.style.transform = `rotate(${fromDeg}deg)`;
  }

  show(on: boolean): void {
    this.root.hidden = !on;
  }

  update(s: CombatState): void {
    const hpV = s.hp / s.hpMax;
    // Health (the left arc) and armour (the right) both stand on the bottom and drain from the top.
    this.place(this.hpArc, HP_SPAN, hpV, 110);
    const arV = Math.max(0, Math.min(1, s.armour / s.armourMax));
    this.place(this.arArc, AR_SPAN, arV, 50 - 100 * arV);
    this.arArc.classList.toggle("torch", !!s.torch);
    this.hpArc.classList.toggle("low", hpV < 0.3);
    if (s.reload >= 0) this.place(this.rlArc, 1, s.reload, -90);
    this.rlArc.style.opacity = s.reload >= 0 ? "1" : "0";
    const gap = Math.max(3, Math.min(60, s.gap));
    this.ticks[0].style.transform = `translate(-50%, ${-gap - 7}px)`;
    this.ticks[1].style.transform = `translate(-50%, ${gap}px)`;
    this.ticks[2].style.transform = `translate(${-gap - 7}px, -50%)`;
    this.ticks[3].style.transform = `translate(${gap}px, -50%)`;
    this.root.classList.toggle("ads", s.ads);
    const key = `${s.kind}|${s.rarity}|${s.mag}|${s.res}|${s.magMax}|${s.two}|${s.reload >= 0}`;
    if (key === this.last) return;
    this.last = key;
    // No spare rounds to speak of (Dead Streets: just the rounds you have).
    this.small.textContent = s.res >= 0 ? `${s.mag} / ${s.res}` : `${s.mag}`;
    this.small.classList.toggle("low", s.mag <= Math.ceil(s.magMax * 0.2));
    this.wN.innerHTML = s.res >= 0 ? `${s.mag}<small> / ${s.res}</small>` : `${s.mag}`;
    this.wName.textContent = `${t(GUN_NAMES[s.kind] ?? s.kind).toUpperCase()} · ${t(RARITY_NAMES[s.rarity] ?? "Common").toUpperCase()}${s.two ? " ⇄" : ""}`;
    this.wName.style.color = RARITY_CSS[s.rarity] ?? "";
    const lit = s.magMax > 0 ? Math.ceil((s.mag / s.magMax) * 10) : 0;
    let led = "";
    for (let k = 0; k < 10; k++) led += `<i class="${k < lit ? "" : "o"}"></i>`;
    this.led.innerHTML = led;
    this.led.classList.toggle("low", lit <= 2);
    this.weapon.classList.toggle("reloading", s.reload >= 0);
  }

  /** Your shot landed. */
  hitMark(head: boolean, kill: boolean): void {
    const h = this.hit;
    h.classList.remove("on", "head", "kill");
    void h.offsetWidth;
    h.classList.add("on");
    if (kill) h.classList.add("kill");
    else if (head) h.classList.add("head");
    clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => h.classList.remove("on"), 260);
  }

  /** You were hit from `angle` (radians on screen: 0 ahead, + to the right). */
  hurt(angle: number): void {
    const d = this.dmg;
    d.style.transform = `rotate(${angle}rad)`;
    d.classList.remove("on");
    void d.offsetWidth;
    d.classList.add("on");
    clearTimeout(this.dmgTimer);
    this.dmgTimer = window.setTimeout(() => d.classList.remove("on"), 900);
  }

  /** You put someone out: a line under the crosshair. */
  killed(name: string, head: boolean): void {
    const k = this.kill;
    k.textContent = `${head ? t("Head shot") + " · " : ""}${t("Dropped")} ${name}`;
    k.classList.remove("on");
    void k.offsetWidth;
    k.classList.add("on");
    clearTimeout(this.killTimer);
    this.killTimer = window.setTimeout(() => k.classList.remove("on"), 1800);
  }
}
