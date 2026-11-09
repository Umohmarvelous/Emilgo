# EMILGO Games v6: the brief, in build order

The brief, word for word: [SPEC-V6-ORIGINAL.md](SPEC-V6-ORIGINAL.md). v6 wins
over SPEC-V5 where they differ. Status lives in the table beside each item.

**How it is built (the owner, 9 Nov 2026):** light work first. Tier 1 and Tier 2
are built straight away, each committed and pushed. **Tier 3 waits for the
owner's go-ahead.**

**Read first:** the test site (milgogames.pages.dev) still serves a build from
before v5: its page title is "EMILGO Games", not Blackmask. Pepper soup, the
old items, the vehicles and the 3-minute zone the owner saw are partly that old
build. Nothing new reaches the site until `scripts/deploy-site.sh` and
`fly deploy` run.

## The owner's answers (9 Nov 2026)

| # | Question | Answer | Built as |
|---|---|---|---|
| 1 | Health bars | Only while being shot | Already so (v5 1.11) |
| 2 | Voice | One voice on every phone, like COD; English with a Mandarin accent, the same voice everywhere. "Which is lighter?" | Recorded lines are lighter for the phone and the same everywhere: about 40 short clips, 4–8 KB each at low bitrate, about 250 KB in all, fetched after the lobby shows. The phone's own voice costs nothing to download but sounds different on every phone. So: recorded lines (2.12). Names can't be pre-recorded, so the voice says "Enemy eliminated" and the name shows on screen, as COD does |
| 3 | Zone grace | "No, leave it" and, in the second list, "I approve your recommendations", plus "do not wait until 3 minutes, COD-style" | COD-style (1.9): the gas hurts soon after you leave the circle, more each circle, and at 0 health you're down at once |
| 4 | Growth | Same size, fiercer: a robotic sci-fi helmet and armour that grow with each item | 3.7 |
| 5 | Items | Keep only Smoke Canister, Decoy Flag, Pulse Scanner, Squad Disguise; remove Field Flask, Big Bag, Adrenaline Shot, Zone Shield, Fuel Jerrycan, Van Key. Pick up automatically with a COD-style picking pose | 1.3, 2.1. Titan Serum and the Map Print are v5's new items and stay |
| 6 | Name | **Silo Zone** | 1.1 |
| 7 | App | The EMILGO app, but the game first, on a "PLAY NOW" button | 1.2 |
| 8 | "Relics" | Never mind; brighter is fine | Kept |
| 9 | Water | Keep it; a swim pose, splashes and sound, a fake-Unreal river | 3.5 |
| — | Icon | The owner will send the picture. The lobby avatar defaults to the player's Lagos Life avatar, name and money, and stays changeable | 2.8 |
| — | Suggestions | Yes to all: kill cam, daily reward chest, the treasure-carrier warning | 1.16, 2.11 |

## The CP system, as agreed (the owner asked to recall it)

- **CP is the game's own currency, earned only by playing.** It is never bought with real money and is not Lagos Life money (SPEC-ORIGINAL §7.7; SPEC-V2).
- Earned per round: 10, +15 for crossing the line, +10 for coming first, +5 online. The tutorial earns none. Practice earns CP but no rank XP (SPEC-V3).
- Kept on the phone, like the level. A reset to default never takes it.
- **Spent on 12 boosts** in the Store (60–150 CP for a pack of 3 rounds): Quick Feet, Sprinter, Second Wind, Fast Breath, Cool Head, Iron Grip, Quick Hands, Thick Skin, Rooted, Long Arm, Quick Fists, Low Rider. Up to 2 on at once; each uses a round.
- Boosts are **off in staked matches** (the server leaves them out) and belong to Red Light, Green Light; Free For All has none.
- **Cosmetics** are bought with Lagos Life Game Naira through `Vatar.purchase`, never with CP.

v6 keeps all of that and adds: CP pay that grows with winning and with your level, as COD pays more for a win (1.11); five figurines bought with CP (3.8).

**Lagos Life money can't grow from our game.** Only Lagos Life moves a player's
Naira, and only through a staked match's signed result (2–4 seats). The game
can show the balance; it can't pay into it. What grows with wins and level is CP.

## Tier 1: small changes (one file or one system, no new art)

| # | Item | Status |
|---|---|---|
| 1.1 | The name **Silo Zone** on the loading screen, the page title, the link card and the home-screen manifest | |
| 1.2 | The X link opens on one **PLAY NOW** button and plays first; the later "get the app" note sends players to the EMILGO app | |
| 1.3 | Items: only Smoke Canister, Decoy Flag, Pulse Scanner, Squad Disguise (and v5's Titan Serum and Map Print) in every loot table and every Airfall | |
| 1.4 | No cars, buses or keke in any mode (switched off, the code kept) | |
| 1.5 | Controls: by default only the move stick (walk), fire, aim, jump, sprint, crouch ("bend") and backpack; the player can add or remove any control in Arrange buttons | |
| 1.6 | Settings open on top of the match, the game visible behind | |
| 1.7 | Jumping starts sooner and lands sooner | |
| 1.8 | Emotes: only Shaku Shaku and Zanku, free for everyone | |
| 1.9 | The zone, COD-style: a short warning outside, then damage that grows each circle; at 0 health you're down at once | |
| 1.10 | Network status, COD-style: "Connection lost, reconnecting" while offline, "Connection restored" when it's back | |
| 1.11 | CP pay, COD-style: more for winning, for placing, and for your level | |
| 1.12 | Items spread across the map (no clusters), each spinning and bobbing, the glow coloured by kind | |
| 1.13 | The squad leader wears a captain's armband on the upper arm | |
| 1.14 | Treasure-carrier warning: whoever holds 4 of 5 shows on everyone's compass | |
| 1.15 | One-thumb portrait (Free For All): pushing the stick left or right turns the camera that way, the body kept centred, as in Lagos Life | |

## Tier 2: one system reworked, no heavy automation

| # | Item | Status |
|---|---|---|
| 2.1 | Pick up by walking through: items are taken automatically, with a COD-style crouch-and-grab pose on the move | |
| 2.2 | The pickup light: 10–20 glowing streaks orbit the body for 1.5 s, then snap into the chest in a burst. One instanced mesh, the orbit worked out in the vertex shader, additive blending, no lights | |
| 2.3 | COD-style sprint: a faster tactical sprint on a double push, the body leaning, the camera's field of view kicking out, its own animation and breathing | |
| 2.4 | Every gun its own sound and rhythm: machine guns fast and rapid, the pistol one shot a press | |
| 2.5 | Body sounds: a jump effort, the landing, hard breathing after a sprint, hurt, the pickup | |
| 2.6 | COD-type icons on every control | |
| 2.7 | No walking through buildings or solid props; low things (under about 1 m) can be jumped onto | |
| 2.8 | The lobby avatar defaults to the player's Lagos Life avatar, name and money; still changeable | |
| 2.9 | Ads in sight: an **Advertise** button in the lobby opens the billboard shop. Billboards numbered **Billboard 1 … 66**, each with its place. Prices in two tiers, **1 week and 2 weeks**, any board. Flutterwave pays on the web game | |
| 2.10 | An ad before each store purchase (the EMILGO app and the web; never in Lagos Life). A house ad until an ad network's account exists | |
| 2.11 | The daily reward chest; the kill cam | |
| 2.12 | The announcer recorded once, one voice on every phone: a script the owner runs on the Mac with an open-licence speech model; the game plays the clips | |
| 2.13 | Suit colours bake cleanly: each picked colour lands on its own part of the body, no bleeding into the next | |
| 2.14 | **The ad networks list**: what's wired, and 20–30 networks that can fill unsold boards, with how each is joined (`ADS-NETWORKS.md`) | |

## Tier 3: heavy (waits for the owner's go-ahead)

| # | Item |
|---|---|
| 3.1 | **A runner mode**: run to a finish line. The genre of the endless runners: three lanes, swipe to change lane, jump and slide, coins, power-ups (magnet, jetpack, shield), something chasing you, the finish line. Our own art, names and courses |
| 3.2 | **The transformation**: two new items, **Strength Booster** (more weapon and melee damage, heavier steps) and **Speed Booster** (much faster). On pickup: 0.5 s of slow motion (the animation only, never the physics), a power-up pose, the camera swooping round 360° on a curve that can't enter walls, the streaks as a vortex; then a ground shockwave, burning eyes, a fiery aura (strength) or an electric aura with after-images (speed), all fading when it ends |
| 3.3 | **The 11 places rebuilt** to look like the v4 pictures: each with everything that belongs there (the mangrove's stones, river and grass…), nothing placed without a reason, the outer places drawn in closer to the middle, more detail on the map |
| 3.4 | **Realistic trees and stones** (CC0 scans), light baked into the world, compressed textures (KTX2), lighter copies for Low and Medium |
| 3.5 | **Rivers**: a swim pose, splashes, water sound, a river that looks real |
| 3.6 | **Billboards**: two-sided boards, and tall portrait boards lit at night |
| 3.7 | **Growth**: a robotic sci-fi helmet and armour that get fiercer with each level |
| 3.8 | **5 new figurines** in the Store for CP: anyone can preview them; only owners play as them |
| 3.9 | **Dances**: international dances with their real steps (motion capture) |
| 3.10 | **Awards**: badges, achievements, milestones, shown on the character and the profile |
| 3.11 | **The player's profile**: every stat, the awards, the history, part of it public; text chat in the lobby, the match and the profile; direct messages |
| 3.12 | **The server split** (see "Microservices" below) |
| 3.13 | **The performance plan** (see "Performance" below): baked light, KTX2, interest-managed snapshots, animation level of detail |

## Performance: the Meta AI conversation, point by point

The owner's rule: never change the game's design, structure or graphics.

| Point | Verdict |
|---|---|
| Bake lighting into the world; one sun; fake reflections | **Take** for the static world (3.4): it's how the look gets closer to Unreal for free. Moving things keep the sun's shadow on Medium and up |
| Cap the pixel ratio | **Done**: Low 1.25, Medium 1.75, High 2 |
| No antialias on low phones; high-performance GPU | **Done**: no antialias on any tier (the film look's grain hides it), high-performance GPU asked for |
| InstancedMesh for trees, rocks, crowds, bullets | **Done** (17 systems) |
| LOD | **Done** for people and trees. **Take** for animation: far bodies animate at 15–30 fps |
| Merge static geometry | **Done** for loaded models (each one merged into one mesh). **Take** for the city's buildings in 3.3 |
| Textures 1024 px on phones; KTX2 + Basis | **Take** (3.4): KTX2 cuts GPU memory about 4×; the biggest single win left for low phones |
| Draco | **Already better**: meshopt, which decodes faster on phones |
| Under 40 MB first load, stream the rest | **Done**: 650 KB to the lobby, the world streams after |
| Post-processing off on Low | **Done**. Bloom stays on High and Max only; the pickup light glows by additive blending, so it reads on Low too |
| Rebuild in Expo + React Three Fiber, not a WebView | **No.** Lagos Life embeds the game as a web page, so it must stay one game for the web, the app and Lagos Life. The WebView already runs WebGL on the phone's GPU; a rewrite would cost months and change nothing on screen |
| UI in HTML, not in 3D | **Done**: the HUD is plain HTML over the canvas |
| Game logic in a Web Worker | **No** for now: the HUD and the world read the match every frame, so a worker would copy it across every frame. Measure first (3.13) |
| Server decides score and money | **Done**: XP, rank, staked results and runs are server-checked and signed |
| 10 ticks a second, interpolate | **Done better**: 15 snapshots a second, 120 ms interpolation. **Take**: far players sent less often (interest management), which cuts server bandwidth about half in 24-player matches |
| Binary, not JSON | **Done** for snapshots (packed bytes since protocol 18). Events stay JSON: they're rare |
| Rooms of up to 50 | **Done**: rooms of 12 and 24, spread across nodes by a directory |
| WebRTC data channels | **No**: needs relay servers; at 15 snapshots a second WebSocket is fine |
| Colyseus or Nakama | **No**: our room server already does what they do (rooms, rejoin, server rule, directory); switching is a rewrite |
| CDN for assets | **Done** (Cloudflare Pages); R2 when the owner sets it up |
| Kubernetes | **No**: Fly.io machines scale per process |

## Microservices

**Agreed with the rule:** everything inside a match stays one process; what's
outside a match can be split. The match node already is that one process.

| Service | Today | Plan (3.12) |
|---|---|---|
| Match node (movement, shots, items, zone, room state) | One process per node, rooms of 12–24 | Stays one process: never split |
| Matchmaking and presence | Already its own process (the directory, `dirMain.ts`) | Kept |
| Auth and profile | Part of the node | **Split**: profile, awards and dashboard (3.10, 3.11) |
| Leaderboard | Part of the node | **Split**: a sorted set in Redis |
| Chat and friends | Part of the node | **Split** with the chat in 3.11 |
| Shop and payments | The node + the EMILGO server | **Split**: purchases, CP checks, webhooks |
| Billboards and ads | Part of the node | **Split** |
| Analytics | None | **New**, write-only, batched: never on a match's path |
| Talk between services | — | Redis pub/sub; plain HTTPS for the phone. No gRPC: it adds tools and gains little at this size |

Start with three, as advised (match node, profile, leaderboard), then the rest as players come.

## Questions for the owner

1. **"Speed walk"** in the controls you want kept. The move stick walks, and sprint is its own button. Did you mean an auto-run button (keeps running until you touch the stick)? Built: not added until you say.
2. **The zone.** One answer says "leave it" (3.5 minutes) and another approves the change. Built COD-style, as your note on dying asks. Say if you want the 3.5 minutes back: it's one line.
3. **Real-life meetings.** Chat to anyone, with the option to meet in real life, needs safety rules: under-18s can't get direct messages from strangers, phone numbers and addresses are blocked in chat, and every chat has report and block. Agree?

## Limits to know

- **Copying games:** the runner mode can follow the genre (lanes, jump, slide, coins, a chaser) but none of those games' characters, art, names, music or courses. The same for COD.
- **Google and Meta ads on billboards:** neither puts ads inside a 3D world. Google's web-game ads are full-screen breaks and rewarded ads; Meta's network doesn't serve the web. Brand ads reach 3D billboards through in-game ad networks (Anzu, Frameplay, Gadsme, Adverty and others), which buy from Google's and others' ad exchanges. Each needs a publisher account the owner signs up for (2.14).
- **Lagos Life:** no paid billboards and no ads before purchases there (Agreement 4(g)); only `Vatar.purchase`.
- **Real phones:** every number still comes from headless Chrome with a slowed CPU.

## Decisions

| Topic | Decision |
|---|---|
| Kept items | Smoke Canister, Decoy Flag, Pulse Scanner, Squad Disguise, Titan Serum, Map Print. The removed items' rules stay in the code, out of every table |
| Emotes | Shaku Shaku and Zanku, free (they were the paid Owambe pack). The new dances (3.9) can become the paid pack |
| Vehicles | Off in every mode; the code and the Van Key stay, unused |
| CP | Stays earned-only; pay grows with the win and the level |
