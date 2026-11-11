// Grass, close to (v6 max, 3.3/3.4: "the mangrove's stones, river and grass", the v4 forest's meadow). Tufts of
// blades on the grass ground round the camera: two crossed cards each, a canvas of blades, cut out.
//
//   where     the grass ground only (the layout's groundAt), where nothing stands (space.topNear), not in
//             standing water; the forest's floor thicker, the savanna's thinner and drier
//   when      a cell's tufts are made the first time the camera comes near it (a few hundred tests: about a
//             millisecond), one cell a frame, and dropped again far off: the world's build pays nothing
//   the look  each tuft its own size, turn and green (drier where the noise says so); lit as the ground is (the
//             normals point up); the tips sway; far off they sink into the ground instead of popping out
//   tiers     High: a tuft every 1.7 m, out to 60 m; Medium: every 2.4 m, out to 42 m; Low: none

import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { Space } from "../../game/core/space";
import type { TierSpec } from "../../graphics/tiers";
import { inPond, type OpenLayout } from "./naija";
import { patchField } from "./patches";

const CELL = 50;

function bladeTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const x = 8 + rnd() * 112;
    const k = 0.55 + rnd() * 0.6;
    g.strokeStyle = `rgb(${Math.round(98 * k)},${Math.round(122 * k)},${Math.round(62 * k)})`;
    g.lineWidth = 1.2 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x + (rnd() - 0.5) * 20, 80, x + (rnd() - 0.5) * 36, 14 + rnd() * 60);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function tuftGeometry(): BufferGeometry {
  const a = new PlaneGeometry(1.4, 0.6).translate(0, 0.3, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = mergeGeometries([a, b])!;
  // Lit as the ground under it: every normal up.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  g.setAttribute("normal", new Float32BufferAttribute(n.array as Float32Array, 3));
  return g;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _c = new Color();

export class GrassField {
  private readonly step: number;
  private readonly reach: number;
  private readonly geo = tuftGeometry();
  private readonly mat: Material;
  private readonly made = new Map<number, InstancedMesh | null>();
  private readonly n: number;
  private tick = 0;

  constructor(
    private readonly L: OpenLayout,
    private readonly space: Space,
    spec: TierSpec,
    time: { value: number },
    private readonly group: Group,
  ) {
    this.step = spec.tier >= 2 ? 1.4 : 2;
    this.reach = spec.tier >= 2 ? 60 : 42;
    this.n = Math.ceil((L.half * 2) / CELL);
    const map = bladeTexture();
    const m = spec.pbr ? new MeshStandardMaterial({ map, alphaTest: 0.45, side: DoubleSide, roughness: 0.95 }) : new MeshLambertMaterial({ map, alphaTest: 0.45, side: DoubleSide });
    const reach = this.reach;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vGTip;").replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec3 org = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          // Far off, the tuft sinks into the ground (no popping at the edge of the reach).
          float far = 1.0 - smoothstep(${(reach * 0.65).toFixed(1)}, ${reach.toFixed(1)}, distance(org.xz, cameraPosition.xz));
          transformed.y *= far;
          float tip = position.y / 0.6;
          vGTip = tip;
          transformed.xz += vec2(sin(uTime * 1.7 + org.x * 0.5 + org.z * 0.3), cos(uTime * 1.3 + org.z * 0.45)) * 0.08 * tip * tip;
        }`,
      );
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vGTip;")
        .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= 0.5 + 0.5 * vGTip;")
        // Lit as the ground is, whichever side of the card faces you (a back face would flip it down: black).
        .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);");
    };
    m.customProgramCacheKey = () => `grass2:${reach}`;
    this.mat = m;
  }

  /** Make the nearest cell the camera wants (one every third call: about 2 ms each on a laptop), drop the far ones. */
  update(cam: Vector3): void {
    const { n } = this;
    const H = this.L.half;
    const ci = Math.floor((cam.x + H) / CELL);
    const cj = Math.floor((cam.z + H) / CELL);
    const r = Math.ceil(this.reach / CELL) + 1;
    if (this.tick++ % 3 === 0) {
      let best = -1;
      let bestD = this.reach + 10;
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= n || j >= n || this.made.has(j * n + i)) continue;
          // The camera's distance to the cell's square.
          const dx = Math.max(0, Math.abs(cam.x - (-H + (i + 0.5) * CELL)) - CELL / 2);
          const dz = Math.max(0, Math.abs(cam.z - (-H + (j + 0.5) * CELL)) - CELL / 2);
          const d = Math.hypot(dx, dz);
          if (d < bestD) {
            bestD = d;
            best = j * n + i;
          }
        }
      }
      if (best >= 0) this.made.set(best, this.make(best % n, Math.floor(best / n)));
    }
    // Drop what's well behind.
    for (const [k, m] of this.made) {
      const i = k % n;
      const j = Math.floor(k / n);
      if (Math.abs(i - ci) <= r + 2 && Math.abs(j - cj) <= r + 2) continue;
      if (m) {
        this.group.remove(m);
        m.dispose();
      }
      this.made.delete(k);
    }
  }

  private make(i: number, j: number): InstancedMesh | null {
    const { L, space, step } = this;
    const H = L.half;
    const x0 = -H + i * CELL;
    const z0 = -H + j * CELL;
    const pts: number[] = [];
    // A jittered grid: each square's tuft somewhere in it (a hash of where).
    for (let z = z0; z < z0 + CELL; z += step) {
      for (let x = x0; x < x0 + CELL; x += step) {
        const h1 = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
        const h2 = Math.sin(x * 39.3468 + z * 11.135) * 24634.6345;
        const fx = h1 - Math.floor(h1);
        const fz = h2 - Math.floor(h2);
        const px = x + fx * step;
        const pz = z + fz * step;
        if (L.groundAt(px, pz) !== "grass") continue;
        // Thinner on the open savanna (the noise's low half), thick in the places' meadows.
        const lush = patchField(px, pz, 60, 41);
        if (lush < 0.35 && fx > 0.55) continue;
        if (inPond(L.ponds, px, pz, -1)) continue;
        if (space.topNear(px, pz, 0.7) > 0.05) continue;
        pts.push(px, pz, lush, fz);
      }
    }
    if (!pts.length) return null;
    const count = pts.length / 4;
    const im = new InstancedMesh(this.geo, this.mat, count);
    for (let k = 0; k < count; k++) {
      const [px, pz, lush, f] = [pts[k * 4], pts[k * 4 + 1], pts[k * 4 + 2], pts[k * 4 + 3]];
      const s = 0.7 + f * 0.8 + lush * 0.4;
      _q.setFromAxisAngle(_up, f * 6.283);
      im.setMatrixAt(k, _m.compose(_p.set(px, 0, pz), _q, _s.set(s, s * (0.8 + lush * 0.6), s)));
      // Lush green to dry straw.
      const dry = Math.min(1, Math.max(0, (0.55 - lush) * 2.2));
      im.setColorAt(k, _c.setRGB(0.9 + dry * 0.3, 0.95 - dry * 0.1, 0.75 - dry * 0.25));
    }
    im.computeBoundingSphere();
    im.receiveShadow = true;
    im.updateMatrixWorld(true);
    this.group.add(im);
    return im;
  }

  dispose(): void {
    for (const m of this.made.values()) if (m) this.group.remove(m);
    this.made.clear();
    this.geo.dispose();
    this.mat.dispose();
  }
}
