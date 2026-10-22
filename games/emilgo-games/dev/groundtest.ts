// Dev only: are everyone's feet on the ground? Not in any build.
//
// Builds people in every outfit, hair and tier, plays every state (idle, walk,
// run, sprint, crouch, prone, emotes, lobby poses, the fall, the cheer),
// skins every vertex on the CPU and measures the lowest point of the body.
//   grounded states: the lowest point must sit within ±1 cm of the ground
//                    (gait: the planted foot over a stride)
//   any state:       nothing may sink below −1 cm
// Results land in window.__ground and on the page.
//   /dev/groundtest.html?tier=0|1|2 (default: all)
import { Vector3 } from "three";

import { MOVE } from "../src/config";
import { EMOTE_IDS } from "../src/social/emotes";
import { Human, nearDetail, type Tier } from "../src/world/human";
import { POSES } from "../src/world/human/animator";
import { HAIRS, OUTFITS, OUTFIT_BY_ID, cleanLook, uniformLook, type ExtraId, type HairId, type Look } from "../src/world/human/wardrobe";

const q = new URLSearchParams(location.search);
const tiers: Tier[] = q.get("tier") ? [Number(q.get("tier")) as Tier] : [0, 1, 2];
const out = document.getElementById("out")!;
const v = new Vector3();

/** Lowest skinned vertex (world y). */
function lowest(h: Human): number {
  h.mesh.updateMatrixWorld(true);
  const pos = h.mesh.geometry.attributes.position;
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) {
    // Already in world space: the skin is detached and bound at identity, and
    // the bones hang from the mesh, so their world matrices carry its transform.
    h.mesh.getVertexPosition(i, v);
    if (v.y < min) min = v.y;
  }
  return min;
}

interface Row { state: string; look: string; tier: Tier; min: number; maxMin: number; ok: boolean; why: string }
const rows: Row[] = [];
const tris: Record<string, number[]> = {};

type Run = { state: string; frames: number; dt: number; grounded: "always" | "stride" | "none"; setup?: (h: Human) => void; speed?: number; stance?: number; air?: number };
const RUNS: Run[] = [
  { state: "idle", frames: 90, dt: 1 / 30, grounded: "always", speed: 0 },
  { state: "walk", frames: 60, dt: 1 / 30, grounded: "always", speed: MOVE.walk },
  { state: "run", frames: 60, dt: 1 / 30, grounded: "stride", speed: MOVE.run },
  { state: "sprint", frames: 60, dt: 1 / 30, grounded: "stride", speed: MOVE.sprint },
  { state: "crouch", frames: 45, dt: 1 / 30, grounded: "always", speed: 0, stance: 1 },
  { state: "crouch-walk", frames: 60, dt: 1 / 30, grounded: "always", speed: MOVE.crouch, stance: 1 },
  { state: "prone", frames: 45, dt: 1 / 30, grounded: "always", speed: 0, stance: 2 },
  { state: "prone-crawl", frames: 60, dt: 1 / 30, grounded: "always", speed: MOVE.prone, stance: 2 },
  { state: "air", frames: 20, dt: 1 / 30, grounded: "none", speed: 0, air: 1 },
  ...EMOTE_IDS.map((e): Run => ({ state: `emote:${e}`, frames: 66, dt: 1 / 30, grounded: "always", speed: 0, setup: (h) => h.emote(e) })),
  ...POSES.map((p): Run => ({ state: `pose:${p.id}`, frames: 60, dt: 1 / 30, grounded: "always", speed: 0, setup: (h) => h.setPose(p.id) })),
  ...(["fist", "slap", "push", "grab"] as const).map((id): Run => ({ state: `act:${id}`, frames: 18, dt: 1 / 30, grounded: "always", speed: 0, setup: (h) => h.act(id) })),
  { state: "carry-run", frames: 60, dt: 1 / 30, grounded: "stride", speed: MOVE.run, setup: (h) => h.setCarry(true) },
  { state: "hit", frames: 18, dt: 1 / 30, grounded: "always", speed: 0, setup: (h) => h.hit(0.7) },
  // The three falls (ragdoll.ts picks one by the person's seed), forward-ish and straight back.
  ...([["thrown", 0], ["spin", 0.04], ["crumple", 0.07]] as const).flatMap(([kind, seed]) =>
    [0.4, Math.PI].map((dir): Run => ({ state: `fallen:${kind}${dir > 1 ? "-back" : ""}`, frames: 120, dt: 1 / 30, grounded: "always", speed: 0, setup: (h) => {
      h.anim.seed = seed;
      h.kill(dir);
    } })),
  ),
  // The cheer is a deliberate hop: it must come back down onto the ground.
  { state: "cheer", frames: 60, dt: 1 / 30, grounded: "stride", speed: 0, setup: (h) => h.finish() },
];

function looksFor(): Look[] {
  const hairs: HairId[] = q.get("tris") ? ["afro", "braids", "locs", "ponytail"] : ["afro", "bun", "lowcut", "braids"];
  const own = OUTFITS.map((o, i) => cleanLook({ body: o.fits ?? (i % 2 ? "f" : "m"), skin: i % 8, hair: hairs[i % hairs.length], outfit: o.id, extras: [], height: i % 3 === 0 ? 0.95 : i % 3 === 1 ? 1 : 1.05 }));
  return [...own, uniformLook(own[0], 7), uniformLook(own[1], 12)];
}

/** ?tris=1: triangle counts per detail level only (fast). */
function trisOnly(): void {
  const by: Record<string, { min: number; max: number; worst: string }> = {};
  // Every outfit × every hair, bare and with the heaviest extras.
  const all: Look[] = [];
  for (const o of [...OUTFITS, OUTFIT_BY_ID.uniform])
    for (const hr of HAIRS)
      for (const extras of [[], ["gele", "earrings", "watch", "glasses"], ["headset", "shades", "earrings", "watch"]] as ExtraId[][])
        for (const body of ["m", "f"] as const) all.push(cleanLook({ body, skin: 1, hair: hr.id, outfit: o.id, extras, height: 1 }));
  for (const look of all) {
    const h = new Human(look, 2, { seed: 1 });
    for (const lvl of [0, 1, 2, 3] as const) {
      h.setDetail(lvl);
      const e = (by[`level${lvl}`] ??= { min: Infinity, max: 0, worst: "" });
      e.min = Math.min(e.min, h.triangles);
      if (h.triangles > e.max) {
        e.max = h.triangles;
        e.worst = `${look.outfit}/${look.body}/${look.hair}/${look.extras.join("+")}`;
      }
    }
    h.dispose();
  }
  (window as unknown as { __ground: unknown }).__ground = by;
  out.textContent = JSON.stringify(by, null, 1);
}

async function main(): Promise<void> {
  if (q.get("tris")) return trisOnly();
  const t0 = performance.now();
  for (const tier of tiers) {
    for (const look of looksFor()) {
      const name = `${look.outfit}/${look.body}/${look.hair}/h${look.height}`;
      for (const run of RUNS) {
        const h = new Human(look, tier, { seed: 1.3 });
        (tris[`t${tier}`] ??= []).push(h.triangles);
        for (const lvl of [0, 1, 2, 3] as const) {
          h.setDetail(lvl);
          (tris[`level${lvl}`] ??= []).push(h.triangles);
        }
        h.setDetail(nearDetail(tier));
        const oneOff = run.state.startsWith("act:") || run.state === "hit";
        if (!oneOff) run.setup?.(h);
        // Settle into the state first (stance and air blend in).
        for (let i = 0; i < 20; i++) h.update(1 / 30, run.speed ?? 0, run.stance ?? 0, run.air ?? 0);
        if (oneOff) run.setup?.(h);
        let min = Infinity;
        let maxMin = -Infinity;
        for (let f = 0; f < run.frames; f++) {
          h.update(run.dt, run.speed ?? 0, run.stance ?? 0, run.air ?? 0);
          const m = lowest(h);
          min = Math.min(min, m);
          maxMin = Math.max(maxMin, m);
        }
        h.dispose();
        let ok = min > -0.01;
        let why = ok ? "" : `sinks ${(min * 100).toFixed(1)} cm`;
        if (run.grounded === "always" && maxMin > 0.01) {
          ok = false;
          why += `${why ? "; " : ""}floats up to ${(maxMin * 100).toFixed(1)} cm`;
        }
        if (run.grounded === "stride" && min > 0.01) {
          ok = false;
          why += `${why ? "; " : ""}never touches (${(min * 100).toFixed(1)} cm)`;
        }
        rows.push({ state: run.state, look: name, tier, min, maxMin, ok, why });
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const bad = rows.filter((r) => !r.ok);
  const triSummary = Object.fromEntries(Object.entries(tris).map(([k, a]) => [k, { min: Math.min(...a), max: Math.max(...a), avg: Math.round(a.reduce((s, x) => s + x, 0) / a.length) }]));
  const byState: Record<string, { n: number; worstSink: number; worstFloat: number }> = {};
  for (const r of rows) {
    const s = (byState[r.state] ??= { n: 0, worstSink: 0, worstFloat: 0 });
    s.n++;
    s.worstSink = Math.min(s.worstSink, Math.round(r.min * 1000) / 10);
    s.worstFloat = Math.max(s.worstFloat, Math.round(r.maxMin * 1000) / 10);
  }
  const result = { checks: rows.length, failed: bad.length, ms: Math.round(performance.now() - t0), triangles: triSummary, byState, worst: bad.slice(0, 40).map((r) => `t${r.tier} ${r.state} ${r.look}: ${r.why}`) };
  (window as unknown as { __ground: unknown }).__ground = result;
  out.textContent = JSON.stringify(result, null, 1);
}

void main();
