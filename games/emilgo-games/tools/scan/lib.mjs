// Shared: load a Trellis original into plain arrays (welded by exact position), atlas decoded.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
export async function io() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule() });
}
export const SRC = { woman: '/Users/a0000/Downloads/3d_male_model.glb', man: '/Users/a0000/Downloads/3d_female_model.glb' };
export const HEIGHT = { man: 1.78, woman: 1.72 };
export async function loadOriginal(body) {
  const doc = await (await io()).read(SRC[body]);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute('POSITION').getArray();
  const N = prim.getAttribute('NORMAL').getArray();
  const UV = prim.getAttribute('TEXCOORD_0').getArray();
  const I = prim.getIndices().getArray();
  const tex = doc.getRoot().listMaterials()[0].getBaseColorTexture();
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // normalise: feet on y=0, scaled to height, centred in x/z on the body's mid-line
  let miny = Infinity, maxy = -Infinity;
  for (let i = 1; i < P.length; i += 3) { miny = Math.min(miny, P[i]); maxy = Math.max(maxy, P[i]); }
  const s = HEIGHT[body] / (maxy - miny);
  const pos = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) { pos[i] = P[i] * s; pos[i + 1] = (P[i + 1] - miny) * s; pos[i + 2] = P[i + 2] * s; }
  return { pos, nor: new Float32Array(N), uv: new Float32Array(UV), idx: new Uint32Array(I), atlas: { data, W: info.width, H: info.height, C: info.channels }, scale: s };
}
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function sampleAtlas(a, u, v) {
  const { data, W, H, C } = a;
  let x = u * W - 0.5, y = v * H - 0.5; const x0 = Math.floor(x), y0 = Math.floor(y); const fx = x - x0, fy = y - y0;
  const cl = (n, m) => Math.min(m - 1, Math.max(0, n)); const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const px = (xx, yy) => data[(cl(yy, H) * W + cl(xx, W)) * C + c];
    out[c] = (px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx) * (1 - fy) + (px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx) * fy;
  }
  return out; // sRGB 0..255
}
