// Camera: Call of Duty's over-the-shoulder view, a first-person view, and the
// catch cinematic.
//
// The brief's numbers: eye height 1.6 m, 2.5 m behind, 0.5 m to the right;
// 65° in third person, 75° in first; pitch −60°…+60°; a calm default rate
// (35% sideways, 25% up/down, of 180°/s), 0.15 smoothing, and NO auto-correct —
// the camera stays where you leave it (a setting brings back the old drift).
// The camera pushes in when a wall is behind you.
//
// Modes:
//   lobby      slow drift down the street (behind the menus)
//   follow     third person behind a contestant (you, or whoever you spectate)
//   first      first person, from the eyes
//   cinematic  swing round to a catch, with shake
//   shot       placed by the match flow's cinema (walkout, field preview, tutorial)

import { PerspectiveCamera, Vector3 } from "three";

import { DOLL_Z, FIELD } from "../config";

export interface Follow {
  x: number;
  z: number;
  /** Jump height. */
  y?: number;
  /** 0 stand, 1 crouch, 2 prone (eye height drops). */
  stance?: number;
  /** The floor's height under them (open worlds: a roof, the stairs). */
  ground?: number;
}

/** A box the camera must not pass through (x, z centre and half-sizes, height; y0 its bottom, 0 if on the ground). */
export interface Collider {
  x: number;
  z: number;
  hx: number;
  hz: number;
  h: number;
  y0?: number;
}

const MAX_RATE = Math.PI; // 180°/s
const PITCH_MIN = (-60 * Math.PI) / 180;
const PITCH_MAX = (60 * Math.PI) / 180;
const DIST = 2.5;
const BASE_DIST = DIST;
const SHOULDER = 0.5;
const EYE = 1.6;
const SMOOTH = 0.15; // per 1/60 s

/** 0 → 1 over the first `inF` of u, 1 → 0 over the last `outF`, eased. */
function ramp(u: number, inF: number, outF: number): number {
  const w = Math.max(0, Math.min(1, u / inF, (1 - u) / outF));
  return w * w * (3 - 2 * w);
}

export class CameraRig {
  /** Where the player is aiming: 0 = looking down −Z, toward the doll. */
  yaw = 0;
  /** + looks down, − looks up. */
  pitch = 0.12;
  /** Shown values chase yaw/pitch (smoothing). */
  private viewYaw = 0;
  private viewPitch = 0.12;
  autoCenter = false;
  /**
   * v6 (the owner: one-thumb portrait "placing the model in the center at all time ... just like Lagos Life"):
   * 1 puts the body in the middle of the view instead of over the shoulder; it eases there (`centreK`).
   */
  centre = 0;
  private centreK = 0;
  /** v6, the COD-style sprint: 0 walking, 0.6 sprinting, 1 in the tactical burst; the view widens and bobs with it. */
  sprint = 0;
  private sprintK = 0;
  shakeEnabled = true;
  invertY = false;
  sensH = 0.35;
  sensV = 0.25;
  firstPerson = false;
  /** Driving (vehicles): the arm this many times longer, the pivot this much higher. */
  arm = 1;
  lift = 0;
  /** Set from the screen's shape: wider on tall portrait phones. */
  baseFov = 65;
  colliders: Collider[] = [];
  /** Open worlds: the boxes near a point (a grid lookup), instead of walking every collider. */
  near: ((x: number, z: number, r: number) => readonly Collider[]) | null = null;
  /** The floor under the followed body (the arm never dips below it). */
  private floor = 0;
  /** Where the finish is this round, and the side walls the camera mustn't pass (Infinity: open ground). */
  dollZ = DOLL_Z;
  wallX = FIELD.halfWidth + 1.4;
  /** First person: where the eyes are (the crowd fills it in each frame). */
  readonly eye = new Vector3();
  eyeValid = false;

  private mode: "lobby" | "follow" | "cinematic" | "shot" = "lobby";
  private readonly pos = new Vector3(0, 6, 16);
  private readonly look = new Vector3(0, 2, -30);
  private readonly wantPos = new Vector3();
  private readonly wantLook = new Vector3();
  private readonly pivot = new Vector3();
  private idle = 10;
  private shake = 0;
  private time = 0;
  private fov = 65;
  private dist = DIST;

  private readonly cineTarget = new Vector3();
  private readonly cineFrom = new Vector3();
  private readonly cineAt = new Vector3();
  private cineT = 0;

  /** The zoom on an offender (SPEC-V2 §2.6 step 2): where, how far in, how long. */
  private readonly zoomAt = new Vector3();
  private zoomT = 0;
  private zoomLen = 0;
  /** The final-two push-in (§2.8): the lens narrows by `pushBy` and comes back. */
  private pushT = 0;
  private pushLen = 0;
  private pushBy = 1;

  constructor(readonly camera: PerspectiveCamera) {
    camera.fov = this.fov;
    camera.position.copy(this.pos);
    camera.lookAt(this.look);
  }

  get current(): "lobby" | "follow" | "cinematic" | "shot" {
    return this.mode;
  }

  /**
   * Where follow() would put the lens behind `target` from a fresh start
   * (behind, level, looking up the field), and its field of view. The
   * walkout's last shot lands here, so the countdown starts without a jump.
   */
  restPose(target: Follow, pos: Vector3, look: Vector3): number {
    this.yaw = this.viewYaw = 0;
    this.pitch = this.viewPitch = 0.12;
    this.dist = DIST;
    this.computeFollow(target, 1);
    pos.copy(this.wantPos);
    look.copy(this.wantLook);
    return this.baseFov;
  }

  /** A cinema frame: the lens exactly here, looking there (a cut, no smoothing). */
  shot(pos: Vector3, look: Vector3, fov: number): void {
    this.mode = "shot";
    this.pos.copy(pos);
    this.look.copy(look);
    this.fov = fov;
  }

  lobby(): void {
    this.mode = "lobby";
  }

  /** `yaw`, `pitch`: which way a snap faces (v6, the kill cam: from the killer towards you). */
  follow(snap = false, target?: Follow, yaw = 0, pitch = 0.12): void {
    this.mode = "follow";
    if (snap && target) {
      this.yaw = this.viewYaw = yaw;
      this.pitch = this.viewPitch = pitch;
      this.idle = 10;
      this.dist = DIST;
      this.computeFollow(target, 1);
      this.pos.copy(this.wantPos);
      this.look.copy(this.wantLook);
    }
  }

  /**
   * Swing round in front of a catch: between the victim and the doll, a little
   * to one side, so they fall AWAY from the lens and you see their face.
   * `away` is the horizontal unit direction from the doll to the victim.
   */
  cinematic(chest: Vector3, away: Vector3): void {
    this.mode = "cinematic";
    this.cineTarget.copy(chest);
    this.cineFrom.copy(this.pos);
    this.cineT = 0;
    const side = chest.x > 0 ? -1 : 1;
    this.cineAt.set(chest.x - away.x * 3.3 - away.z * side * 1.5, chest.y + 0.3, chest.z - away.z * 3.3 + away.x * side * 1.5);
  }

  /** Keep the lens on the falling body. */
  track(target: Vector3): void {
    this.cineTarget.copy(target);
  }

  /**
   * Zoom in on `target` for `seconds`, from where the lens is (a telephoto
   * zoom, the lens doesn't move), then back. Behind a player only.
   */
  zoom(target: Vector3, seconds: number): void {
    this.zoomAt.copy(target);
    this.zoomT = 0;
    this.zoomLen = seconds;
  }

  /** Keep the zoom on the falling body. */
  zoomTrack(target: Vector3): void {
    if (this.zoomLen > 0) this.zoomAt.copy(target);
  }

  get zooming(): boolean {
    return this.zoomLen > 0;
  }

  /** Narrow the lens by `factor` (< 1) and bring it back over `seconds`. */
  push(factor: number, seconds: number): void {
    this.pushBy = factor;
    this.pushT = 0;
    this.pushLen = seconds;
  }

  /** Cancel a zoom or push (a new round, the kill cam). */
  clearZoom(): void {
    this.zoomLen = 0;
    this.pushLen = 0;
  }

  /** Look stick (−1..1 each axis) and mouse drag (px) for this frame. */
  orbit(x: number, y: number, dt: number, mouseX = 0, mouseY = 0): void {
    const moved = Math.abs(x) > 0.02 || Math.abs(y) > 0.02 || mouseX !== 0 || mouseY !== 0;
    if (!moved) return;
    const inv = this.invertY ? -1 : 1;
    this.yaw -= x * MAX_RATE * this.sensH * dt + mouseX * 0.0045 * (this.sensH / 0.35);
    this.pitch -= (y * MAX_RATE * this.sensV * dt - mouseY * 0.0035 * (this.sensV / 0.25)) * inv;
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch));
    this.idle = 0;
  }

  /**
   * The touchpad (v4): turn by exactly this much (radians; x + turns right,
   * y + looks down), already scaled by the thumb's travel and speed. The
   * view follows almost at once (a touchpad mustn't feel like it lags).
   */
  turn(x: number, y: number): void {
    if (!x && !y) return;
    // Down the sights the touchpad is finer.
    const fine = 1 - 0.38 * this.adsK;
    this.yaw -= x * fine;
    this.pitch += y * fine * (this.invertY ? -1 : 1);
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch));
    this.idle = 0;
    this.padAt = this.time;
  }
  private padAt = -1e9;

  /** Guns (v4): aiming down the sights wanted (0/1), its zoom (× the lens), and how far in it is now. */
  adsWant = 0;
  adsZoom = 1;
  private adsK = 0;
  /** Recoil still to come back (radians of pitch). */
  private recoilBack = 0;

  /** Where the crosshair points: the view's yaw and pitch (what a shot follows). */
  get aimYaw(): number {
    return this.viewYaw;
  }
  get aimPitch(): number {
    return this.viewPitch;
  }
  /** The camera's kick now (0 … ~1.2): Max's chromatic aberration follows it. */
  get shakeNow(): number {
    return this.shake;
  }
  /** 0 … 1: how far down the sights. */
  get ads(): number {
    return this.adsK;
  }

  /** A shot's kick: the view jumps up (and a little sideways); about half of it comes back. */
  recoil(up: number, side: number): void {
    this.pitch = Math.max(PITCH_MIN, this.pitch - up);
    this.viewPitch = Math.max(PITCH_MIN, this.viewPitch - up * 0.6);
    this.yaw += side;
    this.recoilBack += up * 0.5;
  }

  kick(amount: number): void {
    if (this.shakeEnabled) this.shake = Math.min(1.2, this.shake + amount);
  }

  update(dt: number, target: Follow | null): void {
    this.time += dt;
    this.idle += dt;
    // Smoothing: about 15% of the way each 60th of a second.
    // Down the sights, and the recoil coming back.
    this.adsK += (this.adsWant - this.adsK) * (1 - Math.exp(-dt * 14));
    if (this.recoilBack > 1e-4) {
      const r = this.recoilBack * (1 - Math.exp(-dt * 9));
      this.recoilBack -= r;
      this.pitch = Math.min(PITCH_MAX, this.pitch + r);
    }
    // The touchpad follows within a frame or two; the stick and keys keep the calm 0.15.
    const k = 1 - Math.pow(1 - (this.time - this.padAt < 0.3 ? 0.6 : SMOOTH), dt * 60);
    let dy = this.yaw - this.viewYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.viewYaw += dy * k;
    this.viewPitch += (this.pitch - this.viewPitch) * k;

    let wantFov = this.baseFov;
    if (this.mode === "follow" && target) {
      if (this.autoCenter && this.idle > 1.1 && !this.firstPerson) {
        // The old drift: ease back behind the player, facing the doll.
        const d = Math.atan2(Math.sin(-this.yaw), Math.cos(-this.yaw));
        this.yaw += d * (1 - Math.exp(-dt * 2.2));
        this.pitch += (0.12 - this.pitch) * (1 - Math.exp(-dt * 2.2));
      }
      if (this.firstPerson && this.eyeValid) {
        wantFov = this.baseFov + 10;
        this.pos.copy(this.eye);
        this.lookDir(this.wantLook).multiplyScalar(10).add(this.eye);
        this.look.copy(this.wantLook);
      } else {
        this.computeFollow(target, dt);
        // Position: tight follow (the smoothing lives in the angles).
        this.pos.lerp(this.wantPos, 1 - Math.exp(-dt * 18));
        this.look.copy(this.wantLook);
      }
      wantFov = this.zoomed(dt, wantFov) * (1 + (this.adsZoom - 1) * this.adsK);
      this.sprintK += (this.sprint - this.sprintK) * (1 - Math.exp(-dt * (this.sprint > this.sprintK ? 6 : 3)));
      if (!this.firstPerson) wantFov *= 1 + 0.11 * this.sprintK * (1 - this.adsK);
    } else if (this.mode === "shot") {
      wantFov = this.fov;
    } else if (this.mode === "cinematic") {
      this.cineT += dt;
      const t = Math.min(1, this.cineT / 0.6);
      const e = 1 - Math.pow(1 - t, 3);
      this.pos.lerpVectors(this.cineFrom, this.cineAt, e);
      this.look.lerp(this.cineTarget, 1 - Math.exp(-dt * 14));
      wantFov = this.baseFov * 0.62;
    } else {
      // Lobby: a slow, low drift down the street.
      const a = Math.sin(this.time * 0.1) * 0.32;
      this.wantPos.set(Math.sin(a) * 8, 2.2 + Math.sin(this.time * 0.2) * 0.25, this.dollZ + 17 + Math.cos(a) * 1);
      this.wantLook.set(0, 1.9, this.dollZ + 1);
      const kk = 1 - Math.exp(-dt * 1.5);
      this.pos.lerp(this.wantPos, kk);
      this.look.lerp(this.wantLook, kk);
    }
    this.fov += (wantFov - this.fov) * (1 - Math.exp(-dt * 8));

    this.camera.position.copy(this.pos);
    // v6: a runner's bob at a sprint (stride-timed), stronger in the tactical burst.
    if (this.sprintK > 0.02 && this.mode === "follow" && !this.firstPerson) this.camera.position.y += Math.sin(this.time * 12.5) * 0.03 * this.sprintK;
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.35;
      this.camera.position.x += (Math.sin(this.time * 61) + Math.sin(this.time * 37)) * 0.5 * s;
      this.camera.position.y += (Math.sin(this.time * 53) + Math.sin(this.time * 29)) * 0.5 * s;
      this.shake *= Math.exp(-dt * 5);
    }
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** The zoom and the push on top of the follow view: the look and the field of view this frame. */
  private zoomed(dt: number, fov: number): number {
    if (this.pushLen > 0) {
      this.pushT += dt;
      const u = this.pushT / this.pushLen;
      if (u >= 1) this.pushLen = 0;
      else fov *= 1 + (this.pushBy - 1) * ramp(u, 0.25, 0.3);
    }
    if (this.zoomLen > 0) {
      this.zoomT += dt;
      const u = this.zoomT / this.zoomLen;
      if (u >= 1) {
        this.zoomLen = 0;
      } else {
        const w = ramp(u, 0.2, 0.25);
        this.look.lerp(this.zoomAt, w);
        // Narrow enough that they fill about a third of the screen's height.
        const d = Math.max(1, this.pos.distanceTo(this.zoomAt));
        const tight = Math.max(6, Math.min(fov * 0.6, (2 * Math.atan(1.7 / d) * 180) / Math.PI));
        fov += (tight - fov) * w;
      }
    }
    return fov;
  }

  /** Unit view direction from the smoothed angles. */
  private lookDir(out: Vector3): Vector3 {
    const cp = Math.cos(this.viewPitch);
    return out.set(-Math.sin(this.viewYaw) * cp, -Math.sin(this.viewPitch), -Math.cos(this.viewYaw) * cp);
  }

  private computeFollow(t: Follow, dt: number): void {
    const stance = t.stance ?? 0;
    const eye = stance >= 1.5 ? 0.45 : stance >= 0.5 ? 1.05 : EYE;
    this.floor = t.ground ?? 0;
    this.pivot.set(t.x, this.floor + eye + (t.y ?? 0) * 0.85 + this.lift, t.z);
    const d = this.lookDir(this.wantLook);
    const rx = Math.cos(this.viewYaw);
    const rz = -Math.sin(this.viewYaw);
    // Collision: shorten the arm if a wall or box is in the way.
    const want = this.clearance(this.pivot, -d.x, -d.y, -d.z, rx, rz);
    this.dist += (want - this.dist) * (want < this.dist ? 1 : 1 - Math.exp(-dt * 4));
    // Down the sights: closer in over the shoulder.
    const dist = this.dist * (1 - 0.42 * this.adsK);
    this.centreK += (this.centre - this.centreK) * (1 - Math.exp(-dt * 5));
    const sh = SHOULDER * (1 - this.centreK) + 0.12 * this.adsK;
    this.wantPos.set(this.pivot.x - d.x * dist + rx * sh, Math.max(this.floor + 0.25, this.pivot.y - d.y * dist), this.pivot.z - d.z * dist + rz * sh);
    // Aim straight ahead from the shoulder, so the player sits left of centre.
    this.wantLook.set(this.wantPos.x + d.x * 10, this.wantPos.y + d.y * 10, this.wantPos.z + d.z * 10);
  }

  /** How far back the camera can sit before hitting something (≤ DIST). */
  private clearance(p: Vector3, bx: number, by: number, bz: number, rx: number, rz: number): number {
    const DIST = BASE_DIST * this.arm;
    let best = DIST;
    // Ray from the pivot to the camera spot (back along the view, plus the shoulder).
    const ex = bx * DIST + rx * SHOULDER;
    const ez = bz * DIST + rz * SHOULDER;
    const ey = by * DIST;
    // The street's walls.
    const wall = this.wallX;
    for (const side of [1, -1]) {
      const vx = ex * side;
      if (vx <= 1e-6) continue;
      const t = (wall - p.x * side) / vx;
      if (t >= 0 && t < 1) best = Math.min(best, Math.max(0.6, t * DIST - 0.25));
    }
    // Under the ground (or the floor you stand on).
    if (ey < 0) {
      const t = (this.floor + 0.2 - p.y) / ey;
      if (t >= 0 && t < 1) best = Math.min(best, Math.max(0.6, t * DIST));
    }
    // Boxes (slab test in x/z): the open worlds hand over only the ones nearby.
    for (const c of this.near ? this.near(p.x, p.z, DIST + SHOULDER + 1) : this.colliders) {
      if (p.y + ey > c.h && p.y > c.h) continue;
      if (c.y0 !== undefined && p.y + ey < c.y0 && p.y < c.y0) continue;
      let t0 = 0;
      let t1 = 1;
      for (const [o, v, lo, hi] of [
        [p.x, ex, c.x - c.hx, c.x + c.hx],
        [p.z, ez, c.z - c.hz, c.z + c.hz],
      ] as const) {
        if (Math.abs(v) < 1e-9) {
          if (o < lo || o > hi) {
            t0 = 2;
            break;
          }
          continue;
        }
        let a = (lo - o) / v;
        let b = (hi - o) / v;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      if (t0 <= t1 && t0 < 1) best = Math.min(best, Math.max(0.6, t0 * DIST - 0.25));
    }
    return best;
  }
}
