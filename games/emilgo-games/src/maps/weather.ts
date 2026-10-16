// Weather and air: rain (with splashes) — the only falling weather the spec
// allows (SPEC-V2: sunny, rainy, sunset, sunrise, night). Plus the sky's
// moving parts: a drifting cloud layer, stars at night, and soft halos round
// lamps after dark.
//
// Every particle system is GPU-only: positions are fixed seeds; the vertex
// shader moves them with time and wraps them in a box that follows the camera.
// No per-frame CPU work beyond a few uniforms, whatever the particle count.

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Vector3,
} from "three";

import type { Weather } from "./registry";
import { canvasTexture, clouds as cloudPainter, glow } from "../world/tex";

function seeds(n: number, perVertex: number, extra?: (i: number) => number[]): BufferGeometry {
  const g = new BufferGeometry();
  const s: number[] = [];
  const e: number[] = [];
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = [Math.random(), Math.random(), Math.random()];
    for (let k = 0; k < perVertex; k++) {
      s.push(...a);
      e.push(k, ...(extra ? extra(i) : [0]).slice(0, 1));
      pos.push(0, 0, 0);
    }
  }
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new Float32BufferAttribute(s, 3));
  g.setAttribute("aEnd", new Float32BufferAttribute(e, 2));
  // Particles are everywhere around the camera: never frustum-cull the cloud.
  g.boundingSphere = null;
  return g;
}

const WRAP = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec3 uBox;
  uniform vec3 uVel;
  attribute vec3 aSeed;
  attribute vec2 aEnd;
  vec3 wrapped(vec3 seed, vec3 vel, float sway) {
    vec3 p = seed * uBox + vel * uTime;
    p.x += sin(uTime * 1.3 + seed.y * 40.0) * sway;
    p.z += cos(uTime * 1.1 + seed.x * 40.0) * sway;
    return mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
  }
`;

/** One kind of falling stuff. */
function streaks(n: number, color: Color, opacity: number, len: number): LineSegments {
  const mat = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new Vector3() },
      uBox: { value: new Vector3(34, 18, 34) },
      uVel: { value: new Vector3(1.5, -18, 0.6) },
      uColor: { value: color },
      uOpacity: { value: opacity },
      uLen: { value: len },
    },
    vertexShader: `${WRAP}
      uniform float uLen;
      varying float vFade;
      void main() {
        vec3 p = wrapped(aSeed, uVel, 0.0);
        p -= normalize(uVel) * uLen * aEnd.x;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vFade = (1.0 - aEnd.x * 0.85) * smoothstep(30.0, 4.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vFade;
      void main() { gl_FragColor = vec4(uColor, uOpacity * vFade); }`,
    transparent: true,
    depthWrite: false,
  });
  const ls = new LineSegments(seeds(n, 2), mat);
  ls.frustumCulled = false;
  ls.renderOrder = 5;
  return ls;
}

/** Rain splashes: little rings popping on the ground around you. */
function splashes(n: number): Points {
  const tex = canvasTexture("glow", 32, glow, false);
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new Vector3() }, uBox: { value: new Vector3(26, 1, 26) }, uVel: { value: new Vector3() }, uMap: { value: tex }, uScale: { value: 400 } },
    vertexShader: `${WRAP}
      uniform float uScale;
      varying float vA;
      void main() {
        vec3 p = wrapped(aSeed, vec3(0.0), 0.0);
        p.y = 0.03;
        float t = fract(uTime * (1.5 + aSeed.z) + aSeed.x * 7.0);
        vA = (1.0 - t) * 0.5;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.04 + t * 0.12) * uScale / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D uMap; varying float vA;
      void main() { float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(0.85, 0.9, 1.0, a * vA); }`,
    transparent: true,
    depthWrite: false,
  });
  const p = new Points(seeds(n, 1), mat);
  p.frustumCulled = false;
  return p;
}

export class Air {
  readonly group = new Group();
  private readonly mats: ShaderMaterial[] = [];
  private readonly cloudLayer: Mesh;
  private readonly cloudMat: MeshBasicMaterial;
  private halos: Points | null = null;
  private time = 0;

  constructor(
    weather: Weather,
    o: { particles: number; night: boolean; cloudTint: Color; cloudCover: number; lamps: [number, number, number][]; lampColor: Color; lampsOn: boolean },
  ) {
    const k = Math.max(0.15, o.particles);
    if (weather === "rain") {
      this.add(streaks(Math.round(2600 * k), new Color(0xbfd2e6), 0.32, 0.9));
      if (o.particles > 0.5) this.add(splashes(Math.round(700 * k)));
    }

    // Clouds: a broad sheet high above, drifting.
    const tex = canvasTexture("clouds", 512, cloudPainter, true);
    tex.repeat.set(3, 3);
    this.cloudMat = new MeshBasicMaterial({ map: tex, color: o.cloudTint, transparent: true, opacity: o.cloudCover, depthWrite: false, fog: false });
    this.cloudLayer = new Mesh(new PlaneGeometry(900, 900), this.cloudMat);
    this.cloudLayer.rotation.x = Math.PI / 2;
    this.cloudLayer.position.set(0, 140, -60);
    this.cloudLayer.renderOrder = -1;
    this.group.add(this.cloudLayer);

    // Stars.
    if (o.night && weather !== "rain") {
      const g = new BufferGeometry();
      const p: number[] = [];
      for (let i = 0; i < 700; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = 0.12 + Math.random() * 1.3;
        p.push(Math.cos(a) * Math.cos(e) * 360, Math.sin(e) * 360, Math.sin(a) * Math.cos(e) * 360);
      }
      g.setAttribute("position", new Float32BufferAttribute(p, 3));
      // A tiny, unattenuated point per star.
      const stars = new Points(g, new PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
      stars.frustumCulled = false;
      this.group.add(stars);
    }

    // Lamp halos after dark (steady: no flicker).
    if (o.lampsOn && o.lamps.length) {
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(o.lamps.flat(), 3));
      const mat = new ShaderMaterial({
        uniforms: { uMap: { value: canvasTexture("glow", 64, glow, false) }, uColor: { value: o.lampColor }, uScale: { value: 400 }, uTime: { value: 0 } },
        vertexShader: `uniform float uScale;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = 2.6 * uScale / max(1.0, -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor;
          void main() { float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(uColor, a * 0.55); }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      this.halos = new Points(g, mat);
      this.halos.frustumCulled = false;
      this.mats.push(mat);
      this.group.add(this.halos);
    }
  }

  private add(o: Points | LineSegments): void {
    this.mats.push(o.material as ShaderMaterial);
    this.group.add(o);
  }

  /** Point size scale: viewport height in px × projection (set on resize). */
  setScale(px: number, fovDeg: number): void {
    const s = px / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const m of this.mats) if (m.uniforms.uScale) m.uniforms.uScale.value = s;
  }

  update(dt: number, cam: Vector3): void {
    this.time += dt;
    for (const m of this.mats) {
      m.uniforms.uTime.value = this.time;
      if (m.uniforms.uCam) m.uniforms.uCam.value.copy(cam);
    }
    const map = this.cloudMat.map!;
    map.offset.x = (this.time * 0.0025) % 1;
    map.offset.y = (this.time * 0.0011) % 1;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      (m.material as { dispose?: () => void } | undefined)?.dispose?.();
    });
  }
}
