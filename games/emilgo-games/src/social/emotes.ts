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
  // v6 max (3.9): the world's dances, with their real steps (motion capture), free for everyone.
  { id: "charleston", icon: "dance", label: "Charleston", from: "USA, 1920s" },
  { id: "twist", icon: "dance", label: "The Twist", from: "USA, 1960s" },
  { id: "salsa", icon: "dance", label: "Salsa", from: "Cuba" },
  { id: "lambada", icon: "dance", label: "Lambada", from: "Brazil" },
  { id: "kazachok", icon: "dance", label: "Kazachok", from: "Russia and Ukraine" },
  { id: "breaking", icon: "flex", label: "Breaking", from: "New York" },
  { id: "ballet", icon: "slay", label: "Pirouette", from: "Ballet, France" },
];

/** The emotes a player can pick and send (v6). */
export const LIVE_EMOTES: readonly EmoteId[] = ["shaku", "zanku", "charleston", "twist", "salsa", "lambada", "kazachok", "breaking", "ballet"];

/** v6 max (3.9): the dances that play a motion-captured clip (op-dances.bin) over the whole body. */
export const MOCAP_DANCES: Partial<Record<EmoteId, string>> = {
  charleston: "charleston", twist: "twist", salsa: "salsa", lambada: "lambada", kazachok: "kazachok", breaking: "breaking", ballet: "ballet",
};
export const EMOTES: Emote[] = EMOTE_ALL.filter((e) => LIVE_EMOTES.includes(e.id));

export const EMOTE_IDS = EMOTES.map((e) => e.id);
export const EMOTE_BY_ID = Object.fromEntries(EMOTE_ALL.map((e) => [e.id, e])) as Record<EmoteId, Emote>;
export const EMOTE_SECONDS = 2.2;
