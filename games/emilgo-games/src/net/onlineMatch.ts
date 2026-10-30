// A Free For All match, seen from one phone (protocol 12; net/matchWire.ts).
// The phone keeps a copy of the match (Match.mirror) built from the start's
// seed, mode and squads, the way OnlineRound does for Red Light, Green Light:
//
//   You           PREDICTED: your stick moves your body at once, with the
//                 match core's own movement (Match.predict), slowed as the
//                 server slows it (a brace, a flag held, a clinch). Each
//                 snapshot says where the server really had you; the gap
//                 closes smoothly, and snaps when it is large. While the
//                 server moves you (knocked down, held in a clinch, your own
//                 shoulder charge) you follow it instead.
//   Everyone else INTERPOLATED: drawn NET.interpDelayMs in the past, between
//                 two snapshots. Cars too (protocol 13), except the one you
//                 drive: it is predicted like your body (drive.ts), and
//                 riders sit in their seats wherever their car is drawn.
//   Everything    ONLY the server decides: the match's events arrive as they
//   else          happen and are applied to the copy (Match.applyRemote), then
//                 handed to the screen in the same order.

import { MELEE, MOVE, NET } from "../config";
import { BUILTIN_MANIFEST, type ModeDef } from "../content/modes";
import type { Contestant } from "../game/core/body";
import { Match, settingsOf, type MatchWorld } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import type { CaptureModule } from "../game/modules/capture";
import type { FlagsModule } from "../game/modules/flags";
import { driveCar, wrap, type Car } from "../game/modules/drive";
import type { MeleeModule } from "../game/modules/melee";
import type { TagModule } from "../game/modules/tag";
import type { VehiclesModule } from "../game/modules/vehicles";
import type { NetClient } from "./client";
import { CAR_STRIDE, decodeEvent, MATCH_PHASES, MSNAP_STRIDE, unpackMeter, type FfaStart, type MatchSnap, type MatchSync, type WireEvent } from "./matchWire";
import { unpackFlags, type ServerMsg, type StartInfo } from "./protocol";

const SNAP_KEEP = 24;
const HIST_KEEP_MS = 1500;
const SNAP_IF_ERROR_M = 2.0;

interface Hist {
  t: number;
  x: number;
  z: number;
  /** The car you drive: its heading then. */
  h?: number;
}

/** The mode a start names, if this build has the same version of it (else the copy would disagree). */
export function ffaDef(f: FfaStart): ModeDef | null {
  const def = BUILTIN_MANIFEST.modes.find((d) => d.id === f.mode);
  return def && def.v === f.v ? def : null;
}

export class OnlineMatch {
  readonly match: Match;
  readonly ffa: FfaStart;
  readonly def: ModeDef;
  readonly seed: number;
  readonly me: Contestant | null;
  /** The measure for each body (seconds held, deliveries …), as the server last said: the HUD's scores. */
  readonly measures: number[];
  /** How far in the past others are drawn: longer with data saver on (half the snapshots). */
  interpMs: number = NET.interpDelayMs;

  private readonly melee: MeleeModule | null;
  private readonly flags: FlagsModule | null;
  private readonly cars: VehiclesModule | null;
  /** The car you drive: where it was (predicted), and the gap to the server still to close. */
  private readonly carHist: Hist[] = [];
  private carCorr = { x: 0, z: 0, h: 0 };
  private readonly snaps: MatchSnap[] = [];
  private readonly hist: Hist[] = [];
  private corrX = 0;
  private corrZ = 0;
  /** Seconds of play until which the server moves you (your own charge's lunge). */
  private followUntil = -1;
  private readonly off: () => void;

  constructor(
    start: StartInfo,
    readonly myId: string,
    private readonly net: NetClient,
    world: MatchWorld,
    log: readonly WireEvent[] = [],
    snap?: MatchSnap,
  ) {
    const f = start.ffa!;
    const def = ffaDef(f);
    if (!def) throw new Error(`mode ${f.mode} v${f.v} isn't in this build`);
    this.ffa = f;
    this.def = def;
    this.seed = start.seed;
    this.match = new Match({
      seed: start.seed,
      world,
      settings: settingsOf(def, f.rk === 1),
      contestants: start.roster.map((r, i) => ({ id: r.id, name: r.name, bot: false, squad: f.sq[i] })),
      countdown: f.cd,
      mirror: true,
    });
    this.me = this.match.get(myId) ?? null;
    this.measures = new Array(this.match.contestants.length).fill(0);
    this.melee = this.match.module<MeleeModule>("melee");
    this.flags = this.match.module<FlagsModule>("flags");
    this.cars = this.match.module<VehiclesModule>("vehicles");
    // A rejoin: every event so far, straight into the copy (the screen sees only what comes after).
    this.events(log);
    this.match.drain();
    if (snap) this.onSnap(snap, true);
    this.off = net.on((m) => this.receive(m));
  }

  static fromSync(sync: MatchSync, myId: string, net: NetClient, world: MatchWorld): OnlineMatch {
    return new OnlineMatch({ seed: sync.seed, s: sync.s, roster: sync.roster, init: [], ffa: sync.ffa }, myId, net, world, sync.log, sync.snap);
  }

  dispose(): void {
    this.off();
    this.net.resetInput();
  }

  // ── Your buttons ───────────────────────────────────────────────────────────

  setInput(x: number, z: number): void {
    const me = this.me;
    if (!me) return;
    me.inX = x;
    me.inZ = z;
    this.net.setInput(x, z);
  }

  setButtons(sprint: boolean, stance: 0 | 1 | 2, jump: number): void {
    const me = this.me;
    if (!me) return;
    me.inSprint = sprint;
    me.inStance = stance;
    me.inJump = jump & 255;
    this.net.setButtons(sprint, stance, me.inJump);
  }

  setActions(attack: number, grab: number): void {
    const me = this.me;
    if (!me) return;
    // The copy never swings: what you see is the server's "swing" event.
    me.inAttack = me.attackSeen = attack & 255;
    me.inGrab = me.grabSeen = grab & 255;
    this.net.setActions(attack & 255, grab & 255);
  }

  /** Brace held, the interact counter and whether it's held, the backpack's counter. */
  setMatchButtons(brace: boolean, interact: number, hold: boolean, pack: number): void {
    const me = this.me;
    if (!me) return;
    this.match.setBrace(me.id, brace);
    this.match.setInteract(me.id, interact & 255, hold);
    this.net.setMatchButtons(brace, interact, hold, pack);
  }

  /** The events since the last call, applied to the copy, in order. */
  drain(): MatchEvent[] {
    return this.match.drain();
  }

  // ── The fixed step ─────────────────────────────────────────────────────────

  step(dt: number): void {
    const m = this.match;
    m.step(dt);
    const me = this.me;
    const car = this.driving();
    if (car && me && m.phase === "play") this.driveMine(car, me, dt);
    else if (this.carHist.length) this.carHist.length = 0;
    if (me && me.status === "alive" && m.phase === "play" && !m.seated(me)) {
      if (this.net.state !== "open") me.inX = me.inZ = 0;
      const follow = this.following();
      if (!follow) m.predict(me, dt, this.share(me));
      // Close the gap to the server: about 90% in a quarter second (faster while it moves you).
      const k = 1 - Math.exp(-dt * (follow ? 18 : 9));
      const dx = this.corrX * k;
      const dz = this.corrZ * k;
      me.x += dx;
      me.z += dz;
      this.corrX -= dx;
      this.corrZ -= dz;
      if (follow) me.h = m.world.space.floorAt(me.x, me.z, me.h + me.y + 0.05).h;
      // History moves with the correction, so the next comparison isn't double-counted.
      for (const h of this.hist) {
        h.x += dx;
        h.z += dz;
      }
      const t = performance.now();
      this.hist.push({ t, x: me.x, z: me.z });
      while (this.hist.length && t - this.hist[0].t > HIST_KEEP_MS) this.hist.shift();
    }
    this.interpolate(this.net.serverNow() - this.interpMs);
    this.cars?.placeRiders(m);
  }

  /** The car you're driving, if you are. */
  driving(): Car | null {
    const me = this.me;
    const v = this.cars;
    if (!me || !v) return null;
    const i = this.match.seatOf(me);
    const car = i >= 0 ? v.cars[i] : undefined;
    return car && car.seats[0] === me.index && car.state < 4 ? car : null;
  }

  /** Your car, predicted: your stick drives it now, and the server's word pulls it back gently. */
  private driveMine(car: Car, me: Contestant, dt: number): void {
    if (this.net.state !== "open") me.inX = me.inZ = 0;
    driveCar(car, me.inX, me.inZ, car.fuel > 0, dt, this.match.world.space);
    const k = 1 - Math.exp(-dt * 6);
    const dx = this.carCorr.x * k;
    const dz = this.carCorr.z * k;
    const dh = this.carCorr.h * k;
    car.x += dx;
    car.z += dz;
    car.heading = wrap(car.heading + dh);
    this.carCorr.x -= dx;
    this.carCorr.z -= dz;
    this.carCorr.h -= dh;
    for (const h of this.carHist) {
      h.x += dx;
      h.z += dz;
      h.h = (h.h ?? 0) + dh;
    }
    const t = performance.now();
    this.carHist.push({ t, x: car.x, z: car.z, h: car.heading });
    while (this.carHist.length && t - this.carHist[0].t > HIST_KEEP_MS) this.carHist.shift();
  }

  /** The server is moving you: down, held, or in your own charge's lunge. */
  private following(): boolean {
    const me = this.me;
    const mel = this.melee;
    if (!me || !mel) return false;
    return mel.isDown(me.index) || mel.heldBy[me.index] >= 0 || this.match.elapsed < this.followUntil;
  }

  /** Your speed share this step, as the server's modules will give it. */
  private share(me: Contestant): number {
    const m = this.match;
    let k = 1;
    const mel = this.melee;
    if (mel) {
      if (m.braced(me) && m.effect(me, "iron") <= 0) k *= MELEE.brace.slow;
      if (mel.clinchOf(me.index) >= 0) k *= MELEE.grab.drag;
    }
    const f = this.flags;
    if (f && f.heldBy(me.index) && f.holderSlow > 0) k *= 1 - f.holderSlow;
    const tag = m.module<TagModule>("tag");
    if (tag?.isOjuju(me.index)) k *= tag.speed;
    return k;
  }

  // ── Network ────────────────────────────────────────────────────────────────

  private receive(m: ServerMsg): void {
    if (m.t === "mev") this.events(m.e);
    else if (m.t === "msnap") this.onSnap(m, false);
  }

  private events(list: readonly WireEvent[]): void {
    const m = this.match;
    for (const w of list) {
      const e = decodeEvent(w, (i) => m.contestants[i]?.id ?? null);
      if (!e) continue;
      m.applyRemote(e);
      this.mine(e);
    }
  }

  /** What an event does to your predicted body (the copy's modules keep the rest). */
  private mine(e: MatchEvent): void {
    const me = this.me;
    if (!me) return;
    const m = this.match;
    switch (e.type) {
      case "hit":
        this.melee?.setWobble(m.get(e.tg)?.index ?? -1, e.w);
        if (e.tg !== me.id) break;
        // Knocked: slide now, as the server has you.
        me.vx = e.kx;
        me.vz = e.kz;
        me.sprinting = false;
        me.stun = Math.max(me.stun, Math.hypot(me.vx, me.vz) / MOVE.decel);
        break;
      case "swing":
        if (e.id === me.id && e.kind === "charge") this.followUntil = m.elapsed + MELEE.charge.windup + MELEE.charge.dash + 0.2;
        break;
      case "respawn":
      case "seat":
        if (e.id === me.id) {
          this.hist.length = 0;
          this.corrX = this.corrZ = 0;
          this.carHist.length = 0;
          this.carCorr = { x: 0, z: 0, h: 0 };
        }
        break;
      case "bump":
        this.melee?.setWobble(m.get(e.tg)?.index ?? -1, e.w);
        if (e.tg !== me.id) break;
        // Pushed aside by a car: slide now, as the server has you.
        me.vx = e.kx;
        me.vz = e.kz;
        me.sprinting = false;
        me.stun = Math.max(me.stun, Math.hypot(me.vx, me.vz) / MOVE.decel);
        break;
      default:
        break;
    }
  }

  private onSnap(s: MatchSnap, sync: boolean): void {
    const m = this.match;
    this.snaps.push(s);
    if (this.snaps.length > SNAP_KEEP) this.snaps.shift();
    // Missed a phase change (only after a reconnect): take the server's word.
    const ph = MATCH_PHASES[s.ph];
    if (ph && ph !== m.phase && m.phase !== "ended") {
      m.phase = ph;
      if (s.pt !== undefined && s.pd !== undefined) {
        m.phaseTime = s.pt / 1000;
        m.phaseDuration = s.pd / 1000;
      }
    }
    const el = s.el / 1000;
    if (Math.abs(el - m.elapsed) > 0.25) m.elapsed = el;
    if (s.o) {
      // The server's measures: the copy's own count drifts by a step or two.
      const cap = m.module<CaptureModule>("capture");
      for (let i = 0; i < this.measures.length; i++) {
        const v = (s.o[i] ?? 0) / 10;
        this.measures[i] = v;
        this.flags?.setObjective(i, v);
        cap?.setObjective(i, v);
      }
    }
    // Meters (wobble, brace) for everyone; the rest is drawn from the buffer.
    const mel = this.melee;
    for (const c of m.contestants) {
      if (s.st[c.index] !== "a") continue;
      const k = c.index * MSNAP_STRIDE;
      const mt = unpackMeter(s.p[k + 5]);
      if (mel) {
        mel.setWobble(c.index, mt.wobble);
        mel.brace[c.index] = mt.brace;
      }
      if (c === this.me) {
        c.stamina = unpackFlags(s.p[k + 4]).stamina;
        if (sync) this.place(c, s, k);
      }
    }
    // The cars: fuel and damage as the server says (their places are drawn from the buffer).
    const v = this.cars;
    if (v && s.v) {
      for (const car of v.cars) {
        if (!car) continue;
        const k = car.index * CAR_STRIDE;
        if (k + CAR_STRIDE > s.v.length) continue;
        car.fuel = s.v[k + 4] / 10;
        car.damage = s.v[k + 5] / 10;
        if (sync) {
          car.x = s.v[k] / 100;
          car.z = s.v[k + 1] / 100;
          car.heading = s.v[k + 2] / 100;
          car.speed = s.v[k + 3] / 100;
        }
      }
      if (sync) v.placeRiders(m);
    }
    if (!sync) {
      this.reconcile(s);
      this.reconcileCar(s);
    }
  }

  /** Your car: where the server had it against where we predicted it then. */
  private reconcileCar(s: MatchSnap): void {
    const car = this.driving();
    if (!car || !s.v || !this.carHist.length) return;
    const k = car.index * CAR_STRIDE;
    if (k + CAR_STRIDE > s.v.length) return;
    const sx = s.v[k] / 100;
    const sz = s.v[k + 1] / 100;
    const sh = s.v[k + 2] / 100;
    const ss = s.v[k + 3] / 100;
    const localThen = s.s - (this.net.serverNow() - performance.now()) - this.net.rtt / 2;
    const h = histAt(this.carHist, localThen);
    const ex = sx - h.x;
    const ez = sz - h.z;
    const eh = wrap(sh - (h.h ?? car.heading));
    if (Math.hypot(ex, ez) > SNAP_IF_ERROR_M * 1.5 || Math.abs(eh) > 0.6) {
      car.x += ex;
      car.z += ez;
      car.heading = wrap(car.heading + eh);
      for (const p of this.carHist) {
        p.x += ex;
        p.z += ez;
        p.h = (p.h ?? 0) + eh;
      }
      this.carCorr = { x: 0, z: 0, h: 0 };
    } else this.carCorr = { x: ex, z: ez, h: eh };
    // A knock the phone couldn't see (another car, a blast): take the server's speed.
    if (Math.abs(ss - car.speed) > 1.5) car.speed = ss;
  }

  private place(c: Contestant, s: MatchSnap, k: number): void {
    c.x = s.p[k] / 100;
    c.z = s.p[k + 1] / 100;
    c.heading = s.p[k + 2] / 100;
    const hy = s.p[k + 3] / 100;
    c.h = this.match.world.space.floorAt(c.x, c.z, hy + 0.05).h;
    c.y = Math.max(0, hy - c.h);
  }

  /** Compare where the server had us with where we predicted we'd be then. */
  private reconcile(s: MatchSnap): void {
    const me = this.me;
    if (!me || me.status !== "alive" || s.st[me.index] !== "a") return;
    const k = me.index * MSNAP_STRIDE;
    const sx = s.p[k] / 100;
    const sz = s.p[k + 1] / 100;
    if (this.following() || !this.hist.length) {
      this.corrX = sx - me.x;
      this.corrZ = sz - me.z;
      if (this.following()) me.heading = s.p[k + 2] / 100;
      return;
    }
    // The server's state at time s reflects inputs we sent one-way-trip earlier.
    const localThen = s.s - (this.net.serverNow() - performance.now()) - this.net.rtt / 2;
    const h = this.histAt(localThen);
    const ex = sx - h.x;
    const ez = sz - h.z;
    if (Math.hypot(ex, ez) > SNAP_IF_ERROR_M) {
      me.x += ex;
      me.z += ez;
      for (const p of this.hist) {
        p.x += ex;
        p.z += ez;
      }
      this.corrX = this.corrZ = 0;
    } else {
      this.corrX = ex;
      this.corrZ = ez;
    }
  }

  private histAt(t: number): Hist {
    return histAt(this.hist, t);
  }

  /** Everyone else, between the two snapshots either side of `t` (server ms). */
  private interpolate(t: number): void {
    const list = this.snaps;
    if (!list.length) return;
    let a = list[0];
    let b = list[0];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].s <= t) {
        a = list[i];
        b = list[Math.min(list.length - 1, i + 1)];
        break;
      }
    }
    const span = b.s - a.s;
    const u = span > 0 ? Math.max(0, Math.min(1, (t - a.s) / span)) : 1;
    const space = this.match.world.space;
    const m = this.match;
    const mine = this.driving();
    if (this.cars && a.v && b.v) {
      for (const car of this.cars.cars) {
        if (!car || car === mine) continue;
        const k = car.index * CAR_STRIDE;
        if (k + CAR_STRIDE > a.v.length || k + CAR_STRIDE > b.v.length) {
          if (k + CAR_STRIDE <= b.v.length) {
            car.x = b.v[k] / 100;
            car.z = b.v[k + 1] / 100;
            car.heading = b.v[k + 2] / 100;
          }
          continue;
        }
        const was = car.heading;
        car.x = (a.v[k] + (b.v[k] - a.v[k]) * u) / 100;
        car.z = (a.v[k + 1] + (b.v[k + 1] - a.v[k + 1]) * u) / 100;
        const ha = a.v[k + 2] / 100;
        car.heading = wrap(ha + wrap(b.v[k + 2] / 100 - ha) * u);
        car.speed = (a.v[k + 3] + (b.v[k + 3] - a.v[k + 3]) * u) / 100;
        car.turn = span > 0 ? wrap(car.heading - was) * 60 : 0;
        car.h = space.floorAt(car.x, car.z, car.h + 0.3).h;
      }
    }
    for (const c of m.contestants) {
      if (c === this.me || c.status !== "alive" || m.seated(c) || a.st[c.index] !== "a" || b.st[c.index] !== "a") continue;
      const k = c.index * MSNAP_STRIDE;
      const ax = a.p[k] / 100;
      const az = a.p[k + 1] / 100;
      const bx = b.p[k] / 100;
      const bz = b.p[k + 1] / 100;
      const x = ax + (bx - ax) * u;
      const z = az + (bz - az) * u;
      if (span > 0) {
        c.vx = ((bx - ax) * 1000) / span;
        c.vz = ((bz - az) * 1000) / span;
      }
      // A respawn far away: no slide across the map.
      if (Math.hypot(x - c.x, z - c.z) > 12) c.vx = c.vz = 0;
      c.x = x;
      c.z = z;
      const ha = a.p[k + 2] / 100;
      let dh = b.p[k + 2] / 100 - ha;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      c.heading = ha + dh * u;
      const hy = (a.p[k + 3] + (b.p[k + 3] - a.p[k + 3]) * u) / 100;
      c.h = space.floorAt(x, z, hy + 0.05).h;
      c.y = Math.max(0, hy - c.h);
      const fl = unpackFlags(b.p[k + 4]);
      c.stance = fl.stance;
      c.sprinting = fl.sprinting;
      c.stamina = fl.stamina;
      c.stun = fl.stunned ? 0.1 : 0;
      c.slide = fl.sliding ? 0.2 : 0;
    }
  }
}

/** Where a history was at time t (between its samples). */
function histAt(h: readonly Hist[], t: number): Hist {
  if (t <= h[0].t) return h[0];
  for (let i = h.length - 1; i > 0; i--) {
    if (h[i - 1].t <= t) {
      const a = h[i - 1];
      const b = h[i];
      const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      const out: Hist = { t, x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
      if (a.h !== undefined && b.h !== undefined) out.h = a.h + wrap(b.h - a.h) * u;
      return out;
    }
  }
  return h[h.length - 1];
}
