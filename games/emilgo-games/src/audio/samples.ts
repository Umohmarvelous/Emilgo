// The sample layer (v4 Phase 8): recorded sounds from the asset CDN
// (tools/assets/sounds.mjs: CC0 only — Kenney's packs, Freesound's CC0, the
// Sonniss GDC bundles; never BBC Sound Effects), Opus at 48 kbps. A sample
// listed in the CDN's sfx/manifest.json takes over its synthesised sound
// (Sound.gunshot … and the world's loops, world.ts); with no CDN, offline, in
// the app or Lagos Life, everything stays synthesised as before.

const base = ((import.meta.env.VITE_ASSET_CDN as string | undefined) ?? "").replace(/\/$/, "");
const buffers = new Map<string, AudioBuffer>();
let started = false;

/** Fetch and decode the listed samples once (after the first tap: decoding needs the context). */
export function loadSamples(ctx: BaseAudioContext): void {
  if (started || !/^https?:\/\//.test(base)) return;
  started = true;
  void fetch(`${base}/sfx/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then(async (m: { sounds?: Record<string, string> } | null) => {
      for (const [name, file] of Object.entries(m?.sounds ?? {})) {
        try {
          const data = await (await fetch(`${base}/sfx/${file}`)).arrayBuffer();
          buffers.set(name, await ctx.decodeAudioData(data));
        } catch {
          /* that one stays synthesised */
        }
      }
    })
    .catch(() => {});
}

/** A loaded sample by name ("gun-rifle", "loop-turbine" …), or null. */
export function sampleBuffer(name: string): AudioBuffer | null {
  return buffers.get(name) ?? null;
}
