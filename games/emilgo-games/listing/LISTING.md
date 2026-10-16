# Lagos Life listing — EMILGO Games · Red Light, Green Light

Everything the Lagos Life developer dashboard asks for at submission, ready to
paste. Requirements (docs, review checklist §07): a square 512 px icon (PNG,
JPEG or WebP — not SVG), 3 to 5 screenshots, a short description of at most
120 characters, and an honest long description.

## Icon

`icon-512.png` — 512 × 512 PNG. Source: `icon.html` (re-render it if the design
changes). Our own mark only: no Lagos Life or Vatar logo (Developer Agreement §11).

## Screenshots (portrait, 750 × 1624)

| File | Shows |
| --- | --- |
| `screenshots/1-lobby.png` | The lobby: Mama Gele, practice, multiplayer, shop |
| `screenshots/2-running.png` | WAKA! — running while she sings, lyrics on screen |
| `screenshots/3-freeze.png` | FREEZE! — she's watching; three CPU players caught |
| `screenshots/4-caught.png` | Getting caught: the stylised elimination (blood can be switched off) |
| `screenshots/5-shop.png` | The cosmetics shop |

All five are real, unedited captures of the game.

## Game name

EMILGO Games · Red Light, Green Light

## Short description (118 characters — limit 120)

Red Light, Green Light on a Lagos street. Waka when Mama Gele sings, freeze when she turns. Play solo or with friends.

## Long description

Mama Gele is singing on a closed-off Lagos street. While she sings, run. The
moment she turns round, freeze — anyone still moving is out. Cross the finish
line before the clock runs out.

It's hard on purpose. Mama can stop singing after two words or deep into the
second verse, and sometimes she stops singing and doesn't turn at all. The
music never warns you: watch her, not the beat. Pick her song — a music-box
lullaby, the old Korean playground words on a new tune, or a Pidgin call and
response with talking drum.

• Practice against 11 CPU players (always labelled CPU) — no internet needed
• Friendly online rounds with up to 12 real people: quick match, or a private room with a six-letter code
• Lagos Life matches for 2–4 players, with optional stakes in Lagos Life game money. Stakes are confirmed on Lagos Life's own sheet; the winner takes the pot less the house's 5%; a draw gives every stake back. Game money only — never real money, never cashed out
• Fair on slow connections: the game measures each player's lag and gives that time back, so a weak network doesn't get you caught
• Chat and emotes between rounds, with a filter that hides insults and phone numbers, links and account details; tap any message to mute, block or report
• A cosmetics shop: outfits, a fila cap, an emote pack and a gold chat name. Nothing in the shop helps you win
• Leaderboard of best scores
• Light: under 200 KB, no other downloads, made for phones on mobile data

Eliminations show stylised blood; switch it to dust in Settings.

## Category

Action (or Party, if offered).

## Products — create these in the dashboard

Ids and prices must match `src/shop/catalog.ts` exactly. All are **one-off**
products (bought once per player). Prices are whole naira within ₦100–₦50,000;
6 of the 20 allowed.

| Product id | Name | Price | Description |
| --- | --- | --- | --- |
| `outfit_gold` | Gold Owambe outfit | ₦500 | Shine like the celebrant. Everyone on the street sees it. |
| `outfit_ankara` | Ankara Orange outfit | ₦500 | Bright orange top, deep blue trousers. Loud and proud. |
| `outfit_midnight` | Midnight outfit | ₦500 | All black with a purple shine. |
| `cap_fila` | Fila cap | ₦300 | The classic folded cap. Matches whatever you're wearing. |
| `emotes_owambe` | Owambe emote pack | ₦300 | Three dance emotes: Zanku, Shaku Shaku and Odogwu. |
| `badge_gold` | Gold chat name | ₦200 | Your name in gold with a ★ in every online chat. |

If you change a price in the dashboard, change `price` in `src/shop/catalog.ts`
to match before the next deploy — the shop shows that number, and an honest
price is a review requirement (checklist §06).
