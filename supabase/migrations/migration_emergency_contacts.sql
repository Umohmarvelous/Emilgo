-- migration_emergency_contacts.sql
--
-- Emergency contacts that exist on more than one phone.
--
-- ── What was there before ──────────────────────────────────────────────────
-- ONE contact — `{ name, phone }` — in a Zustand store persisted to
-- AsyncStorage. That means:
--
--   * it lived on one device and vanished with a reinstall, which is the exact
--     moment someone would want it most;
--   * nothing verified the number, so a typo was indistinguishable from a
--     working contact until an emergency proved otherwise;
--   * `notifyEmergencyContacts()` in src/services/notifications.ts is a
--     `console.log` with a comment saying "simulated — replace with Twilio".
--     The alert has never left the handset.
--
-- ── The consent model, and why it is not an SMS OTP ────────────────────────
-- Verifying a number by texting it a code needs an SMS provider, a business
-- verification and per-message billing (SETUP-KEYS §4.8). None of that exists
-- yet, and a code the ADDING user generates and reads back to themselves proves
-- nothing anyway.
--
-- So verification is CONSENT, not possession. If the number belongs to someone
-- with an EMILGO account, they get a real request in-app and must accept it —
-- two-party, auditable, and working today. If it does not, the contact stays
-- `pending` and the UI says so plainly rather than showing a green tick it has
-- not earned.
--
-- The one deliberate exception: an SOS goes to a pending contact too. Withholding
-- an emergency alert because somebody never tapped Accept would be indefensible.
-- Routine movement updates are held back until they have.

create table if not exists public.emergency_contacts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  -- E.164. Normalised on the way in by `ec_normalise_phone` so that
  -- "0803 123 4567", "+2348031234567" and "234 803 123 4567" are one contact.
  phone        text not null,
  relationship text,
  -- Lower sorts first. This is the order an SOS walks, so it is not decoration.
  priority     integer not null default 0,

  -- ── Consent ─────────────────────────────────────────────────────────────
  status          text not null default 'pending'
                  check (status in ('pending','verified','declined')),
  verified_at     timestamptz,
  -- Set when the number matches an EMILGO account. NULL means we can only reach
  -- them through the user's own phone, which is why `channel` matters.
  contact_user_id uuid references auth.users(id) on delete set null,
  invited_at      timestamptz,

  -- ── Per-contact settings ────────────────────────────────────────────────
  notify_trip_start      boolean not null default true,
  notify_trip_end        boolean not null default true,
  notify_sos             boolean not null default true,
  notify_route_deviation boolean not null default false,
  notify_no_movement     boolean not null default false,
  share_live_location    boolean not null default false,
  -- 'auto' picks in-app when the contact has an account and falls back to the
  -- device's own composer when they do not.
  channel        text not null default 'auto'
                 check (channel in ('auto','in_app','sms','whatsapp')),
  custom_message text,
  -- Quiet hours, in the USER's local time. Both NULL means never quiet. An SOS
  -- ignores them — that is the whole point of an SOS.
  silent_from    time,
  silent_to      time,
  muted_until    timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, phone)
);

create index if not exists emergency_contacts_user_idx
  on public.emergency_contacts (user_id, priority, created_at);
-- Drives "who has added ME?" — the inbox of requests to accept.
create index if not exists emergency_contacts_contact_idx
  on public.emergency_contacts (contact_user_id) where contact_user_id is not null;

-- Every alert that was actually sent. Without this, "notify my contacts" is a
-- promise with no evidence — and after an incident the log is the only thing
-- that can answer whether anyone was told.
create table if not exists public.emergency_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.emergency_contacts(id) on delete set null,
  kind       text not null,
  trip_id    text,
  channel    text,
  -- 'sent' means dispatched, not read. Nothing here should ever imply delivery
  -- that was not observed.
  outcome    text not null default 'sent'
             check (outcome in ('sent','skipped_muted','skipped_unverified','skipped_quiet','failed')),
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists emergency_events_user_idx
  on public.emergency_events (user_id, created_at desc);

alter table public.emergency_contacts enable row level security;
alter table public.emergency_events   enable row level security;

-- The owner sees their own list. The CONTACT sees the rows naming them, because
-- otherwise they could not accept, decline or later withdraw.
drop policy if exists emergency_contacts_owner on public.emergency_contacts;
create policy emergency_contacts_owner on public.emergency_contacts
  for all to authenticated
  using (user_id = auth.uid() or contact_user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists emergency_events_owner on public.emergency_events;
create policy emergency_events_owner on public.emergency_events
  for select to authenticated using (user_id = auth.uid());
-- ═══════════════════════════════════════════════════════════════════════════
-- Phone normalisation
-- ═══════════════════════════════════════════════════════════════════════════
-- Nigerian numbers arrive in four shapes and they are all the same number.
-- Storing them raw meant "0803…" and "+234803…" were two contacts, and neither
-- matched the account that owns them.
create or replace function public.ec_normalise_phone(p_raw text)
returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare d text;
begin
  if p_raw is null then return null; end if;
  d := regexp_replace(p_raw, '[^0-9+]', '', 'g');
  d := regexp_replace(d, '(?!^)\+', '', 'g');       -- a + is only meaningful leading

  if d like '+%' then return d; end if;
  if d like '234%' and length(d) >= 13 then return '+' || d; end if;
  -- 0803… → +234803…
  if d like '0%' and length(d) = 11 then return '+234' || substr(d, 2); end if;
  -- 803… typed without the trunk zero
  if length(d) = 10 then return '+234' || d; end if;
  return d;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Reading
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.ec_list()
returns setof public.emergency_contacts
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.emergency_contacts
   where user_id = auth.uid()
   order by priority asc, created_at asc;
$$;

-- Requests addressed to ME: "X has added you as their emergency contact."
create or replace function public.ec_requests_for_me()
returns table (
  id uuid, owner_id uuid, owner_name text, owner_photo text,
  relationship text, status text, created_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.user_id, u.full_name, u.profile_photo,
         c.relationship, c.status, c.created_at
    from public.emergency_contacts c
    join public.users u on u.id = c.user_id
   where c.contact_user_id = auth.uid()
   order by c.created_at desc;
$$;

create or replace function public.ec_events(p_limit integer default 100)
returns setof public.emergency_events
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.emergency_events
   where user_id = auth.uid()
   order by created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Writing
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Add a contact.
 *
 * The match against `users.phone` happens HERE rather than in the client,
 * because `public.users` is not cross-readable and a "does this number have an
 * account?" endpoint would be a phone-enumeration oracle. The caller already
 * knows the number they typed, and the ten-contact cap is what bounds how many
 * they can test.
 */
create or replace function public.ec_add(
  p_name text, p_phone text, p_relationship text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  v_phone text;
  v_match uuid;
  v_id uuid;
  v_count int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  v_phone := public.ec_normalise_phone(p_phone);
  if v_phone is null or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 10 then
    return jsonb_build_object('ok', false, 'reason', 'phone_invalid');
  end if;

  -- Adding yourself is the one mistake that makes the whole feature useless in
  -- the moment it is needed.
  if exists (select 1 from public.users where id = me
              and public.ec_normalise_phone(phone) = v_phone) then
    return jsonb_build_object('ok', false, 'reason', 'own_number');
  end if;

  select count(*) into v_count from public.emergency_contacts where user_id = me;
  if v_count >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'limit_reached');
  end if;

  if exists (select 1 from public.emergency_contacts
              where user_id = me and phone = v_phone) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  select id into v_match from public.users
   where public.ec_normalise_phone(phone) = v_phone limit 1;

  insert into public.emergency_contacts (
    user_id, name, phone, relationship, priority, contact_user_id, invited_at
  ) values (
    me, trim(p_name), v_phone, nullif(trim(coalesce(p_relationship, '')), ''),
    v_count, v_match, case when v_match is not null then now() else null end
  ) returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'phone', v_phone,
    -- The client uses this to decide between "request sent" and "invite them",
    -- never to display anything about the other account.
    'reachable_in_app', v_match is not null
  );
end $$;

create or replace function public.ec_update(
  p_id uuid,
  p_name text default null,
  p_relationship text default null,
  p_phone text default null,
  p_notify_trip_start boolean default null,
  p_notify_trip_end boolean default null,
  p_notify_sos boolean default null,
  p_notify_route_deviation boolean default null,
  p_notify_no_movement boolean default null,
  p_share_live_location boolean default null,
  p_channel text default null,
  p_custom_message text default null,
  p_silent_from time default null,
  p_silent_to time default null,
  p_clear_silent boolean default false,
  p_muted_until timestamptz default null,
  p_clear_mute boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_phone text; v_match uuid; v_owner uuid;
begin
  select user_id into v_owner from public.emergency_contacts where id = p_id;
  if v_owner is null or v_owner <> auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Changing the number is changing WHO this is, so consent starts over.
  if p_phone is not null then
    v_phone := public.ec_normalise_phone(p_phone);
    if v_phone is null or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 10 then
      return jsonb_build_object('ok', false, 'reason', 'phone_invalid');
    end if;
    if exists (select 1 from public.emergency_contacts
                where user_id = auth.uid() and phone = v_phone and id <> p_id) then
      return jsonb_build_object('ok', false, 'reason', 'duplicate');
    end if;
    select id into v_match from public.users
     where public.ec_normalise_phone(phone) = v_phone limit 1;
  end if;

  update public.emergency_contacts set
    name         = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
    relationship = coalesce(p_relationship, relationship),
    phone        = coalesce(v_phone, phone),
    contact_user_id = case when v_phone is null then contact_user_id else v_match end,
    status       = case when v_phone is null or v_phone = phone then status else 'pending' end,
    verified_at  = case when v_phone is null or v_phone = phone then verified_at else null end,
    notify_trip_start      = coalesce(p_notify_trip_start, notify_trip_start),
    notify_trip_end        = coalesce(p_notify_trip_end, notify_trip_end),
    notify_sos             = coalesce(p_notify_sos, notify_sos),
    notify_route_deviation = coalesce(p_notify_route_deviation, notify_route_deviation),
    notify_no_movement     = coalesce(p_notify_no_movement, notify_no_movement),
    share_live_location    = coalesce(p_share_live_location, share_live_location),
    channel      = coalesce(p_channel, channel),
    custom_message = case when p_custom_message is null then custom_message
                          else nullif(trim(p_custom_message), '') end,
    silent_from  = case when p_clear_silent then null else coalesce(p_silent_from, silent_from) end,
    silent_to    = case when p_clear_silent then null else coalesce(p_silent_to, silent_to) end,
    muted_until  = case when p_clear_mute then null else coalesce(p_muted_until, muted_until) end,
    updated_at   = now()
  where id = p_id;

  return jsonb_build_object('ok', true, 'reachable_in_app', coalesce(v_match, contact_user_id_of(p_id)) is not null);
end $$;

-- Tiny helper so ec_update can report reachability without a second round trip.
create or replace function public.contact_user_id_of(p_id uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select contact_user_id from public.emergency_contacts where id = p_id;
$$;

create or replace function public.ec_delete(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.emergency_contacts where id = p_id and user_id = auth.uid();
  return found;
end $$;

-- Priority IS the order an SOS walks, so it is set as a whole list rather than
-- one row at a time — a partial reorder can leave two contacts both "first".
create or replace function public.ec_reorder(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare i int;
begin
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.emergency_contacts
       set priority = i - 1, updated_at = now()
     where id = p_ids[i] and user_id = auth.uid();
  end loop;
end $$;

/** The CONTACT's answer to being added. Only they can give it. */
create or replace function public.ec_respond(p_id uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_target uuid;
begin
  select contact_user_id into v_target from public.emergency_contacts where id = p_id;
  if v_target is null or v_target <> auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  update public.emergency_contacts
     set status = case when p_accept then 'verified' else 'declined' end,
         verified_at = case when p_accept then now() else null end,
         updated_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'status', case when p_accept then 'verified' else 'declined' end);
end $$;
-- ═══════════════════════════════════════════════════════════════════════════
-- The contact's inbox
-- ═══════════════════════════════════════════════════════════════════════════
-- `social_notifications` was the obvious place and is the wrong one: it has no
-- body, no location and no trip, and its `kind` is constrained to feed events.
-- An emergency alert that cannot say WHERE is not an alert.

create table if not exists public.emergency_alerts (
  id              uuid primary key default gen_random_uuid(),
  -- The recipient. Indexed first because "my alerts" is the only read path.
  contact_user_id uuid not null references auth.users(id) on delete cascade,
  from_user_id    uuid not null references auth.users(id) on delete cascade,
  contact_id      uuid references public.emergency_contacts(id) on delete set null,
  kind            text not null,
  title           text not null,
  body            text not null,
  trip_id         text,
  trip_code       text,
  lat             double precision,
  lng             double precision,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists emergency_alerts_inbox_idx
  on public.emergency_alerts (contact_user_id, created_at desc);

alter table public.emergency_alerts enable row level security;

drop policy if exists emergency_alerts_recipient on public.emergency_alerts;
create policy emergency_alerts_recipient on public.emergency_alerts
  for select to authenticated
  using (contact_user_id = auth.uid() or from_user_id = auth.uid());

-- Only the recipient marks it read. The sender must never be able to clear an
-- alert off someone else's screen.
drop policy if exists emergency_alerts_read on public.emergency_alerts;
create policy emergency_alerts_read on public.emergency_alerts
  for update to authenticated
  using (contact_user_id = auth.uid())
  with check (contact_user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- Dispatch
-- ═══════════════════════════════════════════════════════════════════════════
/**
 * Decide who hears about this, tell the ones we can reach, and log every
 * decision including the ones to stay quiet.
 *
 * ── Why the skips are logged too ───────────────────────────────────────────
 * "Nobody was notified" and "nobody was due to be notified" look identical
 * afterwards unless the reason is written down. After an incident that
 * difference is the whole question, so `emergency_events` records a row for a
 * contact who was muted, unverified or inside quiet hours — with which.
 *
 * ── What an SOS overrides ──────────────────────────────────────────────────
 * Quiet hours, mute, and the pending-consent hold. Everything except an
 * explicit `notify_sos = false`, which is a decision the user made about that
 * specific person.
 *
 * Returns the contacts the SERVER could not reach — the ones with no EMILGO
 * account — so the client can offer to send from the device's own composer.
 */
create or replace function public.ec_dispatch(
  p_kind      text,
  p_title     text,
  p_body      text,
  p_trip_id   text default null,
  p_trip_code text default null,
  p_lat       double precision default null,
  p_lng       double precision default null
)
returns table (
  contact_id uuid, name text, phone text, channel text, custom_message text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me       uuid := auth.uid();
  c        record;
  is_sos   boolean := p_kind = 'sos';
  wants    boolean;
  quiet    boolean;
  now_t    time := (now() at time zone 'Africa/Lagos')::time;
begin
  if me is null then raise exception 'not signed in'; end if;

  for c in
    select * from public.emergency_contacts
     where user_id = me
     order by priority asc, created_at asc
  loop
    wants := case p_kind
      when 'trip_start'      then c.notify_trip_start
      when 'trip_end'        then c.notify_trip_end
      when 'sos'             then c.notify_sos
      when 'route_deviation' then c.notify_route_deviation
      when 'no_movement'     then c.notify_no_movement
      when 'test'            then true
      else false
    end;

    if not wants then
      continue;  -- an explicit preference, not a skip worth logging
    end if;

    -- Consent. An SOS goes to a pending contact anyway; a routine ping does not.
    if c.status <> 'verified' and not is_sos then
      insert into public.emergency_events (user_id, contact_id, kind, trip_id, outcome)
      values (me, c.id, p_kind, p_trip_id, 'skipped_unverified');
      continue;
    end if;

    if c.muted_until is not null and c.muted_until > now() and not is_sos then
      insert into public.emergency_events (user_id, contact_id, kind, trip_id, outcome)
      values (me, c.id, p_kind, p_trip_id, 'skipped_muted');
      continue;
    end if;

    -- Quiet hours, including the overnight case where `from` is after `to`.
    quiet := false;
    if c.silent_from is not null and c.silent_to is not null then
      quiet := case
        when c.silent_from <= c.silent_to
          then now_t >= c.silent_from and now_t < c.silent_to
        else now_t >= c.silent_from or now_t < c.silent_to
      end;
    end if;
    if quiet and not is_sos then
      insert into public.emergency_events (user_id, contact_id, kind, trip_id, outcome)
      values (me, c.id, p_kind, p_trip_id, 'skipped_quiet');
      continue;
    end if;

    if c.contact_user_id is not null and c.channel in ('auto', 'in_app') then
      insert into public.emergency_alerts (
        contact_user_id, from_user_id, contact_id, kind, title, body,
        trip_id, trip_code, lat, lng
      ) values (
        c.contact_user_id, me, c.id, p_kind, p_title,
        coalesce(nullif(c.custom_message, '') || ' — ', '') || p_body,
        p_trip_id, p_trip_code,
        case when c.share_live_location or is_sos then p_lat else null end,
        case when c.share_live_location or is_sos then p_lng else null end
      );
      insert into public.emergency_events (user_id, contact_id, kind, trip_id, channel, outcome)
      values (me, c.id, p_kind, p_trip_id, 'in_app', 'sent');
    else
      -- No account, or the user explicitly chose SMS/WhatsApp. The server cannot
      -- send either — that needs a provider (SETUP-KEYS §4.8) — so it hands the
      -- contact back and the client opens the device's own composer.
      insert into public.emergency_events (user_id, contact_id, kind, trip_id, channel, outcome)
      values (me, c.id, p_kind, p_trip_id,
              case when c.channel = 'auto' then 'sms' else c.channel end, 'sent');

      contact_id := c.id;
      name := c.name;
      phone := c.phone;
      channel := case when c.channel = 'auto' then 'sms' else c.channel end;
      custom_message := c.custom_message;
      return next;
    end if;
  end loop;
end $$;

/** The contact's own inbox. */
create or replace function public.ec_my_alerts(p_limit integer default 100)
returns table (
  id uuid, from_user_id uuid, from_name text, from_photo text,
  kind text, title text, body text, trip_id text, trip_code text,
  lat double precision, lng double precision,
  read_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.from_user_id, u.full_name, u.profile_photo,
         a.kind, a.title, a.body, a.trip_id, a.trip_code,
         a.lat, a.lng, a.read_at, a.created_at
    from public.emergency_alerts a
    join public.users u on u.id = a.from_user_id
   where a.contact_user_id = auth.uid()
   order by a.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 300));
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'ec_normalise_phone(text)',
    'ec_list()',
    'ec_requests_for_me()',
    'ec_events(integer)',
    'ec_add(text,text,text)',
    'ec_update(uuid,text,text,text,boolean,boolean,boolean,boolean,boolean,boolean,text,text,time,time,boolean,timestamptz,boolean)',
    'contact_user_id_of(uuid)',
    'ec_delete(uuid)',
    'ec_reorder(uuid[])',
    'ec_respond(uuid,boolean)',
    'ec_dispatch(text,text,text,text,text,double precision,double precision)',
    'ec_my_alerts(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
