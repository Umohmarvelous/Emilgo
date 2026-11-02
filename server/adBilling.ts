/**
 * server/adBilling.ts
 *
 * Paying for EMILGO Games billboards (games/emilgo-games/SPEC-V3.md §8): the
 * advertiser portal's checkouts and the providers' confirmations. The secret
 * keys live only here.
 *
 *   POST /api/ads/checkout          { provider, amount_naira, creative_id?, return_url? }
 *        (Authorization: Bearer <the advertiser's Supabase session>)
 *        → opens a pending payment as that advertiser (open_ad_payment), then
 *          the provider's checkout with the payment's id as its reference.
 *   GET  /api/ads/verify/:reference[?session_id=]   (same Authorization)
 *        → asks the provider whether it was paid, and settles it if so.
 *   POST /api/webhooks/flutterwave  (verif-hash)       → settles.
 *   POST /api/webhooks/stripe       (Stripe-Signature) → settles.
 *   Paystack's confirmations come through its existing webhook
 *   (server/paystack.ts calls paystackEvent here).
 *
 * Settling is the database's settle_ad_payment, which needs AD_BILLING_KEY (its
 * SHA-256 is in public.game_ads_config) and checks the amount and currency
 * against what was opened, once. This server never holds the service-role key.
 *
 * Environment:
 *   SUPABASE_URL / SUPABASE_ANON_KEY   (or the EXPO_PUBLIC_ ones from the app's .env)
 *   AD_BILLING_KEY                     24+ chars
 *   PAYSTACK_SECRET_KEY                sk_test_… / sk_live_…
 *   FLUTTERWAVE_SECRET_KEY             FLWSECK_TEST-… / FLWSECK-…
 *   FLUTTERWAVE_WEBHOOK_HASH           the "secret hash" set in Flutterwave's dashboard
 *   STRIPE_SECRET_KEY                  sk_test_… / sk_live_…
 *   STRIPE_WEBHOOK_SECRET              whsec_…
 *   ADS_RETURN_URL                     where a checkout comes back to (the portal), for phones
 *   ADS_MOCK_PAY=1                     test only: with no provider key, settle a checkout at once
 *                                      (refused when NODE_ENV=production)
 *
 * With no key for a provider its checkout runs in MOCK mode (no money moves),
 * like the rest of this server.
 */

import type { Express, Request, Response } from "express";
import crypto from "node:crypto";

export type Provider = "paystack" | "flutterwave" | "stripe";
type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const PROVIDERS: Provider[] = ["paystack", "flutterwave", "stripe"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Stripe's webhook signature: t=…,v1=… over `${t}.${raw body}`, within five minutes. */
export function stripeSignatureOk(raw: Buffer | string, header: string | undefined, secret: string, nowS: number): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > 300) return false;
  const want = crypto.createHmac("sha256", secret).update(`${t}.${typeof raw === "string" ? raw : raw.toString("utf8")}`).digest("hex");
  return parts
    .filter(([k, v]) => k === "v1" && typeof v === "string" && v.length === want.length)
    .some(([, v]) => crypto.timingSafeEqual(Buffer.from(v, "utf8"), Buffer.from(want, "utf8")));
}

/** Flutterwave's webhook: the verif-hash header is the secret hash set in its dashboard. */
export function flutterwaveHashOk(header: string | undefined, hash: string): boolean {
  if (!header || !hash || header.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(hash));
}

export class AdBilling {
  private readonly sb: string;
  private readonly anon: string;

  constructor(
    private readonly env: Env,
    private readonly get: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.sb = (env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
    this.anon = (env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  }

  /** Is a provider's key set (else its checkout is a mock)? */
  live(p: Provider): boolean {
    const k = p === "paystack" ? this.env.PAYSTACK_SECRET_KEY : p === "flutterwave" ? this.env.FLUTTERWAVE_SECRET_KEY : this.env.STRIPE_SECRET_KEY;
    return !!k && k.trim().length > 10;
  }

  private get billingKey(): string | null {
    const k = this.env.AD_BILLING_KEY?.trim();
    return k && k.length >= 24 ? k : null;
  }

  private async sbFetch(path: string, jwt: string | null, init: { method: "GET" | "POST"; body?: unknown }): Promise<{ ok: boolean; status: number; json: any }> {
    const resp = await this.get(`${this.sb}${path}`, {
      method: init.method,
      headers: { apikey: this.anon, Authorization: `Bearer ${jwt ?? this.anon}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const json = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, json };
  }

  /** Who a session token belongs to (Supabase checks it), or null. */
  private async user(jwt: string): Promise<{ id: string; email: string | null } | null> {
    const r = await this.sbFetch("/auth/v1/user", jwt, { method: "GET" });
    return r.ok && typeof r.json?.id === "string" ? { id: r.json.id, email: r.json.email ?? null } : null;
  }

  /** settle_ad_payment, with the billing key. */
  private async settle(reference: string, provider: Provider, amountKobo: number, currency: string, providerRef: string, ok = true): Promise<{ ok: boolean; reason: string }> {
    const key = this.billingKey;
    if (!key) return { ok: false, reason: "billing_off" };
    const r = await this.sbFetch("/rest/v1/rpc/settle_ad_payment", null, {
      method: "POST",
      body: { p_key: key, p_reference: reference, p_provider: provider, p_amount_kobo: Math.round(amountKobo), p_currency: currency, p_provider_ref: providerRef.slice(0, 120), p_ok: ok },
    });
    if (!r.ok) return { ok: false, reason: "settle_failed" };
    return { ok: !!r.json?.ok, reason: String(r.json?.reason ?? "") };
  }

  private async providerCall(p: Provider, path: string, init: { method: "GET" | "POST"; json?: unknown; form?: URLSearchParams }): Promise<{ ok: boolean; json: any }> {
    const base = p === "paystack" ? "https://api.paystack.co" : p === "flutterwave" ? "https://api.flutterwave.com" : "https://api.stripe.com";
    const key = (p === "paystack" ? this.env.PAYSTACK_SECRET_KEY : p === "flutterwave" ? this.env.FLUTTERWAVE_SECRET_KEY : this.env.STRIPE_SECRET_KEY) ?? "";
    const resp = await this.get(`${base}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.form ? init.form.toString() : undefined,
    });
    const json = await resp.json().catch(() => null);
    return { ok: resp.ok, json };
  }

  /** POST /api/ads/checkout */
  async checkout(jwt: string | null, body: Record<string, unknown>): Promise<Reply> {
    if (!this.sb || !this.anon) return { status: 503, body: { error: "The ad stack is not configured on this server." } };
    if (!jwt) return { status: 401, body: { error: "Sign in first." } };
    const provider = body.provider as Provider;
    const amount = Number(body.amount_naira);
    const creative = typeof body.creative_id === "string" && UUID.test(body.creative_id) ? body.creative_id : null;
    if (!PROVIDERS.includes(provider) || !Number.isFinite(amount) || amount <= 0) return { status: 400, body: { error: "provider and amount_naira are required" } };
    const me = await this.user(jwt);
    if (!me) return { status: 401, body: { error: "Sign in again." } };
    // The payment is opened AS the advertiser: the database checks it's their account and the minimum.
    const opened = await this.sbFetch("/rest/v1/rpc/open_ad_payment", jwt, { method: "POST", body: { p_provider: provider, p_amount_naira: amount, p_creative: creative } });
    if (!opened.ok || typeof opened.json?.reference !== "string") return { status: 400, body: { error: opened.json?.message ?? "Couldn't start the payment." } };
    const reference: string = opened.json.reference;
    const kobo = Math.round(Number(opened.json.amount) * 100);
    const back = this.returnUrl(body.return_url);

    if (!this.live(provider)) {
      // Test mode with no key: nothing moves. Settled at once only where the owner allows it.
      const mockPay = this.env.ADS_MOCK_PAY === "1" && this.env.NODE_ENV !== "production";
      const settled = mockPay ? await this.settle(reference, provider, kobo, "NGN", `mock_${reference.slice(0, 8)}`) : null;
      return { status: 200, body: { mock: true, reference, checkout_url: null, settled: !!settled?.ok } };
    }
    const email = me.email ?? `${me.id}@users.emilgo.invalid`;
    if (provider === "paystack") {
      const r = await this.providerCall("paystack", "/transaction/initialize", {
        method: "POST",
        json: { email, amount: kobo, currency: "NGN", reference, ...(back ? { callback_url: `${back}?ref=${reference}` } : {}), metadata: { kind: "game_billboard" } },
      });
      if (!r.ok || !r.json?.data?.authorization_url) return { status: 502, body: { error: r.json?.message ?? "Paystack refused the checkout." } };
      return { status: 200, body: { reference, checkout_url: r.json.data.authorization_url } };
    }
    if (provider === "flutterwave") {
      const r = await this.providerCall("flutterwave", "/v3/payments", {
        method: "POST",
        json: { tx_ref: reference, amount: kobo / 100, currency: "NGN", redirect_url: back ? `${back}?ref=${reference}` : undefined, customer: { email }, meta: { kind: "game_billboard" }, customizations: { title: "EMILGO Games billboards" } },
      });
      if (!r.ok || !r.json?.data?.link) return { status: 502, body: { error: r.json?.message ?? "Flutterwave refused the checkout." } };
      return { status: 200, body: { reference, checkout_url: r.json.data.link } };
    }
    const form = new URLSearchParams({
      mode: "payment",
      client_reference_id: reference,
      customer_email: email,
      "metadata[reference]": reference,
      "metadata[kind]": "game_billboard",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "ngn",
      "line_items[0][price_data][unit_amount]": String(kobo),
      "line_items[0][price_data][product_data][name]": "EMILGO Games billboards",
      success_url: `${back ?? "https://example.invalid/advertise"}?ref=${reference}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back ?? "https://example.invalid/advertise"}?ref=${reference}&cancelled=1`,
    });
    const r = await this.providerCall("stripe", "/v1/checkout/sessions", { method: "POST", form });
    if (!r.ok || !r.json?.url) return { status: 502, body: { error: r.json?.error?.message ?? "Stripe refused the checkout." } };
    return { status: 200, body: { reference, checkout_url: r.json.url } };
  }

  /** Where a checkout comes back to: the portal's page on the web, else ADS_RETURN_URL. */
  private returnUrl(asked: unknown): string | null {
    const allowed = (this.env.ADS_RETURN_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (typeof asked === "string" && /^https?:\/\/[^\s]+\/advertise$/.test(asked)) {
      const origin = new URL(asked).origin;
      if (allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return asked;
    }
    const fixed = this.env.ADS_RETURN_URL?.trim();
    return fixed && /^https:\/\//.test(fixed) ? fixed.replace(/\/+$/, "") : null;
  }

  /** GET /api/ads/verify/:reference — ask the provider, settle if paid. */
  async verify(jwt: string | null, reference: string, sessionId: string | null): Promise<Reply> {
    if (!jwt) return { status: 401, body: { error: "Sign in first." } };
    if (!UUID.test(reference)) return { status: 400, body: { error: "bad reference" } };
    // Read as the advertiser: they only see their own payments.
    const r = await this.sbFetch(`/rest/v1/ad_payments?id=eq.${reference}&select=id,provider,amount_naira,status`, jwt, { method: "GET" });
    const pay = Array.isArray(r.json) ? r.json[0] : null;
    if (!pay) return { status: 404, body: { error: "No such payment." } };
    if (pay.status !== "pending") return { status: 200, body: { ok: pay.status === "paid", reason: pay.status } };
    const provider = pay.provider as Provider;
    if (!this.live(provider)) return { status: 200, body: { ok: false, reason: "mock" } };
    const checked = await this.ask(provider, reference, sessionId);
    if (!checked) return { status: 200, body: { ok: false, reason: "not_paid_yet" } };
    const s = await this.settle(reference, provider, checked.kobo, checked.currency, checked.ref);
    return { status: 200, body: s };
  }

  /** What the provider says about a payment: paid, how much (kobo) and in what — or null. */
  private async ask(p: Provider, reference: string, sessionId: string | null): Promise<{ kobo: number; currency: string; ref: string } | null> {
    if (p === "paystack") {
      const r = await this.providerCall("paystack", `/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" });
      const d = r.json?.data;
      return r.ok && d?.status === "success" && d.reference === reference ? { kobo: Number(d.amount), currency: String(d.currency), ref: String(d.id ?? reference) } : null;
    }
    if (p === "flutterwave") {
      const r = await this.providerCall("flutterwave", `/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, { method: "GET" });
      const d = r.json?.data;
      return r.ok && d?.status === "successful" && d.tx_ref === reference ? { kobo: Math.round(Number(d.amount) * 100), currency: String(d.currency), ref: String(d.id) } : null;
    }
    if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;
    const r = await this.providerCall("stripe", `/v1/checkout/sessions/${sessionId}`, { method: "GET" });
    const d = r.json;
    return r.ok && d?.payment_status === "paid" && d.client_reference_id === reference ? { kobo: Number(d.amount_total), currency: String(d.currency).toUpperCase(), ref: String(d.id) } : null;
  }

  /** Paystack's charge.success for a billboard (its webhook's signature already checked in paystack.ts). */
  async paystackEvent(event: any): Promise<void> {
    const d = event?.data;
    if (event?.event !== "charge.success" || d?.metadata?.kind !== "game_billboard" || !UUID.test(String(d?.reference))) return;
    await this.settle(d.reference, "paystack", Number(d.amount), String(d.currency), String(d.id ?? d.reference));
  }

  /** POST /api/webhooks/flutterwave */
  async flutterwaveWebhook(hash: string | undefined, event: any): Promise<Reply> {
    if (!flutterwaveHashOk(hash, this.env.FLUTTERWAVE_WEBHOOK_HASH ?? "")) return { status: 401, body: {} };
    const d = event?.data;
    if (event?.event === "charge.completed" && UUID.test(String(d?.tx_ref)) && this.live("flutterwave")) {
      // Flutterwave asks that every event be checked with its API before it's trusted.
      const r = await this.providerCall("flutterwave", `/v3/transactions/${encodeURIComponent(String(d.id))}/verify`, { method: "GET" });
      const v = r.json?.data;
      if (r.ok && v?.status === "successful" && v.tx_ref === d.tx_ref) await this.settle(v.tx_ref, "flutterwave", Math.round(Number(v.amount) * 100), String(v.currency), String(v.id));
    }
    return { status: 200, body: {} };
  }

  /** POST /api/webhooks/stripe */
  async stripeWebhook(raw: Buffer | string, signature: string | undefined): Promise<Reply> {
    if (!stripeSignatureOk(raw, signature, this.env.STRIPE_WEBHOOK_SECRET ?? "", Math.floor(this.now() / 1000))) return { status: 401, body: {} };
    let event: any = null;
    try {
      event = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
    } catch {
      return { status: 400, body: {} };
    }
    const s = event?.data?.object;
    if (event?.type === "checkout.session.completed" && s?.payment_status === "paid" && UUID.test(String(s.client_reference_id))) {
      await this.settle(s.client_reference_id, "stripe", Number(s.amount_total), String(s.currency).toUpperCase(), String(s.id));
    }
    return { status: 200, body: {} };
  }
}

let billing: AdBilling | null = null;

/** The one AdBilling of this server (paystack.ts's webhook hands it Paystack's events). */
export function adBilling(): AdBilling {
  return (billing ??= new AdBilling(process.env));
}

export function registerAdBillingRoutes(app: Express): void {
  const b = adBilling();
  const bearer = (req: Request) => {
    const h = req.header("authorization") ?? "";
    return h.startsWith("Bearer ") && h.length < 4000 ? h.slice(7) : null;
  };
  const send = (res: Response, r: Reply) => res.status(r.status).json(r.body);
  const fail = (res: Response) => () => res.status(500).json({ error: "Something went wrong. Please try again." });

  app.post("/api/ads/checkout", (req, res) => void b.checkout(bearer(req), req.body ?? {}).then((r) => send(res, r), fail(res)));
  app.get("/api/ads/verify/:reference", (req, res) =>
    void b.verify(bearer(req), String(req.params.reference ?? ""), typeof req.query.session_id === "string" ? req.query.session_id : null).then((r) => send(res, r), fail(res)),
  );
  app.post("/api/webhooks/flutterwave", (req, res) => void b.flutterwaveWebhook(req.header("verif-hash"), req.body).then((r) => send(res, r), fail(res)));
  app.post("/api/webhooks/stripe", (req, res) =>
    void b.stripeWebhook((req.rawBody as Buffer) ?? Buffer.from(JSON.stringify(req.body)), req.header("stripe-signature")).then((r) => send(res, r), fail(res)),
  );
  const off = PROVIDERS.filter((p) => !b.live(p));
  if (off.length) console.log(`[Ads billing] No key for ${off.join(", ")}: those checkouts run in MOCK mode.`);
}
