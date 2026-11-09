// "How to play" (v5, the owner: real pictures, every mode described). The ?
// button and the Play screen open the guide: every mode you can see, and the
// basics. Before your first match of a mode: that mode's page, then the basics.
//
// The pictures in ui/howto/ are real shots of the game, taken by
// dev/howto-shots.mjs. Re-run it when a mode or a world changes. They only load
// when the guide opens, so they cost the lobby nothing.

import { familyOn, modeOn } from "../config";
import { BUILTIN_MANIFEST, type ModeDef } from "../content/modes";
import { el, esc } from "./dom";
import { t, translateTree } from "./i18n";
import { icon } from "./icons";

const PICS = import.meta.glob("./howto/*.webp", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const pic = (id: string): string => PICS[`./howto/${id}.webp`] ?? "";

interface Page {
  id: string;
  name: string;
  /** "6–12 players · 9 min · squads up to 4", from the mode itself. */
  meta?: string;
  /** What this is, in a sentence or two. */
  text: string;
  /** Mode pages: how the match is won. */
  win?: string;
  tips: string[];
}

interface Words {
  text: string;
  win: string;
  tips: string[];
}

export const MODE_WORDS: Record<string, Words> = {
  "treasure-hunt": {
    text: "Five treasures are hidden in chests all over the world, among many empty ones. Hold the interact button at a chest to open it. One upload machine stands in an open field: its light shows from across the map.",
    win: "Carry all 5 treasures to the machine and stay in its ring while they upload. If time runs out, the most treasures wins.",
    tips: [
      "Kill a carrier and everything they found drops where they fell: walk over it to take it.",
      "Die in the ring and you lose them all. Clear the area before you upload.",
      "In a squad, only your leader uploads. Walk up to them to hand over what you found, then protect them.",
      "Someone carrying all 5 is marked over their head from far away.",
    ],
  },
  "find-the-flag": {
    text: "One flag stands in the open, on a tall mast. It shows on your map and compass, and on everyone else's.",
    win: "Walk onto the flag to take it, then stay alive holding it for 10 seconds.",
    tips: ["Go down and you drop it where you fell.", "You come back 6 seconds after going down.", "A car gets you there before the runners."],
  },
  "hold-the-flag": {
    text: "One flag, the whole match. Whoever carries it runs a little slower and shows on everyone's map every 10 seconds.",
    win: "The most seconds holding the flag when the time runs out.",
    tips: ["With 9 or more players a second flag comes in.", "You don't need it for long: take it late and keep it.", "Stay near cover: everyone knows where you are."],
  },
  "steal-reposition": {
    text: "Four flags lie around the world and three drop zones glow on the map. Each zone lasts 60 seconds, then moves.",
    win: "The first to deliver 5 flags to a live drop zone.",
    tips: ["Check the map before you run: the zone may be gone when you arrive.", "Shoot the carrier and take the flag they drop."],
  },
  "squad-rally": {
    text: "Squads of four. A rally point drives slowly down the main roads, and the bigger your squad's share inside it, the more you score.",
    win: "The squad with the most score at the end. The last minute counts double.",
    tips: ["Stay together: a lone player scores little.", "Get ahead of the point and wait for it."],
  },
  hustle: {
    text: "Work job stations around the city for Owo: fetch water, wash, fix, carry parcels. What you carry isn't safe until it's in an Esusu box.",
    win: "The most Owo banked when the time runs out.",
    tips: ["Go down and half of what you carry spills: anyone can scoop it.", "Bank often. The leader shows on everyone's map."],
  },
  scarcity: {
    text: "Three flags for twelve players, and nobody comes back. The zone closes fast. At 6:00 a gate opens.",
    win: "Be the last one standing with a flag, or the first through the gate with one.",
    tips: ["Without a flag, your only job is to take one.", "A car is the safest way to reach the gate."],
  },
  "chase-reverse": {
    text: "One player starts as an Ojuju, a little faster than everyone else. Its touch turns humans into Ojuju too. At 3:00, two Reverse charms appear.",
    win: "Humans: be the last one human. Ojuju: turn everyone.",
    tips: ["A Reverse charm turns an Ojuju back into a human.", "Cars outrun any Ojuju until the fuel runs out."],
  },
  "compound-wars": {
    text: "A walled compound with eight rooms, worth 1 to 5 points. Hold a room with its door shut and it pays your squad every second.",
    win: "The most points when the time runs out.",
    tips: ["The two best rooms are locked: find a key.", "Hold inside at a door to jam it shut for 20 seconds.", "The fuse box darkens a room for 20 seconds."],
  },
  "riddles-elders": {
    text: "A riddle names a place in the city. Run there and take its kola-nut token. Some tokens are decoys.",
    win: "The first to bring 3 right tokens back to the Elders' Bench.",
    tips: ["A wrong token costs you.", "A new riddle comes every 90 seconds."],
  },
  "lights-out": {
    text: "The power goes off every minute or so, and nobody comes back. Your lamp lights a cone in front of you.",
    win: "Keep a rival in your lamp for 1.5 seconds to find them. The last one unfound wins.",
    tips: ["Crouch in the dark: your glow shrinks.", "Stay away from running generators: they light you up."],
  },
  "max-royale": {
    text: "Up to 24 players on the whole big world, alone or in squads. Loot guns and armour as the zone closes five times. Nobody comes back.",
    win: "The last squad standing.",
    tips: ["Move before the circle does: being outside hurts slowly, but it never stops.", "Airfall crates hold the best loot. They also draw a crowd."],
  },
  "max-flag": {
    text: "Find the Flag for up to 24 players on the whole big world. The flag is on your map and compass.",
    win: "Walk onto the flag, then stay alive holding it for 15 seconds.",
    tips: ["You come back 8 seconds after going down.", "It's a long run: find a car."],
  },
  "flag-duel": {
    text: "A Lagos Life match for 2 to 4 players on the market, with optional stakes in Lagos Life game money. You confirm any stake on Lagos Life's own sheet.",
    win: "The first to take the flag and hold it for 10 seconds wins the pot.",
    tips: ["A dropped flag is anyone's.", "Every staked match plays the same."],
  },
  "dead-streets": {
    text: "On your own, at night, in a dead city. Cross 1.4 km of streets from the Motor Park of the Lost to the Broadcast Mast, past zombies and thirty obstacles.",
    win: "Reach the Mast and hold it while the gate grinds open. Faster runs earn better medals.",
    tips: ["Noise brings them: sprinting and shooting both count.", "Churches and mosques are safe and heal you.", "After 12:00 you start to bleed."],
  },
};

const BASICS: Page[] = [
  {
    id: "basics-move",
    name: "Moving",
    text: "Phone upright: one stick, under your thumb, walks and runs, and pushing it sideways turns the view as you go. Phone sideways: the left stick walks, and dragging the right side of the screen looks.",
    tips: ["Sprint, jump, crouch and go prone from the buttons.", "Left-handed? Settings, Controls: the stick moves to the other side.", "Turn your phone sideways, or tap Rotate, for the full view."],
  },
  {
    id: "basics-guns",
    name: "Guns",
    text: "Everyone starts with a pistol. Rifles, SMGs and shotguns lie around the world in six rarities, from Common to Mythic.",
    tips: ["Your gun fires by itself when a rival is in your sights. Prefer to do it yourself? Settings → Controls → Auto-shoot.", "Armour plates soak up hits. Health comes back after 6 quiet seconds.", "Up close, your fists and shoves still work."],
  },
  {
    id: "basics-zone",
    name: "The safe zone",
    text: "The circle shrinks during the match. Outside it you have 3.5 minutes. After that your health falls slowly, and the sky laser takes the last of it.",
    tips: ["The next circle shows on your map 30 seconds before it moves.", "Get back inside and the timer runs back down."],
  },
  {
    id: "basics-items",
    name: "Items and Airfall",
    text: "Walk onto a glowing item to take it: up to 10 fit in your backpack, and every one adds armour. A red flare means an Airfall crate is coming down with the best loot.",
    tips: [
      "Open a crate by holding the button for 3 seconds.",
      "Going down drops your bag for others to take.",
      "Titan Serum: each dose (up to 3) makes you look fiercer and take less from every shot. At 3 it takes twice the shots to drop you. Go down and you lose it all.",
      "Map Print: the whole map for 20 seconds, everyone named, everything hidden shown. One use a match.",
    ],
  },
  {
    id: "basics-cars",
    name: "Cars",
    text: "Walk up to a door to get in. Fast cars can't be seen by the sky. A tank lasts 30 seconds of driving, and fuel boys by the road top it up.",
    tips: ["Crash too much and it catches fire: get out before it blows.", "You can pull a driver out by holding at their door."],
  },
];

const players = (d: ModeDef): string => {
  const p = d.players;
  const n = p.min === p.max ? `${p.max}` : `${p.min}–${p.max}`;
  const sq = p.squad[1] > 1 ? ` · ${t(p.squad[0] === p.squad[1] ? "squads of" : "squads up to")} ${p.squad[1]}` : "";
  return p.max === 1 ? t("On your own") : `${n} ${t("players")}${sq}`;
};

function modePage(d: ModeDef): Page {
  const w = MODE_WORDS[d.id] ?? { text: d.blurb.en, win: "", tips: [] };
  return { id: d.id, name: d.name.en, meta: `${players(d)} · ${Math.round(d.time / 60)} min`, text: w.text, win: w.win, tips: w.tips };
}

const carsIn = (d: ModeDef | undefined) => !!d?.modules.vehicles;

/** A shown mode: on, its game on, not a test mode; the staked duel only where it can be played. */
function shown(d: ModeDef, staked: boolean): boolean {
  if (d.tags?.includes("dev") || !modeOn(d.id) || !familyOn(d.family)) return false;
  return staked || !d.tags?.includes("staked");
}

export class HowTo {
  readonly root = el("div", "fcards");
  /** Lagos Life hosts: the staked duel is in the guide too. */
  staked = false;
  private pages: Page[] = [];
  private at = 0;
  private done: (() => void) | null = null;
  private x0 = -1;

  constructor(parent: HTMLElement) {
    this.root.dataset.ui = "1";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "How to play");
    parent.append(this.root);
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-fc]");
      if (!b) return;
      const a = b.dataset.fc;
      if (a === "next") this.go(this.at + 1);
      else if (a === "prev") this.go(this.at - 1);
      else if (a === "close") this.close();
      else if (a === "hub") this.hub();
      else if (a === "dot") this.go(Number(b.dataset.i));
      else if (a === "open") this.browse(b.dataset.id ?? "");
    });
    // Swipe between pages.
    this.root.addEventListener("pointerdown", (e) => (this.x0 = e.clientX));
    this.root.addEventListener("pointerup", (e) => {
      if (this.x0 < 0 || !this.pages.length) return;
      const dx = e.clientX - this.x0;
      this.x0 = -1;
      if (Math.abs(dx) > 50) this.go(this.at + (dx < 0 ? 1 : -1));
    });
  }

  get open(): boolean {
    return this.root.classList.contains("visible");
  }

  /** The guide: every mode's picture and name, and the basics. */
  hub(): void {
    this.pages = [];
    this.done = null;
    this.root.classList.add("visible");
    const list = BUILTIN_MANIFEST.modes.filter((d) => shown(d, this.staked));
    const tile = (id: string, name: string, sub: string) =>
      `<button class="ht-tile" data-fc="open" data-id="${esc(id)}"><span class="ht-pic" style="background-image:url(${pic(id)})"></span><b>${esc(t(name))}</b><small>${esc(sub)}</small></button>`;
    this.root.innerHTML = `<div class="fcard glass ht-hub">
      <div class="fc-top"><span class="h">${esc(t("How to play"))}</span><button class="ibtn" data-fc="close" aria-label="Close">${icon("close", "", 16)}</button></div>
      <div class="ht-scroll">
        <div class="label">${esc(t("Game modes"))}</div>
        <div class="ht-grid">${list.map((d) => tile(d.id, d.name.en, players(d))).join("")}</div>
        <div class="label">${esc(t("The basics"))}</div>
        <div class="ht-grid">${BASICS.map((p) => tile(p.id, p.name, "")).join("")}</div>
      </div>
    </div>`;
    translateTree(this.root);
  }

  /** From the guide: a page, with Next and Back through the rest of its list. */
  private browse(id: string): void {
    const modes = BUILTIN_MANIFEST.modes.filter((d) => shown(d, this.staked)).map(modePage);
    const list = BASICS.some((b) => b.id === id) ? BASICS : modes;
    this.pages = list;
    this.go(Math.max(0, list.findIndex((p) => p.id === id)));
  }

  /** A mode's page and the basics; `then` runs when they're closed (or read through). */
  show(modeId: string, then: (() => void) | null = null): void {
    const d = BUILTIN_MANIFEST.modes.find((x) => x.id === modeId);
    this.pages = [...(d ? [modePage(d)] : []), ...BASICS.filter((b) => b.id !== "basics-cars" || carsIn(d))];
    this.done = then;
    this.root.classList.add("visible");
    this.go(0);
  }

  /** Closed without going on (Back). */
  cancel(): void {
    this.done = null;
    this.close();
  }

  close(): void {
    if (!this.open) return;
    this.root.classList.remove("visible");
    this.root.replaceChildren();
    const fn = this.done;
    this.done = null;
    fn?.();
  }

  private go(i: number): void {
    if (i >= this.pages.length) return this.close();
    this.at = Math.max(0, i);
    const p = this.pages[this.at];
    const last = this.at === this.pages.length - 1;
    const dots = this.pages.map((_, k) => `<button class="dot ${k === this.at ? "on" : ""}" data-fc="dot" data-i="${k}" aria-label="${k + 1}"></button>`).join("");
    const src = pic(p.id);
    this.root.innerHTML = `<div class="fcard glass">
      <div class="fc-top">${this.done ? `<span class="label">${this.at + 1}/${this.pages.length}</span>` : `<button class="ibtn" data-fc="hub" aria-label="${esc(t("All modes"))}">${icon("back", "", 16)}</button>`}<button class="ibtn" data-fc="close" aria-label="Close">${icon("close", "", 16)}</button></div>
      <div class="fc-art">${src ? `<img src="${src}" alt="" width="640" height="360">` : ""}</div>
      <b class="fc-title">${esc(t(p.name))}</b>
      ${p.meta ? `<span class="fc-meta">${esc(p.meta)}</span>` : ""}
      <div class="fc-body">
        <p class="fc-text">${esc(t(p.text))}</p>
        ${p.win ? `<p class="fc-win"><b>${esc(t("To win"))}</b> ${esc(t(p.win))}</p>` : ""}
        ${p.tips.length ? `<ul class="fc-tips">${p.tips.map((x) => `<li>${esc(t(x))}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="fc-nav"><button class="btn secondary" data-fc="prev" ${this.at ? "" : "disabled"} aria-label="${esc(t("Back"))}">${icon("back", "", 14)}</button><span class="dots">${dots}</span><button class="btn primary" data-fc="next">${last ? (this.done ? t("Play") : t("Got it")) : t("Next")}</button></div>
    </div>`;
    translateTree(this.root);
  }
}
