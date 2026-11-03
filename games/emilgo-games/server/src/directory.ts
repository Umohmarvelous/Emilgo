// The room directory (v4 Phase 10): many game servers ("nodes"), one place
// that knows them. Each node is stateless between matches, holds its own
// rooms, and tells the directory how busy it is every 2 s. A phone asks the
// directory where to go before it connects:
//
//   GET  /dir/pick            → { url, shard }  quick play: the node with the most room
//   GET  /dir/pick?key=CODE   → the node holding that room or party code (its first
//                               letter is the node's shard)
//   GET  /dir/pick?key=v:ID   → a Lagos Life match: the same node for both players
//                               (rendezvous hashing over the live nodes)
//   POST /dir/beat            a node's heartbeat (Authorization: Bearer $DIR_SECRET)
//   GET  /dir/nodes           the live nodes and their load (for operators)
//
// A node that stops beating for 6 s is gone; one that is draining (a deploy)
// gets no new players and leaves when its last match ends. Nothing is stored:
// restart the directory and the nodes repopulate it within one beat.
//
// The 1M path (README §8): nodes × rooms. One node holds ~1,500–2,000 players
// in Free For All on one core (measured); 1M players is ~600 nodes behind one
// directory (a beat is ~200 bytes every 2 s: 60 KB/s at 600 nodes), and the
// directory itself can be replicated: it is a pure function of the last beats.

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";

export interface Beat {
  /** The node's shard letter (from NET.codeAlphabet): its room and party codes start with it. */
  shard: string;
  /** Its public WebSocket address (wss://…). */
  url: string;
  peers: number;
  /** Players it should hold at most. */
  cap: number;
  rooms: number;
  playing: number;
  tickP99: number;
  rssMb: number;
  draining: boolean;
}

interface Node extends Beat {
  seen: number;
  /** Players sent its way since its last beat (so a burst doesn't all land on one node). */
  sent: number;
}

const STALE_MS = 6000;
/** A node whose ticks run long is busy whatever its head count (60 Hz: 16.7 ms a step). */
const TICK_BUSY_MS = 12;

export class Directory {
  private readonly nodes = new Map<string, Node>();
  constructor(private readonly clock: () => number = Date.now) {}

  beat(b: Beat): void {
    const n = this.nodes.get(b.shard);
    if (n && n.url !== b.url && this.clock() - n.seen < STALE_MS) throw new Error(`shard ${b.shard} is taken by ${n.url}`);
    this.nodes.set(b.shard, { ...b, seen: this.clock(), sent: 0 });
  }

  live(): Node[] {
    const t = this.clock();
    for (const [k, n] of this.nodes) if (t - n.seen > STALE_MS * 10) this.nodes.delete(k);
    return [...this.nodes.values()].filter((n) => t - n.seen <= STALE_MS);
  }

  /** Where a phone should connect: for a code, its node; for a match id, the same node for everyone; else the one with the most room. */
  pick(key = ""): Node | null {
    const live = this.live();
    if (!live.length) return null;
    if (key.startsWith("v:")) {
      // Rendezvous hashing: the highest hash of (key, node) wins; a node leaving moves only its own keys.
      let best: Node | null = null;
      let bestH = -1;
      for (const n of live) {
        if (n.draining) continue;
        const h = createHash("sha1").update(`${key}|${n.shard}`).digest().readUInt32BE(0);
        if (h > bestH) (bestH = h), (best = n);
      }
      return best;
    }
    if (key) {
      const n = live.find((x) => x.shard === key[0]);
      return n ?? null;
    }
    let best: Node | null = null;
    let bestScore = Infinity;
    for (const n of live) {
      if (n.draining || n.peers + n.sent >= n.cap) continue;
      const score = (n.peers + n.sent) / n.cap + (n.tickP99 > TICK_BUSY_MS ? 1 : 0);
      if (score < bestScore) (bestScore = score), (best = n);
    }
    if (best) best.sent++;
    return best;
  }
}

/** The directory's HTTP routes (/dir/…); false if the request isn't one of them. */
export function directoryRoute(dir: Directory, req: IncomingMessage, res: ServerResponse, secret: string | undefined, origins: string[]): boolean {
  const url = new URL(req.url ?? "/", "http://local");
  if (!url.pathname.startsWith("/dir/")) return false;
  const origin = req.headers.origin ?? "";
  const cors: Record<string, string> = { "Cache-Control": "no-store", "Content-Type": "application/json" };
  if (!origins.length || origins.includes(origin)) cors["Access-Control-Allow-Origin"] = origins.length ? origin : "*";
  if (url.pathname === "/dir/pick" && req.method === "GET") {
    const key = (url.searchParams.get("key") ?? "").slice(0, 64);
    const n = dir.pick(key);
    if (!n) res.writeHead(503, cors).end(JSON.stringify({ error: key ? "not_found" : "full" }));
    else res.writeHead(200, cors).end(JSON.stringify({ url: n.url, shard: n.shard }));
    return true;
  }
  if (url.pathname === "/dir/nodes" && req.method === "GET") {
    const live = dir.live().map(({ shard, url: u, peers, cap, rooms, playing, tickP99, rssMb, draining }) => ({ shard, url: u, peers, cap, rooms, playing, tickP99, rssMb, draining }));
    res.writeHead(200, cors).end(JSON.stringify({ nodes: live, peers: live.reduce((s, n) => s + n.peers, 0) }));
    return true;
  }
  if (url.pathname === "/dir/beat" && req.method === "POST") {
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      res.writeHead(401).end();
      return true;
    }
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c;
      if (body.length > 4096) req.destroy();
    });
    req.on("end", () => {
      try {
        const b = JSON.parse(body) as Beat;
        if (typeof b.shard !== "string" || b.shard.length !== 1 || typeof b.url !== "string" || !/^wss?:\/\//.test(b.url)) throw new Error("bad beat");
        dir.beat({
          shard: b.shard,
          url: b.url,
          peers: Number(b.peers) || 0,
          cap: Math.max(1, Number(b.cap) || 1),
          rooms: Number(b.rooms) || 0,
          playing: Number(b.playing) || 0,
          tickP99: Number(b.tickP99) || 0,
          rssMb: Number(b.rssMb) || 0,
          draining: !!b.draining,
        });
        res.writeHead(204).end();
      } catch (e) {
        res.writeHead(400).end(String((e as Error).message));
      }
    });
    return true;
  }
  res.writeHead(404).end();
  return true;
}

/** A node's side: beat to the directory every 2 s (a failed beat is just tried again). */
export function startBeating(dirUrl: string, secret: string, beat: () => Beat): () => void {
  const send = () =>
    fetch(`${dirUrl.replace(/\/$/, "")}/dir/beat`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(beat()) }).then(
      (r) => {
        if (!r.ok) console.log(`directory beat refused: ${r.status}`);
      },
      () => {},
    );
  void send();
  const iv = setInterval(send, 2000);
  iv.unref();
  return () => {
    clearInterval(iv);
    void send();
  };
}
