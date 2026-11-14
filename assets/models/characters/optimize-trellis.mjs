/**
 * Mobile LOD pipeline for Trellis-exported GLB.
 *
 * Trellis bakes a chart-dense UV atlas: ~27% of edges are UV-chart boundaries
 * and 56% of positions are split into wedges. meshoptimizer locks those, so the
 * as-exported mesh cannot simplify below ~39k triangles. Two outputs follow:
 *
 *   uvsafe  - original wedges kept, atlas stays valid, floors at ~39k tris.
 *   LOD0..2 - positions welded first (unlocks any budget), base color baked to
 *             COLOR_0 because merging wedges invalidates the atlas.
 *
 * Usage: node final.mjs <in.glb> <outDir> <budget>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { dedup, weld, simplify, prune, textureCompress, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { basename, join as pjoin } from 'node:path';
import { statSync, mkdirSync } from 'node:fs';

const [src, outDir, budgetArg] = process.argv.slice(2);
const BUDGET = Number(budgetArg);
const stem = basename(src, '.glb');

const triCount = (doc) => doc.getRoot().listMeshes().reduce((n, m) =>
  n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);

function rigInfo(doc) {
  const root = doc.getRoot();
  const skinned = root.listMeshes().some((m) => m.listPrimitives().some(
    (p) => p.getAttribute('JOINTS_0') || p.getAttribute('WEIGHTS_0')));
  return { skins: root.listSkins().length, anims: root.listAnimations().length, skinned };
}

function nameTexturesBySlot(doc) {
  for (const mat of doc.getRoot().listMaterials()) {
    for (const [slot, tex] of Object.entries({
      baseColor: mat.getBaseColorTexture(),
      metallicRoughness: mat.getMetallicRoughnessTexture(),
      normal: mat.getNormalTexture(),
      occlusion: mat.getOcclusionTexture(),
      emissive: mat.getEmissiveTexture(),
    })) if (tex && !tex.getName()) tex.setName(slot);
  }
}

/**
 * Collapse wedges so one vertex remains per unique position, leaving no orphan
 * vertices behind -- stray duplicates keep meshoptimizer seeing multi-wedge
 * positions and raise the floor instead of lowering it.
 */
function weldByPosition(doc) {
  const buffer = doc.getRoot().listBuffers()[0];
  let mergedTotal = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices().getArray();
      const semantics = prim.listSemantics();
      const srcAttr = Object.fromEntries(semantics.map((s) => {
        const a = prim.getAttribute(s);
        return [s, { arr: a.getArray(), n: a.getType() === 'VEC2' ? 2 : a.getType() === 'VEC4' ? 4 : 3, type: a.getType() }];
      }));
      const pos = srcAttr.POSITION.arr;
      const V = prim.getAttribute('POSITION').getCount();

      const rep = new Map(); const remap = new Int32Array(V); const order = [];
      for (let v = 0; v < V; v++) {
        const k = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
        if (!rep.has(k)) { rep.set(k, order.length); order.push(v); }
        remap[v] = rep.get(k);
      }
      mergedTotal += V - order.length;

      for (const s of semantics) {
        const { arr, n, type } = srcAttr[s];
        const dst = new Float32Array(order.length * n);
        order.forEach((srcIdx, d) => {
          for (let c = 0; c < n; c++) dst[d * n + c] = arr[srcIdx * n + c];
        });
        prim.setAttribute(s, doc.createAccessor().setType(type).setArray(dst).setBuffer(buffer));
      }
      const I = new Uint32Array(idx.length);
      for (let i = 0; i < idx.length; i++) I[i] = remap[idx[i]];
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(I).setBuffer(buffer));
    }
  }
  return mergedTotal;
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * Sample the base color atlas at each surviving vertex's UV into COLOR_0.
 * Simplification only ever removes vertices, so every survivor keeps a real
 * original UV -- making this bake seam-free regardless of chart merging.
 */
async function bakeVertexColors(doc) {
  const buffer = doc.getRoot().listBuffers()[0];
  const mat = doc.getRoot().listMaterials()[0];
  const tex = mat && mat.getBaseColorTexture();
  if (!tex) return false;
  const { data, info } = await sharp(Buffer.from(tex.getImage()))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;

  const sample = (u, v) => {
    // glTF UV origin is top-left with v increasing downward.
    let x = u * W - 0.5, y = v * H - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const cl = (n, max) => Math.min(max - 1, Math.max(0, n));
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const px = (xx, yy) => data[(cl(yy, H) * W + cl(xx, W)) * C + c] / 255;
      const top = px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx;
      const bot = px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx;
      out[c] = srgbToLinear(top * (1 - fy) + bot * fy);
    }
    return out;
  };

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const uvAttr = prim.getAttribute('TEXCOORD_0');
      if (!uvAttr) continue;
      const uv = uvAttr.getArray();
      const n = uvAttr.getCount();
      const col = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const [r, g, b] = sample(uv[i * 2], uv[i * 2 + 1]);
        col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = 1;
      }
      prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(col).setBuffer(buffer));
      prim.setAttribute('TEXCOORD_0', null);
    }
  }
  // COLOR_0 multiplies baseColorFactor, so neutralize the factor and drop maps.
  mat.setBaseColorTexture(null).setMetallicRoughnessTexture(null)
    .setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.7);
  return true;
}

function addDraco(doc) {
  doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
    encodeSpeed: 5, decodeSpeed: 5,
    quantizationBits: { POSITION: 14, NORMAL: 10, TEX_COORD: 12, COLOR: 8, GENERIC: 12 },
  });
}

async function makeIO() {
  await MeshoptSimplifier.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });
}

async function emit(io, doc, name) {
  const out = pjoin(outDir, `${stem}_${name}.glb`);
  await io.write(out, doc);
  return { file: basename(out), tris: triCount(doc), kb: Math.round(statSync(out).size / 1024) };
}

const io = await makeIO();
mkdirSync(outDir, { recursive: true });
const report = { src: basename(src), rig: null, variants: [] };

// ---- Variant 1: UV-safe. Atlas preserved; reports the real floor. ----
{
  const doc = await io.read(src);
  report.rig = rigInfo(doc);
  await doc.transform(dedup(), flatten(), join(), weld());
  const before = triCount(doc);
  nameTexturesBySlot(doc);
  await doc.transform(
    simplify({ simplifier: MeshoptSimplifier, ratio: BUDGET / before, error: 0.05, lockBorder: false }),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85, pattern: /baseColor|emissive/i, resize: [2048, 2048] }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, pattern: /metallicRoughness|occlusion|normal/i, resize: [1024, 1024] }),
  );
  addDraco(doc);
  const r = await emit(io, doc, 'uvsafe');
  report.variants.push({ ...r, kind: 'uv-safe (atlas intact, floors above budget)', textured: true, before });
}

// ---- Variant 2: welded LOD chain at 100/50/25% of budget, vertex-colored. ----
for (const [name, frac] of [['LOD0', 1], ['LOD1', 0.5], ['LOD2', 0.25]]) {
  const target = Math.round(BUDGET * frac);
  const doc = await io.read(src);
  await doc.transform(dedup(), flatten(), join(), weld());
  const merged = weldByPosition(doc);
  const before = triCount(doc);
  await doc.transform(
    simplify({ simplifier: MeshoptSimplifier, ratio: target / before, error: 0.05, lockBorder: false }),
  );
  const baked = await bakeVertexColors(doc);
  await doc.transform(prune());
  // prune() leaves the extension declared; a *required* EXT_texture_webp with
  // zero textures can trip strict loaders.
  if (doc.getRoot().listTextures().length === 0) {
    for (const ext of doc.getRoot().listExtensionsUsed()) {
      if (ext.extensionName === 'EXT_texture_webp') ext.dispose();
    }
  }
  addDraco(doc);
  const r = await emit(io, doc, name);
  report.variants.push({ ...r, kind: `welded + vertex-color (target ${target})`, target, baked, merged, textured: false });
}

console.log('__REPORT__' + JSON.stringify(report));
