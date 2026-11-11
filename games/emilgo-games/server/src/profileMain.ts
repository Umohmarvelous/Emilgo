// The profile service on its own (v6 max, 3.12: "Auth and profile: split").
// The one place a player's rank XP, wins, commends and streak live, for every
// node: nodes call it with the shared secret (HttpProfiles in profiles.ts);
// phones never do (a node checks who they are first). SQLite on its own volume,
// the same table the single-node server keeps (profiles.ts), so moving from one
// to the other is copying profiles.db.
//
//   GET    /v1/profiles/<key>            the profile (404: none yet)
//   POST   /v1/profiles/<key>/award      { xp, won, day }: a match's XP
//   POST   /v1/profiles/<key>/commend    one more commend
//   DELETE /v1/profiles/<key>            gone (Vatar Developer Agreement §8.2(e))
//   GET    /health
//
//   PORT              default 8810
//   SERVICE_SECRET    the nodes' shared secret (required)
//   DATA_DIR          where profiles.db lives (default ./data)

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { SqliteProfiles } from "./profiles";

const PORT = Number(process.env.PORT ?? 8810);
const SECRET = process.env.SERVICE_SECRET?.trim();
if (!SECRET || SECRET.length < 16) {
  console.error("SERVICE_SECRET (16 characters or more) is required");
  process.exit(1);
}
const profiles = new SqliteProfiles(`${process.env.DATA_DIR ?? "./data"}/profiles.db`);

function authorised(req: IncomingMessage): boolean {
  const want = Buffer.from(`Bearer ${SECRET}`);
  const got = Buffer.from(req.headers.authorization ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 4096) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        resolve(v && typeof v === "object" ? v : {});
      } catch {
        resolve({});
      }
    });
  });
}

const KEY = /^(ll:(test|live):[^\s/]{1,120}|em:[0-9a-f]{40})$/;

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = (status: number, v?: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(v === undefined ? "" : JSON.stringify(v));
  };
  if (req.url === "/health") return void res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
  if (!authorised(req)) return send(401, { error: "unauthorised" });
  const m = /^\/v1\/profiles\/([^/]+)(\/award|\/commend)?$/.exec(req.url ?? "");
  if (!m) return send(404, { error: "not_found" });
  const key = decodeURIComponent(m[1]);
  if (!KEY.test(key)) return send(400, { error: "bad_key" });
  if (req.method === "GET" && !m[2]) {
    const p = profiles.get(key);
    return p ? send(200, p) : send(404, { error: "none" });
  }
  if (req.method === "DELETE" && !m[2]) return send(200, { gone: profiles.remove(key) });
  if (req.method === "POST" && m[2] === "/award") {
    const b = await body(req);
    const xp = Number(b.xp);
    const day = typeof b.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : null;
    // A match pays at most a few thousand XP (rank/xp.ts): anything wild is refused, not stored.
    if (!Number.isFinite(xp) || xp < 0 || xp > 5000 || typeof b.won !== "boolean" || !day) return send(400, { error: "bad_award" });
    return send(200, profiles.award(key, xp, b.won, day));
  }
  if (req.method === "POST" && m[2] === "/commend") {
    profiles.commend(key);
    return send(200, profiles.get(key));
  }
  send(405, { error: "method" });
}

const http = createServer((req, res) => {
  route(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500).end();
  });
});
http.listen(PORT, () => console.log(`emilgo games profiles on :${PORT}`));
const bye = () =>
  http.close(() => {
    profiles.close();
    process.exit(0);
  });
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
