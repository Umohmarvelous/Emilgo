// Player settings, stored through the host (localStorage in a browser or
// Lagos Life, AsyncStorage via the bridge in EMILGO). Each host keeps its own
// copy — nothing crosses between Lagos Life and EMILGO.

import { SONG_IDS, type SongChoice } from "./audio/songs";
import { DEFAULT_DISTANCE, DISTANCES, MODES, type Distance, type Mode } from "./config";
import { EMOTE_IDS, type EmoteId } from "./social/emotes";
import type { Host } from "./platform/types";
import { cleanLook, DEFAULT_LOOK, type Look } from "./world/human/wardrobe";
import type { PoseId } from "./world/human/animator";

export type GraphicsTier = "auto" | "low" | "medium" | "high";

export interface Settings {
  sound: boolean;
  music: boolean;
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
  tutorialSeen: boolean;
  best: number;
  played: number;
  wins: number;
  xp: number;
  /** Today's challenges: the day they were set and progress on each. */
  daily: { day: string; progress: number[] };
  /** People you've played online with lately (names only), newest first. */
  recent: { name: string; at: number }[];
}

const KEY = "settings.v1";

export const DEFAULT_WHEEL: EmoteId[] = ["wave", "dance", "laugh", "taunt", "respect", "handshake", "cry", "slay"];

export function defaults(host: Host): Settings {
  return {
    sound: true,
    music: true,
    haptics: true,
    // Lagos Life is 18+ (Terms §2). EMILGO is not age-gated, so it starts clean.
    blood: host.kind === "lagoslife",
    shake: true,
    autoCam: false,
    leftHanded: false,
    lookStick: "touch",
    sensH: 0.35,
    sensV: 0.25,
    invertY: false,
    firstPerson: false,
    graphics: "auto",
    look: { ...DEFAULT_LOOK },
    badge: false,
    song: "shuffle",
    chat: true,
    lobbyPose: "relaxed",
    wheel: [...DEFAULT_WHEEL],
    map: "lagos-street",
    tutorialSeen: false,
    best: 0,
    played: 0,
    wins: 0,
    xp: 0,
    daily: { day: "", progress: [] },
    recent: [],
    mode: "classic",
    distance: DEFAULT_DISTANCE,
  };
}

export function loadSettings(host: Host): Settings {
  const base = defaults(host);
  const raw = host.load(KEY);
  if (!raw) return base;
  try {
    const saved = JSON.parse(raw) as Partial<Settings> & { equipped?: { outfit?: string | null; cap?: boolean; badge?: boolean }; quality?: string };
    const out = { ...base };
    for (const k of Object.keys(base) as (keyof Settings)[]) {
      if (typeof saved[k] === typeof base[k] && !Array.isArray(base[k])) (out as Record<string, unknown>)[k] = saved[k];
    }
    if (out.song !== "shuffle" && !SONG_IDS.includes(out.song)) out.song = base.song;
    if (!["auto", "low", "medium", "high"].includes(out.graphics)) out.graphics = base.graphics;
    if (out.lookStick !== "always" && out.lookStick !== "touch") out.lookStick = base.lookStick;
    if (!MODES.includes(out.mode)) out.mode = base.mode;
    if (!DISTANCES.includes(out.distance)) out.distance = base.distance;
    out.sensH = clamp(out.sensH, 0.05, 1);
    out.sensV = clamp(out.sensV, 0.05, 1);
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
    return out;
  } catch {
    return base;
  }
}

export function saveSettings(host: Host, s: Settings): void {
  host.save(KEY, JSON.stringify(s));
}

function clamp(v: number, a: number, b: number): number {
  return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : a;
}
