# Trellis2 GLB -> mobile LODs

Generated with `@gltf-transform/cli` v4.5.1 (+ meshoptimizer, draco3dgltf, sharp).

## The constraint you need to know about

The Trellis export bakes a **chart-dense UV atlas**: ~27% of all edges are UV-chart
boundaries, and 56% of vertex positions are split into wedges (up to 11 per position).
The splits are 99.99% UV-only -- normals are identical across them.

meshoptimizer locks vertices at attribute discontinuities, so **the mesh as exported
cannot be simplified below ~39k triangles** no matter the target ratio or error budget.
Targeting 20k, 10k and 5k all returned ~39.2k. That is a topology floor, not a setting.

Welding by position first removes the floor completely (20k target -> 19,668 tris at
0.11% geometric error), but it merges UV charts, which invalidates the atlas:
76% of triangles at 20k, 85% at 10k and 91% at 5k end up spanning charts.

So you get two variants. Pick per use case.

## Variant A -- `*_uvsafe.glb` (atlas intact, over budget)

| file | tris | size | textures |
|---|---|---|---|
| 3d_male_model_uvsafe.glb | 39,214 | 1.1 MB | 2048 baseColor + 1024 MR, WebP |
| 3d_female_model_uvsafe.glb | 34,994 | 911 KB | 2048 baseColor + 1024 MR, WebP |

Full original texture quality. **Misses the 20k budget** -- this is the floor described
above. Use for hero/close-up rendering, or as the source for a proper re-bake.

## Variant B -- `*_LOD0/1/2.glb` (on budget, vertex-colored)

| file | tris | size |
|---|---|---|
| 3d_male_model_LOD0.glb | 19,668 | 91 KB |
| 3d_male_model_LOD1.glb | 9,726 | 52 KB |
| 3d_male_model_LOD2.glb | 4,914 | 30 KB |
| 3d_female_model_LOD0.glb | 19,600 | 95 KB |
| 3d_female_model_LOD1.glb | 9,798 | 49 KB |
| 3d_female_model_LOD2.glb | 4,884 | 26 KB |

100% / 50% / 25% of the 20k character budget. Since merged UVs break the atlas, base
color is baked into `COLOR_0` instead, sampled at each vertex's original UV and
converted sRGB -> linear (COLOR_0 is linear per glTF spec and multiplies
baseColorFactor, which is set to white). This is seam-free by construction:
simplification only ever *removes* vertices, so every survivor keeps a real original UV.

Trade-off: color detail drops from a 2048x2048 atlas to ~11k vertex samples. Reads fine
in motion and at distance; flat up close. Textures are dropped entirely, so these also
cost 0 MB of texture VRAM (vs 22 MB per 2048 map).

## To get textured geometry under 20k

Requires a re-unwrap + re-bake, which needs a tool not installed here (Blender, or
xatlas + a ray-cast transfer):

1. Take `*_uvsafe.glb` or a position-welded simplification as the target mesh.
2. Re-unwrap to a fresh atlas (xatlas / Blender Smart UV Project).
3. Bake base color from the **original** 291k-tri mesh onto the new UVs.

## Re-running

```sh
npm install @gltf-transform/cli
node optimize-trellis.mjs <input.glb> <outDir> <triangleBudget>
```

Budget is LOD0; LOD1/LOD2 derive at 50%/25%. Use `20000` for characters and `5000`
for props (no prop meshes were present in this batch -- both inputs are characters).

## Notes

- **Not rigged.** Both inputs have 0 skins, 0 animations and no JOINTS_0/WEIGHTS_0.
  Skin-aware simplification is therefore moot -- there is no animation to break. If you
  rig these later, re-run simplification *before* skinning, or re-check this.
- Draco applied last, after all geometry edits (EDGEBREAKER; position 14 bits,
  normal 10, uv 12, color 8).
- Source atlases were already `EXT_texture_webp`; re-encoded at q85/q80.
- The `-compressed.glb` files in Downloads are from an earlier pass and were not used.
