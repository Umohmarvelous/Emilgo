// Dev/test only: the room directory and N game-server nodes on this machine,
// the way production runs them on many (README §8). For the load test:
//
//   npm run server:build
//   node server/scripts/cluster.mjs 6            (directory :8800, nodes :8801–8806)
//   node server/dist/loadtest.mjs --clients 10000 --dir http://localhost:8800 --ffa find-the-flag,max-royale --procs 4
//
// Ctrl-C stops them all. Each node's log is in $LOGS (default /tmp/emilgo-cluster).

import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const N = Number(process.argv[2] ?? 4);
const BASE = Number(process.env.BASE_PORT ?? 8800);
const LOGS = process.env.LOGS ?? "/tmp/emilgo-cluster";
const CAP = process.env.NODE_CAP ?? "2000";
const SHARDS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
mkdirSync(LOGS, { recursive: true });
const secret = randomBytes(24).toString("hex");
const kids = [];
const run = (name, file, env) => {
  const out = openSync(join(LOGS, `${name}.log`), "w");
  const c = spawn(process.execPath, ["--enable-source-maps", file], { env: { ...process.env, ...env }, stdio: ["ignore", out, out] });
  c.on("exit", (code) => console.log(`${name} exited (${code})`));
  kids.push(c);
};

run("directory", "server/dist/directory.mjs", { PORT: String(BASE), DIR_SECRET: secret });
for (let i = 0; i < N; i++) {
  const port = BASE + 1 + i;
  mkdirSync(join(LOGS, `data-${i}`), { recursive: true });
  run(`node-${SHARDS[i]}`, "server/dist/index.mjs", {
    PORT: String(port),
    DIRECTORY: `http://localhost:${BASE}`,
    DIR_SECRET: secret,
    NODE_URL: `ws://localhost:${port}`,
    SHARD: SHARDS[i],
    NODE_CAP: CAP,
    MAX_PER_IP: "100000",
    DATA_DIR: join(LOGS, `data-${i}`),
  });
}
console.log(`cluster: directory :${BASE}, ${N} nodes :${BASE + 1}–${BASE + N} (cap ${CAP} each); logs in ${LOGS}`);
const stop = () => {
  for (const c of kids) c.kill("SIGINT");
  setTimeout(() => process.exit(0), 1500);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
