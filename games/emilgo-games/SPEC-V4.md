# EMILGO Games v4 "Max Mode"

The brief, word for word: [SPEC-V4-ORIGINAL.md](SPEC-V4-ORIGINAL.md). The
pictures and the first plan: [concepts/index.html](concepts/index.html),
[concepts/PLAN.md](concepts/PLAN.md) (commit `696b67f`).

**2 Nov 2026: the owner answered and said to build every phase to completion
without waiting for approval**, keeping performance in mind, testing with
about 10,000 users, committing and pushing each change, and carrying on by
itself after each usage-limit reset. Further upgrades come after this build.

v4 wins over SPEC-V3 where they disagree. Everything in SPEC-V3 that v4
doesn't touch stays (the Lagos Life rules, blood behind the setting, no
made-up brands, no child zombies, religious sites respected, Ball Haunt
hidden and untouched).

## Owner's answers (2 Nov 2026)

| # | Question | Answer |
|---|---|---|
| 1 | HUD | **A Field Kit**, plus from C (Pulse): the screen edge reddens when hurt; the zone is an orange heat at the edges; C's health and armour arc moves into A, **at the centre** round the crosshair. The minimap stays top right in **the old game's design**. |
| 1 | Welcome | **Welcome A**, with lobby B's background (the next location, full-bleed). |
| 1 | Lobby | **Lobby A**, plus from lobby B: the next location full-bleed, this week's rotation, your squad's four slots; READY is styled like the PLAY button and still says PLAY; lobby A's loadout section restyled in HUD A's style. |
| 2 | FFA damage | 100 health + armour, gun kills, respawns per each mode's rules, the zone laser kept. **Anything shootable can be destroyed.** |
| 3 | Staked Flag Duel | **Guns too.** |
| 4 | Loadout | Spawn with a pistol; the bigger guns are loot. |
| 5 | World | **Bigger, with more players.** |
| 6 | Hosting | The big world's assets on a CDN (the owner's Cloudflare R2). The app's offline copy keeps the lobby, Practice and a Dead Streets lite. |
| 7 | Assets | **Free (CC0) first.** Set up Megascans (Fab) and Sketchfab ingestion for when the owner has the accounts. |
| 8 | Giants | **No giants.** Armour makes you strong and look strong; no growth. The armour's look gets refined later. |
| 9 | Ball Haunt | Stays hidden and untouched. |
| 10 | Zombies | A health bar over a zombie while it's being shot, showing its remaining life. |
| 11 | Size | Compress the heavy assets, keeping the detail; keep only the vital assets, everything else low-poly and compressed. Built to scale towards 1 million players at once. |

## Decisions (made while building; change any by saying so)

| Topic | Decision |
|---|---|
| Phase order | Guns before the HUD (the HUD shows ammo, reloads and hit markers), so a phase never redoes another's work. |
| Touch look numbers | 0.12° per px of thumb travel at sensitivity 1 for a slow thumb; the boost rises (smoothstep) from 0.15 to 1.6 px/ms up to ×(1 + acceleration); default acceleration 1.4, dead zone 3 px (the step that crosses it counts only past it). Vertical = 0.8 × horizontal at the default sliders. The view chases the touchpad at 0.6 a frame (the stick and keys keep 0.15). Presets: Precise 0.8/0.6, Classic 1/1.4, Fast 1.3/2.4, Linear 1/0. |
| Fixed move stick | Centred 40 px + its radius in from the bottom corner (150 px higher in portrait). A thumb landing more than two radii away gets the stick under it for that touch; Settings has Floating for the old behaviour. |
| The old look-stick settings | "Look stick: always drawn" becomes "Show touch point: on". The horizontal and vertical sliders now scale the touchpad (30% = 1×); the mouse keeps its own feel. |
| Guns: which modes | Every Free For All mode and the staked Flag Duel, except Chase & Reverse and Lights Out (their rules are a touch and a find: a gun would end them in a second). Guns ride with melee (not named in the manifest), so a newer manifest from the server can't drop them. Dead Streets keeps its own gun. |
| Guns: the numbers | Pistol 24 (×1.8 head, 4/s, 12+48), assault rifle 26 (×1.6, 10/s, 30+120), SMG 19 (×1.4, 14/s, 32+160), shotgun 8 × 13 (×1.25, 1.4/s, 6+30). Damage falls to 0.3–0.7× between each gun's near and far range. Rarities: damage ×1.00/1.05/1.10/1.17/1.25/1.35, magazine +0/0/15/25/40/50%. All in `GUNS` (config.ts). |
| Health | 100, plus armour up to 150 (plates of 25 on the ground; armour takes 70% of a hit). Health comes back at 8 a second after 6 s unhurt (respawning modes keep fights flowing). Melee costs health too (fist 18, slap 7, push 4, trip 10, charge 14, a prop 26, a throw 20). |
| Hits | Hitscan from the shoulder the camera looks over, along the camera's aim, so the crosshair is exact; walls stop bullets (Space.ray); the target rewound by the shooter's lag (≤150 ms, as melee). Friendly fire off. Seated in a car you can't be shot (the car takes it); a car's blast now hurts (90 at its heart, 6 m), so does a fuel drum's (85, 5 m). |
| "Anything shootable can be destroyed" | Crates (they give ammo, a plate or a gun), fuel drums (they blow, and set off drums near), the street props, and cars. Buildings and the billboards stay (the owner: "leave billboards intact"). |
| Loot | Per 10,000 m²: 2.4 guns, 2 ammo boxes, 2 plates, 2.6 crates, 1.2 drums, placed from the match's seed (the copy places the same). Ammo and plates are taken by walking over them; a gun needs interact. Falling drops your primary and a plate. |
| Keys (computer) | Left button fire, right button aim (held), wheel or Q swap, R reload; with guns the slap moves to Z, the grab to G, the emote wheel to J. |
| Protocol 15 | "in" carries the aim (milliradians) and the gun buttons. **The test server on Fly needs `fly deploy`** (the owner's) before the test site plays online again. |
| HUD A placement | The watch top left under the four buttons (where the clock was; the clock lines go); the plates beside it; the radio left of the minimap (portrait: under it); the objective line under the compass in A's panel. The old minimap stays as it was, top right. Ball Haunt keeps the old HUD (`Hud.setFieldKit` only in Free For All and Dead Streets). |
| The edges | Red: steady from 60 health down, pulsing under 30, a flash on every hit (shot, claw, hazard). Orange: outside the zone, 35% plus the exposure; pulsing when the sky has seen you. |
| Dead Streets' centre | The arc is health (left) and the torch's battery (right, amber); the rounds by it (no spare count: Dead Streets has no magazines); the watch shows the run's clock with the bleed (or the Mast's hold) under it. |
| Zombie health bars | Over any zombie hurt in the last 3 s, within 40 m and on screen, nearest ten; the bar is its health against what it rose with; a Masked one's bar is edged amber (only a head shot puts it down). |
| The operator | Everyone in Free For All and the Dead Streets runner (not the zombies, not Ball Haunt). One material change re-dresses the scanned body on every tier: camo (tri-planar on the bind pose), gloves, boots, a balaclava with one slit (the eyes and the bridge of the nose show; the scanned eyes and lids still move). Three original kits (Ironwood, Ash, Dune), picked by a player's colour. No real-world camo patterns, no brands. |
| Gear and LODs | Helmet (rails, comms, NVG mount), plate carrier (straps, cummerbund, mag pouches), belt, holster, knee pads, boot shells: low-poly pieces weighted to their bones and written into the body's own geometry, so a dressed body is still one draw; each detail level gets its own gear (the far level: helmet, plates and boots only). |
| The armour ladder's look | By armour points (guns: 0–150): T0 Operator, T1 Plated from 25 (pauldrons, vambraces, greaves), T2 Juggernaut from 60 (heavier plates, a collar, a visor with a slit), T3 Warlord from 100 (black plate, spikes, ember glow), T4 Titan from 140 (obsidian and gold, horns, a crown, a glowing core). **No growth** (the owner). Dead Streets' runner by its armour × 1.5. To be refined later (the owner). |
| "Every item becomes armour" | Every backpack item taken also gives 10 armour (up to 150); the items still do what they do. |
| Zombies' look | A rot shader on the scanned bodies (every tier): grey-green mottled skin with veins and lesions, sunken bruised sockets, milky glowing eyes, blood round the mouth (blood on), filthy dark clothes torn through to the flesh with wound edges (red only with blood on). Pieces per kind in the body's own mesh: the Masked a cracked modern gas mask (never a traditional mask), the Bloater a swollen belly, Runners, Screamers, Lurkers and Brutes ribs showing, Shamblers and Brutes a forearm open to the bone; a Brute stands 1.14× (adults only, no child zombies). The kinds' tints now only shift the rot. |
| Zombies' moves | A shambling idle and walk (arms reaching ahead, each its own height, twitching; the chest hunched; the head lolling); emerge (out of the ground clawing at the air, 2.5 s, with the rise), lunge (both arms thrust out when one suddenly closes fast), claw (a raking swipe when it lands one), stagger (the existing hit, from the shot's side). Procedural keys like the rest of the animator. |
| Max tier | A fifth choice in Settings (Auto never picks it): High's tier for people, textures and distances, plus a depth texture on the scene's target and four passes: depth-only SSAO (12 samples, half size, blurred), god rays (the bright pass dragged towards the sun's place on screen when it's in front), depth of field while aiming down the sights (focused on what the crosshair is on, the centre kept sharp), chromatic aberration following the camera's kick (shots, hits). A soft sky as the scene's environment (35%) so helmets, visors, guns and metal catch reflections; 4096 shadows; 340 m view. The grade per location stays as each world's look (LOOKS). Low still fakes it (lights, fog, the CSS vignette). |
| "1 million users at once" | One server process can't hold that. The build makes each room server stateless between matches and adds a room directory so many machines share the load. Tested here at **10,000 simulated players** (the owner's number); the 1M path is described in README (machines × rooms), not tested. |

## Phases (built back to back, no waiting; each tested, committed, pushed, the test site republished)

1. **Look control.** The touchpad look: anywhere on the right half outside the buttons, invisible by default (a setting shows a faint touch point), a dead zone and an acceleration curve, no snap-back or auto-centring, dragging from FIRE also aims. The move stick gets a fixed 1 px white outline. Settings: sensitivity, vertical ratio, acceleration, dead zone, presets.
2. **Guns.** Free For All (and the staked Flag Duel) becomes a shooter: spawn with a pistol; assault rifle, SMG and shotgun as loot in six rarities; ADS, recoil, spread, reload; hitscan refereed by the server with the lag rewind; melee stays as backup; 100 health + armour; destructible props (anything shootable breaks). Dead Streets' gun gets the same feel.
3. **HUD A (Field Kit) hybrid.** For Free For All and Dead Streets: the wrist watch, the plates, the magazine counter, the radio feed; C's arc round the crosshair; the hurt edge; the zone heat; the old minimap top right; hit markers; **zombie health bars**.
4. **Operators and armour.** Tactical gear on the scanned bodies (helmet, balaclava with the eye slit, plate carrier, gloves, boots), LODs per tier; items fill armour; armour tiers show (heavier plates, no growth).
5. **Zombies.** The rot material, the eight kinds, emerge / lunge / claw / stagger.
6. **Max Mode graphics.** A fourth tier, Max (GTAO, god rays, depth of field when aiming, chromatic aberration, a grade per location); helmet and wet-ground reflections; Low still fakes the look.
7. **The world.** A bigger Free For All world with more players, streamed in cells, new locations, more billboards; the asset pipeline (compression, LODs, the CDN loader, Fab and Sketchfab ingestion waiting for the owner's keys); only the vital assets kept.
8. **Sound.** A CC0 sample layer, spatial emitters (turbines, the club), music states.
9. **Screens.** Welcome A, lobby A, the pre-match screen, victory and defeat.
10. **Scale and performance.** The room directory, the 10,000-player load test, frame rate on throttled CPUs, the whole regression suite, docs and the handoff.

## Status

### Phase 1: Look control (done 2 Nov 2026)

| Check | Result |
|---|---|
| In headless Chrome (real GPU, 844×390, Free For All practice) | A tap on the right half (2 px): no turn. A 140 px drag: the camera turned 19° and pitched up; held still for 0.8 s afterwards: no drift, no re-centring. The touch point shows only with its setting on. The move stick sits fixed bottom left with its 1 px white ring; a push from inside it runs; left-handed mirrors both. The Controls tab: presets, the three sensitivities, acceleration, dead zone, touch point, aim while firing, fixed/floating. |
| Builds | typecheck · EMILGO embed 2,832 KB |

Not done in Phase 1: a real phone.

### Phase 2: Guns (done 3 Nov 2026)

| Check | Result |
|---|---|
| Tests | **gunstest 47** (new: which modes carry guns; the loadout; body and head shots; falloff; armour; out at 0 and back with a pistol; no friendly fire; walls; the lag rewind 100 ms yes / 300 ms no; pickups, the swap, reloads; ammo and plates; a crate's loot; a drum's blast; a car dented; melee costs health; the phone's copy the same). Every earlier suite: rules, content, space, world, shared, cars, extras, ffa (offline and 12 phones online), survival, matchtest (the staked Flag Duel, now with guns): all pass. |
| In headless Chrome | Practice: the pistol held in both hands (the arms posed round it), firing, the ammo count, ADS (closer and narrower), the centre arc (health left, armour right), the weapon panel. Online against 11 scripted phones that shoot (`ffaplay --shoot`): their guns in their hands, hits on each other, the damage arc toward the shooter, a gun on the ground over its rarity pillar. |
| Frame rate, CPU 4×, real GPU, 844×390, firing | Low lowest 60, mean 60.2 (49 draws, 37K) · Medium 60 / 60.2 (62 draws, 50K). |
| Builds | typecheck · server · EMILGO embed 2,882 KB (was 2,832) |

Not done in Phase 2: a real phone; the guns' look past low-poly (the sample sounds come in Phase 8).

### Phase 3: HUD A, Field Kit (done 3 Nov 2026)

| Check | Result |
|---|---|
| In headless Chrome (real GPU) | Free For All, 844×390: the watch (8:58, ZONE · 1 LEFT, its arc), the plates (60 armour: two whole, one cracked), the radio by the map, the objective in A's panel, the centre arc; at 26 health the red edge pulsing. Dead Streets: the watch (0:15, BLEED 11:48), the arc as health and torch, the rounds, a zombie's bar over its head at 55% after a hit. Left-handed (mirrored) and portrait 390×844 (FIRE and ADS above the jump cluster, the weapon over the bottom row, the radio under the map). |
| Tests | typecheck; the HUD is the phone's only (no rules changed). |
| Builds | EMILGO embed |

Not done in Phase 3: a real phone.

### Phase 4: Operators and armour (done 3 Nov 2026)

| Check | Result |
|---|---|
| In headless Chrome (real GPU) | `dev/humans.html?set=uniform&gear=ladder`: T0–T4 side by side in the three kits; `set=face&gear=0`: only the eyes and the bridge of the nose show under the helmet; boots, gloves. In a match: your operator from behind, re-dressed as armour fills (T0 → T2 → T4). |
| Frame rate online, 12 operators hunting you and shooting (CPU 4×, 844×390) | Low lowest 59, mean 59.9 (51 draws, 42K) · Medium lowest 47, mean 53.5 (94 draws, 98K): within the limits, near v3's live-match Medium (47.9–60). |
| Tests | gunstest 47 (items now armour too); typecheck. |
| Builds | EMILGO embed |

Not done in Phase 4: a real phone; the armour's look refined (the owner: later).

### Phase 5: Zombies (done 3 Nov 2026)

| Check | Result |
|---|---|
| In headless Chrome (real GPU) | `dev/humans.html?set=eight&zombie=all&blood=1`: the eight kinds side by side, arms out; `set=face&zombie=all&still=1`: the sockets, the eyes, the mouth. A night run: zombies by the runner, lit by the torch. |
| Frame rate, Dead Streets, CPU 4× | Low lowest 60, mean 60.2 (39 draws, 43K) · Medium 40–58 from moment to moment (47–51 draws, 79–96K), the same with the rot shader off in A/B (44.9 / 48.1 / 58.2 as the horde moved): v3's Medium range for a run was 39–59. |
| Tests | survivaltest (online, the server's check of a run); typecheck. |
| Builds | EMILGO embed |

Not done in Phase 5: a real phone; sculpted zombie meshes (an art job, PLAN.md §1).

### Phase 6: Max Mode graphics (done 3 Nov 2026)

| Check | Result |
|---|---|
| In headless Chrome (real GPU, 844×390) | High and Max side by side in Naija World; Max down the sights: the body and the far trees soft, the wall at the crosshair sharp. No console errors. |
| Frame rate (this Mac, no throttle) | High lowest 60, mean 60.1 (56 draws) · Max lowest 60, mean 60.1 (99 draws with its passes). Max is for computers and flagship phones; Auto never gives it. |
| Builds | typecheck · EMILGO embed |

Not done in Phase 6: a flagship phone's numbers.
