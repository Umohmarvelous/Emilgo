// The 20 controls (SPEC-V2 §7.4): every control any EMILGO game may use, with
// its icon, its keyboard key and how it works on touch. Each game says which
// it uses; the others stay in the list, marked, and never show on its screen.
//
// Red Light, Green Light uses 16. Reload, grenade and ability wait for games
// that need them; voice chat can't be built (the Lagos Life frame has no
// microphone).

export type ControlId =
  | "reload"
  | "melee"
  | "grenade"
  | "crouch"
  | "prone"
  | "jump"
  | "sprint"
  | "slide"
  | "interact"
  | "emotes"
  | "voice"
  | "chat"
  | "map"
  | "scoreboard"
  | "settings"
  | "feed"
  | "compass"
  | "stamina"
  | "ability"
  | "quick";

export interface ControlDef {
  id: ControlId;
  label: string;
  icon: string;
  /** Keyboard, as shown to players ("" when there's no key). */
  key: string;
  /** How it works on a touch screen. */
  touch: string;
}

export const CONTROLS: readonly ControlDef[] = [
  { id: "reload", label: "Reload", icon: "refresh", key: "R", touch: "Button" },
  { id: "melee", label: "Fist, slap, push", icon: "fist", key: "1 · 2 · 3", touch: "Bottom centre, with someone within 2 m" },
  { id: "grenade", label: "Grenade", icon: "target", key: "", touch: "Button" },
  { id: "crouch", label: "Crouch", icon: "crouch", key: "C", touch: "Tap the crouch button" },
  { id: "prone", label: "Lie down", icon: "prone", key: "Hold C", touch: "Hold the crouch button" },
  { id: "jump", label: "Jump", icon: "jump", key: "Space", touch: "Jump button" },
  { id: "sprint", label: "Sprint", icon: "sprint", key: "Shift", touch: "Button above the move stick, or double-tap the stick" },
  { id: "slide", label: "Slide", icon: "crouch", key: "C while sprinting", touch: "Crouch while sprinting" },
  { id: "interact", label: "Grab the ball", icon: "grab", key: "F", touch: "Bottom centre, with a free ball in reach" },
  { id: "emotes", label: "Emote wheel", icon: "emote", key: "G", touch: "Hold the emote button" },
  { id: "voice", label: "Voice chat", icon: "sound", key: "", touch: "" },
  { id: "chat", label: "Text chat", icon: "chat", key: "T", touch: "Chat button (online)" },
  { id: "map", label: "Full map", icon: "map", key: "M", touch: "Tap the minimap" },
  { id: "scoreboard", label: "Scoreboard", icon: "people", key: "Hold Tab", touch: "Scoreboard button, top left" },
  { id: "settings", label: "Settings", icon: "gear", key: "", touch: "Gear button, top left" },
  { id: "feed", label: "Kill feed on / off", icon: "eye", key: "K", touch: "Settings, Game" },
  { id: "compass", label: "Compass", icon: "signal", key: "", touch: "Always on, top centre" },
  { id: "stamina", label: "Stamina", icon: "bolt", key: "", touch: "Round the sprint button and above the move stick" },
  { id: "ability", label: "Ability", icon: "star", key: "", touch: "Button" },
  { id: "quick", label: "Quick chat", icon: "ping", key: "Y", touch: "Quick chat button" },
];

/** The controls Red Light, Green Light uses (the rest are hidden in it). */
export const RLGL_CONTROLS: ReadonlySet<ControlId> = new Set<ControlId>([
  "melee",
  "crouch",
  "prone",
  "jump",
  "sprint",
  "slide",
  "interact",
  "emotes",
  "chat",
  "map",
  "scoreboard",
  "settings",
  "feed",
  "compass",
  "stamina",
  "quick",
]);

/** Why a control isn't in this game. */
export function unusedReason(id: ControlId): string {
  return id === "voice" ? "Not available: no microphone in Lagos Life" : "Not in this game";
}
