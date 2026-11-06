# EMILGO Games: session handoff

> **3 Nov 2026: the v4 rework (R1–R10) is done**, from the owner's rework brief
> (last section of [SPEC-V4-ORIGINAL.md](SPEC-V4-ORIGINAL.md)). Status and the
> gaps that remain: SPEC-V4 "Rework". One step is the owner's: run
> `scripts/deploy-site.sh`, because milgogames.pages.dev has no `/lib` or `/music`
> and the EMILGO app's copy streams them from there. [SPEC-V5.md](SPEC-V5.md) has
> since begun and wins where they differ (no gutters, the female body only…).
>
> **3 Nov 2026: v4 "Max Mode" is done.** The owner's answers of 2 Nov
> ([SPEC-V4-ORIGINAL.md](SPEC-V4-ORIGINAL.md)) became [SPEC-V4.md](SPEC-V4.md):
> 10 phases (look control, guns, HUD A Field Kit, operators and armour, zombies,
> Max graphics, Naija Max the 2 km world, sound, screens, scale and
> performance), **all built, tested, committed and pushed without waiting for
> approval**, as the owner asked. Ball Haunt stays hidden. What each phase
> built and measured is in SPEC-V4 "Status"; what is still the owner's (keys,
> R2, real servers, real phones) is in each phase's "Not done" line.
>
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
> 1–5 and their "How to play" cards, the** `GameMode` **seam, the staked Flag Duel;
> Ball Haunt hidden) is built and committed (29 Oct 2026)**. **Phase 5
> (vehicles) is done (30 Oct)** and **Phase 6 (FFA modes 6–10, Ranked, the
> Harmattan, all 22 §10 extras) is done (2 Nov 2026)**; **Phase 7 (Spooky World, Dead Streets' core) is done (2 Nov 2026)**; **Phase 8 (Dead Streets' extras, rank rewards, the loading screen) is done (2 Nov 2026)**. **Phase 9 (billboards: the boards in both cities, house boards, the ads feed and seconds seen, the Supabase migration, the advertiser portal, checkouts and the review queue) is done (2 Nov 2026)**; the migration and the keys are the owner's to apply (see "Billboards: the owner's steps"). **Phase 10 (performance and regression: the faster boot, the web build) is done (2 Nov 2026)**. **Phase 11 (Ball Haunt rebuilt: no Mama, the song from the sky, the eye and the shared sky laser, its own chunk, on the shared match core) is done (2 Nov 2026)**; Ball Haunt is still hidden (`FEATURES.ballHaunt`). **All 11 phases are done.** On 2 Nov the owner
> said to build every remaining phase (7–11) **without waiting for approval**,
> committing **and pushing** each change. See SPEC-V3 "Status".
>
> Before v3: Red Light, Green Light v2 was built to [SPEC-V2.md](SPEC-V2.md)
> in 8 phases, all done and committed, then the owner's scanned people
> replaced every player (27 Oct). The High-budget item below is still on hold.

## Start here (new session)

Read these in order:

1. This file.
2. [SPEC-V4.md](SPEC-V4.md): v4's answers, Decisions and Status (v4 wins over v3 where they differ).
3. [SPEC-V3.md](SPEC-V3.md): the owner's answers, Decisions, the 11 phases and Status (v3 wins over everything below). The brief word for word: [SPEC-V3-ORIGINAL.md](SPEC-V3-ORIGINAL.md).
4. [SPEC-V2.md](SPEC-V2.md) (Ball Haunt's rules; SPEC-V3's Phase 11 decisions change the doll, the song and the lasers):
   - the owner's answers, the Decisions table and the 8 phases;
   - the **Status** section for what each finished phase built.
5. [SPEC-ORIGINAL.md](SPEC-ORIGINAL.md): the owner's own full spec (§1–§11), word for word. Every `§` in this file and in SPEC-V2 points into it. Where it disagrees with SPEC-V2's Answers and Decisions, SPEC-V2 wins.
6. [README.md](README.md):
   - §1, the Lagos Life rules the game must keep;
   - §4, the architecture;
   - §5, how to run it and test it.
7. [UPGRADE.md](UPGRADE.md) only for history. Where it disagrees with SPEC-V2, SPEC-V2 wins.

## How the owner works (follow these)

- **One phase at a time.** Finish it, test it, report it, then **stop and wait for the go-ahead**. Never start the next phase on your own. *Exception (2 Nov 2026): the owner said "continue building all other remaining phases until completion without my approval": phases 7–11 run back to back.*
- **Short, plain replies.** No repetition.
- **Build only what the spec says** (SPEC-V3 now). Nothing extra. If the spec is unclear, add a row to its Decisions table and say so in the report.
- **Commit after every finished update, without asking** (the owner, 18 Oct 2026: "always commit every new update"). Stage only that change's files. End commit messages with the `Co-Authored-By` line. **Push each commit** (`git push origin <branch>`; 2 Nov 2026: "keep commiting and pushing to repository for every change made"). Never force-push.
- **The permanent home (30 Oct 2026):** no domain yet, so players use **https://milgogames.pages.dev** (published by `scripts/deploy-site.sh`) and the server is **https://emilgo-games.fly.dev** (Fly.io, London; `fly.toml`, `fly deploy`; the owner pays Fly). Later, with emilgo.app: play.emilgo.app and api.emilgo.app. The owner buys the domain, makes the Fly account and sets every secret with `fly secrets set` — never in the repo or the chat. README §6 has the steps.
- **Deploys are paused, except the owner's test site** (30 Oct 2026: "deploy this on cloudflare so i can play with my mobile phone"): **https://milgogames.pages.dev** (Cloudflare Pages project `milgogames`, wrangler is logged in). Republish it after each phase. `scripts/play-live.sh` builds the last commit, starts the game server on this Mac (port 8799, data in `data/live/`) behind a Cloudflare quick tunnel and republishes the site pointing at it; `scripts/play-live.sh stop` ends it. The owner runs it (Claude's permission check blocks opening the tunnel). Without it the site plays Practice only. Everything else (Lagos Life, EAS, the Docker server) stays paused.
- **After any change under** `src/`, run `npm run game:embed` from the repo root. It writes the app's copy, `src/games/emilgo-games/redlightHtml.generated.ts`, which is committed.
- **Never use Squid Game's music, doll voice, score, doll design or colours.** They are Netflix IP and Vatar Agreement §3.3 / §4(i) forbids them.
  - The song is the traditional, public-domain playground chant "Mugunghwa kkochi pieotseumnida", synthesised.
  - Since v3 Phase 11 there is no doll: the song comes from the sky and an eye in the sky watches (`world/skyWatcher.ts`).
  - No words, lyrics or song title on screen.
- **Real test keys live only in** `server/.env`, which is git-ignored. Never print them or put them in the game.
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
| Doll | Replaced in v3 Phase 11 (the owner's answer): no doll; the song comes from the sky, an eye watches, the sky laser strikes. |

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
`updateSkin`, `posed`). **Any code that turns a bone by hand must call**
`posed()`, or the skin won't follow. The skin is detached, so three.js's
CPU skinning (`getVertexPosition`) already returns world positions.
- Tiers: `graphics/tiers.ts` (`LOW_END_GPU`, `autoTier`); Auto's step down:
`session.ts` `stepDownIfStruggling`; the governor: `core/quality.ts`.
- The eye in the sky is made on first use: `session.ts` `doll` (a getter;
`dollObj` is null until then; it comes from Ball Haunt's chunk).
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
`dev/humans.html?gen=1` shows the generated people.
- Shadow stand-ins: `graphics/shadowOnly.ts`; `Human.castShadows`.
- The ground solver lying down skins its points by all four weights
(`Body.contactsAll`, stride 20).

## v4 rework: where things are (R1–R10)

- **The operator**: `tools/anim/operator.mjs` bakes the CC0 mannequins onto the game's skeleton; `tools/anim/lite.mjs` writes the EMILGO app's lighter copies. The look: `src/world/human/suit.ts` (a region's edge is found per pixel, so no sawtooth).
- **Assets** (all CC0; `assets-site/` is git-ignored and copied into the site's build):
  - textures and skies: `tools/assets/library.mjs` → `assets-site/lib/tex`, `lib/sky`
  - models: `tools/assets/pipeline.mjs fetch | build [ids…]` → `tools/assets/out/`, then `rsync -a --delete tools/assets/out/ assets-site/lib/models/`
  - props: `node tools/assets/props.mjs` writes `src/maps/open/propTable.ts`. Server and phones place props from it, so the solids agree without loading a model. **Append-only once shipped**: a placement's variant carries the prop's index, so removing or reordering an entry changes what stands where.
  - music and sound: `tools/audio/music.mjs`, `tools/audio/sfx.mjs` → `assets-site/music`, `assets-site/lib/sfx`
- **Controls**: `src/input/layout.ts`; Dead Streets fires from the FIRE circles (`controls.setSurvival`).
- **The worlds' look**: `src/maps/open/art.ts` (each prefab, drawn on its solids), `src/maps/open/build.ts` (ground, sky, rocks and props instanced per cell).
- Traps:
  - Pipeline glTF is quantized and may carry morph targets: `src/assets/cdn.ts` turns attributes to floats before moving or merging, and strips morphs (an instanced prop with morphs crashes three.js).
  - A layout change that adds solids can move the starts and the boards: the city's props go in after the starts and before the boards (adstest and the Flag Duel check this).
  - zsh doesn't split `$ids`: use `${=ids}` when passing a list to the pipeline.
  - Poly Haven is slow from here (about a model a minute, with timeouts): `fetch` retries and writes each `.gltf` last, so run it again to finish the skips.
  - A killed `dev/cdp.mjs` can leave its headless Chrome running a match for hours, and the frame-rate and load numbers suffer. Look for `--remote-debugging-port` in `ps` first.
  - Another session may be editing this tree: for a clean test, `git archive HEAD | tar -x` into a scratch folder, symlink `node_modules`, and build there.

## v4: where things are (scale, Phase 10)

- The room directory: `server/src/directory.ts` (the `Directory`, its `/dir/*` routes,
the nodes' beat), `server/src/dirMain.ts` (standalone, built to
`server/dist/directory.mjs`). Nodes join with `DIRECTORY`, `DIR_SECRET`, `NODE_URL`,
`SHARD`, `NODE_CAP` (README §8). The phone: `src/net/client.ts` asks it first
(`VITE_GAMES_DIRECTORY`, or `?dir=` in dev) and moves on a code from another node or 1012.
- On this Mac: `node server/scripts/cluster.mjs 4` (directory :8800, nodes :8801…,
logs in /tmp/emilgo-cluster; `NODE_CAP=3000` for 10,000), then
`node server/dist/loadtest.mjs --clients 10000 --seconds 120 --dir http://localhost:8800 --ffa find-the-flag,max-royale --menu 0.9 --procs 3`.
Stop it with `kill -INT <cluster pid>`, never `pkill -f` with a pattern (it can kill your shell).
- One room's cost offline: `node server/dist/stepbench.mjs max-royale 24 300`.
- A node logs `slow step N ms: worst room …` (at most every 10 s) when a step runs long.
- Frame rate: `CPU_RATE=4 GPU=1 VIEW=844x390 node dev/cdp.mjs http://localhost:5173/ <out> <script.json>`
with a script that starts a mode and samples `requestAnimationFrame` (SPEC-V4 Phase 7 and 10).
Read `uptime` first: at a load average over ~10 the numbers swing by ±20 fps.
- three.js traps found in Phase 10 (each re-picks a program every draw): one material on
instanced meshes with and without instance colours; a transparent `DoubleSide`
material without `forceSinglePass`; and reading `clientWidth` every frame forces a layout.

## v3 Phase 1: where things are

- Rank: `src/rank/ladder.ts`, `src/rank/xp.ts`; server `server/src/profiles.ts` (DATA_DIR/profiles.db), `Room.onAward` in `room.ts`, the `id`/`rank` messages (protocol 11); session `onRank`, `sendIdentity`.
- Modes as data: `src/content/` (`modes.ts` the launch manifest and `BUILT`, `validate.ts`, `catalog.ts`, `load.ts`); server `server/src/content.ts`. **Add a module to** `BUILT` **when its phase ships**, or its modes stay "Soon".
- Ball Haunt's switch: `FEATURES` in `src/config.ts`. Off since Phase 4 (the test server runs with `BALL_HAUNT=1`).
- The movement kernel: `src/game/core/body.ts`.
- Mouse look: `input/controls.ts` (`lockPointer`, `mouseMode`). Pause hush: `sound.hush`.
- New tests: `ranktest` (set `RANK_SECRET` to the server's `SUPABASE_JWT_SECRET` for the online part) and `contenttest`. The test server now also takes `SUPABASE_JWT_SECRET=test-supabase-jwt-secret-0123456789abcdef`.

## v3 Phase 3: where things are

- The match core: `src/game/core/match.ts` (`Match`, `settingsOf` for Ranked), `module.ts` (`RuleModule`, `MatchEvent`), `reach.ts` (the walk grid). Modules: `src/game/modules/` (`zone.ts`, `items.ts`, `airfall.ts`, `index.ts` builds them in step order). Items and loot tables: `src/content/items.ts` (an item with `effect: null` is never handed out). Numbers: `ZONE`, `LOOT`, `AIRFALL`, `RESPAWN` in `src/config.ts`.
- On screen: `src/world/matchScene.ts` ties a match to everything below (Phase 4's `GameMode` should use it as it is): `skyLaser.ts`, `zone.ts` (the curtain), `items.ts` (items, loot bags, crates, the Ankara parachute, flares), `footprints.ts`, `decals.ts` (scorch and prints); `human/pack.ts` (the worn backpack), `ragdoll.ts` (`roll`, `skyFall`), `crowd.ts` (`strike`, `revive`, `setPack`).
- HUD: `src/ui/play.ts` (zone line, exposure meter, interact, the backpack radial, effect chips, tints); `hud.ts` (`setCompass`'s item diamond), `minimap.ts` (`zone`, crate marks). Sounds: `sound.ts` (`skyWarn`, `skyHit`, `pickup`, `useItem`, `full`, `flare`, `crate`, `heartbeat`, `zoneAlert`).
- Try it: `npm run game:dev`, then `/dev/open.html?play=1` (`&fast=4` brings the zone and Airfall sooner, `&seed=n`, `&tier=0|1|2`, `&auto=1` tours the city). `window.__match` is the match, `window.__ms` the scene, `window.__play` the numbers. **Editing** `src/` **while a headless run is going reloads its page** (Vite): don't, during a perf gate.
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

## v3 Phase 11: where things are

- **No Mama.** `world/skyWatcher.ts` is the eye (same calls the doll had: `setSinging`, `setWatching`, `caught`, `placeAt`); `world/skyLaser.ts` strikes whoever is caught (`session.ts` on a "moved" elimination, and `rlgl/replayView.ts` in replays). `world/doll.ts`, `world/lasers.ts` and the doll's look in `world/human/`* are deleted. The song's echo is `sound.ts` `skySend`.
- **Ball Haunt's chunk**: `src/modes/rlgl.ts`, loaded by `Session.loadRl` (`withRl` runs a start once it's here; `rlgl` is the module, null until then). **Don't import Ball Haunt's modules (rules, world, walkout, tutorial, replays, songs, the eye) from the lobby's code**; take types with `import type`. Light pieces the lobby needs: `game/phases.ts`, `flow/walkoutButtons.ts`.
- **On the shared core**: `game/rules.ts` `RedLightRound` wraps a `Match` with `game/modules/doll.ts` (the cycle, the line, swings, judging) and `game/modules/balls.ts`. `Match` moves bodies by `MatchWorld.course` when there is one (the corridor), not its `space`. The wire, the rooms and `OnlineRound` are unchanged. The rules tests set `phase`/`phaseTime`/`phaseDuration` through the wrapper's setters.
- To show Ball Haunt: `FEATURES.ballHaunt = true` in `src/config.ts` (the server reads it too), then `npm run game:embed` and redeploy.

## v3 Phase 10: where things are

- **Three builds**: `npm run game:build` → `dist/` (the site Lagos Life frames: its SDK tag, the matches' code in its own chunk); `npm run game:embed` → the EMILGO app's single file (the chunk inlined); `npx vite build --mode web` → `dist-web/` (the game on its own site: split, no Lagos Life SDK). `scripts/deploy-site.sh` deploys the web build; `BUILD=lagoslife scripts/deploy-site.sh` the one Lagos Life frames.
- **The matches' chunk**: `src/modes/v3.ts` (FfaMode and the open worlds' builders), loaded by `Session.loadV3` (in idle time after the lobby is up, and by `ensureNaija` / `ensureSpooky`). **Don't import** `modes/ffa`**,** `maps/open/`* **builders,** `game/modules/`* **or** `world/{ffa,deadView,billboards,…}` **from the lobby's code** (session, screens, hud): it pulls them back into the boot script. The lobby's needs live in `game/weekly.ts` and `maps/open/route.ts`. If the chunk can't load, `matchLoadFailed` says so on Play.
- Boot: Ball Haunt's course textures are painted on first use (`Session.atlas`); no render before `start()` (`Session.started`); the welcome picture only when the script came quickly (`main.ts` `showArt`).
- Dailies: `game/progress.ts` (`V3_POOL` while `FEATURES.ballHaunt` is off), counted in `Session.onFfaEnd`, shown on the results (`FfaResultView.completed`).
- Measuring the boot fairly: build the last commit into a scratch folder, serve both (`vite preview --outDir …`), and alternate (`dev/cdp.mjs` with `CPU_RATE=4 NET_KBPS=1600 NET_RTT=150`, the `eg:` marks). Single runs swing by a second on this Mac.

## v3 Phase 9: where things are

- The boards in the cities: `src/maps/open/billboards.ts` (`placeBoards`, `BoardSlot`, `faceOf`; sizes `BOARD_SIZE` in `prefabs.ts`, prefab `billboard`, drawn in `art.ts`). Wishes: `BOARD_WISHES` in `naija.ts`; Spooky World's along the route in `spooky.ts`. **New boards go on the end of a wish list** (a board's id is its place there, and ads are booked by id), then add the row to `game_billboard_slots` in the migration (adstest fails until the two lists agree).
- On screen: `src/world/billboards.ts` (`BillboardView`: the atlas, house boards, the rotation, the film, the seconds seen), created in `FfaMode` (`boards`); the feed and the report: `src/net/ads.ts` (`adsUrl`, `fetchFeed`, `reportSeen`); the session's side: `Session.adFeed`, `houseInfo`, ModeHost `boardFeed` / `houseInfo` / `boardsSeen`; `OpenWorld.cellOn`. Settings `adsAudio`, `adsVol` (Audio tab; hidden in Lagos Life).
- Game server: `server/src/ads.ts` (`Billboards`: `/ads/v1/match`, `/ads/v1/seen`, the one-use tokens, the minute's flush; `SupabaseAds`), routes in `server/src/index.ts`, counts in `/metrics` (`ads`).
- The ad stack: `supabase/migrations/migration_game_billboards.sql`, its test `supabase/tests/test_game_billboards.sql` (not yet run: run it in the SQL editor after the migration).
- The app: the portal `app/advertise/index.tsx`, `src/services/billboards.ts`; checkouts and webhooks `server/adBilling.ts` (registered in `server/routes.ts`; Paystack's webhook in `server/paystack.ts` hands billboard charges to it); the review queue `components/admin/BillboardReviews.tsx` (the Ad console's Billboards tab).

### Billboards: the owner's steps (nothing here is done for you)

1. Run `supabase/migrations/migration_game_billboards.sql`, then `supabase/tests/test_game_billboards.sql` (it rolls itself back; every row should say PASS).
2. Make two long random secrets (32+ characters each). In the SQL editor:

   `UPDATE public.game_ads_config SET game_key_hash = encode(extensions.digest('<GAME_ADS_KEY>', 'sha256'), 'hex'), billing_key_hash = encode(extensions.digest('<AD_BILLING_KEY>', 'sha256'), 'hex');`
3. Game server (Fly): `fly secrets set SUPABASE_URL=… SUPABASE_ANON_KEY=… GAME_ADS_KEY=…`, then `fly deploy`. Without them every board shows house boards.
4. App server: `AD_BILLING_KEY`, and each provider's keys as you get them (`PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY` + `FLUTTERWAVE_WEBHOOK_HASH`, `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`), `ADS_RETURN_URL` (the portal's address, e.g. `https://<your site>/advertise`) and `ADS_RETURN_ORIGINS`. Point the providers' webhooks at `/api/webhooks/paystack`, `/api/webhooks/flutterwave`, `/api/webhooks/stripe`. Stripe must be able to charge in NGN on your account; if it can't, leave Stripe off.
5. Set the real prices: `UPDATE public.ad_billboard_prices SET rotation_cpm = …, premium_cpm = …, min_budget_naira = …, placeholder = FALSE;`
6. Make yourself an admin (service role) to see the queue: `UPDATE public.users SET is_admin = true WHERE username = '<you>';`

## v3 Phase 8: where things are

- The run's extras are in `src/game/modules/survival.ts` (kinds, the beam, noise, finds, the Last Stand; loadout params `weapon`, `perks`, `charms`, `mods`, `mutator`; `runMutator`, `dailySeed`, `medalOf`), numbers in `SURVIVAL` (`src/config.ts`), lore in `src/content/lore.ts`. Screen side: `world/deadView.ts`; the ghost: `src/game/ghost.ts`; the loadout: `Screens.playRun`; the summary map and photo: `Screens.ffaResults`, `drawRunMap`.
- Server: `runstart {daily}`, `runend {wp, charm}`; the daily board in `server/src/runs.ts` (`putDaily`, `topDaily`).
- Rank rewards: `HOODIE_DESIGNS[].rank` (`world/human/wardrobe.ts`), painted in `scanpaint.ts` (`rankTorso`, the sleeves), checked by `allowedLook(want, owned, xp)`.
- Loading screen: `Screens.matchLoading`, `Session.showLoading`.

## v3 Phase 7: where things are

- Spooky World: `src/maps/open/spooky.ts` (`buildSpookyWorld`: the route, districts, buildings, the thirty obstacles; `run` on the layout: route, sanctuaries, obstacles, hazards, gates; `routeAt`, `routeProgress`). `matchWorldOf` hands `run` to the match.
- The rules: `src/game/modules/survival.ts` (`SurvivalModule`; numbers in `SURVIVAL`, `src/config.ts`). Zombies are bot bodies 1…20 in the match. Items: bandage, medkit, ammo, armour, battery, nv (`content/items.ts`, table `ds-core`).
- The phone: `FfaMode.run` (a `LocalSource` with the zombie pool), `world/deadView.ts` (zombie paint, rising, the torch, night vision, the run's HUD, lightning), `controls.setSurvival`, `Screens.playRun`, `Session.goRun` / `ensureSpooky`. The run's trace goes to the server at the end (`runstart`, `runpart`, `runend`; `runtok`, `runres`).
- The server: `server/src/runs.ts` (`verifyRun`, `RunBoard`, `runs.db`), wired in `server/src/index.ts`.
- Tests: `survivaltest` (offline; `GAME=ws://localhost:8797` adds the online half).

## v3 Phase 6: where things are

- Modes 6–10 are rule modules: `economy.ts` (Hustle), `tag.ts` (Chase & Reverse), `rooms.ts` (Compound Wars; the courtyard is `prefabs.ts` `courtyard`), `riddles.ts` (+ `content/riddles.ts`), `blackout.ts` (Lights Out). Their screen side: `world/modesView.ts`.
- The §10 items' effects and the power-emote cards: `modules/gadgets.ts` (+ `world/gadgets.ts`). The Harmattan: `modules/harmattan.ts`. The danfo hazard: `modules/traffic.ts` (drawn in `world/vehicles.ts`). Zip-lines: `modules/zips.ts`, placed by `zipLines()` in `maps/open/matchWorld.ts` (`Space.topNear` checks the path). The Airfall vote: `modules/airfall.ts` (`ballot`, `vote`; the panel in `modes/ffa.ts`).
- Weekly mutators: `weeklyMutator`, `envOf`, `settingsOf(def, ranked, mutator)` in `game/core/match.ts`; `MoveEnv` in `body.ts`. The server puts `mu` in the start (none when staked).
- Server-only bits: squad pings (`Room.squadPing`, to squad mates only), commends (`Room.commend`, `profiles.commend`), the streak (`profiles` column `streak`; `withStreak` adds `st` to the look in `server/src/index.ts`).
- Client-only: the ping wheel (`ui/quickchat.ts` `setPings`), Form badge and streak in the lobby (`ui/screens.ts`), the unlock ceremony (`Screens.ceremony`), the practice dummy (`LobbyStage.setDummy`, `shoveDummy`).
- Tests: `extrastest` (121 checks, offline); `ffatest`'s network half checks pings and commends; `ranktest` checks streak and commends.

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
node server/dist/extrastest.mjs                         # 121 checks (Phase 6: items, Ranked, modes 6–10, the Harmattan, the extras)
GAME=ws://localhost:8797 node server/dist/survivaltest.mjs  # Phase 7: Spooky World, the route walked, the run's rules, the server's check
GAME=ws://localhost:8797 node server/dist/adstest.mjs   # Phase 9: 46 checks offline (boards, the feed, the server), 7 online
(cd ../.. && npx tsx server/adBilling.check.ts)          # Phase 9: 31 checks, the billboards' checkouts (no network)
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
- `dev/humans.html?set=face&tier=2` shows the character line-ups.

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
