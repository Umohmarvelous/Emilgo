// Free For All (SPEC-V3 §4, §9; Phase 4) behind the GameMode seam: one
// match on Naija World — online (a copy of the server's match, net/
// onlineMatch.ts) or a practice walk on your own (a local match, no bots:
// there are none, ever). The shared match scene draws the zone, the items and
// Airfall (world/matchScene.ts); the Free For All view adds melee and the
// flags (world/ffa.ts); the session lends the renderer, the people, the HUD
// and the controls (modes/types.ts).

import { Vector3 } from "three";

import { type ModeDef } from "../content/modes";
import { Rng } from "../core/rng";
import type { Contestant } from "../game/core/body";
import { Match, settingsOf, type MatchWorld } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import type { CaptureModule } from "../game/modules/capture";
import type { FlagsModule } from "../game/modules/flags";
import type { MeleeModule } from "../game/modules/melee";
import { LOOKS } from "../graphics/grade";
import type { OpenWorld } from "../maps/open/build";
import { matchWorldOf } from "../maps/open/matchWorld";
import type { NetClient } from "../net/client";
import type { MatchSnap, MatchSync, WireEvent } from "../net/matchWire";
import { OnlineMatch } from "../net/onlineMatch";
import type { ServerMsg, StartInfo } from "../net/protocol";
import { fromWire, type WireLook } from "../shop/catalog";
import type { MapMark } from "../ui/hud";
import { getLang, t } from "../ui/i18n";
import { PlayHud } from "../ui/play";
import { accentOf } from "../world/crowd";
import { FfaView, PROP_NAME } from "../world/ffa";
import { randomLook, type Look } from "../world/human/wardrobe";
import { MatchScene } from "../world/matchScene";
import type { GameMode, ModeHost, ModeResult } from "./types";

/** Seconds from the end to the results: the last moment, seen. */
const RESULTS_AFTER_MS = 3500;

const worlds = new WeakMap<OpenWorld, Map<string, MatchWorld>>();

/** The match's world for a map ("naija-world", "naija-world:market"), on this phone's copy of Naija World. */
export function matchWorldFor(world: OpenWorld, map: string): MatchWorld {
  let byMap = worlds.get(world);
  if (!byMap) worlds.set(world, (byMap = new Map()));
  let w = byMap.get(map);
  if (!w) byMap.set(map, (w = matchWorldOf(world.layout, world.space, map)));
  return w;
}

/** Where the match comes from: the server's (a copy), or a practice walk here. */
interface Source {
  readonly def: ModeDef;
  readonly match: Match;
  readonly me: Contestant | null;
  readonly measures?: readonly number[];
  setInput(x: number, z: number): void;
  setButtons(sprint: boolean, stance: 0 | 1 | 2, jump: number): void;
  setActions(attack: number, grab: number): void;
  setMatchButtons(brace: boolean, interact: number, hold: boolean, pack: number): void;
  step(dt: number): void;
  drain(): MatchEvent[];
  dispose(): void;
}

/** Practice: the mode on your own, refereed here. */
class LocalSource implements Source {
  readonly match: Match;
  readonly me: Contestant;

  constructor(readonly def: ModeDef, seed: number, world: MatchWorld, name: string) {
    this.match = new Match({ seed, world, settings: settingsOf(def), contestants: [{ id: "me", name, bot: false }], countdown: 3 });
    this.me = this.match.contestants[0];
  }

  setInput(x: number, z: number): void {
    this.match.setInput("me", x, z);
  }
  setButtons(sprint: boolean, stance: 0 | 1 | 2, jump: number): void {
    this.match.setButtons("me", sprint, stance, jump);
  }
  setActions(attack: number, grab: number): void {
    this.match.setActions("me", attack, grab);
  }
  setMatchButtons(brace: boolean, interact: number, hold: boolean, pack: number): void {
    this.match.setBrace("me", brace);
    this.match.setInteract("me", interact, hold);
    this.match.setPack("me", pack);
  }
  step(dt: number): void {
    this.match.step(dt);
  }
  drain(): MatchEvent[] {
    return this.match.drain();
  }
  dispose(): void {}
}

export class FfaMode implements GameMode {
  over = false;
  private src: Source;
  private readonly ms: MatchScene;
  private readonly view: FfaView;
  private readonly play = new PlayHud();
  private readonly focus = new Vector3();
  private readonly marks: MapMark[] = [];
  private readonly looks: Look[];
  private press = 0;
  private hold = false;
  private packN = 0;
  private packAct = 0;
  private endAt = -1;
  private lastCount = -1;
  private spectate = -1;

  private constructor(
    private readonly host: ModeHost,
    private readonly world: OpenWorld,
    src: Source,
    wire: readonly (WireLook | undefined)[],
    private readonly online: { net: NetClient; myId: string } | null,
  ) {
    this.src = src;
    const m = src.match;
    const me = src.me!;
    const h = host;
    // Everyone in their own clothes (Free For All has no match suit); strangers as the seed dresses them.
    const rng = new Rng(m.seed ^ 0x5eed);
    const looks: Look[] = m.contestants.map((c, i) => (c === me ? h.myLook() : wire[i] ? fromWire(wire[i]!) : randomLook(new Rng((rng.next() * 1e9) ^ (i * 977)))));
    this.looks = looks;
    h.crowd.setup(looks, me.index);
    h.crowd.hideMyHead = h.rig.firstPerson;

    // The world, its sky, and the camera's walls.
    h.scene.add(world.group);
    h.scene.fog = world.fog;
    h.renderer.setClearColor(world.clear);
    h.camera.far = world.view + 40;
    h.camera.updateProjectionMatrix();
    h.rig.wallX = Infinity;
    h.rig.dollZ = -1e6;
    h.rig.colliders = [];
    h.rig.near = (x, z, r) => world.space.camBoxes(x, z, r);

    this.ms = new MatchScene({
      tier: h.spec.tier,
      view: world.view,
      ground: "dust",
      crowd: h.crowd,
      hud: h.hud,
      play: this.play,
      sound: h.sound,
      me: me.index,
      printsAt: (x, z, feet) => {
        const s = world.space.surfaceAt(x, z, feet);
        return s !== "puddle" && s !== "metal";
      },
    });
    this.view = new FfaView({ crowd: h.crowd, hud: h.hud, sound: h.sound, me: me.index, layer: h.ui, places: world.layout.landmarks });
    h.scene.add(this.ms.group, this.view.group);

    // The HUD.
    h.hud.reset(looks.map((l, i) => ({ accent: accentOf(l), me: i === me.index })));
    h.hud.setOnline(!!online);
    h.hud.show(true);
    const map = h.hud.map;
    map.setTerrain(world.terrain);
    map.reach = 80;
    map.names = world.layout.landmarks;
    h.ui.append(this.play.root);
    this.play.onInteract = (down) => this.interact(down);
    this.play.onUse = (slot) => (this.packAct = ((++this.packN & 511) << 5) | slot);
    this.play.onDrop = (slot) => (this.packAct = ((++this.packN & 511) << 5) | 16 | slot);

    // The controls: Free For All's buttons and keys.
    const c = h.controls;
    c.layout = "ffa";
    c.reset();
    c.onInteract = (down) => this.interact(down);
    c.onPack = () => this.play.openPack(!this.play.packOpen);
    c.onSlot = (slot, drop) => this.play.key(slot, drop);
    h.rig.follow(true, { x: me.x, z: me.z, y: me.y, stance: me.stance, ground: me.h });
  }

  /** An online match from its start (or a rejoin's log and snapshot). */
  static online(host: ModeHost, world: OpenWorld, start: StartInfo, myId: string, net: NetClient, log: readonly WireEvent[] = [], snap?: MatchSnap): FfaMode {
    const src = new OnlineMatch(start, myId, net, matchWorldFor(world, start.ffa!.map), log, snap);
    src.interpMs = host.settings.dataSaver ? src.interpMs + 90 : src.interpMs;
    return new FfaMode(host, world, src, start.roster.map((r) => r.look), { net, myId });
  }

  static fromSync(host: ModeHost, world: OpenWorld, sync: MatchSync, myId: string, net: NetClient): FfaMode {
    return FfaMode.online(host, world, { seed: sync.seed, s: sync.s, roster: sync.roster, init: [], ffa: sync.ffa }, myId, net, sync.log, sync.snap);
  }

  /** Practice: the mode on your own. */
  static practice(host: ModeHost, world: OpenWorld, def: ModeDef, seed: number, name: string): FfaMode {
    return new FfaMode(host, world, new LocalSource(def, seed, matchWorldFor(world, def.map), name), [], null);
  }

  get match(): Match {
    return this.src.match;
  }

  /** The seed of the match being played (a rejoin's sync for another match starts afresh). */
  get seed(): number {
    return this.src.match.seed;
  }

  private interact(down: boolean): void {
    if (down) this.press = (this.press + 1) & 255;
    this.hold = down;
  }

  receive(msg: ServerMsg): boolean {
    if (msg.t !== "msync" || !this.online) return false;
    // Back after a drop: the match rebuilt from the server's log (the screen carries on).
    if (msg.sync.seed !== this.src.match.seed) return false;
    const next = new OnlineMatch({ seed: msg.sync.seed, s: msg.sync.s, roster: msg.sync.roster, init: [], ffa: msg.sync.ffa }, this.online.myId, this.online.net, matchWorldFor(this.world, msg.sync.ffa.map), msg.sync.log, msg.sync.snap);
    this.src.dispose();
    this.src = next;
    return true;
  }

  // ── Fixed step ─────────────────────────────────────────────────────────────

  update(dt: number): void {
    const h = this.host;
    const c = h.controls;
    const src = this.src;
    const m = src.match;
    const me = src.me!;
    c.update();
    const live = me.status === "alive" && m.phase === "play" && !this.over && !h.paused;
    c.enabled = (m.phase === "play" || m.phase === "countdown") && !this.over && !h.paused;
    if (live) {
      const { x, y } = c.move;
      const yaw = h.rig.yaw;
      // The stick is camera-relative: up is where the camera looks.
      src.setInput(Math.cos(yaw) * x - Math.sin(yaw) * y, -Math.sin(yaw) * x - Math.cos(yaw) * y);
      src.setButtons(c.sprint, c.stance as 0 | 1 | 2, c.jumps);
      src.setActions(c.attacks, c.grabs);
      src.setMatchButtons(c.brace, this.press, this.hold, this.packAct);
    } else {
      src.setInput(0, 0);
      src.setButtons(false, 0, c.jumps);
      src.setMatchButtons(false, this.press, false, this.packAct);
    }
    src.step(dt);
    const events = src.drain();
    const cam = h.camera.position;
    this.ms.events(events, m, cam);
    this.view.events(events, m, cam);
    for (const e of events) this.onEvent(e);
    if (this.endAt > 0 && performance.now() >= this.endAt && !this.over) this.finish();
  }

  private onEvent(e: MatchEvent): void {
    const h = this.host;
    const m = this.src.match;
    const me = this.src.me!;
    switch (e.type) {
      case "phase":
        if (e.phase === "play") {
          const b = this.src.def.blurb;
          h.hud.pushFeed(getLang() === "pcm" && b.pcm ? b.pcm : b.en, "info");
          h.haptic("select");
        }
        break;
      case "won": {
        const mine = e.squad >= 0 && e.squad === m.squads[me.index];
        if (mine) h.sound.win();
        else h.sound.lose();
        const who = e.id ? m.get(e.id) : null;
        h.hud.pushFeed(mine ? t("You won") : who ? `${who.name} ${t("won")}` : t("Match over"), mine ? "safe" : "out");
        break;
      }
      case "ended":
        if (this.endAt < 0) this.endAt = performance.now() + RESULTS_AFTER_MS;
        if (!m.winner) h.hud.pushFeed(t("Time"), "info");
        break;
      case "respawn":
        if (e.id === me.id) h.rig.follow(true, { x: me.x, z: me.z, y: me.y, stance: me.stance, ground: me.h });
        break;
      default:
        break;
    }
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  render(dt: number): void {
    const h = this.host;
    const c = h.controls;
    const m = this.src.match;
    const me = this.src.me!;
    const cam = h.camera.position;
    const md = c.consumeMouse();
    if (c.enabled) h.rig.orbit(c.look.x, c.look.y, dt, md.x, md.y);
    h.crowd.update(dt, m.contestants, cam);

    // Who the camera follows: you; out for good, someone still in (your squad first).
    let target = me;
    if (me.status !== "alive" && m.respawnIn(me) < 0) {
      if (this.spectate < 0 || m.contestants[this.spectate]?.status !== "alive") {
        const alive = m.contestants.filter((x) => x.status === "alive");
        const pick = alive.find((x) => m.sameSquad(x, me)) ?? alive[0];
        this.spectate = pick ? pick.index : -1;
      }
      if (this.spectate >= 0) target = m.contestants[this.spectate];
    }
    if (h.rig.firstPerson && target === me) h.rig.eyeValid = !!h.crowd.eye(me.index, h.rig.eye);
    h.rig.update(dt, { x: target.x, z: target.z, y: target.y, stance: target.stance, ground: target.h });
    this.focus.set(target.x, target.h, target.z);
    this.world.update(dt, this.focus, cam);

    // The map: your squad and the objectives only (rivals aren't shown: a holder's ping is the point).
    this.marks.length = 0;
    const tg = this.view.target(m);
    const extra = {
      target: tg ? { kind: tg.kind, d: tg.d, label: tg.prop ? t(PROP_NAME[tg.prop]) : undefined, progress: 0 } : null,
      objective: m.phase === "play" ? this.view.objectiveLine(m, this.src.measures) : "",
    };
    const { pin } = this.ms.update(dt, m, cam, this.marks, extra);
    const { goal } = this.view.update(dt, m, h.camera, this.marks, h.rig.firstPerson && target === me);
    h.hud.setMap({ x: target.x, z: target.z, heading: target.heading, out: me.status !== "alive" }, this.marks, null, h.rig.yaw);
    h.hud.setCompass(h.rig.yaw, target, null, this.world.layout.landmarks, pin, goal);
    h.hud.setTimer(m.phase === "play" ? m.timeLeft : m.settings.time, m.phase === "play" && m.timeLeft <= 30);

    // The countdown.
    if (m.phase === "countdown") {
      const n = Math.max(1, Math.ceil(m.phaseDuration - m.phaseTime));
      if (n !== this.lastCount) {
        this.lastCount = n;
        h.hud.setCountdown(n, 0);
        h.sound.countTick(n === 1);
      }
    } else if (this.lastCount !== 0) {
      this.lastCount = 0;
      h.hud.setCountdown(0, 0);
    }

    // The buttons: melee's always there in play; holding someone, the finishers.
    const live = me.status === "alive" && m.phase === "play";
    h.controls.showActions(live || m.phase === "countdown");
    h.controls.setNear(live, live);
    const mel = m.module<MeleeModule>("melee");
    h.controls.setFinisher(!!mel && live && mel.clinchOf(me.index) >= 0);
    h.controls.setStamina(me.stamina, me.sprinting);

    h.draw(LOOKS.naija);
  }

  /** The match is over: the result, for the session's results screen. */
  private finish(): void {
    const m = this.src.match;
    const me = this.src.me!;
    this.over = true;
    this.host.controls.enabled = false;
    this.host.controls.showActions(false);
    this.play.openPack(false);
    const st = m.standings();
    // Online, the server's measures; practice, the match's own.
    const measures = this.src.measures;
    const r: ModeResult = {
      def: this.src.def,
      standings: st.map((s) => {
        const c = m.get(s.id)!;
        return { ...s, objective: measures ? (measures[c.index] ?? s.objective) : s.objective, name: c.name, me: c === me, look: this.looks[c.index] };
      }),
      won: !!m.winner && m.winner.squad === m.squads[me.index],
      online: !!this.online,
      seconds: m.elapsed,
      measure: measureName(m),
    };
    this.host.onEnd(r);
  }

  dispose(): void {
    const h = this.host;
    this.src.dispose();
    h.scene.remove(this.world.group, this.ms.group, this.view.group);
    this.ms.dispose();
    this.view.dispose();
    this.play.root.remove();
    const c = h.controls;
    c.layout = "rlgl";
    c.onInteract = c.onPack = null;
    c.onSlot = null;
    c.reset();
    c.setNear(false, false);
    h.crowd.setPacks(false);
    h.hud.map.zone = null;
    h.hud.map.hints = [];
    h.hud.setCountdown(0, 0);
    h.rig.near = null;
  }
}

/** What the mode's measure is called on the results ("" when it has none). */
function measureName(m: Match): string {
  const f = m.module<FlagsModule>("flags");
  if (m.module<CaptureModule>("capture")) return "Seconds in the rally point";
  if (!f) return "";
  if (f.claimHold > 0) return "Longest hold (s)";
  if (f.extractAt > 0 || f.ping > 0) return "Seconds held";
  return "Deliveries";
}
