# SPEC-V8: final launch polish (13 Nov 2026)

The owner's words: [SPEC-V8-ORIGINAL.md](SPEC-V8-ORIGINAL.md). v8 wins over v7 where they differ. It takes over
v7's rows that are not finished (3.2–3.5, now B2 and B9).

## Continue here (for the new session)

1. Read this file, then the top of [HANDOFF.md](HANDOFF.md) (the owner's steps, the traps). The brief:
   SPEC-V8-ORIGINAL.md.
2. Run `git log --oneline -8`. v8 commits are named "LOOTLINE v8 (X): …"; the last v7 one is 8f19179 (3.2,
   part 1). The branch is `sdk-54-temp`.
3. **The build order:** Tier A, top to bottom (A1 → A19). Then **STOP**: report to the owner and wait for the
   go-ahead before Tier B. For each row: build, test, commit, push, then set its Status here.
4. Rules that don't change:
   - Commit and push after each finished row without asking. Stage **only that row's files**.
   - **Never commit the owner's own uncommitted edits:**
     - `src/config.ts` (`deadStreets: false`);
     - the Play screen's start CSS in `src/ui/styles.css`;
     - `SPEC-V5.md`'s tables;
     - `HANDOFF.md`'s renumbered reading list and `++` marks;
     - the deleted/moved docs at the repo root;
     - `.cursor/`;
     - `tools/assets/_plan.mts`.
   - Stage `config.ts`, `styles.css` and `HANDOFF.md` from a cleaned copy: HEAD plus only your change, via
     `git hash-object -w` and `git update-index --cacheinfo`. New CSS goes at the end of styles.css, after the
     `/* ── v7 (appended) ── */` marker. Never force-push.
   - Real keys live only in `server/.env` and `tools/audio/.env`: never printed, never in the game.
   - **No `fly` command that creates billed resources** (Redis, apps, volumes, machines). The owner has no
     budget yet. Wire and test locally (`docker compose --profile split`).
   - The protocol (`NET` in `src/config.ts`) is **25 and unreleased**: shared-rule changes ride on it. Bump it
     only after a deploy.
   - The app's embedded copy: rebuild it once at the end, from a `git archive HEAD` checkout
     (`npm run game:embed` from the repo root), never from the working tree.
   - **The wire trap:** `encodeEvent` (src/net/matchWire.ts) uses `k` as the event's type key and maps only
     `id`/`tg`/`by` to roster indices. Never name an event field `k`; send other bodies as contestant indices.
   - Keep replies short.
5. Tests: `node server/build-tools.mjs && node server/dist/<name>.mjs` for:
   - contenttest, treasuretest, extrastest, sharedtest, ffatest, gunstest, spacetest, rulestest, worldtest,
     maxtest, survivaltest, ranktest, solidaudit, servicestest, socialtest;
   - switchtest and matchtest need a live server;
   - ffatest and worldtest can flake under load (timing): rerun.
   Typecheck: `npx tsc --noEmit` and `npx tsc --noEmit -p server`.
6. See it: run `npx vite` (port 5173), then
   `VIEW=844x390 GPU=1 node dev/cdp.mjs "http://localhost:5173/" <out> <script.json>` (390x844 for portrait).
   - Hooks:
     - `__game.practiceFfa(__game.content.manifest.modes.find(d => d.id === "treasure-hunt"))`;
     - `__game.gm.match`;
     - `m.modules.find(x => x.id === "treasure")`;
     - `__game.controls`;
     - `__game.rig`.
   - The HUD overwrites the input pack every frame: drive actions with `m.emit(...)`.
   - The welcome screen is `#boot`: wait about 7 s, then click it.
7. **Auto-resume:** create a session cron, every 15 min, with this prompt: *"If you are idle mid-build, check
   `git log --oneline -5` and games/emilgo-games/SPEC-V8.md's Status columns, then carry on with the next row
   that is not Done, in the order of 'Continue here' step 3 (commit + push each, stage only that change's
   files, never the owner's foreign edits). When Tier A is all Done, report to the owner, delete this cron job
   and wait for the go-ahead. If you are already working, ignore this."*

## The owner's answers (13 Nov)

| Topic | Decision |
|---|---|
| End screens | **Concept A (Field Kit)** for victory ("MISSION COMPLETE") and defeat ("KIA"): `concepts/ui.html` `endScreen`, pictures `concepts/img/ui-A-win.jpg` / `ui-A-lose.jpg`. Kept: today's winner's-circle background and model. Every feature of today's screen is kept |
| Pre-match | **The concept** (`concepts/ui.html` `prematch()`, `concepts/img/ui-prematch.jpg`). Every feature of today's loading screen is kept |
| Ball Haunt | Deleted everywhere, Lagos Life included. Its flying birds move to Free For All first (A19 before B1) |
| The name | **LOOTLINE** replaces "Silo Zone" (v6) and every user-facing "EMILGO" (the EMILGO app isn't published, so players would be confused). Do a web trademark check before using it; if it's taken, tell the owner (backup: GEMRUSH). Code identifiers, package names, the embed's folder and Lagos Life's integration stay |
| Billboards | **Sign-in stays**, as long as it keeps to the Vatar agreement. Fix the unreachable portal. Add **an owner switch** that turns the whole feature on/off at any time: server-side, `server/src/switches.ts`, off by default. Checkout behind one adapter: **Paystack** now, **Flutterwave** ready |
| Treasures | **4, not 5.** The kinds are **precious treasures** from realistic CC0 assets: a gold bar, a silver bar, an emerald, a diamond (a ruby spare). The HUD's line-up of treasure icons becomes small renders of the 3D treasures (one sprite sheet, rendered once); each one lights up and animates (spins, glints) when found. Found treasures still rise out of the chest, now as the real models. **All treasures in chests for now.** The circle icon over a chest that the brief called "the invisible box" is the line-up. Nothing floats over chests |
| Squads | **Win together:** any member's find counts for the squad (no hand-over to the leader); any member uploads what they carry; the squad wins at 4 uploaded. The announcer tells the squad "Your teammate found a treasure". Solo players are unchanged |
| Solo rules | A solo player **uploads in twos** (as soon as they carry 2, not all 4). **A find exposes the finder**: one ping on every rival's map for 8 s. This is the owner's explicit exception to v7's "no hints"; it joins H9's pulse. **A solo player killed after uploading**: their uploaded treasures come off the scan machine under their name and go to the killer's uploaded count. Carried ones drop as now. The win counts uploads after transfers |
| Solo against squads | Anyone can queue alone for a squad match: the room tries to merge them into a squad; if none is found within the wait, they drop in alone against the squads. Invite matches are unchanged |
| Controls | Every in-match control is pushed to the far edges and corners, portrait most of all. Player-arranged layouts keep their own positions |
| Timer | Already gone (v7 question 7). The match ends only when the treasures are uploaded or when the zone shuts completely |
| Services | Shop and payments, and billboards and ads, get their own services like `profileMain.ts` (the same image, `SERVICE_SECRET`, Fly's private network), off unless `SHOP_URL` / `ADS_URL` is set. **`scripts/split-services.sh`** does the whole split when the owner runs it: Redis → `REDIS_URL`, the profile/shop/ads apps, every address and the secret set on the game app, no secret printed. **Automatic:** every service has `min_machines_running = 0` with auto start/stop (asleep costs about nothing); match nodes scale by player count (fly-autoscaler config). **Nothing is created on Fly now** (the owner: "put it on hold") |
| Real guns | Real-looking, light models replace the drawn guns (`src/world/gunsView.ts` `gunGeometry`): CC0 first (e.g. Quaternius); CC-BY only with credit in Settings. Pistol, assault rifle, SMG, shotgun, **plus a DMR/sniper and an LMG**. Each ≤ 3–5 k triangles, meshopt, KTX2 per tier, one atlas, instanced, LOD |
| Shooting | **The Max Mode prompt plus more** (B1). The owner: "very crucial … surprise me" |
| The announcer | **One male, authoritative American ElevenLabs voice** replaces both women's voices; the voice choice in Settings goes. Wire it fully now: `tools/audio/voice.sh` gets an ElevenLabs path (`ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in a git-ignored `tools/audio/.env`). When the key comes, one run records every line. Until then, today's clips play. The key is free (a free account, about 10 k characters a month, enough for every line); **before launch the owner moves to a paid plan** (the free one is non-commercial) |
| Pickup FX #4 | My pick: **Glass Shatter**: a crystal shell forms over the body, cracks, bursts into shards, and the shards fly back into the body |
| Puzzles (future) | **For discussion, not built.** My proposal: map fragments give a **riddle** pointing at a landmark; **landmark puzzles** (light three torches in the order a billboard shows; match the symbols on walls; read a code off a wall to open a vault); seeded per match so they can't be memorised; the server checks every step |

## What the owner hasn't seen, and why (told on 13 Nov)

- **The services:** built in v6 (M10) but asleep until deployed with `REDIS_URL` / `PROFILE_URL`. Shop,
  payments and billboards were kept on the node and not mentioned. B2 fixes that.
- **The end screens and the pre-match screen:** v4 reskinned the old screens instead of building concept A.
  A1 and A2 fix that.
- **The guns:** v4 built ADS, recoil, spread, reloads and hit markers; v6 gave each gun its own sound and fire
  rate. The test site (milgogames.pages.dev) still serves a pre-v5 build, and the app's embedded copy dates from
  v6. After Tier A, the owner runs `scripts/deploy-site.sh` to see the new build.

## Tier A: light (built first, then STOP for the go-ahead)

| # | Item | Status |
|---|---|---|
| A1 | **Victory and defeat = concept A.** MISSION COMPLETE / KIA slams in; the place line; the XP bar rolls (a tick per 50); the rank-up badge pops with a chime; a stats grid (kills, damage, survived, armour tier); award and loot cards flip in by rarity (gold glint on Legendary); the daily chest (the gift); the streak; CP; the table, commends, play of the game and the heat map; CONTINUE / PLAY AGAIN (SPECTATE on defeat); the fanfare and the sting. Over **today's** winner's-circle background and model. Nothing of today's screen is lost (`src/ui/screens.ts` `ffaResults`, ~line 1083) | **Done.** Title slams in; place line (on KIA: weapon · metres); XP rolls with a tick per 50; rank-up badge pops with a chime; KILLED BY line; stats grid (kills, damage, survived, armour T0–T4, tracked in `modes/ffa.ts`); awards as rarity cards flipping in (gold glint ≥ Legendary); CP; chest; streak. The table, commends, play of the game, heat map, run map and reward lines moved to a REPORT drawer. SPECTATE hides the UI to watch the winner's circle. Landscape and portrait checked |
| A2 | **Pre-match = the concept.** The place name big; mode · goal; three tips; 12 player slots filling as they arrive; a streaming bar and "N / 12 ready"; DROPPING IN 0:05 with its whoosh. Kept: the squad cards (names, ranks), the kit cards, the radio line, the runner's extras (`matchLoading`, ~line 1488) | **Done.** The place big, mode · map, the goal, three tips per mode; up to 12 slots filling in; a streaming bar driven by the world build's real steps (over this phone's last build count; the first build eases), its %, "N / 12 players ready"; DROPPING IN with an honest seconds-left from the pace, and a whoosh as it gives way. Kept: squad cards, kit cards, the radio line (now shown on phones too), the runner's extras, Cancel |
| A3 | Restart in Free For All restarts the current FFA match, never another mode | **Done.** The pause menu's Restart called Red Light, Green Light's practice; it now restarts the same FFA practice (or Dead Streets run). Tested: treasure-hunt → Restart → treasure-hunt |
| A4 | The timer: check that no clock or time-up logic is left in FFA. The end comes only when the treasures are uploaded or when the zone shuts and nobody's left | **Done.** Found one left: the Match still ended Treasure Hunt at `time` (960 s), and the HUD's timer was still fed. Now a mode whose zone is the clock plays on past it (`overtime`): the last circle shuts completely (60 s), nobody respawns, and the match ends when nobody's left (a hard stop 60 s later), then the treasure count decides. The watch counts the shutting down. treasuretest has the section |
| A5 | **Top-centre text alerts**: every dialog popup ("Empty treasure"…) becomes kill-feed-style text at the top centre, with no box and no background | **Done.** The Field Kit's boxed "RADIO ›" feed (every treasure, bounty, pickpocket, upload and "Empty box" alert) is now plain shadowed text at the top centre, coloured by kind (red bad, green good), newest first: 2 lines under the treasure line-up in landscape, 3 above the objective in portrait. In-match toasts go the same way (`Screens.toastTo`) |
| A6 | Rank badges off the body; only on the profile card | **Done.** The worn badge's emblem over every head (v6 3.10, `world/ffa.ts`) is gone; it still shows on the profile card. The Awards sheet's line says so |
| A7 | **The name LOOTLINE** (after the trademark check): every user-facing "EMILGO" and "Silo Zone" goes (the title, loading, the link card, the manifest, i18n, the icon via `dev/icon.mjs`) | **Done.** Web check 13 Nov: no game and no live mark named LOOTLINE (nearest: "LOOTLINES", a dead 2024 US filing, class 42; aggregator sites, not a legal search). Renamed: the page title, the home-screen name, the manifest, the welcome logo ("DROP · LOOT · UPLOAD / LOOTLINE"), the get-the-app card, the billboard ad line, the house boards' footers, the credits, the advertiser portal's wording, a suit colour's name, i18n; the icon re-rendered. The link card (`public/card.jpg`) is a game shot with no name on it. Code names, packages, the embed's folder and Lagos Life's integration unchanged |
| A8 | **Billboards:** fix the unreachable portal; the owner's on/off switch; the checkout adapter (Paystack, Flutterwave ready); sign-in kept | Not started |
| A9 | **Treasures:** 4; squads find and win together; the announcer's "Your teammate found a treasure" (`treasure.ts`, config, voice lines, treasuretest) | Not started |
| A10 | **Solo:** uploads in twos; a find exposes the finder (8 s ping); uploaded treasures pass to the killer | Not started |
| A11 | Controls to the far corners and edges, portrait first | Not started |
| A12 | Solo against squads: merge if a squad is found, otherwise go alone | Not started |
| A13 | Jump **significantly higher**; a new, weightier jump sound (still one take, v7 1.6) | Not started |
| A14 | **COD strafe:** left/right keeps the torso and face forward (with v7 2.4's backpedal) | Not started |
| A15 | **Emotes everywhere:** lobby, waiting room, results | Not started |
| A16 | **Gamepad** (PlayStation, Xbox; the browser's standard mapping): move, look, fire (RT/R2), aim (LT/L2), jump (A/×), interact (X/□), sprint (L3), crouch/slide (B/○), backpack, reload; in the app's WebView too | Not started |
| A17 | **Speed ghosting** back: glowing afterimages trail the runner while the Speed booster is on | Not started |
| A18 | **The ElevenLabs wiring** (no key needed to build it): `voice.sh` ElevenLabs path, one male voice set, the voice choice removed from Settings, the new lines (teammate's find, exposure). Recording waits for the key | Not started |
| A19 | **The birds** from Ball Haunt into Free For All's sky (moved before the purge) | Not started |

**→ STOP here: report to the owner and wait for the go-ahead.**

## Tier B: heavy (after the go-ahead), in order

| # | Item | Status |
|---|---|---|
| B1 | **The shooting overhaul, Max Mode, plus real gun models.** Shared and server-refereed in `src/game/modules/guns.ts` (today: hitscan, spread, ADS, bloom, a lag rewind of ≤ 150 ms, headshots, falloff, walls stop shots), `gunsView.ts`, `combat.ts`. **Ballistics:** projectiles stepped per tick on the server (a ray each step, no tunnelling), muzzle speed and subtle drop per gun, per-gun falloff curves, the lag rewind kept; **capsule hitboxes** (head/neck ×2, sniper ×2.5; torso ×1; limbs ×0.75); **penetration** (thin cover cuts damage, solid walls stop). **Handling:** spring recoil with a fixed, learnable pattern per gun and recovery; first-shot accuracy, then bloom from moving, jumping and hip-fire, ADS near zero; ADS breathing sway and a **hold-breath** button (steady 4 s, then a shaky exhale); sprint-to-fire delay; **tactical vs empty reload**; scopes (red dot, 2×, 4× on the DMR). **Feedback:** **suppression** (whiz, the edge blurs and darkens, a little aim shake); the victim's directional flinch; **armour break** (the plate shatters, a sound of its own); hit markers by type (body / head / armour / kill) and a kill confirm (red X, skull ping); **the final kill in slow motion** (killcam). **VFX, all pooled, instanced:** randomised HDR muzzle flash (a light on High+ only), tracers every 3rd round, bouncing casings, decals by surface (holes and dust, metal sparks, sand, water, blood mist). **Audio:** a close crack plus a far boom (delayed by sound's speed past 150 m), indoor/outdoor tails, the mechanical layer, whiz, the headshot ping. **Haptics:** `navigator.vibrate`, and in the app a bridge message to expo-haptics. **New guns:** DMR/sniper and LMG. **Budget:** Low at 30 fps on a throttled CPU, ≤ 6 extra draws in a firefight, no allocations per shot | Not started |
| B2 | **The services split:** shop/payments and billboards/ads services; `scripts/split-services.sh` (Redis, apps, addresses, secrets; nothing run on Fly); auto start/stop on every service and the node autoscaler config; tested with `docker compose --profile split`; servicestest extended | Not started |
| B3 | **Purge Ball Haunt** (about 44 files: code, assets, server, Lagos Life's entry, tests) | Not started |
| B4 | **Chests and treasures (v7 3.2 finished):** the lid opens (bounce, the lock pops), the real treasure models (CC0 gold bar, silver bar, emerald, diamond) rise and spin; the HUD line-up's sprites from the same models | Not started |
| B5 | **The power-up (Goku):** a blend from run/idle into the stance (feet wide, knees bent, chest out, head back, flexed fists, a roar); time at about 0.4× for 1.5–2 s; the camera detaches to a worm's-eye shot, pushes in and tilts up, shakes at the peak, then eases back. **The aura:** an eruption pillar, a looping silhouette aura (a noise shader, vertex wobble, additive), a cracked glowing ground ring; gold for Strength, cyan for Speed; ≤ 3 draw calls, GPU only, bloom on High+ | Not started |
| B6 | **Four pickup FX:** (1) the original orbit, the pick pose and the 360° camera; (2) electric sparks along the body's contour, centred on the chest; (3) fire skin (glowing cracks and flames over the skin); (4) Glass Shatter | Not started |
| B7 | **The HUD refined**, COD-Mobile-inspired: side clusters, on top of v7 3.1, the Field Kit language | Not started |
| B8 | **6–7 new emotes** (they play everywhere since A15) | Not started |
| B9 | v7 **3.3** 3D trees, **3.4** a real respawn, **3.5** the runner rebuilt (as in SPEC-V7) | Not started |
| B10 | **Run and audio:** a COD-weight run cycle; a realistic sound pass across the game | Not started |
| B11 | **The character overhaul:** a smaller bust, smaller hands, real shoulders; the finger/wrist/shoulder rig; face, nose, eyes and hands as a premium figurine. Limit: a true UE5 face needs a scanned head and hands (CC0 if found, else the owner buys them) | Not started |
| B12 | **Launch check:** Low tier at 30 fps on a throttled CPU across every new system; the embed rebuilt from `git archive HEAD`; the owner's deploy steps in one list | Not started |
