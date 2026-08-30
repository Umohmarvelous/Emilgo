-- migration_cs_coins.sql
--
-- The virtual coin system, and the wall between it and real money.
--
-- ── Why this exists in this shape ──────────────────────────────────────────
-- See COMPLIANCE.md §0–§3. The short version: what makes a balance "e-money"
-- under CBN rules is not the symbol on the screen, it is whether the balance is
-- a claim on the operator redeemable for cash. So `cs` is defined here as a
-- thing that CANNOT become cash:
--
--   * there is no conversion function between cs and any currency, in either
--     direction, anywhere in this schema or in the app;
--   * cs is spent on ENTITLEMENTS at a fixed cs price (a half-fare ride, a fuel
--     voucher), never on "an amount of naira";
--   * nothing can move cs to a bank account.
--
-- `coinsToNaira(c) = c * 0.7` used to exist in the client and was rendered to
-- users as "≈ ₦n". A published fixed redemption rate is the single strongest
-- evidence a unit IS stored value. It is deleted, and this schema is built so it
-- cannot be reintroduced without someone noticing.
--
-- ── Two accounts, as asked ─────────────────────────────────────────────────
--   * ONE general pool  — the app's issuance budget, `cs_general_ledger`.
--   * ONE pool per user — `cs_ledger`, keyed by user.
--
-- Watching an ad moves cs OUT of the general pool and INTO the user's pool in a
-- single transaction (stage 1, immediate). When the ad network actually pays,
-- that payment replenishes the general pool (stage 2, later, real money in
-- EMILGO's own corporate account — which is why the replenishment row records a
-- reference, not a user).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. CURRENCY (real money only)
-- ═══════════════════════════════════════════════════════════════════════════
-- The app has to work in every country, so a real amount is never assumed to be
-- naira. `₦` was hard-coded in 89 places; a user's currency is now a property of
-- the user.

alter table public.users
  add column if not exists country_code  text not null default 'NG',
  add column if not exists currency_code text not null default 'NGN';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. THE GENERAL POOL
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.cs_general_ledger (
  id         bigserial primary key,
  -- Positive = cs issued into the pool (an ad network paid, or an operator
  -- top-up). Negative = cs granted out of the pool to a user.
  amount     bigint      not null,
  kind       text        not null check (kind in (
                 'ad_network_payout',   -- stage 2: the money actually arrived
                 'operator_topup',      -- EMILGO funds the pool from its budget
                 'ad_watch_grant',      -- stage 1: granted to a user, immediately
                 'correction')),
  -- Who received it, when the entry is a grant. NULL for inbound entries.
  user_id    uuid        references auth.users(id) on delete set null,
  -- Free-text reference for an inbound payout: the network's settlement id.
  reference  text,
  note       text,
  -- Every write is idempotent. A retried ad completion must never grant twice.
  dedupe_key text unique,
  created_at timestamptz not null default now()
);

create index if not exists cs_general_ledger_created_idx
  on public.cs_general_ledger (created_at desc);

alter table public.cs_general_ledger enable row level security;

-- Nobody reads the general ledger directly. It is the company's own books; the
-- app only ever needs the single number that `cs_general_balance()` returns.
drop policy if exists cs_general_admin on public.cs_general_ledger;
create policy cs_general_admin on public.cs_general_ledger
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. PER-USER POOLS
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.cs_ledger (
  id         bigserial primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  -- Positive = earned or received. Negative = spent or gifted away.
  amount     bigint      not null,
  kind       text        not null check (kind in (
                 'ad_watch',          -- + from the general pool
                 'gift_received',     -- + from another user
                 'gift_sent',         -- - to another user
                 'referral',          -- + campaign
                 'signup_bonus',      -- +
                 'redeem_half_fare',  -- - entitlement: one discounted ride
                 'redeem_fuel',       -- - entitlement: fuel at a partner station
                 'redeem_commission', -- - entitlement: one commission waiver
                 'expiry',            -- - housekeeping
                 'correction')),
  -- The other party, for a gift. Never a bank, never an account number.
  counterparty_id uuid   references auth.users(id) on delete set null,
  note       text,
  dedupe_key text unique,
  created_at timestamptz not null default now()
);

create index if not exists cs_ledger_user_idx
  on public.cs_ledger (user_id, created_at desc);

alter table public.cs_ledger enable row level security;

-- Read your own ledger. Writes go through the RPCs below — a client that can
-- INSERT into its own ledger can mint cs, which is the whole game.
drop policy if exists cs_ledger_read_own on public.cs_ledger;
create policy cs_ledger_read_own on public.cs_ledger
  for select to authenticated using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. BALANCES
-- ═══════════════════════════════════════════════════════════════════════════
-- The balance is ALWAYS the sum of the ledger. It is never stored and never set,
-- so it cannot be forged — you can only add entries, and every entry is written
-- by a function that checked something first.

create or replace function public.cs_balance(p_user uuid default null)
returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0)::bigint
    from public.cs_ledger
   where user_id = coalesce(p_user, auth.uid())
     -- Reading someone else's balance is only for the caller themselves.
     and coalesce(p_user, auth.uid()) = auth.uid();
$$;

create or replace function public.cs_general_balance()
returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0)::bigint from public.cs_general_ledger;
$$;

-- The user's own statement — what the history screen renders.
create or replace function public.cs_history(p_limit integer default 100)
returns table (
  id              bigint,
  amount          bigint,
  kind            text,
  counterparty_id uuid,
  counterparty_name text,
  note            text,
  created_at      timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.id, l.amount, l.kind, l.counterparty_id, u.full_name, l.note, l.created_at
    from public.cs_ledger l
    left join public.users u on u.id = l.counterparty_id
   where l.user_id = auth.uid()
   order by l.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. STAGE 1 — an ad is watched, the general pool pays the user
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Both legs in ONE transaction. A grant that debits the general pool but fails
-- to credit the user (or the reverse) is money invented or destroyed, and a
-- ledger that does not balance cannot be audited — which is the only reason this
-- design is defensible in the first place.

create or replace function public.cs_grant_from_general(
  p_amount     bigint,
  p_dedupe_key text,
  p_note       text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); v_pool bigint;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'grant must be positive';
  end if;
  if p_dedupe_key is null or length(p_dedupe_key) < 8 then
    raise exception 'a grant needs a dedupe key';
  end if;

  -- Already granted. Not an error: a client retrying after a dropped response
  -- must get the same answer, not a second payment.
  if exists (select 1 from public.cs_general_ledger where dedupe_key = p_dedupe_key) then
    return jsonb_build_object('ok', true, 'granted', 0, 'duplicate', true,
                              'balance', public.cs_balance());
  end if;

  -- Lock the pool for the length of the transaction so two ads finishing at the
  -- same instant cannot both read the same balance and both be funded.
  perform pg_advisory_xact_lock(hashtext('cs_general_pool'));

  select coalesce(sum(amount), 0) into v_pool from public.cs_general_ledger;

  -- An empty pool is a real state, not an error: it means the ad network has not
  -- paid yet. The user is told the truth rather than credited with cs the
  -- company has not earned.
  if v_pool < p_amount then
    return jsonb_build_object('ok', false, 'reason', 'general_pool_empty',
                              'pool', v_pool, 'balance', public.cs_balance());
  end if;

  insert into public.cs_general_ledger (amount, kind, user_id, note, dedupe_key)
  values (-p_amount, 'ad_watch_grant', me, p_note, p_dedupe_key);

  insert into public.cs_ledger (user_id, amount, kind, note, dedupe_key)
  values (me, p_amount, 'ad_watch', p_note, 'u:' || p_dedupe_key);

  return jsonb_build_object('ok', true, 'granted', p_amount, 'duplicate', false,
                            'balance', public.cs_balance(),
                            'pool', v_pool - p_amount);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. STAGE 2 — the ad network pays, the general pool is replenished
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Admin-only, and deliberately NOT callable from the app: this is the point
-- where real money lands in EMILGO's own corporate account and is converted into
-- issuance capacity. It records a settlement reference so a row here can be tied
-- back to a statement line.

create or replace function public.cs_replenish_general(
  p_amount    bigint,
  p_reference text,
  p_kind      text default 'ad_network_payout',
  p_note      text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin boolean;
begin
  select is_admin into v_admin from public.users where id = auth.uid();
  if not coalesce(v_admin, false) then raise exception 'admins only'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'must be positive'; end if;
  if p_kind not in ('ad_network_payout', 'operator_topup', 'correction') then
    raise exception 'not an inbound kind';
  end if;

  insert into public.cs_general_ledger (amount, kind, reference, note, dedupe_key)
  values (p_amount, p_kind, p_reference, p_note,
          coalesce(p_kind || ':' || p_reference, null))
  on conflict (dedupe_key) do nothing;

  return jsonb_build_object('ok', true, 'pool', public.cs_general_balance());
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. GIFTING
-- ═══════════════════════════════════════════════════════════════════════════
--
-- COMPLIANCE.md §2.3: this is only safe because cs cannot become cash. It moves
-- points between two ledgers and touches nothing else. There is no fee, no
-- spread, no settlement and no bank leg — if any of those are ever added, this
-- becomes money transmission and needs a licence.

create table if not exists public.cs_gift_config (
  id                boolean primary key default true check (id),
  min_gift          bigint  not null default 5,
  max_gift          bigint  not null default 500,
  daily_sent_cap    bigint  not null default 2000,
  daily_gift_count  integer not null default 20,
  enabled           boolean not null default true
);
insert into public.cs_gift_config (id) values (true) on conflict (id) do nothing;
alter table public.cs_gift_config enable row level security;
drop policy if exists cs_gift_config_read on public.cs_gift_config;
create policy cs_gift_config_read on public.cs_gift_config
  for select to authenticated using (true);

create or replace function public.cs_gift(
  p_to_user uuid,
  p_amount  bigint,
  p_note    text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  cfg public.cs_gift_config%rowtype;
  v_bal bigint; v_sent_today bigint; v_count_today integer;
  v_to_name text; v_to_role text; v_key text;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into cfg from public.cs_gift_config where id;
  if not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  if p_to_user is null or p_to_user = me then
    return jsonb_build_object('ok', false, 'reason', 'invalid_recipient');
  end if;

  select full_name, role into v_to_name, v_to_role
    from public.users where id = p_to_user;
  if v_to_name is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_recipient');
  end if;

  if p_amount < cfg.min_gift or p_amount > cfg.max_gift then
    return jsonb_build_object('ok', false, 'reason', 'out_of_range',
                              'min', cfg.min_gift, 'max', cfg.max_gift);
  end if;

  -- One lock per sender: two taps on Send at the same moment must not both pass
  -- the balance check.
  perform pg_advisory_xact_lock(hashtext('cs_gift:' || me::text));

  v_bal := public.cs_balance();
  if v_bal < p_amount then
    return jsonb_build_object('ok', false, 'reason', 'insufficient',
                              'balance', v_bal);
  end if;

  select coalesce(-sum(amount), 0), count(*)
    into v_sent_today, v_count_today
    from public.cs_ledger
   where user_id = me and kind = 'gift_sent'
     and created_at >= date_trunc('day', now());

  if v_sent_today + p_amount > cfg.daily_sent_cap then
    return jsonb_build_object('ok', false, 'reason', 'daily_cap',
                              'sent_today', v_sent_today, 'cap', cfg.daily_sent_cap);
  end if;
  if v_count_today >= cfg.daily_gift_count then
    return jsonb_build_object('ok', false, 'reason', 'daily_count',
                              'cap', cfg.daily_gift_count);
  end if;

  v_key := 'gift:' || me::text || ':' || p_to_user::text || ':' ||
           extract(epoch from clock_timestamp())::bigint::text;

  insert into public.cs_ledger (user_id, amount, kind, counterparty_id, note, dedupe_key)
  values (me, -p_amount, 'gift_sent', p_to_user, p_note, v_key || ':out');

  insert into public.cs_ledger (user_id, amount, kind, counterparty_id, note, dedupe_key)
  values (p_to_user, p_amount, 'gift_received', me, p_note, v_key || ':in');

  return jsonb_build_object('ok', true, 'amount', p_amount,
                            'to_name', v_to_name, 'to_role', v_to_role,
                            'balance', public.cs_balance(),
                            'reference', v_key);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. SPENDING — entitlements, never amounts
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This is the hinge the whole compliance argument turns on. cs buys a THING at a
-- fixed cs price — one discounted ride, one fuel voucher — never "n naira of
-- value". A voucher is a service entitlement; an amount is stored value.

create table if not exists public.cs_entitlements (
  code        text primary key,
  label       text    not null,
  description text    not null,
  price_cs    bigint  not null check (price_cs > 0),
  -- Which role may redeem it. NULL = anyone.
  for_role    text,
  enabled     boolean not null default true
);

insert into public.cs_entitlements (code, label, description, price_cs, for_role) values
  ('half_fare',        'Half-fare ride',   'One ride at half the posted fare.',                200, 'passenger'),
  ('fuel_voucher',     'Fuel voucher',     'Fuel at a partner station, redeemed at the pump.', 500, 'driver'),
  ('commission_waiver','Commission waiver','One trip with no service commission.',             150, 'driver')
on conflict (code) do nothing;

alter table public.cs_entitlements enable row level security;
drop policy if exists cs_entitlements_read on public.cs_entitlements;
create policy cs_entitlements_read on public.cs_entitlements
  for select to authenticated using (enabled);

create table if not exists public.cs_redemptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  code         text        not null references public.cs_entitlements(code),
  price_cs     bigint      not null,
  -- Short human code the driver reads out at the pump / the passenger shows.
  voucher_code text        not null unique,
  used_at      timestamptz,
  expires_at   timestamptz not null default now() + interval '30 days',
  created_at   timestamptz not null default now()
);
create index if not exists cs_redemptions_user_idx
  on public.cs_redemptions (user_id, created_at desc);

alter table public.cs_redemptions enable row level security;
drop policy if exists cs_redemptions_own on public.cs_redemptions;
create policy cs_redemptions_own on public.cs_redemptions
  for select to authenticated using (user_id = auth.uid());

create or replace function public.cs_redeem(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  ent public.cs_entitlements%rowtype;
  v_bal bigint; v_role text; v_voucher text;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into ent from public.cs_entitlements where code = p_code and enabled;
  if ent.code is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_entitlement');
  end if;

  select role into v_role from public.users where id = me;
  if ent.for_role is not null and ent.for_role <> coalesce(v_role, '') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_role');
  end if;

  perform pg_advisory_xact_lock(hashtext('cs_spend:' || me::text));

  v_bal := public.cs_balance();
  if v_bal < ent.price_cs then
    return jsonb_build_object('ok', false, 'reason', 'insufficient',
                              'balance', v_bal, 'price', ent.price_cs);
  end if;

  v_voucher := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.cs_ledger (user_id, amount, kind, note, dedupe_key)
  values (me, -ent.price_cs,
          case ent.code
            when 'half_fare'         then 'redeem_half_fare'
            when 'fuel_voucher'      then 'redeem_fuel'
            when 'commission_waiver' then 'redeem_commission'
            else 'correction' end,
          ent.label, 'redeem:' || v_voucher);

  insert into public.cs_redemptions (user_id, code, price_cs, voucher_code)
  values (me, ent.code, ent.price_cs, v_voucher);

  return jsonb_build_object('ok', true, 'voucher', v_voucher,
                            'label', ent.label, 'price', ent.price_cs,
                            'balance', public.cs_balance());
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. GRANTS
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare fn text;
begin
  foreach fn in array array[
    'cs_balance(uuid)',
    'cs_general_balance()',
    'cs_history(integer)',
    'cs_grant_from_general(bigint,text,text)',
    'cs_replenish_general(bigint,text,text,text)',
    'cs_gift(uuid,bigint,text)',
    'cs_redeem(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- There is deliberately NO function here that converts cs to a currency or a
-- currency to cs, and none that pays cs to a bank account. If you are reading
-- this because you are about to add one, read COMPLIANCE.md §0 first — that one
-- function is the difference between a loyalty programme and a licence.
