// Every Vatar SDK error code, with what to tell a player. Source of truth:
// https://lagoslife.app/developers/docs#errors (read 13 Oct 2026).
//
// Note: the v1 SDK script only passes through codes in its own table and
// turns anything else into "error". `not_available` is documented but is NOT
// in that table, so in practice "matches aren't on" may arrive as "error".
// Phase 3's match code must treat both the same way.

export const VATAR_ERROR_TEXT: Record<string, string> = {
  not_framed: "Open this game from the Games app in Lagos Life.",
  timeout: "Lagos Life didn't answer in time. Check your network and try again.",
  rate_limited: "Easy! Too many tries. Wait small, then try again.",
  busy: "A pay sheet is already open.",
  cancelled: "Payment cancelled. Nothing was charged.",
  payment_failed: "The payment didn't go through.",
  not_for_sale: "This item isn't for sale right now.",
  owned: "You already own this.",
  off: "This game is switched off in Lagos Life right now.",
  not_available: "Online matches aren't open for this game yet.",
  signed_out: "Sign in to Lagos Life to put your score on the board.",
  too_soon: "Score noted. The board takes one score every 20 seconds.",
  friendly_only: "Only friendly matches for now — no stakes.",
  limit: "That's over a stake limit for today.",
  not_found: "No open match with that code.",
  not_open: "That match is full, started or over.",
  not_multiplayer: "Matches aren't on for this game.",
  bad_request: "That request didn't go through. Try again.",
  error: "Something went wrong on Lagos Life's side. Try again.",
};

export function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "error";
}

export function errorText(e: unknown): string {
  return VATAR_ERROR_TEXT[errorCode(e)] ?? VATAR_ERROR_TEXT.error;
}
