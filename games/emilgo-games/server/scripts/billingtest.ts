// v8 (A8): the billboards' checkout adapter and billing, with a fake network: Paystack opens and verifies, its
// webhook's signature is checked, Flutterwave's hash is checked, a booking opens as the advertiser and a confirmed
// payment is settled once with the billing key; no key = test mode (no money moves).
//
//   node server/build-tools.mjs && node server/dist/billingtest.mjs

import { createHmac } from "node:crypto";

import { Billing } from "../src/billing";
import { FlutterwaveCheckout, PaystackCheckout, checkoutFromEnv } from "../src/checkout";
import { portalHtml } from "../src/portal";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

const REF = "0f1e2d3c-4b5a-4968-8776-655443322110";
const AD = "11111111-2222-4333-8444-555555555555";
type Call = { url: string; method: string; body: any; auth: string };
function fakeFetch(calls: Call[], answer: (c: Call) => { status?: number; json: unknown }): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const c: Call = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null, auth: String((init?.headers as Record<string, string>)?.Authorization ?? "") };
    calls.push(c);
    const a = answer(c);
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  }) as typeof fetch;
}

console.log("the adapter:");
{
  check(checkoutFromEnv({}).id === "paystack" && checkoutFromEnv({ CHECKOUT: "flutterwave" }).id === "flutterwave", "Paystack by default; CHECKOUT=flutterwave switches");
  check(!new PaystackCheckout({}).live && new PaystackCheckout({ PAYSTACK_SECRET_KEY: "sk_test_0123456789abcdef" }).live, "live only with a key");
}

console.log("Paystack:");
{
  const key = "sk_test_0123456789abcdef";
  const calls: Call[] = [];
  const ps = new PaystackCheckout(
    { PAYSTACK_SECRET_KEY: key },
    fakeFetch(calls, (c) =>
      c.url.endsWith("/transaction/initialize")
        ? { json: { status: true, data: { authorization_url: "https://checkout.paystack.com/abc" } } }
        : { json: { status: true, data: { status: "success", reference: REF, amount: 500000, currency: "NGN", id: 77 } } },
    ),
  );
  const o = await ps.open({ reference: REF, kobo: 500000, email: "a@b.co", returnUrl: "https://x.test/advertise", title: "T" });
  check("url" in o && o.url.startsWith("https://checkout.paystack.com"), "opens the checkout");
  check(calls[0].body.amount === 500000 && calls[0].body.callback_url === `https://x.test/advertise?ref=${REF}` && calls[0].auth === `Bearer ${key}`, "in kobo, back to the portal, with the secret key");
  const v = await ps.verify(REF);
  check(v?.kobo === 500000 && v.currency === "NGN" && v.providerRef === "77", "verifies a paid one");
  const raw = JSON.stringify({ event: "charge.success", data: { reference: REF, metadata: { kind: "game_billboard" } } });
  const good = createHmac("sha512", key).update(raw).digest("hex");
  check(!!(await ps.webhook({ "x-paystack-signature": good }, raw)), "a signed webhook is taken (and checked with the API)");
  check((await ps.webhook({ "x-paystack-signature": "00" + good.slice(2) }, raw)) === null, "a forged one is refused");
}

console.log("Flutterwave (ready):");
{
  const calls: Call[] = [];
  const fw = new FlutterwaveCheckout(
    { FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-0123456789", FLUTTERWAVE_WEBHOOK_HASH: "hash-123" },
    fakeFetch(calls, (c) =>
      c.url.endsWith("/v3/payments")
        ? { json: { status: "success", data: { link: "https://checkout.flutterwave.com/x" } } }
        : { json: { status: "success", data: { status: "successful", tx_ref: REF, amount: 5000, currency: "NGN", id: 9 } } },
    ),
  );
  const o = await fw.open({ reference: REF, kobo: 500000, email: "a@b.co", returnUrl: null, title: "T" });
  check("url" in o && calls[0].body.amount === 5000 && calls[0].body.tx_ref === REF, "opens the checkout (in naira, our reference)");
  const raw = JSON.stringify({ event: "charge.completed", data: { tx_ref: REF } });
  check((await fw.webhook({ "verif-hash": "hash-123" }, raw))?.kobo === 500000, "a webhook with the hash is taken (and checked with the API)");
  check((await fw.webhook({ "verif-hash": "nope-123" }, raw)) === null, "a wrong hash is refused");
}

console.log("billing:");
{
  const calls: Call[] = [];
  const net = fakeFetch(calls, (c) => {
    if (c.url.endsWith("/auth/v1/user")) return c.auth === "Bearer user-jwt" ? { json: { id: "u1", email: "biz@x.co" } } : { status: 401, json: {} };
    if (c.url.endsWith("/rpc/book_billboard")) return { json: { reference: REF, amount: 5000 } };
    if (c.url.endsWith("/rpc/settle_ad_payment")) return { json: { ok: true, reason: "paid" } };
    if (c.url.includes("/ad_payments?")) return { json: [{ id: REF, status: "pending" }] };
    if (c.url.endsWith("/transaction/initialize")) return { json: { data: { authorization_url: "https://checkout.paystack.com/abc" } } };
    return { json: { data: { status: "success", reference: REF, amount: 500000, currency: "NGN", id: 5 } } };
  });
  const env = { SUPABASE_URL: "https://sb.test", SUPABASE_ANON_KEY: "anon", AD_BILLING_KEY: "k".repeat(30), PAYSTACK_SECRET_KEY: "sk_test_0123456789abcdef" };
  const b = new Billing(env, new PaystackCheckout(env, net), net);
  check((await b.book(null, {}, null)).status === 401, "signed out: refused");
  check((await b.book("user-jwt", { slot_id: "bad", weeks: 3, creative_id: AD }, null)).status === 400, "a bad booking: refused");
  const r = await b.book("user-jwt", { slot_id: "mx-04", weeks: 2, creative_id: AD, return_url: "https://g.test/advertise" }, "https://g.test");
  const opened = calls.find((c) => c.url.endsWith("/rpc/book_billboard"));
  check(r.status === 200 && (r.body as { checkout_url: string }).checkout_url.includes("paystack") && opened?.auth === "Bearer user-jwt" && opened.body.p_provider === "paystack", "a booking opens AS the advertiser, then the checkout");
  const init = calls.find((c) => c.url.endsWith("/transaction/initialize"));
  check(init?.body.amount === 500000 && init.body.callback_url === `https://g.test/advertise?ref=${REF}`, "priced by the database (₦5,000 → 500000 kobo), back to this server's portal");
  await b.book("user-jwt", { slot_id: "mx-04", weeks: 1, creative_id: AD, return_url: "https://evil.test/advertise" }, "https://g.test");
  check(!calls.filter((c) => c.url.endsWith("/transaction/initialize"))[1]?.body.callback_url, "a return address elsewhere is dropped");
  const v = await b.verify("user-jwt", REF);
  const settle = calls.find((c) => c.url.endsWith("/rpc/settle_ad_payment"));
  check((v.body as { ok: boolean }).ok && settle?.body.p_key === env.AD_BILLING_KEY && settle.body.p_amount_kobo === 500000, "a paid one is settled with the billing key, at what the provider says");
  const test = new Billing({ ...env, PAYSTACK_SECRET_KEY: "" }, new PaystackCheckout({}, net), net);
  const m = await test.book("user-jwt", { slot_id: "mx-04", weeks: 1, creative_id: AD }, null);
  check((m.body as { mock?: boolean; checkout_url: unknown }).mock === true && (m.body as { checkout_url: unknown }).checkout_url === null, "no key: test mode, no checkout, no money");
  check((await b.webhook("flutterwave", {}, "{}")).status === 404, "the other provider's webhook is refused");
}

console.log("the portal:");
{
  const off = portalHtml({ on: false, sb: null, provider: "paystack", live: false });
  check(off.includes('"on":false') && !off.includes("__CONFIG__"), "the page carries the switch");
  const evil = portalHtml({ on: true, sb: { url: "https://sb.test</script><script>alert(1)", anon: "a" }, provider: "paystack", live: true });
  check(!evil.includes("</script><script>alert"), "config can't close the script tag");
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
