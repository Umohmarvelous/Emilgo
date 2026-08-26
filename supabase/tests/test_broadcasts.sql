-- supabase/tests/test_broadcasts.sql
--
-- Proves a park broadcast reaches its drivers, only its drivers, only while it
-- is still true, and that the owner can tell whether anyone read it.
--
-- Usage: node ./.dbq.mjs -f supabase/tests/test_broadcasts.sql

BEGIN;

CREATE TEMP TABLE t (n int generated always as identity, step text, ok boolean, detail text) ON COMMIT DROP;
GRANT ALL ON t TO authenticated, anon;

DO $$
DECLARE
  OWNER_ID UUID; DRV UUID; OUTSIDER UUID;
  v JSONB; v_id UUID; v_n INT;
BEGIN
  SELECT id INTO OWNER_ID   FROM public.users ORDER BY created_at LIMIT 1;
  SELECT id INTO DRV        FROM public.users WHERE id <> OWNER_ID ORDER BY created_at LIMIT 1;
  SELECT id INTO OUTSIDER   FROM public.users WHERE id NOT IN (OWNER_ID, DRV) ORDER BY created_at LIMIT 1;
  IF OWNER_ID IS NULL OR DRV IS NULL OR OUTSIDER IS NULL THEN
    INSERT INTO t (step, ok, detail) VALUES ('need three users', false, 'sign up three times first');
    RETURN;
  END IF;

  UPDATE public.users SET role = 'park_owner', park_name = 'Test Park' WHERE id = OWNER_ID;
  UPDATE public.users SET role = 'driver',     park_name = 'Test Park' WHERE id = DRV;
  UPDATE public.users SET role = 'driver',     park_name = 'Other Park' WHERE id = OUTSIDER;
  DELETE FROM public.broadcasts WHERE park_id = OWNER_ID;

  -- ── Only a park owner may send ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', DRV, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.broadcast_send('Drivers cannot broadcast');
  INSERT INTO t (step, ok, detail) VALUES (
    'a driver cannot broadcast', (v ->> 'reason') = 'not_a_park_owner', v::text);

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', OWNER_ID, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v := public.broadcast_send('');
  INSERT INTO t (step, ok, detail) VALUES (
    'an empty broadcast is refused', (v ->> 'reason') = 'empty', v::text);

  v := public.broadcast_send('Road blocked at Ojuelegba', 'Route notice', 'urgent');
  v_id := (v ->> 'id')::uuid;
  INSERT INTO t (step, ok, detail) VALUES ('the owner can broadcast', (v ->> 'ok') = 'true', v::text);
  INSERT INTO t (step, ok, detail) VALUES (
    'it reports how many drivers it should reach', (v ->> 'reach') = '1', v ->> 'reach');
  INSERT INTO t (step, ok, detail) VALUES (
    'the sender name is stored so no user lookup is needed',
    (SELECT sender_name IS NOT NULL FROM public.broadcasts WHERE id = v_id), NULL);

  -- An expired notice, and one that expires in the future.
  PERFORM public.broadcast_send('Yesterday''s fuel queue', NULL, 'normal', now() - interval '1 hour');
  PERFORM public.broadcast_send('Tomorrow''s meeting',     NULL, 'normal', now() + interval '1 day');

  -- `now()` is the TRANSACTION's start time, so all three rows above share a
  -- created_at and any ordering assertion on them is a coin toss. Space them.
  RESET ROLE;
  UPDATE public.broadcasts SET created_at = now() - interval '10 minutes' WHERE id = v_id;
  UPDATE public.broadcasts SET created_at = now() - interval '1 minute'
   WHERE park_id = OWNER_ID AND id <> v_id;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', OWNER_ID, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ── The driver's view ───────────────────────────────────────────────────
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', DRV, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_n FROM public.broadcast_list_for_driver();
  INSERT INTO t (step, ok, detail) VALUES (
    'the driver sees the live notices and not the expired one', v_n = 2, v_n::text);
  INSERT INTO t (step, ok, detail) VALUES (
    'an unread urgent notice sorts first',
    (SELECT id FROM public.broadcast_list_for_driver() LIMIT 1) = v_id, NULL);
  INSERT INTO t (step, ok, detail) VALUES (
    'it starts unread',
    (SELECT read FROM public.broadcast_list_for_driver() WHERE id = v_id) = false, NULL);

  PERFORM public.broadcast_mark_read(v_id);
  INSERT INTO t (step, ok, detail) VALUES (
    'marking read sticks',
    (SELECT read FROM public.broadcast_list_for_driver() WHERE id = v_id) = true, NULL);
  PERFORM public.broadcast_mark_read(v_id);
  INSERT INTO t (step, ok, detail) VALUES (
    'marking read twice is not two receipts',
    (SELECT count(*) FROM public.broadcast_reads WHERE broadcast_id = v_id) = 1, NULL);
  INSERT INTO t (step, ok, detail) VALUES (
    'a read urgent notice stops being pinned to the top',
    (SELECT id FROM public.broadcast_list_for_driver() LIMIT 1) <> v_id, NULL);

  -- ── A driver from another park ──────────────────────────────────────────
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', OUTSIDER, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.broadcast_list_for_driver();
  INSERT INTO t (step, ok, detail) VALUES (
    'another park''s driver sees nothing', v_n = 0, v_n::text);

  PERFORM public.broadcast_mark_read(v_id);

  -- ── Back to the owner ───────────────────────────────────────────────────
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', OWNER_ID, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO t (step, ok, detail) VALUES (
    'the owner sees everything they sent, expired included',
    (SELECT count(*) FROM public.broadcast_list_sent()) = 3, NULL);
  INSERT INTO t (step, ok, detail) VALUES (
    'and how many drivers read it',
    (SELECT read_count FROM public.broadcast_list_sent() WHERE id = v_id) = 1, NULL);
  -- The outsider called mark_read above. Asked from THEIR session the count
  -- would be 0 because RLS hides the row, which proves nothing; asked from the
  -- owner's it proves the receipt was never written.
  INSERT INTO t (step, ok, detail) VALUES (
    'a driver from another park cannot forge a read receipt',
    (SELECT read_count FROM public.broadcast_list_sent() WHERE id = v_id) = 1, NULL);
  INSERT INTO t (step, ok, detail) VALUES (
    'against how many it should have reached',
    (SELECT reach FROM public.broadcast_list_sent() WHERE id = v_id) = 1, NULL);

  INSERT INTO t (step, ok, detail) VALUES (
    'the owner can delete a broadcast', public.broadcast_delete(v_id), NULL);
  INSERT INTO t (step, ok, detail) VALUES (
    'deleting it takes the receipts with it',
    (SELECT count(*) FROM public.broadcast_reads WHERE broadcast_id = v_id) = 0, NULL);

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', DRV, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO t (step, ok, detail) VALUES (
    'a driver cannot delete a broadcast',
    public.broadcast_delete((SELECT id FROM public.broadcast_list_for_driver() LIMIT 1)) = false, NULL);

  RESET ROLE;
END $$;

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, step, detail FROM t ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) AS score FROM t;

ROLLBACK;
