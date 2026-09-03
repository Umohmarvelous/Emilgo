// constants/devFlags.ts
//
// Deliberate, temporary relaxations of production rules — all in one file so
// there is exactly one place to look before a release.
//
// ═════════════════════════════════════════════════════════════════════════════
//  HOW TO USE THIS FILE
//
//  Flip a flag to `true` to relax the rule, `false` to restore it. Nothing else
//  needs changing anywhere in the app — every flag is read from this module.
//
//  After flipping one, reload the app (press `r` in the Metro terminal). These
//  are compile-time constants, not settings, so a hot reload is enough but a
//  running JS bundle will not pick it up on its own.
//
//  ⚠️  EVERY FLAG MUST BE `false` BEFORE SHIPPING. `assertProductionFlags()`
//      below throws in a production build if one is left on, so a forgotten
//      flag fails loudly at startup instead of quietly costing someone money.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Lets a driver save a payout bank account WITHOUT Paystack name-verification.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Scan-to-pay cannot be tested end to end until a driver has a payout account,
 * and adding one normally requires Paystack's account-resolution endpoint to
 * name-check the NUBAN. That needs a live secret key on the server, which needs
 * a verified Paystack business — see SETUP-KEYS.md. Until that exists, every
 * driver is stuck one screen before the thing you want to test.
 *
 * ── What turning it on actually does ───────────────────────────────────────
 *   • The "Verify account" step is skipped; the driver types the account name.
 *   • The screen shows a permanent orange "TEST MODE" banner, so nobody mistakes
 *     an unverified account for a verified one.
 *   • The saved row is marked `payout_verified: false`.
 *
 * ── What it does NOT do ────────────────────────────────────────────────────
 * It does not move real money. Payouts still run through Paystack, which will
 * reject an account number that does not exist. This only unblocks the UI.
 *
 * ── Turning it back on/off ─────────────────────────────────────────────────
 *   Testing:    set to `true`  → drivers can add any 10-digit NUBAN.
 *   Production: set to `false` → Paystack verification required again.
 */
export const ALLOW_UNVERIFIED_PAYOUT_ACCOUNT = true;

/**
 * Every flag above, by name, for the startup assertion and for the debug screen
 * that lists what is currently relaxed.
 */
export const DEV_FLAGS = {
  ALLOW_UNVERIFIED_PAYOUT_ACCOUNT,
} as const;

/** True when any relaxation is active — drives the in-app warning banner. */
export const ANY_DEV_FLAG_ON = Object.values(DEV_FLAGS).some(Boolean);

/**
 * Called once from the root layout.
 *
 * In development a left-on flag is the point, so it only warns. In a production
 * build it throws: shipping with payout verification disabled is the kind of
 * mistake that is invisible until money is involved, and a crash on launch in
 * CI is far cheaper than discovering it from a user.
 */
export function assertProductionFlags() {
  const on = Object.entries(DEV_FLAGS)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (!on.length) return;

  const message = `Dev flags left on: ${on.join(", ")} — see constants/devFlags.ts`;
  if (__DEV__) {
    console.warn(`⚠️  ${message}`);
  } else {
    throw new Error(message);
  }
}
