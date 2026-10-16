// The shop's server side: turns a Lagos Life purchase into an item, exactly as
// the docs require (https://lagoslife.app/developers/docs#flow):
//
//   1. who is asking?        POST /session/verify (the game's word is not enough)
//   2. is the purchase real? GET /purchases/{id}: paid or delivered, OUR game,
//                            THIS player, a product we actually sell
//   3. give it ONCE          the store's primary key is the purchaseId
//   4. mark it delivered     POST /purchases/{id}/deliver (safe to repeat)
//
// Refunded: 409, nothing given (and anything given earlier is taken back).
// Webhook purchase.paid: a nudge to do the same steps without waiting for the
// phone — useful when the player closed the game mid-payment.
//
// Tickets: after a verified claim, the server hands back a small signed ticket
// listing what this player owns. The game shows it when going online, so the
// game server can dress them correctly WITHOUT calling Lagos Life for every
// connection (their API allows 600 calls a minute per game; a busy evening
// would blow that in seconds). Tickets are HMAC-signed with TICKET_SECRET and
// expire after a day; a forged or stale one is simply ignored.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { PRODUCT_BY_ID } from "../../src/shop/catalog";
import type { OwnershipStore } from "./store";
import { VatarError, type VatarApi } from "./vatar";

const TICKET_TTL_MS = 24 * 3600_000;

export interface Ticket {
  /** Lagos Life per-game player id. */
  p: string;
  /** Owned product ids. */
  o: string[];
  m: "live" | "test";
  exp: number;
}

export type ClaimResult =
  | { ok: true; owned: string[]; ticket: string; granted: boolean }
  | { ok: false; status: number; error: string };

export class Shop {
  private readonly secret: Buffer;

  constructor(
    private readonly api: VatarApi,
    private readonly store: OwnershipStore,
    ticketSecret: string | undefined,
    private readonly log: (event: string, info: Record<string, unknown>) => void = () => {},
  ) {
    // Without a configured secret, tickets last until this process restarts —
    // fine for one process; several processes MUST share TICKET_SECRET.
    this.secret = ticketSecret && ticketSecret.length >= 32 ? Buffer.from(ticketSecret) : randomBytes(32);
  }

  /** The player claims a purchase they just made (or one restored after a reload). */
  async claim(session: string, purchaseId: string): Promise<ClaimResult> {
    let playerId: string;
    try {
      playerId = (await this.api.verifySession(session)).playerId;
    } catch (e) {
      return fail(e, 401, "verify");
    }
    return this.fulfil(purchaseId, playerId);
  }

  /** What this player owns, plus a fresh ticket. */
  async owned(session: string): Promise<ClaimResult> {
    let playerId: string;
    try {
      playerId = (await this.api.verifySession(session)).playerId;
    } catch (e) {
      return fail(e, 401, "verify");
    }
    const owned = this.store.owned(playerId, this.api.mode);
    return { ok: true, owned, ticket: this.issue(playerId, owned), granted: false };
  }

  /** Webhook nudge: the purchase's own playerId is the owner (checked with the API). */
  async onPaidWebhook(purchaseId: string): Promise<void> {
    try {
      const p = await this.api.getPurchase(purchaseId);
      await this.fulfil(purchaseId, p.playerId);
    } catch (e) {
      this.log("webhook_fulfil_failed", { why: e instanceof VatarError ? e.code : String(e) });
    }
  }

  /** Finish any grant whose "delivered" call didn't land (crash, network). */
  async retryUndelivered(): Promise<void> {
    for (const g of this.store.undelivered()) {
      if (g.mode !== this.api.mode) continue;
      try {
        await this.api.deliver(g.purchaseId);
        this.store.markDelivered(g.purchaseId);
      } catch (e) {
        if (e instanceof VatarError && e.code === "refunded") this.store.revoke(g.purchaseId);
      }
    }
  }

  private async fulfil(purchaseId: string, playerId: string): Promise<ClaimResult> {
    let p;
    try {
      p = await this.api.getPurchase(purchaseId);
    } catch (e) {
      return fail(e, 404, "not_found");
    }
    if (p.playerId !== playerId) {
      this.log("claim_refused", { why: "other_player" });
      return { ok: false, status: 403, error: "not_yours" };
    }
    if (p.status === "refunded") {
      this.store.revoke(p.id);
      return { ok: false, status: 409, error: "refunded" };
    }
    if (p.status !== "paid" && p.status !== "delivered") return { ok: false, status: 409, error: "not_paid" };
    if (!PRODUCT_BY_ID[p.productId]) {
      // Sold in the dashboard but unknown to this build: don't mark it delivered,
      // so it stays in purchases() until a build that knows it ships.
      this.log("claim_refused", { why: "unknown_product", productId: p.productId });
      return { ok: false, status: 422, error: "unknown_product" };
    }

    const granted = this.store.grant({ purchaseId: p.id, playerId, productId: p.productId, mode: p.mode });
    if (granted) this.log("granted", { productId: p.productId, mode: p.mode });
    try {
      await this.api.deliver(p.id);
      this.store.markDelivered(p.id);
    } catch (e) {
      if (e instanceof VatarError && e.code === "refunded") {
        this.store.revoke(p.id);
        return { ok: false, status: 409, error: "refunded" };
      }
      // Granted but not yet marked: retryUndelivered() finishes it later.
      this.log("deliver_deferred", { why: e instanceof VatarError ? e.code : String(e) });
    }
    const owned = this.store.owned(playerId, p.mode);
    return { ok: true, owned, ticket: this.issue(playerId, owned), granted };
  }

  // ── Tickets ────────────────────────────────────────────────────────────────

  issue(playerId: string, owned: string[]): string {
    const t: Ticket = { p: playerId, o: owned, m: this.api.mode, exp: Date.now() + TICKET_TTL_MS };
    const body = Buffer.from(JSON.stringify(t)).toString("base64url");
    return `${body}.${this.sign(body)}`;
  }

  /** The ticket's contents if genuine and current, else null. */
  verify(ticket: unknown): Ticket | null {
    if (typeof ticket !== "string" || ticket.length > 2000) return null;
    const dot = ticket.lastIndexOf(".");
    if (dot < 1) return null;
    const body = ticket.slice(0, dot);
    const want = Buffer.from(this.sign(body));
    const got = Buffer.from(ticket.slice(dot + 1));
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
      const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Ticket;
      if (typeof t.p !== "string" || !Array.isArray(t.o) || t.m !== this.api.mode || !(t.exp > Date.now())) return null;
      return t;
    } catch {
      return null;
    }
  }

  private sign(body: string): string {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }
}

function fail(e: unknown, status: number, fallback: string): ClaimResult {
  if (e instanceof VatarError) {
    const s = e.http === 0 || e.http >= 500 ? 502 : e.http === 404 ? 404 : e.http === 403 ? 403 : status;
    return { ok: false, status: s, error: e.code };
  }
  return { ok: false, status: 502, error: fallback };
}
