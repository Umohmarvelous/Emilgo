// Where the game server is, in order of precedence:
//
//   1. the host says so    EMILGO injects it (from EXPO_PUBLIC_GAMES_SERVER)
//   2. the build says so   VITE_GAMES_SERVER, set when building for Lagos Life
//   3. development         a page served over http from this machine or the
//                          LAN talks to ws://<same host>:8787
//
// Otherwise online play is unavailable and the button says so. A page served
// over https may only use wss:// — browsers block insecure sockets from secure
// pages — so in that case only a wss:// address is accepted.

export function serverUrl(hostProvided?: string | null): string | null {
  const candidates = [hostProvided, import.meta.env.VITE_GAMES_SERVER as string | undefined];
  for (const c of candidates) {
    const url = (c ?? "").trim();
    if (!url) continue;
    if (!/^wss?:\/\//.test(url)) continue;
    if (location.protocol === "https:" && url.startsWith("ws://")) continue;
    return url;
  }
  if (location.protocol === "http:" && isLocal(location.hostname)) {
    return `ws://${location.hostname}:8787`;
  }
  return null;
}

function isLocal(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}
