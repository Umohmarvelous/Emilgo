import { Document, NodeIO } from '@gltf-transform/core';
export async function writeGlb(path, parts) {
  const doc = new Document(); const buf = doc.createBuffer(); const scene = doc.createScene();
  for (const p of parts) {
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p.P)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(p.I)).setBuffer(buf));
    if (p.N) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p.N)).setBuffer(buf));
    if (p.C) prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p.C)).setBuffer(buf));
    prim.setMaterial(doc.createMaterial().setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.8).setMetallicFactor(0));
    scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  }
  await new NodeIO().write(path, doc);
}
