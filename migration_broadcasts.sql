-- migration_broadcasts.sql
--
-- Making a park broadcast actually arrive.
--
-- ── What was wrong ─────────────────────────────────────────────────────────
-- The plumbing existed and the last mile did not. A park owner's message was
-- written to AsyncStorage, pushed to `broadcasts` by the sync loop, and pulled
-- by drivers — but `(driver)/messages.tsx` reads `BroadcastsStorage.getAll()`
-- and nothing else. So a broadcast appeared only if a background sync happened
-- to have run first. There was no realtime, no push, and no way for the owner to
-- know whether a single driver had seen it.
--
-- For a park telling its drivers "the road is blocked", "arrives eventually" is
-- the same as "does not work".
--
-- ── What a broadcast needs that a message blob does not ────────────────────
-- A subject, an urgency, an expiry, and evidence somebody read it. A notice
-- about today's fuel queue is worse than useless tomorrow, and an owner who
-- cannot tell the difference between "nobody read it" and "nobody has synced"
-- will send it again, and again.

alter table public.broadcasts
  add column if not exists title      text,
  add column if not exists priority   text not null default 'normal',
  add column if not exists expires_at timestamptz,
  -- Denormalised so a driver sees who sent it without a lookup into `users`,
  -- which is not cross-readable (migration_user_privacy.sql).
  add column if not exists sender_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'broadcasts_priority_check') then
    alter table public.broadcasts
      add constraint broadcasts_priority_check check (priority in ('normal','urgent'));
  end if;
end $$;

create index if not exists broadcasts_park_created_idx
  on public.broadcasts (park_id, created_at desc);

-- Read receipts. The owner's only honest answer to "did they see it?".
create table if not exists public.broadcast_reads (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  read_at      timestamptz not null default now(),
  primary key (broadcast_id, user_id)
);

alter table public.broadcast_reads enable row level security;

-- A driver writes their own receipt. The owner reads all of them for their own
-- broadcasts — which is the whole point — and nobody else sees either.
drop policy if exists broadcast_reads_own on public.broadcast_reads;
create policy broadcast_reads_own on public.broadcast_reads
  for all to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.broadcasts b
                where b.id = broadcast_id and b.park_id = auth.uid())
  )
  with check (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- Sending
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.broadcast_send(
  p_message    text,
  p_title      text default null,
  p_priority   text default 'normal',
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  v_role text; v_park text; v_name text;
  v_id uuid; v_reach int;
begin
  select role, park_name, full_name into v_role, v_park, v_name
    from public.users where id = me;

  -- A broadcast goes to every driver in a park. Only the park's owner may send
  -- one, and the check is here rather than in the UI because the UI is not an
  -- access control.
  if v_role is distinct from 'park_owner' then
    return jsonb_build_object('ok', false, 'reason', 'not_a_park_owner');
  end if;
  if coalesce(trim(p_message), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  if coalesce(p_priority, 'normal') not in ('normal','urgent') then
    return jsonb_build_object('ok', false, 'reason', 'bad_priority');
  end if;

  select count(*) into v_reach from public.users
   where role = 'driver' and park_name = v_park and park_name is not null;

  insert into public.broadcasts (park_id, message, title, priority, expires_at, sender_name)
  values (me, trim(p_message), nullif(trim(coalesce(p_title, '')), ''),
          coalesce(p_priority, 'normal'), p_expires_at, v_name)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'reach', v_reach);
end $$;

create or replace function public.broadcast_delete(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.broadcasts where id = p_id and park_id = auth.uid();
  return found;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Reading
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * What this driver should see.
 *
 * Expired notices are dropped here rather than filtered on the client: a notice
 * about today's fuel queue is actively misleading tomorrow, and a client that
 * forgets the filter shows it anyway.
 */
create or replace function public.broadcast_list_for_driver(p_limit integer default 50)
returns table (
  id uuid, message text, title text, priority text,
  sender_name text, created_at timestamptz, expires_at timestamptz, read boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select auth.uid() as uid),
  my_park as (
    select u.park_name from public.users u, me where u.id = me.uid
  )
  select b.id, b.message, b.title, b.priority, b.sender_name,
         b.created_at, b.expires_at,
         (r.user_id is not null)
    from public.broadcasts b
    cross join me
    join public.users owner_row on owner_row.id = b.park_id
    join my_park on my_park.park_name = owner_row.park_name
    left join public.broadcast_reads r
           on r.broadcast_id = b.id and r.user_id = me.uid
   where owner_row.role = 'park_owner'
     and my_park.park_name is not null
     and (b.expires_at is null or b.expires_at > now())
   order by
     -- Urgent first, but only while unread: a read urgent notice pinned to the
     -- top forever is how people learn to ignore the top.
     (case when r.user_id is null and b.priority = 'urgent' then 0 else 1 end),
     b.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create or replace function public.broadcast_mark_read(p_id uuid)
returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.broadcast_reads (broadcast_id, user_id)
  select p_id, auth.uid()
   where exists (
     select 1 from public.broadcasts b
       join public.users owner_row on owner_row.id = b.park_id
       join public.users me on me.id = auth.uid()
      where b.id = p_id and owner_row.park_name = me.park_name
   )
  on conflict do nothing;
$$;

/** The owner's own sent list, with how far each one actually got. */
create or replace function public.broadcast_list_sent(p_limit integer default 50)
returns table (
  id uuid, message text, title text, priority text,
  created_at timestamptz, expires_at timestamptz,
  read_count integer, reach integer
)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select auth.uid() as uid),
  my_park as (select u.park_name from public.users u, me where u.id = me.uid),
  drivers as (
    select count(*)::int as n from public.users u, my_park
     where u.role = 'driver' and u.park_name = my_park.park_name
       and my_park.park_name is not null
  )
  select b.id, b.message, b.title, b.priority, b.created_at, b.expires_at,
         (select count(*)::int from public.broadcast_reads r where r.broadcast_id = b.id),
         drivers.n
    from public.broadcasts b
    cross join me
    cross join drivers
   where b.park_id = me.uid
   order by b.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'broadcast_send(text,text,text,timestamptz)',
    'broadcast_delete(uuid)',
    'broadcast_list_for_driver(integer)',
    'broadcast_mark_read(uuid)',
    'broadcast_list_sent(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- `broadcasts.id` had no default: every row ever inserted had its uuid minted
-- on the client. That is fine for an offline-first write and impossible for a
-- server-side one, so the column gains the default it should always have had.
alter table public.broadcasts alter column id set default gen_random_uuid();
