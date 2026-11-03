// The sample layer (v4 Phase 8): recorded sounds from the asset CDN
// (tools/assets/sounds.mjs: CC0 only — Kenney's packs, Freesound's CC0, the
// Sonniss GDC bundles; never BBC Sound Effects), Opus at 48 kbps. A sample
// listed in the CDN's sfx/manifest.json takes over its synthesised sound
// (Sound.gunshot … and the world's loops, world.ts); with no CDN, offline, in
// the app or Lagos Life, everything stays synthesised as before.

// v4 rework: the site's own library (tools/audio/sfx.mjs, CC0 recordings) when no CDN is set; the
// EMILGO app's offline copy streams it from the game's site.
const LIB = __HOST_BUILD__ === "emilgo" ? "https://milgogames.pages.dev/lib" : `${import.meta.env.BASE_URL}lib`;
const base = ((import.meta.env.VITE_ASSET_CDN as string | undefined) ?? LIB).replace(/\/$/, "");
const buffers = new Map<string, AudioBuffer>();
let started = false;

/** Fetch and decode the listed samples once (after the first tap: decoding needs the context). */
export function loadSamples(ctx: BaseAudioContext): void {
  if (started || !base) return;
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
