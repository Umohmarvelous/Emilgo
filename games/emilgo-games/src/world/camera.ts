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
//   lobby      slow drift in front of Mama Gele (behind menus over the street)
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
}

/** A box the camera must not pass through (x, z centre and half-sizes, height). */
export interface Collider {
  x: number;
  z: number;
  hx: number;
  hz: number;
  h: number;
}

const MAX_RATE = Math.PI; // 180°/s
const PITCH_MIN = (-60 * Math.PI) / 180;
const PITCH_MAX = (60 * Math.PI) / 180;
const DIST = 2.5;
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
  shakeEnabled = true;
  invertY = false;
  sensH = 0.35;
  sensV = 0.25;
  firstPerson = false;
  /** Set from the screen's shape: wider on tall portrait phones. */
  baseFov = 65;
  colliders: Collider[] = [];
  /** Where Mama stands this round, and the side walls the camera mustn't pass (Infinity: open ground). */
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

  follow(snap = false, target?: Follow): void {
    this.mode = "follow";
    if (snap && target) {
      this.yaw = this.viewYaw = 0;
      this.pitch = this.viewPitch = 0.12;
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

  kick(amount: number): void {
    if (this.shakeEnabled) this.shake = Math.min(1.2, this.shake + amount);
  }

  update(dt: number, target: Follow | null): void {
    this.time += dt;
    this.idle += dt;
    // Smoothing: about 15% of the way each 60th of a second.
    const k = 1 - Math.pow(1 - SMOOTH, dt * 60);
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
      wantFov = this.zoomed(dt, wantFov);
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
      // Lobby: a slow drift in front of Mama Gele, low, so she towers.
      const a = Math.sin(this.time * 0.1) * 0.32;
      this.wantPos.set(Math.sin(a) * 8, 2.2 + Math.sin(this.time * 0.2) * 0.25, this.dollZ + 17 + Math.cos(a) * 1);
      this.wantLook.set(0, 1.9, this.dollZ + 1);
      const kk = 1 - Math.exp(-dt * 1.5);
      this.pos.lerp(this.wantPos, kk);
      this.look.lerp(this.wantLook, kk);
    }
    this.fov += (wantFov - this.fov) * (1 - Math.exp(-dt * 8));

    this.camera.position.copy(this.pos);
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
    this.pivot.set(t.x, eye + (t.y ?? 0) * 0.85, t.z);
    const d = this.lookDir(this.wantLook);
    const rx = Math.cos(this.viewYaw);
    const rz = -Math.sin(this.viewYaw);
    // Collision: shorten the arm if a wall or box is in the way.
    const want = this.clearance(this.pivot, -d.x, -d.y, -d.z, rx, rz);
    this.dist += (want - this.dist) * (want < this.dist ? 1 : 1 - Math.exp(-dt * 4));
    this.wantPos.set(this.pivot.x - d.x * this.dist + rx * SHOULDER, Math.max(0.25, this.pivot.y - d.y * this.dist), this.pivot.z - d.z * this.dist + rz * SHOULDER);
    // Aim straight ahead from the shoulder, so the player sits left of centre.
    this.wantLook.set(this.wantPos.x + d.x * 10, this.wantPos.y + d.y * 10, this.wantPos.z + d.z * 10);
  }

  /** How far back the camera can sit before hitting something (≤ DIST). */
  private clearance(p: Vector3, bx: number, by: number, bz: number, rx: number, rz: number): number {
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
    // Under the ground.
    if (ey < 0) {
      const t = (0.2 - p.y) / ey;
      if (t >= 0 && t < 1) best = Math.min(best, Math.max(0.6, t * DIST));
    }
    // Boxes (slab test in x/z).
    for (const c of this.colliders) {
      if (p.y + ey > c.h && p.y > c.h) continue;
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
