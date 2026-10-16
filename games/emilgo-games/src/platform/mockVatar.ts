// DEVELOPMENT ONLY. A stand-in for window.Vatar so the Lagos Life code path
// can be exercised on localhost (open the game with ?mockvatar). It is imported
// behind `import.meta.env.DEV`, so production builds do not contain it.
//
// It is not a copy of the Vatar SDK (that must always be loaded from
// lagoslife.app) — it fakes the WORLD's answers, including the 20-second score
// rule and the 30-second board refresh, so throttling bugs show up here first.
//
// Matches: if the fake platform (server/scripts/mockvatar.ts) is running, the
// mock talks to it — every tab is a different test player, and two tabs can
// play a real staked match through our game server. Open the game with
// ?mockvatar (platform on 127.0.0.1:8790) or ?mockvatar=http://host:port.
// Without it, matches answer the way the real SDK does before approval.
//
// Real testing happens in the Lagos Life sandbox with test keys.

import type { VatarMatch, VatarSDK } from "./lagoslife";

function fail(code: string): Error {
  const e = new Error("Vatar: " + code) as Error & { code: string };
  e.code = code;
  return e;
}

const later = <T>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(v), ms));

/** Talk to the fake platform; rejects with a Vatar-style error code. */
async function api<T>(base: string, path: string, body?: object, session?: string): Promise<T> {
  const u = new URL(base + path);
  if (session && !body) u.searchParams.set("session", session);
  const url = u.toString();
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, session }) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(String((j as { error?: string }).error ?? "error"));
  return j as T;
}

export async function installMockVatar(): Promise<void> {
  // The real SDK script may already be here (it is cached after the first
  // load). Outside a world it can only answer "not_framed", so with ?mockvatar
  // the mock replaces it. If the real script runs later, it sees window.Vatar
  // and leaves the mock alone.
  if ((window.Vatar as { __mock?: boolean } | undefined)?.__mock) return;
  const param = new URLSearchParams(location.search).get("mockvatar");
  const base = (param && /^https?:\/\//.test(param) ? param : `http://${location.hostname}:8790`).replace(/\/+$/, "");
  // Each tab is its own test player: the name lives in this tab only.
  let name = sessionStorage.getItem("mockvatar.name");
  if (!name) {
    name = `Tester ${Math.floor(100 + Math.random() * 900)}`;
    sessionStorage.setItem("mockvatar.name", name);
  }
  let world: { player: { id: string; name: string; avatar: null }; session: string } | null = null;
  try {
    world = await api(base, "/mock/init", { name });
  } catch {
    world = null; // no fake platform running: offline mock below
  }
  const player = world?.player ?? { id: "t_DEVplayer0000", name: "Dev Tester", avatar: null };
  let session = world?.session ?? "vtr1.mock";
  let best = 0;
  let lastScore = 0;
  const board = [
    { name: "Ada", score: 1402 },
    { name: "Tunde", score: 1288 },
    { name: "Chioma", score: 1190 },
    { name: "Bayo", score: 640 },
  ];
  const pause: (() => void)[] = [];
  const resume: (() => void)[] = [];
  const sub = (list: (() => void)[]) => (fn: () => void) => {
    list.push(fn);
    return () => list.splice(list.indexOf(fn), 1);
  };

  const notAvailable = () => Promise.reject(fail("error")); // what the v1 SDK turns not_available into

  // Matches through the fake platform, with onUpdate by polling.
  const listeners = new Set<(m: VatarMatch) => void>();
  let lastJson = "";
  let lastId = "";
  const poll = async () => {
    if (!world) return;
    try {
      const m = await api<VatarMatch | null>(base, `/mock/match/current${lastId ? `?last=${lastId}` : ""}`, undefined, session);
      const j = JSON.stringify(m);
      if (m && j !== lastJson) {
        lastJson = j;
        lastId = m.id;
        listeners.forEach((f) => f(m));
      }
    } catch {
      /* keep polling */
    }
  };
  if (world) setInterval(poll, 700);
  const track = (m: VatarMatch) => {
    lastId = m.id;
    lastJson = JSON.stringify(m);
    return m;
  };
  const matchApi = world
    ? {
        create: (o: { stake: number; seats: number }) => api<VatarMatch>(base, "/mock/match/create", o, session).then(track),
        join: (code: string) => api<VatarMatch>(base, "/mock/match/join", { code }, session).then(track),
        quick: (o: { stake: number }) => api<VatarMatch>(base, "/mock/match/quick", o, session).then(track),
        leave: () => api<VatarMatch | null>(base, "/mock/match/leave", {}, session),
        current: () => api<VatarMatch | null>(base, "/mock/match/current", undefined, session),
        onUpdate: (fn: (m: VatarMatch) => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      }
    : null;

  const sdk: VatarSDK & { __mock: true } = {
    __mock: true,
    version: "1-mock",
    init: () => later({ player, session, mode: "test" as const }, 300),
    session: async () => {
      if (!world) return later({ session, exp: Date.now() + 15 * 60_000 });
      const r = await api<{ session: string; exp: number }>(base, "/mock/session", {}, session);
      session = r.session;
      return r;
    },
    // The world's pay sheet: it covers the game (pause), the player taps
    // "Pay (test)", the sheet closes (resume). Here that's instant.
    purchase: async (productId: string) => {
      if (!world) throw fail("not_for_sale");
      pause.forEach((f) => f());
      try {
        return await api<{ purchaseId: string; productId: string }>(base, "/mock/purchase", { productId }, session);
      } finally {
        setTimeout(() => resume.forEach((f) => f()), 300);
      }
    },
    purchases: () => (world ? api<{ purchaseId: string; productId: string }[]>(base, "/mock/purchases", undefined, session) : later([])),
    submitScore: (n: number) => {
      const now = Date.now();
      if (now - lastScore < 20_000) return Promise.reject(fail("too_soon"));
      lastScore = now;
      best = Math.max(best, Math.floor(n));
      return later({ best, accepted: true });
    },
    leaderboard: () => {
      const rows = [...board, ...(best ? [{ name: player.name, score: best }] : [])]
        .sort((a, b) => b.score - a.score)
        .map((r, i) => ({ rank: i + 1, ...r }));
      const me = rows.find((r) => r.name === player.name);
      return later({ top: rows, me: me ? { rank: me.rank, label: `#${me.rank}`, score: me.score } : null });
    },
    onPurchase: () => () => {},
    onPause: sub(pause),
    onResume: sub(resume),
    match: matchApi ?? {
      create: notAvailable as () => Promise<VatarMatch>,
      join: notAvailable as () => Promise<VatarMatch>,
      quick: notAvailable as () => Promise<VatarMatch>,
      leave: () => later(null),
      current: () => later(null),
      onUpdate: () => () => {},
    },
  };
  window.Vatar = sdk;

  // Simulate the world pausing / resuming us from the dev console.
  (window as unknown as { mockVatarPause: () => void }).mockVatarPause = () => pause.forEach((f) => f());
  (window as unknown as { mockVatarResume: () => void }).mockVatarResume = () => resume.forEach((f) => f());
}
