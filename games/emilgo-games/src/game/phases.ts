// Red Light, Green Light's phases, on their own (SPEC-V3 §1.2): the wire code
// the lobby loads (net/protocol.ts) needs the list, and must not pull the
// referee (rules.ts) and the rest of Ball Haunt into the boot script with it.

export type Phase = "walkout" | "countdown" | "sing" | "hum" | "turning" | "watch" | "turningBack" | "ended";

export const PHASES: readonly Phase[] = ["walkout", "countdown", "sing", "hum", "turning", "watch", "turningBack", "ended"];

/** Before play: nobody moves and the clock doesn't run. */
export function prePlay(p: Phase): boolean {
  return p === "walkout" || p === "countdown";
}
