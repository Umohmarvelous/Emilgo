# The COD-style upgrade (started 15 Oct 2026)

> **Superseded where they differ by [SPEC-V2.md](SPEC-V2.md)** (17 Oct 2026):
> no heat shimmer, dust, light shafts or wind; weather is sunny or rainy; the
> traffic lights and on-screen words are gone; people are 2,000 / 3,500 / 5,000
> triangles with normal maps and stand on the ground in every pose.

The brief: Call of Duty Mobile's lobby, controls and camera; Nigerian street art
(Lagos Life / "Inside Life" style) with international appeal; 24 maps; graphics
tiers; realistic effects. Reference images: `~/Downloads/emilgo games/` (17).

## Decisions (and why)

| Brief says | We do | Why |
| --- | --- | --- |
| "KUKALO GAMES" logo | **EMILGO GAMES** | The owner renamed everything to EMILGO Games; the brief predates it. |
| Engine: `expo-three` + `@react-three/fiber/native` | **three.js on the web** (as now) | Lagos Life only runs a web page in an iframe. One web build runs in Lagos Life, in the EMILGO app's WebView and in any browser, which covers "iOS, Android, Web" with one codebase. React Native renderers can't run inside Lagos Life. |
| COD art in the references | **Our own art in the COD *style*** | The COD images are Activision's. We copy the layout, mood and lighting, never the characters, logos or art. |
| Photos of people (IMG_7770–7777) | **Outfit, hair and pose references** for our own generated characters | Scans or photos of real people can't be shipped without a licence. |
| Baobab model (cgtrader) | **Our own procedural baobab** | No download, no licence question, a few KB of code. |
| ₦ balance in the profile card | **Level, XP and best score** | The Vatar SDK has no wallet or balance call. Showing a made-up balance would be dishonest. Stakes stay on Lagos Life's own sheet. |
| Gold chat name (text colour) | **Gold ★ badge and gold frame**, name text stays white | The new rule: text is only white or black. |
| Nav bar at the bottom | **Top-centre tabs** in landscape, a tab strip in portrait | The reference lobby has them at the top, and two bars at the bottom don't fit a phone. |
| Voice effects in the store | Not built | No microphone in the Lagos Life frame. |
| Clan | Tab shown as "Soon" | Needs accounts and a backend we don't have yet. Friends come first. |
| Walk 2 / run 6 / sprint 9 m/s | Adopted. **Track lengthened from 80 m to 120 m**, time 48 → 45 s | At 6 m/s the old 80 m track is crossed in 13 s, so the rounds would lose their tension. |

## Where each reference image is used

- `action_hero_art1/2/3`: welcome poster. A squad of our own characters in
  tactical "hero suits", smoke, embers, low-angle dramatic light, a green
  night-vision grade (art2), a burning skyline (art3), a hero pose (art1).
  Rendered from the game's own 3D scene into one image.
- `lobby1` (COD MP lobby): the mode-select screen. A vertical mode list on the
  left, invite cards on the right, a mode/map card with a switch button, and a
  big START at bottom right.
- `lobby2` (BR lobby): the challenges column (daily tasks with progress bars),
  the map card with a thumbnail, and a "fill with CPU" checkbox.
- `lobby_of_invited_player` (squad lobby): room members standing around you on
  the street, with level and name tags, a PLAYER LIST count and a next-match
  timer. Top tabs.
- `lobby_of_invited players` (winner's circle): the post-match podium with the
  top 3 in victory poses, 1/2/3 numbers, name plates, and "returning to lobby
  in N".
- `IMG_7770`: the Ankara patchwork denim dress outfit, a big afro, and the
  hand-in-hair and hand-on-hip poses (lobby idles and the "Pose" emote).
- `IMG_7772`: the office blouse and pencil skirt outfit, and A-pose turnaround
  views (the customise turntable).
- `IMG_7773`: the striped bodycon dress, an updo bun, and heels.
- `IMG_7775`: the oversized sweater and chinos outfit, a low cut, and a walk
  pose.
- `IMG_7776`: the cami and mom jeans outfit, a sleek ponytail, and a relaxed
  stand.
- `IMG_7777`: the striped tank and shorts outfit, a low cut, and the
  front/back/side run poses.
- `insidelife_background` / `2`: the Lagos art direction. Rusty corrugated zinc
  roofs, interlocking paving, yellow danfos under a shed, a wooden kiosk, a
  patio umbrella with plastic chairs, sandbags, lanterns, hedges and flowers, a
  bungalow with louvre windows, Nigerian flag. Used in the lobby set and the
  Lagos maps.
- `trees1` / `IMG_7779`: the baobab avenue. Procedural baobabs for the rural
  maps and the lobby.

## Phases (each tested before the next)

1. **Design system**: fonts (Montserrat, Inter, JetBrains Mono, self-hosted),
   tokens, an SVG icon set (no emoji anywhere), the restyle.
2. **Characters**: generated skinned humans with fingers and faces, in 3 tiers
   (800 / 2,000 / 5,000 triangles, 256 / 512 / 1024 textures). Outfits and hair
   from the references; procedural animation (idle, walk, run, sprint, jump,
   crouch, prone, freeze, fall, cheer, emotes, poses).
3. **Lobby and welcome**: a golden-hour street set, the character turntable
   (drag, pinch), the four corners, the action bar, tabs, and the panels
   (customise, emotes, loadout, store, friends and invite, settings, mode
   select). The welcome poster.
4. **Controls and camera**: the spec's sticks, over-the-shoulder camera, first
   person, collision, sensitivity, jump, crouch, prone and sprint with stamina.
   The referee and server learn the new moves (protocol 3).
5. **Graphics tiers and effects**: Low, Medium and High; shadows; dust, wind,
   clouds, rain, fog, light shafts, heat shimmer (High only).
6. **24 maps**: a map kit, 24 recipes, 50 m chunks with 3 LOD levels, day/night
   and weather, minimap.
7. **Social**: the winner's circle, the squad lobby, friends and invites
   (server, Lagos Life identity), the offline queue.
8. **Regression**: server tests, fairness, load, budgets (draw calls, triangles,
   memory, load time), the three builds.

## Status (16 Oct 2026)

All eight phases are built and tested. What was measured:

| Check | Result |
| --- | --- |
| Type-checks (game, server) | clean |
| Referee moves (`rulestest`) | 25/25: speeds 2 / 6 / 9 / 1.5 / 0.5 m/s, a 1.20 m jump, 4.5 s of sprint, stance steps, caught for jumping or ducking during the stare, safe holding a crouch, nobody spawns on anyone |
| Matches (`matchtest`) | 19/19 |
| Shop (`shoptest`) | all passed (new look format: free looks need no ticket, paid items still do) |
| Fairness (lag compensation) | 7/7 |
| Load (1,200 players, one process) | 0 failures · server step p50 5.2 ms, p99 25 ms · 6.3 KB/s per player · 182 MB |
| All 24 maps | build in 11–235 ms · 25–45 draw calls · 27–86K triangles (budget: < 100 calls, < 100K triangles) |
| Load, phone profile (CPU ÷4, slow 4G) | first frame 3.0 s (target < 5 s) · 339 KB over the wire |
| Frames, same profile, Medium | lobby 16.7 ms steady · round p50 16.7 ms, p95 16.8 ms, worst 83 ms, none over 100 ms · 26 MB JS heap |
| Builds | Lagos Life `dist/`: 247 KB JS gzipped + 7 KB CSS + 108 KB fonts + 84 KB poster · EMILGO single file 1,117 KB (fonts and poster inlined) |

The frame numbers are on this Mac's GPU with a slowed CPU; a real mid-range
Android (Snapdragon 660 class) still has to be checked by hand.

### Built

- **Welcome**: the hero poster (`src/ui/welcome.webp`, rendered by
  `dev/poster.ts` from our own characters), the wordmark, a thin green bar,
  "Loading Lagos...", at least 1.6 s, then a fade to the lobby.
- **Characters** (`src/world/human/`): generated, skinned, five-fingered people
  with painted faces; 2 builds, 8 skin tones, 8 hairstyles and 8 hair colours,
  12 outfits (6 free from the reference photos, the hero suit, the agbada, the
  3 shop outfits), 7 extras; idle, walk, run, sprint, crouch, prone, jump,
  fall, cheer, 12 emotes, 5 lobby poses. ~800 / 2,600 / 5,000 triangles by tier.
- **Lobby** (`src/world/lobbyStage.ts`, `src/ui/screens.ts`): golden-hour
  Lagos set after the Inside Life art (zinc roofs, pavers, danfo shed, kiosk,
  umbrella and plastic chairs, flag, palms, mural, baobab), 3-point light,
  dust motes, light shafts, background blur; drag to turn, pinch or wheel to
  zoom. All four corners, tabs (Clan marked Soon), action bar, daily
  challenges, mode and map card. Panels: Customise, Emotes (with the wheel
  editor), Loadout, Store (try anything on), Friends and Invite, Leaderboard,
  Settings (Graphics, Audio, Controls, Game, Account).
- **Play screen** (after `lobby1`/`lobby2`): game list (Ayo, Ludo, Suwe marked
  Soon), modes (Practice, Quick match, Private room, Join with code, Lagos Life
  match), map card with Switch, weather and time of day for practice.
- **Controls** (`src/input/controls.ts`): the brief's sticks (120 px, 1 px
  white, centre dot, 10% dead zone, move stick only on touch, look stick on
  touch or always), jump, crouch (hold for prone), sprint (button, double-tap
  or Shift), emote wheel (hold), chat. Swap sticks mirrors everything.
  Keyboard and mouse on the web.
- **Camera** (`src/world/camera.ts`): 1.6 m eye, 2.5 m back, 0.5 m right,
  65° (75° first person; wider on portrait phones), pitch ±60°, 35% / 25% of
  180°/s, 0.15 smoothing, no snap-back (a setting brings it back), pushes in
  at walls.
- **Rules, protocol 3**: jump, crouch, prone, sprint and stamina in the shared
  referee; buttons go up with the stick, height and stance come back in
  snapshots; the server picks a map per round from the seed.
- **Graphics** (`src/graphics/tiers.ts`): Low / Medium / High / Auto; real
  shadows on Medium and High; heat shimmer on High in hot maps.
- **24 maps** (`src/maps/`): registry, kit, 23 recipes plus the original
  street; 50 m chunks with 3 LOD levels; per-map time of day and weather
  (rain with splashes, storm with lightning and thunder, snow, ash and
  embers, fog, dust); drifting clouds, stars, lamp halos, wind on leaves,
  water and lava; minimap.
- **Social**: winner's circle (podium, spotlights, returns to the lobby in
  15 s), squad room (everyone in the room stands round you, name tags, next
  match timer), recent players, live online and in-match counts, room codes
  with copy.
- **Offline**: practice, customise and browsing work offline; a best score
  made offline is kept and sent to Lagos Life when the network is back.

### Not built, and why

- **Global friends, invites that notify, whisper, clans**: need accounts and a
  friends service. Lagos Life gives each game only a per-game player id and
  no friends or notifications API. Rooms with codes are the way to play
  together for now.
- **Voice effects**: no microphone in the Lagos Life frame.
- **Ludo, Ayo, Suwe**: shown as Soon; their own phased builds.
- **Map streaming and occlusion culling**: not needed at this size; a whole
  map builds in under a quarter of a second and stays under budget.
- **Engine `expo-three` / `@react-three/fiber/native`**: see Decisions above.

