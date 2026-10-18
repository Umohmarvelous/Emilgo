# Red Light, Green Light v2: the finalized spec (17 Oct 2026)

The owner's finalized specification (sections 1–11, pasted in chat on
16 Oct 2026, saved word for word in [SPEC-ORIGINAL.md](SPEC-ORIGINAL.md)) is
the rule book. Where it disagrees with [UPGRADE.md](UPGRADE.md),
this file wins. Build strictly to it: nothing extra.

## Answers (owner, 17 Oct 2026)

| Question | Answer |
| --- | --- |
| 20 players, but Lagos Life staked matches are 2–4 seats | **20-player matches are free**, on our server (Invite Friends, Play with New People). **Staked Lagos Life matches stay 2–4** on the same field. Balls scale with players (13 per 20, so 3 for 4 and 1 for 2). Matchmaking starts at 20, or after 60 s with at least 2. No bots online. |
| CP and boosts | **CP is earned only by playing.** Boosts work in Solo and free matches and are **switched off in staked matches**. |
| The 3-second warning hum | First "no hum at all"; **changed the same day: hum + fake hums.** Every turn is warned by a 3 s hum under the song, but about a third of hums are fake (she sings on and doesn't turn). Never two fakes running, never before her first turn. The fake hum replaces the old silent feint. |
| Fighting when players get close | **Never automatic** (owner, 17 Oct 2026): until a player taps fist, slap or push, runners near each other just run. Sprinting into someone is only a bump: no shove, no stagger (this overrides §2.4 and §4.4's "push mechanic, no button"). CPUs swing only to take a ball off its holder. |
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
| The song | **Changed by the owner (17 Oct 2026):** "the original Red Light, Green Light song". She sings the traditional Korean playground call "Mugunghwa kkochi pieotseumnida" (public domain words, the plain playground chant), synthesised, in her own voice, teasing the pace like a real caller. Never the show's recording, melody or score. No words or title on screen. The song picker and the other songs are gone. | The show's music is Netflix's; Lagos Life requires we own everything (Vatar Agreement §3.3, §4(i)). |
| The doll's look | **Owner's choice (17 Oct 2026): the giant schoolgirl doll.** Bob with two pigtails, big glassy eyes, rosy cheeks, a green pinafore with bib, straps and buttons over a white shirt, knee socks, black shoes; about 12 m tall. Built on the players' generator, so she's smooth. Our colours, not the show's orange and yellow. | The show's doll design is Netflix's. |
| "Screen zooms in on the offender" | Your screen gives a 1.2 s zoom on the nearest player caught at that turn (once per turn), then comes back. If it's you: crack, a 2 s kill cam from the doll's eyes, slow-motion fall, hard shake, red vignette, then you spectate. Bodies stay until the end. | You need your view back before the song restarts. |
| Final two, slow motion | The whole room slows (0.4× for 2.5 s): the server slows the referee clock, so it stays fair for both. | One screen can't slow down alone in multiplayer. |
| Skip the walkout | Your skip jumps to "behind the players" and waits there. The countdown starts when everyone has skipped or the walkout ends. | Online, everyone's countdown must match. |
| Tutorial "video" | Played live in the 3D engine: a model plays the whole game, steps highlighted, with captions. **No spoken voice** (the owner had the narration removed, 18 Oct 2026). | A video file costs megabytes; this costs a few KB. |
| Rotate phone | Tapping rotates the game 90° on screen, so landscape works even with rotation lock on. | The Lagos Life frame forbids fullscreen and orientation lock. |
| Blood | Unchanged: on in Lagos Life (18+), off by default in EMILGO (not age-gated), a toggle in Settings. | |
| Sprint in Settings (§7.5 #9, #10) | One "Sprint" choice: Toggle (tap on, tap off; COD), Hold, or Auto (a full push sprints). Toggle is the default (§3.5, §4.5). | Auto-sprint and toggle-vs-hold are one setting with three answers. |
| Compass (§7.4 #17) | A strip under the top centre, above the kill feed: N/E/S/W, the bearing, and a diamond for the doll (red while she watches). North is towards the doll. | Where COD Mobile puts it. |
| Quick chat (§7.4 #20, "ping") | Six fixed calls (Go, Wait, Watch out, Help, Nice one, Sorry), one tap each. Online they go to the room's chat; in Solo they show over your head. | Fixed words need no filter. |
| Font | Montserrat, Inter, JetBrains Mono, at COD Mobile's sizes (10–14 px). | COD's own font is licensed. |
| Controls RLGL doesn't use (reload, grenade, ability) | In the controls list, hidden in RLGL. | Future games. |
| Language | English and Pidgin. | Same as the EMILGO app. |
| "Fill with CPU" online | Removed. CPUs only in Solo. | §8. |
| Starting a room (Phase 5) | **Invite Friends** (a private room): it loads when everyone in it, two or more, has tapped Ready. The old "Start now" button is gone; after a round everyone is un-ready again, so nobody is pulled into a round they didn't ask for. **Play with New People**: the same, but it also loads when 20 are in, or 60 s after the second person arrives, ready or not. **Lagos Life match**: no Ready button; being there is being ready (the stakes are in). It loads when everyone in the match has arrived, or after 30 s. | Strangers can't hold a public room hostage; friends wait for each other. |
| The 2 s loading | When the room loads, the server picks the map first and tells every phone, which builds it under a loading bar. Nobody can join during those 2 s. Solo shows a short loading card instead. | §1.2; the map is ready when the walkout starts. |
| Walkout length | 9 s of walk (front, side, behind, overhead), then the preview: 4 sweeps of 1.6 s, Mama 2.4 s, the balls 1.1 s and baskets 1.1 s (Ball Haunting only), the lasers 2.2 s, back behind the players 1.4 s. 21.4 s in all for Classic Run, 23.6 s for Ball Haunting. Skip shows after the 9 s walk. Mama faces the field for her close-up and turns back to the wall as the countdown starts. | Every phone cuts on the same clock (the referee's walkout phase). |
| Play menu (§1.1) | Invite Friends (make a room and share its code, or join one with a code), Play with New People, Play Solo vs AI, plus Lagos Life match where the platform allows it. The old Private room and Join with code are both inside Invite Friends. Mode, distance and map are picked on the same screen. | §1.1's three choices; staked matches have their own path. |
| Tutorial (§1.5) | Offered with a button through the walkout and countdown of your first Solo match, and always from the Play menu, the lobby's help button and Settings. A real round on the short field (100 m) in the mode you picked, with three scripted people: Ada (the model) keeps every rule, Tunde runs through her first stare and is caught, and in Ball Haunting Bisi slaps Ada's ball loose. Steps light up as they happen, with captions (no spoken voice). The old "How to play" sheet is gone. | Every step is sure to happen (tested on 30 seeds per mode). |
| Mode of a staked match | Every staked Lagos Life match is **Ball Haunting, 200 m, 80 s**, with one ball fewer than players (1 for 2, 2 for 3, 3 for 4). The match screens say so before anyone stakes. One line to change (`STAKED` in `src/config.ts`). | Lagos Life's match API carries only stake and seats: there is no way to agree a mode, so all staked matches must play the same one. The owner's answer asked for scaled balls in staked matches. |
| Attack details (spec gives none) | Range 2 m. Fist: knocks you back 1 m, stuns 0.8 s, 1.6 s cooldown. Slap: 0.35 m, 0.35 s, 0.8 s. Push: 2.4 m, 0.25 s, 1.2 s. Every hit knocks a held ball loose. Sprinting into someone shoves them 1.4 m (once a second per pair). Grabbing takes 0.35 s, and counts as moving while she watches. | A fist is the big hit, a slap the quick one, a push moves people furthest. |
| A ball's holder caught by the doll | The ball drops where they fall, free for anyone. When every ball is in a basket, everyone still on the field is out ("no ball left") and the round ends. | Nobody can win without a ball, so there's nothing left to wait for. |

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
      songs.ts                 CHANGED  one song: the traditional Mugunghwa call
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

### Phase 5: Match flow (done 18 Oct 2026)

| Check | Result |
| --- | --- |
| Solo, start to finish, in headless Chrome | Play menu → loading → walkout (all four angles) → field preview (4 sweeps, Mama, the balls, the baskets, the lasers) → behind the players → countdown 5 → 1 → play |
| Online, the browser and 5 scripted players (and 19 in a room) | the waiting room's circle with ready marks, Ready, the 2 s loading bar, the walkout on the announced map, skip (after the walk) → the countdown for everyone at once |
| Layout, landscape 844×390 and portrait 390×844, right- and left-handed | nothing overlaps (the tutorial button moves to the top centre once the controls show) |
| Cost during the walkout, 20 people | High: 67 draw calls and 97K triangles at the worst moment (behind the players, everyone close). Low: 53 and 62K |
| Tests | rules 81/81 (13 new: the walkout, skips, countdown; 2 new: the tutorial shows every step and the model crosses, 30 seeds per mode) · balls test now also checks ready marks, the loading, the door shutting, the walkout and skips: all passed · match, shop all passed · fairness 7/7 · load 600 clients: 0 failures, tick p99 6.8 ms, 6.4 KB/s |
| Builds | Lagos Life `dist/` 277 KB JS gzipped; EMILGO embed 1,206 KB. **Protocol 7**: the Docker server on :8787 must be rebuilt |

Built:
- **The flow** (`flow/machine.ts`): lobby → Play menu → waiting room →
  loading → walkout → preview → countdown → play → end → results. Written for
  every game; a late server message can't drag the screen backwards.
- **Play menu** (`ui/screens.ts`): Invite Friends, Play with New People, Play
  Solo vs AI (and Lagos Life match); mode, distance and map on the same
  screen; the Tutorial button by Start.
- **Waiting room** (`flow/waitingRoom.ts`, `world/lobbyStage.ts`):
  everyone's model in their own outfit, standing in a circle with you at the
  front; the camera rises and pulls back as the circle grows (checked with
  6 and 19, both orientations). Name tags carry a ready tick;
  the count of ready players top right; Ready / Not ready and Leave at the
  bottom; text chat as before. Everyone ready: the 2 s loading bar while the
  map is built.
- **Referee and server, protocol 7**: a new first phase, `walkout`, in which
  nobody moves and the clock doesn't run. Skips count only after the walk,
  and when everyone still connected has skipped, the countdown starts for all
  (CPUs never hold it up). The countdown is 5 s. New messages `ready` and
  `skip`; `start` is gone.
- **Walkout** (`flow/walkout.ts`, `flow/cinema.ts`, `world/tunnel.ts`): a
  plain concrete tunnel behind the start (about 300 triangles) and a walkway
  to the start line. The players file out in the black suits, two or four
  abreast, each to the place the referee gave them, filmed from the front,
  the side, behind and overhead. No name tags, flags, crowd sounds or lights.
- **Field preview** (`rlgl/shots.ts`): four sweeps, Mama close up, the balls
  where they lie and the baskets past the line (Ball Haunting), the laser
  guns, then down behind the players, exactly where the game camera starts.
- **Skip**: a skip button bottom right once everyone is in the arena; your
  lens jumps behind the players and waits there.
- **Countdown** (`flow/countdown.ts`): 5 → 1, big in the centre, no words,
  each number on a synthesised bass drop, the last one deepest.
- **Tutorial** (`flow/tutorial.ts`, `rlgl/tutorial.ts`): see Decisions.
- Fixed on the way: an error from a background check (the friends counts)
  no longer pulls the Play menu over the lobby or a Solo round.

### The hum and no automatic fights (17 Oct 2026, between Phases 2 and 3)

- Referee: phase 2 is now `hum` (3 s, the song plays on under it); at its end
  the referee decides, in secret, whether she turns or sings on (38%, never
  twice running, never before her first turn). Protocol 5.
- The sprint shove is gone: bodies still never pass through each other, but a
  bump changes positions only. CPUs no longer swing at whoever is close;
  in Ball Haunting they attack only the player holding the ball they want.
- `rulestest` 61/61 (every one of 394 turns came after a hum; 127 of 536 hums
  fake; running through a hum is safe; sprinting into someone staggers no
  one). Balance (20 players): a sharp player (0.25 s) crosses 100% of rounds
  in 25 / 50 / 75 s of the 45 / 80 / 120 s; 0.45 s: 27% / 7% / 1%; walking
  never makes it.

### Phase 4: HUD, controls, camera (done 17 Oct 2026)

Also in this phase, at the owner's request: the new song and the new doll
(see Decisions).

| Check | Result |
| --- | --- |
| Layout, landscape 844×390 and portrait 390×844, right- and left-handed | nothing overlaps; screenshots of the HUD, sprint, kill feed, full map, scoreboard, quick chat, settings |
| The slide, through the real buttons | sprint, then crouch: slides 0.75 s, crouched after |
| Tests | rules 66/66 (5 new: the slide) · match, balls, shop all passed · fairness 7/7 · load 600 clients: 0 failures, tick p99 7.7 ms, 6.2 KB/s |
| Builds | Lagos Life `dist/` 270 KB JS gzipped; EMILGO embed 1,184 KB. Protocol 6: the Docker server on :8787 must be rebuilt (Docker wasn't running) |

Built:
- **HUD, §3.2** (`ui/hud.ts`): top left, text only: the clock, mode and
  distance, who's still in, how far you've run, the round trip online; under it
  pause, settings, scoreboard and first person. Top centre: the compass, then
  the kill feed ("[Name] was eliminated", no background, slides in, gone after
  5 s). Top right: the minimap. Centre: the countdown numbers, the verdict.
  On a tall screen the compass and feed sit under the top row.
- **Minimap** (`ui/minimap.ts`): round, faded edge, slightly see-through, over
  a top-down picture of the map taken at the start of each round; turns with
  your view; you, runners, the safe, the out, balls, baskets, the doll (red
  while she watches). Tap (or M) for the full map, north up. Small, medium or
  large in Settings → Game.
- **Controls** (`input/controls.ts`): icons only, no words anywhere. Sprint
  above the move stick with stamina round it, and a stamina bar above the move
  stick while you sprint or recover; Toggle, Hold or Auto. Sticks: 1 px white
  ring, a centre dot, the thumb; size and opacity in Settings. Jump, crouch
  (hold: prone), emote, quick chat and chat bottom right; fist, slap, push and
  grab bottom centre only when they apply. All mirrored by "Swap sticks".
- **The slide** (shared move code, protocol 6): crouch while sprinting and you
  slide on, low, for 0.75 s, no steering, slowing to a crouch; counts as
  moving while she watches. Its own animation.
- **The 20 controls** (`input/actions.ts`): each with its icon, key and touch
  use; Settings → Controls lists all 20, the four this game doesn't use
  (reload, grenade, ability; voice chat: no microphone) greyed out. New keys:
  Tab (hold) scoreboard, M map, K kill feed, Y quick chat.
- **Scoreboard** (`ui/scoreboard.ts`) and **quick chat** (`ui/quickchat.ts`).
- **Camera**: already to spec (65° / 75°, pitch ±60°, collision, no
  auto-correct by default); sensitivity now 0.3 of the maximum on both axes.
  Screen shake when you're hit or pushed.

Not in this phase: the pause menu, audio volumes and the rest of the 20
settings (Phase 7).

### Phase 3: Desert Field, sky, light and dark (done 17 Oct 2026)

| Check | Result |
| --- | --- |
| Every pass counted (shadows, the mirror, post) — Desert Field, 300 m, 20 bunched at the start | Low 64K triangles / 50 draw calls · Medium 90K / 58 · High 98K / 64 |
| All 24 maps at 300 m, start of a round | Medium 51–90K triangles, 45–76 calls · High 54–98K, 52–84 calls (Farmland trimmed after the sweep) |
| Scenery along a 300 m run, per 50 m stretch | even on all 24 maps (no gaps) |
| Time to lobby, slow phone profile (CPU ÷4, 1.6 Mb/s, 150 ms) | 4.1 s, 351 KB |
| Builds | Lagos Life `dist/` 268 KB JS gzipped; EMILGO embed 1,173 KB; Docker server rebuilt on protocol 5, keys OK (test) |
| Tests | rules 61/61 · match, balls, shop all passed · fairness 7/7 · load 1,200: 0 failures, step p99 10 ms, 6.6 KB/s |

Built:
- **Desert Field** (`maps/desert.ts`, recipe `desert-field`, the default map,
  32 m wide): sand with grass patches (some on the field, they don't get in
  the way), dunes beyond, two mountain ranges, and 26 details round the field
  (7 cacti, 2 prickly pears, 2 abandoned cars, 2 cow skulls, 2 ribcages,
  2 tyres, 3 pairs of drums, a signpost, a dead tree, 4 rock clusters).
- **Every map at every distance**: the street, the scenery and Mama's closure
  run to the line; the far backdrop moves back with her; the ground stretches.
- **Laser guns** (`world/lasers.ts`) on every map: towers every 30 m down both
  sides and two flanking Mama; turrets sweep, track the nearest runner while
  she turns and stares, and the nearest one fires the beam on a catch. Red
  beacons at night.
- **Potholes** (`maps/potholes.ts`) on every outdoor map: puddles that reflect
  the sky (a real mirror on High), ripple, and splash with rings, droplets and
  a sound when someone runs through.
- **Birds** (`maps/birds.ts`): three small flocks crossing in daylight (none
  at night or in rain; no vultures).
- **Sky** (`maps/sky.ts`): follows the camera; 2D clouds that drift with the
  wind on Low and Medium, volumetric clouds on High; stars at night.
- **Five states**: sunny, rainy, sunrise (new: low sun behind the runners, a
  pink sky over Mama), sunset, night. One "Sky" picker on the play screen.
- **Light / dark mode** (Settings → Graphics): Map, Light (full daylight,
  lamps off), Dark (full night, lamps and neon on, red beacons). Applies at
  once, in the lobby (its own day, golden and night looks) and mid-round.
- **Mountains**: smooth ridges with distinct peaks instead of cones.
- **Tiers**: world textures 256 / 512 / 1024; Medium "basic" shadows, High full
  soft ones; real shadows from the nearest 3 people (Medium) or 2 (High), a
  soft blob for the rest; scenery casts only near the runner (High: full
  detail in your own stretch, the buildings' volumes beyond; Medium: volumes
  only), from shadow-only stand-ins the screen never draws.
- **High post** (`graphics/post.ts`): bloom on bright things, a light grade
  warmed at sunrise and sunset and cooled at night, a soft vignette.
- Fog only at the far edge; Mama is never lost in it; the mountains stay on the
  horizon; the camera sees 900 m.

Not in this phase: a continuous day/night cycle within a round (the five
states are fixed per round).

### Phase 2: referee v4 and server (done 17 Oct 2026)

| Check | Result |
| --- | --- |
| Referee (`rulestest`, no server) | **58/58**: the 25 old checks, plus distances and time limits, ball counts and placement, grab range, holding, fist/slap/push range and cooldowns, the slide, the attacker's 3 s wait on a dropped ball, attacker shot and target forgiven in red light, nobody attacks a player past the line, across with a ball → banked and safe, across without → still in play, a caught holder drops the ball, last ball banked ends the round, sprint shoves, a walk is only a bump, nobody runs through anybody, 20 spawns apart |
| Ball Haunting online (`ballstest`, new) | 16/16: room and start say the mode, grab → push → drop arrive in order with the slide, snapshots are 5 numbers a player with no balls, a reconnect gets every ball and everyone's distance |
| Lagos Life match (`matchtest`) | all passed, twice: staked Ball Haunting, A fetches the ball and wins, result signed and settled |
| Shop (`shoptest`) | all passed |
| Lag fairness | 7/7 |
| Load: 1,200 players, rooms of 20, half fighting over balls | 0 failures · server step p50 6.6–8.4 ms, p99 15–19 ms · 181–196 MB · **4.9 KB/s a player** (was 11.4 before slimming the snapshots). Worst case, 20 alive and running: 542 B × 15/s = 7.9 KB/s |
| Balance (`scripts/sim.ts`, 20 players) | Classic, a sharp player (0.25 s reactions) crosses 95–98% of rounds, in 33 s / 64 s / 96 s of the 45 / 80 / 120 s; a 0.45 s player almost never; walking never makes it. Ball Haunting, a CPU-level player: 27% / 15% / 7% |
| Feet on the ground | 1,428 checks, 0 failed (fist, slap, push, grab, carrying and staggering added) |
| The real client online | the browser as the third player in a room with two scripted players: joined, saw the balls, the grab and the push; no console errors |
| Builds | Lagos Life `dist/` 254 KB JS gzipped; EMILGO embed 1,136 KB. The Docker server is rebuilt on protocol 4 ("keys OK (test)") |

Built:
- **Modes and distances** (`config.ts`): Classic Run and Ball Haunting; 100,
  200, 300 m in 45, 80, 120 s. Every map stretches to the distance: the line,
  the plaza, Mama's stage, the street and the minimap follow it.
- **Balls and baskets** (`game/balls.ts`, `world/props.ts`): 13 for 20, placed
  apart in the middle of the field; three woven baskets past the line; one
  instanced draw call for every ball.
- **Fighting** (`game/combat.ts`): fist, slap, push; sprint shoves; the slide
  and stagger; forgiveness for the one hit. Animations for each, plus picking
  up, carrying (both hands round the ball) and staggering.
- **Buttons**: fist, slap and push bottom-centre only with someone within 2 m,
  grab only with a free ball in reach (keyboard 1, 2, 3 and F).
- **CPUs** (Solo only): head for free balls, chase holders, throw their
  favourite attack, never while she watches.
- **Server**: protocol 4; rooms of 20; Play with New People matches by mode and
  distance, starts at 20 or 60 s after the second player; staked matches
  play `STAKED`.
- **Crowd budget**: twenty people share 30K / 40K / 52K triangles (Low /
  Medium / High), nearest first; real shadows from the nearest six. A bunched
  start on High: 40 draw calls, 79K triangles (126K before).
- **Smaller snapshots**: speed and distance are worked out on the phone; the
  fallen are sent as zeros; balls travel as events (a reconnect gets them all).
- Play screen: Mode and Distance pickers (the full play menu comes in Phase 5).

Not yet (later phases): the walkout and waiting room (5), the elimination
sequence and highlights (6), boosts and CP (7), the Desert Field and the laser
guns (3). Pressing grab and the attack buttons works now; their final COD
layout and the stamina bar over the move stick come in Phase 4.

### Phase 1: clean slate and characters (done 17 Oct 2026)

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
  ceiling per level. **Distance LOD** (`world/crowd.ts`): full detail within
  20 m, one step down to 45 m, the far level beyond, inside a triangle budget
  for the whole crowd (Phase 2); you always get full detail.
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
