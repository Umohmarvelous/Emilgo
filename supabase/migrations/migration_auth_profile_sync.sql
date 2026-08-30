-- migration_auth_profile_sync.sql
--
-- One trigger that mirrors auth metadata into `public.users`, and does not
-- destroy anything on the way.
--
-- ── Two bugs, both invisible until they bite ───────────────────────────────
--
-- 1. **`handle_auth_user_upsert` overwrote every column with whatever was in the
--    metadata — including NULL.** `raw_user_meta_data` only carries the keys the
--    last `updateUser` call passed, so ANY metadata update wiped
--    `vehicle_details`, `park_name`, `park_location` and `avg_rating`. A driver
--    who finished their profile and then changed one setting lost their vehicle.
--    Every column is COALESCEd over its current value now: metadata can set a
--    field, never clear one.
--
-- 2. **It did not carry `username`.** That was survivable while registration
--    called `signUp(email, password, metadata)` in one shot, because
--    `handle_new_user` caught the INSERT and the metadata was complete.
--
--    Registration now verifies the email FIRST — the auth row is created by a
--    passwordless OTP with NO metadata, and the profile arrives later on an
--    `updateUser`. Under the old trigger that left `username` NULL forever, and
--    username is how chat, search and @-mentions find a person. So the update
--    path has to carry the same fields the insert path did.
--
-- Two triggers doing overlapping inserts is also how the two got out of step, so
-- this collapses them into one.

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_upsert  on auth.users;

create or replace function public.handle_auth_user_upsert()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.users (
    id, email, username, first_name, last_name, full_name, phone, age, role,
    driver_id, profile_photo, vehicle_details, park_location, park_name,
    device_fingerprint, points_balance, credits_balance, avg_rating,
    country_code, currency_code, profile_complete, created_at, updated_at
  )
  values (
    new.id,
    new.email,
    nullif(m->>'username', ''),
    m->>'first_name',
    m->>'last_name',
    m->>'full_name',
    coalesce(m->>'phone', ''),
    coalesce((m->>'age')::int, 18),
    coalesce(m->>'role', 'passenger'),
    nullif(trim(coalesce(m->>'driver_id', '')), ''),
    m->>'profile_photo',
    m->>'vehicle_details',
    m->>'park_location',
    m->>'park_name',
    m->>'device_fingerprint',
    coalesce((m->>'points_balance')::int, 0),
    coalesce((m->>'credits_balance')::int, 0),
    (m->>'avg_rating')::float,
    coalesce(m->>'country_code', 'NG'),
    coalesce(m->>'currency_code', 'NGN'),
    coalesce((m->>'profile_complete')::boolean, false),
    now(), now()
  )
  on conflict (id) do update set
    -- Read from `m` (the raw metadata), NOT from `excluded`.
    --
    -- `excluded` is the VALUES row, and those values carry INSERT-TIME
    -- DEFAULTS: `coalesce(m->>'role', 'passenger')` is 'passenger' whenever the
    -- metadata simply does not mention a role. Coalescing against that would
    -- resolve to 'passenger' rather than to the row's current value — which
    -- silently DEMOTED a driver to a passenger on any unrelated metadata
    -- update, and role is what every screen in the app routes on.
    --
    -- Reading `m` directly means "absent" is NULL, and NULL falls through to the
    -- existing value. Metadata can set a field; it can never clear one.
    email            = coalesce(nullif(new.email, ''),                public.users.email),
    username         = coalesce(nullif(m->>'username', ''),           public.users.username),
    first_name       = coalesce(nullif(m->>'first_name', ''),         public.users.first_name),
    last_name        = coalesce(nullif(m->>'last_name', ''),          public.users.last_name),
    full_name        = coalesce(nullif(m->>'full_name', ''),          public.users.full_name),
    phone            = coalesce(nullif(m->>'phone', ''),              public.users.phone),
    age              = coalesce((m->>'age')::int,                     public.users.age),
    role             = coalesce(nullif(m->>'role', ''),               public.users.role),
    driver_id        = coalesce(nullif(trim(coalesce(m->>'driver_id','')), ''), public.users.driver_id),
    profile_photo    = coalesce(nullif(m->>'profile_photo', ''),      public.users.profile_photo),
    vehicle_details  = coalesce(nullif(m->>'vehicle_details', ''),    public.users.vehicle_details),
    park_location    = coalesce(nullif(m->>'park_location', ''),      public.users.park_location),
    park_name        = coalesce(nullif(m->>'park_name', ''),          public.users.park_name),
    device_fingerprint = coalesce(nullif(m->>'device_fingerprint',''), public.users.device_fingerprint),
    avg_rating       = coalesce((m->>'avg_rating')::float,            public.users.avg_rating),
    country_code     = coalesce(nullif(m->>'country_code', ''),       public.users.country_code),
    currency_code    = coalesce(nullif(m->>'currency_code', ''),      public.users.currency_code),
    -- Balances are NEVER taken from metadata on an update. Metadata is written
    -- by the client, so trusting it here would let anyone set their own balance
    -- with one `updateUser` call.
    profile_complete = coalesce((m->>'profile_complete')::boolean,    public.users.profile_complete),
    updated_at       = now();

  return new;
exception when others then
  -- A failure here must not block sign-up: the user would be stuck with an auth
  -- row and no way forward. Warn and let the client's own upsert repair it.
  raise warning 'handle_auth_user_upsert failed for %: %', new.id, sqlerrm;
  return new;
end $$;

create trigger on_auth_user_upsert
  after insert or update on auth.users
  for each row execute function public.handle_auth_user_upsert();

-- `handle_new_user` is now unreachable. Kept, not dropped: dropping a function
-- another migration might still reference is not reversible, and it costs
-- nothing to leave. Its trigger is gone, which is what mattered.
comment on function public.handle_new_user() is
  'Superseded by handle_auth_user_upsert (migration_auth_profile_sync.sql). No trigger calls this.';
