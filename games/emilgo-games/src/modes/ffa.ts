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
import { GROWTH, GUN_KINDS, GUNS, HARMATTAN, MOVE, SURVIVAL, VEHICLES } from "../config";
import { ITEM_DEFS } from "../content/items";
import { type ModeDef } from "../content/modes";
import { Rng } from "../core/rng";
import type { Contestant } from "../game/core/body";
import { badgeOf, botBadge } from "../rank/awards";
import { FIGURINE_BY_ID, FIGURINES, figurineLook } from "../shop/figurines";
import { Match, settingsOf, weeklyMutator, type MatchWorld } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import type { CaptureModule } from "../game/modules/capture";
import type { FlagsModule } from "../game/modules/flags";
import type { GadgetsModule } from "../game/modules/gadgets";
import type { MeleeModule } from "../game/modules/melee";
import type { HarmattanModule } from "../game/modules/harmattan";
import type { VehiclesModule } from "../game/modules/vehicles";
import { LOOKS } from "../graphics/grade";
import { MUTATOR_NAME } from "../game/weekly";
import type { OpenWorld } from "../maps/open/build";
import { matchWorldOf } from "../maps/open/matchWorld";
import type { NetClient } from "../net/client";
import type { MatchSnap, MatchSync, WireEvent } from "../net/matchWire";
import { OnlineMatch } from "../net/onlineMatch";
import type { ServerMsg, StartInfo } from "../net/protocol";
import { fromWire, type WireLook } from "../shop/catalog";
import type { MapMark } from "../ui/hud";
import type { AirfallModule } from "../game/modules/airfall";
import type { AdFeed } from "../net/ads";
import { BillboardView } from "../world/billboards";
import { DeadView } from "../world/deadView";
import type { SurvivalModule } from "../game/modules/survival";
import type { ItemsModule } from "../game/modules/items";
import type { ZoneModule } from "../game/modules/zone";
import type { FlagsModule as FlagsRules } from "../game/modules/flags";
import type { LineId } from "../audio/voice";
import { gunStats, type GunsModule } from "../game/modules/guns";
import { CombatHud, GUN_NAMES } from "../ui/combat";
import { FieldKit, leftLine, type ZombieBar } from "../ui/fieldkit";
import { armourTier, KITS } from "../world/human/gear";
import { WorldSound } from "../audio/world";
import { emittersOf, Scenery } from "../world/scenery";
import { GunsView } from "../world/gunsView";
import { KillCam, type KillCamFrame } from "../world/killCam";
import { ReplayOverlay } from "../ui/replay";
import { getLang, t } from "../ui/i18n";
import { PING_LINES } from "../ui/quickchat";
import { gameSize } from "../ui/rotate";
import { PlayHud } from "../ui/play";
import { accentOf } from "../world/crowd";
import { displacement, FfaView, PLAY_SCORE, PROP_NAME } from "../world/ffa";
import { el, esc, fmtTime } from "../ui/dom";
import { randomLook, type Look } from "../world/human/wardrobe";
import { MatchScene } from "../world/matchScene";
import { GadgetView } from "../world/gadgets";
import { ModesView } from "../world/modesView";
import { TreasureView } from "../world/treasure";
import type { TreasureModule } from "../game/modules/treasure";
import { GrowthView } from "../world/growth";
import { PowerView, RISE_SECONDS } from "../world/power";
import { WaterFx } from "../world/water";
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
  setButtons(sprint: boolean, stance: 0 | 1 | 2, jump: number, tac?: boolean): void;
  setActions(attack: number, grab: number): void;
  setMatchButtons(brace: boolean, interact: number, hold: boolean, pack: number): void;
  /** Guns (v4): the camera's aim and the gun buttons. */
  setAim(yaw: number, pitch: number, trigger: boolean, ads: boolean, reload: number, swap: number): void;
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
  setButtons(sprint: boolean, stance: 0 | 1 | 2, jump: number, tac = false): void {
    this.match.setButtons("me", sprint, stance, jump, tac);
  }
  setActions(attack: number, grab: number): void {
    this.match.setActions("me", attack, grab);
  }
  setMatchButtons(brace: boolean, interact: number, hold: boolean, pack: number): void {
    this.match.setBrace("me", brace);
    this.match.setInteract("me", interact, hold);
    this.match.setPack("me", pack);
  }
  setAim(yaw: number, pitch: number, trigger: boolean, ads: boolean, reload: number, swap: number): void {
    this.match.setAim("me", yaw, pitch, trigger, ads, reload, swap);
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

const _bar = new Vector3();
const _fwd = new Vector3();

/** The winning-streak glow on someone's clothes. */
const STREAK_GLOW = 0x5a3c00;

/** A squad ping stays on the map this long (s). */
const PING_SHOW = 8;

/** How far off you can hear someone walking, metres. */
const STEP_RANGE = 38;

export class FfaMode implements GameMode {
  over = false;
  private src: Source;
  private readonly ms: MatchScene;
  private readonly view: FfaView;
  private readonly cars: VehicleView | null;
  private readonly gadgets: GadgetView;
  private readonly modes6: ModesView;
  /** Treasure Hunt's boxes, relics and machine (that mode only). */
  private readonly treasure: TreasureView | null;
  /** v5: grown bodies' fiercer look; the Map Print (whether it opened the full map). */
  private readonly growth: GrowthView;
  /** v6 max (3.2): the boosters' transformation, and camouflage. */
  private readonly power: PowerView;
  /** v6 max (3.5): swimming, splashes and ripples. */
  private readonly water: WaterFx;
  /** v6 max: your rise's camera: where it started (yaw, arm), or null. */
  private powerCam: { yaw: number; arm: number } | null = null;
  private printOpened = false;
  /** The announcer's last look: seconds left, and whether you were outside the circle. */
  private lastLeft = Infinity;
  private wasOut = false;
  /** Rivals you killed this match. */
  private kills = 0;
  /** v6 max (3.10): what you did this match, for the awards (rank/awards.ts MatchFeats). */
  private readonly feats = { heads: 0, deaths: 0, deadAt: -9, treasures: 0, uploads: 0, crates: 0, items: 0, boosters: [] as string[], downs: 0, helps: 0, swum: 0 };
  /** Dead Streets' screen side (a run only). */
  private readonly dead: DeadView | null;
  /** The billboards (SPEC-V3 §8), this match's ads once they come, and whether their seconds have been sent. */
  private readonly boards: BillboardView | null;
  private boardFeed: AdFeed | null = null;
  private boardsSent = false;
  private gone = false;
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
  /** Guns (v4): the guns drawn, and the gun HUD (Free For All's shooter modes only). */
  private readonly gunsView: GunsView | null;
  private readonly combat: CombatHud | null;
  /** v6 2.11: the kill cam (the shooter modes; Dead Streets' zombies have none), its tag, what it says, and on screen. */
  private readonly killCam: KillCam | null;
  private readonly kcUi: ReplayOverlay | null;
  private kcCard = { who: "", what: "" };
  private kcOn = false;
  private dryAt = 0;
  private autoTick = 0;
  private stepAt = new Float32Array(0);
  private wasAir = false;
  private wasTac = false;
  private winded = false;
  private autoWas = false;
  /** HUD A (v4 Phase 3): the watch, the plates, the edges, the zombies' bars. */
  private readonly fk = new FieldKit();
  /** Dead Streets: each zombie's health when last seen, its most, and when it was last hurt (seconds of play). */
  private zPrev = new Float32Array(0);
  private zMax = new Float32Array(0);
  private zHitAt = new Float32Array(0);
  private readonly zBars: ZombieBar[] = [];
  /** v4 Phase 8: the places' sounds and the score; the turbines' rotors. */
  private readonly worldSound: WorldSound;
  private readonly scenery: Scenery;
  private actionAt = -99;
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
    // v6 max (3.8): the figurines worn: yours (if owned), what the others' phones sent, now and then a bot's.
    const zombieMatch = !!m.module("survival");
    const figs = m.contestants.map((c, i) => {
      if (zombieMatch && c !== me) return null;
      if (c === me) return h.settings.figs.includes(h.settings.fig) ? (FIGURINE_BY_ID[h.settings.fig] ?? null) : null;
      if (wire[i]) return FIGURINE_BY_ID[wire[i]!.fg ?? ""] ?? null;
      const r = new Rng((m.seed ^ 0xf19) + i * 7919);
      return r.next() < 0.15 ? FIGURINES[Math.floor(r.next() * FIGURINES.length)] : null;
    });
    const looks: Look[] = m.contestants.map((c, i) => (c === me ? h.myLook() : wire[i] ? fromWire(wire[i]!) : figurineLook(randomLook(new Rng((rng.next() * 1e9) ^ (i * 977))), figs[i])));
    this.looks = looks;
    h.crowd.setup(looks, me.index);
    // The streak glow (§10.18): 3 wins in a row or more, as the server's profile says.
    wire.forEach((w, i) => {
      if ((w?.st ?? 0) >= 3) h.crowd.setTint(i, null, STREAK_GLOW);
    });
    h.crowd.hideMyHead = h.rig.firstPerson;
    // v4: everyone a tactical operator (their kit by their colours); Dead Streets' zombies stay as they are.
    const zombies = !!m.module("survival");
    m.contestants.forEach((_c, i) => {
      if (zombies && i !== me.index) return;
      h.crowd.setGear(i, KITS[looks[i].hoodie % KITS.length], 0);
      h.crowd.setFigurine(i, figs[i]);
    });

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
    // v6 max (3.11): text chat in an online match (the room's chat: the server cleans every line).
    h.controls.chatBtn.hidden = !online;
    // v6 max (3.10): the badges worn, over heads: yours, what the others' phones sent, a few for the bots.
    this.view.badges = m.contestants.map((c, i) => (c === me ? badgeOf(h.settings.awards) : wire[i] ? (wire[i]!.aw ?? "") : botBadge(m.seed, i)));
    h.scene.add(this.ms.group, this.view.group);
    this.cars = m.module<VehiclesModule>("vehicles") ? new VehicleView({ crowd: h.crowd, sound: h.sound, rig: h.rig, me: me.index, stands: m.world.fuel ?? [] }) : null;
    if (this.cars) h.scene.add(this.cars.group);
    this.gadgets = new GadgetView({ crowd: h.crowd, hud: h.hud, sound: h.sound, me: me.index });
    h.scene.add(this.gadgets.group);
    this.modes6 = new ModesView({ crowd: h.crowd, hud: h.hud, sound: h.sound, me: me.index });
    h.scene.add(this.modes6.group);
    this.treasure = m.module("treasure") ? new TreasureView({ hud: h.hud, sound: h.sound, me: me.index, layer: h.ui, tier: h.spec.tier }) : null;
    this.growth = new GrowthView(h.crowd);
    this.power = new PowerView(h.crowd, this.ms.pickFx, h.spec.tier);
    h.scene.add(this.power.group);
    this.water = new WaterFx(h.crowd, h.sound);
    h.scene.add(this.water.group);
    this.power.onShock = (who, kind) => {
      const mm = this.src.match;
      const c = mm.contestants[who];
      const mine = who === this.src.me?.index;
      const d = c && this.src.me ? Math.hypot(c.x - this.src.me.x, c.z - this.src.me.z) : 99;
      if (mine || d < 45) h.sound.powerShock(kind, mine ? 1 : Math.max(0.15, 1 - d / 45));
      if (mine) {
        h.hud.flash(kind === 1 ? "#ff7a1a" : "#5ccfff");
        h.haptic("heavy");
      }
    };
    this.power.onFade = (who) => {
      if (who !== this.src.me?.index) return;
      h.sound.powerDown();
      h.hud.pushFeed(t("Your power fades"), "info");
    };
    h.sound.voice.prepare();
    h.scene.add(this.growth.group);
    if (this.treasure) h.scene.add(this.treasure.group);
    const guns = m.module<GunsModule>("guns");
    this.gunsView = guns ? new GunsView({ crowd: h.crowd, sound: h.sound, tier: h.spec.tier, me: me.index, blood: h.settings.blood }) : null;
    this.combat = guns || m.module("survival") ? new CombatHud() : null;
    if (this.gunsView) h.scene.add(this.gunsView.group);
    this.killCam = guns && !m.module("survival") ? new KillCam(h.crowd) : null;
    this.kcUi = this.killCam ? new ReplayOverlay(h.ui) : null;
    this.kcUi?.skipBtn.addEventListener("click", () => {
      h.sound.ui();
      this.endKillCam();
    });
    this.worldSound = new WorldSound(h.sound, h.spec.tier === 0 ? 6 : 12);
    this.worldSound.theme = m.module("survival") ? "dead" : "ffa";
    this.worldSound.setEmitters(emittersOf(world.layout));
    this.scenery = new Scenery(world.layout);
    h.scene.add(this.scenery.group);
    this.dead = m.module("survival") ? new DeadView({ crowd: h.crowd, hud: h.hud, sound: h.sound, me: me.index, layer: h.ui, tier: h.spec.tier, blood: h.settings.blood }) : null;
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

    // The billboards: house boards at once, the booked ads when the feed comes (never asked in Lagos Life).
    const slots = world.layout.boards ?? [];
    this.boards = slots.length
      ? new BillboardView(slots, {
          tier: h.spec.tier,
          night: !!this.dead,
          info: h.houseInfo(this.dead ? "dead" : "ffa"),
          feed: null,
          space: world.space,
          cellOn: (x, z) => world.cellOn(x, z),
          audio: () => ({ on: h.settings.adsAudio, vol: h.settings.master * h.settings.adsVol }),
        })
      : null;
    if (this.boards) {
      h.scene.add(this.boards.group);
      void h.boardFeed(world.layout.id).then((f) => {
        if (this.gone || !f) return;
        this.boardFeed = f;
        this.boards?.setFeed(f);
      });
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
    // HUD A, Field Kit: Free For All and Dead Streets (Ball Haunt keeps its own).
    h.ui.append(this.fk.root);
    h.hud.setFieldKit(true);
    this.play.root.classList.add("fieldkit");
    this.dead?.setFieldKit(true);
    if (this.combat) {
      h.ui.append(this.combat.root);
      this.combat.onSwap = () => h.controls.swap();
    }
    this.play.onInteract = (down) => this.interact(down);
    this.play.onUse = (slot) => (this.packAct = ((++this.packN & 511) << 5) | slot);
    this.play.onDrop = (slot) => (this.packAct = ((++this.packN & 511) << 5) | 16 | slot);

    // The controls: Free For All's buttons and keys.
    const c = h.controls;
    c.layout = "ffa";
    // The interact prompt, the backpack and the weapon panel are arranged with the buttons (v4 rework).
    c.extraRoots.length = 0;
    c.extraRoots.push(this.play.root);
    if (this.combat) c.extraRoots.push(this.combat.root);
    c.arrange();
    c.reset();
    c.onInteract = (down) => this.interact(down);
    c.onPack = () => this.play.openPack(!this.play.packOpen);
    c.onSlot = (slot, drop) => this.play.key(slot, drop);
    c.onRadio = () => this.nextStation();
    if (this.dead) c.setSurvival(true);
    c.setGuns(!!guns);
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
    this.endKillCam();
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

  /** Auto-shoot: is the crosshair on someone it could hit? Checked every other frame; the last answer between. */
  private onEnemy(m: Match, me: Contestant): boolean {
    if (this.autoTick++ % 2) return this.autoWas;
    const h = this.host;
    const g = m.module<GunsModule>("guns");
    const slot = g ? g.slot[me.index] : 0;
    if (g && g.mag[me.index][slot] <= 0) return (this.autoWas = false);
    const range = g ? GUNS.kinds[GUN_KINDS[g.gun[me.index][slot]] ?? "pistol"].range : SURVIVAL.gun.range;
    const yaw = h.rig.aimYaw;
    const pitch = h.rig.aimPitch;
    const cp = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cp;
    const o = h.camera.position;
    const reach = range + Math.hypot(o.x - me.x, o.z - me.z);
    const space = m.world.space;
    const gd = m.module<GadgetsModule>("gadgets");
    for (const c of m.contestants) {
      if (c === me || c.status !== "alive" || (!this.dead && m.squads[c.index] === m.squads[me.index]) || m.seated(c)) continue;
      // v6 max: auto-shoot can't see into smoke or camouflage, and takes a rival in your colours for a mate.
      if (gd && (gd.hidden(m, c.index) || gd.shownSquad(m, c.index) === m.squads[me.index])) continue;
      const px = c.x - o.x;
      const pz = c.z - o.z;
      const dist = px * dx + pz * dz;
      if (dist < 1) continue;
      const along = dist / Math.max(1e-3, cp * cp);
      if (along > reach) continue;
      // Across: the body's radius. Up: from its feet to its head.
      const cx = o.x + dx * along - c.x;
      const cz = o.z + dz * along - c.z;
      if (cx * cx + cz * cz > 0.2) continue;
      const y = o.y + dy * along - (c.h + c.y);
      if (y < 0 || y > 1.85) continue;
      if (space.ray(o.x, o.y, o.z, dx, dy, dz, along) < along - 0.4) continue;
      return (this.autoWas = true);
    }
    return (this.autoWas = false);
  }

  // ── Fixed step ─────────────────────────────────────────────────────────────

  update(dt: number): void {
    const h = this.host;
    const c = h.controls;
    const src = this.src;
    const m = src.match;
    const me = src.me!;
    const live = me.status === "alive" && m.phase === "play" && !this.over && !h.paused;
    // The awards' metres swum.
    if (live && me.swim) this.feats.swum += Math.min(10, Math.hypot(me.vx, me.vz)) * dt;
    c.autoTrigger = live && !m.seated(me) && h.settings.autoFire && (!!this.gunsView || !!this.dead) && this.onEnemy(m, me);
    c.update();
    c.enabled = (m.phase === "play" || m.phase === "countdown") && !this.over && !h.paused;
    if (live) {
      const { x, y } = c.move;
      const yaw = h.rig.yaw;
      // The stick is camera-relative: up is where the camera looks.
      src.setInput(Math.cos(yaw) * x - Math.sin(yaw) * y, -Math.sin(yaw) * x - Math.cos(yaw) * y);
      src.setButtons(c.sprint, c.stance as 0 | 1 | 2, c.jumps, c.tac);
      src.setActions(c.attacks, c.grabs);
      src.setMatchButtons(c.brace, this.press, this.hold, this.packAct);
      if (this.gunsView) src.setAim(h.rig.aimYaw, h.rig.aimPitch, c.trigger, c.ads, c.reloads, c.swaps);
      // Dead Streets: shooting, you face where you aim (v4 rework: "when my 3d model fires a bullet he does not aim").
      if (this.dead && c.trigger) me.heading = h.rig.aimYaw + Math.PI;
    } else {
      src.setInput(0, 0);
      src.setButtons(false, 0, c.jumps);
      src.setMatchButtons(false, this.press, false, this.packAct);
      if (this.gunsView) src.setAim(h.rig.aimYaw, h.rig.aimPitch, false, false, c.reloads, c.swaps);
    }
    src.step(dt);
    if (live && this.dead && c.trigger) me.heading = h.rig.aimYaw + Math.PI;
    const events = src.drain();
    const cam = h.camera.position;
    this.ms.events(events, m, cam);
    this.view.events(events, m, cam);
    this.cars?.events(events, m, cam);
    this.gadgets.events(events, m, cam);
    this.power.events(events, m, cam);
    this.modes6.events(events, m);
    this.treasure?.events(events, m, cam);
    this.dead?.events(events, m);
    this.killCam?.note(events, m);
    if (!this.killCam?.active) this.gunsView?.events(events, m, cam);
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

  /** v6 max (3.10): the awards' count of what you did (your own events only). */
  private tally(e: MatchEvent, m: Match, me: Contestant): void {
    const f = this.feats;
    switch (e.type) {
      case "kill":
      case "eliminated": {
        // Going down for good, once (a kill and its elimination come together).
        const id = e.type === "kill" ? e.tg : e.id;
        if (id === me.id && m.elapsed - f.deadAt > 1) {
          f.deaths++;
          f.deadAt = m.elapsed;
        }
        break;
      }
      case "tre":
        if (e.id === me.id && (e.how === "find" || e.how === "take")) f.treasures++;
        break;
      case "tbox":
        // v7: an instant hunt's find never travels as "tre": it is the box.
        if (e.id === me.id && e.found >= 0 && m.module<TreasureModule>("treasure")?.instant) f.treasures++;
        break;
      case "upl":
        if (e.id === me.id && e.how === "done") f.uploads++;
        break;
      case "open":
        if (e.id === me.id) f.crates++;
        break;
      case "use":
        if (e.id === me.id) f.items++;
        break;
      case "take":
        if (e.id === me.id && (e.kind === "strength-booster" || e.kind === "speed-booster") && !f.boosters.includes(e.kind)) f.boosters.push(e.kind);
        break;
      case "down":
        if (e.by === me.id && e.id !== me.id) f.downs++;
        break;
      case "helpup":
        if (e.id === me.id) f.helps++;
        break;
    }
  }

  private onEvent(e: MatchEvent): void {
    const h = this.host;
    const m = this.src.match;
    const me = this.src.me!;
    if (e.type === "kill" && e.by === me.id && e.tg !== me.id) {
      const tg = m.get(e.tg);
      if (tg && !m.sameSquad(tg, me)) {
        this.kills++;
        if (e.head) this.feats.heads++;
      }
    }
    this.tally(e, m, me);
    if (e.type === "kill" && e.tg === me.id && e.by && e.by !== me.id && e.how !== "zone" && m.phase === "play") this.killedBy(m, me, e);
    switch (e.type) {
      case "phase":
        if (e.phase === "play") {
          h.sound.voice.say(startLine(m), true);
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
      case "eliminated": {
        // The announcer: who is out (you, a teammate, an enemy; the name is on screen).
        const c = m.get(e.id);
        if (c && !(m.module("survival") && c.bot)) h.sound.voice.eliminated(c === me ? "you" : m.sameSquad(c, me) ? "mate" : "enemy");
        break;
      }
      case "flag":
        if (e.how === "take" || e.how === "found") {
          const c = e.id ? m.get(e.id) : null;
          if (c === me) h.sound.voice.say("flag_taken");
          else if (c && !m.sameSquad(c, me)) h.sound.voice.say("flag_enemy");
        }
        break;
      case "flare":
        if (m.phase === "play") h.sound.voice.say("airdrop");
        break;
      case "zone": {
        // A new circle: closing (the last one said as the final circle). Not the first, set as play starts.
        const z = m.module<ZoneModule>("zone");
        if (z && m.elapsed > 5) h.sound.voice.say(e.phase >= z.phases.length - 1 ? "zone_final" : "zone_closing");
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
        this.endKillCam();
        if (this.endAt < 0) this.endAt = performance.now() + RESULTS_AFTER_MS;
        if (!m.winner) h.hud.pushFeed(t("Time"), "info");
        break;
      case "respawn":
        if (e.id === me.id) {
          this.endKillCam();
          h.rig.follow(true, { x: me.x, z: me.z, y: me.y, stance: me.stance, ground: me.h });
        }
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
        // v6 max (3.2): a booster: the surge, and what it does.
        if ((e.kind === "strength-booster" || e.kind === "speed-booster") && e.id === me.id) {
          const str = e.kind === "strength-booster";
          h.sound.powerUp(str ? 1 : 2);
          h.hud.pushFeed(str ? t("STRENGTH: guns +35%, blows +50%, 25 s") : t("SPEED: much faster, sprint twice as long, 20 s"), "safe");
        }
        // v5: growth and the Map Print, said.
        const items = m.module<ItemsModule>("items");
        if (e.kind === "titan-serum") {
          const c = m.get(e.id);
          const lv = c && items ? items.growth[c.index] : 0;
          if (c === me) h.hud.pushFeed(`${t("Titan Serum")}: ${t("level")} ${lv} · ${Math.round((1 - GROWTH.take[lv]) * 100)}% ${t("less damage")}`, "safe");
          else if (c && lv >= GROWTH.max && Math.hypot(c.x - me.x, c.z - me.z) < 80) h.hud.pushFeed(`${c.name} ${t("is fully grown: it takes twice the shots")}`, "out");
          if (c === me) h.sound.voice.say("serum");
        } else if (e.kind === "map-print" && e.id === me.id) {
          h.sound.voice.say("print");
          h.hud.pushFeed(t("Map Print: everyone and everything, for 20 s"), "safe");
          if (!h.hud.map.expanded) {
            h.hud.map.expand(true);
            this.printOpened = true;
          }
        }
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
        if (m.phase === "play") h.hud.pushFeed(t("A van has arrived"), "info");
        break;
      case "claw":
      case "hazard":
        if (("tg" in e ? e.tg : e.id) === me.id) {
          this.fk.hurt();
          this.actionAt = m.elapsed;
        }
        break;
      case "shot":
        if (e.id === me.id) this.actionAt = m.elapsed;
        // Dead Streets: your shot on a zombie, marked like Free For All's.
        if (e.id === me.id && e.tg) {
          this.combat?.hitMark(e.head, false);
          h.sound.hitMarker(e.head, false);
        }
        break;
      case "zdie":
        if (e.by === me.id) this.combat?.hitMark(e.head, true);
        break;
      // ── Guns (v4) ──
      case "fire": {
        if (Math.hypot(e.x - me.x, e.z - me.z) < 30) this.actionAt = m.elapsed;
        // The shooter's arms kick (the mocap's shot), anyone in view.
        const sh = m.get(e.id);
        if (sh) h.crowd.human(sh.index)?.shot();
        if (e.id === me.id) {
          const K = GUNS.kinds[GUN_KINDS[e.g] ?? "pistol"];
          const ads = h.rig.ads;
          h.rig.recoil(K.recoil * (1 - 0.35 * ads), (Math.random() - 0.5) * K.recoil * 0.5);
          h.rig.kick(K.pellets > 1 ? 0.25 : 0.06);
        }
        break;
      }
      case "dmg":
        if (e.by === me.id || e.tg === me.id) this.actionAt = m.elapsed;
        this.markHit(m, e.tg);
        if (e.by === me.id && e.tg !== me.id) {
          const dead = e.hp <= 0;
          this.combat?.hitMark(e.head, dead);
          h.sound.hitMarker(e.head, dead);
          h.haptic("select");
        }
        if (e.tg === me.id) {
          this.fk.hurt();
          // v6: you hear yourself take it (the zone's gas too).
          if (e.hp > 0) h.sound.hurt(e.amt >= 20);
          const by = e.by ? m.get(e.by) : null;
          if (by) {
            // Where it came from, on screen: 0 ahead, + to the right.
            const yaw = h.rig.aimYaw;
            const a = Math.atan2(by.x - me.x, by.z - me.z);
            const fwd = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
            this.combat?.hurt(-Math.atan2(Math.sin(a - fwd), Math.cos(a - fwd)));
          }
          h.hud.flashRed();
          h.haptic("heavy");
        }
        break;
      case "kill": {
        const tg = m.get(e.tg);
        const by = e.by ? m.get(e.by) : null;
        if (!tg) break;
        if (by === me && tg !== me) this.combat?.killed(tg.name, e.head);
        const how = e.how === "blast" ? t("blew up") : e.how === "melee" ? t("knocked out") : t("dropped");
        h.hud.pushFeed(by ? `${by === me ? t("You") : by.name} ${how} ${tg === me ? t("you") : tg.name}${e.head ? " · " + t("head") : ""}` : `${tg === me ? t("You") : tg.name} ${e.how === "zone" ? t("fell to the zone") : t("went down")}`, tg === me ? "out" : by === me ? "safe" : "info");
        break;
      }
      case "reload":
        if (e.how === "start") {
          const rc = m.get(e.id);
          if (rc) h.crowd.human(rc.index)?.reload(Math.max(0.4, e.at - m.elapsed));
        }
        if (e.id === me.id && e.how === "start") {
          const g = m.module<GunsModule>("guns");
          const kind = GUN_KINDS[g?.gun[me.index][e.s] ?? 0] ?? "pistol";
          h.sound.reload(kind, Math.max(0.4, e.at - m.elapsed));
        }
        break;
      case "ptake":
        if (e.id === me.id) {
          const g = m.module<GunsModule>("guns");
          const p = g?.pickups[e.p];
          if (p?.kind === "plate") h.sound.plate();
          else h.sound.pickup();
          if (p?.kind === "gun") h.hud.pushFeed(`${t(["Pistol", "Assault rifle", "SMG", "Shotgun"][p.gun] ?? "Gun")} · ${t(["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"][p.rarity])}`, "safe");
        }
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
    if (car && car.speed > 1 && !c.looking) {
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
    const pd = c.consumePad();
    // The kill cam: the bodies as they were, from behind whoever took you out.
    const kc = this.killCam?.frame(m) ?? null;
    if (!kc && this.kcOn) this.kcShow(false);
    // v6 max (3.2): your rise: the camera swings once round you (the rig's arm keeps it out of walls), in and up
    // to look at you, then settles back where it was (a full turn: no snap). Your look waits till it's done.
    const rise = !kc && me.status === "alive" ? this.power.riseOf(me.index) : -1;
    if (rise >= 0 && rise <= RISE_SECONDS) {
      if (!this.powerCam) this.powerCam = { yaw: h.rig.yaw, arm: h.rig.arm };
      const u = rise / RISE_SECONDS;
      const e = 0.5 - 0.5 * Math.cos(Math.PI * u);
      const bump = Math.sin(Math.PI * u);
      h.rig.yaw = this.powerCam.yaw + e * Math.PI * 2;
      h.rig.pitch = 0.12 - 0.2 * bump;
      h.rig.arm = this.powerCam.arm * (1 - 0.38 * bump);
      h.rig.adsWant = 0;
    } else {
      if (this.powerCam) {
        h.rig.arm = this.powerCam.arm;
        h.rig.yaw = this.powerCam.yaw;
        this.powerCam = null;
      }
      if (c.enabled && !kc) {
        h.rig.orbit(c.look.x, c.look.y, dt, md.x, md.y);
        h.rig.turn(pd.x, pd.y);
      }
    }
    h.crowd.update(kc ? dt * kc.k : dt, kc ? kc.people : m.contestants, cam);
    if (!kc) this.killCam?.record(dt, m, me.index, this.gunsView?.myAiming ?? false);

    // Who the camera follows: you; out for good, someone still in (your squad first); the killer in the kill cam.
    let target = me;
    if (kc) target = this.killCamFrame(kc);
    else if (me.status !== "alive" && m.respawnIn(me) < 0) {
      if (this.spectate < 0 || m.contestants[this.spectate]?.status !== "alive") {
        const alive = m.contestants.filter((x) => x.status === "alive");
        const pick = alive.find((x) => m.sameSquad(x, me)) ?? alive[0];
        this.spectate = pick ? pick.index : -1;
      }
      if (this.spectate >= 0) target = m.contestants[this.spectate];
    }
    if (h.rig.firstPerson && target === me) h.rig.eyeValid = !!h.crowd.eye(me.index, h.rig.eye);
    // (v6 max, 3.5: a swimmer lies along the water: framed low, as lying down is.)
    h.rig.update(dt, { x: target.x, z: target.z, y: target.y, stance: target.swim && target.status === "alive" ? 2 : target.stance, ground: target.h });
    this.focus.set(target.x, target.h, target.z);
    this.world.update(dt, this.focus, cam);
    this.boards?.update(dt, h.camera);

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
    const tgt6 = this.modes6.target(m);
    const trNear = this.treasure?.target(m) ?? null;
    const jobNear = trNear && (!tgt6 || trNear.d <= tgt6.d) ? trNear : tgt6;
    const near = jobNear && (!flagNear || jobNear.d < flagNear.d) ? jobNear : flagNear;
    this.cars?.update(dt, m, cam, this.marks);
    const { inSmoke } = this.gadgets.update(dt, m, cam, this.marks);
    const extra = {
      target: car.target && (!near || car.target.d < near.d) ? car.target : near,
      objective: m.phase === "play" ? this.treasure?.objectiveLine(m) || this.view.objectiveLine(m, this.src.measures) || this.modes6.objectiveLine(m) : "",
      car: car.panel,
      smoke: inSmoke,
      riddle: this.modes6.riddle(m),
    };
    const { pin } = this.ms.update(dt, m, cam, this.marks, extra);
    const { goal: flagGoal } = this.view.update(dt, m, h.camera, this.marks, h.rig.firstPerson && target === me);
    const deadPin = this.dead?.update(dt, m, cam, this.marks).pin ?? null;
    if (this.gunsView) this.gunFrame(dt, m, me, kc);
    this.fieldFrame(m, me);
    this.soundFrame(dt, m, me);
    const trPin = this.treasure?.update(dt, m, h.camera, this.marks).pin ?? null;
    this.growth.update(dt, m, cam, me.index, h.rig.firstPerson);
    this.power.update(dt, m, cam, me.index, h.rig.firstPerson);
    this.water.update(dt, m, cam, me.index);
    this.printFrame(m, me);
    const goal = trPin ?? flagGoal ?? deadPin ?? this.modes6.update(dt, m, this.marks).pin;
    // The Harmattan: the siren, then the dust; footprints gone; headlights on (or in a power cut).
    const hm = m.module<HarmattanModule>("harmattan");
    if (hm) {
      const storm = hm.now(m);
      const nx = hm.next(m);
      if (nx >= 0 && nx <= HARMATTAN.siren && this.sirenAt !== hm.storms.findIndex((s) => s.at - m.elapsed === nx)) {
        this.sirenAt = hm.storms.findIndex((s) => s.at - m.elapsed === nx);
        h.sound.siren();
        h.hud.pushFeed(t("Sandstorm incoming!"), "info");
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
      this.boards?.setDim(this.dimmed);
      h.renderer.setClearColor(this.world.clear);
    }
    h.hud.setMap({ x: target.x, z: target.z, heading: target.heading, out: me.status !== "alive" }, this.marks, null, h.rig.yaw);
    h.hud.setCompass(h.rig.yaw, target, null, this.world.layout.landmarks, pin, goal);
    h.hud.setTimer(m.phase === "play" ? m.timeLeft : m.settings.time, m.phase === "play" && m.timeLeft <= 30);
    // The announcer: the time, and stepping outside the circle.
    if (m.phase === "play" && !this.over) {
      const left = m.timeLeft;
      // v7: an instant hunt has no clock to call (its 30 minutes are only a backstop).
      const clock = !m.module<TreasureModule>("treasure")?.instant;
      if (clock && this.lastLeft > 120 && left <= 120 && m.settings.time > 240) h.sound.voice.say("time_two");
      if (clock && this.lastLeft > 30 && left <= 30) h.sound.voice.say("time_thirty");
      this.lastLeft = left;
      const z = m.module<ZoneModule>("zone");
      const out = !!z && me.status === "alive" && !z.inside(me.x, me.z);
      if (out && !this.wasOut) h.sound.voice.say("zone_outside");
      this.wasOut = out;
    }

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

  /** The places' sounds where the camera is, and the score's state: low health, the final circle, a fight, or exploring. */
  private soundFrame(dt: number, m: Match, me: Contestant): void {
    const h = this.host;
    this.scenery.update(dt);
    const cam = h.camera;
    cam.getWorldDirection(_fwd);
    this.worldSound.update(dt, cam.position, _fwd);
    this.feet(dt, m, me);
    const g = m.module<GunsModule>("guns");
    const sv = m.module<SurvivalModule>("survival");
    const hp = sv ? sv.hp / SURVIVAL.you.hp : g ? g.hp[me.index] / GUNS.hp : 1;
    const fight = m.elapsed - this.actionAt < 8;
    const final = !!this.play.state?.zone?.final;
    // v5: the score carries on while you wait to respawn (it stopped and restarted: part of "the music keeps skipping").
    this.worldSound.setMusic(this.over || m.phase !== "play" || this.inCar >= 0 ? "off" : hp < 0.3 ? "low" : final ? "final" : fight ? "combat" : "explore");
  }

  /**
   * v5: footsteps. Yours, and everyone else's within earshot, panned to where
   * they are and quieter the further off (crouching is near silent), so you can
   * hear who is coming; your jump and your landing.
   */
  private feet(dt: number, m: Match, me: Contestant): void {
    const h = this.host;
    if (this.stepAt.length !== m.contestants.length) this.stepAt = new Float32Array(m.contestants.length);
    const air = me.status === "alive" && me.y > 0.05;
    if (air && !this.wasAir && me.vy > 0) h.sound.jump();
    else if (!air && this.wasAir && me.status === "alive") h.sound.land();
    this.wasAir = air;
    // v6: a sprint that ran the stamina dry ends in hard breathing.
    if (me.stamina < 0.08 && !this.winded && me.status === "alive") {
      this.winded = true;
      h.sound.breath();
    } else if (me.stamina > 0.5) this.winded = false;
    if (m.phase !== "play" || this.over) return;
    const cam = h.camera;
    cam.getWorldDirection(_fwd);
    const rx = -_fwd.z;
    const rz = _fwd.x;
    const rl = Math.hypot(rx, rz) || 1;
    for (const c of m.contestants) {
      if (c.status !== "alive" || c.y > 0.02 || m.seated(c)) continue;
      const sp = Math.hypot(c.vx, c.vz);
      if (sp < 0.8) continue;
      const i = c.index;
      this.stepAt[i] -= dt;
      if (this.stepAt[i] > 0) continue;
      this.stepAt[i] = sp > MOVE.run + 0.5 ? 0.24 : sp > 3 ? 0.3 : 0.44;
      const pace = Math.min(1, sp / MOVE.sprint);
      const surface = m.world.space.surfaceAt(c.x, c.z, c.h + c.y) ?? "concrete";
      if (c === me) {
        h.sound.step(surface, pace);
        // v6 max (3.2): on the Strength Booster your steps land heavy.
        if (m.effect(me, "strength") > 0) h.sound.heavyStep(pace);
        continue;
      }
      const dx = c.x - me.x;
      const dz = c.z - me.z;
      const d = Math.hypot(dx, dz);
      if (d > STEP_RANGE) continue;
      const k = 1 - d / STEP_RANGE;
      h.sound.stepNear(surface, pace, k * k * (c.stance > 0 ? 0.25 : sp < 3 ? 0.55 : 1), d > 0.5 ? ((dx * rx + dz * rz) / (d * rl)) * 0.85 : 0);
    }
  }

  /** HUD A, each frame: the watch, the plates, the edges; Dead Streets' centre arc and the zombies' bars. */
  /**
   * v7 (the owner: "slowly loss speed, breath slower with sound effect like cod-style, make struggling human sound
   * ... and the sound of their heart beat running slow"): under a third of your health, the world goes muffled, a
   * heavy heart beats slower the nearer you are (68 → 42 a minute), the breath comes in ragged gasps and shaking
   * breaths out, longer and longer, and past halfway a strained groan every few seconds. (The legs slow too:
   * WEAK, guns.ts; the screen's edges pulse red: fieldkit.)
   */
  private nearDeath(level: number): void {
    const s = this.host.sound;
    const w = this.weak;
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - w.last);
    w.last = now;
    if (level <= 0) {
      if (w.on) s.muffle(0);
      w.on = false;
      w.beat = w.breath = 0;
      w.groan = 2.5;
      w.inhale = true;
      return;
    }
    w.on = true;
    s.muffle(0.35 + 0.65 * level);
    w.beat -= dt;
    w.breath -= dt;
    w.groan -= dt;
    if (w.beat <= 0) {
      s.weakHeart(level);
      w.beat = 60 / (68 - 26 * level);
    }
    if (w.breath <= 0) {
      s.weakBreath(level, w.inhale);
      w.breath = w.inhale ? 0.65 + 0.35 * level : 0.95 + 0.9 * level;
      w.inhale = !w.inhale;
    }
    if (level > 0.45 && w.groan <= 0) {
      s.weakGroan(level);
      w.groan = 3.5 + Math.random() * 3 - level * 1.2;
    }
  }
  private readonly weak = { on: false, last: 0, beat: 0, breath: 0, groan: 2.5, inhale: true };

  private fieldFrame(m: Match, me: Contestant): void {
    const h = this.host;
    this.armourLook(m, me);
    this.captains(m);
    const ps = this.play.state;
    const sv = m.module<SurvivalModule>("survival");
    const g = m.module<GunsModule>("guns");
    const alive = me.status === "alive";
    const playing = m.phase === "play" || m.phase === "countdown";
    this.fk.show(playing && !this.over);
    if (!playing) return;
    let watch: { big: string; line: string; arc: number; urgent: boolean };
    let health = 1;
    let armour = 0;
    let tag = "";
    if (sv) {
      // Dead Streets: the run's clock, the bleed (or the Mast's hold) under it.
      const bleed = Math.max(0, sv.bleedAfter - m.elapsed);
      const stand = sv.standAt >= 0 && !sv.tally.finished ? Math.max(0, Math.ceil(sv.standAt + SURVIVAL.stand.s - m.elapsed)) : -1;
      watch = {
        big: fmtTime(Math.max(0, m.elapsed)),
        line: stand >= 0 ? `${t("Hold the Mast")} ${stand} s` : bleed > 0 ? `${t("Bleed")} ${fmtTime(bleed)}` : t("Bleeding"),
        arc: bleed / sv.bleedAfter,
        urgent: bleed <= 0 || stand >= 0,
      };
      health = sv.hp / SURVIVAL.you.hp;
      armour = sv.armour;
      tag = `${t("Torch")} ${Math.round(sv.torch)}% · ${Math.round(sv.tally.route * 100)}%`;
    } else {
      const z = ps?.zone;
      const left = m.contestants.filter((c) => c.status === "alive").length;
      // v7 (the owner: "remove the timer"): an instant hunt's watch shows the zone's countdown when there is one, else
      // the boxes still shut; never the match clock.
      const hunt = m.module<TreasureModule>("treasure");
      const noClock = !!hunt?.instant;
      const shut = noClock ? hunt!.boxes.reduce((n, b) => n + (b.opened ? 0 : 1), 0) : 0;
      const big = z && z.closesIn >= 0 && !z.closing ? fmtTime(z.closesIn) : noClock ? String(shut) : fmtTime(m.phase === "play" ? m.timeLeft : m.settings.time);
      watch = {
        big,
        line: `${z?.closing ? t("Zone closing") : z?.final ? t("Final circle") : t("Zone")} · ${leftLine(left)}`,
        arc: noClock ? shut / Math.max(1, hunt!.boxes.length) : m.phase === "play" ? m.timeLeft / m.settings.time : 1,
        urgent: !!z?.closing || (!noClock && m.phase === "play" && m.timeLeft <= 30),
      };
      if (g) {
        health = g.hp[me.index] / GUNS.hp;
        armour = g.armour[me.index];
        tag = `${t("Armour")} ${Math.round(armour)}`;
      }
    }
    const heat = ps ? (ps.outside ? 0.35 + 0.65 * ps.exposure : ps.exposure * 0.5) : 0;
    this.fk.update({ watch, armour, armourMax: GUNS.armour.max, tag, health: alive ? health : 1, heat: alive ? heat : 0, doomed: !!ps?.doomed });
    // v7: near death (shot, or worn down by the gas): the breath, the heart, the voice, the world muffled.
    this.nearDeath(alive && g && !this.over ? g.weakness(me.index) : 0);
    if (!sv) {
      if (g) this.playerBars(m, me, g);
      return;
    }
    // Dead Streets' centre: health and the torch round the dot, the rounds by it.
    const cb = this.combat;
    if (cb) {
      cb.show(alive && m.phase === "play");
      cb.update({
        hp: sv.hp,
        hpMax: SURVIVAL.you.hp,
        armour: sv.torch,
        armourMax: 100,
        torch: true,
        kind: "pistol",
        rarity: 0,
        mag: sv.ammo,
        magMax: SURVIVAL.you.ammo,
        res: -1,
        reload: -1,
        gap: 6,
        ads: false,
        two: false,
      });
    }
    // The zombies' bars: the ones hurt in the last 3 s, near and in front, nearest first.
    const n = m.contestants.length;
    if (this.zPrev.length !== n) {
      this.zPrev = new Float32Array(n);
      this.zMax = new Float32Array(n);
      this.zHitAt = new Float32Array(n).fill(-99);
    }
    // The game's size without asking the page for its layout (that forces one, every frame, after the HUD's writes).
    const { w: W, h: H } = gameSize();
    const cam = h.camera;
    this.zBars.length = 0;
    const list: [number, ZombieBar][] = [];
    for (let i = 1; i < n; i++) {
      const z = m.contestants[i];
      const hp = sv.zhp[i];
      // A new one risen (its health went up): its most is what it has now.
      if (hp > this.zPrev[i] + 1e-3) this.zMax[i] = hp;
      else if (hp < this.zPrev[i] - 1e-3) this.zHitAt[i] = m.elapsed;
      this.zPrev[i] = hp;
      if (z.status !== "alive" || hp <= 0 || m.elapsed - this.zHitAt[i] > 3) continue;
      const d = Math.hypot(z.x - me.x, z.z - me.z);
      if (d > 40) continue;
      _bar.set(z.x, z.h + z.y + 2.05, z.z).project(cam);
      if (_bar.z > 1 || Math.abs(_bar.x) > 1.05 || Math.abs(_bar.y) > 1.05) continue;
      list.push([d, { x: ((_bar.x + 1) / 2) * W, y: ((1 - _bar.y) / 2) * H, v: hp / Math.max(1, this.zMax[i]), on: true, masked: sv.kindOf(i) === "masked" }]);
    }
    list.sort((a, b) => a[0] - b[0]);
    for (const [, b] of list) this.zBars.push(b);
    this.fk.zombies(this.zBars);
  }

  private markHit(m: Match, id: string): void {
    const c = m.get(id);
    if (!c) return;
    if (this.zHitAt.length !== m.contestants.length) this.zHitAt = new Float32Array(m.contestants.length).fill(-99);
    this.zHitAt[c.index] = m.elapsed;
  }

  /** v5: a small health bar over anyone being shot (3 s after the last hit), near and on screen, nearest first. */
  private playerBars(m: Match, me: Contestant, g: GunsModule): void {
    const { w: W, h: H } = gameSize();
    const cam = this.host.camera;
    this.zBars.length = 0;
    if (this.zHitAt.length === m.contestants.length) {
      const list: [number, ZombieBar][] = [];
      for (const c of m.contestants) {
        if (c === me || c.status !== "alive" || m.elapsed - this.zHitAt[c.index] > 3 || m.seated(c)) continue;
        if (m.module<GadgetsModule>("gadgets")?.hidden(m, c.index)) continue;
        const d = Math.hypot(c.x - me.x, c.z - me.z);
        if (d > 80) continue;
        _bar.set(c.x, c.h + c.y + 2.05, c.z).project(cam);
        if (_bar.z > 1 || Math.abs(_bar.x) > 1.05 || Math.abs(_bar.y) > 1.05) continue;
        list.push([d, { x: ((_bar.x + 1) / 2) * W, y: ((1 - _bar.y) / 2) * H, v: g.hp[c.index] / GUNS.hp, on: true, masked: g.armour[c.index] > 0 }]);
      }
      list.sort((a, b) => a[0] - b[0]);
      for (const [, b] of list) this.zBars.push(b);
    }
    this.fk.zombies(this.zBars);
  }

  /** The armour ladder's look: each body's gear follows its armour (a changed tier re-dresses it). */
  private armourLook(m: Match, me: Contestant): void {
    const g = m.module<GunsModule>("guns");
    const sv = m.module<SurvivalModule>("survival");
    const crowd = this.host.crowd;
    for (const c of m.contestants) {
      if (sv && c !== me) continue;
      const points = sv ? sv.armour * 1.5 : g ? g.armour[c.index] : 0;
      const tier = armourTier(points);
      const h = crowd.human(c.index);
      if (h && h.gearTier >= 0 && h.gearTier !== tier) crowd.setGear(c.index, KITS[this.looks[c.index].hoodie % KITS.length], tier);
    }
  }

  /**
   * v6: the captain's armband on each squad's leader: its first player still in (their first seat, the party's
   * leader; Treasure Hunt's uploader is chosen the same way). Solo players wear none.
   */
  private captains(m: Match): void {
    const crowd = this.host.crowd;
    const lead = new Map<number, number>();
    const size = new Map<number, number>();
    for (const c of m.contestants) {
      const sq = m.squads[c.index];
      size.set(sq, (size.get(sq) ?? 0) + 1);
      if (c.status === "alive" && !lead.has(sq)) lead.set(sq, c.index);
    }
    for (const c of m.contestants) {
      const sq = m.squads[c.index];
      crowd.human(c.index)?.setCaptain((size.get(sq) ?? 0) > 1 && lead.get(sq) === c.index);
    }
  }

  /** Guns, each frame: the camera down the sights, the guns drawn, the gun HUD, a dry click. */
  private gunFrame(dt: number, m: Match, me: Contestant, kc: KillCamFrame | null): void {
    const h = this.host;
    const g = m.module<GunsModule>("guns")!;
    const c = h.controls;
    const i = me.index;
    const live = me.status === "alive" && m.phase === "play" && !m.seated(me);
    const s = g.slot[i];
    const kind = GUN_KINDS[g.gun[i][s]] ?? "pistol";
    const K = GUNS.kinds[kind];
    h.rig.adsWant = live && c.ads ? 1 : 0;
    // v6: one-thumb portrait keeps you in the middle of the view (down the sights goes back over the shoulder; the
    // kill cam too, or the killer hides you).
    h.rig.centre = c.thumbMode && !c.ads && !this.killCam?.busy ? 1 : 0;
    // v6: the sprint's widening view and bob (the burst more).
    h.rig.sprint = live && me.sprinting ? (me.tac > 0 ? 1 : 0.6) : 0;
    // v6 max: the burst's start: a rush of air and a sharp breath in.
    const tacNow = live && me.tac > 0;
    if (tacNow && !this.wasTac) h.sound.tacSprint();
    this.wasTac = tacNow;
    // Aiming or firing, you face the aim (the server turns your body the same way).
    if (live && (c.ads || c.trigger || m.elapsed - g.aimedAt[i] < 0.8)) me.heading = h.rig.aimYaw + Math.PI;
    h.rig.adsZoom = K.zoom;
    this.gunsView!.myPitch = h.rig.aimPitch;
    this.gunsView!.myAiming = live && (c.ads || c.trigger);
    if (kc?.fires.length) this.gunsView!.events(kc.fires, m, h.camera.position);
    this.gunsView!.update(kc ? dt * kc.k : dt, m, h.camera, kc ? { people: kc.people, gunUp: kc.gunUp } : undefined);
    // The trigger on nothing at all: a dry click now and then.
    if (live && c.trigger && g.mag[i][s] <= 0 && g.res[i][s] <= 0 && m.elapsed - this.dryAt > 0.4) {
      this.dryAt = m.elapsed;
      h.sound.dryFire();
    }
    const cb = this.combat!;
    cb.show(live || (me.status === "alive" && m.phase === "countdown"));
    // The crosshair's gap: the spread now (as the rules work it out), on screen.
    const moving = Math.hypot(me.vx, me.vz) > 0.6;
    const spread = (c.ads ? K.ads : K.hip) * (me.stance === 1 ? 0.8 : me.stance === 2 ? 0.6 : 1) + (moving ? K.move : 0) + (me.y > 0.05 ? K.move * 2 : 0) + g.bloom[i];
    const halfFov = ((h.camera.fov / 2) * Math.PI) / 180;
    const gap = (Math.tan(spread) / Math.tan(halfFov)) * (gameSize().h / 2);
    const ra = g.reloadAt[i];
    cb.update({
      hp: g.hp[i],
      hpMax: GUNS.hp,
      armour: g.armour[i],
      armourMax: GUNS.armour.max,
      kind,
      rarity: g.rarity[i][s],
      mag: Math.max(0, g.mag[i][s]),
      magMax: gunStats(kind, g.rarity[i][s]).mag,
      res: g.res[i][s],
      reload: ra >= 0 ? Math.max(0, Math.min(1, 1 - (ra - m.elapsed) / K.reload)) : -1,
      gap,
      ads: h.rig.ads > 0.5,
      two: g.gun[i][1] >= 0,
    });
  }

  /**
   * A Map Print (v5): while it lasts, the map shows everyone (named), every
   * item on the ground, the crates, and what the mode hides (Treasure Hunt's
   * chests, and which hold a treasure). It closes the full map it opened.
   */
  private printFrame(m: Match, me: Contestant): void {
    const map = this.host.hud.map;
    const left = me.status === "alive" ? (m.effects(me).find((e) => e.key === "print")?.left ?? 0) : 0;
    map.print = left;
    if (left <= 0) {
      if (this.printOpened) {
        this.printOpened = false;
        map.expand(false);
      }
      return;
    }
    const gd = m.module<GadgetsModule>("gadgets");
    for (const c of m.contestants) {
      if (c === me || c.status !== "alive") continue;
      // v6 max: camouflage keeps a rival off the print too.
      if (gd?.camo(c.index) && !m.sameSquad(c, me)) continue;
      this.marks.push({ x: c.x, z: c.z, kind: m.sameSquad(c, me) ? "mate" : "rival", label: c.name });
    }
    const items = m.module<ItemsModule>("items");
    if (items) for (const it of items.items) if (!it.taken) this.marks.push({ x: it.x, z: it.z, kind: "loot" });
    this.treasure?.printMarks(m, this.marks);
  }

  /** A rival took you out: the kill cam a beat later, and what its tag says (who, with what, how far, their health). */
  private killedBy(m: Match, me: Contestant, e: Extract<MatchEvent, { type: "kill" }>): void {
    const kc = this.killCam;
    const by = e.by ? m.get(e.by) : null;
    if (!kc || !by || kc.busy) return;
    const g = m.module<GunsModule>("guns");
    const what = [
      e.how === "blast" ? t("Blast") : e.how === "melee" ? t("Melee") : t(GUN_NAMES[e.how] ?? "Shot"),
      e.head ? t("Head shot") : "",
      `${Math.round(Math.hypot(by.x - me.x, by.z - me.z))} m`,
      g ? `${Math.max(1, Math.ceil(g.hp[by.index]))} ${t("HP left")}` : "",
    ].filter(Boolean);
    this.kcCard = { who: by.name || t("A rival"), what: what.join(" · ") };
    kc.begin(m, by, me);
  }

  /** A kill cam frame: the screen given over to it, the lens behind the killer, turned towards you. */
  private killCamFrame(kc: KillCamFrame): Contestant {
    const h = this.host;
    const k = kc.killer;
    const dx = kc.victim.x - k.x;
    const dz = kc.victim.z - k.z;
    const d = Math.hypot(dx, dz);
    const first = !this.kcOn;
    this.kcShow(true);
    h.rig.eyeValid = false;
    h.rig.adsWant = 0;
    // Facing you (too close to tell, the way they face).
    const yaw = d > 1.5 ? Math.atan2(-dx, -dz) : k.heading - Math.PI;
    if (first) h.rig.follow(true, { x: k.x, z: k.z, y: k.y, stance: k.stance, ground: k.h }, yaw, 0.08);
    else {
      h.rig.yaw = yaw;
      h.rig.pitch = 0.08;
    }
    if (kc.slowStart) h.rig.push(d > 25 ? 0.5 : d > 8 ? 0.65 : 0.85, 1.4);
    this.kcUi!.progress(kc.u);
    return k;
  }

  /** The kill cam on screen or off: the HUD and the buttons hidden under it, your own head seen (first person hides it). */
  private kcShow(on: boolean): void {
    if (this.kcOn === on) return;
    this.kcOn = on;
    const h = this.host;
    if (on) this.kcUi!.show("killcam", this.kcCard.who, this.kcCard.what);
    else this.kcUi?.hide();
    if (!this.over) h.hud.show(!on);
    h.ui.classList.toggle("kc-on", on);
    this.play.root.style.visibility = on ? "hidden" : "";
    this.fk.root.style.visibility = on ? "hidden" : "";
    h.crowd.hideMyHead = !on && h.rig.firstPerson;
    h.rig.clearZoom();
  }

  /** The kill cam over (played out, skipped, cut short by a respawn or the end): the bodies back, the screen back. */
  private endKillCam(): void {
    this.killCam?.stop(this.src.match);
    this.kcShow(false);
  }

  /** v5: you left before the end: that's a defeat, and you see it (the owner never saw the end screens). */
  forfeit(): void {
    if (!this.over) this.finish();
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
      kills: this.kills,
      feats: {
        mode: this.src.def.id,
        online: !!this.online,
        ranked: false,
        won: !!m.winner && m.winner.squad === m.squads[me.index],
        place: st.find((s) => s.id === me.id)?.place ?? 0,
        sides: new Set(st.map((s) => s.squad)).size,
        seconds: m.elapsed,
        kills: this.kills,
        heads: this.feats.heads,
        deaths: this.feats.deaths,
        treasures: this.feats.treasures,
        uploads: this.feats.uploads,
        crates: this.feats.crates,
        items: this.feats.items,
        boosters: this.feats.boosters,
        downs: this.feats.downs,
        helps: this.feats.helps,
        swum: Math.round(this.feats.swum),
        hour: new Date().getHours(),
      },
      ...(this.best.text ? { play: this.best.text } : {}),
      trail: this.trail,
      ...(this.dead ? { run: runResult(m.module<SurvivalModule>("survival")!, this.trace) } : {}),
    };
    this.sendBoards();
    this.host.sound.voice.say(r.won ? "victory" : "defeat", true);
    this.host.onEnd(r);
  }

  /** The billboards' seconds on screen, once (at the end, or on leaving early). */
  private sendBoards(): void {
    if (this.boardsSent || !this.boards) return;
    this.boardsSent = true;
    this.host.boardsSeen(this.boardFeed, this.boards.seen());
  }

  dispose(): void {
    const h = this.host;
    h.sound.muffle(0);
    this.sendBoards();
    this.gone = true;
    h.controls.chatBtn.hidden = true;
    this.endKillCam();
    this.kcUi?.dispose();
    if (this.boards) {
      h.scene.remove(this.boards.group);
      this.boards.dispose();
    }
    this.src.dispose();
    h.scene.remove(this.world.group, this.ms.group, this.view.group);
    this.ms.dispose();
    this.view.dispose();
    this.cars?.dispose();
    this.gadgets.dispose();
    if (this.gunsView) {
      h.scene.remove(this.gunsView.group);
      this.gunsView.dispose();
    }
    this.combat?.root.remove();
    this.fk.dispose();
    this.worldSound.dispose();
    h.scene.remove(this.scenery.group);
    this.scenery.dispose();
    for (let i = 0; i < this.src.match.contestants.length; i++) h.crowd.setGear(i, null);
    h.hud.setFieldKit(false);
    h.rig.adsWant = 0;
    h.controls.setGuns(false);
    if (this.dead) {
      h.scene.remove(this.dead.group);
      this.dead.dispose();
      h.controls.setSurvival(false);
    }
    this.modes6.dispose(this.src.match);
    if (this.treasure) {
      h.scene.remove(this.treasure.group);
      this.treasure.dispose();
    }
    h.sound.voice.hush();
    h.scene.remove(this.growth.group);
    this.growth.dispose(this.src.match);
    this.power.dispose(this.src.match);
    this.water.dispose();
    h.hud.map.print = 0;
    if (this.dimmed) this.world.setDim(0);
    if (this.dustSet) this.world.setDust(0, HARMATTAN.see);
    h.sound.engine(0, 0);
    h.sound.carRadio(null);
    h.rig.arm = 1;
    h.rig.lift = 0;
    this.play.root.remove();
    h.controls.extraRoots.length = 0;
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
export { MUTATOR_NAME };

/** The announcer's first order of a match, by what the mode is. */
function startLine(m: Match): LineId {
  if (m.module("treasure")) return "start_treasure";
  if (m.module("survival")) return "start_generic";
  const f = m.module<FlagsRules>("flags");
  if (m.module("dropzones")) return "start_deliver";
  if (m.module("capture")) return "start_rally";
  if (f && f.claimHold > 0) return "start_flag";
  if (f) return "start_hold";
  if (m.module<GunsModule>("guns")?.royale) return "start_royale";
  return "start_generic";
}

/** What the mode's measure is called on the results ("" when it has none). */
function measureName(m: Match): string {
  const f = m.module<FlagsModule>("flags");
  if (m.module("tag")) return "Seconds human";
  if (m.module("blackout")) return "Seconds unfound";
  if (m.module("economy")) return "Owo banked";
  if (m.module("riddles")) return "Riddles solved";
  if (m.module("rooms")) return "Points";
  if (m.module("treasure")) return "Treasures";
  if (m.module<CaptureModule>("capture")) return "Seconds in the rally point";
  if (!f) return "";
  if (f.claimHold > 0) return "Longest hold (s)";
  if (f.extractAt > 0 || f.ping > 0) return "Seconds held";
  return "Deliveries";
}
