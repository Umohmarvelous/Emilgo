# Red Light, Green Light: the owner's original specification

> Pasted by the owner in chat on 16 Oct 2026, saved here word for word.
> [SPEC-V2.md](SPEC-V2.md)'s Answers and Decisions override it where they differ
> (e.g. no automatic pushing, the Mugunghwa chant, no voice chat).

In building this be highly creative. You can suggest improvements. You build everything to run smoothly on low-end Android phones (Tecno, Infinix), mid-range phones, and high-end devices, as well as laptops and web browsers.

Reference style: Call of Duty Mobile (UI, lobby, controls, camera, kill feed, match flow, pause menu) + football match walkout sequences + Squid Game's Red Light Green Light.

I am giving you the complete, finalized specification. Build strictly to this. Do not add features I did not ask for. Do not add weather effects, heat shimmer, or environmental effects I did not approve. Do not add floating name tags, country flags, crowd sounds, or stadium light effects during walkout.


## 1. UNIVERSAL GAME FLOW (APPLIES TO EVERY GAME)

This flow is reused for every game added to Emilgo Games.

### 1.1 Lobby → Game Selection
- Player is in the main lobby (COD-style, Nigerian street environment).
- Player taps a game station or selects a game from the Play menu.
- Three options appear (COD-style):
  - **Invite Friends** — send invites to Lagos Life friends. They receive a notification in their lobby.
  - **Play with New People** — global matchmaking, computer pairs players together.
  - **Play Solo vs AI** — practice mode only, opt-in, never default.

### 1.2 Waiting Room
- Players who accept invites appear in the waiting room lobby.
- Each player's 3D model is displayed in full, standing properly on the ground, in the waiting room.
- COD-style layout: teammates on one side, opponents on the other (for team games), or all players in a circle (for free-for-all).
- Voice chat active. Text chat active.
- When all players are ready, a 2-second loading state begins.

### 1.3 Walkout Sequence (Football Match Style)
- Camera cuts to a cinematic walkout.
- Players walk from a walkway/tunnel toward the field.
- All players wear the same outfit — a black suit similar to Squid Game's Red Light Green Light uniform.
- Camera captures from multiple angles: front, side, behind, overhead.
- **Do NOT add:** stadium light flickering, crowd sounds, floating name tags, country flags, or emote wheel during walkout.
- On arriving at the field:
  - Camera preview of the field: 4 sweeping angles showing the arena.
  - Camera zooms in on the doll for a close-up.
  - Camera shows balls and baskets placed around the field.
  - Camera shows the laser guns mounted around the field.
  - Camera returns behind the players, now standing in the field.
- **Skip button** appears only after players have walked into the game arena. If tapped, skip to countdown.
- **Countdown:** Large numbers 5 → 1 appear at center screen. No text, just numbers. Each number pulses with a bass drop sound.
- Game begins after countdown.

### 1.4 Gameplay
- Full COD-style HUD (Section 3).
- Players control characters with virtual joysticks.
- Match ends when win condition is met.
- Post-match: stats screen, return to lobby.

### 1.5 Tutorial Button
- When players enter the field for the first time, a tutorial button appears.
- Tapping it plays a video of a 3D model performing the exact game from start to finish, with rules narrated and steps highlighted.
- This tutorial system is reused for every game added to the app.

---

## 2. RED LIGHT GREEN LIGHT — FULL GAME DESIGN

### 2.1 Game Modes (Player Chooses Before Match)
Players select one of these modes before starting:

**Mode A — Classic Run**
- Players simply run to the safe line.
- No balls. No baskets.
- Dodge the doll. Reach the line. Survive.

**Mode B — Ball Haunting**
- Every player starts without a ball.
- A limited number of balls are scattered on the field (fewer than players — e.g., 13 balls for 20 players).
- Players must grab a ball and run to the safe line.
- Anyone without a ball when time runs out is automatically eliminated.
- Players can steal balls from each other by attacking.

**Distance Selection (Applies to Both Modes)**
- Short: 100m
- Default: 200m
- Long: 300m
- Time limit is fixed per distance. Players cannot change the time.

### 2.2 Core Mechanic
- A giant doll stands at the far end of a large open desert field.
- The doll sings a Nigerian lullaby (no lyrics shown, no song name shown).
- When the song stops, the doll turns 180° to face players.
- Any player caught moving after the doll turns is eliminated by laser.
- A 3-second warning hum plays before the doll turns.

### 2.3 Ball Haunting Rules
- Balls are scattered across the field.
- Players fight for balls.
- Holding a ball does not make you immune to the doll — you must still freeze when the doll turns.
- When a player is attacked, they drop their ball. The ball becomes free for anyone to grab.
- Attacker has a 3-second cooldown before they can grab the dropped ball.
- Once a player reaches the safe line WITH a ball, they are permanently safe — from the doll and from other players.
- Players at the safe line cannot be attacked. Their ball cannot be stolen.
- Players without a ball when time runs out are eliminated.

### 2.4 Attack Mechanic
- When another player is within 2m, attack buttons appear (fist, slap, push icons only — no text).
- Attacking causes the target to drop their ball if holding one.
- 3-second cooldown before the attacker can grab the dropped ball.
- **Push mechanic (no button):** If Player A is sprinting and collides with Player B, Player B is pushed and their screen shakes slightly. Only works when sprinting.

### 2.5 Match Size
- 20 players per Red Light Green Light match.
- 13 balls maximum in Ball Haunting mode.

### 2.6 Elimination Sequence (COD-Realistic, Upgraded)
When a player is eliminated:
1. Doll's head snaps 180° with a CRACK sound.
2. Screen zooms in on the offender.
3. Realistic blood particles splatter on the ground.
4. Character ragdolls and falls in slow motion (COD-style death animation).
5. Screen shakes violently.
6. Low, ominous drum sound plays.
7. Body fades out with a red vignette.
8. Killer doll's eyes flash red briefly.
9. Kill feed text appears at top-center: "[PlayerName] was eliminated" — slides in, no background, slides out after 5 seconds.
10. Eliminated players REMAIN on the field as ragdolled bodies until match ends. They do not vanish.

### 2.7 Kill Cam
- When eliminated, show a 2-second replay from the doll's POV.

### 2.8 Final Survivor Cutscene
- When only 2 players remain, camera zooms in, music intensifies, slow-motion.

### 2.9 Play of the Game
- After match ends, show the best moment (closest escape, best dodge, best attack).

---

## 3. GAMEPLAY HUD & UI (STRICT COD STYLE)

### 3.1 Rules
- Small text and icons only. Same font and size as COD Mobile.
- Text color: white and black only.
- No emojis, no mobile phone icons. Use animated game vectors (Lottie/SVG) instead.
- No backgrounds on non-button UI elements. Text-only overlays for: timer, team names, kill feed, emote display, friends list in match, activity feed.
- Opaque blur backgrounds only on buttons and modals.

### 3.2 Layout
- **Top-right corner:** Mini map (COD style, slightly faded, round with faded edges, shows terrain background, tappable to expand).
- **Top-center:** Kill feed / activity feed (text slides in, no background, slides out after 5 seconds).
- **Top-left:** Team names, player count, match info (text only, no background).
- **Bottom-left:** Movement joystick (1px solid white border, center dot, no text, left-handed default, only visible on touch).
- **Bottom-right:** Camera joystick (1px solid white border, center dot, no text, reduced sensitivity, no auto-correct).
- **Bottom-center:** Vital controls (COD style).
- **Above movement joystick:** Jump, crouch, sprint buttons (icon only).

### 3.3 Joystick Rules
- Movement joystick: no text, 1px solid border, center dot, left-handed default.
- Camera joystick: reduced sensitivity, no auto-correct — camera stays where player leaves it.
- Movement joystick only visible when player touches left half of screen.
- Joystick push = walk. Full push = run. Double-tap = sprint.

### 3.4 Camera
- Default: Third-person over-the-shoulder (COD POV).
- Toggle: First-person.
- FOV: 65° third-person, 75° first-person.
- Pitch range: -60° to +60°.
- Camera collision: pushes in when hitting walls.

### 3.5 Actions
- Walk, run, sprint, jump, crouch, prone, interact, emote, attack.
- Sprint button toggles state (COD style).

### 3.6 Remove From Game Screen
- Song lyrics.
- Song name.
- Game instructions ("waka," "freeze").
- All text labels under joysticks.
- Heat shimmer (do not add — models must not shake or look like they are heating).

---

## 4. PLAYER CONTROLS

### 4.1 Movement Joystick
- Left-handed by default (toggle to right-handed in settings).
- 1px solid white border, no dotted lines.
- Center dot for reference.
- No text under it.
- Small push = walk. Full push = run.
- Only visible when player touches left half of screen.

### 4.2 Camera Joystick
- Right-handed by default.
- Reduced sensitivity (0.3 of max).
- No auto-correct — camera stays where player leaves it.
- No text under it.

### 4.3 Action Buttons
- Jump, crouch, sprint, emote (icon only).
- Positioned bottom-right (COD style).

### 4.4 Player Collision & Pushing
- Players cannot run through each other.
- When Player A sprints into Player B, Player B is pushed.
- Push effect: slight screen shake for Player B.
- Only works when sprinting.
- Attack buttons appear when within 2m of another player (fist, slap, push icons only).

### 4.5 Sprint System (COD Style)
- Press sprint button → player transitions to sprint state.
- Press again → stop sprinting.
- Sprint drains stamina (visual bar appears above joystick).

---

## 5. 3D MODEL & ANIMATION REQUIREMENTS (CRITICAL FIXES)

### 5.1 Ground Contact Fix
- All 3D models MUST stand properly on the ground. No floating. No hovering.
- Verify Y-axis positioning after every import. Feet must touch the ground plane exactly.
- Test on every map — no sinking into terrain, no floating above terrain.

### 5.2 Model Quality (Not Low-Poly)
- Models should NOT look low-poly.
- Use higher polygon counts than typical mobile games, but optimized to run on all devices.
- Characters: 2,000–5,000 triangles (smooth, realistic, human anatomy correct).
- Props: 1,000–2,500 triangles.
- Buildings: 2,000–5,000 triangles.
- Use smooth shading where appropriate.
- Use normal maps to add detail without extra polygons.
- Use LODs to maintain performance on low-end devices.

### 5.3 No Heat Shimmer
- Do NOT add heat shimmer or any distortion effect that makes models shake or appear to be heating.
- Models must be stable and still when standing.

### 5.4 Animation States
- Idle: Standing still, subtle breathing.
- Walk: Slow movement.
- Run: Faster movement.
- Sprint: Fastest movement.
- Jump: Airborne.
- Crouch: Low stance.
- Prone: Lying down.
- Emote: Various (wave, dance, laugh, cry, taunt, respect, handshake).
- Death: Ragdoll fall (COD-style).

---

## 6. ENVIRONMENT & VISUAL UPGRADES

### 6.1 Red Light Green Light Field
- Large open desert field, size depends on distance mode (100m, 200m, or 300m).
- Sandy ground with scattered grass patches.
- Potholes with realistic water that reflects and splashes when stepped on.
- Doll at center-back of field, very far from players.
- Laser guns mounted around the field perimeter.
- Baskets scattered near the safe line (for Ball Haunting mode).
- Balls scattered across the field (for Ball Haunting mode).
- Distant mountains on the horizon.
- Birds flying randomly in the sky.
- 20–30 environmental details total (rocks, cacti, abandoned cars, bones, etc.).

### 6.2 Sky & Clouds
- Realistic clouds using scrolling 2D cloud textures on skybox for low and medium graphics tiers — almost zero performance cost.
- Volumetric clouds ONLY on highest graphics tier.
- Day/night cycle with realistic lighting.
- Weather states: sunny, rainy, sunset, sunrise, night.

### 6.3 Graphics Tiers
- **Low:** 2,000 tris characters, 1,000 tris props, 256 textures, no shadows, static skybox, scrolling 2D clouds only.
- **Medium:** 3,500 tris characters, 1,500 tris props, 512 textures, basic shadows, scrolling 2D clouds.
- **High:** 5,000 tris characters, 2,500 tris props, 1024 textures, full shadows, post-processing, volumetric clouds.

### 6.4 Light/Dark Mode
- Light mode: full daylight, streetlights off, bright colors.
- Dark mode: full night, streetlights on, neon signs glow, darker palette.
- All 3D models, buildings, cars, and environment update when mode is toggled.

### 6.5 Rotate Phone Prompt
- When game starts, a small animated rotate-phone icon appears.
- Tapping it rotates the game to landscape, overriding phone settings.
- Only previews for a few seconds, then fades.
- Also available in settings.

---

## 7. UI & SETTINGS

### 7.1 Pause Menu (COD Style)
- Settings, quit, resume, controls, audio, graphics.
- Opaque blur background.

### 7.2 Audio Controls
- Background music toggle.
- Voice chat toggle.
- Sound effects toggle.
- Master volume slider.

### 7.3 Text Chat
- In-match text chat for typing messages.
- Allowed by Lagos Life.
- Must include moderation: report, block, mute, profanity filter.

### 7.4 20 Additional Controls
1. Reload (for future games with weapons)
2. Melee
3. Grenade (future)
4. Crouch
5. Prone
6. Jump
7. Sprint
8. Slide
9. Interact
10. Emote wheel
11. Voice chat toggle
12. Text chat toggle
13. Mini map expand
14. Scoreboard
15. Settings quick access
16. Kill feed toggle
17. Compass
18. Health/stamina bar
19. Ability button (future)
20. Ping/quick chat

### 7.5 20 Additional Settings
1. Graphics quality (low/medium/high)
2. Camera sensitivity
3. Vertical sensitivity
4. Horizontal sensitivity
5. Invert Y axis
6. Joystick size
7. Joystick opacity
8. Left/right hand toggle
9. Auto-sprint
10. Sprint toggle vs hold
11. Voice chat volume
12. Music volume
13. SFX volume
14. Light/dark mode
15. Map size (small/medium/large)
16. Language
17. Notifications toggle
18. Friend requests toggle
19. Data saver mode
20. Reset to default

### 7.6 Map System
- 24 maps total (6 Nigerian urban, 4 Nigerian rural, 6 international urban, 4 international nature, 4 special/horror).
- All maps functional in every game.
- Map size options: small, medium, large.
- Round mini map with faded edges.
- Mini map shows terrain background.
- Tapping mini map expands to full map view.

### 7.7 Store
- **Speed boosts** — purchasable with CP (not Lagos Life money).
- 10–20 boost/upgrade items: speed, stamina, freeze resistance, ball grip, etc.
- Standard cosmetics: emotes, outfits, voice effects, chat badges.
- Cosmetic purchases use Lagos Life Game Naira via Vatar SDK.
- Boost purchases use CP (in-game premium currency).

---

## 8. PERFORMANCE REQUIREMENTS

- 60 FPS on mid-range, 30 FPS minimum on low-end (Tecno, Infinix).
- Under 100 draw calls per frame.
- Under 100,000 triangles per frame.
- Under 50 MB initial bundle.
- Under 5 seconds to lobby.
- Works on iOS, Android, and web.
- Offline mode: works on poor connections, auto-syncs when network returns.
- AI never default — players opt in to practice mode.

---

## 9. VATAR SDK INTEGRATION

- `Vatar.init()` for auto-login.
- `Vatar.session()` refreshed before each server call.
- `Vatar.purchase()` for cosmetic purchases.
- `Vatar.match.*` for creating/joining matches with staking.
- `Vatar.onPause/onResume` to pause game when backgrounded.
- `Vatar.leaderboard()` for rank display.
- `Vatar.submitScore()` for posting match results.
- Server-side signed results with HMAC-SHA256.
- Respect all match limits: ₦100,000 max stake, ₦500,000 daily per player, 5% house cut, 40% of house cut to developer.

---

## 10. DO NOT ADD

- Heat shimmer or any model-shaking distortion.
- Stadium light flickering.
- Crowd sounds.
- Floating name tags above heads.
- Country flags above heads.
- Emote wheel during walkout.
- Sandstorm events.
- Tumbleweeds.
- Vultures.
- Footprint trails.
- Weather effects beyond what is specified in Section 6.

---

## 11. YOUR TASKS

1. Build this specification into a production-ready game.
2. Fix all 3D model issues: models must stand on ground, not float, not shake.
3. Redesign 3D models with higher polygon counts that still run on all devices.
4. Implement both Red Light Green Light modes: Classic Run and Ball Haunting.
5. Implement distance selection: 100m, 200m, 300m with fixed time.
6. Implement the walkout sequence with skip button after entering arena.
7. Implement the full COD-style HUD, controls, and pause menu.
8. Implement the kill feed, kill cam, final survivor cutscene, and play of the game.
9. Implement all 24 maps, all 20 controls, all 20 settings, and the store.
10. Ensure 60 FPS on mid-range and 30 FPS minimum on low-end phones.
11. Write the complete file structure.
12. Write the build phases in order.
13. Ask any clarifying questions before building.

Be highly creative with implementation. This game must feel like Call of Duty meets Squid Game meets Nigerian street culture. Build it right.
