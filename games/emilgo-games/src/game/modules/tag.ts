// Chase & Reverse (SPEC-V3 §9 #8; Phase 6): one player starts as the Ojuju
// (from Calabar folklore), the chaser. An Ojuju who touches a human turns
// them: they join the Ojuju. The Ojuju are a little faster but can't use
// items. At 3:00 two Reverse charms appear: a human carrying one who touches
// an Ojuju cures them (the charm is spent). Last human standing wins; if the
// Ojuju turn everyone, the one who turned the most wins. Time up with humans
// left: whoever stayed human longest places first.
//
// Pure and seeded; who starts as the Ojuju is announced (an event), and the
// charms' places come from the public seed, so a phone's copy agrees.

import { FLAGS } from "../../config";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import { nearOpen } from "./flags";
import type { MeleeModule } from "./melee";
import type { ZoneModule } from "./zone";

/** Touch to turn (or cure): this close, about the same height. */
export const TAG_TOUCH = 0.9;

export interface Charm {
  readonly index: number;
  x: number;
  z: number;
  h: number;
  /** Who carries it (body index), −1 on the ground; spent once used. */
  holder: number;
  spent: boolean;
}

export class TagModule implements RuleModule {
  readonly id = "tag" as const;
  readonly start: number;
  readonly speed: number;
  readonly cures: number;
  readonly curesAt: number;
  /** 1 for an Ojuju. */
  ojuju = new Uint8Array(0);
  /** Seconds each body has been human, and how many each Ojuju turned. */
  human = new Float64Array(0);
  turned = new Float64Array(0);
  readonly charms: Charm[] = [];
  private charmsOut = false;
  private began = 0;

  constructor(params: Record<string, unknown>) {
    const num = (k: string, d: number) => (typeof params[k] === "number" ? (params[k] as number) : d);
    this.start = Math.max(1, Math.floor(num("start", 1)));
    this.speed = Math.max(0.8, Math.min(1.3, num("chaserSpeed", 1.08)));
    this.cures = Math.max(0, Math.floor(num("cures", 2)));
    this.curesAt = num("curesAt", 180);
  }

  init(m: Match): void {
    const n = m.contestants.length;
    this.ojuju = new Uint8Array(n);
    this.human = new Float64Array(n);
    this.turned = new Float64Array(n);
    // Alone (Practice) there's nobody to chase: you're human, nothing is judged.
    if (m.mirror || n < 2) return;
    // The first Ojuju: chosen by the seed, announced to everyone.
    const order = m.rng("tag").shuffle(m.contestants.map((c) => c.index));
    const k = Math.min(this.start, Math.max(1, n - 1));
    for (let i = 0; i < k; i++) this.turn(m, m.contestants[order[i]], true, null);
  }

  isOjuju(i: number): boolean {
    return this.ojuju[i] === 1;
  }

  /** Humans still in. */
  humans(m: Match): Contestant[] {
    return m.contestants.filter((c) => c.status === "alive" && !this.ojuju[c.index]);
  }

  private turn(m: Match, c: Contestant, toOjuju: boolean, by: Contestant | null): void {
    this.ojuju[c.index] = toOjuju ? 1 : 0;
    // An Ojuju can't carry a charm.
    if (toOjuju) for (const ch of this.charms) if (ch.holder === c.index) this.dropCharm(m, ch, c);
    m.emit({ type: "turn", id: c.id, ojuju: toOjuju, by: by?.id ?? null });
  }

  // ── The Ojuju are faster ──

  pre(m: Match): void {
    for (const c of m.contestants) if (c.status === "alive" && this.ojuju[c.index]) m.slow(c, this.speed);
  }

  // ── Touches, charms, the end ──

  step(m: Match, dt: number): void {
    const t = m.elapsed;
    if (!this.began) this.began = t;
    for (const c of m.contestants) if (c.status === "alive" && !this.ojuju[c.index]) this.human[c.index] += dt;
    if (!this.charmsOut && t >= this.curesAt && this.cures > 0) this.dropCharms(m);
    const melee = m.module<MeleeModule>("melee");
    const down = (c: Contestant) => !!melee?.isDown(c.index);
    // Charms on the ground: a human walks onto one to carry it.
    for (const ch of this.charms) {
      if (ch.spent || ch.holder >= 0) continue;
      for (const c of m.contestants) {
        if (c.status !== "alive" || this.ojuju[c.index] || down(c) || m.seated(c)) continue;
        if (this.carrying(c.index) || Math.hypot(c.x - ch.x, c.z - ch.z) > FLAGS.touch || Math.abs(c.h - ch.h) > 1) continue;
        ch.holder = c.index;
        m.emit({ type: "charm", charm: ch.index, how: "take", id: c.id, x: ch.x, z: ch.z, h: ch.h });
        break;
      }
    }
    // Touches between an Ojuju and a human: a charm cures, otherwise the human turns.
    for (const a of m.contestants) {
      if (a.status !== "alive" || !this.ojuju[a.index] || down(a) || m.seated(a)) continue;
      for (const b of m.contestants) {
        if (b === a || b.status !== "alive" || this.ojuju[b.index] || m.seated(b)) continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) > TAG_TOUCH || Math.abs(a.h + a.y - (b.h + b.y)) > 1.2) continue;
        const ch = this.charms.find((x) => x.holder === b.index && !x.spent);
        if (ch && !down(b)) {
          ch.spent = true;
          ch.holder = -1;
          m.emit({ type: "charm", charm: ch.index, how: "use", id: b.id, x: a.x, z: a.z, h: a.h });
          this.turn(m, a, false, b);
        } else {
          this.turned[a.index]++;
          this.turn(m, b, true, a);
        }
        break;
      }
    }
    // The carrier of a charm moves it.
    for (const ch of this.charms) {
      if (ch.holder < 0 || ch.spent) continue;
      const c = m.contestants[ch.holder];
      ch.x = c.x;
      ch.z = c.z;
      ch.h = c.h;
    }
    this.judge(m);
  }

  private carrying(i: number): boolean {
    return this.charms.some((ch) => ch.holder === i && !ch.spent);
  }

  /** The Reverse charms: inside the zone, away from each other. */
  private dropCharms(m: Match): void {
    this.charmsOut = true;
    const rng = m.rng("charms");
    const safe = m.module<ZoneModule>("zone")?.safe();
    const reach = m.reach;
    for (let k = 0; k < this.cures; k++) {
      for (let tries = 0; tries < 60; tries++) {
        let x: number;
        let z: number;
        if (safe) {
          const a = rng.range(0, Math.PI * 2);
          const r = Math.sqrt(rng.next()) * safe.r * 0.7;
          x = safe.x + Math.cos(a) * r;
          z = safe.z + Math.sin(a) * r;
        } else [x, z] = reach.centre(reach.open[rng.int(0, reach.open.length - 1)]);
        const cell = nearOpen(m, x, z, 4);
        if (cell < 0) continue;
        const [cx, cz] = reach.centre(cell);
        if (this.charms.some((o) => Math.hypot(o.x - cx, o.z - cz) < 30)) continue;
        const ch: Charm = { index: this.charms.length, x: cx, z: cz, h: reach.h[cell], holder: -1, spent: false };
        this.charms.push(ch);
        m.emit({ type: "charm", charm: ch.index, how: "drop", id: null, x: cx, z: cz, h: ch.h });
        break;
      }
    }
  }

  private dropCharm(m: Match, ch: Charm, c: Contestant): void {
    ch.holder = -1;
    ch.x = c.x;
    ch.z = c.z;
    ch.h = c.h;
    m.emit({ type: "charm", charm: ch.index, how: "drop", id: c.id, x: c.x, z: c.z, h: c.h });
  }

  /** Last human standing; or everyone turned. */
  private judge(m: Match): void {
    if (m.winner || m.contestants.length < 2) return;
    const humans = this.humans(m);
    if (humans.length === 1 && m.contestants.length > 2) m.win(humans[0]);
    else if (humans.length === 0) m.win(this.topOjuju(m));
  }

  private topOjuju(m: Match): Contestant | null {
    let best: Contestant | null = null;
    for (const c of m.contestants) if (this.ojuju[c.index] && (!best || this.turned[c.index] > this.turned[best.index])) best = c;
    return best;
  }

  onEvent(m: Match, e: MatchEvent): void {
    // Knocked down or out with a charm: it drops where you are.
    if (e.type !== "down" && e.type !== "eliminated") return;
    const c = m.get(e.id);
    if (!c) return;
    for (const ch of this.charms) if (ch.holder === c.index && !ch.spent) this.dropCharm(m, ch, c);
  }

  /** Time up with humans left: the one who stayed human longest (the measure does it). */
  timeUp(m: Match): void {
    const humans = this.humans(m);
    if (humans.length === 1) m.win(humans[0]);
  }

  /** The measure: seconds as a human (an Ojuju's turns break ties). */
  objective(_m: Match, i: number): number {
    return Math.round(this.human[i]) + this.turned[i] * 0.01;
  }

  // ── The copy ──

  apply(m: Match, e: MatchEvent): void {
    if (e.type === "turn") {
      const c = m.get(e.id);
      if (!c) return;
      this.ojuju[c.index] = e.ojuju ? 1 : 0;
      const by = e.by ? m.get(e.by) : null;
      if (e.ojuju && by) this.turned[by.index]++;
    } else if (e.type === "charm") {
      let ch = this.charms[e.charm];
      if (!ch) {
        ch = { index: e.charm, x: e.x, z: e.z, h: e.h, holder: -1, spent: false };
        this.charms[e.charm] = ch;
        this.charmsOut = true;
      }
      const c = e.id ? m.get(e.id) : null;
      if (e.how === "take" && c) ch.holder = c.index;
      else if (e.how === "use") {
        ch.spent = true;
        ch.holder = -1;
      } else if (e.how === "drop") {
        ch.holder = -1;
        ch.x = e.x;
        ch.z = e.z;
        ch.h = e.h;
      }
    }
  }

  view(m: Match, dt: number): void {
    for (const c of m.contestants) if (c.status === "alive" && !this.ojuju[c.index]) this.human[c.index] += dt;
    for (const ch of this.charms) {
      if (ch.holder < 0 || ch.spent) continue;
      const c = m.contestants[ch.holder];
      ch.x = c.x;
      ch.z = c.z;
      ch.h = c.h;
    }
  }
}
