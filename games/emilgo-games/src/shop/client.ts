// The game's side of the shop. Lagos Life only.
//
//   buy(id)    Vatar.purchase → the world's pay sheet → our server claims it
//              (checks with Lagos Life, gives it once, marks it delivered)
//   boot       ask our server what this player owns, and claim anything paid
//              but undelivered (a crash, or the payment page reloading us)
//   onPurchase a purchase confirmed while we weren't waiting for it → claim
//
// The game never decides you own something. `owned` is only ever what our
// server returned; it is cached so the shop draws instantly next time, and
// refreshed from the server on every boot.

import type { Host, ShopHost } from "../platform/types";
import { PRODUCT_BY_ID } from "./catalog";

const CACHE_KEY = "shop.owned.v1";

export type BuyResult = { ok: true; productId: string } | { ok: false; code: string };

export class ShopClient {
  owned = new Set<string>();
  /** Signed list of what we own, for the game server (see server/src/shop.ts). */
  ticket: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly base: string;

  constructor(
    private readonly host: Host & { shop: ShopHost },
    serverWs: string,
  ) {
    this.base = serverWs.replace(/^ws/, "http").replace(/\/+$/, "");
    try {
      const cached = JSON.parse(host.load(CACHE_KEY) ?? "[]") as unknown;
      if (Array.isArray(cached)) this.owned = new Set(cached.filter((x): x is string => typeof x === "string" && !!PRODUCT_BY_ID[x]));
    } catch {
      /* no cache */
    }
    host.shop.onPurchase((p) => void this.claim(p.purchaseId));
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** What we own (from our server), then anything paid but never delivered. */
  async boot(): Promise<void> {
    try {
      const session = await this.host.shop.session();
      this.apply(await this.post("/shop/owned", { session }));
    } catch {
      /* offline or no server: keep the cached list */
    }
    try {
      const pending = await this.host.shop.purchases();
      for (const p of pending) await this.claim(p.purchaseId);
    } catch {
      /* nothing to restore */
    }
  }

  async buy(productId: string): Promise<BuyResult> {
    let purchase;
    try {
      purchase = await this.host.shop.purchase(productId);
    } catch (e) {
      return { ok: false, code: String((e as { code?: string })?.code ?? "error") };
    }
    const r = await this.claim(purchase.purchaseId);
    return r ? { ok: true, productId } : { ok: false, code: "claim" };
  }

  /** Ask our server to check and deliver. Retries a few times: the item is paid for. */
  async claim(purchaseId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const session = await this.host.shop.session();
        this.apply(await this.post("/shop/claim", { session, purchaseId }));
        return true;
      } catch (e) {
        const status = (e as { status?: number }).status ?? 0;
        // 4xx (not yours, refunded, unknown product) won't change by retrying.
        if (status >= 400 && status < 500 && status !== 429) return false;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    return false;
  }

  private apply(r: { owned?: unknown; ticket?: unknown }): void {
    if (Array.isArray(r.owned)) {
      this.owned = new Set(r.owned.filter((x): x is string => typeof x === "string" && !!PRODUCT_BY_ID[x]));
      this.host.save(CACHE_KEY, JSON.stringify([...this.owned]));
    }
    if (typeof r.ticket === "string") this.ticket = r.ticket;
    for (const fn of this.listeners) fn();
  }

  private async post(path: string, body: object): Promise<{ owned?: unknown; ticket?: unknown }> {
    const r = await fetch(this.base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(String((json as { error?: string }).error ?? r.status)), { status: r.status });
    return json as { owned?: unknown; ticket?: unknown };
  }
}
