// Host: framed inside a Vatar world (Lagos Life first), via the Vatar Games SDK.
//
// Rules this file exists to keep (https://lagoslife.app/developers/docs):
//  - the SDK is loaded from lagoslife.app by index.html, never a copy;
//  - Vatar.init() is called first, and nothing else is asked before it answers;
//  - onPause/onResume stop and restart timers and sound;
//  - submitScore: whole numbers, at most one every 20 s per player;
//  - leaderboard: refreshed at most every 30 s (12 calls a minute allowed);
//  - we keep only the per-game pseudonymous id, display name and avatar. We
//    never ask for, store or try to derive anything else (Agreement §8).
//
//  - matches go through Vatar.match.* only; stakes are the world's game money,
//    confirmed on the world's own sheet. We never decide a result here: our
//    server posts it, signed with a secret no phone ever sees.

import { errorCode, errorText } from "./vatarErrors";
import {
  type HapticKind,
  type Host,
  type Leaderboard,
  type MatchHost,
  type ShopHost,
  type MatchView,
  type Player,
  Signal,
  safeStorage,
  vibrate,
} from "./types";

export type VatarMatch = MatchView;

/** The surface of https://lagoslife.app/sdk/vatar-games-v1.js (v1). */
export interface VatarSDK {
  version: string;
  init(): Promise<{ player: { id: string; name: string; avatar: string | null }; session: string; mode: "live" | "test" }>;
  session(): Promise<{ session: string; exp: number }>;
  purchase(productId: string): Promise<{ purchaseId: string; productId: string }>;
  purchases(): Promise<{ purchaseId: string; productId: string }[]>;
  submitScore(n: number): Promise<{ best: number; accepted: boolean }>;
  leaderboard(): Promise<Leaderboard>;
  onPurchase(fn: (p: { purchaseId: string; productId: string }) => void): () => void;
  onPause(fn: () => void): () => void;
  onResume(fn: () => void): () => void;
  match: {
    create(o: { stake: number; seats: number }): Promise<VatarMatch>;
    join(code: string): Promise<VatarMatch>;
    quick(o: { stake: number }): Promise<VatarMatch>;
    leave(): Promise<VatarMatch | null>;
    current(): Promise<VatarMatch | null>;
    onUpdate(fn: (m: VatarMatch) => void): () => void;
  };
}

declare global {
  interface Window {
    Vatar?: VatarSDK;
  }
}

/** Whole naira, 0…₦100,000 — the platform's per-match cap. */
function wholeStake(n: number): number {
  return Math.max(0, Math.min(100_000, Math.round(Number(n) || 0)));
}

/** A best score not yet confirmed by Lagos Life (offline, or the call failed). */
const QUEUE_KEY = "score.queue.v1";
const SCORE_GAP_MS = 20_500; // the platform's 20 s, plus a little slack for clock drift
const BOARD_TTL_MS = 30_000;

class LagosLifeHost implements Host {
  readonly kind = "lagoslife" as const;
  mode: "live" | "test" | "local" = "local";
  player: Player = { id: null, name: "Player", avatar: null };
  readonly can = { leaderboard: false, exit: false };
  blocked: string | null = null;
  readonly server = null;
  readonly matches: MatchHost;
  readonly shop: ShopHost;

  private identified = false;
  private readonly pause = new Signal();
  private readonly resume = new Signal();
  private readonly identity = new Signal<Player>();
  private readonly storage = safeStorage("emilgo-games.ll.");

  // submitScore throttle
  private best = 0;
  private pending = 0;
  private lastSent = 0;
  private timer: ReturnType<typeof setTimeout> | 0 = 0;

  // leaderboard cache
  private board: Leaderboard | null = null;
  private boardAt = 0;

  constructor(private readonly sdk: VatarSDK) {
    sdk.onPause(() => this.pause.emit());
    sdk.onResume(() => this.resume.emit());
    const m = sdk.match;
    this.matches = {
      create: (stake, seats) => m.create({ stake: wholeStake(stake), seats: Math.max(2, Math.min(4, Math.round(seats))) }),
      join: (code) => m.join(code.toUpperCase()),
      quick: (stake) => m.quick({ stake: wholeStake(stake) }),
      leave: () => m.leave(),
      current: () => m.current(),
      onUpdate: (fn) => m.onUpdate(fn),
      session: async () => (await sdk.session()).session,
    };
    this.shop = {
      purchase: (productId) => sdk.purchase(productId),
      purchases: () => sdk.purchases(),
      onPurchase: (fn) => sdk.onPurchase(fn),
      session: async () => (await sdk.session()).session,
    };
  }

  identify(r: Awaited<ReturnType<VatarSDK["init"]>>): void {
    this.identified = true;
    this.mode = r.mode === "test" ? "test" : "live";
    this.player = {
      id: r.player.id,
      name: (r.player.name || "Player").slice(0, 40),
      avatar: typeof r.player.avatar === "string" && r.player.avatar.startsWith("data:image/") ? r.player.avatar : null,
    };
    this.can.leaderboard = true;
    this.identity.emit(this.player);
    // A best score from a round played offline (or one that never landed): send it now.
    const queued = Number(this.load(QUEUE_KEY) ?? 0);
    if (queued > 0) this.submitScore(queued);
    window.addEventListener("online", () => this.pending > this.best && this.flush());
  }

  failInit(code: string): void {
    if (code === "off") this.blocked = errorText({ code });
    // signed_out, timeout, error: play on as a guest without a board.
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
  onIdentity(fn: (p: Player) => void) {
    return this.identity.on(fn);
  }

  submitScore(score: number): void {
    const n = Math.floor(score);
    if (!this.identified || !isFinite(n) || n <= 0) return;
    if (n <= this.best || n <= this.pending) return;
    this.pending = n;
    // Kept until Lagos Life confirms it: offline now, it goes when we're back.
    this.save(QUEUE_KEY, String(n));
    this.flush();
  }

  private flush(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.lastSent + SCORE_GAP_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = 0;
      const n = this.pending;
      if (n <= this.best) return;
      // No network: wait for the "online" event instead of burning a try.
      if (navigator.onLine === false) return;
      this.lastSent = Date.now();
      this.sdk
        .submitScore(n)
        .then((r) => {
          this.best = Math.max(this.best, Number(r?.best) || n);
          this.board = null; // our row changed
          if (this.pending <= this.best) this.save(QUEUE_KEY, "0");
          if (this.pending > this.best) this.flush();
        })
        .catch((e) => {
          const code = errorCode(e);
          // Transient: try again after the gap. Anything else (signed_out, off): drop it.
          if (code === "too_soon" || code === "rate_limited" || code === "timeout" || code === "error") this.flush();
        });
    }, wait);
  }

  async leaderboard(): Promise<Leaderboard> {
    if (this.board && Date.now() - this.boardAt < BOARD_TTL_MS) return this.board;
    try {
      const r = await this.sdk.leaderboard();
      this.board = {
        top: Array.isArray(r?.top) ? r.top.slice(0, 50) : [],
        me: r?.me ?? null,
      };
      this.boardAt = Date.now();
      return this.board;
    } catch (e) {
      if (this.board) return this.board;
      throw e;
    }
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

  exit(): void {
    /* The world's own top bar closes the game. */
  }
}

/**
 * Resolves with a host once init answers, or after `softTimeoutMs` as a guest
 * (identity then arrives through onIdentity). Resolves null when the SDK says
 * we are not inside a world at all, so the caller can fall back.
 */
export function createLagosLifeHost(sdk: VatarSDK, softTimeoutMs = 3500): Promise<Host | null> {
  return new Promise((resolve) => {
    const host = new LagosLifeHost(sdk);
    let settled = false;
    const done = (h: Host | null) => {
      if (settled) return;
      settled = true;
      resolve(h);
    };
    const timer = setTimeout(() => done(host), softTimeoutMs);

    sdk
      .init()
      .then((r) => {
        clearTimeout(timer);
        host.identify(r);
        done(host);
      })
      .catch((e) => {
        clearTimeout(timer);
        const code = errorCode(e);
        if (code === "not_framed") {
          done(null);
          return;
        }
        host.failInit(code);
        done(host);
      });
  });
}
