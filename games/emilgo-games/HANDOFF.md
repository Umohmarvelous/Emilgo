# EMILGO Games: session handoff

> **28 Oct 2026: v3 has begun.** The owner approved [SPEC-V3.md](SPEC-V3.md):
> Dead Streets (solo zombie survival), Free For All (12 humans, melee, 10
> modes, vehicles) and a hidden Ball Haunt, on one rank ladder kept on the
> server. 11 phases, **each waits for the owner's go-ahead**. **Phase 1
> (foundations) is done and committed (28 Oct 2026)**. **Phase 2 (the
> open-world engine, Naija World, the film look) is built and committed (28 Oct
> 2026)**; its Medium perf gate was re-run on a quiet Mac and passes. **Phase 3
> (shared gameplay: the match core, the zone, items and the backpack, Airfall,
> the sky laser and its falls, footprints, the item compass) is built and
> committed (28 Oct 2026)**. **Phase 4 (Free For All's core: Gidigbo melee,
> 12-player rooms, squads and parties, the rotation, results with XP, modes
> 1–5 and their "How to play" cards, the `GameMode` seam, the staked Flag Duel;
> Ball Haunt hidden) is built and committed (29 Oct 2026)**. Phase 5
> (vehicles) waits for the go-ahead. See SPEC-V3 "Status".
>
> Before v3: Red Light, Green Light v2 was built to [SPEC-V2.md](SPEC-V2.md)
> in 8 phases, all done and committed, then the owner's scanned people
> replaced every player (27 Oct). The High-budget item below is still on hold.

## Start here (new session)

Read these in order:
1. This file.
2. [SPEC-V3.md](SPEC-V3.md): the owner's answers, Decisions, the 11 phases and Status (v3 wins over everything below). The brief word for word: [SPEC-V3-ORIGINAL.md](SPEC-V3-ORIGINAL.md).
3. [SPEC-V2.md](SPEC-V2.md) (still the rules for Ball Haunt until Phase 11):
   - the owner's answers, the Decisions table and the 8 phases;
   - the **Status** section for what each finished phase built.
4. [SPEC-ORIGINAL.md](SPEC-ORIGINAL.md): the owner's own full spec (§1–§11), word for word. Every `§` in this file and in SPEC-V2 points into it. Where it disagrees with SPEC-V2's Answers and Decisions, SPEC-V2 wins.
5. [README.md](README.md):
   - §1, the Lagos Life rules the game must keep;
   - §4, the architecture;
   - §5, how to run it and test it.
6. [UPGRADE.md](UPGRADE.md) only for history. Where it disagrees with SPEC-V2, SPEC-V2 wins.

## How the owner works (follow these)

- **One phase at a time.** Finish it, test it, report it, then **stop and wait for the go-ahead**. Never start the next phase on your own.
- **Short, plain replies.** No repetition.
- **Build only what the spec says** (SPEC-V3 now). Nothing extra. If the spec is unclear, add a row to its Decisions table and say so in the report.
- **Commit after every finished update, without asking** (the owner, 18 Oct 2026: "always commit every new update"). Stage only that change's files. End commit messages with the `Co-Authored-By` line. Don't push.
- **The permanent home (decided 30 Oct 2026):** players use **https://play.emilgo.app** (Pages project `milgogames`, published by `scripts/deploy-site.sh`); the server is **api.emilgo.app** on Fly.io, London (`fly.toml`, `fly deploy`). The owner buys the domain, makes the Fly account and sets every secret with `fly secrets set` — never in the repo or the chat. README §6 has the steps.
- **Deploys are paused, except the owner's test site** (30 Oct 2026: "deploy this on cloudflare so i can play with my mobile phone"): **https://milgogames.pages.dev** (Cloudflare Pages project `milgogames`, wrangler is logged in). Republish it after each phase. `scripts/play-live.sh` builds the last commit, starts the game server on this Mac (port 8799, data in `data/live/`) behind a Cloudflare quick tunnel and republishes the site pointing at it; `scripts/play-live.sh stop` ends it. The owner runs it (Claude's permission check blocks opening the tunnel). Without it the site plays Practice only. Everything else (Lagos Life, EAS, the Docker server) stays paused.
- **After any change under `src/`**, run `npm run game:embed` from the repo root. It writes the app's copy, `src/games/emilgo-games/redlightHtml.generated.ts`, which is committed.
- **Never use Squid Game's music, doll voice, score, doll design or colours.** They are Netflix IP and Vatar Agreement §3.3 / §4(i) forbids them.
  - The song is the traditional, public-domain playground chant "Mugunghwa kkochi pieotseumnida", synthesised.
  - The doll is our own giant schoolgirl in a green pinafore.
  - No words, lyrics or song title on screen.
- **Real test keys live only in `server/.env`**, which is git-ignored. Never print them or put them in the game.
- **Lagos Life rules that are easy to break:**
  - no microphone in the frame, so no voice chat;
  - staked matches have 2–4 seats only;
  - results come only from our server, signed;
  - never link players across services;
  - never claim to be a "partner".

## Standing answers from the owner (17 Oct 2026)

| Topic | Answer |
| --- | --- |
| Players per match | 20-player matches are free, on our server. Staked Lagos Life matches stay at 2–4 seats. No bots online. |
| Staked mode | Every staked match is Ball Haunting, 200 m, 80 s, with one ball fewer than the players (`STAKED` in `src/config.ts`). |
| CP | Earned only by playing. Boosts are off in staked matches. |
| Warning hum | A 3 s hum before every turn, plus fake hums (about 38%; never two in a row, never before the first turn). |
| Fighting | Never automatic. Players fight only when they tap fist, slap or push. A bump just stops you. CPUs only swing at whoever holds the ball they want. |
| Hits during red light | Only the attacker is shot. |
| Song | The traditional Mugunghwa chant, and (18 Oct 2026) our own lullaby: she takes turns with the two. No other songs, no picker. |
| Doll | The giant schoolgirl doll: pigtails, green pinafore, about 12 m tall. |

## Phase status

| # | Phase | State |
| --- | --- | --- |
| 1 | Clean slate and characters | Done, committed `51357ad` |
| 2 | Referee v4 and server | Done, committed `36dc89e` |
| — | The hum, no automatic fights | Done, committed `5906bd9` |
| 3 | Desert Field, sky, light and dark | Done, committed `5906bd9` |
| 4 | HUD, controls, camera (+ the new song and doll) | Done, committed `d8dfc01` |
| 5 | Match flow | Done, committed `05910de` |
| 6 | Elimination and highlights (+ the lullaby, the pens, the wider desert) | Done, committed `9a41722`, `2a27245`, `e71f778`, `f212177` |
| 7 | Menus, settings, social, store | Done, committed `337327b` |
| 8 | Performance and regression | Done (22 Oct 2026), committed `d8249f0`, `d64aec5`, `238b0c7`, `1feaadd` and the docs |
| — | Scanned people (owner's request after 8) | In the game (27 Oct 2026). High over budget: owner's call |

The full scope of each phase is in SPEC-V2.md under "Build phases". What 1–4 built is in its "Status" section.

## Phase 6: Elimination and highlights (done)

What it built, the checks and the numbers: SPEC-V2.md, Status, "Phase 6".
The new decisions (the 10 steps, the kill cam, the final two, the play of
the game, spectating, the second song, the pens and the wider desert) are
rows in its Decisions table. **Tell the owner the pens are our reading of
"places to go in and find them"**: the layout is easy to change.

Where things are, for Phase 7 and 8:
- Elimination: `session.ts` `onCaught` (per body) and `afterCatches` (per
  batch: crack, drum, zoom). Blood: `world/blood.ts`. Falls:
  `world/human/ragdoll.ts`.
- Replays: `game/replay.ts` (recorder), `rlgl/replayView.ts` (player),
  `ui/replay.ts` (overlay), lenses in `rlgl/shots.ts`. The sequence after
  you're out or across: `session.ts` `sequence()`.
- The final two: `FINAL` in `config.ts`; the referee's `timeScale`.
- Play of the game: `game/highlights.ts` (the server runs it in `room.ts`).
- Pens: `game/pens.ts` (shared), `world/pens.ts` (drawn),
  `maps/registry.ts` `fieldHalfWidth`.
- Protocol 9 (8: `fn2` and `hl` events; 9: the pens' walls).
- Test servers: rebuild with `npm run server:build` after any change to
  `src/game` or `server/src` (the servers run the built copy).

## Phase 7: Menus, settings, social, store (done)

What it built, the checks and the numbers: SPEC-V2.md, Status, "Phase 7".
The new decisions (pause menu, audio, the 20 settings, language, data saver,
reset, rotate, moderation in the roster, friends, CP and boosts) are rows in
its Decisions table. Protocol 10.

Where things are: pause and settings `ui/screens.ts` (actions in
`game/session.ts`); language `ui/i18n.ts`; rotation `ui/rotate.ts`; volumes
`audio/sound.ts` `setLevels`; friends `social/friends.ts` and
`server/src/presence.ts`; boosts `shop/boosts.ts` (applied by
`game/rules.ts` `setBoosts`, left out of staked matches in `room.ts`).

## Phase 8: Performance and regression (done)

What it built, the checks and the numbers: SPEC-V2.md, Status, "Phase 8".
Two new rows in its Decisions table: the low-end GPU class (with Auto's step
down) and poor connections.

Where things are:
- Animation LOD: `world/crowd.ts` (`ANIM_STRIDE`).
- Bones and skin, posed on demand: `world/human/index.ts` (`apply`,
  `updateSkin`, `posed`). **Any code that turns a bone by hand must call
  `posed()`**, or the skin won't follow. The skin is detached, so three.js's
  CPU skinning (`getVertexPosition`) already returns world positions.
- Tiers: `graphics/tiers.ts` (`LOW_END_GPU`, `autoTier`); Auto's step down:
  `session.ts` `stepDownIfStruggling`; the governor: `core/quality.ts`.
- Mama is made after boot: `session.ts` `doll` (a getter; `dollObj` is null
  until then).
- Poor connections: `net/client.ts` (the watchdog, `online` retry).
- Measuring: `dev/cdp.mjs`, with `CPU_RATE`, `NET_KBPS`/`NET_RTT`, and the
  `profile` (+ `reload`, `tree`), `offline` and `net` steps.

The spec's limits (§8) and where they stand: 30 fps on low-end, 60 on
mid-range, under 100 draw calls and 100K triangles, under 5 s to the lobby,
under 50 MB. All met in headless Chrome. **None checked on a real phone.**

## Scanned people (after Phase 8)

What it built, the checks and the numbers: SPEC-V2.md, Status, "Scanned
people". Four new rows in its Decisions table (the hoodie replaces the suit,
old looks, the mouth, the detail levels).

Owner's rules for them (22 Oct 2026): hoodie and joggers only, colour and
design are all players change; High is his LOD0 (19.7K), Low and Medium may
look faceted; COD-style moves but no new COD moves; five fingers; real eyes
that move and blink, the mouth moving "when necessary"; "I'll say what to
change as time goes on". The source scans are in `assets/models/characters`
(not committed) and the 300K originals in `~/Downloads` (filenames swapped:
`3d_male_model` is the woman).

Where things are:
- Bodies: `world/human/scanbody.ts` (the clothes, the face, loading),
  `scanpaint.ts` (texture), `keys.ts` (keyframed clips), `animator.ts`
  (`faceRig`), `wardrobe.ts` (`HOODIE_COLORS`, `HOODIE_DESIGNS`,
  `hoodieFromOutfit`).
- The bake: `tools/scan/bake.mjs` then `pack.mjs` → `world/human/scan/*.bin`
  (the header of bake.mjs says what it needs).
- Review sheets: `dev/scan.html?body=m|f&level=0..3&set=moves|emotes|poses`.
  `dev/humans.html?gen=1` shows the generated people (Mama).
- Shadow stand-ins: `graphics/shadowOnly.ts`; `Human.castShadows`.
- The ground solver lying down skins its points by all four weights
  (`Body.contactsAll`, stride 20).

## v3 Phase 1: where things are

- Rank: `src/rank/ladder.ts`, `src/rank/xp.ts`; server `server/src/profiles.ts` (DATA_DIR/profiles.db), `Room.onAward` in `room.ts`, the `id`/`rank` messages (protocol 11); session `onRank`, `sendIdentity`.
- Modes as data: `src/content/` (`modes.ts` the launch manifest and `BUILT`, `validate.ts`, `catalog.ts`, `load.ts`); server `server/src/content.ts`. **Add a module to `BUILT` when its phase ships**, or its modes stay "Soon".
- Ball Haunt's switch: `FEATURES` in `src/config.ts`. Off since Phase 4 (the test server runs with `BALL_HAUNT=1`).
- The movement kernel: `src/game/core/body.ts`.
- Mouse look: `input/controls.ts` (`lockPointer`, `mouseMode`). Pause hush: `sound.hush`.
- New tests: `ranktest` (set `RANK_SECRET` to the server's `SUPABASE_JWT_SECRET` for the online part) and `contenttest`. The test server now also takes `SUPABASE_JWT_SECRET=test-supabase-jwt-secret-0123456789abcdef`.

## v3 Phase 3: where things are

- The match core: `src/game/core/match.ts` (`Match`, `settingsOf` for Ranked), `module.ts` (`RuleModule`, `MatchEvent`), `reach.ts` (the walk grid). Modules: `src/game/modules/` (`zone.ts`, `items.ts`, `airfall.ts`, `index.ts` builds them in step order). Items and loot tables: `src/content/items.ts` (an item with `effect: null` is never handed out). Numbers: `ZONE`, `LOOT`, `AIRFALL`, `RESPAWN` in `src/config.ts`.
- On screen: `src/world/matchScene.ts` ties a match to everything below (Phase 4's `GameMode` should use it as it is): `skyLaser.ts`, `zone.ts` (the curtain), `items.ts` (items, loot bags, crates, the Ankara parachute, flares), `footprints.ts`, `decals.ts` (scorch and prints); `human/pack.ts` (the worn backpack), `ragdoll.ts` (`roll`, `skyFall`), `crowd.ts` (`strike`, `revive`, `setPack`).
- HUD: `src/ui/play.ts` (zone line, exposure meter, interact, the backpack radial, effect chips, tints); `hud.ts` (`setCompass`'s item diamond), `minimap.ts` (`zone`, crate marks). Sounds: `sound.ts` (`skyWarn`, `skyHit`, `pickup`, `useItem`, `full`, `flare`, `crate`, `heartbeat`, `zoneAlert`).
- Try it: `npm run game:dev`, then `/dev/open.html?play=1` (`&fast=4` brings the zone and Airfall sooner, `&seed=n`, `&tier=0|1|2`, `&auto=1` tours the city). `window.__match` is the match, `window.__ms` the scene, `window.__play` the numbers. **Editing `src/` while a headless run is going reloads its page** (Vite): don't, during a perf gate.
- New test: `sharedtest` (59 checks, no server needed).

## v3 Phase 4: where things are

- Rules (pure, shared): `src/game/modules/melee.ts` (Gidigbo: Wobble, swings, brace and parry, the clinch and its finishers, trips, charges, ring-outs, street props, slippers), `flags.ts` (Find the Flag, Hold, Steal & Reposition, Scarcity, the Flag Duel), `dropzones.ts`, `capture.ts` (Squad Rally). The match core gained squads, standings, `reachFor` (one tap, the nearest thing), `predict`, and the **mirror** (`Match.mirror`, `applyRemote`, each module's `apply`/`view`); hidden things come from `secretRng` (the server's own seed). Numbers: `MELEE`, `FLAGS`, `DROPZONES`, `RALLY` in `src/config.ts`. Where stash spots and arenas come from: `src/maps/open/matchWorld.ts`.
- Wire (protocol 12): `src/net/matchWire.ts`. Server: `server/src/ffa.ts` (`FfaGame`, `assignSquads`, the Flag Duel id), `room.ts` (`beginMatch`, `tickMatch`), `lobby.ts` (`fq`, parties, `openFor` rank locks, `ballHaunt`).
- The phone: `src/modes/types.ts` (the `GameMode` seam, `ModeHost`), `src/modes/ffa.ts` (online or practice), `src/net/onlineMatch.ts` (the copy, prediction, interpolation), `src/world/ffa.ts` (flags, props, goals, melee on the bodies, meters over heads, the objective line). Session: `startFfa`, `beginFfa`, `endFfa`, `onFfaEnd`, `goFfa`, `ensureNaija` (Naija World built once per tier). Screens: `playFfa`, `ffaResults`; cards: `src/ui/ffaCards.ts`. Controls: `layout = "ffa"`.
- Try it: the Play screen (Free For All) → Practice, or a quick match with company: `node server/dist/ffaplay.mjs --n 11 [--mode hold-the-flag] [--hunt]` fills the queue with scripted phones (`--hunt`: they come for you). `window.__game.gm` is the mode; `.match` the copy.
- Tests: `ffatest` (offline rules, then 12 phones online with `GAME=`), `matchtest` (the staked Flag Duel), `loadtest --ffa find-the-flag`.
- **Open item: Phase 4's frame-rate gate isn't measured.** Other apps kept this Mac's load at 18–160 on 29–30 Oct. Re-run it on a quiet Mac (load under 8) before Phase 5: the game page, a live 12-player match (`ffaplay --n 11`), CPU 4×, Low and Medium. SPEC-V3 Status has the numbers so far.

## v3 Phase 5: where things are

- Rules (pure, shared): `src/game/modules/drive.ts` (how a car moves: `driveCar`, `collideWorld`, seats and doors; the server and the phone that drives both run it) and `vehicles.ts` (`VehiclesModule`: parking, getting in and out, bumps, the sky, fuel and the fuel boys, damage and the blast, the hijack, the items). Numbers: `VEHICLES` in `src/config.ts`. The core knows who is seated (`Match.seated`, `setSeat`): a rider isn't walked, bumped, hit or offered anything but the door. The roads and the six fuel boys' stands come from the layout (`maps/open/matchWorld.ts`, `fuelStands`).
- Wire: protocol 13 (`CAR_STRIDE` numbers per car in each snapshot; `car`, `seat`, `hijack`, `fuel`, `wreck`, `horn`, `alarm`, `bump`, `dodge` events). The phone predicts the car it drives (`OnlineMatch.driveMine`, `reconcileCar`) and smooths the others.
- The phone: `src/world/vehicles.ts` (the three kinds built from boxes, wheels, smoke, fire, the blast, the stands; riders seated via `crowd.setSeat`), the seated pose (`animator.ts` SIT/WHEEL/LAP), `controls.setDriving` (horn, radio, slap), the HUD's car panel (`ui/play.ts`), car sounds and the engine (`audio/sound.ts`), the radio loops (`audio/radio.ts`), card 6 (`ui/ffaCards.ts`), the driving camera (`rig.arm`, `rig.lift`).
- Tests: `cartest` (50 checks, offline), and `ffatest`'s network half now has a phone walk to a car and drive it.
- Try it: Practice (Free For All) and walk to the car on the map (a white box), or `window.__game.gm.match.module("vehicles").cars`.

## Running and testing

From the repo root:

```bash
npm run game:dev       # Vite dev server on :5173 (?mockvatar = fake Lagos Life player)
npm run game:embed     # typecheck + single-file build → the app's copy (run after every src change)
npm run game:build     # typecheck + dist/ (Lagos Life site)
npm --prefix games/emilgo-games run typecheck   # client + server
```

### The test suite

Run it from `games/emilgo-games/`. It uses ports **:8797** (game server) and **:8790** (fake platform), so the Docker server on :8787 is left alone.

```bash
node server/build-tools.mjs && npm run server:build
PORT=8790 WEBHOOK_URL=http://localhost:8797/vatar-webhook node server/dist/mockvatar.mjs &
PORT=8797 DATA_DIR=<scratch>/data TICKET_SECRET=test-ticket-secret-0123456789abcdef ADMIN_TOKEN=test-admin \
  MAX_PER_IP=100000 VATAR_SECRET=vtr_test_mock VATAR_RESULTS_SECRET=vtr_results_mock \
  VATAR_WEBHOOK_SECRET=vtr_whsec_test_mock VATAR_API=http://localhost:8790/api/games/v1 \
  SUPABASE_JWT_SECRET=test-supabase-jwt-secret-0123456789abcdef BALL_HAUNT=1 node server/dist/index.mjs &
node server/dist/rulestest.mjs                          # 115 checks, no server needed
node server/dist/contenttest.mjs                        # 27 checks, no server needed
node server/dist/spacetest.mjs                          # 19 checks (Phase 2: ground and walls)
node server/dist/worldtest.mjs                          # 15 checks (Phase 2: Naija World)
node server/dist/sharedtest.mjs                         # 59 checks (Phase 3: the match core, zone, items, Airfall)
node server/dist/cartest.mjs                            # 50 checks (Phase 5: vehicles)
GAME=ws://localhost:8797 node server/dist/ffatest.mjs   # Phase 4: melee and the five modes offline, then 12 phones online
GAME=ws://localhost:8797 node server/dist/ranktest.mjs  # 42 checks (needs SUPABASE_JWT_SECRET on the server, as above)
GAME=ws://localhost:8797 node server/dist/matchtest.mjs
GAME=ws://localhost:8797 node server/dist/ballstest.mjs
GAME=ws://localhost:8797 node server/dist/shoptest.mjs
GAME=ws://localhost:8797 node server/dist/socialtest.mjs
node server/dist/fairness.mjs ws://localhost:8797       # 7/7
node server/dist/loadtest.mjs --clients 600 --seconds 60 --url ws://localhost:8797
node server/dist/loadtest.mjs --clients 600 --seconds 60 --url ws://localhost:8797 --ffa find-the-flag   # 50 rooms of 12
```

- `BALL_HAUNT=1` keeps Ball Haunt's rooms open on the test server (ballstest, fairness, loadtest, socialtest
  play it) while `FEATURES.ballHaunt` is off. Leave it off any real server.
- matchtest plays the Flag Duel: it takes as long as the flag takes to find (30 s to 5 min).
- fairness times reactions in real time: at a load around 120 it marks safe runs as caught (2/7). Run it again when the Mac is quieter (7/7 at load 37) before you go looking for a bug.
- macOS has no `timeout` command. Use the load test's own `--seconds` instead.
- Kill both background servers when you're done.

### Screenshots and UI checks

`dev/cdp.mjs` drives headless Chrome. The steps it understands are listed at the top of the file.

```bash
VIEW=844x390 node dev/cdp.mjs "http://localhost:5173/" <outdir> <steps.json>   # GPU=1 for the real GPU
```

- The page exposes `window.__game` for tests: `g.action("…")`, `g.round`.
- Check every UI change in two layouts:
  - landscape 844×390 and portrait 390×844;
  - right-handed and left-handed ("Swap sticks").
- `dev/humans.html?set=doll&tier=2&cam=face` shows the character and doll line-ups.

## Open items (not code; the owner's)

- **ON HOLD — owner picked option 1 (28 Oct 2026), build it only when he says go.**
  To do then: make the 100K-triangle limit apply to Low and Medium only
  (High exempt); write it as a SPEC-V2 Decisions row, update the Status
  "Scanned people" budgets row and this item, commit. No code change is
  needed (the crowd budget stays); it is a spec and docs decision.
- **High is over budget: 114K triangles at worst (limit 100K).** Your own
  body is 19.7K on High (the owner's LOD0); the other 19 are already at the
  lightest level. Low (76K) and Medium (92K) are under, and Auto never gives
  a phone High (it's "for computers, or by choice"). Options for the owner:
  1. **Keep it** and make the limit 100K for Low and Medium only. High still
     runs 60 fps on this Mac. (Recommended.)
  2. A lighter far body (1.6K → about 0.8K) for everyone: High about 98K, but
     the other 19 look rougher at the start line on every tier.
  3. Your body at 19.7K only in close-ups (walkout, results), 6.1K in play.
- **The listing screenshots show the old people.** `listing/LISTING.md` says
  they are real captures of the game, so they need taking again before
  submission. Its product table now matches the hoodie shop.

- **Docker server on :8787 is still on protocol 5.** New builds (protocol 11) can't join it; the Play menu says "Update the game to play online." Rebuild it with:
  ```bash
  cd games/emilgo-games && docker compose up -d --build
  ```
- **Never tested on a real phone.** Only headless Chrome has run it, with both the software and the real GPU.
- **Never run against real Lagos Life.** Only against the fake platform, `server/scripts/mockvatar.ts`.
- **Hosting, domain (emilgo.app), Vatar keys, dashboard products, sandbox checklist, submission:** see README §6. All of it is paused by the owner.

## Key numbers (scanned people, 27 Oct 2026)

- rules 115 · match 20 · balls 29 · shop 22 · social 13 · fairness 7/7 · ground 702 / 0 failed.
- Load test, 600 clients: 0 failures · tick p99 6.4 ms · 6.9 KB/s.
- Lagos Life `dist/`: 318 KB JS gzipped + 154 KB of scans at boot. EMILGO embed: 2,343 KB. Protocol 10.
- Desert Field 300 m Ball Haunting, 20 bodies, worst frame: Low 59 calls / 76K · Medium 68 / 92K · **High 78 / 114K**.
- Lobby ready, production build, slow 4G + CPU 4×: 4.0–4.25 s.

## Key numbers (Phase 8)

- rules 115 · match 20 · balls 29 (6 runs in a row) · shop 22 · social 13 · fairness 7/7 · ground 1,638 / 0 failed.
- Load test, 600 clients: 0 failures · tick p99 8.3 ms · 6.8 KB/s.
- Lagos Life `dist/`: 302 KB JS gzipped (about 0.4 MB sent in all). EMILGO embed: 1,281 KB. Protocol 10.
- Desert Field 300 m Ball Haunting, 20 bodies: Low 30 fps, 59 calls / 70K triangles · Medium 60 fps, 70 / 86K · High 60 fps, 77 / 98K.
- Lobby ready, production build, slow 4G + CPU 4×: 3.9–4.6 s.
