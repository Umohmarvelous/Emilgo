// The in-play HUD, laid out as Call of Duty Mobile's (SPEC-V2 §3.1–3.2):
//
//   top left     match info, text only: the clock, the mode, who's still in,
//                how far you've run, the round trip online; under it the
//                buttons (pause, settings, scoreboard, first person)
//   top centre   the compass, then the kill feed (text slides in, gone after 5 s)
//   top right    the minimap (round, faded, terrain; tap for the full map)
//   centre       the countdown, the verdict, the first-person dot
//
// Small text, white with a dark outline so it reads on sand or snow, no
// backgrounds on anything that isn't a button. No song name, no lyrics, no
// instructions on the game screen (§3.6).

import { DEFAULT_COURSE, MODE_NAME, type Course } from "../config";
import { el, fmtTime } from "./dom";
import { icon } from "./icons";
import { Minimap, type MapMark } from "./minimap";

export type { MapMark } from "./minimap";
export type Signal = "count" | "none";

const FEED_MS = 5000;
const FEED_MAX = 5;

export class Hud {
  readonly root = el("div", "hud");
  readonly pauseBtn = el("button", "ibtn glass");
  readonly viewBtn = el("button", "ibtn glass");
  readonly settingsBtn = el("button", "ibtn glass");
  readonly boardBtn = el("button", "ibtn glass");
  readonly map: Minimap;
  private readonly info = el("div", "minfo");
  private readonly clock = el("b", "clock");
  private readonly modeLine = el("span", "mline");
  private readonly aliveLine = el("span", "mline");
  private readonly runLine = el("span", "mline");
  private readonly pingLine = el("span", "mline ping");
  private readonly compass = el("div", "compass");
  private readonly strip = el("div", "strip");
  private readonly dollPin = el("i", "dollpin");
  private readonly feed = el("div", "feed");
  private readonly conn = el("div", "conn", "Reconnecting…");
  private readonly count = el("div", "bigcount");
  private readonly verdict = el("div", "verdict");
  private readonly vignette = el("div", "vignette");
  private readonly reticle = el("div", "reticle");
  private course: Course = DEFAULT_COURSE;
  private lastClock = "";
  private lastAlive = "";
  private lastRun = "";
  private lastPing = -1;
  private lastCount = -1;
  private feedOn = true;

  constructor() {
    const btn = (b: HTMLButtonElement, ico: string, label: string) => {
      b.innerHTML = icon(ico, "", 18);
      b.setAttribute("aria-label", label);
      b.dataset.ui = "1";
    };
    btn(this.pauseBtn, "pause", "Pause");
    btn(this.settingsBtn, "gear", "Settings");
    btn(this.boardBtn, "people", "Scoreboard");
    btn(this.viewBtn, "fpv", "First person");

    const tl = el("div", "tl");
    this.info.append(this.clock, this.modeLine, this.aliveLine, this.runLine, this.pingLine);
    const row = el("div", "hbtns");
    row.append(this.pauseBtn, this.settingsBtn, this.boardBtn, this.viewBtn);
    tl.append(this.info, row);
    this.pingLine.hidden = true;

    // Compass: two turns of ticks, so any heading has the strip under it.
    const marks: string[] = [];
    for (let turn = 0; turn < 3; turn++) {
      for (let d = 0; d < 360; d += 15) {
        const label = d === 0 ? "N" : d === 90 ? "E" : d === 180 ? "S" : d === 270 ? "W" : d % 45 === 0 ? String(d) : "";
        marks.push(`<i class="${label ? (label.length === 1 ? "cardinal" : "num") : "tick"}" style="left:${(turn * 360 + d) * 2}px">${label}</i>`);
      }
    }
    this.strip.innerHTML = marks.join("");
    this.compass.append(this.strip, this.dollPin, el("i", "caret"));
    this.compass.setAttribute("aria-hidden", "true");

    const tc = el("div", "tc");
    tc.append(this.compass, this.feed, this.conn);
    this.conn.setAttribute("role", "status");

    const tr = el("div", "tr");
    this.map = new Minimap(this.root);
    tr.append(this.map.root);

    this.count.setAttribute("aria-live", "assertive");
    this.root.append(this.vignette, tl, tc, tr, this.count, this.verdict, this.reticle);
    this.show(false);
  }

  show(on: boolean): void {
    this.root.classList.toggle("visible", on);
    if (!on) this.map.expand(false);
  }

  reset(_contestants: { accent: string; me: boolean }[]): void {
    this.feed.replaceChildren();
    this.verdict.className = "verdict";
    this.vignette.className = "vignette";
    this.count.className = "bigcount";
    this.lastClock = this.lastAlive = this.lastRun = "";
    this.lastCount = -1;
  }

  /** The round's field: the minimap and the match line follow it. */
  setCourse(c: Course): void {
    this.course = c;
    this.modeLine.textContent = `${MODE_NAME[c.mode]} · ${c.distance} m`;
  }

  setFeedOn(on: boolean): void {
    this.feedOn = on;
    this.feed.hidden = !on;
  }

  setFirstPerson(on: boolean): void {
    this.reticle.classList.toggle("visible", on);
    this.viewBtn.innerHTML = icon(on ? "tpv" : "fpv", "", 18);
    this.viewBtn.setAttribute("aria-label", on ? "Third person" : "First person");
  }

  /** Online rounds show the round trip; practice doesn't. */
  setOnline(on: boolean): void {
    this.pingLine.hidden = !on;
    this.lastPing = -1;
    if (!on) this.setConnection("ok");
  }

  setPing(ms: number): void {
    const v = Math.round(ms / 10) * 10;
    if (v === this.lastPing) return;
    this.lastPing = v;
    this.pingLine.textContent = ms <= 0 ? "… ms" : v < 10 ? "<10 ms" : `${v} ms`;
  }

  setConnection(state: "ok" | "reconnecting" | "lost"): void {
    this.conn.classList.toggle("visible", state !== "ok");
    this.conn.textContent = state === "lost" ? "Connection lost" : "Reconnecting… you're standing still";
  }

  setTimer(seconds: number, urgent: boolean): void {
    const t = fmtTime(seconds);
    if (t !== this.lastClock) {
      this.clock.textContent = t;
      this.lastClock = t;
    }
    this.clock.classList.toggle("urgent", urgent);
  }

  setAlive(n: number, total: number): void {
    const t = `${n} / ${total} in`;
    if (t !== this.lastAlive) {
      this.aliveLine.textContent = t;
      this.lastAlive = t;
    }
  }

  setDistance(progress01: number): void {
    const m = Math.round(Math.max(0, Math.min(1, progress01)) * this.course.distance);
    const t = `${m} / ${this.course.distance} m`;
    if (t !== this.lastRun) {
      this.runLine.textContent = t;
      this.lastRun = t;
    }
  }

  /**
   * The compass: `yaw` is where the camera looks (0 = north, towards Mama).
   * Mama's pin sits at her bearing from you.
   */
  setCompass(yaw: number, me: { x: number; z: number }, doll: { x: number; z: number; watching: boolean }): void {
    // The camera looks along (−sin yaw, −cos yaw): north (−z) at yaw 0, east (+x) at yaw −π/2.
    const deg = (d: number) => ((d % 360) + 360) % 360;
    const heading = deg((-yaw * 180) / Math.PI);
    const w = this.compass.clientWidth || 260;
    this.strip.style.transform = `translateX(${w / 2 - (360 + heading) * 2}px)`;
    const bearing = deg((Math.atan2(doll.x - me.x, -(doll.z - me.z)) * 180) / Math.PI);
    let rel = bearing - heading;
    rel = ((rel + 540) % 360) - 180;
    const x = w / 2 + rel * 2;
    this.dollPin.style.transform = `translateX(${Math.max(4, Math.min(w - 4, x))}px)`;
    this.dollPin.classList.toggle("edge", Math.abs(rel * 2) > w / 2);
    this.dollPin.classList.toggle("watch", doll.watching);
  }

  /** The minimap and, when open, the full map. */
  setMap(me: { x: number; z: number; heading: number; out: boolean }, marks: readonly MapMark[], doll: { x: number; z: number; watching: boolean }, yaw: number): void {
    this.map.draw(me, marks, doll, yaw);
  }

  /** Countdown: big numbers, nothing else (SPEC-V2 §1.3). Returns true when the number changed. */
  setCountdown(n: number, _frac: number): boolean {
    const changed = n !== this.lastCount;
    this.lastCount = n;
    if (changed) {
      this.count.textContent = n > 0 ? String(n) : "";
      this.count.className = "bigcount";
      if (n > 0) {
        void this.count.offsetWidth;
        this.count.className = "bigcount pulse";
      }
    }
    return changed;
  }

  setSignal(_s: Signal): void {
    this.count.className = "bigcount";
    this.count.textContent = "";
    this.lastCount = -1;
  }

  /**
   * The kill feed and activity feed (top centre): text only, slides in, gone
   * after 5 s. `kind` only changes the small mark before the text.
   */
  pushFeed(text: string, kind: "out" | "safe" | "info" = "info"): void {
    if (!this.feedOn) return;
    const item = el("div", `feed-item ${kind}`);
    item.textContent = text;
    this.feed.prepend(item);
    while (this.feed.children.length > FEED_MAX) this.feed.lastElementChild?.remove();
    setTimeout(() => item.classList.add("gone"), FEED_MS);
    setTimeout(() => item.remove(), FEED_MS + 450);
  }

  showVerdict(kind: "out" | "safe" | "time" | "noball"): void {
    this.verdict.innerHTML = `${icon(kind === "safe" ? "flag" : kind === "time" ? "timer" : kind === "noball" ? "ball" : "close", "", 18)}<span>${kind === "safe" ? "Safe" : kind === "time" ? "Time up" : kind === "noball" ? "No ball left" : "Eliminated"}</span>`;
    this.verdict.className = `verdict ${kind === "safe" ? "safe" : "dead"} visible`;
    if (kind !== "safe") this.vignette.className = "vignette dead";
  }

  /** A brief red edge round the screen (someone caught as you watch: SPEC-V2 §2.6 step 7). */
  flashRed(): void {
    if (this.vignette.classList.contains("dead")) return;
    this.vignette.className = "vignette";
    void this.vignette.offsetWidth;
    this.vignette.className = "vignette hit";
  }

  clearVerdict(): void {
    this.verdict.className = "verdict";
    this.vignette.className = "vignette";
  }
}
