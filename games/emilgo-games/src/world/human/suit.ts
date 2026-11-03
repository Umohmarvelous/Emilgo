// The operator's black tactical suit (v4 rework R2; the owner: "remove the
// body armor … only the black suit, not camouflage", gloves, real boots).
// One material per body, coloured by the region the bake gave each vertex
// (op.ts REGION):
//
//   suit     black ripstop: a fine weave, a little wear on the knees and seat
//   seam     the joints' gussets, a shade darker
//   pad      sewn-in knee and elbow pads (raised in the mesh), cordura
//   belt     a black webbing belt, a gunmetal buckle at the front
//   pocket   thigh cargo pockets (raised), a flap line across the top
//   band     an armband on the left arm in the player's colour (who's who)
//   glove    black leather gloves, hard knuckles, a cuff over the wrist
//   boot     black leather boots (raised round the ankle), laces up the front,
//            rubber soles
//   head     a black knit balaclava with one slit: only the eyes and the
//            bridge of the nose show (the brief); real eyeballs in it
//
// Medium and up: a bump from a tiled weave texture (tri-planar on the rest
// pose, so it never swims) and roughness per region. Low: Lambert, colours only.

import { CanvasTexture, Color, MeshLambertMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector2, Vector3, type Material } from "three";

import type { Tier } from "./mesh";
import type { BoneName, V3 } from "./skeleton";
import { HOODIE_COLORS, SKIN_TONES, type Look } from "./wardrobe";

let weaveTex: CanvasTexture | null = null;

/** A tiling weave: r fine ripstop grid, g a coarse knit, b blotchy wear. */
function weave(): CanvasTexture {
  if (weaveTex) return weaveTex;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const img = g.createImageData(S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const blot = new Float32Array(S * S);
  for (let k = 0; k < 60; k++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 6 + rnd() * 16;
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        const d = Math.hypot(i, j) / r;
        if (d > 1) continue;
        const px = (((Math.floor(x + i) % S) + S) % S) + (((Math.floor(y + j) % S) + S) % S) * S;
        blot[px] += (1 - d) * (1 - d) * 0.5;
      }
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const k = (y * S + x) * 4;
      // Ripstop: a fine weave with a heavier thread every 8.
      const fine = 0.5 + 0.25 * Math.sin((x / S) * Math.PI * 64) * Math.sin((y / S) * Math.PI * 64);
      const rip = x % 16 === 0 || y % 16 === 0 ? 0.85 : 0;
      img.data[k] = Math.round(Math.min(1, fine + rip * 0.3 + (rnd() - 0.5) * 0.12) * 255);
      // Knit: rows of little vees.
      const knit = 0.5 + 0.5 * Math.sin((y / S) * Math.PI * 40 + Math.abs(((x % 8) - 4) / 4) * 2.2);
      img.data[k + 1] = Math.round(knit * 255);
      img.data[k + 2] = Math.round(Math.min(1, blot[y * S + x]) * 255);
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  weaveTex = new CanvasTexture(c);
  weaveTex.wrapS = weaveTex.wrapT = RepeatWrapping;
  weaveTex.colorSpace = SRGBColorSpace;
  return weaveTex;
}

const lin = (hex: string) => new Color(hex);

/** The suit's material for one body (its skin shows only in the slit; its armband in its colour). */
export function suitMaterial(look: Look, tier: Tier, rest: Record<BoneName, V3>): Material {
  const eyeL = rest.eyeL;
  const eyeR = rest.eyeR;
  const u = {
    weaveMap: { value: weave() },
    skinCol: { value: lin(SKIN_TONES[look.skin] ?? SKIN_TONES[3]) },
    bandCol: { value: lin(HOODIE_COLORS[look.hoodie]?.hex ?? "#c8a040") },
    eyeC: { value: new Vector3((eyeL.x + eyeR.x) / 2, (eyeL.y + eyeR.y) / 2, Math.max(eyeL.z, eyeR.z)) },
    eyeHalf: { value: new Vector2(Math.abs(eyeL.x - eyeR.x) * 0.5 + 0.024, 0.0145) },
  };
  const lit = tier === 0;
  const mat = lit ? new MeshLambertMaterial({ color: 0xffffff }) : new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float region;\nattribute vec4 pal;\nattribute float accent;\nflat varying int vReg;\nvarying vec3 vBind;\nvarying vec3 vBindN;\nvarying vec4 vPal;\nvarying float vAcc;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBind = position; vBindN = normal; vReg = int(region + 0.5); vPal = pal; vAcc = accent;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        flat varying int vReg; varying vec3 vBind; varying vec3 vBindN; varying vec4 vPal; varying float vAcc;
        uniform sampler2D weaveMap; uniform vec3 skinCol, bandCol, eyeC; uniform vec2 eyeHalf;
        vec3 tri(vec3 p, vec3 n) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-5);
          return texture2D(weaveMap, p.zy).rgb * w.x + texture2D(weaveMap, p.xz).rgb * w.y + texture2D(weaveMap, p.xy).rgb * w.z;
        }
        float hgt; float rough = 0.85; float metal = 0.0;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 wv = tri(vBind * 9.0, vBindN);
          vec3 wear = tri(vBind * 3.0, vBindN);
          int r = vReg;
          // The blended palette: colour (×0.1) and roughness per vertex.
          vec3 c = vPal.rgb * 0.1;
          rough = vPal.a;
          hgt = wv.r * 0.6;
          if (r == 0 || r == 1 || r == 7) {
            // Ripstop, worn a little grey at the knees, the seat, the elbows.
            c *= 0.82 + 0.36 * wv.r;
            c = mix(c, vec3(0.075, 0.072, 0.068), smoothstep(0.35, 0.9, wear.b) * 0.16);
          } else if (r == 5) {
            c *= 0.9 + 0.15 * wv.g; hgt = wv.g * 0.5;
          } else if (r == 6) {
            c *= 0.9 + 0.2 * wv.r;
            if (abs(vBind.x) < 0.032 && vBindN.z > 0.6) { c = vec3(0.16, 0.165, 0.17); rough = 0.32; metal = 0.85; }
          } else if (r == 2 || r == 10) {
            c *= 0.9 + 0.2 * wear.g; hgt = r == 10 ? 0.7 : wear.g * 0.3;
          } else if (r == 11) {
            hgt = step(0.5, fract(vBind.z * 60.0));
          } else if (r == 3) {
            // Leather with creases; laces up the front of the shaft and over the instep; a darker toe cap.
            c *= 0.85 + 0.25 * wear.r;
            float lace = step(0.72, fract(vBind.y * 70.0 + abs(vBind.x - sign(vBind.x) * 0.09) * 30.0));
            if (vBindN.z > 0.55 && vBind.y > 0.05 && vBind.y < 0.24) { c = mix(c, vec3(0.012), lace); hgt = lace; }
            if (vBind.z > 0.1 && vBind.y < 0.07) c *= 0.7;
          } else if (r == 4) {
            // The balaclava: one slit (the eyes and the bridge of the nose).
            vec3 d = vBind - eyeC;
            float e = (d.x * d.x) / (eyeHalf.x * eyeHalf.x);
            bool slit = abs(d.x) < eyeHalf.x && abs(d.y + 0.002) < eyeHalf.y * (1.0 - 0.45 * e) && d.z > -0.06;
            bool bridge = abs(d.x) < 0.010 && d.y < 0.0 && d.y > -0.03 && d.z > -0.02;
            if (slit || bridge) { c = mix(skinCol, vec3(dot(skinCol, vec3(0.33))), 0.3) * (0.24 + 0.2 * smoothstep(-0.03, 0.01, d.z)) * (0.75 + 0.25 * smoothstep(eyeHalf.y, 0.0, d.y)); rough = 0.6; hgt = 0.0; }
            else { c *= 0.85 + 0.3 * wv.g; hgt = wv.g; }
          } else if (r == 9) {
            vec3 en = normalize(vBindN);
            float z = en.z;
            c = vec3(0.7, 0.68, 0.64);
            if (z > 0.84) c = vec3(0.1, 0.06, 0.03);
            if (z > 0.95) c = vec3(0.008);
            rough = 0.12; hgt = 0.0;
            // The lids over the top and bottom of the ball: an almond opening.
            float lid = en.y > 0.36 + 0.1 * abs(en.x) || en.y < -0.3 - 0.08 * abs(en.x) ? 1.0 : 0.0;
            if (lid > 0.5) { c = mix(skinCol, vec3(dot(skinCol, vec3(0.33))), 0.3) * 0.3; rough = 0.6; }
          }
          c = mix(c, bandCol * (0.8 + 0.25 * wv.r), vAcc);
          diffuseColor.rgb = c;
        }`,
      );
    if (!lit) {
      s.fragmentShader = s.fragmentShader
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = rough;")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = metal;")
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          {
            // Bump from the weave's height (screen-space derivatives): stitches and knit catch the light.
            vec3 sp = -vViewPosition;
            vec3 sx = normalize(dFdx(sp)), sy = normalize(dFdy(sp));
            vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
            float det = dot(sx, r1);
            vec2 dh = vec2(dFdx(hgt), dFdy(hgt)) * 0.06;
            vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
            normal = normalize(abs(det) * normal - g);
          }`,
        );
    }
  };
  mat.customProgramCacheKey = () => `suit:${lit ? "l" : "s"}`;
  return mat;
}
