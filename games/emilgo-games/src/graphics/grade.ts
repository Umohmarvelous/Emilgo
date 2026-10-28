// The film look (the owner, 28 Oct 2026): every place graded like a war
// film's scene, warm, each with its own colour adjustments. One system, a look
// per environment, on every tier:
//
//   Low     no extra pass: the look reaches the lights (their colour pushed
//           towards its white balance), the exposure, and a vignette drawn
//           over the canvas by the page (a CSS gradient, free on a phone)
//   Medium  one grade pass: the scene into a target, graded, vignetted,
//           tone mapped, to the screen
//   High    the post chain (graphics/post.ts): bloom, the same grade, grain
//
// A look's numbers are small on purpose: the scene must still read as itself.

import {
  Color,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Light,
  type Object3D,
  type WebGLRenderer,
} from "three";

import type { Tier } from "./tiers";

export interface GradeLook {
  /** Tone mapping exposure. */
  exposure: number;
  /** White balance: −1 cool … +1 warm. */
  temp: number;
  /** −1 green … +1 magenta. */
  tint: number;
  /** 1 = as is. */
  contrast: number;
  saturation: number;
  /** Colour pushed into the shadows (linear, added) and the highlights (multiplied). */
  lift: [number, number, number];
  gain: [number, number, number];
  /** 0 … 1. */
  vignette: number;
  /** High only: film grain, 0 … 1. */
  grain: number;
}

/** The looks, by environment. */
export const LOOKS = {
  /** Naija World: Harmattan afternoon. Dusty amber, soft blacks lifted towards brown, the sky's blue held back. */
  naija: { exposure: 1.0, temp: 0.55, tint: 0.05, contrast: 1.1, saturation: 0.92, lift: [0.012, 0.006, 0.0], gain: [1.04, 1.0, 0.92], vignette: 0.38, grain: 0.35 },
  /** Spooky World: cold moonlight with a sick green in the shadows. */
  spooky: { exposure: 0.95, temp: -0.45, tint: -0.15, contrast: 1.18, saturation: 0.75, lift: [0.0, 0.008, 0.012], gain: [0.95, 1.0, 1.05], vignette: 0.55, grain: 0.45 },
  /** Red Light, Green Light by day: warm, clean, a touch of contrast. */
  day: { exposure: 1.05, temp: 0.3, tint: 0.0, contrast: 1.08, saturation: 1.02, lift: [0.006, 0.003, 0.0], gain: [1.02, 1.0, 0.96], vignette: 0.3, grain: 0.25 },
  /** Sunset and sunrise: golden, the shadows towards plum. */
  golden: { exposure: 1.05, temp: 0.7, tint: 0.1, contrast: 1.1, saturation: 1.05, lift: [0.01, 0.0, 0.01], gain: [1.06, 0.99, 0.9], vignette: 0.36, grain: 0.25 },
  /** Night: teal shadows, warm lamps (the gain keeps them warm). */
  night: { exposure: 1.05, temp: -0.25, tint: 0.0, contrast: 1.12, saturation: 0.9, lift: [0.0, 0.006, 0.012], gain: [1.05, 1.0, 0.94], vignette: 0.45, grain: 0.35 },
  /** Rain: grey-green, low saturation. */
  rain: { exposure: 1.02, temp: -0.1, tint: -0.08, contrast: 1.06, saturation: 0.82, lift: [0.004, 0.006, 0.006], gain: [1.0, 1.0, 0.98], vignette: 0.4, grain: 0.3 },
  /** The lobby's golden-hour street. */
  lobby: { exposure: 1.05, temp: 0.5, tint: 0.05, contrast: 1.08, saturation: 1.0, lift: [0.008, 0.004, 0.0], gain: [1.04, 1.0, 0.94], vignette: 0.42, grain: 0.2 },
} satisfies Record<string, GradeLook>;

export type LookId = keyof typeof LOOKS;

/** A Red Light, Green Light map's look from its sky. */
export function lookForSky(time: string, weather: string): LookId {
  if (weather === "rain") return "rain";
  if (time === "night") return "night";
  if (time === "sunset" || time === "sunrise") return "golden";
  return "day";
}

/** The white balance as an RGB multiplier (temp warm → more red, less blue; tint → magenta/green). */
export function balance(look: GradeLook, out = new Vector3()): Vector3 {
  const t = look.temp * 0.08;
  const g = look.tint * 0.04;
  return out.set(1 + t + g * 0.5, 1 - g, 1 - t * 1.2 + g * 0.5);
}

/** The grade in GLSL: `c` linear HDR in, linear out (tone mapping after). */
export const GRADE_GLSL = /* glsl */ `
  uniform vec3 uBalance; uniform float uContrast; uniform float uSat; uniform vec3 uLift; uniform vec3 uGain;
  uniform float uVignette; uniform float uGrain; uniform float uTime;
  vec3 gradeColor(vec3 c, vec2 uv) {
    c *= uBalance;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    // Contrast about middle grey, in a log-ish space so the highlights don't clip.
    c = pow(max(c, 0.0) / 0.18, vec3(uContrast)) * 0.18;
    c = c * uGain + uLift * (1.0 - clamp(l * 4.0, 0.0, 1.0));
    vec2 d = uv - 0.5;
    c *= 1.0 - dot(d, d) * uVignette * 1.6;
    if (uGrain > 0.0) {
      float n = fract(sin(dot(uv * 1000.0 + uTime * 61.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c *= 1.0 + n * uGrain * 0.06;
    }
    return c;
  }`;

/** The uniforms GRADE_GLSL reads, filled from a look. */
export function gradeUniforms(): Record<string, { value: unknown }> {
  return {
    uBalance: { value: new Vector3(1, 1, 1) },
    uContrast: { value: 1 },
    uSat: { value: 1 },
    uLift: { value: new Vector3() },
    uGain: { value: new Vector3(1, 1, 1) },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uTime: { value: 0 },
  };
}

export function applyLook(u: Record<string, { value: unknown }>, look: GradeLook, grain: boolean): void {
  balance(look, u.uBalance.value as Vector3);
  u.uContrast.value = look.contrast;
  u.uSat.value = look.saturation;
  (u.uLift.value as Vector3).set(...look.lift);
  (u.uGain.value as Vector3).set(...look.gain);
  u.uVignette.value = look.vignette;
  u.uGrain.value = grain ? look.grain : 0;
}

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * Low: push a scene's lights towards the look's white balance, once, when the
 * place is built. Remembers each light's own colour, so a new look starts from it.
 */
export function gradeLights(root: Object3D, look: GradeLook): void {
  const b = balance(look);
  root.traverse((o) => {
    const l = o as Light & { userData: { ownColor?: Color } };
    if (!(l as { isLight?: boolean }).isLight || !l.color) return;
    l.userData.ownColor ??= l.color.clone();
    l.color.copy(l.userData.ownColor).multiply(new Color(b.x, b.y, b.z));
  });
}

/** Medium's one pass (High uses graphics/post.ts with the same grade). */
export class Grade {
  private readonly scene = new Scene();
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  private readonly mat: ShaderMaterial;
  private readonly size = new Vector2();
  private look: GradeLook = LOOKS.day;

  constructor(private readonly tier: Tier) {
    this.mat = new ShaderMaterial({
      uniforms: { tMap: { value: null }, ...gradeUniforms() },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap; varying vec2 vUv;
        ${GRADE_GLSL}
        void main() {
          gl_FragColor = vec4(gradeColor(texture2D(tMap, vUv).rgb, vUv), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const q = new Mesh(new PlaneGeometry(2, 2), this.mat);
    q.frustumCulled = false;
    this.scene.add(q);
  }

  set(look: GradeLook, renderer: WebGLRenderer): void {
    this.look = look;
    applyLook(this.mat.uniforms, look, false);
    renderer.toneMappingExposure = look.exposure;
  }

  get current(): GradeLook {
    return this.look;
  }

  /** Draw `scene` graded to the screen (Low: straight to it; the vignette is the page's). */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    if (this.tier === 0) {
      renderer.render(scene, camera);
      return;
    }
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    this.mat.uniforms.tMap.value = this.target.texture;
    renderer.setRenderTarget(prev);
    renderer.render(this.scene, this.cam);
  }

  dispose(): void {
    this.target.dispose();
    this.mat.dispose();
  }
}

/** Low's vignette: a CSS gradient over the canvas, its edge tinted by the look. */
export function vignetteCss(look: GradeLook): string {
  const warm = look.temp > 0;
  const a = (look.vignette * 0.75).toFixed(2);
  const edge = warm ? `rgba(40,18,4,${a})` : `rgba(4,12,22,${a})`;
  return `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, ${edge} 100%)`;
}
