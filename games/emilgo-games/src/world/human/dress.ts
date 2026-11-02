// The operator's dress (v4 Phase 4): one material change re-dresses the
// scanned body, on every tier (Lambert on Low, standard above):
//
//   the clothes   camo fabric, tri-planar on the bind pose (it never swims)
//   the hands     gloves;  the feet  boots
//   the head      a balaclava (a knit colour) with one slit: only the eyes
//                 and the bridge of the nose show; the scanned eyes and lids
//                 still move behind it
//   the gear      (gear.ts) its own colour per vertex; a colour over 1 glows
//
// Which part a fragment is comes from the bone that moves its vertex most,
// so it follows every pose and every LOD level. One shader for everyone
// (its uniforms per body), so dressing the crowd compiles once.

import { CanvasTexture, Color, type Material, RepeatWrapping, SRGBColorSpace, Vector2, Vector3 } from "three";

import { BONE_INDEX, type BoneName } from "./skeleton";
import type { Kit } from "./gear";
import { SCELL, scellUv } from "./scanbody";

type V3 = { x: number; y: number; z: number };

const camoTex = new Map<string, CanvasTexture>();

/** An original four-colour camo (soft blobs at three sizes), tiling. */
function camo(kit: Kit): CanvasTexture {
  let t = camoTex.get(kit.id);
  if (t) return t;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = kit.camo[0];
  g.fillRect(0, 0, S, S);
  let seed = 0;
  for (const ch of kit.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const [col, n, r] of [[kit.camo[1], 26, 34], [kit.camo[2], 30, 24], [kit.camo[3], 40, 12]] as [string, number, number][]) {
    g.fillStyle = col;
    for (let k = 0; k < n; k++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const rr = r * (0.5 + rnd());
      // Drawn wrapped, so the tile has no seams.
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        g.beginPath();
        g.ellipse(x + dx, y + dy, rr, rr * (0.5 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  camoTex.set(kit.id, t);
  return t;
}

const linCol = (hex: string) => new Color(hex);

/** Put the operator's dress on a body's material (or take it off: kit null). */
export function dress(mat: Material, kit: Kit | null, rest: Record<BoneName, V3>): void {
  const m = mat as Material & { userData: { dressed?: string } };
  if (!kit) {
    if (!m.userData.dressed) return;
    m.userData.dressed = undefined;
    m.onBeforeCompile = () => {};
    m.customProgramCacheKey = () => "";
    m.needsUpdate = true;
    return;
  }
  const eyeL = rest.eyeL;
  const eyeR = rest.eyeR;
  const c = new Vector3((eyeL.x + eyeR.x) / 2, (eyeL.y + eyeR.y) / 2, Math.max(eyeL.z, eyeR.z));
  const half = new Vector2(Math.abs(eyeL.x - eyeR.x) * 0.5 + 0.02, 0.0135);
  const cell = scellUv(SCELL.gear);
  const u = {
    camoMap: { value: camo(kit) },
    gloveCol: { value: linCol(kit.glove) },
    bootCol: { value: linCol(kit.boot) },
    knitCol: { value: linCol(kit.knit) },
    eyeC: { value: c },
    eyeHalf: { value: half },
    gearUv: { value: new Vector2(cell[0], cell[1]) },
  };
  const key = `dress:${kit.id}:${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)}`;
  if (m.userData.dressed === key) return;
  m.userData.dressed = key;
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
        uniform sampler2D camoMap; uniform vec3 gloveCol, bootCol, knitCol, eyeC; uniform vec2 eyeHalf, gearUv;
        vec3 tri3(vec3 p, vec3 n) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-5);
          return texture2D(camoMap, p.zy).rgb * w.x + texture2D(camoMap, p.xz).rgb * w.y + texture2D(camoMap, p.xy).rgb * w.z;
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
            bool head = r == ${BONE_INDEX.head} || r == ${BONE_INDEX.neck} || r == ${BONE_INDEX.jaw};
            bool hand = r == ${BONE_INDEX.handL} || r == ${BONE_INDEX.handR} || (r >= ${BONE_INDEX.thumb1L} && r <= ${BONE_INDEX.pinky2R});
            // The feet, and the bottom of the legs (the boots' uppers).
            bool foot = r == ${BONE_INDEX.footL} || r == ${BONE_INDEX.footR} || vBind.y < 0.14;
            // The eyeballs always show; the lids' skin is the balaclava's outside the slit.
            bool eye = r == ${BONE_INDEX.eyeL} || r == ${BONE_INDEX.eyeR};
            bool lid = r == ${BONE_INDEX.lidL} || r == ${BONE_INDEX.lidR};
            if (head || lid) {
              vec3 d = vBind - eyeC;
              float e = (d.x * d.x) / (eyeHalf.x * eyeHalf.x);
              bool slit = abs(d.x) < eyeHalf.x && abs(d.y + 0.002) < eyeHalf.y * (1.0 - 0.45 * e) && d.z > -0.07;
              bool bridge = abs(d.x) < 0.009 && d.y < 0.0 && d.y > -0.026 && d.z > -0.025;
              if (!(slit || bridge)) {
                float k = 0.85 + 0.3 * tri3(vBind * 9.0, vBindN).g;
                diffuseColor.rgb = knitCol * k;
              }
            } else if (!eye) {
              diffuseColor.rgb = hand ? gloveCol : foot ? bootCol : tri3(vBind * 3.2, vBindN);
            }
          }
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        #ifdef USE_COLOR
        totalEmissiveRadiance += max(vColor.rgb - 1.0, vec3(0.0)) * 0.5;
        #endif`,
      );
  };
  m.customProgramCacheKey = () => "operator-dress";
  m.needsUpdate = true;
}
