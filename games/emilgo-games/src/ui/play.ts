// The open worlds' HUD (SPEC-V3 §3.3, §7, Phase 3), over the shared one
// (hud.ts): what the zone, items and Airfall need on screen. Same language as
// the rest: small type, white with a dark outline, glass only on buttons.
//
//   top right, under the map   the zone: when it closes, or that it's closing
//   top centre, under the feed the exposure meter (outside the zone only)
//   centre right               interact: pick up / take from the bag / hold to
//                              open, with the hold's ring
//   top right                  the backpack button; it opens a radial of the
//                              slots round the middle of the screen (the game
//                              goes on: it never pauses). Tap a slot, then Use
//                              or Drop.
//   bottom centre              what's working on you now (Kola Rush 7 s …)
//   the whole screen           a warm tint outside the zone, a heat flash when
//                              the laser hits near you; out: when you're back

import { ITEM_DEFS, type ItemId } from "../content/items";
import { el, fmtTime } from "./dom";
import { getLang, t } from "./i18n";
import { icon } from "./icons";
import { VEHICLES } from "../config";

export interface PlayHudState {
  /** The zone: seconds until the next circle starts closing (−1: none coming), closing now. */
  zone: { closesIn: number; closing: boolean; final: boolean } | null;
  /** 0 … 1; outside the circle; the laser coming down. */
  exposure: number;
  outside: boolean;
  doomed: boolean;
  /** The open world's zone: seconds left before it starts to hurt. */
  graceLeft?: number;
  pack: readonly (ItemId | null)[];
  /** What interact would do now (Free For All adds: search a stash spot, pick up a street prop, named in `label`). */
  target: { kind: "item" | "bag" | "crate" | "stash" | "prop" | "car" | "job"; item?: ItemId; left?: number; label?: string; progress: number } | null;
  effects: readonly { key: string; left: number }[];
  /** Out: seconds until back (−1: not coming back); alive: −2. */
  respawn: number;
  /** 0 … 1: a laser just hit close by. */
  heat: number;
  /** Free For All: the mode's objective in a line ("Hold it: 6 s"), or "". */
  objective?: string;
  /**
   * In a car (vehicles): its tank (0 … 1), how bad it is (0 clean … 3 on
   * fire), seconds until it blows (−1: it isn't burning), someone pulling
   * the driver out, the radio's station.
   */
  car?: { fuel: number; state: number; blowIn: number; hijack: boolean; radio: string } | null;
  /** Inside a Smoke Pot's cloud: the screen greys (Phase 6). */
  smoke?: boolean;
  /** Riddles of the Elders: the newest riddle you haven't solved (its language, then English beneath), and your count. */
  riddle?: { text: string; en: string; solved: number; need: number } | null;
}

/** An item's icon. */
export const ITEM_ICON: Record<ItemId, string> = {
  kola: "kola", zobo: "zobo", "big-bag": "bigbag", "zone-shield": "umbrella", "pepper-soup": "bundle", "iron-wrapper": "bundle",
  "smoke-pot": "fog", "banana-peel": "trip", "pepper-powder": "fire", megaphone: "horn", slipper: "bundle", "decoy-flag": "flag",
  "talking-drum": "signal", "aso-ebi": "outfit", "golden-slipper": "bundle", jerrycan: "fuel", "danfo-key": "car",
  zanku: "dance", shaku: "fire", odogwu: "crown", breakdance: "dance",
  bandage: "heal", medkit: "heal", ammo: "ammo", armour: "brace", battery: "bolt", nv: "eye",
};

export function itemName(k: ItemId): string {
  const n = ITEM_DEFS[k].name;
  return getLang() === "pcm" && n.pcm ? n.pcm : n.en;
}

function itemWhat(k: ItemId): string {
  const w = ITEM_DEFS[k].what;
  return getLang() === "pcm" && w.pcm ? w.pcm : w.en;
}

const EFFECT_NAME: Record<string, { item: ItemId; label: string }> = {
  speed: { item: "kola", label: "Adrenaline Shot" },
  shield: { item: "zone-shield", label: "Zone Shield" },
  bait: { item: "zanku", label: "Wobble Bait" },
  shaku: { item: "shaku", label: "Shuffle Shield" },
  pose: { item: "odogwu", label: "Hero Pose" },
};

export class PlayHud {
  readonly root = el("div", "playhud");
  /** What the last update showed (HUD A's watch and heat edge read it). */
  state: PlayHudState | null = null;
  /** Interact pressed (true) and released (false). */
  onInteract: (down: boolean) => void = () => {};
  onUse: (slot: number) => void = () => {};
  onDrop: (slot: number) => void = () => {};
  /** The backpack opened or closed (the page stops steering while it's open, if it likes). */
  onPack: (open: boolean) => void = () => {};

  private readonly zoneLine = el("div", "pzone");
  private readonly obj = el("div", "pobj");
  private readonly expo = el("div", "pexpo");
  private readonly expoFill = el("i");
  private readonly expoText = el("span");
  readonly act = el("button", "pint glass");
  private readonly actRing = el("i", "ring");
  private readonly actText = el("span");
  readonly packBtn = el("button", "ppack ibtn glass");
  private readonly packCount = el("b", "dot-badge");
  private readonly radial = el("div", "pradial");
  private readonly wheel = el("div", "pwheel");
  private readonly centre = el("div", "centre");
  private readonly fx = el("div", "pfx");
  private readonly tint = el("div", "ptint");
  private readonly smoke = el("div", "psmoke");
  private readonly riddle = el("div", "priddle glass");
  private lastRiddle = "";
  private readonly heat = el("div", "pheat");
  private readonly dead = el("div", "pdead");
  /** In a car: the tank, its state, the warnings. */
  private readonly car = el("div", "pcar");
  private readonly carFuel = el("i");
  private readonly carText = el("span");
  private readonly carWarn = el("div", "pwarn");
  private lastCar = "";
  private slots: HTMLButtonElement[] = [];
  private picked = -1;
  private lastPack = "";
  private lastZone = "";
  private lastTarget = "";
  private lastFx = "";
  private lastDead = "";
  private lastObj = "";
  private holding = false;
  private pack: readonly (ItemId | null)[] = [];

  constructor() {
    this.root.dataset.ui = "1";
    this.zoneLine.innerHTML = "";
    this.expo.append(this.expoFill, this.expoText);
    this.act.append(this.actRing, this.actText);
    this.act.dataset.ui = "1";
    this.packBtn.innerHTML = icon("pack", "", 18);
    this.packBtn.dataset.ctl = "pack";
    this.act.dataset.ctl = "interact";
    this.packBtn.append(this.packCount);
    this.packBtn.dataset.ui = "1";
    this.packBtn.setAttribute("aria-label", "Backpack");
    this.radial.append(this.wheel, this.centre);
    this.radial.dataset.ui = "1";
    this.radial.setAttribute("role", "dialog");
    this.radial.setAttribute("aria-label", "Backpack");
    this.car.innerHTML = `${icon("fuel", "", 14)}<b class="tank"></b>`;
    this.car.querySelector(".tank")!.append(this.carFuel);
    this.car.append(this.carText);
    this.root.append(this.smoke, this.riddle, this.tint, this.heat, this.zoneLine, this.obj, this.expo, this.car, this.carWarn, this.act, this.packBtn, this.fx, this.dead, this.radial);

    // Interact: a tap picks up; holding opens a crate.
    const down = (e: Event) => {
      e.preventDefault();
      if (this.holding) return;
      this.holding = true;
      this.act.classList.add("down");
      this.onInteract(true);
    };
    const up = () => {
      if (!this.holding) return;
      this.holding = false;
      this.act.classList.remove("down");
      this.onInteract(false);
    };
    this.act.addEventListener("pointerdown", down);
    this.act.addEventListener("pointerup", up);
    this.act.addEventListener("pointercancel", up);
    this.act.addEventListener("pointerleave", up);
    this.packBtn.addEventListener("click", () => this.openPack(!this.radial.classList.contains("visible")));
    this.radial.addEventListener("click", (e) => {
      if (e.target === this.radial) this.openPack(false);
    });
  }

  get packOpen(): boolean {
    return this.radial.classList.contains("visible");
  }

  openPack(on: boolean): void {
    if (on === this.packOpen) return;
    this.radial.classList.toggle("visible", on);
    if (on) {
      this.picked = this.pack.findIndex((k) => k !== null);
      this.lastPack = "";
      this.drawPack();
    }
    this.onPack(on);
  }

  /** Keyboard: slot n (0-based) picked in the open backpack; or straight used when closed. */
  key(slot: number, drop: boolean): void {
    if (slot < 0 || slot >= this.pack.length || !this.pack[slot]) return;
    if (drop) this.onDrop(slot);
    else this.onUse(slot);
  }

  update(s: PlayHudState): void {
    this.state = s;
    this.smoke.classList.toggle("visible", !!s.smoke);
    const r = s.respawn === -2 ? (s.riddle ?? null) : null;
    const rs = r ? `${r.text}|${r.en}|${r.solved}/${r.need}` : "";
    if (rs !== this.lastRiddle) {
      this.lastRiddle = rs;
      this.riddle.classList.toggle("visible", !!r);
      if (r) {
        this.riddle.innerHTML = "";
        const head = el("b");
        head.textContent = `${t("The Elders ask")} · ${r.solved}/${r.need}`;
        const main = el("span");
        main.textContent = r.text;
        const en = el("small");
        en.textContent = r.en;
        this.riddle.append(head, main, ...(r.en && r.en !== r.text ? [en] : []));
      }
    }
    // ── Your car ──
    const c = s.respawn === -2 ? (s.car ?? null) : null;
    this.car.classList.toggle("visible", !!c);
    if (c) {
      this.carFuel.style.transform = `scaleX(${Math.max(0, Math.min(1, c.fuel)).toFixed(3)})`;
      this.car.classList.toggle("low", c.fuel <= 0.2);
    }
    const state = c ? ["", t("Scratched"), t("Smoking"), t("On fire")][Math.min(3, c.state)] : "";
    const words = c ? [state, c.radio].filter(Boolean).join(" · ") : "";
    const warn = !c ? "" : c.blowIn >= 0 && c.blowIn <= VEHICLES.damage.warn ? t("GET OUT") : c.hijack ? t("They're pulling you out: slap!") : "";
    const carSig = `${words}|${warn}`;
    if (carSig !== this.lastCar) {
      this.lastCar = carSig;
      this.carText.textContent = words;
      this.carWarn.textContent = warn;
      this.carWarn.classList.toggle("visible", !!warn);
    }

    // ── The zone ──
    let zl = "";
    if (s.zone) {
      if (s.zone.closing) zl = `${t("Zone closing")}`;
      else if (s.zone.closesIn >= 0) zl = `${t("Zone closes in")} ${fmtTime(s.zone.closesIn)}`;
      else if (s.zone.final) zl = t("Final circle");
    }
    if (zl !== this.lastZone) {
      this.lastZone = zl;
      this.zoneLine.innerHTML = zl ? `${icon("zone", "", 12)}<span>${zl}</span>` : "";
      this.zoneLine.classList.toggle("closing", !!s.zone?.closing);
    }

    // ── The objective ──
    const ob = s.respawn === -2 || s.objective ? (s.objective ?? "") : "";
    if (ob !== this.lastObj) {
      this.lastObj = ob;
      this.obj.textContent = ob;
    }

    // ── Exposure ──
    const showExpo = s.outside || s.exposure > 0.01 || s.doomed;
    this.expo.classList.toggle("visible", showExpo && s.respawn === -2);
    this.expo.classList.toggle("hot", s.exposure > 0.7 || s.doomed);
    this.expoFill.style.transform = `scaleX(${Math.min(1, s.exposure).toFixed(3)})`;
    const et = s.doomed ? t("The sky has seen you") : !s.outside ? t("Back in the zone") : s.graceLeft === undefined ? t("Outside the zone") : s.graceLeft > 0 ? `${t("Outside the zone")} · ${fmtTime(s.graceLeft)}` : t("Outside the zone: losing health");
    if (this.expoText.textContent !== et) this.expoText.textContent = et;
    this.tint.style.opacity = s.respawn !== -2 ? "0" : s.outside ? (0.35 + 0.55 * s.exposure).toFixed(2) : (0.5 * s.exposure).toFixed(2);
    this.heat.style.opacity = s.heat.toFixed(2);

    // ── Interact ──
    let tl = "";
    if (s.target && s.respawn === -2) {
      if (s.target.kind === "crate") tl = `crate:${t("Hold to open")}`;
      else if (s.target.kind === "stash") tl = `stash:${t("Search")}`;
      else if (s.target.kind === "prop") tl = `prop:${t("Pick up")} · ${s.target.label ?? ""}`;
      else if (s.target.kind === "bag") tl = `bag:${t("Take from the bag")}`;
      else if (s.target.kind === "car") tl = `car:${s.target.label ?? ""}`;
      else if (s.target.kind === "job") tl = `job:${s.target.label ?? ""}`;
      else tl = `item:${t("Pick up")} · ${itemName(s.target.item!)}:${s.target.item}`;
    }
    if (tl !== this.lastTarget) {
      this.lastTarget = tl;
      this.act.classList.toggle("visible", !!tl);
      if (tl) {
        // kind:label (a label may hold a colon), or item:label:id.
        const cut = tl.indexOf(":");
        const kind = tl.slice(0, cut);
        const rest = tl.slice(cut + 1);
        const last = kind === "item" ? rest.lastIndexOf(":") : -1;
        const label = last >= 0 ? rest.slice(0, last) : rest;
        const item = last >= 0 ? rest.slice(last + 1) : "";
        const ico = kind === "crate" ? "crate" : kind === "bag" || kind === "prop" ? "bundle" : kind === "stash" ? "search" : kind === "car" ? "car" : kind === "job" ? "hand" : ITEM_ICON[item as ItemId];
        this.act.querySelector("svg")?.remove();
        this.act.insertAdjacentHTML("afterbegin", icon(ico, "", 18));
        this.actText.textContent = label;
        this.act.setAttribute("aria-label", label);
      }
    }
    const p = s.target?.progress ?? 0;
    this.actRing.style.setProperty("--p", `${Math.round(p * 360)}deg`);
    this.actRing.style.opacity = p > 0 ? "1" : "0";

    // ── The backpack ──
    this.pack = s.pack;
    const n = s.pack.filter((k) => k).length;
    const sig = s.pack.join(",");
    if (sig !== this.lastPack) {
      this.lastPack = sig;
      this.packCount.textContent = n ? String(n) : "";
      this.packCount.hidden = !n;
      if (this.packOpen) {
        if (this.picked < 0 || !s.pack[this.picked]) this.picked = s.pack.findIndex((k) => k !== null);
        this.drawPack();
      }
    }

    // ── Effects ──
    const fx = s.effects.filter((e) => EFFECT_NAME[e.key]).map((e) => `${e.key}:${Math.ceil(e.left)}`).join(",");
    if (fx !== this.lastFx) {
      this.lastFx = fx;
      this.fx.replaceChildren(
        ...s.effects
          .filter((e) => EFFECT_NAME[e.key])
          .map((e) => {
            const chip = el("span", "chip");
            chip.innerHTML = `${icon(ITEM_ICON[EFFECT_NAME[e.key].item], "", 12)}<span>${t(EFFECT_NAME[e.key].label)}</span><b>${Math.ceil(e.left)}</b>`;
            return chip;
          }),
      );
    }

    // ── Out, and coming back ──
    const dl = s.respawn === -2 ? "" : s.respawn < 0 ? t("Out") : `${t("Back in")} ${Math.ceil(s.respawn)}`;
    if (dl !== this.lastDead) {
      this.lastDead = dl;
      this.dead.textContent = dl;
      this.dead.classList.toggle("visible", !!dl);
      if (dl) this.openPack(false);
    }
  }

  private drawPack(): void {
    const pack = this.pack;
    const n = pack.length;
    if (this.slots.length !== n) {
      this.wheel.replaceChildren();
      this.slots = [];
      for (let i = 0; i < n; i++) {
        const b = el("button", "slot") as HTMLButtonElement;
        b.dataset.ui = "1";
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        b.style.setProperty("--x", Math.cos(a).toFixed(3));
        b.style.setProperty("--y", Math.sin(a).toFixed(3));
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!this.pack[i]) return;
          this.picked = i;
          this.drawPack();
        });
        this.wheel.append(b);
        this.slots.push(b);
      }
    }
    pack.forEach((k, i) => {
      const b = this.slots[i];
      b.classList.toggle("empty", !k);
      b.classList.toggle("on", i === this.picked && !!k);
      b.innerHTML = k ? `${icon(ITEM_ICON[k], "", 20)}<i>${i < 9 ? i + 1 : i === 9 ? 0 : ""}</i>` : "";
      b.setAttribute("aria-label", k ? itemName(k) : t("Empty"));
    });
    const k = this.picked >= 0 ? pack[this.picked] : null;
    this.centre.replaceChildren();
    if (!k) {
      this.centre.append(el("span", "nm", t(pack.some((x) => x) ? "Pick an item" : "Your backpack is empty")));
      return;
    }
    const use = el("button", "btn primary", t("Use")) as HTMLButtonElement;
    const drop = el("button", "btn secondary", t("Drop")) as HTMLButtonElement;
    use.disabled = !ITEM_DEFS[k].effect;
    use.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onUse(this.picked);
    });
    drop.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onDrop(this.picked);
    });
    const row = el("div", "row");
    row.append(use, drop);
    this.centre.append(el("b", "nm", itemName(k)), el("span", "what", itemWhat(k)), row);
  }
}
