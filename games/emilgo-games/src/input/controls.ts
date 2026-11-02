// Touch, mouse and keyboard.
//
// Sticks (SPEC-V2 §3.3, §4: 1 px solid white, a centre dot, no text, a 10%
// dead zone; size and opacity in Settings):
//   move   left half — appears wherever the thumb lands, gone when it lifts;
//          a small push walks, a full push runs; LET GO = FREEZE; a quick
//          double-tap of the stick starts a sprint
//   look   right half — rotates the camera at a rate (calm by default);
//          drawn always or only while touched (settings)
// "Swap sticks" mirrors the halves and the buttons.
//
// Buttons, icons only (SPEC-V2 §3.1): sprint above the move stick, with your
// stamina round it (toggle, hold or auto, in Settings); bottom right jump,
// crouch (tap; hold for prone; while sprinting: a slide), emote (hold for the
// wheel), chat and quick chat. Bottom centre, only when they apply (§2.4):
// fist, slap and push with someone within 2 m; grab with a free ball in reach.
//
// Keyboard: WASD/arrows move, Shift sprint, Space jump, C crouch (hold: prone),
// V first person, Q/E look, T chat, G emotes, Y quick chat, 1/2/3 fist/slap/
// push, F grab, Tab scoreboard (hold), M map, K kill feed, Esc/P pause.
// Nothing is hover-only (Lagos Life review checklist §03).
//
// Free For All (layout "ffa", SPEC-V3 §4): the bottom-centre buttons are
// always there in play — fist, slap, push, grab and brace (held); while you
// hold someone in a clinch, fist, slap and push become Throw, Trip and Drag.
// Keys: F fist, R slap, X push, Q grab, Ctrl brace (held), E interact (hold
// to open a crate), B the backpack, 1–0 use a slot (Shift: drop it); with
// the mouse taken, left click a fist and right click a brace (held).
//
// In a car (vehicles, Phase 5): the stick drives; jump is the horn (Space);
// sprint, crouch and the emotes go; a radio button (N) changes the station;
// slap (R) shows only while someone is pulling at your door.

import { gameSize, toGame } from "../ui/rotate";
import { ATTACK_KINDS, type AttackKind, type Stance } from "../config";
import { icon } from "../ui/icons";

export interface Vec2 {
  x: number;
  y: number;
}

const SIZES = { small: 100, medium: 120, large: 144 } as const;
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
  private on = false;
  /** Controls answer only in play; turning them off also gives the mouse back. */
  get enabled(): boolean {
    return this.on;
  }
  set enabled(on: boolean) {
    this.on = on;
    if (!on) this.unlockPointer();
  }
  /**
   * Desktop mouse (SPEC-V3): "lock" takes the pointer on a click (the cursor
   * hides, the mouse turns the camera, Esc gives it back); "stick" makes a
   * mouse drag on the look side a virtual right stick, exactly as a thumb.
   */
  mouseMode: "lock" | "stick" = "lock";
  /** Called when the pointer is taken or given back. */
  onPointerLock: ((locked: boolean) => void) | null = null;
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
  /** Attack requests: (count << 2) | kind (1 fist, 2 slap, 3 push). Grab requests: a count. */
  attacks = 0;
  grabs = 0;
  /** Which game the buttons and keys are for. */
  layout: "rlgl" | "ffa" = "rlgl";
  /** Free For All: brace held (button, Ctrl or the right mouse button). */
  get brace(): boolean {
    return this.braceKey || this.braceTouch || this.braceMouse;
  }
  private braceKey = false;
  private braceTouch = false;
  private braceMouse = false;
  private finisher = false;
  /** Free For All: interact pressed and released (E). */
  onInteract: ((down: boolean) => void) | null = null;
  /** Free For All: the backpack (B), and a slot used or dropped (1–0, Shift). */
  onPack: (() => void) | null = null;
  onSlot: ((slot: number, drop: boolean) => void) | null = null;
  readonly actions: HTMLDivElement;
  /** Above the move stick: sprint, with your stamina round it (SPEC-V2 §3.2). */
  readonly moveSide: HTMLDivElement;
  /** The bottom-centre buttons (fist, slap, push, grab), shown only when they apply. */
  readonly vitals: HTMLDivElement;
  private readonly attackBtns: HTMLButtonElement[] = [];
  private readonly grabBtn: HTMLButtonElement;
  private readonly braceBtn: HTMLButtonElement;
  readonly chatBtn: HTMLButtonElement;
  private readonly jumpBtn: HTMLButtonElement;
  private readonly crouchBtn: HTMLButtonElement;
  private readonly sprintBtn: HTMLButtonElement;
  private readonly emoteBtn: HTMLButtonElement;
  private readonly radioBtn: HTMLButtonElement;
  private driving: "driver" | "rider" | null = null;
  /** In a car: the radio's next station. */
  onRadio: (() => void) | null = null;
  readonly quickBtn: HTMLButtonElement;
  private readonly stamRing: SVGCircleElement;
  /** The stick's radius in px (Settings: small, medium, large). */
  private radius = 60;
  private sprintMode: "toggle" | "hold" | "auto" = "toggle";
  private autoSprint = false;
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
  onQuick: (() => void) | null = null;
  onScoreboard: ((open: boolean) => void) | null = null;
  onMap: (() => void) | null = null;
  onFeed: (() => void) | null = null;
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
    const btn = (cls: string, ico: string, aria: string) => {
      const b = document.createElement("button");
      b.className = `abtn ${cls}`;
      b.dataset.ui = "1";
      b.setAttribute("aria-label", aria);
      // Icons only: no words on the game screen (SPEC-V2 §3.6).
      b.innerHTML = icon(ico, "", cls === "jump" ? 26 : 22);
      this.actions.append(b);
      return b;
    };
    this.sprintBtn = btn("sprint", "sprint", "Sprint");
    this.emoteBtn = btn("emote", "emote", "Emotes (hold)");
    this.chatBtn = btn("chat", "chat", "Chat");
    this.quickBtn = btn("quick", "ping", "Quick chat");
    this.chatBtn.insertAdjacentHTML("beforeend", `<i class="dot-badge"></i>`);
    this.crouchBtn = btn("crouch", "crouch", "Crouch (hold to lie down)");
    this.jumpBtn = btn("jump", "jump", "Jump");
    this.chatBtn.hidden = true;
    // Your stamina, round the sprint button.
    this.sprintBtn.insertAdjacentHTML("beforeend", `<svg class="stam-ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" /></svg>`);
    this.stamRing = this.sprintBtn.querySelector("circle")!;
    this.moveSide = document.createElement("div");
    this.moveSide.className = "mside";
    this.moveSide.append(this.sprintBtn);

    this.vitals = document.createElement("div");
    this.vitals.className = "vitals";
    const vbtn = (ico: string, aria: string) => {
      const b = document.createElement("button");
      b.className = "abtn vbtn";
      b.dataset.ui = "1";
      b.setAttribute("aria-label", aria);
      b.innerHTML = icon(ico, "", 24);
      b.hidden = true;
      this.vitals.append(b);
      return b;
    };
    for (const k of ATTACK_KINDS) this.attackBtns.push(vbtn(k, k[0].toUpperCase() + k.slice(1)));
    this.grabBtn = vbtn("grab", "Grab the ball");
    this.braceBtn = vbtn("brace", "Brace (hold)");
    this.radioBtn = vbtn("radio", "Radio");

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
    press(this.radioBtn, () => this.onRadio?.());
    ATTACK_KINDS.forEach((k, i) => press(this.attackBtns[i], () => this.attack(k)));
    press(this.grabBtn, () => this.grab());
    press(
      this.braceBtn,
      () => (this.braceTouch = true),
      () => (this.braceTouch = false),
    );
    press(
      this.sprintBtn,
      () => (this.sprintMode === "hold" ? this.setSprint(true) : this.setSprint(!this.sprint)),
      () => this.sprintMode === "hold" && this.setSprint(false),
    );
    this.quickBtn.addEventListener("click", () => this.onQuick?.());
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
      (e) => {
        const p = toGame(e.clientX, e.clientY);
        this.onWheel?.(true, p.x, p.y);
      },
      (e) => {
        const p = toGame(e.clientX, e.clientY);
        this.onWheel?.(false, p.x, p.y);
      },
    );
    this.emoteBtn.addEventListener("pointermove", (e) => {
      const p = toGame(e.clientX, e.clientY);
      this.onWheelMove?.(p.x, p.y);
    });
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
    document.addEventListener("mousemove", this.lockedMove);
    // Free For All with the mouse taken: left click a fist, right click a brace.
    document.addEventListener("mousedown", (e) => {
      if (!this.locked || !this.on || this.layout !== "ffa") return;
      if (e.button === 0) this.attack("fist");
      else if (e.button === 2) this.braceMouse = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 2) this.braceMouse = false;
    });
    document.addEventListener("pointerlockchange", () => this.onPointerLock?.(this.locked));
  }

  /** The mouse is ours (pointer lock on the game surface). */
  get locked(): boolean {
    return typeof document !== "undefined" && document.pointerLockElement === this.surface;
  }

  /**
   * Take the pointer. Raw movement where the browser offers it, so the OS's
   * acceleration never changes how the camera feels; otherwise plain lock.
   */
  private lockPointer(): void {
    const el = this.surface as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
    if (!el.requestPointerLock || this.locked) return;
    const plain = (): void => {
      try {
        const r = el.requestPointerLock();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch {
        /* the host forbids it: the mouse stays a drag */
      }
    };
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof r.catch === "function") r.catch(plain);
    } catch {
      plain();
    }
  }

  /** Give the mouse back (the pause menu needs a cursor). */
  releasePointer(): void {
    this.unlockPointer();
  }

  private unlockPointer(): void {
    if (this.locked) {
      try {
        document.exitPointerLock();
      } catch {
        /* fine */
      }
    }
  }

  /** While locked, every mouse movement turns the camera (same path, sensitivity and smoothing as a drag). */
  private lockedMove = (e: MouseEvent): void => {
    if (!this.locked || !this.on) return;
    // Turn a screen delta into the game's own axes when the game is turned on its side.
    const a = toGame(0, 0);
    const b = toGame(e.movementX, e.movementY);
    this.mdx += b.x - a.x;
    this.mdy += b.y - a.y;
  };

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
    this.moveSide.classList.toggle("lefty", leftHanded);
    this.placeLookHome();
  }

  /** Stick size and opacity (Settings), and how sprint works. */
  setStyle(size: keyof typeof SIZES, opacity: number, sprintMode: "toggle" | "hold" | "auto"): void {
    const px = SIZES[size];
    this.radius = px / 2;
    for (const s of [this.sticks.move, this.sticks.look]) {
      s.el.style.setProperty("--stick", `${px}px`);
      s.el.style.setProperty("--stick-o", String(opacity));
    }
    this.sprintMode = sprintMode;
    this.autoSprint = sprintMode === "auto";
  }

  /** Stamina 0…1: the ring round the sprint button and the bar above the move stick. */
  setStamina(v: number, sprinting: boolean): void {
    const c = 188.5; // 2π × 30
    this.stamRing.style.strokeDashoffset = String(c * (1 - v));
    this.sprintBtn.classList.toggle("low", v < 0.2);
    const bar = this.sticks.move.el.querySelector<HTMLElement>(".bar");
    if (bar) {
      bar.style.setProperty("--v", String(v));
      bar.classList.toggle("show", sprinting || v < 0.999);
    }
  }

  /** Show or hide the in-play buttons (they never show on menus). */
  showActions(on: boolean): void {
    this.actions.hidden = !on;
    // Off, the chat button may still stand alone (rooms, results): .play marks the full set.
    this.actions.classList.toggle("play", on);
    this.moveSide.hidden = !on;
    this.vitals.hidden = !on;
    if (!on) this.setNear(false, false);
    this.placeLookHome();
  }

  /** Which bottom-centre buttons apply right now: someone in reach to attack, a ball to grab (Free For All: brace with the attacks). */
  setNear(attack: boolean, grab: boolean): void {
    for (const b of this.attackBtns) if (b.hidden === attack) b.hidden = !attack;
    if (this.grabBtn.hidden === grab) this.grabBtn.hidden = !grab;
    const brace = attack && this.layout === "ffa";
    if (this.braceBtn.hidden === brace) this.braceBtn.hidden = !brace;
    this.grabBtn.setAttribute("aria-label", this.layout === "ffa" ? "Grab (clinch)" : "Grab the ball");
  }

  /**
   * In a car (or out: null). The driver's jump is the horn; a rider has no
   * jump; sprint, crouch and the emotes go; the radio comes. `slap`: someone
   * is pulling at your door, so the slap shows.
   */
  setDriving(mode: "driver" | "rider" | null, slap: boolean): void {
    if (mode !== this.driving) {
      this.driving = mode;
      this.jumpBtn.innerHTML = icon(mode === "driver" ? "horn" : "jump", "", 26);
      this.jumpBtn.setAttribute("aria-label", mode === "driver" ? "Horn" : "Jump");
      this.jumpBtn.hidden = mode === "rider";
      this.crouchBtn.hidden = !!mode;
      this.sprintBtn.hidden = !!mode;
      this.emoteBtn.hidden = !!mode;
      if (mode) {
        this.setSprint(false);
        this.setStance(0);
      }
    }
    if (this.radioBtn.hidden === !!mode) this.radioBtn.hidden = !mode;
    if (mode) {
      this.attackBtns.forEach((b, i) => {
        const on = slap && ATTACK_KINDS[i] === "slap";
        if (b.hidden === on) b.hidden = !on;
      });
      if (!this.grabBtn.hidden) this.grabBtn.hidden = true;
      if (!this.braceBtn.hidden) this.braceBtn.hidden = true;
    }
  }

  /**
   * Dead Streets (Phase 7): the three attack buttons are the cutlass (fist),
   * the gun (slap) and a shove (push), always there; no grab, no brace.
   */
  setSurvival(on: boolean): void {
    const names = on ? (["cutlass", "gun", "push"] as const) : ATTACK_KINDS;
    const labels = on ? ["Cutlass", "Shoot", "Shove"] : ATTACK_KINDS.map((k) => k[0].toUpperCase() + k.slice(1));
    this.attackBtns.forEach((b, i) => {
      b.innerHTML = icon(names[i], "", 24);
      b.setAttribute("aria-label", labels[i]);
      b.hidden = false;
    });
    this.grabBtn.hidden = on;
    this.braceBtn.hidden = on;
  }

  /** Free For All: holding someone, the attacks finish the clinch (fist Throw, slap Trip, push Drag). */
  setFinisher(on: boolean): void {
    if (on === this.finisher) return;
    this.finisher = on;
    const names = on ? (["throw", "trip", "drag"] as const) : ATTACK_KINDS;
    this.attackBtns.forEach((b, i) => {
      const k = names[i];
      b.innerHTML = icon(k, "", 24);
      b.setAttribute("aria-label", k[0].toUpperCase() + k.slice(1));
      b.classList.toggle("finish", on);
    });
  }

  attack(kind: AttackKind): void {
    const n = ((this.attacks >> 2) + 1) & 63;
    this.attacks = (n << 2) | (ATTACK_KINDS.indexOf(kind) + 1);
  }

  grab(): void {
    this.grabs = (this.grabs + 1) & 255;
  }

  setSprint(on: boolean): void {
    this.sprint = on;
    this.sprintBtn.classList.toggle("on", on);
  }

  setStance(s: Stance): void {
    this.stance = s;
    if (s > 0) this.setSprint(false);
    this.crouchBtn.classList.toggle("on", s > 0);
    this.crouchBtn.innerHTML = icon(s === 2 ? "prone" : "crouch", "", 22);
    this.crouchBtn.setAttribute("aria-label", s === 2 ? "Lying down (tap to stand)" : "Crouch (hold to lie down)");
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
    this.braceKey = this.braceTouch = this.braceMouse = false;
    this.setFinisher(false);
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
    // Auto-sprint: a full push sprints while stamina lasts (the button still toggles it).
    if (this.autoSprint && this.stance === 0) {
      const full = Math.hypot(mx, my) > 0.95;
      if (full !== this.sprint && !this.shiftSprint) this.setSprint(full);
    }
    // A stop ends a sprint: the next run starts as a run.
    if (!mx && !my && this.sprint && !this.shiftSprint) this.setSprint(false);
    m.el.classList.toggle("sprint", this.sprint && m.id !== null);

    const l = this.sticks.look;
    // Q and E turn the camera in Red Light, Green Light; Free For All gives them to grab and interact.
    const kl = this.layout === "ffa" ? 0 : (this.key("e") ? 1 : 0) - (this.key("q") ? 1 : 0);
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
    const g = gameSize();
    const x = this.leftHanded ? 120 : g.w - 250;
    const y = g.h - 110;
    l.el.style.transform = `translate(${x}px, ${y}px)`;
    l.knob.style.transform = "translate(-50%, -50%)";
  }

  private down = (e: PointerEvent): void => {
    this.touched();
    if (!this.enabled) return;
    if ((e.target as HTMLElement).closest("button, a, input, .sheet, [data-ui]")) return;
    // Locked: the mouse is the camera, and its buttons don't make sticks.
    if (e.pointerType === "mouse" && this.locked) return;
    // Game coordinates: the same as the screen's unless the game is turned on its side.
    const p = toGame(e.clientX, e.clientY);
    const leftSide = p.x < gameSize().w / 2;
    const isMove = this.leftHanded ? !leftSide : leftSide;
    // Pointer lock (the default on a computer): a click on the game takes the mouse.
    if (e.pointerType === "mouse" && this.mouseMode === "lock") {
      e.preventDefault();
      this.lockPointer();
      return;
    }
    // "stick": a mouse drag on the look side is a virtual stick, like a thumb (below).
    if (e.pointerType === "mouse" && !isMove && this.mouseMode !== "stick") {
      this.mouseLook = { id: e.pointerId, x: p.x, y: p.y };
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
    s.ox = p.x;
    s.oy = p.y;
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
    const p = toGame(e.clientX, e.clientY);
    if (this.mouseLook && e.pointerId === this.mouseLook.id) {
      this.mdx += p.x - this.mouseLook.x;
      this.mdy += p.y - this.mouseLook.y;
      this.mouseLook.x = p.x;
      this.mouseLook.y = p.y;
      return;
    }
    for (const s of [this.sticks.move, this.sticks.look]) {
      if (s.id !== e.pointerId) continue;
      e.preventDefault();
      let dx = p.x - s.ox;
      let dy = p.y - s.oy;
      const d = Math.hypot(dx, dy);
      const R = this.radius;
      if (d > R) {
        // Drag the base along: the thumb never runs out of stick.
        const pull = d - R;
        s.ox += (dx / d) * pull;
        s.oy += (dy / d) * pull;
        dx = p.x - s.ox;
        dy = p.y - s.oy;
        s.el.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
      }
      const nx = dx / R;
      const ny = -dy / R; // screen up = forward
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
    if (this.layout === "ffa" && this.ffaKey(e, k, true)) {
      this.keys.add(k);
      return;
    }
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
    else if (k === "g") this.onWheel?.(true, gameSize().w / 2, gameSize().h / 2);
    else if (k === "1" || k === "2" || k === "3") this.attack(ATTACK_KINDS[Number(k) - 1]);
    else if (k === "f") this.grab();
    else if (k === "y") this.onQuick?.();
    else if (k === "m") this.onMap?.();
    else if (k === "k") this.onFeed?.();
    else if (k === "tab") {
      e.preventDefault();
      this.onScoreboard?.(true);
    }
    this.keys.add(k);
  };

  private keyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
    if (!this.enabled) return;
    if (this.layout === "ffa") this.ffaKey(e, k, false);
    if (k === "tab") this.onScoreboard?.(false);
    if (k === "shift") {
      this.shiftSprint = false;
      this.setSprint(false);
    } else if (k === "c") {
      clearTimeout(this.crouchTimer);
      if (performance.now() - this.crouchDownAt < PRONE_HOLD_MS) this.setStance(this.stance === 0 ? 1 : 0);
    }
  };

  /** Free For All's own keys (true: taken). */
  private ffaKey(e: KeyboardEvent, k: string, down: boolean): boolean {
    if (k === "control") {
      this.braceKey = down;
      return true;
    }
    if (k === "e") {
      this.onInteract?.(down);
      return true;
    }
    if (!down) return false;
    if (k === "f") this.attack("fist");
    else if (k === "r") this.attack("slap");
    else if (k === "x") this.attack("push");
    else if (k === "q") this.grab();
    else if (k === "b") this.onPack?.();
    else if (k === "n" && this.driving) this.onRadio?.();
    else if (/^digit\d$/.test(e.code.toLowerCase())) {
      const d = Number(e.code.slice(5));
      this.onSlot?.(d === 0 ? 9 : d - 1, e.shiftKey);
    } else return false;
    return true;
  }
}
