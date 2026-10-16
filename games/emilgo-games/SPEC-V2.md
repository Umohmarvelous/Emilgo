# Red Light, Green Light v2: the finalized spec (17 Oct 2026)

The owner's finalized specification (sections 1–11, pasted in chat on
16 Oct 2026) is the rule book. Where it disagrees with [UPGRADE.md](UPGRADE.md),
this file wins. Build strictly to it: nothing extra.

## Answers (owner, 17 Oct 2026)

| Question | Answer |
| --- | --- |
| 20 players, but Lagos Life staked matches are 2–4 seats | **20-player matches are free**, on our server (Invite Friends, Play with New People). **Staked Lagos Life matches stay 2–4** on the same field. Balls scale with players (13 per 20, so 3 for 4 and 1 for 2). Matchmaking starts at 20, or after 60 s with at least 2. No bots online. |
| CP and boosts | **CP is earned only by playing.** Boosts work in Solo and free matches and are **switched off in staked matches**. |
| The 3-second warning hum | **No hum at all.** Hard mode stays: the song stops anywhere, sometimes she stops and doesn't turn. |
| Attacks while the doll is watching | **Only the attacker is shot.** The player who was hit or pushed is forgiven for that movement. |

## Decisions (spec unclear, contradictory, or blocked by the platform)

Change any of these by saying so.

| Spec | Decision | Why |
| --- | --- | --- |
| Voice chat (waiting room, toggle, volume) | Not built | The Lagos Life frame has no microphone. |
| Invite Lagos Life friends | A friends list kept on the phone (add from recent players or your room). Invites and friend requests reach friends who are online in EMILGO Games, as a lobby notification. | Lagos Life gives games no friends list or notifications, and we may not store or link player data. |
| Black suit "during walkout" | The numbered black suit is worn for the **whole match**: walkout, play, bodies. Your own outfit shows in the lobby, the waiting room and after the match. Hair and skin stay yours. | One look on the field, as in the show. The number on chest and back finds you without name tags. |
| Baskets near the safe line | Crossing the line with a ball drops it into the nearest basket by itself: you are safe and it can't be stolen. Crossing without a ball doesn't count; you are still in play. | Gives the baskets a job without another button. |
| Buttons "above the move stick" (§3.2) vs "bottom-right" (§4.3) | Sprint above the move stick, with the stamina bar. Jump, crouch (hold for prone) and emote bottom-right. Fist, slap, push and grab bottom-centre ("vital controls"), shown only when they apply. Left/right hand mirrors all of it. | COD Mobile's own layout. |
| Time per distance | 100 m in 45 s, 200 m in 80 s, 300 m in 120 s, both modes. Checked with the balance sim in Phase 2. | Keeps today's tension (about 2.2 × the running time). |
| "Map size small / medium / large" | In a match it is the distance (short 100, default 200, long 300). In Settings (§7.5 #15) it is the minimap's size. | Two lists use the same words. |
| Desert field (§6.1) vs 24 maps | A new **Desert Field** replaces Desert Dunes (Wild) and is the default. The other 23 maps stay playable with the same doll, lasers, balls, baskets and potholes. | §6.1 and §7.6 together. |
| Weather | Five states: sunny, rainy, sunset, sunrise, night. Light/dark mode switches any map between its day state and night. | §6.2, §6.4, §10. |
| Removed (§3.6, §5.3, §10) | Heat shimmer; snow, ash, embers, storm and lightning, fog banks, dust motes, light shafts, wind sway on plants; the giant traffic lights; on-screen words (waka, freeze), song name, lyrics. A faint fade stays at the far edge only, so distant objects don't pop in. | Not approved. |
| The song | One original Nigerian lullaby. No words or title on screen. The song picker and the other two songs go. | §2.2. |
| "Screen zooms in on the offender" | Your screen gives a 1.2 s zoom on the nearest player caught at that turn (once per turn), then comes back. If it's you: crack, a 2 s kill cam from the doll's eyes, slow-motion fall, hard shake, red vignette, then you spectate. Bodies stay until the end. | You need your view back before the song restarts. |
| Final two, slow motion | The whole room slows (0.4× for 2.5 s): the server slows the referee clock, so it stays fair for both. | One screen can't slow down alone in multiplayer. |
| Skip the walkout | Your skip jumps to "behind the players" and waits there. The countdown starts when everyone has skipped or the walkout ends. | Online, everyone's countdown must match. |
| Tutorial "video" | Played live in the 3D engine: a model plays the whole game, steps highlighted, narrated by the phone's own voice, with captions. | A video file costs megabytes; this costs a few KB. |
| Rotate phone | Tapping rotates the game 90° on screen, so landscape works even with rotation lock on. | The Lagos Life frame forbids fullscreen and orientation lock. |
| Blood | Unchanged: on in Lagos Life (18+), off by default in EMILGO (not age-gated), a toggle in Settings. | |
| Font | Montserrat, Inter, JetBrains Mono, at COD Mobile's sizes (10–14 px). | COD's own font is licensed. |
| Controls RLGL doesn't use (reload, grenade, ability) | In the controls list, hidden in RLGL. | Future games. |
| Language | English and Pidgin. | Same as the EMILGO app. |
| "Fill with CPU" online | Removed. CPUs only in Solo. | §8. |

## File structure

`NEW`, `CHANGED`, `REMOVED`; unmarked files stay as they are.

```
games/emilgo-games/
  SPEC-V2.md                   NEW      this file
  src/
    config.ts                  CHANGED  MODES, DISTANCES (+ fixed times), BALLS (13 per 20), ATTACK (2 m, cooldowns), PUSH, rooms of 20
    settings.ts                CHANGED  the 20 settings, reset to default
    game/
      rules.ts                 CHANGED  referee v4: mode, distance, balls, attacks, pushes, safe-with-ball, end-of-time check
      balls.ts                 NEW      balls and baskets: spawn, grab, drop, 3 s cooldown, lock at the line (shared with the server)
      combat.ts                NEW      fist, slap, push, sprint shoves: range, cooldowns, knockback, the forgiven window
      bots.ts                  CHANGED  CPUs fetch balls, attack and steal (Solo only)
      replay.ts                NEW      snapshot ring buffer: kill cam, final two, play of the game
      highlights.ts            NEW      scores moments: closest escape, best dodge, best attack (shared with the server)
      progress.ts              CHANGED  CP earned per match
      session.ts               CHANGED  shrinks to wiring; the match flow moves to flow/
    flow/                      NEW      the universal match flow, reused by every future game
      machine.ts                        lobby, choose, waiting, loading, walkout, preview, countdown, play, end, post
      waitingRoom.ts                    3D room: a circle (free-for-all) or two sides (teams), ready marks, text chat
      cinema.ts                         camera shots: dolly, orbit, crane, cut
      walkout.ts                        the walk, 4 angles, field preview, skip
      countdown.ts                      5 to 1, pulse, bass drop
      tutorial.ts                       in-engine demo player: steps, highlights, narration
    rlgl/                      NEW      what Red Light, Green Light plugs into flow/
      shots.ts                          walkout and preview shot list (doll close-up, balls and baskets, lasers)
      tutorial.ts                       the tutorial script for both modes
    world/
      human/
        wardrobe.ts            CHANGED  the numbered black suit
        mesh.ts                CHANGED  2,000 / 3,500 / 5,000 triangles
        normals.ts             NEW      generated normal maps: weave, seams, folds, skin
        ground.ts              NEW      feet on the ground: sole solve every frame, terrain height
        lod.ts                 NEW      each character's detail by distance (top detail for the 8 nearest)
        ragdoll.ts             NEW      ragdoll on the body bones, slow motion, rests on the ground
        animator.ts            CHANGED  idle is breathing only; fist, slap, push, carry ball; emotes wave, dance, laugh, cry, taunt, respect, handshake
      doll.ts                  CHANGED  180° turn, head snap, red eyes, close-up mount
      lasers.ts                NEW      laser gun towers round the field: aim, beam, flash
      blood.ts                 NEW      blood particles and ground splats (pooled)
      tunnel.ts                NEW      the walkout walkway
      props.ts                 NEW      ball and basket models
      trafficLights.ts         REMOVED
    maps/
      registry.ts              CHANGED  Desert Field replaces Desert Dunes; states sunny, rainy, sunset, sunrise, night
      recipes.ts               CHANGED  every map carries the field kit at 100, 200 or 300 m
      desertField.ts           NEW      sand, grass patches, mountains, 20–30 details (rocks, cacti, abandoned cars, bones)
      potholes.ts              NEW      puddle water: reflections, ripples, splash when stepped in
      birds.ts                 NEW      small flocks crossing the sky (not vultures)
      sky.ts                   NEW      skybox, scrolling cloud layer (Low, Medium), volumetric clouds (High), sun and moon
      weather.ts               CHANGED  rain only
      world.ts                 CHANGED  lighting for the 5 states, light/dark mode (streetlights, neon)
    graphics/
      tiers.ts                 CHANGED  the spec's numbers
      post.ts                  NEW      High only: colour grade, bloom, vignette
      heat.ts                  REMOVED
    input/
      controls.ts              CHANGED  sticks per §4, sprint toggle/hold/auto, size, opacity, attack and grab buttons
      actions.ts               NEW      the 20 controls: id, icon, key, which games use each
    ui/
      hud.ts                   CHANGED  the §3.2 layout
      minimap.ts               NEW      round, faded edge, terrain; tap for the full map
      killfeed.ts              NEW      top-centre text, slides in, gone after 5 s
      scoreboard.ts            NEW      every player's state
      pause.ts                 NEW      COD pause menu
      rotate.ts                NEW      rotate-phone prompt and 90° rotation
      friends.ts               NEW      friends, invites and requests
      screens.ts               CHANGED  play menu (Invite / New People / Solo), mode and distance, the 20 settings, store tabs
    audio/
      songs.ts                 CHANGED  one original Nigerian lullaby
      sound.ts                 CHANGED  crack, drum, bass drop, hits, splash; master, music and effects volumes
    shop/
      catalog.ts               CHANGED  cosmetics (Game Naira) and 10–20 boosts (CP)
      boosts.ts                NEW      what each boost does; the referee applies them only where allowed
    social/
      friends.ts               NEW      the on-phone friends list and its messages
    net/
      protocol.ts              CHANGED  protocol 4: mode, distance, balls, attacks, flow timeline, skip, invites
  server/
    src/room.ts                CHANGED  20 seats, modes, balls, attacks, flow timeline, skip votes, slow motion, highlight
    src/lobby.ts               CHANGED  matchmaking (20, or 60 s with 2+), staked 2–4
    src/presence.ts            NEW      who is online, invite and request relay; nothing stored
    scripts/rulestest.ts       CHANGED  modes, balls, attacks, pushes, collisions
  dev/
    groundtest.ts              NEW      feet-on-the-ground check on every map and stage
```

## Build phases

Each phase ends tested and waits for the owner's go-ahead.

1. **Clean slate and characters** (§3.6, §5, §10)
   - Remove everything in the "Removed" row.
   - Characters at 2,000 / 3,500 / 5,000 triangles, distance LOD, generated
     normal maps, smooth shading.
   - Feet on the ground in every pose, stance and emote, on every map and
     stage. An automatic test fails any gap over 1 cm.
   - Stillness: idle is breathing only. No jitter from the camera, shadows or
     z-fighting.
   - The numbered black suit.
2. **Referee v4 and server** (§2.1–2.5, §4.4)
   - Classic Run and Ball Haunting; 100 / 200 / 300 m with fixed times.
   - Balls, grab, drop, the attacker's 3 s cooldown, baskets and safe lock, the
     end-of-time ball check.
   - Fist, slap and push within 2 m; sprint shoves; no running through people;
     only the attacker is shot in red light.
   - 20-player rooms and matchmaking; staked 2–4 with scaled balls; CPUs that
     fetch, fight and steal (Solo only).
   - Tests: rules, matches, fairness, load at 20 per room, balance per
     distance and mode.
3. **Desert Field, sky, light and dark** (§6)
   - The field at each distance: sand, grass, potholes with water (sky
     reflection on Low and Medium, a real reflection on High; ripples and
     splashes), mountains, birds, 20–30 details, laser towers, baskets, balls,
     the doll far away at the centre-back.
   - Skybox and scrolling clouds (Low, Medium), volumetric clouds (High); day
     and night lighting; the 5 states; light/dark mode on every map.
   - The other 23 maps get the field kit and the new states, within the prop
     and building triangle budgets.
   - Graphics tiers to the spec; High gets post-processing.
4. **HUD, controls, camera** (§3, §4, §7.4)
   - The §3.2 layout: round faded minimap with terrain (tap for full map),
     text-only kill feed and match info.
   - Sticks per §4; sprint toggle, hold and auto; stamina bar over the move
     stick; buttons as decided; attack buttons within 2 m; grab; the 20
     controls (scoreboard, compass, quick chat, slide and the rest); screen
     shake when pushed.
5. **Match flow** (§1)
   - Play menu: Invite Friends, Play with New People, Play Solo vs AI; mode and
     distance.
   - Waiting room: everyone's model standing in a circle, ready marks, text
     chat; 2 s loading.
   - Walkout in black suits (front, side, behind, overhead), field preview
     (4 sweeps, doll close-up, balls and baskets, lasers, back behind the
     players), skip after entering the arena, countdown 5 to 1 with a bass drop.
   - The tutorial button on first entry, and the in-engine tutorial.
6. **Elimination and highlights** (§2.2, §2.6–2.9)
   - The 10 steps: head snap and crack, zoom, blood and ground splats,
     slow-motion ragdoll that stays, shake, drum, red vignette, red eyes, kill
     feed.
   - Kill cam (2 s from the doll's eyes), the final-two cutscene, play of the
     game.
   - The new lullaby; the 180° turn.
7. **Menus, settings, social, store** (§6.5, §7)
   - COD pause menu; audio; the 20 settings; the rotate prompt.
   - Chat moderation in the match roster (report, block, mute, filter).
   - Friends, invites and requests.
   - Store: 10–20 CP boosts, off in staked matches; cosmetics through Vatar.
8. **Performance and regression** (§8, §9)
   - Low-end profile (Tecno/Infinix class): 30 fps floor; mid-range 60 fps;
     under 100 draw calls and 100K triangles with 20 players; under 5 s to the
     lobby; under 50 MB.
   - Every test, the three builds, the docs, the handoff.

## Status

### Phase 1: clean slate and characters (done 17 Oct 2026, waiting for go-ahead)

| Check | Result |
| --- | --- |
| Feet on the ground (`dev/groundtest.html`: 14 looks × 3 tiers × 28 states, every vertex skinned on the CPU) | **1,176 checks, 0 failed.** Worst gap 0.7 cm, nothing floats. Before: sprinting floated up to 34 cm, running never touched the ground, a fallen body sank 15 cm, crawling sank 11 cm |
| Triangles per person (every outfit × hair × heaviest accessories) | Low 1,792–3,034 (≈ 2,100 typical, ≈ 2,000 in the suit) · Medium 2,772–3,654 · High 3,598–**4,988** (hard ceiling 5,000) · far LOD 974–2,090 |
| Practice round, High, 12 people, Market Square | 37 draw calls, 82K triangles |
| Practice round, Low, Desert Dunes | 23 draw calls, 47K triangles |
| Builds | type-checks clean; Lagos Life `dist/` 247 KB JS gzipped; EMILGO embed 1,114 KB |
| Referee (`rulestest`) | all passed |

Built:
- **Removed**: heat shimmer (`graphics/heat.ts`), snow, ash and embers, storms,
  lightning and thunder, fog as a weather, dust motes and light shafts (maps and
  lobby), wind sway on plants, the waving flag and swaying palms, pulsing
  spotlights and haze cones on the podium, the traffic lights
  (`world/trafficLights.ts`), on-screen words (waka, freeze, hints), lyrics and
  the song title. Map weather is now sunny or rainy.
- **Ground solver** (`world/human/index.ts`): after every pose the lowest point
  of the body, from a hull of points fixed to the bones, is put exactly on the
  ground. Only a real jump or the cheer's hop leaves it.
- **Detail levels** (`world/human/mesh.ts`): far, Low, Medium, High, with a hard
  ceiling per level. **Distance LOD** (`world/crowd.ts`): full detail for the 8
  nearest within 20 m, one step down to 45 m, the far level beyond; you always
  get full detail.
- **Normal maps** (`world/human/normals.ts`), Medium and High: seams, zip,
  waistband, knee and elbow creases, knit ribs, denim twill, hair coils and
  strands, faint skin grain. Nothing finer than four texels (it would alias into
  stripes).
- **The numbered black suit** (`UNIFORM`, `uniformLook`): zip, white piping
  down the outside of sleeves and legs, number on the left chest and big on the
  back. Worn by everyone on the field; your own outfit in the lobby and the
  winner's circle.
- **Stillness**: idle is breathing only (no sway or weight shift).
- UV margins inside each texture region: no skin-coloured line down the back
  seam.
