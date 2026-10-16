// Adaptive resolution. The single biggest lever on a phone GPU is how many
// pixels it shades, so instead of guessing a device class up front we start
// from a sane guess and let measured frame times move the render scale.
//
// Rule of thumb: drop fast (a stutter is felt at once), climb slowly (only
// after several calm seconds), never above 2× — past that nobody can see it.

export type QualityMode = "auto" | "saver" | "sharp";

const STEPS = [0.6, 0.75, 1, 1.25, 1.5, 1.75, 2];

export class QualityGovernor {
  private idx: number;
  private maxIdx: number;
  private samples = 0;
  private total = 0;
  private work = 0;
  /** Asked before any change; false = not now (e.g. she's turning). */
  canApply: () => boolean = () => true;
  private pending = -1;
  private calm = 0;
  private mode: QualityMode = "auto";

  constructor(private readonly apply: (pixelRatio: number) => void) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.maxIdx = this.indexFor(dpr);
    this.idx = Math.min(this.maxIdx, this.indexFor(lowEnd() ? 1 : 1.5));
    this.apply(STEPS[this.idx]);
  }

  setMode(mode: QualityMode): void {
    this.mode = mode;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (mode === "saver") this.idx = this.indexFor(1);
    else if (mode === "sharp") this.idx = this.indexFor(dpr);
    this.maxIdx = this.indexFor(dpr);
    this.idx = Math.min(this.idx, this.maxIdx);
    this.reset();
    this.apply(STEPS[this.idx]);
  }

  /**
   * Feed one frame: `intervalMs` render-to-render, `workMs` the time our own
   * update + render took, `targetMs` the frame time we're aiming for (16.7 at
   * 60 fps, 33.3 at 30). Judged against the TARGET, so a 30 fps menu is not
   * mistaken for a slow phone, and a 60 Hz phone can climb back up.
   *
   * Decides every 60 frames or 1.5 s, whichever comes first — a slow device
   * adapts in seconds, not after 90 slow frames.
   */
  sample(intervalMs: number, workMs: number, targetMs: number): void {
    if (this.mode !== "auto") return;
    this.total += intervalMs;
    this.work += workMs;
    if (++this.samples < 60 && this.total < 1500) return;

    const avg = this.total / this.samples;
    const busy = this.work / this.samples;
    this.samples = 0;
    this.total = 0;
    this.work = 0;

    let want = this.idx;
    if (avg > targetMs * 1.25 && this.idx > 0) {
      want = this.idx - 1;
      this.calm = 0;
    } else if (avg <= targetMs * 1.1 && busy < targetMs * 0.45 && this.idx < this.maxIdx) {
      // Comfortably on time with room to spare, four windows running: one step up.
      if (++this.calm >= 4) {
        want = this.idx + 1;
        this.calm = 0;
      }
    } else {
      this.calm = 0;
    }
    if (want !== this.idx) this.pending = want;
    // A resolution change stalls the GPU for a moment: never while she's turning or watching.
    if (this.pending >= 0 && this.canApply()) {
      this.idx = this.pending;
      this.pending = -1;
      this.apply(STEPS[this.idx]);
    }
  }

  reset(): void {
    this.samples = 0;
    this.total = 0;
    this.work = 0;
    this.calm = 0;
    this.pending = -1;
  }

  private indexFor(ratio: number): number {
    let best = 0;
    for (let i = 0; i < STEPS.length; i++) if (STEPS[i] <= ratio + 1e-3) best = i;
    return best;
  }
}

/** Cheap device-class hint. Wrong guesses are corrected by sampling within seconds. */
export function lowEnd(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory ?? 4;
  return cores <= 4 || mem <= 2;
}
