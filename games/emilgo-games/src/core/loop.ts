// The frame loop: a fixed 60 Hz simulation inside a capped render loop.
//
// - Fixed step: the referee always sees dt = 1/60, so a slow phone and a fast
//   one judge "moving" identically. At most 5 steps a frame — past that we drop
//   time rather than spiral (a phone waking from a stall must not fast-forward).
// - FPS cap: 120 Hz screens would otherwise draw twice as often for nothing.
//   60 in play, 30 on menus, 30 everywhere in battery-saver.
// - Paused: no rAF at all. A paused game costs zero battery.

export class Loop {
  readonly fixed = 1 / 60;
  /** Scales simulated time (slow motion). Practice only — online play cannot slow the server. */
  timeScale = 1;

  private raf = 0;
  private last = 0;
  private acc = 0;
  private minFrameMs = 1000 / 60 - 2;
  private running = false;
  private stepping = true;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (frameDt: number) => void,
  ) {}

  /** The frame time currently aimed for, ms. */
  targetMs = 1000 / 60;

  setFpsCap(fps: 30 | 60): void {
    this.minFrameMs = 1000 / fps - 2;
    this.targetMs = 1000 / fps;
  }

  /** Whether fixed steps run. Rendering continues either way while started. */
  setStepping(on: boolean): void {
    this.stepping = on;
    this.acc = 0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  get isRunning(): boolean {
    return this.running;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    const elapsed = now - this.last;
    if (elapsed < this.minFrameMs) return;
    this.last = now;

    const dt = Math.min(elapsed / 1000, 0.1);
    if (this.stepping) {
      this.acc += dt * this.timeScale;
      let steps = 0;
      while (this.acc >= this.fixed && steps < 5) {
        this.update(this.fixed);
        this.acc -= this.fixed;
        steps++;
      }
      if (steps === 5) this.acc = 0;
    }
    this.render(dt);
  };
}
