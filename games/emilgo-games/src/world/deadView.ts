// Dead Streets on screen (SPEC-V3 §3.3; Phase 7), beside the match scene:
//
//   Zombies     the crowd's bodies in zombie paint (grey-green, a dull red
//               glow); asleep in the pool they're hidden; one rises out of
//               the ground over 2.5 s; put down, it falls away from you.
//   Torch       one SpotLight from your chest the way you face (no shadows
//               on Low, a 512 map on Medium, 1024 on High), a faint cone,
//               dimmer as the battery runs down.
//   Night vision a green wash and a vignette over the screen while it lasts.
//   The run's HUD  health (damage only), armour, rounds, the torch's battery,
//               the clock to the bleed, how far along.
//   Obstacles   sparks, flares and zinc on their beat; keys, fuel and the
//               generator's switch glowing; the Mast's flare at the finish.
//   Sounds      shots, blows, claws, the hazards.

import {
  AdditiveBlending,
  ConeGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SpotLight,
  type Vector3,
} from "three";

import type { Sound } from "../audio/sound";
import { SURVIVAL } from "../config";
import type { Tier } from "../graphics/tiers";
import type { Match } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import type { SurvivalModule } from "../game/modules/survival";
import { routeAt } from "../maps/open/spooky";
import { el, esc, fmtTime } from "../ui/dom";
import type { Hud, ItemPin } from "../ui/hud";
import { t } from "../ui/i18n";
import type { MapMark } from "../ui/minimap";
import type { Crowd } from "./crowd";

const ZOMBIE_TINT = 0x8a9878;
const ZOMBIE_GLOW = 0x200404;
const _m = new Matrix4();

export interface DeadViewOptions {
  crowd: Crowd;
  hud: Hud;
  sound: Sound | null;
  me: number;
  layer: HTMLElement;
  tier: Tier;
}

export class DeadView {
  readonly group = new Group();
  private readonly o: DeadViewOptions;
  private readonly torch: SpotLight;
  private readonly cone: Mesh;
  private readonly bits: InstancedMesh;
  private readonly hudEl = el("div", "dshud glass");
  private readonly nvEl = el("div", "nvwash");
  private readonly rising = new Map<number, number>();
  private hidden: boolean[] = [];
  private hudKey = "";
  private time = 0;

  constructor(o: DeadViewOptions) {
    this.o = o;
    this.torch = new SpotLight(0xfff1d0, 0, 26, 0.42, 0.55, 1.2);
    if (o.tier >= 1) {
      this.torch.castShadow = true;
      const size = o.tier >= 2 ? 1024 : 512;
      this.torch.shadow.mapSize.set(size, size);
      this.torch.shadow.camera.near = 0.3;
      this.torch.shadow.camera.far = 26;
    }
    this.group.add(this.torch, this.torch.target);
    this.cone = new Mesh(new ConeGeometry(Math.tan(0.42) * 9, 9, 18, 1, true).translate(0, -4.5, 0).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.06, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    this.group.add(this.cone);
    // Sparks, flares and the things to pick up: one instanced draw of glowing bits.
    this.bits = new InstancedMesh(new IcosahedronGeometry(0.18, 0), new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }), 64);
    this.bits.frustumCulled = false;
    this.bits.count = 0;
    this.group.add(this.bits);
    this.hudEl.setAttribute("role", "status");
    o.layer.append(this.hudEl, this.nvEl);
  }

  /** Every zombie in paint, every sleeping one hidden. */
  setup(m: Match): void {
    for (let i = 1; i < m.contestants.length; i++) {
      this.o.crowd.setTint(i, ZOMBIE_TINT, ZOMBIE_GLOW);
      this.o.crowd.setHidden(i, true);
      this.hidden[i] = true;
    }
  }

  events(list: readonly MatchEvent[], m: Match): void {
    const s = this.o.sound;
    const me = m.contestants[this.o.me];
    for (const e of list) {
      switch (e.type) {
        case "zrise": {
          const z = m.get(e.id);
          if (!z) break;
          this.o.crowd.setHidden(z.index, false);
          this.hidden[z.index] = false;
          this.o.crowd.revive(z.index);
          this.rising.set(z.index, 0);
          break;
        }
        case "zdie": {
          const z = m.get(e.id);
          if (z) this.o.crowd.kill(z.index, z, me.x, me.z);
          if (e.head) this.o.hud.pushFeed(t("Head shot"), "safe");
          break;
        }
        case "claw":
          this.o.hud.flashRed();
          s?.thud(1);
          break;
        case "shot":
          s?.crack(true);
          this.o.crowd.act(this.o.me, "slap");
          if (e.ammo === 0) this.o.hud.pushFeed(t("Out of rounds"), "out");
          break;
        case "blow":
          this.o.crowd.act(this.o.me, e.kind === "cutlass" ? "fist" : "push");
          s?.strike(e.kind === "cutlass" ? "fist" : "push", !!e.tg || e.gate >= 0);
          break;
        case "hazard":
          this.o.hud.flashRed();
          s?.thud(1);
          break;
        case "dgate":
          if (e.how === "key") this.o.hud.pushFeed(t("A key"), "safe");
          else if (e.how === "fuel") this.o.hud.pushFeed(t("Fuel for the generator"), "safe");
          else if (e.how === "open") this.o.hud.pushFeed(t("The way is open"), "safe");
          else if (e.how === "hit") this.o.hud.pushFeed(`${e.n} / ${SURVIVAL.blows}`, "info");
          break;
        case "kit":
          if (e.why === "sanctuary") this.o.hud.pushFeed(t("A sanctuary: rest here a moment"), "safe");
          break;
        default:
          break;
      }
    }
  }

  /** Every frame. The compass's pin: the next stretch of the route (or a key, fuel, the switch close by). */
  update(dt: number, m: Match, cam: Vector3, marks: MapMark[]): { pin: ItemPin | null } {
    this.time += dt;
    const sv = m.module<SurvivalModule>("survival");
    const me = m.contestants[this.o.me];
    if (!sv) return { pin: null };
    // Zombies: rising out of the ground; asleep in the pool, hidden.
    for (let i = 1; i < m.contestants.length; i++) {
      const z = m.contestants[i];
      const r = this.rising.get(i);
      if (r !== undefined) {
        const u = Math.min(1, r / SURVIVAL.rise);
        this.o.crowd.setLift(i, -1.7 * (1 - u) * (1 - u));
        if (u >= 1) {
          this.rising.delete(i);
          this.o.crowd.setLift(i, 0);
        } else this.rising.set(i, r + dt);
      }
      const asleep = sv.state[i] === 0 && z.status !== "alive" && z.x < -m.world.space.bounds.x1 + 20;
      if (asleep !== !!this.hidden[i]) {
        this.hidden[i] = asleep;
        this.o.crowd.setHidden(i, asleep);
      }
    }
    // The torch: from your chest, where you face; dimmer as the battery goes.
    const hd = me.heading;
    const y = me.h + me.y + 1.35;
    this.torch.position.set(me.x + Math.sin(hd) * 0.3, y, me.z + Math.cos(hd) * 0.3);
    this.torch.target.position.set(me.x + Math.sin(hd) * 8, me.h + 0.4, me.z + Math.cos(hd) * 8);
    const power = me.status === "alive" && sv.torch > 0 ? 0.35 + 0.65 * Math.min(1, sv.torch / 30) : 0;
    // A weak battery flickers.
    const flick = sv.torch < 15 && Math.sin(this.time * 31) > 0.7 ? 0.4 : 1;
    this.torch.intensity = 26 * power * flick;
    this.cone.position.copy(this.torch.position);
    this.cone.lookAt(this.torch.target.position);
    (this.cone.material as MeshBasicMaterial).opacity = 0.06 * power;
    // Night vision.
    this.nvEl.classList.toggle("on", m.elapsed < sv.nvUntil);
    // Obstacles: sparks and flares on their beat, keys and fuel to find.
    let n = 0;
    const run = sv.run;
    let pin: ItemPin | null = null;
    if (run) {
      for (const h of run.hazards) {
        if (n >= 60 || Math.hypot(h.x - cam.x, h.z - cam.z) > 60) continue;
        if ((h.kind === "spark" || h.kind === "flare" || h.kind === "swing") && sv.hazardOn(m, h)) {
          for (let k = 0; k < 4 && n < 60; k++) {
            const a = this.time * 9 + k * 1.7 + h.id;
            const r = h.r * (0.3 + 0.6 * ((k * 0.37 + this.time * 2.3) % 1));
            _m.makeScale(h.kind === "flare" ? 2.2 : 1, h.kind === "flare" ? 2.2 : 1, h.kind === "flare" ? 2.2 : 1).setPosition(h.x + Math.cos(a) * r, 0.4 + ((k + this.time * 3) % 1.6), h.z + Math.sin(a) * r);
            this.bits.setMatrixAt(n++, _m);
          }
        }
      }
      for (const g of run.gates) {
        if (sv.open.has(g.id)) continue;
        const things: [number, number][] = [];
        if (g.key && !sv.keys.has(g.id)) things.push(g.key);
        if (g.fuel && !sv.fuel.has(g.id)) things.push(g.fuel);
        if (g.sw) things.push(g.sw);
        for (const [x, z] of things) {
          if (n >= 64) break;
          const bob = Math.sin(this.time * 3 + x) * 0.1;
          _m.makeScale(1.4, 1.4, 1.4).setPosition(x, 0.9 + bob, z);
          this.bits.setMatrixAt(n++, _m);
          if (Math.hypot(x - me.x, z - me.z) < 25) pin = { x, z, kind: "rare" };
        }
      }
      // The Mast: a flare over the finish.
      marks.push({ x: run.finish[0], z: run.finish[1], kind: "goal", r: SURVIVAL.finish });
      if (!pin) {
        const ahead = routeAt(run, Math.min(run.length, sv.tally.best + 30));
        pin = { x: ahead.x, z: ahead.z, kind: "goal" };
      }
      for (const s of run.sanctuaries) marks.push({ x: s.x, z: s.z, kind: "safe" });
    }
    this.bits.count = n;
    this.bits.instanceMatrix.needsUpdate = true;
    // The run's HUD (redrawn only when a number changes).
    const bleed = Math.max(0, 720 - m.elapsed);
    const key = `${Math.ceil(sv.hp)}|${Math.round(sv.armour)}|${sv.ammo}|${Math.round(sv.torch)}|${Math.ceil(bleed)}|${Math.round(sv.tally.route * 100)}|${m.elapsed < sv.nvUntil}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      const hp = Math.max(0, Math.min(100, sv.hp));
      this.hudEl.innerHTML = `<div class="bar hp"><i style="width:${hp}%"></i><span>${Math.ceil(hp)}</span></div>
        ${sv.armour > 0 ? `<div class="bar ar"><i style="width:${Math.min(100, sv.armour)}%"></i></div>` : ""}
        <div class="row"><span>${esc(t("Rounds"))} <b class="num">${sv.ammo}</b></span><span>${esc(t("Torch"))} <b class="num">${Math.round(sv.torch)}%</b></span></div>
        <div class="row"><span class="${bleed <= 0 ? "bleed" : ""}">${bleed > 0 ? `${esc(t("Bleed in"))} <b class="num">${fmtTime(bleed)}</b>` : esc(t("Bleeding"))}</span><span><b class="num">${Math.round(sv.tally.route * 100)}%</b></span></div>`;
    }
    return { pin };
  }

  dispose(): void {
    this.hudEl.remove();
    this.nvEl.remove();
    this.torch.dispose();
    this.cone.geometry.dispose();
    (this.cone.material as MeshBasicMaterial).dispose();
    this.bits.dispose();
  }
}
