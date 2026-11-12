# EMILGO Games v7: the brief, in build order

The brief, word for word: [SPEC-V7-ORIGINAL.md](SPEC-V7-ORIGINAL.md) (the 11 Nov brief and the owner's 12 Nov
message). v7 wins over SPEC-V6 where they differ; the 12 Nov message wins over the 11 Nov brief. Status lives
in the table beside each item.

**How it is built (the owner, 11 Nov 2026):** light work first. Tier 1 and Tier 2 are built straight away,
each committed and pushed. **Tier 3 (the heavy build) waited for the owner's go-ahead.** Through all of it:
performance kept as it is (smooth on a medium phone).

**12 Nov 2026, the owner's second message:** a new session builds *everything* to completion ("continue this
session in a new session to build everything together to completion"). Read as **the go-ahead for Tier 3 too**,
after the rows above it. And Treasure Hunt goes back to its own rules (find all 5, upload them), with no hints
of where the treasures are, and gets tougher ideas of its own: the "Treasure Hunt, 12 Nov" table below.

## Continue here (for the new session)

1. Read this file, then [HANDOFF.md](HANDOFF.md)'s top (owner steps, traps). The brief: SPEC-V7-ORIGINAL.md.
2. `git log --oneline -8`: the last v7 commits are named "EMILGO Games v7 (X.Y): …". Branch `sdk-54-temp`.
3. Build order: **H1–H3** (they undo what the owner didn't want: do these first), then **2.6 → 2.12**, then
   **H4–H10**, then **Tier 3 (3.1 → 3.5)**. Each row: build, test, commit, push, set its Status here.
4. Rules that don't change:
   - Commit + push after each finished row without asking. Stage **only that row's files**.
   - **Never commit the owner's own uncommitted edits**: `src/config.ts` (`deadStreets: false`), the
     Play-screen start CSS in `src/ui/styles.css`, `SPEC-V5.md`'s tables, `HANDOFF.md`'s reading-list edits,
     the deleted/moved docs at the repo root, `.cursor/` state. Stage `config.ts`/`styles.css` from a cleaned
     copy (`git hash-object -w` + `git update-index --cacheinfo`); new CSS goes at the end of styles.css after
     the `/* ── v7 (appended) ── */` marker, so the staged copy = HEAD + that block. Never force-push.
   - Real keys only in `server/.env`, never printed, never in the game.
   - Protocol (`NET` in `src/config.ts`) is **25 and unreleased**: shared-rule changes ride on it; bump it
     only after a deploy.
   - The app's embedded copy: rebuild from a `git archive HEAD` checkout (`npm run game:embed` from the repo
     root), never from the working tree. Do it once at the end.
5. Tests: `node server/build-tools.mjs && node server/dist/<name>.mjs` for contenttest, treasuretest,
   extrastest, sharedtest, ffatest, gunstest, spacetest, rulestest, worldtest, maxtest, survivaltest, ranktest,
   **solidaudit** (new, for 2.6). switchtest and matchtest need a live server (ECONNREFUSED otherwise).
   Typecheck: `npx tsc --noEmit` and `npx tsc --noEmit -p server`.
6. See it: `npx vite` (port 5173), then `VIEW=844x390 GPU=1 node dev/cdp.mjs "http://localhost:5173/" <out> <script.json>`.
   Hooks: `__game.practiceFfa(__game.content.manifest.modes.find(d => d.id === "treasure-hunt"))`,
   `__game.gm.match`, `m.modules.find(x => x.id === "treasure")`, `__game.controls`, `__game.rig`.
   Gait: `dev/humans.html?set=move&gear=0`.
7. Auto-resume (the owner wants building to restart by itself after a usage limit): create a session cron,
   every 15 min, with this prompt: *"If you are idle mid-build, check `git log --oneline -5` and
   games/emilgo-games/SPEC-V7.md's Status columns, then carry on with the next row that is not Done, in the
   order of 'Continue here' step 3 (commit + push each, stage only that change's files, never the owner's
   foreign edits). When every row is Done, report to the owner and delete this cron job. If you are already
   working, ignore this."*

## Questions (built as recommended until the owner says otherwise)

| # | Question | Recommended, and built so |
|---|---|---|
| 1 | ~~Treasure Hunt ends the moment a treasure is found. Who wins?~~ | **Withdrawn 12 Nov**: the owner wants the hunt's own rules back (find all 5, upload them). See H1 |
| 2 | The jump: "one sound, the one that sounds real (not like a female voice only but a human voice)" | One take, always the same: the most natural of the recorded efforts. Say if you want a man's voice instead (the body is the woman's, so a woman's effort matches) |
| 3 | The American voice: a woman or a man? | A woman, so the two voices are a straight swap (Settings → Announcer: Mandarin-accented / American) |
| 4 | The health pickup | A **Med Kit**: lies in the world like the other items, goes in the backpack, used from it: +60 health over 3 s, stops the gas's harm for those 3 s; carry up to 2 |
| 5 | Flag Duel (the staked Lagos Life match) | Stays (only Lagos Life opens it); "Treasure Hunt only" hides every other Free For All mode |
| 6 | The trees: "are they not 3D?" | No: each tree is a flat picture of a scan that turns to face you (that is the "moving"). Yes, they can be real 3D and still light: a 2–4 k-triangle copy of each scan with its own texture, drawn instanced. That is Tier 3.3; Tier 1 stopped their sway |
| 7 | (12 Nov) The clock: the 11 Nov brief said "remove the timer"; the 12 Nov message says the hunt's rules stay | **No clock on screen; the zone is the clock.** First to upload all 5 wins at once. If nobody has when the last circle shuts (~16 min), the most uploaded wins, then the most carried, then the last alive |
| 8 | (12 Nov) "Found from a far place" vs "no hint of where the treasures are" | **No hints at all**: no beams, no chests on the map, no compass pin. A chest shows only by its own look and, up close (≤ 35 m, in sight), its shining orbit; real and empty chests look the same. The Map Print item (v6, picked up by choice) stays |

## Tier 1: small changes (one file or one system, no new art)

| # | Item | Status |
|---|---|---|
| 1.1 | Free For All shows only **Treasure Hunt**; XP and Ranked work on it; one switch in the code (`FEATURES.huntOnly`) | Done. `FEATURES.huntOnly` in `src/config.ts` (true now): every other public FFA mode off in menus, the rotation and the server; the staked Flag Duel and the test's City Flag stay. contenttest checks both ways |
| 1.2 | The **Smoke Canister** out of every loot table | Done. Out of `ffa-core` and `airfall`; its rule and look kept, unused |
| 1.3 | Default graphics: **Medium** on laptops and desktops, **Low** on phones | Done. Auto: phones and tablets Low, computers Medium; High and Max by choice |
| 1.4 | **Icons only**, no text labels on items and prompts ("tap to open box", the map viewer…) | Done. The interact button is a round icon (a chest for a box, the upload arrow, a hand); effects show icon + seconds; the backpack shows the item's icon big and icon buttons (use, drop); the map drops its labels and "MAP PRINT"; the daily chest's "Tap to open" is a hand. Words kept for screen readers |
| 1.5 | Phone: the long descriptions off the mode and loading screens (Meridian Max's, "This week"'s…) | Done. On phones (narrow, or landscape under 540 px high) Meridian Max's paragraph, "This week", the blurbs, the ways-to-play lines, the notes, the loading screen's radio line and route are hidden |
| 1.6 | **One** jump sound, always the same | Done. One recorded take (the deepest of the three), always the same, nothing layered (question 2) |
| 1.7 | Free For All's worlds: the faceted stones, the farm's long brown ridges and stems, the houses' bare posts **removed** | Done. The "stone" is the drawn bush (a faceted green blob with no collision); bushes and the Old Farm are left out of both worlds (their ground kept clear, so nothing else moved); the houses' veranda posts gone; Low draws the scanned rocks too (~40 KB). Protocol 25 |
| 1.8 | The zone **slower** (COD-style), the gas slower to hurt | Done. Each circle closes over ~2 min (v6: 40–50 s), the last shut at ~16 min; 8 s warning, then about half v6's harm (1.5 → 10 a second) |
| 1.9 | Running: knees **higher**, the camera steadier (no shake) | Done. The run clips were crouched and stretched up to 35%: now quicker steps (up to 1.9×), 10% stretch at most, legs straighter running (head ~12 cm higher); the camera's sprint bob a third |
| 1.10 | The trees stop **swaying** | Done. No sway. The card still turns to you: real 3D trees are 3.3 |

## Tier 2: one system each

| # | Item | Status |
|---|---|---|
| 2.1 | ~~Treasure Hunt's new rules: no clock; the first real box opened ends the match; boxes seen from far~~ | Built 11 Nov (ac92fa1), **then reversed by the owner on 12 Nov**: H1–H3 undo the instant win and the far hints and keep what still fits (boxes in or near the zone, the treasure kinds, the rise out of the chest) |
| 2.2 | The **Med Kit** (question 4) | Done (2478432). Lies in the world (ffa-core and airfall), up to 2 in the backpack; +60 over 3 s, the gas held off meanwhile; not at full health, not stacked |
| 2.3 | **Near death** (in the gas or badly shot): slower and slower, laboured breath, a slow heartbeat, a struggling voice, COD-style | Done (54bd224). Under 30% health: down to 60% speed, the world muffled, the heart slowing 68 → 42 bpm, breath in and out, a groan past 45% weakness; the server's pace matches |
| 2.4 | **Backpedal** COD-style: back walks you backwards, still facing forward | Done (7c2d3fb). Back (past 112° off your aim) walks you backwards at 60% speed, no sprint, still facing your aim; the legs play the walk in reverse |
| 2.5 | **Sprint and slide** in Free For All, as in the runner | Done (edc3919). While sprinting the crouch button is the slide (its own icon, an orange ring): 0.95 s at 1.1× the sprint, then back up into the sprint. C on the keyboard |
| 2.6 | **Solid world**: no walking into buildings, stones, trees, props; only items are walked through | Done. Every audited prefab now stops a body where it is drawn (only the ramps' drawn steps and a room's 0.5 m beds remain: false alarms). Pines: the boughs start above head height (drawn tiers lifted to clear 1.9 m; the scanned pine impostors cut their lowest needles away, the trunk kept), trunk solid 0.7. Rocks: the scan's own measured footprint, turned as drawn. Tanks and silos: a dodecagon round them. Mangrove roots, the hangar's walls, the plane wreck's tilted wing and debris, the vans, the portrait boards' plinths, plane-tree trunks: solids widened. Posts, poles, goods on tables, ladders, signs, gate posts, planters: their own solids (`bodyParts`, never drawn from). The house gate stands open (its leaves solid). Solids: Naija 1468 → 1844, Meridian Max 4265 → 4853; worldtest, spacetest, maxtest, sharedtest pass |
| 2.7 | **Daily streak**: badges, awards and rewards | Not started |
| 2.8 | The **pickup orbit**: new designs, electric sparks, more cinematic | Not started |
| 2.9 | The **advertiser screen inside the game**, not a browser tab | Not started. Today `session.ts`'s "advertise" opens `VITE_ADVERTISE_URL` in a tab on the web; Lagos Life's in-app screen is the model |
| 2.10 | **Two announcer voices**: the Mandarin-accented woman and an American; a switch in Settings | Not started. The pipeline is `tools/audio/voice.sh` (Kokoro-82M; the owner runs it); clips to `assets-site/voice/` |
| 2.11 | The **backpack straps** follow the shoulder and upper arm's curve | Not started |
| 2.12 | The **welcome screen**: no zombie text, a first-timer's "how it plays" in three pictures, a cinematic background from the game's own world | Not started |

### 2.6, what the audit found (all fixed 12 Nov but the false alarms; `solidaudit` now reads only those)

`server/scripts/solidaudit.ts` draws every placement of both worlds (Naija City, Meridian Max) and samples the
drawn surfaces between 0.5 m and 1.6 m up (where a body would touch them) that no solid covers (12 cm grace).
The prefab solids are in `src/maps/open/prefabs.ts` `parts()`; the looks in `src/maps/open/art.ts`.

| Where | What sticks out of its solid | Fix |
|---|---|---|
| pine, snowpine (590) | low branches to ~2.7 m round a 0.5 m trunk solid | a wider solid at body height (or trim the lowest whorl on the drawn and impostor pines) |
| rock (306) | the drawn rock to ~2.1 m vs a 1.7 × 1.3 box; the **scanned** rock is turned at random (`(v >> 6) % 628`), its solid isn't | turn the solid the same way; size it to the scan's 2.1 s |
| tank (18) | the round tank (radius r) and its ladder vs a square of 0.85 r | a box of 2 r, or two crossed boxes |
| hut (29) | the round wall (radius r) vs a square of 0.85 r | the same |
| house (76) | the fenced house's gate drawn across its opening | solid gate leaves, or the gate drawn open |
| mangrove (70) | the roots arching to 1.1 m vs a 0.8 m trunk | a wider root solid |
| market, buspark, suya | stall posts, queue rails, canopy posts | a solid per post / rail |
| planewreck | the wings and engines lower than the wing solid | lower the wing solid; engines their own |
| hangar | the walls drawn at x ±16, the solids at ±15.3 | move the solids to the walls |
| billboard | the plinth round the pole | a plinth solid |
| plaza | the tree's trunk on the planter | a trunk solid |
| school, petrol, viewing, palmwine, watertower, busstop, chief, courtyard, okada, compound, storey | small bits (a pump, a bench, a ladder, pots) | one by one |
| ridge, dune, stand, overbridge, stilt, uncompleted | the stairs' and slopes' drawn steps | none: the audit reads a ramp's drawn edge as uncovered (false alarm) |
| props | the plants (`SOFT` in prefabs.ts) and any prop under 0.45 m have no solid | plants over knee height solid too; the low ones you step on |
| the impostor trees | not audited (drawn on the phone only) | check one in the game: its trunk solid against the card |

## Treasure Hunt, 12 Nov (the owner: "rules remain the same… find all 5 hidden treasures and upload them"; "no hint of where the treasures are"; "tougher… so it stands out")

| # | Item | Status |
|---|---|---|
| H1 | **The rules back**: find all 5, carry them, upload at the machine (v6: drop all on death, die in the ring and lose them, squads hand to the leader, a 5-carrier marked over the head). Kept from v7: every chest in the zone or just outside it (`area`/`core`), the slower zone, the Med Kit, no clock on screen (question 7) | Done. The v6 rules back (find all 5, carry, upload at the machine; drop all on death; the squad leader uploads; all-but-one marked). The 32 chests within 240 m of the machine (`treasure.area`), the 5 real within 150 m; the circles keep the machine within 0.3 of their radius. **The zone is the clock** (`zone.clock`): the watch counts down to the next circle or to the closing one shutting; the match ends as the last shuts (960 s); then the most carried wins, a tie to the side with more still standing. Ranked: no respawn, 18 s upload. The instant hunt is gone from the code. treasuretest/contenttest follow |
| H2 | **No hints**: off with the beams, the chests on the map within 300 m, the compass pin to the nearest chest; the shining orbit only within ~35 m and in sight (question 8) | Done. No beams, no chests on the map, no compass to them. The shining orbit only within 35 m of the camera and in sight (`space.lineClear`, checked every 0.3 s a box); real and empty look the same. Dropped treasures still show (v6) |
| H3 | The **five treasures** are things: a diamond, gold bars, silver bars, an emerald, a ruby (`TREASURE_KINDS`): each rises out of its chest when found, the feed names it ("Ada found the emerald"), the HUD shows which of the 5 you carry | Done. Each treasure its own model (a brilliant-cut diamond, a stack of gold or silver bars, a step-cut emerald, a ruby); every find rises out of its chest with a bounce and its own light for 2.4 s, then goes with its finder; the feed names it ("You found the diamond! 1/5", "Ada found the emerald"); a strip of the five under the objective: lit, you carry it; ringed, a squad mate does |
| H4 | **Heavy loot**: each treasure carried costs 3% of your speed (5 = 15%), and 4 or more stop the sprint and slide: the greedy are slower | Not started |
| H5 | **Trapped chests**: one empty chest in four is trapped: it shrieks and fires a red flare 30 m up for 6 s, seen by everyone near. Opening is a gamble | Not started |
| H6 | **The upload alarm**: an upload sounds across the map ("Upload started", a pulse from the machine) and shows its countdown to all: the hunt ends in a fight at the machine. The machine's ring shrinks with the zone | Not started |
| H7 | **Pickpocket**: a melee hit on a carrier from behind knocks one treasure loose, without the kill: steal on the run | Not started |
| H8 | **Fool's Gold** (a new item, rare): drop a fake treasure; whoever grabs it is stunned 1.5 s and pinged on every map for 3 s | Not started |
| H9 | **The carriers' pulse**: every 90 s each player carrying 3 or more shows on everyone's map for 2 s (where the *players* are, never the chests) | Not started |
| H10 | **Bounty**: whoever leads (most carried + uploaded) has a bounty; their killer gets bonus XP and a feed line | Not started |

## Tier 3: the heavy build (go-ahead given 12 Nov, after the rows above)

| # | Item | Status |
|---|---|---|
| 3.1 | **Lobby and HUD redesign**: the top bar's buttons (Lobby, Loadout, Store, Friends, Clan, Leaderboard) join the tabs, and the tabs move to the top; easy to reach in portrait; the lobby with more detail; a HUD in the big shooters' league (COD, Free Fire), our own style | Not started |
| 3.2 | **Realistic chests** (wood, iron bands, a lock, a lid that opens) and the **treasure reveal**: a diamond, gold bars, silver bars, an emerald… rising out of the right box and bouncing in the air | Not started (H3 moves today's rise to every find; 3.2 is the chest and the reveal's art) |
| 3.3 | **3D trees**, light: a 2–4 k-triangle copy of each scan, instanced (question 6) | Not started |
| 3.4 | **A real respawn** (a drop-in, the body landing and rising, the camera following) | Not started |
| 3.5 | **The runner, rebuilt**: on Free For All's maps, billboards on every road (portrait and landscape, ads always running), obstacles that fight back, no levels, XP but not rank, the toughest runner going, competitive | Not started |
