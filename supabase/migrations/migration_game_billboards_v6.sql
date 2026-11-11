-- EMILGO Games v6: numbered billboards, and booking one board for 1 or 2 weeks.
-- Needs migration_game_billboards.sql first (not _max.sql: the big world's boards are here too). Safe to run again.
--
-- ── What it adds ────────────────────────────────────────────────────────────
--   * Every board gets a number and a name with its place, in the world's own
--     order ("Billboard 12 · Harbour Yard (roadside)"), like Lagos Life's.
--     The rows are written by games/emilgo-games/scripts/billboard-numbers.ts.
--   * Fixed prices to book one board: 1 week or 2 weeks, standard or premium
--     (`game_billboard_week_prices`). Test placeholders until the owner sets
--     them (`placeholder`).
--   * `game_billboard_bookings`: one board, one advertiser, one window; a board
--     can't be booked twice for the same days (a pending booking holds it for
--     an hour while its payment goes through).
--   * `billboard_boards()`: the numbered list for the advertiser portal, with
--     each board's prices and when it's next free.
--   * `book_billboard(...)`: opens the payment for a booking (the app's server
--     then sends the advertiser to Paystack, Flutterwave or Stripe).
--   * `settle_ad_payment` learns bookings: a paid booking puts its ad on that
--     board for its window (instead of adding to a view budget).
--   * `next_billboards` serves a booked ad on its board for its window, whatever
--     the advertiser's view budget.
--
-- ── What it never does ──────────────────────────────────────────────────────
--   * Anything in Lagos Life (the game never asks there; Agreement 4(g)).
--   * Skip the review queue: a booked ad still shows only once approved.

ALTER TABLE public.game_billboard_slots ADD COLUMN IF NOT EXISTS number INT;

-- BEGIN generated: scripts/billboard-numbers.ts (79 boards)
INSERT INTO public.game_billboard_slots (id, map, kind, premium, label, number) VALUES
  ('nw-02', 'naija-world', 'road', FALSE, 'Billboard 1 · near Newsstand (roadside, two-sided)', 1),
  ('nw-03', 'naija-world', 'road', TRUE , 'Billboard 2 · near Courtyard Flats (roadside, premium, two-sided)', 2),
  ('nw-04', 'naija-world', 'road', FALSE, 'Billboard 3 · near Courtyard Flats (roadside, two-sided)', 3),
  ('nw-05', 'naija-world', 'road', FALSE, 'Billboard 4 · near Bike Park (roadside, two-sided)', 4),
  ('nw-06', 'naija-world', 'road', FALSE, 'Billboard 5 · near Courtyard Flats (roadside, two-sided)', 5),
  ('nw-07', 'naija-world', 'road', FALSE, 'Billboard 6 · near The Rooftops (roadside, two-sided)', 6),
  ('nw-08', 'naija-world', 'road', FALSE, 'Billboard 7 · near Barber Shop (roadside, two-sided)', 7),
  ('nw-09', 'naija-world', 'landmark', TRUE , 'Billboard 8 · near Bike Park (landmark, premium)', 8),
  ('nw-10', 'naija-world', 'landmark', FALSE, 'Billboard 9 · near Auto Row (landmark)', 9),
  ('nw-11', 'naija-world', 'landmark', FALSE, 'Billboard 10 · near Barber Shop (landmark)', 10),
  ('nw-12', 'naija-world', 'landmark', FALSE, 'Billboard 11 · near Barber Shop (landmark)', 11),
  ('nw-13', 'naija-world', 'plaza', FALSE, 'Billboard 12 · near Newsstand (plaza entrance)', 12),
  ('nw-14', 'naija-world', 'route', FALSE, 'Billboard 13 · near The Rooftops (bus route)', 13),
  ('mx-01', 'max-world', 'road', TRUE , 'Billboard 14 · near Glass District (roadside, premium, two-sided)', 14),
  ('mx-02', 'max-world', 'road', TRUE , 'Billboard 15 · near Construction Site (roadside, premium, two-sided)', 15),
  ('mx-03', 'max-world', 'road', FALSE, 'Billboard 16 · near Rail Siding (roadside, two-sided)', 16),
  ('mx-04', 'max-world', 'road', FALSE, 'Billboard 17 · near The Manor (roadside, two-sided)', 17),
  ('mx-05', 'max-world', 'road', FALSE, 'Billboard 18 · near Ironwood Forest (roadside, two-sided)', 18),
  ('mx-06', 'max-world', 'road', FALSE, 'Billboard 19 · near Harbour Yard (roadside, two-sided)', 19),
  ('mx-07', 'max-world', 'road', FALSE, 'Billboard 20 · near Dune Sea (roadside, two-sided)', 20),
  ('mx-08', 'max-world', 'road', FALSE, 'Billboard 21 · near Mangrove Sink (roadside, two-sided)', 21),
  ('mx-09', 'max-world', 'landmark', TRUE , 'Billboard 22 · Harbour Yard (landmark, premium)', 22),
  ('mx-10', 'max-world', 'landmark', FALSE, 'Billboard 23 · Black Refinery (landmark)', 23),
  ('mx-11', 'max-world', 'landmark', FALSE, 'Billboard 24 · Old Airfield (landmark)', 24),
  ('mx-12', 'max-world', 'landmark', FALSE, 'Billboard 25 · Dune Sea (landmark)', 25),
  ('mx-13', 'max-world', 'landmark', FALSE, 'Billboard 26 · Mangrove Sink (landmark)', 26),
  ('mx-14', 'max-world', 'landmark', FALSE, 'Billboard 27 · Ironwood Forest (landmark)', 27),
  ('mx-15', 'max-world', 'landmark', FALSE, 'Billboard 28 · Windmere Ridge (landmark)', 28),
  ('mx-16', 'max-world', 'plaza', TRUE , 'Billboard 29 · Neon Row (plaza entrance, premium)', 29),
  ('mx-17', 'max-world', 'plaza', TRUE , 'Billboard 30 · The Arena (plaza entrance, premium)', 30),
  ('mx-18', 'max-world', 'road', FALSE, 'Billboard 31 · near Ironwood Forest (roadside, two-sided)', 31),
  ('mx-19', 'max-world', 'road', TRUE , 'Billboard 32 · Ironwood Forest (roadside, premium, two-sided)', 32),
  ('mx-20', 'max-world', 'road', FALSE, 'Billboard 33 · Ironwood Forest (roadside, two-sided)', 33),
  ('mx-21', 'max-world', 'road', FALSE, 'Billboard 34 · near Dune Sea (roadside, two-sided)', 34),
  ('mx-22', 'max-world', 'road', TRUE , 'Billboard 35 · Dune Sea (roadside, premium, two-sided)', 35),
  ('mx-23', 'max-world', 'road', FALSE, 'Billboard 36 · Dune Sea (roadside, two-sided)', 36),
  ('mx-24', 'max-world', 'road', FALSE, 'Billboard 37 · near Harbour Yard (roadside, two-sided)', 37),
  ('mx-25', 'max-world', 'road', FALSE, 'Billboard 38 · Harbour Yard (roadside, two-sided)', 38),
  ('mx-26', 'max-world', 'road', FALSE, 'Billboard 39 · Harbour Yard (roadside, two-sided)', 39),
  ('mx-27', 'max-world', 'road', FALSE, 'Billboard 40 · near Mangrove Sink (roadside, two-sided)', 40),
  ('mx-28', 'max-world', 'road', FALSE, 'Billboard 41 · Mangrove Sink (roadside, two-sided)', 41),
  ('mx-29', 'max-world', 'road', FALSE, 'Billboard 42 · Mangrove Sink (roadside, two-sided)', 42),
  ('mx-30', 'max-world', 'road', FALSE, 'Billboard 43 · near Ironwood Forest (roadside, two-sided)', 43),
  ('mx-31', 'max-world', 'road', FALSE, 'Billboard 44 · near Glass District (roadside, two-sided)', 44),
  ('mx-32', 'max-world', 'road', FALSE, 'Billboard 45 · near Dune Sea (roadside, two-sided)', 45),
  ('mx-33', 'max-world', 'road', FALSE, 'Billboard 46 · near Dune Sea (roadside, two-sided)', 46),
  ('mx-34', 'max-world', 'road', FALSE, 'Billboard 47 · near Glass District (roadside, two-sided)', 47),
  ('mx-35', 'max-world', 'road', FALSE, 'Billboard 48 · near Harbour Yard (roadside, two-sided)', 48),
  ('mx-36', 'max-world', 'road', FALSE, 'Billboard 49 · near Mangrove Sink (roadside, two-sided)', 49),
  ('mx-37', 'max-world', 'road', FALSE, 'Billboard 50 · near Mangrove Sink (roadside, two-sided)', 50),
  ('mx-38', 'max-world', 'road', FALSE, 'Billboard 51 · Windmere Ridge (roadside, two-sided)', 51),
  ('mx-39', 'max-world', 'road', FALSE, 'Billboard 52 · Black Refinery (roadside, two-sided)', 52),
  ('mx-40', 'max-world', 'road', FALSE, 'Billboard 53 · near Old Airfield (roadside, two-sided)', 53),
  ('mx-41', 'max-world', 'landmark', FALSE, 'Billboard 54 · Harbour Yard (landmark)', 54),
  ('mx-42', 'max-world', 'landmark', FALSE, 'Billboard 55 · Harbour Yard (landmark)', 55),
  ('mx-43', 'max-world', 'landmark', FALSE, 'Billboard 56 · Black Refinery (landmark)', 56),
  ('mx-44', 'max-world', 'landmark', TRUE , 'Billboard 57 · Old Airfield (landmark, premium)', 57),
  ('mx-45', 'max-world', 'landmark', FALSE, 'Billboard 58 · Dune Sea (landmark)', 58),
  ('mx-46', 'max-world', 'landmark', FALSE, 'Billboard 59 · Dune Sea (landmark)', 59),
  ('mx-47', 'max-world', 'landmark', FALSE, 'Billboard 60 · Mangrove Sink (landmark)', 60),
  ('mx-48', 'max-world', 'landmark', FALSE, 'Billboard 61 · Ironwood Forest (landmark)', 61),
  ('mx-49', 'max-world', 'landmark', FALSE, 'Billboard 62 · Ironwood Forest (landmark)', 62),
  ('mx-50', 'max-world', 'landmark', FALSE, 'Billboard 63 · Windmere Ridge (landmark)', 63),
  ('mx-51', 'max-world', 'plaza', TRUE , 'Billboard 64 · Neon Row (plaza entrance, premium)', 64),
  ('mx-52', 'max-world', 'plaza', FALSE, 'Billboard 65 · Neon Row (plaza entrance)', 65),
  ('mx-53', 'max-world', 'plaza', FALSE, 'Billboard 66 · The Arena (plaza entrance)', 66),
  ('mx-54', 'max-world', 'road', TRUE , 'Billboard 67 · Glass District (roadside, premium, two-sided)', 67),
  ('mx-55', 'max-world', 'road', TRUE , 'Billboard 68 · Glass District (roadside, premium, two-sided)', 68),
  ('mx-56', 'max-world', 'road', FALSE, 'Billboard 69 · Glass District (roadside, two-sided)', 69),
  ('mx-57', 'max-world', 'road', FALSE, 'Billboard 70 · near Frostline (roadside, two-sided)', 70),
  ('mx-58', 'max-world', 'road', FALSE, 'Billboard 71 · near Frostline (roadside, two-sided)', 71),
  ('mx-59', 'max-world', 'plaza', TRUE , 'Billboard 72 · Neon Row (plaza entrance, premium, portrait LED tower, two faces, lit at night)', 72),
  ('mx-60', 'max-world', 'plaza', FALSE, 'Billboard 73 · Neon Row (plaza entrance, portrait LED tower, two faces, lit at night)', 73),
  ('mx-61', 'max-world', 'plaza', TRUE , 'Billboard 74 · The Arena (plaza entrance, premium, portrait LED tower, two faces, lit at night)', 74),
  ('mx-62', 'max-world', 'landmark', TRUE , 'Billboard 75 · Glass District (landmark, premium, portrait LED tower, two faces, lit at night)', 75),
  ('mx-63', 'max-world', 'landmark', FALSE, 'Billboard 76 · Harbour Yard (landmark, portrait LED tower, two faces, lit at night)', 76),
  ('mx-64', 'max-world', 'landmark', FALSE, 'Billboard 77 · Frostline (landmark, portrait LED tower, two faces, lit at night)', 77),
  ('mx-65', 'max-world', 'landmark', FALSE, 'Billboard 78 · Old Airfield (landmark, portrait LED tower, two faces, lit at night)', 78),
  ('mx-66', 'max-world', 'landmark', FALSE, 'Billboard 79 · Black Refinery (landmark, portrait LED tower, two faces, lit at night)', 79)
ON CONFLICT (id) DO UPDATE
  SET kind = EXCLUDED.kind, premium = EXCLUDED.premium, label = EXCLUDED.label, number = EXCLUDED.number;
-- END generated

CREATE UNIQUE INDEX IF NOT EXISTS game_billboard_slots_number_idx ON public.game_billboard_slots (number) WHERE number IS NOT NULL;


-- ═════════════════════════════════════════════════════════════════════════════
-- PRICES: one board, 1 or 2 weeks
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.game_billboard_week_prices (
  premium     BOOLEAN NOT NULL,
  weeks       INT     NOT NULL CHECK (weeks IN (1, 2)),
  naira       NUMERIC(12,2) NOT NULL CHECK (naira > 0),
  placeholder BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (premium, weeks)
);
INSERT INTO public.game_billboard_week_prices (premium, weeks, naira, placeholder) VALUES
  (FALSE, 1, 25000, TRUE),
  (FALSE, 2, 45000, TRUE),
  (TRUE,  1, 50000, TRUE),
  (TRUE,  2, 90000, TRUE)
ON CONFLICT (premium, weeks) DO NOTHING;

ALTER TABLE public.game_billboard_week_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_billboard_week_prices_read ON public.game_billboard_week_prices;
CREATE POLICY game_billboard_week_prices_read ON public.game_billboard_week_prices
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS game_billboard_week_prices_admin ON public.game_billboard_week_prices;
CREATE POLICY game_billboard_week_prices_admin ON public.game_billboard_week_prices
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


-- ═════════════════════════════════════════════════════════════════════════════
-- BOOKINGS
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.game_billboard_bookings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id     TEXT NOT NULL REFERENCES public.game_billboard_slots(id) ON DELETE CASCADE,
  partner_id  UUID NOT NULL REFERENCES public.ad_partners(id) ON DELETE CASCADE,
  creative_id UUID NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  payment_id  UUID UNIQUE REFERENCES public.ad_payments(id) ON DELETE SET NULL,
  weeks       INT  NOT NULL CHECK (weeks IN (1, 2)),
  price_naira NUMERIC(12,2) NOT NULL CHECK (price_naira > 0),
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_billboard_bookings_slot_idx ON public.game_billboard_bookings (slot_id, starts_at);
CREATE INDEX IF NOT EXISTS game_billboard_bookings_creative_idx ON public.game_billboard_bookings (creative_id, status);

ALTER TABLE public.game_billboard_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_billboard_bookings_read ON public.game_billboard_bookings;
CREATE POLICY game_billboard_bookings_read ON public.game_billboard_bookings
  FOR SELECT TO authenticated
  USING (public.is_admin() OR partner_id IN (SELECT id FROM public.ad_partners WHERE owner_id = auth.uid()));

/** Does a booking hold this board over these days (paid, or pending and under an hour old)? */
CREATE OR REPLACE FUNCTION public.billboard_taken(p_slot TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.game_billboard_bookings b
     WHERE b.slot_id = p_slot
       AND (b.status = 'paid' OR (b.status = 'pending' AND b.created_at > now() - interval '1 hour'))
       AND b.starts_at < p_to AND b.ends_at > p_from);
$$;


/**
 * The numbered list for the portal: every board, its number and place, whether it's premium, its prices and
 * the first moment it's free (now, or when the last booking on it ends).
 */
CREATE OR REPLACE FUNCTION public.billboard_boards()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'number', s.number,
           'label', s.label,
           'kind', s.kind,
           'premium', s.premium,
           'week1', (SELECT naira FROM public.game_billboard_week_prices WHERE premium = s.premium AND weeks = 1),
           'week2', (SELECT naira FROM public.game_billboard_week_prices WHERE premium = s.premium AND weeks = 2),
           'placeholder', (SELECT bool_or(placeholder) FROM public.game_billboard_week_prices),
           'free_from', GREATEST(now(), COALESCE((
               SELECT MAX(b.ends_at) FROM public.game_billboard_bookings b
                WHERE b.slot_id = s.id
                  AND (b.status = 'paid' OR (b.status = 'pending' AND b.created_at > now() - interval '1 hour'))), now()))
         ) ORDER BY s.number NULLS LAST, s.id), '[]'::JSONB)
    FROM public.game_billboard_slots s;
$$;

REVOKE ALL ON FUNCTION public.billboard_boards() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billboard_boards() TO authenticated;


/**
 * Book one board for 1 or 2 weeks with one of your ads, from `p_start` (or as soon as it's free). Opens the
 * payment (pending) and the booking that waits on it; the app's server takes the advertiser to the provider.
 * The ad must be yours and a billboard; it shows only once a reviewer approves it.
 */
CREATE OR REPLACE FUNCTION public.book_billboard(p_slot TEXT, p_weeks INT, p_creative UUID, p_provider TEXT, p_start TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_p     public.ad_partners;
  v_s     public.game_billboard_slots;
  v_price NUMERIC;
  v_from  TIMESTAMPTZ;
  v_to    TIMESTAMPTZ;
  v_pay   UUID;
  v_book  UUID;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  SELECT * INTO v_p FROM public.ad_partners WHERE owner_id = v_me;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'make your advertiser account first'; END IF;
  IF p_provider NOT IN ('paystack', 'flutterwave', 'stripe') THEN RAISE EXCEPTION 'unknown provider'; END IF;
  IF p_weeks NOT IN (1, 2) THEN RAISE EXCEPTION 'a booking is 1 or 2 weeks'; END IF;
  SELECT * INTO v_s FROM public.game_billboard_slots WHERE id = p_slot;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'no such billboard'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ad_creatives c WHERE c.id = p_creative AND c.partner_id = v_p.id AND c.placement = 'game_billboard') THEN
    RAISE EXCEPTION 'not your billboard ad';
  END IF;
  SELECT naira INTO v_price FROM public.game_billboard_week_prices WHERE premium = v_s.premium AND weeks = p_weeks;
  IF v_price IS NULL THEN RAISE EXCEPTION 'no price set for this board'; END IF;

  -- Serialise bookings on this board, then check the days are free.
  PERFORM 1 FROM public.game_billboard_slots WHERE id = p_slot FOR UPDATE;
  v_from := GREATEST(now(), COALESCE(p_start, now()));
  v_to := v_from + make_interval(days => 7 * p_weeks);
  IF public.billboard_taken(p_slot, v_from, v_to) THEN
    RAISE EXCEPTION 'Billboard % is booked for some of those days', v_s.number;
  END IF;

  INSERT INTO public.ad_payments (partner_id, creative_id, provider, amount_naira, created_by)
  VALUES (v_p.id, p_creative, p_provider, v_price, v_me)
  RETURNING id INTO v_pay;
  INSERT INTO public.game_billboard_bookings (slot_id, partner_id, creative_id, payment_id, weeks, price_naira, starts_at, ends_at, created_by)
  VALUES (p_slot, v_p.id, p_creative, v_pay, p_weeks, v_price, v_from, v_to, v_me)
  RETURNING id INTO v_book;
  RETURN jsonb_build_object('reference', v_pay, 'amount', v_price, 'booking', v_book, 'starts_at', v_from, 'ends_at', v_to, 'number', v_s.number);
END;
$$;

REVOKE ALL ON FUNCTION public.book_billboard(TEXT, INT, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_billboard(TEXT, INT, UUID, TEXT, TIMESTAMPTZ) TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- SETTLING: a paid booking puts its ad on its board for its window
-- ═════════════════════════════════════════════════════════════════════════════

-- Redefined from migration_game_billboards.sql: the same checks; a payment that a booking waits on settles the
-- booking (its ad goes on that board, premium, for the booked days) instead of adding to the view budget.
CREATE OR REPLACE FUNCTION public.settle_ad_payment(
  p_key TEXT, p_reference UUID, p_provider TEXT, p_amount_kobo BIGINT, p_currency TEXT, p_provider_ref TEXT, p_ok BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pay  public.ad_payments;
  v_book public.game_billboard_bookings;
BEGIN
  IF NOT public.ads_key_ok('billing', p_key) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_pay FROM public.ad_payments WHERE id = p_reference FOR UPDATE;
  IF v_pay.id IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'unknown'); END IF;
  IF v_pay.status <> 'pending' THEN RETURN jsonb_build_object('ok', v_pay.status = 'paid', 'reason', 'already_' || v_pay.status); END IF;
  IF v_pay.provider <> p_provider THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'provider'); END IF;
  SELECT * INTO v_book FROM public.game_billboard_bookings WHERE payment_id = v_pay.id FOR UPDATE;
  IF NOT p_ok THEN
    UPDATE public.ad_payments SET status = 'failed', settled_at = now(), provider_ref = left(p_provider_ref, 120) WHERE id = v_pay.id;
    IF v_book.id IS NOT NULL THEN UPDATE public.game_billboard_bookings SET status = 'failed' WHERE id = v_book.id; END IF;
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'failed');
  END IF;
  IF upper(COALESCE(p_currency, '')) <> 'NGN' OR p_amount_kobo <> ROUND(v_pay.amount_naira * 100) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'amount');
  END IF;
  UPDATE public.ad_payments SET status = 'paid', settled_at = now(), provider_ref = left(p_provider_ref, 120) WHERE id = v_pay.id;
  IF v_book.id IS NULL THEN
    UPDATE public.ad_partners SET budget_naira = budget_naira + v_pay.amount_naira WHERE id = v_pay.partner_id;
    RETURN jsonb_build_object('ok', TRUE, 'reason', 'paid', 'amount', v_pay.amount_naira);
  END IF;
  -- A booking: paid late (after its hour's hold) it starts now if its days are still free, else from when they are.
  IF v_book.starts_at < now() THEN
    UPDATE public.game_billboard_bookings
       SET starts_at = now(), ends_at = now() + make_interval(days => 7 * weeks)
     WHERE id = v_book.id;
  END IF;
  UPDATE public.game_billboard_bookings SET status = 'paid' WHERE id = v_book.id
  RETURNING * INTO v_book;
  UPDATE public.ad_creatives
     SET slot_ids = ARRAY(SELECT DISTINCT unnest(slot_ids || ARRAY[v_book.slot_id])),
         static_premium = TRUE
   WHERE id = v_book.creative_id;
  RETURN jsonb_build_object('ok', TRUE, 'reason', 'booked', 'amount', v_pay.amount_naira, 'slot', v_book.slot_id, 'starts_at', v_book.starts_at, 'ends_at', v_book.ends_at);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_ad_payment(TEXT, UUID, TEXT, BIGINT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_ad_payment(TEXT, UUID, TEXT, BIGINT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- SERVING: a booked ad on its board, for its days
-- ═════════════════════════════════════════════════════════════════════════════

-- Redefined from migration_game_billboards.sql. Booked ads first (only their booked boards, only during their
-- days, whatever the view budget); then the rotation as before. A booked ad's other boards still need a budget.
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

  SELECT COALESCE(jsonb_agg(s.ad ORDER BY s.booked DESC, s.premium DESC, s.w DESC), '[]'::JSONB) INTO v_out
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
               'slots',   to_jsonb(CASE WHEN bk.slots IS NOT NULL AND NOT public.partner_has_budget(c.partner_id) THEN bk.slots ELSE c.slot_ids END),
               'premium', c.static_premium OR bk.slots IS NOT NULL
             ) AS ad,
             bk.slots IS NOT NULL AS booked,
             c.static_premium AS premium,
             c.weight * random() AS w
        FROM public.ad_creatives c
        LEFT JOIN LATERAL (
          SELECT array_agg(b.slot_id) AS slots
            FROM public.game_billboard_bookings b
           WHERE b.creative_id = c.id AND b.status = 'paid' AND b.starts_at <= now() AND b.ends_at > now()
        ) bk ON TRUE
       WHERE c.placement = 'game_billboard'
         AND c.active
         AND c.review_status = 'approved'
         AND (bk.slots IS NOT NULL OR (
               c.starts_at <= now()
           AND (c.ends_at IS NULL OR c.ends_at > now())
           AND public.partner_has_budget(c.partner_id)
           AND (c.daily_cap IS NULL OR COALESCE((
                 SELECT SUM(d.views) FROM public.ad_billboard_daily d
                  WHERE d.ad_id = c.id AND d.day = v_today), 0) < c.daily_cap)))
         AND (cardinality(c.maps) = 0 OR p_map = ANY (c.maps) OR bk.slots IS NOT NULL)
       ORDER BY booked DESC, premium DESC, w DESC
       LIMIT 12
    ) s;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.next_billboards(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_billboards(TEXT, TEXT) TO anon, authenticated;
