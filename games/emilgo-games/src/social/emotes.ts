// Emotes: a pose for the body and an icon above the head, for ~2 seconds.
// They move the arms, never the feet, so emoting while she watches is safe —
// which makes a well-timed taunt the purest taunt in the game.
//
// Most are free for everyone. The pack is a Lagos Life purchase: the server
// only relays a pack emote from someone who owns it.

export type EmoteId = "wave" | "dance" | "laugh" | "cry" | "taunt" | "respect" | "handshake" | "slay" | "flex" | "zanku" | "shaku" | "odogwu";

export interface Emote {
  id: EmoteId;
  /** Icon id (ui/icons.ts). */
  icon: string;
  label: string;
  /** Owned through the "Owambe emote pack" product. */
  pack?: boolean;
}

export const EMOTES: Emote[] = [
  { id: "wave", icon: "wave", label: "Wave" },
  { id: "dance", icon: "dance", label: "Dance" },
  { id: "laugh", icon: "laugh", label: "Laugh" },
  { id: "cry", icon: "cry", label: "Cry" },
  { id: "taunt", icon: "taunt", label: "Taunt" },
  { id: "respect", icon: "respect", label: "Respect" },
  { id: "handshake", icon: "handshake", label: "Handshake" },
  { id: "slay", icon: "slay", label: "Slay" },
  { id: "flex", icon: "flex", label: "Flex" },
  { id: "zanku", icon: "dance", label: "Zanku", pack: true },
  { id: "shaku", icon: "fire", label: "Shaku Shaku", pack: true },
  { id: "odogwu", icon: "crown", label: "Odogwu", pack: true },
];

export const EMOTE_IDS = EMOTES.map((e) => e.id);
export const EMOTE_BY_ID = Object.fromEntries(EMOTES.map((e) => [e.id, e])) as Record<EmoteId, Emote>;
export const EMOTE_SECONDS = 2.2;
