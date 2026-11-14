// Emotes: a pose for the body and an icon above the head, for ~2 seconds.
// They move the arms, never the feet, so emoting while she watches is safe —
// which makes a well-timed taunt the purest taunt in the game.
//
// Most are free for everyone. The pack is a Lagos Life purchase: the server
// only relays a pack emote from someone who owns it.
//
// v6 (the owner: "among all emotes, I like shaku shaku and zanku ... everyone
// else must be removed"): only Shaku Shaku and Zanku, free for everyone. The
// others stay in EMOTE_ALL (their poses, old saves) but can't be picked or sent.
//
// v6 max (3.9): international dances added, motion-captured.
//
// Disabling an emote (v6.1): set `off` on its entry in EMOTE_ALL. `off: true`
// disables it silently; `off: "reason"` disables it and gives the UI a tooltip.
// The kill-switch is honoured by EMOTES (picker), EMOTE_IDS, isEmoteLive,
// canSendEmote, and — if you wire it in — the server relay.

export type EmoteId =
  | "wave" | "dance" | "laugh" | "cry" | "taunt" | "respect" | "handshake" | "slay" | "flex" | "zanku" | "shaku" | "odogwu"
  // v6 max (3.9): international dances, motion-captured (tools/anim/dances.mjs: the CMU database's real takes).
  | "charleston" | "twist" | "salsa" | "lambada" | "kazachok" | "breaking" | "ballet";

export interface Emote {
  id: EmoteId;
  /** Icon id (ui/icons.ts). */
  icon: string;
  label: string;
  /** Owned through the "Owambe emote pack" product. */
  pack?: boolean;
  /** v6 max (3.9): where a dance comes from (shown under its name). */
  from?: string;
  /**
   * Kill-switch. When set, the emote cannot be picked or sent.
   *   true          → disabled (no reason shown)
   *   "reason"      → disabled, and the string is a human-readable reason
   *   false / "" / null / undefined → enabled
   * Strings "false" / "0" / "no" / "off" are also treated as enabled
   * (so an accidental `off: "false"` doesn't silently disable a dance).
   */
  off?: boolean | string;
}

// --- off normalisation -------------------------------------------------------

const OFF_FALSEY = new Set(["", "false", "0", "no", "off"]);

/** True if this emote is disabled via its `off` field. */
export function isEmoteOff(e: Emote | undefined): boolean {
  if (!e || e.off == null) return false;
  if (typeof e.off === "boolean") return e.off;
  return !OFF_FALSEY.has(e.off.trim().toLowerCase());
}

// --- data --------------------------------------------------------------------

export const EMOTE_ALL: Emote[] = [
  { id: "wave", icon: "wave", label: "Wave", off: "true" },
  { id: "dance", icon: "dance", label: "Dance", off: "true" },
  { id: "laugh", icon: "laugh", label: "Laugh", off: "true" },
  { id: "cry", icon: "cry", label: "Cry", off: "true" },
  { id: "taunt", icon: "taunt", label: "Taunt", off: "true" },
  { id: "respect", icon: "respect", label: "Respect", off: "true" },
  { id: "handshake", icon: "handshake", label: "Handshake", off: "true" },
  { id: "slay", icon: "slay", label: "Slay", off: "true" },
  { id: "flex", icon: "flex", label: "Flex", off: "true" },
  { id: "zanku", icon: "dance", label: "Zanku", off: "true" },
  { id: "shaku", icon: "fire", label: "Shaku Shaku" , off: "true"},
  { id: "odogwu", icon: "crown", label: "Odogwu", pack: true, off: "true" },
  // v6 max (3.9): the world's dances, with their real steps (motion capture), free for everyone.
  { id: "charleston", icon: "dance", label: "Charleston", from: "", off: "true" },
  { id: "twist", icon: "dance", label: "The Twist", from: "", off: "true" },
  { id: "salsa", icon: "dance", label: "Salsa", from: "", off: "true" },
  { id: "lambada", icon: "dance", label: "Lambada", from: "", off: "true" },
  { id: "kazachok", icon: "dance", label: "Kazachok", from: "", off: "true" },
  { id: "breaking", icon: "flex", label: "Breaking", from: "", off: "true" },
  // Disabled — stays in EMOTE_ALL so old saves / lookups still resolve it.
  { id: "ballet", icon: "slay", label: "Pirouette", from: "", off: "true" },
];

/** v6 base allow-list (what *could* be live). `off` narrows this further. */
export const LIVE_EMOTES: readonly EmoteId[] = [
  "shaku", "zanku", "charleston", "twist", "salsa", "lambada", "kazachok", "breaking", "ballet",
];

/** v6 max (3.9): dances that play a motion-captured clip (op-dances.bin) over the whole body. */
export const MOCAP_DANCES: Partial<Record<EmoteId, string>> = {
  charleston: "charleston",
  twist: "twist",
  salsa: "salsa",
  lambada: "lambada",
  kazachok: "kazachok",
  breaking: "breaking",
  ballet: "ballet",
};

// --- derived live set --------------------------------------------------------

const BASE_LIVE: ReadonlySet<EmoteId> = new Set(LIVE_EMOTES);

/**
 * The emotes a player can actually pick and send right now.
 * Membership in LIVE_EMOTES is necessary but not sufficient — `off` wins.
 */
export const EMOTES: Emote[] = EMOTE_ALL.filter(
  (e) => BASE_LIVE.has(e.id) && !isEmoteOff(e),
);

export const EMOTE_IDS: EmoteId[] = EMOTES.map((e) => e.id);

const LIVE_SET: ReadonlySet<EmoteId> = new Set(EMOTE_IDS);

/** Full lookup — includes disabled emotes, for old saves and replays. */
export const EMOTE_BY_ID = Object.fromEntries(
  EMOTE_ALL.map((e) => [e.id, e]),
) as Record<EmoteId, Emote>;

export const EMOTE_SECONDS = 2.2;

// --- guards (call these on the send path, the relay, and the UI) -------------

/** Is this emote currently live (pickable / relayable)? */
export function isEmoteLive(id: EmoteId): boolean {
  return LIVE_SET.has(id);
}

/**
 * The single check the send path, the server relay, and the UI should all call.
 * Returns false for: unknown ids, `off`-disabled ids, ids outside LIVE_EMOTES,
 * and pack emotes when the caller doesn't own the pack.
 */
export function canSendEmote(
  id: EmoteId,
  opts: { ownsPack?: boolean } = {},
): boolean {
  const e = EMOTE_BY_ID[id];
  if (!e) return false;
  if (isEmoteOff(e)) return false;
  if (!LIVE_SET.has(id)) return false;
  if (e.pack && !opts.ownsPack) return false;
  return true;
}

/** Ids the owner has disabled: shown in the UI, but never played. */
export const DISABLED_EMOTES: ReadonlySet<EmoteId> = new Set(
  EMOTE_ALL.filter(isEmoteOff).map((e) => e.id),
);

// --- UI helpers (optional) ---------------------------------------------------

export interface EmoteButton {
  emote: Emote;
  disabled: boolean;
  /** The `off` reason string, if one was supplied. Use as a tooltip. */
  reason?: string;
}

/**
 * Buttons to render. Includes disabled emotes so you can grey them out
 * instead of hiding them. Use `EMOTES` directly if you'd rather hide them.
 */
export const EMOTE_BUTTONS: EmoteButton[] = EMOTE_ALL
  .filter((e) => BASE_LIVE.has(e.id))
  .map((e) => ({
    emote: e,
    disabled: isEmoteOff(e),
    reason: typeof e.off === "string" && e.off.trim() ? e.off : undefined,
  }));