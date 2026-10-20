# EMILGO Games: session handoff

> Updated 20 Oct 2026. Branch `sdk-54-temp`. Red Light, Green Light v2 is being
> built to the owner's spec, [SPEC-V2.md](SPEC-V2.md), in **8 phases**.
> **Phases 1–7 are done and committed. Phase 8 is under way (the owner said,
> 20 Oct 2026: do 7, then 8, without waiting in between).**

## Start here (new session)

Read these in order:
1. This file.
2. [SPEC-V2.md](SPEC-V2.md):
   - the owner's answers, the Decisions table and the 8 phases;
   - the **Status** section for what each finished phase built.
3. [SPEC-ORIGINAL.md](SPEC-ORIGINAL.md): the owner's own full spec (§1–§11), word for word. Every `§` in this file and in SPEC-V2 points into it. Where it disagrees with SPEC-V2's Answers and Decisions, SPEC-V2 wins.
4. [README.md](README.md):
   - §1, the Lagos Life rules the game must keep;
   - §4, the architecture;
   - §5, how to run it and test it.
5. [UPGRADE.md](UPGRADE.md) only for history. Where it disagrees with SPEC-V2, SPEC-V2 wins.

## How the owner works (follow these)

- **One phase at a time.** Finish it, test it, report it, then **stop and wait for the go-ahead**. Never start the next phase on your own.
- **Short, plain replies.** No repetition.
- **Build only what SPEC-V2 says.** Nothing extra. If the spec is unclear, add a row to its Decisions table and say so in the report.
- **Commit after every finished update, without asking** (the owner, 18 Oct 2026: "always commit every new update"). Stage only that change's files. End commit messages with the `Co-Authored-By` line. Don't push.
- **Deploys are paused.** Don't host or upload anything.
- **After any change under `src/`**, run `npm run game:embed` from the repo root. It writes the app's copy, `src/games/emilgo-games/redlightHtml.generated.ts`, which is committed.
- **Never use Squid Game's music, doll voice, score, doll design or colours.** They are Netflix IP and Vatar Agreement §3.3 / §4(i) forbids them.
  - The song is the traditional, public-domain playground chant "Mugunghwa kkochi pieotseumnida", synthesised.
  - The doll is our own giant schoolgirl in a green pinafore.
  - No words, lyrics or song title on screen.
- **Real test keys live only in `server/.env`**, which is git-ignored. Never print them or put them in the game.
- **Lagos Life rules that are easy to break:**
  - no microphone in the frame, so no voice chat;
  - staked matches have 2–4 seats only;
  - results come only from our server, signed;
  - never link players across services;
  - never claim to be a "partner".

## Standing answers from the owner (17 Oct 2026)

| Topic | Answer |
| --- | --- |
| Players per match | 20-player matches are free, on our server. Staked Lagos Life matches stay at 2–4 seats. No bots online. |
| Staked mode | Every staked match is Ball Haunting, 200 m, 80 s, with one ball fewer than the players (`STAKED` in `src/config.ts`). |
| CP | Earned only by playing. Boosts are off in staked matches. |
| Warning hum | A 3 s hum before every turn, plus fake hums (about 38%; never two in a row, never before the first turn). |
| Fighting | Never automatic. Players fight only when they tap fist, slap or push. A bump just stops you. CPUs only swing at whoever holds the ball they want. |
| Hits during red light | Only the attacker is shot. |
| Song | The traditional Mugunghwa chant, and (18 Oct 2026) our own lullaby: she takes turns with the two. No other songs, no picker. |
| Doll | The giant schoolgirl doll: pigtails, green pinafore, about 12 m tall. |

## Phase status

| # | Phase | State |
| --- | --- | --- |
| 1 | Clean slate and characters | Done, committed `51357ad` |
| 2 | Referee v4 and server | Done, committed `36dc89e` |
| — | The hum, no automatic fights | Done, committed `5906bd9` |
| 3 | Desert Field, sky, light and dark | Done, committed `5906bd9` |
| 4 | HUD, controls, camera (+ the new song and doll) | Done, committed `d8dfc01` |
| 5 | Match flow | Done, committed `05910de` |
| 6 | Elimination and highlights (+ the lullaby, the pens, the wider desert) | Done, committed `9a41722`, `2a27245`, `e71f778`, `f212177` |
| 7 | Menus, settings, social, store | Done (20 Oct 2026) |
| 8 | **Performance and regression** | **Under way** |

The full scope of each phase is in SPEC-V2.md under "Build phases". What 1–4 built is in its "Status" section.

## Phase 6: Elimination and highlights (done)

What it built, the checks and the numbers: SPEC-V2.md, Status, "Phase 6".
The new decisions (the 10 steps, the kill cam, the final two, the play of
the game, spectating, the second song, the pens and the wider desert) are
rows in its Decisions table. **Tell the owner the pens are our reading of
"places to go in and find them"**: the layout is easy to change.

Where things are, for Phase 7 and 8:
- Elimination: `session.ts` `onCaught` (per body) and `afterCatches` (per
  batch: crack, drum, zoom). Blood: `world/blood.ts`. Falls:
  `world/human/ragdoll.ts`.
- Replays: `game/replay.ts` (recorder), `rlgl/replayView.ts` (player),
  `ui/replay.ts` (overlay), lenses in `rlgl/shots.ts`. The sequence after
  you're out or across: `session.ts` `sequence()`.
- The final two: `FINAL` in `config.ts`; the referee's `timeScale`.
- Play of the game: `game/highlights.ts` (the server runs it in `room.ts`).
- Pens: `game/pens.ts` (shared), `world/pens.ts` (drawn),
  `maps/registry.ts` `fieldHalfWidth`.
- Protocol 9 (8: `fn2` and `hl` events; 9: the pens' walls).
- Test servers: rebuild with `npm run server:build` after any change to
  `src/game` or `server/src` (the servers run the built copy).

## Phase 7: Menus, settings, social, store (done)

What it built, the checks and the numbers: SPEC-V2.md, Status, "Phase 7".
The new decisions (pause menu, audio, the 20 settings, language, data saver,
reset, rotate, moderation in the roster, friends, CP and boosts) are rows in
its Decisions table. Protocol 10.

Where things are: pause and settings `ui/screens.ts` (actions in
`game/session.ts`); language `ui/i18n.ts`; rotation `ui/rotate.ts`; volumes
`audio/sound.ts` `setLevels`; friends `social/friends.ts` and
`server/src/presence.ts`; boosts `shop/boosts.ts` (applied by
`game/rules.ts` `setBoosts`, left out of staked matches in `room.ts`).

## Phase 8: Performance and regression

### What the spec asks for (§8, §9)

- **Frame rate:** 30 fps or better on low-end phones (Tecno, Infinix); 60 fps on mid-range.
- **Budgets, with 20 players:** under 100 draw calls and under 100K triangles.
- **Size and speed:** under 5 s to the lobby; under 50 MB.
- **Network:** offline and poor-connection play.
- **Vatar SDK:** the §9 list. All of it is already wired, in `platform/lagoslife.ts` and the server's `vatar.ts`.
- **Wrap-up:**
  - every test passes;
  - the three builds succeed: Lagos Life `dist/`, the EMILGO embed, and the server;
  - the docs are updated;
  - this handoff is updated.

### Tools that already exist

- `core/quality.ts`: an automatic quality governor.
- `graphics/tiers.ts`: the Low, Medium and High tiers.
- `dev/cdp.mjs`, run with `CPU_RATE=4` and `NET_KBPS` / `NET_RTT` to throttle CPU and network.
- `npm run game:sim`.
- The load test.
- README §7 has the earlier measurements.

### Not possible here

A real phone. Only headless Chrome has run it so far. The owner needs to test on a Tecno or Infinix and an iPhone.

## Running and testing

From the repo root:

```bash
npm run game:dev       # Vite dev server on :5173 (?mockvatar = fake Lagos Life player)
npm run game:embed     # typecheck + single-file build → the app's copy (run after every src change)
npm run game:build     # typecheck + dist/ (Lagos Life site)
npm --prefix games/emilgo-games run typecheck   # client + server
```

### The test suite

Run it from `games/emilgo-games/`. It uses ports **:8797** (game server) and **:8790** (fake platform), so the Docker server on :8787 is left alone.

```bash
node server/build-tools.mjs && npm run server:build
PORT=8790 WEBHOOK_URL=http://localhost:8797/vatar-webhook node server/dist/mockvatar.mjs &
PORT=8797 DATA_DIR=<scratch>/data TICKET_SECRET=test-ticket-secret-0123456789abcdef ADMIN_TOKEN=test-admin \
  MAX_PER_IP=100000 VATAR_SECRET=vtr_test_mock VATAR_RESULTS_SECRET=vtr_results_mock \
  VATAR_WEBHOOK_SECRET=vtr_whsec_test_mock VATAR_API=http://localhost:8790/api/games/v1 \
  node server/dist/index.mjs &
node server/dist/rulestest.mjs                          # 115 checks, no server needed
GAME=ws://localhost:8797 node server/dist/matchtest.mjs
GAME=ws://localhost:8797 node server/dist/ballstest.mjs
GAME=ws://localhost:8797 node server/dist/shoptest.mjs
GAME=ws://localhost:8797 node server/dist/socialtest.mjs
node server/dist/fairness.mjs ws://localhost:8797       # 7/7
node server/dist/loadtest.mjs --clients 600 --seconds 60 --url ws://localhost:8797
```

- macOS has no `timeout` command. Use the load test's own `--seconds` instead.
- Kill both background servers when you're done.

### Screenshots and UI checks

`dev/cdp.mjs` drives headless Chrome. The steps it understands are listed at the top of the file.

```bash
VIEW=844x390 node dev/cdp.mjs "http://localhost:5173/" <outdir> <steps.json>   # GPU=1 for the real GPU
```

- The page exposes `window.__game` for tests: `g.action("…")`, `g.round`.
- Check every UI change in two layouts:
  - landscape 844×390 and portrait 390×844;
  - right-handed and left-handed ("Swap sticks").
- `dev/humans.html?set=doll&tier=2&cam=face` shows the character and doll line-ups.

## Open items (not code; the owner's)

- **Docker server on :8787 is still on protocol 5.** New builds (protocol 10) can't join it; the Play menu says "Update the game to play online." Rebuild it with:
  ```bash
  cd games/emilgo-games && docker compose up -d --build
  ```
- **Never tested on a real phone.** Only headless Chrome has run it, with both the software and the real GPU.
- **Never run against real Lagos Life.** Only against the fake platform, `server/scripts/mockvatar.ts`.
- **Hosting, domain (emilgo.app), Vatar keys, dashboard products, sandbox checklist, submission:** see README §6. All of it is paused by the owner.

## Key numbers (Phase 6)

- rules 103 · balls (10 runs in a row), match, shop all passed · fairness 7/7 · ground 1,638 / 0 failed.
- Load test, 600 clients: 0 failures · tick p99 8.7 ms · 6.8 KB/s.
- Lagos Life `dist/`: 287 KB JS gzipped. EMILGO embed: 1,236 KB.
- Desert Field 300 m Ball Haunting, 14 bodies near you: High 68 draw calls / 92K triangles; Low 55 / 61K.
