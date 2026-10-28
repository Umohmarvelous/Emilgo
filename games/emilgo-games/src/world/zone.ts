// The zone's wall (SPEC-V3 §10 #19): a shimmering heat curtain round the safe
// circle, drawn as one open cylinder with a scrolling texture. Cheap: one
// draw, one small noise picture, no extra pass. Warm like the Harmattan; it
// rises out of the ground and thins upwards, and fades out with distance
// (beyond the haze you have the map) and right up close (walking through it
// shouldn't blind you). Outside it, the screen's own tint and the heartbeat
// say where you are (ui/play.ts).

import { AdditiveBlending, Color, CylinderGeometry, DoubleSide, Mesh, RepeatWrapping, ShaderMaterial } from "three";

import type { Circle } from "../game/modules/zone";
import { canvasTexture, type Painter } from "./tex";

const HEIGHT = 42;

/** Rising heat: soft vertical streaks, brighter in knots. */
const heat: Painter = (g, s, rnd) => {
  g.fillStyle = "#000";
  g.fillRect(0, 0, s, s);
  for (let k = 0; k < 90; k++) {
    const x = rnd() * s;
    const w = 2 + rnd() * 10;
    const gr = g.createLinearGradient(x - w, 0, x + w, 0);
    const a = 0.15 + rnd() * 0.45;
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.5, `rgba(255,255,255,${a})`);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    const y = rnd() * s;
    const h = s * (0.2 + rnd() * 0.6);
    g.fillRect(x - w, y, w * 2, h);
    if (y + h > s) g.fillRect(x - w, y - s, w * 2, h);
  }
};

/** The heat picture (the zone's curtain, Airfall's flare smoke share it). */
export function heatTexture(): import("three").CanvasTexture {
  const map = canvasTexture("zone-heat", 128, heat);
  map.wrapS = map.wrapT = RepeatWrapping;
  return map;
}

const VERT = /* glsl */ `
varying vec2 vUv;
varying float vDist;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDist = distance(cameraPosition, wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform float time;
uniform float around;
uniform float view;
uniform vec3 color;
uniform float strength;
varying vec2 vUv;
varying float vDist;
void main() {
  float a = texture2D(map, vec2(vUv.x * around, vUv.y * 1.4 - time * 0.12)).r;
  float b = texture2D(map, vec2(vUv.x * around * 1.7 + 0.37, vUv.y * 0.9 - time * 0.05)).r;
  float shimmer = 0.35 + 1.3 * a * (0.4 + b);
  float up = pow(1.0 - vUv.y, 1.6);
  float foot = 0.7 + 1.1 * (1.0 - smoothstep(0.0, 0.06, vUv.y));
  float far = 1.0 - smoothstep(view * 0.55, view, vDist);
  float near = 0.35 + 0.65 * smoothstep(1.5, 9.0, vDist);
  float k = strength * shimmer * up * foot * far * near;
  gl_FragColor = vec4(color * k, 1.0);
}`;

export class ZoneWall {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private r = -1;

  /** `view`: the tier's view distance (the curtain fades out before the haze). */
  constructor(view: number, segments = 96) {
    const geo = new CylinderGeometry(1, 1, 1, segments, 1, true);
    geo.translate(0, 0.5, 0);
    const map = heatTexture();
    this.mat = new ShaderMaterial({
      uniforms: {
        map: { value: map },
        time: { value: 0 },
        around: { value: 1 },
        view: { value: view },
        color: { value: new Color(1, 0.46, 0.18) },
        strength: { value: 0.85 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** The circle now (null: no zone). */
  set(c: Circle | null): void {
    if (!c || c.r > 1e5) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(c.x, -0.6, c.z);
    if (c.r !== this.r) {
      this.r = c.r;
      this.mesh.scale.set(c.r, HEIGHT, c.r);
      // One streak picture every 14 m round the circle, however big it is.
      this.mat.uniforms.around.value = Math.max(1, Math.round((c.r * Math.PI * 2) / 14));
    }
  }

  update(dt: number): void {
    this.mat.uniforms.time.value += dt;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
