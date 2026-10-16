// Which host are we in? Decided once, at boot.
//
//   1. EMILGO injected __EMILGO_GAMES_HOST__            → emilgo
//   2. framed + the Vatar SDK answers init()      → lagoslife
//   3. anything else                              → web
//
// __HOST_BUILD__ is "emilgo" for the copy embedded in the EMILGO app; that
// build does not even contain the Vatar SDK tag.

import { createEmilgoHost } from "./emilgo";
import { createLagosLifeHost } from "./lagoslife";
import type { Host } from "./types";
import { createWebHost } from "./web";

/** Wait for the async SDK script, but never long: offline must still boot. */
function vatarReady(ms: number): Promise<boolean> {
  if (window.Vatar) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      if (window.Vatar) return resolve(true);
      if (document.readyState === "complete" || performance.now() - started > ms) return resolve(!!window.Vatar);
      setTimeout(check, 50);
    };
    check();
  });
}

export async function detectHost(): Promise<Host> {
  const boot = window.__EMILGO_GAMES_HOST__;
  if (boot && boot.host === "emilgo") return createEmilgoHost(boot);

  if (__HOST_BUILD__ !== "emilgo") {
    let mock = false;
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("mockvatar")) {
      const { installMockVatar } = await import("./mockVatar");
      await installMockVatar();
      mock = true;
    }
    const framed = window.parent !== window;
    if ((framed || mock) && (await vatarReady(2500)) && window.Vatar) {
      const host = await createLagosLifeHost(window.Vatar);
      if (host) return host;
    }
  }

  return createWebHost();
}

export type { Host, Player, Leaderboard, HapticKind } from "./types";
