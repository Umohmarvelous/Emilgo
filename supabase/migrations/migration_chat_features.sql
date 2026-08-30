-- migration_chat_features.sql
--
-- Everything the chat needed to behave like a real messenger and did not have.
--
-- ── What was actually missing ───────────────────────────────────────────────
-- The client model carried `reply_to`, but `messages` had no column for it, so
-- the INSERT silently dropped it: a reply quote existed only on the device that
-- sent it and vanished on the other side and after a reinstall.
--
-- Voice notes stored a `file://` path from the SENDER's sandbox. The recipient
-- received a path to a file that does not exist on their phone. Nothing here
-- fixes that by itself — the client now uploads — but `media_*` is where the
-- uploaded object lives.
--
-- `unread_count` was ONE integer on a row shared by both people. Whoever opened
-- the chat zeroed it for both. Unread is per-viewer by definition, so it is now
-- derived from `conversation_prefs.last_read_at`.
--
-- `messages_update_participant` let EITHER participant UPDATE ANY message in
-- the conversation — including rewriting the other person's text. Update is now
-- sender-only and read receipts go through an RPC.
--
-- ── Per-user state is per-user rows, never columns on the shared row ────────
-- Mute, pin, archive, wallpaper, "clear chat", starring and delete-for-me are
-- all one-sided. Every one of them lives in a table keyed by (user_id, …), so
-- one side muting a chat cannot mute it for the other.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. COLUMNS
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.messages
  add column if not exists reply_to             jsonb,
  add column if not exists media_url            text,
  add column if not exists media_type           text,
  add column if not exists media_name           text,
  add column if not exists media_size           bigint,
  add column if not exists media_width          integer,
  add column if not exists media_height         integer,
  add column if not exists duration_ms          integer,
  add column if not exists deleted_for_everyone boolean not null default false,
  add column if not exists deleted_at           timestamptz,
  add column if not exists edited_at            timestamptz,
  add column if not exists forwarded            boolean not null default false,
  add column if not exists delivered_at         timestamptz,
  add column if not exists read_at              timestamptz;

-- `messages_has_content` was `text IS NOT NULL OR audio_uri IS NOT NULL`. That
-- predates media entirely, so a photo with no caption was rejected outright —
-- and so was every delete-for-everyone, which has to null the content it is
-- removing. A tombstone is a legitimate row with no content.
alter table public.messages drop constraint if exists messages_has_content;
alter table public.messages
  add constraint messages_has_content
  check (text is not null or audio_uri is not null or media_url is not null
         or deleted_for_everyone);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_media_type_check'
  ) then
    alter table public.messages
      add constraint messages_media_type_check
      check (media_type is null or media_type in ('image','video','audio','file'));
  end if;
end $$;

-- The client has always written `trip_code`; the column never existed, so every
-- trip conversation's upsert failed with "column does not exist" and was
-- swallowed by a console.warn.
alter table public.conversations
  add column if not exists trip_code text;

create index if not exists messages_conv_created_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists messages_media_idx
  on public.messages (conversation_id, media_type) where media_type is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. PER-USER STATE
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.conversation_prefs (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  conversation_id text        not null references public.conversations(id) on delete cascade,
  -- NULL = not muted. A timestamp far in the future is "mute forever"; storing
  -- it that way means one column answers both questions and nothing has to be
  -- un-muted by a background job.
  muted_until     timestamptz,
  pinned          boolean     not null default false,
  archived        boolean     not null default false,
  -- A wallpaper key ('doodle', 'plain', 'sunset', …) or a storage path for a
  -- picked photo. NULL means "use whatever the app default is", which is what
  -- lets the default change without rewriting every row.
  wallpaper       text,
  last_read_at    timestamptz,
  -- "Clear chat" hides everything older than this, for this user only.
  cleared_at      timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create table if not exists public.message_stars (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  message_id      text        not null references public.messages(id) on delete cascade,
  conversation_id text        not null,
  created_at      timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists message_stars_user_idx
  on public.message_stars (user_id, created_at desc);

-- Delete-for-me. A row here hides the message from ONE person; the message
-- itself is untouched, which is the whole difference from delete-for-everyone.
create table if not exists public.message_hides (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  message_id text        not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table public.conversation_prefs enable row level security;
alter table public.message_stars      enable row level security;
alter table public.message_hides      enable row level security;

drop policy if exists conversation_prefs_own on public.conversation_prefs;
create policy conversation_prefs_own on public.conversation_prefs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists message_stars_own on public.message_stars;
create policy message_stars_own on public.message_stars
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists message_hides_own on public.message_hides;
create policy message_hides_own on public.message_hides
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. THE UPDATE HOLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Anyone in the conversation could UPDATE any row in it. That is an edit button
-- on someone else's words. Editing is now sender-only; marking read is an RPC.

drop policy if exists messages_update_participant on public.messages;
drop policy if exists messages_update_sender      on public.messages;
create policy messages_update_sender on public.messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. HELPERS
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.chat_is_participant(p_conversation_id text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and (c.participant_id = auth.uid() or c.passenger_id = auth.uid())
  );
$$;

-- Keep the denormalised preview on the conversation in step with reality.
-- Doing it in a trigger rather than a second client round trip means a forwarded
-- copy, a message sent from another device and a message inserted by an RPC all
-- bump the row identically — the client update only ever covered its own sends.
create or replace function public.chat_bump_conversation()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.conversations
     set last_message = coalesce(
           nullif(new.text, ''),
           case new.media_type
             when 'image' then '📷 Photo'
             when 'video' then '🎥 Video'
             when 'audio' then '🎤 Voice message'
             when 'file'  then '📄 ' || coalesce(new.media_name, 'Document')
             else null
           end,
           case when new.audio_uri is not null then '🎤 Voice message' else '' end),
         last_message_at = new.created_at,
         updated_at      = now()
   where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists chat_bump_conversation_trg on public.messages;
create trigger chat_bump_conversation_trg
  after insert on public.messages
  for each row execute function public.chat_bump_conversation();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. READING
-- ═══════════════════════════════════════════════════════════════════════════

-- The inbox, already resolved to "the other person".
--
-- The conversation row is symmetric — it describes BOTH sides — but an inbox row
-- is one-sided. Deciding which side is "them" on the client is how a driver
-- ended up looking at a chat with themselves; deciding it here means there is
-- one implementation and it is next to the data.
create or replace function public.chat_list_conversations()
returns table (
  id               text,
  type             text,
  other_id         uuid,
  other_name       text,
  other_username   text,
  other_photo      text,
  other_role       text,
  other_driver_id  text,
  other_vehicle    text,
  other_park_name  text,
  last_message     text,
  last_message_at  timestamptz,
  unread_count     integer,
  muted_until      timestamptz,
  pinned           boolean,
  archived         boolean,
  wallpaper        text,
  trip_code        text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select auth.uid() as uid)
  select
    c.id,
    c.type,
    case when c.participant_id = me.uid then c.passenger_id        else c.participant_id        end,
    case when c.participant_id = me.uid then c.passenger_name      else c.participant_name      end,
    case when c.participant_id = me.uid then c.passenger_username  else c.participant_username  end,
    case when c.participant_id = me.uid then c.passenger_photo     else c.participant_photo     end,
    case when c.participant_id = me.uid then 'passenger'           else coalesce(c.participant_role, 'driver') end,
    -- Driver-only fields describe the driver, so they only apply when the OTHER
    -- side is the driver.
    case when c.participant_id = me.uid then null else c.participant_driver_id end,
    case when c.participant_id = me.uid then null else c.participant_vehicle   end,
    case when c.participant_id = me.uid then null else c.participant_park_name end,
    -- The preview is computed, not read off the row: "clear chat" and
    -- delete-for-me are one-sided, and a stale preview of a message this user
    -- has deleted is the most visible way to get that wrong.
    coalesce(lm.preview, ''),
    coalesce(lm.created_at, c.last_message_at, c.created_at),
    coalesce(unread.n, 0)::int,
    p.muted_until,
    coalesce(p.pinned, false),
    coalesce(p.archived, false),
    p.wallpaper,
    c.trip_code
  from public.conversations c
  cross join me
  left join public.conversation_prefs p
         on p.conversation_id = c.id and p.user_id = me.uid
  left join lateral (
    select coalesce(
             nullif(m.text, ''),
             case m.media_type
               when 'image' then '📷 Photo'
               when 'video' then '🎥 Video'
               when 'audio' then '🎤 Voice message'
               when 'file'  then '📄 ' || coalesce(m.media_name, 'Document')
               else null end,
             case when m.audio_uri is not null then '🎤 Voice message' else '' end) as preview,
           m.created_at
      from public.messages m
     where m.conversation_id = c.id
       and not m.deleted_for_everyone
       and (p.cleared_at is null or m.created_at > p.cleared_at)
       and not exists (select 1 from public.message_hides h
                        where h.message_id = m.id and h.user_id = me.uid)
     order by m.created_at desc
     limit 1
  ) lm on true
  left join lateral (
    select count(*) as n
      from public.messages m
     where m.conversation_id = c.id
       and m.sender_id <> me.uid
       and not m.deleted_for_everyone
       and m.created_at > coalesce(p.last_read_at, '-infinity'::timestamptz)
       and (p.cleared_at is null or m.created_at > p.cleared_at)
       and not exists (select 1 from public.message_hides h
                        where h.message_id = m.id and h.user_id = me.uid)
  ) unread on true
  where c.participant_id = me.uid or c.passenger_id = me.uid
  order by coalesce(p.pinned, false) desc,
           coalesce(lm.created_at, c.last_message_at, c.created_at) desc;
$$;

-- One conversation's messages, oldest first, with this viewer's hides, clears
-- and stars already applied.
create or replace function public.chat_list_messages(
  p_conversation_id text,
  p_limit           integer default 300
)
returns table (
  id                   text,
  conversation_id      text,
  sender_id            uuid,
  sender_name          text,
  sender_role          text,
  text                 text,
  audio_uri            text,
  media_url            text,
  media_type           text,
  media_name           text,
  media_size           bigint,
  media_width          integer,
  media_height         integer,
  duration_ms          integer,
  reply_to             jsonb,
  forwarded            boolean,
  edited_at            timestamptz,
  deleted_for_everyone boolean,
  created_at           timestamptz,
  read                 boolean,
  status               text,
  delivered_at         timestamptz,
  read_at              timestamptz,
  starred              boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select auth.uid() as uid),
  cleared as (
    select pr.cleared_at from public.conversation_prefs pr, me
     where pr.conversation_id = p_conversation_id and pr.user_id = me.uid
  )
  select m.id, m.conversation_id, m.sender_id, m.sender_name, m.sender_role,
         -- A message deleted for everyone keeps its row (so the thread does not
         -- silently reshuffle) but must not keep its content.
         case when m.deleted_for_everyone then null else m.text end,
         case when m.deleted_for_everyone then null else m.audio_uri end,
         case when m.deleted_for_everyone then null else m.media_url end,
         case when m.deleted_for_everyone then null else m.media_type end,
         case when m.deleted_for_everyone then null else m.media_name end,
         case when m.deleted_for_everyone then null else m.media_size end,
         m.media_width, m.media_height, m.duration_ms,
         case when m.deleted_for_everyone then null else m.reply_to end,
         m.forwarded, m.edited_at, m.deleted_for_everyone, m.created_at,
         m.read, m.status, m.delivered_at, m.read_at,
         (s.message_id is not null)
    from public.messages m
    cross join me
    left join public.message_stars s
           on s.message_id = m.id and s.user_id = me.uid
    left join cleared on true
   where m.conversation_id = p_conversation_id
     and public.chat_is_participant(p_conversation_id)
     and (cleared.cleared_at is null or m.created_at > cleared.cleared_at)
     and not exists (select 1 from public.message_hides h
                      where h.message_id = m.id and h.user_id = me.uid)
   order by m.created_at asc
   limit greatest(1, least(coalesce(p_limit, 300), 1000));
$$;

-- Media, documents and links in one conversation — the gallery behind
-- "Media, links and docs".
create or replace function public.chat_conversation_media(
  p_conversation_id text,
  p_kind            text default 'media',
  p_limit           integer default 200
)
returns table (
  id          text,
  sender_id   uuid,
  sender_name text,
  media_url   text,
  media_type  text,
  media_name  text,
  media_size  bigint,
  text        text,
  created_at  timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select auth.uid() as uid)
  select m.id, m.sender_id, m.sender_name, m.media_url, m.media_type,
         m.media_name, m.media_size, m.text, m.created_at
    from public.messages m
    cross join me
   where m.conversation_id = p_conversation_id
     and public.chat_is_participant(p_conversation_id)
     and not m.deleted_for_everyone
     and not exists (select 1 from public.message_hides h
                      where h.message_id = m.id and h.user_id = me.uid)
     and case coalesce(p_kind, 'media')
           when 'media' then m.media_type in ('image','video')
           when 'docs'  then m.media_type = 'file'
           -- A link is any message whose text contains a URL. Matching in SQL
           -- rather than filtering on the client means the gallery does not have
           -- to download the whole history to find three links.
           when 'links' then m.text ~* '(https?://|www\.)[^[:space:]]+'
           else false
         end
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

-- Everything this user has starred, newest first, with enough context to render
-- a row that says which chat it came from.
create or replace function public.chat_list_starred(p_limit integer default 200)
returns table (
  id                text,
  conversation_id   text,
  sender_id         uuid,
  sender_name       text,
  text              text,
  media_url         text,
  media_type        text,
  media_name        text,
  audio_uri         text,
  created_at        timestamptz,
  starred_at        timestamptz,
  other_name        text,
  other_photo       text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select auth.uid() as uid)
  select m.id, m.conversation_id, m.sender_id, m.sender_name, m.text,
         m.media_url, m.media_type, m.media_name, m.audio_uri, m.created_at,
         s.created_at,
         case when c.participant_id = me.uid then c.passenger_name  else c.participant_name  end,
         case when c.participant_id = me.uid then c.passenger_photo else c.participant_photo end
    from public.message_stars s
    cross join me
    join public.messages m      on m.id = s.message_id
    join public.conversations c on c.id = m.conversation_id
   where s.user_id = me.uid
     and not m.deleted_for_everyone
     and not exists (select 1 from public.message_hides h
                      where h.message_id = m.id and h.user_id = me.uid)
   order by s.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

-- Search. Scoped to one conversation when an id is passed, across every
-- conversation the caller is in when it is not.
create or replace function public.chat_search_messages(
  p_query           text,
  p_conversation_id text default null,
  p_limit           integer default 60
)
returns table (
  id              text,
  conversation_id text,
  sender_id       uuid,
  sender_name     text,
  text            text,
  created_at      timestamptz,
  other_name      text,
  other_photo     text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select auth.uid() as uid)
  select m.id, m.conversation_id, m.sender_id, m.sender_name, m.text, m.created_at,
         case when c.participant_id = me.uid then c.passenger_name  else c.participant_name  end,
         case when c.participant_id = me.uid then c.passenger_photo else c.participant_photo end
    from public.messages m
    cross join me
    join public.conversations c on c.id = m.conversation_id
   where (c.participant_id = me.uid or c.passenger_id = me.uid)
     and (p_conversation_id is null or m.conversation_id = p_conversation_id)
     and not m.deleted_for_everyone
     and m.text is not null
     and m.text ilike '%' || p_query || '%'
     and not exists (select 1 from public.message_hides h
                      where h.message_id = m.id and h.user_id = me.uid)
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. WRITING
-- ═══════════════════════════════════════════════════════════════════════════

-- Read receipts.
--
-- This replaces a client-side `update messages set read = true` with no sender
-- filter, which marked the reader's OWN outgoing messages as read — so your
-- ticks turned blue the moment you opened your own chat, whether or not anyone
-- had seen anything.
create or replace function public.chat_mark_read(p_conversation_id text)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if not public.chat_is_participant(p_conversation_id) then
    raise exception 'not a participant';
  end if;

  insert into public.conversation_prefs (user_id, conversation_id, last_read_at, updated_at)
  values (auth.uid(), p_conversation_id, now(), now())
  on conflict (user_id, conversation_id)
  do update set last_read_at = now(), updated_at = now();

  update public.messages
     set read = true, status = 'read', read_at = coalesce(read_at, now())
   where conversation_id = p_conversation_id
     and sender_id <> auth.uid()
     and read = false;
  get diagnostics n = row_count;
  return n;
end $$;

-- Delivery receipts: everything addressed to me that I have now received.
-- Separate from read on purpose — one tick vs two is the whole point.
create or replace function public.chat_mark_delivered(p_conversation_id text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.messages m
     set status = 'delivered', delivered_at = coalesce(m.delivered_at, now())
    from public.conversations c
   where c.id = m.conversation_id
     and (c.participant_id = auth.uid() or c.passenger_id = auth.uid())
     and (p_conversation_id is null or m.conversation_id = p_conversation_id)
     and m.sender_id <> auth.uid()
     and m.status = 'sent';
  get diagnostics n = row_count;
  return n;
end $$;

-- One RPC for every one-sided conversation preference. NULL means "leave this
-- one alone", which is what lets the mute sheet and the wallpaper picker call
-- the same function without either clobbering the other's setting.
create or replace function public.chat_set_prefs(
  p_conversation_id text,
  p_muted_until     timestamptz default null,
  p_clear_mute      boolean     default false,
  p_pinned          boolean     default null,
  p_archived        boolean     default null,
  p_wallpaper       text        default null,
  p_clear_wallpaper boolean     default false
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.chat_is_participant(p_conversation_id) then
    raise exception 'not a participant';
  end if;

  insert into public.conversation_prefs (user_id, conversation_id, muted_until, pinned, archived, wallpaper, updated_at)
  values (auth.uid(), p_conversation_id, p_muted_until,
          coalesce(p_pinned, false), coalesce(p_archived, false), p_wallpaper, now())
  on conflict (user_id, conversation_id) do update set
    muted_until = case when p_clear_mute      then null
                       when p_muted_until is not null then p_muted_until
                       else public.conversation_prefs.muted_until end,
    pinned      = coalesce(p_pinned,   public.conversation_prefs.pinned),
    archived    = coalesce(p_archived, public.conversation_prefs.archived),
    wallpaper   = case when p_clear_wallpaper then null
                       when p_wallpaper is not null then p_wallpaper
                       else public.conversation_prefs.wallpaper end,
    updated_at  = now();
end $$;

-- Mark a conversation unread again: rewind last_read_at to just before the last
-- incoming message. Deleting the timestamp entirely would mark the whole
-- history unread, which is not what "mark as unread" means anywhere.
create or replace function public.chat_mark_unread(p_conversation_id text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare last_in timestamptz;
begin
  if not public.chat_is_participant(p_conversation_id) then
    raise exception 'not a participant';
  end if;

  select max(created_at) into last_in
    from public.messages
   where conversation_id = p_conversation_id and sender_id <> auth.uid();

  insert into public.conversation_prefs (user_id, conversation_id, last_read_at, updated_at)
  values (auth.uid(), p_conversation_id, coalesce(last_in - interval '1 millisecond', now()), now())
  on conflict (user_id, conversation_id)
  do update set last_read_at = coalesce(last_in - interval '1 millisecond', now()), updated_at = now();
end $$;

-- "Clear chat" — for me. The messages stay for the other person, which is the
-- behaviour every messenger has and the one users assume.
create or replace function public.chat_clear_history(p_conversation_id text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.chat_is_participant(p_conversation_id) then
    raise exception 'not a participant';
  end if;

  insert into public.conversation_prefs (user_id, conversation_id, cleared_at, updated_at)
  values (auth.uid(), p_conversation_id, now(), now())
  on conflict (user_id, conversation_id)
  do update set cleared_at = now(), updated_at = now();
end $$;

create or replace function public.chat_toggle_star(p_message_id text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_conv text; v_now boolean;
begin
  select conversation_id into v_conv from public.messages where id = p_message_id;
  if v_conv is null or not public.chat_is_participant(v_conv) then
    raise exception 'not a participant';
  end if;

  if exists (select 1 from public.message_stars
              where user_id = auth.uid() and message_id = p_message_id) then
    delete from public.message_stars
     where user_id = auth.uid() and message_id = p_message_id;
    v_now := false;
  else
    insert into public.message_stars (user_id, message_id, conversation_id)
    values (auth.uid(), p_message_id, v_conv)
    on conflict do nothing;
    v_now := true;
  end if;
  return v_now;
end $$;

create or replace function public.chat_delete_for_me(p_message_ids text[])
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  insert into public.message_hides (user_id, message_id)
  select auth.uid(), m.id
    from public.messages m
   where m.id = any(p_message_ids)
     and public.chat_is_participant(m.conversation_id)
  on conflict do nothing;
  get diagnostics n = row_count;
  -- A hidden message can never be reached again, so a star on it is dead state.
  delete from public.message_stars
   where user_id = auth.uid() and message_id = any(p_message_ids);
  return n;
end $$;

-- Delete for everyone. Sender only, and only inside the window — an unbounded
-- one lets someone rewrite a conversation from a year ago after the other
-- person has acted on it.
create or replace function public.chat_delete_for_everyone(p_message_ids text[])
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.messages
     set deleted_for_everyone = true,
         deleted_at = now(),
         text = null, audio_uri = null, media_url = null, media_type = null,
         media_name = null, media_size = null, reply_to = null
   where id = any(p_message_ids)
     and sender_id = auth.uid()
     and not deleted_for_everyone
     and created_at > now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.chat_edit_message(p_message_id text, p_text text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(trim(p_text), '') = '' then
    raise exception 'message cannot be empty';
  end if;
  update public.messages
     set text = p_text, edited_at = now()
   where id = p_message_id
     and sender_id = auth.uid()
     and not deleted_for_everyone
     -- Only text messages are editable; there is nothing to edit on a photo,
     -- and allowing it would let a caption swap the meaning of an old image.
     and media_type is null and audio_uri is null
     and created_at > now() - interval '15 minutes';
  if not found then
    raise exception 'this message can no longer be edited';
  end if;
end $$;

-- Forward. Copies happen server-side so one call fans out to N chats and every
-- copy is stamped `forwarded` — the client cannot forget to set that flag, and a
-- forwarded message must never claim to be original.
create or replace function public.chat_forward(
  p_message_ids      text[],
  p_conversation_ids text[]
)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer := 0; src record; target text; me uuid := auth.uid(); my_name text; my_role text;
begin
  select full_name, role into my_name, my_role from public.users where id = me;

  foreach target in array p_conversation_ids loop
    if not public.chat_is_participant(target) then
      raise exception 'not a participant of %', target;
    end if;

    for src in
      select m.* from public.messages m
       where m.id = any(p_message_ids)
         and not m.deleted_for_everyone
         and public.chat_is_participant(m.conversation_id)
       order by m.created_at asc
    loop
      insert into public.messages (
        id, conversation_id, sender_id, sender_name, sender_role,
        text, audio_uri, media_url, media_type, media_name, media_size,
        media_width, media_height, duration_ms,
        forwarded, read, status, created_at
      ) values (
        'fwd_' || replace(gen_random_uuid()::text, '-', ''),
        target, me, coalesce(my_name, 'User'), my_role,
        src.text, src.audio_uri, src.media_url, src.media_type, src.media_name, src.media_size,
        src.media_width, src.media_height, src.duration_ms,
        true, false, 'sent', now()
      );
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. GRANTS
-- ═══════════════════════════════════════════════════════════════════════════
-- `anon` gets nothing. The anon key ships inside the app bundle, so anything
-- executable by anon is executable by anyone who downloads the app — that is
-- exactly how the users-table PII leak happened (migration_user_privacy.sql).

do $$
declare fn text;
begin
  foreach fn in array array[
    'chat_is_participant(text)',
    'chat_list_conversations()',
    'chat_list_messages(text,integer)',
    'chat_conversation_media(text,text,integer)',
    'chat_list_starred(integer)',
    'chat_search_messages(text,text,integer)',
    'chat_mark_read(text)',
    'chat_mark_delivered(text)',
    'chat_mark_unread(text)',
    'chat_set_prefs(text,timestamptz,boolean,boolean,boolean,text,boolean)',
    'chat_clear_history(text)',
    'chat_toggle_star(text)',
    'chat_delete_for_me(text[])',
    'chat_delete_for_everyone(text[])',
    'chat_edit_message(text,text)',
    'chat_forward(text[],text[])'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. STORAGE — chat-media
-- ═══════════════════════════════════════════════════════════════════════════
-- PRIVATE, unlike `post-media`. A post is published; a chat is not. A public
-- bucket means the URL is the only thing standing between a private photo and
-- anyone who has it, and URLs leak through logs, screenshots and link previews.
--
-- Objects are keyed by conversation: `<conversation_id>/<uid>-<rand>.<ext>`.
-- That single convention is what makes the policies below one line each — the
-- first path segment IS the access-control question.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 52428800,
        array['image/jpeg','image/png','image/webp','image/heic','image/gif',
              'video/mp4','video/quicktime',
              'audio/m4a','audio/mp4','audio/mpeg','audio/aac','audio/wav',
              'application/pdf','text/plain',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_media_read   on storage.objects;
drop policy if exists chat_media_insert on storage.objects;
drop policy if exists chat_media_delete on storage.objects;

create policy chat_media_read on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-media'
         and public.chat_is_participant((storage.foldername(name))[1]));

create policy chat_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-media'
              and public.chat_is_participant((storage.foldername(name))[1]));

-- Only the uploader can remove their own object. A participant deleting the
-- other side's media would make delete-for-me destroy someone else's copy.
create policy chat_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-media' and owner = auth.uid());
