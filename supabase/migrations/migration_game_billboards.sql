-- migration_game_billboards.sql
--
-- Billboards in EMILGO Games (games/emilgo-games/SPEC-V3.md §8): the paid
-- boards in the game's cities, sold and served from the same ad stack as the
-- app's feed and rewarded ads, not a parallel one.
--
-- ── What it adds ────────────────────────────────────────────────────────────
--   * `ad_creatives` learns the game: placement 'game_billboard', the board's
--     format (static picture, slideshow, film), the boards it is booked on
--     (none: any), the maps (none: every map), whether it is a premium static
--     booking (fixed to its boards for the match, outside the rotation), its
--     cycle (10 s, 30 s, or the whole match), whether its film may play sound,
--     and the review: pending until a person approves it.
--   * `game_billboard_slots`: every board in the game's cities, by the id the
--     game gives it (the game's adstest checks this list against the layouts).
--   * `ad_billboard_daily`: seconds on screen and views per day, map, board and
--     creative. Added up by the game server from the phones' reports. No user
--     id, no device, nothing about who (Vatar Agreement 4(f) bans profiling,
--     and the EMILGO app doesn't need it either).
--   * The game server's door: `next_billboards` and `record_billboard_seen`,
--     callable with the public anon key and GAME_ADS_KEY, a secret whose
--     SHA-256 is the only copy here (`game_ads_config`). The game server never
--     holds the service-role key.
--   * Self-serve: an advertiser signs in with an ordinary EMILGO account, gets
--     an `ad_partners` row of their own, uploads to the `ad-media` bucket,
--     submits (pending), pays (Paystack, Flutterwave or Stripe through the app's
--     server: `ad_payments`, settled only by that server with AD_BILLING_KEY),
--     and an admin approves in the Ad console. Budget runs out, serving stops
--     (`partner_has_budget` now counts billboard views too).
--   * Content rules, checked by a person in the review queue: no gambling, no
--     betting, nothing adult, no crypto, no scams, and nothing the Vatar
--     Developer Agreement §4(h) prohibits. A keyword screen flags what a
--     reviewer should look at twice; it never approves anything by itself.
--
-- ── What it never does ──────────────────────────────────────────────────────
--   * Serve a billboard in Lagos Life. Agreement 4(g) bans advertising any way
--     to pay other than Vatar.purchase, so the game never asks there and the
--     game server refuses host=lagoslife before it reaches this database.
--   * Put a billboard in the app's feed: `serve_feed_ads` is redefined below
--     with one added predicate (placement = 'app').
--
-- Prices are the owner's to set (`ad_billboard_prices`): the numbers inserted
-- here are placeholders for test mode, marked as such.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- ═════════════════════════════════════════════════════════════════════════════
-- CREATIVES: the game's boards
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS placement      TEXT    NOT NULL DEFAULT 'app',
  -- static: media_url is the picture. slideshow: `slides` holds 2–6 pictures.
  -- video: media_url is the film (mp4), poster_url its still (Low phones show only that).
  ADD COLUMN IF NOT EXISTS board_format   TEXT,
  ADD COLUMN IF NOT EXISTS slides         JSONB   NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS poster_url     TEXT,
  -- Booked boards (empty: any board) and maps (empty: every map, "global").
  ADD COLUMN IF NOT EXISTS slot_ids       TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS maps           TEXT[]  NOT NULL DEFAULT '{}',
  -- Fixed to its boards for the whole match, outside the rotation.
  ADD COLUMN IF NOT EXISTS static_premium BOOLEAN NOT NULL DEFAULT FALSE,
  -- Seconds on a board before the next creative; 0 = the whole match.
  ADD COLUMN IF NOT EXISTS cycle_s        INT     NOT NULL DEFAULT 30,
  -- The film may play sound (the player's own Ads audio setting still decides; it starts off).
  ADD COLUMN IF NOT EXISTS audio          BOOLEAN NOT NULL DEFAULT FALSE,
  -- The review. Rows made before this migration were entered by an admin: approved.
  ADD COLUMN IF NOT EXISTS review_status  TEXT    NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS review_notes   TEXT,
  ADD COLUMN IF NOT EXISTS review_rules   TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reviewed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- What the keyword screen saw (a reviewer looks twice; it never decides).
  ADD COLUMN IF NOT EXISTS content_flags  TEXT[]  NOT NULL DEFAULT '{}';

-- `format` gains 'billboard'. The CHECK it was born with (migration_ad_rewards.sql)
-- is found by what it says rather than by name, in case it was named otherwise.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.ad_creatives'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%format%rewarded%'
  LOOP
    EXECUTE format('ALTER TABLE public.ad_creatives DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_format_check;
ALTER TABLE public.ad_creatives ADD CONSTRAINT ad_creatives_format_check
  CHECK (format IN ('feed', 'banner', 'interstitial', 'rewarded', 'billboard'));

ALTER TABLE public.ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_placement_check;
ALTER TABLE public.ad_creatives ADD CONSTRAINT ad_creatives_placement_check
  CHECK (placement IN ('app', 'game_billboard'));

-- A billboard is exactly the game_billboard placement, with a board format and a known cycle.
ALTER TABLE public.ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_billboard_shape;
ALTER TABLE public.ad_creatives ADD CONSTRAINT ad_creatives_billboard_shape
  CHECK (
    ((placement = 'game_billboard') = (format = 'billboard'))
    AND (placement <> 'game_billboard' OR (
      board_format IN ('static', 'slideshow', 'video')
      AND cycle_s IN (0, 10, 30)
      AND jsonb_typeof(slides) = 'array'
      AND jsonb_array_length(slides) <= 6
    ))
  );

ALTER TABLE public.ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_review_check;
ALTER TABLE public.ad_creatives ADD CONSTRAINT ad_creatives_review_check
  CHECK (review_status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS ad_creatives_billboard_idx
  ON public.ad_creatives (static_premium DESC, weight DESC)
  WHERE placement = 'game_billboard' AND active AND review_status = 'approved';

CREATE INDEX IF NOT EXISTS ad_creatives_review_idx
  ON public.ad_creatives (created_at) WHERE review_status = 'pending';

CREATE INDEX IF NOT EXISTS ad_creatives_submitter_idx
  ON public.ad_creatives (submitted_by) WHERE submitted_by IS NOT NULL;


-- ═════════════════════════════════════════════════════════════════════════════
-- PARTNERS: a self-serve advertiser is a partner with an owner
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ad_partners
  ADD COLUMN IF NOT EXISTS owner_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS self_serve BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS ad_partners_owner_idx
  ON public.ad_partners (owner_id) WHERE owner_id IS NOT NULL;


-- ═════════════════════════════════════════════════════════════════════════════
-- THE BOARDS: every billboard in the game's cities
-- ═════════════════════════════════════════════════════════════════════════════

-- The ids are the game's own (maps/open/billboards.ts): the place of the board
-- in its city's list, so they never move. New boards are added here when the
-- game adds them; the game's adstest fails if the two lists disagree.
CREATE TABLE IF NOT EXISTS public.game_billboard_slots (
  id      TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2}-[0-9]{2}$'),
  map     TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('road', 'landmark', 'plaza', 'route', 'zone')),
  premium BOOLEAN NOT NULL DEFAULT FALSE,
  label   TEXT NOT NULL DEFAULT ''
);

ALTER TABLE public.game_billboard_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_billboard_slots_read ON public.game_billboard_slots;
CREATE POLICY game_billboard_slots_read ON public.game_billboard_slots
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS game_billboard_slots_admin ON public.game_billboard_slots;
CREATE POLICY game_billboard_slots_admin ON public.game_billboard_slots
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.game_billboard_slots (id, map, kind, premium, label) VALUES
  ('nw-02', 'naija-world', 'road', FALSE, 'Naija World: Main road, near Tailor''s Kiosk'),
  ('nw-03', 'naija-world', 'road', TRUE , 'Naija World: Main road, near Face-me-I-face-you'),
  ('nw-04', 'naija-world', 'road', FALSE, 'Naija World: Main road, near Central Bus Park'),
  ('nw-05', 'naija-world', 'road', FALSE, 'Naija World: Main road, near Primary School'),
  ('nw-06', 'naija-world', 'road', FALSE, 'Naija World: Main road, near Face-me-I-face-you'),
  ('nw-07', 'naija-world', 'road', FALSE, 'Naija World: Main road, near The Rooftops'),
  ('nw-08', 'naija-world', 'road', FALSE, 'Naija World: Main road, near Barber''s Shed'),
  ('nw-09', 'naija-world', 'landmark', TRUE , 'Naija World: Landmark, near Central Bus Park'),
  ('nw-10', 'naija-world', 'landmark', FALSE, 'Naija World: Landmark, near Mechanic Village'),
  ('nw-11', 'naija-world', 'landmark', FALSE, 'Naija World: Landmark, near Viewing Centre'),
  ('nw-12', 'naija-world', 'landmark', FALSE, 'Naija World: Landmark, near Petrol Station'),
  ('nw-13', 'naija-world', 'plaza', FALSE, 'Naija World: Plaza entrance, near Tailor''s Kiosk'),
  ('nw-14', 'naija-world', 'route', FALSE, 'Naija World: Danfo route, near Water Tower'),
  ('sw-01', 'spooky-world', 'route', FALSE, 'Spooky World: Run route, near Night Market'),
  ('sw-02', 'spooky-world', 'route', FALSE, 'Spooky World: Run route, near Face-me-I-face-you'),
  ('sw-03', 'spooky-world', 'route', FALSE, 'Spooky World: Run route, near Face-me-I-face-you'),
  ('sw-04', 'spooky-world', 'route', FALSE, 'Spooky World: Run route, near The Gutters'),
  ('sw-05', 'spooky-world', 'route', FALSE, 'Spooky World: Run route, near Uncompleted Estate'),
  ('sw-06', 'spooky-world', 'route', FALSE, 'Spooky World: Run route, near Tank Farm'),
  ('sw-07', 'spooky-world', 'route', FALSE, 'Spooky World: Run route, near St. Ruth''s Hospital Wing'),
  ('sw-08', 'spooky-world', 'route', FALSE, 'Spooky World: Run route, near St. Ruth''s Hospital Wing'),
  ('sw-09', 'spooky-world', 'route', FALSE, 'Spooky World: Run route, near Farm Edge'),
  ('sw-11', 'spooky-world', 'landmark', TRUE , 'Spooky World: Landmark, near The Broadcast Mast')
ON CONFLICT (id) DO UPDATE
  SET map = EXCLUDED.map, kind = EXCLUDED.kind, premium = EXCLUDED.premium, label = EXCLUDED.label;


-- ═════════════════════════════════════════════════════════════════════════════
-- SEEN: seconds on screen, added up (nothing about who)
-- ═════════════════════════════════════════════════════════════════════════════

-- One row per day, map, board and creative. `views` counts matches in which the
-- board was on screen with this creative for a second or more (billing's unit);
-- `seconds` is how long, all told.
CREATE TABLE IF NOT EXISTS public.ad_billboard_daily (
  day     DATE    NOT NULL,
  map     TEXT    NOT NULL,
  slot_id TEXT    NOT NULL REFERENCES public.game_billboard_slots(id) ON DELETE CASCADE,
  ad_id   UUID    NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  seconds NUMERIC(14,1) NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  views   INT     NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (day, map, slot_id, ad_id)
);

CREATE INDEX IF NOT EXISTS ad_billboard_daily_ad_idx ON public.ad_billboard_daily (ad_id, day);

ALTER TABLE public.ad_billboard_daily ENABLE ROW LEVEL SECURITY;

-- Admins read it all; an advertiser reads their own totals through my_billboard_ads().
DROP POLICY IF EXISTS ad_billboard_daily_read ON public.ad_billboard_daily;
CREATE POLICY ad_billboard_daily_read ON public.ad_billboard_daily
  FOR SELECT TO authenticated
  USING (public.is_admin());


-- ═════════════════════════════════════════════════════════════════════════════
-- THE GAME SERVER'S KEY, AND THE BILLING SERVER'S
-- ═════════════════════════════════════════════════════════════════════════════

-- Hex SHA-256 of each secret; NULL turns that door off. Set by the owner in the
-- SQL editor (never from a client: no policies, so only the service role and
-- the database owner can touch the table):
--   UPDATE public.game_ads_config SET game_key_hash = encode(extensions.digest('<GAME_ADS_KEY>', 'sha256'), 'hex');
--   UPDATE public.game_ads_config SET billing_key_hash = encode(extensions.digest('<AD_BILLING_KEY>', 'sha256'), 'hex');
CREATE TABLE IF NOT EXISTS public.game_ads_config (
  id               BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  game_key_hash    TEXT,
  billing_key_hash TEXT,
  -- The project's public address ('https://<ref>.supabase.co'): uploaded media
  -- must be on it. NULL: taken from the request's own Host header.
  storage_base     TEXT
);
ALTER TABLE public.game_ads_config ADD COLUMN IF NOT EXISTS storage_base TEXT;
INSERT INTO public.game_ads_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.game_ads_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_ads_config FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.ads_key_ok(p_which TEXT, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  SELECT COALESCE((
    SELECT length(COALESCE(p_key, '')) >= 24
           AND CASE p_which
                 WHEN 'game'    THEN c.game_key_hash
                 WHEN 'billing' THEN c.billing_key_hash
               END = encode(extensions.digest(p_key, 'sha256'), 'hex')
      FROM public.game_ads_config c WHERE c.id
  ), FALSE);
$$;

REVOKE ALL ON FUNCTION public.ads_key_ok(TEXT, TEXT) FROM PUBLIC, anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- PRICES (the owner's) AND PAYMENTS
-- ═════════════════════════════════════════════════════════════════════════════

-- What a billboard view costs, per thousand (rotation and premium), and the
-- smallest budget a self-serve advertiser may buy. PLACEHOLDERS for test mode:
-- the owner sets the real prices before billboards are sold.
CREATE TABLE IF NOT EXISTS public.ad_billboard_prices (
  id               BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  rotation_cpm     NUMERIC(10,2) NOT NULL CHECK (rotation_cpm >= 0),
  premium_cpm      NUMERIC(10,2) NOT NULL CHECK (premium_cpm >= 0),
  min_budget_naira NUMERIC(12,2) NOT NULL CHECK (min_budget_naira >= 0),
  placeholder      BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO public.ad_billboard_prices (id, rotation_cpm, premium_cpm, min_budget_naira, placeholder)
VALUES (TRUE, 1000, 2500, 5000, TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ad_billboard_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_billboard_prices_read ON public.ad_billboard_prices;
CREATE POLICY ad_billboard_prices_read ON public.ad_billboard_prices
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS ad_billboard_prices_admin ON public.ad_billboard_prices;
CREATE POLICY ad_billboard_prices_admin ON public.ad_billboard_prices
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- One row per checkout. Created by the advertiser (pending); settled only by
-- the app's server, after the provider confirms, with AD_BILLING_KEY.
CREATE TABLE IF NOT EXISTS public.ad_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   UUID NOT NULL REFERENCES public.ad_partners(id) ON DELETE CASCADE,
  creative_id  UUID REFERENCES public.ad_creatives(id) ON DELETE SET NULL,
  provider     TEXT NOT NULL CHECK (provider IN ('paystack', 'flutterwave', 'stripe')),
  amount_naira NUMERIC(12,2) NOT NULL CHECK (amount_naira > 0),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  provider_ref TEXT,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ad_payments_partner_idx ON public.ad_payments (partner_id, created_at DESC);

ALTER TABLE public.ad_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_payments_read ON public.ad_payments;
CREATE POLICY ad_payments_read ON public.ad_payments
  FOR SELECT TO authenticated
  USING (public.is_admin() OR created_by = auth.uid());


-- ═════════════════════════════════════════════════════════════════════════════
-- BUDGETS: billboard views bill the partner too
-- ═════════════════════════════════════════════════════════════════════════════

-- Redefined from migration_ad_partners.sql: spend now adds billboard views to
-- the app's impressions (a premium booking's views at the premium price, the
-- rest at the partner's CPM). A self-serve partner with nothing paid is out of
-- budget; a direct partner at 0 is uncapped, as before; a house ad (no
-- partner) is always in budget.
CREATE OR REPLACE FUNCTION public.partner_has_budget(p_partner UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_partner IS NULL THEN TRUE
    ELSE COALESCE((
      SELECT p.active
             AND (p.budget_naira <= 0 AND NOT p.self_serve   -- 0 means uncapped (direct partners only)
                  OR p.budget_naira > (
                    (SELECT COUNT(*)
                       FROM public.ad_events e
                       JOIN public.ad_creatives c ON c.id = e.ad_id
                      WHERE c.partner_id = p.id AND e.kind = 'impression')
                  ) * p.cpm_naira / 1000.0
                  + (SELECT COALESCE(SUM(d.views * CASE WHEN c.static_premium THEN GREATEST(pr.premium_cpm, p.cpm_naira) ELSE p.cpm_naira END), 0)
                       FROM public.ad_billboard_daily d
                       JOIN public.ad_creatives c ON c.id = d.ad_id
                      WHERE c.partner_id = p.id) / 1000.0)
        FROM public.ad_partners p
        CROSS JOIN (SELECT premium_cpm FROM public.ad_billboard_prices WHERE id) pr
       WHERE p.id = p_partner
    ), FALSE)
  END;
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- THE FEED KEEPS TO THE APP
-- ═════════════════════════════════════════════════════════════════════════════

-- Redefined from migration_social_feed.sql with one added predicate: a
-- billboard is never a promoted post.
CREATE OR REPLACE FUNCTION public.serve_feed_ads(p_limit INT DEFAULT 3)
RETURNS TABLE (
  id UUID, advertiser_name TEXT, advertiser_handle TEXT, advertiser_logo TEXT,
  headline TEXT, body TEXT, media_url TEXT, media_type TEXT,
  cta_label TEXT, cta_url TEXT
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.advertiser_name, c.advertiser_handle, c.advertiser_logo,
         c.headline, c.body, c.media_url, c.media_type, c.cta_label, c.cta_url
    FROM public.ad_creatives c
    JOIN public.users u ON u.id = auth.uid()
   WHERE c.active
     AND c.placement = 'app'
     AND c.starts_at <= now()
     AND (c.ends_at IS NULL OR c.ends_at > now())
     AND (cardinality(c.target_roles) = 0 OR u.role = ANY (c.target_roles))
     AND NOT EXISTS (
       SELECT 1 FROM public.ad_events e
        WHERE e.ad_id = c.id AND e.user_id = auth.uid() AND e.kind = 'dismiss'
          AND e.created_at > now() - INTERVAL '7 days'
     )
     AND (c.daily_cap IS NULL OR (
       SELECT COUNT(*) FROM public.ad_events e
        WHERE e.ad_id = c.id AND e.kind = 'impression'
          AND e.created_at > date_trunc('day', now())
     ) < c.daily_cap)
   ORDER BY -ln(random()) / c.weight
   LIMIT GREATEST(1, LEAST(p_limit, 10));
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- THE GAME SERVER'S TWO CALLS
-- ═════════════════════════════════════════════════════════════════════════════

/**
 * The creatives a match on `p_map` may show: approved, live, in budget, under
 * today's cap, on this map or every map. Premium bookings first, then the
 * rotation by weight. In the shape the game reads (net/ads.ts).
 */
CREATE OR REPLACE FUNCTION public.next_billboards(p_key TEXT, p_map TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Africa/Lagos')::DATE;
  v_out   JSONB;
BEGIN
  IF NOT public.ads_key_ok('game', p_key) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(s.ad ORDER BY s.premium DESC, s.w DESC), '[]'::JSONB) INTO v_out
    FROM (
      SELECT jsonb_build_object(
               'id',      c.id,
               'format',  c.board_format,
               'images',  CASE c.board_format
                            WHEN 'static'    THEN jsonb_build_array(c.media_url)
                            WHEN 'slideshow' THEN c.slides
                            ELSE '[]'::JSONB
                          END,
               'video',   CASE WHEN c.board_format = 'video' THEN c.media_url END,
               'poster',  c.poster_url,
               'cycle',   c.cycle_s,
               'audio',   c.audio,
               'slots',   to_jsonb(c.slot_ids),
               'premium', c.static_premium
             ) AS ad,
             c.static_premium AS premium,
             c.weight * random() AS w
        FROM public.ad_creatives c
       WHERE c.placement = 'game_billboard'
         AND c.active
         AND c.review_status = 'approved'
         AND c.starts_at <= now()
         AND (c.ends_at IS NULL OR c.ends_at > now())
         AND (cardinality(c.maps) = 0 OR p_map = ANY (c.maps))
         AND public.partner_has_budget(c.partner_id)
         AND (c.daily_cap IS NULL OR COALESCE((
               SELECT SUM(d.views) FROM public.ad_billboard_daily d
                WHERE d.ad_id = c.id AND d.day = v_today), 0) < c.daily_cap)
       ORDER BY premium DESC, w DESC
       LIMIT 12
    ) s;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.next_billboards(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_billboards(TEXT, TEXT) TO anon, authenticated;


/**
 * Seconds on screen from the game server, already added up per day, map,
 * board and creative. Rows for a board or a creative that isn't a billboard
 * here are skipped, and so is anything malformed. Returns how many were kept.
 */
CREATE OR REPLACE FUNCTION public.record_billboard_seen(p_key TEXT, p_rows JSONB)
RETURNS INT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r     JSONB;
  v_n   INT := 0;
  v_day DATE;
BEGIN
  IF NOT public.ads_key_ok('game', p_key) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'bad rows';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    CONTINUE WHEN COALESCE(r->>'day', '') !~ '^\d{4}-\d{2}-\d{2}$'
               OR COALESCE(r->>'ad', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               OR COALESCE(r->>'secs', '') !~ '^\d+(\.\d+)?$'
               OR COALESCE(r->>'views', '') !~ '^\d+$';
    v_day := (r->>'day')::DATE;
    CONTINUE WHEN v_day < CURRENT_DATE - 2 OR v_day > CURRENT_DATE + 1;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.game_billboard_slots s WHERE s.id = r->>'slot' AND s.map = r->>'map');
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.ad_creatives c WHERE c.id = (r->>'ad')::UUID AND c.placement = 'game_billboard');

    INSERT INTO public.ad_billboard_daily (day, map, slot_id, ad_id, seconds, views)
    VALUES (v_day, r->>'map', r->>'slot', (r->>'ad')::UUID,
            LEAST((r->>'secs')::NUMERIC, 1e9), LEAST((r->>'views')::INT, 1000000000))
    ON CONFLICT (day, map, slot_id, ad_id) DO UPDATE
      SET seconds = public.ad_billboard_daily.seconds + EXCLUDED.seconds,
          views   = public.ad_billboard_daily.views + EXCLUDED.views;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.record_billboard_seen(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_billboard_seen(TEXT, JSONB) TO anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- CONTENT RULES: what the keyword screen points a reviewer at
-- ═════════════════════════════════════════════════════════════════════════════

-- The rules every billboard is checked against by a person. The review refuses
-- an approval unless every one is ticked.
CREATE OR REPLACE FUNCTION public.billboard_rules()
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['no_gambling', 'no_betting', 'no_adult', 'no_crypto', 'no_scam', 'vatar_4h'];
$$;

/**
 * Words that suggest a rule may be broken, by rule. A flag only asks a
 * reviewer to look twice; it neither approves nor refuses anything.
 */
CREATE OR REPLACE FUNCTION public.billboard_content_flags(p_text TEXT)
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY_REMOVE(ARRAY[
    CASE WHEN p_text ~* '\m(casino|jackpot|lotto|lottery|poker|roulette|slot machine|scratch card)' THEN 'gambling' END,
    CASE WHEN p_text ~* '\m(bet|bets|betting|sportsbook|odds|stake|wager|accumulator|bookie|bookmaker)\M' THEN 'betting' END,
    CASE WHEN p_text ~* '\m(sex|sexy|xxx|porn|nude|nudes|escort|hookup|adult only|18\+)' THEN 'adult' END,
    CASE WHEN p_text ~* '\m(crypto|bitcoin|btc|ethereum|usdt|forex|nft|airdrop|token sale|ico|mining pool|binary option)' THEN 'crypto' END,
    CASE WHEN p_text ~* '(double your money|guaranteed (return|profit|income)|investment plan|ponzi|get rich|instant loan|loan app|free money|recharge card giveaway|\mhack)' THEN 'scam' END
  ], NULL);
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- SELF-SERVE: the advertiser's side
-- ═════════════════════════════════════════════════════════════════════════════

/** The caller's advertiser account (made the first time), with what's left of its budget. */
CREATE OR REPLACE FUNCTION public.my_ad_account(p_name TEXT DEFAULT NULL, p_email TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_p     public.ad_partners;
  v_price public.ad_billboard_prices;
  v_spent NUMERIC;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  SELECT * INTO v_price FROM public.ad_billboard_prices WHERE id;
  SELECT * INTO v_p FROM public.ad_partners WHERE owner_id = v_me;
  IF v_p.id IS NULL THEN
    IF COALESCE(btrim(p_name), '') = '' THEN
      RETURN jsonb_build_object('ok', TRUE, 'account', NULL,
        'prices', jsonb_build_object('rotation_cpm', v_price.rotation_cpm, 'premium_cpm', v_price.premium_cpm,
                                     'min_budget', v_price.min_budget_naira, 'placeholder', v_price.placeholder));
    END IF;
    INSERT INTO public.ad_partners (name, contact_email, owner_id, self_serve, budget_naira, cpm_naira, active)
    VALUES (left(btrim(p_name), 80), left(btrim(COALESCE(p_email, '')), 160), v_me, TRUE, 0, v_price.rotation_cpm, TRUE)
    RETURNING * INTO v_p;
  END IF;
  SELECT (SELECT COUNT(*) FROM public.ad_events e JOIN public.ad_creatives c ON c.id = e.ad_id
           WHERE c.partner_id = v_p.id AND e.kind = 'impression') * v_p.cpm_naira / 1000.0
       + (SELECT COALESCE(SUM(d.views * CASE WHEN c.static_premium THEN GREATEST(v_price.premium_cpm, v_p.cpm_naira) ELSE v_p.cpm_naira END), 0)
            FROM public.ad_billboard_daily d JOIN public.ad_creatives c ON c.id = d.ad_id
           WHERE c.partner_id = v_p.id) / 1000.0
    INTO v_spent;
  RETURN jsonb_build_object('ok', TRUE,
    'account', jsonb_build_object('id', v_p.id, 'name', v_p.name, 'budget', v_p.budget_naira,
                                  'spent', ROUND(v_spent, 2), 'cpm', v_p.cpm_naira, 'active', v_p.active),
    'prices', jsonb_build_object('rotation_cpm', v_price.rotation_cpm, 'premium_cpm', v_price.premium_cpm,
                                 'min_budget', v_price.min_budget_naira, 'placeholder', v_price.placeholder));
END;
$$;

REVOKE ALL ON FUNCTION public.my_ad_account(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_ad_account(TEXT, TEXT) TO authenticated;


/**
 * Submit a billboard. It waits for review (pending, not active) whatever the
 * caller says; media must be in the caller's own folder of the ad-media bucket.
 */
CREATE OR REPLACE FUNCTION public.submit_billboard_ad(
  p_headline   TEXT,
  p_website    TEXT,
  p_format     TEXT,
  p_media_url  TEXT    DEFAULT NULL,
  p_slides     JSONB   DEFAULT '[]'::JSONB,
  p_poster_url TEXT    DEFAULT NULL,
  p_maps       TEXT[]  DEFAULT '{}',
  p_slots      TEXT[]  DEFAULT '{}',
  p_premium    BOOLEAN DEFAULT FALSE,
  p_cycle      INT     DEFAULT 30,
  p_audio      BOOLEAN DEFAULT FALSE,
  p_starts_at  TIMESTAMPTZ DEFAULT now(),
  p_ends_at    TIMESTAMPTZ DEFAULT NULL,
  p_attest     TEXT[]  DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me     UUID := auth.uid();
  v_p      public.ad_partners;
  v_id     UUID;
  v_prefix TEXT;
  v_base   TEXT;
  v_urls   TEXT[];
  v_u      TEXT;
  v_text   TEXT;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  SELECT * INTO v_p FROM public.ad_partners WHERE owner_id = v_me;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'make your advertiser account first'; END IF;

  IF COALESCE(btrim(p_headline), '') = '' OR length(p_headline) > 120 THEN RAISE EXCEPTION 'a name for the ad is required (120 characters at most)'; END IF;
  IF COALESCE(p_website, '') !~ '^https://[^\s]{3,300}$' THEN RAISE EXCEPTION 'your website (https://…) is required'; END IF;
  IF p_format NOT IN ('static', 'slideshow', 'video') THEN RAISE EXCEPTION 'format: static, slideshow or video'; END IF;
  IF p_cycle NOT IN (0, 10, 30) THEN RAISE EXCEPTION 'cycle: 10, 30 or 0 (the whole match)'; END IF;
  IF p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at THEN RAISE EXCEPTION 'the end comes after the start'; END IF;
  -- The advertiser says the ad keeps every rule (a reviewer checks it again).
  IF NOT (public.billboard_rules() <@ COALESCE(p_attest, '{}')) THEN RAISE EXCEPTION 'confirm the content rules'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_maps, '{}')) m WHERE m NOT IN (SELECT DISTINCT map FROM public.game_billboard_slots)) THEN
    RAISE EXCEPTION 'unknown map';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_slots, '{}')) s WHERE s NOT IN (SELECT id FROM public.game_billboard_slots)) THEN
    RAISE EXCEPTION 'unknown board';
  END IF;
  IF p_premium AND (cardinality(COALESCE(p_slots, '{}')) = 0
     OR EXISTS (SELECT 1 FROM public.game_billboard_slots s WHERE s.id = ANY (p_slots) AND NOT s.premium)) THEN
    RAISE EXCEPTION 'a premium booking names premium boards only';
  END IF;

  -- The media: in this account's own folder of this project's ad-media bucket, nowhere else.
  SELECT COALESCE(c.storage_base, 'https://' || NULLIF(current_setting('request.headers', TRUE)::JSON->>'host', ''))
    INTO v_base FROM public.game_ads_config c WHERE c.id;
  IF v_base IS NULL THEN RAISE EXCEPTION 'billboards are not set up yet'; END IF;
  v_prefix := rtrim(v_base, '/') || '/storage/v1/object/public/ad-media/' || v_me::TEXT || '/';
  v_urls := CASE p_format
              WHEN 'static'    THEN ARRAY[p_media_url]
              WHEN 'slideshow' THEN ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_slides, '[]'::JSONB)))
              ELSE ARRAY[p_media_url, p_poster_url]
            END;
  IF p_format = 'slideshow' AND (cardinality(v_urls) < 2 OR cardinality(v_urls) > 6) THEN RAISE EXCEPTION 'a slideshow has 2 to 6 pictures'; END IF;
  FOREACH v_u IN ARRAY v_urls LOOP
    IF v_u IS NULL OR left(v_u, length(v_prefix)) <> v_prefix OR v_u ~ '[\s"''<>]' OR position('..' IN v_u) > 0 THEN
      RAISE EXCEPTION 'upload the media to your own folder first';
    END IF;
  END LOOP;

  v_text := concat_ws(' ', v_p.name, p_headline, p_website);
  INSERT INTO public.ad_creatives (
    partner_id, advertiser_name, headline, body, media_url, media_type, cta_label, cta_url,
    format, placement, board_format, slides, poster_url, maps, slot_ids, static_premium,
    cycle_s, audio, starts_at, ends_at, active, review_status, submitted_by, content_flags,
    category, weight
  ) VALUES (
    v_p.id, v_p.name, btrim(p_headline), '',
    CASE WHEN p_format = 'slideshow' THEN v_urls[1] ELSE p_media_url END,
    CASE WHEN p_format = 'video' THEN 'video' ELSE 'image' END,
    'Visit', p_website,
    'billboard', 'game_billboard', p_format,
    CASE WHEN p_format = 'slideshow' THEN COALESCE(p_slides, '[]'::JSONB) ELSE '[]'::JSONB END,
    CASE WHEN p_format = 'video' THEN p_poster_url END,
    COALESCE(p_maps, '{}'), COALESCE(p_slots, '{}'), COALESCE(p_premium, FALSE),
    p_cycle, COALESCE(p_audio, FALSE) AND p_format = 'video', COALESCE(p_starts_at, now()), p_ends_at,
    FALSE, 'pending', v_me, public.billboard_content_flags(v_text),
    'general', 1
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_billboard_ad FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_billboard_ad TO authenticated;


/** The caller's billboards with their review and what they've done so far. */
CREATE OR REPLACE FUNCTION public.my_billboard_ads()
RETURNS TABLE (
  id UUID, headline TEXT, board_format TEXT, review_status TEXT, review_notes TEXT, active BOOLEAN,
  maps TEXT[], slot_ids TEXT[], static_premium BOOLEAN, cycle_s INT,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
  views BIGINT, seconds NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.headline, c.board_format, c.review_status, c.review_notes, c.active,
         c.maps, c.slot_ids, c.static_premium, c.cycle_s,
         c.starts_at, c.ends_at, c.created_at,
         COALESCE(SUM(d.views), 0)::BIGINT, COALESCE(SUM(d.seconds), 0)
    FROM public.ad_creatives c
    LEFT JOIN public.ad_billboard_daily d ON d.ad_id = c.id
   WHERE c.submitted_by = auth.uid() AND c.placement = 'game_billboard'
   GROUP BY c.id
   ORDER BY c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.my_billboard_ads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_billboard_ads() TO authenticated;


/** A checkout begins: a pending payment on the caller's account. Its id is the provider's reference. */
CREATE OR REPLACE FUNCTION public.open_ad_payment(p_provider TEXT, p_amount_naira NUMERIC, p_creative UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_p     public.ad_partners;
  v_min   NUMERIC;
  v_id    UUID;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  SELECT * INTO v_p FROM public.ad_partners WHERE owner_id = v_me;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'make your advertiser account first'; END IF;
  IF p_provider NOT IN ('paystack', 'flutterwave', 'stripe') THEN RAISE EXCEPTION 'unknown provider'; END IF;
  SELECT min_budget_naira INTO v_min FROM public.ad_billboard_prices WHERE id;
  IF p_amount_naira IS NULL OR p_amount_naira < v_min OR p_amount_naira > 50000000 THEN
    RAISE EXCEPTION 'the budget is at least %', v_min;
  END IF;
  IF p_creative IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.ad_creatives c WHERE c.id = p_creative AND c.partner_id = v_p.id) THEN
    RAISE EXCEPTION 'not your ad';
  END IF;
  INSERT INTO public.ad_payments (partner_id, creative_id, provider, amount_naira, created_by)
  VALUES (v_p.id, p_creative, p_provider, ROUND(p_amount_naira, 2), v_me)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('reference', v_id, 'amount', ROUND(p_amount_naira, 2));
END;
$$;

REVOKE ALL ON FUNCTION public.open_ad_payment(TEXT, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_ad_payment(TEXT, NUMERIC, UUID) TO authenticated;


/**
 * The provider has confirmed a payment (the app's server checked it with the
 * provider first, and holds AD_BILLING_KEY). Settles once: the amount must
 * match what was opened, in naira; the partner's budget grows by it.
 */
CREATE OR REPLACE FUNCTION public.settle_ad_payment(
  p_key TEXT, p_reference UUID, p_provider TEXT, p_amount_kobo BIGINT, p_currency TEXT, p_provider_ref TEXT, p_ok BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pay public.ad_payments;
BEGIN
  IF NOT public.ads_key_ok('billing', p_key) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_pay FROM public.ad_payments WHERE id = p_reference FOR UPDATE;
  IF v_pay.id IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'unknown'); END IF;
  IF v_pay.status <> 'pending' THEN RETURN jsonb_build_object('ok', v_pay.status = 'paid', 'reason', 'already_' || v_pay.status); END IF;
  IF v_pay.provider <> p_provider THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'provider'); END IF;
  IF NOT p_ok THEN
    UPDATE public.ad_payments SET status = 'failed', settled_at = now(), provider_ref = left(p_provider_ref, 120) WHERE id = v_pay.id;
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'failed');
  END IF;
  IF upper(COALESCE(p_currency, '')) <> 'NGN' OR p_amount_kobo <> ROUND(v_pay.amount_naira * 100) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'amount');
  END IF;
  UPDATE public.ad_payments SET status = 'paid', settled_at = now(), provider_ref = left(p_provider_ref, 120) WHERE id = v_pay.id;
  UPDATE public.ad_partners SET budget_naira = budget_naira + v_pay.amount_naira WHERE id = v_pay.partner_id;
  RETURN jsonb_build_object('ok', TRUE, 'reason', 'paid', 'amount', v_pay.amount_naira);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_ad_payment(TEXT, UUID, TEXT, BIGINT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_ad_payment(TEXT, UUID, TEXT, BIGINT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- THE REVIEW QUEUE (admins, in the Ad console)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.list_billboard_reviews(p_status TEXT DEFAULT 'pending')
RETURNS TABLE (
  id UUID, partner_id UUID, partner_name TEXT, budget_naira NUMERIC, paid_naira NUMERIC,
  headline TEXT, cta_url TEXT, board_format TEXT, media_url TEXT, slides JSONB, poster_url TEXT,
  maps TEXT[], slot_ids TEXT[], static_premium BOOLEAN, cycle_s INT, audio BOOLEAN,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
  review_status TEXT, review_notes TEXT, review_rules TEXT[], content_flags TEXT[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  RETURN QUERY
  SELECT c.id, c.partner_id, pt.name, pt.budget_naira,
         COALESCE((SELECT SUM(p.amount_naira) FROM public.ad_payments p WHERE p.partner_id = c.partner_id AND p.status = 'paid'), 0),
         c.headline, c.cta_url, c.board_format, c.media_url, c.slides, c.poster_url,
         c.maps, c.slot_ids, c.static_premium, c.cycle_s, c.audio,
         c.starts_at, c.ends_at, c.created_at,
         c.review_status, c.review_notes, c.review_rules, c.content_flags
    FROM public.ad_creatives c
    LEFT JOIN public.ad_partners pt ON pt.id = c.partner_id
   WHERE c.placement = 'game_billboard'
     AND (p_status IS NULL OR c.review_status = p_status)
   ORDER BY c.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_billboard_reviews(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_billboard_reviews(TEXT) TO authenticated;


/**
 * A reviewer's decision. Approving needs every content rule ticked, a paid
 * budget (self-serve), and no other live premium booking on the same boards
 * at the same time. A rejection keeps the notes for the advertiser.
 */
CREATE OR REPLACE FUNCTION public.review_billboard_ad(p_id UUID, p_approve BOOLEAN, p_notes TEXT DEFAULT NULL, p_rules TEXT[] DEFAULT '{}')
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.ad_creatives;
  v_p public.ad_partners;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO v_c FROM public.ad_creatives WHERE id = p_id AND placement = 'game_billboard' FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'no such billboard'; END IF;

  IF p_approve THEN
    IF NOT (public.billboard_rules() <@ COALESCE(p_rules, '{}')) THEN
      RAISE EXCEPTION 'tick every content rule to approve';
    END IF;
    SELECT * INTO v_p FROM public.ad_partners WHERE id = v_c.partner_id;
    IF v_p.self_serve AND v_p.budget_naira <= 0 THEN
      RAISE EXCEPTION 'not paid yet';
    END IF;
    IF v_c.static_premium AND EXISTS (
      SELECT 1 FROM public.ad_creatives o
       WHERE o.id <> v_c.id AND o.placement = 'game_billboard' AND o.static_premium
         AND o.active AND o.review_status = 'approved'
         AND o.slot_ids && v_c.slot_ids
         AND tstzrange(o.starts_at, COALESCE(o.ends_at, 'infinity')) && tstzrange(v_c.starts_at, COALESCE(v_c.ends_at, 'infinity'))
    ) THEN
      RAISE EXCEPTION 'another premium booking holds one of these boards then';
    END IF;
  END IF;

  UPDATE public.ad_creatives SET
    review_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    active        = p_approve,
    review_notes  = NULLIF(btrim(COALESCE(p_notes, '')), ''),
    review_rules  = CASE WHEN p_approve THEN public.billboard_rules() ELSE COALESCE(p_rules, '{}') END,
    reviewed_by   = auth.uid(),
    reviewed_at   = now()
  WHERE id = v_c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_billboard_ad(UUID, BOOLEAN, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_billboard_ad(UUID, BOOLEAN, TEXT, TEXT[]) TO authenticated;

-- The console's on/off switch must not put an unreviewed billboard on the air.
CREATE OR REPLACE FUNCTION public.set_ad_creative_active(p_id UUID, p_active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_active AND EXISTS (SELECT 1 FROM public.ad_creatives WHERE id = p_id AND review_status <> 'approved') THEN
    RAISE EXCEPTION 'review it first';
  END IF;
  UPDATE public.ad_creatives SET active = p_active WHERE id = p_id;
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- MEDIA: the ad-media bucket (public to read: the game loads it; each
-- advertiser writes only their own folder)
-- ═════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ad-media', 'ad-media', TRUE, 20971520,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
ON CONFLICT (id) DO UPDATE
  SET public = TRUE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS ad_media_read   ON storage.objects;
DROP POLICY IF EXISTS ad_media_write  ON storage.objects;
DROP POLICY IF EXISTS ad_media_update ON storage.objects;
DROP POLICY IF EXISTS ad_media_delete ON storage.objects;

CREATE POLICY ad_media_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'ad-media');

CREATE POLICY ad_media_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ad-media' AND (storage.foldername(name))[1] = auth.uid()::TEXT);

CREATE POLICY ad_media_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'ad-media' AND (storage.foldername(name))[1] = auth.uid()::TEXT);

CREATE POLICY ad_media_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'ad-media' AND (storage.foldername(name))[1] = auth.uid()::TEXT);

COMMIT;
