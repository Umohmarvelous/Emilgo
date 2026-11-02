/**
 * server/adBilling.check.ts — the billboards' payments, checked with a fake
 * Supabase and fake providers (no network, no keys, no money).
 *
 *   npx tsx server/adBilling.check.ts
 */

import crypto from "node:crypto";

import { AdBilling, flutterwaveHashOk, stripeSignatureOk } from "./adBilling";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

const REF = "6f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const SB = "https://proj.supabase.co";
const BASE_ENV = { SUPABASE_URL: SB, SUPABASE_ANON_KEY: "anon-key", AD_BILLING_KEY: "billing-key-0123456789abcdef" };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/** A fake world: Supabase (who you are, opening and settling payments) and the providers. */
function world(opts: { payStatus?: string; provider?: string; providerPaid?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const raw = typeof init?.body === "string" ? init.body : "";
    const body = headers["Content-Type"] === "application/json" && raw ? JSON.parse(raw) : raw;
    calls.push({ url, method: init?.method ?? "GET", headers, body });
    const json = (status: number, j: unknown) => ({ ok: status < 400, status, json: async () => j }) as Response;
    if (url === `${SB}/auth/v1/user`) return headers.Authorization === "Bearer user-jwt" ? json(200, { id: "u1", email: "ads@example.com" }) : json(401, {});
    if (url === `${SB}/rest/v1/rpc/open_ad_payment`) return json(200, { reference: REF, amount: body.p_amount_naira });
    if (url === `${SB}/rest/v1/rpc/settle_ad_payment`) return json(200, { ok: true, reason: "paid" });
    if (url.startsWith(`${SB}/rest/v1/ad_payments`)) return json(200, [{ id: REF, provider: opts.provider ?? "paystack", amount_naira: 10000, status: opts.payStatus ?? "pending" }]);
    if (url === "https://api.paystack.co/transaction/initialize") return json(200, { data: { authorization_url: "https://checkout.paystack.com/abc" } });
    if (url.startsWith("https://api.paystack.co/transaction/verify/"))
      return json(200, { data: { status: opts.providerPaid === false ? "abandoned" : "success", reference: REF, amount: 1000000, currency: "NGN", id: 77 } });
    if (url === "https://api.flutterwave.com/v3/payments") return json(200, { data: { link: "https://checkout.flutterwave.com/x" } });
    if (url.includes("api.flutterwave.com/v3/transactions/")) return json(200, { data: { status: "successful", tx_ref: REF, amount: 10000, currency: "NGN", id: 99 } });
    if (url === "https://api.stripe.com/v1/checkout/sessions") return json(200, { url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    return json(404, {});
  }) as typeof fetch;
  const settles = () => calls.filter((c) => c.url.endsWith("/rpc/settle_ad_payment"));
  return { calls, fetchFn, settles };
}

async function main(): Promise<void> {
  console.log("signatures:");
  {
    const secret = "whsec_test_secret";
    const body = JSON.stringify({ type: "checkout.session.completed" });
    const t = 1_800_000_000;
    const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    check(stripeSignatureOk(body, `t=${t},v1=${sig}`, secret, t + 10), "Stripe: a good signature passes");
    check(!stripeSignatureOk(body + " ", `t=${t},v1=${sig}`, secret, t + 10), "Stripe: a changed body fails");
    check(!stripeSignatureOk(body, `t=${t},v1=${sig}`, secret, t + 400), "Stripe: an old timestamp fails");
    check(!stripeSignatureOk(body, undefined, secret, t), "Stripe: no header fails");
    check(!stripeSignatureOk(body, `t=${t},v1=${sig}`, "", t), "Stripe: no secret set fails");
    check(flutterwaveHashOk("my-hash", "my-hash") && !flutterwaveHashOk("my-hasx", "my-hash") && !flutterwaveHashOk(undefined, "my-hash") && !flutterwaveHashOk("x", ""), "Flutterwave: only the exact hash passes");
  }

  console.log("checkout:");
  {
    const w = world();
    check((await new AdBilling({}, w.fetchFn).checkout("user-jwt", { provider: "paystack", amount_naira: 10000 })).status === 503, "no ad stack configured: 503");
    const b = new AdBilling({ ...BASE_ENV, ADS_MOCK_PAY: "1" }, w.fetchFn);
    check((await b.checkout(null, { provider: "paystack", amount_naira: 10000 })).status === 401, "not signed in: 401");
    check((await b.checkout("user-jwt", { provider: "cash", amount_naira: 10000 })).status === 400, "an unknown provider: 400");
    check((await b.checkout("forged", { provider: "paystack", amount_naira: 10000 })).status === 401, "a session Supabase doesn't know: 401");
    const r = await b.checkout("user-jwt", { provider: "paystack", amount_naira: 10000 });
    const open = w.calls.find((c) => c.url.endsWith("/rpc/open_ad_payment"));
    check(open?.headers.Authorization === "Bearer user-jwt", "the payment is opened as the advertiser (their session, not a server key)");
    check(r.status === 200 && r.body.mock === true && r.body.checkout_url === null && r.body.settled === true, "no Paystack key, ADS_MOCK_PAY=1: a mock, settled at once");
    const st = w.settles()[0];
    check(st?.body.p_key === BASE_ENV.AD_BILLING_KEY && st.body.p_amount_kobo === 1_000_000 && st.body.p_currency === "NGN", "settled with the billing key, in kobo, in naira");
    const w2 = world();
    const r2 = await new AdBilling({ ...BASE_ENV, ADS_MOCK_PAY: "1", NODE_ENV: "production" }, w2.fetchFn).checkout("user-jwt", { provider: "paystack", amount_naira: 10000 });
    check(r2.body.mock === true && r2.body.settled === false && w2.settles().length === 0, "in production a mock never settles");
    const w3 = world();
    const r3 = await new AdBilling({ ...BASE_ENV }, w3.fetchFn).checkout("user-jwt", { provider: "flutterwave", amount_naira: 10000 });
    check(r3.body.settled === false && w3.settles().length === 0, "without ADS_MOCK_PAY a mock never settles");
  }

  console.log("live checkouts:");
  {
    const env = { ...BASE_ENV, PAYSTACK_SECRET_KEY: "sk_test_paystack_secret", FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-secret", STRIPE_SECRET_KEY: "sk_test_stripe_secret", ADS_RETURN_URL: "https://play.example/advertise" };
    const w = world();
    const b = new AdBilling(env, w.fetchFn);
    const p = await b.checkout("user-jwt", { provider: "paystack", amount_naira: 10000 });
    const pc = w.calls.find((c) => c.url === "https://api.paystack.co/transaction/initialize");
    check(p.body.checkout_url === "https://checkout.paystack.com/abc" && pc?.body.reference === REF && pc.body.amount === 1_000_000 && pc.body.currency === "NGN" && pc.body.metadata.kind === "game_billboard", "Paystack: our reference, kobo, NGN, marked as a billboard");
    check(pc?.headers.Authorization === "Bearer sk_test_paystack_secret" && !w.calls.some((c) => c.url.startsWith(SB) && JSON.stringify(c).includes("sk_test_paystack")), "the provider key goes to the provider only");
    const f = await b.checkout("user-jwt", { provider: "flutterwave", amount_naira: 10000 });
    const fc = w.calls.find((c) => c.url === "https://api.flutterwave.com/v3/payments");
    check(f.body.checkout_url === "https://checkout.flutterwave.com/x" && fc?.body.tx_ref === REF && fc.body.amount === 10000 && fc.body.redirect_url === `https://play.example/advertise?ref=${REF}`, "Flutterwave: our reference, naira, back to the portal");
    const s = await b.checkout("user-jwt", { provider: "stripe", amount_naira: 10000, return_url: "https://evil.example/advertise" });
    const sc = w.calls.find((c) => c.url === "https://api.stripe.com/v1/checkout/sessions");
    const form = new URLSearchParams(String(sc?.body ?? ""));
    check(s.body.checkout_url === "https://checkout.stripe.com/c/pay/cs_test_1" && form.get("client_reference_id") === REF && form.get("line_items[0][price_data][unit_amount]") === "1000000" && form.get("line_items[0][price_data][currency]") === "ngn", "Stripe: our reference, kobo, NGN");
    check(!!form.get("success_url")?.startsWith("https://play.example/advertise?ref="), "a return address that isn't ours is ignored (ADS_RETURN_URL used)");
  }

  console.log("verify and webhooks:");
  {
    const env = { ...BASE_ENV, PAYSTACK_SECRET_KEY: "sk_test_paystack_secret", FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-secret", FLUTTERWAVE_WEBHOOK_HASH: "flw-hash", STRIPE_SECRET_KEY: "sk_test_stripe_secret", STRIPE_WEBHOOK_SECRET: "whsec_x" };
    let w = world();
    let b = new AdBilling(env, w.fetchFn);
    const v = await b.verify("user-jwt", REF, null);
    check(v.body.ok === true && w.settles().length === 1 && w.settles()[0].body.p_amount_kobo === 1_000_000, "verify: Paystack says paid, settled");
    w = world({ providerPaid: false });
    b = new AdBilling(env, w.fetchFn);
    const nv = await b.verify("user-jwt", REF, null);
    check(nv.body.ok === false && w.settles().length === 0, "verify: not paid yet, nothing settled");
    w = world({ payStatus: "paid" });
    b = new AdBilling(env, w.fetchFn);
    const pv = await b.verify("user-jwt", REF, null);
    check(pv.body.ok === true && !w.calls.some((c) => c.url.includes("paystack.co")), "verify: already paid, the provider isn't asked again");
    check((await b.verify("user-jwt", "../../etc", null)).status === 400, "verify: a malformed reference is refused");

    w = world();
    b = new AdBilling(env, w.fetchFn, () => 1_800_000_000_000);
    const evt = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_1", payment_status: "paid", client_reference_id: REF, amount_total: 1_000_000, currency: "ngn" } } });
    const sig = crypto.createHmac("sha256", "whsec_x").update(`1800000000.${evt}`).digest("hex");
    check((await b.stripeWebhook(evt, `t=1800000000,v1=${"0".repeat(64)}`)).status === 401 && w.settles().length === 0, "Stripe webhook: a bad signature settles nothing");
    const ok = await b.stripeWebhook(evt, `t=1800000000,v1=${sig}`);
    check(ok.status === 200 && w.settles()[0]?.body.p_reference === REF && w.settles()[0].body.p_currency === "NGN", "Stripe webhook: signed and paid, settled");

    w = world();
    b = new AdBilling(env, w.fetchFn);
    const flw = { event: "charge.completed", data: { id: 99, tx_ref: REF } };
    check((await b.flutterwaveWebhook("wrong", flw)).status === 401 && w.settles().length === 0, "Flutterwave webhook: a wrong hash settles nothing");
    await b.flutterwaveWebhook("flw-hash", flw);
    check(w.calls.some((c) => c.url.includes("/v3/transactions/99/verify")) && w.settles().length === 1, "Flutterwave webhook: checked with its API, then settled");

    w = world();
    b = new AdBilling(env, w.fetchFn);
    await b.paystackEvent({ event: "charge.success", data: { reference: REF, amount: 1_000_000, currency: "NGN", id: 5 } });
    check(w.settles().length === 0, "Paystack: a charge that isn't a billboard's is left alone");
    await b.paystackEvent({ event: "charge.success", data: { reference: REF, amount: 1_000_000, currency: "NGN", id: 5, metadata: { kind: "game_billboard" } } });
    check(w.settles().length === 1, "Paystack: a billboard's charge.success settles");

    w = world();
    b = new AdBilling({ ...env, AD_BILLING_KEY: "" }, w.fetchFn);
    const off = await b.verify("user-jwt", REF, null);
    check(off.body.ok === false && off.body.reason === "billing_off" && w.settles().length === 0, "no AD_BILLING_KEY: nothing is ever settled");
  }
}

main().then(
  () => {
    console.log(failures ? `\n${failures} FAILED` : "\nall passed");
    process.exit(failures ? 1 : 0);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
