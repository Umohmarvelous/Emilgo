# EMILGO — session status, 21 August 2026

Branch `sdk-54-temp`. **This session's work is NOT committed** — the working
tree holds it. Earlier sessions' work is committed but unpushed; see
"Blocked on you" first.

---

## 🔴 Blocked on you (do these before the next session)

### 1. Push access

`git push` fails with **403**. Your machine has two GitHub accounts logged
into `gh`:

| account | write access to `Umohmarvelous/Teqil` |
|---|---|
| **MarvisDG** (active now, restored as you asked) | ❌ no |
| Umohmarvelous | ✅ yes (owner) |

Your git identity is already `Umohmarvelous <umohmarvelous@gmail.com>` — the
commits are attributed correctly. It is only the *push credential* that is
MarvisDG.

Pick one:
- Add **MarvisDG** as a collaborator with write access on
  `github.com/Umohmarvelous/Teqil/settings/access`, or
- Run `gh auth switch -u Umohmarvelous` yourself when you want to push.

**3 commits are waiting**: `0e37942`, `98b0e85`, plus this file.

### 2. AdMob — unchanged, still yours to do

`SETUP-KEYS.md §4.7`. Ads cannot show in Expo Go at all — the SDK is a
native module and is not in Expo Go. A dev build is not optional.

### 3. Meta / Facebook ads — a gate you cannot skip

I was wrong earlier when I said Meta Audience Network doesn't accept new
publishers. It does — ~37,000 publishers, open. The real blocker is
different: **Meta requires the app to be live in the App Store or Play
Store**, plus app-ownership verification and a Business account. EMILGO
isn't published, so Meta is unreachable today no matter what you integrate.
Correct sequence: ship to the stores → then add Meta / AppLovin / Unity as
bidders through AdMob Mediation, not as second SDKs.

Realistic Nigerian rewarded eCPM is **$0.50–$2.00**. US is **$15–$30**.
Country mix matters far more than which network you pick.

---

## ✅ Done and verified this session

### Security — a live, unauthenticated PII dump, closed
`migration_user_privacy.sql`, commit `ca33289`.

`public.users` carried a policy `FOR SELECT USING (true)` with no role
restriction, so it applied to `anon` — and the anon key ships inside the app
bundle. `GET /rest/v1/users?select=*` returned **every row**: email, phone,
kyc_status, is_admin, and (once a driver filled them in) payout_bank_code,
payout_account_number, nin_hash, bvn_hash.

Verified against the live database before and after: 9 rows / 9 emails /
9 phone numbers readable before; `permission denied for table users` now.

Every legitimate cross-user read became a SECURITY DEFINER function whose
select list *is* the access control: `get_public_profiles`,
`get_driver_public`, `get_park_owner_id`, `username_available`.

### Username login no longer leaks emails
`get_user_by_username` returned an email for any handle, to anyone, before a
session existed. It now runs only inside two edge functions
(`username-login`, `username-reset`) with the service-role key. Deployed and
tested: an unknown username and a wrong password return the *same* status and
the *same* sentence, so neither endpoint is an account-existence oracle.

### Search is username-only
Badge IDs and full names removed from every typed search path. A badge ID is
printed on a QR sticker in a guessable pattern — a searchable ID field is an
index of every driver on the platform. A legal name is worse: nobody chooses
it and nobody can change it to stop being found. QR *scanning* still resolves
an ID, because a scan means you are standing in front of them.

`search_drivers` dropped. Live suggestions added to `driver-search.tsx` and
`(passenger)/find-driver.tsx`.

### Feed crash + vanishing posts
Commit `0e37942`.

- **The crash you pasted.** `list_posts` builds a poll as
  `{options, ends_at, my_choice, tallies}`; the TypeScript interface claimed
  `{options, votes, total, closed}` — a shape nothing ever produced. So
  `Math.max(...poll.votes)` spread `undefined`. Added the missing translation
  and made the component defensive.
- **Voting wiped the poll.** `vote_poll` returns only tallies; the store
  assigned that straight onto the post, erasing `options`. Merges now.
- **Posts disappearing.** *Not* the feed query — verified `feed_for_you`
  returns the right rows, own posts included, and the two "missing" ones are
  replies which For You correctly excludes. Two client bugs: every feed RPC
  returns an **empty set, not an error**, when `auth.uid()` is NULL, so a
  fetch that outran session restore looked exactly like "no posts" and got
  cached as truth; and the store persisted only the composer draft, so every
  cold start began at zero. `load()` waits for a session now, and posts +
  both main timelines persist (capped 250). Ads deliberately not persisted —
  a replayed impression bills an advertiser for a view that never happened.

### Referral system ("WhatsApp Status ads")
Commit `98b0e85`. **16/16** in `supabase/tests/test_referrals.sql`.

Meta sells Status ads; there is no publisher programme, so EMILGO earning
revenue *inside* WhatsApp is not buildable. The inverse is: the user's Status
carries a referral link, and EMILGO pays for attributable installs.

Built and verified: `referral_config`, `referral_codes`, `referral_shares`,
`referrals`; `my_referral`, `record_referral_share`, `claim_referral`,
`try_qualify_referral`, `list_my_referrals`. Client service
`src/services/referrals.ts`, deep-link capture in `app/_layout.tsx`
(`getInitialURL` covers the fresh-install case that actually matters for
attribution), and `applyPendingReferral()` on signup.

Reward pays on **qualification**, never signup. `referred_id` is UNIQUE.
Self-referral blocked. Device-fingerprint guard. Idempotent by `dedupe_key`.
Daily cap per referrer.

---

## ❌ Not done — build these first, in this order

### 1. ~~The chat tab~~ — DONE

Two sessions ago the app had two chat screens and nobody knew. That was
fixed (commit `24acca1`). This session finished the job: the extra chat
features are built, and the three faults underneath them are closed.

**The faults, which only show up with two real accounts:**

- **`markRead` marked YOUR OWN messages read.** It ran
  `update messages set read = true` across the whole conversation with no
  sender filter, so opening your own chat turned your own ticks blue. It is
  `chat_mark_read()` now, and the test proves it touches exactly the other
  side's rows.
- **Unread was one integer on a row BOTH people share.** Whoever read the
  chat cleared it for both. Unread is derived per viewer from
  `conversation_prefs.last_read_at`.
- **`addMessageLocal` incremented unread for your own sends**, so sending a
  message made the chat unread and put your own words on the tab badge.
- **Any participant could `UPDATE` any message in the conversation** —
  an edit button on the other person's words. Update is sender-only;
  receipts go through an RPC.
- **Voice notes stored the SENDER's `file://` path.** The recipient got a
  path to a file that does not exist on their phone, so every received voice
  note was silent. They upload now.
- **`reply_to` had no column.** The client model carried it and the INSERT
  dropped it, so a reply quote existed only on the device that sent it.
- **`messages_has_content` was `text OR audio_uri`** — it predates media, so
  a photo with no caption was rejected outright.
- **The chat screen's back button called `onBack()` AND `router.back()`.**
  Rendered inline inside the Messages tab that popped the tab off the stack,
  so closing a chat navigated out of Messages entirely.
- **The tab never fetched anything.** The list came from the persisted cache
  plus whatever realtime happened to deliver, and pull-to-refresh was
  `await new Promise(r => setTimeout(r, 700))` — a spinner that fetched
  nothing. On a fresh install the inbox was empty forever.
- **"typing…" fired for your OWN typing.** `setTyping` wrote into
  `typingUsers[conversationId]` and the same screen read it back.

**Built this session:**

| Feature | Where |
|---|---|
| Starred messages | `chat_toggle_star` / `chat_list_starred`, `app/chat/starred.tsx` |
| Media, links and docs gallery | `chat_conversation_media`, `app/chat/media.tsx` |
| Mute (8h / 1 week / always) | `conversation_prefs.muted_until`; the realtime handler checks it before it notifies |
| Wallpaper picker | `components/chat/wallpapers.ts`, `ChatWallpaper`, `app/chat/wallpaper.tsx` — per chat or app-wide |
| Forward | `chat_forward` fans out server-side and stamps `forwarded` |
| Delete for everyone | sender-only, 2-day window, leaves a tombstone |
| Delete for me | `message_hides`, one-sided |
| Edit | sender-only, 15 minutes, text only |
| Photos, videos, documents | `expo-image-picker` + `expo-document-picker` → private `chat-media` bucket |
| Voice notes that the other side can hear | uploaded, played through a signed URL |
| Pin / archive / mark unread / clear chat | swipe actions on the row, and the in-chat menu |
| Selection mode | multi-select → copy, forward, delete |
| In-chat search | find bar with `3/12` and up/down |
| Reply-quote jump | tap a quote, it scrolls and flashes |
| Unread divider, scroll-to-latest, delivery receipts, presence, real typing | `ChatScreen` |

**The database:** `migration_chat_features.sql`, applied.
`supabase/tests/test_chat_features.sql` — **40/40**, run as two real users
under RLS inside a rolled-back transaction. It proves unread is per viewer,
mute/pin/wallpaper/star are one-sided, delete-for-me hides for one person
only, delete-for-everyone is sender-only and time-boxed, and that a raw
`UPDATE` on the other side's message is refused.

**`chat-media` is a PRIVATE bucket**, unlike `post-media`. A post is
published; a chat is not. Every object is reached through a signed URL, so
**`message.media_url` holds a storage PATH, not a URL** — anything rendering
it must go through `resolveMediaUrl` / `useSignedMedia`.

**Still to verify on device:** two real accounts, on real hardware. The
database is proven and the bundle builds (31.2 MB dev, HTTP 200); the React
layer has not been driven by a human.

### 2. Referral UI
The data layer is done and tested. Still needed: the invite screen (code,
stats, share buttons, invite list) and the rendered share card. A card image
needs `react-native-view-shot` + `expo-sharing` — **verify both work in
Expo Go on SDK 54 before designing around them.** Text-only share works today
with zero new dependencies.

### 3. Cross-app polish
- HugeIcons on the message tab and the For You tab.
- Pull-to-refresh on every scrollable screen, spinner **below** the header,
  never behind it. `useCollapsibleScroll().scrollProps` and
  `HEADER_CONTENT_GAP` already exist for this — audit which screens skipped
  them rather than adding a fourth mechanism.
- Header ↔ content spacing audit.

### 4. Still open from earlier
- `constants/devFlags.ts` — `ALLOW_UNVERIFIED_PAYOUT_ACCOUNT` is `true`.
  **Must be `false` before release.**
- `v_active_park_trips` is still a SECURITY DEFINER view (advisor ERROR).
- `auth_leaked_password_protection` is off — one toggle in the dashboard.
- Chat and feed have never been tested between two real accounts on real
  hardware. The databases are proven; the React layer is not. For chat this is
  now the ONLY thing left on it.

---

## How to start the next session

> Read `STATUS.md`, then `HANDOFF.md`. The chat is done and tested against
> the database — what it has never had is two people on two phones. Sign in
> on two devices and check, in this order: does a message arrive without a
> refresh; do the ticks go grey → double → blue on the SENDER's side only
> when the other person opens it; does muting actually silence the push; does
> a photo sent by one side render on the other (that is the signed-URL path,
> the most likely thing to be wrong); does a voice note play on the receiving
> phone. Then move to the referral UI (§2).
