# EMILGO Games v4 "Max Mode": concept pass and plan (draft, 2 Nov 2026)

**Status: pictures only. Nothing in the game has changed.** Every picture is in
[index.html](index.html) (open it in a browser). This file is the plan behind
them. Each phase below waits for the owner's go-ahead, as always.

The brief (three prompts, 2 Nov 2026): COD-style tactical operators, realistic
zombies, Free For All as a shooter, the "Unreal Engine" look, a touchpad look
control, a new welcome screen, a restructured lobby and pre-match screens,
items that become armour (players grow into monsters and giants), more
billboards, much bigger worlds with many different locations, 1,000+ assets,
legendary-looking loot, sound everywhere, and a HUD redesign with victory and
defeat screens.

## 1. What is honest about the brief

| The brief asks | What a Tecno/Infinix can really do | What we do |
|---|---|---|
| UE5 look, ray tracing, SSR, SSAO, volumetrics, at 30 fps on low-end phones | A Mali-G52 holds 30 fps at ~100 draws and ~100K triangles with **no** post passes. Each full-screen pass costs it 2–4 ms. | Four tiers (section 4). **Max** has the full stack and is for strong phones and computers. **Low** fakes it: baked light, env-map reflections, fog, a CSS vignette. The "tiers" pictures show both, side by side. |
| 1,000+ assets from Megascans, Poly Haven, Sketchfab, Kenney | Megascans is now on Fab (its licence and an account are the owner's). Sketchfab downloads need an account and most models are CC-BY (credit required). Poly Haven trees are 0.3–17 **million** triangles each. | **2,898 CC0 candidates** listed with thumbnails (Poly Haven 2,352, ambientCG 546 of its 2,037). Everything goes through a pipeline: decimate to 3–4 LODs, KTX2 textures, impostors for trees. Megascans/Sketchfab only if the owner wants them and holds the accounts. |
| Hyper-realistic zombies (WWZ / Resident Evil) | Real sculpted zombies are an art job, not code. | Procedural rot, veins, wounds, blood and exposed bone on our scanned bodies (the pictures). For the last step to film quality: sculpted meshes (commissioned, or licensed packs). |
| Exact COD look control | Mechanics aren't anyone's property; COD's code and look are. | Our own touchpad model with a dead zone and an acceleration curve. Playable now: [controls.html](controls.html). |
| Forget the 4 s boot and offline play? | The app embeds one 2.8 MB file that plays offline. A 1.6 km world with streamed assets can't be embedded. | The lobby, Dead Streets "lite" and Practice stay in the app's file; the big world streams from a CDN (question 6). |

Rules that stay: no made-up brands (signs say CLUB, BAR; guns have generic
names), no child zombies, religious sites respected, Lagos Life's rules
(README §1), blood behind the setting (on in Lagos Life, off by default in
the app; the owner updates the store age rating).

## 2. Characters, armour, zombies

- **Operator** (pictures: operator, operator-face, operator-turn): the game's
  scanned body and skeleton, so every existing move, emote and fall still
  plays. One material re-dresses the body: camo fabric glued to the bind pose,
  gloves on the hands, boots on the feet; the scanned head keeps its real eyes
  and blink behind a shrink-wrapped balaclava with one slit (eyes and the
  bridge of the nose only). Helmet with comms and NVG mount, plate carrier,
  pouches, belt, holster, pads, pack: separate meshes on the bones, merged per
  material at runtime (2–3 extra draws).
- **Armour ladder** (picture: armour): every pick-up is now armour. Points fill
  four thresholds; each tier changes the suit and the size.

  | Tier | Name | Size | Armour | Look |
  |---|---|---|---|---|
  | T0 | Operator | 1.00 | 0 | base kit |
  | T1 | Plated | 1.06 | +25 | pauldrons, vambraces, tassets, greaves |
  | T2 | Juggernaut | 1.15 | +60 | sealed helm, chest core, bomb-suit bulk |
  | T3 | Warlord | 1.27 | +100 | spiked black plate, horns, ember eyes, cape |
  | T4 | Titan | 1.45 | +160 | obsidian and gold, bull horns, crown, sun core |

  Balance (proposal): the hitbox grows half as fast as the look; −3% speed per
  tier; armour drops as loot when you fall, so giants are worth hunting.
  Budget: +1.5K triangles and +1 draw per tier on High; Low shows T3/T4 as the
  same silhouette with fewer plates.
- **Zombies** (pictures: zombies, zombie-close, zombie-rise): the scanned
  bodies with a rot shader (grey-green skin, veins, lesions, sunken bruised
  sockets, milky glowing eyes, blood round the mouth), filthy torn clothes
  with wounds through the tears, exposed ribs or forearm bone, the Masked in a
  cracked gas mask (a modern mask, never a traditional one). New clips:
  emerge, lunge, claw, stagger (keyframed like the others).

## 3. Free For All becomes a shooter

- **Loadout**: spawn with a sidearm; assault rifles, SMGs and shotguns are
  loot (six rarities, Common → Mythic: picture "rarity"). The machete and
  Gidigbo melee stay as backup.
- **Gunplay**: hitscan, refereed by the server with the existing lag rewind
  (≤150 ms). ADS (slower, tighter spread, a depth-of-field blur on Medium+),
  per-gun recoil pattern plus a little randomness, spread that blooms while
  firing and moving, reloads with animation, hit markers (white, red kill,
  gold headshot) and their sounds.
- **Health**: 100 + armour. Kills respawn per each mode's rules; the zone's
  sky laser stays. The objectives (flags, zone, vehicles) are unchanged.
- **Open**: the staked Flag Duel (real stakes in Lagos Life) — keep it
  melee-only? (question 3)

## 4. Graphics tiers ("Max Mode")

| Tier | Who gets it | What's on |
|---|---|---|
| Low | Tecno/Infinix (Auto) | Lambert, no shadows, 0.6–1.0 render scale, fog, baked/vertex light, env-map shine, CSS vignette, the grade in the lights |
| Medium | most phones | PBR, shadows near you, one grade pass |
| High | strong phones | + bloom, grain, cascaded shadows (3 cascades) |
| Max | flagship phones, computers | + GTAO ambient occlusion, god rays, height fog with light shafts, planar reflections on wet ground and glass, depth of field when aiming, chromatic aberration in action, a LUT grade per location |

Perf gate per phase as today (`dev/cdp.mjs` at CPU 4×/6×) **plus a real Tecno
or Infinix** before anything ships.

## 5. The world: bigger, streamed, many places

- **Size (proposal)**: one 1.6 × 1.6 km world for Free For All (16× today) with
  eleven locations that each look different: Ironwood Forest, Glass District,
  Dune Sea, Windmere Ridge, Neon Row, Harbour Yard, Frostline, Black Refinery,
  Old Airfield, The Arena, Mangrove Sink. Dead Streets gets night versions
  along a route.
- **Streaming**: the world is a grid of 64 m cells. Near (0–96 m): full detail.
  Mid (96–320 m): LOD2 and tree impostors. Far: skyline proxies and terrain,
  then fog. Each cell has a manifest of instanced prefabs; assets load as KTX2
  + meshopt glTF in a worker, kept in an LRU with a GPU budget (Low 120 MB,
  Medium 200 MB, High 350 MB). The server builds only colliders, from the
  same seed, as today.
- **Every repeated thing is instanced** (one draw per prefab per cell); every
  asset has 3–4 LODs; far trees are 2-card impostors.
- **Hosting**: the assets live on a CDN (Cloudflare R2: Pages caps files at
  25 MB and 20,000 files). The owner's account.

## 6. Sound everywhere

A sample layer on top of today's synthesiser: SFX from CC0 and royalty-free
libraries (Kenney audio packs, Freesound CC0, the Sonniss GDC bundles), music
from Pixabay Music / FreePD or commissioned. Never BBC Sound Effects (not for
commercial use). Spatial emitters on a pooled PannerNode budget (Low 6,
Medium/High 12): wind turbines (whoosh per blade pass, louder close), the
club (bass through walls, full mix at the door), generators, sirens, PA
announcements at the airfield and harbour, ship horns, gulls, birds, rivers,
fire roar at the refinery. Music states: explore → combat → low health
(low-passed) → final circle (intensified) → victory/defeat stings. HUD sounds
are pooled one-shots.

## 7. Billboards

The system stays as built (Phase 9). New board types (picture: billboards):
rooftop signs, LED walls on towers, road gantries, bus-shelter panels,
murals, stadium ribbons, plus a lobby card. New boards go on the end of each
wish list, so booked ids never move.

## 8. Interface

Four HUD concepts (A Field Kit, B Clean Ops, C Pulse, D Street Tech), each for
Free For All and Dead Streets, with victory and defeat screens; two welcome
screens, two lobbies, one pre-match screen. Live: [ui.html](ui.html)
(`?c=A..D&s=ffa|dead|win|lose`, `&notes=1` shows where each sound fires).
All animation is transforms and opacity: no blur, no particles, fine at 30 fps.

## 9. Phases (each waits for the go-ahead)

1. Look control (the touchpad) + the chosen HUD's skeleton.
2. Operator gear and the armour ladder (items → armour), LODs.
3. Free For All guns: weapons, ADS, recoil, spread, reload, hit markers, server hits.
4. Zombie art pass (rot material, bones, the new clips).
5. Graphics tiers and the post stack (Max Mode).
6. World streaming + the first three locations, the asset pipeline.
7. The other eight locations, the big world, more billboards.
8. Sound: the sample layer, spatial emitters, music states.
9. Welcome, lobby, pre-match, victory and defeat screens.
10. Performance on a real Tecno/Infinix and an iPhone; regression.

## 10. Questions for the owner

1. Which HUD concept, or which parts of which?
2. Free For All damage: 100 HP + armour, gun kills, respawns per mode, the zone laser kept?
3. The staked Flag Duel: melee-only (recommended) or guns?
4. Spawn with a sidearm, primaries as loot?
5. World size: 1.6 km square for 12 players, or bigger with more players?
6. Assets on a CDN (your Cloudflare R2): the app's offline copy keeps the lobby, Practice and a Dead Streets lite?
7. CC0-only (Poly Haven, ambientCG, Kenney), or do you hold Fab/Megascans and Sketchfab accounts?
8. Giants: hitbox at half the visual growth, −3% speed a tier?
9. Ball Haunt stays hidden and untouched?
