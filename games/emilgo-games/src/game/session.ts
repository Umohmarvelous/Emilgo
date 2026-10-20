// The game: owns the renderer, the lobby, the world, the round and the menus,
// and wires the referee's events to everything you see, hear and feel.
//
//   update(dt)   fixed 60 Hz: read input → (bots think) → round steps → events
//   render(dt)   every frame: the lobby stage, or the street — animate, move
//                the camera, refresh the HUD, draw
//
// Two kinds of round, one code path:
//   practice   a local RedLightRound with CPU contestants
//   online     an OnlineRound fed by the game server (real people only)
// Both implement RoundView, so everything below the round — the world, the
// effects, the HUD, results — is identical. What differs is spelled out where
// it happens: online rounds can't pause or slow down, because the server
// doesn't wait for anyone.
//
// Two views: the LOBBY (lobbyStage: your character on a golden-hour street,
// the waiting room, the winner's circle) and the GAME (the map, the run).
//
// The match flow (SPEC-V2 §1; flow/machine.ts): Play menu → waiting room →
// 2 s loading → walkout and field preview (flow/walkout.ts, rlgl/shots.ts) →
// countdown 5 → 1 (flow/countdown.ts) → play → results. The tutorial
// (flow/tutorial.ts, rlgl/tutorial.ts) plays a real round with a model.

import { ACESFilmicToneMapping, OrthographicCamera, PCFShadowMap, PCFSoftShadowMap, SRGBColorSpace, WebGLRenderTarget, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from "three";

import { Sound } from "../audio/sound";
import { ATTACK, BALLS, DISTANCES, FINAL, FLOW, MODES, MOVE, PRACTICE, RULES, courseFor, scoreFor, walkoutLength, type AttackKind, type Course, type Distance, type Mode, type Stance } from "../config";
import { SONGS, songFor, type SongId } from "../audio/songs";
import { Loop } from "../core/loop";
import { QualityGovernor } from "../core/quality";
import { Rng, randomSeed } from "../core/rng";
import { Post } from "../graphics/post";
import { frame as cinemaFrame } from "../flow/cinema";
import { Countdown } from "../flow/countdown";
import { MatchFlow } from "../flow/machine";
import { TutorialPlayer } from "../flow/tutorial";
import { Walkout, WalkoutButtons } from "../flow/walkout";
import { ReplayView } from "../rlgl/replayView";
import { behindShot, finalTwoLens, killCamLens, potgLens, previewShots } from "../rlgl/shots";
import { DEMO, TutorialScript, tutorialPeople, tutorialSteps } from "../rlgl/tutorial";
import { tierSpec, type TierSpec } from "../graphics/tiers";
import { REFLECT_LAYER } from "../maps/potholes";
import { Controls } from "../input/controls";
import { buildWorld, type World } from "../maps/world";
import { DEFAULT_MAP, SKY_STATES, fieldHalfWidth, mapOf, withMode, type MapCategory, type SkyState } from "../maps/registry";
import { NetClient } from "../net/client";
import { OnlineRound } from "../net/onlineRound";
import { ERROR_TEXT, normalizeCode, type RoomInfo, type ServerMsg, type StartInfo, type SyncInfo } from "../net/protocol";
import { serverUrl } from "../net/serverUrl";
import type { Host, MatchView } from "../platform/types";
import { errorCode, errorText } from "../platform/vatarErrors";
import { DEFAULT_WHEEL, saveSettings, type Settings } from "../settings";
import { EMOTE_PACK, PRODUCT_BY_ID, fromWire, toWireLook, type WireLook } from "../shop/catalog";
import { ShopClient } from "../shop/client";
import { EMOTE_BY_ID, EMOTES, type EmoteId } from "../social/emotes";
import { Hud, type MapMark } from "../ui/hud";
import { QuickChat } from "../ui/quickchat";
import { Scoreboard } from "../ui/scoreboard";
import type { TerrainShot } from "../ui/minimap";
import { Screens, naira, payoutOf, type LobbyTab, type OnlineAvailability, type PlayMode, type ResultInfo } from "../ui/screens";
import { ReplayOverlay } from "../ui/replay";
import { Bubbles, ChatPanel, EmoteWheel } from "../ui/social";
import { CameraRig } from "../world/camera";
import { Crowd, accentOf } from "../world/crowd";
import { Doll } from "../world/doll";
import { Effects } from "../world/fx";
import { setMaxAnisotropy, warmLook } from "../world/human";
import { cleanLook, ownedOnly, randomLook, uniformLook, type ExtraId, type Look } from "../world/human/wardrobe";
import type { PoseId } from "../world/human/animator";
import { LobbyStage, type Framing } from "../world/lobbyStage";
import { PropsView } from "../world/props";
import { setTextureAnisotropy } from "../world/tex";
import { buildAtlas } from "../world/textures";
import { BOT_NAMES, BotBrain } from "./bots";
import { addProgress, ensureDaily, levelOf, xpForRound } from "./progress";
import { attackTarget, canAttack } from "./combat";
import { CLIP, Highlights, type Moment, type MomentKind } from "./highlights";
import { Recorder, type Clip, type DollPose } from "./replay";
import { PHASES, prePlay, type Cause, type Contestant, RedLightRound, type RoundEvent, type RoundView } from "./rules";

const ME = "me";
const MATCH_STILL_ON = "The match is still on. The result comes when the round ends.";
const MAX_PEOPLE = 20;
const RETURN_AFTER = 15;

type MyState = "playing" | "out" | "safe";
type View = "lobby" | "game";

const _chest = new Vector3();
const _away = new Vector3();
const _eyeL = new Vector3();
const _eyeR = new Vector3();
const _head = new Vector3();
const _focus = new Vector3();
const _size = new Vector2();
const _a = new Vector3();
const _b = new Vector3();
const _lensPos = new Vector3();
const _lensLook = new Vector3();

/** The zoom on an offender (SPEC-V2 §2.6 step 2), seconds. */
const ZOOM_S = 1.2;
/** Your own fall, live and in slow motion, before the kill cam (seconds, real time). */
const OUT_FALL_S = 1.5;
/** The kill cam: this much before the shot and after it, seconds of play. */
const KILLCAM_BEFORE = 1.2;
const KILLCAM_AFTER = 0.4;
const MOMENT_NAME: Record<MomentKind, string> = { escape: "Closest escape", dodge: "Best dodge", attack: "Best attack" };

export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  // Far enough for the mountains behind a 300 m run (the fog ends the view first).
  private readonly camera = new PerspectiveCamera(65, 1, 0.1, 900);
  private readonly rig: CameraRig;
  private readonly doll = new Doll();
  private readonly crowd = new Crowd(MAX_PEOPLE);
  private readonly fx = new Effects();
  private readonly props: PropsView;
  /** High only: bloom, grade, vignette. */
  private post: Post | null = null;
  private readonly quality: QualityGovernor;
  private readonly loop: Loop;
  private readonly sound = new Sound();
  private readonly controls: Controls;
  private readonly hud = new Hud();
  private readonly screens = new Screens();
  private readonly touch: HTMLDivElement;
  private readonly chat: ChatPanel;
  private readonly wheel: EmoteWheel;
  private readonly bubbles: Bubbles;
  private readonly spectateBtn: HTMLButtonElement;
  private readonly stage: LobbyStage;
  private readonly atlas;
  private spec: TierSpec;
  private world: World | null = null;
  private worldKey = "";
  private view: View = "lobby";
  private spectateId: string | null = null;
  private chatOn = false;
  private spectateOn = false;
  private actionsOn = false;
  private readonly shop: ShopClient | null;
  private shopBusy: string | null = null;
  private shopNote: string | null = null;

  // The match flow
  private readonly flow = new MatchFlow();
  private readonly countdown: Countdown;
  private readonly flowBtns: WalkoutButtons;
  private readonly tutorial: TutorialPlayer;
  private readonly shotFrame = cinemaFrame();
  /** This round's walkout (null once the countdown starts). */
  private walkout: Walkout | null = null;
  /** The first time on a field (Solo): the tutorial button shows through the walkout and countdown. */
  private offerTutorial = false;
  /** The tutorial running: its script, where to go after, when to wrap up. */
  private tut: { script: TutorialScript; after: "solo" | "menu"; wrapAt: number } | null = null;

  // Lobby state
  private playMode: PlayMode = "new";
  private playError: string | null = null;
  private customizeTab = "outfit";
  private emoteSel: EmoteId | null = null;
  private wheelSlot = -1;
  private settingsTab = "graphics";
  private friendsTab: "friends" | "invite" = "friends";
  private mapCat: MapCategory = "ng-urban";
  /** The sky picked for practice (null: the map's own). */
  private skyPick: SkyState | null = null;
  /** What the current world was built from (rebuilt when light / dark mode changes mid-round). */
  private worldArgs: { mapId: string; pick: SkyState | null; course?: Course } | null = null;
  private worldMs = 0;
  private tryOn: Look | null = null;
  private onlineCounts: { online: number | null; inMatch: number | null } = { online: null, inMatch: null };
  private rank: string | null = null;
  private returnAt = 0;
  private podiumNames: { name: string; time: number; me: boolean }[] = [];

  private round: RoundView | null = null;
  private meId = ME;
  private mode: "practice" | "online" = "practice";
  private brains: BotBrain[] = [];
  /** Everyone as they look on the field: the numbered match suit (SPEC-V2 §1.3). */
  private looks: Look[] = [];
  /** Everyone in their own clothes (the winner's circle). */
  private ownLooks: Look[] = [];
  private my: MyState = "playing";
  private paused = false;
  private hostPaused = false;
  private watching = false;
  private recorded: ResultInfo | null = null;
  private resultsIn = -1;
  private slowmo = 0;
  private stepClock = 0;
  private settingsFrom: "lobby" | "pause" = "lobby";
  private songId: SongId = "mugunghwa";
  private songBeat = 0;
  /** Her calls so far this round: she takes turns with her two songs. */
  private songTurn = 0;
  private lastPhase = "";
  private watchesSurvived = 0;
  private sprintMetres = 0;
  private readonly marks: MapMark[] = [];
  private readonly board: Scoreboard;
  private readonly quick: QuickChat;

  // Elimination and highlights (SPEC-V2 §2.6–2.9)
  private readonly replay: ReplayView;
  private readonly replayUi: ReplayOverlay;
  private readonly resultsBtn: HTMLButtonElement;
  /** What this phone shows, the last 12 s of it: the kill cam and the play of the game are cut from it. */
  private rec: Recorder | null = null;
  /** Solo: the highlights are scored here (online the server scores them). */
  private hl: Highlights | null = null;
  /** Caught this step: one crack, one drum and one zoom for the lot. */
  private caughtNow: Contestant[] = [];
  /** Her real turns this round, and the one the zoom last went to (once a turn). */
  private turnNo = 0;
  private zoomTurn = -1;
  private zoomId: string | null = null;
  /** Your own elimination: the live fall, then the kill cam, then you spectate. */
  private outSeq: { stage: "fall" | "killcam"; left: number } | null = null;
  /** After crossing: a moment to enjoy it, then you spectate. */
  private spectateIn = -1;
  /** The play of the game: the moment, its clip (once recorded), when to show it (s, −1: not yet). */
  private potg: { m: Moment; clip: Clip } | null = null;
  /** A better moment whose clip isn't cut yet (the seconds after it are still being recorded). */
  private potgNext: Moment | null = null;
  private potgIn = -1;
  private replaying: "killcam" | "potg" | null = null;
  /** Two left: the cutscene's lens (when you're watching), for this long. */
  private finalShot: { ids: [string, string]; t: number } | null = null;
  private readonly dollPose: DollPose = { yaw: Math.PI, head: 0, watching: false };

  // Online
  private readonly server: string | null;
  private net: NetClient | null = null;
  private room: RoomInfo | null = null;
  private onlineError: string | null = null;
  private seatId: string | null = null;
  private connecting = false;

  // Lagos Life matches
  private vmatch: MatchView | null = null;
  private vStake = 0;
  private vSeats = 2;
  private vBusy = false;
  private vError: string | null = null;
  private vPlaying: string | null = null;
  private vRetries = 0;
  private vOutcome: string | null = null;

  constructor(
    private readonly host: Host,
    private readonly settings: Settings,
    canvas: HTMLCanvasElement,
    ui: HTMLElement,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // A frame's cost is every pass in it (shadows, the mirror, post), not just the last.
    this.renderer.info.autoReset = false;
    this.spec = tierSpec(settings.graphics, this.renderer.getContext());
    this.renderer.shadowMap.enabled = this.spec.shadows;
    this.renderer.shadowMap.type = this.spec.tier === 2 ? PCFSoftShadowMap : PCFShadowMap;
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    setMaxAnisotropy(aniso);
    setTextureAnisotropy(this.spec.tier === 2 ? Math.min(8, aniso) : 4);
    this.server = serverUrl(host.server);
    // The shop needs Lagos Life (to pay) and our server (to check and deliver).
    this.shop = host.shop && this.server ? new ShopClient(host as Host & { shop: NonNullable<Host["shop"]> }, this.server) : null;

    this.atlas = buildAtlas(aniso);
    this.props = new PropsView(this.spec);
    this.scene.add(this.doll.root, this.crowd.group, this.fx.group, this.props.group);
    this.crowd.tier = this.spec.tier;
    this.crowd.setShadows(this.spec.shadows);
    this.rig = new CameraRig(this.camera);
    // Mama shows in the puddles' mirror (High).
    this.doll.root.traverse((o) => o.layers.enable(REFLECT_LAYER));
    this.stage = new LobbyStage(this.renderer, this.spec, canvas);

    this.quality = new QualityGovernor((pr) => {
      this.renderer.setPixelRatio(Math.min(pr, this.spec.maxPixelRatio));
      this.resize();
    });
    this.quality.canApply = () => {
      const ph = this.round?.phase;
      return ph !== "turning" && ph !== "watch";
    };

    // ── UI ──
    this.touch = document.createElement("div");
    this.touch.className = "touch";
    const moveStick = stickEl();
    const lookStick = stickEl();
    const bubbleLayer = document.createElement("div");
    bubbleLayer.className = "bubble-layer";
    ui.append(this.touch, bubbleLayer, this.hud.root, moveStick, lookStick);
    this.controls = new Controls(this.touch, moveStick, lookStick);
    ui.append(this.controls.actions, this.controls.moveSide, this.controls.vitals);
    this.board = new Scoreboard(ui);
    this.quick = new QuickChat(ui);
    ui.append(this.screens.root, this.screens.toastNode);
    this.bubbles = new Bubbles(bubbleLayer);
    this.chat = new ChatPanel(ui, this.controls.chatBtn);
    this.wheel = new EmoteWheel(ui);
    this.spectateBtn = document.createElement("button");
    this.spectateBtn.className = "spectate-btn btn secondary";
    this.spectateBtn.dataset.ui = "1";
    this.spectateBtn.textContent = "Next runner";
    this.spectateBtn.addEventListener("click", () => this.nextSpectate());
    ui.append(this.spectateBtn);
    // While you spectate: straight to the results (the round goes on without you).
    this.resultsBtn = document.createElement("button");
    this.resultsBtn.className = "results-btn btn secondary";
    this.resultsBtn.dataset.ui = "1";
    this.resultsBtn.textContent = "Results";
    this.resultsBtn.addEventListener("click", () => {
      this.sound.ui();
      this.showResults();
    });
    ui.append(this.resultsBtn);
    this.replay = new ReplayView(this.crowd, this.doll, this.props, this.fx);
    this.replayUi = new ReplayOverlay(ui);
    this.replayUi.skipBtn.addEventListener("click", () => {
      this.sound.ui();
      this.endReplay();
    });
    this.flowBtns = new WalkoutButtons(ui);
    this.flowBtns.skipBtn.addEventListener("click", () => this.skipWalkout());
    this.flowBtns.tutorialBtn.addEventListener("click", () => {
      this.sound.ui();
      this.startTutorial("solo");
    });
    this.tutorial = new TutorialPlayer(ui);
    this.tutorial.onClose(() => this.endTutorial());
    this.countdown = new Countdown(this.hud, (last) => this.sound.bassDrop(last));
    this.chat.onSend((text) => this.net?.send({ t: "chat", text }));
    this.chat.onAction((a) => {
      if (a.kind === "block") this.net?.send({ t: "block", id: a.seat });
      else if (a.kind === "report") this.net?.send({ t: "report", id: a.seat, reason: a.reason });
      else this.chat.add({ from: "", name: "", text: this.chat.isMuted(a.seat) ? `Muted ${a.name}.` : `Unmuted ${a.name}.`, mine: false, system: true });
    });
    this.wheel.onEmote((id) => this.sendEmote(id));
    this.wheel.onLocked(() => this.hud.pushFeed("Owambe emote pack: in the Store", "info"));
    this.controls.onWheel = (open, x, y) => {
      if (open) this.wheel.open(x, y);
      else this.wheel.release();
    };
    this.controls.onWheelMove = (x, y) => this.wheel.hover(x, y);
    this.controls.onChat = () => this.chat.toggle();
    // Quick chat: online it's a chat line to the room; in practice a bubble over you.
    this.controls.onQuick = () => this.quick.toggle();
    this.quick.onSend((text) => {
      if (this.mode === "online" && this.net) this.net.send({ t: "chat", text });
      const me = this.round?.get(this.meId);
      if (me) this.bubbles.show(me.index, "ping");
    });
    this.controls.onScoreboard = (open) => this.board.show(open);
    this.controls.onMap = () => this.hud.map.expand(!this.hud.map.expanded);
    this.controls.onFeed = () => {
      this.settings.killFeed = !this.settings.killFeed;
      saveSettings(this.host, this.settings);
      this.hud.setFeedOn(this.settings.killFeed);
      this.screens.toast(this.settings.killFeed ? "Kill feed on" : "Kill feed off");
    };
    this.hud.boardBtn.addEventListener("click", () => this.board.show(!this.board.open));
    // Settings, straight from the game (practice pauses; online carries on).
    this.hud.settingsBtn.addEventListener("click", () => {
      this.pause();
      if (this.paused) this.action("settings-pause", document.body);
    });
    this.controls.onFirstPerson = () => this.toggleView();
    this.hud.viewBtn.addEventListener("click", () => this.toggleView());
    this.shop?.onChange(() => this.onOwnedChanged());
    this.onOwnedChanged();
    this.controls.onFirstInput(() => this.sound.unlock());
    const unlock = () => {
      this.sound.unlock();
      window.removeEventListener("pointerdown", unlock, true);
    };
    window.addEventListener("pointerdown", unlock, true);
    this.controls.onPauseKey = () => (this.paused ? this.resume() : this.pause());
    this.hud.pauseBtn.addEventListener("click", () => this.pause());
    this.screens.handle((act, node) => this.action(act, node));

    // ── Host lifecycle ──
    host.onPause(() => this.hostPause());
    host.onResume(() => this.hostResume());
    host.onBack(() => this.back());
    host.onIdentity(() => {
      if (this.screens.name === "lobby") this.screens.setPlayer(null, host);
    });
    host.matches?.onUpdate((m) => this.onMatchUpdate(m));
    window.addEventListener("online", () => this.screens.name === "lobby" && this.toLobby());
    window.addEventListener("offline", () => this.screens.name === "lobby" && this.toLobby());

    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 150));
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.loop.stop();
      this.sound.suspend();
      this.screens.fatal("Graphics paused", "Your phone needed its graphics memory back. Tap to carry on.");
    });

    this.applySettings();
    this.loop = new Loop(
      (dt) => this.update(dt),
      (dt) => this.render(dt),
    );
    this.resize();
  }

  /** Budgets, for testing (draw calls, triangles, memory, how long the map took to build). */
  get stats(): { worldMs: number; calls: number; triangles: number; geometries: number; textures: number; map: string } {
    const r = this.renderer.info;
    return { worldMs: Math.round(this.worldMs), calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures, map: this.world?.info.id ?? "" };
  }

  start(): void {
    if (this.host.blocked) {
      this.screens.blocked(this.host.blocked);
      this.renderOnce();
      return;
    }
    this.toLobby();
    this.loop.start();
    void this.shop?.boot();
    const idle = (window as unknown as { requestIdleCallback?: (fn: () => void, o?: object) => void }).requestIdleCallback;
    const later = (fn: () => void, t: number) => (idle ? idle(fn, { timeout: t }) : setTimeout(fn, t));
    // Get the (silent) audio engine ready while the lobby is idle, and paint
    // a few CPU outfits ahead so the first round starts without a stall.
    later(() => this.sound.prepare(), 2500);
    later(() => {
      const rng = new Rng(1234);
      for (let i = 0; i < 6; i++) warmLook(randomLook(rng), this.spec.tier);
    }, 4000);
    this.host.matches
      ?.current()
      .then((m) => m && this.onMatchUpdate(m))
      .catch(() => {});
    this.refreshRank();
    this.pollCounts();
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────

  private toLobby(): void {
    if (this.tut) this.closeTutorial();
    this.leaveOnline();
    this.endRound();
    this.flow.reset("lobby");
    this.paused = false;
    this.tryOn = null;
    this.returnAt = 0;
    this.view = "lobby";
    this.loop.setFpsCap(this.spec.tier === 2 ? 60 : 30);
    this.controls.enabled = false;
    this.setActions(false);
    this.touch.classList.remove("live");
    this.hud.show(false);
    this.hud.clearVerdict();
    this.stage.setMode("lobby");
    this.stage.setLook(this.myLook(), this.settings.lobbyPose);
    this.stage.setFraming("center");
    this.stage.interactive = true;
    this.chat.setAvailable(false);
    this.showLobby();
    if (!this.loop.isRunning && !this.hostPaused) this.loop.start();
  }

  private showLobby(): void {
    const daily = ensureDaily(this.settings.daily);
    this.screens.lobby({
      host: this.host,
      settings: this.settings,
      online: this.onlineAvailability(),
      shop: !!this.shop,
      level: levelOf(this.settings.xp),
      rank: this.rank,
      friends: { ...this.onlineCounts, recent: this.settings.recent.map((r) => r.name) },
      daily: daily.map((def, i) => ({ def, progress: this.settings.daily.progress[i] ?? 0 })),
      mode: this.playMode,
      badge: this.settings.badge && !!this.shop?.owned.has("badge_gold"),
    });
    this.stage.setFraming("center");
  }

  /** Back to the lobby screen without leaving the stage (closing a panel). */
  private closePanel(): void {
    this.tryOn = null;
    this.stage.setLook(this.myLook(), this.settings.lobbyPose);
    this.showLobby();
  }

  private frame(f: Framing): void {
    this.stage.setFraming(f);
  }

  private refreshRank(): void {
    if (!this.host.can.leaderboard) return;
    this.host
      .leaderboard()
      .then((b) => {
        this.rank = b?.me?.label ?? null;
        if (this.screens.name === "lobby") this.showLobby();
      })
      .catch(() => {});
  }

  /** The friends panel's counts: a light connection to the server while in the lobby. */
  private pollCounts(): void {
    if (this.onlineAvailability() !== "ready") return;
    const net = this.ensureNet();
    net?.connect().catch(() => {});
  }

  private showCustomize(): void {
    this.frame("left-panel");
    this.screens.customize(this.tryOn ?? this.settings.look, this.customizeTab, this.owned(), !!this.shop);
  }

  private showEmotes(): void {
    this.frame("left-panel");
    this.screens.emotes(this.emoteSel, this.owned(), this.settings.wheel, this.wheelSlot, !!this.shop);
  }

  private showLoadout(): void {
    this.frame("left-panel");
    this.screens.loadout(this.settings);
  }

  private showStore(): void {
    this.frame("left-panel");
    this.screens.store(this.owned(), this.settings.badge, this.shopBusy, this.shopNote, !!this.shop);
  }

  private showFriends(): void {
    this.frame("right-panel");
    if (this.friendsTab === "invite" && this.onlineAvailability() === "ready") this.ensureNet()?.connect().catch(() => {});
    this.screens.friends({
      online: this.onlineAvailability(),
      recent: this.settings.recent,
      counts: this.onlineCounts,
      tab: this.friendsTab,
      code: this.room?.kind === "private" ? this.room.code : null,
    });
  }

  private showPlay(): void {
    this.frame("full");
    this.screens.play({
      mode: this.playMode,
      settings: this.settings,
      online: this.onlineAvailability(),
      lagosLife: !!this.host.matches,
      error: this.playError,
      connecting: this.connecting,
      sky: withMode(this.skyPick ?? mapOf(this.settings.map).sky, this.settings.lightMode),
    });
  }

  private showSettings(): void {
    this.frame("full");
    this.screens.settings(this.settings, this.settingsTab, this.settingsFrom, this.tierNote());
  }

  private tierNote(): string {
    const s = this.spec;
    return this.settings.graphics === "auto" ? `Auto chose ${s.name} for this device` : `${s.name}`;
  }

  /** Put the chosen look on and tell everyone. */
  private setLook(next: Look, preview = false): void {
    const clean = cleanLook(next);
    if (preview) {
      this.tryOn = clean;
      this.stage.setLook(clean, this.settings.lobbyPose);
      return;
    }
    this.tryOn = null;
    this.settings.look = clean;
    saveSettings(this.host, this.settings);
    this.stage.setLook(this.myLook(), this.settings.lobbyPose);
    this.sendLook();
  }

  private owned(): ReadonlySet<string> {
    return this.shop?.owned ?? new Set<string>();
  }

  // ── Flow ──────────────────────────────────────────────────────────────────

  /** Stop whatever round is running and put the world back to idle. */
  private endRound(): void {
    if (this.round instanceof OnlineRound) this.round.dispose();
    this.round = null;
    this.brains = [];
    this.watching = false;
    this.resultsIn = -1;
    this.slowmo = 0;
    this.loop.timeScale = 1;
    this.loop.setStepping(false);
    this.sound.stopSong();
    this.fx.clear();
    this.bubbles.clear();
    this.wheel.close();
    this.spectateId = null;
    this.doll.setSinging(false);
    this.doll.setWatching(false);
    this.walkout = null;
    this.offerTutorial = false;
    this.flowBtns.show(false, false);
    this.countdown.clear();
    this.rig.firstPerson = false;
    this.crowd.hideMyHead = false;
    this.hud.setFirstPerson(false);
    // Elimination and highlights.
    this.replay.stop();
    this.replayUi.hide();
    this.replaying = null;
    this.rec = null;
    this.hl = null;
    this.caughtNow = [];
    this.zoomId = null;
    this.outSeq = null;
    this.spectateIn = -1;
    this.potg = null;
    this.potgNext = null;
    this.potgIn = -1;
    this.finalShot = null;
    this.rig.clearZoom();
    this.sound.stopTension();
    this.resultsBtn.classList.remove("visible");
  }

  /** Play Solo vs AI: a short loading card while the map is built, then the walkout. */
  private practice(): void {
    this.leaveOnline();
    this.flow.go("loading");
    this.screens.loading();
    // Let the card paint before the (blocking) build.
    setTimeout(() => this.startPractice(), 40);
  }

  private startPractice(): void {
    this.leaveOnline();
    this.flow.reset("loading");
    const seed = randomSeed();
    const rng = new Rng(seed ^ 0xa5a5a5a5);
    const people: { id: string; name: string; bot: boolean }[] = [{ id: ME, name: "You", bot: false }];
    // No CPU shares your name: "Ada · CPU caught" must never read as you.
    const mine = this.host.player.name.trim().toLowerCase();
    const names = rng.shuffle(BOT_NAMES.filter((n) => n.toLowerCase() !== mine));
    for (let i = 0; i < PRACTICE.bots; i++) people.push({ id: `cpu${i}`, name: names[i], bot: true });

    const info = mapOf(this.settings.map);
    const course = courseFor(this.settings.mode, this.settings.distance, fieldHalfWidth(info, this.settings.mode));
    const round = new RedLightRound({ seed, contestants: people, featuredId: ME, course, walkout: walkoutLength(course.mode) });
    this.mode = "practice";
    this.meId = ME;
    // The first time on a field: the tutorial button (SPEC-V2 §1.5).
    const first = !this.settings.tutorialSeen;
    if (first) this.settings.tutorialSeen = true;
    this.beginRound(round, rng, this.settings.map, this.skyPick, []);
    this.offerTutorial = first;
    this.brains = people.slice(1).map((p, i) => new BotBrain(p.id, i, rng));
  }

  private startOnline(info: StartInfo | SyncInfo, sync: boolean): void {
    const net = this.net;
    if (!net) return;
    this.endRound(); // dispose the old round before the new one subscribes
    const me = this.seatId ?? net.id;
    const round = sync ? OnlineRound.fromSync(info as SyncInfo, me, net) : new OnlineRound(info, me, net);
    this.mode = "online";
    this.flow.reset("loading");
    this.meId = me;
    // People you played with show up in Friends (names only).
    const at = Date.now();
    for (const r of info.roster) {
      if (r.id === me) continue;
      this.settings.recent = [{ name: r.name, at }, ...this.settings.recent.filter((x) => x.name !== r.name)].slice(0, 30);
    }
    this.beginRound(round, new Rng(info.seed ^ 0xa5a5a5a5), info.map ?? DEFAULT_MAP, null, info.roster.map((r) => r.look));
  }

  /** Everything both kinds of round need at their start. */
  private beginRound(round: RoundView, rng: Rng, mapId: string, sky: SkyState | null, wire: (WireLook | undefined)[] = []): void {
    this.endRound();
    this.round = round;
    this.view = "game";
    this.stage.interactive = false;
    const course = round.course;
    this.ensureWorld(mapId, sky, course);
    this.doll.placeAt(course.dollZ);
    this.rig.dollZ = course.dollZ;
    this.rig.wallX = course.halfWidth + 1.4;
    this.hud.setCourse(course);
    this.props.setup(round.balls, round.baskets);
    const meIndex = round.get(this.meId)?.index ?? -1;

    const mine = this.myLook();
    this.ownLooks = round.contestants.map((c, i) => {
      if (i === meIndex && !this.tut) return mine;
      // Online: as the server says they look; practice: a believable stranger.
      if (this.mode === "online" && wire[i]) return fromWire(wire[i]);
      return randomLook(new Rng((rng.next() * 1e9) ^ (c.id.length * 77)));
    });
    // On the field everyone wears the black suit with their seat number.
    this.looks = this.ownLooks.map((l, i) => uniformLook(l, i + 1));
    this.crowd.setup(this.looks, meIndex);
    // Through the walkout she faces the field (the close-up); she turns to the wall for the countdown.
    this.doll.setFacing(round.phase === "walkout");

    this.my = "playing";
    this.paused = false;
    this.recorded = null;
    this.rec = new Recorder(round.contestants.length, round.balls.length);
    // Solo scores its own highlights; online the server does (the tutorial has none).
    this.hl = this.mode === "practice" && !this.tut ? new Highlights() : null;
    this.turnNo = 0;
    this.zoomTurn = -1;
    this.watchesSurvived = 0;
    this.sprintMetres = 0;
    this.songTurn = 0;
    this.songId = songFor(round.seed, 0);
    this.songBeat = 0;
    this.lastPhase = "";

    this.hud.reset(this.looks.map((l, i) => ({ accent: accentOf(l), me: i === meIndex })));
    this.hud.setOnline(this.mode === "online");
    this.screens.hide();
    this.controls.reset();
    const me = round.get(this.meId);
    if (round.phase === "walkout") {
      // The walkout: pictures only, no HUD, no controls (SPEC-V2 §1.3).
      this.startWalkout(round);
    } else {
      this.hud.show(true);
      this.setLive(!this.tut);
      if (me) this.rig.follow(true, me);
    }
    this.rig.firstPerson = this.settings.firstPerson;
    this.crowd.hideMyHead = this.settings.firstPerson;
    this.hud.setFirstPerson(this.settings.firstPerson);
    this.loop.setStepping(true);
    this.loop.setFpsCap(this.spec.tier === 0 ? 30 : 60);
    if (!this.loop.isRunning && !this.hostPaused) this.loop.start();
    this.warmUp();
    this.hud.map.setTerrain(this.terrainShot(course));
    this.board.show(false);
    this.quick.toggle(false);

    if (!this.tut) this.settings.played++;
    saveSettings(this.host, this.settings);
  }

  /** Controls on (or off) for play. */
  private setLive(on: boolean): void {
    this.controls.enabled = on;
    this.setActions(on);
    this.touch.classList.toggle("live", on);
  }

  // ── Walkout, countdown, tutorial (SPEC-V2 §1.3, §1.5) ────────────────────

  private startWalkout(round: RoundView): void {
    this.flow.go("walkout");
    this.hud.show(false);
    this.setLive(false);
    const me = round.get(this.meId) ?? round.contestants[0];
    const lasers = this.world?.lasers;
    const preview = previewShots({
      course: round.course,
      balls: round.balls,
      baskets: round.baskets,
      towers: lasers?.spots ?? [],
      dollFace: (out) => {
        this.doll.eyes(_eyeL, _eyeR);
        return out.addVectors(_eyeL, _eyeR).multiplyScalar(0.5);
      },
    });
    this.walkout = new Walkout(round.contestants, preview, behindShot((p, l) => this.rig.restPose(me, p, l)));
  }

  /** Skip: your lens jumps behind the players; the referee starts the countdown when everyone has. */
  private skipWalkout(): void {
    const round = this.round;
    const w = this.walkout;
    if (!round || !w || round.phase !== "walkout" || !w.canSkip(round.phaseTime)) return;
    this.sound.ui();
    w.skip(round.phaseTime);
    if (this.mode === "online") this.net?.send({ t: "skip" });
    else if (round instanceof RedLightRound) round.skip(this.meId);
  }

  /** The tutorial: a real round on the short field, played by a model (rlgl/tutorial.ts). */
  private startTutorial(after: "solo" | "menu"): void {
    if (this.tut) return;
    this.leaveOnline();
    this.endRound();
    const mode = this.settings.mode;
    const info = mapOf(this.settings.map);
    const course = courseFor(mode, 100, fieldHalfWidth(info, mode));
    const seed = randomSeed();
    const script = new TutorialScript(mode);
    this.tut = { script, after, wrapAt: 0 };
    this.settings.tutorialSeen = true;
    const round = new RedLightRound({ seed, contestants: tutorialPeople(mode), featuredId: DEMO, course });
    this.mode = "practice";
    this.meId = DEMO;
    this.flow.reset("play");
    this.beginRound(round, new Rng(seed ^ 0xa5a5a5a5), this.settings.map, this.skyPick, []);
    this.tutorial.start(mode === "balls" ? "Ball Haunting" : "Classic Run", tutorialSteps(mode));
  }

  private closeTutorial(): void {
    this.tutorial.close();
    this.tut = null;
    this.meId = ME;
  }

  /** Closed or done: back where it was opened from (a Solo match starts fresh). */
  private endTutorial(): void {
    const after = this.tut?.after ?? "menu";
    this.closeTutorial();
    this.endRound();
    if (after === "solo") {
      this.startPractice();
    } else {
      this.toLobby();
      this.showPlay();
    }
  }

  /** Build the map's world (kept if the next round is on the same map). */
  private ensureWorld(mapId: string, pick: SkyState | null, course?: Course): void {
    // Light / dark mode decides over the pick (SPEC-V2 §6.4).
    const sky = withMode(pick ?? mapOf(mapId).sky, this.settings.lightMode);
    this.worldArgs = { mapId, pick, course };
    const key = `${mapId}|${sky}|${this.spec.tier}|${course ? `${course.distance}/${course.halfWidth}` : ""}`;
    if (this.world && key === this.worldKey) return;
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    const t0 = performance.now();
    this.world = buildWorld(mapId, sky, this.spec, this.atlas, course);
    this.worldMs = performance.now() - t0;
    this.worldKey = key;
    this.scene.add(this.world.group);
    this.scene.fog = this.world.fog;
    this.renderer.setClearColor(this.world.clear);
    this.rig.colliders = this.world.colliders;
    this.sizeParticles();
  }

  /** Particle sizes follow the drawing buffer and the lens. */
  private sizeParticles(): void {
    const h = this.renderer.getDrawingBufferSize(_size).y || window.innerHeight;
    this.world?.setScale(h, this.camera.fov);
  }

  private setActions(on: boolean): void {
    this.actionsOn = on;
    this.controls.showActions(on);
  }

  private toggleView(): void {
    if (!this.round || this.my !== "playing") return;
    const on = !this.rig.firstPerson;
    this.rig.firstPerson = on;
    this.crowd.hideMyHead = on;
    this.hud.setFirstPerson(on);
    this.haptic("select");
  }

  // ── Fixed step ────────────────────────────────────────────────────────────

  private update(dt: number): void {
    const round = this.round;
    if (!round) return;
    // Practice freezes on pause. Online the round goes on without you — you
    // simply stand still, which is the safest thing to do in this game.
    if (this.paused && this.mode === "practice") return;

    this.controls.update();
    if (this.tut) {
      // The model plays; your stick does nothing.
      this.tut.script.think(round as RedLightRound);
    } else if (this.my === "playing" && !this.paused) {
      const { x, y } = this.controls.move;
      const yaw = this.rig.yaw;
      // Stick is camera-relative: up = where the camera looks.
      const wx = Math.cos(yaw) * x - Math.sin(yaw) * y;
      const wz = -Math.sin(yaw) * x - Math.cos(yaw) * y;
      round.setInput(this.meId, wx, wz);
      round.setButtons(this.meId, this.controls.sprint, this.controls.stance as Stance, this.controls.jumps);
      round.setActions(this.meId, this.controls.attacks, this.controls.grabs);
    } else {
      round.setInput(this.meId, 0, 0);
      round.setButtons(this.meId, false, 0, this.controls.jumps);
    }

    for (const b of this.brains) b.think(round as RedLightRound, round.get(b.id)!);
    round.step(dt);
    if (this.tut) {
      // The model is over the line: a moment to see it, then the last step.
      if (this.tut.script.done && !this.tut.wrapAt) this.tut.wrapAt = performance.now() + 2500;
      if (this.tut.wrapAt && performance.now() >= this.tut.wrapAt) {
        this.tutorial.show("end");
        this.tutorial.finish();
        this.tut.wrapAt = Infinity;
      }
    }
    const me = round.get(this.meId);
    if (me?.sprinting) this.sprintMetres += Math.hypot(me.vx, me.vz) * dt;
    // The song plays on under the hum.
    if (round.phase === "sing" || round.phase === "hum") this.songBeat += (dt * SONGS[this.songId].bpm) / 60;
    const events = round.drain();
    // Solo: the play of the game is scored here (online it arrives from the server as a "moment").
    if (this.hl && round instanceof RedLightRound) {
      const m = this.hl.observe(round, events);
      if (m) events.splice(events[events.length - 1]?.type === "ended" ? events.length - 1 : events.length, 0, { type: "moment", ...m });
    }
    // What this phone shows, for the kill cam and the play of the game.
    if (this.rec && !prePlay(round.phase) && round.phase !== "ended") this.rec.step(dt, round.elapsed, PHASES.indexOf(round.phase), round.contestants, round.balls, this.doll.pose(this.dollPose));
    for (const e of events) this.onEvent(e);
    if (this.caughtNow.length) this.afterCatches();
    this.keepPotgClip(false);
  }

  /**
   * A better moment's clip, cut once everything after it is recorded (or the
   * round is over). Until then — or if it can't be cut — the last one stands.
   */
  private keepPotgClip(force: boolean): void {
    const next = this.potgNext;
    if (!next || !this.rec) return;
    if (!force && this.rec.latest < next.t + CLIP.after) return;
    this.potgNext = null;
    const clip = this.rec.clip(next.t - CLIP.before, next.t + CLIP.after);
    if (clip) this.potg = { m: next, clip };
  }

  private onEvent(e: RoundEvent): void {
    if (this.tut) {
      const step = this.tut.script.onEvent(e, this.round as RedLightRound);
      if (step) this.tutorial.show(step);
      if (step === "end") this.tutorial.finish();
    }
    switch (e.type) {
      case "phase":
        this.onPhase(e.phase, e.duration);
        break;
      case "eliminated":
        this.onCaught(e.id, e.cause);
        break;
      case "finished":
        this.onFinished(e.id, e.place);
        break;
      case "ended":
        this.onEnded();
        break;
      case "attack":
        this.onAttack(e.id, e.kind, e.target, e.dropped);
        break;
      case "grab": {
        const c = this.round?.get(e.id);
        if (c) this.crowd.act(c.index, "grab");
        if (e.id === this.meId) {
          this.sound.ball(false);
          this.haptic("select");
        }
        break;
      }
      case "drop":
        break;
      case "bank":
        if (e.id === this.meId) {
          this.sound.ball(true);
          this.haptic("success");
        }
        break;
      case "final":
        this.onFinalTwo(e.ids);
        break;
      case "moment":
        // A better play of the game: its clip is cut once the seconds after it are recorded.
        this.potgNext = { kind: e.kind, who: e.who, t: e.t, score: e.score };
        break;
    }
  }

  /**
   * Two left running (SPEC-V2 §2.8): everything slows (the referee's clock —
   * the round's timeScale — the same on every phone), the music builds, and
   * the camera closes in: on your own run if you're one of them, else a
   * cutscene of the two.
   */
  private onFinalTwo(ids: [string, string]): void {
    if (this.tut) return;
    this.sound.finalTwo(FINAL.seconds);
    this.haptic("heavy");
    if (ids.includes(this.meId) && this.my === "playing") this.rig.push(0.78, FINAL.seconds);
    else if (!this.replaying && this.view === "game") {
      // A cutscene: the pair, nothing else on screen.
      this.finalShot = { ids, t: 0 };
      this.hud.show(false);
      this.resultsBtn.classList.remove("visible");
    }
  }

  /** A swing: animate it; if it landed, the target staggers (and, if it's you, the screen jolts). */
  private onAttack(id: string, kind: AttackKind, targetId: string | null, dropped: number): void {
    const round = this.round;
    const c = round?.get(id);
    if (!round || !c) return;
    this.crowd.act(c.index, kind);
    const t = targetId ? round.get(targetId) : undefined;
    const me = round.get(this.meId);
    const near = !!me && Math.hypot(c.x - me.x, c.z - me.z) < 12;
    if (near) this.sound.strike(kind, !!t);
    if (!t) return;
    this.crowd.hit(t.index, t, t.x - c.x, t.z - c.z);
    if (t.id === this.meId) {
      this.rig.kick(kind === "fist" ? 0.45 : 0.3);
      this.haptic("heavy");
    }
    if (dropped >= 0 && (t.id === this.meId || id === this.meId)) this.hud.pushFeed(t.id === this.meId ? "Your ball got knocked loose" : `You knocked ${this.label(t)}'s ball loose`, "info");
  }

  private onPhase(phase: string, duration: number): void {
    const playing = this.my === "playing";
    const from = this.lastPhase;
    this.lastPhase = phase;
    // A stare you stood through.
    if (from === "watch" && playing) this.watchesSurvived++;
    switch (phase) {
      case "countdown":
        this.toCountdown(from === "walkout");
        break;
      case "sing":
        if (from === "countdown") {
          this.flow.go("play");
          this.countdown.clear();
          this.offerTutorial = false;
          this.flowBtns.show(false, false);
        }
        // After a fake hum the song never stopped: it just carries on.
        if (from === "hum") break;
        // A fresh call: the next of her two songs (the seed decides which comes first, so a room hears the same).
        this.songId = songFor(this.round?.seed ?? 0, this.songTurn++);
        this.songBeat = 0;
        this.sound.playSong(this.songId, this.songBeat);
        this.hud.setSignal("none"); // the countdown's done: nothing on screen but the run
        this.doll.setSinging(true);
        this.doll.setWatching(false);
        break;
      case "hum":
        // The warning: she hums under the song. Real or fake, it sounds the same.
        this.sound.hum(duration || RULES.hum.length);
        if (playing) this.haptic("select");
        break;
      case "turning":
        this.turnNo++;
        this.sound.stopSong();
        this.doll.setSinging(false);
        this.doll.face(true, duration);
        this.sound.turn();
        break;
      case "watch":
        this.doll.setWatching(true);
        this.sound.watch();
        break;
      case "turningBack":
        this.doll.setWatching(false);
        this.doll.face(false, duration);
        this.sound.release();
        break;
    }
  }

  /** The walkout is over (or there wasn't one): HUD and controls on, the lens behind you, Mama to the wall. */
  private toCountdown(fromWalkout: boolean): void {
    const round = this.round;
    if (!round) return;
    this.walkout = null;
    this.flow.go("countdown");
    if (fromWalkout) this.doll.face(false, 1.1);
    else this.doll.setFacing(false);
    this.hud.show(true);
    this.setLive(!this.tut && this.my === "playing");
    const me = round.get(this.meId);
    if (me) this.rig.follow(true, me);
    this.flowBtns.show(false, this.offerTutorial, true);
  }

  private onCaught(id: string, cause: Cause): void {
    const round = this.round!;
    const c = round.get(id);
    const me = round.get(this.meId);
    if (!c || !me) return;
    const isMe = id === this.meId && !this.tut;

    // The elimination (SPEC-V2 §2.6). Per body: the beam from the nearest laser
    // gun, the blood, the slow fall that stays, the kill feed. Per batch (all
    // caught this step, afterCatches): her head's crack, the drum, the zoom.
    this.crowd.chest(c, _chest);
    _away.set(c.x, 0, c.z - round.course.dollZ).normalize();
    if (cause === "moved") {
      if (this.world) {
        this.world.lasers.fireAt(_chest, _eyeL);
        this.fx.beam(_eyeL, _eyeL, _chest);
      } else {
        this.doll.eyes(_eyeL, _eyeR);
        this.fx.beam(_eyeL, _eyeR, _chest);
      }
    }
    this.fx.burst(_chest, _away, isMe ? 40 : cause === "time" ? 14 : 24);
    this.crowd.kill(c.index, c, 0, round.course.dollZ);
    if (cause === "moved") this.caughtNow.push(c);

    const near = isMe || Math.hypot(c.x - me.x, c.z - me.z) < 7;
    this.sound.catch(near);
    this.rig.kick(isMe ? 1.2 : near ? 0.35 : 0.1);
    // The kill feed (step 9): "[Name] was eliminated".
    this.hud.pushFeed(`${isMe ? "You were" : `${this.label(c)} was`} eliminated`, "out");

    if (isMe && this.mode === "practice") this.cpuReact(["laugh", "taunt"], 2, 0.5);
    if (isMe) {
      this.my = "out";
      this.controls.enabled = false;
      this.controls.reset();
      this.setActions(false);
      this.touch.classList.remove("live");
      this.sound.stopSong();
      // The red vignette (step 7) comes with the verdict.
      this.hud.showVerdict(cause === "moved" ? "out" : cause);
      this.haptic("heavy");
      setTimeout(() => this.haptic("error"), 180);
      // See the fall from outside, even in first person.
      this.rig.firstPerson = false;
      this.crowd.hideMyHead = false;
      this.hud.setFirstPerson(false);
      this.rig.clearZoom();
      if (cause === "moved") {
        // Your fall in slow motion: the whole round in Solo; online (the server
        // can't wait) just your body's own clock.
        if (this.mode === "practice") {
          this.loop.timeScale = 0.3;
          this.slowmo = OUT_FALL_S;
        } else {
          this.crowd.slowFall(c.index, 0.3, OUT_FALL_S);
        }
        this.rig.cinematic(_chest, _away);
        // Then the kill cam (2 s from her eyes), then you spectate.
        this.outSeq = { stage: "fall", left: OUT_FALL_S };
      } else {
        this.spectateIn = 2;
      }
      this.record(cause);
    }
  }

  /**
   * Everyone Mama caught this step, together: her head snaps round to the
   * nearest of them with a CRACK (step 1), her eyes flash red (step 8), one
   * low drum (step 6). Your screen zooms in on that one for a moment (step 2,
   * once a turn), their fall in slow motion (step 4), a shake (step 5) and a
   * red edge (step 7) — unless it was you: then your own sequence plays.
   */
  private afterCatches(): void {
    const round = this.round;
    const list = this.caughtNow;
    this.caughtNow = [];
    if (!round) return;
    const me = round.get(this.meId);
    if (!me) return;
    let nearest = list[0];
    for (const c of list) if (Math.hypot(c.x - me.x, c.z - me.z) < Math.hypot(nearest.x - me.x, nearest.z - me.z)) nearest = c;
    const mine = list.some((c) => c.id === this.meId) && !this.tut;
    const near = mine || Math.hypot(nearest.x - me.x, nearest.z - me.z) < 12;
    this.doll.caught(nearest.x, nearest.z);
    this.sound.crack(near);
    this.sound.drum(near);
    if (mine || this.replaying || this.zoomTurn === this.turnNo || this.view !== "game") return;
    this.zoomTurn = this.turnNo;
    this.zoomId = nearest.id;
    this.rig.zoom(this.crowd.chest(nearest, _chest), ZOOM_S);
    this.crowd.slowFall(nearest.index, 0.35, ZOOM_S);
    this.rig.kick(0.55);
    this.hud.flashRed();
  }

  private onFinished(id: string, place: number): void {
    const round = this.round!;
    const c = round.get(id);
    if (!c) return;
    this.crowd.finish(c.index);
    if (this.tut) {
      this.hud.pushFeed(`${c.name} crossed`, "safe");
      return;
    }
    if (id === this.meId) {
      this.my = "safe";
      this.controls.enabled = false;
      this.controls.reset();
      this.setActions(false);
      this.touch.classList.remove("live");
      this.hud.showVerdict("safe");
      this.sound.win();
      this.haptic("success");
      this.record("finished");
      // A moment to enjoy it, then watch the rest (the results come when the round ends).
      this.spectateIn = 2.2;
    } else {
      this.hud.pushFeed(`${this.label(c)} crossed${place === 1 ? " first" : ""}`, "safe");
      if (c.bot && Math.random() < 0.4) setTimeout(() => this.playEmote(c.id, Math.random() < 0.5 ? "dance" : "flex"), 600);
    }
  }

  private onEnded(): void {
    this.flow.go("end");
    if (this.mode === "online" && this.room?.kind === "match" && (!this.vOutcome || this.vOutcome === MATCH_STILL_ON)) {
      this.setOutcome("Round over. Sending the result to Lagos Life…");
    }
    this.sound.stopSong();
    this.sound.stopTension();
    // Still on the field (playing, watching, or in your own sequence): the play
    // of the game, then the results. Already on the results: nothing more.
    if (this.view !== "game" || this.tut) return;
    this.keepPotgClip(true);
    this.potgIn = this.potg ? 1.2 : -1;
    if (!this.potg) this.resultsIn = 1.6;
  }

  /** Into spectating: follow whoever is ahead, next-runner and results buttons. */
  private toSpectate(): void {
    this.outSeq = null;
    this.spectateIn = -1;
    if (!this.round || this.view !== "game") return;
    this.hud.clearVerdict();
    if (this.round.phase === "ended" || this.round.aliveCount === 0) {
      if (this.potgIn < 0 && this.resultsIn < 0 && !this.replaying) this.resultsIn = 0.6;
      return;
    }
    this.watching = true;
    this.rig.follow();
    this.resultsBtn.classList.add("visible");
  }

  /** The kill cam (SPEC-V2 §2.7): the 2 s before you were shot, from Mama's eyes. */
  private startKillCam(): boolean {
    const round = this.round;
    const me = round?.get(this.meId);
    if (!round || !me || !this.rec || me.eliminatedAt < 0) return false;
    const clip = this.rec.clip(me.eliminatedAt - KILLCAM_BEFORE, me.eliminatedAt + KILLCAM_AFTER);
    if (!clip) return false;
    const idx = me.index;
    const shotAt = KILLCAM_BEFORE / (KILLCAM_BEFORE + KILLCAM_AFTER);
    this.replay.start(
      clip,
      round.course.dollZ,
      (pos, look, at) => {
        const c = at.people[idx];
        this.crowd.chest(c, _a);
        return killCamLens((l, r) => this.doll.eyes(l, r), _a, at.u, pos, look);
      },
      // As it was, then the shot and the fall at half speed (about 2 s in all).
      (u) => (u < shotAt ? 1 : 0.5),
    );
    this.beginReplay("killcam");
    return true;
  }

  /** The play of the game (SPEC-V2 §2.9): the round's best moment, in slow motion at its heart. */
  private startPotg(): boolean {
    const round = this.round;
    const p = this.potg;
    if (!round || !p) return false;
    const who = round.contestants[p.m.who];
    if (!who) return false;
    const key = CLIP.before / (CLIP.before + CLIP.after);
    const side = who.x > 0 ? -1 : 1;
    this.replay.start(
      p.clip,
      round.course.dollZ,
      (pos, look, at) => {
        this.crowd.chest(at.people[p.m.who], _a);
        return potgLens(_a, at.u, side, pos, look);
      },
      // Slow motion round the moment itself.
      (u) => (Math.abs(u - key) < 0.14 ? 0.35 : 1),
    );
    this.beginReplay("potg", this.label(who), MOMENT_NAME[p.m.kind]);
    return true;
  }

  private beginReplay(kind: "killcam" | "potg", who = "", what = ""): void {
    this.replaying = kind;
    this.finalShot = null;
    this.rig.clearZoom();
    this.hud.show(false);
    this.hud.clearVerdict();
    this.setActions(false);
    this.resultsBtn.classList.remove("visible");
    this.watching = false;
    this.bubbles.clear();
    this.replayUi.show(kind, who, what);
  }

  /** The replay is over (or skipped): the kill cam goes on to spectating, the play of the game to the results. */
  private endReplay(): void {
    const kind = this.replaying;
    if (!kind) return;
    this.replay.stop(this.round?.contestants);
    this.replaying = null;
    this.replayUi.hide();
    if (kind === "potg") {
      this.showResults();
      return;
    }
    this.hud.show(true);
    this.toSpectate();
  }

  private record(outcome: "finished" | Cause): void {
    if (this.recorded || !this.round || this.tut) return;
    const round = this.round;
    const me = round.get(this.meId)!;
    const finished = outcome === "finished";
    const first = finished && me.place === 1;
    const score = scoreFor({ finished, timeLeft: round.timeLeft, progress: me.progress, first, distance: round.course.distance });
    const newBest = score > this.settings.best;
    if (newBest) this.settings.best = score;
    if (finished) this.settings.wins++;
    const before = levelOf(this.settings.xp).level;
    const xp = xpForRound({ finished, first, watches: this.watchesSurvived, online: this.mode === "online" });
    this.settings.xp += xp;
    const after = levelOf(this.settings.xp).level;
    const d = this.settings.daily;
    const completed = [
      ...addProgress(d, "rounds", 1),
      ...(finished ? addProgress(d, "cross", 1) : []),
      ...(first ? addProgress(d, "first", 1) : []),
      ...addProgress(d, "watches", this.watchesSurvived),
      ...(this.mode === "online" ? addProgress(d, "online", 1) : []),
      ...addProgress(d, "sprint", Math.round(this.sprintMetres)),
    ];
    saveSettings(this.host, this.settings);
    if (score > 0) this.host.submitScore(score);

    let boardNote: string | null = null;
    if (this.host.kind === "lagoslife") boardNote = this.host.can.leaderboard ? "Score sent to the board" : "Sign in to Lagos Life to rank";
    this.recorded = {
      outcome,
      place: me.place,
      time: me.finishTime,
      progress: Math.min(1, me.progress / round.course.distance),
      score,
      best: this.settings.best,
      newBest,
      survivors: 0,
      total: round.contestants.length,
      canWatch: false,
      boardNote,
      online: this.mode === "online" ? (this.room?.kind ?? "quick") : null,
      matchNote: this.vOutcome ?? (round.phase !== "ended" ? MATCH_STILL_ON : null),
      xp,
      level: after,
      levelUp: after > before,
      completed,
    };
  }

  /** The winner's circle: top three (by place, or by distance if nobody crossed). */
  private showResults(): void {
    const round = this.round;
    if (!round || !this.recorded) return;
    const r = this.recorded;
    r.survivors = round.contestants.filter((c) => c.status === "finished").length;
    r.canWatch = round.phase !== "ended" && round.aliveCount > 0;
    // Whatever was on: a replay, a sequence, the final two's music.
    if (this.replaying) this.replay.stop(round.contestants);
    this.replaying = null;
    this.replayUi.hide();
    this.outSeq = null;
    this.spectateIn = -1;
    this.potgIn = -1;
    this.resultsIn = -1;
    this.finalShot = null;
    this.watching = false;
    this.resultsBtn.classList.remove("visible");
    this.sound.stopTension();
    this.hud.clearVerdict();
    this.hud.show(false);
    this.setActions(false);
    this.flow.reset("post");
    const ranked = round.contestants
      .slice()
      .sort((a, b) => (a.status === "finished" && b.status === "finished" ? a.place - b.place : a.status === "finished" ? -1 : b.status === "finished" ? 1 : b.progress - a.progress))
      .slice(0, 3);
    this.podiumNames = ranked.map((c) => ({ name: this.label(c), time: c.status === "finished" ? c.finishTime : Math.min(1, c.progress / round.course.distance) * 100, me: c.id === this.meId }));
    this.view = "lobby";
    this.stage.setMode("podium");
    this.stage.setPodium(ranked.map((c) => this.ownLooks[c.index]));
    this.stage.interactive = false;
    // Practice and quick matches go back to the lobby on their own; rooms and matches wait for you.
    this.returnAt = r.online === null || r.online === "quick" ? performance.now() + RETURN_AFTER * 1000 : 0;
    this.screens.postmatch(r, this.podiumNames, this.returnAt ? RETURN_AFTER : 0);
    this.loop.setFpsCap(30);
  }

  // ── Online ────────────────────────────────────────────────────────────────

  private onlineAvailability(): OnlineAvailability {
    if (!this.server) return "unavailable";
    if (navigator.onLine === false) return "offline";
    return "ready";
  }

  /** The connection, made if needed. */
  private ensureNet(): NetClient | null {
    if (!this.server) return null;
    if (!this.net) {
      const net = new NetClient(this.server, this.host.player.name);
      net.on((m) => this.onServer(m));
      net.onState((s) => this.onNetState(s));
      this.net = net;
    }
    return this.net;
  }

  /** Connect, then run `then` (or show the error on the play screen). */
  private online(then: (net: NetClient) => void): void {
    const net = this.ensureNet();
    if (!net) return;
    this.playError = null;
    this.connecting = net.state !== "open";
    if (this.screens.name === "play") this.showPlay();
    net
      .connect()
      .then(() => {
        this.connecting = false;
        then(net);
      })
      .catch(() => {
        this.connecting = false;
        this.playError = "Can't reach the game server. Check your connection and try again.";
        if (this.screens.name === "play") this.showPlay();
        else this.showPlay();
      });
  }

  // ── Lagos Life matches ────────────────────────────────────────────────────

  private showMatchMenu(): void {
    this.frame("full");
    this.screens.matchMenu(this.vStake, this.vSeats, this.vError, this.vBusy);
  }

  /** create / quick / join through the world. Stakes go on the world's own sheet. */
  private async matchCall(run: () => Promise<MatchView>): Promise<void> {
    if (this.vBusy) return;
    this.vBusy = true;
    this.vError = null;
    this.showMatchMenu();
    try {
      const m = await run();
      this.vBusy = false;
      this.onMatchUpdate(m);
    } catch (e) {
      this.vBusy = false;
      const code = errorCode(e);
      this.vError =
        code === "cancelled"
          ? "No wahala. Nothing was staked."
          : code === "error" || code === "not_available"
            ? "Lagos Life matches aren't open for this game yet. Try a friendly match for now."
            : errorText(e);
      if (this.screens.name === "vmenu") this.showMatchMenu();
    }
  }

  private onMatchUpdate(m: MatchView): void {
    const fresh = !this.vmatch || this.vmatch.id !== m.id;
    this.vmatch = m;
    switch (m.status) {
      case "open":
        if (fresh || ["vmenu", "vwait", "play", "lobby"].includes(this.screens.name)) this.screens.matchWaiting(m, null);
        break;
      case "playing":
        void this.playMatch(m);
        break;
      case "done":
        this.setOutcome(this.matchOutcomeText(m));
        break;
      case "cancelled":
      case "void":
        this.vPlaying = null;
        this.vError = "That match was called off. Every stake went back.";
        if (this.screens.name === "vwait" || this.screens.name === "room") this.showMatchMenu();
        else this.setOutcome(this.vError);
        break;
    }
  }

  /** The match is full: ask OUR server to referee it, proving who we are with a session. */
  private async playMatch(m: MatchView, attempt = 0): Promise<void> {
    if (this.vPlaying === m.id && attempt === 0) return;
    this.vPlaying = m.id;
    const net = this.ensureNet();
    if (!net || !this.host.matches) {
      this.screens.fatal("Can't start the match", "This build has no game server. Every stake goes back automatically if the match isn't played.");
      return;
    }
    this.vOutcome = null;
    if (!this.round) this.showWaiting("Starting the match…");
    try {
      await net.connect();
      const session = await this.host.matches.session();
      net.send({ t: "vmatch", id: m.id, session });
    } catch {
      if (attempt < 3) setTimeout(() => void this.playMatch(m, attempt + 1), 1500);
      else this.screens.fatal("Can't reach the game server", "Check your connection. If the match isn't played, every stake goes back automatically.");
    }
  }

  private setOutcome(text: string): void {
    this.vOutcome = text;
    if (this.recorded) this.recorded.matchNote = text;
    this.screens.matchOutcome(text);
  }

  private matchOutcomeText(m: MatchView): string {
    if (m.winner === "draw" || !m.winner) return m.stake ? "Draw. Every stake went back." : "Draw. Nobody crossed first.";
    const winner = m.players.find((p) => p.id === m.winner)?.name ?? "Someone";
    if (!m.stake) return m.winner === m.me ? "You won the match." : `${winner} won the match.`;
    const pay = naira(payoutOf(m.stake, m.players.length));
    return m.winner === m.me ? `You won ${pay} Lagos Life game money.` : `${winner} took the pot (${pay}).`;
  }

  private onServer(m: ServerMsg): void {
    switch (m.t) {
      case "welcome":
        this.sendLook();
        if (typeof m.on === "number") this.setCounts(m.on, m.pl ?? 0);
        break;
      case "stats":
        this.setCounts(m.on, m.pl);
        break;
      case "seat":
        this.seatId = m.id;
        break;
      case "chat":
        if (this.settings.chat) this.chat.add({ from: m.from, name: m.name, text: m.text, mine: m.from === this.seatId, gold: m.b === 1 });
        break;
      case "emote":
        if (m.from !== this.seatId && !this.chat.isMuted(m.from)) {
          if (this.round?.get(m.from)) this.playEmote(m.from, m.e);
          else if (this.settings.chat) {
            const who = this.room?.players.find((p) => p.id === m.from)?.name ?? "Someone";
            this.chat.add({ from: m.from, name: who, text: EMOTE_BY_ID[m.e].label, mine: false });
          }
        }
        break;
      case "note":
        this.chat.add({ from: "", name: "", text: m.text, mine: false, system: true });
        if (this.round && this.my === "playing") this.hud.pushFeed(m.text, "info");
        break;
      case "vresult":
        if (!m.posted) {
          this.setOutcome("Couldn't reach Lagos Life with the result. If it doesn't settle within 2 hours, every stake goes back.");
        } else {
          if (this.vmatch?.status !== "done") this.setOutcome("Result sent. Lagos Life is settling the match…");
          setTimeout(() => this.host.matches?.current().then((x) => x && this.onMatchUpdate(x)).catch(() => {}), 800);
        }
        break;
      case "room":
        this.room = m.room;
        if (m.room.state === "lobby" && !this.round) this.flow.go(m.room.map ? "loading" : "waiting");
        if (this.screens.name === "room" || this.screens.name === "friends") this.showRoom();
        // Loading: the server has picked the map — build it now, under the loading bar.
        if (m.room.map && m.room.state === "lobby" && !this.round) {
          const r = m.room;
          const map = r.map!;
          setTimeout(() => {
            if (this.room !== r || this.round) return;
            this.ensureWorld(map, null, courseFor(r.mode, r.dist, fieldHalfWidth(mapOf(map), r.mode)));
            this.warmUp();
          }, 60);
        }
        break;
      case "start":
        this.startOnline(m.start, false);
        break;
      case "sync":
        if (!(this.round instanceof OnlineRound) || this.round.seed !== m.sync.seed) this.startOnline(m.sync, true);
        break;
      case "left":
        this.room = null;
        break;
      case "err":
        if ((m.code === "match_state" || m.code === "verify") && this.vmatch?.status === "playing" && !this.round && this.vRetries++ < 3) {
          setTimeout(() => this.vmatch && void this.playMatch(this.vmatch, this.vRetries), 1500);
          break;
        }
        this.onlineError = m.msg ?? ERROR_TEXT[m.code];
        if (this.screens.name === "room") this.showRoom();
        else {
          this.playError = this.onlineError;
          // Only over the Play menu: a background check (the friends counts)
          // never pulls the menu over the lobby or a Solo round.
          if (this.screens.name === "play") this.showPlay();
        }
        break;
      default:
        break;
    }
  }

  private setCounts(on: number, pl: number): void {
    this.onlineCounts = { online: on, inMatch: pl };
    this.screens.setFriendCounts(on, pl);
  }

  private onNetState(s: NetClient["state"]): void {
    if (this.mode === "online" && this.round) this.hud.setConnection(s === "open" ? "ok" : s === "closed" ? "lost" : "reconnecting");
    if (s === "closed" && this.room && !this.round) {
      this.room = null;
      if (this.screens.name === "room") {
        this.playError = "Lost the connection to the game server.";
        this.toLobby();
      }
    }
  }

  private showWaiting(text: string): void {
    this.view = "lobby";
    this.stage.setMode("lobby");
    this.stage.setLook(this.myLook(), this.settings.lobbyPose);
    this.stage.setFraming("center");
    this.screens.waiting(text);
  }

  /** The squad room: everyone in it standing around you on the street. */
  private showRoom(): void {
    const net = this.net;
    if (!net || !this.room) return;
    this.view = "lobby";
    this.stage.setMode("squad");
    this.stage.setLook(this.myLook(), this.settings.lobbyPose);
    const me = this.seatId ?? net.id;
    this.stage.setSquad(this.room.players.filter((p) => p.id !== me).map((p) => ({ id: p.id, name: p.name, look: fromWire(p.look) })));
    this.stage.setFraming("center");
    this.stage.interactive = true;
    this.loop.setFpsCap(30);
    this.screens.room(this.room, me, net.serverNow(), this.onlineError);
  }

  /** Leave any room (the lobby keeps a light connection for the counts). */
  private leaveOnline(): void {
    if (this.net && this.room) this.net.send({ t: "leave" });
    if (this.net && this.mode === "online") this.net.resetInput();
    this.room = null;
    this.onlineError = null;
    this.seatId = null;
    this.chat.clear();
    this.vPlaying = null;
    this.vRetries = 0;
    this.mode = "practice";
    this.meId = ME;
    this.hud.setOnline(false);
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  private render(frameDt: number): void {
    const workStart = performance.now();
    this.renderer.info.reset();
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.view === "lobby") {
      this.stage.update(frameDt);
      this.stage.render();
      if (this.screens.name === "room" && this.net) {
        this.screens.tickRoom(this.net.serverNow());
        this.screens.placeTags(this.stage.squadTags(w, h, this.seatId ?? this.net.id));
      }
      if (this.screens.name === "results") {
        const left = this.returnAt ? Math.max(0, Math.ceil((this.returnAt - performance.now()) / 1000)) : 0;
        this.screens.placePlates(this.stage.podiumPlates(w, h), left);
        if (this.returnAt && left <= 0) {
          this.returnAt = 0;
          this.action(this.recorded?.online === "private" ? "room" : "menu", document.body);
        }
      }
      this.updateSocial(null);
      this.quality.sample(frameDt * 1000, performance.now() - workStart, this.loop.targetMs);
      return;
    }

    if (this.slowmo > 0) {
      this.slowmo -= frameDt;
      if (this.slowmo <= 0) this.loop.timeScale = 1;
    }
    const round = this.round;
    if (!round) return;
    // Slow motion: yours in Solo (the loop), the final two's everywhere (the referee's clock).
    const vdt = frameDt * this.loop.timeScale * round.timeScale;
    const list = round.contestants;

    if (round.phase === "walkout" && this.walkout) {
      this.renderWalkout(round, frameDt, vdt);
      this.quality.sample(frameDt * 1000, performance.now() - workStart, this.loop.targetMs);
      return;
    }
    if (this.replaying) {
      this.renderReplay(round, frameDt);
      this.quality.sample(frameDt * 1000, performance.now() - workStart, this.loop.targetMs);
      return;
    }

    this.crowd.update(vdt, list, this.camera.position);
    for (const c of list) this.crowd.setCarry(c.index, c.ball >= 0 && c.status !== "eliminated");
    if (round.balls.length) this.props.update(vdt, round.balls, (h, out) => this.crowd.hands(h, out));
    this.doll.update(vdt);
    this.fx.update(vdt);
    const me = round.get(this.meId);
    if (me && this.my === "out" && this.rig.current === "cinematic") this.rig.track(this.crowd.chest(me, _chest));
    // The zoom stays on the falling body.
    if (this.zoomId && this.rig.zooming) {
      const z = round.get(this.zoomId);
      if (z) this.rig.zoomTrack(this.crowd.chest(z, _chest));
    }
    this.poolBlood(list);

    if (me) {
      if (this.my === "playing" && !this.paused) {
        const md = this.controls.consumeMouse();
        this.rig.orbit(this.controls.look.x, this.controls.look.y, frameDt, md.x, md.y);
      }
      const target = this.watching ? this.leader() ?? me : me;
      if (this.rig.firstPerson && !this.watching) this.rig.eyeValid = !!this.crowd.eye(me.index, this.rig.eye);
      if (this.finalShot) this.finalTwoShot(round, frameDt);
      this.rig.update(frameDt, target);
      this.updateHud(round, me, frameDt);
      _focus.set(target.x, 0, target.z);
      this.world?.update(frameDt, _focus, this.camera.position);
      // The towers track runners while she turns and stares.
      this.world?.lasers.update(frameDt, round.phase === "turning" || round.phase === "watch", list);
      // Feet in puddles splash.
      const pot = this.world?.potholes;
      if (pot) {
        for (const c of list) {
          if (c.status === "eliminated" || (c.y ?? 0) > 0.05) continue;
          if (pot.step(c.index, c.x, c.z, Math.hypot(c.vx, c.vz)) && (c.id === this.meId || Math.hypot(c.x - me.x, c.z - me.z) < 9)) this.sound.splash(c.id === this.meId);
        }
      }
    }

    this.updateSocial(round);
    this.sequence(frameDt);

    this.draw();
    this.quality.sample(frameDt * 1000, performance.now() - workStart, this.loop.targetMs);
  }

  /**
   * What comes next, in order: your fall → the kill cam → spectating; across
   * the line → spectating; the round over → the play of the game → the results.
   */
  private sequence(frameDt: number): void {
    const seq = this.outSeq;
    if (seq) {
      seq.left -= frameDt;
      if (seq.left <= 0) {
        this.outSeq = null;
        if (!this.startKillCam()) this.toSpectate();
      }
      return;
    }
    if (this.spectateIn > 0) {
      this.spectateIn -= frameDt;
      if (this.spectateIn <= 0) this.toSpectate();
      return;
    }
    if (this.potgIn > 0) {
      this.potgIn -= frameDt;
      if (this.potgIn <= 0) {
        this.potgIn = -1;
        if (!this.startPotg()) this.showResults();
      }
      return;
    }
    if (this.resultsIn > 0) {
      this.resultsIn -= frameDt;
      if (this.resultsIn <= 0) this.showResults();
    }
  }

  /** A replay frame: the clip on the field, the lens it asks for, the overlay's progress. */
  private renderReplay(round: RoundView, frameDt: number): void {
    const r = this.replay.update(frameDt, round.contestants, this.camera.position, _lensPos, _lensLook);
    this.replayUi.progress(this.replay.progress);
    if (!r.done) this.rig.shot(_lensPos, _lensLook, r.fov);
    this.rig.update(frameDt, null);
    this.world?.update(frameDt, _lensLook, this.camera.position);
    this.world?.lasers.update(frameDt, false, round.contestants);
    this.updateSocial(round);
    this.draw();
    if (r.done) this.endReplay();
  }

  /** Two left, and you're watching: a cutscene of the pair while the clock runs slow. */
  private finalTwoShot(round: RoundView, frameDt: number): void {
    const f = this.finalShot!;
    f.t += frameDt;
    const a = round.get(f.ids[0]);
    const b = round.get(f.ids[1]);
    if (f.t >= FINAL.seconds || !a || !b || this.my === "playing") {
      this.finalShot = null;
      this.rig.follow();
      this.hud.show(true);
      if (this.watching) this.resultsBtn.classList.add("visible");
      return;
    }
    const fov = finalTwoLens(this.crowd.chest(a, _a), this.crowd.chest(b, _b), f.t / FINAL.seconds, _lensPos, _lensLook);
    this.rig.shot(_lensPos, _lensLook, fov);
  }

  /** Under each body as it comes to rest, its pool (SPEC-V2 §2.6 step 3); it stays. */
  private poolBlood(list: readonly Contestant[]): void {
    for (const c of list) {
      if (c.status !== "eliminated") continue;
      const a = this.crowd.anim(c.index);
      if (!a || a.dead < 0.8 || a.dead > 4) continue;
      this.crowd.chest(c, _chest);
      this.fx.blood.pool(c.index, _chest.x, _chest.z);
    }
  }

  /** The walkout: the walkers on their paths, the lens on the reel, the skip and tutorial buttons. */
  private renderWalkout(round: RoundView, frameDt: number, vdt: number): void {
    const w = this.walkout!;
    const t = round.phaseTime;
    if (t >= FLOW.walk) this.flow.go("preview");
    w.update(t, this.shotFrame);
    this.crowd.update(vdt, w.walk.walkers, this.camera.position);
    if (round.balls.length) this.props.update(vdt, round.balls, (h, out) => this.crowd.hands(h, out));
    this.doll.update(vdt);
    this.rig.shot(this.shotFrame.pos, this.shotFrame.look, this.shotFrame.fov);
    this.rig.update(frameDt, null);
    this.world?.update(frameDt, this.shotFrame.look, this.camera.position);
    this.world?.lasers.update(frameDt, false, round.contestants);
    this.flowBtns.show(w.canSkip(t) && !this.paused, this.offerTutorial && !this.paused);
    this.draw();
  }

  /** The game view: the puddles' mirror and the post-processing on High, a plain draw otherwise. */
  private draw(): void {
    if (this.spec.fancy) {
      this.world?.beforeRender(this.renderer, this.scene, this.camera);
      if (!this.post) this.post = new Post();
      this.post.warmth = this.world ? (this.world.time === "sunset" || this.world.time === "sunrise" ? 1 : this.world.night ? -1 : 0.2) : 0;
      this.post.render(this.renderer, this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateHud(round: RoundView, me: Contestant, frameDt: number): void {
    this.hud.setTimer(round.timeLeft, round.timeLeft <= 10 && round.phase !== "ended");
    let inPlay = 0;
    const list = round.contestants;
    let n = 0;
    const mark = (x: number, z: number, kind: MapMark["kind"]) => {
      const m = this.marks[n] ?? (this.marks[n] = { x: 0, z: 0, kind });
      m.x = x;
      m.z = z;
      m.kind = kind;
      n++;
    };
    for (const k of round.baskets) mark(k.x, k.z, "basket");
    for (const b of round.balls) if (b.holder < 0 && b.basket < 0) mark(b.x, b.z, "ball");
    for (const c of list) {
      if (c.status !== "eliminated") inPlay++;
      if (c.id === this.meId) continue;
      mark(c.x, c.z, c.status === "eliminated" ? "out" : c.status === "finished" ? "safe" : "other");
    }
    this.marks.length = n;
    this.hud.setAlive(inPlay, list.length);
    this.hud.setDistance(me.progress / round.course.distance);
    // Fist, slap and push with someone in reach; grab with a free ball in reach.
    if (this.my === "playing" && !this.paused && !this.tut) this.controls.setNear(canAttack(me) && !!attackTarget(me, round.contestants, ATTACK.range), this.canGrab(round, me));
    else this.controls.setNear(false, false);
    this.controls.setStamina(me.stamina, me.sprinting);
    const watching = round.phase === "watch" || round.phase === "turning";
    const doll = { x: 0, z: round.course.dollZ, watching };
    this.hud.setMap({ x: me.x, z: me.z, heading: me.heading, out: me.status === "eliminated" }, this.marks, doll, this.rig.yaw);
    this.hud.setCompass(this.rig.yaw, me, doll);
    this.board.update(round.contestants, this.meId, round.course.distance, (c) => this.label(c));
    if (this.mode === "online" && this.net) this.hud.setPing(this.net.rtt);

    if (round.phase === "countdown") this.countdown.update(round.phaseDuration - round.phaseTime);

    if (this.my === "playing" && this.controls.moving) {
      // Footsteps for you only: a quiet rhythm that stops when you stop.
      const speed = Math.hypot(me.vx, me.vz);
      if (speed > 0.6 && me.y <= 0) {
        this.stepClock -= frameDt;
        if (this.stepClock <= 0) {
          this.sound.step();
          this.stepClock = speed > MOVE.run + 0.5 ? 0.2 : speed > 3 ? 0.26 : 0.4;
        }
      }
    }
  }

  private canGrab(round: RoundView, me: Contestant): boolean {
    if (round.course.mode !== "balls" || me.ball >= 0 || me.status !== "alive" || me.stance === 2) return false;
    for (const b of round.balls) {
      if (b.holder >= 0 || b.basket >= 0) continue;
      if (b.noGrab === me.index && round.elapsed < b.waitUntil) continue;
      if (Math.hypot(b.x - me.x, b.z - me.z) <= BALLS.reach) return true;
    }
    return false;
  }

  // ── Shop and looks ────────────────────────────────────────────────────────

  /** What you look like, keeping only what you own. */
  private myLook(): Look {
    return ownedOnly(this.settings.look, this.owned());
  }

  /** Tell the game server what I look like (and, with the ticket, what I own). */
  private sendLook(): void {
    if (!this.net || this.net.state !== "open") return;
    const badge = this.settings.badge && this.owned().has("badge_gold");
    this.net.send({ t: "look", ticket: this.shop?.ticket ?? undefined, look: toWireLook(this.myLook(), badge) });
  }

  private onOwnedChanged(): void {
    const owned = this.owned();
    this.wheel.setOwned(owned.has(EMOTE_PACK) ? EMOTES.filter((e) => e.pack).map((e) => e.id) : []);
    this.wheel.setSlots(this.settings.wheel);
    this.sendLook();
    if (this.screens.name === "store") this.showStore();
    if (this.screens.name === "lobby") {
      this.stage.setLook(this.myLook(), this.settings.lobbyPose);
      this.showLobby();
    }
  }

  private async buy(id: string): Promise<void> {
    if (!this.shop || this.shopBusy) return;
    this.shopBusy = id;
    this.shopNote = null;
    this.showStore();
    const r = await this.shop.buy(id);
    this.shopBusy = null;
    const name = PRODUCT_BY_ID[id]?.name ?? "It";
    if (r.ok) {
      this.shopNote = `${name} is yours.`;
      // Put it on straight away.
      const p = PRODUCT_BY_ID[id];
      if (p?.kind === "outfit") this.setLook({ ...this.settings.look, outfit: id });
      if (p?.kind === "cap") this.setLook({ ...this.settings.look, extras: [...this.settings.look.extras.filter((e) => e !== "gele" && e !== "headset"), "fila"] });
      if (p?.kind === "badge") this.settings.badge = true;
      saveSettings(this.host, this.settings);
      this.sendLook();
      this.haptic("success");
    } else {
      this.shopNote =
        r.code === "cancelled"
          ? "No wahala. Nothing was charged."
          : r.code === "claim"
            ? "Paid, thank you. We couldn't reach our server just now; it will be delivered the next time you open the game."
            : r.code === "owned"
              ? "You already own this. Tap Restore purchases."
              : errorText({ code: r.code });
    }
    if (this.screens.name === "store") this.showStore();
  }

  // ── Social ────────────────────────────────────────────────────────────────

  private sendEmote(id: EmoteId): void {
    const round = this.round;
    if (!round) {
      // In a room: show it on your character and tell the room.
      this.stage.emote(id);
      if (this.room) this.net?.send({ t: "emote", e: id });
      return;
    }
    this.playEmote(this.meId, id);
    if (this.mode === "online") this.net?.send({ t: "emote", e: id });
    this.haptic("tap");
    addProgress(this.settings.daily, "emotes", 1);
  }

  private playEmote(seat: string, id: EmoteId): void {
    const c = this.round?.get(seat);
    if (!c || c.status === "eliminated") return;
    this.crowd.emote(c.index, id);
    this.bubbles.show(c.index, EMOTE_BY_ID[id].icon);
  }

  /** Practice only: a few CPUs react (labelled CPU, as always). */
  private cpuReact(ids: EmoteId[], count: number, delay: number): void {
    const round = this.round;
    if (!round) return;
    const pool = round.contestants.filter((c) => c.bot && c.status !== "eliminated");
    for (let i = 0; i < count && pool.length; i++) {
      const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const id = ids[Math.floor(Math.random() * ids.length)];
      setTimeout(() => this.playEmote(c.id, id), (delay + i * 0.35) * 1000);
    }
  }

  /** Who may see chat / buttons right now — set only when it changes. */
  private updateSocial(round: RoundView | null): void {
    const s = this.screens.name;
    const online = this.mode === "online" || s === "room";
    const chatOn = this.settings.chat && !!this.net && (s === "room" || (online && s === "results") || (online && !!round && (this.watching || this.my !== "playing")));
    if (chatOn !== this.chatOn) {
      this.chatOn = chatOn;
      this.chat.setAvailable(chatOn);
      // In the room and results, the chat button stands alone (no play buttons).
      if (!this.actionsOn) this.controls.actions.hidden = !chatOn;
    }
    const spectate = this.watching && !s && !this.finalShot;
    if (spectate !== this.spectateOn) {
      this.spectateOn = spectate;
      this.spectateBtn.classList.toggle("visible", spectate);
    }
    if (round && this.bubbles.active) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.bubbles.update((i) => {
        const c = round.contestants[i];
        if (!c) return null;
        this.crowd.chest(c, _head);
        _head.y += 0.95;
        _head.project(this.camera);
        if (_head.z > 1 || _head.x < -1.2 || _head.x > 1.2 || _head.y < -1.2 || _head.y > 1.2) return null;
        return { x: ((_head.x + 1) / 2) * w, y: ((1 - _head.y) / 2) * h };
      });
    }
  }

  private nextSpectate(): void {
    const alive = (this.round?.contestants ?? []).filter((c) => c.status === "alive");
    if (!alive.length) return;
    const i = alive.findIndex((c) => c.id === this.spectateId);
    this.spectateId = alive[(i + 1) % alive.length].id;
    this.haptic("select");
  }

  private leader(): Contestant | null {
    const picked = this.spectateId ? this.round?.get(this.spectateId) : undefined;
    if (picked && picked.status === "alive") return picked;
    let best: Contestant | null = null;
    for (const c of this.round?.contestants ?? []) {
      if (c.status !== "alive") continue;
      if (!best || c.progress > best.progress) best = c;
    }
    return best;
  }

  private label(c: Contestant): string {
    if (this.tut) return c.name;
    return c.bot ? `${c.name} · CPU` : c.id === this.meId ? "You" : c.name;
  }

  private renderOnce(): void {
    if (this.view === "lobby") {
      this.stage.update(0.016);
      this.stage.render();
      return;
    }
    this.rig.update(0.016, null);
    this.renderer.render(this.scene, this.camera);
  }

  // ── Pause / host lifecycle ────────────────────────────────────────────────

  private pause(): void {
    if (!this.round || this.paused || this.screens.name === "results" || this.view !== "game") return;
    this.paused = true;
    this.controls.reset();
    this.wheel.close();
    if (this.mode === "practice") {
      this.loop.stop();
      this.sound.suspend();
    } else {
      this.net?.resetInput();
    }
    this.screens.pause(this.host, this.mode === "online");
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.screens.hide();
    this.controls.enabled = this.my === "playing" && !this.tut && !this.walkout;
    if (!this.hostPaused) {
      this.sound.resume();
      this.loop.start();
    }
  }

  private hostPause(): void {
    this.hostPaused = true;
    this.net?.resetInput();
    if (this.round && !this.paused && this.my === "playing" && this.screens.name !== "results" && this.view === "game") this.pause();
    // The lobby's animations stop too: a backgrounded game costs nothing.
    this.loop.stop();
    this.sound.suspend();
  }

  private hostResume(): void {
    this.hostPaused = false;
    if (this.paused && this.mode === "practice") return;
    this.sound.resume();
    this.loop.start();
  }

  private back(): void {
    const s = this.screens.name;
    if (this.tut && !s) return this.endTutorial();
    if (this.round && !this.paused && !s) this.pause();
    else if (s === "pause") this.resume();
    else if (s === "settings") this.action(this.settingsFrom === "pause" ? "pause-menu" : "back", document.body);
    else if (s === "room") this.action("leave-room", document.body);
    else if (s === "maps") this.action("mode", document.body);
    else if (s === "vmenu") this.action("mode", document.body);
    // vwait: a stake may be on the table — leaving is a deliberate tap on Leave.
    else if (s === "lobby" && this.host.can.exit) this.host.exit();
    else if (s === "results" || s === "") this.toLobby();
    else if (s !== "vwait" && s !== "lobby") this.action("back", document.body);
  }

  // ── Menu actions ──────────────────────────────────────────────────────────

  private action(act: string, node: HTMLElement): void {
    if (act !== "toggle" && act !== "range" && act !== "look-range") this.sound.ui();
    const d = node.dataset;
    switch (act) {
      // Lobby
      case "tab":
        this.lobbyTab(d.tab as LobbyTab);
        break;
      case "customize":
        this.showCustomize();
        break;
      case "ctab":
        this.customizeTab = d.tab ?? "outfit";
        this.showCustomize();
        break;
      case "look":
      case "look-range": {
        const base = this.tryOn ?? this.settings.look;
        const key = d.key!;
        const val = act === "look-range" ? (node as HTMLInputElement).value : d.val!;
        let next: Look = { ...base };
        if (key === "body") next.body = val === "f" ? "f" : "m";
        else if (key === "skin") next.skin = Number(val);
        else if (key === "hair") next.hair = val as Look["hair"];
        else if (key === "hairColor") next.hairColor = Number(val);
        else if (key === "outfit") next.outfit = val;
        else if (key === "height") next.height = Number(val) / 100;
        else if (key === "extra") {
          const id = val as ExtraId;
          next = { ...base, extras: base.extras.includes(id) ? base.extras.filter((e) => e !== id) : [...base.extras.filter((e) => !conflicts(e, id)), id] };
        }
        // Locked (paid, not owned): try it on, don't keep it.
        const locked = d.locked && !this.owned().has(d.locked);
        if (locked) {
          this.setLook(next, true);
          this.screens.toast(this.shop ? "Trying it on. Buy it in the Store to keep it." : "Trying it on. Shop items are bought inside Lagos Life.");
        } else {
          this.setLook(next);
        }
        if (act === "look") this.showCustomize();
        break;
      }
      case "random-look":
        this.setLook(randomLook(new Rng(randomSeed())));
        this.showCustomize();
        break;
      case "emotes":
        this.showEmotes();
        break;
      case "emote-pick": {
        const id = d.id as EmoteId;
        this.emoteSel = id;
        this.stage.emote(id);
        const e = EMOTE_BY_ID[id];
        const free = !e.pack || this.owned().has(EMOTE_PACK);
        if (this.wheelSlot >= 0 && free) {
          this.settings.wheel[this.wheelSlot] = id;
          this.wheelSlot = -1;
          saveSettings(this.host, this.settings);
          this.wheel.setSlots(this.settings.wheel);
        }
        this.showEmotes();
        break;
      }
      case "emote-slot":
        this.wheelSlot = this.wheelSlot === Number(d.i) ? -1 : Number(d.i);
        this.showEmotes();
        break;
      case "loadout":
        this.showLoadout();
        break;
      case "pose":
        this.settings.lobbyPose = d.id as PoseId;
        saveSettings(this.host, this.settings);
        this.stage.setPose(this.settings.lobbyPose);
        this.showLoadout();
        break;
      case "store":
        this.shopNote = null;
        this.showStore();
        break;
      case "try": {
        const p = PRODUCT_BY_ID[d.id ?? ""];
        if (p?.kind === "outfit") this.setLook({ ...this.settings.look, outfit: p.id }, !this.owned().has(p.id));
        else if (p?.kind === "cap") this.setLook({ ...this.settings.look, extras: [...this.settings.look.extras.filter((e) => !conflicts(e, "fila")), "fila"] }, !this.owned().has(p.id));
        else if (p?.kind === "emotes") this.stage.emote("zanku");
        if (p && !this.owned().has(p.id)) this.screens.toast("Trying it on.");
        break;
      }
      case "buy":
        void this.buy(d.id ?? "");
        break;
      case "wear": {
        const p = PRODUCT_BY_ID[d.id ?? ""];
        if (p && this.owned().has(p.id)) {
          if (p.kind === "outfit") this.setLook({ ...this.settings.look, outfit: p.id });
          if (p.kind === "cap") this.setLook({ ...this.settings.look, extras: [...this.settings.look.extras.filter((e) => !conflicts(e, "fila")), "fila"] });
          this.showStore();
        }
        break;
      }
      case "toggle-badge":
        if (this.owned().has("badge_gold")) {
          this.settings.badge = !this.settings.badge;
          saveSettings(this.host, this.settings);
          this.sendLook();
          this.showStore();
        }
        break;
      case "restore":
        this.shopNote = "Checking with Lagos Life…";
        this.showStore();
        void this.shop?.boot().then(() => {
          this.shopNote = "All your purchases are here.";
          if (this.screens.name === "store") this.showStore();
        });
        break;
      case "friends":
        this.friendsTab = "friends";
        this.showFriends();
        break;
      case "invite":
        this.friendsTab = "invite";
        this.showFriends();
        break;
      case "ftab":
        this.friendsTab = d.tab === "invite" ? "invite" : "friends";
        this.showFriends();
        break;
      case "copy-code": {
        const code = this.room?.code;
        if (code) {
          navigator.clipboard?.writeText(code).then(
            () => this.screens.toast(`Code ${code} copied`),
            () => this.screens.toast(`Code: ${code}`),
          );
        }
        break;
      }

      // Play
      case "start":
      case "mode":
        this.playError = null;
        this.showPlay();
        break;
      case "pick-mode":
        this.playMode = d.mode as PlayMode;
        this.playError = null;
        this.showPlay();
        break;
      case "maps":
        this.mapCat = mapOf(this.settings.map).category;
        this.frame("full");
        this.screens.maps(this.settings.map, this.mapCat);
        break;
      case "mapcat":
        this.mapCat = d.cat as MapCategory;
        this.screens.maps(this.settings.map, this.mapCat);
        break;
      case "pick-map":
        this.settings.map = d.map ?? DEFAULT_MAP;
        this.skyPick = null;
        saveSettings(this.host, this.settings);
        this.showPlay();
        break;
      case "sky":
        this.skyPick = SKY_STATES.includes(d.s as SkyState) ? (d.s as SkyState) : null;
        this.showPlay();
        break;
      case "rmode":
        if (MODES.includes(d.m as Mode)) {
          this.settings.mode = d.m as Mode;
          saveSettings(this.host, this.settings);
        }
        this.showPlay();
        break;
      case "dist": {
        const v = Number(d.d) as Distance;
        if (DISTANCES.includes(v)) {
          this.settings.distance = v;
          saveSettings(this.host, this.settings);
        }
        this.showPlay();
        break;
      }
      case "go":
        this.go();
        break;
      case "practice":
        this.practice();
        break;
      case "again":
      case "restart":
        if (this.tut) this.closeTutorial();
        this.paused = false;
        this.sound.resume();
        this.startPractice();
        break;
      case "tutorial":
        this.startTutorial("menu");
        break;
      case "back":
        if (this.round && this.paused) this.screens.pause(this.host, this.mode === "online");
        else if (this.screens.name === "maps") this.showPlay();
        else if (this.room && !this.round) this.showRoom();
        else this.closePanel();
        break;
      case "settings":
        this.settingsFrom = "lobby";
        this.showSettings();
        break;
      case "settings-pause":
        this.settingsFrom = "pause";
        this.showSettings();
        break;
      case "stab":
        this.settingsTab = d.tab ?? "graphics";
        this.showSettings();
        break;
      case "pause-menu":
        this.screens.pause(this.host, this.mode === "online");
        break;
      case "toggle": {
        const key = d.key as keyof Settings;
        const on = (node as HTMLInputElement).checked;
        if (typeof this.settings[key] === "boolean") {
          (this.settings as unknown as Record<string, boolean>)[key] = on;
          this.applySettings();
          saveSettings(this.host, this.settings);
          if (key === "sound" && on) this.sound.ui();
        }
        break;
      }
      case "set": {
        const key = d.key;
        if (key === "graphics" && ["auto", "low", "medium", "high"].includes(d.val ?? "")) this.settings.graphics = d.val as Settings["graphics"];
        if (key === "lookStick" && (d.val === "always" || d.val === "touch")) this.settings.lookStick = d.val;
        if (key === "stickSize" && (d.val === "small" || d.val === "medium" || d.val === "large")) this.settings.stickSize = d.val;
        if (key === "mapSize" && (d.val === "small" || d.val === "medium" || d.val === "large")) this.settings.mapSize = d.val;
        if (key === "sprintMode" && (d.val === "toggle" || d.val === "hold" || d.val === "auto")) this.settings.sprintMode = d.val;
        if (key === "lightMode" && (d.val === "auto" || d.val === "light" || d.val === "dark")) {
          this.settings.lightMode = d.val;
          // Everything in the world follows at once: sky, light, lamps, neon.
          if (this.round && this.worldArgs) this.ensureWorld(this.worldArgs.mapId, this.worldArgs.pick, this.worldArgs.course);
          this.stage.setLightMode(this.settings.lightMode);
        }
        this.applySettings();
        saveSettings(this.host, this.settings);
        this.showSettings();
        break;
      }
      case "range": {
        const key = d.key as "sensH" | "sensV" | "stickOpacity";
        if (key !== "sensH" && key !== "sensV" && key !== "stickOpacity") break;
        this.settings[key] = Math.max(key === "stickOpacity" ? 0.3 : 0.05, Math.min(1, Number((node as HTMLInputElement).value) / 100));
        this.applySettings();
        saveSettings(this.host, this.settings);
        break;
      }
      case "resume":
        this.resume();
        break;
      case "menu":
        this.toLobby();
        break;
      case "exit":
        this.host.exit();
        break;
      case "watch":
        this.screens.hide();
        this.view = "game";
        this.watching = true;
        this.returnAt = 0;
        this.loop.setFpsCap(this.spec.tier === 0 ? 30 : 60);
        this.hud.show(true);
        this.hud.clearVerdict();
        this.rig.follow();
        this.resultsBtn.classList.add("visible");
        break;
      case "reload":
        location.reload();
        break;

      // Online
      case "quick":
        this.chat.clear();
        this.onlineError = null;
        if (this.mode === "online") this.endRound();
        this.hud.show(false);
        this.online((net) => {
          net.send({ t: "quick", mode: this.settings.mode, dist: this.settings.distance });
          this.room = null;
          this.showWaiting("Finding players…");
        });
        break;
      case "create": {
        this.chat.clear();
        const size = Number(d.size);
        this.onlineError = null;
        this.online((net) => {
          net.send({ t: "create", size, mode: this.settings.mode, dist: this.settings.distance });
          this.showWaiting("Making your room…");
        });
        break;
      }
      case "join": {
        const input = this.screens.root.querySelector<HTMLInputElement>("input[name=code]");
        const code = normalizeCode(input?.value ?? "");
        if (code.length !== 6) {
          this.playError = "Room codes are six letters.";
          this.showPlay();
          break;
        }
        this.onlineError = null;
        this.online((net) => {
          net.send({ t: "join", code });
          this.showWaiting("Joining…");
        });
        break;
      }
      case "ready":
        this.net?.send({ t: "ready", on: d.on === "1" });
        break;
      case "room":
        this.endRound();
        this.hud.show(false);
        this.setActions(false);
        this.touch.classList.remove("live");
        this.returnAt = 0;
        this.showRoom();
        break;
      case "leave-room":
        this.net?.send({ t: "leave" });
        this.room = null;
        this.endRound();
        this.toLobby();
        break;

      // Lagos Life matches
      case "vmenu":
        this.vError = null;
        this.endRound();
        this.hud.show(false);
        this.setActions(false);
        this.touch.classList.remove("live");
        this.view = "lobby";
        this.stage.setMode("lobby");
        this.showMatchMenu();
        break;
      case "vstake":
        this.vStake = Number(d.stake) || 0;
        this.showMatchMenu();
        break;
      case "vseats":
        this.vSeats = Number(d.seats) || 2;
        this.showMatchMenu();
        break;
      case "vcreate":
        void this.matchCall(() => this.host.matches!.create(this.vStake, this.vSeats));
        break;
      case "vquick":
        void this.matchCall(() => this.host.matches!.quick(this.vStake));
        break;
      case "vjoin": {
        const code = normalizeCode(this.screens.root.querySelector<HTMLInputElement>("input[name=vcode]")?.value ?? "");
        if (code.length !== 6) {
          this.vError = "Match codes are six letters.";
          this.showMatchMenu();
          break;
        }
        void this.matchCall(() => this.host.matches!.join(code));
        break;
      }
      case "vleave":
        this.host.matches
          ?.leave()
          .catch(() => null)
          .then(() => {
            this.vmatch = null;
            this.vError = "You left the match. Your stake went back.";
            this.showMatchMenu();
          });
        break;
    }
  }

  /** START on the play screen. */
  private go(): void {
    switch (this.playMode) {
      case "solo":
        this.practice();
        break;
      case "new":
        this.action("quick", document.body);
        break;
      case "friends":
        this.friendsTab = "invite";
        this.showFriends();
        break;
      case "lagos":
        this.vError = null;
        this.showMatchMenu();
        break;
    }
  }

  private lobbyTab(tab: LobbyTab): void {
    switch (tab) {
      case "lobby":
        this.closePanel();
        break;
      case "loadout":
        this.showLoadout();
        break;
      case "store":
        this.showStore();
        break;
      case "friends":
        this.friendsTab = "friends";
        this.showFriends();
        break;
      case "clan":
        this.frame("right-panel");
        this.screens.clan();
        break;
      case "board":
        this.frame("right-panel");
        this.screens.boardLoading();
        this.host
          .leaderboard()
          .then((b) => this.screens.name === "board" && this.screens.board(b, null))
          .catch((e) => this.screens.name === "board" && this.screens.board(null, e));
        break;
    }
  }

  private applySettings(): void {
    const s = this.settings;
    this.sound.setEnabled(s.sound);
    this.sound.setMusic(s.music);
    this.fx.setBlood(s.blood);
    this.rig.shakeEnabled = s.shake;
    this.rig.autoCenter = s.autoCam;
    this.rig.invertY = s.invertY;
    this.rig.sensH = s.sensH;
    this.rig.sensV = s.sensV;
    this.stage?.setLightMode(s.lightMode);
    this.controls.setLayout(s.leftHanded, s.lookStick === "always");
    this.controls.setStyle(s.stickSize, s.stickOpacity, s.sprintMode);
    this.hud.map.setSize(s.mapSize);
    this.hud.setFeedOn(s.killFeed);
    this.wheel.setSlots(s.wheel.length === 8 ? s.wheel : DEFAULT_WHEEL);
    const spec = tierSpec(s.graphics, this.renderer.getContext());
    if (spec.tier !== this.spec?.tier || spec.name !== this.spec?.name) {
      const changed = !!this.spec && spec.tier !== this.spec.tier;
      this.spec = spec;
      this.renderer.shadowMap.enabled = spec.shadows;
      // Medium: basic shadows; High: full, soft (SPEC-V2 §6.3).
      this.renderer.shadowMap.type = spec.tier === 2 ? PCFSoftShadowMap : PCFShadowMap;
      this.crowd.tier = spec.tier;
      this.crowd.setShadows(spec.shadows);
      this.stage?.setSpec(spec);
      if (changed && this.stage) this.stage.setLook(this.myLook(), this.settings.lobbyPose);
      this.worldKey = "";
    }
    this.quality.setMode(s.graphics === "low" ? "saver" : s.graphics === "high" ? "sharp" : "auto");
    if (this.round && !this.paused) this.loop.setFpsCap(this.spec.tier === 0 ? 30 : 60);
  }

  private haptic(kind: Parameters<Host["haptic"]>[0]): void {
    if (this.settings.haptics) this.host.haptic(kind);
  }

  private resize(): void {
    const w = window.innerWidth || 375;
    const h = window.innerHeight || 812;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // The brief's 65° is a landscape lens; a portrait phone needs a wider one
    // to see the street (horizontal view kept near the landscape one).
    this.rig.baseFov = w / h < 0.7 ? 82 : w / h < 1 ? 74 : 65;
    this.camera.updateProjectionMatrix();
    if (this.stage) this.stage.aspect = w / h;
    if (this.world) this.sizeParticles();
    if (!this.loop?.isRunning) this.renderOnce();
  }

  /**
   * The minimap's terrain: the map from straight above, rendered once at the
   * start of the round (behind the countdown) and read back into a canvas. The
   * runners, Mama's effects and the balls aren't in it — they are marks.
   */
  private terrainShot(course: Course): TerrainShot | null {
    if (!this.world) return null;
    const margin = 30;
    const x1 = course.halfWidth + margin;
    const x0 = -x1;
    const z0 = course.dollZ - 20;
    const z1 = course.backLimitZ + 20;
    const w = this.spec.tier === 0 ? 160 : 256;
    const h = Math.min(2048, Math.round((w * (z1 - z0)) / (x1 - x0)));
    const cam = new OrthographicCamera((x0 - x1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, (z0 - z1) / 2, 1, 800);
    cam.position.set(0, 400, (z0 + z1) / 2);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, (z0 + z1) / 2);
    cam.updateMatrixWorld();
    const rt = new WebGLRenderTarget(w, h);
    rt.texture.colorSpace = SRGBColorSpace;
    const hide = [this.crowd.group, this.fx.group, this.props.group];
    const was = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const fog = this.scene.fog;
    this.scene.fog = null;
    try {
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.scene, cam);
      const px = new Uint8Array(w * h * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext("2d")!;
      const img = g.createImageData(w, h);
      // GL rows run bottom-up; the canvas's top-down (the top is Mama's end).
      for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      g.putImageData(img, 0, 0);
      return { image: canvas, x0, x1, z0, z1 };
    } catch {
      return null;
    } finally {
      this.renderer.setRenderTarget(null);
      rt.dispose();
      this.scene.fog = fog;
      hide.forEach((o, i) => (o.visible = was[i]));
    }
  }

  /**
   * Compile every shader now, behind the countdown. Without this, things that
   * first appear mid-round (the eye beams, the blood) make the GPU compile on
   * the spot — a stall on a weak phone, and online the server doesn't wait.
   */
  private warmUp(): void {
    const hidden: { visible: boolean }[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    try {
      this.renderer.compile(this.scene, this.camera);
    } finally {
      for (const o of hidden) o.visible = false;
    }
  }
}

/** Two extras that can't be worn together (one head item, one face item). */
function conflicts(a: ExtraId, b: ExtraId): boolean {
  const head: ExtraId[] = ["fila", "gele", "headset"];
  const face: ExtraId[] = ["shades", "glasses"];
  return (head.includes(a) && head.includes(b)) || (face.includes(a) && face.includes(b));
}

function stickEl(): HTMLDivElement {
  const s = document.createElement("div");
  s.className = "stick";
  s.setAttribute("aria-hidden", "true");
  // A centre dot for reference, the thumb, and (move stick) your stamina above it.
  s.innerHTML = `<i class="dot"></i><i class="knob"></i><i class="bar"><b></b></i>`;
  return s;
}

