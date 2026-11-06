# EMILGO Games v5: the brief, in build order

The brief, word for word: [SPEC-V5-ORIGINAL.md](SPEC-V5-ORIGINAL.md). v5 wins
over SPEC-V4 where they differ. Status lives in the table beside each item.

**How it is built (the owner, 6 Nov 2026):** simplest first. Tier 1 and Tier 2
are built straight away, each committed and pushed. **Tier 3 waits for the
owner's go-ahead.** Nothing from "Suggestions" is built without a yes.

## Tier 1: small changes (one file or one system, no new art)

| # | Item | Status |
|---|---|---|
| 1.1 | Dead Streets and Free For All each get an on/off switch in code, with written instructions | |
| 1.2 | Old items out of the loot (Hot Ration, the "pepper" set, the street props) | |
| 1.3 | Outside the safe zone: 3.5 minutes of grace, then health falls slowly | |
| 1.4 | Sky laser: thin, realistic | |
| 1.5 | Male body hidden: everyone is the female body | |
| 1.6 | Lobby poses removed | |
| 1.7 | Gutters removed from every world (the cause of "my character sinks") | |
| 1.8 | Footprints removed | |
| 1.9 | Auto-shoot on by default, manual in Settings | |
| 1.10 | No gun in hand standing or running; it comes up to aim or fire | |
| 1.11 | Health bar over every player and zombie while being shot | |
| 1.12 | Screen blinking fixed | |
| 1.13 | Music skipping fixed | |
| 1.14 | Bag redesigned: small, real | |
| 1.15 | Relics more eye-catching | |
| 1.16 | More billboards | |
| 1.17 | Death: COD-style falls | |
| 1.18 | Avatar back, changeable in the lobby | |

## Tier 2: one system reworked, no heavy automation

| # | Item | Status |
|---|---|---|
| 2.1 | Victory and defeat screens reach the player every time | |
| 2.2 | The big world is what you play: every public mode on it, the old city's wall gone, all places reachable | |
| 2.3 | A real flag you can see in every flag mode; each mode's goal checked end to end | |
| 2.4 | 8-bit CC0 music per screen; new gunshot | |
| 2.5 | Sounds: pick up, use, jump, footsteps of others by distance | |
| 2.6 | Customise bar redesigned: fair skin only, dark suit by default, colour and design really change the suit | |

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
5. **Which old items.** Taken out so far: listed in Decisions. Say if any should stay.
6. **The name.** "Kill Squad" is already a released game on Steam, so it could cause a trademark problem. Ideas to check: **Blackmask**, **Mask Squad**, **Last Upload**. Recommended: Blackmask.
7. **The app to download.** The X prompt needs a store link. Which: EMILGO app, or a new app for this game?

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

## Toggling a mode

See [README.md](README.md) "Showing and hiding a mode".
