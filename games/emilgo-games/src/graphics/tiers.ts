// Graphics tiers (SPEC-V2 §6.3): what Low, Medium and High switch on.
//
//            characters   props   textures  shadows    sky
//   Low      ~2,000 tris  1,000   256       none       static skybox, scrolling 2D clouds
//   Medium   ~3,500 tris  1,500   512       basic      scrolling 2D clouds
//   High     ~5,000 tris  2,500   1024      full       post-processing, volumetric clouds
//
// No heat shimmer, dust, wind or light shafts on any tier (SPEC-V2 §5.3, §10).
//
// "Auto" picks from the device, then the resolution governor (core/quality)
// keeps the frame rate by moving the render scale.

import { lowEnd } from "../core/quality";
import type { GraphicsTier } from "../settings";

export type Tier = 0 | 1 | 2;

export interface TierSpec {
  tier: Tier;
  name: "Low" | "Medium" | "High";
  shadows: boolean;
  shadowSize: number;
  /** Particles budget multiplier (rain). */
  particles: number;
  /** Lobby background blur (depth of field). */
  dof: boolean;
  /** High only: post-processing, volumetric clouds. */
  fancy: boolean;
  /** Standard (PBR) materials; Low uses Lambert. */
  pbr: boolean;
  /** Highest pixel ratio the governor may reach. */
  maxPixelRatio: number;
  /** Visible distance (fog end), metres. */
  far: number;
}

const SPECS: TierSpec[] = [
  { tier: 0, name: "Low", shadows: false, shadowSize: 0, particles: 0.35, dof: false, fancy: false, pbr: false, maxPixelRatio: 1.25, far: 150 },
  { tier: 1, name: "Medium", shadows: true, shadowSize: 1024, particles: 0.75, dof: true, fancy: false, pbr: true, maxPixelRatio: 1.75, far: 220 },
  { tier: 2, name: "High", shadows: true, shadowSize: 2048, particles: 1, dof: true, fancy: true, pbr: true, maxPixelRatio: 2, far: 300 },
];

/** What Auto would pick on this device. */
export function autoTier(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): Tier {
  if (lowEnd()) return 0;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints ?? 0) > 1;
  let gpu = "";
  try {
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch {
    /* hidden */
  }
  // Older mobile GPUs: Medium at most.
  if (/Adreno \(TM\) [3-5]\d\d|Mali-[TG][0-7]\d|PowerVR|SwiftShader/i.test(gpu)) return /SwiftShader/i.test(gpu) ? 0 : 1;
  if (mobile) return /Apple GPU|Adreno \(TM\) [6-9]\d\d|Mali-G7[1-9]|Mali-G[89]\d|Immortalis|Xclipse/i.test(gpu) ? 1 : 1;
  return 2;
}

export function tierSpec(setting: GraphicsTier, gl?: WebGLRenderingContext | WebGL2RenderingContext | null): TierSpec {
  const t: Tier = setting === "low" ? 0 : setting === "medium" ? 1 : setting === "high" ? 2 : autoTier(gl);
  return SPECS[t];
}
