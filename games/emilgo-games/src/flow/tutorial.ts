// The tutorial (SPEC-V2 §1.5), for every game: not a video file but the game
// itself — a model plays a real round in the 3D engine while the rules are
// narrated and each step is highlighted. A few KB instead of megabytes
// (SPEC-V2 Decisions: Tutorial "video").
//
//   steps      the game's script: titles, what's said, what on screen to light up
//   captions   always on screen (bottom centre); the step list on the side
//   voice      the phone's own text-to-speech, when sound is on and the phone
//              has it (no recordings, nothing downloaded)
//
// This file is only the player. Each game supplies the steps and the model's
// brain (rlgl/tutorial.ts) and tells the player when a step happens.

import { esc } from "../ui/dom";
import { icon } from "../ui/icons";
import type { TutorialStep } from "./step";

export type { TutorialStep };

export class TutorialPlayer {
  readonly root: HTMLDivElement;
  private steps: TutorialStep[] = [];
  private readonly shown = new Set<string>();
  private voice = false;
  private lit: Element | null = null;
  private closeFn: () => void = () => {};

  constructor(ui: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "tut";
    this.root.dataset.ui = "1";
    ui.append(this.root);
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tut]");
      if (b) this.closeFn();
    });
  }

  get open(): boolean {
    return this.root.classList.contains("visible");
  }

  onClose(fn: () => void): void {
    this.closeFn = fn;
  }

  start(title: string, steps: TutorialStep[], voice: boolean): void {
    this.steps = steps;
    this.shown.clear();
    this.voice = voice && typeof speechSynthesis !== "undefined";
    this.root.innerHTML = `<div class="tut-head"><span class="label">Tutorial</span><b>${esc(title)}</b></div>
      <ol class="tut-steps">${steps.map((s) => `<li data-step="${esc(s.id)}">${esc(s.title)}</li>`).join("")}</ol>
      <div class="tut-cap" aria-live="polite"><b></b><span></span></div>
      <button class="ibtn glass tut-close" data-tut="close" aria-label="Close tutorial">${icon("close", "", 18)}</button>
      <button class="btn primary tut-done" data-tut="done">Got it</button>`;
    this.root.classList.add("visible");
    this.root.classList.remove("finished");
  }

  /** Light up a step (each once, in whatever order the game plays them): the list, the caption, the voice, the ring. */
  show(id: string): void {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0 || this.shown.has(id)) return;
    this.shown.add(id);
    const step = this.steps[i];
    this.root.querySelectorAll<HTMLElement>("[data-step]").forEach((li, k) => {
      li.classList.toggle("on", k === i);
      li.classList.toggle("done", k !== i && this.shown.has(this.steps[k].id));
    });
    const cap = this.root.querySelector(".tut-cap")!;
    cap.querySelector("b")!.textContent = step.title;
    cap.querySelector("span")!.textContent = step.say;
    cap.classList.remove("in");
    void (cap as HTMLElement).offsetWidth;
    cap.classList.add("in");
    this.ring(step.hi ? document.querySelector(step.hi) : null);
    this.speak(step.say);
  }

  /** The round is over: every step done, and the Got it button. */
  finish(): void {
    this.root.classList.add("finished");
  }

  close(): void {
    this.root.classList.remove("visible", "finished");
    this.root.replaceChildren();
    this.ring(null);
    if (this.voice) speechSynthesis.cancel();
  }

  private ring(el: Element | null): void {
    this.lit?.classList.remove("tut-hi");
    this.lit = el;
    el?.classList.add("tut-hi");
  }

  private speak(text: string): void {
    if (!this.voice) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      // A Nigerian English voice if the phone has one, else its own English.
      const v = speechSynthesis.getVoices();
      u.voice = v.find((x) => /en[-_]NG/i.test(x.lang)) ?? v.find((x) => /^en/i.test(x.lang)) ?? null;
      u.rate = 1.02;
      speechSynthesis.speak(u);
    } catch {
      this.voice = false;
    }
  }
}
