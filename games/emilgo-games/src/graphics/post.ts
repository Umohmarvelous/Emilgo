// Post-processing, High only (SPEC-V2 §6.3): bloom, a colour grade and a soft
// vignette. No distortion of any kind (§5.3: nothing shimmers or shakes).
//
//   1. the scene, in linear HDR, into a half-float target (4× MSAA on WebGL2)
//   2. its bright parts (sun, lamps, lasers, neon), at a quarter size
//   3. blurred: horizontal, then vertical
//   4. composed to the screen: scene + glow, graded, vignetted, then tone
//      mapped and converted to sRGB exactly as three would have done
//
// Four small passes on a high-end phone; Low and Medium never pay for it.

import {
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from "three";

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Post {
  private readonly scene = new Scene();
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad = new Mesh(new PlaneGeometry(2, 2));
  private readonly full: WebGLRenderTarget;
  private readonly a: WebGLRenderTarget;
  private readonly b: WebGLRenderTarget;
  private readonly bright: ShaderMaterial;
  private readonly blur: ShaderMaterial;
  private readonly out: ShaderMaterial;
  private readonly size = new Vector2();
  /** Grade: warmth −1 (cool) … 1 (warm), set per sky. */
  warmth = 0;

  constructor() {
    this.full = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.a = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
    this.b = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
    this.bright = new ShaderMaterial({
      uniforms: { tMap: { value: null } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tMap, vUv).rgb;
          float l = max(c.r, max(c.g, c.b));
          gl_FragColor = vec4(c * smoothstep(1.4, 3.0, l), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blur = new ShaderMaterial({
      uniforms: { tMap: { value: null }, uDir: { value: new Vector2() } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap; uniform vec2 uDir; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tMap, vUv).rgb * 0.227;
          c += (texture2D(tMap, vUv + uDir * 1.385).rgb + texture2D(tMap, vUv - uDir * 1.385).rgb) * 0.316;
          c += (texture2D(tMap, vUv + uDir * 3.231).rgb + texture2D(tMap, vUv - uDir * 3.231).rgb) * 0.070;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.out = new ShaderMaterial({
      uniforms: { tMap: { value: null }, tGlow: { value: null }, uWarm: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap, tGlow; uniform float uWarm; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tMap, vUv).rgb + texture2D(tGlow, vUv).rgb * 0.45;
          // Grade: a touch more contrast and colour, warmed or cooled by the sky.
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, 1.08);
          c = pow(max(c, 0.0), vec3(1.04));
          c *= vec3(1.0 + uWarm * 0.04, 1.0, 1.0 - uWarm * 0.04);
          // A soft vignette.
          vec2 d = vUv - 0.5;
          c *= 1.0 - dot(d, d) * 0.55;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private pass(renderer: WebGLRenderer, mat: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }

  /** Draw `scene` through the effects to the screen. */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    if (this.full.width !== w || this.full.height !== h) {
      this.full.setSize(w, h);
      this.a.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
      this.b.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    }
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.full);
    renderer.render(scene, camera);
    this.bright.uniforms.tMap.value = this.full.texture as Texture;
    this.pass(renderer, this.bright, this.a);
    this.blur.uniforms.tMap.value = this.a.texture;
    this.blur.uniforms.uDir.value.set(1 / this.a.width, 0);
    this.pass(renderer, this.blur, this.b);
    this.blur.uniforms.tMap.value = this.b.texture;
    this.blur.uniforms.uDir.value.set(0, 1 / this.a.height);
    this.pass(renderer, this.blur, this.a);
    this.out.uniforms.tMap.value = this.full.texture;
    this.out.uniforms.tGlow.value = this.a.texture;
    this.out.uniforms.uWarm.value = this.warmth;
    this.pass(renderer, this.out, prev);
  }

  dispose(): void {
    for (const t of [this.full, this.a, this.b]) t.dispose();
    for (const m of [this.bright, this.blur, this.out]) m.dispose();
  }
}
