// Plays a recorded clip (game/replay.ts) on the real field: the kill cam and
// the play of the game (SPEC-V2 §2.7, §2.9).
//
// The replay borrows the bodies, Mama and the balls. Everyone is put back as
// they were at the clip's first frame (the fallen stand up again, those who
// fell before it lie where they fell), then driven frame by frame: people
// fall, cheer, swing and pick up again as they did, Mama turns as she did and
// her beam fires again. The live round carries on underneath (online it
// can't wait); when the clip ends every body is given back to it — anyone who
// was caught live meanwhile is lying down.
//
// The camera is the caller's: a function from the clip's moment to a lens.

import { Vector3 } from "three";

import { ACT_CODES } from "../game/combat";
import { freshMotion, type Contestant } from "../game/rules";
import { REPLAY, ballAt, frameHead, runnerAt, runnerStatus, type Clip, type DollPose } from "../game/replay";
import type { Ball } from "../game/balls";
import type { Crowd } from "../world/crowd";
import type { Doll } from "../world/doll";
import type { Effects } from "../world/fx";
import type { AnimState } from "../world/human/animator";
import type { PropsView } from "../world/props";

/** How fast the clip plays at u (0 … 1 of the way through): 1 = as recorded. */
export type Speed = (u: number) => number;

/** Where the lens is at this moment of the clip; returns the field of view. */
export type ReplayCamera = (pos: Vector3, look: Vector3, at: ReplayMoment) => number;

export interface ReplayMoment {
  /** 0 … 1 of the way through. */
  u: number;
  /** Seconds of play, as recorded. */
  t: number;
  /** The runners as they are in the clip right now. */
  people: readonly Contestant[];
  doll: Doll;
}

const _a = new Vector3();
const _away = new Vector3();
const _eyeL = new Vector3();
const _eyeR = new Vector3();

export class ReplayView {
  private clip: Clip | null = null;
  private head = 0;
  private speed: Speed = () => 1;
  private cam: ReplayCamera | null = null;
  private saved: (AnimState | null)[] = [];
  private people: Contestant[] = [];
  private balls: Ball[] = [];
  private status: Contestant["status"][] = [];
  private acts: number[] = [];
  private readonly dollPose: DollPose = { yaw: Math.PI, head: 0, watching: false };
  private dollZ = 0;

  constructor(
    private readonly crowd: Crowd,
    private readonly doll: Doll,
    private readonly props: PropsView,
    private readonly fx: Effects,
  ) {}

  get active(): boolean {
    return this.clip !== null;
  }

  /** 0 … 1 of the way through (1 when not playing). */
  get progress(): number {
    return this.clip ? Math.min(1, this.head / (this.clip.count - 1)) : 1;
  }

  start(clip: Clip, dollZ: number, cam: ReplayCamera, speed: Speed = () => 1): void {
    this.stop();
    this.clip = clip;
    this.dollZ = dollZ;
    this.cam = cam;
    this.speed = speed;
    this.head = 0;
    this.saved = this.crowd.saveAnims();
    this.people = Array.from({ length: clip.people }, (_, index): Contestant => ({
      id: `replay${index}`,
      name: "",
      bot: true,
      index,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      heading: Math.PI,
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
    this.balls = Array.from({ length: clip.balls }, (_, index): Ball => ({ index, x: 0, z: 0, holder: -1, basket: -1, noGrab: -1, waitUntil: 0 }));
    this.fill(0);
    // Everyone as they were at the first frame.
    for (const c of this.people) {
      const a = this.crowd.anim(c.index);
      if (!a) continue;
      a.dead = c.status === "eliminated" ? 6 : -1;
      a.fall = c.status === "eliminated" ? 1 : 0;
      if (c.status === "eliminated") a.fallDir = Math.atan2(c.x, c.z - dollZ) - c.heading;
      a.done = c.status === "finished" ? 6 : -1;
      a.action = null;
      a.emote = null;
      a.hitT = 0;
    }
    this.status = this.people.map((c) => c.status);
    this.acts = this.people.map(() => 0);
  }

  /**
   * One frame of the replay. Returns false once it has ended (and has given
   * everything back to `live`).
   */
  update(frameDt: number, live: readonly Contestant[], camPos: Vector3, outPos: Vector3, outLook: Vector3): { fov: number; done: boolean } {
    const clip = this.clip;
    if (!clip || !this.cam) return { fov: 0, done: true };
    const u = this.progress;
    const k = this.speed(u);
    this.head = Math.min(clip.count - 1, this.head + frameDt * REPLAY.hz * k);
    this.fill(this.head);
    this.events();
    // Bodies, Mama and the balls, at the clip's own pace (slow motion slows them).
    const dt = frameDt * k;
    this.crowd.update(dt, this.people, camPos);
    for (const c of this.people) this.crowd.setCarry(c.index, c.ball >= 0 && c.status !== "eliminated");
    this.doll.show(this.dollPose);
    this.doll.update(dt);
    if (this.balls.length) this.props.update(dt, this.balls, (h, out) => this.crowd.hands(h, out));
    this.fx.update(dt);
    const fov = this.cam(outPos, outLook, { u: this.progress, t: frameHead(clip, Math.floor(this.head)).t, people: this.people, doll: this.doll });
    const done = this.head >= clip.count - 1;
    if (done) this.stop(live);
    return { fov, done };
  }

  /** End now; every body back to the live round (`live`: who is down there now). */
  stop(live?: readonly Contestant[]): void {
    if (!this.clip) return;
    this.clip = null;
    this.doll.show(null);
    this.crowd.loadAnims(this.saved);
    if (live) {
      for (const c of live) {
        const a = this.crowd.anim(c.index);
        if (!a) continue;
        // Caught live while the replay played: lying where they fell.
        if (c.status === "eliminated" && a.dead < 0) {
          a.dead = 6;
          a.fall = 1;
          a.fallDir = Math.atan2(c.x, c.z - this.dollZ) - c.heading;
        }
        if (c.status === "finished" && a.done < 0) a.done = 6;
      }
    }
    this.saved = [];
  }

  /** The runners, balls and Mama at (fractional) frame `f`. */
  private fill(f: number): void {
    const clip = this.clip!;
    const f0 = Math.floor(f);
    const f1 = Math.min(clip.count - 1, f0 + 1);
    const w = f - f0;
    const d = clip.data;
    for (const c of this.people) {
      const a = runnerAt(clip, f0, c.index);
      const b = runnerAt(clip, f1, c.index);
      c.x = d[a] + (d[b] - d[a]) * w;
      c.z = d[a + 1] + (d[b + 1] - d[a + 1]) * w;
      c.y = Math.max(0, d[a + 2] + (d[b + 2] - d[a + 2]) * w);
      const dh = Math.atan2(Math.sin(d[b + 3] - d[a + 3]), Math.cos(d[b + 3] - d[a + 3]));
      c.heading = d[a + 3] + dh * w;
      c.vx = d[a + 4] + (d[b + 4] - d[a + 4]) * w;
      c.vz = d[a + 5] + (d[b + 5] - d[a + 5]) * w;
      c.stance = Math.round(d[a + 6]) as Contestant["stance"];
      const flags = d[a + 7];
      c.status = runnerStatus(flags);
      c.slide = flags & 4 ? 0.1 : 0;
      c.actKind = ACT_CODES[(flags >> 3) & 7] ?? "";
      c.stun = flags & 64 ? 0.1 : 0;
      c.ball = d[a + 8];
      if (c.status === "eliminated") c.vx = c.vz = 0;
    }
    for (const ball of this.balls) {
      const a = ballAt(clip, f0, ball.index);
      const b = ballAt(clip, f1, ball.index);
      ball.x = d[a] + (d[b] - d[a]) * w;
      ball.z = d[a + 1] + (d[b + 1] - d[a + 1]) * w;
      const h = d[a + 2];
      ball.holder = h > 0 ? h - 1 : -1;
      ball.basket = h < 0 ? -h - 1 : -1;
    }
    const h0 = frameHead(clip, f0);
    const h1 = frameHead(clip, f1);
    const dy = h1.doll.yaw - h0.doll.yaw;
    this.dollPose.yaw = h0.doll.yaw + Math.atan2(Math.sin(dy), Math.cos(dy)) * w;
    this.dollPose.head = h0.doll.head + (h1.doll.head - h0.doll.head) * w;
    this.dollPose.watching = h0.doll.watching;
  }

  /** What changed since the last frame: falls (with her beam), finishes, swings, pick-ups. */
  private events(): void {
    for (const c of this.people) {
      const i = c.index;
      const a = this.crowd.anim(i);
      const was = this.status[i];
      if (c.status !== was) {
        this.status[i] = c.status;
        if (c.status === "eliminated") {
          this.crowd.kill(i, c, 0, this.dollZ);
          // Caught by Mama (she was looking): her head snaps, the beam, the blood again.
          if (this.dollPose.watching) {
            this.crowd.chest(c, _a);
            _away.set(c.x, 0, c.z - this.dollZ).normalize();
            this.doll.caught(c.x, c.z);
            this.doll.eyes(_eyeL, _eyeR);
            this.fx.beam(_eyeL, _eyeR, _a);
            this.fx.burst(_a, _away, 22, false);
          }
        } else if (c.status === "finished") {
          this.crowd.finish(i);
        }
      }
      // A live catch can't knock someone down in the middle of the replay.
      if (a && c.status === "alive" && a.dead >= 0) {
        a.dead = -1;
        a.fall = 0;
      }
      const act = ACT_CODES.indexOf(c.actKind as (typeof ACT_CODES)[number]);
      if (act > 0 && this.acts[i] === 0) this.crowd.act(i, ACT_CODES[act] as "fist" | "slap" | "push" | "grab");
      this.acts[i] = act;
    }
  }
}
