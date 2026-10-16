// Host: inside the EMILGO app, in a React Native WebView (or an iframe on
// EMILGO's web build). The app injects `window.__EMILGO_GAMES_HOST__` before the page
// runs, and the two sides talk with small JSON messages tagged `emilgo: 1`.
//
//   app → game   pause | resume | back
//   game → app   ready | haptic | save | exit
//
// Storage goes to the app's AsyncStorage (via `save`), because a WebView loaded
// from an HTML string has no stable origin for localStorage.
//
// This copy of the game never loads the Vatar SDK and never talks to Lagos
// Life: an EMILGO account and a Lagos Life player are never linked.

import {
  type HapticKind,
  type Host,
  type Leaderboard,
  type Player,
  Signal,
} from "./types";

export interface EmilgoBoot {
  host: "emilgo";
  v: 1;
  name?: string;
  saved?: Record<string, string>;
  /** wss:// address of the EMILGO Games server, from EXPO_PUBLIC_GAMES_SERVER. */
  server?: string;
}

declare global {
  interface Window {
    __EMILGO_GAMES_HOST__?: EmilgoBoot;
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

type Incoming = { emilgo: 1; type: "pause" | "resume" | "back" };

class EmilgoHost implements Host {
  readonly kind = "emilgo" as const;
  mode: "live" | "test" | "local" = "local";
  player: Player;
  readonly can = { leaderboard: false, exit: true };
  blocked: string | null = null;
  readonly server: string | null;
  /** Never: an EMILGO account is never linked to a Lagos Life player. */
  readonly matches = null;
  /** No shop in EMILGO: the cosmetics are sold only through Lagos Life. */
  readonly shop = null;

  private readonly store: Map<string, string>;
  private readonly pause = new Signal();
  private readonly resume = new Signal();
  private readonly back = new Signal();
  private readonly identity = new Signal<Player>();

  constructor(boot: EmilgoBoot) {
    this.player = { id: null, name: (boot.name || "You").slice(0, 40), avatar: null };
    this.server = typeof boot.server === "string" && /^wss?:\/\//.test(boot.server) ? boot.server : null;
    this.store = new Map(Object.entries(boot.saved ?? {}).filter(([, v]) => typeof v === "string"));

    const onMessage = (e: Event) => {
      const me = e as MessageEvent;
      // On EMILGO web the game is an iframe: only its parent may talk to it.
      if (!window.ReactNativeWebView && me.source && me.source !== window.parent) return;
      this.handle(me.data);
    };
    window.addEventListener("message", onMessage);
    // Android's WebView delivers to document, iOS to window.
    document.addEventListener("message", onMessage as EventListener);

    this.post({ type: "ready" });
  }

  private handle(raw: unknown): void {
    let m: Incoming | null = null;
    try {
      m = (typeof raw === "string" ? JSON.parse(raw) : raw) as Incoming;
    } catch {
      return;
    }
    if (!m || m.emilgo !== 1) return;
    if (m.type === "pause") this.pause.emit();
    else if (m.type === "resume") this.resume.emit();
    else if (m.type === "back") this.back.emit();
  }

  private post(msg: Record<string, unknown>): void {
    const json = JSON.stringify({ emilgo: 1, ...msg });
    try {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(json);
      else if (window.parent !== window) window.parent.postMessage(json, "*");
    } catch {
      /* host gone */
    }
  }

  onPause(fn: () => void) {
    return this.pause.on(fn);
  }
  onResume(fn: () => void) {
    return this.resume.on(fn);
  }
  onBack(fn: () => void) {
    return this.back.on(fn);
  }
  onIdentity(fn: (p: Player) => void) {
    return this.identity.on(fn);
  }

  submitScore(): void {
    /* No shared board in EMILGO yet; the best score is kept locally. */
  }

  leaderboard(): Promise<Leaderboard> {
    return Promise.resolve({ top: [], me: null });
  }

  haptic(kind: HapticKind): void {
    this.post({ type: "haptic", kind });
  }

  load(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  save(key: string, value: string): void {
    this.store.set(key, value);
    this.post({ type: "save", key, value });
  }

  exit(): void {
    this.post({ type: "exit" });
  }
}

export function createEmilgoHost(boot: EmilgoBoot): Host {
  return new EmilgoHost(boot);
}
