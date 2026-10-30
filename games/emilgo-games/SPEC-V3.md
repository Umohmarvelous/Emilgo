# EMILGO Games v3: the spec (28 Oct 2026)

The owner's brief is saved word for word in
[SPEC-V3-ORIGINAL.md](SPEC-V3-ORIGINAL.md). This file is the approved plan
built from it, with the owner's answers. **Where SPEC-V2 or SPEC-ORIGINAL
disagree with this file, this file wins.** For the rules of the Red Light,
Green Light build (Ball Haunt), SPEC-V2 still applies until Phase 11.

## Decisions (made while building; change any by saying so)

| Topic | Decision | Why |
|---|---|---|
| Rules this brief overrides | SPEC-ORIGINAL §10 and SPEC-V2's "Removed" row no longer apply to the new modes: a sandstorm (FFA), footprint trails (your own), lightning and storms (Spooky World) are back. The countdown's bass drops are gone everywhere (real ticks instead). The pause menu has no blur. Hoodie-only is lifted (rank outfits). | The v3 brief asks for each. |
| Ball Haunt hidden "by default" | `FEATURES.ballHaunt` exists from Phase 1, but **stays on until the first flagship mode can be played** (Phase 4). It flipped to off in Phase 4. | With it off before then, the game would have nothing to play. |
| Splitting the referee (Phase 1) | Phase 1 moves only the **movement kernel** (the body, `moveContestant`, stance, stamina, walls) into `src/game/core/body.ts`, unchanged; `rules.ts` re-exports it. The module-based match core is built in **Phase 3** with its first modules (zone, items), and Red Light, Green Light moves onto it in **Phase 11**. | The owner: don't spend time on Ball Haunt up front. A core with no module to run would be untested guesswork. |
| The `GameMode` seam in `session.ts` | Built in **Phase 4**, with Free For All, the first second mode, so its shape comes from a real one. Phase 1 adds what menus need now: the mode catalog (`content/catalog.ts`) feeds the Play menu's strip. | Same reason. |
| Practice vs CPUs and rank | **No rank XP** in Solo vs AI; CP as before. The results say "Practice earns CP, not rank XP". | Ranks are earned against people or the Dead Streets run, which the server can check. |
| Red Light, Green Light online rounds and rank | They pay the Free For All formula **in proportion to their length** (`FULL_MATCH_S`, 8 min): a 1-minute round pays an eighth. | A string of short rounds can't out-earn real matches. |
| Lagos Life's leaderboard | Now **total rank XP** (it was the best round score). Vatar keeps each player's highest number, and XP only grows. Per-mode boards (Dead Streets) will be ours. | One board per game; the rank is the progress worth showing. |
| The old levels | Not carried onto the ladder (they live on the phone and could be edited). Level 5 or more on the old ladder shows a **FOUNDER** tag in the lobby. | The plan (§1.4). |
| Content signing key | No key is built into the game yet (`CONTENT_PUBLIC_KEY = null`), so phones play the **built-in manifest** only. The owner makes the key pair when hosting starts (`server/src/content.ts` says how). | Deploys are paused; a key nobody holds is useless. |
| The Play menu's strip of games | Ayo, Naija Ludo and Suwe ("Soon") are gone. It now shows **Ball Haunt** (playable, first), **Dead Streets** and **Free For All** ("Soon" until built), from the mode catalog. The lobby's mode card says Ball Haunt. | The v3 brief is what EMILGO Games is now. |
| Audio pooling | Phase 1 caps one-shot voices at 32 (footsteps dropped first). **Spatial voices** (car engines, zombies) get their own pool when they arrive (Phases 5 and 7). | Nothing spatial exists yet. |
| Mouse look "identical to the joystick" | The mouse goes through the camera's same path, sensitivity settings and smoothing, with no OS acceleration. **Joystick** in Settings makes a mouse drag an actual virtual stick, which is the touch stick exactly. | A mouse moves by distance and a stick by rate, so only the stick option can be literally identical. |
| Nothing plays during pause | Solo already stopped everything. **Online** (the round goes on), the whole mix fades out while paused, menu clicks included, and comes back on resume. | The brief. |
| EMILGO rank identity | The game asks the app for the signed-in account's token over the bridge (`auth`); the game server checks it itself (`SUPABASE_URL`, or `SUPABASE_JWT_SECRET`) and keeps a hash of the user id, nothing else. Without either setting, EMILGO players play unranked (the phone keeps its own count). | Agreement §8: Lagos Life and EMILGO are never linked. |
| Naija World's layout (Phase 2) | Not a hand-written `naija-world.json`: the **plan** (roads, river, the 12 landmarks, the 18 places) is written by hand in `maps/open/naija.ts`, and the streets are **filled in from it by a seeded generator** (about 490 placements, 1,600 solids, built in ~25 ms). Server and phones build the same city from the same seed, so nothing goes on the wire. A weekly map can still ship as data: a plan plus a seed. | Hundreds of hand-placed houses would be slow to change and easy to get wrong; a seed keeps the "same colliders everywhere" rule for free. |
| Naija World's ground (Phase 2) | **Flat**, not a heightfield: the city is level, so the ground is one painted plane (2048² on Medium and High, 1024² on Low) with a fine grain over it. Height comes from the solids: gutters and the river are pits (holes cut in the ground's picture), roofs and stairs are boxes and ramps. | A heightfield on level ground is 8K triangles of nothing. Spooky World can still use one. |
| The edge of Naija World | A **2.6 m block wall** all round (a shared solid), with bush beyond it to the haze. The roads end at it. | Free For All needs an edge; the world's bounds already stop bodies, and the wall shows where it is. |
| The PVS in a low city | Built and baked per cell (rays at 3 m eye height against building masses), but in a 1–4 floor city with long straight roads it **hides 0–1 cells**; it switches off above 3 m (rooftops). The **view distance does the work**: 64 cells → 23 drawn on Low, 36 on Medium. | Honest numbers; the plan's "6–14 visible" assumed taller blocks. Spooky World's walls and trees may give it more to do. |
| The film look, per tier | One system (`graphics/grade.ts`), a look per place. **High**: the post chain, now graded by the look, plus grain. **Medium**: one grade pass (a half-float target). **Low**: no pass: the look's white balance goes into the lights once per build, its exposure into tone mapping, and the vignette is a CSS gradient over the canvas. | The owner's answer, as written. |
| The lobby's film look | The lobby keeps its own pipeline (the blurred set behind you) and is graded **the Low way on every tier** (lights, exposure, the CSS vignette). | A grade pass there would retune its look and add a full-screen pass to the 4 s boot. |
| The interface's warmth | `--white` is a warm white (#fff8ee); the glass panels are warm black; lines and dim text are warm. Accent colours unchanged. | "The interface's colours warmed to match." |
| Naija World in the game | Not yet in the menus: it is walked on `dev/open.html` until a mode uses it (the match core in Phase 3, Free For All in Phase 4). The builder runs in slices between frames (`buildOpenWorldIdle`) so it can build behind the lobby. | Phase 2 is the engine and the city; there is no open-world mode to play yet. |
| Phase 3 in the game (Phase 3) | The match core (`game/core/match.ts`) and its first modules (zone, items, Airfall) are pure and run on the server's side of the code, but **no room plays them yet**: Free For All's rooms come in Phase 4 with the `GameMode` seam. Today they run in the headless test (`sharedtest`) and on `dev/open.html?play=1` (a local match on Naija World). Protocol stays 11. | Phase 3 is the shared gameplay; Phase 4 is the first mode that uses it. |
| The zone's numbers (Phase 3) | A phase's rate fills the exposure meter at **rate × 10% a second** outside the circle (1.0: 10 s to full; 4: 2.5 s). Back inside it drains **12.5% a second**. Each circle lies inside the one before, its centre on ground you can walk to, at least 35% of its radius from the world's edge. The next circle shows **30 s** before it starts closing. | The brief gives the rates, not their unit; early circles forgive, late ones don't. |
| The sky laser is certain (Phase 3) | Once the meter is full the laser **always** hits: it takes 1.2 s to come down and follows you. The meter is the warning you can act on. From the first instant a faint shaft and a closing ring mark the spot (a camera looking level never sees 110 m up), then the white-hot core comes down it. | "Descends slowly … as the warning, then hits instantly." |
| The sky laser's falls (Phase 3) | Prone: a new **roll** (face down, rolled onto the back). A beam within 7° of vertical: knees first. From in front or behind (within 50°): thrown back, or face down. From the side: spun. Each beam's slant comes from its target and time, so every phone draws it, and drops the body, the same way. | §7's four falls. |
| Items built now (Phase 3) | Only items whose effect needs Phase 3's systems are handed out: **Kola Rush** (+15% run and sprint, 10 s), **Zobo Flask** (−40% off the meter at once), **Big Bag** (used: +2 slots for this life, one a life) and Airfall's **Zone Shield** (no exposure for 30 s; the meter doesn't drain either). The rest are in the tables but never scattered or put in a crate until their phase gives them an effect, as modes stay "Soon". | Building melee or vehicle items before melee and vehicles would be guessing. |
| Item tables (Phase 3) | Built into the game (`content/items.ts`), not yet in the signed manifest. A table moves into the manifest (a format change) when a weekly drop needs one. | No week needs one yet. |
| The scatter (Phase 3) | 8 items a hectare × the mode's density: **102** on Naija World at 0.8 (Ranked 77). A little over half at the named places, never closer than 5 m, only on open ground you can walk to (the walk grid). | "Seeded scatter that changes every match." |
| Picking up and opening (Phase 3) | A **tap** of interact takes the nearest item or loot bag within 1.6 m (a full backpack says so). A crate needs interact **held** 3 s within 2 m; letting go, walking off or a knockdown starts you again; the first to finish gets it. Keys on the dev page: E, B or Tab, 1–0 (Shift drops). | §7, §10.3. |
| What a crate holds (Phase 3) | **One rare** item (built: the Zone Shield) and **two** from the mode's table, straight into the opener's backpack; what doesn't fit lands round them. It lands inside the circle the zone is closing to (70% of its radius) as the flare goes up, 20 s before; none in a match's last 45 s. | §10.3 lists the rare loot, not how much. |
| Loot bags (Phase 3) | A dead body's backpack becomes a bag that **glows (and shows on the compass) for 60 s**, then stays, dark, until emptied. Looting takes what fits; the rest stays in it. | §10 #5. |
| Respawns (Phase 3) | When a mode respawns: after its delay, inside the circle the zone is closing to, as far from everyone as can be found (25 m and up), with an empty backpack and meter. | The match core needed it for Find the Flag. |
| The walk grid (Phase 3) | A 1 m grid of where a body fits, flooded from the first start (`game/core/reach.ts`), built once per world in about 0.14 s: items, crates, zone centres and respawns go only on it. | Nothing should land in a wall or a yard with no way in. |
| The compass and the map (Phase 3) | The compass's diamond is the nearest thing within 180 m you'd want: an item you don't carry (gold if rare), a glowing loot bag, or a crate. The map shades outside the zone, dashes the next circle and shows crates as gold squares. | §7's "item compass", plus the zone on the map. |
| Footprints (Phase 3) | Yours only, 40, fading over 20 s, every half stride on the ground; none in water, on metal roofs, in the air or crawling. | §7. |
| The backpack you wear (Phase 3) | Everyone wears one in the open worlds: a small merged mesh on the **chest bone** (it follows every lean); off when you're out (it's the loot bag now), on again when you're back. Drawn only on bodies within 45 m (one draw each). | §3.3 "worn visibly on your back". |
| Which are "modes 1–5" (Phase 4) | §9's numbers: Find the Flag, Hold the Flag, Steal & Reposition, Squad Rally, Scarcity. Scarcity opens at Pro I (its `minRank`); Hustle needs the economy module and shows **Soon** until Phase 6. This week's rotation (the public queues): Find the Flag, Hold the Flag, Steal & Reposition, Squad Rally. Every unlocked mode plays in a private room. | The plan's own numbering; the queue follows §9's "featured rotation of 3–4 modes". |
| Vehicles in the Phase 4 modes | The modes shipped **without** `vehicles` (version 1); Phase 5 added them back as version 2. A phone checks the start's mode version and won't play a mismatched copy ("Update the game"). | No module to run them yet. |
| Ranked (Phase 4) | No Ranked queue yet: **Phase 6**, with modes 6–10. The `ranked` overrides are in each mode already. | §13: "FFA modes 6–10, Ranked". |
| Gidigbo's buttons | Fist, slap, push, grab and **brace (held)** are always there in play, bottom centre. Holding someone, fist/slap/push become **Throw / Trip / Drag**. The held player's stick, pushed the opposite way to the finisher, is the **reversal**. Attack while sprinting is the **shoulder charge**; while crouched, the **sweep**; a slide into someone, the **tackle**. Keys: F fist, R slap, X push, Q grab, Ctrl brace (or the right mouse button, the left one a fist), E interact, B backpack, 1–0 slots. | §4's moves on the buttons people already have; Q and E stop turning the camera in Free For All. |
| Any knockdown drops what's in your hands | A Daze, a trip, a throw, a tackle or a ring-out drops the flag or the street prop you hold; your **backpack stays**. | §4: "you drop whatever is in your hands". |
| Street props (Phase 4) | 36 across the city on open ground: plastic chair, bucket, broom, pestle, bench, slipper. A tap of interact picks one up; it changes your swing until it breaks. The slipper (and the Flying Slipper item) is thrown; the Golden Slipper comes back to you. | §4's list. |
| Items given effects now (Phase 4) | **Pepper Soup** (+20% knockback, 15 s), **Iron Wrapper** (brace without the slow, 10 s), **Flying Slipper** and **Golden Slipper** (thrown stun). The other §10 items wait for Phase 6. | They need only melee. |
| Find the Flag's stash | 40 stash spots, each beside a danfo, a kiosk, a tank or a stall, on ground you can reach. A tap within 2 m searches one; an empty one stays empty (for you). Radio hints are circles that narrow (90, 55, 30 m), named by the nearest landmark in the feed. | §9 #1. |
| Hidden things stay on the server | The flag's stash, the circles to come, the crates' places, the drop zones and the hints come from a **second seed only the server has**; phones learn them from events as they happen. A phone's copy of the match (built from the public seed) can't be read for them. | Otherwise anyone could read the flag's stash from the copy on their phone. |
| Protocol 12 (Phase 4) | Free For All on the wire (`net/matchWire.ts`): the start (the mode and its version, squads), the match's events as they happen (bodies by roster index), snapshots at 15 Hz (position, heading, height, movement, a meter word, what's in the hands; the mode's measure once a second). A rejoin replays the server's event log into a fresh copy. About **5.7 KB/s** a phone with 12 playing. | One copy of the rules on the phone and the server; only what the phone can't work out goes over. |
| Squads and parties | Parties of up to 4: one squad; only the leader picks the game. Squad Rally's fours fill parties first, then the smallest squads. Everyone else is on their own. Squad mates wear a **diamond in the squad's colour** over their heads and show on the map; rivals don't show on the map (a flag holder's ping does). The squad-coloured trim on clothes waits for the loading screen's work (Phase 8). | §7: "a squad-coloured trim and a small diamond, no names". |
| Public queues and private rooms | A public queue starts at 12, or 60 s after it reaches the mode's minimum. A private room starts when everyone in it (2 or more) is ready. No CP boosts in Free For All (they're Red Light, Green Light's). | §9's matchmaking; boosts change RLGL's movement only. |
| The Flag Duel (Lagos Life stakes) | Every staked match plays the **Flag Duel**: Find the Flag for 2–4 on the market (an 80 m arena), first to find the flag and hold it 10 s, 5 minutes; nobody claims it: a draw (every stake back). The signed result and the settlement are unchanged. | The answers: staked matches stay, as a Free For All duel. |
| XP (Phase 4) | From the server at the end, by §2.2 from the standings (squads pooled; ties share the better place): stayed, place, won, the mode's measure against the best. Practice pays none. | §2.2. |
| Practice in Free For All | **On your own** on Naija World, the mode's rules running here: to learn the city and the buttons. No bots. | §9: "There are no bots, ever." |
| "How to play" (Phase 4) | Brief 2b's cards 1–5, drawn as SVG in code; card 1 is each mode's own goal. They show before your first match of each mode and from the Play screen. Card 6 (cars) came with them in Phase 5, in the modes that have cars. | §12 Brief 2b, §3.3 #16. |
| Melee on the bodies (Phase 4) | Swings, hits and the clinch use the existing fist/slap/push/grab animations; a knockdown is the existing fall, then the body gets up. A brace shows as a shield over the head. Dedicated clips (a guard, a throw, a get-up) wait for an animation pass. | The rules and the feel first; clips are art. |
| Ball Haunt hidden (Phase 4) | `FEATURES.ballHaunt` is **off**. The server refuses its rooms unless started with `BALL_HAUNT=1` (its tests do). Red Light, Green Light still lives in `session.ts`, not behind a dynamic import, until its rebuild in Phase 11: the Lagos Life build still carries it. | It flips "in Phase 4"; moving it behind the seam is Phase 11's rebuild. |
| Which modes have cars (Phase 5) | Modes 1–5 get `vehicles` back (each now **version 2**), as do 6–9 where §9 lists them. **Not the staked Flag Duel**: 2–4 people on the market, where a car would decide a paid match. | §9: "unless a mode says otherwise"; a stake should turn on the flag, not on who reached a car. |
| How many, and where (Phase 5) | **One car, or two with 8 or more people**, of a kind the seed picks (danfo, keke, tokunbo). Parked in a lane of a road, facing along it, **at least 100 m from the middle of the starts** and 50 m from each other. A Danfo Key calls a danfo to the nearest road 10–45 m away; never more than 4 cars in a match. | §5 says "1–2 … far from the arena"; FFA has no single arena, so "the middle of the starts" is the arena. |
| Driving controls (Phase 5) | The stick points where to go (the camera's way) and its push is the throttle; **pull it back to brake**. There's no reverse ("forward only"). The camera pulls back and swings behind the car while you aren't looking round. Jump is the **horn**; interact gets in and out. The slap button shows only while someone pulls at your door. Keys: WASD, Space horn, E in/out, R slap, N radio. | One stick and the buttons you already have; on a phone a steering wheel and pedals would crowd the screen. |
| Getting in and out (Phase 5) | From 2.1 m of a door, with the car slower than 2 m/s. Your door gives your seat (the driver on the left: Nigerian roads drive on the right); taken, the other. **Anyone can ride.** Out at speed, you tumble (down 1.2 s). | §5 says two seats; nothing says who may ride. |
| Pushed aside (Phase 5) | A car faster than 1.5 m/s knocks people aside (0.8 m + 0.28 m per m/s) with a wobble up to 0.5 at top speed, **none for the driver's squad mates**, never more than once in 0.6 s. Slower, it just won't let you walk through it. Nobody is ever hurt by a car. | §5: "pushed aside … never killed". |
| The sky and a car (Phase 5) | Faster than 4 m/s with fuel, no exposure builds, and a **laser already coming misses** (it lands where the car was). Slower, out of fuel, or blown up, you're visible again. | §5. A laser in flight has to do something; missing is the point of the car. |
| Fuel (Phase 5) | 30 s of **driving** (the throttle open), not of sitting. Six fuel boys stand on road edges across the city; stop beside one (under 2 m/s, within 4 m) for +10 s, once a match each. The **Fuel Jerrycan** adds 15 s to the car you're in or beside; the **Danfo Key** calls a danfo. Both are Airfall loot, and stay in your pack if there's nothing to use them on. | §5 and §10.3; the jerrycan's amount wasn't given. |
| Damage (Phase 5) | Out of 100: a loss of speed over 2.5 m/s costs 6 a m/s; cornering over 6 m/s² sideways and scraping a wall cost a little each second. Scratched at 15, smoking at 45, **on fire at 75**, then it blows 10–15 s later ("GET OUT" for the last 3). The blast throws the occupants out and down (2.4 s) and knocks away everyone within 5.5 m; **nobody dies of it**. The wreck stays where it is. | §5's states; "never killed" kept for the blast too. |
| Hijack (Phase 5) | Hold interact at a **rival's** driver door for 0.6 s with the car under 2 m/s. A slap (any swing) from inside, driving off, or being knocked down stops it. The driver comes out stunned 1 s and drops what they hold (melee's knockdown); you take the wheel. At a squad mate's door you get in beside them instead. | §5. |
| Slow motion in a blast (Phase 5) | On the occupants' screens only: their fall at 0.3× for 1.6 s and the lens pushed in. The match doesn't slow. | §5. |
| The radio (Phase 5) | Three loops we wrote (highlife, an afrobeats-style groove, a fuji-style one), played by the synthesiser like the doll's songs. **Only the phone in the car hears it**; it stops when you get out. | §5 "synthesised"; a radio everyone hears across the city would be noise. |
| Headlights (Phase 5) | Naija World is played in the day until the Harmattan sandstorm (Phase 6), so the lamps are drawn but **not lit yet**. | Nothing dark to light. |
| Where it lives (30 Oct) | Players: **https://play.emilgo.app** (Cloudflare Pages: free, already set up, sends the frame-ancestors header). Server: **api.emilgo.app** on **Fly.io, London** (one always-on machine, 512 MB, a 1 GB volume for the databases): London is the best-connected Fly region for Lagos (Johannesburg's traffic to Lagos usually goes through Europe anyway). The bare emilgo.app stays for the EMILGO app's site. | The owner's choice of domain; Fly over Railway for picking London; Hostinger's shared hosting can't keep a WebSocket server running. |
| Protocol 13 (Phase 5) | Each snapshot carries the cars (x, z, heading, speed, fuel, damage: 6 numbers each); getting in and out, hijacks, fuel, damage, the horn and the alarm are events. The phone predicts the car it drives with the server's own driving code and smooths the rest. | One copy of the rules on both sides, as in Phase 4. |


## Context (from the plan)

Today EMILGO Games is a single game: **Red Light, Green Light** (Classic Run + Ball
Haunting). It was built in 8 phases to SPEC-V2, then the owner's scanned people
were added (`games/emilgo-games/`, about 34K lines of TypeScript, three.js, an
authoritative Node `ws` server, protocol 10). The owner now wants two flagship
modes on one shared world, plus a single rank ladder:
- **Dead Streets**: solo zombie survival, ranked on a global leaderboard.
- **Free For All**: 12 humans, melee only, 10 objective modes, vehicles.

RLGL stays in the code as a hidden toggle called **Ball Haunt**.

This plan says what exists, how each new system extends it, and the numbers and
designs the owner asked for. It ends with the questions to answer before any
code is written. **Every build phase below waits for the owner's go-ahead**,
as the owner has always worked.

## Owner's answers (28 Oct 2026)

These go into `SPEC-V3.md` as its Answers table in Phase 1.

| Question | Answer |
|---|---|
| Ball Haunt | **Rebuild it with the sky sniper**: Mama removed, the song comes from the sky, the sky laser fires when it cuts; vehicles stay FFA-only. **Do it last**, after Dead Streets and FFA are fully working (Phase 11). Until then it stays hidden as built. |
| Billboards | **Paid ads only in the EMILGO app and on the web.** Lagos Life never shows paid ads. **No made-up brands anywhere.** |
| Empty billboards | **EMILGO Games content**: new modes, this week's top players, rank milestones, Daily Run seeds, and the EMILGO app. Lagos Life always shows only these. |
| Staking | **A staked FFA duel**: 2–4 seats, Find the Flag on a compact part of Naija World, through the existing signed-results path. |
| Looks and moves | **The hoodie-only and no-new-moves rules are lifted.** Add grapple, climb, crawl, aim/reload, drive and the zombie clips. Outfits: urban streetwear (hoodies, joggers) for the lower ranks; **tactical gear, armour and agbadas** as hero outfits at the higher ranks. |
| Dead Streets in the EMILGO app | **Everywhere**: Lagos Life, web and the app. Blood off by default in the app (as today). The app's store age rating must be updated (the owner's task). |
| Modes 7, 9, 10 | **Compound Wars**, **Riddles of the Elders**, **Lights Out**. |
| Cinematic look (owner, 28 Oct 2026, before Phase 2) | **Every mode's environments and the interface look like a film scene, graded like COD:** a warm look, with each environment's colour adjustments designed for it. Built as one shared colour-grade system (`graphics/grade.ts`) with a look per environment, on every graphics tier (Low through lights, fog, tone mapping and a vignette overlay, no extra pass; Medium one grade pass; High bloom, grade and grain), applied to Naija World, Spooky World, the Red Light, Green Light maps and the lobby; the interface's colours warmed to match. |
| Riddle languages | I draft every riddle in Yoruba, Igbo, Hausa, Pidgin and English. Yoruba, Igbo and Hausa are marked "needs review" and **stay hidden until a fluent speaker approves them** (a `reviewed` flag in the content manifest). |

---

## 0. What the code has, and what the brief assumes it has

The brief says to extend "vehicle mechanics, billboard system, item pickup
system… rank persistence", and that Ball Haunt plays "as currently built — doll
replaced by sky sniper… vehicles unchanged from prior approval". **The code has
none of these.** No branch, commit or document has them either.

| Brief assumes | What is really there | Consequence |
|---|---|---|
| Vehicles | Static danfo/car/bus props only (`maps/kit.ts:282-319`) | New system |
| Billboards | Nothing. The nearest thing is a shop-sign atlas (`world/textures.ts`, `atlasQuad`) | New system |
| Item pickups, backpack | Nothing. The only pickups are balls (`game/balls.ts`) | New system; the ball code is the model for it |
| Sky laser / sky sniper | Tower turrets fire 0.28 s beams (`world/lasers.ts`, `fx.beam`). Mama, the doll, is still in | New effect |
| Rank persistence | A local `xp` → level (`game/progress.ts`, `400+100n`), kept on the phone only (`settings.v1`). The server stores purchase grants only | New, server-side |
| Pointer-lock mouse look | Mouse **drag** only (`input/controls.ts:403`, `camera.ts:209`) | New |
| Health, inventory, guns, zombies, torch | None. Combat does no damage | New |
| Lagos Life invite / CP flow | Exists: friends on the phone with an invite relay (`social/friends.ts`, `server/src/presence.ts`); CP earned per round (`shop/boosts.ts:133`) | Reused |
| Vatar SDK | Exists: `platform/lagoslife.ts`, signed results `server/src/vatar.ts:93`, offline score queue | Reused |

**Existing pieces this plan reuses:**
- **Movement kernel:** `moveContestant` (`game/rules.ts:190`) is deterministic, seeded and fixed-step, shared by the server and client prediction.
- **Combat:** fist, slap, push and grab (`game/combat.ts`, `ATTACK` in `config.ts:113`).
- **Solid walls:** `Wall`, `collideWalls` (`game/pens.ts:108`). Layout is worked out from the seed, so walls are never sent over the network.
- **Network:** `NetClient` with reconnect/resume; `OnlineRound` for prediction and interpolation.
- **Server rooms:** `Room` (one place where the referee is created: `room.ts` `begin()` 313–354), and `Lobby` with private codes.
- **Match flow:** `flow/` (machine, waiting room, cinema, walkout, countdown, tutorial player).
- **Highlights and replays:** `Recorder` / `Highlights` (kill cam, play of the game).
- **People:** scanned bodies with distance LOD and a triangle budget (`world/crowd.ts`), ragdoll falls (`human/ragdoll.ts`), keyframed clips (`human/keys.ts` `clip()`/`mirror()`).
- **Map kit:** merged chunks with 3-level LOD (`maps/kit.ts`, `maps/world.ts`).
- **Graphics:** tiers and the low-end GPU class (`graphics/tiers.ts`); the resolution governor (`core/quality.ts`).
- **Sound:** a synth engine with master/music/SFX buses (`audio/sound.ts` `setLevels`).
- **Host:** the `Host` interface (Lagos Life / EMILGO / web).
- **Text:** i18n (EN + Pidgin).
- **Ads backend:** the EMILGO app's ad backend in Supabase: `ad_partners`, `ad_creatives`, `ad_events`, an auction with budgets and frequency caps, and the admin Ad console (`supabase/migrations/migration_ad_partners.sql`, `migration_ad_network.sql`, `src/services/adAdmin.ts`).

**Assumptions in the code that will break:**
- The referee treats the world as a −Z corridor: `progress = startZ − z`, a `|x| ≤ halfWidth` clamp, and a finish at `z ≤ finishZ`.
- `Kit.chunkAt(z)` cuts the map into 1D strips.
- The camera tests walls at `wallX` and loops over every collider (O(n)).
- Mama sits at x=0, which falls, blood and the kill cam all assume.
- `separate()` is O(n²).
- `session.ts` (3,010 lines) imports RLGL directly, with 4 `instanceof RedLightRound` casts.

**Bug found while reading:** `dailyFor` uses `slice(0, 13)` (`progress.ts:59`), so all 7 challenges show instead of 3. It gets fixed in Phase 1.

---

## 1. Architecture: three modes, no forked shared systems

### 1.1 Split the referee into a core and rule modules

```
src/game/core/
  body.ts        Contestant motion fields + moveContestant (moved from rules.ts, unchanged maths)
  space.ts       Bounds (corridor OR rectangle), a uniform-grid collider index (walls, boxes,
                 ramps, roofs) with groundAt(x,z,y), shared by server, client, camera
  match.ts       class Match implements RoundView: phases (walkout/countdown/play/ended only),
                 fixed step, input counters, event queue, separate() on a spatial hash,
                 seeded Rng streams (seed ^ const per module), module hooks
  module.ts      interface RuleModule { init, step, onEvent, snapshot?, view?, decide? }
src/game/modules/       (pure, shared with the server)
  doll.ts        RLGL sing/hum/turn/watch + detect()        ← moved out of RedLightRound
  balls.ts       already exists; becomes a module
  zone.ts        shrinking safe zone, exposure meter, sky-laser trigger
  items.ts       loot table spawn, pickups, 10-slot backpack, death drops
  airfall.ts     ≤3 drops, 180–240 s apart, seeded times and places
  melee.ts       combat v2 (§4) built on combat.ts
  vehicles.ts    arcade vehicle physics, fuel, damage, hijack (§5)
  flags.ts / dropzones.ts / capture.ts / economy.ts / rooms.ts / tag.ts / riddles.ts / blackout.ts
  survival.ts    health, guns, zombies (director, flow-field), finish line (Dead Streets)
```

- `RedLightRound` becomes `Match` + `doll` + `balls`. The 115 rules tests must still pass, which proves nothing changed.
- `session.ts` gets a `GameMode` seam: `createRound`, `previewShots`, `hudMarks`, `compassTarget`, `controls`, `score/xp`, `tutorialCards`, `onEvent`. The RLGL calls in `session.ts` (`:797`, `:922`, `:1182`, `:1486`, `:2060`, `:2071`) move into `modes/rlgl.ts`, beside the new `modes/ffa.ts` and `modes/deadstreets.ts`.
- **Shared** (one copy only): movement, collisions, camera, people, ragdoll, sky laser, audio, HUD, minimap and compass, items, the flow, replays, network, platform, ranks and billboards.

### 1.2 The hidden Ball Haunt

- `FEATURES.ballHaunt = false` lives in `src/config.ts`; the server reads the same file.
- When it is off:
  - the mode is not in the menu, and the server refuses it;
  - `modes/rlgl.ts`, the doll, the songs and the tower lasers sit behind a dynamic `import()`, so the Lagos Life build never downloads that chunk;
  - the EMILGO single-file build includes the code but never runs it, and the doll's meshes are never made.
- **Phase 11 (last):** Ball Haunt is rebuilt on the shared core. Mama is gone; the song plays from the sky; the shared sky laser fires on anyone moving after the song cuts. It keeps balls, the safe line, baskets and collisions. No vehicles.
- Until Phase 11, the code stays as built, hidden and never loaded.

### 1.3 Mode definitions as data (weekly drops with no store submission)

A mode is a **JSON `ModeDef`** that combines built-in modules. Data only: no `eval`, no downloaded code.

```jsonc
{ "id":"find-the-flag", "v":3, "family":"ffa", "name":{"en":"Find the Flag","pcm":"Find Di Flag"},
  "minRank":"rookie-1", "players":{"min":6,"max":12,"squad":[1,4]}, "map":"naija-world",
  "time":540, "respawn":{"on":true,"delay":6},
  "modules":{
    "zone":{"phases":[[60,180,40,1.0],[180,110,40,1.5],[300,60,40,2.5],[420,25,40,4]]},
    "items":{"table":"ffa-core","density":0.8}, "airfall":{"max":3,"gap":[180,240]},
    "vehicles":{"count":[1,2],"kinds":["danfo","keke","tokunbo"]},
    "flags":{"count":1,"spots":"stash","claimHold":10,"hints":[90,180,270]}},
  "win":{"kind":"first","event":"flag.claimed"},
  "ranked":{"xp":2,"respawn":{"on":false},"zone.scale":0.85,"flags.claimHold":20,"flags.hints":[180]},
  "xp":{"objective":"flags.score"}, "tutorial":"ftf-cards", "tags":["rookie","featured"] }
```

**Delivery**
- The server serves `GET /content/v1/manifest`: modes, item tables, map layouts, the playlist rotation and house billboards, signed with Ed25519.
- Phones check the signature, cache the manifest (`content.v1`) and use the cached copy offline.
- The game server loads the same file, so the server and the phones referee from the same definition.
- A room announces `modeId@hash`. A phone that doesn't have it fetches it before loading.

**Limits**
- A new **combination** of modules and numbers ships by data, any week.
- A new **module** (a new kind of rule) needs a code release:
  - **Lagos Life:** redeploy the site at the same address. Under Agreement §3.4 this needs no review.
  - **EMILGO app:** an OTA update of the embedded build (EAS Update, which is JS, allowed). Phones on an older build hide modes whose modules they lack ("Update to play").
- The validator (`content/validate.ts`) rejects unknown modules and out-of-range numbers on both the server and the phones.
- New map layouts ship the same way: a list of placements of existing kit prefabs (§6.2).

### 1.4 Rank persistence across sessions and devices

The server is the only authority. The phone never sends XP; it sends match facts or a run log.

| Host | Profile key | Across devices |
|---|---|---|
| Lagos Life | the per-game Vatar player id (`t_`/`p_`), checked with `verifySession` | Yes: Lagos Life gives the same id on every device |
| EMILGO app | the EMILGO account: Supabase JWT checked by the game server (JWKS), stored as `sha256(host‖uid)` | Yes, signed in |
| Web (direct link) | guest only, kept on the device, not ranked | No |

**Rules**
- **Never linked:** a Lagos Life profile and an EMILGO profile are two separate ladders (Agreement §8.2, README §1). Agreement §8.2(a) allows game-progress data used "only to run your Game". Only an id, XP, stats and unlocks are stored, and they are deleted on request (§8.2(e)).
- **Storage:** the SQLite `profiles` table goes beside `grants` in `server/src/store.ts`:
  - `profiles(key, mode, xp, ds_best_ms, ds_best_score, stats_json, unlocks_json, updated_at)`;
  - `runs(id, key, seed, mode_hash, log_hash, verified, xp, created_at)`.
  - Both sit behind the existing `OwnershipStore`-style interface, ready for Postgres.
- **XP from FFA:** the room's `decide()` hook already knows every result. The server awards XP and pushes `{t:"rank", xp, rank}`.
- **XP from Dead Streets** (solo, can be offline):
  - The phone runs the same deterministic referee and uploads `{seed, modeHash, inputLog}`. The log holds the stick, buttons and aim at 20 Hz, about 40–70 KB gzipped for 12 minutes.
  - The server re-simulates the run headless (est. 1–2 s of CPU, done in a queue) and grants XP and a leaderboard place only if its result matches.
  - Offline runs wait in `runs.queue.v1`, the same pattern as the existing `score.queue.v1`. The results screen shows "+215 XP (pending)" until the run is verified.
- **Lagos Life board:** `Vatar.submitScore(totalXP)`. Vatar keeps each player's highest score, and XP only ever goes up, so the board becomes the **rank board**. Per-mode boards (Dead Streets fastest, weekly Daily Run) are ours, served by our server.
- **Old local levels** are not carried over: they could be edited on the phone. Anyone who had level 5 or more gets a cosmetic **Founder** hoodie badge.

### 1.5 Protocol 11

- `StartInfo` gains `modeId`, `hash`, `map` (layout id) and `squads`.
- **Snapshots:**
  - per player: stride 5, plus a `hp/exposure` byte and an `item-in-hand` byte;
  - vehicles: stride 7 (x, z, heading, speed, damage state, fuel, seats);
  - items, airfall and flags travel as events, like balls do today.
- **New messages:** `party`, `rank`, `runlog`, `content`, `ping` (squad ping wheel).
- With 12 players no interest management is needed: about 12 × 7 + 2 × 7 numbers per snapshot, at 15 Hz, **under 6 KB/s**.
- The Docker server must be rebuilt (it is on protocol 5).

---

## 2. Unified rank ladder

### 2.1 XP thresholds (scales without limit)

- **Calibration:** a skilled FFA player earns about **1,500 XP/hour** (about 5.5 matches an hour × 270 XP); Dead Streets earns about 1,000/hour.
- Rank is derived from **total XP only**. A ladder entry is just `{id, name, divisions:3}`.
- The cost of a division comes from a formula, so adding a tier is one line in the manifest. Nobody's XP is reset; XP past the last tier is banked.

Cost of each division in tier `t` (0 = Rookie), in hours × 1,500 XP:
- Rookie: 0.5 h, 1 h, 1.5 h
- Pro: 5 h, 7 h, 10 h
- Legendary: 20 h, 25 h, 35 h
- From Master on, every division of tier `t` costs **(45 + 15·(t−3)) hours** (Master 45, Grandmaster 60, Mythic 75, Titan 90, the next tier 105 …).

| Rank | Total XP | Hours of skilled FFA play to reach it |
|---|---|---|
| Rookie I / II / III | 0 / 750 / 2,250 | 0 / 0.5 / 1.5 |
| Pro I / II / III | 4,500 / 12,000 / 22,500 | 3 / 8 / 15 |
| **Legendary I** / II / III | **37,500** / 67,500 / 105,000 | **25** / 45 / 70 |
| **Master I** / II / III | **157,500** / 225,000 / 292,500 | **105** / 150 / 195 |
| Grandmaster I / II / III | 360,000 / 450,000 / 540,000 | 240 / 300 / 360 |
| Mythic I / II / III | 630,000 / 742,500 / 855,000 | 420 / 495 / 570 |
| Titan I / II / III | 967,500 / 1,102,500 / 1,237,500 | 645 / 735 / 825 |
| (Tier 8, future) I | 1,372,500 | 915 |

- Average players earn about 60% of the skilled rate, so Legendary takes them about 40 hours. Dead Streets-only players take about 1.5× as long.
- **Ranked matches** pay double XP.
- **No rank decay:** "earned, not given". A separate seasonal **Form** badge (last 20 matches) shows who is active.

### 2.2 FFA match XP

```
XP = 60·stayed                         (0 if you quit; and a 5-min queue lock)
   + 120·(N − place)/(N − 1)           (placement; squads use squad place)
   + 150·won
   + 100·clamp(objectiveScore/objectiveTop, 0, 1)    (the mode's own measure, vs the match's best)
   + min(40, 4·displacements + 6·steals + 5·crates + 3·assists)
   × 2 if Ranked;  +100 first match of the day (once)
```

Worked examples:
- Skilled player, 25% win rate: 60 + ~85 + 38 + ~65 + ~22 ≈ **270**.
- Last place who stayed to the end: about 60–90.

### 2.3 Dead Streets run XP (deliberately lower than FFA)

```
XP = finished ? 100 : 80·routeFraction
   + finished ? 80·clamp((720 − t)/360, 0, 1) : 0    (t in s; full time bonus at ≤ 6:00)
   + min(60, 1.5·kills) + min(45, 1.5·headshots)
   + min(15, 5·loreFound)
   × charm multiplier (voluntary handicaps, §3.3 #21, up to ×1.5)  × 2 if Ranked
```

- Skilled run: 100 + 40 + 45 + 30 ≈ **215** in about 13 minutes with menus, so about 1,000/hour. The most a run can pay is 300 before multipliers.
- **Leaderboard score** (a separate number from XP): `10,000 − 5·seconds + 25·kills + 40·headshots + 100·lore` when you finish; `20·metres` when you don't.

### 2.4 What each tier unlocks

Outfits follow the owner's answer: streetwear at the low ranks, hero outfits at the high ranks. The clothes are generated over the scans (`scanbody.ts`) as the hoodie is today. Each new outfit is a garment layer plus paint, within the per-body triangle levels. Cosmetic only: no outfit changes stats.

| Tier | FFA modes unlocked | Rewards (1–2 per division in FFA) |
|---|---|---|
| Rookie | Find the Flag, Hold the Flag, Steal & Reposition, Squad Rally, Hustle (5) | Hoodie colours and trims, a tracksuit top, 2 emotes, a Pidgin taunt pack |
| Pro | Scarcity, Chase & Reverse, Compound Wars (8) | Adire hoodie, a bomber jacket with cargo joggers, the Dane gun (Dead Streets), the Ranked queue |
| Legendary | Riddles of the Elders, Lights Out (10) | **Tactical gear**: a plate-carrier vest, knee pads and gloves; the Thunder Pestle; perk slot 2 |
| Master | the weekly experimental mode early | **Armour**: a full set with a helmet; a night-vision scope skin |
| Grandmaster | custom private-room rules | **Agbada** (Aso-oke weave, with a fila cap) |
| Mythic | | **Royal Agbada**: embroidered, with gold thread, a cape and an animated sheen |
| Titan | | **Titan armour** (Agbada-draped plate) plus a laser-death colour (cosmetic) and a loading-screen pose |

**What the agbada costs:** loose robes need cloth that moves. It gets a few keyframed "drape" bones on the robe that follow the legs, not cloth physics. It stays inside the High 19.7K and the far 1.6K levels per body.

---

## 3. Dead Streets

### 3.1 Spooky World (320 × 320 m, one merged map)

- **Size:** above the 300 m minimum, and denser rather than larger. A 10–12 minute run comes from a **winding route of about 1.4 km** through ten districts, not from a huge map.
- **Look:**
  - Dark grey and black, a slightly red sky, red and orange lightning.
  - Fake night lighting, the same approach as today (glow vertex colours, lamp halos), with **flickering lamps** (a shader time uniform, no real lights).
  - Lightning is a 0.1–0.2 s pulse on the hemisphere light and the sky uniform, with thunder delayed by distance.

**Districts and landmarks (12), all fictional names:**
1. Motor Park of the Lost (start)
2. Cathedral of the Silent Bell
3. Night Market
4. Old Mosque Courtyard
5. Face-me-I-face-you compounds
6. The Gutters (drainage tunnels)
7. Uncompleted Estate (bare-block skeleton buildings, scaffolds)
8. Tank Farm (burning oil tanks)
9. St. Ruth's Hospital Wing (reuses the abandoned-hospital kit)
10. Farm Edge with the Zombie Pools
11. Railway Cutting
12. The Broadcast Mast (finish: a rescue flare and a gate that opens)

**Sub-locations (18):**
- The barber's shed, the viewing centre, the pharmacy, the schoolhouse (no child zombies: Agreement 4(d)), the generator room, the water tower, the bridge, the bus stop, the shrine of broken masks, the tailor's shop, the police post, the bakery oven room, the cell mast, the courtyard well, the pastor's office, the radio hut, the cold room, the rooftop garden.

**Cultural detail, kept respectful:**
- **Religious buildings are sanctuaries.** Zombies never enter churches or mosques. You get 10 seconds of quiet and slow healing there. No fighting inside, and nothing desecrated.
- **Masks:** weathered Yoruba-style masks and Anansi motifs appear only as **set dressing and lore**. They never play a sacred figure as a monster, because Egungun and Gelede are living traditions.

### 3.2 30 obstacle types

Route clusters marked ✦ are deliberately confusing.

1. Tree climb where there's no road
2. Rooftop gap jump
3. Collapsed-overpass crawl
4. Zombie-pool wade (−50% speed; Lurkers grab at your ankles)
5. ✦ Looping tunnels (two identical junctions; one chalk mark is the only tell)
6. Fallen live power line (sparks in a rhythm)
7. Burning oil tank (flares on a timer)
8. Collapsing building (falls 6 s after you step in)
9. Barricaded door (3 melee hits, or find the key)
10. Climb over a danfo-wreck pile
11. ✦ Market-stall maze
12. Rope bridge over the canal
13. Flooded drainage run
14. Ladder up the water tank
15. Generator puzzle (fuel + switch opens the gate)
16. Bell-tower climb
17. Crawl under barbed wire
18. ✦ Shipping-container maze
19. Okada-wreck ramp jump
20. Zinc sheets swinging in the wind (timing)
21. Floor collapse (drops you to a basement route)
22. Gateman's locked gate (find the keys in the post)
23. Pitch-black room (torch only)
24. Thorn-hedge wall (cut through with a cutlass)
25. Chest-deep flooded underpass (no weapon use)
26. Narrow ledge shimmy
27. Train-carriage pass-through
28. Uncompleted-building scaffold climb
29. ✦ Fake shortcut (a dead end that costs about 20 s)
30. ✦ Mirrored alleys (the same street twice; landmarks break the tie)

**Shared traversal moves:** climb, crawl, wade, ledge and vault are **4 new clips** in `keys.ts` (Q4) and **3 new collider kinds** in `space.ts` (`climb` volume, `crawl` low ceiling, `wade` water).

### 3.3 The core loop and systems

- **Runs:**
  - spawn at the Motor Park; reach the Mast;
  - a 10–12 minute target;
  - the **bleed clock**: after 12:00, health drains 1%/s; at 0, the sky laser.
- **Backpack (10 slots):**
  - holds health, armour, ammo, weapons, night vision, batteries, keys and valuables;
  - worn visibly on your back: one merged mesh on the spine bone;
  - opened with a radial menu; it doesn't pause the game.
- **Torch:**
  - in the right hand when your gun is stowed; a gun has a mounted torch;
  - **one** real `SpotLight` following the camera aim: no shadows on Low, a 512 shadow map on Medium, 1024 on High;
  - plus an additive cone mesh and a bright-centre falloff texture;
  - wet ground and puddles reflect it (the potholes mirror on High).
- **Night vision:**
  - earned by rank or bought with CP; battery-limited;
  - Medium/High: a green mono post pass with grain;
  - Low: no extra pass; ambient light up, green fog and a vignette overlay.
- **Zombies:**
  - scanned bodies with a zombie paint variant in `scanpaint.ts` (grey-green skin, torn hoodie);
  - new clips: shamble, lunge, claw, emerge, crawl, stagger, die;
  - they **rise from the ground**: a crack decal and dust, the hands first, then the full body over 2.5 s;
  - pathing: a **flow field** on a 1 m grid, rebuilt every 0.25 s within 40 m of you;
  - **active caps**: 14 on Low, 20 on Medium, 24 on High, pooled and on the crowd budget.
- **Health:**
  - a damage-only health bar for Dead Streets;
  - at 0, the **sky laser** (§7);
  - the heartbeat speeds up as health falls or zombies come within 8 m.
- **Camera:** third person by default, first person by toggle. Cinematic moments: lightning reveals, the torch sweeping a room, a zombie rising in the beam.

### 3.4 21 extra features, items and mechanics

1. **The Drum Director**: a pacing engine (build, peak, relief) that places spawns out of sight. A talking-drum motif rises in the score before a horde.
2. **Eight zombie types, each with a counter:**
   - Shambler;
   - Okada Runner (fast; stunned by the torch);
   - Crawler (you only see it with the beam held low);
   - Ata Bloater: a pepper-gas burst that blurs and slows you, so shoot it from range;
   - Screamer: calls a horde; melee kills it silently;
   - Agbero Brute: charges; side-step into walls;
   - Pool Lurker: grabs your legs in the pools; mash-free escape by aiming down;
   - Masked: immune to torch stun; headshot only.
3. **Torch stun:** hold the beam on a Runner's face for 0.6 s to stagger it. It costs battery.
4. **Noise system:** sprint, gunshots and breaking glass draw zombies; melee and crouching don't. Stealth routes exist.
5. **Lightning reveals:** each flash outlines hidden zombies for 0.3 s. A brain-over-reflex cue.
6. **Hidden caches:** "Grandma's tin box" under floorboards, found from chalk symbols you learn to read.
7. **Lore:** 24 collectibles (radio broadcasts, diary pages, unnamed newspaper cuttings) that tell how the outbreak began. No invented brand or masthead names, following the owner's rule.
8. **Rank weapons** (every weapon has a weakness):
   - Dane gun (Pro): huge spread, slow reload.
   - Thunder Pestle (Legendary): melee that knocks down groups, slow.
   - Gen-Set Torch (Master): a generator-powered flame jet, loud.
9. **Perks** (pick 1, a second at Legendary):
   - Second Breath: rise once at 30%.
   - Quiet Feet.
   - Eagle Eye: headshot zoom, but a smaller torch cone.
   - Pack Mule: +2 slots, −5% speed.
   - Steady Hand.
10. **Daily Run:** one seed for everyone each day, with its own board. Fair and talkable.
11. **Weekly mutators:** Harmattan Haze, Double Runners, One Bullet, No Torch.
12. **Ghost runner:** race your personal best's ghost. It reuses `Recorder`.
13. **Bounty zombie:** carries a gold key to a vault with rare loot. Hunting it costs time.
14. **Last Stand at the Mast:** defend for 45 s while the gate grinds open, under red flares and lightning. **The screenshot moment.**
15. **Birds and owls as signals:** birds scatter when you run; owls go silent near a Lurker.
16. **Medals:** gold, silver and bronze times per run, plus a flawless badge.
17. **Weapon mods:** mounted torch, NV scope, suppressor (quieter, less damage).
18. **Sanctuary echoes:** a church bell or the call to prayer, softly, guides you towards a sanctuary. Respectful, never a jump scare.
19. **Easter egg:** a broken giant-schoolgirl doll in a toy shop (a nod to Mama). Shining your torch on her eyes three times opens a secret room.
20. **Photo mode** at the finish.
21. **Juju charms:** voluntary handicaps (no torch, melee only, 6 slots) for up to ×1.5 XP.
22. **The run summary map:** your route drawn over the map, the deaths of past runs as faint red dots, and the shortcuts you missed.

---

## 4. Free For All: melee that's fun, not frustrating ("Gidigbo" system)

**No HP bar.** Supremacy comes from position, objectives and displacement.

**The Wobble meter**
- Hits fill a balance meter over the player.
- **Full = Dazed:** knocked down for 1.6 s, and you drop whatever is in your hands (a flag, an item); your backpack stays.
- Wobble drains quickly after 1.5 s without a hit.
- **The only deaths** are the zone's sky laser and lethal hazards (a live wire, a fire). Your backpack drops where you die.

**Moves:** the existing fist, slap and push, plus four:

| Move | What it does | Beaten by |
|---|---|---|
| Slap | quick, low wobble, **interrupts a grab wind-up** | Brace |
| Fist | heavy wobble, 0.35 s wind-up (telegraphed) | Brace, Slap (faster) |
| Push | 2.4 m displacement, little wobble | Grab (clinch) |
| **Brace** (hold) | knockback halved, −40% speed; a timed brace (0.25 s window) **parries** and staggers the attacker | Grab, Trip |
| **Grab / clinch** (Gidigbo) | hold for 1.2 s, then **Throw** (direction of your stick, 3 m), **Trip** (knockdown) or **Drag** | Strike during the wind-up; the escape mind-game |
| **Trip** | slide-tackle or crouch-sweep: knockdown, no wobble | Jump, Brace |
| **Shoulder charge** | sprint plus attack; costs 40% stamina | Side-step, Brace |

- **The escape mind-game:** while held, the held player picks a direction in secret. If it is opposite the thrower's, it is a **reversal**. A choice, not button mashing.
- **Environmental melee:**
  - plastic party chair (3 hits, big wobble);
  - bucket (blinds 1 s, worn on the head: comedy);
  - broom (long reach);
  - pestle (heavy, slow);
  - wooden bench (two-hand sweep);
  - **flying slipper** (throwable stun; it comes back like a boomerang only if you catch it).
  - Everything breaks after its uses.
- **Ring-outs:** being shoved into a gutter costs 3 s of climbing out. Being shoved over a roof edge stuns 1 s. Being shoved out of the zone: the exposure meter.

**Anti-frustration**
- 1.5 s get-up immunity after a knockdown.
- Diminishing stun: wobble gain is −35% for each attacker within 1 s, so no 3-on-1 stun-locks.
- A 120° frontal cone and auto-face within 2 m.
- Hit-stop of 50 ms, plus shake and sound.
- 150 ms input buffering.
- Server-authoritative, with target positions rewound by RTT/2 (capped at 150 ms), the same idea as today's `graceBonus`.

---

## 5. Vehicles (FFA only)

- **Which:** 1–2 per match from `danfo | keke | tokunbo` (a modern car), placed **far from the arena**. Two seats.
- **Physics:** server-authoritative arcade kinematics in `modules/vehicles.ts`:
  - forward only;
  - steering limited by speed;
  - collides with the static index;
  - **players are pushed aside** with a `knock()` impulse and a wobble, never killed.
- **Sky lasers:**
  - above 4 m/s, exposure doesn't build and the laser can't fire, so **you are invisible to the sky** (other players still see you);
  - below that speed, or out of fuel, you are visible again.
- **Fuel:**
  - **30 s** of driving;
  - beeps at 20% and 10%;
  - empty: the car stalls, everyone gets out, and you are visible.
  - **Roadside fuel boys** (jerrycan stands) add 10 s each, once per match each.
- **Damage:**
  - one number per car, raised by impacts (a speed change over a threshold), lateral g in fast turns and scraping;
  - states: clean → scratched → smoking → on fire → exploded;
  - on fire: 10–15 s, then it blows. Occupants get a 3 s "GET OUT" warning;
  - explosion: screen shake, instanced debris, and **slow motion for the occupants only**. That is a camera-and-animation slow-mo on their own screen while their bodies play a scripted eject. The match itself can't slow down for two players.
- **Hijack:**
  - stand beside a door and hold interact for 0.6 s; it can be interrupted by a slap from inside or by driving off;
  - the player pulled out is stunned 1 s and drops what they hold.
- **Cosmetic:** an alarm when bumped, headlights at night or in a sandstorm, horn, and a radio playing three original highlife, afrobeats and fuji-style loops we compose (synthesised).
- **Budget:** each car is about 2–3K triangles with a 600-triangle far LOD, and fits in 3 draw calls.

---

## 6. Naija World (400 × 400 m) and performance

### 6.1 The world

One Nigerian city: a developed **east** (market streets, bus park, offices, schools) fading into an undeveloped **west** (compounds, farm plots, mud houses, a river), with no skyscrapers. Buildings are 1–4 floors; a 5-floor office block at most.

**12 landmarks:**
1. Central Bus Park (danfos, ticket kiosks)
2. Oja Market (stalls, umbrellas)
3. Suya Junction (smoke and grills)
4. Water Tower
5. Viewing Centre (a football crowd room, empty)
6. Community Church
7. Central Mosque
8. Primary School with flag pole
9. Village Baobab Square
10. River Footbridge
11. Petrol Station (no fuel)
12. Telecom Mast

**18 sub-locations:**
- Drainage channels (the gutters)
- Face-me-I-face-you compound
- Rooftops by stairs
- A bus stop
- An okada park
- A barber's
- A tailor
- Mechanic village
- A carpenter's shed
- A cassava farm
- A palm-wine joint
- The chief's compound
- A borehole
- An abandoned uncompleted estate
- An underpass tunnel
- A hidden plaza behind the market
- A generator alley
- A rail siding

The city and village styles come from the existing kit (`building`, `stall`, `danfo`, `hut`, `baobab`, `fence`, `lamp`) and new prefabs: keke, church, mosque, kiosk, billboard, gutter, stairs, roof, water tank, generator.

### 6.2 How it is built and streamed

| System | Approach |
|---|---|
| Layout | **Data:** `maps/layouts/naija-world.json`, a list of `{prefab, x, z, rot, seedVariant}`. The client builds meshes from it; client and server build the same colliders and heights from it. Weekly maps can ship as JSON. |
| Kit | `Kit.chunkAt(z)` becomes `cellAt(x,z)`: a 2D grid of **50 m cells (8 × 8)**. Each cell merges into a 3-level LOD (near: everything; mid: mass+main; far: mass). Foliage, glow and textures merge **per cell per material** into an atlas. |
| View distance | Low 110 m · Medium 160 m · High 220 m. Beyond that, haze. Most of the year the haze is **Harmattan**: authentic, and it hides the cut-off. Cells past the distance are not drawn at all. |
| Occlusion | A **potentially-visible set** per cell, baked when the layout loads by ray-casting building masses (from 64 cells to about 6–14 visible). |
| Instancing | Stalls, lamps, chairs, buckets, items, crates, birds and debris: one draw per prefab. |
| Ground | One heightfield mesh (≈8K tris, 4 m grid near, coarser far). Roofs and stairs are walkable boxes and ramps in `space.ts`. |
| Shadows | The existing approach: real shadows from casters within ±18 m (the selection made 2D, not z-only); building shadows through `shadowOnly` proxies. Off on Low. |
| Camera | Collider lookups through the same grid index (today it loops over every collider). |
| Audio pooling | 16 voices; spatial `PannerNode`s pooled at 6 (Low) and 12 (Medium/High); the nearest win. |
| Billboards | One 2048² atlas for every static ad; at most one live `VideoTexture` (the nearest visible, Medium/High only). |
| Boot | The world is built **after** the lobby is up (in idle time, as Mama is today) and only for the chosen mode. The 4 s boot is untouched. |

**Low-tier budget** (target under 100 draw calls and 100K triangles):

| What | Triangles | Draw calls |
|---|---|---|
| World, about 10 cells at mixed LOD | ≤ 55K | ≤ 40 |
| 12 people (own 3.2K, others 1.6–3.2K) | ≤ 25K | 12 |
| Vehicles | ≤ 4K | 6 |
| Items, crates, flags | ≤ 4K | ≤ 6 |
| Billboards | ≤ 1K | 2 |
| Sky, clouds, zone wall, effects | ≤ 6K | ≤ 10 |
| **Total** | **≤ 95K** | **≤ 76** |

- Spooky World is cheaper: its 70 m darkness acts as the haze.
- **Perf gate for every phase:** the existing `dev/cdp.mjs` at CPU 4× and 6×. Low must hold 30 fps, Medium 60. Nothing ships over budget.
- A real Tecno or Infinix test is still owed and is needed before launch.

---

## 7. Shared systems

- **Sky laser** (`world/skyLaser.ts`; replaces `fx.beam` for eliminations in the new modes):
  - a white-hot column (additive core, bloom on High, a heat-distortion-free glow shell) **descends slowly** from the clouds for about 1.2 s as the warning, then **hits instantly**;
  - white smoke burst, scorch decal and heat flash;
  - the death reaction picks a `ragdoll.ts` fall from the beam angle against your heading and stance: thrown back, spun, knees first, or a roll from prone;
  - triggers per mode: Dead Streets health 0; FFA zone exposure full or a lethal hazard; Ball Haunt moving after the song cuts.
- **Mouse look with pointer lock** (`input/controls.ts`):
  - click the canvas to lock; Esc releases;
  - mouse deltas use `requestPointerLock({unadjustedMovement:true})` (no OS acceleration) and go into the **same** `orbit()` path, the same sensitivity settings and the same smoothing (`k = 1−0.85^(dt·60)`);
  - Settings → Controls → "Mouse look / Joystick". Joystick turns the mouse into a virtual stick on the same `MAX_RATE` curve as the phone;
  - Lagos Life's frame allows pointer lock (`allow-pointer-lock`).
- **Pause menu:** remove the backdrop blur (`styles.css:64`): a solid `rgba(6,8,10,0.88)`, no `backdrop-filter`. Nothing plays while paused online either: the music and SFX buses are muted locally.
- **Audio:**
  - footsteps by surface, from collider and ground tags: sand, concrete, grass, metal (car roofs), puddle;
  - a camera swoosh on every cut;
  - **real countdown ticks** replace the bass drops (`session.ts:356`, `sound.ts:579`);
  - heartbeat;
  - Harmattan wind and a 3 s siren (FFA);
  - spatial car engines and horns;
  - fuel beeps;
  - Dead Streets ambience: owls, roars, thunder, wind through windows, breaking glass, far-off gunshots;
  - **no** heartbeat before the countdown, bass drops, drum choruses, crowd gasps or drum loops;
  - all through the master/music/SFX buses.
  - Zombie voices and gunshots may need a small set of recorded samples (about 250 KB opus, fetched lazily for Dead Streets only), because synthesis sounds cheap for them.
- **Items and backpack** (`modules/items.ts`):
  - 10 slots;
  - seeded scatter that changes every match;
  - a nearest-item diamond on the existing compass strip, hidden if you already carry that type;
  - on death the backpack drops as a loot bag.
- **Footprints:** the local player only; a pool of 40 decals fading over 20 s; dust in Naija World, mud in Spooky World; the sandstorm wipes them.
- **Teammates without name tags:** a squad-coloured trim on any outfit, plus a small coloured diamond over each squadmate. Squadmates only; no names.

---

## 8. Ad billboards (our own system)

- **Client** (`world/billboards.ts`):
  - billboard **slots** are prefabs in the layout: main roads, landmarks, plaza entrances, near the zone, along car routes;
  - formats: static image, slideshow (atlas UV swap), video (one shared `<video>`, muted by default, the nearest visible billboard only, Medium/High; Low shows the poster frame);
  - settings: Ads audio on/off and an ads volume; cycling of 10 s, 30 s or per match, per map or global;
  - the phone fetches `GET /ads/v1/match?map=&host=` at match start and caches it (offline: the cache, then house ads);
  - impressions are **aggregate only**: seconds on screen per slot, with no player id (Agreement 4(f) bans profiling).
- **Backend:** extend the EMILGO Supabase ad stack, not a new one:
  - `ad_creatives` gains `placement='game_billboard'`, `format`, `slot_ids`, `static_premium`, `cycle_s` and `audio`;
  - the auction (`next_ad`) gains billboard slots, with premium static slots outside the rotation;
  - **new advertiser self-serve portal**: Expo web routes, sign-up, uploads into a storage bucket, Paystack (already in the app, on test keys), Flutterwave and Stripe checkout;
  - an approval queue in the existing Ad console;
  - **content rules** in the review queue: no gambling, betting, adult, crypto, scams, or anything Vatar §4(h) lists.
- **Lagos Life (owner's answer):** Agreement 4(g) bans "advertising for paying anywhere other than through `Vatar.purchase`", so paid ads are **switched off by host**:
  - `host.kind === "lagoslife"` never calls `/ads`;
  - the server also refuses `host=lagoslife`;
  - a test checks both.
- **House boards** fill every slot in Lagos Life, and any slot in the EMILGO app or on the web with no booked ad:
  - new modes, this week's top players, rank milestones and the Daily Run seed;
  - and, in the EMILGO app and on the web only, the EMILGO app itself;
  - drawn in code from the manifest, with **no made-up brands**.

---

## 9. The FFA modes

All 10 use Naija World, the zone, items, airfall and vehicles unless a mode says otherwise. **Ranked** means double XP plus each mode's harder rule: no respawns, a zone 15% smaller, fewer hints, worse loot odds.

| # | Mode | Win | Time | Key rules and hazards | Why it's fun and hard |
|---|---|---|---|---|---|
| 1 | **Find the Flag** | First to **claim** the one flag: hold it for 10 s (20 s Ranked) | ≤ 9 min | Hidden in 1 of 40 "stash spots" (inside a danfo, a water tank, under a stall, the bell tower). Radio hints at 1:30, 3:00 and 4:30 narrow it to a district. Claiming makes you glow on everyone's compass. | Searching rewards map knowledge; the claim turns the finder into the target |
| 2 | **Hold the Flag** | Most **cumulative** seconds held | 8 min | One flag (two with 9+ players). The holder is −10% speed and pings on the minimap every 10 s (5 s Ranked). Points per second; squads pool. | Constant reversals; brace and juke |
| 3 | **Steal & Reposition** | First to 5 deliveries, or most at 9 min | 9 min | 4 flags; 3 drop zones, each live 60 s, then it moves. Stealing allowed. Unbanked flags drop on Daze. | Route planning versus interception |
| 4 | **Squad Rally** (squads only) | Most squad members inside the moving **Rally Point** at the end; ties go to cumulative presence | 8 min | The point drives down main roads at walking pace; the last 60 s count double. | Positioning and body-blocking; vehicles are huge here |
| 5 | **Scarcity** | Last standing **with a flag**, or first to the extraction gate with a flag once it opens (6:00) | ≤ 10 min | 3 flags for 12 players. An aggressive zone. No respawns, even in base. | Pure tension; alliances that break |
| 6 | **Hustle** | Highest **Owo** (a fictional score, never ₦) at the time limit | 10 min | Task stations: deliver parcels, sell sachet water, wash a car, carry loads, fix a generator. Owo you carry spills 50% on Daze. Bank it at **Esusu boxes**. The leader shows on the map every 30 s. Sabotage stations. | Risk against reward; comebacks |
| 7 | **Compound Wars** (was Landlord's Court) | Most points | 8 min | One walled compound: 8 rooms worth 1–5 points/s, from the Boys' Quarters up to the Master Bedroom with AC. Hold a room by being inside with the door shut. Keys, a fuse box to darken a room, doors you can jam. A small zone around the compound. | Tight space, doors and timing; a room flips on one shove |
| 8 | **Chase & Reverse** | Last human standing | 7 min | One player starts as the **Ojuju** (from Calabar folklore), the chaser. Tagged humans join the Ojuju. Two **Reverse charms** appear at 3:00: a human holding one can cure an Ojuju back to human. The Ojuju are faster but can't use items. | Comebacks mid-match; the hunted can turn the tide |
| 9 | **Riddles of the Elders** (was Puzzle Chief) | First to solve 3 riddles and return to the Elders' Bench | ≤ 10 min | A riddle every 90 s. **The answer is a place or object on the map**: go there and take the kola-nut token. Riddles are in Yoruba, Igbo, Hausa or Pidgin with an English line beneath; Yoruba, Igbo and Hausa ones show only once they are `reviewed`. Wrong tokens cost 20 s. | Brains over reflex; makes language a strength |
| 10 | **Lights Out** (was NEPA Blackout) | Last player not **found** | ≤ 8 min | Power cuts every 60–90 s dim the map. Everyone carries a small lamp that always shows. Hold a rival in **your** lamp's light for 1.5 s and they're found (out). Hide behind cover; crouch to hide your lamp's glow; generators are hazards. | Hide-and-seek where everyone is hunter and hunted |

**Matchmaking at launch**
- 10 modes × squads × Ranked would split a small player base. So: **a featured rotation of 3–4 modes** in public queues (from the manifest, changed weekly) and **all unlocked modes in private rooms**.
- Public queues start at 12 players, or after 60 s with 6 or more.
- There are no bots, ever.

**Five more concepts for future weeks:**
1. **Owambe Floor:** hold the dance floor; dancing emotes score; shoves knock you off. A spectacle mode.
2. **Mama's List:** each player has a secret five-item shopping list across the market; first home wins; steal from baskets.
3. **Danfo King:** stand on a moving danfo's roof (driven by a player) to score; everyone else tries to climb on.
4. **Pepper Pass:** a hot Ata Rodo pepper goes from player to player by slap; whoever holds it when it pops is out. Rounds get shorter.
5. **Bridge Crossing:** squads carry a load across the river footbridge while others try to shove them into the water.

---

## 10. 22 more FFA features, items and mechanics

1. **Items:**
   - Kola Rush (+15% speed, 10 s)
   - Pepper Soup (+20% knockback, 15 s)
   - Zobo Flask (−40% exposure)
   - Iron Wrapper (brace without slowing, 10 s)
   - Big Bag (+2 slots)
   - Harmattan Smoke Pot (breaks line of sight)
   - Banana Peel (a trip trap)
   - Pepper Powder (a sneeze stagger in a cone)
   - Megaphone (a push wave, slow wind-up)
   - Flying Slipper (a thrown stun)
   - Decoy Flag
   - Talking Drum (shows the nearest rival for 5 s)
   - Aso-ebi Disguise (wear a rival squad's colour for 20 s; ends when you attack)
   - Every item has a counter, listed in the item table.
2. **Emotes with effects** (power-emote cards are items, not free):
   - Zanku Bait: rivals within 6 m who face you take +20% wobble for 3 s; you can't move while dancing.
   - Shaku Shield: 2 s of no knockback, then 2 s slowed.
   - Odogwu Pose: at an objective, +10% capture rate for your squad; you are rooted.
   - Breakdance Sweep: a 360° trip that leaves you dazed after.
3. **Airfall:**
   - at most 3 a match, 3–4 minutes apart at random;
   - an **Ankara-cloth parachute crate**, marked by a flare column 20 s before it lands;
   - open it by holding for 3 s (can be interrupted);
   - rare loot inside: Golden Slipper, Zone Shield (30 s), Fuel Jerrycan, Danfo Key (calls a vehicle to the road nearby).
4. **Harmattan sandstorm events** (FFA only): a siren 3 s before; visibility 25 m; wind drift; footprints wiped; car headlights on.
5. **Death drops:** the backpack becomes a loot bag that glows for 60 s.
6. **Spectators vote** where the next Airfall lands, out of three. **Losing is still fun.**
7. **A ping wheel for squads:** go, help, item, danger, here. No voice (Lagos Life has no microphone).
8. **Squad help-ups:** a squadmate shortens your Daze by 50%.
9. **Displacement feed:** e.g. "Tunde dumped Ada in the gutter", replacing the kill feed.
10. **Bounty on the leader** in Hustle and Hold.
11. **Play of the game** is reused (`Highlights`): a new moment kind, "best displacement".
12. **Honour after the match:** commend a player; tracked as a cosmetic title.
13. **Weekly mutators:** Juju Day (low gravity), Rainy Season (slippery), Market Day (double items).
14. **A danfo traffic hazard:** an empty bus on a schedule (seeded, so the server and phones agree) sweeps a main road and shoves anyone in the way.
15. **Unlock ceremony:** reaching a rank plays a short cinematic, and the newly unlocked mode card flips in.
16. **First-time flows:** each mode's first play shows its tutorial cards (§12); tooltips show on first use of each item.
17. **Queue mini-game:** practise shoves on a dummy in the waiting room. A practice dummy is not an opponent.
18. **The Form badge** and **streak hoodie glow** (only for winning streaks).
19. **The zone wall:** a shimmering heat curtain drawn as a cheap scrolling-texture cylinder. Outside it, a tint and the heartbeat.
20. **Gutter rescue:** a squadmate can pull you out of a gutter in 1 s.
21. **Rooftop zip-lines:** two per map, one way only, so you can't use them to escape the zone.
22. **Post-match heat map** of where you went and what you held.

---

## 11. Vatar and platform compliance

| Rule | How it is met |
|---|---|
| No cash-out; no gambling mechanics | Owo and CP are scores and earned currency, never money. No paid loot boxes: Airfall is gameplay only. |
| Stakes 2–4 seats only; ₦100,000 per match; ₦500,000 per day; 5% cut, 40% of it to us | A 12-player FFA match and a solo Dead Streets run can't be staked. **Staked play is the FFA duel** (owner's answer): a 2–4 seat Find the Flag on a compact district of Naija World, with no boosts and no Ranked. `STAKED` in `config.ts` points at its `ModeDef`. The signed-result path is reused unchanged (`vatar.ts` `signResult`): first to claim the flag wins; a timeout is a draw. The stake limits are kept by Vatar's own sheet, and the client's clamp stays. |
| HMAC-SHA256 results from the server | As today. |
| Purchases only through the Vatar SDK | As today (`Vatar.purchase`); rank outfits are earned, never sold. |
| AI never the default; no AI opponents | FFA is humans only. Dead Streets zombies are the environment in a solo run. |
| Offline turns staking off | It already does, because matches need the server. Dead Streets offline runs are queued for verification. |
| Content | Fictional violence (Agreement 4(c) is about promoting real-world violence). Blood stays a setting (on in Lagos Life, off in EMILGO). No child zombies. Religious sites are respected. |
| No tracking or profiling | Ad impressions are aggregate. Profiles hold only id, XP, stats and unlocks. |
| Never link players across services | Two ladders (§1.4). |

**Also:**
- **The EMILGO app ships Dead Streets too** (owner's answer). Blood stays off by default in the app. **The owner updates the App Store and Play Store age ratings** before the release that carries it. Added to SETUP-KEYS as a release checklist item.
- **Deploys are paused.** The content API, profiles and ads all need the game server hosted with a domain (emilgo.app isn't bought yet). Everything is built and tested locally until the owner says go.

---

## 12. Visual briefs

### Brief 1: Match loading screen

- **Layout:** landscape, three bands.
  - **Left 60%:** your squad, or you alone in Dead Streets, as **3D scanned people** in rank stances, on a low stage with soft rim light. The camera slowly dollies along them, built from `flow/cinema.ts` and `lobbyStage.ts`.
  - **Right 40%:** a **map card**: a top-down render of the play area (taken from the minimap capture), the mode name, the win condition in one line, the time and the zone's first ring.
  - **Bottom strip:** a loading bar styled as a **danfo route sign** (yellow, black lettering, stops as dots that fill: "Building world · Spawning items · Syncing players").
- **Player cards (FFA):**
  - three squad columns of four, or 12 solo cards in two rows;
  - each card: name, a rank badge (a tier glyph with division pips), the squad colour bar, the hoodie colour chip and a ready tick;
  - your card is gold-edged;
  - no flags; never the Vatar avatar next to EMILGO data.
- **Dead Streets:** one hero card, plus your **best time ghost**, the Daily Run seed name and the top 3 for today.
- **Mood:** FFA has warm Harmattan gold dusk with dust in the light. Dead Streets is red-black, with a lightning flash every 4 s lighting the characters from behind.
- **Nigerian touches:** Adire and Ankara patterns as faint card backgrounds; a talking-drum tick on each player joining (a short tick, not a loop); radio-announcer lines in Pidgin as text ("Oya, the flag dey hide for market side o!").
- **Countdown:** when everyone is ready, the cards lock (a stamp sound), 3-2-1 ticks, then a **camera swoosh** from the map card into the world: the top-down view drops into your character's over-the-shoulder view.

**References** (search for these):
1. "Call of Duty Mobile multiplayer match loading screen": two-team cards and the map title. Take: the clean team columns.
2. "Apex Legends squad intro champion screen": 3D characters in poses. Take: the posed 3D models.
3. "Valorant agent select lock-in screen": the lock-in moment and map preview. Take: the stamp-lock beat.
4. "Fall Guys round reveal loading screen": playful mode cards. Take: the one-line win condition.
5. "Rocket League match loading versus screen": the compact player row.
6. "Lagos danfo bus destination sign": the style for the progress bar.
7. "Adire eleko indigo pattern": the card texture.

**How ours differs:** real 3D people from your own lobby, a route-sign loader, Pidgin radio lines, a world-drop transition instead of a fade, and rank shown by stance and hoodie, not just a badge.

### Brief 2a: Dead Streets tutorial (pictures and text, 6 cards, swipe)

Drawn as SVG diagrams in code (a few KB). Shown on the first run and from the Play menu.

1. **The goal:** a map strip from the Motor Park to the Mast, with a dotted winding route and a clock icon at "10–12 min". Text: "Reach the Mast. The longer you take, the more the dark bleeds you."
2. **Pick up:** the backpack with 10 slots, drawn with icons (gun, cutlass, ammo, medkit, battery, NV, key). Text: "You start with nothing. Ten slots. Choose."
3. **Light:** a top-down cone diagram: a bright centre fading out, a torch in hand, and a gun-mounted torch beside it. Then an NV panel in green. Text: "Light shows you, and shows *them* you. Hold the beam on a runner's face to stagger it."
4. **Zombies:** a strip of 5 silhouettes (Shambler, Runner, Crawler, Bloater, Masked), each with one counter icon. Then a 3-frame "hands from the ground" sequence. Text: "Watch the ground crack."
5. **Avoid:** the icons for a zombie pool, a live wire, a burning tank and the bleed clock. Sanctuaries are marked in green: "Churches and mosques are safe ground."
6. **Score:** a formula diagram: time + kills + headshots → XP bar → rank badge.

**References:**
1. "Resident Evil item box inventory grid": slot clarity.
2. "World War Z zombie types infographic": silhouettes with counters.
3. "Until Dawn flashlight dark room": the beam mood for card 3.
4. "Left 4 Dead special infected poster": one silhouette, one tip.
5. "Escape from Tarkov backpack grid": the limited-space feeling.
6. "Nintendo instruction manual illustrated page": simple diagram style.

### Brief 2b: Free For All tutorial (Find the Flag, 6 cards)

1. **The goal:** a 12-figure map with one hidden "?" flag. Text: "Find it. Claim it: hold for 10 s. Everyone will come for you."
2. **The zone:** three nested circles shrinking (1 → 2 → 3), with the outside tinted red, an exposure meter filling, and the sky beam. Text: "Outside the circle the sky hunts you."
3. **Melee:** a triangle diagram: **Strike beats Grab, Grab beats Brace, Brace beats Strike**. Below it, 4 small panels (slap, push, throw, trip) with arrows.
4. **Wobble:** a meter fills, and a figure falls and drops the flag. Text: "No health. Lose your balance, lose the flag."
5. **Hints, items and Airfall:** a radio icon narrowing a district; item icons; an Ankara parachute crate.
6. **Vehicles:** a danfo moving with "invisible to the sky while moving" and a fuel gauge that beeps at 20% and 10%.

**References:**
1. "Fortnite storm circle map diagram": shrinking rings.
2. "Gang Beasts grab and throw controls guide": the grapple illustration.
3. "Fall Guys how to play tips screen": a friendly tone.
4. "COD Mobile battle royale tutorial airdrop": the crate icon language.
5. "rock paper scissors combat triangle fighting game": the counter diagram.
6. "Gidigbo Yoruba wrestling": the stance for the grab panel art.

---

## 13. Build phases (each ends tested, reported and committed, then **waits for the go-ahead**)

1. **Foundations:**
   - `SPEC-V3.md` from this plan and the answers;
   - referee split (core + modules) with all existing tests green;
   - the `GameMode` seam in `session.ts`;
   - the Ball Haunt flag (hidden);
   - `ModeDef` + validator + manifest (local file first);
   - rank ladder + server `profiles` + XP + rank UI;
   - pointer lock;
   - the pause blur removed;
   - countdown ticks instead of bass drops;
   - footsteps by surface and audio pooling;
   - the dailies bug fixed;
   - protocol 11.
2. **Open-world engine:** 2D cells, the layout JSON, shared colliders, heights, stairs and roofs, the PVS, view distance and haze, minimap and compass for open maps, then Naija World greybox → dressed. Perf gate.
3. **Shared gameplay:** items, backpack, death drops, the sky laser and death falls, the zone, Airfall, footprints, the item compass.
4. **FFA core:** Gidigbo melee, 12-player rooms, squads and parties, the featured rotation, results with XP; modes 1–5 and their tutorial cards.
5. **Vehicles.**
6. **FFA modes 6–10**, Ranked, the Harmattan sandstorm, extras (§10).
7. **Spooky World and Dead Streets core:** zombies (clips, paint, director, flow field), health, guns, torch, night vision, the 30 obstacles, server-verified runs, the leaderboard.
8. **Dead Streets extras (§3.4)**, rank rewards and cosmetics, the loading screen.
9. **Billboards:** the client and house ads, then the Supabase extension and advertiser portal (needs hosting and payment keys).
10. **Performance and regression:** a real Tecno or Infinix, an iPhone, and the web; the three builds; docs and handoff.
11. **Ball Haunt rebuild** (only after 1–10 are fully working): RLGL moves onto the shared core; Mama removed; the song plays from the sky; the shared sky laser; still hidden by default behind `FEATURES.ballHaunt`.

**Phase 1 starts with `SPEC-V3.md`.** It records:
- the owner's brief, word for word, as `SPEC-V3-ORIGINAL.md`;
- the Answers above;
- a Decisions table, including the rules this brief overrides from SPEC-ORIGINAL §10 and SPEC-V2 (sandstorm, footprints, lightning in Spooky World, the countdown bass drop removed, the pause blur removed, hoodie-only lifted).

HANDOFF.md and the project memory are updated to point to it.

## 14. Files touched (representative)

- **Refactored:**
  - `src/game/rules.ts` → `src/game/core/*` + `src/game/modules/*`
  - `src/game/session.ts` → `src/modes/{rlgl,ffa,deadstreets}.ts`
  - `src/config.ts` (FEATURES, ladder)
  - `src/maps/kit.ts` (`cellAt`), `src/maps/world.ts` (2D casters, haze)
  - `src/world/camera.ts` (grid colliders)
  - `src/input/controls.ts` (pointer lock), `src/input/actions.ts` (new controls: brace, interact, backpack, reload, aim, fire, torch, NV)
  - `src/audio/sound.ts`, `src/ui/{hud,screens,minimap,scoreboard}.ts`, `src/ui/styles.css:64`
  - `src/net/protocol.ts`
  - `server/src/{room,lobby,store,index}.ts`
  - `src/world/human/{keys,animator,scanpaint}.ts` (new clips, zombie paint)
- **New:**
  - `src/content/{manifest,validate}.ts`
  - `src/rank/ladder.ts`
  - `src/world/{skyLaser,billboards,vehicles,zone,items,torch,zombies}.ts`
  - `src/maps/layouts/*.json`, `src/maps/prefabs.ts`
  - `src/ui/tutorialCards.ts`
  - `server/src/{content,profiles,verify}.ts`
  - Supabase migration `migration_game_billboards.sql`
- **Tests added:**
  - `rulestest` (core parity, modules)
  - `ffatest` (12 players, squads, every mode's win)
  - `runverify` (Dead Streets replay parity across 50 seeds)
  - `vehicletest`, `ranktest`, `contenttest` (bad manifests rejected)
  - a `groundtest` extension (new clips)
  - `loadtest` with 12-seat FFA rooms

## 15. Verification

- **Each phase:** `npm --prefix games/emilgo-games run typecheck`; the full suite from HANDOFF "The test suite" on ports :8797/:8790, plus the new tests; `npm run game:embed`.
- **Perf:** `dev/cdp.mjs` at 844×390 and 390×844, CPU 4× and 6×, slow 4G:
  - Low 30 fps and Medium 60 fps in each new mode, under 100 calls and 100K triangles;
  - lobby ready under 4 s.
- **Browser checks:** a solo Dead Streets run start to finish; an FFA match with the browser plus 11 scripted players; a Lagos Life staked match against `mockvatar` (results signed and settled); offline Dead Streets → reconnect → run verified → XP granted.
- **Real-device pass in Phase 10:** a Tecno or Infinix, an iPhone, a desktop browser (pointer lock).

## Status

### Phase 1: Foundations (done 28 Oct 2026)

| Check | Result |
| --- | --- |
| Tests | rules **115** (unchanged after the body moved out) · **content 27** (new: the built-in manifest is clean, 9 kinds of bad mode dropped alone, the menu by rank 5 / 8 / 10, Ball Haunt off hides it, signed manifests open only unchanged and with the right key) · **rank 42** (new: the ladder against §2.1's table, the XP formulas, profiles, EMILGO tokens: forged, expired and anonymous refused; online: a ranked and a guest player in a real round) · match 20 · balls 29 · shop 22 · social 13 · fairness 7/7 · chat filter |
| Ball Haunt off | Switched off by hand: the server refused a quick room and a private room (`mode_off`); the menu leaves it out (content test). Switched back on. |
| Load, 600 clients | 0 failed · tick p99 8.1 ms · 7.2 KB/s each |
| In headless Chrome | A click takes the mouse; 100 px turns the camera 0.386 rad (the drag's gain); Esc pauses and gives it back; the pause menu has no blur. The lobby shows ROOKIE I (a fake Lagos Life player, checked by the server). The Play strip, both orientations: Ball Haunt, Dead Streets (Soon), Free For All (Soon). Solo results: "+0 XP · +10 CP · Rookie I · Practice earns CP, not rank XP". 300 footsteps at once: never more than 26 voices. |
| Boot to the lobby | Production build, slow 4G, CPU 4×, real GPU: **no change from before v3**, measured side by side (before 4.7–6.3 s, after 5.2–6.4 s) on a Mac under heavy load from other apps (load average 16). The 4.0–4.25 s record was on a quiet machine; it must be re-measured when the Mac is quiet. |
| Builds | Lagos Life `dist/`: 326 KB JS gzipped (was 318) · EMILGO embed: 2,363 KB (was 2,343) · server. **Protocol 11**: the Docker server (protocol 5) needs rebuilding |

Built:
- **Docs**: [SPEC-V3-ORIGINAL.md](SPEC-V3-ORIGINAL.md) (the brief word for word), this file, HANDOFF.
- **Mouse look** (`input/controls.ts`): pointer lock on a click (raw movement), Esc or pause gives it back, a first-time toast; Settings → Controls → Mouse: Mouse look or Joystick.
- **Pause**: no blur (`styles.css`); online the mix fades out (`sound.hush`).
- **Countdown**: timer ticks (`sound.countTick`), no bass drops.
- **Footsteps by surface** (`sound.step`): sand, concrete, grass, metal, puddle; `groundSurface(map)`, `Potholes.wet`. **Voice cap** of 32.
- **Rank** (`src/rank/`): the ladder and XP formulas; server profiles and identity (`server/src/profiles.ts`), the `id` and `rank` messages, awards at every round's end (`Room.onAward`), `DELETE /profiles/<key>`; host identities (Lagos Life session, EMILGO token over the bridge, none on the web); the lobby's rank and bar, FOUNDER, the results' XP line; Lagos Life's board takes total XP.
- **Modes as data** (`src/content/`): `ModeDef` and the launch manifest (10 Free For All modes, the Flag Duel, Dead Streets, Classic Run and Ball Haunting), the validator, the catalog (play / locked / soon / hidden), signed delivery (`GET /content/v1/manifest`, `server/src/content.ts`; the phone verifies Ed25519 and keeps the newest good copy); the Play strip comes from it. The EMILGO bridge may store `content.v1`.
- **Ball Haunt's switch**: `FEATURES.ballHaunt` (on until Phase 4); off, the server refuses its rooms and staked matches, Mama is never built, the menus leave it out.
- **The body** (`src/game/core/body.ts`): the movement kernel, moved out of `rules.ts` unchanged.
- **Fixed**: three daily challenges a day again (all seven were showing).

Not done in Phase 1 (see Decisions): the module-based match core (Phase 3), the `GameMode` seam (Phase 4), spatial voices (Phases 5, 7), a content key (at hosting). The online results line updating from the server is covered by the rank test over the network, not yet seen in a browser round.

### Phase 2: Open-world engine and Naija World (done 28 Oct 2026)

| Check | Result |
| --- | --- |
| Tests | **space 19** (walls, kerbs, stairs, roofs, ledges, gutters, slabs, wading, the edge) · **world 15** (new: the same seed builds the same city solid for solid; 12 landmarks and 18 places; no building over 5 floors; 99.3% of open ground reachable on foot and every landmark and place walkable to; 24 starts on open ground, 40 m apart; a minute of 24 bodies running, jumping and crawling about: never inside a wall, never off the world; 1.7 µs a body step) · rules 115 · content 27 · rank 42 · match · balls · shop · social · fairness 7/7: all passed |
| The city | 659 placements · 1,870 solids · 88 gutter runs · 274 slabs · built in ~20 ms (server and phones, same seed) |
| Draws and triangles (tour of the city, 12 people, shadows counted) | Low ≤ 33 calls, ≤ 40K triangles · Medium ≤ 52 calls, ≤ 67K. Both under 100 / 100K |
| Frame rate (headless Chrome, real GPU, CPU 4× and 6×, 844×390 and 390×844) | Low: lowest 32–42 fps (holds 30). Medium: lowest 56, mean 59 at CPU 4× landscape when the Mac was quiet. **Other runs swung from 10 to 60 fps on both arms of an A/B** while other apps held the load average at 20–80, so the gate was re-run on a quiet machine (28 Oct, evening, load 5–7): **Medium with the grade: lowest 59, mean 60 at CPU 4×; lowest 54, mean 59 at 6×. Low 59/60.** Passed. |
| Building it | 0.55–0.9 s of work at full speed. Sliced: no slice over ~0.2 s at full speed (the rest are GC pauses); the first frame's uploads and shader compiles take up to 1 s and are for the mode to hide (Phase 4) |
| Load test, 600 clients | 0 failed; tick p99 25 ms with the Mac under heavy load (no server code changed this phase; Phase 1 was 8.1 ms) |
| Builds | EMILGO embed 2,370 KB (was 2,363); Naija World isn't in it yet (nothing in the game imports it) |

Built:
- **Ground and walls** (`game/core/space.ts`): solids on a grid, shared by server and phones; bodies keep the floor's height.
- **The prefabs** (`maps/open/prefabs.ts`): 42, with seeded variants and solid parts. **The art** (`maps/open/art.ts`): each drawn from its own parts, so what you see is what stops you; windows and doors as flat quads; trees drop to one stand-in far away.
- **Naija World** (`maps/open/naija.ts`): the plan by hand, the streets from a seed; footsteps on wood added.
- **The builder** (`maps/open/build.ts`): 50 m cells (8 × 8), each a three-level LOD plus one atlas draw for all its textured walls; the painted ground; gutters and the river; the Harmattan haze at Low 110 / Medium 160 / High 220 m (cells past it are not drawn); the PVS; the wall and the bush beyond; shadows from the cells near you; sliced building and async shader warm-up.
- **Compass and map for open worlds** (`ui/hud.ts`, `ui/minimap.ts`): landmark pins and the name you face; the full map with place names.
- **The film look** (`graphics/grade.ts`): see Decisions.
- **Dev**: `dev/open.html?tier=0|1|2` walks the city (WASD, drag to look; `&auto=1` tours it; `&sky=x,z,h` looks down; `&idle=1` builds in slices). `?nograde=1` on the game skips Medium's grade pass, for A/B.

Not done in Phase 2: Naija World in a playable mode (Phases 3–4); a real Tecno or Infinix (Phase 10).

### Phase 3: Shared gameplay (done 28 Oct 2026)

| Check | Result |
| --- | --- |
| Tests | **shared 59** (new: the walk grid; the core's phases, Ranked settings, determinism over 5 minutes of 12 players, 24 pushing into one spot; the zone's nested circles, its timing, 10%/s exposure, the shield, the laser 1.2 s after full, out by the zone, back inside the circle; drain and Zobo; the scatter's count, kinds, ground, spacing and places; pick-up reach, a full backpack, Big Bag, drop, the loot bag, Kola Rush's speed; Airfall's times, flare, landing spot, hold, let go, walk off, first to finish, its loot) · rules 115 · content 27 · space 19 · world 15 · rank 42 · match 20 · balls 29 · shop 22 · social 13 · fairness 7/7 · space 20 · world 15: all passed. Load, 600 clients: 0 failed, tick p99 10.8 ms |
| In headless Chrome (`dev/open.html?play=1`) | Pick up (E, or the button), the backpack radial (use, drop), Kola Rush, a Zone Shield; the zone's curtain from inside and out, the exposure meter, the tint, the heartbeat; the laser's shaft and ring, then its core, the hit, smoke, scorch and a fall (thrown, spun, knees first, and the roll from prone); out, "Back in 6", back inside the zone; a loot bag's green glow; Airfall's flare, the crate under its Ankara canopy, the canopy settling aside, held 3 s open, its three items in the backpack; worn backpacks from behind. |
| Draws and triangles (the city tour, 12 people, a live match) | Low ≤ 52 calls, ≤ 46K triangles · Medium ≤ 72 calls, ≤ 73K. Items, crates and loot bags: 6 calls, ≤ 1.3K. Under 100 / 100K |
| Frame rate (CPU 4× and 6×, 844×390 and 390×844, real GPU, a live match with the zone at 6× speed; a quiet Mac, load 5–7) | Low: lowest 43–54, mean 57–59 (holds 30). Medium: lowest 54, mean 59 at CPU 4× (both layouts); at CPU 6× lowest 39–48, mean 47–50. The city alone, the same runs: Low 59/60, Medium 59/60 at 4× and 54/59 at 6×, so the match costs Medium about 1 fps at 4× |
| Cost | A 12-player step with the zone, items and Airfall: about 70 µs (a 60 Hz tick has 16,667). The walk grid: about 0.14 s once per world. |
| Builds | Lagos Life `dist/`: 330 KB JS gzipped (was 326) · EMILGO embed: 2,382 KB (was 2,370; nothing in the game imports the match yet) · server |

Built:
- **The match core** (`game/core/match.ts`, `module.ts`): bodies, phases (walkout, countdown, play, ended), a fixed step, separation on a spatial hash, seeded streams per module, events every module hears, timed effects, eliminations and respawns; `settingsOf` applies Ranked. **The walk grid** (`reach.ts`).
- **The zone** (`modules/zone.ts`): nested circles from the seed, announced 30 s ahead, closing on time; the exposure meter; the sky laser's timing. On screen: the heat curtain (`world/zone.ts`), the zone on the map, the zone line, the meter, the tint and the heartbeat.
- **Items and the backpack** (`modules/items.ts`, `content/items.ts`): the scatter, pick up, use, drop, 10 slots (12 with a Big Bag), loot bags. On screen: items turning over pillars of light (`world/items.ts`), the interact button, the backpack radial, effect chips, the compass's diamond, the worn backpack (`human/pack.ts`).
- **Airfall** (`modules/airfall.ts`): up to 3 crates, the flare 20 s ahead, landing inside the closing circle, hold to open, rare loot. On screen: the flare column, the crate under an Ankara-cloth parachute, the gold square on the map.
- **The sky laser and its falls** (`world/skyLaser.ts`, `human/ragdoll.ts`): the shaft, the closing ring, the white-hot core coming down, the hit, smoke, heat flash and scorch; the fall from the beam's angle and the stance, with a new roll from prone.
- **Footprints** (`world/footprints.ts`, `world/decals.ts`).
- **Sounds**: the laser's whine and hit, pick-up, drink, a full backpack, the flare, a crate, the heartbeat, the zone's horn.
- **Dev**: `dev/open.html?play=1` (`&fast=n`, `&seed=n`; E, B or Tab, 1–0, Shift+1–0).

Not done in Phase 3 (see Decisions): rooms on the server and the wire (Phase 4, with Free For All); the items that need melee, flags, squads or vehicles (their phases); spatial voices (Phases 5, 7); a real phone (Phase 10).

### Phase 4: Free For All's core (done 29 Oct 2026)

| Check | Result |
| --- | --- |
| Tests | **ffatest 54 offline** (melee: each move, brace and parry, the clinch and its finishers and reversal, trips, charges, ring-outs, props, slippers, diminishing wobble, get-up immunity; each mode's win; squads; the mirror and the hidden seed; cost) **+ 11 online** (a party, the leader's pick, rank locks, a 12-phone queue start, squads, a rejoin from the log, a win every phone agrees on, XP). **matchtest** plays the staked **Flag Duel** end to end (signed result, settled). Every earlier suite passes (rules 115, content 27, shared 59, rank, balls, shop, social, fairness 7/7) with Ball Haunt on `BALL_HAUNT=1`. |
| In headless Chrome (the real game page, 11 scripted phones from `ffaplay`) | Practice on Naija World; a quick match from the queue to the 12-player start, play, a phone claiming the flag, the results with the server's XP (+23); melee up close (swings, hits, Wobble meters over heads); a private room by mode; the five "How to play" cards. |
| Network | **5.7 KB/s** a phone with 12 playing (snapshots at 15 Hz, events at 30 Hz). |
| Draws and triangles (12 playing Find the Flag on Naija World) | Low 46 calls, 42K triangles · Medium 73 calls, 66K. Under 100 / 100K |
| Frame rate (CPU 4×, 844×390, real GPU; a live 12-player Hold the Flag with `ffaplay --n 11`) | Measured on 30 Oct once the Mac was quiet (load 5): **Low lowest 38, mean 57.9** (39 draws, 36K triangles) · **Medium lowest 46, mean 56.3** (68 draws, 64K). Holds 30. (On 29 Oct other apps kept the load at 18–160 and no run was fair.) |
| Load (600 players, 50 rooms of Find the Flag, a quiet Mac) | Server tick p50 **5.5 ms**, p99 19 ms; snapshot spacing at clients p50 66 ms, p99 150 ms (target 67); 6.2 KB/s a client; 199 MB. |
| Cost | A 12-player step of Find the Flag with melee: **142–160 µs**. Found and fixed on the way: the bodies' spatial hash kept every cell ever visited and emptied them all each step (5.7 ms a step after two minutes). |
| Found in the browser test | A phone back online after the server had let its seat go, mid Free For All, went back to the queue as if the match had never started (and asked for a Ball Haunt room). Now it lands on the Play screen with "you lost your place"; a phone still in the queue looks again in the same mode. |
| Builds | Lagos Life `dist/`: 398 KB JS gzipped (was 330: Naija World's builder and Free For All now ship) · EMILGO embed: 2,593 KB (was 2,382) · server |

Built:
- **Melee, Gidigbo** (`modules/melee.ts`): the Wobble and the Daze, fist/slap/push, brace and the timed parry, grab → clinch → Throw/Trip/Drag with the reversal, the sweep, the tackle, the shoulder charge, ring-outs (gutter, roof), get-up immunity, diminishing wobble, the cone and auto-face, input buffering, lag rewind; street props and thrown slippers; Pepper Soup, Iron Wrapper, the slippers.
- **The flag modes** (`modules/flags.ts`, `dropzones.ts`, `capture.ts`): Find the Flag, Hold the Flag, Steal & Reposition, Squad Rally, Scarcity, and the staked Flag Duel.
- **Rooms** (`server/src/ffa.ts`, `room.ts`, `lobby.ts`): the public queue per featured mode, private rooms by mode, parties, squads, rank locks, rejoin, XP at the end; Lagos Life stakes play the Flag Duel. Protocol 12 (`net/matchWire.ts`).
- **The phone** (`modes/`, `net/onlineMatch.ts`, `world/ffa.ts`): the `GameMode` seam; a copy of the match with your body predicted; flags, props, drop zones, the rally point, the gate; melee on the bodies; meters and squad diamonds over heads; the objective line, the compass's objective pin, hints and pings on the map; the melee buttons and keys; the Play screen for Free For All, parties, the results; "How to play" (`ui/ffaCards.ts`).
- **Ball Haunt hidden**: `FEATURES.ballHaunt = false`.
- **Dev**: `ffaplay` (scripted phones for a browser test, `--hunt`), `loadtest --ffa`.

Not done in Phase 4 (see Decisions): vehicles and card 6 (Phase 5); Ranked, Hustle and modes 6–10 (Phase 6); the squad-coloured trim on clothes and the match loading screen (Phase 8); dedicated melee clips (an animation pass); Red Light, Green Light behind a dynamic import (Phase 11); the Lagos Life staked match seen in a browser (its server path is tested by `matchtest`; the phone runs the same code as a quick match); a real phone (Phase 10).

### Phase 5: Vehicles (done 30 Oct 2026)

| Check | Result |
| --- | --- |
| Tests | **cartest 50** (where they start, driving, walls and gutters, people pushed aside, riders can't be hit, the sky and a laser that misses, fuel and its beeps, a fuel boy once, the jerrycan and the Danfo Key, fire 10–15 s then the blast, nobody dies, a tumble out at speed, the hijack and what stops it, a squad mate's door, a flag carried in a car, the phone's copy agreeing on every seat over 90 s, cost). **ffatest** over the network: a phone walks to a car, drives off, and all 12 copies agree where it is. Every earlier suite passes (rules, content, space, world, shared, ffa 54 + 12 online, rank, balls, shop, social, match, fairness 7/7). |
| In headless Chrome (the real game page, Practice) | Walk to a danfo: "Drive"; in, seated with hands on the wheel; the camera back and behind; the fuel bar, "Get out", the horn and the radio buttons; away at 9.6 m/s; a turn; on fire ("Your car is on fire", smoke and flames), then the blast: the flash, panels flying, thrown out and down in slow motion, back up. |
| Frame rate (CPU 4×, 844×390, real GPU), driving across the city | **Low lowest 37, mean 54.8** (39 draws, 36K) · **Medium lowest 45–56, mean 57.6–59.7** (69 draws, 72K). Holds 30. Medium swung (lowest 4–12 in three runs) only when Cursor's GPU process pushed the load to 13–20; standing still swung the same way in the same minutes, and a CPU profile while driving shows the game's own code under 3% a function. |
| A car | Near, with its wheels: danfo about 1,000 triangles, tokunbo 850, keke 550 (the brief's budget is 2–3K); 2 draws of its own (body, windows) plus one instanced draw for every car's wheels. Past 70 m, its far copy: one draw, 36 triangles. |
| Cost | A 12-player step of Find the Flag with 2 cars driving: **41 µs**. |
| Network | **6.4 KB/s** a phone with 12 playing (Find the Flag, 2 cars). Protocol 13. |
| Builds | Lagos Life `dist/`: 417 KB JS gzipped (was 398) · EMILGO embed: 2,639 KB (was 2,593) · server |

Built:
- **The rules** (`modules/drive.ts`, `modules/vehicles.ts`): parking (1, or 2 from 8 people; far from the middle), arcade driving (forward only, steering by speed and grip, walls, no gutters, the river), bumping people aside (a wobble, never hurt), cars meeting, the sky (hidden over 4 m/s; a laser in flight misses), fuel (30 s, the beeps, the stall), six fuel boys, damage to fire to the blast, the hijack, the Fuel Jerrycan and the Danfo Key.
- **The wire**: protocol 13; the phone predicts the car it drives.
- **The phone**: the danfo, keke and tokunbo, their wheels, lean, smoke, fire and blast, the wreck; the fuel boys' stands; riders seated; the driving camera; horn, radio (three loops of our own), slap-only while hijacked; the car panel (fuel, state, "GET OUT", "They're pulling you out: slap!"); cars and fuel boys on the map; engine, horn, alarm, doors, crash and blast sounds; card 6; Pidgin for all of it.

Not done in Phase 5 (see Decisions): headlights lit (Phase 6's sandstorm is the first darkness); the danfo traffic hazard (§10.14, Phase 6); a real phone (Phase 10).