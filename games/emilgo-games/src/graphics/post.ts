// Post-processing, High only (SPEC-V2 §6.3): bloom, a colour grade and a soft
// vignette. No distortion of any kind (§5.3: nothing shimmers or shakes).
//
//   1. the scene, in linear HDR, into a half-float target (4× MSAA on WebGL2)
//   2. its bright parts (sun, lamps, lasers, neon), at a quarter size
//   3. blurred: horizontal, then vertical
//   4. composed to the screen: scene + glow, graded by the place's look
//      (graphics/grade.ts, with grain), then tone mapped and converted to sRGB
//      exactly as three would have done
//
// Four small passes on a high-end phone; Low and Medium never pay for it.
//
// Max (v4 Phase 6), for flagships and computers, adds from the depth buffer:
//   5. ambient occlusion (a depth-only SSAO at half size, blurred): contact
//      shadows in corners, under cars, between people
//   6. god rays: the bright pass blurred towards the sun's place on screen
//   7. depth of field while aiming down the sights (focused on what the
//      crosshair is on), from a blurred quarter-size copy of the scene
//   8. chromatic aberration in action (a shot's kick, a hit), at the edges

import {
  DepthTexture,
  DirectionalLight,
  HalfFloatType,
  PerspectiveCamera,
  UnsignedIntType,
  Vector3,
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

import { applyLook, GRADE_GLSL, gradeUniforms, type GradeLook } from "./grade";

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
  private time = 0;
  /** Max (v4): the depth-buffer passes; aiming (0 … 1) and action (0 … 1) this frame. */
  private max = false;
  private ads = 0;
  private action = 0;
  private maxT: { ao: WebGLRenderTarget; ao2: WebGLRenderTarget; rays: WebGLRenderTarget; sceneQ: WebGLRenderTarget; sceneQ2: WebGLRenderTarget; aoMat: ShaderMaterial; rayMat: ShaderMaterial; copy: ShaderMaterial; outMax: ShaderMaterial } | null = null;
  private sun: DirectionalLight | null = null;
  private sunScene: Scene | null = null;

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
      uniforms: { tMap: { value: null }, tGlow: { value: null }, ...gradeUniforms() },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap, tGlow; varying vec2 vUv;
        ${GRADE_GLSL}
        void main() {
          vec3 c = texture2D(tMap, vUv).rgb + texture2D(tGlow, vUv).rgb * 0.45;
          gl_FragColor = vec4(gradeColor(c, vUv), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** The place's look (graphics/grade.ts), with its grain. */
  setLook(look: GradeLook, renderer: WebGLRenderer): void {
    applyLook(this.out.uniforms, look, true);
    if (this.maxT) applyLook(this.maxT.outMax.uniforms, look, true);
    renderer.toneMappingExposure = look.exposure;
  }

  /** Max on or off; how far down the sights (depth of field) and how much is happening (chromatic aberration). */
  setMax(on: boolean, ads = 0, action = 0): void {
    if (on !== this.max) {
      this.max = on;
      // The scene's target gains (or drops) a depth texture: made afresh at the next size check.
      this.full.setSize(1, 1);
      this.full.depthTexture?.dispose();
      this.full.depthTexture = on ? new DepthTexture(1, 1, UnsignedIntType) : null;
    }
    this.ads = ads;
    this.action = action;
  }

  private makeMax(): NonNullable<Post["maxT"]> {
    const t = () => new WebGLRenderTarget(1, 1, { type: HalfFloatType });
    const aoMat = new ShaderMaterial({
      uniforms: { tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 500 }, uRes: { value: new Vector2() }, uProj: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth; uniform float uNear, uFar, uProj; uniform vec2 uRes; varying vec2 vUv;
        float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        void main() {
          float d0 = lin(texture2D(tDepth, vUv).r);
          if (d0 > uFar * 0.9) { gl_FragColor = vec4(1.0); return; }
          // A disc of samples that shrinks with distance (about 0.6 m across in the world).
          float rad = clamp(0.35 * uProj / d0, 0.002, 0.06);
          float occ = 0.0;
          for (int i = 0; i < 12; i++) {
            float a = float(i) * 2.39996 + fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
            float r = rad * (0.25 + 0.75 * float(i) / 12.0);
            vec2 o = vec2(cos(a), sin(a)) * r * vec2(uRes.y / uRes.x, 1.0);
            float d = lin(texture2D(tDepth, vUv + o).r);
            float diff = d0 - d;
            // Closer than us nearby: it shades us (fading out for big depth gaps: no halos).
            occ += smoothstep(0.02, 0.25, diff) * (1.0 - smoothstep(0.6, 1.6, diff));
          }
          float ao = 1.0 - occ / 12.0 * 0.85;
          gl_FragColor = vec4(vec3(ao), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const rayMat = new ShaderMaterial({
      uniforms: { tMap: { value: null }, uSun: { value: new Vector2(0.5, 0.5) }, uOn: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap; uniform vec2 uSun; uniform float uOn; varying vec2 vUv;
        void main() {
          vec2 d = (uSun - vUv) / 28.0;
          vec2 p = vUv;
          vec3 c = vec3(0.0);
          float w = 1.0;
          for (int i = 0; i < 28; i++) { c += texture2D(tMap, p).rgb * w; w *= 0.95; p += d; }
          gl_FragColor = vec4(c * 0.09 * uOn, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const copy = new ShaderMaterial({
      uniforms: { tMap: { value: null } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `uniform sampler2D tMap; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tMap, vUv).rgb, 1.0); }`,
      depthTest: false,
      depthWrite: false,
    });
    const outMax = new ShaderMaterial({
      uniforms: {
        tMap: { value: null }, tGlow: { value: null }, tAo: { value: null }, tRays: { value: null }, tBlur: { value: null }, tDepth: { value: null },
        uNear: { value: 0.1 }, uFar: { value: 500 }, uAds: { value: 0 }, uCa: { value: 0 },
        ...gradeUniforms(),
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap, tGlow, tAo, tRays, tBlur, tDepth; uniform float uNear, uFar, uAds, uCa; varying vec2 vUv;
        ${GRADE_GLSL}
        float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        void main() {
          // Chromatic aberration: red out, blue in, growing to the edges.
          vec2 off = (vUv - 0.5) * uCa * 0.012;
          vec3 c = vec3(texture2D(tMap, vUv + off).r, texture2D(tMap, vUv).g, texture2D(tMap, vUv - off).b);
          c *= texture2D(tAo, vUv).r;
          // Depth of field down the sights: focused where the crosshair is.
          if (uAds > 0.01) {
            float focus = lin(texture2D(tDepth, vec2(0.5)).r);
            float d = lin(texture2D(tDepth, vUv).r);
            float coc = clamp(abs(d - focus) / max(2.5, focus * 0.9), 0.0, 1.0) * 0.85;
            // The middle stays sharp (what you aim at); the rest softens with depth.
            coc *= smoothstep(0.08, 0.3, length((vUv - 0.5) * vec2(1.6, 1.0)));
            c = mix(c, texture2D(tBlur, vUv).rgb * texture2D(tAo, vUv).r, coc * uAds);
          }
          c += texture2D(tGlow, vUv).rgb * 0.45 + texture2D(tRays, vUv).rgb;
          gl_FragColor = vec4(gradeColor(c, vUv), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    return { ao: t(), ao2: t(), rays: t(), sceneQ: t(), sceneQ2: t(), aoMat, rayMat, copy, outMax };
  }

  /** The scene's sun (its first directional light), found once per scene. */
  private sunOf(scene: Scene): DirectionalLight | null {
    if (this.sunScene === scene && this.sun?.parent) return this.sun;
    this.sunScene = scene;
    this.sun = null;
    scene.traverse((o) => {
      if (!this.sun && (o as DirectionalLight).isDirectionalLight) this.sun = o as DirectionalLight;
    });
    return this.sun;
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
      if (this.full.depthTexture) {
        this.full.depthTexture.image.width = w;
        this.full.depthTexture.image.height = h;
        this.full.depthTexture.needsUpdate = true;
      }
      this.a.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
      this.b.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
      if (this.maxT) {
        this.maxT.ao.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
        this.maxT.ao2.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
        for (const q of [this.maxT.rays, this.maxT.sceneQ, this.maxT.sceneQ2]) q.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
      }
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
    this.time = (this.time + 1 / 60) % 100;
    if (this.max && this.full.depthTexture) return this.renderMax(renderer, scene, camera, prev, w, h);
    this.out.uniforms.tMap.value = this.full.texture;
    this.out.uniforms.tGlow.value = this.a.texture;
    this.out.uniforms.uTime.value = this.time;
    this.pass(renderer, this.out, prev);
  }

  /** Max: the depth passes, then everything composed. */
  private renderMax(renderer: WebGLRenderer, scene: Scene, camera: Camera, prev: WebGLRenderTarget | null, w: number, h: number): void {
    if (!this.maxT) {
      this.maxT = this.makeMax();
      this.full.setSize(1, 1);
      this.full.setSize(w, h);
      this.maxT.ao.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
      this.maxT.ao2.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
      for (const q of [this.maxT.rays, this.maxT.sceneQ, this.maxT.sceneQ2]) q.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    }
    const M = this.maxT;
    const cam = camera as PerspectiveCamera;
    const depth = this.full.depthTexture!;
    // Ambient occlusion at half size, then blurred twice.
    M.aoMat.uniforms.tDepth.value = depth;
    M.aoMat.uniforms.uNear.value = cam.near;
    M.aoMat.uniforms.uFar.value = cam.far;
    M.aoMat.uniforms.uRes.value.set(w, h);
    M.aoMat.uniforms.uProj.value = 1 / Math.tan(((cam.fov ?? 60) * Math.PI) / 360);
    this.pass(renderer, M.aoMat, M.ao);
    this.blur.uniforms.tMap.value = M.ao.texture;
    this.blur.uniforms.uDir.value.set(1 / M.ao.width, 0);
    this.pass(renderer, this.blur, M.ao2);
    this.blur.uniforms.tMap.value = M.ao2.texture;
    this.blur.uniforms.uDir.value.set(0, 1 / M.ao.height);
    this.pass(renderer, this.blur, M.ao);
    // God rays: the bright pass dragged towards the sun (only when it's in front).
    const sun = this.sunOf(scene);
    let on = 0;
    if (sun) {
      _sun.copy(sun.position).sub(sun.target.position).normalize().multiplyScalar(1000).add(cam.position).project(cam);
      const inFront = _sun.z < 1;
      on = inFront ? Math.max(0, 1 - Math.max(Math.abs(_sun.x), Math.abs(_sun.y)) / 1.6) : 0;
      M.rayMat.uniforms.uSun.value.set(_sun.x * 0.5 + 0.5, _sun.y * 0.5 + 0.5);
    }
    M.rayMat.uniforms.uOn.value = on;
    M.rayMat.uniforms.tMap.value = this.b.texture;
    this.pass(renderer, M.rayMat, M.rays);
    // A blurred quarter of the scene, for the depth of field.
    if (this.ads > 0.01) {
      M.copy.uniforms.tMap.value = this.full.texture;
      this.pass(renderer, M.copy, M.sceneQ);
      this.blur.uniforms.tMap.value = M.sceneQ.texture;
      this.blur.uniforms.uDir.value.set(1.5 / M.sceneQ.width, 0);
      this.pass(renderer, this.blur, M.sceneQ2);
      this.blur.uniforms.tMap.value = M.sceneQ2.texture;
      this.blur.uniforms.uDir.value.set(0, 1.5 / M.sceneQ.height);
      this.pass(renderer, this.blur, M.sceneQ);
    }
    const u = M.outMax.uniforms;
    u.tMap.value = this.full.texture;
    u.tGlow.value = this.a.texture;
    u.tAo.value = M.ao.texture;
    u.tRays.value = M.rays.texture;
    u.tBlur.value = M.sceneQ.texture;
    u.tDepth.value = depth;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uAds.value = this.ads;
    u.uCa.value = this.action;
    u.uTime.value = this.time;
    this.pass(renderer, M.outMax, prev);
  }

  dispose(): void {
    for (const t of [this.full, this.a, this.b]) t.dispose();
    for (const m of [this.bright, this.blur, this.out]) m.dispose();
    if (this.maxT) {
      for (const t of [this.maxT.ao, this.maxT.ao2, this.maxT.rays, this.maxT.sceneQ, this.maxT.sceneQ2]) t.dispose();
      for (const m of [this.maxT.aoMat, this.maxT.rayMat, this.maxT.copy, this.maxT.outMax]) m.dispose();
    }
  }
}

const _sun = new Vector3();
