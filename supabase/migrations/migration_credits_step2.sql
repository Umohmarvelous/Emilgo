-- ============================================================================
-- Step 2 — Credit System hardening
--
-- Builds on migration_credits_auth.sql (which created public.credits_history).
-- Goals:
--   1. Make "earn once per user, per post/thread" enforceable on the SERVER,
--      not just in the client's local ledger (survives reinstall / new device).
--   2. Keep public.users.credits_balance consistent with the ledger sum so the
--      column never drifts, while preserving its DEFAULT 10 signup seed.
-- Safe to run more than once (idempotent guards throughout).
-- ============================================================================

-- ── 1. Idempotency key ──────────────────────────────────────────────────────
-- A deterministic string that identifies a "once-only" earn event.
-- The client fills this for like/comment/share/reply/signup; it is left NULL
-- for events that may legitimately repeat (e.g. ad_watch, added in Step 4).
ALTER TABLE public.credits_history
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

-- A plain UNIQUE index (not partial): Postgres treats NULLs as distinct, so
-- unlimited NULL-key rows are still allowed, while any two rows sharing the
-- SAME non-null dedupe_key collide. Using a full (non-partial) index means
-- `ON CONFLICT (dedupe_key)` works as an arbiter without a WHERE predicate,
-- which is what supabase-js `.upsert({ onConflict: 'dedupe_key' })` emits.
CREATE UNIQUE INDEX IF NOT EXISTS credits_history_dedupe_key_uidx
  ON public.credits_history (dedupe_key);

-- ── 2. Keep users.credits_balance == SUM(ledger) ────────────────────────────
-- RECOMPUTE (not increment): recomputing from the ledger means the DEFAULT 10
-- seed and a later "signup +10" ledger row both resolve to a balance of 10 —
-- no double counting — and any historical drift self-heals on the next insert.
CREATE OR REPLACE FUNCTION public.sync_credits_balance()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.users
     SET credits_balance = (
       SELECT COALESCE(SUM(amount), 0)
         FROM public.credits_history
        WHERE user_id = NEW.user_id
     )
   WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_credits_balance ON public.credits_history;
CREATE TRIGGER trg_sync_credits_balance
  AFTER INSERT ON public.credits_history
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_credits_balance();
