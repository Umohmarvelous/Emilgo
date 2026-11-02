// Free For All (SPEC-V3 §4, §9; Phase 4) behind the GameMode seam: one
// match on Naija World — online (a copy of the server's match, net/
// onlineMatch.ts) or a practice walk on your own (a local match, no bots:
// there are none, ever). The shared match scene draws the zone, the items and
// Airfall (world/matchScene.ts); the Free For All view adds melee and the
// flags (world/ffa.ts), and the cars their own (world/vehicles.ts: driving
// pulls the camera back and swings it behind the car); the session lends the renderer, the people, the HUD
// and the controls (modes/types.ts).

import { Vector3 } from "three";

import { RADIO_IDS, RADIO_NAME, type RadioId } from "../audio/radio";
import { HARMATTAN, SURVIVAL, VEHICLES } from "../config";
import { ITEM_DEFS } from "../content/items";
import { type ModeDef } from "../content/modes";
import { Rng } from "../core/rng";
import type { Contestant } from "../game/core/body";
import { Match, settingsOf, weeklyMutator, type MatchWorld } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import type { CaptureModule } from "../game/modules/capture";
import type { FlagsModule } from "../game/modules/flags";
import type { MeleeModule } from "../game/modules/melee";
import type { HarmattanModule } from "../game/modules/harmattan";
import type { VehiclesModule } from "../game/modules/vehicles";
import { LOOKS } from "../graphics/grade";
import type { OpenWorld } from "../maps/open/build";
import { matchWorldOf } from "../maps/open/matchWorld";
import type { NetClient } from "../net/client";
import type { MatchSnap, MatchSync, WireEvent } from "../net/matchWire";
import { OnlineMatch } from "../net/onlineMatch";
import type { ServerMsg, StartInfo } from "../net/protocol";
import { fromWire, type WireLook } from "../shop/catalog";
import type { MapMark } from "../ui/hud";
import type { AirfallModule } from "../game/modules/airfall";
import { DeadView } from "../world/deadView";
import type { SurvivalModule } from "../game/modules/survival";
import type { ItemsModule } from "../game/modules/items";
import { getLang, t } from "../ui/i18n";
import { PING_LINES } from "../ui/quickchat";
import { PlayHud } from "../ui/play";
import { accentOf } from "../world/crowd";
import { displacement, FfaView, PLAY_SCORE, PROP_NAME } from "../world/ffa";
import { el, esc, fmtTime } from "../ui/dom";
import { randomLook, type Look } from "../world/human/wardrobe";
import { MatchScene } from "../world/matchScene";
import { GadgetView } from "../world/gadgets";
import { ModesView } from "../world/modesView";
import { VehicleView } from "../world/vehicles";
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

  constructor(readonly def: ModeDef, seed: number, world: MatchWorld, name: string, zombies = 0) {
    // A run has no weekly Free For All mutator (Dead Streets' own come later), and brings its zombie pool.
    const mu = def.tags?.includes("staked") || def.family === "survival" ? undefined : weeklyMutator(Date.now());
    const pool = Array.from({ length: zombies }, (_, i) => ({ id: `z${i}`, name: "", bot: true, squad: 1 }));
    this.match = new Match({ seed, world, settings: settingsOf(def, false, mu), contestants: [{ id: "me", name, bot: false }, ...pool], countdown: 3 });
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

/** A run's result: the tally, the trace, and the caches, lore and vault it missed. */
function runResult(sv: SurvivalModule, trace: number[]): NonNullable<ModeResult["run"]> {
  return { tally: { ...sv.tally }, trace: trace.slice(), missed: sv.finds.filter((f) => !sv.found.has(f.k) && f.kind !== "egg").map((f) => [f.x, f.z] as [number, number]) };
}

/** The winning-streak glow on someone's clothes. */
const STREAK_GLOW = 0x5a3c00;

/** A squad ping stays on the map this long (s). */
const PING_SHOW = 8;

export class FfaMode implements GameMode {
  over = false;
  private src: Source;
  private readonly ms: MatchScene;
  private readonly view: FfaView;
  private readonly cars: VehicleView | null;
  private readonly gadgets: GadgetView;
  private readonly modes6: ModesView;
  /** Dead Streets' screen side (a run only). */
  private readonly dead: DeadView | null;
  private dimmed = 0;
  /** The Harmattan: the dust now (eased), as last set on the world; in a storm; whose siren has sounded. */
  private dust = 0;
  private dustSet = 0;
  private inStorm = false;
  private sirenAt = -1;
  private readonly dimLook = { ...LOOKS.naija };
  /** The car you were in last frame (−1: none), and your radio's station. */
  private inCar = -1;
  private station: RadioId | null = null;
  private readonly play = new PlayHud();
  private readonly focus = new Vector3();
  private readonly marks: MapMark[] = [];
  private readonly looks: Look[];
  private press = 0;
  private hold = false;
  private packN = 0;
  private packAct = 0;
  private endAt = -1;
  /** The play of the game so far, and your trail for the heat map. */
  private best = { score: 0, text: "" };
  private readonly trail: [number, number, number][] = [];
  private trailAt = 0;
  /** A run's trace for the server's check: t, x, z and the floor under you, once a second of play. */
  private readonly trace: number[] = [];
  private traceAt = 0;
  private lastCount = -1;
  private spectate = -1;
  /** The spectators' Airfall vote panel (§10.6), and which vote it shows (−1: hidden). */
  private readonly voteEl = el("div", "airvote glass");
  private voteFor = -1;
  private voteKey = "";
  /** Squad pings on the map (§10.7): what, where, until when (seconds of play). */
  private readonly pings: { k: number; x: number; z: number; until: number }[] = [];

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
    // The streak glow (§10.18): 3 wins in a row or more, as the server's profile says.
    wire.forEach((w, i) => {
      if ((w?.st ?? 0) >= 3) h.crowd.setTint(i, null, STREAK_GLOW);
    });
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
    this.cars = m.module<VehiclesModule>("vehicles") ? new VehicleView({ crowd: h.crowd, sound: h.sound, rig: h.rig, me: me.index, stands: m.world.fuel ?? [] }) : null;
    if (this.cars) h.scene.add(this.cars.group);
    this.gadgets = new GadgetView({ crowd: h.crowd, hud: h.hud, sound: h.sound, me: me.index });
    h.scene.add(this.gadgets.group);
    this.modes6 = new ModesView({ crowd: h.crowd, hud: h.hud, sound: h.sound, me: me.index });
    h.scene.add(this.modes6.group);
    this.dead = m.module("survival") ? new DeadView({ crowd: h.crowd, hud: h.hud, sound: h.sound, me: me.index, layer: h.ui, tier: h.spec.tier }) : null;
    if (this.dead) {
      h.scene.add(this.dead.group);
      this.dead.setup(m, world.fog, world.clear);
      // Harmattan Haze week (§3.4 #11): the dust over the dead city.
      if (m.module<SurvivalModule>("survival")?.mutator === "haze") {
        this.dust = this.dustSet = 0.6;
        world.setDust(0.6, HARMATTAN.see * 1.4);
      }
      h.renderer.setClearColor(world.clear);
    }

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
    c.onRadio = () => this.nextStation();
    if (this.dead) c.setSurvival(true);
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

  /** A Dead Streets run: you and the zombie pool, refereed here (the server checks it after). */
  static run(host: ModeHost, world: OpenWorld, def: ModeDef, seed: number, name: string): FfaMode {
    return new FfaMode(host, world, new LocalSource(def, seed, matchWorldFor(world, def.map), name, SURVIVAL.cap), [], null);
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
    if (msg.t === "sping") {
      this.showPing(msg.from, msg.k, msg.x, msg.z);
      return true;
    }
    if (msg.t !== "msync" || !this.online) return false;
    // Back after a drop: the match rebuilt from the server's log (the screen carries on).
    if (msg.sync.seed !== this.src.match.seed) return false;
    const next = new OnlineMatch({ seed: msg.sync.seed, s: msg.sync.s, roster: msg.sync.roster, init: [], ffa: msg.sync.ffa }, this.online.myId, this.online.net, matchWorldFor(this.world, msg.sync.ffa.map), msg.sync.log, msg.sync.snap);
    this.src.dispose();
    this.src = next;
    return true;
  }

  // ── The spectators' Airfall vote (§10.6) ───────────────────────────────────

  private votePanel(m: Match, me: Contestant): void {
    const air = m.module<AirfallModule>("airfall");
    const b = air?.ballot;
    if (!b || me.status === "alive" || m.elapsed >= b.until) {
      if (this.voteFor >= 0) {
        this.voteFor = -1;
        this.voteEl.remove();
      }
      return;
    }
    b.spots.forEach((s) => this.marks.push({ x: s.x, z: s.z, kind: "crate" }));
    const voted = b.cast.has(me.index);
    const key = `${b.crate}:${voted}:${b.votes.join(",")}:${Math.ceil(b.until - m.elapsed)}`;
    if (key === this.voteKey) return;
    this.voteKey = key;
    if (this.voteFor < 0) {
      this.voteFor = b.crate;
      this.host.ui.append(this.voteEl);
    }
    const near = (x: number, z: number) => {
      let best = "";
      let bd = Infinity;
      for (const l of this.world.layout.landmarks) {
        const d = Math.hypot(l.x - x, l.z - z);
        if (d < bd) {
          bd = d;
          best = l.name;
        }
      }
      return best;
    };
    this.voteEl.innerHTML = `<span class="label">${esc(t("Where should the next Airfall land?"))} <span class="num">${Math.max(0, Math.ceil(b.until - m.elapsed))} s</span></span>
      <div class="opts">${b.spots.map((s, k) => `<button class="btn ${voted ? "secondary" : "primary"}" data-vote="${k}" ${voted ? "disabled" : ""}>${"ABC"[k]} · ${esc(t("near"))} ${esc(near(s.x, s.z))}${voted ? ` <b class="num">${b.votes[k]}</b>` : ""}</button>`).join("")}</div>`;
    for (const btn of this.voteEl.querySelectorAll<HTMLButtonElement>("[data-vote]")) {
      btn.onclick = () => {
        const k = Number(btn.dataset.vote);
        if (this.online) this.online.net.send({ t: "mvote", c: k });
        else air?.vote(m, me, k);
        btn.disabled = true;
      };
    }
  }

  // ── Squad pings (§10.7) ────────────────────────────────────────────────────

  /** Where ping k points: you (Help, Here), the nearest item on the ground (Item), or 18 m where you look. */
  pingSpot(k: number): { x: number; z: number } | null {
    const m = this.src.match;
    const me = this.src.me;
    if (!me || me.status !== "alive") return null;
    if (k === 1 || k === 4) return { x: me.x, z: me.z };
    if (k === 2) {
      let best: { x: number; z: number } | null = null;
      let bestD = 30;
      for (const it of m.module<ItemsModule>("items")?.items ?? []) {
        if (it.taken) continue;
        const d = Math.hypot(it.x - me.x, it.z - me.z);
        if (d < bestD) {
          bestD = d;
          best = { x: it.x, z: it.z };
        }
      }
      if (best) return best;
    }
    // The camera looks along (−sin yaw, −cos yaw).
    const yaw = this.host.rig.yaw;
    return { x: me.x - Math.sin(yaw) * 18, z: me.z - Math.cos(yaw) * 18 };
  }

  /** A ping from `from` (you or a squad mate): on the map for a few seconds, and in the feed. */
  showPing(from: string, k: number, x: number, z: number): void {
    const m = this.src.match;
    const c = m.get(from);
    if (!c) return;
    this.pings.push({ k, x, z, until: m.elapsed + PING_SHOW });
    if (this.pings.length > 8) this.pings.shift();
    const what = t(PING_LINES[k] ?? "Here");
    this.host.hud.pushFeed(`${c === this.src.me ? t("You") : c.name}: ${what}`, k === 3 ? "out" : "safe");
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
    this.cars?.events(events, m, cam);
    this.gadgets.events(events, m, cam);
    this.modes6.events(events, m);
    this.dead?.events(events, m);
    for (const e of events) this.onEvent(e);
    // Your trail, once a second of play (the heat map).
    if (m.phase === "play" && me.status === "alive" && m.elapsed >= this.trailAt) {
      this.trailAt = m.elapsed + 1;
      const flags = m.module<FlagsModule>("flags");
      this.trail.push([Math.round(me.x), Math.round(me.z), flags?.heldBy(me.index) ? 1 : 0]);
    }
    // A run: where you went, for the server's check (and where the run ended).
    if (this.dead && m.phase !== "walkout" && m.phase !== "countdown" && (m.elapsed >= this.traceAt || (m.over && this.trace[this.trace.length - 4] !== m.elapsed))) {
      this.traceAt = m.elapsed + 1;
      const r1 = (v: number) => Math.round(v * 10) / 10;
      this.trace.push(r1(m.elapsed), r1(me.x), r1(me.z), r1(me.h));
    }
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
          const mu = m.settings.mutator;
          if (mu) h.hud.pushFeed(`${t("This week")}: ${t(MUTATOR_NAME[mu])}`, "info");
          h.haptic("select");
        }
        break;
      case "down": {
        // The play of the game: the best displacement so far.
        const score = PLAY_SCORE[e.why] ?? 0;
        const by = e.by ? m.get(e.by) : null;
        const c = m.get(e.id);
        if (c && score > this.best.score) {
          const line = displacement(e.why, by?.name ?? null, c.name, c.h < -0.3);
          if (line) this.best = { score, text: `${line} (${fmtTime(m.elapsed)})` };
        }
        break;
      }
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
      // ── Cars ──
      case "wreck":
        // Your car blows up: the moment in slow motion, on your screen only.
        if (e.state >= 4 && e.car === this.inCar) {
          h.crowd.slowFall(me.index, 0.3, 1.6);
          h.rig.push(0.8, 1.6);
          h.haptic("heavy");
        } else if (e.state === 3 && e.car === this.inCar) h.hud.pushFeed(t("Your car is on fire"), "out");
        break;
      case "fuel":
        if (e.car !== this.inCar) break;
        if (e.why === "empty") h.hud.pushFeed(t("Out of fuel"), "out");
        else if (e.why === "boy") h.hud.pushFeed(t("Fuel boy: +10 s"), "safe");
        else if (e.why === "can") h.hud.pushFeed(t("Jerrycan: +15 s"), "safe");
        break;
      case "hijack":
        if (e.how === "done" && e.car === this.inCar && e.id !== me.id) h.hud.pushFeed(t("Pulled out of your car"), "out");
        break;
      case "dodge":
        if (e.id === me.id) h.hud.pushFeed(t("Too fast for the sky"), "safe");
        break;
      case "use": {
        // The first time you use an item: how it's beaten (SPEC-V3 §10.16).
        if (e.id !== me.id) break;
        const seen = h.settings.itemsSeen.split(",").filter(Boolean);
        const counter = ITEM_DEFS[e.kind].counter;
        if (seen.includes(e.kind) || !counter) break;
        h.settings.itemsSeen = [...seen, e.kind].join(",");
        h.saveSettings();
        h.hud.pushFeed(`${t("Beaten by")}: ${getLang() === "pcm" && counter.pcm ? counter.pcm : counter.en}`, "info");
        break;
      }
      case "car":
        if (m.phase === "play") h.hud.pushFeed(t("A danfo has come"), "info");
        break;
      default:
        break;
    }
  }

  /** The radio: off, then each station in turn. */
  private nextStation(): void {
    const i = this.station ? RADIO_IDS.indexOf(this.station) : -1;
    this.station = i + 1 < RADIO_IDS.length ? RADIO_IDS[i + 1] : null;
    this.host.sound.carRadio(this.station);
  }

  /** In a car: the camera, the buttons, the HUD's panel, the engine and the radio. Returns the HUD's car panel. */
  private carFrame(dt: number, m: Match, me: Contestant, cam: Vector3): { panel: NonNullable<Parameters<MatchScene["update"]>[4]>["car"]; target: { kind: "car"; label: string; progress: number; d: number } | null } {
    const h = this.host;
    const v = m.module<VehiclesModule>("vehicles");
    const seat = v && me.status === "alive" ? m.seatOf(me) : -1;
    const car = seat >= 0 ? v!.cars[seat] : undefined;
    // Out of the car: the radio stops.
    if (seat !== this.inCar) {
      if (seat < 0 && this.station) {
        this.station = null;
        h.sound.carRadio(null);
      }
      this.inCar = seat;
    }
    // The camera: further back and higher; behind the car while you aren't looking round.
    const k = 1 - Math.exp(-dt * 4);
    h.rig.arm += ((car ? 2.6 : 1) - h.rig.arm) * k;
    h.rig.lift += ((car ? 0.7 : 0) - h.rig.lift) * k;
    const c = h.controls;
    if (car && car.speed > 1 && Math.hypot(c.look.x, c.look.y) < 0.05) {
      const want = car.heading + Math.PI;
      const d = Math.atan2(Math.sin(want - h.rig.yaw), Math.cos(want - h.rig.yaw));
      h.rig.yaw += d * (1 - Math.exp(-dt * 2.2));
    }
    c.setDriving(car ? (car.seats[0] === me.index ? "driver" : "rider") : null, !!car?.hijack);
    // The engine you hear: yours, or the nearest going.
    let level = 0;
    let rev = 0;
    if (car && car.state < 4) {
      level = 1;
      rev = car.speed / VEHICLES.kinds[car.kind].top;
    } else if (v) {
      for (const o of v.cars) {
        if (!o || o.state >= 4 || (o.seats[0] < 0 && o.speed < 0.5)) continue;
        const near = 1 - Math.hypot(o.x - cam.x, o.z - cam.z) / 30;
        if (near > level) {
          level = near * 0.7;
          rev = o.speed / VEHICLES.kinds[o.kind].top;
        }
      }
    }
    h.sound.engine(this.over ? 0 : level, rev);
    // What interact would do at a car.
    let target: { kind: "car"; label: string; progress: number; d: number } | null = null;
    const o = v && me.status === "alive" && m.phase === "play" ? v.option(m, me) : null;
    if (o) {
      const oc = v!.cars[o.car];
      const label = o.kind === "drive" ? t("Drive") : o.kind === "ride" ? t("Get in") : o.kind === "pull" ? t("Hold: pull them out") : t("Get out");
      const mine = oc.hijack && oc.hijack.by === me.index;
      target = { kind: "car", label, progress: mine ? Math.min(1, (m.elapsed - oc.hijack!.since) / VEHICLES.hijack.hold) : 0, d: o.d };
    }
    const panel = car
      ? {
          fuel: car.fuel / VEHICLES.fuel.full,
          state: car.state,
          blowIn: car.state === 3 ? car.blow - m.elapsed : -1,
          hijack: !!car.hijack && car.seats[0] === me.index,
          radio: this.station ? RADIO_NAME[this.station] : "",
        }
      : null;
    return { panel, target };
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
    this.votePanel(m, me);
    for (let k = this.pings.length - 1; k >= 0; k--) {
      const p = this.pings[k];
      if (p.until <= m.elapsed) this.pings.splice(k, 1);
      else this.marks.push({ x: p.x, z: p.z, kind: "ping" });
    }
    const tg = this.view.target(m);
    const car = this.carFrame(dt, m, me, cam);
    const flagNear = tg
      ? tg.kind === "mate"
        ? { kind: "job" as const, d: tg.d, label: tg.how === "rescue" ? t("Pull them out of the gutter") : t("Help them up"), progress: 0 }
        : { kind: tg.kind, d: tg.d, label: tg.prop ? t(PROP_NAME[tg.prop]) : undefined, progress: 0 }
      : null;
    const jobNear = this.modes6.target(m);
    const near = jobNear && (!flagNear || jobNear.d < flagNear.d) ? jobNear : flagNear;
    this.cars?.update(dt, m, cam, this.marks);
    const { inSmoke } = this.gadgets.update(dt, m, cam, this.marks);
    const extra = {
      target: car.target && (!near || car.target.d < near.d) ? car.target : near,
      objective: m.phase === "play" ? this.view.objectiveLine(m, this.src.measures) || this.modes6.objectiveLine(m) : "",
      car: car.panel,
      smoke: inSmoke,
      riddle: this.modes6.riddle(m),
    };
    const { pin } = this.ms.update(dt, m, cam, this.marks, extra);
    const { goal: flagGoal } = this.view.update(dt, m, h.camera, this.marks, h.rig.firstPerson && target === me);
    const deadPin = this.dead?.update(dt, m, cam, this.marks).pin ?? null;
    const goal = flagGoal ?? deadPin ?? this.modes6.update(dt, m, this.marks).pin;
    // The Harmattan: the siren, then the dust; footprints gone; headlights on (or in a power cut).
    const hm = m.module<HarmattanModule>("harmattan");
    if (hm) {
      const storm = hm.now(m);
      const nx = hm.next(m);
      if (nx >= 0 && nx <= HARMATTAN.siren && this.sirenAt !== hm.storms.findIndex((s) => s.at - m.elapsed === nx)) {
        this.sirenAt = hm.storms.findIndex((s) => s.at - m.elapsed === nx);
        h.sound.siren();
        h.hud.pushFeed(t("Harmattan! A sandstorm is coming"), "info");
      }
      if (storm && !this.inStorm) this.ms.prints.wipe();
      this.inStorm = !!storm;
      this.dust += ((storm ? 1 : 0) - this.dust) * (1 - Math.exp(-dt * (storm ? 1.5 : 0.8)));
      if (Math.abs(this.dust - this.dustSet) > 0.01) {
        this.dustSet = this.dust;
        this.world.setDust(this.dust, HARMATTAN.see);
        h.renderer.setClearColor(this.world.clear);
      }
    }
    this.cars?.setLights(this.dust > 0.3 || this.dimmed > 0.4);
    // Lights Out: the city as dark as the mode says.
    if (m.module("blackout") && Math.abs(this.modes6.dim - this.dimmed) > 0.01) {
      this.dimmed = this.modes6.dim;
      this.world.setDim(this.dimmed);
      h.renderer.setClearColor(this.world.clear);
    }
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
    const seated = m.seated(me);
    if (this.dead) h.controls.setSurvival(live);
    else if (!seated) h.controls.setNear(live, live);
    const mel = m.module<MeleeModule>("melee");
    h.controls.setFinisher(!!mel && live && mel.clinchOf(me.index) >= 0);
    h.controls.setStamina(me.stamina, me.sprinting);

    // Lights Out: the film look darkens with the city.
    if (this.dimmed > 0.01) {
      this.dimLook.exposure = LOOKS.naija.exposure * (1 - 0.7 * this.dimmed);
      this.dimLook.saturation = LOOKS.naija.saturation * (1 - 0.35 * this.dimmed);
      h.draw(this.dimLook);
    } else h.draw(LOOKS.naija);
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
      ...(this.best.text ? { play: this.best.text } : {}),
      trail: this.trail,
      ...(this.dead ? { run: runResult(m.module<SurvivalModule>("survival")!, this.trace) } : {}),
    };
    this.host.onEnd(r);
  }

  dispose(): void {
    const h = this.host;
    this.src.dispose();
    h.scene.remove(this.world.group, this.ms.group, this.view.group);
    this.ms.dispose();
    this.view.dispose();
    this.cars?.dispose();
    this.gadgets.dispose();
    if (this.dead) {
      h.scene.remove(this.dead.group);
      this.dead.dispose();
      h.controls.setSurvival(false);
    }
    this.modes6.dispose(this.src.match);
    if (this.dimmed) this.world.setDim(0);
    if (this.dustSet) this.world.setDust(0, HARMATTAN.see);
    h.sound.engine(0, 0);
    h.sound.carRadio(null);
    h.rig.arm = 1;
    h.rig.lift = 0;
    this.play.root.remove();
    this.voteEl.remove();
    const c = h.controls;
    c.layout = "rlgl";
    c.onInteract = c.onPack = c.onRadio = null;
    c.setDriving(null, false);
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

/** The weekly mutators' names (§10.13). */
export const MUTATOR_NAME = { juju: "Juju Day: low gravity", rainy: "Rainy Season: slippery ground", market: "Market Day: double items" } as const;

/** What the mode's measure is called on the results ("" when it has none). */
function measureName(m: Match): string {
  const f = m.module<FlagsModule>("flags");
  if (m.module("tag")) return "Seconds human";
  if (m.module("blackout")) return "Seconds unfound";
  if (m.module("economy")) return "Owo banked";
  if (m.module("riddles")) return "Riddles solved";
  if (m.module("rooms")) return "Points";
  if (m.module<CaptureModule>("capture")) return "Seconds in the rally point";
  if (!f) return "";
  if (f.claimHold > 0) return "Longest hold (s)";
  if (f.extractAt > 0 || f.ping > 0) return "Seconds held";
  return "Deliveries";
}
