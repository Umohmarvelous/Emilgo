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

import { t, translateTree } from "./i18n";
import { DEFAULT_COURSE, MODE_NAME, type Course } from "../config";
import { el, fmtTime } from "./dom";
import { icon } from "./icons";
import { Minimap, type MapMark } from "./minimap";

export type { MapMark } from "./minimap";

/** The compass's item diamond: everyday items warm white, Airfall's gold, a loot bag green, a crate red. */
export interface ItemPin {
  x: number;
  z: number;
  /** Items (above); Free For All's objective: the flag (gold), a goal (a drop zone, the rally point), a rival holding the flag (red, glowing). */
  kind: "item" | "rare" | "bag" | "crate" | "flag" | "goal" | "hot";
}
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

  /** Matches draw their own lines: drop the last Ball Haunt round's. */
  clearCourse(): void {
    this.modeLine.textContent = this.aliveLine.textContent = this.runLine.textContent = "";
    this.lastAlive = this.lastRun = "";
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
    this.conn.textContent = t(state === "lost" ? "Connection lost" : "Reconnecting… you're standing still");
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
    const line = t(`${n} / ${total} in`);
    if (line !== this.lastAlive) {
      this.aliveLine.textContent = line;
      this.lastAlive = line;
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
   * The compass: `yaw` is where the camera looks (0 = north, towards the finish).
   * The finish's pin (the eye in the sky) sits at its bearing from you.
   */
  private compassW = 0;
  private compassReads = 0;
  private stripX = Number.NaN;
  private pinX = Number.NaN;

  setCompass(
    yaw: number,
    me: { x: number; z: number },
    doll: { x: number; z: number; watching: boolean } | null,
    places: readonly { name: string; x: number; z: number }[] = [],
    item: ItemPin | null = null,
    goal: ItemPin | null = null,
  ): void {
    // The camera looks along (−sin yaw, −cos yaw): north (−z) at yaw 0, east (+x) at yaw −π/2.
    const deg = (d: number) => ((d % 360) + 360) % 360;
    const heading = deg((-yaw * 180) / Math.PI);
    // Its width, read once in a while: reading layout every frame forces a reflow.
    if (!this.compassW || ++this.compassReads % 120 === 0) this.compassW = this.compass.clientWidth || 260;
    const w = this.compassW;
    const sx = Math.round((w / 2 - (360 + heading) * 2) * 2) / 2;
    if (sx !== this.stripX) {
      this.stripX = sx;
      this.strip.style.transform = `translateX(${sx}px)`;
    }
    const relOf = (x: number, z: number) => {
      const r = deg((Math.atan2(x - me.x, -(z - me.z)) * 180) / Math.PI) - heading;
      return ((r + 540) % 360) - 180;
    };
    this.dollPin.hidden = !doll;
    if (doll) {
      const rel = relOf(doll.x, doll.z);
      const x = w / 2 + rel * 2;
      const px = Math.round(Math.max(4, Math.min(w - 4, x)) * 2) / 2;
      if (px !== this.pinX) {
        this.pinX = px;
        this.dollPin.style.transform = `translateX(${px}px)`;
      }
      this.dollPin.classList.toggle("edge", Math.abs(rel * 2) > w / 2);
      this.dollPin.classList.toggle("watch", doll.watching);
    }
    this.placePins(places, me, w, relOf);
    this.itemPin(item, w, relOf);
    this.goalPin(goal, w, relOf);
  }

  /** Free For All: the objective's pin (a flag shape), at its bearing. */
  private readonly goalEl = el("i", "goalpin");
  private goalX = Number.NaN;
  private goalKind = "";
  private goalPin(p: ItemPin | null, w: number, relOf: (x: number, z: number) => number): void {
    if (!this.goalEl.parentElement) this.compass.append(this.goalEl);
    this.goalEl.hidden = !p;
    if (!p) return;
    const rel = relOf(p.x, p.z);
    const x = Math.round(Math.max(6, Math.min(w - 6, w / 2 + rel * 2)) * 2) / 2;
    if (x !== this.goalX) {
      this.goalX = x;
      this.goalEl.style.transform = `translateX(${x}px)`;
    }
    if (p.kind !== this.goalKind) {
      this.goalKind = p.kind;
      this.goalEl.className = `goalpin ${p.kind}`;
    }
    this.goalEl.classList.toggle("edge", Math.abs(rel * 2) > w / 2);
  }

  /**
   * Open worlds (SPEC-V3 §7): a diamond for the nearest item you don't
   * already carry, a loot bag or a crate, at its bearing; dimmed at the edge
   * when it's behind you.
   */
  private readonly itemEl = el("i", "itempin");
  private itemX = Number.NaN;
  private itemKind = "";
  private itemPin(p: ItemPin | null, w: number, relOf: (x: number, z: number) => number): void {
    if (!this.itemEl.parentElement) this.compass.append(this.itemEl);
    this.itemEl.hidden = !p;
    if (!p) return;
    const rel = relOf(p.x, p.z);
    const x = Math.round(Math.max(4, Math.min(w - 4, w / 2 + rel * 2)) * 2) / 2;
    if (x !== this.itemX) {
      this.itemX = x;
      this.itemEl.style.transform = `translateX(${x}px) rotate(45deg)`;
    }
    if (p.kind !== this.itemKind) {
      this.itemKind = p.kind;
      this.itemEl.className = `itempin ${p.kind}`;
    }
    this.itemEl.classList.toggle("edge", Math.abs(rel * 2) > w / 2);
  }

  /**
   * Open worlds: a small pin for each landmark within 250 m at its bearing,
   * and the name of the one nearest the middle (within 12°) under the strip.
   */
  private readonly pins: HTMLElement[] = [];
  private readonly placeName = el("span", "placename");
  private lastPlace = "";
  private placePins(places: readonly { name: string; x: number; z: number }[], me: { x: number; z: number }, w: number, relOf: (x: number, z: number) => number): void {
    if (!this.placeName.parentElement && places.length) this.compass.append(this.placeName);
    let best = "";
    let bestRel = 12;
    let n = 0;
    for (const p of places) {
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d > 250 || d < 6) continue;
      const rel = relOf(p.x, p.z);
      if (Math.abs(rel * 2) > w / 2) continue;
      let pin = this.pins[n];
      if (!pin) {
        pin = el("i", "placepin");
        this.pins.push(pin);
        this.compass.append(pin);
      }
      pin.hidden = false;
      pin.style.transform = `translateX(${Math.round((w / 2 + rel * 2) * 2) / 2}px)`;
      n++;
      if (Math.abs(rel) < bestRel) {
        bestRel = Math.abs(rel);
        best = `${p.name} · ${Math.round(d)} m`;
      }
    }
    for (let i = n; i < this.pins.length; i++) this.pins[i].hidden = true;
    if (best !== this.lastPlace) {
      this.lastPlace = best;
      this.placeName.textContent = best;
    }
  }

  /** The minimap and, when open, the full map. */
  setMap(me: { x: number; z: number; heading: number; out: boolean }, marks: readonly MapMark[], doll: { x: number; z: number; watching: boolean } | null, yaw: number): void {
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
    item.textContent = t(text);
    this.feed.prepend(item);
    while (this.feed.children.length > FEED_MAX) this.feed.lastElementChild?.remove();
    setTimeout(() => item.classList.add("gone"), FEED_MS);
    setTimeout(() => item.remove(), FEED_MS + 450);
  }

  showVerdict(kind: "out" | "safe" | "time" | "noball"): void {
    this.verdict.innerHTML = `${icon(kind === "safe" ? "flag" : kind === "time" ? "timer" : kind === "noball" ? "ball" : "close", "", 18)}<span>${kind === "safe" ? "Safe" : kind === "time" ? "Time up" : kind === "noball" ? "No ball left" : "Eliminated"}</span>`;
    translateTree(this.verdict);
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
