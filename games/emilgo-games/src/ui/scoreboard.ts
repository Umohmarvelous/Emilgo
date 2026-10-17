// The scoreboard (SPEC-V2 §7.4 #14): everyone in the round — their number,
// name, whether they're still in, safe or out, how far they've run, and who
// holds a ball. A modal (blurred background is allowed on modals, §3.1).
// Open with the HUD button (tap again to close) or hold Tab.

import type { Contestant } from "../game/rules";
import { el, esc } from "./dom";
import { icon } from "./icons";

export class Scoreboard {
  readonly root = el("div", "scoreboard");
  private readonly body = el("div", "sb-body");
  open = false;
  private at = 0;

  constructor(parent: HTMLElement) {
    this.root.dataset.ui = "1";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Scoreboard");
    this.root.append(this.body);
    this.root.addEventListener("click", () => this.show(false));
    parent.append(this.root);
  }

  show(on: boolean): void {
    this.open = on;
    this.root.classList.toggle("visible", on);
    this.at = 0;
  }

  /** Refresh (at most 4 times a second) while open. */
  update(list: readonly Contestant[], meId: string, distance: number, label: (c: Contestant) => string): void {
    if (!this.open) return;
    const now = performance.now();
    if (now - this.at < 250) return;
    this.at = now;
    const rank = (c: Contestant) => (c.status === "finished" ? 0 : c.status === "alive" ? 1 : 2);
    const rows = [...list].sort((a, b) => rank(a) - rank(b) || (a.status === "finished" ? a.place - b.place : a.status === "alive" ? b.progress - a.progress : b.eliminatedAt - a.eliminatedAt));
    const counts = { in: list.filter((c) => c.status === "alive").length, safe: list.filter((c) => c.status === "finished").length, out: list.filter((c) => c.status === "eliminated").length };
    this.body.innerHTML = `
      <div class="sb-head"><span>Players</span><span class="grow"></span><span>${counts.in} in · ${counts.safe} safe · ${counts.out} out</span></div>
      <div class="sb-rows">${rows
        .map(
          (c) => `<div class="sb-row ${c.status}${c.id === meId ? " me" : ""}">
            <span class="num">${String(c.index + 1).padStart(2, "0")}</span>
            <span class="name">${esc(label(c))}</span>
            <span class="ball">${c.ball >= 0 ? icon("ball", "", 12) : ""}</span>
            <span class="state">${c.status === "finished" ? `Safe · ${c.place}` : c.status === "alive" ? "In" : "Out"}</span>
            <span class="dist">${Math.round(Math.min(distance, c.progress))} m</span>
          </div>`,
        )
        .join("")}</div>`;
  }
}
