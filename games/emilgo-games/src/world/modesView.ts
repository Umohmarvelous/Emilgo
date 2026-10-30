// Modes 6–10 on screen (SPEC-V3 §9; Phase 6), beside FfaView (melee and the
// flag modes): what each later mode adds, seen and heard.
//
//   Chase & Reverse   the Ojuju's ashen skin; the Reverse charms (a gold
//                     amulet under a green column) on the ground and the map
//
// Each mode's things are one instanced draw.

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
  TorusGeometry,
  Vector3,
} from "three";

import type { Sound } from "../audio/sound";
import type { Match } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import type { TagModule } from "../game/modules/tag";
import type { Hud, ItemPin } from "../ui/hud";
import type { MapMark } from "../ui/minimap";
import { t } from "../ui/i18n";
import type { Crowd } from "./crowd";
import { merge, part } from "./geo";

/** An Ojuju: ashen, a dull red glow. */
const OJUJU_TINT = 0x8a7a74;
const OJUJU_GLOW = 0x2a0606;
const MAX_CHARMS = 6;

export interface ModesViewOptions {
  crowd: Crowd;
  hud: Hud;
  sound: Sound | null;
  me: number;
}

const _m = new Matrix4();
const _v = new Vector3();

function charmGeometry(): BufferGeometry {
  return merge([
    part(new TorusGeometry(0.16, 0.035, 6, 14), 0xffc23a, { p: [0, 0.32, 0] }),
    part(new IcosahedronGeometry(0.07, 0), 0x2fbf6a, { p: [0, 0.32, 0] }),
    part(new CylinderGeometry(0.01, 0.01, 0.2, 4), 0x3a2a1a, { p: [0, 0.5, 0] }),
  ]);
}

export class ModesView {
  readonly group = new Group();
  private readonly o: ModesViewOptions;
  private readonly charms: InstancedMesh;
  private readonly columns: InstancedMesh;
  private tinted: boolean[] = [];
  private time = 0;

  constructor(o: ModesViewOptions) {
    this.o = o;
    const make = (geo: BufferGeometry, mat: MeshBasicMaterial | MeshLambertMaterial, n: number) => {
      const mesh = new InstancedMesh(geo, mat, n);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      return mesh;
    };
    this.charms = make(charmGeometry(), new MeshLambertMaterial({ vertexColors: true, emissive: new Color(0x3a2a00) }), MAX_CHARMS);
    this.columns = make(new CylinderGeometry(0.5, 0.5, 1, 12, 1, true).translate(0, 0.5, 0), new MeshBasicMaterial({ color: 0x3ee08a, transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }), MAX_CHARMS);
  }

  events(list: readonly MatchEvent[], m: Match): void {
    const me = m.contestants[this.o.me];
    const hud = this.o.hud;
    for (const e of list) {
      if (e.type === "turn") {
        const c = m.get(e.id);
        if (!c) continue;
        if (e.ojuju) {
          if (c === me) {
            hud.pushFeed(e.by ? t("You're Ojuju now: touch the humans") : t("You start as the Ojuju: touch the humans"), "out");
            hud.flashRed();
          } else hud.pushFeed(`${c.name} ${t("turned Ojuju")}`, "info");
          this.o.sound?.thud(1);
        } else {
          if (c === me) hud.pushFeed(t("Cured: you're human again"), "safe");
          else hud.pushFeed(`${c.name} ${t("was cured")}`, "safe");
        }
      } else if (e.type === "charm") {
        if (e.how === "drop" && !e.id) hud.pushFeed(t("Reverse charms are out: a human who carries one can cure an Ojuju"), "info");
        else if (e.how === "take" && e.id === me.id) hud.pushFeed(t("You carry a Reverse charm: touch an Ojuju to cure them"), "safe");
      }
    }
  }

  /** Every frame: tints, the mode's things, the map. Returns the compass's objective pin, if any. */
  update(dt: number, m: Match, marks: MapMark[]): { pin: ItemPin | null } {
    this.time += dt;
    let pin: ItemPin | null = null;
    const me = m.contestants[this.o.me];
    const tag = m.module<TagModule>("tag");
    if (tag) {
      // The Ojuju's skin.
      for (const c of m.contestants) {
        const want = tag.isOjuju(c.index);
        if ((this.tinted[c.index] ?? false) === want) continue;
        this.tinted[c.index] = want;
        this.o.crowd.setTint(c.index, want ? OJUJU_TINT : null, want ? OJUJU_GLOW : 0);
      }
      // The charms: on the ground they glow; carried, they ride at the hip.
      let n = 0;
      let best = Infinity;
      for (const ch of tag.charms) {
        if (!ch || ch.spent || n >= MAX_CHARMS) continue;
        const bob = Math.sin(this.time * 2 + ch.index) * 0.06;
        const y = ch.holder >= 0 ? ch.h + 0.8 : ch.h + bob;
        _m.makeRotationY(this.time * 1.5 + ch.index).setPosition(ch.x, y, ch.z);
        this.charms.setMatrixAt(n, _m);
        _m.makeScale(1, ch.holder >= 0 ? 0 : 30, 1).setPosition(ch.x, ch.h, ch.z);
        this.columns.setMatrixAt(n, _m);
        n++;
        if (ch.holder < 0) {
          marks.push({ x: ch.x, z: ch.z, kind: "crate" });
          // For a human: the nearest charm is the compass's pin.
          if (!tag.isOjuju(me.index) && me.status === "alive") {
            const d = Math.hypot(ch.x - me.x, ch.z - me.z);
            if (d < best) {
              best = d;
              pin = { x: ch.x, z: ch.z, kind: "rare" };
            }
          }
        }
      }
      this.charms.count = this.columns.count = n;
      this.charms.instanceMatrix.needsUpdate = this.columns.instanceMatrix.needsUpdate = true;
    }
    void _v;
    return { pin };
  }

  /** The objective line for these modes ("" when it's none of them). */
  objectiveLine(m: Match): string {
    const me = m.contestants[this.o.me];
    const tag = m.module<TagModule>("tag");
    if (tag) {
      const humans = tag.humans(m).length;
      const carrying = tag.charms.some((ch) => ch.holder === me.index && !ch.spent);
      if (tag.isOjuju(me.index)) return `${t("You're Ojuju")} · ${t("humans left")}: ${humans}`;
      return `${carrying ? t("Charm: cure an Ojuju") : t("Run from the Ojuju")} · ${t("humans left")}: ${humans}`;
    }
    return "";
  }

  dispose(m: Match): void {
    for (const c of m.contestants) if (this.tinted[c.index]) this.o.crowd.setTint(c.index, null);
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
