# EMILGO — Keys, accounts and manual setup

Everything in this app that needs **you**, not code, before the feature is fully
effective. Grouped by whether it blocks going live, degrades a feature, or is
optional.

Read alongside [HANDOFF.md](HANDOFF.md) (working state + remaining tasks) and
[PRD.md](PRD.md) (what the product is).

Last verified against the codebase: **2026-08-15**.

---

## 0. How to read this

Every row names the exact env var the code reads, the file that reads it, and
**what actually happens when it is missing** — because in this codebase, missing
almost never means "crash". Most of these degrade to a mock or a fallback, which
is convenient in development and dangerous at launch: the feature looks like it
works.

| Status | Meaning |
| --- | --- |
| 🔴 **Blocks launch** | Real money, real identity, or the app is unusable without it |
| 🟠 **Degrades** | Feature runs on a mock or a fallback path; looks fine, isn't real |
| 🟢 **Optional** | Genuinely fine to leave unset |

---

## 1. 🔴 Blocks launch

### 1.1 Paystack — currently on TEST keys

| Var | Where | Now |
| --- | --- | --- |
| `EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY` | `src/services/paystack.ts` | `pk_test_…` |
| `PAYSTACK_SECRET_KEY` | `server/` | `sk_test_…` |

**Both keys in `.env` are test keys.** Every payment in the app today is a
sandbox transaction: cards are fake, no money moves, and settlements never
arrive. The QR half-fare flow, the ₦100 driver bonus and fuel-coin accrual all
run end to end against test money, so they will look correct in QA and move
nothing in production.

**What you must do**

1. Complete Paystack business verification (CAC document, bank account, BVN of a
   director). This is a review process, not instant — start it before you need it.
2. Once approved, take the **live** keys from Paystack → Settings → API Keys.
3. Put `sk_live_…` **server-side only**. It must never reach the bundle: anything
   prefixed `EXPO_PUBLIC_` is compiled into the app and readable by anyone who
   downloads it.
4. Set up the Paystack webhook to your server so payment confirmation does not
   depend on the phone staying online.

> **Security note.** `PAYSTACK_SECRET_KEY` currently sits in the same `.env` the
> Expo app loads. It is only read by `server/`, so it is not bundled today, but
> the moment someone adds `EXPO_PUBLIC_` to it by accident it ships to every
> device. Consider splitting into `.env` (app) and `.env.server` (server).

#### Payout accounts are blocked until Paystack is live

A driver cannot receive a fare until they have added a payout bank account, and
adding one calls Paystack's account-resolution endpoint to name-check the NUBAN.
That needs a live secret key on the server. So **until Paystack verification
completes, no driver can add a payout account, and scan-to-pay cannot be tested
end to end.**

Two things used to hide this. `resolveBankAccount` invented an account name from
a list of five made-up Nigerians whenever no server was configured, so the screen
looked like it worked; that is deleted. It now returns unresolved with a reason.

To test the flow before Paystack is live, set the flag in
**`constants/devFlags.ts`**:

```ts
export const ALLOW_UNVERIFIED_PAYOUT_ACCOUNT = true;   // testing
export const ALLOW_UNVERIFIED_PAYOUT_ACCOUNT = false;  // production  ← default
```

Reload the app afterwards (`r` in the Metro terminal). With it on, the driver
types the account name themselves, the Verify step disappears, and the screen
carries a permanent orange **TEST MODE** banner so an unverified account is never
mistaken for a verified one. It does **not** move money — Paystack still rejects
an account number that does not exist.

`assertProductionFlags()` throws at startup in a production build if any flag is
left on, so this cannot ship by accident.

### 1.2 Smile Identity (KYC) — currently MOCK

| Var | Where | Now |
| --- | --- | --- |
| `SMILE_PARTNER_ID` | `server/kyc.ts` | unset |
| `SMILE_API_KEY` | `server/kyc.ts` | unset |

`server/kyc.ts` logs *"No SMILE_PARTNER_ID/SMILE_API_KEY set — running in MOCK
mode"* and approves identities without checking anything. The OTP in mock mode is
the fixed string `123456` (`src/services/kyc.ts`, `DEV_OTP_CODE`).

This gates the loyalty/partner programme and payout eligibility, so in mock mode
**anyone can become a verified partner and attach a payout account.**

**What you must do**

1. Register at Smile Identity, get a partner ID and API key for the Nigeria
   NIN/BVN products.
2. Set both **server-side**.
3. Replace the mock bodies in `server/kyc.ts` (interfaces already match the live
   provider, so no UI changes are needed).
4. Move `IDENTITY_SALT` in `src/services/kyc.ts` out of the source file and into
   a server secret. It is currently a committed constant, which weakens the
   "one identity per account" hash it exists to protect.

### 1.3 Expo push notifications — needs a project ID and credentials

`src/services/notifications.ts:59` calls `getExpoPushTokenAsync()` **without a
`projectId`**. In Expo Go that resolves; in a dev or production build it can fail
to obtain a token, so push silently never arrives.

`app.json` already carries `extra.eas.projectId =
492934f4-8a6b-45de-9399-4d6687854411`, owner `stainles`.

**What you must do**

1. Pass the project ID explicitly:
   `getExpoPushTokenAsync({ projectId })`, read from
   `Constants.expoConfig.extra.eas.projectId`.
2. **iOS:** an Apple Developer account (99 USD/yr) and an APNs key uploaded to
   EAS. This is the same blocker as the dev build (see §4).
3. **Android:** an FCM server key in the Expo/EAS dashboard.

Until then push is dead in any build that is not Expo Go, and the
`/api/webhooks/scan-success` route that sends "your fare was paid" pushes has
nothing to deliver to.

---

### 1.4 🔴 Supabase email template — the OTP code must be IN it

Registration now verifies the email **before** the account is usable
(`src/services/emailVerification.ts`): Supabase mails a 6-digit code, the code
is exchanged for a session, and only then are the password and profile set.

**Supabase's default "Magic Link" template contains a link and no code.** If you
do nothing, the mail still sends and the user stares at a screen asking for six
digits that are not in it.

**What you must do** — Supabase dashboard → Authentication → Emails → *Magic
Link*, and put `{{ .Token }}` in the body. Something like:

```html
<h2>Your EMILGO code</h2>
<p>Enter this code to finish setting up your account:</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:700">{{ .Token }}</p>
<p>It expires in an hour. If you didn't ask for it, ignore this email.</p>
```

Also worth setting, in Authentication → Providers → Email:

| Setting | Value | Why |
| --- | --- | --- |
| **Enable email provider** | on | the only sign-in method the app has |
| **Confirm email** | on | an unconfirmed address is a permanent account-takeover route |
| **Secure email change** | on | requires confirmation on BOTH addresses |
| **Leaked password protection** | on | one toggle; checks against HaveIBeenPwned |
| **OTP expiry** | 3600 or less | the client assumes an hour |

> **On the free tier Supabase's own SMTP is rate-limited to a handful of mails
> per hour.** That is fine for you testing and will not survive real signups —
> the second the app has users, point Authentication → SMTP Settings at a real
> sender (Resend, Postmark, SES). Until then, registration fails for the third
> person who tries it that hour, and the error looks like the app is broken.

---

## 2. 🟠 Degrades — feature runs, but on a fallback

### 2.1 Google Maps — route drawing

| Var | Where |
| --- | --- |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | `app/live-trip-code/[code].tsx:86` |

Unset. The screen already says so at line 1196: *"Add
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to enable route drawing."* Live trips still
track and show position; they just cannot draw the road-following polyline
between origin and destination.

**What you must do:** Google Cloud project → enable **Directions API** →
create an API key → **restrict it** by bundle ID (`com.teqil.app`) and to the
Directions API only. Billing must be enabled; there is a free monthly tier.

> **Not needed for finding nearby drivers or fuel.** Phase 7 shipped without any
> key: proximity search runs against your own `user_presence` rows exactly as
> Bolt does, and filling stations come from **Overpass** (OpenStreetMap), which
> is free, keyless and needs no billing account. Verified against Lagos — 17
> stations within 5 km. Directions is the *only* thing this key buys.

### 2.2 Feedback — no channel configured

| Var | Where |
| --- | --- |
| `EXPO_PUBLIC_FEEDBACK_ENDPOINT` | `src/services/feedback.ts:18` |
| `EXPO_PUBLIC_FEEDBACK_EMAIL` | `src/services/feedback.ts:19` |

Neither is set, so "Send Feedback" returns the error *"No feedback channel is
configured"* (line 108). Set **either**: an endpoint you own that accepts the
JSON payload, or an address, which falls back to the device mail composer.

### 2.3 Rate the app — store links dead

| Var | Where |
| --- | --- |
| `EXPO_PUBLIC_APP_STORE_ID` | `components/ios/RatingModal.tsx:55` |
| `EXPO_PUBLIC_ANDROID_PACKAGE` | `components/ios/RatingModal.tsx:56` |

Unset until the apps exist in the stores. `EXPO_PUBLIC_ANDROID_PACKAGE` you can
set today — it is `com.teqil.app`. `EXPO_PUBLIC_APP_STORE_ID` is the numeric ID
App Store Connect assigns after you create the app record.

### 2.4 Scan-success webhook

| Var | Where |
| --- | --- |
| `EXPO_PUBLIC_WEBHOOK_URL` | `app/(passenger)/verify-driver.tsx:137` |

Falls back to `http://localhost:5001/api/webhooks/scan-success`, which only
resolves on the machine running the server. On a real phone the call fails and
the driver never gets the "you were scanned" push. Point it at your deployed
server before any real-device testing.

### 2.5a `EXPO_PUBLIC_GAMES_SERVER` — online rounds in the Game tab

| Var | Where |
| --- | --- |
| `EXPO_PUBLIC_GAMES_SERVER` | `app/games/redlight.tsx` → passed to the game |

Unset, the game's **Online** button says "soon" and practice works offline.
Must be a **`wss://`** address (the game page runs on an https origin inside the
WebView; `ws://` is blocked). Needs the EMILGO Games server deployed somewhere
public with TLS — see `games/emilgo-games/README.md` §4. For device testing on your
Wi-Fi: `cloudflared tunnel --url http://localhost:8787`.

### 2.5 `EXPO_PUBLIC_DOMAIN` — remote testers

Set, but note the constraint already in CLAUDE.md: a LAN-only value works only on
the local network. For remote testers use `npm run expo:remote`, which opens
Cloudflare tunnels for both Metro and the API (`brew install cloudflared`).

---

## 3. 🟢 Optional / development-only

| Var | Effect |
| --- | --- |
| `EXPO_PUBLIC_DEV_PREMIUM_TIER` | Forces a premium tier locally. **Remove before release** — it lets a build grant itself paid status. |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` | Read by `services/*` (the microservices split). Not needed while the app talks to Supabase directly. If you ever set the service-role key, it is **full admin, bypasses all RLS** — server-side only, never in `EXPO_PUBLIC_`. |
| `EXPO_PUBLIC_API_URL`, `PORT`, `REPLIT_*` | Already set / infrastructure. |

---

## 4. Not a key — but it blocks the same things

### 4.1 Apple provisioning → the dev build

The app is on branch `sdk-54-temp`, a deliberate downgrade from SDK 57 so it runs
in **Expo Go** on a real iPhone while Apple provisioning is outstanding.

**Consequences today**

- No iOS 26 Liquid Glass. `expo-glass-effect` needs a dev build, so every glass
  surface renders on the `expo-blur` fallback path. The design is correct; it is
  simply not the real material.
- Push notifications cannot be fully tested (§1.3).

**What you must do:** enrol in the Apple Developer Program, then `eas build`.
Return to SDK 57 with `git checkout main && npm install`.

### 4.2 WhatsApp linking + two-way sync — cannot be done in app code alone

Requested, and worth being explicit about: **there is no way to read or send a
user's personal WhatsApp messages from an app.** WhatsApp has no client API, and
messages are end-to-end encrypted. What is achievable is the **WhatsApp Business
Platform (Cloud API)**, which is a different thing:

- You register a **business phone number** — messages come from EMILGO, not from
  the driver's own WhatsApp.
- Business-initiated messages must use **pre-approved templates**; free-form
  replies are only allowed inside a 24-hour customer service window.
- It is **metered per conversation**, so it is a running cost, not a one-off key.
- Sync requires a **public webhook endpoint** on your server to receive inbound
  messages — it cannot work phone-to-phone.

**What you must do if you want it**

1. Meta Business account + verified business.
2. WhatsApp Business Platform app → phone number → permanent access token.
3. Submit message templates for approval.
4. Host a webhook (`server/`) for inbound messages and wire it into
   `useMessagesStore`.

A far cheaper 80% of the value, with **no keys and no approval**: a "Continue on
WhatsApp" button using the `whatsapp://send?phone=…` deep link. It hands the
conversation off to WhatsApp; it does not sync back. Recommended first step.

### 4.3 Duplicate `DATABASE_URL`

`.env` defines `DATABASE_URL` **twice** (lines 5 and 11). The later one wins,
silently. Delete whichever is stale before it causes a confusing incident.

---

### 4.4 Ad inventory — the feature is built, the shelf is empty

`serve_feed_ads` and `next_ad` run a real auction over `public.ad_creatives`:
role targeting, weighting, per-creative frequency caps, partner budgets,
cooldowns and impression/click/dismiss events in `ad_events`. It is finished,
applied and covered by 27 passing tests.

It returns **nothing**, because that table has no rows. The feed shows no
promoted units and "Watch & earn" says there are no ads right now. Both are
correct.

Nothing was seeded on purpose: a fake advertiser in a production feed is
indistinguishable from a real one to a user, and the click-through would go
somewhere nobody agreed to.

**Two ways to fill it, and most apps run both:**

**a) Direct partners.** You sell a slot; you keep all of it. Needs a sales
motion. Enter them in-app: Settings → Ads → **Ad console**. Admin only, and the
flag can only be granted server-side —

```sql
UPDATE public.users SET is_admin = true WHERE username = '<you>';
```

Add a partner (name, CPM in naira per 1,000 impressions, budget), then an ad
against it. Serving stops automatically once spend reaches the budget.

**b) An ad network** — Google AdMob or Meta Audience Network. Inventory fills
instantly with no sales effort, but the network takes a cut, chooses the
creative, and needs an approved account plus native SDK configuration (a config
plugin and a rebuild — it will not work in Expo Go). This is the realistic
answer at scale, and it is additive: a network ad is just another row whose
media comes from an SDK.

**⚠️ Whichever you choose, read §4.6 first.** The reward defaults pay out more
than an ad currently earns.

### 4.5 Phone numbers — consented disclosure now, masking later

`get_contact_phone` hands over one number at a time, only between two people who
already share a conversation, only while the owner allows it, and never across a
block. That is the honest interim and it needs no key.

**Number masking** — a proxy that connects both parties without either seeing the
other's number — is the better answer and is what Bolt and Uber use. It needs a
telco account, a provisioned pool of numbers and per-minute billing, so it is a
business decision rather than a code one. Until then a driver's real number is
disclosed to passengers they are chatting with, which they consent to via the
switch in Account Settings → Phone number.

### 4.6 ⚠️ Rewarded-ad payouts are a growth subsidy, not a revenue share

**Read this before launching the rewards feature.** Rewarded-video eCPM in
Nigeria runs about **$0.50–$2.00 per 1,000 impressions** — at ₦1,500/$ that is
**₦0.75–₦3.00 of gross revenue per ad watched.**

The seeded defaults pay **₦8.00 per rewarded ad** plus a daily ladder worth
₦110 for a full clear. At those numbers every ad watched **costs ₦5–7 more than
it earns**, and 10,000 daily active users clearing the quota burns roughly
**₦2–3.5 million per month**.

That may well be the right call for launch — paying users to form a habit is a
normal acquisition cost, and it is cheaper than most referral schemes. But it
must be a decision, not an accident.

Nothing in the app hard-codes a reward. Every value is one row:

```sql
SELECT * FROM public.ad_reward_config;

UPDATE public.ad_reward_config
   SET rewarded_credits = 2.00,          -- at/below real eCPM
       daily_milestones = '[{"at":1,"naira":2,"label":"First watch"},
                            {"at":5,"naira":10,"label":"Daily goal"}]'::JSONB,
       max_ads_per_day  = 12;
```

Changes take effect on the next screen load — no deploy, no app update. Watch
`ad_sessions` and `ad_events` for the real completion and click rates before
settling on numbers.

### 4.7 🔴 AdMob — WHAT YOU MUST DO FOR ADS TO SHOW

The SDK is integrated, initialised at launch, preloaded, and wired into the
rewards player. It is currently pointed at **Google's official TEST ad units**,
which serve real test ads so the whole flow can be exercised before any account
exists. Test ads earn **nothing**.

Everything below is on you. None of it can be done from code.

**Step 1 — Create an AdMob account** (~10 min, needs a Google account)
  1. Go to https://admob.google.com and sign up.
  2. Add your payment profile and your Nigerian bank details. Google pays by
     wire once you pass the $100 threshold, and will not serve paid ads until a
     payment profile exists.

**Step 2 — Register the app** (~5 min)
  3. Apps → Add app. Choose "No, it is not on a store yet" for now; register it
     properly once it is live on the App Store and Play, because the store
     listing is what unlocks better fill.
  4. Do this TWICE — iOS and Android are separate apps in AdMob with separate
     IDs. Copy both **App IDs**; they look like `ca-app-pub-1234…~5678…` (note
     the tilde).

**Step 3 — Create ad units** (~5 min)
  5. For each app: Ad units → Add ad unit → **Rewarded**. Name it
     `emilgo-rewarded`. Copy the **Ad unit ID** — `ca-app-pub-1234…/9876…`
     (a slash, not a tilde). These are different from App IDs; mixing them up
     is the single most common cause of "ads never load".
  6. Optionally add an **Interstitial** unit the same way.

**Step 4 — Put them in the app**
  7. `app.json` → `plugins` → `react-native-google-mobile-ads`: replace
     `androidAppId` and `iosAppId` with your two App IDs.
  8. `.env` — these are public identifiers, so `EXPO_PUBLIC_` is correct here in
     a way it is never correct for a secret:

     ```
     EXPO_PUBLIC_ADMOB_IOS_REWARDED=ca-app-pub-…/…
     EXPO_PUBLIC_ADMOB_ANDROID_REWARDED=ca-app-pub-…/…
     EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL=ca-app-pub-…/…
     EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL=ca-app-pub-…/…
     ```

**Step 5 — Build a dev client. THIS IS NOT OPTIONAL.**
  9. AdMob is a native module. **It does not exist in Expo Go**, and the app is
     written to detect that and skip the network rather than crash — so in Expo
     Go you will see "no ads right now" forever, no matter what you configure.

     ```bash
     npx expo prebuild --clean
     npx eas build --profile development --platform ios
     ```

     This needs the Apple Developer Program membership already tracked in §4.1.

**Step 6 — `app-ads.txt`** (skippable at first, costs you money if skipped)
  10. AdMob → Apps → app-ads.txt. Publish the line it gives you at
      `https://<your-domain>/app-ads.txt`. Without it many buyers will not bid,
      and your eCPM is materially lower. It needs the domain listed on your
      store page.

**Step 7 — Wait for review.** New AdMob accounts sit in review, typically a few
days. Until then real units return no-fill and the app falls back to the empty
state, which is correct.

**⚠️ Never tap your own live ads.** Google treats it as click fraud and bans the
account, and there is effectively no appeal. This is why the code defaults to
test units — see `isUsingTestUnits()` in `src/services/admob.ts`.

#### What about Meta, and the others?

**Correction to an earlier note in this file:** it previously said Meta Audience
Network "has not accepted new publishers in many markets since 2022." That is
wrong. Meta Audience Network is open and actively taking publishers — ~37,000
of them. The real barriers are different ones, and they apply to you right now:

- The app must be **live in the App Store or Google Play**. EMILGO is not
  published yet, so Meta cannot be applied for today regardless of anything else.
- App **ownership verification** through a Meta Business account.
- Meta strongly prefers you arrive **through a mediation platform** rather than
  as a direct standalone integration.

That last point is the important one, and it changes the plan less than it
sounds. See §4.9.

### 4.8 Reddit in the feed (optional, free)

#### First — what RSS is, since it powers the feed today

RSS ("Really Simple Syndication") is a plain XML file that a publisher puts at a
fixed URL and updates whenever they publish. It lists recent articles: title,
link, summary, image, timestamp. Nothing more.

It matters here for three reasons. It needs **no key, no account and no
approval** — you fetch a URL like any web page. It is **explicitly meant to be
consumed** by other software, so using it is not scraping and breaches nobody's
terms. And essentially every news site still publishes one, usually at
`/feed`, `/rss` or `/feed.xml`, because it is what Google News and podcast apps
read.

That is why the For You feed has real outside content today while Twitter,
Instagram and Facebook remain impossible: the newsrooms *want* to be read this
way, and the social platforms have closed their doors. Four Nigerian newsrooms
are seeded and verified. To add another, find its feed URL and insert a row:

```sql
INSERT INTO public.feed_sources (kind, name, url, category, weight)
VALUES ('rss', 'Punch', 'https://punchng.com/feed/', 'news', 2);
```

The trade-off is that RSS gives you articles, not conversation — headlines and
summaries, no comments, no upvotes, no personalities. That is exactly the gap
Reddit fills.

#### Getting the Reddit client ID (about five minutes, free)

  1. Sign in to Reddit, then go to **https://www.reddit.com/prefs/apps**
     (or Reddit → Settings → Privacy & Security → "Manage third-party app
     authorization" → the developer link at the bottom).
  2. Scroll to the bottom and click **"are you a developer? create an app…"**
     (it reads "create another app…" if you already have one).
  3. Fill in the form:
     - **name**: `EMILGO Feed` — internal only, users never see it.
     - **type**: choose **script**. This is the important field. "script" is for
       a backend calling on its own behalf; "web app" would demand a real OAuth
       redirect flow you do not need.
     - **description**: optional.
     - **redirect uri**: `http://localhost` — required by the form, unused by
       this flow.
  4. Click **create app**.
  5. Read the two values off the resulting box. The layout is confusing and this
     is where people get it wrong:
     - The **client ID** is the short string *directly underneath the app name*,
       near the words "personal use script". It has no label. ~14 characters.
     - The **secret** is the longer string on the line labelled `secret`.
  6. Put both in `.env`:

     ```
     EXPO_PUBLIC_REDDIT_CLIENT_ID=…
     EXPO_PUBLIC_REDDIT_CLIENT_SECRET=…
     ```

  7. Add subreddits as sources (admin, in SQL for now):

     ```sql
     INSERT INTO public.feed_sources (kind, name, url, category, weight)
     VALUES ('reddit', 'r/Nigeria', 'Nigeria', 'community', 2);
     ```

The old keyless `reddit.com/r/x.json` endpoint now returns 403 to datacenter
traffic, which is why the OAuth app is required. Without both variables the
Reddit source is skipped silently — never faked.

**Twitter/X, Instagram and Facebook cannot be added.** X has had no free read
tier since 2023 (~$100/month minimum). Instagram and Facebook Graph return only
media on accounts you own and have connected — there is no "posts from
Instagram" endpoint for anyone. Scraping breaches their terms and gets the app's
IP ranges blocked. This is a platform limitation, not missing work.

### 4.9 Ad networks — the honest landscape

You asked for 10–20 of the highest-paying networks, and for Meta rather than
AdMob. Here is what is actually true, because the wrong answer here costs real
money.

#### The thing to understand first: you do not pick a network, you pick a mediation layer

Running one network means one buyer bidding on each impression, and it takes
whatever price it likes. **Mediation** runs an auction: ten networks bid on the
same impression and the highest wins. That is where the revenue difference
lives — typically **20–40% over a single network**, far more than the gap
between any two networks on this list.

So the target architecture is one SDK (a mediation layer) with many demand
sources behind it, configured in a dashboard. Not ten SDKs. Ten SDKs means ten
native dependencies, ten sets of ATT/consent plumbing, ten review risks and a
much bigger app — for less money than one auction.

Two credible mediation layers:

| | AdMob Mediation | AppLovin MAX |
| --- | --- | --- |
| Sign-up | Google account | Business e-mail, quicker review |
| App must be live in a store | Not to sign up | Not to sign up |
| iOS strength | Good | Strongest in the market |
| Nigerian payout | Wire, or Payoneer → naira | Wire / PayPal, $20 minimum, NET 30 |
| Bidders it can call | Meta, AppLovin, Unity, Mintegral, Liftoff, Pangle, InMobi, Chartboost, Vungle, ironSource… | the same list, plus AdMob |

**Recommendation, unchanged: start on AdMob, then turn on mediation.** Not
because AdMob pays best — AppLovin usually beats it on iOS — but because it is
the only one you can go live on unaided, from Nigeria, without a published app,
and it is already integrated and tested in this codebase. Switching the
mediation layer later is a dashboard change plus one SDK swap; it is not a
rewrite, because `src/services/admob.ts` deliberately keeps the network behind a
narrow interface.

#### The demand sources worth enabling, roughly best-paying first

Rewarded video, which is the format this app uses:

1. **AppLovin** — usually the highest bidder on iOS.
2. **Google AdMob / AdX** — deepest global fill, best in Tier-3 markets.
3. **Meta Audience Network** — high CPMs when it bids; needs a published app.
4. **Unity Ads** — strongest on gaming inventory.
5. **ironSource / LevelPlay** — now part of Unity; excellent reporting.
6. **Mintegral** — very competitive in Asia and increasingly in Africa.
7. **Liftoff Monetize** (formerly Vungle) — strong rewarded video.
8. **Pangle** (TikTok's network) — aggressive bidder, huge volume.
9. **InMobi** — good in India/Africa, one of the few with real Lagos demand.
10. **Chartboost**, **Fyber**, **Smaato**, **Tapjoy**, **Digital Turbine** —
    worth enabling as extra bidders once the first five are filling.

Enabling more bidders has diminishing returns after roughly the first six, and
each one adds latency to the auction. Six to eight is the practical sweet spot.

#### Where the money actually is: the country, not the network

This is the part that matters most for EMILGO, and no choice of network changes
it. Rewarded-video eCPM (revenue per 1,000 completed views), 2026:

| Tier | Markets | Rewarded eCPM |
| --- | --- | --- |
| Tier 1 | US, UK, Canada, Australia, Japan, Germany, Norway, Denmark, Switzerland, Sweden | **$15–40** |
| Tier 2 | UAE, Singapore, S. Korea, Italy, Spain, Poland | ~$5–12 |
| Tier 3 | **Nigeria**, India, Pakistan, Indonesia, Brazil | **$1.50–4** published; realistically **$0.50–2** for a non-gaming utility app |

Blog-published Tier-3 figures skew high because they average in gaming
inventory, which bids far above a transport app. Plan against the lower number.

**The consequence, stated plainly.** A Nigerian user watching one rewarded ad
earns you roughly **₦0.75–3.00 gross**. §4.6 already records that the app pays
**₦8.00** per ad. That gap is a deliberate growth subsidy, and it does not close
by finding a better network — a 40% mediation uplift on ₦2 is ₦2.80, still well
under ₦8. It closes by changing the payout, by earning on trips instead, or by
having Tier-1 users. There is no ad network that fixes it.

If you want Tier-1 ad revenue you need Tier-1 *users*. Ten highest-CPM markets
to target if you ever localise: US, Norway, Denmark, Switzerland, Australia,
Canada, UK, Germany, Sweden, Japan.

#### One thing to never do

Do not tap your own live ads, and do not ask friends to. Google and Meta both
detect it easily and ban the account permanently, usually withholding the
balance. This is why the code defaults to Google's **test** unit IDs
(`isUsingTestUnits()`), and why that default is correct rather than unfinished.

### 4.11 🎮 Lagos Life (Vatar) — EMILGO Games in the Lagos Life Games app

The game (`games/emilgo-games/`) is fully built and tested against a fake
Lagos Life platform. To go live it needs, **all server-side, never in any app
or game code**:

| Secret | Where it comes from | Server env |
| --- | --- | --- |
| Test secret `vtr_test_…` | `lagoslife.app/developers/keys` (shown once) | `VATAR_SECRET` |
| Results secret | shown with the keys | `VATAR_RESULTS_SECRET` |
| Webhook signing secret `vtr_whsec_test_…` | shown with the keys | `VATAR_WEBHOOK_SECRET` |
| Live versions of all three | after Lagos Life approves the game | same names |
| Ticket secret (32+ random chars) | you make it: `openssl rand -base64 48` | `TICKET_SECRET` |
| Moderator token (24+ random chars) | you make it | `ADMIN_TOKEN` |

Plus: a public HTTPS host for the game (Cloudflare Pages), a `wss://` host for
the game server with a persistent disk, the 6 products created in the
dashboard (ids/prices in `games/emilgo-games/listing/LISTING.md`), and two
approvals from Lagos Life — matches, then stakes. Step-by-step:
`games/emilgo-games/README.md` §6.

### 4.10 "Can users watch ads on their WhatsApp status and earn?"

Asked directly, so answered directly. There are two different ideas hiding in
this question. One is impossible; the other is not only possible, it is probably
worth more to you than the ad network.

**Impossible: earning ad revenue from ads shown inside WhatsApp.**
Meta launched ads in WhatsApp's Status/Updates tab in 2025, but Meta sells that
inventory and Meta keeps the money. There is no publisher programme, no SDK, and
no API that lets a third-party app place an ad in someone's status feed or
collect revenue from one. WhatsApp is also end-to-end encrypted and has no
plug-in model — no third-party code runs inside it, by design. Nothing about
this is a gap in our implementation.

**Possible, and genuinely good: users share EMILGO content to their status, and
you reward installs that come back.**
This is referral marketing, and it fits Nigerian WhatsApp behaviour better than
almost any other channel. It works like this:

1. Generate a per-user referral link (`teqil://r/<code>`, plus an
   `https://` fallback for people without the app).
2. Give the user a ready-made status image or 15-second video, rendered with
   their own referral code, and a "Share to WhatsApp Status" button —
   `whatsapp://send` is already wired in `src/services/whatsapp.ts`.
3. Attribute installs to the code and pay on a **real** event — a completed
   first trip — not on the install. Paying per install is what invites fraud.

Why this is worth more than the ad reward: a rewarded ad view in Nigeria is
worth ₦0.75–3.00 to you. A referred user who completes a trip is worth a fare
margin, and they arrived with a friend's endorsement. You can afford to pay far
more for the second thing, and it does not depend on any ad network's fill rate.

**Not built yet.** No referral table, no code generation, no attribution, no
share-card renderer. Flagging it as a real option, not claiming it exists.

---

## 5. Quick checklist

Copy into an issue and work down it.

- [ ] **Apply `supabase/migrations/migration_contact_phone.sql`** — nothing about
      calling a contact works until it lands
- [ ] **`constants/devFlags.ts` — every flag `false` before release**
- [ ] Paystack business verification → live keys, secret server-side only
- [ ] Paystack webhook endpoint deployed
- [ ] Smile Identity partner ID + API key; replace mock bodies in `server/kyc.ts`
- [ ] Move `IDENTITY_SALT` to a server secret
- [ ] Apple Developer Program → APNs key → EAS dev build
- [ ] FCM server key for Android push
- [ ] Pass `projectId` to `getExpoPushTokenAsync`
- [ ] Google Directions API key, restricted to `com.teqil.app`
- [ ] `EXPO_PUBLIC_WEBHOOK_URL` → deployed server
- [ ] Feedback endpoint **or** email
- [ ] `EXPO_PUBLIC_ANDROID_PACKAGE=com.teqil.app` (can do now)
- [ ] `EXPO_PUBLIC_APP_STORE_ID` after the App Store record exists
- [ ] Remove `EXPO_PUBLIC_DEV_PREMIUM_TIER` before release
- [ ] De-duplicate `DATABASE_URL`
- [ ] Decide on WhatsApp: deep link (free) vs Business Platform (metered)
- [ ] Turn on **leaked-password protection** in Supabase → Auth (one toggle)
- [ ] Insert real `ad_creatives` rows, or accept a feed and rewards screen with
      no ads (§4.4)
- [ ] **Decide the rewarded-ad payout rate before launch** — the defaults lose
      ₦5–7 per ad on purpose (§4.6)
- [ ] Apply `supabase/migrations/migration_ad_rewards.sql`
- [ ] Decide on number masking vs consented disclosure (§4.5)
- [ ] **EMILGO Games on Lagos Life** (§4.11): host the game + server, test keys,
      6 dashboard products, sandbox checklist, submit; then live keys and the
      matches + stakes approvals
- [ ] Harden the ~20 pre-existing functions with a mutable `search_path`, and the
      `SECURITY DEFINER` view `v_active_park_trips` — run Supabase's advisor and
      work the list (the Phase 6/7 functions are already done, see
      `migration_harden_definer.sql`)
