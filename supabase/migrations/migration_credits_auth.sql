-- Add new columns to public.users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS credits_balance INTEGER DEFAULT 0;

-- Create credits_history table
CREATE TABLE IF NOT EXISTS public.credits_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    post_id UUID,
    comment_id UUID,
    synced BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS for credits_history
ALTER TABLE public.credits_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own credits history"
    ON public.credits_history FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own credits history"
    ON public.credits_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Function to resolve username safely for login without exposing all user data
CREATE OR REPLACE FUNCTION public.get_user_by_username(p_username TEXT)
RETURNS TABLE (email TEXT, device_fingerprint TEXT) AS $$
BEGIN
  RETURN QUERY SELECT u.email, u.device_fingerprint FROM public.users u WHERE u.username = p_username LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
