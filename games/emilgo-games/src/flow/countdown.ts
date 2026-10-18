// The countdown (SPEC-V2 §1.3): big numbers 5 → 1 in the centre of the
// screen, no words, each one pulsing in on a bass drop. Then the game begins.
// Driven by the referee's own countdown phase, so it matches on every phone.

export interface CountdownView {
  /** Show n (0: nothing); true when it changed (the pulse restarts). */
  setCountdown(n: number, frac: number): boolean;
}

export class Countdown {
  constructor(
    private readonly view: CountdownView,
    /** The bass drop; `last` for the final number. */
    private readonly drop: (last: boolean) => void,
  ) {}

  /** `left`: seconds of countdown remaining. */
  update(left: number): void {
    const n = Math.max(0, Math.ceil(left - 1e-6));
    if (this.view.setCountdown(n, left - Math.floor(left)) && n > 0) this.drop(n === 1);
  }

  /** Off the screen (the walkout, or play has begun). */
  clear(): void {
    this.view.setCountdown(0, 0);
  }
}
