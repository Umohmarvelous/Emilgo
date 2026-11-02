// The zombies' look (v4 Phase 5): one material change rots the scanned body,
// on every tier, as the operator's dress does (dress.ts):
//
//   the skin     grey-green and mottled, veins and lesions, bruised and
//                sunken round the eyes; the eyes milky and faintly glowing
//   the mouth    blood round it and down the chin (blood on only)
//   the clothes  filthy, darkened and torn: through the tears the rotten
//                flesh, with wounds at their edges (red only with blood on)
//   the gear     (zombie pieces from gear.ts) its own colour per vertex
//
// The kinds keep their tint over it (the crowd's setTint: the bounty's gold
// glow, lightning's reveal). Adults only: there are no child zombies.

import { CanvasTexture, type Material, RepeatWrapping, Vector2, Vector3 } from "three";

import { BONE_INDEX, type BoneName } from "./skeleton";
import { SCELL, scellUv } from "./scanbody";

type V3 = { x: number; y: number; z: number };

let rotTex: CanvasTexture | null = null;

/**
 * Rot noise, tiling, in three channels: r lesions and blotches, g veins,
 * b the tears' and splatters' field.
 */
function rotNoise(): CanvasTexture {
  if (rotTex) return rotTex;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgb(128,0,0)";
  g.fillRect(0, 0, S, S);
  let seed = 9173;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const wrap = (fn: (dx: number, dy: number) => void) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy);
  };
  // Red channel: blotches (dark and light).
  g.globalCompositeOperation = "source-over";
  for (let k = 0; k < 90; k++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 4 + rnd() * 22;
    const v = rnd() < 0.5 ? 40 + rnd() * 50 : 170 + rnd() * 70;
    wrap((dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, `rgba(${v},0,0,0.9)`);
      gr.addColorStop(1, `rgba(${v},0,0,0)`);
      g.fillStyle = gr;
      g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  // Green channel: veins (branching dark lines; drawn as light in green, read inverted).
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  for (let k = 0; k < 26; k++) {
    let x = rnd() * S;
    let y = rnd() * S;
    let a = rnd() * Math.PI * 2;
    let w = 2.2;
    for (let s = 0; s < 22; s++) {
      const nx = x + Math.cos(a) * 6;
      const ny = y + Math.sin(a) * 6;
      wrap((dx, dy) => {
        g.strokeStyle = `rgba(0,${Math.round(90 + w * 50)},0,0.8)`;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.lineTo(nx + dx, ny + dy);
        g.stroke();
      });
      x = nx;
      y = ny;
      a += (rnd() - 0.5) * 1.1;
      w = Math.max(0.6, w * 0.93);
    }
  }
  // Blue channel: the tears' field (large soft shapes).
  for (let k = 0; k < 40; k++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 8 + rnd() * 30;
    wrap((dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, "rgba(0,0,200,0.9)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  rotTex = new CanvasTexture(c);
  rotTex.wrapS = rotTex.wrapT = RepeatWrapping;
  return rotTex;
}

/** Rot a body's material (or restore it: on false). */
export function rot(mat: Material, on: boolean, rest: Record<BoneName, V3>, blood: boolean): void {
  const m = mat as Material & { userData: { rotted?: string } };
  if (!on) {
    if (!m.userData.rotted) return;
    m.userData.rotted = undefined;
    m.onBeforeCompile = () => {};
    m.customProgramCacheKey = () => "";
    m.needsUpdate = true;
    return;
  }
  const key = `rot:${blood}`;
  if (m.userData.rotted === key) return;
  m.userData.rotted = key;
  const eyeL = rest.eyeL;
  const eyeR = rest.eyeR;
  const cell = scellUv(SCELL.gear);
  const u = {
    rotMap: { value: rotNoise() },
    eyeL: { value: new Vector3(eyeL.x, eyeL.y, eyeL.z) },
    eyeR: { value: new Vector3(eyeR.x, eyeR.y, eyeR.z) },
    gearUv: { value: new Vector2(cell[0], cell[1]) },
    bloodOn: { value: blood ? 1 : 0 },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nflat varying float vRegion;\nvarying vec3 vBind;\nvarying vec3 vBindN;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vBind = position; vBindN = normal;
        #ifdef USE_SKINNING
        float bi = skinIndex.x; float bw = skinWeight.x;
        if (skinWeight.y > bw) { bw = skinWeight.y; bi = skinIndex.y; }
        if (skinWeight.z > bw) { bw = skinWeight.z; bi = skinIndex.z; }
        if (skinWeight.w > bw) { bw = skinWeight.w; bi = skinIndex.w; }
        vRegion = bi;
        #else
        vRegion = 0.0;
        #endif`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        flat varying float vRegion; varying vec3 vBind; varying vec3 vBindN;
        uniform sampler2D rotMap; uniform vec3 eyeL, eyeR; uniform vec2 gearUv; uniform float bloodOn;
        vec3 rotTri(vec3 p, vec3 n) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-5);
          return texture2D(rotMap, p.zy).rgb * w.x + texture2D(rotMap, p.xz).rgb * w.y + texture2D(rotMap, p.xy).rgb * w.z;
        }
        vec3 flesh(vec3 q) {
          vec3 base = vec3(0.30, 0.34, 0.25);
          base = mix(base, vec3(0.22, 0.16, 0.18), smoothstep(0.55, 0.15, q.r));
          base = mix(base, vec3(0.42, 0.44, 0.33), smoothstep(0.65, 0.95, q.r) * 0.6);
          base *= 1.0 - 0.45 * smoothstep(0.35, 0.8, q.g);
          return base;
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          int r = int(vRegion + 0.5);
          #ifdef USE_MAP
          bool gear = abs(vMapUv.x - gearUv.x) < 0.012 && abs(vMapUv.y - gearUv.y) < 0.025;
          #else
          bool gear = false;
          #endif
          if (!gear) {
            vec3 q = rotTri(vBind * 5.0, vBindN);
            bool head = r == ${BONE_INDEX.head} || r == ${BONE_INDEX.jaw} || r == ${BONE_INDEX.lidL} || r == ${BONE_INDEX.lidR};
            bool eye = r == ${BONE_INDEX.eyeL} || r == ${BONE_INDEX.eyeR};
            bool hand = r == ${BONE_INDEX.handL} || r == ${BONE_INDEX.handR} || (r >= ${BONE_INDEX.thumb1L} && r <= ${BONE_INDEX.pinky2R});
            bool foot = r == ${BONE_INDEX.footL} || r == ${BONE_INDEX.footR};
            if (eye) {
              diffuseColor.rgb = vec3(0.78, 0.8, 0.66);
            } else if (head || hand || foot) {
              vec3 f = flesh(q);
              if (head) {
                // Sunken, bruised sockets; blood round the mouth and down the chin.
                float dl = min(length(vBind - eyeL), length(vBind - eyeR));
                f *= mix(0.32, 1.0, smoothstep(0.018, 0.045, dl));
                vec3 c = (eyeL + eyeR) * 0.5;
                vec3 d = vBind - c;
                float mouth = (1.0 - smoothstep(0.022, 0.05, abs(d.x))) * (1.0 - smoothstep(0.0, 0.05, abs(d.y + 0.075))) * step(0.0, d.z + 0.05);
                f = mix(f, vec3(0.16, 0.012, 0.01), mouth * bloodOn * 0.9);
              }
              diffuseColor.rgb = f;
            } else {
              // The clothes: filthy and dark; through the tears, flesh with a wound's edge.
              vec3 cloth = vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))) * vec3(0.32, 0.3, 0.27);
              cloth *= 0.7 + 0.5 * q.r;
              // Tears and splatters a hand's width across (a coarser read of the same field).
              vec3 big = rotTri(vBind * 1.4 + 0.37, vBindN);
              float tear = smoothstep(0.58, 0.66, big.b);
              float edge = smoothstep(0.46, 0.58, big.b) * (1.0 - tear);
              vec3 c = mix(cloth, flesh(q), tear);
              c = mix(c, mix(vec3(0.08, 0.06, 0.05), vec3(0.2, 0.02, 0.015), bloodOn), edge * 0.85);
              // A splatter now and then (blood on), drying dark.
              float spl = smoothstep(0.8, 0.9, big.r) * bloodOn;
              diffuseColor.rgb = mix(c, vec3(0.12, 0.01, 0.01), spl * 0.8);
            }
          }
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          int r2 = int(vRegion + 0.5);
          if (r2 == ${BONE_INDEX.eyeL} || r2 == ${BONE_INDEX.eyeR}) totalEmissiveRadiance += vec3(0.35, 0.4, 0.22);
        }
        #ifdef USE_COLOR
        totalEmissiveRadiance += max(vColor.rgb - 1.0, vec3(0.0)) * 0.5;
        #endif`,
      );
  };
  m.customProgramCacheKey = () => "zombie-rot";
  m.needsUpdate = true;
}
