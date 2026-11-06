// The rotate-phone prompt (SPEC-V2 §6.5). Lagos Life's frame forbids
// fullscreen and orientation lock, so the game turns itself: tapping the
// prompt (or the Settings switch) rotates the whole game 90° on screen, and a
// portrait phone with rotation lock on plays in landscape.
//
// Everything else follows from three things done here:
//   - the canvas and the UI layer are turned and sized to the swapped screen;
//   - the stylesheet's orientation and width/height media queries are swapped,
//     and its vw/vh (the --vw1 / --vh1 tokens) follow the game, not the glass;
//   - toGame() turns a touch's screen point into the game's own (controls).
//
// The prompt (v5, the owner): in the middle of the screen, in the lobby and in a
// match, up to five times, ten seconds apart, then it's gone. Turning the phone
// or tapping it ends it at once. A menu open over the game holds it back: the
// next showing waits, and no showing is used up.

import { el } from "./dom";
import { icon } from "./icons";

let rotated = false;

/** Is the game turned on its side? */
export function isRotated(): boolean {
  return rotated;
}

/** The game's own size in CSS px (the screen's, swapped while rotated). */
export function gameSize(): { w: number; h: number } {
  const w = window.innerWidth || 375;
  const h = window.innerHeight || 812;
  return rotated ? { w: h, h: w } : { w, h };
}

/** A screen point (a touch's clientX/Y) in the game's coordinates. */
export function toGame(x: number, y: number): { x: number; y: number } {
  if (!rotated) return { x, y };
  // The game is turned 90° clockwise: its top edge runs down the screen's right side.
  return { x: y, y: (window.innerWidth || 375) - x };
}

/** One showing, the gap between two showings, and how many showings a run of the prompt has. */
const SHOW_MS = 3500;
const GAP_MS = 10_000;
const TIMES = 5;

export class Rotator {
  readonly button = el("button", "rotate-hint glass");
  onTap: () => void = () => {};
  /** May the prompt show now? (Not over a menu.) */
  canShow: () => boolean = () => true;
  private timer = 0;
  private left = 0;
  private readonly media = new WeakMap<CSSMediaRule, string>();

  constructor(
    private readonly ui: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly onResize: () => void,
  ) {
    this.button.dataset.ui = "1";
    this.button.setAttribute("aria-label", "Rotate the game");
    this.button.innerHTML = `${icon("rotate", "rot-anim", 22)}<span>Tap to rotate</span>`;
    this.button.addEventListener("click", () => {
      this.hide();
      this.onTap();
    });
    ui.append(this.button);
    window.addEventListener("resize", () => {
      this.layout();
      if (gameSize().w >= gameSize().h) this.hide(); // turned to landscape: nothing left to ask
    });
  }

  /** Start the prompt's run (the game starting, a match starting), if the game is in portrait. */
  prompt(): void {
    this.left = TIMES;
    this.next();
  }

  private next(): void {
    this.clear();
    const { w, h } = gameSize();
    if (w >= h) this.left = 0;
    if (this.left <= 0) return;
    if (!this.canShow()) {
      this.timer = window.setTimeout(() => this.next(), GAP_MS);
      return;
    }
    this.left--;
    this.button.classList.add("visible");
    this.timer = window.setTimeout(() => {
      this.button.classList.remove("visible");
      this.timer = window.setTimeout(() => this.next(), GAP_MS);
    }, SHOW_MS);
  }

  private clear(): void {
    clearTimeout(this.timer);
    this.button.classList.remove("visible");
  }

  /** End the run: no more showings. */
  hide(): void {
    this.left = 0;
    this.clear();
  }

  set(on: boolean): void {
    if (on === rotated) return;
    rotated = on;
    document.documentElement.classList.toggle("rot90", on);
    this.swapMedia(on);
    this.layout();
    this.onResize();
  }

  private layout(): void {
    for (const node of [this.canvas, this.ui]) {
      if (rotated) {
        node.style.width = `${window.innerHeight}px`;
        node.style.height = `${window.innerWidth}px`;
      } else {
        node.style.width = "";
        node.style.height = "";
      }
    }
  }

  /** Portrait ↔ landscape, width ↔ height, in every media query of our stylesheets. */
  private swapMedia(on: boolean): void {
    const visit = (rules: CSSRuleList) => {
      for (const r of Array.from(rules)) {
        if (r instanceof CSSMediaRule) {
          if (!this.media.has(r)) this.media.set(r, r.media.mediaText);
          const text = this.media.get(r)!;
          if (/orientation|width|height/.test(text)) r.media.mediaText = on ? swapText(text) : text;
          visit(r.cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        visit(sheet.cssRules);
      } catch {
        /* another origin's sheet (fonts): nothing of ours in it */
      }
    }
  }
}

function swapText(t: string): string {
  return t
    .replace(/portrait/g, "\u0001")
    .replace(/landscape/g, "portrait")
    .replace(/\u0001/g, "landscape")
    .replace(/width/g, "\u0002")
    .replace(/height/g, "width")
    .replace(/\u0002/g, "height");
}
