// Social UI: the chat panel, the emote wheel, and icon bubbles over heads.
//
// Chat is only offered when nobody is mid-run — in the waiting room, on the
// results card, and while you spectate — so it never sits between your thumb
// and a freeze. Emotes work any time (they don't move your feet).
//
// Every line on screen came back from the server already cleaned. Each one can
// be tapped: Mute (just you stop seeing them), Block (neither of you sees the
// other, and you won't be matched together), Report (with a reason; the server
// keeps their last few lines as evidence).

import { EMOTE_BY_ID, type EmoteId } from "../social/emotes";
import { CHAT_MAX } from "../social/filter";
import { REPORT_REASONS, type ReportReason } from "../net/protocol";
import { el } from "./dom";
import { icon } from "./icons";

export interface ChatLine {
  from: string;
  name: string;
  text: string;
  mine: boolean;
  system?: boolean;
  /** Gold chat name (a shop item; the server only sets it for buyers). */
  gold?: boolean;
}

export type ChatAction = { kind: "mute" | "block"; seat: string; name: string } | { kind: "report"; seat: string; name: string; reason: ReportReason };

export class ChatPanel {
  private readonly badge: HTMLElement;
  private readonly panel = el("div", "chat-panel");
  private readonly log = el("div", "chat-log");
  private readonly form = el("form", "chat-form");
  private readonly input = el("input");
  private readonly sheet = el("div", "chat-sheet");
  private unread = 0;
  private open = false;
  private available = false;
  private readonly muted = new Set<string>();
  private sendFn: (text: string) => void = () => {};
  private actionFn: (a: ChatAction) => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly button: HTMLElement,
  ) {
    this.badge = button.querySelector(".dot-badge") ?? el("i", "dot-badge");
    this.panel.classList.add("glass");

    const head = el("div", "chat-head");
    const title = el("b", "h", "Chat");
    const close = el("button", "ibtn");
    close.innerHTML = icon("close", "", 18);
    close.setAttribute("aria-label", "Close chat");
    close.addEventListener("click", () => this.setOpen(false));
    head.append(title, el("small", "", "Be nice. Never share numbers or links."), close);

    this.input.maxLength = CHAT_MAX;
    this.input.placeholder = "Say something…";
    this.input.autocomplete = "off";
    this.input.setAttribute("aria-label", "Chat message");
    const send = el("button", "btn primary");
    send.style.height = "36px";
    send.innerHTML = icon("send", "", 16);
    send.setAttribute("aria-label", "Send");
    send.type = "submit";
    this.form.append(this.input, send);
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.sendFn(text);
      this.input.value = "";
    });

    this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-live", "polite");
    this.log.addEventListener("click", (e) => {
      const line = (e.target as HTMLElement).closest<HTMLElement>("[data-seat]");
      if (line && line.dataset.mine !== "1") this.openSheet(line.dataset.seat!, line.dataset.name!);
    });

    this.panel.append(head, this.log, this.form, this.sheet);
    this.panel.dataset.ui = "1";
    parent.append(this.panel);
    this.setAvailable(false);
  }

  onSend(fn: (text: string) => void): void {
    this.sendFn = fn;
  }

  onAction(fn: (a: ChatAction) => void): void {
    this.actionFn = fn;
  }

  isMuted(seat: string): boolean {
    return this.muted.has(seat);
  }

  /** Whether chat may be shown at all right now (room, results, spectating). */
  setAvailable(on: boolean): void {
    this.available = on;
    this.button.hidden = !on;
    if (!on) this.setOpen(false);
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  setOpen(on: boolean): void {
    this.open = on && this.available;
    this.panel.classList.toggle("visible", this.open);
    this.sheet.classList.remove("visible");
    if (this.open) {
      this.unread = 0;
      this.badge.textContent = "";
      this.log.scrollTop = this.log.scrollHeight;
    }
  }

  clear(): void {
    this.log.replaceChildren();
    this.unread = 0;
    this.badge.textContent = "";
  }

  add(line: ChatLine): void {
    if (!line.system && this.muted.has(line.from)) return;
    // Other people's lines are buttons: a tap opens Mute / Block / Report, and
    // buttons get taps reliably everywhere (old iOS drops clicks on plain divs).
    const tappable = !line.system && !line.mine;
    const row = el(tappable ? "button" : "div", `chat-line${line.mine ? " mine" : ""}${line.system ? " system" : ""}${line.gold ? " gold" : ""}`);
    if (tappable) {
      (row as HTMLButtonElement).type = "button";
      row.setAttribute("aria-label", `${line.name}: ${line.text}. Tap to mute, block or report`);
    }
    if (!line.system) {
      row.dataset.seat = line.from;
      row.dataset.name = line.name;
      if (line.mine) row.dataset.mine = "1";
      const who = el("b", line.gold ? "gold" : "", line.mine ? "You" : line.name);
      row.append(who);
    }
    row.append(el("span", "", line.text)); // textContent: never HTML
    this.log.append(row);
    while (this.log.children.length > 60) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    if (!this.open && !line.mine && !line.system) {
      this.unread++;
      this.badge.textContent = this.unread > 9 ? "9+" : String(this.unread);
    }
  }

  private openSheet(seat: string, name: string): void {
    this.sheet.replaceChildren();
    const title = el("b", "h", name);
    const mute = el("button", "", this.muted.has(seat) ? "Unmute" : "Mute (only you stop seeing them)");
    mute.addEventListener("click", () => {
      if (this.muted.has(seat)) this.muted.delete(seat);
      else this.muted.add(seat);
      this.actionFn({ kind: "mute", seat, name });
      this.sheet.classList.remove("visible");
    });
    const block = el("button", "", "Block");
    block.addEventListener("click", () => {
      this.muted.add(seat);
      this.actionFn({ kind: "block", seat, name });
      this.sheet.classList.remove("visible");
    });
    const reasons = el("div", "chat-reasons");
    reasons.append(el("small", "", "Report for:"));
    for (const [reason, label] of Object.entries(REPORT_REASONS) as [ReportReason, string][]) {
      const b = el("button", "", label);
      b.addEventListener("click", () => {
        this.actionFn({ kind: "report", seat, name, reason });
        this.sheet.classList.remove("visible");
      });
      reasons.append(b);
    }
    const cancel = el("button", "ghost", "Cancel");
    cancel.addEventListener("click", () => this.sheet.classList.remove("visible"));
    this.sheet.append(title, mute, block, reasons, cancel);
    this.sheet.classList.add("visible");
  }
}

/**
 * The emote wheel: hold the emote button, slide to a slot, let go. Or tap a
 * slot. Eight slots, set in Loadout. Pack emotes are locked until bought.
 */
export class EmoteWheel {
  private readonly root = el("div", "wheel");
  private slots: EmoteId[] = [];
  private owned = new Set<EmoteId>();
  private hot = -1;
  private cx = 0;
  private cy = 0;
  private fn: (id: EmoteId) => void = () => {};
  private lockedFn: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root.dataset.ui = "1";
    this.root.setAttribute("role", "menu");
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-slot]");
      if (b) this.pick(Number(b.dataset.slot));
      else this.close();
    });
    parent.append(this.root);
  }

  onEmote(fn: (id: EmoteId) => void): void {
    this.fn = fn;
  }

  onLocked(fn: () => void): void {
    this.lockedFn = fn;
  }

  setOwned(ids: EmoteId[]): void {
    this.owned = new Set(ids);
  }

  setSlots(ids: EmoteId[]): void {
    this.slots = ids.slice(0, 8);
  }

  get isOpen(): boolean {
    return this.root.classList.contains("visible");
  }

  open(x: number, y: number): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.cx = x;
    this.cy = y;
    this.hot = -1;
    const R = 92;
    this.root.innerHTML =
      this.slots
        .map((id, i) => {
          const e = EMOTE_BY_ID[id];
          const a = (i / this.slots.length) * Math.PI * 2 - Math.PI / 2;
          const locked = !!e.pack && !this.owned.has(id);
          return `<button data-slot="${i}" class="${locked ? "locked" : ""}" style="left:${130 + Math.cos(a) * R}px;top:${130 + Math.sin(a) * R}px" aria-label="${e.label}">${icon(e.icon, "", 22)}<span>${e.label}</span></button>`;
        })
        .join("") + `<span class="mid">Emote</span>`;
    this.root.classList.add("visible");
  }

  /** While holding: highlight the slot the thumb points at. */
  hover(x: number, y: number): void {
    if (!this.isOpen) return;
    const dx = x - this.cx;
    const dy = y - this.cy;
    let h = -1;
    if (Math.hypot(dx, dy) > 30) {
      const a = Math.atan2(dy, dx) + Math.PI / 2;
      const n = this.slots.length;
      h = ((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n;
    }
    if (h === this.hot) return;
    this.hot = h;
    this.root.querySelectorAll<HTMLElement>("[data-slot]").forEach((b, i) => b.classList.toggle("hot", i === h));
  }

  /** Released: play the slot under the thumb, if any. */
  release(): void {
    if (!this.isOpen) return;
    if (this.hot >= 0) this.pick(this.hot);
  }

  close(): void {
    this.root.classList.remove("visible");
    this.hot = -1;
  }

  private pick(i: number): void {
    const id = this.slots[i];
    this.close();
    if (!id) return;
    const e = EMOTE_BY_ID[id];
    if (e.pack && !this.owned.has(id)) this.lockedFn();
    else this.fn(id);
  }
}

/** Icon bubbles that follow a contestant's head on screen. */
export class Bubbles {
  private readonly root = el("div", "bubbles");
  private readonly live: { el: HTMLElement; index: number; until: number }[] = [];

  constructor(parent: HTMLElement) {
    this.root.setAttribute("aria-hidden", "true");
    parent.append(this.root);
  }

  /** Any bubble on screen? (Nothing to place = nothing to do this frame.) */
  get active(): boolean {
    return this.live.length > 0;
  }

  show(index: number, iconName: string, seconds = 2.2, gold = false): void {
    // One bubble per head: a new emote replaces the old one.
    const old = this.live.findIndex((b) => b.index === index);
    if (old >= 0) {
      this.live[old].el.remove();
      this.live.splice(old, 1);
    }
    const b = el("div", gold ? "bubble gold" : "bubble");
    b.innerHTML = icon(iconName, "", 22);
    this.root.append(b);
    this.live.push({ el: b, index, until: performance.now() + seconds * 1000 });
  }

  clear(): void {
    for (const b of this.live) b.el.remove();
    this.live.length = 0;
  }

  /** `project(index)` → screen px of the head, or null if off screen / behind the camera. */
  update(project: (index: number) => { x: number; y: number } | null): void {
    const t = performance.now();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      const p = t < b.until ? project(b.index) : null;
      if (t >= b.until) {
        b.el.remove();
        this.live.splice(i, 1);
        continue;
      }
      b.el.style.display = p ? "" : "none";
      if (p) b.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    }
  }
}
