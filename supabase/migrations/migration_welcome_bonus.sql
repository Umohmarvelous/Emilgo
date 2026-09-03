CREATE TABLE IF NOT EXISTS public.welcome_bonus_claims (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending', -- pending, watching, claimed
    ads_watched INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.welcome_bonus_claims ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can read own welcome bonus claim"
    ON public.welcome_bonus_claims FOR SELECT USING (auth.uid() = user_id);
  CREATE POLICY "Users can insert own welcome bonus claim"
    ON public.welcome_bonus_claims FOR INSERT WITH CHECK (auth.uid() = user_id);
  CREATE POLICY "Users can update own welcome bonus claim"
    ON public.welcome_bonus_claims FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RPC to check if a user is in the first 500 users
CREATE OR REPLACE FUNCTION public.check_welcome_bonus_eligibility(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rank INTEGER;
BEGIN
  -- Find the rank of the user based on created_at
  SELECT rank INTO v_rank
  FROM (
    SELECT id, rank() OVER (ORDER BY created_at ASC) as rank
    FROM auth.users
  ) ranked_users
  WHERE id = p_user_id;

  -- Only first 500 users are eligible
  RETURN v_rank <= 500;
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_welcome_bonus_eligibility(UUID) TO authenticated;
