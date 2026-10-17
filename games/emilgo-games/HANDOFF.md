# EMILGO Games: session handoff

> Updated 17 Oct 2026. Branch `sdk-54-temp`. Red Light, Green Light v2 is being
> built to the owner's spec, [SPEC-V2.md](SPEC-V2.md), in **8 phases**.
> **Phases 1–4 are done and committed. 4 phases are left (5, 6, 7, 8). Next:
> Phase 5, Match flow.** The owner said go ahead with Phase 5 (17 Oct 2026).

## Start here (new session)

Read these in order:
1. This file.
2. [SPEC-V2.md](SPEC-V2.md):
   - the owner's answers, the Decisions table and the 8 phases;
   - the **Status** section for what each finished phase built.
3. [README.md](README.md):
   - §1, the Lagos Life rules the game must keep;
   - §4, the architecture;
   - §5, how to run it and test it.
4. [UPGRADE.md](UPGRADE.md) only for history. Where it disagrees with SPEC-V2, SPEC-V2 wins.

## How the owner works (follow these)

- **One phase at a time.** Finish it, test it, report it, then **stop and wait for the go-ahead**. Never start the next phase on your own.
- **Short, plain replies.** No repetition.
- **Build only what SPEC-V2 says.** Nothing extra. If the spec is unclear, add a row to its Decisions table and say so in the report.
- **Commit only when asked.** End commit messages with the `Co-Authored-By` line.
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
| Song | The traditional Mugunghwa chant only. The song picker and the other songs are gone. |
| Doll | The giant schoolgirl doll: pigtails, green pinafore, about 12 m tall. |

## Phase status

| # | Phase | State |
| --- | --- | --- |
| 1 | Clean slate and characters | Done, committed `51357ad` |
| 2 | Referee v4 and server | Done, committed `36dc89e` |
| — | The hum, no automatic fights | Done, committed `5906bd9` |
| 3 | Desert Field, sky, light and dark | Done, committed `5906bd9` |
| 4 | HUD, controls, camera (+ the new song and doll) | Done, committed (the commit after `5906bd9`) |
| 5 | **Match flow** | **Next.** Not started |
| 6 | Elimination and highlights | Not started |
| 7 | Menus, settings, social, store | Not started |
| 8 | Performance and regression | Not started |

The full scope of each phase is in SPEC-V2.md under "Build phases". What 1–4 built is in its "Status" section.

## Phase 5: Match flow (next)

### What the spec asks for (SPEC-V2 §1)

- **Play menu:** Invite Friends, Play with New People, Play Solo vs AI. Mode and distance are picked here.
- **Waiting room:**
  - everyone's model standing in a circle;
  - ready marks;
  - text chat;
  - 2 s loading.
- **Walkout:**
  - players walk out in the black suits, filmed from the front, the side, behind and overhead;
  - field preview: 4 sweeps, a close-up of the doll, the balls and baskets, the lasers, then back behind the players;
  - a skip button once you're in the arena;
  - a countdown from 5 to 1 with a bass drop.
- **Tutorial:** a tutorial button on first entry, and the tutorial played live in the 3D engine.

### What exists today to build on

| Piece | Today | Where |
| --- | --- | --- |
| Play menu | Practice, Quick match, Private room, Join by code, Lagos Life match. Mode and Distance pickers are already there. | `screens.play()`, `PlayMode` and `MODE_INFO` in `src/ui/screens.ts` |
| Waiting room | A "squad room": the players stand around you on the street, with name tags and chat. | `stage.setMode("squad")` in `src/world/lobbyStage.ts`; `screens.room()`; `session.ts` near "The squad room" |
| Countdown | 3 s (`countdown: 3`), shown big in the centre. The spec wants 5 → 1. | `src/config.ts` RULES, `src/game/rules.ts` phase `countdown`, `hud.setCountdown` |
| Tutorial | A text "How to play" sheet, shown once (`settings.tutorialSeen`). The in-engine tutorial isn't built. | `screens.howto()`, `session.ts` |
| Walkout, field preview, skip | Not built. | — |
| Friends and invites | A friends list kept on the phone, plus room codes. Notifications are Phase 7. | `screens.friends()` |

### Decisions already taken that affect Phase 5 (from the Decisions table)

- **Skip online:** your skip jumps to "behind the players" and waits there. The countdown starts when everyone has skipped or the walkout ends.
- **Tutorial:** played live in the engine. A model plays the game with each step highlighted, narrated by the phone's own text-to-speech, with captions. No video file.
- **Black suit:** worn for the whole match, including the walkout. Your own outfit shows in the lobby, the waiting room and after the match.
- **No CPUs online.** "Fill with CPU" is removed; CPUs appear only in Solo.
- **Walkout:** no name tags, no flags, no crowd sounds (spec §3.6 / §10, the "Removed" row).

### Watch out for

- A longer countdown, a new phase, or a skip that crosses the wire changes the referee or protocol. If so:
  - bump `NET.protocol` (it is 6 now);
  - add tests to `server/scripts/rulestest.ts`;
  - the Docker server must then be rebuilt.

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
node server/dist/rulestest.mjs                          # 66/66, no server needed
GAME=ws://localhost:8797 node server/dist/matchtest.mjs
GAME=ws://localhost:8797 node server/dist/ballstest.mjs
GAME=ws://localhost:8797 node server/dist/shoptest.mjs
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

- **Docker server on :8787 is still on protocol 5.** Docker Desktop wasn't running, so it couldn't be rebuilt. New builds (protocol 6) can't join it until someone runs this:
  ```bash
  cd games/emilgo-games && docker compose up -d --build
  ```
- **Never tested on a real phone.** Only headless Chrome has run it, with both the software and the real GPU.
- **Never run against real Lagos Life.** Only against the fake platform, `server/scripts/mockvatar.ts`.
- **Hosting, domain (emilgo.app), Vatar keys, dashboard products, sandbox checklist, submission:** see README §6. All of it is paused by the owner.
- **Moved out of Phase 4 into Phase 7:**
  - the pause menu;
  - audio volumes;
  - the rest of the 20 settings.

## Key numbers (Phase 4)

- rules 66/66 · match, balls, shop all passed · fairness 7/7.
- Load test, 600 clients: 0 failures · tick p99 7.7 ms · 6.2 KB/s.
- Lagos Life `dist/`: 270 KB JS gzipped. EMILGO embed: 1,184 KB.
