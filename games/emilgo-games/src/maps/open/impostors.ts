// Scanned trees as impostors (v6 max, 3.4: "realistic trees (CC0 scans)"). A
// scanned tree is millions of triangles; a phone shows it as a card turned to
// the camera, painted from the scan: dev/impostor.ts rendered each tree from 12
// directions round it into a colour atlas and a normal atlas, and
// tools/assets/trees.ts baked them to KTX2 (lib/trees/). Here:
//
//   the draw   one instanced quad per tree, one draw per kind per cell. The
//              vertex shader turns the quad to the camera (about the vertical)
//              and picks the two baked views nearest the camera's bearing round
//              the tree (each tree turned its own way, so a row of them differ);
//              the fragment blends them and cuts out the empty space
//   the light  the baked normals (each view's own camera space) are put back
//              into the world, so the sun and the sky light the leaves as they
//              do the rest; the snow pines whiten whatever faces up. Low: no
//              normal atlas, a flat card lit facing you
//   the wind   none since v7 (the owner saw them move): the crown stands still
//
// Nothing breaks without them: no KTX2, no files: the drawn trees, as before.

import { BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshLambertMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, Sphere, Vector3, type Material, type Texture } from "three";

import type { TierSpec } from "../../graphics/tiers";
import { ktxFile, ktxOn, libJson } from "../../assets/ktx";
import type { TreeAt } from "./art";
import { PINE_CLEAR } from "./prefabs";

export type Species = "broadA" | "broadB" | "pine";

interface Meta {
  views: number;
  cols: number;
  rows: number;
  /** The square frame's side and the tree's height (m, as scanned). */
  size: number;
  height: number;
  files: Record<string, string>;
}

export interface Impostor {
  a: Texture;
  n: Texture | null;
  meta: Meta;
  /** The atlases' view size this tier took (px). */
  tile: number;
}

export type ImpostorSet = Partial<Record<Species, Impostor>>;

/** The species' scans (tools/assets/trees.ts). */
const SOURCE: Record<Species, string> = { broadA: "island_tree_02", broadB: "island_tree_01", pine: "fir_sapling_medium" };

/**
 * Each scan's colour graded to the world's (linear gains). The fir was shot in a dim forest and comes out a near
 * black olive (sRGB 47, 50, 29 on average): lifted and greened to a spruce's; the broadleaves a touch greener.
 */
const GRADE: Record<Species, [number, number, number]> = { broadA: [1.08, 1.22, 1.05], broadB: [1.08, 1.22, 1.05], pine: [1.5, 2.1, 1.9] };

/** The impostors this tier draws with, or null (the drawn trees then). */
export async function loadImpostors(spec: TierSpec): Promise<ImpostorSet | null> {
  if (!ktxOn()) return null;
  const list = (await libJson("trees/trees.json")) as { species?: Record<string, Meta> } | null;
  if (!list?.species) return null;
  const tile = spec.tier === 0 ? 256 : 512;
  const out: ImpostorSet = {};
  await Promise.all(
    (Object.keys(SOURCE) as Species[]).map(async (sp) => {
      const meta = list.species![SOURCE[sp]];
      const fa = meta?.files[`a.${tile}`];
      const fn = meta?.files[`n.${tile}`];
      if (!meta || !fa) return;
      const [a, n] = await Promise.all([ktxFile(fa, 4), spec.pbr && fn ? ktxFile(fn, 4) : Promise.resolve(null)]);
      if (a) out[sp] = { a, n, meta, tile };
      else n?.dispose();
    }),
  );
  // Both kinds or none: half the forest scanned and half drawn would look odd.
  if (!(out.broadA || out.broadB) || !out.pine) {
    for (const v of Object.values(out)) {
      v?.a.dispose();
      v?.n?.dispose();
    }
    return null;
  }
  return out;
}

/** Which species draws a tree (broadleaf: one scan or the other, by where it stands). */
export function speciesOf(t: TreeAt, set: ImpostorSet): Species {
  if (t.kind !== "broad") return "pine";
  const pick = (Math.floor(t.x * 7.31 + t.z * 3.17) & 1) === 0 ? "broadA" : "broadB";
  return set[pick] ? pick : set.broadA ? "broadA" : "broadB";
}

const quads = new Map<string, BufferGeometry>();
/** A unit card standing on its foot (x −½…½, y 0…1), sized to the frame (in tree heights). */
function quad(k: number): BufferGeometry {
  const key = k.toFixed(3);
  let g = quads.get(key);
  if (!g) {
    g = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
    g.deleteAttribute("normal");
    g.setAttribute("normal", new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    // The card is turned and sized in the shader: bound it as the frame round its foot.
    g.boundingSphere = new Sphere(new Vector3(0, k / 2, 0), k * 0.75);
    quads.set(key, g);
  }
  return g;
}

const mats = new Map<string, Material>();

/** The impostor material for a species (shared by every cell). */
export function impostorMaterial(spec: TierSpec, sp: Species, imp: Impostor, time: { value: number }): Material {
  const key = `${sp}|${spec.tier}|${spec.pbr}`;
  const have = mats.get(key);
  if (have) return have;
  const m = spec.pbr ? new MeshStandardMaterial({ roughness: 0.95, metalness: 0 }) : new MeshLambertMaterial();
  const k = imp.meta.size / imp.meta.height;
  const withN = !!imp.n && spec.pbr;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uA: { value: imp.a },
      uN: { value: imp.n },
      uViews: { value: imp.meta.views },
      uCols: { value: imp.meta.cols },
      uRows: { value: imp.meta.rows },
      uQuad: { value: k },
      uTexPx: { value: [imp.meta.cols * imp.tile, imp.meta.rows * imp.tile] },
      uGrade: { value: GRADE[sp] },
      uTime: time,
      // v7 (2.6): a pine's lowest needles are cut away up to PINE_CLEAR, the trunk kept (a body walks under them).
      uClear: { value: sp === "pine" ? PINE_CLEAR : 0 },
    });
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aYaw;
        attribute float aSnow;
        uniform float uViews; uniform float uCols; uniform float uRows; uniform float uQuad; uniform float uTime;
        varying vec2 vUvA; varying vec2 vUvB; varying float vMix; varying float vSnow; varying vec2 vMet;
        varying vec3 vRight; varying vec3 vFwd;
        vec2 tileUv(float i, vec2 l) {
          float col = mod(i, uCols); float row = floor(i / uCols);
          return vec2((col + l.x) / uCols, (uRows - row - 1.0 + l.y) / uRows);
        }`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `vec3 orgW = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec2 dIr = normalize(cameraPosition.xz - orgW.xz + vec2(1e-4, 0.0));
        vec3 rightW = vec3(dIr.y, 0.0, -dIr.x);
        vec3 objectNormal = vec3(dIr.x, 0.0, dIr.y);
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = rightW * position.x * uQuad + vec3(0.0, position.y * uQuad, 0.0);
        // v7 (the owner: "they are moving"): no sway; the crown stands still. (The card still turns to face you: a
        // flat picture has to. Real 3D trees are SPEC-V7 3.3.)
        float az = atan(dIr.x, dIr.y) - aYaw;
        float f = mod(az / 6.2831853 * uViews, uViews);
        float i0 = floor(f);
        vMix = f - i0;
        vec2 l = vec2(position.x + 0.5, position.y);
        vUvA = tileUv(i0, l);
        vUvB = tileUv(mod(i0 + 1.0, uViews), l);
        vSnow = aSnow;
        // Metres from the trunk's axis, and up from the foot (the instance's scale is the tree's height).
        float hM = length(instanceMatrix[1].xyz);
        vMet = vec2(position.x * uQuad * hM, position.y * uQuad * hM);
        vRight = rightW;
        vFwd = vec3(dIr.x, 0.0, dIr.y);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uA; uniform sampler2D uN; uniform vec2 uTexPx; uniform vec3 uGrade; uniform float uClear;
        varying vec2 vUvA; varying vec2 vUvB; varying float vMix; varying float vSnow; varying vec2 vMet;
        varying vec3 vRight; varying vec3 vFwd;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        vec4 imA = texture2D(uA, vUvA);
        vec4 imB = texture2D(uA, vUvB);
        vec4 imC = mix(imA, imB, vMix);
        // The cut-out holds up far off: the smaller mipmaps average the twigs and needles into the empty space round
        // them, and a plain test at ½ would thin the crown to nothing with distance. Scale the alpha up with the
        // mipmap level the GPU reads (Golus's fix for alpha-tested foliage).
        {
          vec2 tp = vUvA * uTexPx;
          float lod = max(0.0, 0.5 * log2(max(dot(dFdx(tp), dFdx(tp)), dot(dFdy(tp), dFdy(tp)))));
          imC.a *= 1.0 + lod * 0.3;
        }
        if (imC.a < 0.5) discard;
        if (vMet.y < uClear && abs(vMet.x) > 0.3 - 0.1 * vMet.y / max(uClear, 0.01)) discard;
        diffuseColor.rgb *= imC.rgb * uGrade;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        ${
          withN
            ? `vec3 imN = mix(texture2D(uN, vUvA).xyz, texture2D(uN, vUvB).xyz, vMix) * 2.0 - 1.0;
               vec3 imW = normalize(imN.x * vRight + imN.y * vec3(0.0, 1.0, 0.0) + imN.z * vFwd);
               normal = normalize((viewMatrix * vec4(imW, 0.0)).xyz);
               // Snow on the Frostline's pines: lying on what faces up, a dusting over the rest.
               diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.95), vSnow * (0.3 + 0.6 * smoothstep(-0.15, 0.45, imW.y)));`
            : `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.91, 0.93), vSnow * 0.55);`
        }`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        {
          // Leaves aren't stone. Lit from behind, a leaf lets the sun through (the side away from the sun gets some
          // of it), more still looking toward the sun's disc; and the light scatters round through the crown (a
          // wrapped light at the edge between lit and unlit). Not on the snow.
          vec3 sunV = directionalLights[0].direction;
          float nl = dot(normal, sunV);
          float back = saturate(-nl) * 0.55;
          float wrap = (saturate((nl + 0.5) / 1.5) - saturate(nl)) * 0.6;
          float fwd = pow(saturate(dot(-geometryViewDir, sunV)), 4.0) * 0.45;
          reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * RECIPROCAL_PI * (back + wrap + fwd) * (1.0 - vSnow * 0.6);
        }
        #endif`,
      );
  };
  m.customProgramCacheKey = () => `impostor4:${withN}`;
  mats.set(key, m);
  return m;
}

const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();

/** One cell's trees of one species: one instanced draw. */
export function impostorMesh(spec: TierSpec, sp: Species, imp: Impostor, trees: readonly TreeAt[], time: { value: number }): InstancedMesh {
  const k = imp.meta.size / imp.meta.height;
  const im = new InstancedMesh(quad(k), impostorMaterial(spec, sp, imp, time), trees.length);
  const yaw = new Float32Array(trees.length);
  const snow = new Float32Array(trees.length);
  trees.forEach((t, j) => {
    _m.compose(_p.set(t.x, t.y, t.z), _q, _s.setScalar(t.h));
    im.setMatrixAt(j, _m);
    // Each its own way round: a hash of where it stands.
    yaw[j] = ((Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1) * Math.PI * 2;
    snow[j] = t.kind === "snow" ? 1 : 0;
  });
  im.geometry = im.geometry.clone();
  im.geometry.boundingSphere = quad(k).boundingSphere!.clone();
  im.geometry.setAttribute("aYaw", new InstancedBufferAttribute(yaw, 1));
  im.geometry.setAttribute("aSnow", new InstancedBufferAttribute(snow, 1));
  im.computeBoundingSphere();
  im.castShadow = false;
  im.receiveShadow = spec.shadows;
  return im;
}
