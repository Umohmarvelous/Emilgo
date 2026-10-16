// What the game needs from whoever is hosting it. Three hosts implement this:
//
//   lagoslife  framed inside a Vatar world's Games app; talks to the Vatar SDK
//   emilgo     inside the EMILGO app's WebView; talks to React Native
//   web        a plain browser tab (development, direct links)
//
// The game never asks which host it is in to decide a RULE — only to decide
// what the host can do (a leaderboard, an exit button). The rules are the same
// everywhere.
//
// Hosts are kept strictly apart: a Lagos Life player is never linked to an
// EMILGO account, and nothing from one is stored where the other can read it
// (Vatar Developer Agreement §8.2(b): do not link players across services).

export type HostKind = "lagoslife" | "emilgo" | "web";

export interface Player {
  /** Lagos Life: a per-game pseudonym (p_… live, t_… test). Otherwise null. */
  id: string | null;
  name: string;
  /** Small PNG data URL from Lagos Life, or null. */
  avatar: string | null;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  score: number;
}

export interface Leaderboard {
  top: LeaderboardRow[];
  me: { rank: number | null; label: string; score: number } | null;
}

export type HapticKind = "tap" | "select" | "warning" | "success" | "heavy" | "error";

/** A Lagos Life match as the SDK reports it (Vatar.match.*, onUpdate). */
export interface MatchView {
  id: string;
  code: string;
  status: "open" | "playing" | "done" | "cancelled" | "void";
  stake: number;
  seats: number;
  players: { id: string; name: string }[];
  me: string;
  winner: string | null;
  result: unknown;
  endsAt: number | null;
  mode: "live" | "test";
}

/**
 * Buying through the world's own pay sheet (Vatar.purchase). Only Lagos Life
 * has this. A purchase resolving here proves nothing by itself: our server
 * checks it with Lagos Life before anything is given.
 */
export interface ShopHost {
  purchase(productId: string): Promise<{ purchaseId: string; productId: string }>;
  /** Paid but not yet delivered (after a crash, or a trip to the payment page). */
  purchases(): Promise<{ purchaseId: string; productId: string }[]>;
  onPurchase(fn: (p: { purchaseId: string; productId: string }) => void): () => void;
  session(): Promise<string>;
}

/**
 * Lagos Life matches: real players, optional stakes in the world's game money,
 * confirmed on the world's own sheet. Only the Lagos Life host has this. The
 * result is never decided here — our server posts it, signed.
 */
export interface MatchHost {
  create(stake: number, seats: number): Promise<MatchView>;
  join(code: string): Promise<MatchView>;
  quick(stake: number): Promise<MatchView>;
  leave(): Promise<MatchView | null>;
  current(): Promise<MatchView | null>;
  onUpdate(fn: (m: MatchView) => void): () => void;
  /** A fresh 15-minute session token for our server to verify. */
  session(): Promise<string>;
}

export interface Host {
  readonly kind: HostKind;
  /** "live"/"test" in Lagos Life; "local" elsewhere. */
  mode: "live" | "test" | "local";
  player: Player;
  readonly can: {
    leaderboard: boolean;
    /** The host has its own screen to go back to (EMILGO). */
    exit: boolean;
  };
  /** Set when the world has switched this game off. Play must not start. */
  blocked: string | null;
  /** Game server address supplied by the host (EMILGO), or null to use the build's. */
  readonly server: string | null;
  /** Lagos Life matches, or null where there is no world to hold the stakes. */
  readonly matches: MatchHost | null;
  /** The cosmetics shop, or null where we may not sell (anywhere but Lagos Life). */
  readonly shop: ShopHost | null;

  onPause(fn: () => void): () => void;
  onResume(fn: () => void): () => void;
  /** Hardware back (Android, EMILGO). */
  onBack(fn: () => void): () => void;
  /** Fires when the player's identity arrives late (slow init). */
  onIdentity(fn: (p: Player) => void): () => void;

  /** Fire and forget. The host throttles to its platform's limits. */
  submitScore(score: number): void;
  leaderboard(): Promise<Leaderboard>;
  haptic(kind: HapticKind): void;

  load(key: string): string | null;
  save(key: string, value: string): void;

  exit(): void;
}

/** Tiny listener set, shared by the host implementations. */
export class Signal<T = void> {
  private fns = new Set<(v: T) => void>();
  on(fn: (v: T) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(v: T): void {
    for (const fn of [...this.fns]) {
      try {
        fn(v);
      } catch (e) {
        setTimeout(() => {
          throw e;
        });
      }
    }
  }
}

/** localStorage that never throws: inside a third-party frame it may be blocked. */
export function safeStorage(prefix: string) {
  return {
    load(key: string): string | null {
      try {
        return window.localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    save(key: string, value: string): void {
      try {
        window.localStorage.setItem(prefix + key, value);
      } catch {
        /* blocked or full — settings simply won't persist */
      }
    },
  };
}

export function vibrate(kind: HapticKind): void {
  const pattern: Record<HapticKind, number | number[]> = {
    tap: 8,
    select: 5,
    warning: [12, 40, 12],
    success: [10, 30, 20],
    heavy: 40,
    error: [30, 40, 60],
  };
  try {
    navigator.vibrate?.(pattern[kind]);
  } catch {
    /* not allowed here */
  }
}
