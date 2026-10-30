// The network half of ffatest (SPEC-V3 Phase 4): 12 scripted people on the
// real game server. Not bots in the game — test clients, like the load test.
//
//   1. A party of two: the member can't pick the game; the leader queues and
//      brings them. Ten more join Find the Flag's public queue; it fills at
//      12 and starts. The party is one squad, everyone else on their own.
//   2. Every phone keeps a copy of the match (Match.mirror) from the start,
//      the events and the snapshots. They search the stash spots, walking
//      the walk grid; whoever finds the flag holds it 10 s and wins.
//   3. One phone drops and comes back mid-match: it rebuilds its copy from
//      the server's log and agrees with the others.
//   4. At the end the server pays XP (guests: shown, not kept), the winner most.
//   5. A mode a guest's rank hasn't opened is refused, in the queue and as a private room.
//   6. Vehicles (Phase 5): the phone nearest a car walks to its driver's door,
//      gets in and drives off; every phone's copy agrees it is driving, and
//      where the car is (protocol 13's car snapshots).

import WebSocket from "ws";

import { NET } from "../../src/config";
import { BUILTIN_MANIFEST } from "../../src/content/modes";
import { Match, settingsOf } from "../../src/game/core/match";
import type { Reach } from "../../src/game/core/reach";
import type { FlagsModule } from "../../src/game/modules/flags";
import { doorPoint } from "../../src/game/modules/drive";
import type { ItemsModule } from "../../src/game/modules/items";
import type { VehiclesModule } from "../../src/game/modules/vehicles";
import { CAR_STRIDE, decodeEvent, MATCH_PHASES, MSNAP_STRIDE, type MatchSnap, type MatchSync, type WireEvent } from "../../src/net/matchWire";
import type { ServerMsg, StartInfo } from "../../src/net/protocol";
import { worldFor } from "../src/ffa";

type Check = (ok: boolean, label: string) => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A distance field to a target over the walk grid (8 neighbours, no corner cutting): steer downhill. */
export function field(reach: Reach, tx: number, tz: number): Int32Array {
  const n = reach.n;
  const d = new Int32Array(n * n).fill(-1);
  const start = reach.cell(tx, tz);
  if (start < 0) return d;
  const q = new Int32Array(n * n);
  let head = 0;
  let tail = 0;
  d[start] = 0;
  q[tail++] = start;
  while (head < tail) {
    const c = q[head++];
    const cx = c % n;
    const cz = (c / n) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const k = z * n + x;
      if (d[k] >= 0 || !reach.ok[k]) continue;
      if (dx && dz && (!reach.ok[cz * n + x] || !reach.ok[z * n + cx])) continue;
      d[k] = d[c] + 1;
      q[tail++] = k;
    }
  }
  return d;
}

export class Phone {
  ws!: WebSocket;
  seat = "";
  token = "";
  start: StartInfo | null = null;
  match: Match | null = null;
  errors: string[] = [];
  gains: number[] = [];
  party: { code: string; members: number; lead: string } | null = null;
  ended = false;
  won: string | null = null;
  /** The newest radio hint: the flag is somewhere in this circle. */
  hint: { x: number; z: number; r: number } | null = null;
  bytes = 0;
  playMs = 0;
  snaps = 0;
  private waiters: { test: (m: ServerMsg) => boolean; done: (m: ServerMsg) => void }[] = [];
  private input = { x: 0, z: 0, b: 0, i: 0, a: 0 };

  constructor(readonly name: string, private readonly url: string) {}

  open(resume?: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.on("message", (raw) => this.receive(String(raw)));
    this.ws.on("open", () => this.send({ t: "hello", v: NET.protocol, name: this.name, ...(resume ? { resume } : {}) }));
    return this.wait((m) => m.t === "welcome", 5000).then(() => {});
  }

  send(o: object): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  close(): void {
    this.ws.close();
  }

  wait(test: (m: ServerMsg) => boolean, ms: number): Promise<ServerMsg> {
    return new Promise((resolve, reject) => {
      const w = { test, done: resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`${this.name}: timed out`));
        }
      }, ms);
    });
  }

  private receive(raw: string): void {
    const m = JSON.parse(raw) as ServerMsg;
    // Downstream during play only (the countdown and the results aren't the steady cost).
    if (this.match && !this.ended && this.match.phase === "play") this.bytes += raw.length;
    switch (m.t) {
      case "welcome":
        this.seat = m.id;
        this.token = m.token;
        break;
      case "seat":
        this.seat = m.id;
        break;
      case "err":
        this.errors.push(m.code);
        break;
      case "party":
        this.party = "off" in m ? null : { code: m.code, members: m.members.length, lead: m.lead };
        break;
      case "start":
        if (m.start.ffa) this.begin(m.start, []);
        break;
      case "msync":
        this.rejoin(m.sync);
        break;
      case "mev":
        this.events(m.e);
        break;
      case "msnap":
        this.snap(m);
        break;
      case "rank":
        if (typeof m.gain === "number") this.gains.push(m.gain);
        break;
    }
    for (const w of [...this.waiters]) if (w.test(m)) {
      this.waiters.splice(this.waiters.indexOf(w), 1);
      w.done(m);
    }
  }

  private begin(start: StartInfo, log: WireEvent[]): void {
    const f = start.ffa!;
    const def = BUILTIN_MANIFEST.modes.find((d) => d.id === f.mode)!;
    this.start = start;
    this.ended = false;
    this.match = new Match({
      seed: start.seed,
      world: worldFor(f.map),
      settings: settingsOf(def, f.rk === 1),
      contestants: start.roster.map((r, i) => ({ id: r.id, name: r.name, bot: false, squad: f.sq[i] })),
      countdown: f.cd,
      mirror: true,
    });
    this.events(log);
  }

  private rejoin(sync: MatchSync): void {
    this.begin({ seed: sync.seed, s: sync.s, roster: sync.roster, init: [], ffa: sync.ffa }, sync.log);
    this.snap(sync.snap);
  }

  private events(list: WireEvent[]): void {
    const m = this.match;
    if (!m) return;
    for (const w of list) {
      const e = decodeEvent(w, (i) => m.contestants[i]?.id ?? null);
      if (!e) continue;
      m.applyRemote(e);
      if (e.type === "won") this.won = e.id;
      if (e.type === "hint") this.hint = { x: e.x, z: e.z, r: e.r };
      if (e.type === "ended") this.ended = true;
    }
    m.drain();
  }

  private snap(s: MatchSnap): void {
    const m = this.match;
    if (!m) return;
    this.snaps++;
    m.phase = MATCH_PHASES[s.ph] ?? m.phase;
    m.elapsed = s.el / 1000;
    if (m.phase === "play") this.playMs = s.el;
    for (const c of m.contestants) {
      if (s.st[c.index] !== "a") continue;
      const k = c.index * MSNAP_STRIDE;
      c.x = s.p[k] / 100;
      c.z = s.p[k + 1] / 100;
      c.heading = s.p[k + 2] / 100;
      const hy = s.p[k + 3] / 100;
      c.h = m.world.space.floorAt(c.x, c.z, hy + 0.05).h;
      c.y = Math.max(0, hy - c.h);
    }
    const v = m.module<VehiclesModule>("vehicles");
    if (v && s.v) {
      for (const car of v.cars) {
        const k = car.index * CAR_STRIDE;
        if (!car || k + CAR_STRIDE > s.v.length) continue;
        car.x = s.v[k] / 100;
        car.z = s.v[k + 1] / 100;
        car.heading = s.v[k + 2] / 100;
        car.speed = s.v[k + 3] / 100;
        car.fuel = s.v[k + 4] / 10;
      }
    }
  }

  me() {
    return this.match?.get(this.seat) ?? null;
  }

  /** Where it was 3 s ago, and a sideways step while it's stuck on a corner. */
  private was = { x: 0, z: 0, t: 0 };
  private nudge = { x: 0, z: 0, until: 0 };

  /** Walk towards a target down its distance field (the stick, in world space). */
  steer(d: Int32Array): void {
    const c = this.me();
    const m = this.match;
    if (!c || !m) return;
    const now = Date.now();
    if (now < this.nudge.until) return this.stick(this.nudge.x, this.nudge.z, true);
    if (now - this.was.t > 3000) {
      if (this.was.t && Math.hypot(c.x - this.was.x, c.z - this.was.z) < 0.5) {
        const a = Math.random() * Math.PI * 2;
        this.nudge = { x: Math.cos(a), z: Math.sin(a), until: now + 700 };
      }
      this.was = { x: c.x, z: c.z, t: now };
    }
    const reach = m.reach;
    const here = reach.cell(c.x, c.z);
    let best = -1;
    let bestD = here >= 0 && d[here] >= 0 ? d[here] : 1e9;
    const n = reach.n;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const k = reach.cell(c.x + dx, c.z + dz);
      if (k >= 0 && d[k] >= 0 && d[k] < bestD) {
        bestD = d[k];
        best = k;
      }
    }
    void n;
    if (best < 0) return this.stick(0, 0);
    const [x, z] = reach.centre(best);
    const l = Math.hypot(x - c.x, z - c.z) || 1;
    this.stick((x - c.x) / l, (z - c.z) / l, true);
  }

  stick(x: number, z: number, run = false): void {
    this.input.x = Math.round(x * 100);
    this.input.z = Math.round(z * 100);
    this.input.b = run ? 1 : 0;
  }

  tap(): void {
    this.input.i = (this.input.i + 1) & 255;
  }

  /** A swing: 1 fist, 2 slap, 3 push. */
  swing(kind: 1 | 2 | 3): void {
    this.input.a = ((((this.input.a >> 2) + 1) & 63) << 2) | kind;
  }

  sendInput(): void {
    this.send({ t: "in", ...this.input });
  }
}

export async function online(url: string, check: Check): Promise<number> {
  console.log("\nFree For All over the network:");
  let failures = 0;
  const ok: Check = (v, label) => {
    check(v, label);
    if (!v) failures++;
  };
  const phones = Array.from({ length: 12 }, (_, i) => new Phone(`Tester ${i + 1}`, url));
  try {
    await Promise.all(phones.map((p) => p.open()));
    const [lead, mate] = phones;
    // The party.
    lead.send({ t: "party", op: "make" });
    await lead.wait((m) => m.t === "party", 3000);
    mate.send({ t: "party", op: "join", code: lead.party!.code });
    await mate.wait((m) => m.t === "party" && !("off" in m) && m.members.length === 2, 3000);
    ok(lead.party?.members === 2 && mate.party?.lead === lead.seat, "a party of two: made, joined by its code");
    mate.send({ t: "fq", m: "find-the-flag" });
    await mate.wait((m) => m.t === "err", 3000);
    ok(mate.errors.includes("lead"), "the member can't pick the game for the party");
    // A guest's rank (Rookie) hasn't opened Scarcity.
    const g = phones[11];
    g.send({ t: "fq", m: "scarcity" });
    await g.wait((m) => m.t === "err", 3000);
    g.send({ t: "create", size: 12, m: "scarcity" });
    await g.wait((m) => m.t === "err" && g.errors.length >= 2, 3000);
    ok(g.errors.slice(-2).every((e) => e === "locked"), "a mode the rank hasn't opened: refused in the queue and as a private room");
    g.send({ t: "fq", m: "dead-streets" });
    await g.wait((m) => m.t === "err" && g.errors.length >= 3, 3000);
    ok(g.errors[2] === "mode_off", "a mode this build can't play yet (Dead Streets): refused");
    g.send({ t: "fq", m: "find-the-flag", r: true });
    await g.wait((m) => m.t === "err" && g.errors.length >= 4, 3000);
    ok(g.errors[3] === "locked", "Ranked before Pro I: refused");
    // The queue fills.
    lead.send({ t: "fq", m: "find-the-flag" });
    await sleep(300);
    for (const p of phones.slice(2)) p.send({ t: "fq", m: "find-the-flag" });
    await Promise.all(phones.map((p) => p.wait((m) => m.t === "start", 15000)));
    const start = lead.start!;
    const sq = start.ffa!.sq;
    const idx = (p: Phone) => start.roster.findIndex((r) => r.id === p.seat);
    ok(start.roster.length === 12 && start.ffa!.mode === "find-the-flag", "twelve in the queue: the match starts at once");
    ok(sq[idx(lead)] === sq[idx(mate)] && new Set(sq).size === 11, "the party is one squad; everyone else is on their own");

    // Play: search the stash spots (each phone the ones nearest it), walking the walk grid.
    const flags = () => lead.match!.module<FlagsModule>("flags")!;
    const stashes = flags().stashes;
    const reach = lead.match!.reach;
    const fields = stashes.map((s) => field(reach, s.x, s.z));
    const todo = new Map<Phone, number[]>(phones.map((p) => [p, []]));
    for (const s of stashes) {
      let best = phones[0];
      let bestCost = Infinity;
      for (const p of phones) {
        const c = p.me()!;
        const list = todo.get(p)!;
        const last = list.length ? stashes[list[list.length - 1]] : c;
        const cost = Math.hypot(last.x - s.x, last.z - s.z) + list.length * 25;
        if (cost < bestCost) {
          bestCost = cost;
          best = p;
        }
      }
      todo.get(best)!.push(s.index);
    }
    let dropped = false;
    let rejoined = false;
    let agree = false;
    const late = phones[10];
    // The driver: whoever (not the phone that drops, not the party) starts nearest a car's driver door.
    const cars = () => lead.match!.module<VehiclesModule>("vehicles")!.cars;
    let driver: Phone | null = null;
    let door: [number, number] = [0, 0];
    let bestDoor = Infinity;
    for (const p of phones.slice(2, 10)) {
      const c = p.me()!;
      for (const car of cars()) {
        const d = doorPoint(car, 0);
        const dist = Math.hypot(d[0] - c.x, d[1] - c.z);
        if (dist < bestDoor) {
          bestDoor = dist;
          driver = p;
          door = d;
        }
      }
    }
    const doorField = field(reach, door[0], door[1]);
    const parked = cars().map((c) => [c.x, c.z]);
    let droveAt = -1;
    let carSeen = false;
    const t0 = Date.now();
    let told = 0;
    while (!phones.every((p) => p.ended) && Date.now() - t0 < 300_000) {
      await sleep(50);
      const m = lead.match!;
      if (m.phase !== "play") continue;
      if (process.env.DEBUG && m.elapsed > told + 30) {
        told = m.elapsed;
        const seen = new Set<number>();
        for (const s of (m.module<FlagsModule>("flags")! as unknown as { searched: Set<number>[] }).searched) for (const k of s) seen.add(k);
        console.log(`    ${m.elapsed.toFixed(0)} s: ${seen.size}/${stashes.length} searched; ` + phones.map((p) => {
          const c = p.me()!;
          const l = todo.get(p)!;
          const s = l.length ? stashes[l[0]] : null;
          return `${l.length}${s ? `@${Math.hypot(s.x - c.x, s.z - c.z).toFixed(0)}m${fields[l[0]][reach.cell(c.x, c.z)] < 0 ? "!" : ""}` : ""}${c.status === "alive" ? "" : "x"}`;
        }).join(" "));
      }
      const f = flags().flags[0];
      for (const p of phones) {
        if (p === late && dropped && !rejoined) continue;
        const c = p.me();
        if (!c || !p.match) continue;
        // The driver: to the door, in, and away down the road for a few seconds.
        if (p === driver && droveAt < 0) {
          const seated = p.match.seatOf(c) >= 0;
          if (seated) {
            const car = cars()[p.match.seatOf(c)];
            p.stick(Math.sin(car.heading), Math.cos(car.heading));
            if (car.speed > 4 && droveAt < 0) droveAt = m.elapsed;
          } else if (Math.hypot(door[0] - c.x, door[1] - c.z) < 1.2) {
            p.stick(0, 0);
            p.tap();
          } else p.steer(doorField);
          p.sendInput();
          continue;
        }
        if (p === driver && m.elapsed - droveAt > 3 && !carSeen) {
          // Stopped: does every phone see the same?
          await sleep(300);
          const seat = p.match.seatOf(c);
          const where = phones.filter((q) => q.match && !(q === late && dropped && !rejoined)).map((q) => q.match!.module<VehiclesModule>("vehicles")!.cars[Math.max(0, seat)]);
          const moved = seat >= 0 && Math.hypot(where[0].x - parked[seat][0], where[0].z - parked[seat][1]) > 3;
          const same = where.every((w) => Math.hypot(w.x - where[0].x, w.z - where[0].z) < 1.5);
          const seen = phones.every((q) => !q.match || (q === late && dropped && !rejoined) || q.match.seatOf(q.match.get(p.seat)!) === seat);
          const spread = Math.max(...where.map((w) => Math.hypot(w.x - where[0].x, w.z - where[0].z)));
          ok(moved && same && seen, `a phone walked to a car (${bestDoor.toFixed(0)} m), got in and drove off: every copy agrees it's driving, and where` + (moved && same && seen ? "" : ` (seat ${seat}, moved ${seat >= 0 ? Math.hypot(where[0].x - parked[seat][0], where[0].z - parked[seat][1]).toFixed(1) : "-"} m, copies ${spread.toFixed(2)} m apart, all see it seated: ${seen})`));
          carSeen = true;
        }
        if (p === driver && p.match.seatOf(c) >= 0) {
          p.stick(0, 0);
          p.sendInput();
          continue;
        }
        if (f.holder === c.index) p.stick(0, 0);
        else if (f.holder >= 0) p.stick(0, 0);
        else {
          const list = todo.get(p)!;
          while (list.length && spotDone(p, list[0])) list.shift();
          // Done with its own: help with the nearest spot nobody has searched (a phone stuck on a corner can't hold one up).
          if (!list.length) {
            let best = -1;
            let bestD = Infinity;
            for (const s of stashes) {
              const d = Math.hypot(s.x - c.x, s.z - c.z);
              if (d < bestD && !spotDone(p, s.index)) {
                bestD = d;
                best = s.index;
              }
            }
            if (best >= 0) list.push(best);
          }
          if (list.length) {
            const s = stashes[list[0]];
            if (Math.hypot(s.x - c.x, s.z - c.z) < 1.4) {
              p.stick(0, 0);
              p.tap();
            } else p.steer(fields[list[0]]);
          } else p.stick(0, 0);
        }
        p.sendInput();
      }
      // One phone drops for a few seconds, 4 s in (the flag can turn up in 15), and comes back on its token.
      if (!dropped && m.elapsed > 4) {
        dropped = true;
        late.close();
        setTimeout(() => {
          void late.open(late.token).then(() => {
            rejoined = true;
          });
        }, 1500);
      }
      if (rejoined && !agree && late.match && late.match.elapsed > 0) {
        await sleep(400);
        const a = lead.match!.module<ItemsModule>("items")!;
        const b = late.match!.module<ItemsModule>("items")!;
        agree = a.items.length === b.items.length && a.items.every((it, k) => it.taken === b.items[k].taken) && JSON.stringify(a.packs) === JSON.stringify(b.packs);
      }
    }
    ok(rejoined && agree, "a phone that dropped and came back rebuilt its copy from the server's log: it agrees with the others");
    if (!carSeen) ok(false, `a phone walked to a car and drove off (the match ended first: ${droveAt >= 0 ? "it drove" : "it never got in"})`);
    const winner = lead.won;
    const holder = winner ? phones.find((p) => p.seat === winner) : null;
    ok(phones.every((p) => p.ended) && !!holder, `the flag found and held 10 s: ${holder?.name ?? "nobody"} won (${(lead.playMs / 1000).toFixed(0)} s of play)`);
    ok(phones.every((p) => p.won === winner), "every phone agrees who won");
    await Promise.all(phones.map((p) => p.wait((m) => m.t === "rank", 3000).catch(() => null)));
    const gains = phones.map((p) => p.gains[p.gains.length - 1] ?? 0);
    const wg = holder ? gains[phones.indexOf(holder)] : 0;
    ok(gains.every((x) => x > 0) && gains.every((x, i) => phones[i] === holder || x < wg), `XP from the server for everyone, the winner most (${wg} vs ${Math.max(...gains.filter((_, i) => phones[i] !== holder))} at best)`);
    const secs = Math.max(1, lead.playMs / 1000);
    const kbs = lead.bytes / 1024 / secs;
    ok(kbs < 8, `downstream per phone: ${kbs.toFixed(1)} KB/s (12 people, events and snapshots)`);
  } catch (e) {
    ok(false, `the network run: ${(e as Error).message}`);
  } finally {
    for (const p of phones) p.close();
  }
  return failures;
}

/** Has this phone seen the server's answer to a search of stash k (by anyone: an empty spot stays empty)? */
export function spotDone(p: Phone, k: number): boolean {
  const f = p.match!.module<FlagsModule>("flags")! as unknown as { searched: Set<number>[] };
  for (const s of f.searched) if (s.has(k)) return true;
  return false;
}
