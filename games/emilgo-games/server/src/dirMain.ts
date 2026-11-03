// The room directory on its own (v4 Phase 10; directory.ts): a tiny HTTP
// service the game servers beat to and the phones ask where to connect.
//
//   PORT            default 8800
//   DIR_SECRET      the nodes' shared heartbeat secret (required)
//   GAMES_ORIGINS   comma-separated Origin headers allowed to ask (unset = all)

import { createServer } from "node:http";

import { Directory, directoryRoute } from "./directory";

const PORT = Number(process.env.PORT ?? 8800);
const SECRET = process.env.DIR_SECRET?.trim();
const ORIGINS = (process.env.GAMES_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (!SECRET) {
  console.error("DIR_SECRET is required");
  process.exit(1);
}

const dir = new Directory();
const http = createServer((req, res) => {
  if (req.url === "/health") return void res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
  if (directoryRoute(dir, req, res, SECRET, ORIGINS)) return;
  res.writeHead(404).end();
});
http.listen(PORT, () => console.log(`emilgo games directory on :${PORT}`));
const bye = () => http.close(() => process.exit(0));
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
