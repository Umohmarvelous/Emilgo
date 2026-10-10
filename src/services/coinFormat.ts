// src/services/coinFormat.ts
//
// How a `cs` amount is written. Nothing else.
//
// ── Why this is its own file ───────────────────────────────────────────────
// `src/utils/helpers.ts` is imported by almost everything, including the store
// layer, and it needs to render coins. `src/services/coins.ts` also renders
// coins — but it imports the Supabase client, so having helpers import IT would
// drag a network client into every module that wanted a number formatted, and
// risk the same import cycle the `require()` in `formatDistance` exists to
// avoid.
//
// So the formatter lives here, with no imports at all, and both sides use it.
// The alternative — two copies of the same two lines — is how "1,240 cs" and
// "1240cs" end up on adjacent screens.

/** The unit string for 1. */
export const COIN_UNIT_SINGLE = "coin";
/** The unit string for multiple. */
export const COIN_UNIT_PLURAL = "coins";

/**
 * `1,240 coins`.
 *
 * The trailing unit rather than a leading glyph is deliberate: a leading symbol
 * is how currencies are written, and the whole point of this is that it is not
 * one. See COMPLIANCE.md §0.
 */
export function formatCs(amount: number | null | undefined): string {
  const n = Math.round(Number(amount ?? 0));
  const unit = Math.abs(n) === 1 ? COIN_UNIT_SINGLE : COIN_UNIT_PLURAL;
  return `${n.toLocaleString()} ${unit}`;
}

/** `+40 coins` / `-200 coins`, for a ledger row. */
export function formatCsSigned(amount: number): string {
  const n = Math.round(amount);
  return `${n > 0 ? "+" : ""}${formatCs(n)}`;
}
