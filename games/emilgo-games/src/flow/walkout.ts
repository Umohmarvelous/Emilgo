// The walkout (SPEC-V2 §1.3), for every game: the players file out of the
// tunnel to their places, filmed from the front, the side, behind and
// overhead; then the game's own field preview (its shot list); then the lens
// comes back behind you. Football style, nothing added: no name tags, flags,
// crowd sounds, stadium lights or emote wheel.
//
// The referee holds everyone still at their places for the whole walkout
// (phase "walkout"), so the walk here is pictures only: each person's path
// starts in the tunnel and ends exactly where the referee put them. The
// timeline is the phase's own clock, so every phone shows the same moment.
//
// Skip (shown once everyone has walked in, FLOW.walk): your lens jumps to the
// last shot, behind the players, and waits there. Practice starts the countdown
// at once; online it starts when everyone has skipped or the walkout ends.

import { FLOW } from "../config";
import type { Contestant } from "../game/rules";
import { icon } from "../ui/icons";
import { TUNNEL } from "../world/tunnel";
import { Reel, follow, settle, type Frame, type Shot } from "./cinema";

/** Where the column forms up inside the tunnel. */
const ROW_GAP = 1.2;
/** Out of the tunnel and onto the field here, then across to your place. */
const ONTO_FIELD_Z = 9.6;
/** Arrive by this, before the walk's last shot ends. */
const ARRIVE = FLOW.walk - 0.5;

interface Path {
  /** Three points: in the tunnel, out on the field, your place. */
  pts: [number, number][];
  len: number;
  delay: number;
  speed: number;
}

/**
 * The walk: one path per person, from a column in the tunnel (four files for
 * a big field, two for a small one) to the place the referee gave them. The
 * front of the column takes the places furthest up the field, so no one walks
 * through anyone.
 */
export class Walk {
  /** What the crowd draws: copies of the contestants, moved along the paths. */
  readonly walkers: Contestant[];
  private readonly paths: Path[];

  constructor(list: readonly Contestant[]) {
    const n = list.length;
    const files = n > 8 ? 4 : 2;
    const fileGap = files === 4 ? 1.3 : 1.5;
    // Places, furthest up the field first; within each rank, left to right.
    const order = list.map((c) => c.index).sort((a, b) => list[a].z - list[b].z);
    const paths: Path[] = new Array(n);
    for (let r = 0; r * files < n; r++) {
      const rank = order.slice(r * files, r * files + files).sort((a, b) => list[a].x - list[b].x);
      rank.forEach((idx, f) => {
        const fx = (f - (rank.length - 1) / 2) * fileGap;
        const fz = TUNNEL.mouthZ + 0.6 + r * ROW_GAP;
        const c = list[idx];
        const pts: [number, number][] = [
          [fx, fz],
          [fx, ONTO_FIELD_Z],
          [c.x, c.z],
        ];
        const len = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) + Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
        const delay = r * 0.4;
        // A brisk walk; only the back of a big column has to hurry a little.
        const speed = Math.max(1.7, len / Math.max(1, ARRIVE - delay));
        paths[idx] = { pts, len, delay, speed };
      });
    }
    this.paths = paths;
    this.walkers = list.map((c) => ({ ...c, vx: 0, vz: 0, y: 0, stance: 0, slide: 0, ball: -1 }));
  }

  /** Put everyone where they are at time t (seconds since the walkout began). */
  at(t: number): void {
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];
      const p = this.paths[i];
      const d = Math.max(0, Math.min(p.len, (t - p.delay) * p.speed));
      const [a, b, c] = p.pts;
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let x: number;
      let z: number;
      let dx: number;
      let dz: number;
      if (d <= l1) {
        const u = l1 > 0 ? d / l1 : 1;
        x = a[0] + (b[0] - a[0]) * u;
        z = a[1] + (b[1] - a[1]) * u;
        dx = b[0] - a[0];
        dz = b[1] - a[1];
      } else {
        const l2 = p.len - l1;
        const u = l2 > 0 ? (d - l1) / l2 : 1;
        x = b[0] + (c[0] - b[0]) * u;
        z = b[1] + (c[1] - b[1]) * u;
        dx = c[0] - b[0];
        dz = c[1] - b[1];
      }
      const moving = d > 0 && d < p.len;
      const k = Math.hypot(dx, dz) || 1;
      w.x = x;
      w.z = z;
      w.vx = moving ? (dx / k) * p.speed : 0;
      w.vz = moving ? (dz / k) * p.speed : 0;
      // Facing the way they walk; at their place, up the field (to Mama).
      w.heading = moving ? Math.atan2(dx, dz) : Math.PI;
    }
  }

  /** The middle of the group (x, z), and its front and back (z). */
  centre(): { x: number; z: number; front: number; back: number } {
    let x = 0;
    let z = 0;
    let front = Infinity;
    let back = -Infinity;
    for (const w of this.walkers) {
      x += w.x;
      z += w.z;
      front = Math.min(front, w.z);
      back = Math.max(back, w.z);
    }
    const n = Math.max(1, this.walkers.length);
    return { x: x / n, z: z / n, front, back };
  }

  /** The furthest anyone is to the right (+X) right now. */
  maxX(): number {
    let m = -Infinity;
    for (const w of this.walkers) m = Math.max(m, w.x);
    return m;
  }
}

/** The walk's four angles: front, side, behind, overhead (FLOW.walk seconds). */
export function walkShots(walk: Walk): Shot[] {
  const q = FLOW.walk / 4;
  const front = follow(q, (u, out) => {
    const c = walk.centre();
    // Ahead of them on the walkway, backing away slowly: they walk at the lens.
    out.pos.set(1.4, 1.35, Math.min(c.front - 4.5, 7.5 - u * 1.2));
    out.look.set(c.x * 0.5, 1.35, c.front + 1.5);
    out.fov = 38;
  });
  const side = follow(q, (u, out) => {
    const c = walk.centre();
    // Off to the right of everyone, sliding out as they fan out: nobody walks through the lens.
    out.pos.set(Math.max(6.2, walk.maxX() + 3.4) - u * 0.6, 1.4, c.z - 1.2);
    out.look.set(c.x, 1.05, c.z - 0.4);
    out.fov = 44;
  });
  const behind = follow(q, (_u, out) => {
    const c = walk.centre();
    out.pos.set(0.6, 1.9, Math.min(c.back + 3.2, TUNNEL.mouthZ + TUNNEL.depth - 1.5));
    out.look.set(c.x, 1.0, c.z - 9);
    out.fov = 50;
  });
  const overhead = follow(q, (u, out) => {
    const c = walk.centre();
    const e = settle(u);
    out.pos.set(c.x * 0.3, 9 + e * 7, c.z + 6 - e * 4);
    out.look.set(c.x * 0.3, 0, c.z - 1);
    out.fov = 52;
  });
  return [front, side, behind, overhead];
}

/**
 * One walkout: the reel (walk, then the game's preview, then `behind`) and
 * the walkers. `behind` must end on the frame the game's own camera starts
 * from, so the countdown begins without a jump.
 */
export class Walkout {
  readonly walk: Walk;
  readonly reel: Reel;
  private skippedAt = -1;

  constructor(list: readonly Contestant[], preview: Shot[], behind: Shot) {
    this.walk = new Walk(list);
    this.reel = new Reel([...walkShots(this.walk), ...preview, behind]);
  }

  /** The skip button shows once everyone has walked into the arena. */
  canSkip(t: number): boolean {
    return t >= FLOW.walk && this.skippedAt < 0;
  }

  get skipped(): boolean {
    return this.skippedAt >= 0;
  }

  skip(t: number): void {
    if (this.skippedAt < 0) this.skippedAt = t;
  }

  /** Walkers and the lens at time t into the walkout. */
  update(t: number, out: Frame): void {
    // Skipped: everyone's in place, the lens waits behind the players.
    this.walk.at(this.skippedAt >= 0 ? FLOW.walk : t);
    this.reel.at(this.skippedAt >= 0 ? this.reel.length : t, out);
  }
}

/** The two buttons over the walkout: skip (after the walk) and, the first time on a field, the tutorial. */
export class WalkoutButtons {
  readonly skipBtn: HTMLButtonElement;
  readonly tutorialBtn: HTMLButtonElement;

  constructor(ui: HTMLElement) {
    this.skipBtn = document.createElement("button");
    this.skipBtn.className = "flow-btn flow-skip glass";
    this.skipBtn.dataset.ui = "1";
    this.skipBtn.setAttribute("aria-label", "Skip");
    this.skipBtn.innerHTML = `${icon("skip", "", 18)}`;
    this.tutorialBtn = document.createElement("button");
    this.tutorialBtn.className = "flow-btn flow-tutorial glass";
    this.tutorialBtn.dataset.ui = "1";
    this.tutorialBtn.setAttribute("aria-label", "Tutorial");
    this.tutorialBtn.innerHTML = `${icon("help", "", 18)}<span>Tutorial</span>`;
    ui.append(this.skipBtn, this.tutorialBtn);
  }

  /** `up`: the HUD is showing (the countdown), so the tutorial button moves clear of the controls. */
  show(skip: boolean, tutorial: boolean, up = false): void {
    this.skipBtn.classList.toggle("visible", skip);
    this.tutorialBtn.classList.toggle("visible", tutorial);
    this.tutorialBtn.classList.toggle("up", up);
  }
}

