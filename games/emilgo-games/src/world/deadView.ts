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
//   The sky     night with a red tinge; red and orange lightning every
//               25–55 s (a 0.15 s pulse on a hemisphere light), the thunder
//               after it by its distance.
//   Sounds      shots, blows, claws, the hazards.

import {
  AdditiveBlending,
  Color,
  type Fog,
  HemisphereLight,
  ConeGeometry,
  CylinderGeometry,
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
import { LORE } from "../content/lore";
import { ghostAt, loadGhost } from "../game/ghost";
import { itemName } from "../ui/play";
import type { SurvivalModule } from "../game/modules/survival";
import { routeAt } from "../maps/open/spooky";
import { el, esc, fmtTime } from "../ui/dom";
import type { Hud, ItemPin } from "../ui/hud";
import { getLang, t } from "../ui/i18n";
import type { MapMark } from "../ui/minimap";
import type { Crowd } from "./crowd";

// v4: the rot shader (human/rot.ts) gives the skin and clothes; a kind's tint only shifts it.
const ZOMBIE_TINT = 0xdce4d4;
const ZOMBIE_GLOW = 0x120202;
/** Each kind's paint (§3.4 #2): tint and glow over the rot. The bounty zombie glows gold. */
const KIND_PAINT: Record<string, [number, number]> = {
  shambler: [0xdce4d4, 0x120202],
  runner: [0xe6e8d8, 0x1a0404],
  crawler: [0xc2cab8, 0x0c0202],
  bloater: [0xeee6b0, 0x161600],
  screamer: [0xf4f2ea, 0x1a0808],
  brute: [0xd6c4b4, 0x200804],
  lurker: [0xb8d4c8, 0x00120c],
  masked: [0xd6cec4, 0x1c1408],
};
/** A brute stands this much bigger (the others as they are: adults, all of them). */
const BRUTE_SCALE = 1.14;
const BOUNTY_GLOW = 0x6a4a00;
const REVEAL_GLOW = 0xff4a20;
const _m = new Matrix4();
/** The run's weekly mutators by name (§3.4 #11). */
export { RUN_MUTATOR_NAME } from "../game/weekly";
const REDDENED = new WeakSet<Fog>();

export interface DeadViewOptions {
  crowd: Crowd;
  hud: Hud;
  sound: Sound | null;
  me: number;
  layer: HTMLElement;
  tier: Tier;
  /** Blood on (Settings): the rot's blood round the mouths and in the wounds. */
  blood?: boolean;
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
  /** When each zombie last lunged (the view's clock). */
  private readonly lungedAt: number[] = [];
  private hidden: boolean[] = [];
  private hudKey = "";
  private time = 0;
  /** Lightning: a light that pulses, when the next strike comes, where, and its thunder. */
  private readonly flash = new HemisphereLight(0xff6a3a, 0x401010, 0);
  private nextBolt = 12;
  private boltT = -1;
  private thunderAt = -1;
  private thunderNear = 0;
  /** Lightning reveals (§3.4 #5): zombies outlined until then. */
  private revealUntil = -1;
  private readonly paint: [number, number][] = [];
  private readonly gasEl = el("div", "gaswash");
  /** Birds on the roofs (§3.4 #15): where each flock sits, and when it took off (−1: sitting). */
  private flocks: { x: number; z: number; up: number }[] = [];
  private bellAt = 20;
  /** Your best run's ghost (§3.4 #12), raced: its trace and its body. */
  private ghost: number[] | null = null;
  private ghostMesh: Mesh | null = null;

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
    this.group.add(this.torch, this.torch.target, this.flash);
    this.cone = new Mesh(new ConeGeometry(Math.tan(0.42) * 9, 9, 18, 1, true).translate(0, -4.5, 0).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.06, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    this.group.add(this.cone);
    // Sparks, flares and the things to pick up: one instanced draw of glowing bits.
    this.bits = new InstancedMesh(new IcosahedronGeometry(0.18, 0), new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }), 64);
    this.bits.frustumCulled = false;
    this.bits.count = 0;
    this.group.add(this.bits);
    this.hudEl.setAttribute("role", "status");
    o.layer.append(this.hudEl, this.nvEl, this.gasEl);
  }

  /** Every zombie in paint, every sleeping one hidden; the night's sky a little red. */
  setup(m: Match, fog?: Fog, clear?: Color): void {
    // Once per world (the city is kept between runs).
    if (fog && !REDDENED.has(fog)) {
      REDDENED.add(fog);
      const red = new Color(0x3a0c08);
      fog.color.lerp(red, 0.45);
      clear?.lerp(red, 0.45);
    }
    // Your best run's ghost, if this phone has one.
    this.ghost = loadGhost();
    if (this.ghost) {
      this.ghostMesh = new Mesh(new CylinderGeometry(0.28, 0.24, 1.7, 10).translate(0, 0.85, 0), new MeshBasicMaterial({ color: 0x9ad8ff, transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false }));
      this.group.add(this.ghostMesh);
    }
    const run = m.module<SurvivalModule>("survival")?.run;
    if (run) for (let d = 60; d < run.length - 60; d += 150) {
      const p = routeAt(run, d);
      this.flocks.push({ x: p.x + p.uz * 6, z: p.z - p.ux * 6, up: -1 });
    }
    for (let i = 1; i < m.contestants.length; i++) {
      this.paint[i] = [ZOMBIE_TINT, ZOMBIE_GLOW];
      this.o.crowd.setZombie(i, "shambler", !!this.o.blood);
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
          const p = KIND_PAINT[e.kind ?? "shambler"] ?? KIND_PAINT.shambler;
          this.paint[z.index] = [p[0], e.bounty ? BOUNTY_GLOW : p[1]];
          this.o.crowd.setZombie(z.index, e.kind ?? "shambler", !!this.o.blood);
          this.o.crowd.setTint(z.index, p[0], e.bounty ? BOUNTY_GLOW : p[1]);
          const hz = this.o.crowd.human(z.index);
          if (hz) hz.mesh.scale.setScalar(hz.look.height * (e.kind === "brute" ? BRUTE_SCALE : 1));
          if (e.bounty) this.o.hud.pushFeed(t("A zombie with a gold key: put it down"), "info");
          this.o.crowd.revive(z.index);
          // Out of the ground, clawing at the air.
          this.o.crowd.act(z.index, "emerge");
          this.rising.set(z.index, 0);
          break;
        }
        case "zdie": {
          const z = m.get(e.id);
          if (z) this.o.crowd.kill(z.index, z, me.x, me.z);
          if (e.head) this.o.hud.pushFeed(t("Head shot"), "safe");
          break;
        }
        case "claw": {
          this.o.hud.flashRed();
          s?.thud(1);
          const z = m.get(e.id);
          if (z) this.o.crowd.act(z.index, "claw");
          break;
        }
        case "shot": {
          s?.crack(true);
          this.o.crowd.act(this.o.me, "slap");
          // The zombie hit staggers back from where the shot came.
          const z = e.tg ? m.get(e.tg) : null;
          if (z && z.status === "alive") this.o.crowd.hit(z.index, z, z.x - me.x, z.z - me.z);
          if (e.ammo === 0) this.o.hud.pushFeed(t("Out of rounds"), "out");
          break;
        }
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
        case "horde":
          s?.talkingDrum();
          break;
        case "scream": {
          const z = m.get(e.id);
          s?.scream(z ? Math.max(0.2, 1 - Math.hypot(z.x - me.x, z.z - me.z) / 50) : 0.5);
          this.o.hud.pushFeed(t("A Screamer: more are coming"), "out");
          break;
        }
        case "charge":
          this.o.hud.pushFeed(t("A Brute charges: side-step!"), "out");
          s?.thud(0.8);
          break;
        case "grabbed":
          this.o.hud.pushFeed(t("Grabbed by the legs: strike down to break free"), "out");
          this.o.hud.flashRed();
          break;
        case "gas":
          this.o.hud.pushFeed(t("Pepper gas"), "info");
          break;
        case "stand":
          this.o.hud.pushFeed(t("The Last Stand: hold the Mast until the gate opens"), "info");
          s?.talkingDrum();
          break;
        case "find": {
          if (e.kind === "lore") {
            const l = LORE[e.n];
            if (l) this.o.hud.pushFeed(`${t(l.kind === "radio" ? "Radio" : l.kind === "diary" ? "A diary page" : "A cutting")}: ${getLang() === "pcm" ? l.text.pcm : l.text.en}`, "info");
          } else if (e.kind === "cache") this.o.hud.pushFeed(`${t("Grandma's tin box")}: ${e.items.map((k) => itemName(k)).join(", ")}`, "safe");
          else if (e.kind === "vault") this.o.hud.pushFeed(`${t("The vault")}: ${e.items.map((k) => itemName(k)).join(", ")}`, "safe");
          else if (e.kind === "key") this.o.hud.pushFeed(t("The gold key: find the vault"), "safe");
          else if (e.kind === "egg") this.o.hud.pushFeed(e.n < 3 ? `${"✦".repeat(e.n)} ${t("Her eyes glint…")}` : t("Something opened nearby"), "info");
          break;
        }
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
    const run0 = sv.run;
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
      // A lunge: when one suddenly closes fast, its arms go out ahead (not again for a second).
      if (z.status === "alive" && r === undefined && Math.hypot(z.vx, z.vz) > SURVIVAL.walk * 1.6 && this.time - (this.lungedAt[i] ?? -9) > 1.2) {
        this.lungedAt[i] = this.time;
        this.o.crowd.act(i, "lunge");
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
    // Lightning: now and then, red or orange, the thunder after it by distance.
    if (this.time >= this.nextBolt) {
      this.nextBolt = this.time + 25 + Math.random() * 30;
      this.boltT = 0;
      this.flash.color.setHex(Math.random() < 0.5 ? 0xff5a2a : 0xff9a3a);
      const far = 0.3 + Math.random() * 0.7;
      this.thunderAt = this.time + far * 2.5;
      // Lightning reveals: every zombie outlined for a moment.
      this.revealUntil = this.time + 0.3;
      for (let i = 1; i < m.contestants.length; i++) if (sv.state[i] !== 0) this.o.crowd.setTint(i, this.paint[i]?.[0] ?? ZOMBIE_TINT, REVEAL_GLOW);
      this.thunderNear = 1 - far * 0.7;
    }
    if (this.boltT >= 0) {
      this.boltT += dt;
      const u = this.boltT / 0.15;
      this.flash.intensity = u < 1 ? 2.6 * (1 - u) * (0.6 + 0.4 * Math.sin(this.boltT * 120)) : 0;
      if (u >= 1) this.boltT = -1;
    }
    if (this.revealUntil >= 0 && this.time >= this.revealUntil) {
      this.revealUntil = -1;
      for (let i = 1; i < m.contestants.length; i++) {
        const p = this.paint[i];
        if (p) this.o.crowd.setTint(i, p[0], p[1]);
      }
    }
    // The pepper gas; a bell from a sanctuary near (soft, never a jump scare).
    this.gasEl.classList.toggle("on", m.elapsed < sv.gasUntil);
    if (this.time >= this.bellAt && run0) {
      this.bellAt = this.time + 22;
      let best = Infinity;
      for (const sa of run0.sanctuaries) best = Math.min(best, Math.hypot(sa.x - me.x, sa.z - me.z));
      if (best > 12 && best < 70) this.o.sound?.bell(1 - best / 70);
    }
    if (this.thunderAt >= 0 && this.time >= this.thunderAt) {
      this.thunderAt = -1;
      this.o.sound?.explosion(this.thunderNear * 0.5);
    }
    // The ghost runs your best.
    if (this.ghost && this.ghostMesh) {
      const g = ghostAt(this.ghost, m.elapsed);
      this.ghostMesh.visible = !!g;
      if (g) this.ghostMesh.position.set(g.x, g.h, g.z);
    }
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
      // What to find: chalk marks by the caches, lore's pages, the vault, the doll's eyes.
      for (const f of sv.finds) {
        if (sv.found.has(f.k) || n >= 64 || Math.hypot(f.x - cam.x, f.z - cam.z) > 30) continue;
        const bob = Math.sin(this.time * 2 + f.k) * 0.05;
        const sc = f.kind === "lore" ? 0.6 : f.kind === "egg" ? 0.5 : 1;
        _m.makeScale(sc, sc, sc).setPosition(f.x, (f.kind === "egg" ? 1.4 : 0.5) + bob, f.z);
        this.bits.setMatrixAt(n++, _m);
      }
      // Birds on the roofs till you run near, then up and away.
      for (const fl of this.flocks) {
        const d = Math.hypot(fl.x - me.x, fl.z - me.z);
        if (fl.up < 0 && d < 14 && me.sprinting) fl.up = this.time;
        if (fl.up >= 0 && this.time - fl.up > 40) fl.up = -1;
        if (d > 45 || (fl.up >= 0 && this.time - fl.up > 4)) continue;
        for (let k = 0; k < 6 && n < 64; k++) {
          const u = fl.up >= 0 ? this.time - fl.up : 0;
          const a = k * 1.05;
          _m.makeScale(0.35, 0.2, 0.35).setPosition(fl.x + Math.cos(a) * (0.8 + u * 5), 4.2 + u * 6 + Math.sin(this.time * 9 + k) * (u > 0 ? 0.3 : 0), fl.z + Math.sin(a) * (0.8 + u * 5));
          this.bits.setMatrixAt(n++, _m);
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
    const stand = sv.standAt >= 0 && !sv.tally.finished ? Math.max(0, Math.ceil(sv.standAt + SURVIVAL.stand.s - m.elapsed)) : -1;
    const key = `${stand}|${Math.ceil(sv.hp)}|${Math.round(sv.armour)}|${sv.ammo}|${Math.round(sv.torch)}|${Math.ceil(bleed)}|${Math.round(sv.tally.route * 100)}|${m.elapsed < sv.nvUntil}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      const hp = Math.max(0, Math.min(100, sv.hp));
      this.hudEl.innerHTML = `<div class="bar hp"><i style="width:${hp}%"></i><span>${Math.ceil(hp)}</span></div>
        ${sv.armour > 0 ? `<div class="bar ar"><i style="width:${Math.min(100, sv.armour)}%"></i></div>` : ""}
        <div class="row"><span>${esc(t("Rounds"))} <b class="num">${sv.ammo}</b></span><span>${esc(t("Torch"))} <b class="num">${Math.round(sv.torch)}%</b></span></div>
        ${stand >= 0 ? `<div class="row stand"><span>${esc(t("Hold the Mast"))}</span><b class="num">${stand} s</b></div>` : ""}
        <div class="row"><span class="${bleed <= 0 ? "bleed" : ""}">${bleed > 0 ? `${esc(t("Bleed in"))} <b class="num">${fmtTime(bleed)}</b>` : esc(t("Bleeding"))}</span><span><b class="num">${Math.round(sv.tally.route * 100)}%</b></span></div>`;
    }
    return { pin };
  }

  /** HUD A (v4): the watch, the centre arc and the plates show the run; this panel goes. */
  setFieldKit(on: boolean): void {
    this.hudEl.classList.toggle("fieldkit", on);
  }

  /** The crowd outlives the run: the zombies back to people. */
  private unrot(): void {
    for (let i = 0; i < 128; i++) {
      const h = this.o.crowd.human(i);
      if (!h) continue;
      h.setZombie(null);
      h.mesh.scale.setScalar(h.look.height);
    }
  }

  dispose(): void {
    this.unrot();
    this.hudEl.remove();
    this.nvEl.remove();
    this.gasEl.remove();
    this.torch.dispose();
    this.cone.geometry.dispose();
    (this.cone.material as MeshBasicMaterial).dispose();
    this.bits.dispose();
    if (this.ghostMesh) {
      this.ghostMesh.geometry.dispose();
      (this.ghostMesh.material as MeshBasicMaterial).dispose();
    }
  }
}
