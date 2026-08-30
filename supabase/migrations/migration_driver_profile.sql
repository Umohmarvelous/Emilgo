-- migration_driver_profile.sql
--
-- Claiming a driver badge ID, and saving a driver profile, without the client
-- being able to lie about either.
--
-- ── Why this cannot be done on the client ──────────────────────────────────
-- `driver-profile.tsx` called `generateDriverId()` and displayed the result as
-- "Your Driver ID" before anything was saved. Two problems:
--
--   1. It INVENTED a new random ID even when the account already had one from
--      registration, so the badge on this screen and the badge in the database
--      could disagree — and a badge is what a passenger scans to verify who
--      they are getting into a bus with.
--
--   2. `users.driver_id` is UNIQUE, and `public.users` is not cross-readable
--      (migration_user_privacy.sql), so the client CANNOT check whether an ID
--      is free. A client-side retry loop just hits the unique violation with no
--      way to recover.
--
-- So the ID is claimed here: idempotent, collision-safe, and it never reissues
-- an ID to an account that already has one.

create or replace function public.claim_driver_id(p_base text default null)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me       uuid := auth.uid();
  existing text;
  base     text;
  candidate text;
  n        int := 0;
begin
  if me is null then raise exception 'not signed in'; end if;

  -- Already has one. A badge is permanent: reissuing it would invalidate every
  -- QR sticker already printed and every rating already attached to it.
  select driver_id into existing from public.users where id = me;
  if existing is not null and existing <> '' then
    return existing;
  end if;

  -- Derived from the username by default, because a badge a driver can read
  -- back over the phone beats six random characters.
  if p_base is null or p_base = '' then
    select coalesce(username, split_part(coalesce(full_name, 'driver'), ' ', 1))
      into base from public.users where id = me;
  else
    base := p_base;
  end if;

  base := lower(regexp_replace(coalesce(base, 'driver'), '[^a-zA-Z]', '', 'g'));
  base := nullif(substr(base, 1, 6), '');
  base := coalesce(base, 'driver');

  candidate := base;
  loop
    exit when not exists (select 1 from public.users where driver_id = candidate);
    n := n + 1;
    -- After ten collisions the name space is genuinely crowded; fall back to
    -- something that cannot collide rather than looping forever.
    if n > 10 then
      candidate := base || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      exit;
    end if;
    candidate := base || (10 + floor(random() * 89))::int::text;
  end loop;

  update public.users set driver_id = candidate, updated_at = now() where id = me;
  return candidate;
end $$;

-- Save the driver's own profile.
--
-- This exists so the screen has ONE call that either succeeds completely or
-- changes nothing. The old screen wrote auth metadata and hoped a trigger
-- mirrored it, which meant a failure halfway left the account marked complete
-- with no vehicle on it.
create or replace function public.save_driver_profile(
  p_full_name       text,
  p_vehicle_details text,
  p_profile_photo   text default null,
  p_park_name       text default null,
  p_park_location   text default null,
  p_username        text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  v_username text;
  v_driver_id text;
begin
  if me is null then raise exception 'not signed in'; end if;

  if coalesce(trim(p_full_name), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;
  if coalesce(trim(p_vehicle_details), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'vehicle_required');
  end if;

  select username into v_username from public.users where id = me;

  -- A username is claimed once and never changed: people find each other by it,
  -- and letting it move means a handle that pointed at one person yesterday
  -- points at someone else today. Only an account that has NONE can set one —
  -- which is the case for accounts created before registration asked for it.
  if v_username is null or v_username = '' then
    if coalesce(trim(p_username), '') = '' then
      return jsonb_build_object('ok', false, 'reason', 'username_required');
    end if;
    v_username := lower(trim(p_username));
    if v_username !~ '^[a-z0-9_]{3,20}$' then
      return jsonb_build_object('ok', false, 'reason', 'username_invalid');
    end if;
    if exists (select 1 from public.users where lower(username) = v_username and id <> me) then
      return jsonb_build_object('ok', false, 'reason', 'username_taken');
    end if;
    update public.users set username = v_username where id = me;
  end if;

  v_driver_id := public.claim_driver_id(v_username);

  update public.users set
    full_name       = trim(p_full_name),
    vehicle_details = trim(p_vehicle_details),
    -- A park is optional. Plenty of drivers are independent, and requiring one
    -- meant they invented a park name to get past the screen.
    park_name       = nullif(trim(coalesce(p_park_name, '')), ''),
    park_location   = nullif(trim(coalesce(p_park_location, '')), ''),
    profile_photo   = coalesce(nullif(trim(coalesce(p_profile_photo, '')), ''), profile_photo),
    role            = 'driver',
    profile_complete = true,
    updated_at      = now()
  where id = me;

  return jsonb_build_object(
    'ok', true,
    'driver_id', v_driver_id,
    'username', v_username
  );
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'claim_driver_id(text)',
    'save_driver_profile(text,text,text,text,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
