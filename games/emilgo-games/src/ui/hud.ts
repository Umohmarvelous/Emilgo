// In-play HUD, laid out like Call of Duty Mobile's: minimap top left, score top
// right, the signal at the top centre, buttons bottom right (input/controls).
//
// The signal never relies on colour alone — red/green is the commonest
// colour-blindness — so each state has its own icon and word too: WAKA,
// SHE DEY TURN, FREEZE. The song's words are shown as they are sung, so playing
// muted costs nothing — and, like the music, they say nothing about when she
// will stop.

import { FIELD, DOLL_Z } from "../config";
import { el, fmtTime } from "./dom";
import { icon } from "./icons";

export type Signal = "count" | "go" | "turning" | "stop" | "back" | "safe" | "out" | "none";

const SIGNAL: Record<Exclude<Signal, "count" | "none">, [string, string]> = {
  go: ["play", "Waka"],
  turning: ["eye", "She dey turn"],
  stop: ["pause", "Freeze"],
  back: ["refresh", "Small small"],
  safe: ["flag", "You don cross"],
  out: ["close", "Out"],
};

export interface MapDot {
  x: number;
  z: number;
  out: boolean;
  safe: boolean;
  me: boolean;
}

export class Hud {
  readonly root = el("div", "hud");
  readonly pauseBtn = el("button", "ibtn glass");
  readonly viewBtn = el("button", "ibtn glass");
  private readonly score = el("div", "score");
  private readonly timer = el("b", "num");
  private readonly timerRow = el("div", "r");
  private readonly alive = el("b", "num");
  private readonly dist = el("b", "num");
  private readonly stam = el("div", "bar stam");
  private readonly stamFill = el("i");
  private readonly ping = el("div", "ping glass");
  private readonly conn = el("div", "conn glass", "Reconnecting…");
  private lastPing = -1;
  private readonly signal = el("div", "none",);
  private readonly sigIcon = el("span", "sig-ico");
  private readonly sigText = el("span", "sig-text");
  private readonly song = el("div", "song");
  private readonly songTitle = el("span", "song-title");
  private readonly songWords = el("div", "song-words");
  private words: string[] | null = null;
  private chips: HTMLElement[] = [];
  private readonly mapBox = el("div", "minimap");
  private readonly mapCanvas = el("canvas");
  private readonly mapCtx: CanvasRenderingContext2D;
  private readonly feed = el("div", "feed");
  private readonly hint = el("div", "hint glass");
  private readonly verdict = el("div", "verdict");
  private readonly vignette = el("div", "vignette");
  private readonly reticle = el("div", "reticle");
  private accents: string[] = [];
  private lastTimer = "";
  private lastAlive = "";
  private lastDist = "";
  private lastSignal: Signal | "" = "";
  private lastLit = -2;
  private lastCount = -1;
  private mapAt = 0;

  constructor() {
    this.pauseBtn.innerHTML = icon("pause", "", 20);
    this.pauseBtn.setAttribute("aria-label", "Pause");
    this.pauseBtn.dataset.ui = "1";
    this.viewBtn.innerHTML = icon("fpv", "", 20);
    this.viewBtn.setAttribute("aria-label", "Switch view");
    this.viewBtn.dataset.ui = "1";

    const row = (ico: string, label: string, value: HTMLElement) => {
      const r = el("div", "r");
      r.innerHTML = `${icon(ico, "", 12)}<span>${label}</span>`;
      r.append(value);
      return r;
    };
    this.timerRow.innerHTML = `${icon("timer", "", 32)}<span>Time</span>`;
    this.timerRow.append(this.timer);
    this.stam.append(this.stamFill);
    this.score.append(this.timerRow, row("people", "Alive", this.alive), row("flag", "Run", this.dist), this.stam);
    this.stam.title = "Stamina";

    const tl = el("div", "tr");
    this.mapBox.append(this.mapCanvas);
    tl.append(this.mapBox);
    const tr = el("div", "tl");
    tr.append(this.ping, this.score, this.viewBtn, this.pauseBtn);
    this.ping.hidden = true;
    this.ping.innerHTML = `<i class="dot on"></i><span></span>`;
    this.conn.setAttribute("role", "status");
    this.mapCtx = this.mapCanvas.getContext("2d")!;

    this.signal.append(this.sigIcon, this.sigText);
    this.signal.setAttribute("role", "status");
    this.signal.setAttribute("aria-live", "assertive");
    // this.song.append(this.songTitle, this.songWords);
    this.song.setAttribute("aria-hidden", "true");

    this.root.append(this.vignette, tl, tr, this.signal, this.song, this.feed, this.hint, this.conn, this.verdict, this.reticle);
    this.show(false);
  }

  show(on: boolean): void {
    this.root.classList.toggle("visible", on);
  }

  reset(contestants: { accent: string; me: boolean }[]): void {
    this.accents = contestants.map((c) => c.accent);
    this.feed.replaceChildren();
    this.verdict.className = "verdict";
    this.vignette.className = "vignette";
    this.lastTimer = this.lastAlive = this.lastDist = "";
    this.lastSignal = "";
    this.lastLit = -2;
    this.lastCount = -1;
    this.words = null;
    this.setLyrics(null, -1);
    this.sizeMap();
  }

  private sizeMap(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.mapBox.getBoundingClientRect();
    const w = Math.max(60, Math.round((r.width || 92) * dpr));
    const h = Math.max(80, Math.round((r.height || 132) * dpr));
    if (this.mapCanvas.width !== w) this.mapCanvas.width = w;
    if (this.mapCanvas.height !== h) this.mapCanvas.height = h;
  }

  setFirstPerson(on: boolean): void {
    this.reticle.classList.toggle("visible", on);
    this.viewBtn.innerHTML = icon(on ? "tpv" : "fpv", "", 20);
    this.viewBtn.setAttribute("aria-label", on ? "Third person" : "First person");
  }

  /** Online rounds show the round trip; practice doesn't. */
  setOnline(on: boolean): void {
    this.ping.hidden = !on;
    this.lastPing = -1;
    if (!on) this.setConnection("ok");
  }

  setPing(ms: number): void {
    const v = Math.round(ms / 10) * 10;
    if (v === this.lastPing) return;
    this.lastPing = v;
    (this.ping.lastElementChild as HTMLElement).textContent = ms <= 0 ? "…" : v < 10 ? "<10ms" : `${v}ms`;
    this.ping.dataset.q = v < 150 ? "good" : v < 300 ? "ok" : "bad";
  }

  setConnection(state: "ok" | "reconnecting" | "lost"): void {
    this.conn.classList.toggle("visible", state !== "ok");
    this.conn.textContent = state === "lost" ? "Connection lost" : "Reconnecting… you're standing still";
  }

  setTimer(seconds: number, urgent: boolean): void {
    const t = fmtTime(seconds);
    if (t !== this.lastTimer) {
      this.timer.textContent = t;
      this.lastTimer = t;
    }
    this.timerRow.classList.toggle("urgent", urgent);
  }

  setAlive(n: number, total: number): void {
    const t = `${n}/${total}`;
    if (t !== this.lastAlive) {
      this.alive.textContent = t;
      this.lastAlive = t;
    }
  }

  setDistance(progress01: number): void {
    const t = `${Math.round(Math.max(0, Math.min(1, progress01)) * 100)}%`;
    if (t !== this.lastDist) {
      this.dist.textContent = t;
      this.lastDist = t;
    }
  }

  setStamina(v: number, sprinting: boolean): void {
    this.stamFill.style.width = `${Math.round(v * 100)}%`;
    this.stam.classList.toggle("low", v < 0.2);
    this.stam.classList.toggle("gold", sprinting);
  }

  /** Returns true when the visible countdown number changed (for the beep). */
  setCountdown(n: number, frac: number): boolean {
    const changed = n !== this.lastCount;
    this.lastCount = n;
    if (this.lastSignal !== "count") {
      this.lastSignal = "count";
      this.signal.className = "signal count visible";
      this.sigIcon.innerHTML = `<span class="countring"><svg viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/><circle data-ring cx="14" cy="14" r="12" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="75.4" stroke-dashoffset="0"/></svg><b></b></span>`;
    }
    const b = this.sigIcon.querySelector("b");
    const ring = this.sigIcon.querySelector<SVGCircleElement>("[data-ring]");
    if (b && changed) b.textContent = n > 0 ? String(n) : "";
    if (ring) ring.setAttribute("stroke-dashoffset", String(75.4 * (1 - frac)));
    return changed;
  }

  setSignal(s: Signal): void {
    if (s === this.lastSignal) return;
    this.lastSignal = s;
    if (s === "none" || s === "count") {
      this.signal.className = "signal";
      return;
    }
    const [ico, text] = SIGNAL[s];
    this.sigIcon.innerHTML = icon(ico, "ico-pop", 18);
    this.sigText.textContent = text;
    this.signal.className = `signal ${s} visible`;
    this.vignette.classList.toggle("watch", s === "stop");
  }

  setSongTitle(title: string): void {
    this.songTitle.innerHTML = `${icon("music", "", 10)}<span></span>`;
    (this.songTitle.lastElementChild as HTMLElement).textContent = title;
  }

  /**
   * The line being sung, `lit` = index of the current word. `words` must be the
   * same array for the same line (lyricsAt guarantees it), so chips are rebuilt
   * only when the line changes. `held` greys it out: she has stopped singing.
   */
  setLyrics(words: string[] | null, lit: number, held = false): void {
    this.song.classList.toggle("visible", !!words);
    this.song.classList.toggle("held", held);
    if (!words) return;
    if (words !== this.words) {
      this.words = words;
      this.chips = words.map((w) => el("i", "", w));
      this.songWords.replaceChildren(...this.chips);
      this.lastLit = -2;
    }
    if (lit === this.lastLit) return;
    this.lastLit = lit;
    this.chips.forEach((c, i) => c.classList.toggle("lit", i <= lit));
  }

  /** The minimap: the street from above, Mama at the top, everyone as a dot. */
  setMap(dots: MapDot[], meHeading: number, watching: boolean): void {
    const now = performance.now();
    if (now - this.mapAt < 66) return; // 15 Hz is plenty
    this.mapAt = now;
    const g = this.mapCtx;
    const W = this.mapCanvas.width;
    const H = this.mapCanvas.height;
    const pad = W * 0.1;
    const zTop = DOLL_Z - 2;
    const zBot = FIELD.backLimitZ + 1;
    const X = (x: number) => W / 2 + (x / (FIELD.halfWidth + 1.5)) * (W / 2 - pad);
    const Z = (z: number) => pad + ((z - zTop) / (zBot - zTop)) * (H - 2 * pad);
    g.clearRect(0, 0, W, H);
    // Street.
    g.fillStyle = "rgba(255,255,255,0.06)";
    g.fillRect(X(-FIELD.halfWidth), Z(zTop), X(FIELD.halfWidth) - X(-FIELD.halfWidth), Z(zBot) - Z(zTop));
    // Start and finish lines.
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.fillRect(X(-FIELD.halfWidth), Z(FIELD.startZ), X(FIELD.halfWidth) - X(-FIELD.halfWidth), Math.max(1, H * 0.006));
    g.fillStyle = "#ffd700";
    g.fillRect(X(-FIELD.halfWidth), Z(FIELD.finishZ), X(FIELD.halfWidth) - X(-FIELD.halfWidth), Math.max(1.5, H * 0.01));
    // Mama.
    g.fillStyle = watching ? "#b71c1c" : "#ffffff";
    g.beginPath();
    g.arc(X(0), Z(DOLL_Z), W * 0.06, 0, Math.PI * 2);
    g.fill();
    const r = W * 0.035;
    for (const d of dots) {
      if (d.me) continue;
      g.globalAlpha = d.out ? 0.3 : 1;
      g.fillStyle = d.safe ? "#00a865" : "#ffffff";
      g.beginPath();
      g.arc(X(d.x), Z(d.z), r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    const me = dots.find((d) => d.me);
    if (me) {
      // You: an arrow pointing where you face.
      const cx = X(me.x);
      const cy = Z(me.z);
      const s = W * 0.07;
      g.save();
      g.translate(cx, cy);
      g.rotate(-meHeading + Math.PI);
      g.fillStyle = me.out ? "#808080" : "#00a865";
      g.strokeStyle = "#ffffff";
      g.lineWidth = Math.max(1, W * 0.012);
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s * 0.7, s * 0.7);
      g.lineTo(0, s * 0.35);
      g.lineTo(-s * 0.7, s * 0.7);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
    void this.accents;
  }

  pushFeed(text: string, kind: "out" | "safe" | "info" = "info"): void {
    const item = el("div", `feed-item ${kind}`, text);
    this.feed.prepend(item);
    while (this.feed.children.length > 4) this.feed.lastElementChild?.remove();
    setTimeout(() => item.classList.add("gone"), 2600);
    setTimeout(() => item.remove(), 3200);
  }

  setHint(text: string | null): void {
    this.hint.textContent = text ?? "";
    this.hint.classList.toggle("visible", !!text);
  }

  showVerdict(kind: "out" | "safe" | "time"): void {
    this.verdict.innerHTML = `${icon(kind === "safe" ? "flag" : kind === "time" ? "timer" : "close", "", 18)}<span>${kind === "safe" ? "Safe" : kind === "time" ? "Time up" : "Eliminated"}</span>`;
    this.verdict.className = `verdict ${kind === "safe" ? "safe" : "dead"} visible`;
    if (kind !== "safe") this.vignette.className = "vignette dead";
  }

  clearVerdict(): void {
    this.verdict.className = "verdict";
    this.vignette.className = "vignette";
  }
}
