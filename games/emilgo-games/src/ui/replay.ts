// Over a replay (SPEC-V2 §2.7, §2.9): a small COD-style tag top centre — the
// kill cam's, or the play of the game's with who and what — a thin progress
// line, and a skip button. Nothing else on screen.

import { translateTree } from "./i18n";
import { el, esc } from "./dom";
import { icon } from "./icons";

export type ReplayKind = "killcam" | "potg";

export class ReplayOverlay {
  readonly root = el("div", "replay");
  readonly skipBtn = el("button", "flow-btn flow-skip glass replay-skip");
  private readonly tag = el("div", "replay-tag");
  private readonly bar = el("i", "replay-bar");

  constructor(ui: HTMLElement) {
    this.skipBtn.dataset.ui = "1";
    this.skipBtn.setAttribute("aria-label", "Skip");
    this.skipBtn.innerHTML = icon("skip", "", 18);
    const line = el("div", "replay-line");
    line.append(this.bar);
    this.root.append(this.tag, line);
    ui.append(this.root, this.skipBtn);
  }

  /** Show the tag. `who` and `what` for the play of the game ("Ada", "Closest escape"). */
  show(kind: ReplayKind, who = "", what = ""): void {
    this.tag.className = `replay-tag ${kind}`;
    this.tag.innerHTML =
      kind === "killcam"
        ? `<b>Kill cam</b>`
        : `<b>Play of the game</b><span class="who">${esc(who)}</span><span class="what">${esc(what)}</span>`;
    translateTree(this.tag);
    this.root.classList.add("visible");
    this.skipBtn.classList.add("visible");
    this.progress(0);
  }

  progress(u: number): void {
    this.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, u))})`;
  }

  hide(): void {
    this.root.classList.remove("visible");
    this.skipBtn.classList.remove("visible");
  }
}
