// Modes 6–10 on screen (SPEC-V3 §9; Phase 6), beside FfaView (melee and the
// flag modes): what each later mode adds, seen and heard.
//
//   Chase & Reverse   the Ojuju's ashen skin; the Reverse charms (a gold
//                     amulet under a green column) on the ground and the map
//   Lights Out        dusk, and darker in a power cut (the mode asks the
//                     world to dim); everyone's lamp: a glow at the hand and
//                     a cone of light ahead (crouched in a cut, no glow);
//                     a warning when a rival's light is on you
//   Hustle            the job stations (a signboard on a post, in its job's
//                     colour; grey while it rests or is broken), the Esusu
//                     boxes, spilled Owo, your delivery's drop; Owo on the HUD
//
// Each mode's things are one instanced draw.

import {
  AdditiveBlending,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Quaternion,
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
import { BLACKOUT, ECONOMY, type JobKind } from "../config";
import type { BlackoutModule } from "../game/modules/blackout";
import type { EconomyModule } from "../game/modules/economy";
import type { TagModule } from "../game/modules/tag";
import type { Hud, ItemPin } from "../ui/hud";
import type { PlayHudState } from "../ui/play";
import type { MapMark } from "../ui/minimap";
import { t } from "../ui/i18n";
import type { Crowd } from "./crowd";
import { merge, part } from "./geo";

/** An Ojuju: ashen, a dull red glow. */
const OJUJU_TINT = 0x8a7a74;
const OJUJU_GLOW = 0x2a0606;
const MAX_CHARMS = 6;
/** Each job's colour on its station. */
const JOB_COLOR: Record<JobKind, number> = { water: 0x3a8ee8, wash: 0x3ec6d8, fix: 0xe8a23a, parcel: 0xc08a4a, load: 0x8a6a4a };
const JOB_NAME: Record<JobKind, string> = { water: "Sell sachet water", wash: "Wash the car", fix: "Fix the generator", parcel: "Take the parcel", load: "Take the load" };

export interface ModesViewOptions {
  crowd: Crowd;
  hud: Hud;
  sound: Sound | null;
  me: number;
}

const _m = new Matrix4();
const _c = new Color();
const _v = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _s = new Vector3();
const _x = new Vector3(1, 0, 0);
const _y = new Vector3(0, 1, 0);

function stationGeometry(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.05, 0.05, 2.2, 6), 0x5a4a3a, { p: [0, 1.1, 0] }),
    part(new CylinderGeometry(0.5, 0.5, 0.06, 6), 0xffffff, { p: [0, 2.2, 0], r: [Math.PI / 2, 0, 0] }),
  ]);
}

function boxGeometry(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.4, 0.45, 0.8, 8), 0x7a4a24, { p: [0, 0.4, 0] }),
    part(new CylinderGeometry(0.42, 0.42, 0.08, 8), 0xffc23a, { p: [0, 0.82, 0] }),
    part(new CylinderGeometry(0.06, 0.06, 0.2, 6), 0xffc23a, { p: [0, 0.95, 0] }),
  ]);
}

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
  private readonly lamps: InstancedMesh;
  private readonly posts: InstancedMesh;
  private readonly boxes: InstancedMesh;
  private readonly sacks: InstancedMesh;
  private readonly drop: InstancedMesh;
  private readonly glows: InstancedMesh;
  /** Lights Out: how dark the city is now (eased), and whether a rival's lamp is on you. */
  dim = 0;
  lit = false;
  private litSaid = -9;
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
    // A lamp's light: a cone 1 m long pointing down +z from its tip (scaled to the reach).
    const cone = new ConeGeometry(Math.tan(BLACKOUT.cone), 1, 16, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2);
    this.lamps = make(cone, new MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }), 16);
    this.glows = make(new IcosahedronGeometry(0.09, 1), new MeshBasicMaterial({ color: 0xfff1c8 }), 16);
    this.posts = make(stationGeometry(), new MeshLambertMaterial({ vertexColors: true }), ECONOMY.stations);
    this.posts.setColorAt(0, new Color(1, 1, 1));
    this.boxes = make(boxGeometry(), new MeshLambertMaterial({ vertexColors: true }), ECONOMY.banks);
    this.sacks = make(new IcosahedronGeometry(0.22, 0), new MeshLambertMaterial({ color: 0xffc23a, emissive: new Color(0x4a3200) }), 24);
    this.drop = make(new CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0), new MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }), 1);
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
      } else if (e.type === "owo" && e.id === me.id) {
        if (e.why === "bank") hud.pushFeed(`${t("Banked")}: ${Math.round(e.banked)} Owo`, "safe");
        else if (e.why === "spill") hud.pushFeed(t("Your Owo spilled"), "out");
        else if (e.why === "bounty") hud.pushFeed(t("Bounty: Owo from the leader"), "safe");
        this.o.sound?.ui?.();
      } else if (e.type === "job") {
        if (e.how === "done" || e.how === "deliver") {
          if (e.id === me.id) hud.pushFeed(`+${e.owo} Owo`, "safe");
        } else if (e.how === "sabotage") {
          const c = m.get(e.id);
          if (c && c !== me) hud.pushFeed(`${c.name} ${t("sabotaged a station")}`, "info");
        } else if (e.how === "lost" && e.id === me.id) hud.pushFeed(t("Your job is lost"), "out");
        else if (e.how === "take" && e.id === me.id) hud.pushFeed(t("Take it to the gold ring"), "info");
      } else if (e.type === "found") {
        const a = m.get(e.id);
        const b = m.get(e.tg);
        if (!a || !b) continue;
        if (b === me) hud.pushFeed(`${t("Found by")} ${a.name}`, "out");
        else hud.pushFeed(a === me ? `${t("You found")} ${b.name}` : `${a.name} ${t("found")} ${b.name}`, a === me ? "safe" : "info");
        this.o.sound?.catch(a === me || b === me);
      } else if (e.type === "shock") {
        if (e.id === me.id) {
          hud.pushFeed(t("The generator shocked you"), "out");
          hud.flashRed();
        }
        this.o.sound?.crack(e.id === me.id);
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
    const eco = m.module<EconomyModule>("economy");
    if (eco) {
      let n = 0;
      for (const s of eco.stations) {
        _m.makeTranslation(s.x, s.h, s.z);
        this.posts.setMatrixAt(n, _m);
        const idle = s.broken || m.elapsed < s.until;
        this.posts.setColorAt(n, _c.setHex(idle ? 0x777777 : JOB_COLOR[s.kind]));
        marks.push({ x: s.x, z: s.z, kind: "job", r: idle ? 0 : 1 });
        n++;
      }
      this.posts.count = n;
      this.posts.instanceMatrix.needsUpdate = true;
      if (this.posts.instanceColor) this.posts.instanceColor.needsUpdate = true;
      eco.banks.forEach((b, i) => {
        _m.makeTranslation(b.x, b.h, b.z);
        this.boxes.setMatrixAt(i, _m);
        marks.push({ x: b.x, z: b.z, kind: "basket" });
      });
      this.boxes.count = eco.banks.length;
      this.boxes.instanceMatrix.needsUpdate = true;
      let k = 0;
      for (const b of eco.bags) {
        if (!b || b.owo <= 0 || b.until <= m.elapsed || k >= 24) continue;
        _m.makeTranslation(b.x, b.h + 0.22 + Math.sin(this.time * 3 + b.index) * 0.05, b.z);
        this.sacks.setMatrixAt(k++, _m);
      }
      this.sacks.count = k;
      this.sacks.instanceMatrix.needsUpdate = true;
      // Your delivery: the drop, a gold ring; the compass points at it.
      const j = eco.job[me.index];
      const to = j >= 0 ? eco.stations[j]?.to : null;
      if (to) {
        _m.makeScale(ECONOMY.drop, 6, ECONOMY.drop).setPosition(to.x, to.h, to.z);
        this.drop.setMatrixAt(0, _m);
        marks.push({ x: to.x, z: to.z, kind: "goal", r: ECONOMY.drop });
        pin = { x: to.x, z: to.z, kind: "goal" };
      } else if (eco.carried[me.index] > 0) {
        // Carrying Owo: the nearest Esusu box.
        let best = Infinity;
        for (const b of eco.banks) {
          const d = Math.hypot(b.x - me.x, b.z - me.z);
          if (d < best) {
            best = d;
            pin = { x: b.x, z: b.z, kind: "goal" };
          }
        }
      }
      this.drop.count = to ? 1 : 0;
      this.drop.instanceMatrix.needsUpdate = true;
    }
    const bo = m.module<BlackoutModule>("blackout");
    if (bo) {
      const dark = bo.cut(m);
      // Dusk always; a power cut nearly black.
      const want = dark ? 1 - bo.dim * 0.4 : 0.55;
      this.dim += (want - this.dim) * (1 - Math.exp(-dt * (dark ? 6 : 2)));
      // Every lamp.
      let n = 0;
      for (const c of m.contestants) {
        if (c.status !== "alive" || n >= 16) continue;
        if (dark && c.stance > 0 && c !== me) continue;
        const reach = dark ? BLACKOUT.cutReach : BLACKOUT.reach;
        const hy = c.h + c.y + (c.stance === 2 ? 0.3 : c.stance === 1 ? 0.8 : 1.3);
        _v.set(c.x + Math.sin(c.heading) * 0.35, hy, c.z + Math.cos(c.heading) * 0.35);
        _m.makeTranslation(_v.x, _v.y, _v.z);
        this.glows.setMatrixAt(n, _m);
        _q.setFromAxisAngle(_y, c.heading).multiply(_q2.setFromAxisAngle(_x, 0.08));
        _m.compose(_v, _q, _s.set(reach, reach, reach));
        this.lamps.setMatrixAt(n, _m);
        n++;
      }
      this.lamps.count = this.glows.count = n;
      this.lamps.instanceMatrix.needsUpdate = this.glows.instanceMatrix.needsUpdate = true;
      // A rival's light on you (the phone's own guess; the server decides).
      this.lit = false;
      if (me.status === "alive") for (const c of m.contestants) if (c !== me && c.status === "alive" && !m.sameSquad(c, me) && bo.sees(m, c, me, dark)) this.lit = true;
      if (this.lit && this.time - this.litSaid > 3) {
        this.litSaid = this.time;
        this.o.hud.pushFeed(t("You're in a lamp's light: get out of it"), "out");
      }
    }
    return { pin };
  }

  /** What interact would do at a Hustle station or box, and how far it is (the nearest thing wins). */
  target(m: Match): (NonNullable<PlayHudState["target"]> & { d: number }) | null {
    const eco = m.module<EconomyModule>("economy");
    const me = m.contestants[this.o.me];
    if (!eco || me.status !== "alive" || m.seated(me)) return null;
    let best: (NonNullable<PlayHudState["target"]> & { d: number }) | null = null;
    const take = (d: number, label: string, progress = 0) => {
      if (d <= ECONOMY.reach && (!best || d < best.d)) best = { kind: "job", label, progress, d };
    };
    for (const b of eco.banks) if (eco.carried[me.index] > 0) take(Math.hypot(b.x - me.x, b.z - me.z), `${t("Bank")} ${Math.round(eco.carried[me.index])} Owo`);
    for (const s of eco.stations) {
      const d = Math.hypot(s.x - me.x, s.z - me.z);
      if (d > ECONOMY.reach) continue;
      const w = s.worker >= 0 ? m.contestants[s.worker] : null;
      if (w && w !== me && !m.sameSquad(w, me)) take(d, t("Sabotage"));
      else if (s.broken) take(d, t("Broken: wait"));
      else if (m.elapsed < s.until) take(d, `${t("Resting")} ${Math.ceil(s.until - m.elapsed)} s`);
      else if (s.kind === "parcel" || s.kind === "load") {
        if (eco.job[me.index] < 0) take(d, t(JOB_NAME[s.kind]));
      } else {
        const spec = ECONOMY.jobs[s.kind];
        take(d, `${t(JOB_NAME[s.kind])} (${t("hold")})`, s.worker === me.index ? Math.min(1, eco.work[me.index] / spec.hold) : 0);
      }
    }
    return best;
  }

  /** The objective line for these modes ("" when it's none of them). */
  objectiveLine(m: Match): string {
    const me = m.contestants[this.o.me];
    const eco = m.module<EconomyModule>("economy");
    if (eco) {
      const lead = eco.leader(m);
      const top = lead ? Math.round(eco.banked[lead.index] + eco.carried[lead.index]) : 0;
      return `Owo: ${Math.round(eco.carried[me.index])} ${t("carried")} · ${Math.round(eco.banked[me.index])} ${t("banked")}${lead && lead !== me ? ` · ${t("leader")} ${top}` : ""}`;
    }
    const bo = m.module<BlackoutModule>("blackout");
    if (bo) {
      const left = m.contestants.filter((c) => c.status === "alive").length;
      const nx = bo.next(m);
      const power = nx ? (nx.off ? `${t("Power cut in")} ${Math.ceil(nx.in)} s` : `${t("Power back in")} ${Math.ceil(nx.in)} s`) : "";
      return [power, `${t("not found")}: ${left}`].filter(Boolean).join(" · ");
    }
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
