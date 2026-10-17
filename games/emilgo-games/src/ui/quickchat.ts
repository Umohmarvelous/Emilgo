// Quick chat (SPEC-V2 §7.4 #20, "ping"): six short calls, one tap each. Online
// they go to the room as chat lines (already clean: no filter needed); in
// practice they show over your head. The panel opens above its button.

import { el } from "./dom";

export const QUICK_LINES = ["Go!", "Wait!", "Watch out!", "Help!", "Nice one!", "Sorry!"] as const;

export class QuickChat {
  readonly root = el("div", "quickchat");
  open = false;
  private send: ((text: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root.dataset.ui = "1";
    this.root.setAttribute("role", "menu");
    this.root.innerHTML = QUICK_LINES.map((t, i) => `<button class="qbtn" role="menuitem" data-i="${i}">${t}</button>`).join("");
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (!b) return;
      this.send?.(QUICK_LINES[Number(b.dataset.i)]);
      this.toggle(false);
    });
    parent.append(this.root);
  }

  onSend(fn: (text: string) => void): void {
    this.send = fn;
  }

  toggle(on = !this.open): void {
    this.open = on;
    this.root.classList.toggle("visible", on);
  }
}
