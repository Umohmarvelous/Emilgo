// The server's clock: monotonic milliseconds since the process started.
// Clients only ever compare against it (offset + round trip), so the epoch
// doesn't matter — what matters is that it never jumps when the wall clock does.

import { performance } from "node:perf_hooks";

export function now(): number {
  return Math.round(performance.now());
}
