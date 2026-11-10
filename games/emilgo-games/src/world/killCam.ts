// The kill cam for the open-world matches (v6 2.11; the owner said yes to v5's suggestion: "a short replay of who
// killed you"). Ball Haunt keeps its own (rlgl/replayView.ts, from its eye in the sky); this one is Free For All's,
// COD-style, from over the killer's shoulder.
//
// Each phone records what it SHOWS, 20 times a second for the last 5 s: every body (where, which way, how fast,
// stance, down or up, gun raised) and every shot (who, which gun, where it ended). When a rival takes you out, a
// beat later (your fall, seen live) the 3 s before it play again from behind them, turned towards you; the kill
// itself in slow motion; then on to spectating. A respawn, the match's end or the skip button cut it short.
//
// The replay borrows the bodies, as Ball Haunt's does: the live match goes on underneath (online it can't wait),
// and when it ends every body is handed back as it is live (whoever went down or got up meanwhile).

import { freshMotion, type Contestant } from "../game/core/body";
import type { Match } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import type { GunsModule } from "../game/modules/guns";
import type { Crowd } from "./crowd";

export const KILLCAM = {
  /** Frames a second, and seconds kept. */
  hz: 20,
  keep: 5,
  /** Seconds replayed before the kill and after it (after: long enough to see you land). */
  before: 2.5,
  after: 1.1,
  /** Seconds after the kill before it plays (no less than `after`: those frames must be kept by then). */
  delay: 1.1,
  /** The kill's moment: this speed, from `slowBefore` s before it to `slowAfter` s after. All of it lasts about
   * 5.6 s from the kill, inside the 6 s respawn. */
  slow: 0.4,
  slowBefore: 0.3,
  slowAfter: 0.3,
} as const;

/** Per body per frame: x, z, y, floor, heading, vx, vz, stance, flags. */
const BODY = 9;
const F_DOWN = 1;
const F_SPRINT = 2;
const F_GUN = 4;
const F_SLIDE = 8;

export type FireEvent = Extract<MatchEvent, { type: "fire" }>;

/** One frame of the replay, for the mode to draw. */
export interface KillCamFrame {
  /** The bodies as they were (by contestant index). */
  people: readonly Contestant[];
  /** Each body's gun raised. */
  gunUp: readonly boolean[];
  /** The killer and you, as they were. */
  killer: Contestant;
  victim: Contestant;
  /** This frame's speed (1, or slow at the kill), and whether the kill's moment just began (the lens pushes in). */
  k: number;
  slowStart: boolean;
  /** Shots fired since the last frame, to draw again. */
  fires: FireEvent[];
  /** 0 … 1 of the way through. */
  u: number;
}

interface Clip {
  n: number;
  count: number;
  times: Float64Array;
  data: Float32Array;
  fires: { t: number; e: FireEvent }[];
  kill: number;
  killer: number;
  victim: number;
}

export class KillCam {
  private readonly capacity = KILLCAM.hz * KILLCAM.keep;
  private n = 0;
  private ring = new Float32Array(0);
  private times = new Float64Array(this.capacity);
  private written = 0;
  private clock = 0;
  private fires: { t: number; e: FireEvent }[] = [];
  /** Down but not out (a squad's knocked player), by index: down/up events. */
  private readonly downs = new Set<number>();

  private pending: { at: number; kill: number; killer: number; victim: number } | null = null;
  private clip: Clip | null = null;
  private head = 0;
  private fired = 0;
  private wasSlow = false;
  /** The match's clock at the last frame: the replay runs on it (a slow phone's match runs slower than its frames). */
  private last = 0;
  private saved: ReturnType<Crowd["saveAnims"]> = [];
  private people: Contestant[] = [];
  private gunUp: boolean[] = [];
  private shownDown: boolean[] = [];

  constructor(private readonly crowd: Crowd) {}

  get active(): boolean {
    return this.clip !== null;
  }

  /** A kill cam is coming or playing. */
  get busy(): boolean {
    return this.clip !== null || this.pending !== null;
  }

  /** The match's events: shots kept for the replay; who is down and who got up. */
  note(events: readonly MatchEvent[], m: Match): void {
    for (const e of events) {
      if (e.type === "fire") this.fires.push({ t: m.elapsed, e });
      else if (e.type === "down") this.setDown(m, e.id, true);
      else if (e.type === "up" || e.type === "respawn") this.setDown(m, e.id, false);
      else if (e.type === "helpup") this.setDown(m, e.tg, false);
    }
    const old = m.elapsed - KILLCAM.keep;
    let drop = 0;
    while (drop < this.fires.length && this.fires[drop].t < old) drop++;
    if (drop) this.fires.splice(0, drop);
  }

  private setDown(m: Match, id: string, on: boolean): void {
    const c = m.get(id);
    if (!c) return;
    if (on) this.downs.add(c.index);
    else this.downs.delete(c.index);
  }

  private fallen(c: Contestant): boolean {
    return c.status !== "alive" || this.downs.has(c.index);
  }

  /** Every frame the match is drawn live: a frame kept KILLCAM.hz times a second. */
  record(dt: number, m: Match, myIndex: number, myAiming: boolean): void {
    const list = m.contestants;
    if (list.length !== this.n) {
      this.n = list.length;
      this.ring = new Float32Array(this.capacity * this.n * BODY);
      this.written = 0;
    }
    this.clock -= dt;
    if (this.clock > 0 && this.written > 0) return;
    this.clock = Math.max(0, this.clock + 1 / KILLCAM.hz);
    const g = m.module<GunsModule>("guns");
    const slot = this.written % this.capacity;
    this.times[slot] = m.elapsed;
    let o = slot * this.n * BODY;
    const r = this.ring;
    for (const c of list) {
      const i = c.index;
      const up = !!g && (m.elapsed - g.aimedAt[i] < 1.2 || (g.reloadAt[i] ?? -1) >= 0 || (i === myIndex && myAiming));
      r[o] = c.x;
      r[o + 1] = c.z;
      r[o + 2] = c.y;
      r[o + 3] = c.h;
      r[o + 4] = c.heading;
      r[o + 5] = c.vx;
      r[o + 6] = c.vz;
      r[o + 7] = c.stance;
      r[o + 8] = (this.fallen(c) ? F_DOWN : 0) | (c.sprinting ? F_SPRINT : 0) | (up ? F_GUN : 0) | (c.slide > 0 ? F_SLIDE : 0);
      o += BODY;
    }
    this.written++;
  }

  /** You were taken out by `killer`: the replay plays KILLCAM.delay s from now (once the recording holds the moment). */
  begin(m: Match, killer: Contestant, victim: Contestant): void {
    if (this.busy || killer === victim || this.written < 2) return;
    this.pending = { at: m.elapsed + KILLCAM.delay, kill: m.elapsed, killer: killer.index, victim: victim.index };
  }

  /** Cancel what's coming, or end what's playing (`m`: hand the bodies back as they are live). */
  stop(m: Match): void {
    this.pending = null;
    if (!this.clip) return;
    this.clip = null;
    this.crowd.loadAnims(this.saved);
    this.saved = [];
    for (const c of m.contestants) {
      const a = this.crowd.anim(c.index);
      if (!a) continue;
      const down = this.fallen(c);
      if (down && a.dead < 0) {
        a.dead = 6;
        a.fall = 1;
      } else if (!down && a.dead >= 0) {
        a.dead = -1;
        a.fall = 0;
      }
    }
  }

  /**
   * One drawn frame: null while nothing plays (it starts here once its moment comes). The caller draws the
   * bodies from `people`; when it ends the bodies are back with the live match and this returns null again.
   */
  frame(m: Match): KillCamFrame | null {
    if (this.pending && !this.clip && m.elapsed >= this.pending.at) {
      const p = this.pending;
      this.pending = null;
      this.cut(p);
      this.last = m.elapsed;
    }
    const clip = this.clip;
    if (!clip) return null;
    const tAt = (h: number) => clip.times[0] + h;
    const nowT = tAt(this.head);
    const slow = nowT >= clip.kill - KILLCAM.slowBefore && nowT <= clip.kill + KILLCAM.slowAfter;
    const k = slow ? KILLCAM.slow : 1;
    const slowStart = slow && !this.wasSlow;
    this.wasSlow = slow;
    const span = clip.times[clip.count - 1] - clip.times[0];
    const dt = Math.max(0, Math.min(0.1, m.elapsed - this.last));
    this.last = m.elapsed;
    this.head = Math.min(span, this.head + dt * k);
    const t = tAt(this.head);
    this.fill(clip, t);
    const fires: FireEvent[] = [];
    while (this.fired < clip.fires.length && clip.fires[this.fired].t <= t) fires.push(clip.fires[this.fired++].e);
    const frame: KillCamFrame = {
      people: this.people,
      gunUp: this.gunUp,
      killer: this.people[clip.killer],
      victim: this.people[clip.victim],
      k,
      slowStart,
      fires,
      u: span > 0 ? this.head / span : 1,
    };
    if (this.head >= span) {
      this.stop(m);
      return null;
    }
    return frame;
  }

  /** The clip: the kept frames from KILLCAM.before s before the kill to KILLCAM.after s after it. */
  private cut(p: { kill: number; killer: number; victim: number }): void {
    const total = Math.min(this.written, this.capacity);
    const first = this.written - total;
    const pick: number[] = [];
    for (let w = first; w < this.written; w++) {
      const t = this.times[w % this.capacity];
      if (t >= p.kill - KILLCAM.before && t <= p.kill + KILLCAM.after) pick.push(w % this.capacity);
    }
    if (pick.length < 2 || p.killer >= this.n || p.victim >= this.n) return;
    const size = this.n * BODY;
    const data = new Float32Array(pick.length * size);
    const times = new Float64Array(pick.length);
    pick.forEach((slot, f) => {
      data.set(this.ring.subarray(slot * size, slot * size + size), f * size);
      times[f] = this.times[slot];
    });
    const t0 = times[0];
    const t1 = times[pick.length - 1];
    this.clip = { n: this.n, count: pick.length, times, data, fires: this.fires.filter((f) => f.t >= t0 && f.t <= t1), kill: p.kill, killer: p.killer, victim: p.victim };
    this.head = 0;
    this.fired = 0;
    this.wasSlow = false;
    this.saved = this.crowd.saveAnims();
    this.people = Array.from({ length: this.n }, (_, index): Contestant => ({
      id: `kc${index}`,
      name: "",
      bot: true,
      index,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      heading: 0,
      status: "alive",
      finishTime: -1,
      place: 0,
      eliminatedAt: -1,
      cause: null,
      inX: 0,
      inZ: 0,
      progress: 0,
      graceBonus: 0,
      ...freshMotion(),
    }));
    this.gunUp = this.people.map(() => false);
    this.shownDown = [];
    this.fill(this.clip, t0);
    // Everyone as they were at the first frame: the fallen lie where they fell, everyone else stands.
    this.shownDown = this.people.map((c) => c.status !== "alive");
    for (const c of this.people) {
      const a = this.crowd.anim(c.index);
      if (!a) continue;
      a.dead = this.shownDown[c.index] ? 6 : -1;
      a.fall = this.shownDown[c.index] ? 1 : 0;
    }
  }

  /** The bodies at time `t` (between two kept frames), and their falls as they happened. */
  private fill(clip: Clip, t: number): void {
    let f0 = 0;
    while (f0 < clip.count - 2 && clip.times[f0 + 1] <= t) f0++;
    const f1 = Math.min(clip.count - 1, f0 + 1);
    const gap = clip.times[f1] - clip.times[f0];
    const w = gap > 0 ? Math.max(0, Math.min(1, (t - clip.times[f0]) / gap)) : 0;
    const d = clip.data;
    const size = clip.n * BODY;
    const killer = this.people[clip.killer];
    for (const c of this.people) {
      const a = f0 * size + c.index * BODY;
      const b = f1 * size + c.index * BODY;
      c.x = d[a] + (d[b] - d[a]) * w;
      c.z = d[a + 1] + (d[b + 1] - d[a + 1]) * w;
      c.y = Math.max(0, d[a + 2] + (d[b + 2] - d[a + 2]) * w);
      c.h = d[a + 3] + (d[b + 3] - d[a + 3]) * w;
      const dh = Math.atan2(Math.sin(d[b + 4] - d[a + 4]), Math.cos(d[b + 4] - d[a + 4]));
      c.heading = d[a + 4] + dh * w;
      c.vx = d[a + 5] + (d[b + 5] - d[a + 5]) * w;
      c.vz = d[a + 6] + (d[b + 6] - d[a + 6]) * w;
      c.stance = Math.round(d[a + 7]) as Contestant["stance"];
      const flags = d[w < 0.5 ? a + 8 : b + 8];
      const down = (flags & F_DOWN) !== 0;
      c.status = down ? "eliminated" : "alive";
      c.sprinting = (flags & F_SPRINT) !== 0;
      c.slide = flags & F_SLIDE ? 0.1 : 0;
      this.gunUp[c.index] = (flags & F_GUN) !== 0 && !down;
      if (down) c.vx = c.vz = 0;
      if (!this.shownDown.length) continue;
      // Falls and getting up, as they happened (the victim falls away from the killer).
      const anim = this.crowd.anim(c.index);
      if (down && !this.shownDown[c.index]) {
        const from = c.index === clip.victim && killer ? killer : null;
        this.crowd.kill(c.index, c, from ? from.x : c.x - Math.sin(c.heading), from ? from.z : c.z - Math.cos(c.heading));
      } else if (!down && anim && anim.dead >= 0) {
        // Up again in the recording, or knocked down live meanwhile: the replay's body stands.
        anim.dead = -1;
        anim.fall = 0;
      } else if (down && anim && anim.dead < 0) {
        this.crowd.kill(c.index, c, c.x - Math.sin(c.heading), c.z - Math.cos(c.heading));
      }
      this.shownDown[c.index] = down;
    }
  }
}
