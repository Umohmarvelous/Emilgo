// Quick chat (SPEC-V2 §7.4 #20, "ping"): six short calls, one tap each. Online
// they go to the room as chat lines (already clean: no filter needed); in
// practice they show over your head. The panel opens above its button.

import { el } from "./dom";

export const QUICK_LINES = ["Go!", "Wait!", "Watch out!", "Help!", "Nice one!", "Sorry!"] as const;
/** Free For All's squad pings (SPEC-V3 §10.7), k 0–4: they mark a spot for your squad only. No voice. */
export const PING_LINES = ["Go", "Help", "Item", "Danger", "Here"] as const;

export class QuickChat {
  readonly root = el("div", "quickchat");
  open = false;
  private send: ((text: string) => void) | null = null;
  private ping: ((k: number) => void) | null = null;
  private pings = false;

  constructor(parent: HTMLElement) {
    this.root.dataset.ui = "1";
    this.root.setAttribute("role", "menu");
    this.render();
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (!b) return;
      if (this.pings) this.ping?.(Number(b.dataset.i));
      else this.send?.(QUICK_LINES[Number(b.dataset.i)]);
      this.toggle(false);
    });
    parent.append(this.root);
  }

  onSend(fn: (text: string) => void): void {
    this.send = fn;
  }

  onPing(fn: (k: number) => void): void {
    this.ping = fn;
  }

  /** In a Free For All match the panel is the squad ping wheel; elsewhere quick chat. */
  setPings(on: boolean, label: (s: string) => string = (s) => s): void {
    if (this.pings === on) return;
    this.pings = on;
    this.render(label);
  }

  private render(label: (s: string) => string = (s) => s): void {
    const lines: readonly string[] = this.pings ? PING_LINES : QUICK_LINES;
    this.root.classList.toggle("pings", this.pings);
    this.root.innerHTML = lines.map((t, i) => `<button class="qbtn" role="menuitem" data-i="${i}">${label(t)}</button>`).join("");
  }

  toggle(on = !this.open): void {
    this.open = on;
    this.root.classList.toggle("visible", on);
  }
}
