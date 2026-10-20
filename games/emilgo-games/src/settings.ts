// Player settings, stored through the host (localStorage in a browser or
// Lagos Life, AsyncStorage via the bridge in EMILGO). Each host keeps its own
// copy — nothing crosses between Lagos Life and EMILGO.

import { SONG_IDS, type SongChoice } from "./audio/songs";
import { DEFAULT_DISTANCE, DISTANCES, MODES, type Distance, type Mode } from "./config";
import { EMOTE_IDS, type EmoteId } from "./social/emotes";
import type { Host } from "./platform/types";
import { BOOST_IDS, cleanBoosts, type BoostId } from "./shop/boosts";
import { cleanLook, DEFAULT_LOOK, type Look } from "./world/human/wardrobe";
import type { PoseId } from "./world/human/animator";

export type GraphicsTier = "auto" | "low" | "medium" | "high";

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
  /** The songs on/off (her warning hum stays); their volume. */
  music: boolean;
  musicVol: number;
  /** Master volume, 0…1 (§7.2). */
  master: number;
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
  /** Right stick: always drawn, or only while touched. */
  lookStick: "always" | "touch";
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
  /** Mama's song, or "shuffle" for a different one each round. */
  song: SongChoice;
  /** The stance your character holds in the lobby. */
  lobbyPose: PoseId;
  /** The emote wheel, eight slots. */
  wheel: EmoteId[];
  /** Last map picked for practice. */
  map: string;
  /** The mode and distance picked on the play screen (SPEC-V2 §2.1). */
  mode: Mode;
  distance: Distance;
  /** Light / dark mode (SPEC-V2 §6.4): full daylight, full night, or the map's own sky. */
  lightMode: "auto" | "light" | "dark";
  /** Controls (SPEC-V2 §4, §7.5): stick size and opacity, how sprint works. */
  stickSize: "small" | "medium" | "large";
  stickOpacity: number;
  sprintMode: "toggle" | "hold" | "auto";
  /** HUD: the minimap's size, and whether the kill feed shows. */
  mapSize: "small" | "medium" | "large";
  killFeed: boolean;
  tutorialSeen: boolean;
  best: number;
  played: number;
  wins: number;
  xp: number;
  /** Today's challenges: the day they were set and progress on each. */
  daily: { day: string; progress: number[] };
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

export const DEFAULT_WHEEL: EmoteId[] = ["wave", "dance", "laugh", "taunt", "respect", "handshake", "cry", "slay"];

export function defaults(host: Host): Settings {
  return {
    sound: true,
    sfxVol: 1,
    music: true,
    musicVol: 0.8,
    master: 1,
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
    lookStick: "touch",
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
    daily: { day: "", progress: [] },
    recent: [],
    mode: "classic",
    distance: DEFAULT_DISTANCE,
    lightMode: "auto",
    stickSize: "medium",
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
  "look", "badge", "lobbyPose", "wheel", "map", "mode", "distance", "tutorialSeen", "best", "played", "wins", "xp",
  "daily", "recent", "fid", "friends", "cp", "boosts", "boostsOn", "song",
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
    // One song now: whatever an older save chose becomes it.
    out.song = SONG_IDS[0];
    if (!["auto", "low", "medium", "high"].includes(out.graphics)) out.graphics = base.graphics;
    if (out.lookStick !== "always" && out.lookStick !== "touch") out.lookStick = base.lookStick;
    if (!MODES.includes(out.mode)) out.mode = base.mode;
    if (!DISTANCES.includes(out.distance)) out.distance = base.distance;
    if (!["auto", "light", "dark"].includes(out.lightMode)) out.lightMode = base.lightMode;
    if (!["small", "medium", "large"].includes(out.stickSize)) out.stickSize = base.stickSize;
    if (!["small", "medium", "large"].includes(out.mapSize)) out.mapSize = base.mapSize;
    if (!["toggle", "hold", "auto"].includes(out.sprintMode)) out.sprintMode = base.sprintMode;
    out.stickOpacity = clamp(out.stickOpacity, 0.3, 1);
    out.sensH = clamp(out.sensH, 0.05, 1);
    out.sensV = clamp(out.sensV, 0.05, 1);
    out.sens = clamp(out.sens, 0.5, 2);
    out.master = clamp(out.master, 0, 1);
    out.musicVol = clamp(out.musicVol, 0, 1);
    out.sfxVol = clamp(out.sfxVol, 0, 1);
    if (out.lang !== "en" && out.lang !== "pcm") out.lang = base.lang;
    out.cp = Math.max(0, Math.floor(clamp(out.cp, 0, 1e7)));
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
    if (saved.quality === "saver") out.graphics = "low";
    if (saved.quality === "sharp") out.graphics = "high";
    out.wheel = Array.isArray(saved.wheel) && saved.wheel.length === 8 && saved.wheel.every((e) => EMOTE_IDS.includes(e)) ? saved.wheel : base.wheel;
    out.daily = saved.daily && typeof saved.daily.day === "string" && Array.isArray(saved.daily.progress) ? saved.daily : base.daily;
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
