# EMILGO Games: the ad networks (SPEC-V6 2.14)

The owner asked: every ad platform already wired, and 20–30 networks that can
show ads on billboards nobody has booked, with how each is joined.

Checked 10 Nov 2026. Ad companies change their terms often: confirm a
network's current publisher page before signing up. Lines marked
**unconfirmed** are ones the public pages don't settle.

## The short answer

- **Unsold billboards can only be filled by an "intrinsic" in-game network**
  (ads drawn on a 3D board inside the world). Google, Meta and the ordinary
  web networks can't do this: their ads must run in their own code and frame,
  never copied onto a texture.
- **The one intrinsic network that reaches a JavaScript web game today is
  Anzu, through Playgama's Bridge SDK** (the first rollout covers Unity WebGL,
  Cocos and plain JavaScript). That is the first one to apply to.
- **Full-screen ads (before a store purchase) are already wired** for Google's
  H5 Games Ads. They start once the owner has an AdSense account and the H5
  Games Ads beta approves the site.
- **Lagos Life never shows any of this.** Agreement 4(g): no advertising
  there but `Vatar.purchase`. The game already enforces it.

## What's wired today

| Where | What | Status | What it needs from the owner |
|---|---|---|---|
| Billboards, booked | Brands book a numbered board for 1 or 2 weeks in the portal; their picture, slideshow or video goes on that board for those days (`server/src/ads.ts`, `src/net/ads.ts`, `src/world/billboards.ts`; migrations `migration_game_billboards*.sql`) | Built (v6 2.9) | The billboard migrations run in Supabase; `GAME_ADS_KEY` on the game server |
| Billboards, paying | Checkout for a booking: Flutterwave (the web first), Paystack, Stripe (`server/adBilling.ts`, EMILGO server) | Built; runs in MOCK mode until keys are set | `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_HASH`, `PAYSTACK_SECRET_KEY`, `AD_BILLING_KEY` (and Stripe's if wanted) |
| Billboards, unsold | House boards: our own modes, the Daily Run, ranks, the EMILGO app (no made-up brands) | Built | Nothing |
| Before a store purchase | Google H5 Games Ads (`adBreak`, type "next") when the page carries Google's tag; otherwise a 5-second house ad for the billboards (`src/ui/interstitial.ts`) | Built (v6 2.10); Google's part dormant | An AdSense account, the H5 Games Ads beta, then Google's tag in `index.html` (below) |
| The EMILGO app | AdMob rewarded ads ("Watch ads") with direct partners served first (`react-native-google-mobile-ads`; `migration_ad_network.sql`, `migration_ad_partners.sql`) | Built in the app; test IDs | An AdMob account and the app's real ad unit IDs (the app's SETUP-KEYS.md §6) |
| Lagos Life | Nothing: no paid boards, no ads before purchases | Enforced in the phone and the server | Nothing |

### Switching on Google's ads before a purchase

1. Open an AdSense account for the site's domain (play.emilgo.app, or the
   test site) and wait for approval.
2. Apply to the **H5 Games Ads** beta (AdSense help, "H5 Games Ads").
3. Add Google's tag to `index.html` (web build only, never the Lagos Life
   build): the `adsbygoogle.js?client=ca-pub-…` script plus the two lines that
   define `adBreak` and `adConfig` from Google's guide. The game finds
   `window.adBreak` by itself; nothing else changes.
4. **Google's rule to watch:** full-screen ads must not fire "after every user
   interaction". Each `adBreak` is only an offer (Google caps how often it
   actually shows one), but if Google's review objects, show the ad before
   every third purchase instead: one line in `src/game/session.ts`
   (`case "buy-boost"`).
5. In the EMILGO app's WebView, H5 Games Ads can serve AdMob ads on
   **Android only**. On iPhone the app should show its own AdMob interstitial
   before a purchase instead (the game already talks to the app through its
   bridge, `src/platform/emilgo.ts`; this would be one more message).

## Networks that can fill unsold billboards (intrinsic, in the 3D world)

How any of these plugs in: the network's SDK draws its ad into a texture, and
our board shows that texture where a house board would go (one more source in
`src/world/billboards.ts`, after booked ads and before house boards). The
network counts the views itself. No player data leaves the phone beyond what
its SDK needs; the profiling ban (Agreement 4(f)) applies only in Lagos Life,
where none of this runs.

| # | Network | Web game (JavaScript)? | How to join | Notes |
|---|---|---|---|---|
| 1 | **Anzu** (anzu.io) | **Yes, through Playgama's Bridge SDK** (Unity WebGL, Cocos, JavaScript) | Apply to Playgama or Anzu to be authorised for intrinsic ads; then the Bridge SDK | **First choice.** Brand ads (programmatic, from big buyers) on billboards. Also Unity, Unreal and custom engines natively |
| 2 | **Playgama** (playgama.com) | Yes (Bridge SDK) | Developer sign-up on Playgama; publish the game in its catalogue | The route to Anzu above; also full-screen and rewarded web ads, and distribution to many web-game portals |
| 3 | **Gadsme** (gadsme.com) | **Unconfirmed**: it has an SDK for non-Unity engines; ask whether it covers WebGL | Publisher sign-up on gadsme.com, then its SDK | Display and video on in-game boards |
| 4 | **Adverty** (adverty.com) | **Unconfirmed**: mobile and Unity first | Developer sign-up on adverty.com | "In-Play" ads; programmatic VAST video |
| 5 | **Frameplay** (frameplay.com) | **No** (its SDK v3: Windows, macOS, iOS, Android, PlayStation, Xbox) | Developer sign-up; Unity SDK | Only if the game is ever built natively |
| 6 | **Azerion** (azerion.com) | Through GameDistribution (below) | Contact sales | Owns many web games; sells in-game ad inventory to brands (it took over selling Bidstack's) |
| 7 | **Venatus** (venatus.com) | Web-game ad sales | Contact sales; traffic minimums | Sells in-game and web-game inventory (had exclusive access to Bidstack's in six markets) |
| 8 | **Bidstack** | **Unconfirmed status** | Contact | Its in-game inventory is sold through Azerion and Venatus; check it still takes new games |
| 9 | **Odeeo** (odeeo.io) | Unity (not web) | Developer sign-up | In-game **audio** ads (a radio playing in the world), not billboards |
| 10 | **Admix** | **Not recommended** | — | Moved to Web3; no longer an in-game ad network in practice |

## Networks for full-screen and rewarded ads (the web game)

These fill the ad before a store purchase (and could fill a rewarded "watch
for CP" offer, if the owner ever wants one). They never draw on billboards.

| # | Network | How to join | Notes |
|---|---|---|---|
| 11 | **Google H5 Games Ads** (Ad Placement API) | AdSense account → H5 Games Ads beta → the tag in `index.html` | **Already wired** (`adBreak`). Interstitials, rewarded, display and short video |
| 12 | **Google Ad Manager + IMA SDK** | An Ad Manager account; your own demand or Google's | Video ads with more control; a bigger setup than H5 Games Ads |
| 13 | **AppLixir** (applixir.com) | Self-serve sign-up; a JavaScript SDK | Rewarded video for web games |
| 14 | **AdinPlay** (adinplay.com) | Apply; traffic minimums for the managed service | Header bidding for HTML5 games |
| 15 | **Playwire** (playwire.com) | Apply; managed onboarding; traffic minimums | Full-service, higher rates at scale |
| 16 | **GameDistribution** (Azerion) | Upload the game to its catalogue; its SDK | Distribution plus ads; the developer gets about 50–70% of the ad money |
| 17 | **CrazyGames** (crazygames.com) | Submit the game; its SDK | Ads only when played on CrazyGames |
| 18 | **Poki** (poki.com) | Submit the game; selective | Ads only when played on Poki |
| 19 | **GameMonetize** (gamemonetize.com) | Upload the game; its SDK | Low barrier; lower rates |
| 20 | **Adsterra** (adsterra.com) | Self-serve | Banners and full-screen; quality varies: **never pop-unders**. Better for the portal pages than the game |
| 21 | **Media.net** (media.net) | Apply with the site | Contextual display for the portal and the site's pages, not inside the game |

## Networks for the EMILGO app (native, around the embedded game)

The app already runs AdMob. A mediation layer lets several networks bid for
the same slot, which raises fill in Nigeria.

| # | Network | How to join | Notes |
|---|---|---|---|
| 22 | **Google AdMob** | **Already in the app**; needs the owner's account and real unit IDs | Rewarded now; an interstitial before purchases on iPhone (see above) |
| 23 | **AppLovin MAX** (applovin.com) | Account; MAX SDK; add networks as "adapters" | Mediation: AdMob, Meta, Pangle, Mintegral, Liftoff and more bid together |
| 24 | **Unity LevelPlay** (ironSource) | Account; LevelPlay SDK | Mediation, the alternative to MAX |
| 25 | **Meta Audience Network** | Business account; **apps only, bidding only** (through MAX, LevelPlay or AdMob) | Doesn't serve the web game |
| 26 | **Pangle** (TikTok) | Account; through mediation | Apps only |
| 27 | **Mintegral** | Account; through mediation | Apps only; playable and video |
| 28 | **Liftoff Monetize** (Vungle) | Account; through mediation | Apps only; video |
| 29 | **InMobi** | Account; through mediation | Apps; strong in emerging markets |
| 30 | **Terragon** (terragongroup.com; Adrenaline, Twinpine) | Contact sales | Lagos-based mobile ad platform with African brands and telcos: a **direct** source of local advertisers, for the billboards too (as bookings) |

## Order to do it in

1. **Paid bookings first** (built): set the payment keys and run the
   billboard migrations, so local brands can book boards. Local brands pay the
   most and need no network.
2. **Anzu through Playgama** for the boards nobody books. About two days of
   our work once authorised: the Bridge SDK's texture on the house-board
   fallback, behind a switch, never in Lagos Life.
3. **AdSense and H5 Games Ads** for the ad before purchases (no code left).
4. **AppLovin MAX in the EMILGO app** when the app's audience grows; AdMob
   alone until then.
5. Gadsme and Adverty: ask about WebGL; add whichever confirms as a second
   billboard source.

## Rules that stay

- **Lagos Life:** no paid boards, no networks, no ads before purchases
  (Agreement 4(g)); only `Vatar.purchase`.
- **No player data for targeting** in Lagos Life (4(f)). Elsewhere, a network's
  SDK may collect what its terms say: the privacy page must name each network
  added, and players in the EU or the UK need a consent prompt (Google's own
  consent tool covers AdSense and AdMob).
- **No ads for gambling, betting or alcohol** on boards children can see:
  block those categories in each network's dashboard.

## Sources

- Anzu and Playgama: [GamesBeat](https://gamesbeat.com/playgama-and-anzu-bring-real-world-ads-to-web-games/), [PocketGamer.biz](https://www.pocketgamer.biz/anzu-partners-with-playgama-to-bring-intrinsic-in-game-ads-to-web-games)
- Anzu engines: [Unity partner news](https://anzu.io/news/anzu-becomes-first-in-game-advertising-platform-to-join-unitys-verified-solutions-partner-program)
- Gadsme non-Unity SDK: [AdExchanger](https://adexchanger.com/gaming/the-in-game-ad-market-is-expanding-one-sdk-at-a-time), [Gadsme publishers](https://www.gadsme.com/publishers)
- Frameplay platforms: [Unity Quick Start (SDK v3)](https://docs.frameplay.gg/unity/)
- Adverty: [developers](https://adverty.com/developers/)
- Bidstack, Azerion, Venatus: [Campaign Asia](https://www.campaignasia.com/article/adtech-platforms-bidstack-and-venatus-announce-in-game-advertising-partnership/490356), [Game Developer](https://gamedeveloper.com/press-release/bidstack-secures-a-landmark-two-year-commercial-deal-with-azerion), [Digiday](https://digiday.com/marketing/teaming-up-to-educate-the-market-a-conversation-with-two-in-game-advertising-ceos)
- Odeeo: [PocketGamer.biz](https://www.pocketgamer.biz/in-game-audio-advertising-platform-odeeo-secures-5-million-funding-round-for-global-expansion)
- Google H5 Games Ads: [AdSense help](https://support.google.com/adsense/answer/9959170), [policy](https://support.google.com/publisherpolicies/answer/11975916), [Ad Placement API](https://developers.google.com/ad-placement/apis)
- Web-game networks: [Playgama: choosing an ad network](https://playgama.com/blog/business-faqs/how-do-i-choose-an-ad-network/), [AppLixir: AdinPlay alternatives](https://www.applixir.com/adinplay-alternatives-for-web-game-developers-2026/)
- Terragon: [Nairametrics](https://nairametrics.com/terragon-raises-5-million-to-scale-data-and-marketing-technology-platform/)
