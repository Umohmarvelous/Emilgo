// Host: a plain browser tab. Development, and anyone opening the game's URL
// directly. Practice works fully; there is no shared leaderboard.

import {
  type HapticKind,
  type Host,
  type Leaderboard,
  type Player,
  Signal,
  safeStorage,
  vibrate,
} from "./types";

class WebHost implements Host {
  readonly kind = "web" as const;
  mode: "live" | "test" | "local" = "local";
  player: Player = { id: null, name: "You", avatar: null };
  readonly can = { leaderboard: false, exit: false };
  blocked: string | null = null;
  readonly server = null;
  readonly matches = null;
  readonly shop = null;

  private readonly pause = new Signal();
  private readonly resume = new Signal();
  private readonly storage = safeStorage("emilgo-games.web.");

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause.emit();
      else this.resume.emit();
    });
  }

  onPause(fn: () => void) {
    return this.pause.on(fn);
  }
  onResume(fn: () => void) {
    return this.resume.on(fn);
  }
  onBack() {
    return () => {};
  }
  onIdentity() {
    return () => {};
  }
  submitScore(): void {}
  leaderboard(): Promise<Leaderboard> {
    return Promise.resolve({ top: [], me: null });
  }
  haptic(kind: HapticKind): void {
    vibrate(kind);
  }
  load(key: string) {
    return this.storage.load(key);
  }
  save(key: string, value: string) {
    this.storage.save(key, value);
  }
  exit(): void {}
}

export function createWebHost(): Host {
  return new WebHost();
}
