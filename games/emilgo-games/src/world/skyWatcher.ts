// The watcher in the sky (SPEC-V3 Phase 11; the owner's answer: "Mama
// removed, the song comes from the sky, the sky laser fires when it cuts").
// Ball Haunt has no doll any more: the song plays from the sky over the far end
// of the field, and when it cuts an eye opens in the clouds. Whoever moves while
// it looks is struck by the shared sky laser (world/skyLaser.ts).
//
//   halo     a wide soft glow, gold, breathing with the song while it plays
//   eye      a red iris in a dark ring, opening as the song cuts (the turn),
//            wide while it looks, closing as the song comes back; a white
//            flash and a glance toward whoever it catches
//
// It hangs far and high over the far end, like a moon (about 20° up from the
// line, 8° from the start of a long run), and is drawn over the world, never
// hidden by it: Lagos Street's skyline or a tree must never hide it opening.
//
// It keeps the old doll's interface (face, setFacing, setSinging, setWatching,
// caught, eyes, pose, show), so the round's flow, the kill cam and the replays
// read it the same way. A pose's `yaw` is π closed … 0 open, as the doll's was
// π facing the wall … 0 facing the field.

import { CanvasTexture, CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, SRGBColorSpace, Vector3 } from "three";

import { DOLL_Z } from "../config";
import { REFLECT_LAYER } from "../maps/potholes";
import type { DollPose } from "../game/replay";

/** How high the eye hangs (m), how far beyond the stage (11 m past the line), and its radius. */
const EYE_Y = 70;
const BEYOND = 190;
const R = 18;
/** Over everything else that's see-through (weather, the sky laser's beams). */
const ON_TOP = 1000;

/** The halo's soft edge: white in the middle fading to nothing (tinted gold by the material). */
function glow(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.35, "rgba(255,255,255,0.7)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const mat = (color: number, extra: Partial<MeshBasicMaterial> = {}) =>
  new MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false, side: DoubleSide, forceSinglePass: true, ...extra });

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class SkyWatcher {
  readonly root = new Group();
  private readonly halo: Mesh;
  private readonly ring: Mesh;
  private readonly iris: Mesh;
  private readonly pupil: Mesh;
  private readonly glowTex = glow();
  private readonly haloMat = mat(0xffc24a, { map: this.glowTex });
  private readonly ringMat = mat(0x1a0d10);
  private readonly irisMat = mat(0xd8141a);
  private readonly pupilMat = mat(0x050203);

  private open = 0;
  private openFrom = 0;
  private openTo = 0;
  private openT = 1;
  private openDur = 0.5;
  private singing = false;
  private watching = false;
  private flash = 0;
  private time = 0;
  /** Where the pupil glances (−1…1 across, a catch's side), and for how long. */
  private glance = 0;
  private glanceHold = 0;
  private shown: DollPose | null = null;

  constructor() {
    this.halo = new Mesh(new CircleGeometry(R * 2.6, 40), this.haloMat);
    this.ring = new Mesh(new RingGeometry(R * 0.82, R, 48), this.ringMat);
    this.iris = new Mesh(new CircleGeometry(R * 0.8, 40), this.irisMat);
    this.pupil = new Mesh(new CircleGeometry(R * 0.28, 24), this.pupilMat);
    this.halo.renderOrder = ON_TOP + 1;
    this.ring.renderOrder = ON_TOP + 2;
    this.iris.renderOrder = ON_TOP + 3;
    this.pupil.renderOrder = ON_TOP + 4;
    this.root.add(this.halo, this.ring, this.iris, this.pupil);
    for (const m of [this.halo, this.ring, this.iris, this.pupil]) m.frustumCulled = false;
    // It shows in the puddles' mirror (High).
    this.root.traverse((o) => o.layers.enable(REFLECT_LAYER));
    this.placeAt(DOLL_Z);
  }

  /** Over the far end of this round's field, looking down the field at the runners. */
  placeAt(z: number): void {
    this.root.position.set(0, EYE_Y, z - BEYOND);
    // Face +z (the field), tipped down toward the runners below (+x turns +z down).
    this.root.rotation.set(0.25, 0, 0);
  }

  /** Open (true: the song has cut, it looks) or close over `duration` s. */
  face(players: boolean, duration: number): void {
    this.openFrom = this.open;
    this.openTo = players ? 1 : 0;
    this.openT = 0;
    this.openDur = Math.max(0.05, duration);
  }

  /** Snap open or shut (the lobby, a new round). */
  setFacing(players: boolean): void {
    this.open = this.openFrom = this.openTo = players ? 1 : 0;
    this.openT = 1;
  }

  setSinging(on: boolean): void {
    this.singing = on;
  }

  setWatching(on: boolean): void {
    this.watching = on;
  }

  /** It caught someone at (x, z): a white flash and a glance their way. */
  caught(x: number, _z: number): void {
    this.flash = 1;
    this.glance = Math.max(-1, Math.min(1, x / 16));
    this.glanceHold = 1.3;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.openT < 1) {
      this.openT = Math.min(1, this.openT + dt / this.openDur);
      this.open = this.openFrom + (this.openTo - this.openFrom) * easeInOut(this.openT);
    } else this.open = this.openTo;
    const shown = this.shown;
    const open = shown ? Math.max(0, Math.min(1, 1 - shown.yaw / Math.PI)) : this.open;
    const watching = shown ? shown.watching : this.watching;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    if (this.glanceHold > 0) this.glanceHold -= dt;
    else this.glance *= Math.exp(-dt * 3);

    // The song from the sky: a gold glow breathing while it plays.
    const sing = this.singing && !shown ? 0.85 + Math.sin(this.time * 4.2) * 0.15 : 0;
    this.haloMat.opacity += (sing * (1 - open) - this.haloMat.opacity) * (1 - Math.exp(-dt * 4));
    // The eye: the lid opens top to bottom (the iris scaled on y), red while it looks.
    const lid = Math.max(0.02, open);
    this.ring.scale.set(1, lid, 1);
    this.iris.scale.set(1, lid, 1);
    this.pupil.scale.set(1, lid, 1);
    this.ringMat.opacity = Math.min(0.9, open * 1.4);
    const pulse = watching ? 1 + Math.sin(this.time * 9) * 0.08 : 1;
    const hot = this.flash;
    this.irisMat.opacity = Math.min(1, open + hot);
    this.irisMat.color.setRGB(0.85 + hot * 0.15, 0.08 + hot * 0.8, 0.1 + hot * 0.7);
    this.iris.scale.x = pulse + hot * 0.3;
    this.pupilMat.opacity = Math.min(0.95, open * 1.2);
    this.pupil.position.x = (shown ? shown.head : this.glance) * R * 0.35;
  }

  /** Where the beam and the kill cam come from: the middle of the eye (both "eyes"). */
  eyes(outL: Vector3, outR: Vector3): void {
    this.root.updateMatrixWorld(true);
    outL.set(0, 0, 0).applyMatrix4(this.root.matrixWorld);
    outR.copy(outL);
  }

  /** For tinting UI to its mood without reading three.js state. */
  get isWatching(): boolean {
    return this.watching;
  }

  /** How it looks now, for the replay recorder (yaw: π shut … 0 open; head: the glance). */
  pose(out: DollPose): DollPose {
    out.yaw = Math.PI * (1 - this.open);
    out.head = this.glance;
    out.watching = this.watching;
    return out;
  }

  /** Show it as a replay had it (null: back to now). */
  show(p: DollPose | null): void {
    this.shown = p;
  }

  dispose(): void {
    for (const m of [this.halo, this.ring, this.iris, this.pupil]) m.geometry.dispose();
    for (const m of [this.haloMat, this.ringMat, this.irisMat, this.pupilMat]) m.dispose();
    this.glowTex.dispose();
  }
}
