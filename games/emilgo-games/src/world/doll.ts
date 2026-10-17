// Mama Gele — the watcher.
//
// An original character: a giant doll in a towering orange gele, an Ankara
// A-line dress and coral beads, standing on a stage under an iroko tree. She is
// deliberately NOT the doll from any TV show — no borrowed dress, hair, face or
// song (Vatar Developer Agreement §3.3: we must own everything in the game).
//
// Three draw calls: body (static), head (turns), pupils (glow). The head is its
// own group so it can lead the body when she turns, snap toward whoever moved,
// and sway while she sings.

import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  TorusGeometry,
  Vector3,
} from "three";

import { DOLL_Z } from "../config";
import { merge, part } from "./geo";

const SKIN = "#5b3418";
const ANKARA = ["#ff6b35", "#ffd700", "#00875a", "#1a237e", "#ffd700", "#ff6b35", "#00875a"];
const SCALE = 2.9; // ~10 m: readable from the start line, and she should loom
const STAGE_TOP = 0.5;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export class Doll {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly head = new Group();
  // The doll is never lost in the fog, however long the run: she is what you watch.
  private readonly pupilMat = new MeshBasicMaterial({ color: 0x111111, fog: false });
  private readonly pupils: Mesh;

  /** Local eye centres in head space, for aiming the beam. */
  private readonly eyeLocal = [new Vector3(0.13, 0.4, 0.36), new Vector3(-0.13, 0.4, 0.36)];

  private yaw = Math.PI; // facing the wall
  private turnFrom = Math.PI;
  private turnTo = Math.PI;
  private turnT = 1;
  private turnDur = 0.5;

  private singing = false;
  private watching = false;
  private glow = 0; // 0..1 red glow
  private flash = 0; // white-hot flash on a catch
  private snapYaw = 0; // head turned toward the offender
  private snapHold = 0;
  private headYaw = 0;
  private time = 0;

  /** Stand at the far end of this round's field. */
  placeAt(z: number): void {
    this.root.position.z = z;
  }

  constructor() {
    this.root.position.set(0, STAGE_TOP, DOLL_Z);
    this.root.scale.setScalar(SCALE);
    this.root.rotation.y = this.yaw;
    this.root.add(this.body);
    this.body.add(this.head);
    this.head.position.set(0, 2.25, 0);

    const lambert = new MeshLambertMaterial({ vertexColors: true, fog: false });

    // ── Body ──
    const b = [
      part(new BoxGeometry(0.22, 0.12, 0.34), "#3e2723", { p: [0.16, 0.06, 0.04] }),
      part(new BoxGeometry(0.22, 0.12, 0.34), "#3e2723", { p: [-0.16, 0.06, 0.04] }),
      part(new CylinderGeometry(0.08, 0.09, 0.45, 6), SKIN, { p: [0.16, 0.34, 0] }),
      part(new CylinderGeometry(0.08, 0.09, 0.45, 6), SKIN, { p: [-0.16, 0.34, 0] }),
    ];
    // Ankara skirt: bands narrowing to the waist.
    const bands = ANKARA.length;
    const y0 = 0.46;
    const y1 = 1.5;
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands;
      const t1 = (i + 1) / bands;
      const r0 = 0.8 - 0.38 * t0;
      const r1 = 0.8 - 0.38 * t1;
      const h = (y1 - y0) / bands;
      b.push(part(new CylinderGeometry(r1, r0, h, 12), ANKARA[i], { p: [0, y0 + h * (i + 0.5), 0] }));
    }
    b.push(part(new CylinderGeometry(0.44, 0.44, 0.09, 12), "#ffd700", { p: [0, 1.52, 0] }));
    b.push(part(new CylinderGeometry(0.36, 0.42, 0.56, 10), "#ff6b35", { p: [0, 1.83, 0] }));
    for (const s of [1, -1]) {
      b.push(part(new IcosahedronGeometry(0.18, 0), "#ffd700", { p: [s * 0.44, 2.0, 0] }));
      b.push(part(new CapsuleGeometry(0.07, 0.42, 2, 6), SKIN, { p: [s * 0.5, 1.62, 0.03], r: [0, 0, s * 0.12] }));
      b.push(part(new IcosahedronGeometry(0.085, 0), SKIN, { p: [s * 0.55, 1.3, 0.05] }));
    }
    b.push(part(new CylinderGeometry(0.1, 0.11, 0.18, 8), SKIN, { p: [0, 2.17, 0] }));
    // Coral beads, two strands.
    b.push(part(new TorusGeometry(0.17, 0.045, 5, 14), "#d84315", { p: [0, 2.12, 0.01], r: [Math.PI / 2 + 0.15, 0, 0] }));
    b.push(part(new TorusGeometry(0.23, 0.04, 5, 16), "#e64a19", { p: [0, 2.05, 0.03], r: [Math.PI / 2 + 0.3, 0, 0] }));
    this.body.add(new Mesh(merge(b), lambert));

    // ── Head ──
    const h = [
      part(new IcosahedronGeometry(0.36, 1), SKIN, { p: [0, 0.36, 0], s: [1, 1.08, 0.98] }),
      part(new IcosahedronGeometry(0.07, 0), SKIN, { p: [0.35, 0.36, 0] }),
      part(new IcosahedronGeometry(0.07, 0), SKIN, { p: [-0.35, 0.36, 0] }),
      part(new IcosahedronGeometry(0.045, 0), "#ffc400", { p: [0.36, 0.25, 0.02] }),
      part(new IcosahedronGeometry(0.045, 0), "#ffc400", { p: [-0.36, 0.25, 0.02] }),
      part(new IcosahedronGeometry(0.09, 1), "#f5f5f5", { p: [0.13, 0.4, 0.3], s: [1, 1, 0.65] }),
      part(new IcosahedronGeometry(0.09, 1), "#f5f5f5", { p: [-0.13, 0.4, 0.3], s: [1, 1, 0.65] }),
      part(new BoxGeometry(0.13, 0.025, 0.03), "#1b0f08", { p: [0.13, 0.52, 0.32], r: [0, 0, -0.12] }),
      part(new BoxGeometry(0.13, 0.025, 0.03), "#1b0f08", { p: [-0.13, 0.52, 0.32], r: [0, 0, 0.12] }),
      part(new BoxGeometry(0.06, 0.09, 0.06), SKIN, { p: [0, 0.32, 0.36] }, 0.85),
      part(new BoxGeometry(0.15, 0.045, 0.04), "#8e2a2a", { p: [0, 0.2, 0.33] }),
      // Gele: the wrap, the crown, and the fan of pleats that makes it a gele.
      part(new TorusGeometry(0.33, 0.12, 5, 16), "#ff8f00", { p: [0, 0.6, -0.03], r: [Math.PI / 2 - 0.25, 0, 0], s: [1.12, 1, 0.92] }),
      part(new IcosahedronGeometry(0.34, 1), "#ff8f00", { p: [0, 0.74, -0.06], s: [1.15, 0.58, 1.02] }, 0.95),
      part(new TorusGeometry(0.37, 0.025, 4, 18), "#ffd54f", { p: [0, 0.53, -0.02], r: [Math.PI / 2 - 0.25, 0, 0] }),
    ];
    for (let i = 0; i < 7; i++) {
      const t = i / 6 - 0.5;
      h.push(
        part(new IcosahedronGeometry(0.24, 1), i % 2 ? "#ffb300" : "#ff6f00", {
          p: [t * 0.55, 0.9 + (0.25 - Math.abs(t)) * 0.35, -0.14],
          r: [-0.35, 0, -t * 1.9],
          s: [0.36, 1.05, 0.12],
        }),
      );
    }
    this.head.add(new Mesh(merge(h), lambert));

    const pupilGeo = merge([
      part(new IcosahedronGeometry(0.048, 1), "#ffffff", { p: [0.13, 0.4, 0.356] }),
      part(new IcosahedronGeometry(0.048, 1), "#ffffff", { p: [-0.13, 0.4, 0.356] }),
    ]);
    this.pupils = new Mesh(pupilGeo, this.pupilMat);
    this.head.add(this.pupils);
  }

  /** Turn to face the field (true) or the wall (false) over `duration` s. */
  face(players: boolean, duration: number): void {
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
    this.snapYaw = Math.max(-0.65, Math.min(0.65, Math.atan2(Math.sin(a), Math.cos(a))));
    this.snapHold = 1.3;
  }

  update(dt: number): void {
    this.time += dt;

    if (this.turnT < 1) {
      this.turnT = Math.min(1, this.turnT + dt / this.turnDur);
      const body = easeInOut(this.turnT);
      const head = easeOut(Math.min(1, this.turnT * 1.35));
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

    this.root.rotation.y = this.yaw;
    this.head.rotation.y = this.headYaw;
    this.head.rotation.z = this.singing ? Math.sin(this.time * 5.5) * 0.08 : this.head.rotation.z * Math.exp(-dt * 8);
    this.head.rotation.x = this.flash > 0.5 ? -0.12 * this.flash : 0;

    const wantGlow = this.watching ? 1 : 0;
    this.glow += (wantGlow - this.glow) * (1 - Math.exp(-dt * 6));
    this.flash = Math.max(0, this.flash - dt * 1.6);

    const red = 0.07 + this.glow * 0.93;
    const hot = this.flash;
    this.pupilMat.color.setRGB(Math.min(1, red + hot * 0.3), 0.04 + hot * 0.85, 0.04 + hot * 0.7);
    const pulse = this.watching ? 1 + Math.sin(this.time * 9) * 0.06 : 1;
    this.pupils.scale.setScalar(pulse + this.flash * 0.6);
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
}
