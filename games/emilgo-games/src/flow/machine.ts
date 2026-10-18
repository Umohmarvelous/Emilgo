// The universal match flow (SPEC-V2 §1), the same for every game:
//
//   lobby → choose → waiting → loading → walkout → preview → countdown → play → end → post → lobby
//
//   choose     the Play menu: Invite Friends, Play with New People, Play Solo vs AI
//   waiting    the waiting room: everyone's model in a circle, ready marks, chat
//   loading    everyone ready: 2 s while the map is built
//   walkout    the walk out of the tunnel (front, side, behind, overhead)
//   preview    the game's field preview; skip shows from here
//   countdown  5 → 1
//   play, end, post   the round, its last moments, the results
//
// Solo skips the waiting room (no one to wait for); a Lagos Life match comes
// in from the platform's own match screens straight to loading. The machine
// only keeps the stage and refuses jumps the flow doesn't allow, so a late
// server message can't drag the screen backwards; what each stage shows is
// the session's business.

export type Stage = "lobby" | "choose" | "waiting" | "loading" | "walkout" | "preview" | "countdown" | "play" | "end" | "post";

const NEXT: Record<Stage, readonly Stage[]> = {
  lobby: ["choose", "waiting", "loading"],
  choose: ["lobby", "waiting", "loading"],
  waiting: ["lobby", "choose", "loading"],
  loading: ["waiting", "walkout", "countdown", "lobby"],
  walkout: ["preview", "countdown"],
  preview: ["countdown"],
  countdown: ["play"],
  play: ["end"],
  end: ["post"],
  post: ["lobby", "choose", "waiting", "loading"],
};

export class MatchFlow {
  private now: Stage = "lobby";
  private readonly listeners: ((to: Stage, from: Stage) => void)[] = [];

  get stage(): Stage {
    return this.now;
  }

  /** Before play: the walkout, the preview or the countdown. */
  get opening(): boolean {
    return this.now === "walkout" || this.now === "preview" || this.now === "countdown";
  }

  /** Move on, if the flow allows it from here. Leaving for the lobby is always allowed. */
  go(to: Stage): boolean {
    if (to === this.now) return false;
    if (to !== "lobby" && !NEXT[this.now].includes(to)) return false;
    const from = this.now;
    this.now = to;
    for (const fn of this.listeners) fn(to, from);
    return true;
  }

  /** Jump straight to a stage (a rejoin mid-round, or back to the lobby on an error). */
  reset(to: Stage): void {
    const from = this.now;
    this.now = to;
    if (from !== to) for (const fn of this.listeners) fn(to, from);
  }

  onChange(fn: (to: Stage, from: Stage) => void): void {
    this.listeners.push(fn);
  }
}
