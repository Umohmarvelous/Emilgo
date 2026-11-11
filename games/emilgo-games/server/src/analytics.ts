// Analytics (v6 max, 3.12: "new, write-only, batched: never on a match's
// path"). Counts of what happens, with nothing that says who: no player ids,
// no names, no addresses, no device data (Vatar Developer Agreement §8; the
// EMILGO app's privacy policy). An event is pushed onto an array (that's all a
// match ever does); every 10 s the batch goes out as JSON lines:
//
//   ANALYTICS_URL set     POSTed there (Authorization: Bearer ANALYTICS_TOKEN):
//                         any collector that takes NDJSON (a Worker, BigQuery's
//                         streaming endpoint behind one, Tinybird, Axiom…)
//   unset                 appended to DATA_DIR/analytics-YYYY-MM-DD.ndjson
//
// A batch that can't be sent is dropped after one retry: counts, not records.

import { appendFile, mkdir } from "node:fs/promises";

export type Props = Record<string, string | number | boolean>;

/** Keys that must never be sent, whatever a caller passes. */
const NEVER = /^(id|ids|name|names|player|playerid|seat|fid|key|profile|ip|email|phone|token|session)$/i;

export class Analytics {
  private batch: string[] = [];
  private retry: string[] | null = null;
  /** The batch in `retry` already failed once: if it fails again, it goes. */
  private failedOnce = false;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly sink: { url: string; token: string } | { dir: string },
    private readonly node: string,
    everyMs = 10_000,
  ) {
    this.timer = setInterval(() => void this.flush(), everyMs);
    this.timer.unref();
  }

  /** Something happened (cheap: one small string onto an array). */
  track(event: string, props: Props = {}): void {
    if (this.batch.length >= 50_000) return;
    const clean: Props = {};
    for (const [k, v] of Object.entries(props)) if (!NEVER.test(k) && (typeof v !== "string" || v.length <= 64)) clean[k] = v;
    this.batch.push(JSON.stringify({ e: event, t: Date.now(), n: this.node, ...clean }));
  }

  async flush(): Promise<void> {
    const lines = [...(this.retry ?? []), ...this.batch];
    this.retry = null;
    this.batch = [];
    if (!lines.length) return;
    const body = `${lines.join("\n")}\n`;
    try {
      if ("url" in this.sink) {
        const res = await fetch(this.sink.url, { method: "POST", headers: { "Content-Type": "application/x-ndjson", Authorization: `Bearer ${this.sink.token}` }, body, signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(String(res.status));
      } else {
        await mkdir(this.sink.dir, { recursive: true });
        await appendFile(`${this.sink.dir}/analytics-${new Date().toISOString().slice(0, 10)}.ndjson`, body);
      }
      this.failedOnce = false;
    } catch {
      // Once more next time, then let it go.
      if (!this.failedOnce) this.retry = lines.slice(-20_000);
      this.failedOnce = !this.failedOnce;
    }
  }

  close(): Promise<void> {
    clearInterval(this.timer);
    return this.flush();
  }
}

export function analyticsFromEnv(env: NodeJS.ProcessEnv, node: string): Analytics {
  const url = env.ANALYTICS_URL?.trim();
  return new Analytics(url ? { url, token: env.ANALYTICS_TOKEN?.trim() ?? "" } : { dir: env.DATA_DIR ?? "./data" }, node);
}
