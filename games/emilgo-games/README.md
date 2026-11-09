# EMILGO Games

> **Picking this up in a new session? Read [HANDOFF.md](HANDOFF.md) first.**
> The owner's full spec: [SPEC-ORIGINAL.md](SPEC-ORIGINAL.md).

Nigerian street games, built to run **inside Lagos Life** (through the Vatar
Games SDK) and **inside the EMILGO app** (embedded, offline). One web codebase,
two hosts.

First game: **Red Light, Green Light** — a race down a closed-off Lagos street.
Waka while the sky sings; freeze when the song cuts; cross the line before the
clock runs out. (Since SPEC-V3 it is **Ball Haunt**, hidden behind
`FEATURES.ballHaunt`; the v3 games are Free For All and Dead Streets.)

> **Status (14 Oct 2026): all six phases built and tested locally.** Practice,
> online friendly rounds, Lagos Life matches with stakes, chat/emotes, the
> cosmetics shop, and the listing assets are done. **Nothing is deployed** and
> **nothing has run against the real Lagos Life platform yet** — Lagos Life was
> stood in for by a faithful fake (`server/scripts/mockvatar.ts`). What's left
> needs your accounts: see §6, "Shipping to Lagos Life".

---



## 1. Lagos Life rules this game must keep

Read from the primary sources on 13–14 Oct 2026: the docs
(`lagoslife.app/developers/docs`), the Developer Agreement v1.0 (effective
11 Oct 2026), the Terms, the sample game, and the SDK source itself
(`lagoslife.app/sdk/vatar-games-v1.js`). Where this list and those pages
disagree, **the pages win** — re-read them before shipping.

**Hosting and frame**

- The game is our own HTTPS site, framed by the world. Send
`Content-Security-Policy: frame-ancestors https://lagoslife.app https://www.lagoslife.app https://naijalife.app https://www.naijalife.app https://lagoslife.eliysites.com`
and never `X-Frame-Options: DENY/SAMEORIGIN`. (`public/_headers` does this.)
- Load the SDK from `https://lagoslife.app/sdk/vatar-games-v1.js` — never a copy.
- Frame sandbox: `allow-scripts allow-same-origin allow-pointer-lock allow-forms`,
`allow="autoplay; gamepad"`. **No camera, microphone, location, clipboard,
payment, popups, alerts, downloads, navigation of the parent. No fullscreen**.
- Third-party cookies may be blocked: identify players by session token and
`player.id`, never cookies. Storage is wrapped in try/catch.

**Review checklist (what gets us approved)** — and where each is met:

1. Integration checklist ticked (init, test purchase, server-verified purchase,
  delivery, test match with a server-posted result) → happens in the sandbox, §6.
2. Loads quickly in the frame on mobile data → ~176 KB, lobby in about 2 s on slow 4G (§7).
3. Plays at **375 × 812 portrait**, by touch, no hover-only controls → every screen checked at that size.
4. `onPause`/`onResume` handled; **sound only after the first tap** → tested (§7).
5. Every purchase checked and delivered by our server → `server/src/shop.ts`, tested.
6. Honest names and prices, ₦100–₦50,000, ≤ 20 products, no fake timers → 6 one-offs, `listing/LISTING.md`.
7. Listing: 512 px icon (PNG, not SVG), 3–5 screenshots, ≤ 120-char short description → `listing/`.
8. No outside payments, links or ads; **no logins or personal data** → the chat filter even removes numbers and links.
9. No gambling, real-money prizes or cash-out → stakes are game money through `Vatar.match` only.

**Identity and data (Agreement §8)**

- We get a per-game pseudonymous id (`t_…` test / `p_…` live), display name,
avatar and 15-minute session tokens. Nothing else.
- The server stores only purchase grants (purchase id, player id, product id,
test/live, timestamps) — needed to deliver what people paid for. Delete
`DATA_DIR` if the game is removed or Lagos Life asks (§8.2(e)).
- **Never link a Lagos Life player to anything else** — including an EMILGO
account. The EMILGO copy of the game has no SDK, no shop, no matches.
- Nigeria Data Protection Act 2023 applies. Report breaches within 72 hours.

**Rate limits (per player)**: `init`/`session` 10/min · `purchase` 1 per 3 s ·
`purchases` 20/min · `submitScore` **1 per 20 s** · `leaderboard` 12/min ·
`match.create`/`quick` 1 per 5 s · `join`/`leave` 1 per 3 s · messages ≤ 8 KB.
Per server: 600 API calls/min (our client budgets 540).

**Matches**

- **2–4 seats**. Stake 0 = friendly (no confirm sheet).
- Results come **only from our server**: `POST /matches/{id}/result` with
`{ winner: playerId | "draw" }`, `Authorization: Bearer <secret>`,
`X-Vatar-Timestamp` (±5 min) and `X-Vatar-Signature: v1=<hex>` = HMAC-SHA256
with the **results secret** over `POST\n<path>\n<ts>\n<nonce>\n<sha256(body)>`.
- Settled once; draw refunds everyone; 5% house cut; no result within 2 h of
start, or no fill within 15 min → all stakes refunded.
- Limits: ₦100,000 per match · ₦500,000 per player per day · ₦50,000,000 per
game per day · ₦50,000,000 per creator per day · same two players at most 10
staked matches per day per game.
- Matches need Vatar's approval, and stakes a **second** approval. Until then
`match.*` answers `not_available` (or `friendly_only`) — the game says so.
- Our share: 40% of the house cut, paid in game money, never from matches we play in.

**Money**: 70% of every purchase to us (net of refunds), monthly by the 15th
once the balance is ≥ ₦5,000. Sandbox purchases are free and never count.

**Branding (Agreement §11)**: we may say **"Available in Lagos Life"** with their
badges. We may **not** claim a partnership or endorsement without written
permission.

**SDK quirk**: the v1 script turns error codes outside its own table into
`"error"`. `not_available` is documented but not in that table, so the game
treats `"error"` from `match.*` as "matches aren't open yet".

## 2. What changed from the original brief, and why


| Brief said                                | Reality                                                              | What we did                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| "Kukalo Games"                            | You chose the EMILGO name                                            | Renamed everywhere                                                                |
| SDK at `lagoslife.app/vatar-games-v1.js`  | It's `/sdk/vatar-games-v1.js`                                        | Fixed                                                                             |
| Red Light, Green Light for 2–10 players   | Vatar matches are **2–4 seats**                                      | Lagos Life matches are 2–4; friendly rooms on our server go to 12                 |
| "Squid Game", its doll and its music      | Netflix's; Lagos Life requires we own everything (§3.3, §4(i))       | Original doll (**Mama Gele**) and **three original songs** you can choose between |
| Proximity + party voice chat              | The frame has **no microphone**                                      | Text chat + emotes                                                                |
| ₦50 replay viewer, ₦100 tournament ticket | Minimum price ₦100; paid entry for prizes is gambling-shaped (§4(a)) | Not built. The shop is cosmetics only                                             |
| React Native + R3F for the game           | Lagos Life frames **web pages**                                      | TypeScript + three.js, ~176 KB; EMILGO hosts the same build in a WebView          |
| Colyseus, Turso, GLB models               | Not needed                                                           | Own WebSocket server; built-in SQLite for purchases; procedural models            |
| Blood "highly epic"                       | Lagos Life is 18+; EMILGO isn't age-gated                            | Stylised blood, on by default in Lagos Life, off in EMILGO, a Settings toggle     |


Added beyond the brief: **hard mode** (below), lag-fair detection,
left-handed controls, battery saver, adaptive resolution, shader warm-up,
WebGL context-loss recovery, report/block, gold chat names. (The on-screen
signal words and the traffic lights were removed by SPEC-V2: the doll is the
only cue.)

## 3. How the game plays

> **SPEC-V3 Phase 11 (2 Nov 2026):** Mama is gone. The song comes from the sky,
> an eye in the sky opens when it cuts, and the sky laser strikes whoever
> moves. Where this section says "she", read "the eye"; the timings are the
> same. [SPEC-V3.md](SPEC-V3.md) wins where they differ.

> **The COD-style upgrade (Oct 2026)** — welcome poster, Call of Duty Mobile
> lobby, generated five-fingered characters, jump / crouch / prone / sprint,
> over-the-shoulder and first-person camera, Low/Medium/High graphics, 24 maps
> with weather and time of day, the winner's circle and squad room — is
> documented in **[UPGRADE.md](UPGRADE.md)**: decisions, what each reference
> image became, what was measured, and what wasn't built and why. The finalized
> spec (modes, distances, balls, the hum, the Desert Field…) is
> **[SPEC-V2.md](SPEC-V2.md)**, which wins where they differ.

- **Classic Run or Ball Haunting, 100 / 200 / 300 m** (45 / 80 / 120 s). Walk
2, run 6, sprint 9 m/s. Ball Haunting: carry one of the balls (one fewer than
players… 13 for 20) over the line; fist, slap or push someone within 2 m to
knock theirs loose. Running into people is only ever a bump.
- **The warning hum, and its lies.** Before every turn Mama hums for 3 s under
the song. **About a third of her hums are fake**: she sings on and doesn't
turn, and whoever froze loses time. She cuts the song anywhere — 0.7 s in or
deep into the second verse. Her turn takes 0.35–0.55 s; movement counts 0.2 s
after she faces you.
- **Nothing gives the bluff away** — not by ear, not on screen, not on the
wire: the server never sends how long a song or stare will last, nor whether a
hum is real (a hum is always 3 s; what follows is decided when it ends).
- **One song** (since SPEC-V2 Phase 4): the doll sings the traditional Korean
playground call *Mugunghwa kkochi pieotseumnida*, synthesised in her own
voice — never the show's recording or melody. The referee's timing doesn't
depend on it.
- Balance (sim, 400 rounds): a player who reacts in 0.35 s to her turn crosses
97% of the time; 0.45 s → 25%; 0.60 s → never. Walking all the way → timed out.



## 4. Architecture

```
games/emilgo-games/
  index.html             boot splash + async Vatar SDK tag (stripped from the EMILGO build)
  public/_headers        frame-ancestors + caching for Cloudflare Pages / Netlify
  vite.config.ts         two builds: dist/ (Lagos Life site), dist-emilgo/ (one HTML file)
  scripts/embed.mjs      dist-emilgo → src/games/emilgo-games/redlightHtml.generated.ts (app)
  scripts/sim.ts         balance check · scripts/filter-test.ts chat filter cases
  listing/               icon-512.png, screenshots/, LISTING.md (descriptions + product table)
  src/
    config.ts            every gameplay number (RULES, NET) — read by client AND server
    game/rules.ts        THE REFEREE: pure, seeded, fixed-step. The server runs this file
    game/balls.ts        Ball Haunting's balls and baskets · game/combat.ts fist, slap, push, shoves
    game/bots.ts         practice CPUs (reaction-time personalities; fooled by fake hums; fight only for a ball)
    game/session.ts      everything wired together: rounds, online, matches, shop, social
    audio/songs.ts       the Mugunghwa chant as note data · audio/sound.ts the synthesiser
    world/human/*        generated people: wardrobe (+ match suit), skeleton, mesh (4 detail levels), painter, normal maps, animator, ground solver
    flow/*               the match flow, for every game: machine (stages), waitingRoom (the circle),
                         cinema (camera shots), walkout (tunnel walk + skip), countdown (5 → 1), tutorial (player)
    rlgl/*               Red Light, Green Light's own flow parts: shots (field preview), tutorial (the script)
    world/lobbyStage.ts  the lobby set, the waiting room's circle and winner's circle (with background blur)
    world/*              original street, doll, crowd (one Human each, distance LOD), fx, camera, tex, tunnel (walkout)
    maps/*               24 maps: registry (5 sky states), kit, recipes, desert (the Desert Field's props),
                         world (light, fog, LOD, shadow casters), sky (2D or volumetric clouds), weather (rain),
                         potholes (puddles, splashes, the High mirror), birds
    graphics/*           tiers (Low/Medium/High/Auto), post (High: bloom, grade, vignette)
    net/*                protocol (shared), client (reconnect + clock), onlineRound (predict/interp)
    platform/*           hosts: lagoslife (SDK), emilgo (RN bridge), web; mockVatar (dev only)
    shop/catalog.ts      products (ids/prices = dashboard) · shop/client.ts buy/claim/restore
    social/*             chat filter (EN/Pidgin/Yoruba/Igbo/Hausa + numbers/links), emotes
    ui/*                 HUD + minimap, every screen, chat, emote wheel, icons (SVG), fonts, welcome.webp
  server/
    src/index.ts         HTTP (/health, /metrics, /shop/*, /vatar-webhook, /reports) + WebSocket
    src/lobby.ts         quick match, private codes, Lagos Life match rooms
    src/room.ts          one room: waiting (ready marks) → 2 s loading → playing (walkout, countdown, round) → ended
    src/vatar.ts         the Lagos Life API: sessions, matches, SIGNED results, purchases
    src/shop.ts          claim → verify → grant once → deliver; signed look tickets
    src/store.ts         who owns what (SQLite; swap for Postgres when running many processes)
    scripts/             loadtest, fairness, matchtest, ballstest, shoptest, socialtest, rulestest, apicheck, mockvatar
    Dockerfile           the server as a container (docker-compose.yml runs it)
  dev/                   dev-only pages and tools (never in a build): cdp.mjs (headless Chrome
                         driver for screenshots and timing), humans.html (character line-ups),
                         poster.html (renders src/ui/welcome.webp)
```

**Hosts** — **lagoslife**: framed + `Vatar.init()` answers; leaderboard, matches,
shop. **emilgo**: injected by `app/games/redlight.tsx`; practice + friendly
online only. **web**: dev and direct links; practice + friendly online.

**Online** — the phone sends only its stick and its buttons (sprint, stance, a jump counter); the server's referee decides
positions and catches; snapshots 15×/s (~5 KB/s a player) plus instant events.
Your runner is predicted with the referee's own code; others are drawn 120 ms
behind. **Lag compensation**: the server adds your measured round trip (≤ 350 ms)
to your grace — faking lag buys nothing, it delays your own view by the same
amount. Dropped connection: you freeze, reconnect and resume the same seat (20 s).
No bots online, ever.

**Lagos Life matches** — players create/join/quick-**match through** `Vatar.match`
**(stakes confirmed on Lagos Life's own sheet). When the match is** `playing`**, each
phone asks our server to play it, proving who it is with a fresh session token;
the server verifies it with Lagos Life, checks the player is in that match,
and seats them by their Lagos Life id (a reload comes back to the same runner).**
First across wins; nobody across, or a dead heat, is a draw. The server signs
and posts the result; Lagos Life settles the money.

**Shop** — `Vatar.purchase` → the world's pay sheet → our server checks the
purchase with Lagos Life (paid? ours? this player's? a product we sell?),
grants it **once per purchaseId** (database primary key), marks it delivered.
Restores anything paid-but-undelivered on every boot; the `purchase.paid`
webhook does the same without the phone. Online, others see your outfit only if
a server-signed ticket says you own it. Pack emotes are only relayed from owners.

**Social** — chat in waiting rooms, on results and while spectating (never
mid-run). Server-side filter on every line; mute (just you), block (both ways,
and no quick-matching together), report (the reported player's last five lines
are kept as evidence; moderators read them at `GET /reports`). Emotes any time —
they move arms, never feet, so emoting while she watches is safe.

## Showing and hiding a mode

There are two kill switches. Use the live one when something is wrong right now.

### The live switch: no rebuild, every phone hears at once

From `games/emilgo-games`, with the `ADMIN_TOKEN` you gave `fly secrets set`:

```bash
node scripts/modes.mjs list
ADMIN_TOKEN=... node scripts/modes.mjs off hustle lights-out   # those modes
ADMIN_TOKEN=... node scripts/modes.mjs off survival            # a whole game: ffa, survival, rlgl
ADMIN_TOKEN=... node scripts/modes.mjs on hustle
ADMIN_TOKEN=... node scripts/modes.mjs clear                   # everything back on
```

It lasts across server restarts. Matches already running play out; a staked
Lagos Life match that has started is always allowed to finish, because the
players' stakes are held. With several nodes, run it once per node
(`SERVER=https://...`).

### The code switch: for good, needs a rebuild

Open `src/config.ts`. `MODE_SWITCH` has one line per mode; `FEATURES` has one
line per game. Change `true` to `false`:

```ts
export const MODE_SWITCH = {
  ffa: {
    "find-the-flag": true,
    hustle: false,        // hidden
    ...
```

Then `npm run game:embed` from the repo root (the EMILGO app's copy),
`games/emilgo-games/scripts/deploy-site.sh` (the website) and `fly deploy` (the
server).

Either way, a hidden mode loses its place in the lobby, the Play screen, the
queue, private rooms and practice, and the server refuses it. Saved scores and
ranks stay. A player who last picked it lands on a mode that's still on. Leave
at least one mode on.

## Sharing on X (one click to play)

Post the site's address with `?play` on the end, for example
`https://milgogames.pages.dev/?play`. The post shows the game's card (the
picture is `public/card.jpg`; re-shoot it with `node dev/howto-shots.mjs card`),
and a tap on it opens the game on one big **Tap to play** button: one more tap
and the person is in a Treasure Hunt practice on the big world. No account, no
download, no queue. `?play=hold-the-flag` (any mode id) starts that mode instead.

The card's links use `SITE_URL` at build time (the test site by default):
`SITE_URL=https://play.emilgo.app npx vite build --mode web` once the real
address is live.

After about six minutes of play in a browser, between matches, the game
suggests the app (once a day at most; "Not now" waits three days). Not in the
EMILGO app, not in Lagos Life. Where it sends people is set at build time:
`VITE_APP_ANDROID_URL`, `VITE_APP_IOS_URL` and `VITE_APP_URL` (until the store
listings exist, Android goes to the Play listing for `com.teqil.app` and
everyone else to `https://emilgo.app`).

## 5. Running it

```bash
npm run game:dev        # Vite dev server (add ?mockvatar to play as a fake Lagos Life player)
npm run game:build      # typecheck + dist/: the site Lagos Life frames (its SDK tag included)
npm run game:embed      # typecheck + single-file build → the EMILGO app's copy
(cd games/emilgo-games && npx vite build --mode web)   # dist-web/: the game on its own site (no SDK)
npm run game:preview    # serve dist/ with the frame-ancestors header
npm run game:sim        # balance check
```

**After any change under** `games/emilgo-games/src`**, run** `npm run game:embed` or
the EMILGO app keeps the old copy.

**The server** (`npm --prefix games/emilgo-games run …`): `server:dev` (rebuild +
restart on change, port 8787) · `server:build` · `server:start`.


| Server env                               | Meaning                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `PORT`                                   | default 8787                                                                               |
| `GAMES_ORIGINS`                          | comma-separated allowed page origins (unset = any)                                         |
| `MAX_PEERS`, `MAX_PER_IP`, `TRUST_PROXY` | connection limits; `TRUST_PROXY=1` behind a proxy                                          |
| `VATAR_SECRET`                           | `vtr_test_…` (sandbox) or `vtr_live_…` — **server only, never in the game**                |
| `VATAR_RESULTS_SECRET`                   | signs match results                                                                        |
| `VATAR_WEBHOOK_SECRET`                   | `vtr_whsec_…`, checks webhook signatures                                                   |
| `VATAR_API`                              | default `https://lagoslife.app/api/games/v1`                                               |
| `DATA_DIR`                               | where the purchases database lives (default `./data`) — keep it on a persistent disk       |
| `TICKET_SECRET`                          | 32+ random chars; signs ownership tickets. **Required when running more than one process** |
| `ADMIN_TOKEN`                            | 24+ random chars; unlocks `GET /reports` for moderators, and `DELETE /profiles/<key>`      |
| `SUPABASE_URL` / `SUPABASE_JWT_SECRET`   | the EMILGO app's Supabase project: checks EMILGO players' tokens for rank (SPEC-V3). Unset = EMILGO players unranked |
| `CONTENT_FILE`, `CONTENT_SIGNING_KEY`    | this week's mode manifest and its Ed25519 signing key (`server/src/content.ts`). Unset = the built-in manifest, not served |



| Game build env                                             | Meaning                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| `VITE_GAMES_SERVER` (`games/emilgo-games/.env.production`) | `wss://` address of the server, for the Lagos Life build |
| `EXPO_PUBLIC_GAMES_SERVER` (app `.env`)                    | `wss://` address, for the EMILGO app                     |


**Tests** — run the server and the fake platform first:

```bash
cd games/emilgo-games && node server/build-tools.mjs && npm run server:build
PORT=8790 WEBHOOK_URL=http://localhost:8787/vatar-webhook node server/dist/mockvatar.mjs &
PORT=8787 VATAR_SECRET=vtr_test_mock VATAR_RESULTS_SECRET=vtr_results_mock \
  VATAR_WEBHOOK_SECRET=vtr_whsec_test_mock VATAR_API=http://localhost:8790/api/games/v1 \
  node server/dist/index.mjs &
node server/dist/matchtest.mjs     # staked match (Ball Haunting), signatures, attacks
node server/dist/shoptest.mjs      # purchases, refunds, forgeries, looks  (22 checks)
node server/dist/socialtest.mjs    # friends, invites, boosts in the roster, data saver  (13 checks)
node server/dist/fairness.mjs      # lag never decides who's caught        (7/7)
node server/dist/ballstest.mjs     # Ball Haunting online: grab, push, drop, reconnect (16)
node server/dist/rulestest.mjs     # the referee: moves, modes, balls, fighting, the hum, the final two, highlights, the pens, boosts (115, no server needed)
npx tsx scripts/filter-test.ts     # chat filter                           (22 cases)
MAX_PER_IP=100000 …index.mjs; node server/dist/loadtest.mjs --clients 1200 --seconds 60
```



## 6. Shipping to Lagos Life — what's left, in order

Everything below needs your accounts; none of it is code.

The addresses (30 Oct 2026). **Now, with no domain:** players use
**https://milgogames.pages.dev**; the server is **https://emilgo-games.fly.dev**
(Fly.io, London, `fly.toml`). **Later, with `emilgo.app`:** play.emilgo.app and
api.emilgo.app (steps 1 and the `certs`/custom-domain parts below); the bare
`emilgo.app` is kept for the EMILGO app's own site.

1. **Later: buy `emilgo.app`** (Cloudflare → Domain Registration, or any registrar).
2. **Host the server** on Fly.io, from `games/emilgo-games`:
   `brew install flyctl`, `fly auth login`, `fly apps create emilgo-games`,
   `fly volumes create emilgo_data --region lhr --size 1`,
   `fly secrets set TICKET_SECRET=… ADMIN_TOKEN=…`, `fly deploy`,
   `https://emilgo-games.fly.dev/health` should say `ok`. (With the domain:
   `fly certs add api.emilgo.app` and the DNS records it prints, grey cloud.)
3. **Host the game**: `scripts/deploy-site.sh` (builds the last commit against
   `wss://emilgo-games.fly.dev`; the web build, with no Lagos Life SDK). **For
   the site Lagos Life frames, deploy with `BUILD=lagoslife`**: the web build
   can't talk to Lagos Life. Check the `content-security-policy:
   frame-ancestors …` header on the live URL. (With the domain: Pages →
   `milgogames` → Custom domains → `play.emilgo.app`, and
   `SERVER=wss://api.emilgo.app scripts/deploy-site.sh`.)
4. **Get test keys** at `lagoslife.app/developers/keys`: Game URL =
   `https://milgogames.pages.dev`; Webhook URL = `https://emilgo-games.fly.dev/vatar-webhook`
   (change both when the domain comes).
   Put the test secret, results secret and webhook secret in with
   `fly secrets set VATAR_SECRET=… VATAR_RESULTS_SECRET=… VATAR_WEBHOOK_SECRET=…`.
5. **Create the 5 products** in the dashboard — ids and prices from
  `listing/LISTING.md`, exactly.
6. **Tick the sandbox checklist** at `/developers/sandbox/<draft>`: open the game
  (init seen) → Shop → buy anything with *Pay (test)* (test purchase, server
   verified, delivered) → Multiplayer → Lagos Life match → create a match, let
   the sandbox's test bot join (match created, joined, result posted).
7. **Listing**: icon, screenshots and descriptions from `listing/`. Agree to the
  Developer Agreement. **Submit for review.**
8. After approval: swap in the **live** secrets (`vtr_live_…`), and ask Lagos
  Life to switch on **matches** and then **stakes** for the game (two separate
   approvals; until then the game offers friendlies and says why).



## 7. What was measured

**Online (final run, 15 Oct)**: 1,200 concurrent players on one process — 0
failed connections, server step p50 6.4 ms / p99 12.2 ms (budget 16.7 ms),
snapshot spacing p50 69 ms. Fairness 7/7; with compensation switched off, the
200 ms-lag player gets caught. Two-browser rounds identical to the centimetre;
a killed connection resumed in 1.0 s with the same seat.

**Matches + shop (Phases 3 & 5)**: matchtest (19) and shoptest (22) all passed
against the fake platform, which checks result signatures independently with the formula
from the docs. Ownership survives a server restart and a page reload; a second
browser sees the buyer's outfit and gold name; a forged ticket buys nothing.

**Social (Phase 4)**: three browsers — the filter hid a phone number and an
account number; report kept the evidence; block hid chat and emotes both ways;
a third, unblocked player saw everything.

**Performance (Phase 6)** — headless Chrome on this laptop's Intel Iris GPU:


|                                         | Result                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Download                                | ~176 KB transferred (one JS file + CSS), no assets                     |
| Lobby ready, slow 4G (1.6 Mbps, 150 ms) | **1.95–2.35 s**                                                        |
| Normal CPU, a full round                | 60 fps, full resolution, **no frame over 100 ms** (first tap included) |
| CPU slowed 6× (an old budget phone)     | adapts to 0.6× resolution; worst frame mid-round ~230 ms               |


Fixed during that pass: a 2.5 s mid-round freeze (shaders now compile behind the
loading screen), auto-quality wrongly lowering resolution on 30 fps menus and
never raising it on 60 Hz phones, resolution changes stalling the GPU while she
was watching (now deferred), a per-frame cost in the emote code, a duplicate
WebGL context at boot, a lobby row overflowing 375 pt screens.

**Performance (Phase 8, 22 Oct)**: headless Chrome on this Mac's GPU,
Desert Field, Ball Haunting 300 m, 20 bodies, 844×390.

|                                              | Result                                                        |
| -------------------------------------------- | ------------------------------------------------------------- |
| Low / Medium / High                          | 30 / 60 / 60 fps · 59 / 70 / 77 draw calls · 70K / 86K / 98K triangles |
| CPU slowed 4× and 6×, Low                    | 30 fps at both (work per frame p95: 11.7 and 23.1 ms)          |
| CPU slowed 6×, Auto                          | Medium can't keep up, so the next round starts on Low          |
| Lobby ready, slow 4G + CPU 4×, production    | **3.9–4.6 s** (limit 5 s)                                      |
| Download                                     | ~0.4 MB (limit 50 MB)                                          |
| Load test, 600 clients                       | 0 failed · tick p99 8.3 ms · 6.8 KB/s per player               |

**Not yet verified**: a real Android or iPhone, the real Lagos Life sandbox,
the Docker image. Do those before submitting.

## 8. Scaling notes

The client scales by itself: each phone draws only its own match. The server
scales by **nodes × rooms** behind a **room directory** (v4 Phase 10).

### How it fits together

- **Nodes** are ordinary game servers (`server/dist/index.mjs`). Each holds its own
  rooms and is stateless between matches. Each beats to the directory every 2 s
  (players, rooms, tick time, memory, draining).
- **The directory** (`server/dist/directory.mjs`, or `/dir/*` on any node) holds
  no data, only the last beats. A phone asks it before connecting:
  quick play goes to the node with the most room; a room or party code goes to its node
  (the code's first letter is the node's shard); a Lagos Life match id goes to
  the same node for both players (rendezvous hashing). When every node is full
  the directory answers 503 `full`, and the phone falls back to its build's one
  server address (keep that pointed at a node with headroom).
- **Deploys** drain: on SIGTERM a node stops taking players, closes idle sockets
  with 1012 (the phone asks the directory again and moves), finishes its matches,
  then exits (15 min at most).
- With several nodes: one shared `TICKET_SECRET`, and the purchases store moved
  from SQLite to a shared database (implement `OwnershipStore` in
  `server/src/store.ts` on Postgres). A Lagos Life webhook can land on any node:
  it is only a nudge, so that is safe once the store is shared.

| Env (node) | |
|---|---|
| `DIRECTORY` | the directory's https address |
| `DIR_SECRET` | shared by the directory and every node (beats are refused without it) |
| `NODE_URL` | this node's public `wss://` address |
| `SHARD` | one letter from `NET.codeAlphabet`, different on every node |
| `NODE_CAP` | players it should hold (default 2000) |
| `WARM_WORLDS=0` | skip building the worlds and walk grids at start (tests only) |

The game is built with `VITE_GAMES_DIRECTORY=https://…`. Without it, it uses the
one server, as before.

### Measured (3 Nov 2026, this Mac: 4-core i5 1.4 GHz, 8 GB)

| Test | Result |
|---|---|
| One room's rules, offline (`stepbench`) | 24-player Royale on Naija Max: step p50 0.2 ms, p99 1.7 ms, flat over 5 minutes. Setting up a match: 17–45 ms warm. |
| One node, 1,000 Free For All players (Find the Flag + Royale) | 1,000/1,000 connected; tick p50 1–5 ms; 5.6 KB/s to each phone. Socket writes are about 20% of the node's CPU, the rules about 30%. |
| **10,000 clients through the directory** (4 nodes, cap 3,000; 3 load processes) | **10,000/10,000 connected, 0 failed.** ~1,000 in live matches (63 rooms), 9,000 in the menus; 1.0 GB of memory over the 4 nodes. |
| The same with 4 × cap 2,000 | 8,288 connected, 1,712 told `full` by the directory: the cap works. |
| The same, after the v4 rework (this 8 GB Mac, swapping; 3–6 Nov) | **Not reproduced:** 6,429, 9,183, 6,941 connected in 120 s, 7,675 in 300 s. The Phase 10 commit got 6,572 the same day, so this is the machine, not a regression; 10,000 on the current build still needs real servers. |

The load processes, the nodes and the browser all shared four cores (load average
up to 118), so the tick times above are the laptop's, not a server's. On it, ticks
reached 13–17 ms p50 with only ~250 players in matches on each node.

### Sizing

- **10,000 players, all in matches**: 6–8 nodes on dedicated vCPUs (about 1,500
  Free For All players each, keeping ticks well under the 16.7 ms step).
- **1,000,000 players**: ~600 such nodes behind one directory (a beat is ~200 bytes
  every 2 s: about 60 KB/s at 600 nodes). The directory is a pure function of
  the last beats, so it can run as several copies. Not tested at that size.
- Lagos Life API calls stay low: sessions are verified once per match or claim,
  and online outfits use signed tickets instead of an API call per connection.
- Serve the game from a CDN (Cloudflare Pages): millions of opens cost nothing
  at the origin.

