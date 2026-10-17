// The sky (SPEC-V2 §6.2): a gradient dome that travels with the camera, the
// sun or the moon, stars at night, and clouds:
//
//   Low, Medium  a scrolling 2D cloud layer: one textured plane high above,
//                anchored to the world (it doesn't follow you), drifting with
//                the wind, fading out towards the horizon. Almost free.
//   High         volumetric clouds: the dome's shader marches a ray through a
//                slab of cloud 140–230 m up (10 steps, one light sample each),
//                lit by the sun from inside. Only the sky's pixels pay for it.
//
// Everything here ignores the fog: the sky IS the fog's colour at the horizon.

import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RedFormat,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector2,
  Vector3,
} from "three";

import { canvasTexture, clouds as cloudPainter, glow } from "../world/tex";

export interface SkyLook {
  top: Color;
  horizon: Color;
  below: Color;
  /** Towards the sun (or the moon at night). */
  sunDir: Vector3;
  sunColor: Color;
  night: boolean;
  rain: boolean;
  cloudTint: Color;
  /** 0 clear … 1 overcast. */
  cloudCover: number;
}

const R = 400;
const WIND = new Vector2(1.6, 0.7); // m/s, the clouds' drift

/** Tiling value noise (256², one channel) for the volumetric clouds. */
let noiseTex: DataTexture | null = null;
function noise(): DataTexture {
  if (noiseTex) return noiseTex;
  const N = 256;
  const g = 32; // lattice cells across
  const lat = new Float32Array(g * g);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const data = new Uint8Array(N * N);
  const fade = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      let amp = 0.5;
      let f = 1;
      for (let o = 0; o < 4; o++) {
        const fx = (x / N) * g * f;
        const fy = (y / N) * g * f;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fade(fx - x0);
        const ty = fade(fy - y0);
        const at = (i: number, j: number) => lat[(((j % g) + g) % g) * g + (((i % g) + g) % g)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        v += (a + (b - a) * ty) * amp;
        amp *= 0.5;
        f *= 2;
      }
      data[y * N + x] = Math.round(Math.min(1, v / 0.9375) * 255);
    }
  }
  const t = new DataTexture(data, N, N, RedFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  noiseTex = t;
  return t;
}

export class Sky {
  /** Follows the camera (position only). */
  readonly group = new Group();
  private readonly dome: Mesh;
  private readonly domeMat: ShaderMaterial;
  private layer: Mesh | null = null;
  private layerMat: ShaderMaterial | null = null;
  private time = 0;

  constructor(L: SkyLook, volumetric: boolean) {
    const g = new SphereGeometry(R, 24, 12);
    this.domeMat = new ShaderMaterial({
      uniforms: {
        uTop: { value: L.top.clone() },
        uHorizon: { value: L.horizon.clone() },
        uBelow: { value: L.below.clone() },
        uSun: { value: L.sunDir.clone().normalize() },
        uSunColor: { value: L.sunColor.clone() },
        uNight: { value: L.night ? 1 : 0 },
        uCloud: { value: L.cloudTint.clone() },
        uCover: { value: L.cloudCover },
        uTime: { value: 0 },
        uCam: { value: new Vector3() },
        uNoise: { value: volumetric ? noise() : null },
      },
      defines: volumetric ? { VOLUMETRIC: 1 } : {},
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uBelow, uSun, uSunColor, uCloud, uCam;
        uniform float uNight, uCover, uTime;
        varying vec3 vDir;
        #ifdef VOLUMETRIC
        uniform sampler2D uNoise;
        float dens(vec3 p) {
          vec2 q = (p.xz + vec2(${WIND.x.toFixed(2)}, ${WIND.y.toFixed(2)}) * uTime) * 0.0016;
          float n = texture2D(uNoise, q).r * 0.62 + texture2D(uNoise, q * 3.1 + 0.37).r * 0.28 + texture2D(uNoise, q * 9.7 + 0.71).r * 0.1;
          // Thicker in the middle of the slab, none at its floor and ceiling.
          float h = clamp((p.y - 140.0) / 90.0, 0.0, 1.0);
          float shape = smoothstep(0.0, 0.25, h) * smoothstep(1.0, 0.55, h);
          return clamp((n - (1.0 - uCover * 0.62)) * 3.2, 0.0, 1.0) * shape;
        }
        #endif
        void main() {
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 col = y > 0.0 ? mix(uHorizon, uTop, smoothstep(0.0, 0.62, y)) : mix(uHorizon, uBelow, smoothstep(0.0, 0.2, -y));
          // A warm (or silver) glow round the sun or the moon.
          float s = max(dot(d, normalize(uSun)), 0.0);
          col += uSunColor * (pow(s, 8.0) * 0.18 + pow(s, 64.0) * 0.35) * (1.0 - uNight * 0.6);
          #ifdef VOLUMETRIC
          if (y > 0.015) {
            float t0 = (140.0 - uCam.y) / y;
            float t1 = min((230.0 - uCam.y) / y, t0 + 700.0);
            float stepLen = (t1 - t0) / 10.0;
            float trans = 1.0;
            vec3 acc = vec3(0.0);
            vec3 lit = mix(vec3(1.0), uSunColor, 0.55) * (1.0 - uNight * 0.75);
            vec3 shade = uCloud * (0.55 - uNight * 0.3);
            for (int i = 0; i < 10; i++) {
              vec3 p = uCam + d * (t0 + (float(i) + 0.5) * stepLen);
              float de = dens(p);
              if (de > 0.01) {
                float toSun = dens(p + normalize(uSun) * 24.0);
                vec3 c = mix(lit, shade, clamp(toSun * 1.4, 0.0, 1.0));
                float a = 1.0 - exp(-de * stepLen * 0.035);
                acc += trans * a * c;
                trans *= 1.0 - a;
                if (trans < 0.05) break;
              }
            }
            // Clouds thin out into the haze at the horizon.
            float far = smoothstep(0.015, 0.16, y);
            col = mix(col, acc + col * trans, far);
          }
          #endif
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new Mesh(g, this.domeMat);
    this.dome.renderOrder = -3;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // The sun or the moon.
    const disc = new Mesh(
      new PlaneGeometry(L.night ? 22 : 46, L.night ? 22 : 46),
      new MeshBasicMaterial({ map: canvasTexture("glow", 128, glow, false), color: L.night ? 0xdfe8ff : L.sunColor, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, opacity: L.rain ? 0.25 : 1 }),
    );
    disc.position.copy(L.sunDir).normalize().multiplyScalar(R * 0.9);
    disc.lookAt(0, 0, 0);
    disc.renderOrder = -2;
    this.group.add(disc);

    // Stars.
    if (L.night && !L.rain) {
      const sg = new BufferGeometry();
      const p: number[] = [];
      for (let i = 0; i < 700; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = 0.12 + Math.random() * 1.3;
        p.push(Math.cos(a) * Math.cos(e) * R * 0.92, Math.sin(e) * R * 0.92, Math.sin(a) * Math.cos(e) * R * 0.92);
      }
      sg.setAttribute("position", new Float32BufferAttribute(p, 3));
      const stars = new Points(sg, new PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
      stars.frustumCulled = false;
      stars.renderOrder = -2;
      this.group.add(stars);
    }

    // Low and Medium: the 2D cloud layer, anchored to the world.
    if (!volumetric) {
      const tex = canvasTexture("clouds", 512, cloudPainter, true);
      tex.wrapS = tex.wrapT = RepeatWrapping;
      this.layerMat = new ShaderMaterial({
        uniforms: { uMap: { value: tex }, uTint: { value: L.cloudTint.clone() }, uCover: { value: L.cloudCover }, uOff: { value: new Vector2() } },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap; uniform vec3 uTint; uniform float uCover; uniform vec2 uOff;
          varying vec2 vP;
          void main() {
            vec4 t = texture2D(uMap, (vP + uOff) / 300.0);
            float edge = 1.0 - smoothstep(260.0, 600.0, length(vP));
            gl_FragColor = vec4(uTint * t.rgb, t.a * uCover * edge);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthWrite: false,
        fog: false,
      });
      this.layer = new Mesh(new PlaneGeometry(1200, 1200), this.layerMat);
      this.layer.rotation.x = Math.PI / 2;
      this.layer.position.y = 150;
      this.layer.renderOrder = -1;
      this.layer.frustumCulled = false;
      this.group.add(this.layer);
    }
  }

  update(dt: number, cam: Vector3): void {
    this.time += dt;
    this.group.position.copy(cam);
    const u = this.domeMat.uniforms;
    u.uTime.value = this.time;
    u.uCam.value.copy(cam);
    if (this.layerMat && this.layer) {
      // The plane travels with you; its pattern stays put in the world and drifts with the wind.
      this.layer.position.y = 150 - cam.y;
      this.layerMat.uniforms.uOff.value.set(cam.x + WIND.x * this.time, cam.z + WIND.y * this.time);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      (m.material as { dispose?: () => void } | undefined)?.dispose?.();
    });
  }
}
