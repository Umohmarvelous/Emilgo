// The doll — the watcher.
//
// A giant schoolgirl doll (the owner's choice, 17 Oct 2026), built by the same
// generator as the players (world/human) so she is just as smooth: a black bob
// with bangs and two pigtails, big round glassy eyes, rosy cheeks, a white
// collared shirt under a green pinafore, white knee socks, black shoes — about
// 9 m tall on her stage. Our own design in our own colours: deliberately NOT
// the doll from the TV show (no orange pinafore, no yellow top, not its face —
// Vatar Developer Agreement §3.3: we must own everything in the game).
//
// The body turns as one; the head leads it round, snaps toward whoever moved,
// and tilts from side to side while she sings. Her eyes glow red while she
// watches and flash on a catch (two small glows on the head bone).

import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, type MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from "three";

import { DOLL_Z } from "../config";
import type { DollPose } from "../game/replay";
import { Human } from "./human";
import { FACE } from "./human/mesh";
import { PROPORTIONS, restPositions } from "./human/skeleton";
import { DOLL_LOOK } from "./human/wardrobe";

const SIZE = 6.6; // × a 1.7 m person: about 12 m with her doll's head
const HEAD = 1.28; // a doll's head is big for her body
const STAGE_TOP = 0.5;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const X = new Vector3(1, 0, 0);
const _q = new Quaternion();
const _q2 = new Quaternion();

export class Doll {
  readonly root = new Group();
  private readonly human: Human;
  private readonly head;
  private readonly glowMat = new MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false });
  private readonly glows: Mesh[] = [];
  /** Eye centres in the head bone's space. */
  private readonly eyeLocal: Vector3[];

  private yaw = Math.PI; // facing the wall
  private turnFrom = Math.PI;
  private turnTo = Math.PI;
  private turnT = 1;
  private turnDur = 0.5;
  /** How far ahead of the body the head turns (bigger: the head snaps round first). */
  private headLead = 1.35;
  /** Seconds since the last snap toward an offender (the jerk's overshoot). */
  private snapAge = 9;
  /** A replay's pose, drawn instead of her live one. */
  private shown: DollPose | null = null;

  private singing = false;
  private watching = false;
  private glow = 0; // 0..1 red glow
  private flash = 0; // white-hot flash on a catch
  private snapYaw = 0; // head turned toward the offender
  private snapHold = 0;
  private headYaw = 0;
  private tilt = 0;
  private time = 0;

  constructor() {
    this.root.position.set(0, STAGE_TOP, DOLL_Z);
    this.root.rotation.y = this.yaw;
    this.human = new Human(DOLL_LOOK, 2, { featured: true, seed: 2, lit: "standard" });
    const mat = this.human.mesh.material as MeshStandardMaterial;
    // She is never lost in the fog, however long the run: she is what you watch.
    mat.fog = false;
    mat.roughness = 0.6; // a doll's painted, slightly glossy finish
    this.human.mesh.scale.setScalar(SIZE);
    this.human.mesh.castShadow = true;
    this.root.add(this.human.mesh);
    this.head = this.human.bone("head");
    this.head.scale.setScalar(HEAD);

    // Where her eyes are, from the head's proportions (as the face is painted).
    const p = PROPORTIONS[DOLL_LOOK.body];
    const rest = restPositions(p);
    const [hx, hy, hz] = p.head;
    const el = FACE.eyeEl + 0.02;
    this.eyeLocal = [1, -1].map((s) => {
      const az = s * FACE.eyeAz * 1.05;
      return new Vector3(Math.sin(az) * Math.cos(el) * hx, p.headY + Math.sin(el) * hy - rest.head.y, 0.008 + Math.cos(az) * Math.cos(el) * hz + 0.004 - rest.head.z);
    });
    for (const e of this.eyeLocal) {
      const m = new Mesh(new SphereGeometry(0.02, 12, 8), this.glowMat);
      m.position.copy(e);
      m.renderOrder = 3;
      this.head.add(m);
      this.glows.push(m);
    }
    this.human.update(0, 0, 0, 0);
  }

  /** Stand at the far end of this round's field. */
  placeAt(z: number): void {
    this.root.position.z = z;
  }

  /**
   * Turn to face the field (true) or the wall (false) over `duration` s. To
   * the field her head snaps round first, then the body follows (SPEC-V2 §2.2);
   * back to the wall she turns as one, slowly.
   */
  face(players: boolean, duration: number): void {
    this.headLead = players ? 2.1 : 1.35;
    this.turnFrom = this.yaw;
    // Always spin the same way round, so a turn never looks like a twitch.
    const TAU = Math.PI * 2;
    const target = players ? 0 : Math.PI;
    const delta = (((target - this.turnFrom) % TAU) + TAU) % TAU;
    this.turnTo = this.turnFrom + delta;
    this.turnT = 0;
    this.turnDur = Math.max(0.05, duration);
  }

  /** Snap straight to a facing (lobby, new round). */
  setFacing(players: boolean): void {
    this.yaw = this.turnFrom = this.turnTo = players ? 0 : Math.PI;
    this.turnT = 1;
  }

  setSinging(on: boolean): void {
    this.singing = on;
  }

  setWatching(on: boolean): void {
    this.watching = on;
  }

  /** She caught someone at world (x, z): eyes flash, head snaps toward them. */
  caught(x: number, z: number): void {
    this.flash = 1;
    const dx = x - this.root.position.x;
    const dz = z - this.root.position.z;
    // Angle relative to her facing (+Z when watching), clamped to a neck's reach.
    const a = Math.atan2(dx, dz) - this.yaw;
    this.snapYaw = Math.max(-0.9, Math.min(0.9, Math.atan2(Math.sin(a), Math.cos(a))));
    this.snapHold = 1.3;
    this.snapAge = 0;
  }

  update(dt: number): void {
    this.time += dt;

    if (this.turnT < 1) {
      this.turnT = Math.min(1, this.turnT + dt / this.turnDur);
      const body = easeInOut(this.turnT);
      const head = easeOut(Math.min(1, this.turnT * this.headLead));
      this.yaw = this.turnFrom + (this.turnTo - this.turnFrom) * body;
      // The head leads the body round, then the body catches up.
      this.headYaw = (head - body) * (this.turnTo - this.turnFrom);
    } else {
      this.yaw = this.turnTo % (Math.PI * 2);
      this.turnFrom = this.turnTo = this.yaw;
      this.headYaw *= Math.exp(-dt * 10);
    }
    if (this.snapHold > 0) {
      this.snapHold -= dt;
      this.headYaw += (this.snapYaw - this.headYaw) * (1 - Math.exp(-dt * 30));
    }
    this.snapAge += dt;
    // A replay shows her as she was; her own turns carry on underneath.
    const shown = this.shown;
    this.root.rotation.y = shown ? shown.yaw : this.yaw;

    // Pose (standing, breathing), then her head on top of it.
    this.human.update(dt, 0, 0, 0);
    const wantTilt = this.singing && !shown ? Math.sin(this.time * 4.2) * 0.12 : 0;
    this.tilt += (wantTilt - this.tilt) * (1 - Math.exp(-dt * 8));
    // The snap overshoots and jerks back: a crack, not a glide.
    const jerk = this.snapAge < 0.6 ? Math.sin(this.snapAge * 30) * 0.1 * Math.exp(-this.snapAge * 7) : 0;
    _q.setFromAxisAngle(Y, (shown ? shown.head : this.headYaw) + jerk).multiply(_q2.setFromAxisAngle(Z, this.tilt));
    if (this.flash > 0.5) _q.multiply(_q2.setFromAxisAngle(X, -0.12 * this.flash));
    this.head.quaternion.multiply(_q);
    // Bones rebuild their matrix only when told (world/human: posed on demand).
    this.head.updateMatrix();
    this.human.posed();

    // Eyes: a red glow while she watches; a bright red flash on a catch (SPEC-V2 §2.6 step 8).
    const want = (shown ? shown.watching : this.watching) ? 1 : 0;
    this.glow += (want - this.glow) * (1 - Math.exp(-dt * 6));
    this.flash = Math.max(0, this.flash - dt * 1.6);
    const hot = this.flash;
    this.glowMat.opacity = Math.min(1, this.glow * 0.85 + hot);
    this.glowMat.color.setRGB(1, 0.16 - hot * 0.1, 0.1 - hot * 0.06);
    const pulse = this.watching ? 1 + Math.sin(this.time * 9) * 0.08 : 1;
    for (const g of this.glows) {
      g.visible = this.glowMat.opacity > 0.01;
      g.scale.setScalar(pulse + hot * 0.9);
    }
  }

  /** World positions of both eyes (for the beam). */
  eyes(outL: Vector3, outR: Vector3): void {
    this.root.updateMatrixWorld(true);
    outL.copy(this.eyeLocal[0]).applyMatrix4(this.head.matrixWorld);
    outR.copy(this.eyeLocal[1]).applyMatrix4(this.head.matrixWorld);
  }

  /** For tinting UI to the doll's mood without reading three.js state. */
  get isWatching(): boolean {
    return this.watching;
  }

  /** How she stands now, for the replay recorder. */
  pose(out: DollPose): DollPose {
    out.yaw = this.yaw;
    out.head = this.headYaw;
    out.watching = this.watching;
    return out;
  }

  /** Show her as a replay had her (null: back to now). */
  show(p: DollPose | null): void {
    this.shown = p;
  }
}
