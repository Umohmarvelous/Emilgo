// Player settings, stored through the host (localStorage in a browser or
// Lagos Life, AsyncStorage via the bridge in EMILGO). Each host keeps its own
// copy — nothing crosses between Lagos Life and EMILGO.

import type { SongChoice } from "./audio/songs";
import { DEFAULT_DISTANCE, DISTANCES, MODES, type Distance, type Mode } from "./config";
import { cleanChest, type ChestState } from "./game/chest";
import { cleanAwards, freshAwards, type AwardState } from "./rank/awards";
import { cleanDms, cleanHistory, type DmThread, type MatchRecord } from "./social/profile";
import { levelOf } from "./game/progress";
import { EMOTE_IDS, type EmoteId } from "./social/emotes";
import type { Host } from "./platform/types";
import { BOOST_IDS, cleanBoosts, type BoostId } from "./shop/boosts";
import { cleanLook, DEFAULT_LOOK, type Look } from "./world/human/wardrobe";
import type { PoseId } from "./world/human/animator";

export type GraphicsTier = "auto" | "low" | "medium" | "high" | "max";

export type Lang = "en" | "pcm";

/** A friend (SPEC-V2 Decisions, "Invite Lagos Life friends"): their friend id in this copy of the game, and the name they had. */
export interface Friend {
  fid: string;
  name: string;
  at: number;
}

export interface Settings {
  /** Sound effects on/off; their volume. */
  sound: boolean;
  sfxVol: number;
  /** v5 (3.6): the announcer's voice (directions, who is eliminated). */
  voice: boolean;
  /** The songs on/off (her warning hum stays); their volume. */
  music: boolean;
  musicVol: number;
  /** Master volume, 0…1 (§7.2). */
  master: number;
  /** The billboards' films (SPEC-V3 §8): sound on/off (off unless turned on), and its volume. */
  adsAudio: boolean;
  adsVol: number;
  /** Camera sensitivity (§7.5 #2): scales both look speeds, 0.5…2. */
  sens: number;
  /** English or Nigerian Pidgin (§7.5 #16). */
  lang: Lang;
  /** Lobby notifications: invites, friend requests (§7.5 #17). */
  notify: boolean;
  /** Accept friend requests at all (§7.5 #18). */
  friendReqs: boolean;
  /** Data saver (§7.5 #19): the server sends this phone half the updates (others drawn a little further back). */
  dataSaver: boolean;
  /** The game turned 90° on screen, for landscape with rotation lock on (§6.5). */
  rotate: boolean;
  haptics: boolean;
  /** Stylised blood on catches; off = grey dust. */
  blood: boolean;
  shake: boolean;
  /** Camera drifts back behind you after a moment (off by default: no snap-back). */
  autoCam: boolean;
  /** Move on the right, look on the left. */
  leftHanded: boolean;
  /** v5: held upright, one stick walks and turns the view, on the side of the hand holding the phone. */
  oneThumb: boolean;
  /** v5 (3.4): seconds played in a browser, and the "get the app" note's last showing and its "not now" (ms). */
  webSeconds: number;
  getAppAt: number;
  getAppWait: number;
  /**
   * Touch look (v4 Phase 1): the right half is a touchpad. A faint touch point
   * (off by default: invisible), the acceleration (0 = linear), the dead zone
   * in px (a tap stays a tap), and whether a drag that starts on FIRE also aims.
   */
  lookDot: boolean;
  lookAccel: number;
  lookDead: number;
  fireAim: boolean;
  /**
   * v5: your avatar: a preset's id (ui/avatars.ts), a small picture from your phone, or "" for the default. v6 (the
   * owner: "the default avatar will be player's avatar from lagoslife"): the default is the platform's own picture
   * (Lagos Life's), the first preset only where there's none.
   */
  avatar: string;
  /** v6: the player has picked an avatar themselves (a v5 save's "op-black" was only the old default). */
  avatarSet: boolean;
  /** v5: older saves had a coloured suit by default: set once they've been brought to the black one. */
  suitV5: boolean;
  /** v5: the gun fires by itself while the crosshair is on an enemy. Off: only FIRE fires. */
  autoFire: boolean;
  /** The move stick: fixed in the corner (default) or wherever the thumb lands. */
  moveStick: "fixed" | "float";
  /** Desktop mouse: pointer lock (default) or a virtual look stick (SPEC-V3). */
  mouseLook: "lock" | "stick";
  /** Camera sensitivity, fraction of the maximum (180°/s). */
  sensH: number;
  sensV: number;
  invertY: boolean;
  /** Start rounds in first person. */
  firstPerson: boolean;
  graphics: GraphicsTier;
  /** What you look like (only owned shop items; checked on load and online). */
  look: Look;
  /** Gold name badge (shop item) switched on. */
  badge: boolean;
  /** Online chat (waiting room, results, spectating). Off hides it entirely. */
  chat: boolean;
  /** Ball Haunt's song, or "shuffle" for a different one each round. */
  song: SongChoice;
  /** The stance your character holds in the lobby. */
  lobbyPose: PoseId;
  /** The emote wheel: up to eight slots (v6: the two emotes left). */
  wheel: EmoteId[];
  /** Last map picked for practice. */
  map: string;
  /** The mode and distance picked on the play screen (SPEC-V2 §2.1). */
  mode: Mode;
  distance: Distance;
  /** The game picked on the Play screen's strip, and Free For All's mode (SPEC-V3 §9). */
  game: "ffa" | "rlgl" | "survival";
  /** Dead Streets: your best finished run (seconds, 0 none) on this device. */
  runBest: number;
  /** Dead Streets' loadout (§3.4): weapon, perks, juju charms, weapon mods, and the Daily Run picked. */
  runWeapon: string;
  runPerks: string[];
  runCharms: string[];
  runMods: string[];
  runDaily: boolean;
  /** Where past runs ended (x, z; the run summary map's red dots), the last 30. */
  runDeaths: [number, number][];
  ffaMode: string;
  /** The Free For All modes whose "How to play" cards you've seen (ids, comma-separated). */
  /** The items you've used at least once (their counter shows on the first use, SPEC-V3 §10.16). */
  itemsSeen: string;
  /** The public queue: Ranked picked (Phase 6). */
  ranked: boolean;
  ffaSeen: string;
  /** Light / dark mode (SPEC-V2 §6.4): full daylight, full night, or the map's own sky. */
  lightMode: "auto" | "light" | "dark";
  /** Controls (SPEC-V2 §4, §7.5): stick size and opacity, how sprint works. */
  stickSize: "small" | "medium" | "large";
  /** v4 rework: the player's own arrangement of the game-screen controls (layout.ts), JSON; "" the defaults. */
  ctlLayout: string;
  stickOpacity: number;
  sprintMode: "toggle" | "hold" | "auto";
  /** HUD: the minimap's size, and whether the kill feed shows. */
  mapSize: "small" | "medium" | "large";
  killFeed: boolean;
  tutorialSeen: boolean;
  best: number;
  played: number;
  wins: number;
  /** The old per-phone level's XP (before SPEC-V3). Kept, no longer shown: the rank ladder replaced it. */
  xp: number;
  /**
   * Rank (SPEC-V3 §1.4): the total XP our server last told us (rankKnown), or,
   * for a guest with no profile, the count this phone keeps for itself.
   */
  rankXp: number;
  rankKnown: boolean;
  deviceXp: number;
  /** Reached level 5 on the old ladder: the Founder tag (cosmetic, on this phone). */
  founder: boolean;
  /** Commends from other players (SPEC-V3 §10.12), as the server last said: a cosmetic title. */
  honour: number;
  /** The Form badge (§10.18): your last five online Free For All results, newest first ("W" or "L"). */
  form: string;
  /** Wins in a row, as the server last said (§10.18: 3 or more and you glow). */
  streak: number;
  /** Today's challenges: the day they were set and progress on each. */
  daily: { day: string; progress: number[] };
  /** v6: the daily reward chest (game/chest.ts): the day it was last opened and the days in a row. */
  chest: ChestState;
  /** v6 max (3.10): the awards (rank/awards.ts): the counts, what's reached, the badge worn. */
  awards: AwardState;
  /** v6 max (3.11): the last 30 matches (the profile's history). */
  history: MatchRecord[];
  /** v6 max (3.11): direct messages with friends (social/profile.ts), kept on this phone. */
  dms: Record<string, DmThread>;
  /** v6 max (3.11): take direct messages from friends; show my numbers on my public card. */
  dmsOn: boolean;
  cardPublic: boolean;
  /** v6 max (3.11): friend ids blocked from a thread: their requests are ignored on this phone. */
  blockedFids: string[];
  /** People you've played online with lately, newest first. `seat` reaches them while they're still online. */
  recent: { name: string; at: number; seat?: string }[];
  /** Your friend id in this copy of the game: random, never sent to Lagos Life or EMILGO, unknown to the other copy. */
  fid: string;
  friends: Friend[];
  /** CP (§7.7): earned only by playing, spent on boosts. */
  cp: number;
  /** Boost charges owned (one is used per round it's switched on), and the ones switched on (at most BOOST_SLOTS). */
  boosts: Partial<Record<BoostId, number>>;
  boostsOn: BoostId[];
}

const KEY = "settings.v1";

// v6: the two emotes left (social/emotes.ts LIVE_EMOTES).
export const DEFAULT_WHEEL: EmoteId[] = ["shaku", "zanku"];

export function defaults(host: Host): Settings {
  return {
    sound: true,
    sfxVol: 1,
    voice: true,
    music: true,
    musicVol: 0.8,
    master: 1,
    adsAudio: false,
    adsVol: 0.5,
    sens: 1,
    lang: "en",
    notify: true,
    friendReqs: true,
    dataSaver: false,
    rotate: false,
    haptics: true,
    // Lagos Life is 18+ (Terms §2). EMILGO is not age-gated, so it starts clean.
    blood: host.kind === "lagoslife",
    shake: true,
    autoCam: false,
    leftHanded: false,
    oneThumb: true,
    webSeconds: 0,
    getAppAt: 0,
    getAppWait: 0,
    lookDot: false,
    lookAccel: 1.4,
    lookDead: 3,
    fireAim: true,
    avatar: "",
    avatarSet: false,
    suitV5: true,
    autoFire: true,
    moveStick: "fixed",
    mouseLook: "lock",
    // Reduced sensitivity: 0.3 of the maximum (SPEC-V2 §4.2).
    sensH: 0.3,
    sensV: 0.3,
    invertY: false,
    firstPerson: false,
    graphics: "auto",
    look: { ...DEFAULT_LOOK },
    badge: false,
    song: "shuffle",
    chat: true,
    lobbyPose: "relaxed",
    wheel: [...DEFAULT_WHEEL],
    map: "desert-field",
    tutorialSeen: false,
    best: 0,
    played: 0,
    wins: 0,
    xp: 0,
    rankXp: 0,
    rankKnown: false,
    deviceXp: 0,
    founder: false,
    honour: 0,
    form: "",
    streak: 0,
    daily: { day: "", progress: [] },
    chest: { day: "", streak: 0 },
    awards: freshAwards(),
    history: [],
    dms: {},
    dmsOn: true,
    cardPublic: true,
    blockedFids: [],
    recent: [],
    mode: "classic",
    distance: DEFAULT_DISTANCE,
    game: "ffa",
    runBest: 0,
    runWeapon: "pistol",
    runPerks: [],
    runCharms: [],
    runMods: [],
    runDaily: false,
    runDeaths: [],
    ffaMode: "find-the-flag",
    ffaSeen: "",
    itemsSeen: "",
    ranked: false,
    lightMode: "auto",
    stickSize: "medium",
    ctlLayout: "",
    stickOpacity: 0.8,
    sprintMode: "toggle",
    mapSize: "medium",
    killFeed: true,
    fid: "",
    friends: [],
    cp: 0,
    boosts: {},
    boostsOn: [],
  };
}

/**
 * "Reset to default" (§7.5 #20): every preference back to how it came. What you
 * earned, bought, wear and know stays: level, scores, CP, boosts, friends, your
 * look and wheel, the map and mode you picked, the tutorial seen.
 */
export const KEPT_ON_RESET: readonly (keyof Settings)[] = [
  "look", "avatar", "avatarSet", "suitV5", "badge", "lobbyPose", "wheel", "map", "mode", "distance", "tutorialSeen", "best", "played", "wins", "xp",
  "rankXp", "rankKnown", "deviceXp", "founder", "honour", "form", "streak", "runBest", "runWeapon", "runPerks", "runCharms", "runMods", "runDaily", "runDeaths",
  "daily", "chest", "awards", "history", "dms", "blockedFids", "recent", "fid", "friends", "cp", "boosts", "boostsOn", "song",
];

export function resetPrefs(host: Host, s: Settings): Settings {
  const base = defaults(host);
  const out = { ...base };
  for (const k of KEPT_ON_RESET) (out as Record<string, unknown>)[k] = s[k];
  return out;
}

/** A fresh friend id: 16 random characters, made on this phone. */
export function newFid(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return Array.from(a, (b) => abc[b & 63]).join("");
}

export const FID_RE = /^[A-Za-z0-9_-]{16}$/;

/** Touch look presets (v4): [camera sensitivity, acceleration]. */
export const LOOK_PRESETS: Record<string, [number, number]> = { precise: [0.8, 0.6], classic: [1, 1.4], fast: [1.3, 2.4], linear: [1, 0] };

export function loadSettings(host: Host): Settings {
  const base = defaults(host);
  const raw = host.load(KEY);
  if (!raw) {
    base.fid = newFid();
    return base;
  }
  try {
    const saved = JSON.parse(raw) as Partial<Settings> & { equipped?: { outfit?: string | null; cap?: boolean; badge?: boolean }; quality?: string };
    const out = { ...base };
    for (const k of Object.keys(base) as (keyof Settings)[]) {
      if (typeof saved[k] === typeof base[k] && !Array.isArray(base[k])) (out as Record<string, unknown>)[k] = saved[k];
    }
    // One choice now: whatever an older save chose becomes the default.
    out.song = base.song;
    // v5: everyone starts in the black suit (the owner) until they pick a colour; older saves had one picked for them.
    if (saved.suitV5 !== true) {
      out.suitV5 = true;
      out.look = cleanLook({ ...out.look, hoodie: base.look.hoodie, design: "plain" });
    }
    if (!["auto", "low", "medium", "high", "max"].includes(out.graphics)) out.graphics = base.graphics;
    // Before v4 the look stick could be drawn "always": that now shows the touch point.
    if (typeof saved.lookDot !== "boolean" && (saved as { lookStick?: string }).lookStick === "always") out.lookDot = true;
    if (out.moveStick !== "fixed" && out.moveStick !== "float") out.moveStick = base.moveStick;
    out.lookAccel = clamp(Number(out.lookAccel), 0, 3);
    out.lookDead = Math.round(clamp(Number(out.lookDead), 0, 12));
    if (out.mouseLook !== "lock" && out.mouseLook !== "stick") out.mouseLook = base.mouseLook;
    if (!MODES.includes(out.mode)) out.mode = base.mode;
    if (!DISTANCES.includes(out.distance)) out.distance = base.distance;
    if (out.game !== "ffa" && out.game !== "rlgl") out.game = base.game;
    if (!/^[a-z0-9-]{1,40}$/.test(out.ffaMode)) out.ffaMode = base.ffaMode;
    if (!/^[a-z0-9,-]{0,400}$/.test(out.ffaSeen)) out.ffaSeen = base.ffaSeen;
    if (typeof out.ranked !== "boolean") out.ranked = base.ranked;
    if (typeof out.itemsSeen !== "string" || !/^[a-z0-9,-]{0,400}$/.test(out.itemsSeen)) out.itemsSeen = base.itemsSeen;
    if (!["auto", "light", "dark"].includes(out.lightMode)) out.lightMode = base.lightMode;
    if (!["small", "medium", "large"].includes(out.stickSize)) out.stickSize = base.stickSize;
    if (typeof out.ctlLayout !== "string" || out.ctlLayout.length > 8000) out.ctlLayout = base.ctlLayout;
    if (!["small", "medium", "large"].includes(out.mapSize)) out.mapSize = base.mapSize;
    if (!["toggle", "hold", "auto"].includes(out.sprintMode)) out.sprintMode = base.sprintMode;
    out.stickOpacity = clamp(out.stickOpacity, 0.3, 1);
    out.sensH = clamp(out.sensH, 0.05, 1);
    out.sensV = clamp(out.sensV, 0.05, 1);
    out.sens = clamp(out.sens, 0.5, 2);
    out.master = clamp(out.master, 0, 1);
    out.musicVol = clamp(out.musicVol, 0, 1);
    out.sfxVol = clamp(out.sfxVol, 0, 1);
    out.adsAudio = out.adsAudio === true;
    out.adsVol = clamp(Number(out.adsVol), 0, 1);
    if (out.lang !== "en" && out.lang !== "pcm") out.lang = base.lang;
    out.cp = Math.max(0, Math.floor(clamp(out.cp, 0, 1e7)));
    out.rankXp = Math.max(0, Math.floor(clamp(out.rankXp, 0, 1e10)));
    out.deviceXp = Math.max(0, Math.floor(clamp(out.deviceXp, 0, 1e10)));
    out.honour = Math.max(0, Math.floor(clamp(Number(out.honour) || 0, 0, 1e9)));
    const strs = (v: unknown, ok: readonly string[], most: number) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && ok.includes(x)).slice(0, most) : []);
    out.runWeapon = ["pistol", "dane", "pestle", "flame"].includes(out.runWeapon) ? out.runWeapon : "pistol";
    out.runPerks = strs(out.runPerks, ["breath", "quiet", "eagle", "mule", "steady"], 2);
    out.runCharms = strs(out.runCharms, ["notorch", "melee", "six"], 3);
    out.runMods = strs(out.runMods, ["suppressor", "scope"], 2);
    out.runDaily = out.runDaily === true;
    out.runDeaths = Array.isArray(out.runDeaths) ? out.runDeaths.filter((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v))).slice(-30) : [];
    out.form = typeof out.form === "string" ? out.form.replace(/[^WL]/g, "").slice(0, 5) : "";
    out.streak = Math.max(0, Math.floor(clamp(Number(out.streak) || 0, 0, 1e6)));
    // The old levels aren't carried onto the ladder (they could be edited on the phone): level 5 or more earns the Founder tag.
    if (!out.founder && levelOf(out.xp).level >= 5) out.founder = true;
    out.boosts = cleanBoosts(saved.boosts);
    out.boostsOn = Array.isArray(saved.boostsOn) ? [...new Set(saved.boostsOn.filter((b) => BOOST_IDS.includes(b) && (out.boosts[b] ?? 0) > 0))] : [];
    out.friends = Array.isArray(saved.friends)
      ? saved.friends.filter((f) => f && typeof f.name === "string" && typeof f.fid === "string" && FID_RE.test(f.fid)).slice(0, 100)
      : [];
    out.look = cleanLook(saved.look);
    // Version 1 saves: an "equipped" outfit and cap become part of the look.
    if (!saved.look && saved.equipped) {
      out.look = cleanLook({ ...DEFAULT_LOOK, outfit: saved.equipped.outfit ?? "street", extras: saved.equipped.cap ? ["fila"] : [] });
      out.badge = saved.equipped.badge === true;
    }
    // v6: v5 put everyone on the "op-black" preset by default: unless they picked it, back to the platform's picture.
    if (!saved.avatarSet && out.avatar === "op-black") out.avatar = "";
    if (saved.quality === "saver") out.graphics = "low";
    if (saved.quality === "sharp") out.graphics = "high";
    out.wheel = Array.isArray(saved.wheel) && saved.wheel.length >= 1 && saved.wheel.length <= 8 && saved.wheel.every((e) => EMOTE_IDS.includes(e)) ? saved.wheel : base.wheel;
    out.daily = saved.daily && typeof saved.daily.day === "string" && Array.isArray(saved.daily.progress) ? saved.daily : base.daily;
    out.chest = cleanChest(saved.chest);
    out.awards = cleanAwards(saved.awards);
    out.history = cleanHistory(saved.history);
    out.dms = cleanDms(saved.dms);
    out.dmsOn = saved.dmsOn !== false;
    out.cardPublic = saved.cardPublic !== false;
    out.blockedFids = Array.isArray(saved.blockedFids) ? saved.blockedFids.filter((f) => typeof f === "string" && FID_RE.test(f)).slice(0, 200) : [];
    out.recent = Array.isArray(saved.recent) ? saved.recent.filter((r) => r && typeof r.name === "string").slice(0, 30) : [];
    if (!FID_RE.test(out.fid)) out.fid = newFid();
    return out;
  } catch {
    base.fid = newFid();
    return base;
  }
}

export function saveSettings(host: Host, s: Settings): void {
  host.save(KEY, JSON.stringify(s));
}

function clamp(v: number, a: number, b: number): number {
  return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : a;
}
