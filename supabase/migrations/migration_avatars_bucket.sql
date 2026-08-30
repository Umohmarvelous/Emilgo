-- migration_avatars_bucket.sql
--
-- Somewhere for a profile photo to actually live.
--
-- ── The bug this fixes ─────────────────────────────────────────────────────
-- `driver-profile.tsx` picked a photo and wrote `result.assets[0].uri` straight
-- into `users.profile_photo`. That is a `file://` path inside the PICKER's
-- sandbox on the driver's own phone. It renders on the device that chose it and
-- nowhere else — so every passenger looking at that driver saw a broken image,
-- and so did the driver after a reinstall.
--
-- ── Why public, when chat media is private ─────────────────────────────────
-- A profile photo is shown to strangers by design: a passenger checks the face
-- before getting into the bus, and that is the entire point of having one. A
-- private bucket would mean signing a URL for every avatar in a list of thirty
-- drivers. `chat-media` is private because a chat is not published; an avatar
-- is.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_read   on storage.objects;
drop policy if exists avatars_write  on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;

-- Readable by anyone, including `anon`: an avatar appears on screens a signed-out
-- user can see, and a public bucket that needs a session is just a private one
-- with extra steps.
create policy avatars_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

-- Write only into your own folder. The first path segment IS the access rule —
-- `<uid>/<timestamp>-<rand>.jpg` — which is what stops one user replacing
-- another's face.
create policy avatars_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
