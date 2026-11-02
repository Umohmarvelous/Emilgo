-- test_game_billboards.sql — migration_game_billboards.sql end to end.
-- Run in the SQL editor (or the Supabase MCP) after the migration. Everything
-- happens inside one transaction and is rolled back: nothing is left behind.
BEGIN;
CREATE TEMP TABLE t (step text, ok boolean, detail text) ON COMMIT DROP;
GRANT ALL ON t TO authenticated, anon;

DO $$
DECLARE
  A UUID;           -- an advertiser (an ordinary account)
  ADM UUID;         -- an admin
  v_acct JSONB;
  v_ad UUID;
  v_ad2 UUID;
  v_pay JSONB;
  v_res JSONB;
  v_n INT;
  v_feed JSONB;
  v_base TEXT := 'https://test-project.supabase.co';
  v_key TEXT := 'test-game-ads-key-0123456789abcdef';
  v_bill TEXT := 'test-billing-key-0123456789abcdef';
  v_premium TEXT;
BEGIN
  SELECT u.id INTO A FROM public.users u JOIN auth.users a ON a.id = u.id WHERE NOT u.is_admin LIMIT 1;
  SELECT u.id INTO ADM FROM public.users u JOIN auth.users a ON a.id = u.id WHERE u.id <> A LIMIT 1;
  UPDATE public.users SET is_admin = TRUE WHERE id = ADM;
  UPDATE public.game_ads_config SET
    game_key_hash = encode(extensions.digest(v_key, 'sha256'), 'hex'),
    billing_key_hash = encode(extensions.digest(v_bill, 'sha256'), 'hex'),
    storage_base = v_base;
  SELECT id INTO v_premium FROM public.game_billboard_slots WHERE premium LIMIT 1;

  INSERT INTO t VALUES ('every board of both cities is listed',
    (SELECT count(*) FROM public.game_billboard_slots) >= 20, (SELECT count(*) FROM public.game_billboard_slots)::text);

  -- ── The game server's door ──
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.next_billboards('wrong-key-wrong-key-wrong-key', 'naija-world');
    INSERT INTO t VALUES ('a wrong game key is refused', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t VALUES ('a wrong game key is refused', true, SQLERRM);
  END;
  BEGIN
    PERFORM count(*) FROM public.game_ads_config;
    INSERT INTO t VALUES ('the keys table is closed to clients', false, 'read it');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t VALUES ('the keys table is closed to clients', true, SQLERRM);
  END;
  v_feed := public.next_billboards(v_key, 'naija-world');
  INSERT INTO t VALUES ('the right key gets a feed (an array)', jsonb_typeof(v_feed) = 'array', v_feed::text);
  RESET ROLE;

  -- ── The advertiser ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_acct := public.my_ad_account('TEST Advertiser', 'ads@example.com');
  INSERT INTO t VALUES ('an advertiser account is made', v_acct->'account'->>'id' IS NOT NULL, v_acct::text);
  INSERT INTO t VALUES ('a new account has no budget', (v_acct->'account'->>'budget')::numeric = 0, NULL);

  BEGIN
    PERFORM public.submit_billboard_ad(p_headline := 'x', p_website := 'https://example.com', p_format := 'static',
      p_media_url := 'https://elsewhere.example/storage/v1/object/public/ad-media/' || A || '/a.png',
      p_attest := public.billboard_rules());
    INSERT INTO t VALUES ('media on another host is refused', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t VALUES ('media on another host is refused', true, SQLERRM);
  END;
  BEGIN
    PERFORM public.submit_billboard_ad(p_headline := 'x', p_website := 'https://example.com', p_format := 'static',
      p_media_url := v_base || '/storage/v1/object/public/ad-media/' || gen_random_uuid() || '/a.png',
      p_attest := public.billboard_rules());
    INSERT INTO t VALUES ('media in someone else''s folder is refused', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t VALUES ('media in someone else''s folder is refused', true, SQLERRM);
  END;
  BEGIN
    PERFORM public.submit_billboard_ad(p_headline := 'x', p_website := 'https://example.com', p_format := 'static',
      p_media_url := v_base || '/storage/v1/object/public/ad-media/' || A || '/a.png');
    INSERT INTO t VALUES ('the content rules must be confirmed', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t VALUES ('the content rules must be confirmed', true, SQLERRM);
  END;

  v_ad := public.submit_billboard_ad(
    p_headline := 'TEST Lagos bakery, best bet in town', p_website := 'https://example.com', p_format := 'static',
    p_media_url := v_base || '/storage/v1/object/public/ad-media/' || A || '/a.png',
    p_maps := ARRAY['naija-world'], p_slots := ARRAY[v_premium], p_premium := TRUE, p_cycle := 0,
    p_attest := public.billboard_rules());
  INSERT INTO t VALUES ('a billboard is submitted', v_ad IS NOT NULL, v_ad::text);
  SELECT count(*) INTO v_n FROM public.my_billboard_ads() WHERE id = v_ad AND review_status = 'pending' AND NOT active;
  INSERT INTO t VALUES ('it waits for review, off the air', v_n = 1, NULL);

  BEGIN
    PERFORM public.review_billboard_ad(v_ad, TRUE, NULL, public.billboard_rules());
    INSERT INTO t VALUES ('an advertiser cannot approve their own', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t VALUES ('an advertiser cannot approve their own', true, SQLERRM);
  END;

  v_pay := public.open_ad_payment('paystack', 10000, v_ad);
  INSERT INTO t VALUES ('a checkout opens a pending payment', v_pay->>'reference' IS NOT NULL, v_pay::text);
  BEGIN
    PERFORM public.settle_ad_payment('not-the-billing-key-000000', (v_pay->>'reference')::uuid, 'paystack', 1000000, 'NGN', 'x');
    INSERT INTO t VALUES ('an advertiser cannot settle their own payment', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t VALUES ('an advertiser cannot settle their own payment', true, SQLERRM);
  END;
  RESET ROLE;

  -- ── The billing server settles ──
  SET LOCAL ROLE anon;
  v_res := public.settle_ad_payment(v_bill, (v_pay->>'reference')::uuid, 'paystack', 999900, 'NGN', 'ps_1');
  INSERT INTO t VALUES ('a short payment does not settle', v_res->>'reason' = 'amount', v_res::text);
  v_res := public.settle_ad_payment(v_bill, (v_pay->>'reference')::uuid, 'paystack', 1000000, 'USD', 'ps_1');
  INSERT INTO t VALUES ('a payment in another currency does not settle', v_res->>'reason' = 'amount', v_res::text);
  v_res := public.settle_ad_payment(v_bill, (v_pay->>'reference')::uuid, 'paystack', 1000000, 'NGN', 'ps_1');
  INSERT INTO t VALUES ('the right payment settles', (v_res->>'ok')::boolean, v_res::text);
  v_res := public.settle_ad_payment(v_bill, (v_pay->>'reference')::uuid, 'paystack', 1000000, 'NGN', 'ps_1');
  INSERT INTO t VALUES ('a payment settles once', v_res->>'reason' = 'already_paid', v_res::text);
  RESET ROLE;
  INSERT INTO t VALUES ('the budget grew by it',
    (SELECT budget_naira FROM public.ad_partners WHERE owner_id = A) = 10000, NULL);

  -- ── The review ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ADM, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.list_billboard_reviews('pending') WHERE id = v_ad AND 'betting' = ANY (content_flags);
  INSERT INTO t VALUES ('the queue shows it, flagged for a second look ("bet")', v_n = 1, NULL);
  BEGIN
    PERFORM public.review_billboard_ad(v_ad, TRUE, NULL, ARRAY['no_gambling']);
    INSERT INTO t VALUES ('approval needs every rule ticked', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t VALUES ('approval needs every rule ticked', true, SQLERRM);
  END;
  BEGIN
    PERFORM public.set_ad_creative_active(v_ad, TRUE);
    INSERT INTO t VALUES ('the console switch cannot air an unreviewed billboard', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t VALUES ('the console switch cannot air an unreviewed billboard', true, SQLERRM);
  END;
  PERFORM public.review_billboard_ad(v_ad, TRUE, 'ok', public.billboard_rules());
  RESET ROLE;
  INSERT INTO t VALUES ('approved: on the air',
    (SELECT active AND review_status = 'approved' FROM public.ad_creatives WHERE id = v_ad), NULL);

  -- A second premium booking on the same board at the same time.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_ad2 := public.submit_billboard_ad(
    p_headline := 'TEST second', p_website := 'https://example.com', p_format := 'static',
    p_media_url := v_base || '/storage/v1/object/public/ad-media/' || A || '/b.png',
    p_slots := ARRAY[v_premium], p_premium := TRUE, p_attest := public.billboard_rules());
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ADM, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.review_billboard_ad(v_ad2, TRUE, NULL, public.billboard_rules());
    INSERT INTO t VALUES ('two premium bookings cannot hold one board at once', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t VALUES ('two premium bookings cannot hold one board at once', true, SQLERRM);
  END;
  RESET ROLE;

  -- ── Serving and counting ──
  SET LOCAL ROLE anon;
  v_feed := public.next_billboards(v_key, 'naija-world');
  INSERT INTO t VALUES ('the approved billboard is in the feed',
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_feed) x WHERE x->>'id' = v_ad::text AND (x->>'premium')::boolean), v_feed::text);
  v_feed := public.next_billboards(v_key, 'spooky-world');
  INSERT INTO t VALUES ('booked for Naija World: not in Spooky World',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_feed) x WHERE x->>'id' = v_ad::text), NULL);
  v_n := public.record_billboard_seen(v_key, jsonb_build_array(
    jsonb_build_object('day', CURRENT_DATE::text, 'map', 'naija-world', 'slot', v_premium, 'ad', v_ad, 'secs', 42.5, 'views', 3),
    jsonb_build_object('day', CURRENT_DATE::text, 'map', 'naija-world', 'slot', 'zz-99', 'ad', v_ad, 'secs', 5, 'views', 1),
    jsonb_build_object('day', '2001-01-01', 'map', 'naija-world', 'slot', v_premium, 'ad', v_ad, 'secs', 5, 'views', 1),
    jsonb_build_object('day', CURRENT_DATE::text, 'map', 'naija-world', 'slot', v_premium, 'ad', 'not-a-uuid', 'secs', 5, 'views', 1)));
  INSERT INTO t VALUES ('seen: only real boards, live creatives and today count', v_n = 1, v_n::text);
  v_n := public.record_billboard_seen(v_key, jsonb_build_array(
    jsonb_build_object('day', CURRENT_DATE::text, 'map', 'naija-world', 'slot', v_premium, 'ad', v_ad, 'secs', 7.5, 'views', 1)));
  RESET ROLE;
  INSERT INTO t VALUES ('seen adds up (4 views, 50 s)',
    (SELECT views = 4 AND seconds = 50 FROM public.ad_billboard_daily WHERE ad_id = v_ad AND day = CURRENT_DATE), NULL);
  INSERT INTO t VALUES ('nothing about who is kept',
    NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ad_billboard_daily' AND column_name ~ 'user|device|player|ip'), NULL);

  -- ── The feed keeps to the app ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.serve_feed_ads(10) f WHERE f.id = v_ad;
  INSERT INTO t VALUES ('a billboard is never a promoted post', v_n = 0, NULL);
  SELECT count(*) INTO v_n FROM public.ad_billboard_daily;
  INSERT INTO t VALUES ('an advertiser cannot read the daily table directly', v_n = 0, v_n::text);
  SELECT views INTO v_n FROM public.my_billboard_ads() WHERE id = v_ad;
  INSERT INTO t VALUES ('an advertiser reads their own totals', v_n = 4, v_n::text);
  RESET ROLE;
END $$;

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, step, detail FROM t ORDER BY ok, ctid;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM t;
ROLLBACK;
