# EMILGO Games v7: the brief, in build order

The brief, word for word: [SPEC-V7-ORIGINAL.md](SPEC-V7-ORIGINAL.md). v7 wins over SPEC-V6 where they
differ. Status lives in the table beside each item.

**How it is built (the owner, 11 Nov 2026):** light work first. Tier 1 and Tier 2 are built straight away,
each committed and pushed. **Tier 3 (the heavy build) waits for the owner's go-ahead.** Through all of it:
performance kept as it is (smooth on a medium phone).

## Questions (built as recommended until the owner says otherwise)

| # | Question | Recommended, and built so |
|---|---|---|
| 1 | Treasure Hunt now ends the moment a treasure is found. Who wins? | The first to open a box with a treasure in it wins at once (in squads, their squad). A few boxes hold one (a diamond, gold bars, silver bars, an emerald, a ruby), the rest are empty. No upload machine, no clock. If nobody finds one, the zone still closes: the last standing wins |
| 2 | The jump: "one sound, the one that sounds real (not like a female voice only but a human voice)" | One take, always the same: the most natural of the recorded efforts. Say if you want a man's voice instead (the body is the woman's, so a woman's effort matches) |
| 3 | The American voice: a woman or a man? | A woman, so the two voices are a straight swap (Settings → Announcer: Mandarin-accented / American) |
| 4 | The health pickup | A **Med Kit**: lies in the world like the other items, goes in the backpack, used from it: +60 health over 3 s, stops the gas's harm for those 3 s; carry up to 2 |
| 5 | Flag Duel (the staked Lagos Life match) | Stays (only Lagos Life opens it); "Treasure Hunt only" hides every other Free For All mode |
| 6 | The trees: "are they not 3D?" | No: each tree is a flat picture of a scan that turns to face you (that is the "moving"). Yes, they can be real 3D and still light: a 2–4 k-triangle copy of each scan with its own texture, drawn instanced. That is Tier 3.3; Tier 1 stops their sway now |

## Tier 1: small changes (one file or one system, no new art)

| # | Item | Status |
|---|---|---|
| 1.1 | Free For All shows only **Treasure Hunt**; XP and Ranked work on it; one switch in the code (`FEATURES.huntOnly`) | Done. `FEATURES.huntOnly` in `src/config.ts` (true now): every other public FFA mode off in menus, the rotation and the server; the staked Flag Duel and the test's City Flag stay. contenttest checks both ways |
| 1.2 | The **Smoke Canister** out of every loot table | Done. Out of `ffa-core` and `airfall`; its rule and look kept, unused |
| 1.3 | Default graphics: **Medium** on laptops and desktops, **Low** on phones | Done. Auto: phones and tablets Low, computers Medium; High and Max by choice |
| 1.4 | **Icons only**, no text labels on items and prompts ("tap to open box", the map viewer…) | Done. The interact button is a round icon (a chest for a box, the upload arrow, a hand); effects show icon + seconds; the backpack shows the item's icon big and icon buttons (use, drop); the map drops its labels and "MAP PRINT"; the daily chest's "Tap to open" is a hand. Words kept for screen readers |
| 1.5 | Phone: the long descriptions off the mode and loading screens (Meridian Max's, "This week"'s…) | Done. On phones (narrow, or landscape under 540 px high) Meridian Max's paragraph, "This week", the blurbs, the ways-to-play lines, the notes, the loading screen's radio line and route are hidden |
| 1.6 | **One** jump sound, always the same | Done. One recorded take (the deepest of the three), always the same, nothing layered (question 2) |
| 1.7 | Free For All's worlds: the faceted stones, the farm's long brown ridges and stems, the houses' bare posts **removed** | Done. The "stone" is the drawn bush (a faceted green blob with no collision); bushes and the Old Farm are left out of both worlds (their ground kept clear, so nothing else moved); the houses' veranda posts gone; Low draws the scanned rocks too (~40 KB). Protocol 25 |
| 1.8 | The zone **slower** (COD-style), the gas slower to hurt | Done. Each circle closes over ~2 min (v6: 40–50 s), the last shut at ~16 min; 8 s warning, then about half v6's harm (1.5 → 10 a second) |
| 1.9 | Running: knees **higher**, the camera steadier (no shake) | Done. The run clips were crouched and stretched up to 35%: now quicker steps (up to 1.9×), 10% stretch at most, legs straighter running (head ~12 cm higher); the camera's sprint bob a third |
| 1.10 | The trees stop **swaying** | Done. No sway. The card still turns to you: real 3D trees are 3.3 |

## Tier 2: one system each, built now

| # | Item | Status |
|---|---|---|
| 2.1 | **Treasure Hunt's new rules**: no clock; the first real box opened ends the match; every box inside the zone or just outside it; every box seen from far (a glow and a shining orbit round it) | Not started |
| 2.2 | The **Med Kit** (question 4) | Not started |
| 2.3 | **Near death** (in the gas or badly shot): slower and slower, laboured breath, a slow heartbeat, a struggling voice, COD-style | Not started |
| 2.4 | **Backpedal** COD-style: back walks you backwards, still facing forward | Not started |
| 2.5 | **Sprint and slide** in Free For All, as in the runner | Not started |
| 2.6 | **Solid world**: no walking into buildings, stones, trees, props; only items are walked through | Not started |
| 2.7 | **Daily streak**: badges, awards and rewards | Not started |
| 2.8 | The **pickup orbit**: new designs, electric sparks, more cinematic | Not started |
| 2.9 | The **advertiser screen inside the game**, not a browser tab | Not started |
| 2.10 | **Two announcer voices**: the Mandarin-accented woman and an American; a switch in Settings | Not started |
| 2.11 | The **backpack straps** follow the shoulder and upper arm's curve | Not started |
| 2.12 | The **welcome screen**: no zombie text, a first-timer's "how it plays" in three pictures, a cinematic background from the game's own world | Not started |

## Tier 3: the heavy build (waits for the owner's go-ahead)

| # | Item | Status |
|---|---|---|
| 3.1 | **Lobby and HUD redesign**: the top bar's buttons (Lobby, Loadout, Store, Friends, Clan, Leaderboard) join the tabs, and the tabs move to the top; easy to reach in portrait; the lobby with more detail; a HUD in the big shooters' league (COD, Free Fire), our own style | Waits |
| 3.2 | **Realistic chests** (wood, iron bands, a lock, a lid that opens) and the **treasure reveal**: a diamond, gold bars, silver bars, an emerald… rising out of the right box and bouncing in the air | Waits |
| 3.3 | **3D trees**, light: a 2–4 k-triangle copy of each scan, instanced (question 6) | Waits |
| 3.4 | **A real respawn** (a drop-in, the body landing and rising, the camera following) | Waits |
| 3.5 | **The runner, rebuilt**: on Free For All's maps, billboards on every road (portrait and landscape, ads always running), obstacles that fight back, no levels, XP but not rank, the toughest runner going, competitive | Waits |
