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

export type EmoteId = "wave" | "dance" | "laugh" | "cry" | "taunt" | "respect" | "handshake" | "slay" | "flex" | "zanku" | "shaku" | "odogwu";

export interface Emote {
  id: EmoteId;
  /** Icon id (ui/icons.ts). */
  icon: string;
  label: string;
  /** Owned through the "Owambe emote pack" product. */
  pack?: boolean;
}

export const EMOTE_ALL: Emote[] = [
  { id: "wave", icon: "wave", label: "Wave" },
  { id: "dance", icon: "dance", label: "Dance" },
  { id: "laugh", icon: "laugh", label: "Laugh" },
  { id: "cry", icon: "cry", label: "Cry" },
  { id: "taunt", icon: "taunt", label: "Taunt" },
  { id: "respect", icon: "respect", label: "Respect" },
  { id: "handshake", icon: "handshake", label: "Handshake" },
  { id: "slay", icon: "slay", label: "Slay" },
  { id: "flex", icon: "flex", label: "Flex" },
  { id: "zanku", icon: "dance", label: "Zanku" },
  { id: "shaku", icon: "fire", label: "Shaku Shaku" },
  { id: "odogwu", icon: "crown", label: "Odogwu", pack: true },
];

/** The emotes a player can pick and send (v6). */
export const LIVE_EMOTES: readonly EmoteId[] = ["shaku", "zanku"];
export const EMOTES: Emote[] = EMOTE_ALL.filter((e) => LIVE_EMOTES.includes(e.id));

export const EMOTE_IDS = EMOTES.map((e) => e.id);
export const EMOTE_BY_ID = Object.fromEntries(EMOTE_ALL.map((e) => [e.id, e])) as Record<EmoteId, Emote>;
export const EMOTE_SECONDS = 2.2;
