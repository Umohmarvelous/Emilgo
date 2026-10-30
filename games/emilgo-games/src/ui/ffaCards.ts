// Free For All's "How to play" (SPEC-V3 §12, Brief 2b): pictures and a line
// of text, card by card, drawn as SVG in code (a few KB, no image files).
// Shown from the Play screen and before your first match of each mode.
//
//   1  the goal: the mode's own (Find the Flag: 12 people, one hidden flag)
//   2  the zone: three circles closing, the outside red, the sky's beam
//   3  melee: Strike beats Grab, Grab beats Brace, Brace beats Strike;
//      slap, push, throw and trip
//   4  the Wobble: the meter fills, you fall, the flag drops
//   5  radio hints, items and Airfall
//   6  cars (modes with vehicles): get in, the sky can't see you fast, fuel
//      and the fuel boys, don't let it burn

import { BUILTIN_MANIFEST } from "../content/modes";
import { el, esc } from "./dom";
import { t, translateTree } from "./i18n";
import { icon } from "./icons";

interface Card {
  title: string;
  text: string;
  art: string;
}

const W = 320;
const H = 170;
const GOLD = "#ffc23a";
const RED = "#ff5a3a";
const LINE = "rgba(255,255,255,0.85)";

const svg = (body: string) => `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-hidden="true">${body}</svg>`;
/** A small standing figure at (x, y): head and body. */
const fig = (x: number, y: number, c = LINE, s = 1) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><circle cx="0" cy="-15" r="4" fill="${c}"/><path d="M0 -10v10M0 0l-4 9M0 0l4 9M0 -7l-5 5M0 -7l5 5" stroke="${c}" stroke-width="2" stroke-linecap="round" fill="none"/></g>`;
const flag = (x: number, y: number, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0v-26" stroke="#3a3530" stroke-width="2.4"/><path d="M0 -26h16l-4 6 4 6H0z" fill="${GOLD}" stroke="#000" stroke-width="0.8"/></g>`;
const label = (x: number, y: number, s: string, c = LINE, size = 11) => `<text x="${x}" y="${y}" fill="${c}" font-size="${size}" font-weight="700" text-anchor="middle" font-family="Montserrat, sans-serif">${esc(t(s))}</text>`;
/** A street block map: roads crossing on sand. */
const streets = `<rect x="20" y="12" width="280" height="146" rx="10" fill="#7a5a36" opacity="0.55"/><path d="M20 80h280M140 12v146M230 12v146M60 12v146" stroke="#b8956a" stroke-width="9" opacity="0.6"/>`;

const GOALS: Record<string, { title: string; text: string; art: () => string }> = {
  "find-the-flag": {
    title: "The goal",
    text: "Find it. Claim it: hold it for 10 s. Everyone will come for you.",
    art: () => {
      let people = "";
      for (let i = 0; i < 12; i++) people += fig(40 + (i % 6) * 48, 52 + Math.floor(i / 6) * 74 + (i % 2) * 10, i === 0 ? GOLD : LINE, 0.8);
      return svg(`${streets}${people}<circle cx="186" cy="86" r="16" fill="#000" opacity="0.45"/>${label(186, 92, "?", GOLD, 20)}`);
    },
  },
  "flag-duel": {
    title: "The Flag Duel",
    text: "Staked: the first to find the hidden flag and hold it for 10 s wins the pot. Melee, the zone and items are on.",
    art: () => svg(`${streets}${fig(70, 110, GOLD)}${fig(250, 110)}<circle cx="160" cy="70" r="16" fill="#000" opacity="0.45"/>${label(160, 76, "?", GOLD, 20)}${label(160, 150, "10 s", GOLD, 14)}`),
  },
  "hold-the-flag": {
    title: "The goal",
    text: "Most seconds holding the flag wins. The holder is slower and pings on everyone's map.",
    art: () =>
      svg(`${streets}${fig(160, 104, GOLD, 1.3)}${flag(168, 86, 1.2)}<circle cx="160" cy="92" r="40" fill="none" stroke="${RED}" stroke-width="2" stroke-dasharray="5 4"/>${fig(80, 120)}${fig(240, 70)}${fig(250, 130)}${label(160, 30, "+1 every second", GOLD)}`),
  },
  "steal-reposition": {
    title: "The goal",
    text: "Carry flags into a live drop zone. First to 5 deliveries wins. Zones move every minute.",
    art: () =>
      svg(`${streets}${fig(80, 110, GOLD)}${flag(88, 92)}<path d="M100 96 Q170 40 232 76" stroke="${GOLD}" stroke-width="2" fill="none" stroke-dasharray="4 4"/><ellipse cx="240" cy="96" rx="34" ry="12" fill="none" stroke="#ffd36a" stroke-width="3"/>${label(240, 130, "Drop zone", "#ffd36a")}${label(80, 150, "5 to win", GOLD)}`),
  },
  "squad-rally": {
    title: "The goal",
    text: "Squads of four. Keep yours inside the rally point as it drives down the main roads. The last minute counts double.",
    art: () =>
      svg(`${streets}<circle cx="160" cy="84" r="44" fill="#38b6ff" opacity="0.18" stroke="#38b6ff" stroke-width="2"/>${fig(140, 96, GOLD)}${fig(160, 86, GOLD)}${fig(178, 100, GOLD)}${fig(150, 112, LINE)}${fig(250, 110)}<path d="M206 84h50" stroke="#38b6ff" stroke-width="2" marker-end="url(#a)"/><defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0l10 5-10 5z" fill="#38b6ff"/></marker></defs>`),
  },
  scarcity: {
    title: "The goal",
    text: "Three flags for twelve. The last standing with a flag wins, or the first through the gate with one once it opens. No respawns.",
    art: () => svg(`${streets}${flag(90, 100)}${flag(160, 70)}${flag(230, 110)}<rect x="262" y="30" width="26" height="40" fill="none" stroke="#59d98e" stroke-width="3"/>${label(275, 86, "Gate", "#59d98e")}${label(160, 150, "3 flags · 12 people", GOLD)}`),
  },
};

const SHARED: Card[] = [
  {
    title: "The zone",
    text: "The circle closes in three steps. Outside it the meter fills, and the sky hunts you.",
    art: svg(
      `<rect x="0" y="0" width="${W}" height="${H}" fill="${RED}" opacity="0.18"/><circle cx="160" cy="88" r="74" fill="#1a1410" stroke="${LINE}" stroke-width="2"/><circle cx="174" cy="92" r="46" fill="none" stroke="${LINE}" stroke-width="1.5" stroke-dasharray="5 4"/><circle cx="184" cy="98" r="22" fill="none" stroke="${LINE}" stroke-width="1.5" stroke-dasharray="3 3"/>${label(96, 52, "1")}${label(150, 72, "2")}${label(184, 102, "3")}${fig(276, 124, RED)}<path d="M286 0 L278 112" stroke="#fff3d6" stroke-width="5" opacity="0.9"/><rect x="236" y="148" width="70" height="7" rx="3" fill="#000" opacity="0.5"/><rect x="236" y="148" width="52" height="7" rx="3" fill="${RED}"/>`,
    ),
  },
  {
    title: "Melee",
    text: "Strike beats Grab. Grab beats Brace. Brace beats Strike. Hold someone and finish: Throw, Trip or Drag.",
    art: svg(
      `${label(160, 22, "Strike", GOLD, 13)}${label(160, 116, "an arrow: beats", LINE, 8)}${label(70, 104, "Brace", "#bfe3ff", 13)}${label(250, 104, "Grab", "#ff9a7a", 13)}<path d="M172 30 L236 88" stroke="${GOLD}" stroke-width="2" marker-end="url(#m)"/><path d="M222 100 H98" stroke="#ff9a7a" stroke-width="2" marker-end="url(#m)"/><path d="M84 88 L148 30" stroke="#bfe3ff" stroke-width="2" marker-end="url(#m)"/><defs><marker id="m" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0l10 5-10 5z" fill="${LINE}"/></marker></defs>` +
        ["slap", "push", "throw", "trip"].map((k, i) => `<g transform="translate(${44 + i * 70} 124)" color="#fff"><rect x="-26" y="-4" width="52" height="42" rx="8" fill="#000" opacity="0.35"/><g transform="translate(-11 0)">${icon(k, "", 22).replace("<svg", '<svg x="0" y="0"')}</g>${label(0, 33, k[0].toUpperCase() + k.slice(1), LINE, 9)}</g>`).join(""),
    ),
  },
  {
    title: "The Wobble",
    text: "No health. Hits fill your Wobble. Full, you fall, and whatever is in your hands drops. Lose your balance, lose the flag.",
    art: svg(
      `${fig(80, 110, LINE, 1.4)}${flag(92, 86, 1.1)}<rect x="56" y="40" width="50" height="7" rx="3" fill="#000" opacity="0.5"/><rect x="56" y="40" width="22" height="7" rx="3" fill="#ffe08a"/><path d="M128 90h40" stroke="${LINE}" stroke-width="2" marker-end="url(#w)"/><defs><marker id="w" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0l10 5-10 5z" fill="${LINE}"/></marker></defs><rect x="196" y="40" width="50" height="7" rx="3" fill="${RED}"/><g transform="translate(222 124) rotate(-80)">${fig(0, 0, LINE, 1.4)}</g>${flag(268, 128, 0.9)}${label(222, 160, "Dazed", RED)}`,
    ),
  },
  {
    title: "Hints, items and Airfall",
    text: "The radio narrows the flag to a district. Pick up items for your backpack. Airfall drops better ones under a red flare.",
    art: svg(
      `<g transform="translate(30 30)" color="${GOLD}">${icon("signal", "", 28)}</g><circle cx="110" cy="70" r="46" fill="none" stroke="${GOLD}" stroke-dasharray="4 3" opacity="0.5"/><circle cx="120" cy="76" r="26" fill="${GOLD}" opacity="0.15" stroke="${GOLD}" stroke-dasharray="4 3"/>` +
        ["kola", "zobo", "umbrella", "bundle"].map((k, i) => `<g transform="translate(${44 + i * 40} 132)" color="#fff">${icon(k, "", 22)}</g>`).join("") +
        `<path d="M250 0v86" stroke="${RED}" stroke-width="4" opacity="0.6"/><path d="M222 54 Q250 22 278 54 Z" fill="#e0662a" stroke="#000" stroke-width="0.6"/><path d="M236 54 Q250 30 264 54" fill="#1d4f9a"/><path d="M226 54 L244 92 M274 54 L256 92" stroke="#3a3530"/><rect x="238" y="88" width="24" height="20" fill="#8a6238" stroke="#000" stroke-width="0.6"/>`,
    ),
  },
];

/** Card 6: a danfo, invisible to the sky at speed, the fuel boy, the fire. */
const CARS: Card = {
  title: "Cars",
  text: "Get in at a door: drive or ride. Fast, the sky can't see you. 30 s of fuel; fuel boys by the road top it up. Hit things and it burns, then blows: get out.",
  art: svg(
    `${streets}<g transform="translate(150 70) rotate(-90)"><rect x="-12" y="-28" width="24" height="56" rx="4" fill="#f5bd02" stroke="#000" stroke-width="1"/><rect x="-12" y="-4" width="24" height="3" fill="#151515"/><rect x="-10" y="12" width="20" height="8" fill="#26323a"/></g><path d="M196 70h40" stroke="${LINE}" stroke-width="2" stroke-dasharray="4 4"/><path d="M128 0 L140 56" stroke="#fff3d6" stroke-width="4" opacity="0.35"/><path d="M128 58l8 -10M144 58l-8 -10" stroke="${RED}" stroke-width="2.5"/>${label(150, 104, "Fast: hidden", GOLD, 10)}` +
      `<rect x="232" y="118" width="18" height="12" fill="#8d6e63"/><rect x="236" y="108" width="8" height="10" fill="#f9c80e" stroke="#000" stroke-width="0.6"/>${fig(258, 132, LINE, 0.8)}${label(246, 152, "+10 s", GOLD, 10)}` +
      `<g transform="translate(64 134)"><rect x="-22" y="-10" width="44" height="18" rx="3" fill="#8a7d74"/><path d="M-8 -10 q4 -16 0 -26 M6 -10 q6 -14 0 -22" stroke="#ff8a1a" stroke-width="4" fill="none"/></g>${label(64, 160, "GET OUT", RED, 10)}`,
  ),
};

/** The cards for a mode: its own goal first, then the shared four; cars last in a mode with them. */
export function cardsFor(modeId: string): Card[] {
  const g = GOALS[modeId] ?? GOALS["find-the-flag"];
  const def = BUILTIN_MANIFEST.modes.find((d) => d.id === modeId);
  return [{ title: g.title, text: g.text, art: g.art() }, ...SHARED, ...(def?.modules.vehicles ? [CARS] : [])];
}

export class FfaCards {
  readonly root = el("div", "fcards");
  private cards: Card[] = [];
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
      else if (a === "dot") this.go(Number(b.dataset.i));
    });
    // Swipe between cards.
    this.root.addEventListener("pointerdown", (e) => (this.x0 = e.clientX));
    this.root.addEventListener("pointerup", (e) => {
      if (this.x0 < 0) return;
      const dx = e.clientX - this.x0;
      this.x0 = -1;
      if (Math.abs(dx) > 50) this.go(this.at + (dx < 0 ? 1 : -1));
    });
  }

  get open(): boolean {
    return this.root.classList.contains("visible");
  }

  /** Show a mode's cards; `then` runs when they're closed (or played through). */
  show(modeId: string, modeName: string, then: (() => void) | null = null): void {
    this.cards = cardsFor(modeId);
    this.done = then;
    this.root.dataset.mode = modeName;
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
    const fn = this.done;
    this.done = null;
    fn?.();
  }

  private go(i: number): void {
    if (i >= this.cards.length) return this.close();
    this.at = Math.max(0, i);
    const c = this.cards[this.at];
    const last = this.at === this.cards.length - 1;
    const dots = this.cards.map((_, k) => `<button class="dot ${k === this.at ? "on" : ""}" data-fc="dot" data-i="${k}" aria-label="Card ${k + 1}"></button>`).join("");
    this.root.innerHTML = `<div class="fcard glass">
      <div class="fc-top"><span class="label">${esc(this.root.dataset.mode ?? "")} · ${this.at + 1}/${this.cards.length}</span><button class="ibtn" data-fc="close" aria-label="Close">${icon("close", "", 16)}</button></div>
      <div class="fc-art">${c.art}</div>
      <b class="fc-title">${esc(t(c.title))}</b>
      <p class="fc-text">${esc(t(c.text))}</p>
      <div class="fc-nav"><button class="btn secondary" data-fc="prev" ${this.at ? "" : "disabled"}>${icon("back", "", 14)}</button><span class="dots">${dots}</span><button class="btn primary" data-fc="next">${last ? (this.done ? t("Play") : t("Got it")) : t("Next")}</button></div>
    </div>`;
    translateTree(this.root);
  }
}
