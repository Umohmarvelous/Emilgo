// Dead Streets' ghost runner (SPEC-V3 §3.4 #12): your best finished run's
// trace (t, x, z, floor once a second), kept on this phone, raced next time.

import type { Host } from "../platform/types";

const KEY = "emilgo.ds.ghost";

export function saveGhost(_host: Host, trace: readonly number[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(trace));
  } catch {
    // No storage (a private window): no ghost.
  }
}

export function loadGhost(): number[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return Array.isArray(v) && v.length >= 8 && v.every((x) => typeof x === "number") ? v : null;
  } catch {
    return null;
  }
}

/** Where the ghost is at `t` seconds (between its samples). */
export function ghostAt(trace: readonly number[], t: number): { x: number; z: number; h: number } | null {
  const n = trace.length / 4;
  if (n < 2 || t > trace[(n - 1) * 4]) return null;
  let i = 0;
  while (i < n - 2 && trace[(i + 1) * 4] < t) i++;
  const t0 = trace[i * 4];
  const t1 = trace[(i + 1) * 4];
  const u = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
  const at = (k: number) => trace[i * 4 + k] + (trace[(i + 1) * 4 + k] - trace[i * 4 + k]) * u;
  return { x: at(1), z: at(2), h: at(3) };
}
