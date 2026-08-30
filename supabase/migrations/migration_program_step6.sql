-- ============================================================================
-- Step 6 — Program Page (Loyalty) + KYC
--
--   1. public.users gains KYC / payout / program columns + salted id hashes.
--   2. UNIQUE indexes on nin_hash / bvn_hash enforce "one identity per account"
--      at the database (a duplicate id makes the user UPDATE fail — the real
--      anti-fraud guarantee, not just a client check).
--   3. public.program_applications — an audit row per loyalty application.
--   4. eligible_accounts_on_device() — a SECURITY DEFINER counter so the client
--      can enforce the device cap without being able to read other users' rows.
--
-- Only HASHES of NIN/BVN are stored, never the raw numbers.
-- Safe to run more than once (idempotent guards throughout).
-- ============================================================================

-- ── 1. User columns ──────────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS program_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS payout_bank_code TEXT,
  ADD COLUMN IF NOT EXISTS payout_account_number TEXT,
  ADD COLUMN IF NOT EXISTS payout_account_name TEXT,
  ADD COLUMN IF NOT EXISTS nin_hash TEXT,
  ADD COLUMN IF NOT EXISTS bvn_hash TEXT;

-- One identity → one account. Partial so many NULLs (not-yet-verified) are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS users_nin_hash_uidx
  ON public.users (nin_hash) WHERE nin_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_bvn_hash_uidx
  ON public.users (bvn_hash) WHERE bvn_hash IS NOT NULL;

-- ── 2. program_applications audit table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.program_applications (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    id_type            TEXT NOT NULL,            -- nin | bvn
    id_hash            TEXT NOT NULL,            -- salted hash, never the raw id
    phone              TEXT,
    otp_verified       BOOLEAN DEFAULT false,
    bank_code          TEXT,
    account_number     TEXT,
    account_name       TEXT,
    kyc_reference      TEXT,
    status             TEXT NOT NULL DEFAULT 'pending',
    device_fingerprint TEXT,
    dedupe_key         TEXT,
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS program_applications_dedupe_key_uidx
  ON public.program_applications (dedupe_key);
CREATE INDEX IF NOT EXISTS program_applications_user_idx
  ON public.program_applications (user_id);

ALTER TABLE public.program_applications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view their own applications"
    ON public.program_applications FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert their own applications"
    ON public.program_applications FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Device-cap counter (RLS-safe via SECURITY DEFINER) ────────────────────
-- Counts rewards-eligible accounts already tied to a device fingerprint. The
-- client can't read other users' rows directly, so it calls this instead.
CREATE OR REPLACE FUNCTION public.eligible_accounts_on_device(fp TEXT)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
    FROM public.users
   WHERE device_fingerprint = fp
     AND program_status IN ('eligible', 'enrolled');
$$ LANGUAGE sql SECURITY DEFINER;
