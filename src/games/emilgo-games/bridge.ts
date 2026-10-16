// src/games/emilgo-games/bridge.ts
//
// The contract between the EMILGO app and the EMILGO Games game page running in a
// WebView. The game side of this lives in games/emilgo-games/src/platform/emilgo.ts;
// change both together.
//
//   app → game   { emilgo: 1, type: "pause" | "resume" | "back" }
//   game → app   { emilgo: 1, type: "ready" }
//                { emilgo: 1, type: "haptic", kind }
//                { emilgo: 1, type: "save", key, value }
//                { emilgo: 1, type: "exit" }
//
// Boot data is injected into the page as `window.__EMILGO_GAMES_HOST__` before the
// game's own script runs.
//
// The copy of the game embedded here never loads the Vatar SDK and never talks
// to Lagos Life: an EMILGO account is never linked to a Lagos Life player
// (Vatar Developer Agreement §8.2(b)).

export const GAMES_STORAGE_PREFIX = "emilgo-games:redlight:";

/** Keys the game is allowed to persist through the bridge. Anything else is dropped. */
export const GAMES_KEYS = ["settings.v1"] as const;

export type GameHaptic = "tap" | "select" | "warning" | "success" | "heavy" | "error";

export type GameMessage =
  | { emilgo: 1; type: "ready" }
  | { emilgo: 1; type: "haptic"; kind: GameHaptic }
  | { emilgo: 1; type: "save"; key: string; value: string }
  | { emilgo: 1; type: "exit" };

export type HostMessage = { emilgo: 1; type: "pause" | "resume" | "back" };

export interface GameBoot {
  host: "emilgo";
  v: 1;
  name?: string;
  saved?: Record<string, string>;
  /** wss:// address of the EMILGO Games server (online rounds). Omit to hide Online. */
  server?: string;
}

/** Parse and validate a message from the page. Returns null for anything unexpected. */
export function parseGameMessage(raw: unknown): GameMessage | null {
  let m: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 16_384) return null;
    try {
      m = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  if (o.emilgo !== 1 || typeof o.type !== "string") return null;
  switch (o.type) {
    case "ready":
    case "exit":
      return { emilgo: 1, type: o.type };
    case "haptic":
      return typeof o.kind === "string" ? { emilgo: 1, type: "haptic", kind: o.kind as GameHaptic } : null;
    case "save":
      if (typeof o.key !== "string" || typeof o.value !== "string") return null;
      if (!(GAMES_KEYS as readonly string[]).includes(o.key) || o.value.length > 8192) return null;
      return { emilgo: 1, type: "save", key: o.key, value: o.value };
    default:
      return null;
  }
}

export function hostMessage(type: HostMessage["type"]): string {
  return JSON.stringify({ emilgo: 1, type } satisfies HostMessage);
}

/**
 * The page HTML with boot data injected ahead of everything else. The JSON is
 * escaped so a display name can never close the script tag.
 */
export function withBoot(html: string, boot: GameBoot): string {
  const json = JSON.stringify(boot).replace(/</g, "\\u003c");
  const tag = `<script>window.__EMILGO_GAMES_HOST__=${json};</script>`;
  return html.replace("<head>", () => `<head>${tag}`);
}
