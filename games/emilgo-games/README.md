# EMILGO Games

> **Picking this up in a new session? Read [HANDOFF.md](HANDOFF.md) first.**
> The owner's full spec: [SPEC-ORIGINAL.md](SPEC-ORIGINAL.md).

Nigerian street games, built to run **inside Lagos Life** (through the Vatar
Games SDK) and **inside the EMILGO app** (embedded, offline). One web codebase,
two hosts.

First game: **Red Light, Green Light** — a race down a closed-off Lagos street.
Waka while Mama Gele sings; freeze when she turns; cross the line before the
clock runs out.

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
    scripts/             loadtest, fairness, matchtest, ballstest, shoptest, rulestest, apicheck, mockvatar
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

## 5. Running it

```bash
npm run game:dev        # Vite dev server (add ?mockvatar to play as a fake Lagos Life player)
npm run game:build      # typecheck + dist/ for hosting
npm run game:embed      # typecheck + single-file build → the EMILGO app's copy
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
| `ADMIN_TOKEN`                            | 24+ random chars; unlocks `GET /reports` for moderators                                    |



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
node server/dist/fairness.mjs      # lag never decides who's caught        (7/7)
node server/dist/ballstest.mjs     # Ball Haunting online: grab, push, drop, reconnect (16)
node server/dist/rulestest.mjs     # the referee: moves, modes, balls, fighting, the hum, the final two, highlights, the pens (103, no server needed)
npx tsx scripts/filter-test.ts     # chat filter                           (22 cases)
MAX_PER_IP=100000 …index.mjs; node server/dist/loadtest.mjs --clients 1200 --seconds 60
```



## 6. Shipping to Lagos Life — what's left, in order

Everything below needs your accounts; none of it is code.

1. **Host the game** on Cloudflare Pages (free): build with `VITE_GAMES_SERVER`
  set, upload `games/emilgo-games/dist/` (it includes `_headers`). Check the
   `content-security-policy: frame-ancestors …` header on the live URL.
2. **Host the server** with TLS (`wss://`): any Docker host (Fly.io, Railway,
  Render, a VPS) using `server/Dockerfile`, a **persistent disk** for
   `DATA_DIR`, and the env above. Point a domain at it; `/health` should say `ok`.
3. **Get test keys** at `lagoslife.app/developers/keys`: Game URL = the Pages
  address; Webhook URL = `https://<server>/vatar-webhook`. Put the test secret,
   results secret and webhook secret into the server's env.
4. **Create the 6 products** in the dashboard — ids and prices from
  `listing/LISTING.md`, exactly.
5. **Tick the sandbox checklist** at `/developers/sandbox/<draft>`: open the game
  (init seen) → Shop → buy anything with *Pay (test)* (test purchase, server
   verified, delivered) → Multiplayer → Lagos Life match → create a match, let
   the sandbox's test bot join (match created, joined, result posted).
6. **Listing**: icon, screenshots and descriptions from `listing/`. Agree to the
  Developer Agreement. **Submit for review.**
7. After approval: swap in the **live** secrets (`vtr_live_…`), and ask Lagos
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

**Not yet verified**: a real Android or iPhone, the real Lagos Life sandbox,
the Docker image. Do those before submitting.

## 8. Scaling notes

The client scales by itself — each phone draws only its own round. The server:

- A round is tiny; one process hosts thousands of players. Add processes behind
a load balancer that keeps a WebSocket on one instance.
- With several processes: one shared `TICKET_SECRET`, and the purchases store
moved from SQLite to a shared database (implement `OwnershipStore` in
`server/src/store.ts` on Postgres; nothing else changes).
- Lagos Life API calls stay low: sessions are verified once per match or claim,
and online outfits use signed tickets instead of an API call per connection.
- Serve the game from a CDN (Cloudflare Pages): millions of opens cost nothing
at the origin.

