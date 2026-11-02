// Dev only (concept renders): the "Max Mode" look — what High+ would draw on
// a strong phone or a computer. A scene goes through:
//
//   render (HDR, 4× MSAA) → GTAO (ambient occlusion) → god rays (screen-space
//   light shafts from the sun) → depth of field (aiming) → bloom → ACES tone
//   map → grade (contrast, split tone, saturation, vignette, grain, a touch of
//   chromatic aberration)
//
// Each step can be switched off, so the same scene can be shown as Low,
// Medium, High and Max side by side (the "tiers" render).

import {
  ACESFilmicToneMapping,
  Color,
  EquirectangularReflectionMapping,
  HalfFloatType,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export const q = new URLSearchParams(location.search);
export const W = Number(q.get("w") ?? 1600);
export const H = Number(q.get("h") ?? 900);

export interface Look {
  exposure: number;
  /** AO strength 0…1 (0 = off). */
  ao: number;
  bloom: [strength: number, radius: number, threshold: number];
  /** Depth of field: focus distance (m), aperture; null = off. */
  dof: [number, number] | null;
  /** God rays: the sun's world position, strength (0 = off). */
  rays: { sun: Vector3; strength: number; color?: [number, number, number] } | null;
  /** Grade: display-space. */
  contrast: number;
  saturation: number;
  /** Shadows pushed toward this colour, highlights toward that one (0…1 each), amount. */
  split: { shadow: [number, number, number]; high: [number, number, number]; amount: number };
  vignette: number;
  grain: number;
  /** Chromatic aberration at the edges, in pixels at 1600 wide. */
  ca: number;
}

export const LOOK: Look = {
  exposure: 1,
  ao: 0.8,
  bloom: [0.55, 0.5, 0.85],
  dof: null,
  rays: null,
  contrast: 1.08,
  saturation: 1.05,
  split: { shadow: [0.1, 0.18, 0.26], high: [1.0, 0.86, 0.68], amount: 0.12 },
  vignette: 0.38,
  grain: 0.035,
  ca: 0.8,
};

export const renderer = new WebGLRenderer({ canvas: document.getElementById("c") as HTMLCanvasElement, antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

const pmrem = new PMREMGenerator(renderer);
const hdrCache = new Map<string, Promise<Texture>>();

/** A Poly Haven sky (CC0) from the cache folder: [background texture, environment map]. */
export function hdri(name: string): Promise<Texture> {
  let p = hdrCache.get(name);
  if (!p) {
    p = new HDRLoader().loadAsync(`/dev/concepts/.cache/hdri/${name}.hdr`).then((t) => {
      t.mapping = EquirectangularReflectionMapping;
      return t;
    });
    hdrCache.set(name, p);
  }
  return p;
}

export async function useSky(scene: Scene, name: string, opts: { background?: boolean; blur?: number; intensity?: number; bgIntensity?: number; rotation?: number } = {}): Promise<void> {
  const t = await hdri(name);
  const env = pmrem.fromEquirectangular(t).texture;
  scene.environment = env;
  scene.environmentIntensity = opts.intensity ?? 1;
  if (opts.rotation) {
    scene.environmentRotation.y = opts.rotation;
    scene.backgroundRotation.y = opts.rotation;
  }
  if (opts.background !== false) {
    scene.background = t;
    scene.backgroundBlurriness = opts.blur ?? 0;
    scene.backgroundIntensity = opts.bgIntensity ?? 1;
  }
}

export function useRoom(scene: Scene, intensity = 0.6): void {
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = intensity;
}

export function camera(fov = 35, near = 0.05, far = 4000): PerspectiveCamera {
  return new PerspectiveCamera(fov, W / H, near, far);
}

// ── Post ─────────────────────────────────────────────────────────────────────

const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    sun: { value: new Vector2(0.5, 0.5) },
    strength: { value: 0.5 },
    tint: { value: new Vector3(1, 0.9, 0.75) },
    aspect: { value: W / H },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 sun; uniform float strength; uniform vec3 tint; uniform float aspect;
    varying vec2 vUv;
    float bright(vec2 uv) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      return smoothstep(1.1, 3.5, l);
    }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - sun) / 72.0;
      vec2 uv = vUv;
      float acc = 0.0; float w = 1.0;
      for (int i = 0; i < 72; i++) { uv -= d; acc += bright(uv) * w; w *= 0.972; }
      vec2 dd = (vUv - sun) * vec2(aspect, 1.0);
      float fall = exp(-dot(dd, dd) * 1.6);
      gl_FragColor = vec4(base.rgb + tint * acc / 72.0 * strength * 1.2 * fall, base.a);
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    contrast: { value: 1 },
    saturation: { value: 1 },
    shadowTint: { value: new Vector3() },
    highTint: { value: new Vector3(1, 1, 1) },
    split: { value: 0 },
    vignette: { value: 0.3 },
    grain: { value: 0.03 },
    ca: { value: 0.001 },
    seed: { value: Math.random() },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float contrast, saturation, split, vignette, grain, ca, seed;
    uniform vec3 shadowTint, highTint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed * 43.0) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * ca * r2 * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col = mix(col, col * mix(shadowTint * 2.0, highTint, smoothstep(0.0, 0.8, l)), split);
      col *= 1.0 - vignette * smoothstep(0.08, 0.62, r2 * 1.6);
      col += (h(vUv * 1000.0) - 0.5) * grain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export interface Shot {
  scene: Scene;
  cam: PerspectiveCamera;
  look?: Partial<Look>;
  /** Draw with no post at all (the Low tier), straight to the screen. */
  raw?: boolean;
}

export function draw({ scene, cam, look: lk, raw }: Shot): void {
  const L: Look = { ...LOOK, ...lk };
  if (q.has("noao")) L.ao = 0;
  if (q.has("raw")) raw = true;
  renderer.toneMappingExposure = L.exposure;
  cam.aspect = W / H;
  cam.updateProjectionMatrix();
  if (raw) {
    renderer.setRenderTarget(null);
    renderer.render(scene, cam);
    return;
  }
  const rt = new WebGLRenderTarget(W, H, { type: HalfFloatType, samples: 4 });
  const fx = new EffectComposer(renderer, rt);
  fx.setPixelRatio(1);
  fx.setSize(W, H);
  fx.addPass(new RenderPass(scene, cam));
  if (L.ao > 0) {
    const ao = new GTAOPass(scene, cam, W, H);
    ao.blendIntensity = L.ao;
    ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.4, thickness: 1, scale: 1, samples: 16 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    fx.addPass(ao);
  }
  if (L.rays && L.rays.strength > 0) {
    const p = L.rays.sun.clone().project(cam);
    const pass = new ShaderPass(new ShaderMaterial(GodRaysShader as never));
    pass.uniforms.sun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    pass.uniforms.strength.value = L.rays.strength;
    if (L.rays.color) pass.uniforms.tint.value.set(...L.rays.color);
    fx.addPass(pass);
  }
  if (L.dof) {
    fx.addPass(new BokehPass(scene, cam, { focus: L.dof[0], aperture: L.dof[1], maxblur: 0.012 }));
  }
  if (L.bloom[0] > 0) fx.addPass(new UnrealBloomPass(new Vector2(W, H), L.bloom[0], L.bloom[1], L.bloom[2]));
  fx.addPass(new OutputPass());
  const g = new ShaderPass(new ShaderMaterial(GradeShader as never));
  g.uniforms.contrast.value = L.contrast;
  g.uniforms.saturation.value = L.saturation;
  g.uniforms.shadowTint.value.set(...L.split.shadow);
  g.uniforms.highTint.value.set(...L.split.high);
  g.uniforms.split.value = L.split.amount;
  g.uniforms.vignette.value = L.vignette;
  g.uniforms.grain.value = L.grain;
  g.uniforms.ca.value = (L.ca / 1600) * 2;
  fx.addPass(g);
  fx.render();
}

/** Tell the screenshot driver the frame is ready. */
export function done(info: Record<string, unknown> = {}): void {
  (window as unknown as { __done: unknown }).__done = { ok: true, ...info };
}

export function fail(e: unknown): void {
  console.error(e);
  (window as unknown as { __done: unknown }).__done = { ok: false, error: String((e as Error)?.stack ?? e) };
}

export const bg = (scene: Scene, hex: number) => {
  scene.background = new Color(hex);
};
