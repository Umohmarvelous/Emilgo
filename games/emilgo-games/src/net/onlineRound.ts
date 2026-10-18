// An online round, seen from one player's phone. It implements the same
// RoundView as the local referee, so the session drives practice and online
// play with the same code.
//
//   You           PREDICTED: your stick moves your runner at once, with the
//                 referee's own movement code (moveContestant). Each snapshot
//                 says where the server really had you; the gap is closed
//                 smoothly, and snapped only if it is large.
//   Everyone else INTERPOLATED: drawn NET.interpDelayMs in the past, between
//                 two snapshots, so they move smoothly however the network jitters.
//   Who is out    ONLY the server decides. Phase changes, catches and finishes
//                 arrive as events and are passed to the session as-is.

import { ATTACK, ATTACK_KINDS, FIELD, MOVE, NET, RULES, courseFor, type Course } from "../config";
import type { Stance } from "../config";
import { placeBaskets, type Ball, type Basket } from "../game/balls";
import { freshMotion, moveContestant, prePlay, type Contestant, type Phase, type RoundEvent, type RoundView } from "../game/rules";
import type { NetClient } from "./client";
import { BALL_STRIDE, CAUSES, OUTCOME_STRIDE, SNAP_STRIDE, cleanDist, cleanMode, phaseAt, unpackFlags, type ServerMsg, type SnapMsg, type StartInfo, type SyncInfo } from "./protocol";

const SNAP_KEEP = 24; // ~1.6 s of history
const HIST_KEEP_MS = 1500;
const SNAP_IF_ERROR_M = 2.0;

interface Hist {
  t: number;
  x: number;
  z: number;
}

export class OnlineRound implements RoundView {
  phase: Phase = "countdown";
  phaseTime = 0;
  phaseDuration: number = RULES.countdown;
  elapsed = 0;
  readonly contestants: Contestant[];
  readonly seed: number;
  readonly course: Course;
  readonly balls: Ball[];
  readonly baskets: Basket[];

  private readonly byId = new Map<string, Contestant>();
  private events: RoundEvent[] = [];
  private readonly snaps: SnapMsg[] = [];
  private readonly me: Contestant | null;
  private readonly hist: Hist[] = [];
  private corrX = 0;
  private corrZ = 0;
  private readonly off: () => void;

  constructor(
    start: StartInfo,
    readonly myId: string,
    private readonly net: NetClient,
  ) {
    this.seed = start.seed;
    this.course = courseFor(cleanMode(start.mode), cleanDist(start.dist), start.hw ? start.hw / 100 : undefined);
    const bp = start.bp ?? [];
    this.balls = Array.from({ length: Math.floor(bp.length / 2) }, (_, i) => ({ index: i, x: bp[i * 2] / 100, z: bp[i * 2 + 1] / 100, holder: -1, basket: -1, noGrab: -1, waitUntil: 0 }));
    this.baskets = this.course.mode === "balls" ? placeBaskets(this.course) : [];
    this.contestants = start.roster.map((r, index) => {
      const c: Contestant = {
        id: r.id,
        name: r.name,
        bot: false,
        index,
        x: start.init[index * 3] / 100,
        z: start.init[index * 3 + 1] / 100,
        vx: 0,
        vz: 0,
        heading: start.init[index * 3 + 2] / 1000,
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
      };
      this.byId.set(r.id, c);
      return c;
    });
    this.me = this.byId.get(myId) ?? null;
    // Rounds open on the walkout (its "ph" event follows within a tick).
    if (start.wo) {
      this.phase = "walkout";
      this.phaseDuration = start.wo / 1000;
    }
    this.off = net.on((m) => this.receive(m));
  }

  /** A round we (re)joined mid-way: build it, then catch up from the server's state. */
  static fromSync(sync: SyncInfo, myId: string, net: NetClient): OnlineRound {
    const r = new OnlineRound(sync, myId, net);
    r.applySync(sync);
    return r;
  }

  dispose(): void {
    this.off();
  }

  get timeLeft(): number {
    return Math.max(0, this.course.timeLimit - this.elapsed);
  }

  get aliveCount(): number {
    let n = 0;
    for (const c of this.contestants) if (c.status === "alive") n++;
    return n;
  }

  get(id: string): Contestant | undefined {
    return this.byId.get(id);
  }

  setInput(id: string, x: number, z: number): void {
    const me = this.me;
    if (!me || id !== me.id) return;
    const len = Math.hypot(x, z);
    if (!isFinite(len)) return;
    const k = len > 1 ? 1 / len : 1;
    me.inX = x * k;
    me.inZ = z * k;
    this.net.setInput(me.inX, me.inZ);
  }

  setButtons(id: string, sprint: boolean, stance: Stance, jump: number): void {
    const me = this.me;
    if (!me || id !== me.id) return;
    me.inSprint = sprint;
    me.inStance = stance;
    me.inJump = jump & 255;
    this.net.setButtons(sprint, stance, me.inJump);
  }

  setActions(id: string, attack: number, grab: number): void {
    const me = this.me;
    if (!me || id !== me.id) return;
    me.inAttack = attack & 255;
    me.inGrab = grab & 255;
    this.net.setActions(me.inAttack, me.inGrab);
  }

  /**
   * Events since the last drain. Runs of phase changes collapse to the latest:
   * after a stall (app in the background) the session should hear "she is
   * watching", not replay a minute of turns.
   */
  drain(): RoundEvent[] {
    const out: RoundEvent[] = [];
    for (const e of this.events) {
      const prev = out[out.length - 1];
      if (e.type === "phase" && prev?.type === "phase") out[out.length - 1] = e;
      else out.push(e);
    }
    this.events = [];
    return out;
  }

  step(dt: number): void {
    if (this.phase !== "ended") {
      this.phaseTime += dt;
      if (!prePlay(this.phase)) this.elapsed += dt;
    }

    const me = this.me;
    if (me && me.status !== "eliminated" && !prePlay(this.phase)) {
      // Disconnected, the server holds you still — so the screen does too.
      // Your stick comes back to life when the connection does.
      if (this.net.state !== "open") me.inX = me.inZ = 0;
      moveContestant(me, dt, this.course);
      // Close the gap to the server smoothly (about 90% in a quarter second).
      const k = 1 - Math.exp(-dt * 9);
      const dx = this.corrX * k;
      const dz = this.corrZ * k;
      me.x += dx;
      me.z += dz;
      this.corrX -= dx;
      this.corrZ -= dz;
      // History moves with the correction, so the next comparison isn't double-counted.
      for (const h of this.hist) {
        h.x += dx;
        h.z += dz;
      }
      const t = performance.now();
      this.hist.push({ t, x: me.x, z: me.z });
      while (this.hist.length && t - this.hist[0].t > HIST_KEEP_MS) this.hist.shift();
    }

    this.interpolate(this.net.serverNow() - NET.interpDelayMs);
  }

  // ── Network ────────────────────────────────────────────────────────────────

  private receive(m: ServerMsg): void {
    switch (m.t) {
      case "snap":
        this.onSnap(m);
        break;
      case "ev":
        this.onEvent(m);
        break;
      case "sync":
        if (m.sync.seed === this.seed) this.applySync(m.sync);
        break;
      default:
        break;
    }
  }

  private onSnap(s: SnapMsg): void {
    this.snaps.push(s);
    if (this.snaps.length > SNAP_KEEP) this.snaps.shift();

    // Missed a phase change (only after a reconnect): take the server's word.
    const ph = phaseAt(s.ph);
    if (ph !== this.phase && ph !== "ended" && this.phase !== "ended") {
      this.phase = ph;
      this.phaseDuration = s.pd / 1000;
      this.phaseTime = s.pt / 1000;
      this.events.push({ type: "phase", phase: ph, duration: this.phaseDuration });
    }
    const serverElapsed = s.el / 1000;
    if (Math.abs(serverElapsed - this.elapsed) > 0.5) this.elapsed = serverElapsed;

    this.reconcile(s);
    if (s.b) this.applyBalls(s.b);
  }

  /** Balls as the server has them; who holds what follows from that. */
  private applyBalls(b: number[]): void {
    for (const c of this.contestants) c.ball = -1;
    for (const ball of this.balls) {
      const o = ball.index * BALL_STRIDE;
      if (o + 2 >= b.length) break;
      ball.x = b[o] / 100;
      ball.z = b[o + 1] / 100;
      const h = b[o + 2];
      ball.holder = h > 0 ? h - 1 : -1;
      ball.basket = h < 0 ? -h - 1 : -1;
      if (ball.holder >= 0 && this.contestants[ball.holder]) this.contestants[ball.holder].ball = ball.index;
    }
  }

  /** The server says someone slid (hit or shoved): if it's us, slide now, as the referee will have us. */
  private slide(c: Contestant, kx: number, kz: number, stun: number): void {
    if (c !== this.me) return;
    c.vx = kx / 100;
    c.vz = kz / 100;
    c.sprinting = false;
    c.stun = Math.max(c.stun, stun, Math.hypot(c.vx, c.vz) / MOVE.decel);
    c.forgive = c.stun + ATTACK.forgive;
  }

  /** Compare where the server had us with where we predicted we'd be then. */
  private reconcile(s: SnapMsg): void {
    const me = this.me;
    if (!me || me.status === "eliminated" || !this.hist.length) return;
    const o = me.index * SNAP_STRIDE;
    const sx = s.p[o] / 100;
    const sz = s.p[o + 1] / 100;
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
    // Stamina is the server's to keep; ours drifts only by a frame or two.
    me.stamina = unpackFlags(s.p[o + 4]).stamina;
  }

  private histAt(t: number): Hist {
    const h = this.hist;
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= t) {
        const a = h[i - 1];
        const b = h[i];
        const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return { t, x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
      }
    }
    return h[h.length - 1];
  }

  private onEvent(m: Extract<ServerMsg, { t: "ev" }>): void {
    switch (m.k) {
      case "ph": {
        const ph = phaseAt(m.ph);
        this.phase = ph;
        this.phaseTime = 0;
        this.phaseDuration = m.d / 1000;
        this.events.push({ type: "phase", phase: ph, duration: this.phaseDuration });
        break;
      }
      case "out": {
        const c = this.contestants[m.i];
        if (!c || c.status === "eliminated") return;
        c.status = "eliminated";
        c.cause = CAUSES[m.c] ?? "moved";
        c.eliminatedAt = this.elapsed;
        // Fall where the server caught them, not where we happened to draw them.
        c.x = m.x / 100;
        c.z = m.z / 100;
        c.vx = c.vz = 0;
        c.inX = c.inZ = 0;
        this.events.push({ type: "eliminated", id: c.id, cause: c.cause });
        break;
      }
      case "fin": {
        const c = this.contestants[m.i];
        if (!c || c.status !== "alive") return;
        c.status = "finished";
        c.finishTime = m.time / 1000;
        c.place = m.place;
        this.events.push({ type: "finished", id: c.id, time: c.finishTime, place: c.place });
        break;
      }
      case "end":
        this.phase = "ended";
        this.events.push({ type: "ended" });
        break;
      case "atk": {
        const c = this.contestants[m.i];
        const kind = ATTACK_KINDS[m.kind - 1];
        if (!c || !kind) return;
        const tg = m.tg >= 0 ? this.contestants[m.tg] : undefined;
        if (tg) this.slide(tg, m.kx ?? 0, m.kz ?? 0, ATTACK.kinds[kind].stun);
        // Our own swing: the button cools down as the referee's does.
        if (c === this.me) c.cool = ATTACK.kinds[kind].cooldown;
        if (m.db >= 0 && tg) tg.ball = -1;
        this.events.push({ type: "attack", id: c.id, kind, target: tg?.id ?? null, dropped: m.db });
        break;
      }
      case "grb": {
        const c = this.contestants[m.i];
        const ball = this.balls[m.b];
        if (!c || !ball) return;
        ball.holder = c.index;
        c.ball = ball.index;
        this.events.push({ type: "grab", id: c.id, ball: ball.index });
        break;
      }
      case "drp": {
        const ball = this.balls[m.b];
        if (!ball) return;
        if (ball.holder >= 0 && this.contestants[ball.holder]?.ball === ball.index) this.contestants[ball.holder].ball = -1;
        ball.holder = -1;
        ball.x = m.x / 100;
        ball.z = m.z / 100;
        this.events.push({ type: "drop", ball: ball.index, x: ball.x, z: ball.z });
        break;
      }
      case "bnk": {
        const c = this.contestants[m.i];
        const ball = this.balls[m.b];
        if (!c || !ball) return;
        ball.basket = m.bk;
        ball.holder = -1;
        c.ball = -1;
        this.events.push({ type: "bank", id: c.id, ball: ball.index, basket: m.bk });
        break;
      }
    }
  }

  private applySync(sync: SyncInfo): void {
    const s = sync.snap;
    this.phase = phaseAt(s.ph);
    this.phaseTime = s.pt / 1000;
    this.phaseDuration = s.pd / 1000;
    this.elapsed = s.el / 1000;
    this.events.push({ type: "phase", phase: this.phase, duration: this.phaseDuration });
    for (const c of this.contestants) {
      const o = c.index * SNAP_STRIDE;
      c.x = s.p[o] / 100;
      c.z = s.p[o + 1] / 100;
      c.vx = c.vz = 0;
      c.heading = s.p[o + 2] / 1000;
      c.y = s.p[o + 3] / 100;
      const fl = unpackFlags(s.p[o + 4]);
      c.stance = fl.stance;
      c.stamina = fl.stamina;
      const [place, finMs, outMs, cause, progress] = sync.outcomes.slice(c.index * OUTCOME_STRIDE, (c.index + 1) * OUTCOME_STRIDE);
      c.progress = Math.max(c.progress, (progress ?? 0) / 100);
      const st = s.st[c.index];
      if (st === "e" && c.status !== "eliminated") {
        c.status = "eliminated";
        c.cause = cause === 3 ? "noball" : cause === 2 ? "time" : "moved";
        c.eliminatedAt = outMs / 1000;
        this.events.push({ type: "eliminated", id: c.id, cause: c.cause });
      } else if (st === "f" && c.status === "alive") {
        c.status = "finished";
        c.place = place;
        c.finishTime = finMs / 1000;
        this.events.push({ type: "finished", id: c.id, time: c.finishTime, place });
      }
    }
    if (s.b) this.applyBalls(s.b);
    this.hist.length = 0;
    this.corrX = this.corrZ = 0;
    this.snaps.length = 0;
    this.snaps.push(s);
  }

  /** Everyone but you, drawn at server time `t`, between the two snapshots around it. */
  private interpolate(t: number): void {
    const snaps = this.snaps;
    if (!snaps.length) return;
    let a = snaps[0];
    let b = snaps[0];
    if (t >= snaps[snaps.length - 1].s) {
      a = b = snaps[snaps.length - 1];
    } else {
      for (let i = snaps.length - 1; i > 0; i--) {
        if (snaps[i - 1].s <= t) {
          a = snaps[i - 1];
          b = snaps[i];
          break;
        }
      }
    }
    const span = b.s - a.s;
    const u = span > 0 ? Math.max(0, Math.min(1, (t - a.s) / span)) : 1;
    // Past the newest snapshot: extrapolate a little on velocity, never far.
    const ahead = t > b.s ? Math.min(0.1, (t - b.s) / 1000) : 0;
    // Velocity from the two snapshots around us (or the last two): the server doesn't send it.
    const n = snaps.length;
    const v0 = a !== b ? a : n > 1 ? snaps[n - 2] : null;
    const v1 = a !== b ? b : snaps[n - 1];
    const vdt = v0 ? (v1.s - v0.s) / 1000 : 0;

    for (const c of this.contestants) {
      if (c === this.me || c.status === "eliminated") continue;
      const o = c.index * SNAP_STRIDE;
      const ax = a.p[o] / 100;
      const az = a.p[o + 1] / 100;
      const bx = b.p[o] / 100;
      const bz = b.p[o + 1] / 100;
      if (v0 && vdt > 0) {
        c.vx = (v1.p[o] - v0.p[o]) / 100 / vdt;
        c.vz = (v1.p[o + 1] - v0.p[o + 1]) / 100 / vdt;
      } else {
        c.vx = c.vz = 0;
      }
      c.x = ax + (bx - ax) * u + c.vx * ahead;
      c.z = az + (bz - az) * u + c.vz * ahead;
      const ha = a.p[o + 2] / 1000;
      const hb = b.p[o + 2] / 1000;
      const dh = Math.atan2(Math.sin(hb - ha), Math.cos(hb - ha));
      c.heading = ha + dh * u;
      c.progress = Math.max(c.progress, FIELD.startZ - c.z);
      c.y = Math.max(0, (a.p[o + 3] + (b.p[o + 3] - a.p[o + 3]) * u) / 100);
      const fl = unpackFlags(b.p[o + 4]);
      c.stance = fl.stance;
      c.sprinting = fl.sprinting;
      // Stagger and swings come as events; the snapshot keeps the stagger honest.
      c.stun = fl.stunned ? 0.1 : 0;
      c.slide = fl.sliding ? 0.1 : 0;
    }
  }
}
