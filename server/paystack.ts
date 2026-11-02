/**
 * server/paystack.ts
 *
 * Server-side Paystack endpoints. The SECRET key lives ONLY here (never in the app).
 * The mobile app calls these routes; this module calls Paystack.
 *
 * Behaviour is mock-by-default so the app works before you have keys:
 *   - If PAYSTACK_SECRET_KEY (sk_test_… / sk_live_…) is set → real Paystack calls.
 *   - If not set → deterministic mock responses (same shape) so dev keeps flowing.
 *
 * Endpoints:
 *   POST /api/paystack/initialize      → start a charge (passenger pays). Returns
 *                                        { authorization_url, access_code, reference }.
 *   GET  /api/paystack/verify/:ref     → verify a charge by reference.
 *   POST /api/paystack/transfer        → pay out to a driver's bank (recipient + transfer).
 *   GET  /api/paystack/resolve         → resolve an account name (payout safety check).
 *   POST /api/webhooks/paystack        → signed webhook (charge.success, transfer.success).
 */

import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { adBilling } from "./adBilling";

const PAYSTACK_BASE = "https://api.paystack.co";
const SECRET = process.env.PAYSTACK_SECRET_KEY || "";
const isLive = SECRET.startsWith("sk_");

function mockRef(prefix: string): string {
  return `${prefix}_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Card brand from BIN — display only. */
function brandOf(pan: string): string {
  const n = String(pan).replace(/\D/g, "");
  if (/^4/.test(n)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(n)) return "mastercard";
  if (/^(506[01]|507[89]|6500)/.test(n)) return "verve";
  if (/^3[47]/.test(n)) return "amex";
  return "card";
}

/** Thin wrapper around the Paystack REST API with the secret key attached. */
async function paystack(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; json: any }> {
  const resp = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json();
  return { ok: resp.ok, json };
}

export function registerPaystackRoutes(app: Express): void {
  if (!isLive) {
    console.log("[Paystack] No PAYSTACK_SECRET_KEY set — running in MOCK mode.");
  }

  // ── Initialize a charge (the passenger pays) ────────────────────────────────
  app.post("/api/paystack/initialize", async (req: Request, res: Response) => {
    const { email, amount, subaccount, metadata } = req.body ?? {};
    if (!email || !amount) {
      return res.status(400).json({ error: "email and amount (naira) are required" });
    }
    const kobo = Math.round(Number(amount) * 100);

    if (!isLive) {
      return res.json({
        mock: true,
        reference: mockRef("init"),
        authorization_url: null, // app falls back to its mock success in dev
        access_code: "mock_access_code",
        amount: kobo,
      });
    }
    const { ok, json } = await paystack("/transaction/initialize", "POST", {
      email,
      amount: kobo,
      subaccount,
      metadata,
    });
    if (!ok) return res.status(400).json(json);
    return res.json(json.data);
  });

  // ── Verify a charge by reference ────────────────────────────────────────────
  app.get("/api/paystack/verify/:reference", async (req: Request, res: Response) => {
    const reference = String(req.params.reference ?? "");
    if (!isLive) {
      return res.json({ mock: true, status: "success", reference, gateway_response: "Approved (mock)" });
    }
    const { ok, json } = await paystack(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      "GET",
    );
    if (!ok) return res.status(400).json(json);
    return res.json(json.data);
  });

  // ── Transfer a payout to a driver's bank account ────────────────────────────
  // Creates a transfer recipient (unless recipient_code is supplied) then transfers.
  app.post("/api/paystack/transfer", async (req: Request, res: Response) => {
    const { name, account_number, bank_code, amount, reason, recipient_code } = req.body ?? {};
    if (!amount) return res.status(400).json({ error: "amount (naira) is required" });
    const kobo = Math.round(Number(amount) * 100);

    if (!isLive) {
      return res.json({ mock: true, reference: mockRef("trf"), status: "success", amount: kobo });
    }

    let recipient = recipient_code as string | undefined;
    if (!recipient) {
      if (!account_number || !bank_code) {
        return res
          .status(400)
          .json({ error: "account_number and bank_code (or recipient_code) required" });
      }
      const r = await paystack("/transferrecipient", "POST", {
        type: "nuban",
        name,
        account_number,
        bank_code,
        currency: "NGN",
      });
      if (!r.ok) return res.status(400).json(r.json);
      recipient = r.json.data.recipient_code;
    }

    const t = await paystack("/transfer", "POST", {
      source: "balance",
      amount: kobo,
      recipient,
      reason: reason || "Emilgo driver payout",
    });
    if (!t.ok) return res.status(400).json(t.json);
    return res.json({ ...t.json.data, recipient_code: recipient });
  });

  // ── Resolve an account name (used before any payout is enabled) ─────────────
  app.get("/api/paystack/resolve", async (req: Request, res: Response) => {
    const account_number = String(req.query.account_number ?? "");
    const bank_code = String(req.query.bank_code ?? "");
    if (!account_number || !bank_code) {
      return res.status(400).json({ error: "account_number and bank_code required" });
    }
    if (!isLive) {
      return res.json({ mock: true, account_name: "Mock Account Holder", account_number });
    }
    const { ok, json } = await paystack(
      `/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
      "GET",
    );
    if (!ok) return res.status(400).json(json);
    return res.json(json.data);
  });

  // ── Tokenize a card → reusable authorization_code ───────────────────────────
  // ⚠️ Sending a raw PAN to your server puts you in PCI-DSS scope. For production,
  // prefer the Paystack Inline/popup (client-side, react-native-paystack-webview is
  // already bundled) so the card never touches your server. This server path backs
  // the custom card form + test keys. We keep ONLY the returned authorization_code.
  app.post("/api/paystack/tokenize-card", async (req: Request, res: Response) => {
    const { email, number, cvv, exp_month, exp_year } = req.body ?? {};
    if (!email || !number || !cvv || !exp_month || !exp_year) {
      return res.status(400).json({ error: "email, number, cvv, exp_month, exp_year required" });
    }
    const digits = String(number).replace(/\D/g, "");
    if (!isLive) {
      if (digits.length < 12) return res.status(400).json({ error: "invalid card number" });
      return res.json({ token: mockRef("authz"), brand: brandOf(digits), last4: digits.slice(-4) });
    }
    // Charge a small verification amount to obtain a reusable authorization.
    const { ok, json } = await paystack("/charge", "POST", {
      email,
      amount: 5000, // ₦50 verification (refund server-side if you wish)
      card: {
        number: digits,
        cvv: String(cvv),
        expiry_month: String(exp_month).padStart(2, "0"),
        expiry_year: String(exp_year).slice(-2),
      },
    });
    // A full integration must also handle data.status of "send_otp" | "send_pin" |
    // "open_url" (3-D Secure) before an authorization is issued.
    const auth = json?.data?.authorization;
    if (!ok || !auth?.authorization_code) {
      return res.status(400).json({
        error: json?.data?.gateway_response || json?.message || "Card could not be verified",
        status: json?.data?.status,
      });
    }
    return res.json({
      token: auth.authorization_code,
      brand: auth.brand || brandOf(digits),
      last4: auth.last4 || digits.slice(-4),
    });
  });

  // ── Direct-debit mandate (passenger authorizes future debits) ───────────────
  app.post("/api/paystack/mandate", async (req: Request, res: Response) => {
    const { email, account_number, bank_code } = req.body ?? {};
    if (!email || !account_number || !bank_code) {
      return res.status(400).json({ error: "email, account_number, bank_code required" });
    }
    if (!isLive) {
      return res.json({ token: mockRef("mandate"), bank_name: "Mock Bank" });
    }
    // Initiate a bank charge; the customer authorizes with an OTP, after which the
    // returned authorization_code is the reusable mandate. Production must complete
    // the OTP step (/charge/submit_otp) before the mandate is usable.
    const { ok, json } = await paystack("/charge", "POST", {
      email,
      amount: 5000,
      bank: { code: bank_code, account_number: String(account_number).replace(/\D/g, "") },
    });
    if (!ok) return res.status(400).json({ error: json?.message || "Could not start direct debit" });
    const auth = json?.data?.authorization;
    if (auth?.authorization_code) {
      return res.json({ token: auth.authorization_code, bank_name: auth.bank || undefined });
    }
    // OTP pending — surface the next step; the app should collect + submit the OTP.
    return res.json({ status: json?.data?.status, reference: json?.data?.reference, next: "otp" });
  });

  // ── Charge a saved authorization / mandate ──────────────────────────────────
  app.post("/api/paystack/charge-authorization", async (req: Request, res: Response) => {
    const { email, amount, authorization_code } = req.body ?? {};
    if (!email || !amount || !authorization_code) {
      return res.status(400).json({ error: "email, amount, authorization_code required" });
    }
    const kobo = Math.round(Number(amount) * 100);
    if (!isLive) {
      return res.json({ status: "success", reference: mockRef("chg"), amount: kobo });
    }
    const { ok, json } = await paystack("/transaction/charge_authorization", "POST", {
      email,
      amount: kobo,
      authorization_code,
    });
    const d = json?.data;
    if (!ok) return res.status(400).json({ status: "failed", reason: json?.message || "charge_failed" });
    if (d?.status === "success") return res.json({ status: "success", reference: d.reference });
    // e.g. "Insufficient funds" → "insufficient_funds" so the app can match it.
    return res.json({
      status: d?.status || "failed",
      reason: String(d?.gateway_response || "declined").toLowerCase().replace(/\s+/g, "_"),
    });
  });

  // ── Create a verified transfer recipient (driver payout) ────────────────────
  // Paystack runs the NIBSS name enquiry when the recipient is created.
  app.post("/api/paystack/transfer-recipient", async (req: Request, res: Response) => {
    const { name, account_number, bank_code } = req.body ?? {};
    if (!account_number || !bank_code) {
      return res.status(400).json({ error: "account_number and bank_code required" });
    }
    if (!isLive) {
      return res.json({ recipient_code: mockRef("rcp"), account_name: name || "Mock Account Holder" });
    }
    const { ok, json } = await paystack("/transferrecipient", "POST", {
      type: "nuban",
      name,
      account_number: String(account_number).replace(/\D/g, ""),
      bank_code,
      currency: "NGN",
    });
    if (!ok) return res.status(400).json({ error: json?.message || "Could not verify account" });
    return res.json({
      recipient_code: json.data.recipient_code,
      account_name: json.data.details?.account_name,
    });
  });

  // ── Webhook (charge.success / transfer.success), signature-verified ─────────
  app.post("/api/webhooks/paystack", (req: Request, res: Response) => {
    if (isLive) {
      const signature = req.header("x-paystack-signature");
      const raw = (req.rawBody as Buffer) ?? Buffer.from(JSON.stringify(req.body));
      const hash = crypto.createHmac("sha512", SECRET).update(raw).digest("hex");
      if (hash !== signature) {
        console.warn("[Paystack webhook] bad signature");
        return res.sendStatus(401);
      }
    }
    const event = req.body;
    console.log("[Paystack webhook]", event?.event, event?.data?.reference);
    // A billboard's budget (EMILGO Games): settled only on a signed event (live mode).
    if (isLive && event?.data?.metadata?.kind === "game_billboard") {
      adBilling().paystackEvent(event).catch((e) => console.warn("[Paystack webhook] billboard settle:", e?.message));
    }
    // TODO: persist the transaction / update trip or subscription state in Supabase.
    return res.sendStatus(200);
  });
}
