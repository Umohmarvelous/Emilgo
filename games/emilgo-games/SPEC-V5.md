# EMILGO Games v5: the brief, in build order

The brief, word for word: [SPEC-V5-ORIGINAL.md](SPEC-V5-ORIGINAL.md). v5 wins
over SPEC-V4 where they differ. Status lives in the table beside each item.

**How it is built (the owner, 6 Nov 2026):** simplest first. Tier 1 and Tier 2
are built straight away, each committed and pushed. **Tier 3 waits for the
owner's go-ahead.** Nothing from "Suggestions" is built without a yes.

## Tier 1: small changes (one file or one system, no new art)

| # | Item | Status |
|---|---|---|
| 1.1 | Dead Streets and Free For All each get an on/off switch in code, with written instructions | Done. `FEATURES` in config.ts; README "Showing and hiding a mode" |
| 1.2 | Old items out of the loot (Hot Ration, the "pepper" set, the street props) | Done. Out: Hot Ration, Iron Guard, Banana Peel, Pepper Spray, Megaphone, Throwing and Golden Boots, the four dance cards, the street props |
| 1.3 | Outside the safe zone: 3.5 minutes of grace, then health falls slowly | Done. 210 s, then 3 health every 2 s; the laser takes the last of it |
| 1.4 | Sky laser: thin, realistic | Done. A thread, not a pillar; starts 420 m up; smaller smoke and scorch |
| 1.5 | Male body hidden: everyone is the female body | Done. The male file no longer loads (287 KB saved) |
| 1.6 | Lobby poses removed | Done |
| 1.7 | Gutters removed from every world (the cause of "my character sinks") | Done. Rivers, the harbour and Dead Streets' trench obstacles stay |
| 1.8 | Footprints removed | Done |
| 1.9 | Auto-shoot on by default, manual in Settings | Done. Settings → Controls → Auto-shoot |
| 1.10 | No gun in hand standing or running; it comes up to aim or fire | Done. Zombie run: the torch alone until you fire |
| 1.11 | Health bar over every player and zombie while being shot | Done. Players and zombies, while being shot (question 1) |
| 1.12 | Screen blinking fixed | Done. Two causes fixed; needs your phone to confirm |
| 1.13 | Music skipping fixed | Done. Needs your ears to confirm |
| 1.14 | Bag redesigned: small, real | Done |
| 1.15 | Relics more eye-catching | Done as "items on the ground": taller coloured shafts (question 8) |
| 1.16 | More billboards | Done. 39 more: 66 in all |
| 1.17 | Death: COD-style falls | Done. Motion-captured fall, mirrored for half the bodies |
| 1.18 | Avatar back, changeable in the lobby | Done. Tap the avatar in the lobby: 12 drawn, or a picture from your phone |

## Tier 2: one system reworked, no heavy automation

| # | Item | Status |
|---|---|---|
| 2.1 | Victory and defeat screens reach the player every time | Done. They worked, but matches rarely ended. Quitting now shows Defeat too |
| 2.2 | The big world is what you play: every public mode on it, the old city's wall gone, all places reachable | Done. Nine of the eleven places exist; Glass District and Frostline were never built (3.7) |
| 2.3 | A real flag you can see in every flag mode; each mode's goal checked end to end | Done for every public flag mode. The staked duel keeps its stash spots |
| 2.4 | 8-bit CC0 music per screen; new gunshot | Done. Juhani Junkala and SketchyLogic, CC0 |
| 2.5 | Sounds: pick up, use, jump, footsteps of others by distance | Done. Synthesised jump and item sounds; a recorded voice would come with 3.6 |
| 2.6 | Customise bar redesigned: fair skin only, dark suit by default, colour and design really change the suit | Done |

## Tier 3: heavy, waits for the owner's go-ahead

| # | Item | Why it is heavy |
|---|---|---|
| 3.1 | **Treasure Hunt** replaces Find the Flag: 5 hidden boxes, one upload machine (ATM style, screen, circle of light, progress bar), loot drops on death, kills rewarded, squad leader, rewards screen | New rule module, server + phone, machine model, cinematic |
| 3.2 | **Growth items**: pick-ups that change your look and take more bullets to kill. **Map Print**: one use, shows everything live | Rules, new looks per level, map labels |
| 3.3 | **One-thumb portrait**: one joystick moves and looks in portrait, two sticks in landscape; every screen responsive on any phone | Controls, camera and every screen |
| 3.4 | **One click from X**: instant web start, then "download the app" after some minutes | Faster boot, deep links, X card, prompt |
| 3.5 | **Body and face**: thicker thighs and legs, a real face opening, the fully closed mask as a choice, more suits | Re-bake of the body and four levels of detail |
| 3.6 | **Voice**: a voice giving orders, "player X is eliminated" | Choice of voice (question 2), generated lines |
| 3.7 | **Realism pass**: low-poly things replaced with CC0 scans, the two missing places (Glass District, Frostline), Max tuned, phones kept fast | Many assets, measured on each tier |
| 3.8 | **Tutorial** with real pictures of the game | Must be shot after 3.1, 3.3 and 3.7, or it shows the old game |
| 3.9 | **App icon and name** | Needs the avatar image the owner will send |

## Questions for the owner

1. **Health bars.** The brief says both "every player must have one" and "only when they are being shot at". Built: only while being shot.
2. **Voice.** Chinese-accented English, or Mandarin? Recommended: English with a Mandarin accent, an adult woman's voice from an open-licence speech model. Names ("player X is eliminated") can't be recorded in advance, so the phone's own speech voice would read them, and it will differ from phone to phone.
3. **Zone grace.** 3.5 minutes outside in a 9 minute match means nobody is pushed until late. Built: 3.5 minutes as asked. Recommended: 3.5 in the first circles, down to 1 in the last two.
4. **Growth.** On 2 Nov the answer was "no giants". "Grown to the max" here: bigger body, or same size with heavier armour and a fiercer look? Recommended: same size.
5. **Which old items.** Taken out: see 1.2. Kept: Adrenaline Shot, Field Flask, Big Bag, Smoke Canister, Decoy Flag, Pulse Scanner, Squad Disguise, Zone Shield, Fuel Jerrycan, Van Key. Say if any should stay or go.
6. **The name.** "Kill Squad" is already a released game on Steam, so it could cause a trademark problem. Ideas to check: **Blackmask**, **Mask Squad**, **Last Upload**. Recommended: Blackmask.
7. **The app to download.** The X prompt needs a store link. Which: EMILGO app, or a new app for this game?
8. **"Relics".** Nothing in the game has that name. Built as the items on the ground. If you meant something else, say what.
9. **The river.** A character still goes down into the city's river and the harbour's water. Keep them, or make them solid ground too?

## Suggestions (not built without a yes)

- Kill cam: a short replay of who killed you (the replay code exists from Ball Haunt).
- Daily reward chest on the rewards screen.
- Treasure-carrier warning: whoever holds 4 of 5 shows on everyone's compass, so the end of a match always has a fight.

## Limits to know

- **"Like Unreal" on a standard phone:** the look can come close with scanned CC0 models and baked light, but not real-time Unreal lighting. Max stays for strong devices.
- **COD:** the style can be followed, but none of its art, sound, names or layouts can be copied.
- **Real phones:** every number so far comes from headless Chrome with a throttled CPU. A real phone test is still the owner's.

## Decisions

| Topic | Decision |
|---|---|
| Zone in a mode on part of a world | The staked duel and Compound Wars keep the hard edge: their arena is the play area |
| Zone in a car | A bullet can't reach you there, so no slow loss either: the laser comes 60 s after the grace, unless you're driving fast |
| Matches on the big world | Still 12 players in most modes, 24 in the Royale and big Flag: the queue test and server sizing assume it. Worth raising once there are real players |
| Network test | A hidden mode `city-flag` (tag `dev`, opened only by `BALL_HAUNT=1`) keeps the old small city and stash spots, so ffatest still plays a quick full match |
| Protocol | 16. **`fly deploy` is needed** before the test site plays online again |
| Old skin tones | Stay in the save data; the suit ignores them and draws fair skin |
| Designs | The Nigerian-era names are now Geometric, Washed, Urban camo, Digital camo, Tiger stripe, Carbon weave, Gold trim, Titan; ids and rank locks unchanged, so nobody loses one |
| Billboards on the big world | They show house boards. `mx-` boards aren't in the Supabase migration yet, so they can't be sold until a row is added for each |

## Toggling a mode

See [README.md](README.md) "Showing and hiding a mode".
