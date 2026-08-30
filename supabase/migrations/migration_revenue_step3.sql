-- ============================================================================
-- Step 3 — Revenue System
--
-- Adds the money layer that sits ALONGSIDE the engagement credits from Step 2:
--   1. public.pool_history  — a per-user ledger of REAL Naira (realised ad
--      revenue in, trip spends out). The sum is the passenger's spendable pool.
--   2. public.transactions  — an audit trail of every money movement (trip
--      payments + premium subscriptions).
--   3. public.users.pool_balance — kept == SUM(pool_history) by a trigger, the
--      same recompute pattern used for credits_balance in Step 2.
--
-- Mirrors the Step 2 hardening: a non-partial UNIQUE index on dedupe_key gives
-- idempotent `ON CONFLICT (dedupe_key) DO NOTHING` upserts (NULL keys stay
-- distinct, so entries allowed to repeat are never blocked).
-- Safe to run more than once (idempotent guards throughout).
-- ============================================================================

-- ── 1. Pool balance column on users ─────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pool_balance NUMERIC(12,2) DEFAULT 0;

-- ── 2. pool_history ledger ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pool_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    amount     NUMERIC(12,2) NOT NULL,           -- +credit in / -spend out (₦)
    kind       TEXT NOT NULL,                     -- ad_revenue | trip_spend | adjustment
    trip_id    UUID,                              -- set on trip_spend rows
    dedupe_key TEXT,                              -- "apply once" key; NULL = repeatable
    synced     BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Idempotency: any two rows sharing a non-null dedupe_key collide; NULLs allowed.
CREATE UNIQUE INDEX IF NOT EXISTS pool_history_dedupe_key_uidx
  ON public.pool_history (dedupe_key);
CREATE INDEX IF NOT EXISTS pool_history_user_idx
  ON public.pool_history (user_id);

ALTER TABLE public.pool_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view their own pool history"
    ON public.pool_history FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert their own pool history"
    ON public.pool_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Keep users.pool_balance == SUM(pool_history) ─────────────────────────
-- Recompute (not increment) so the column self-heals and never drifts.
CREATE OR REPLACE FUNCTION public.sync_pool_balance()
RETURNS TRIGGER AS $$
DECLARE
  target UUID := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  UPDATE public.users
     SET pool_balance = (
       SELECT COALESCE(SUM(amount), 0)
         FROM public.pool_history
        WHERE user_id = target
     )
   WHERE id = target;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_pool_balance ON public.pool_history;
CREATE TRIGGER trg_sync_pool_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.pool_history
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_pool_balance();

-- ── 4. transactions audit trail ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    kind                TEXT NOT NULL,            -- trip_payment | premium_subscription
    -- Trip payment fields (NULL for premium rows)
    base_fare           NUMERIC(12,2),
    passenger_bank_paid NUMERIC(12,2),
    pool_draw           NUMERIC(12,2),
    driver_bonus        NUMERIC(12,2),
    company_cut         NUMERIC(12,2),
    driver_total        NUMERIC(12,2),
    -- Premium payment fields (NULL for trip rows)
    premium_amount      NUMERIC(12,2),
    station_share       NUMERIC(12,2),
    company_share       NUMERIC(12,2),
    station_subaccount  TEXT,
    status              TEXT NOT NULL DEFAULT 'recorded',
    dedupe_key          TEXT,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_dedupe_key_uidx
  ON public.transactions (dedupe_key);
CREATE INDEX IF NOT EXISTS transactions_user_idx
  ON public.transactions (user_id);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view their own transactions"
    ON public.transactions FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert their own transactions"
    ON public.transactions FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
