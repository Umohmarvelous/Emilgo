// The §10 items on screen (SPEC-V3 Phase 6; rules in game/modules/gadgets.ts):
//
//   smoke     a Harmattan Smoke Pot's cloud: dense grey puffs churning over
//             its circle for its life, thinning at the end; inside it, your
//             screen goes grey too
//   peel      a banana peel on the ground
//   decoy     a Decoy Flag, the same pole and gold cloth as a real one
//   powder    a red-orange puff in a cone in front of the thrower
//   wave      a megaphone: a ring that pulses while it winds up, then one
//             that races out
//   drum      the rival a Talking Drum found: a red column over them, on
//             your screen only
//
// v6 max: in Treasure Hunt the Decoy is a closed chest like the real ones (on
// the map as a chest); the Pulse Scanner sends a sweep out from you, and every
// rival it finds gets a column; whoever springs your decoy is marked the same
// way.
//
// One instanced draw each for the puffs, the peels, the decoys and the rings.

import {
  AdditiveBlending,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from "three";

import type { Sound } from "../audio/sound";
import { GADGETS } from "../config";
import type { Match } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import { CAMO, type GadgetsModule } from "../game/modules/gadgets";
import { t } from "../ui/i18n";
import type { Hud } from "../ui/hud";
import type { MapMark } from "../ui/minimap";
import type { Crowd } from "./crowd";
import { merge, part } from "./geo";
import { chestGeometry } from "./treasure";

const PUFFS_PER_CLOUD = 18;
const MAX_CLOUDS = 6;
const MAX_PEELS = 24;
const MAX_DECOYS = 12;
const MAX_RINGS = 12;
const MAX_BURSTS = 64;
const MAX_COLUMNS = 8;

interface Ring {
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  r0: number;
  r1: number;
  color: number;
  /** Pulsing in place (a wind-up) rather than racing out. */
  pulse: boolean;
}

interface Burst {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
}

export interface GadgetViewOptions {
  crowd: Crowd;
  hud: Hud;
  sound: Sound | null;
  me: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _c = new Color();
const UP = new Vector3(0, 1, 0);

function peelGeometry(): BufferGeometry {
  return merge([
    part(new TorusGeometry(0.11, 0.035, 4, 8, Math.PI * 1.2), 0xf2d43a, { p: [0, 0.03, 0], r: [Math.PI / 2, 0, 0] }),
    part(new TorusGeometry(0.11, 0.025, 4, 6, Math.PI * 0.6), 0x8a6a1a, { p: [0.02, 0.05, 0.02], r: [Math.PI / 2, 0, 1.4] }),
  ]);
}

function decoyGeometry(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.025, 0.03, 1.9, 6), 0x3a3530, { p: [0, 0.95, 0] }),
    part(new PlaneGeometry(0.7, 0.42), 0xffc23a, { p: [0.36, 1.66, 0] }),
    part(new PlaneGeometry(0.7, 0.1), 0x1f8a4a, { p: [0.36, 1.5, 0.002] }),
  ]);
}

export class GadgetView {
  readonly group = new Group();
  private readonly o: GadgetViewOptions;
  private readonly smoke: InstancedMesh;
  private readonly peels: InstancedMesh;
  private readonly decoys: InstancedMesh;
  /** v6 max: Treasure Hunt's decoys: chests. */
  private readonly decoyChests: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly bursts: InstancedMesh;
  private readonly column: InstancedMesh;
  private readonly ringList: Ring[] = [];
  private readonly burstList: Burst[] = [];
  private time = 0;

  constructor(o: GadgetViewOptions) {
    this.o = o;
    const make = (geo: BufferGeometry, mat: MeshBasicMaterial | MeshLambertMaterial, n: number, colors = false) => {
      const mesh = new InstancedMesh(geo, mat, n);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      if (colors) mesh.setColorAt(0, new Color(1, 1, 1));
      this.group.add(mesh);
      return mesh;
    };
    this.smoke = make(new IcosahedronGeometry(1, 1), new MeshLambertMaterial({ color: 0xd8d2c6, transparent: true, opacity: 0.9 }), PUFFS_PER_CLOUD * MAX_CLOUDS);
    this.peels = make(peelGeometry(), new MeshLambertMaterial({ vertexColors: true }), MAX_PEELS);
    this.decoys = make(decoyGeometry(), new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }), MAX_DECOYS);
    this.decoyChests = make(chestGeometry(false), new MeshLambertMaterial({ vertexColors: true }), MAX_DECOYS);
    this.rings = make(new RingGeometry(0.9, 1, 40, 1).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, forceSinglePass: true }), MAX_RINGS, true);
    this.bursts = make(new IcosahedronGeometry(1, 0), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }), MAX_BURSTS, true);
    this.column = make(new CylinderGeometry(0.35, 0.35, 1, 10, 1, true).translate(0, 0.5, 0), new MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, forceSinglePass: true }), MAX_COLUMNS);
  }

  events(list: readonly MatchEvent[], m: Match, cam: Vector3): void {
    const me = m.contestants[this.o.me];
    const near = (x: number, z: number, range: number) => Math.max(0, 1 - Math.hypot(x - cam.x, z - cam.z) / range);
    const s = this.o.sound;
    for (const e of list) {
      if (e.type === "reveal") {
        if (e.id === me.id && e.tg) this.o.hud.pushFeed(`${t("Marked")}: ${m.get(e.tg)?.name ?? ""}`, "info");
        else if (e.id === me.id) this.o.hud.pushFeed(t("Pulse: nobody in range"), "info");
        else if (e.tg === me.id) this.o.hud.pushFeed(t("You've been marked: keep moving"), "out");
        continue;
      }
      if (e.type === "disguise") {
        if (e.id === me.id) this.o.hud.pushFeed(e.squad >= 0 ? t("In disguise: they see a squad mate") : e.squad === CAMO ? t("Camouflaged: off every sensor") : t("Disguise off"), "info");
        continue;
      }
      if (e.type !== "gadget") continue;
      switch (e.kind) {
        // The power-emote cards: the dance itself (Breakdance plays the plain dance, then they're down).
        case "zanku":
        case "shaku":
        case "odogwu":
        case "sweep": {
          const c = e.id ? m.get(e.id) : null;
          if (!c) break;
          this.o.crowd.emote(c.index, e.kind === "sweep" ? "dance" : e.kind);
          if (e.kind === "sweep") s?.strike("push", false);
          break;
        }
        case "powder": {
          const hd = e.hd ?? 0;
          for (let k = 0; k < 14; k++) {
            const a = hd + (Math.random() - 0.5) * GADGETS.powder.cone * 2;
            const sp = 3 + Math.random() * 3;
            this.burst({ x: e.x, y: e.h + 1.3, z: e.z, vx: Math.sin(a) * sp, vy: 0.3 + Math.random() * 0.5, vz: Math.cos(a) * sp, age: 0, life: 0.9, size: 0.18 + Math.random() * 0.12 }, 0xd8432a);
          }
          s?.strike("push", false);
          break;
        }
        case "sneeze": {
          const c = e.id ? m.get(e.id) : null;
          if (c) this.o.crowd.hit(c.index, c, Math.random() - 0.5, Math.random() - 0.5);
          if (c === me) this.o.hud.flashRed();
          break;
        }
        case "wave-up":
          this.ringList.push({ x: e.x, y: e.h + 0.05, z: e.z, age: 0, life: GADGETS.wave.windup, r0: 1.2, r1: 1.6, color: 0xffd36a, pulse: true });
          s?.zoneAlert();
          break;
        case "wave":
          this.ringList.push({ x: e.x, y: e.h + 0.3, z: e.z, age: 0, life: 0.45, r0: 0.8, r1: GADGETS.wave.r, color: 0xffffff, pulse: false });
          s?.strike("push", true);
          {
            const c = e.id ? m.get(e.id) : null;
            if (c) this.o.crowd.act(c.index, "push");
          }
          break;
        case "lost":
          this.ringList.length = Math.max(0, this.ringList.length - 1);
          break;
        case "pop": {
          // v6 max: a flash of dye and sparks, and a ring: the trap is sprung.
          const hunt = !!m.module("treasure");
          for (let k = 0; k < 18; k++) this.burst({ x: e.x, y: e.h + (hunt ? 0.5 : 1.5), z: e.z, vx: (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 3, vz: (Math.random() - 0.5) * 4, age: 0, life: 0.9, size: 0.16 }, k % 3 ? 0xff4fd8 : 0xffc23a);
          this.ringList.push({ x: e.x, y: e.h + 0.1, z: e.z, age: 0, life: 0.5, r0: 0.4, r1: 4, color: 0xff4fd8, pulse: false });
          if (e.id === me.id) {
            this.o.hud.pushFeed(t("A decoy! You're stunned and marked"), "out");
            this.o.hud.flashRed();
          }
          if (near(e.x, e.z, 50) > 0) s?.explosion(0.25 * near(e.x, e.z, 50));
          s?.empty();
          break;
        }
        case "fooled": {
          // v7 (H8): Fool's Gold sprung: a puff of brass dust, a mocking honk; the one fooled is stunned and on every map.
          for (let k = 0; k < 16; k++) this.burst({ x: e.x, y: e.h + 0.5, z: e.z, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2.5, vz: (Math.random() - 0.5) * 3, age: 0, life: 0.9, size: 0.14 }, k % 2 ? 0xd8b84a : 0x8a6a2a);
          this.ringList.push({ x: e.x, y: e.h + 0.1, z: e.z, age: 0, life: 0.5, r0: 0.4, r1: 3, color: 0xd8b84a, pulse: false });
          const c = e.id ? m.get(e.id) : null;
          if (c === me) {
            this.o.hud.pushFeed(t("Fool's Gold! Stunned, and everyone can see you"), "out");
            this.o.hud.flashRed();
          } else if (c && near(e.x, e.z, 400) > 0) this.o.hud.pushFeed(`${c.name} ${t("grabbed Fool's Gold")}`, m.sameSquad(c, me) ? "out" : "info");
          if (c === me || near(e.x, e.z, 50) > 0) {
            s?.fooled(c === me ? 1 : near(e.x, e.z, 50));
          }
          break;
        }
        case "smoke":
          if (near(e.x, e.z, 40) > 0) s?.crash(0.15);
          break;
        // v6 max: the Pulse Scanner's sweep: a ring racing out from the scanner (yours, or one near you).
        case "pulse":
          if (e.id === me.id || near(e.x, e.z, 60) > 0) {
            this.ringList.push({ x: e.x, y: e.h + 0.4, z: e.z, age: 0, life: 1.1, r0: 1, r1: e.id === me.id ? 60 : 25, color: 0x3fe0ff, pulse: false });
            this.ringList.push({ x: e.x, y: e.h + 0.4, z: e.z, age: 0, life: 1.5, r0: 0.5, r1: e.id === me.id ? 40 : 18, color: 0x9ff3ff, pulse: false });
            s?.talkingDrum();
          }
          if (e.id === me.id && e.n > 0) this.o.hud.pushFeed(`${t("Pulse")}: ${e.n} ${e.n === 1 ? t("rival found") : t("rivals found")}`, "info");
          break;
        default:
          break;
      }
    }
  }

  private burst(b: Burst, color: number): void {
    if (this.burstList.length >= MAX_BURSTS) this.burstList.shift();
    this.burstList.push(b);
    (b as Burst & { color: number }).color = color;
  }

  /** Every frame. Returns whether the camera is inside smoke (the screen greys). */
  update(dt: number, m: Match, cam: Vector3, marks: MapMark[]): { inSmoke: boolean } {
    this.time += dt;
    const g = m.module<GadgetsModule>("gadgets");
    const t = m.elapsed;
    let puffs = 0;
    let peels = 0;
    let decoys = 0;
    let chests = 0;
    const hunt = !!m.module("treasure");
    let inSmoke = false;
    if (g) {
      for (const p of g.placed) {
        if (!p || p.until <= t) continue;
        if (p.kind === "smoke" && puffs + PUFFS_PER_CLOUD <= PUFFS_PER_CLOUD * MAX_CLOUDS) {
          const left = p.until - t;
          const grow = Math.min(1, (t - p.at) / 0.8);
          const fade = Math.min(1, left / 2);
          const R = GADGETS.smoke.r;
          for (let k = 0; k < PUFFS_PER_CLOUD; k++) {
            // Each puff on its own slow orbit, so the cloud churns.
            const a = k * 2.399 + this.time * (0.08 + (k % 5) * 0.02);
            const r = R * (0.25 + 0.7 * ((k * 0.618) % 1)) * grow;
            const y = 0.8 + ((k * 0.37) % 1) * 2.4;
            const size = (1.6 + ((k * 0.73) % 1) * 1.2) * grow * fade;
            _m.makeScale(size, size * 0.8, size).setPosition(p.x + Math.cos(a) * r, p.h + y, p.z + Math.sin(a) * r);
            this.smoke.setMatrixAt(puffs++, _m);
          }
          if (Math.hypot(cam.x - p.x, cam.z - p.z) < R * 0.85 && cam.y < p.h + 3.4) inSmoke = true;
        } else if (p.kind === "peel" && peels < MAX_PEELS) {
          _q.setFromAxisAngle(UP, p.index * 1.7);
          _m.compose(_v.set(p.x, p.h, p.z), _q, _s.set(1.4, 1.4, 1.4));
          this.peels.setMatrixAt(peels++, _m);
        } else if (p.kind === "decoy" && decoys < MAX_DECOYS) {
          if (hunt) {
            // Treasure Hunt: a closed chest like the real ones, on the map as a chest.
            _q.setFromAxisAngle(UP, p.index * 2.1);
            _m.compose(_v.set(p.x, p.h, p.z), _q, _s.set(1, 1, 1));
            this.decoyChests.setMatrixAt(chests++, _m);
            marks.push({ x: p.x, z: p.z, kind: "chest" });
            decoys++;
          } else {
            // Flapping a little, like the real one.
            _q.setFromAxisAngle(UP, Math.sin(this.time * 1.3 + p.index) * 0.4);
            _m.compose(_v.set(p.x, p.h, p.z), _q, _s.set(1, 1, 1));
            this.decoys.setMatrixAt(decoys++ - chests, _m);
            // On the map like any loose flag (it's the compass that tells).
            marks.push({ x: p.x, z: p.z, kind: "flag" });
          }
        }
      }
    }
    this.smoke.count = puffs;
    this.peels.count = peels;
    this.decoys.count = decoys - chests;
    this.decoyChests.count = chests;
    this.smoke.instanceMatrix.needsUpdate = this.peels.instanceMatrix.needsUpdate = this.decoys.instanceMatrix.needsUpdate = this.decoyChests.instanceMatrix.needsUpdate = true;

    // The Talking Drum's find: a red column over them, and on your map.
    let cols = 0;
    if (g) {
      for (const r of g.reveals) {
        // v7 (H8): by −1 (Fool's Gold): everyone sees them (but you, over yourself).
        if ((r.by !== this.o.me && r.by !== -1) || r.until <= t || (r.by === -1 && r.tg === this.o.me)) continue;
        const c = m.contestants[r.tg];
        if (!c || c.status !== "alive" || cols >= MAX_COLUMNS) continue;
        _m.makeScale(1, 40, 1).setPosition(c.x, c.h, c.z);
        this.column.setMatrixAt(cols++, _m);
        marks.push({ x: c.x, z: c.z, kind: "ping" });
      }
    }
    this.column.count = cols;
    this.column.instanceMatrix.needsUpdate = true;

    // Rings.
    let n = 0;
    for (let k = this.ringList.length - 1; k >= 0; k--) {
      const r = this.ringList[k];
      r.age += dt;
      if (r.age >= r.life) this.ringList.splice(k, 1);
    }
    for (const r of this.ringList) {
      const u = r.age / r.life;
      const rad = r.pulse ? r.r0 + (r.r1 - r.r0) * (0.5 + 0.5 * Math.sin(r.age * 20)) : r.r0 + (r.r1 - r.r0) * u;
      _m.makeScale(rad, 1, rad).setPosition(r.x, r.y, r.z);
      this.rings.setMatrixAt(n, _m);
      this.rings.setColorAt(n, _c.setHex(r.color).multiplyScalar(r.pulse ? 1 : 1 - u));
      n++;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;

    // Bursts (the powder, a decoy popping).
    for (let k = this.burstList.length - 1; k >= 0; k--) {
      const b = this.burstList[k];
      b.age += dt;
      if (b.age >= b.life) this.burstList.splice(k, 1);
    }
    this.burstList.forEach((b, i) => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.vx *= 0.95;
      b.vz *= 0.95;
      const size = b.size * (1 + (b.age / b.life) * 3) * (1 - b.age / b.life);
      _m.makeScale(size, size, size).setPosition(b.x, b.y, b.z);
      this.bursts.setMatrixAt(i, _m);
      this.bursts.setColorAt(i, _c.setHex((b as Burst & { color: number }).color));
    });
    this.bursts.count = this.burstList.length;
    this.bursts.instanceMatrix.needsUpdate = true;
    if (this.bursts.instanceColor) this.bursts.instanceColor.needsUpdate = true;
    return { inSmoke };
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      }
    });
    this.group.removeFromParent();
  }
}
