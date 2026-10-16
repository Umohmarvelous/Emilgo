// The Vatar (Lagos Life) server API: the only place our secrets are used.
// Source of truth: https://lagoslife.app/developers/docs (read 13–14 Oct 2026).
//
//   POST /session/verify            who is this player (token → pseudonymous id)
//   GET  /matches/{id}              the match: players, status, nonce
//   POST /matches/{id}/result       { winner: playerId | "draw" }, SIGNED
//   GET  /purchases/{id}            is this purchase real, paid, and whose?
//   POST /purchases/{id}/deliver    mark it delivered (safe to repeat)
//   webhooks (in index.ts)          match.started / match.settled / purchase.paid
//
// Rules kept here:
//  - Secrets never leave this process. A phone can never post a result.
//  - Every result is signed: X-Vatar-Timestamp (whole seconds) and
//    X-Vatar-Signature = "v1=" + HMAC-SHA256(results secret, five lines:
//    method, path, timestamp, the match's nonce, hex SHA-256 of the exact body).
//  - A result is settled once. 409 already_settled / not_playing: stop retrying.
//  - 429: honour Retry-After. 5xx and network errors: retry with backoff, but
//    each attempt is re-signed with a fresh timestamp (they expire in 5 minutes).
//  - At most 600 API calls a minute per game per mode — budgeted below.
//  - Test and live never mix: the secret's prefix decides the mode, and a
//    session or match of the other mode is refused.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface VatarConfig {
  api: string;
  secret: string;
  resultsSecret: string;
  webhookSecret: string | null;
}

export interface VerifiedSession {
  playerId: string;
  name: string;
  gameId: string;
  exp: number;
  mode: "live" | "test";
}

export interface VatarMatchInfo {
  id: string;
  status: "open" | "playing" | "done" | "cancelled" | "void";
  stake: number;
  seats: number;
  players: { playerId: string; name: string }[];
  winner: string | null;
  result: unknown;
  pot: number;
  payout: number;
  mode: "live" | "test";
  nonce: string;
  createdAt: number;
  startedAt: number | null;
  endsAt: number | null;
  settledAt: number | null;
}

export interface PurchaseInfo {
  id: string;
  productId: string;
  playerId: string;
  amount: number;
  currency: string;
  status: "paid" | "delivered" | "refunded";
  createdAt: number;
  mode: "live" | "test";
}

export class VatarError extends Error {
  constructor(
    readonly http: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Reads the config from the environment. Null when matches are not set up. */
export function vatarConfigFromEnv(env: NodeJS.ProcessEnv): VatarConfig | null {
  const secret = env.VATAR_SECRET?.trim();
  const resultsSecret = env.VATAR_RESULTS_SECRET?.trim();
  if (!secret || !resultsSecret) return null;
  return {
    api: (env.VATAR_API?.trim() || "https://lagoslife.app/api/games/v1").replace(/\/+$/, ""),
    secret,
    resultsSecret,
    webhookSecret: env.VATAR_WEBHOOK_SECRET?.trim() || null,
  };
}

/** The exact signature the docs specify, as a pure function (so it can be tested). */
export function signResult(resultsSecret: string, path: string, ts: string, nonce: string, body: string): string {
  const sha = createHash("sha256").update(body).digest("hex");
  return "v1=" + createHmac("sha256", resultsSecret).update(["POST", path, ts, nonce, sha].join("\n")).digest("hex");
}

/** X-Vatar-Signature on a webhook: "sha256=" + HMAC-SHA256(webhook secret, raw body). Constant time. */
export function webhookSigned(raw: Buffer, header: string | string[] | undefined, secret: string): boolean {
  const want = Buffer.from("sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(String(Array.isArray(header) ? header[0] : header ?? ""));
  return want.length === got.length && timingSafeEqual(want, got);
}

export class VatarApi {
  readonly mode: "live" | "test";
  /** The path prefix of the API base (signatures sign the full path). */
  private readonly basePath: string;
  private readonly calls: number[] = [];
  private pausedUntil = 0;

  constructor(readonly cfg: VatarConfig) {
    this.mode = cfg.secret.startsWith("vtr_live_") ? "live" : "test";
    this.basePath = new URL(cfg.api).pathname.replace(/\/+$/, "");
  }

  async verifySession(session: string): Promise<VerifiedSession> {
    const r = await this.call<VerifiedSession>("POST", "/session/verify", { session });
    if (r.mode !== this.mode) throw new VatarError(403, "wrong_mode");
    if (typeof r.playerId !== "string" || !r.playerId) throw new VatarError(502, "bad_response");
    return r;
  }

  async getMatch(id: string): Promise<VatarMatchInfo> {
    const m = await this.call<VatarMatchInfo>("GET", `/matches/${encodeURIComponent(id)}`);
    if (m.mode !== this.mode) throw new VatarError(403, "wrong_mode");
    if (!Array.isArray(m.players) || typeof m.nonce !== "string") throw new VatarError(502, "bad_response");
    return m;
  }

  /** One purchase in our game. Unpaid, unknown or other games' purchases: 404 not_found. */
  async getPurchase(id: string): Promise<PurchaseInfo> {
    const p = await this.call<PurchaseInfo>("GET", `/purchases/${encodeURIComponent(id)}`);
    if (p.mode !== this.mode) throw new VatarError(403, "wrong_mode");
    if (typeof p.playerId !== "string" || typeof p.productId !== "string") throw new VatarError(502, "bad_response");
    return p;
  }

  /** At startup: one harmless read. A made-up purchase answering 404 means the secret works. */
  async keyCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.getPurchase("__keycheck__");
      return { ok: false, detail: "a made-up purchase was found?!" };
    } catch (e) {
      const err = e instanceof VatarError ? e : new VatarError(0, "network", String(e));
      if (err.http === 404) return { ok: true, detail: `Lagos Life keys OK (${this.mode})` };
      const why = err.http === 0 ? `unreachable (${err.message})` : `${err.http} ${err.code}`;
      return { ok: false, detail: `Lagos Life keys PROBLEM: ${why}` };
    }
  }

  /** Mark delivered. Safe to repeat; a refunded purchase answers 409 refunded. */
  async deliver(id: string): Promise<void> {
    await this.call("POST", `/purchases/${encodeURIComponent(id)}/deliver`, {});
  }

  /**
   * Post the result, signed, retrying transient failures for up to ~4 minutes.
   * Resolves with the settled match, or with null if the platform says it can
   * no longer be settled by us (already settled / not playing).
   */
  async postResult(match: { id: string; nonce: string }, winner: string): Promise<VatarMatchInfo | null> {
    const relPath = `/matches/${encodeURIComponent(match.id)}/result`;
    const body = JSON.stringify({ winner });
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      try {
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = signResult(this.cfg.resultsSecret, this.basePath + relPath, ts, match.nonce, body);
        return await this.call<VatarMatchInfo>("POST", relPath, body, { "X-Vatar-Timestamp": ts, "X-Vatar-Signature": sig });
      } catch (e) {
        const err = e instanceof VatarError ? e : new VatarError(0, "network", String(e));
        if (err.code === "already_settled" || err.code === "not_playing") return null;
        // A bad signature or secret is a bug or a misconfiguration: retrying won't fix it.
        if (err.http >= 400 && err.http < 500 && err.http !== 429) throw err;
        if (Date.now() - started > 240_000) throw err;
        const retryAfter = err.http === 429 ? Math.max(1, this.pausedUntil - Date.now()) : 0;
        await sleep(Math.max(retryAfter, Math.min(30_000, 1000 * 2 ** attempt)));
      }
    }
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  private async call<T>(method: "GET" | "POST", relPath: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    await this.budget();
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    let res: Response;
    try {
      res = await fetch(this.cfg.api + relPath, {
        method,
        body: payload,
        headers: { Authorization: `Bearer ${this.cfg.secret}`, "Content-Type": "application/json", ...extra },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new VatarError(0, "network", String(e));
    }
    if (res.status === 429) {
      const after = Number(res.headers.get("retry-after")) || 5;
      this.pausedUntil = Date.now() + after * 1000;
    }
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* empty or non-JSON body */
    }
    if (!res.ok) throw new VatarError(res.status, typeof json.error === "string" ? json.error : "error", String(json.message ?? ""));
    return json as T;
  }

  /** Stay well under 600 calls a minute, and wait out any Retry-After. */
  private async budget(): Promise<void> {
    for (;;) {
      const t = Date.now();
      if (t < this.pausedUntil) {
        await sleep(this.pausedUntil - t);
        continue;
      }
      while (this.calls.length && t - this.calls[0] > 60_000) this.calls.shift();
      if (this.calls.length < 540) {
        this.calls.push(t);
        return;
      }
      await sleep(60_000 - (t - this.calls[0]) + 10);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
