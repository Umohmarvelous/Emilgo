// The walkout's two buttons (SPEC-V2 §1.3): skip, and the tutorial on the
// first time on a field. On their own, apart from the walkout (flow/walkout.ts,
// in Ball Haunt's chunk), because the session makes them at boot.

import { icon } from "../ui/icons";

/** The two buttons over the walkout: skip (after the walk) and, the first time on a field, the tutorial. */
export class WalkoutButtons {
  readonly skipBtn: HTMLButtonElement;
  readonly tutorialBtn: HTMLButtonElement;

  constructor(ui: HTMLElement) {
    this.skipBtn = document.createElement("button");
    this.skipBtn.className = "flow-btn flow-skip glass";
    this.skipBtn.dataset.ui = "1";
    this.skipBtn.setAttribute("aria-label", "Skip");
    this.skipBtn.innerHTML = `${icon("skip", "", 18)}`;
    this.tutorialBtn = document.createElement("button");
    this.tutorialBtn.className = "flow-btn flow-tutorial glass";
    this.tutorialBtn.dataset.ui = "1";
    this.tutorialBtn.setAttribute("aria-label", "Tutorial");
    this.tutorialBtn.innerHTML = `${icon("help", "", 18)}<span>Tutorial</span>`;
    ui.append(this.skipBtn, this.tutorialBtn);
  }

  /** `up`: the HUD is showing (the countdown), so the tutorial button moves clear of the controls. */
  show(skip: boolean, tutorial: boolean, up = false): void {
    this.skipBtn.classList.toggle("visible", skip);
    this.tutorialBtn.classList.toggle("visible", tutorial);
    this.tutorialBtn.classList.toggle("up", up);
  }
}

