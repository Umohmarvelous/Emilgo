// Touch, mouse and keyboard.
//
// Sticks (the brief: 120 px, 1 px solid white, a centre dot, no text, 10% dead
// zone, 0.4 idle / 0.8 active):
//   move   left half — appears wherever the thumb lands, gone when it lifts;
//          a small push walks, a full push runs; LET GO = FREEZE; a quick
//          double-tap of the stick starts a sprint
//   look   right half — rotates the camera at a rate (calm by default);
//          drawn always or only while touched (settings)
// "Swap sticks" mirrors the halves and the buttons.
//
// Buttons (bottom right): jump, crouch (tap; hold for prone), sprint (toggle),
// emote (hold for the wheel), chat.
//
// Keyboard: WASD/arrows move, Shift sprint, Space jump, C crouch (hold: prone),
// V first person, Q/E look, T chat, G emotes, Esc/P pause. Nothing is hover-only
// (Lagos Life review checklist §03).

import type { Stance } from "../config";
import { icon } from "../ui/icons";

export interface Vec2 {
  x: number;
  y: number;
}

const RADIUS = 60; // px: the stick's radius (120 px across)
const DEAD = 0.1;
const DOUBLE_TAP_MS = 320;
const PRONE_HOLD_MS = 420;

interface StickState {
  id: number | null;
  ox: number;
  oy: number;
  x: number;
  y: number;
  el: HTMLElement;
  knob: HTMLElement;
}

export class Controls {
  enabled = false;
  leftHanded = false;
  /** Right stick drawn when idle ("always") or only while touched. */
  lookAlways = false;
  readonly move: Vec2 = { x: 0, y: 0 };
  readonly look: Vec2 = { x: 0, y: 0 };
  /** Sprint toggled on (button, double-tap or Shift). */
  sprint = false;
  /** The stance asked for. */
  stance: Stance = 0;
  /** Bumped on every jump press. */
  jumps = 0;
  readonly actions: HTMLDivElement;
  readonly chatBtn: HTMLButtonElement;
  private readonly jumpBtn: HTMLButtonElement;
  private readonly crouchBtn: HTMLButtonElement;
  private readonly sprintBtn: HTMLButtonElement;
  private readonly emoteBtn: HTMLButtonElement;
  private readonly keys = new Set<string>();
  private readonly sticks: { move: StickState; look: StickState };
  private firstInput: (() => void) | null = null;
  private lastMoveTap = 0;
  private shiftSprint = false;
  private crouchDownAt = 0;
  private crouchTimer = 0;
  private mouseLook: { id: number; x: number; y: number } | null = null;
  onPauseKey: (() => void) | null = null;
  onFirstPerson: (() => void) | null = null;
  onChat: (() => void) | null = null;
  /** Emote wheel: open (with the pointer id) and closed. */
  onWheel: ((open: boolean, x: number, y: number) => void) | null = null;
  onWheelMove: ((x: number, y: number) => void) | null = null;

  constructor(
    private readonly surface: HTMLElement,
    moveEl: HTMLElement,
    lookEl: HTMLElement,
  ) {
    const make = (el: HTMLElement): StickState => ({ id: null, ox: 0, oy: 0, x: 0, y: 0, el, knob: el.querySelector(".knob") as HTMLElement });
    this.sticks = { move: make(moveEl), look: make(lookEl) };

    // Action buttons.
    this.actions = document.createElement("div");
    this.actions.className = "actions";
    const btn = (cls: string, ico: string, label: string, aria: string) => {
      const b = document.createElement("button");
      b.className = `abtn ${cls}`;
      b.dataset.ui = "1";
      b.setAttribute("aria-label", aria);
      b.innerHTML = `${icon(ico, "", cls === "jump" ? 26 : 22)}<small>${label}</small>`;
      this.actions.append(b);
      return b;
    };
    this.sprintBtn = btn("sprint", "sprint", "SPRINT", "Sprint");
    this.emoteBtn = btn("emote", "emote", "", "Emotes (hold)");
    this.chatBtn = btn("chat", "chat", "", "Chat");
    this.chatBtn.insertAdjacentHTML("beforeend", `<i class="dot-badge"></i>`);
    this.crouchBtn = btn("crouch", "crouch", "CROUCH", "Crouch (hold to lie down)");
    this.jumpBtn = btn("jump", "jump", "JUMP", "Jump");
    this.chatBtn.hidden = true;

    const press = (b: HTMLElement, down: (e: PointerEvent) => void, up?: (e: PointerEvent) => void) => {
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.touched();
        if (!this.enabled) return;
        b.classList.add("down");
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          /* fine */
        }
        down(e);
      });
      const end = (e: PointerEvent) => {
        b.classList.remove("down");
        up?.(e);
      };
      b.addEventListener("pointerup", end);
      b.addEventListener("pointercancel", end);
    };
    press(this.jumpBtn, () => this.jump());
    press(this.sprintBtn, () => this.setSprint(!this.sprint));
    press(
      this.crouchBtn,
      () => {
        this.crouchDownAt = performance.now();
        clearTimeout(this.crouchTimer);
        // Hold: lie down.
        this.crouchTimer = window.setTimeout(() => this.setStance(2), PRONE_HOLD_MS);
      },
      () => {
        clearTimeout(this.crouchTimer);
        if (performance.now() - this.crouchDownAt < PRONE_HOLD_MS) this.setStance(this.stance === 0 ? 1 : 0);
      },
    );
    press(
      this.emoteBtn,
      (e) => this.onWheel?.(true, e.clientX, e.clientY),
      (e) => this.onWheel?.(false, e.clientX, e.clientY),
    );
    this.emoteBtn.addEventListener("pointermove", (e) => this.onWheelMove?.(e.clientX, e.clientY));
    this.chatBtn.addEventListener("click", () => this.onChat?.());

    surface.addEventListener("pointerdown", this.down, { passive: false });
    surface.addEventListener("pointermove", this.moveEv, { passive: false });
    surface.addEventListener("pointerup", this.up);
    surface.addEventListener("pointercancel", this.up);
    surface.addEventListener("lostpointercapture", this.up);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", () => this.reset());
    surface.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Called once, on the very first touch/key — used to unlock audio. */
  onFirstInput(fn: () => void): void {
    this.firstInput = fn;
  }

  /** True while a move stick or move key is held. */
  get moving(): boolean {
    return Math.hypot(this.move.x, this.move.y) > 0.01;
  }

  setLayout(leftHanded: boolean, lookAlways: boolean): void {
    this.leftHanded = leftHanded;
    this.lookAlways = lookAlways;
    this.actions.classList.toggle("lefty", leftHanded);
    this.placeLookHome();
  }

  /** Show or hide the in-play buttons (they never show on menus). */
  showActions(on: boolean): void {
    this.actions.hidden = !on;
    this.placeLookHome();
  }

  setSprint(on: boolean): void {
    this.sprint = on;
    this.sprintBtn.classList.toggle("on", on);
  }

  setStance(s: Stance): void {
    this.stance = s;
    if (s > 0) this.setSprint(false);
    this.crouchBtn.classList.toggle("on", s > 0);
    this.crouchBtn.innerHTML = `${icon(s === 2 ? "prone" : "crouch", "", 22)}<small>${s === 2 ? "PRONE" : "CROUCH"}</small>`;
  }

  jump(): void {
    if (this.stance > 0) {
      // Jump from a crouch stands you up instead (COD does the same).
      this.setStance(0);
      return;
    }
    this.jumps = (this.jumps + 1) & 255;
  }

  reset(): void {
    for (const s of [this.sticks.move, this.sticks.look]) {
      s.id = null;
      s.x = s.y = 0;
      s.el.classList.remove("on", "run", "sprint");
    }
    this.mouseLook = null;
    this.keys.clear();
    this.shiftSprint = false;
    this.setSprint(false);
    this.setStance(0);
    this.placeLookHome();
    this.update();
  }

  /** Recompute move/look from sticks and keys. Call once per frame. */
  update(): void {
    const m = this.sticks.move;
    let mx = m.x;
    let my = m.y;
    const kx = (this.key("d", "arrowright") ? 1 : 0) - (this.key("a", "arrowleft") ? 1 : 0);
    const ky = (this.key("w", "arrowup") ? 1 : 0) - (this.key("s", "arrowdown") ? 1 : 0);
    if (kx || ky) {
      const len = Math.hypot(kx, ky);
      const mag = this.keys.has("alt") ? 0.6 : 1;
      mx = (kx / len) * mag;
      my = (ky / len) * mag;
    }
    if (!this.enabled) mx = my = 0;
    this.move.x = mx;
    this.move.y = my;
    // A stop ends a sprint: the next run starts as a run.
    if (!mx && !my && this.sprint && !this.shiftSprint) this.setSprint(false);
    m.el.classList.toggle("sprint", this.sprint && m.id !== null);

    const l = this.sticks.look;
    const kl = (this.key("e") ? 1 : 0) - (this.key("q") ? 1 : 0);
    this.look.x = this.enabled ? kl || l.x : 0;
    this.look.y = this.enabled ? l.y : 0;
  }

  /** Mouse drag on desktop: pixels moved since the last frame (added to the look rate). */
  consumeMouse(): Vec2 {
    const d = { x: this.mdx, y: this.mdy };
    this.mdx = this.mdy = 0;
    return d;
  }
  private mdx = 0;
  private mdy = 0;

  private key(...names: string[]): boolean {
    for (const n of names) if (this.keys.has(n)) return true;
    return false;
  }

  private touched(): void {
    if (this.firstInput) {
      const fn = this.firstInput;
      this.firstInput = null;
      fn();
    }
  }

  /** The idle right stick, at its home position (when "always"). */
  private placeLookHome(): void {
    const l = this.sticks.look;
    if (l.id !== null) return;
    const show = this.enabled && this.lookAlways && !this.actions.hidden;
    l.el.classList.toggle("idle", show);
    if (!show) return;
    const x = this.leftHanded ? 120 : window.innerWidth - 250;
    const y = window.innerHeight - 110;
    l.el.style.transform = `translate(${x}px, ${y}px)`;
    l.knob.style.transform = "translate(-50%, -50%)";
  }

  private down = (e: PointerEvent): void => {
    this.touched();
    if (!this.enabled) return;
    if ((e.target as HTMLElement).closest("button, a, input, .sheet, [data-ui]")) return;
    const leftSide = e.clientX < window.innerWidth / 2;
    const isMove = this.leftHanded ? !leftSide : leftSide;
    // A mouse drags the camera directly, like a mouse should.
    if (e.pointerType === "mouse" && !isMove) {
      this.mouseLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try {
        this.surface.setPointerCapture(e.pointerId);
      } catch {
        /* fine */
      }
      return;
    }
    const s = isMove ? this.sticks.move : this.sticks.look;
    if (s.id !== null) return;
    e.preventDefault();
    s.id = e.pointerId;
    s.ox = e.clientX;
    s.oy = e.clientY;
    s.x = s.y = 0;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    s.el.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
    s.knob.style.transform = "translate(-50%, -50%)";
    s.el.classList.remove("idle");
    s.el.classList.add("on");
    if (isMove) {
      const t = performance.now();
      if (t - this.lastMoveTap < DOUBLE_TAP_MS && this.stance === 0) this.setSprint(true);
      this.lastMoveTap = t;
    }
  };

  private moveEv = (e: PointerEvent): void => {
    if (this.mouseLook && e.pointerId === this.mouseLook.id) {
      this.mdx += e.clientX - this.mouseLook.x;
      this.mdy += e.clientY - this.mouseLook.y;
      this.mouseLook.x = e.clientX;
      this.mouseLook.y = e.clientY;
      return;
    }
    for (const s of [this.sticks.move, this.sticks.look]) {
      if (s.id !== e.pointerId) continue;
      e.preventDefault();
      let dx = e.clientX - s.ox;
      let dy = e.clientY - s.oy;
      const d = Math.hypot(dx, dy);
      if (d > RADIUS) {
        // Drag the base along: the thumb never runs out of stick.
        const pull = d - RADIUS;
        s.ox += (dx / d) * pull;
        s.oy += (dy / d) * pull;
        dx = e.clientX - s.ox;
        dy = e.clientY - s.oy;
        s.el.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
      }
      const nx = dx / RADIUS;
      const ny = -dy / RADIUS; // screen up = forward
      const mag = Math.min(1, Math.hypot(nx, ny));
      if (mag < DEAD) {
        s.x = s.y = 0;
      } else {
        const k = (mag - DEAD) / (1 - DEAD) / mag;
        s.x = nx * k;
        s.y = ny * k;
      }
      s.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      s.el.classList.toggle("run", s === this.sticks.move && Math.hypot(s.x, s.y) > 0.72);
    }
  };

  private up = (e: PointerEvent): void => {
    if (this.mouseLook && e.pointerId === this.mouseLook.id) {
      this.mouseLook = null;
      return;
    }
    for (const s of [this.sticks.move, this.sticks.look]) {
      if (s.id !== e.pointerId) continue;
      s.id = null;
      s.x = s.y = 0;
      s.el.classList.remove("on", "run", "sprint");
    }
    this.placeLookHome();
  };

  private keyDown = (e: KeyboardEvent): void => {
    this.touched();
    // Typing a room code is typing, not playing.
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
    const k = e.key.toLowerCase();
    if (k === "escape" || k === "p") {
      this.onPauseKey?.();
      return;
    }
    if (!this.enabled) return;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (k === " ") this.jump();
    else if (k === "shift") {
      this.shiftSprint = true;
      if (this.stance === 0) this.setSprint(true);
    } else if (k === "c") {
      this.crouchDownAt = performance.now();
      clearTimeout(this.crouchTimer);
      this.crouchTimer = window.setTimeout(() => this.setStance(2), PRONE_HOLD_MS);
    } else if (k === "z") this.setStance(this.stance === 2 ? 0 : 2);
    else if (k === "v") this.onFirstPerson?.();
    else if (k === "t") this.onChat?.();
    else if (k === "g") this.onWheel?.(true, window.innerWidth / 2, window.innerHeight / 2);
    this.keys.add(k);
  };

  private keyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
    if (!this.enabled) return;
    if (k === "shift") {
      this.shiftSprint = false;
      this.setSprint(false);
    } else if (k === "c") {
      clearTimeout(this.crouchTimer);
      if (performance.now() - this.crouchDownAt < PRONE_HOLD_MS) this.setStance(this.stance === 0 ? 1 : 0);
    }
  };
}
