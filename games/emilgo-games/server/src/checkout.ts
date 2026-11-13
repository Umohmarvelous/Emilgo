// v8 (A8): the billboards' checkout, behind one adapter. Paystack now; Flutterwave ready (set CHECKOUT=flutterwave
// and its keys). The secret keys live only in this server's environment; the portal never sees them.
//
//   CHECKOUT                  "paystack" (default) or "flutterwave"
//   PAYSTACK_SECRET_KEY       sk_test_… / sk_live_…
//   FLUTTERWAVE_SECRET_KEY    FLWSECK_TEST-… / FLWSECK-…
//   FLUTTERWAVE_WEBHOOK_HASH  the "secret hash" set in Flutterwave's dashboard
//
// With no key the adapter is not live: a checkout opens nothing and no money moves (the portal says so).

import { createHmac, timingSafeEqual } from "node:crypto";

export type ProviderId = "paystack" | "flutterwave";

/** One payment the provider confirmed: our reference, what was paid (kobo) and in what, the provider's own id. */
export interface Paid {
  reference: string;
  kobo: number;
  currency: string;
  providerRef: string;
}

export interface CheckoutAdapter {
  readonly id: ProviderId;
  /** A key is set: checkouts are real (test or live keys alike). */
  readonly live: boolean;
  /** Open the provider's checkout for this payment; its page's address, or an error. */
  open(o: { reference: string; kobo: number; email: string; returnUrl: string | null; title: string }): Promise<{ url: string } | { error: string }>;
  /** Ask the provider about a payment: paid (and how much), or null. */
  verify(reference: string): Promise<Paid | null>;
  /** A webhook's call: checked (signature or hash), then confirmed with the provider; the payment, or null. */
  webhook(headers: Record<string, string | string[] | undefined>, raw: string): Promise<Paid | null>;
}

type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;

async function call(get: Fetch, base: string, key: string, path: string, method: "GET" | "POST", json?: unknown): Promise<{ ok: boolean; json: any }> {
  try {
    const res = await get(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(json !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, json: await res.json().catch(() => null) };
  } catch {
    return { ok: false, json: null };
  }
}

const header = (h: Record<string, string | string[] | undefined>, name: string): string => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
};

const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

/** Paystack: transaction/initialize, transaction/verify; webhooks signed with HMAC-SHA512 of the body (x-paystack-signature). */
export class PaystackCheckout implements CheckoutAdapter {
  readonly id = "paystack" as const;
  private readonly key: string;
  constructor(env: Env, private readonly get: Fetch = fetch) {
    this.key = (env.PAYSTACK_SECRET_KEY ?? "").trim();
  }
  get live(): boolean {
    return this.key.length > 10;
  }
  async open(o: { reference: string; kobo: number; email: string; returnUrl: string | null; title: string }): Promise<{ url: string } | { error: string }> {
    const r = await call(this.get, "https://api.paystack.co", this.key, "/transaction/initialize", "POST", {
      email: o.email,
      amount: Math.round(o.kobo),
      currency: "NGN",
      reference: o.reference,
      ...(o.returnUrl ? { callback_url: `${o.returnUrl}?ref=${o.reference}` } : {}),
      metadata: { kind: "game_billboard", title: o.title },
    });
    const url = r.json?.data?.authorization_url;
    return r.ok && typeof url === "string" ? { url } : { error: r.json?.message ?? "Paystack refused the checkout." };
  }
  async verify(reference: string): Promise<Paid | null> {
    const r = await call(this.get, "https://api.paystack.co", this.key, `/transaction/verify/${encodeURIComponent(reference)}`, "GET");
    const d = r.json?.data;
    return r.ok && d?.status === "success" && d.reference === reference ? { reference, kobo: Number(d.amount), currency: String(d.currency), providerRef: String(d.id ?? reference) } : null;
  }
  async webhook(h: Record<string, string | string[] | undefined>, raw: string): Promise<Paid | null> {
    if (!this.live) return null;
    const sig = createHmac("sha512", this.key).update(raw).digest("hex");
    if (!sameText(sig, header(h, "x-paystack-signature"))) return null;
    let e: any = null;
    try {
      e = JSON.parse(raw);
    } catch {
      return null;
    }
    if (e?.event !== "charge.success" || e?.data?.metadata?.kind !== "game_billboard") return null;
    // Trust the API's word, not the event's body alone.
    return this.verify(String(e.data.reference ?? ""));
  }
}

/** Flutterwave: v3/payments, verify_by_reference; webhooks carry the dashboard's secret hash (verif-hash). */
export class FlutterwaveCheckout implements CheckoutAdapter {
  readonly id = "flutterwave" as const;
  private readonly key: string;
  private readonly hash: string;
  constructor(env: Env, private readonly get: Fetch = fetch) {
    this.key = (env.FLUTTERWAVE_SECRET_KEY ?? "").trim();
    this.hash = (env.FLUTTERWAVE_WEBHOOK_HASH ?? "").trim();
  }
  get live(): boolean {
    return this.key.length > 10;
  }
  async open(o: { reference: string; kobo: number; email: string; returnUrl: string | null; title: string }): Promise<{ url: string } | { error: string }> {
    const r = await call(this.get, "https://api.flutterwave.com", this.key, "/v3/payments", "POST", {
      tx_ref: o.reference,
      amount: Math.round(o.kobo) / 100,
      currency: "NGN",
      ...(o.returnUrl ? { redirect_url: `${o.returnUrl}?ref=${o.reference}` } : {}),
      customer: { email: o.email },
      meta: { kind: "game_billboard" },
      customizations: { title: o.title },
    });
    const url = r.json?.data?.link;
    return r.ok && typeof url === "string" ? { url } : { error: r.json?.message ?? "Flutterwave refused the checkout." };
  }
  async verify(reference: string): Promise<Paid | null> {
    const r = await call(this.get, "https://api.flutterwave.com", this.key, `/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, "GET");
    const d = r.json?.data;
    return r.ok && d?.status === "successful" && d.tx_ref === reference ? { reference, kobo: Math.round(Number(d.amount) * 100), currency: String(d.currency), providerRef: String(d.id) } : null;
  }
  async webhook(h: Record<string, string | string[] | undefined>, raw: string): Promise<Paid | null> {
    if (!this.live || !this.hash || !sameText(this.hash, header(h, "verif-hash"))) return null;
    let e: any = null;
    try {
      e = JSON.parse(raw);
    } catch {
      return null;
    }
    if (e?.event !== "charge.completed") return null;
    // Flutterwave asks that every event be checked with its API before it's trusted.
    return this.verify(String(e?.data?.tx_ref ?? ""));
  }
}

/** The checkout this server uses (CHECKOUT, default Paystack). */
export function checkoutFromEnv(env: Env, get: Fetch = fetch): CheckoutAdapter {
  return (env.CHECKOUT ?? "").trim().toLowerCase() === "flutterwave" ? new FlutterwaveCheckout(env, get) : new PaystackCheckout(env, get);
}
