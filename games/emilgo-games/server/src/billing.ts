// v8 (A8): paying for a billboard, on the game's own server (the EMILGO app's server, which did it before, isn't
// deployed: the portal was unreachable). The portal (portal.ts, at /advertise on this server) signs the advertiser in
// with the EMILGO Supabase project; this file opens the booking AS that advertiser (the database prices it and checks
// the board is free), opens the checkout through the adapter (checkout.ts), and settles a confirmed payment with
// settle_ad_payment, which needs AD_BILLING_KEY and checks the amount and currency once. No service-role key here.
//
//   POST /ads/v1/checkout          { slot_id, weeks, creative_id, return_url? }   Authorization: Bearer <session>
//   GET  /ads/v1/verify/<reference>                                                Authorization: Bearer <session>
//   POST /ads/v1/webhook/paystack | /ads/v1/webhook/flutterwave                    (the provider's signature)
//
// Environment: SUPABASE_URL, SUPABASE_ANON_KEY (as for the ads feed), AD_BILLING_KEY (24+ chars), and the
// checkout's keys (checkout.ts).

import type { CheckoutAdapter } from "./checkout";

export interface Reply {
  status: number;
  body: unknown;
}

type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT = /^[a-z]{2}-[0-9]{2}$/;

export class Billing {
  private readonly sb: string;
  private readonly anon: string;
  private readonly key: string | null;

  constructor(
    env: Env,
    readonly checkout: CheckoutAdapter,
    private readonly get: Fetch = fetch,
  ) {
    this.sb = (env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
    this.anon = (env.SUPABASE_ANON_KEY ?? "").trim();
    const k = (env.AD_BILLING_KEY ?? "").trim();
    this.key = k.length >= 24 ? k : null;
  }

  /** The ad stack is configured (the portal can sign in and book). */
  get ready(): boolean {
    return !!this.sb && !!this.anon;
  }

  /** What the portal needs to talk to the ad stack itself: the project's public address and anon key (both public). */
  publicConfig(): { url: string; anon: string } | null {
    return this.ready ? { url: this.sb, anon: this.anon } : null;
  }

  private async sbFetch(path: string, jwt: string | null, method: "GET" | "POST", body?: unknown): Promise<{ ok: boolean; json: any }> {
    try {
      const res = await this.get(`${this.sb}${path}`, {
        method,
        headers: { apikey: this.anon, Authorization: `Bearer ${jwt ?? this.anon}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000),
      });
      return { ok: res.ok, json: await res.json().catch(() => null) };
    } catch {
      return { ok: false, json: null };
    }
  }

  private async user(jwt: string): Promise<{ id: string; email: string | null } | null> {
    const r = await this.sbFetch("/auth/v1/user", jwt, "GET");
    return r.ok && typeof r.json?.id === "string" ? { id: r.json.id, email: r.json.email ?? null } : null;
  }

  private async settle(reference: string, kobo: number, currency: string, providerRef: string): Promise<{ ok: boolean; reason: string }> {
    if (!this.key) return { ok: false, reason: "billing_off" };
    const r = await this.sbFetch("/rest/v1/rpc/settle_ad_payment", null, "POST", {
      p_key: this.key,
      p_reference: reference,
      p_provider: this.checkout.id,
      p_amount_kobo: Math.round(kobo),
      p_currency: currency,
      p_provider_ref: providerRef.slice(0, 120),
      p_ok: true,
    });
    return r.ok ? { ok: !!r.json?.ok, reason: String(r.json?.reason ?? "") } : { ok: false, reason: "settle_failed" };
  }

  /** POST /ads/v1/checkout: book a board for 1 or 2 weeks with one of your ads, then the provider's checkout. */
  async book(jwt: string | null, body: Record<string, unknown>, origin: string | null): Promise<Reply> {
    if (!this.ready) return { status: 503, body: { error: "Billboards aren't set up on this server yet." } };
    if (!jwt) return { status: 401, body: { error: "Sign in first." } };
    const slot = typeof body.slot_id === "string" && SLOT.test(body.slot_id) ? body.slot_id : null;
    const weeks = Number(body.weeks);
    const creative = typeof body.creative_id === "string" && UUID.test(body.creative_id) ? body.creative_id : null;
    if (!slot || !creative || (weeks !== 1 && weeks !== 2)) return { status: 400, body: { error: "Pick a board, 1 or 2 weeks, and one of your ads." } };
    const me = await this.user(jwt);
    if (!me) return { status: 401, body: { error: "Sign in again." } };
    const opened = await this.sbFetch("/rest/v1/rpc/book_billboard", jwt, "POST", { p_slot: slot, p_weeks: weeks, p_creative: creative, p_provider: this.checkout.id });
    if (!opened.ok || typeof opened.json?.reference !== "string") return { status: 400, body: { error: opened.json?.message ?? "Couldn't book that board." } };
    const reference: string = opened.json.reference;
    const kobo = Math.round(Number(opened.json.amount) * 100);
    if (!this.checkout.live) return { status: 200, body: { reference, checkout_url: null, mock: true } };
    // Back to this server's portal only (the page that asked), never anywhere else.
    const back = origin && typeof body.return_url === "string" && body.return_url === `${origin}/advertise` ? body.return_url : null;
    const r = await this.checkout.open({ reference, kobo, email: me.email ?? `${me.id}@users.lootline.invalid`, returnUrl: back, title: "LOOTLINE billboard" });
    return "url" in r ? { status: 200, body: { reference, checkout_url: r.url } } : { status: 502, body: { error: r.error } };
  }

  /** GET /ads/v1/verify/<reference>: ask the provider; settle if paid. */
  async verify(jwt: string | null, reference: string): Promise<Reply> {
    if (!this.ready) return { status: 503, body: { error: "Billboards aren't set up on this server yet." } };
    if (!jwt) return { status: 401, body: { error: "Sign in first." } };
    if (!UUID.test(reference)) return { status: 400, body: { error: "bad reference" } };
    // Read as the advertiser: they only see their own payments.
    const r = await this.sbFetch(`/rest/v1/ad_payments?id=eq.${reference}&select=id,status`, jwt, "GET");
    const pay = Array.isArray(r.json) ? r.json[0] : null;
    if (!pay) return { status: 404, body: { error: "No such payment." } };
    if (pay.status !== "pending") return { status: 200, body: { ok: pay.status === "paid", reason: pay.status } };
    if (!this.checkout.live) return { status: 200, body: { ok: false, reason: "test_mode" } };
    const paid = await this.checkout.verify(reference);
    if (!paid) return { status: 200, body: { ok: false, reason: "not_paid_yet" } };
    return { status: 200, body: await this.settle(paid.reference, paid.kobo, paid.currency, paid.providerRef) };
  }

  /** A provider's webhook: only this server's checkout's (the other's is refused). */
  async webhook(provider: string, headers: Record<string, string | string[] | undefined>, raw: string): Promise<Reply> {
    if (provider !== this.checkout.id) return { status: 404, body: {} };
    const paid = await this.checkout.webhook(headers, raw);
    if (paid && UUID.test(paid.reference)) await this.settle(paid.reference, paid.kobo, paid.currency, paid.providerRef);
    return { status: 200, body: {} };
  }
}
