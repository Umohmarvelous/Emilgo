# EMILGO Games v3: the owner's brief (28 Oct 2026)

Saved word for word as pasted in chat. [SPEC-V3.md](SPEC-V3.md) records the
owner's answers, the decisions and the phases. Where the two disagree,
SPEC-V3 wins.

---

Read the entire existing codebase first — every file, every system. Understand the gameplay loop, map system, controls, character controller, audio engine, vehicle mechanics, billboard system, item pickup system, emote system, invite/CP flow, rank persistence (if any), and Vatar SDK integration. Do not propose or write anything until you understand what's there. Every new system must extend what exists, not replace it. Every feature must feel native to the game, not bolted on.

---

## CRITICAL INSTRUCTIONS

1. **Read the codebase first.** No plans, no proposals, no code until you've reviewed every relevant system.
2. **Give me your plan before writing code.** Specifically how you will:
   - Add three game modes (two new, one hidden) without forking shared systems
   - Build the mode-definition system so new modes load dynamically via API without app store submissions
   - Handle unified rank persistence across sessions and devices
   - Build melee combat for Free For All that's fun, not frustrating
   - Build the merged-map architecture (Naija World for Free For All, Spooky World for Dead Streets) at 400m × 400m without exceeding the performance budget
   - Ensure the extended rank ladder (beyond Legendary) scales indefinitely as new tiers are added
3. **Ask me any clarifying questions** before building. Never guess on ambiguity.
4. **Be highly creative.** Copy ideas from popular games (COD, Fall Guys, Gang Beasts, Escape from Tarkov, Fortnite, World War Z, Resident Evil, Until Dawn, Squid Game — but only as *inspiration*, never as copies). Every copied element — name, icon, visual design, animation, sound, mechanic, level concept — must be modified so we own it. Nothing should be an exact clone. Take the spark, make it ours.
5. **Add 10–30 additional features, abilities, items, mechanics, or details** to each section where you think it will make the game more fun or competitive. Don't limit yourself to what I've listed. Surprise me with things I haven't thought of.
6. **Where I've asked for visual briefs, provide text descriptions with 4–7 image references** (URLs to source images or clear descriptions of what to search for). For tutorials: pictures and text only, not video.

---

## THE THREE MODES

### MODE 1 — "DEAD STREETS" (solo survival horror, rank-based)

Solo-only zombie survival. No human opponents in your match — you compete on the global leaderboard by surviving faster, scoring higher, killing more.

**Core loop:** You spawn at one end of the Spooky World, must reach the finish line at the other end. Zombies attack along the way. Your health/time drains slowly if you take too long. Each run is 10–12 minutes.

- Start with **no weapons**. Guns and melee weapons are scattered around the map — find and pick them up (COD Zombies style).
- **Backpack** worn on character's back holds up to **10 items** — health, armor, ammo, weapons, night vision, valuable pickups. Capacity is limited; you decide what to carry.
- **Torchlight on right hand** when gun is stowed. Cone-shaped beam, bright center fading to edges, reflects off reflectable surfaces. Torchlight moves with camera.
- **Guns have mounted torches** and optional **night vision** — earned via rank unlock or CP purchase.
- **Zombies emerge** from random locations — including from the ground, hands first, then full body, gradually. Spawn density increases as you near the finish line.
- **Health depletion:** if zombies attack you, health drains; at zero you're eliminated by the sky laser.
- **Heartbeat audio** speeds up as health drains or zombies close in.

**Spooky World (single merged map):**
- Nigerian city and village architecture, post-apocalyptic. Dark grey/black palette with red/orange lightning flashes. Heavy thunderstorms.
- Not pitch black — flickering street lamps, sickly glows, most areas dark.
- Cracks in buildings, vines on walls, burnt cars without tires, owls/hawks ambient sounds, slightly red sky, periodic lightning.
- Landmarks: mosques, churches, markets, residential homes — weathered, barricaded, boarded, damaged.
- Terrain: rubble, fallen trees, debris-filled buildings, overgrown vegetation, stagnant "zombie pools."
- Nigerian cultural references, twisted: Yoruba masks, Anansi iconography, traditional patterns — all worn/tattered/ominous.
- Sound: distant screams, breaking glass, thunder, occasional zombie roars, gunshots echoing.
- Stealth cues: camo foliage, building facades to hide behind. Environmental hazards: fallen power lines, burning oil tanks, collapsing buildings.
- **30 obstacle types** across the map: climbing a tree where there's no road, confusing tunnel networks that loop, jumping over gaps, crawling under collapsed structures, wading through zombie pools, rooftop routes. Some clusters deliberately confusing to cost players time.

**Camera:** Third-person default, first-person toggle. Torchlight moves with camera. Cinematic moments: torchlight sweeping through dark rooms, zombie reveals, lightning illuminating the map.

**Rank XP formula:** completion time + kills + headshots. Propose exact weights.

**Add 15+ features, abilities, weapons, items, or mechanics** to make this mode more addictive — rank-exclusive weapons, unlockable abilities, easter eggs, hidden loot caches, collectible lore, environmental storytelling, daily challenges. Design them yourself.

---

### MODE 2 — "FREE FOR ALL" (competitive survival, rank-based, solo or squad)

Human players only. No AI. Solo or squads of up to 4 players (invited via Lagos Life). **12 players per match** (3 squads of 4, or 12 solo).

**Architecture:**
- "Level" in this game = **player rank** (persistent XP-based ladder).
- "Mode" = game type selected from a menu. **10 modes at launch**, all playable any time.
- XP from every match feeds player rank. FFA gives more XP than Dead Streets so FFA players rank up faster.
- **Some modes unlock at higher ranks** (Rookie sees 5, Pro unlocks 3 more, Legendary unlocks 2 more).
- Weekly content drops = new modes loaded via API. No app store submissions.

**Safe zone mechanic (COD-style):** Every match has a shrinking safe zone. Outside it, players slowly lose health and are eventually eliminated by the sky laser.

**Melee combat (no guns in this mode):**
- Slap, punch, push, grab, trip, throw.
- Traditional wrestling grapple mechanics.
- Environmental melee (chairs, buckets, brooms).
- Body collision with push mechanics (existing).
- No health bar — supremacy comes from positioning, objective control, displacement.
- Win condition is always objective-based, not pure deathmatch.

**Vehicles (this mode only):**
- 1–2 per match. Danfo bus, Keke napep, or Modern car.
- Placed far from game arena — finding one is a real trek.
- 2 seats (driver + 1 passenger).
- No reverse. Forward only.
- Cannot run into players (push aside, don't eliminate).
- Can drive into safe zone (safe zone moves, cars become transport).
- While moving above minimum speed: **invisible to sky lasers**. Visible to other human players.
- 30-second fuel. Warning beeps at 20%/10%. Fuel out = car stalls, player exits, invisibility ends.
- Visual damage states only: clean → scratched → smoking → on fire → exploded. Damage from rough driving, impacts, high-speed turns. Fire burns 10–15 seconds before explosion. Occupants have 3 seconds to exit.
- Explosion: COD-style — screen shake, debris, slow-motion for occupants.
- GTA-style hijack: attacker pulls driver out (or passenger). Pulled-out player stunned 1s, vulnerable immediately.
- Cosmetic: alarm when bumped, headlights at night, in-car radio, horn button.

**Naija World (single merged map):**
- **400m × 400m** — larger than 300m to feel like a city, not a Battle Royale continent.
- Combined Nigerian city with **urban area and rural/village area** merged. Feels like one Nigerian city with developed and undeveloped districts — not an entire country with multiple states.
- Merge the visual language of the Naija City and Naija Village map sections into one continuous world. Do NOT merge every single map — take the terrain elements, buildings, and details and construct a new combined world.
- **No huge skyscrapers.** Buildings sized to feel realistic — they can fill the screen only when the 3D character is very close. Small and medium buildings only.
- Some standalone houses in centralized clusters.
- Typical Nigerian locations: suya joints, small schools, offices, transport hubs, compounds, market streets, drainage channels, bus parks, viewing centers, churches, mosques.
- 10+ landmarks per map for orientation.
- 15+ explorable sub-locations.

**10 Modes at launch:**
1. **Find the Flag (Classic)** — First solo player or squad to find the single hidden flag wins. Flags placed in creative locations.
2. **Hold the Flag (Longest Hold Wins)** — Longest cumulative holding time wins, not who holds at end. Rewards per minute held.
3. **Steal & Reposition** — Find flags, deliver to designated drop zones before rivals. Multiple drop zones spawn dynamically.
4. **Squad Rally** — Team mode. Squad with most members inside a moving capture point at end wins.
5. **Scarcity** — Only 3 flags exist for 12 players. Survivors carry flags to finish. Last-standing with a flag wins.
6. **Hustle Mode** — Start at ₦0. Complete tasks across map to earn. Highest earner at time limit wins. Sabotage allowed.
7. **[Renamed from Landlord's Court]** — Compound fighting for the best room. Hold, defend, sabotage. Traditional Nigerian compound setting.
8. **Chase & Reverse** — One player is "the Ogre" (chaser); tagged players become Ogres. Last human standing wins.
9. **[Renamed from Puzzle Chief]** — Riddles dropped throughout the match. First player to solve 3 and return wins. Riddles in Yoruba, Igbo, Hausa, or Pidgin.
10. **[Renamed from NEPA Blackout]** — Hide-and-seek in the dark. Periodic power outages dim the map. Every player carries a small light that reveals their position. Last hidden player wins.

**For modes 7, 9, 10:** Keep the concepts but propose **better, less colloquial names** (e.g., "Compound Wars," "Riddles of the Elders," "Blackout"). Before building, propose these renames to me along with 3–5 additional mode concepts. I'll approve which ones replace which.

**Difficulty (Option C):**
- Base modes are challenging for everyone — tighter timers, more complex rules, smaller safe zones, harder objectives.
- Optional **Ranked mode** per match type doubles XP and doubles the pain — no respawns, tighter margins, tougher AI, worse RNG.

**XP progression (very slow — reaching Legendary takes 20–30 hours, Master+ takes 100+ hours):**
- Winning = bigger XP.
- Not winning but completing = smaller XP.
- Progress bar per match.
- Rank advances when XP threshold hit — can replay same mode many times to level up.

**Add 15+ features, mechanics, items, or abilities** to Free For All. Consider: item pickups scattered across map (speed bars, health, attack strength boosts, backpack expansions, emotes that grant temporary abilities). Dying drops your items for others to loot (COD mobile style). "Airfall" (COD airdrop equivalent) drops treasure chests at random intervals — **3 times max per match, 3–4 minutes apart, random timing** — with rare items inside. Emotes that do things (dance moves that distract, taunts, victory poses). Design these yourself.

---

### HIDDEN MODE — "BALL HAUNT" (formerly Red Light Green Light)

Exists in code, **hidden by default**. Developer can toggle ON/OFF from the codebase at any time. When ON, plays as currently built:

- Doll removed, replaced by sky sniper.
- Sniper lasers fire when doll's song suddenly stops (song plays full loop then cuts off).
- Ball hunting, safe line, baskets, collision, vehicles — all unchanged from prior approval.
- All shared systems apply.

When OFF (default): does not appear in mode selection UI, doesn't consume assets in memory, doesn't affect other modes.

---

## UNIFIED RANK SYSTEM

One rank ladder across both visible modes. FFA gives more XP per match than Dead Streets. FFA unlocks **1–2 rewards per rank tier**.

**Extended rank ladder (leave room for more):**
- Rookie I, II, III
- Pro I, II, III
- Legendary I, II, III
- Master I, II, III
- Grandmaster I, II, III
- Mythic I, II, III
- Titan I, II, III
- (Future tiers added without re-architecting)

Each rank unlocks new abilities, cosmetics, hero outfits (rank-appropriate), and a few additional FFA modes.

**Progression must be extremely slow** — reaching Legendary takes 20–30 hours of skilled play. Master+ takes 100+ hours.

---

## SHARED SYSTEMS (apply to all modes)

### Desktop Mouse-Look (Pointer Lock, Active by Default)
- Click into game canvas → cursor disappears, mouse controls camera freely.
- ESC releases pointer.
- Toggle in settings to use joystick instead.
- Must feel identical to mobile camera joystick — same sensitivity curve, smoothing, no auto-correct, no re-centering, no acceleration differences.
- **Pause menu: remove blurry backdrop entirely.** Solid or semi-transparent overlay only.

### Cinematic Audio Layer
- Footsteps vary by surface (sand, concrete, grass, metal on car roofs, puddle splash)
- Camera swoosh on every cutscene transition
- Real countdown SFX on 5-4-3-2-1
- Wind ambience intensifying during sandstorms (FFA only)
- Sandstorm warning siren 3s before storm (FFA only)
- Spatial car audio (FFA only)
- Fuel warning beep at 20%/10% (FFA only)
- Heartbeat speeding up during zombie attack or health drain (Dead Streets + FFA outside safe zone)
- Ambient spooky sounds for Dead Streets (owls, distant roars, thunder, wind through broken windows)
- **No heartbeat before countdown, no bass drops, no drum choruses, no crowd gasps, no ambient drum loops** (explicitly excluded — prior decision)
- All audio respects master/music/SFX volume settings
- Spatial where it matters
- Nothing plays during pause

### Expanded Maps
- Every map/world grows to minimum 300m × 300m (Naija World is 400m × 400m per above).
- Players can leave main paths: side streets, alleys, courtyards, rooftops via stairs, underground tunnels, bus stops, market stalls, abandoned buildings, drainage channels, hidden plazas.
- 10+ landmarks per map for orientation.
- 15+ explorable sub-locations per map.
- Scary locations exclusive to Dead Streets.
- Items/emotes randomly scattered across expanded map every match — never same spots twice.
- HUD compass at top showing direction of nearest item (invisible if player already has one).
- Footprint trails for local player.
- Environmental cues: birds scatter when players run near (Dead Streets only).
- When players die, their items and emotes drop at their location for others to loot.
- Naija City + Village merged into Naija World (FFA only).
- Spooky map sections merged into Spooky World (Dead Streets only).

### Sky Lasers (Universal Elimination)
- White-hot beams — bright, intense, cinematic.
- Visible from sky to ground — bright descending column of pure white heat.
- Beam descends **slowly from sky** then **hits instantly** with no grace period, no freeze window.
- On impact: white smoke bursts from point of contact, cinematic heat effects, player's death animation reacts physically based on laser angle and stance (collapse, spin, fall — like movie deaths).
- **Trigger varies by mode:**
  - Dead Streets: fires when health depletes from zombie damage.
  - Free For All: fires when health depletes from being outside shrinking safe zone.
  - Ball Haunt (when toggled on): fires when player moves after song suddenly stops.
- Slow descent, instant impact, white-hot — universal across all uses.

### Ad Billboards (Custom System You Own)
- Do NOT use Lagos Life's ad system — no revenue share documented.
- Custom backend integration you control and monetize fully.
- **Placement:** high-visibility locations — main roads, landmarks, plaza entrances, near safe zones, along car routes.
- **Ad formats:** static image (loops), slideshow (multiple images), video.
- **Ad audio (your settings):** master toggle on/off; separate volume slider; video ads default muted.
- **Ad cycling (your settings):** 10s / 30s / every match — configurable per map or globally.
- Some ads **static** (permanent placement, premium subscription).
- Other ads **cycle** (lower tier, shared rotation).
- **Backend you own:** advertisers sign up, pay real money, upload assets, choose target maps/billboards, choose static vs. cycling, choose format, set audio preference. You approve/reject. You see analytics. Payment via Stripe, Paystack, Flutterwave. Ad delivery via API — game fetches current ads per billboard on match start, caches locally.
- **Vatar compliance:** billboards are content, not betting. Exclude gambling, adult content, anything Vatar prohibits.

### Backpack & Item Pickups
- 10 items max per player.
- Item types: health span, armor, ammo, weapons, night vision, speed bars, attack strength boosts, backpack expansions, valuable pickups, emotes with temporary effects.
- Items randomly scattered across map every match.
- HUD compass for nearest item.
- Death drops items for others to loot.

---

## VISUAL BRIEFS

Provide text-based descriptions with 4–7 image references for each:

### Brief 1 — Match Loading Screen
The screen where players load into a match, like COD's multiplayer loading screen. Describe:
- Layout and mood
- Character displays (3D models in stance)
- Map preview imagery
- Player cards (name, rank badge, squad position)
- Team compositions (for FFA squads) or solo player list (for Dead Streets)
- Countdown state
- Transition into gameplay
- Nigerian visual elements integrated
- Reference 4–7 existing games (COD, Apex, Valorant) with URL references
- How ours differs

### Brief 2 — Tutorial Screens (Pictures + Text, No Video)
One tutorial screen per mode showing **step-by-step how to win** — using diagrams, images, and text only. Not video.

For **Dead Streets** tutorial:
- Step-by-step illustrated guide to surviving a run
- What to pick up, what to avoid, how to reach the finish
- Zombie behavior illustrated
- Torchlight and night vision explained visually
- 4–7 image references

For **Free For All** tutorial:
- Step-by-step illustrated guide to one representative mode (e.g., Find the Flag)
- Win condition illustrated
- Safe zone shrinking illustrated
- Melee combat illustrated
- 4–7 image references

---

## TECH REQUIREMENTS

- Login in **4 seconds or less** on medium CPU phones
- **No lag** on Tecno Spark, Infinix Hot, and equivalent mid-tier Androids
- **60fps** on mid-range and high-end
- **30fps minimum** on low-end
- **Offline-first** — game state queues locally, syncs on reconnect (already built, preserve)
- **Weekly content updates** via API — new modes, maps, items load dynamically. No app store submissions. Mode-definition system must interpret new modes from data, not hardcoded.
- Map streaming, occlusion culling, audio pooling, billboard texture atlasing — all fair game
- iOS, Android, Web (browser) — all supported

---

## VATAR COMPLIANCE

- No real-money cash-out anywhere
- Staked matches respect all Vatar limits (₦100,000 max stake, ₦500,000 daily per player, 5% house cut, 40% of house cut to you)
- Signed match results posted from server with HMAC-SHA256
- All purchases via Vatar SDK
- AI never default opponent — practice vs AI is opt-in only; neither new mode uses AI opponents (Dead Streets is solo vs environment; Free For All is humans only)
- Offline mode disables staking automatically
- No content violating Vatar's rules (no gambling mechanics, no adult content, no impersonation)
- Ad billboards compliant — content, not betting

---

## DESIGN PRINCIPLES

- **Fun first.** If a mode isn't fun to lose, it isn't fun to win.
- **Brain over reflex.** Players should win by thinking, planning, outsmarting — not just tapping fast.
- **Spectacle.** Every mode has at least one moment players screenshot or clip. Build that moment in.
- **Cultural authenticity.** Nigerian in scenario, visuals, music, humor. No Western genericism.
- **Replayability.** Randomized elements (spawns, objectives, order) so each playthrough feels fresh.
- **Meaningful progression.** Ranks earned, not given. Rewards feel real.
- **Differentiation.** Nothing should feel like a copy of another game's mode. Take the spark, make it ours.
- **Discoverability.** New modes, features, and systems should teach themselves. Tooltips, hints, first-time flows where needed.
- **Balance.** Every ability, item, or mechanic must have a counter. Nothing should be unstoppable.

---

## YOUR TASKS

1. **Read the codebase first.**
2. **Give me your plan** — how you'll add three modes without forking shared systems; how the mode-definition system works; how unified rank persists; how melee combat works; how 400m × 400m maps stream without breaking 30fps; how weekly content updates ship without app store submissions.
3. **Propose the renames for modes 7, 9, 10** (Compound Wars / Riddles of the Elders / Blackout or better) plus 3–5 additional mode concepts for future updates.
4. **Propose exact XP formulas** for both modes.
5. **Propose the exact rank XP thresholds** for the extended ladder — show how long each rank realistically takes.
6. **Propose the exact mechanics for each FFA mode** — win condition, timer, items allowed, hazards, why it's fun and hard.
7. **Deliver the visual briefs** (loading screen + 2 tutorials).
8. **Ask me any clarifying questions** before building.
9. **Then build.** Reuse what exists, extend where needed, keep performance intact, stay Vatar-compliant.

**Goal:** Two flagship modes that feel distinct but share one world. Dead Streets is the solo survival horror grind. Free For All is the competitive social grind. Together they make Emilgo Games a game people live in week after week — without breaking the 30fps floor, the 4-second login, or the Vatar rules.

Be creative. Be Nigerian. Be fun. Surprise me.
