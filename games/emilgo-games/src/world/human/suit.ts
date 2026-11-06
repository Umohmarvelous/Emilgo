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
import { HOODIE_COLORS, HOODIE_DESIGNS, type Look } from "./wardrobe";

/** v5: one skin tone for everyone, fair (the owner); only the eyes and nose show it. */
const FAIR = "#e8c4a8";
const BLACK = HOODIE_COLORS.findIndex((c) => c.id === "black");

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

/** The design's second colour: near black on a colour, a mid grey on black; gold on the two top ones. */
function suitAlt(look: Look): Color {
  if (look.design === "royal" || look.design === "titan") return new Color(0.75, 0.52, 0.14);
  if (look.hoodie === BLACK) return new Color(0.2, 0.21, 0.22);
  return lin(HOODIE_COLORS[look.hoodie]?.hex ?? "#1d1d20").multiplyScalar(0.18);
}

/** The suit's material for one body (its skin shows only in the slit; its armband in its colour). */
export function suitMaterial(look: Look, tier: Tier, rest: Record<BoneName, V3>): Material {
  const eyeL = rest.eyeL;
  const eyeR = rest.eyeR;
  const u = {
    weaveMap: { value: weave() },
    skinCol: { value: lin(FAIR) },
    bandCol: { value: lin(look.hoodie === BLACK ? "#5a5f66" : HOODIE_COLORS[look.hoodie]?.hex ?? "#c8a040") },
    // v5: the suit's colour and design (black and plain until you change them in Customize).
    suitA: { value: look.hoodie === BLACK ? new Color(0.034, 0.036, 0.041) : lin(HOODIE_COLORS[look.hoodie]?.hex ?? "#1d1d20") },
    suitB: { value: suitAlt(look) },
    design: { value: Math.max(0, HOODIE_DESIGNS.findIndex((d) => d.id === look.design)) },
    eyeC: { value: new Vector3((eyeL.x + eyeR.x) / 2, (eyeL.y + eyeR.y) / 2, Math.max(eyeL.z, eyeR.z)) },
    eyeHalf: { value: new Vector2(Math.abs(eyeL.x - eyeR.x) * 0.5 + 0.024, 0.0145) },
  };
  const lit = tier === 0;
  const mat = lit ? new MeshLambertMaterial({ color: 0xffffff }) : new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float region;\nattribute vec4 pal;\nattribute float accent;\nflat varying int vReg;\nvarying float vRS;\nvarying float vRS2;\nvarying vec3 vBind;\nvarying vec3 vBindN;\nvarying vec4 vPal;\nvarying float vAcc;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBind = position; vBindN = normal; vReg = int(region + 0.5); vRS = region; vRS2 = region * region; vPal = pal; vAcc = accent;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        flat varying int vReg; varying float vRS, vRS2; varying vec3 vBind; varying vec3 vBindN; varying vec4 vPal; varying float vAcc;
        uniform sampler2D weaveMap; uniform vec3 skinCol, bandCol, eyeC, suitA, suitB; uniform vec2 eyeHalf; uniform int design;
        // The suit's pattern, on the bind pose in metres, so it never swims (order: HOODIE_DESIGNS).
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
        }
        vec3 suitPattern(vec3 p, vec3 n) {
          float y = p.y; float ax = abs(p.x);
          vec2 q = abs(n.x) > 0.6 ? p.zy : p.xy;
          float m = 0.0;
          if (design == 1) m = step(y, 0.98);                                  // Two-tone: the legs
          else if (design == 2) m = step(1.2, y) * step(y, 1.29) * step(ax, 0.2); // Chest stripe
          else if (design == 3) m = step(0.5, fract((q.x + q.y) * 9.0)) * step(0.5, fract((q.x - q.y) * 9.0)); // Geometric
          else if (design == 4) m = step(0.98, y) * step(p.x, 0.0);            // Colour block: half the top
          else if (design == 5) m = step(0.72, abs(n.x)) * step(y, 1.42);      // Side stripes: down the arms and legs
          else if (design == 6) m = smoothstep(0.4, 0.62, vnoise(q * 7.0)) * 0.7; // Washed
          else if (design == 7) m = step(0.56, vnoise(q * 6.0));               // Urban camo
          else if (design == 8) m = step(0.55, hash2(floor(q * 26.0)));        // Digital camo
          else if (design == 9) m = step(0.5, fract(p.y * 7.0 + vnoise(q * 5.0) * 1.3)); // Tiger stripe
          else if (design == 10) m = step(0.5, fract((q.x + q.y) * 80.0)) * 0.55; // Carbon weave
          else if (design == 11) m = step(1.2, y) * step(y, 1.24) + step(0.8, abs(n.x)) * step(y, 0.95) * 0.0 + step(0.965, y) * step(y, 0.995); // Gold trim: chest and hip lines
          else if (design == 12) m = step(0.56, vnoise(q * 9.0)) * step(0.5, fract(p.y * 16.0)) + step(1.2, y) * step(y, 1.24); // Titan
          return mix(suitA, suitB, clamp(m, 0.0, 1.0));
        }
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
          {
            // Where a triangle spans two regions, the flat region alone switches per triangle
            // (a sawtooth edge). From the region's mean and mean square, find the other region
            // and how far toward it this point is: the boundary runs straight through the
            // triangle, the same on both sides of an edge (v4 rework: no jagged cuffs and pads).
            float a = float(vReg);
            float d = vRS - a;
            if (abs(d) > 0.01) {
              float v = max(vRS2 - vRS * vRS, 0.0);
              float span = (v + d * d) / d;
              if (d / span > 0.5) r = clamp(int(floor(a + span + 0.5)), 0, 11);
            }
          }
          // The blended palette: colour (×0.1) and roughness per vertex.
          vec3 c = vPal.rgb * 0.1;
          rough = vPal.a;
          hgt = wv.r * 0.6;
          if (r == 0 || r == 1 || r == 7) {
            // One black for the suit and the mannequin's joint gussets (no darker V at the hips,
            // no outlined shoulder caps): the suit reads as one garment.
            if (r <= 1) { c = suitPattern(vBind, vBindN); rough = 0.88; }
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
  mat.customProgramCacheKey = () => `suit2:${lit ? "l" : "s"}`;
  return mat;
}
