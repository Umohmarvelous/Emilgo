// Hustle (SPEC-V3 §9 #6; Phase 6): do jobs across the city for Owo (a score
// of our own, never ₦), bank it in an Esusu box before someone knocks it out
// of you. Most Owo banked at the end wins.
//
//   Stations   sell sachet water, wash a car, fix a generator: hold interact
//              there for a few seconds. Deliver a parcel, carry a load: tap
//              to take the job, then reach its drop (a load slows you).
//              A station rests after each job.
//   Sabotage   tap at a station a rival is working: their work is lost and
//              the station is broken for a while.
//   Spill      Dazed, half of what you carry falls (Ranked: more) as a bag
//              anyone can scoop up; a job you were carrying is lost.
//   Esusu      tap at a box to bank everything you carry.
//   The leader shows on everyone's map every `leaderPing` seconds; Daze them
//              for a bounty out of their pocket (§10.10).
//
// Pure: the stations, their drops and the boxes come from the public seed;
// everything that happens arrives on a phone as events.

import { ECONOMY, type JobKind } from "../../config";
import type { Rng } from "../../core/rng";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import { nearOpen } from "./flags";
import type { MeleeModule } from "./melee";

export interface Station {
  readonly index: number;
  readonly kind: JobKind;
  readonly x: number;
  readonly z: number;
  readonly h: number;
  /** A carry-job's drop. */
  readonly to: { x: number; z: number; h: number } | null;
  /** Resting (after a job) or broken (sabotaged) until; who works it now (−1). */
  until: number;
  broken: boolean;
  worker: number;
}

export interface OwoBag {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly h: number;
  owo: number;
  until: number;
  /** Whose it was (body index) and when it fell: they can't scoop it straight back. */
  readonly by: number;
  readonly at: number;
}

/** Your own spilled Owo can't be scooped back for this long. */
const NO_RESCOOP = 3;

const HOLD_JOBS: readonly JobKind[] = ["water", "wash", "fix"];

export class EconomyModule implements RuleModule {
  readonly id = "economy" as const;
  readonly spill: number;
  readonly leaderPing: number;
  readonly stations: Station[] = [];
  readonly banks: { x: number; z: number; h: number }[] = [];
  readonly bags: OwoBag[] = [];
  carried = new Float64Array(0);
  banked = new Float64Array(0);
  /** The carry-job each body holds (station index), or −1. */
  job = new Int32Array(0);
  /** Hold-job progress, seconds. */
  work = new Float64Array(0);
  private nextPing = 0;
  private rng!: Rng;

  constructor(params: Record<string, unknown>) {
    this.spill = typeof params.spill === "number" ? Math.max(0, Math.min(1, params.spill)) : 0.5;
    this.leaderPing = typeof params.leaderPing === "number" ? Math.max(5, params.leaderPing) : 30;
  }

  init(m: Match): void {
    const n = m.contestants.length;
    this.carried = new Float64Array(n);
    this.banked = new Float64Array(n);
    this.job = new Int32Array(n).fill(-1);
    this.work = new Float64Array(n);
    this.nextPing = this.leaderPing;
    this.rng = m.rng("economy");
    // Stations at the named places (round-robin over the kinds); boxes at the landmarks.
    const kinds = Object.keys(ECONOMY.jobs) as JobKind[];
    const places = this.rng.shuffle([...m.world.places]);
    for (let k = 0; k < ECONOMY.stations && places.length; k++) {
      const p = places[k % places.length];
      const spot = this.spot(m, p.x, p.z, p.r * 0.6);
      if (!spot) continue;
      if (this.stations.some((s) => Math.hypot(s.x - spot[0], s.z - spot[1]) < 15)) continue;
      const kind = kinds[this.stations.length % kinds.length];
      let to: Station["to"] = null;
      if (!HOLD_JOBS.includes(kind)) {
        for (let tries = 0; tries < 40 && !to; tries++) {
          const q = places[this.rng.int(0, places.length - 1)];
          const d = Math.hypot(q.x - spot[0], q.z - spot[1]);
          if (d < ECONOMY.dropFrom[0] || d > ECONOMY.dropFrom[1]) continue;
          const t = this.spot(m, q.x, q.z, q.r * 0.5);
          if (t) to = { x: t[0], z: t[1], h: t[2] };
        }
        if (!to) continue;
      }
      this.stations.push({ index: this.stations.length, kind, x: spot[0], z: spot[1], h: spot[2], to, until: 0, broken: false, worker: -1 });
    }
    const marks = this.rng.shuffle([...m.world.places]).slice(0, ECONOMY.banks * 3);
    for (const p of marks) {
      if (this.banks.length >= ECONOMY.banks) break;
      const spot = this.spot(m, p.x, p.z, 4);
      if (!spot || this.banks.some((b) => Math.hypot(b.x - spot[0], b.z - spot[1]) < 60)) continue;
      this.banks.push({ x: spot[0], z: spot[1], h: spot[2] });
    }
  }

  private spot(m: Match, x: number, z: number, r: number): [number, number, number] | null {
    for (let t = 0; t < 12; t++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = Math.sqrt(this.rng.next()) * r;
      const cell = nearOpen(m, x + Math.cos(a) * d, z + Math.sin(a) * d, 4);
      if (cell < 0) continue;
      const [cx, cz] = m.reach.centre(cell);
      return [cx, cz, m.reach.h[cell]];
    }
    return null;
  }

  /** A load slows you. */
  pre(m: Match): void {
    for (const c of m.contestants) {
      const j = this.job[c.index];
      if (j >= 0 && c.status === "alive") m.slow(c, ECONOMY.jobs[this.stations[j].kind as "parcel" | "load"].slow);
    }
  }

  // ── Taps: take a carry-job, sabotage, bank ──

  reachFor(m: Match, c: Contestant): { d: number; take: () => void } | null {
    const t = m.elapsed;
    let best: { d: number; take: () => void } | null = null;
    const near = (x: number, z: number, h: number, r: number) => {
      const d = Math.hypot(x - c.x, z - c.z);
      return d <= r && Math.abs(h - c.h) < 1.5 && (!best || d < best.d) ? d : -1;
    };
    for (const b of this.banks) {
      const d = near(b.x, b.z, b.h, ECONOMY.reach);
      if (d >= 0 && this.carried[c.index] > 0) best = { d, take: () => this.bank(m, c) };
    }
    for (const s of this.stations) {
      const d = near(s.x, s.z, s.h, ECONOMY.reach);
      if (d < 0) continue;
      const w = s.worker >= 0 ? m.contestants[s.worker] : null;
      if (w && w !== c && !m.sameSquad(w, c)) best = { d, take: () => this.sabotage(m, s, c) };
      else if (!HOLD_JOBS.includes(s.kind) && t >= s.until && this.job[c.index] < 0) best = { d, take: () => this.takeJob(m, s, c) };
    }
    return best;
  }

  private takeJob(m: Match, s: Station, c: Contestant): void {
    this.job[c.index] = s.index;
    s.until = m.elapsed + ECONOMY.rest;
    m.emit({ type: "job", id: c.id, station: s.index, how: "take", owo: 0 });
  }

  private sabotage(m: Match, s: Station, by: Contestant): void {
    const w = s.worker >= 0 ? m.contestants[s.worker] : null;
    if (w) this.work[w.index] = 0;
    s.worker = -1;
    s.broken = true;
    s.until = m.elapsed + ECONOMY.broken;
    m.emit({ type: "job", id: by.id, station: s.index, how: "sabotage", owo: 0 });
  }

  private bank(m: Match, c: Contestant): void {
    const owo = this.carried[c.index];
    if (owo <= 0) return;
    this.banked[c.index] += owo;
    this.carried[c.index] = 0;
    m.emit({ type: "owo", id: c.id, carried: 0, banked: this.banked[c.index], why: "bank" });
  }

  private pay(m: Match, c: Contestant, owo: number, why: "job" | "pick" | "bounty"): void {
    this.carried[c.index] += owo;
    m.emit({ type: "owo", id: c.id, carried: this.carried[c.index], banked: this.banked[c.index], why });
  }

  // ── Every step: holds, deliveries, bags, the leader ──

  step(m: Match, dt: number): void {
    const t = m.elapsed;
    const melee = m.module<MeleeModule>("melee");
    for (const s of this.stations) if (s.broken && t >= s.until) s.broken = false;
    for (const c of m.contestants) {
      const i = c.index;
      if (c.status !== "alive" || m.seated(c)) continue;
      // Hold-jobs: holding interact at a free station.
      let at: Station | null = null;
      if (m.holding(c) && c.stun <= 0 && !melee?.isDown(i)) {
        for (const s of this.stations) {
          if (!HOLD_JOBS.includes(s.kind) || t < s.until || (s.worker >= 0 && s.worker !== i)) continue;
          if (Math.hypot(s.x - c.x, s.z - c.z) <= ECONOMY.reach && Math.abs(s.h - c.h) < 1.5) {
            at = s;
            break;
          }
        }
      }
      const was = this.stations.find((s) => s.worker === i) ?? null;
      if (was && was !== at) {
        was.worker = -1;
        this.work[i] = 0;
        m.emit({ type: "job", id: c.id, station: was.index, how: "stop", owo: 0 });
      }
      if (at) {
        if (at.worker !== i) {
          at.worker = i;
          this.work[i] = 0;
          m.emit({ type: "job", id: c.id, station: at.index, how: "start", owo: 0 });
        }
        this.work[i] += dt;
        const spec = ECONOMY.jobs[at.kind as "water" | "wash" | "fix"];
        if (this.work[i] >= spec.hold) {
          at.worker = -1;
          at.until = t + ECONOMY.rest;
          this.work[i] = 0;
          m.emit({ type: "job", id: c.id, station: at.index, how: "done", owo: spec.pay });
          this.pay(m, c, spec.pay, "job");
        }
      }
      // Carry-jobs: reach the drop.
      const j = this.job[i];
      if (j >= 0) {
        const s = this.stations[j];
        if (s.to && Math.hypot(s.to.x - c.x, s.to.z - c.z) <= ECONOMY.drop) {
          this.job[i] = -1;
          const pay = ECONOMY.jobs[s.kind as "parcel" | "load"].pay;
          m.emit({ type: "job", id: c.id, station: j, how: "deliver", owo: pay });
          this.pay(m, c, pay, "job");
        }
      }
      // Spilled Owo: walk over it (not while down; not your own straight back).
      if (melee?.isDown(i)) continue;
      for (const b of this.bags) {
        if (b.owo <= 0 || b.until <= t || (b.by === i && t - b.at < NO_RESCOOP)) continue;
        if (Math.hypot(b.x - c.x, b.z - c.z) > 1.2 || Math.abs(b.h - c.h) > 1) continue;
        const owo = b.owo;
        b.owo = 0;
        m.emit({ type: "scoop", bag: b.index, id: c.id });
        this.pay(m, c, owo, "pick");
      }
    }
    // The leader, on everyone's map.
    if (t >= this.nextPing) {
      this.nextPing += this.leaderPing;
      const lead = this.leader(m);
      if (lead) m.emit({ type: "ping", id: lead.id, x: lead.x, z: lead.z });
    }
  }

  /** Whoever has the most Owo (banked and carried), if anyone has any. */
  leader(m: Match): Contestant | null {
    let best: Contestant | null = null;
    let top = 0;
    for (const c of m.contestants) {
      const v = this.banked[c.index] + this.carried[c.index];
      if (c.status === "alive" && v > top) {
        top = v;
        best = c;
      }
    }
    return best;
  }

  onEvent(m: Match, e: MatchEvent): void {
    if (e.type !== "down" && e.type !== "eliminated") return;
    const c = m.get(e.id);
    if (!c) return;
    const i = c.index;
    // A job you were carrying is lost.
    if (this.job[i] >= 0) {
      m.emit({ type: "job", id: c.id, station: this.job[i], how: "lost", owo: 0 });
      this.job[i] = -1;
    }
    if (e.type === "down" && e.why !== "daze") return;
    // The bounty: Daze the leader, take some of their pocket.
    const lead = this.leader(m);
    const by = e.type === "down" && e.by ? m.get(e.by) : null;
    if (lead === c && by && by !== c && !m.sameSquad(by, c)) {
      const owo = Math.min(this.carried[i], ECONOMY.bounty);
      if (owo > 0) {
        this.carried[i] -= owo;
        m.emit({ type: "owo", id: c.id, carried: this.carried[i], banked: this.banked[i], why: "spill" });
        this.pay(m, by, owo, "bounty");
      }
    }
    // Dazed (or out): a share of what you carry spills; out, all of it.
    const share = e.type === "eliminated" ? 1 : this.spill;
    const owo = Math.floor(this.carried[i] * share);
    if (owo <= 0) return;
    this.carried[i] -= owo;
    const bag: OwoBag = { index: this.bags.length, x: c.x, z: c.z, h: c.h, owo, until: m.elapsed + ECONOMY.bagLife, by: i, at: m.elapsed };
    this.bags.push(bag);
    m.emit({ type: "owo", id: c.id, carried: this.carried[i], banked: this.banked[i], why: "spill" });
    m.emit({ type: "spill", bag: bag.index, x: bag.x, z: bag.z, h: bag.h, owo });
  }

  /** Time up: the clear leader in Owo banked wins (squads pooled; a tie: nobody). */
  timeUp(m: Match): void {
    const st = m.standings();
    const top = st.filter((s) => s.place === 1);
    if (new Set(top.map((s) => s.squad)).size === 1 && top[0] && top[0].objective > 0) m.win(m.get(top[0].id) ?? null, top[0].squad);
  }

  objective(_m: Match, i: number): number {
    return this.banked[i] ?? 0;
  }

  // ── The copy ──

  apply(m: Match, e: MatchEvent): void {
    const c = "id" in e && typeof e.id === "string" ? m.get(e.id) : null;
    switch (e.type) {
      case "owo":
        if (c) {
          this.carried[c.index] = e.carried;
          this.banked[c.index] = e.banked;
        }
        break;
      case "job": {
        const s = this.stations[e.station];
        if (!s || !c) break;
        if (e.how === "take") {
          this.job[c.index] = s.index;
          s.until = m.elapsed + ECONOMY.rest;
        } else if (e.how === "deliver" || e.how === "lost") this.job[c.index] = -1;
        else if (e.how === "start") s.worker = c.index;
        else if (e.how === "stop") s.worker = -1;
        else if (e.how === "done") {
          s.worker = -1;
          s.until = m.elapsed + ECONOMY.rest;
        } else if (e.how === "sabotage") {
          s.worker = -1;
          s.broken = true;
          s.until = m.elapsed + ECONOMY.broken;
        }
        break;
      }
      case "spill":
        if (!this.bags[e.bag]) this.bags[e.bag] = { index: e.bag, x: e.x, z: e.z, h: e.h, owo: e.owo, until: m.elapsed + ECONOMY.bagLife, by: -1, at: m.elapsed };
        break;
      case "scoop":
        if (this.bags[e.bag]) this.bags[e.bag].owo = 0;
        break;
      default:
        break;
    }
  }

  view(m: Match, dt: number): void {
    for (const s of this.stations) if (s.broken && m.elapsed >= s.until) s.broken = false;
    // Your own hold's progress (the HUD's ring); the pay is the server's.
    for (const c of m.contestants) {
      const s = this.stations.find((x) => x.worker === c.index);
      this.work[c.index] = s ? this.work[c.index] + dt : 0;
    }
  }
}
