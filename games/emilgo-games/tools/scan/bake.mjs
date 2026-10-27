// Bake the visible parts of a scanned body (head, hands, feet) for the game.
//
//   node bake.mjs <man|woman> <out.json>
//
// The hoodie hides everything else, so only these parts are cut from the 300K
// original, each reduced to the four detail levels (far, Low, Medium, High).
// Every part is stored relative to its anchor bone (head, hand, foot) so the
// game's skeleton places it; skin weights use the game's bone names.
//
// Colour: the head gets a texture baked from the original's atlas through a
// spherical "lens" projection (more texels on the face); hands and feet get
// vertex colours averaged over the original surface — never one texel, which
// is what left dark streaks in the old LODs.
//
// The woman's scan has fused fingers: she gets the man's five-finger hands,
// scaled, and re-toned to her skin.
//
// Needs the 300K originals where lib.mjs SRC says (their filenames are
// swapped: 3d_male_model is the woman) and four packages the game doesn't
// carry: npm i --no-save @gltf-transform/core @gltf-transform/extensions
// draco3dgltf sharp. Then pack.mjs writes src/world/human/scan/.

import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { loadOriginal, sampleAtlas, srgbToLinear } from './lib.mjs';

await MeshoptSimplifier.ready;
const [body, outPath] = process.argv.slice(2);

// Per-body cut heights and anchors (metres, after scaling to the game height).
const CFG = {
  man: { neckCut: 1.465, headBase: 1.57, neckBase: 1.49, footCut: 0.135, ankleY: 0.085, handCut: 0.885 },
  woman: { neckCut: 1.375, headBase: 1.465, neckBase: 1.40, footCut: 0.13, ankleY: 0.08, handCut: 0 },
}[body];

// Triangles per part per level: far, Low, Medium, High.
const BUDGET = {
  head: [450, 1000, 1900, 10200],
  hand: [80, 220, 450, 1500],
  foot: [60, 120, 250, 900],
};

const O = await loadOriginal(body);

// ── Weld by position (the scan splits vertices along UV seams) ──
function weld(pos, nor, idx) {
  const map = new Map();
  const remap = new Int32Array(pos.length / 3);
  const P = [], N = [];
  for (let v = 0; v < pos.length / 3; v++) {
    const k = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
    let w = map.get(k);
    if (w === undefined) {
      w = P.length / 3;
      map.set(k, w);
      P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      N.push(0, 0, 0);
    }
    N[w * 3] += nor[v * 3]; N[w * 3 + 1] += nor[v * 3 + 1]; N[w * 3 + 2] += nor[v * 3 + 2];
    remap[v] = w;
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
  const I = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) I[i] = remap[idx[i]];
  return { P: new Float32Array(P), N: new Float32Array(N), I };
}

/** Triangles whose centroid passes `pred`, as a compact mesh. */
function sub(m, pred) {
  const keep = [];
  const { P, I } = m;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const x = (P[a] + P[b] + P[c]) / 3, y = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    if (pred(x, y, z)) keep.push(I[t], I[t + 1], I[t + 2]);
  }
  return compact(m, keep);
}

function compact(m, tris) {
  const map = new Map();
  const P = [], N = [], I = [], F = [], K = [];
  for (const v of tris) {
    let w = map.get(v);
    if (w === undefined) {
      w = P.length / 3;
      map.set(v, w);
      P.push(m.P[v * 3], m.P[v * 3 + 1], m.P[v * 3 + 2]);
      N.push(m.N[v * 3], m.N[v * 3 + 1], m.N[v * 3 + 2]);
      if (m.F) F.push(m.F[v]);
      if (m.lock) K.push(m.lock[v]);
    }
    I.push(w);
  }
  const out = { P: new Float32Array(P), N: new Float32Array(N), I: new Uint32Array(I) };
  if (m.F) out.F = new Float32Array(F);
  if (m.lock) out.lock = new Uint8Array(K);
  return out;
}

/**
 * Keep the outer skin: the scans carry inward-facing inner shells (the man's
 * head has one bigger than its outside), so of the connected pieces keep those
 * whose faces mostly point away from the part's centre — the largest, and any
 * other sizeable one (an ear, a curl).
 */
function largest(m, centre) {
  const n = m.P.length / 3;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < m.I.length; t += 3) {
    const a = find(m.I[t]), b = find(m.I[t + 1]), c = find(m.I[t + 2]);
    parent[b] = a; parent[find(c)] = a;
  }
  if (!centre) {
    const s = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) s[k] += m.P[i * 3 + k] / n;
    centre = s;
  }
  const stat = new Map();
  const P = m.P;
  for (let t = 0; t < m.I.length; t += 3) {
    const a = m.I[t] * 3, b = m.I[t + 1] * 3, c = m.I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (P[a] + P[b] + P[c]) / 3 - centre[0], my = (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - centre[1], mz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - centre[2];
    const r = find(m.I[t]);
    const e = stat.get(r) ?? stat.set(r, { tris: 0, out: 0 }).get(r);
    e.tris++;
    if (nx * mx + ny * my + nz * mz > 0) e.out++;
  }
  if (process.env.DBGC) console.log("  comps", [...stat.values()].filter((e) => e.tris > 50).map((e) => `${e.tris}:${(e.out / e.tris).toFixed(2)}`).join(" "));
  const comps = [...stat.entries()].filter(([, e]) => e.out / e.tris > 0.55).sort((a, b) => b[1].tris - a[1].tris);
  if (!comps.length) {
    // Inner and outer shells joined: sort the triangles one by one, by whether
    // they face away from the part's long axis (principal direction).
    const n3 = m.P.length / 3;
    const c = [0, 0, 0];
    for (let i = 0; i < n3; i++) for (let k = 0; k < 3; k++) c[k] += m.P[i * 3 + k] / n3;
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < n3; i++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += (m.P[i * 3 + a] - c[a]) * (m.P[i * 3 + b] - c[b]);
    let ax = [1, 1, 1];
    for (let it = 0; it < 50; it++) {
      const nx = [0, 1, 2].map((a) => cov[a][0] * ax[0] + cov[a][1] * ax[1] + cov[a][2] * ax[2]);
      const l = Math.hypot(...nx);
      ax = nx.map((x) => x / l);
    }
    const tris = [];
    for (let t = 0; t < m.I.length; t += 3) {
      const a = m.I[t] * 3, b = m.I[t + 1] * 3, cc = m.I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[cc] - P[a], vy = P[cc + 1] - P[a + 1], vz = P[cc + 2] - P[a + 2];
      const nrm = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const d = [(P[a] + P[b] + P[cc]) / 3 - c[0], (P[a + 1] + P[b + 1] + P[cc + 1]) / 3 - c[1], (P[a + 2] + P[b + 2] + P[cc + 2]) / 3 - c[2]];
      const along = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
      const r = [d[0] - ax[0] * along, d[1] - ax[1] * along, d[2] - ax[2] * along];
      if (nrm[0] * r[0] + nrm[1] * r[1] + nrm[2] * r[2] > 0) tris.push(m.I[t], m.I[t + 1], m.I[t + 2]);
    }
    console.log(`  joined shells: kept ${tris.length / 3} of ${m.I.length / 3} triangles`);
    return compact(m, tris);
  }
  const keep = new Set(comps.filter(([, e], i) => i === 0 || e.tris > comps[0][1].tris * 0.02).map(([r]) => r));
  const dropped = [...stat.values()].filter((e) => e.out / e.tris <= 0.55).reduce((a, e) => a + e.tris, 0);
  if (dropped) console.log(`  dropped ${dropped} inward-facing triangles`);
  const tris = [];
  for (let t = 0; t < m.I.length; t += 3) if (keep.has(find(m.I[t]))) tris.push(m.I[t], m.I[t + 1], m.I[t + 2]);
  return compact(m, tris);
}

/**
 * `focus(x, y, z)` ≥ 1 magnifies a region for the simplifier only (the face):
 * its errors count for more, so it keeps more of the triangles.
 */
function decimate(m, target, focus) {
  if (m.I.length / 3 <= target) return m;
  let P = m.P;
  if (focus) {
    P = new Float32Array(m.P.length);
    for (let i = 0; i < P.length; i += 3) {
      const k = focus(m.P[i], m.P[i + 1], m.P[i + 2]);
      P[i] = m.P[i] * k; P[i + 1] = m.P[i + 1] * k; P[i + 2] = m.P[i + 2] * k;
    }
  }
  const simp = (flags) =>
    m.lock
      ? MeshoptSimplifier.simplifyWithAttributes(m.I, P, 3, new Float32Array(0), 0, [], m.lock, target * 3, 1, flags)[0]
      : MeshoptSimplifier.simplify(m.I, P, 3, target * 3, 1, flags)[0];
  let out = compact(m, simp(['LockBorder']));
  if (out.I.length / 3 > target * 1.08) {
    // Too many locked border vertices: let the border move a little (the face rig's cuts stay locked).
    out = compact(m, simp([]));
  }
  return out;
}

const W = weld(O.pos, O.nor, O.idx);

// ── Colour samples from the ORIGINAL surface (atlas sampled inside each triangle) ──
const CELL = 0.01;
function buildSamples(pred) {
  const grid = new Map();
  const { pos, uv, idx, atlas } = O;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    if (!pred(cx, cy, cz)) continue;
    const ux = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
    const vx = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
    const nx = ux[1] * vx[2] - ux[2] * vx[1], ny = ux[2] * vx[0] - ux[0] * vx[2], nz = ux[0] * vx[1] - ux[1] * vx[0];
    const area = Math.hypot(nx, ny, nz) / 2;
    if (area < 1e-12) continue;
    const u = (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3, v = (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3;
    const col = sampleAtlas(atlas, u, v).map((x) => srgbToLinear(x / 255));
    const k = `${Math.floor(cx / CELL)},${Math.floor(cy / CELL)},${Math.floor(cz / CELL)}`;
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    const l = area * 2;
    arr.push(cx, cy, cz, nx / l, ny / l, nz / l, area, col[0], col[1], col[2]);
  }
  return grid;
}

function vertexColours(m, grid) {
  const n = m.P.length / 3;
  // Local edge length → sampling radius.
  const len = new Float32Array(n), cnt = new Float32Array(n);
  for (let t = 0; t < m.I.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = m.I[t + k], b = m.I[t + ((k + 1) % 3)];
      const d = Math.hypot(m.P[a * 3] - m.P[b * 3], m.P[a * 3 + 1] - m.P[b * 3 + 1], m.P[a * 3 + 2] - m.P[b * 3 + 2]);
      len[a] += d; cnt[a]++; len[b] += d; cnt[b]++;
    }
  }
  const C = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = Math.min(0.02, Math.max(0.004, (len[i] / (cnt[i] || 1)) * 0.6));
    const x = m.P[i * 3], y = m.P[i * 3 + 1], z = m.P[i * 3 + 2];
    const nx = m.N[i * 3], ny = m.N[i * 3 + 1], nz = m.N[i * 3 + 2];
    let s = 0, cr = 0, cg = 0, cb = 0;
    for (let rr = r; s === 0 && rr <= 0.05; rr *= 2) {
      const c0 = Math.floor((x - rr) / CELL), c1 = Math.floor((x + rr) / CELL);
      const d0 = Math.floor((y - rr) / CELL), d1 = Math.floor((y + rr) / CELL);
      const e0 = Math.floor((z - rr) / CELL), e1 = Math.floor((z + rr) / CELL);
      for (let a = c0; a <= c1; a++) for (let b = d0; b <= d1; b++) for (let c = e0; c <= e1; c++) {
        const arr = grid.get(`${a},${b},${c}`);
        if (!arr) continue;
        for (let j = 0; j < arr.length; j += 10) {
          const dx = arr[j] - x, dy = arr[j + 1] - y, dz = arr[j + 2] - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > rr * rr) continue;
          const facing = arr[j + 3] * nx + arr[j + 4] * ny + arr[j + 5] * nz;
          if (facing < 0.2) continue;
          const w = arr[j + 6] * Math.exp((-2 * d2) / (rr * rr)) * facing;
          s += w; cr += w * arr[j + 7]; cg += w * arr[j + 8]; cb += w * arr[j + 9];
        }
      }
    }
    C[i * 3] = s ? cr / s : 0.1; C[i * 3 + 1] = s ? cg / s : 0.06; C[i * 3 + 2] = s ? cb / s : 0.04;
  }
  return C;
}

// ── Head: spherical lens projection and texture bake ──
const KU = 1.5, KV = 1.8, EV0 = -0.12;
function headProjector(c) {
  const fa = (az) => 0.5 + Math.atan(KU * az) / (2 * Math.atan(KU * Math.PI));
  const fe = (e) => Math.atan(KV * (e - EV0));
  const e0 = fe(-Math.PI / 2), e1 = fe(Math.PI / 2);
  const f = (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    const az = Math.atan2(dx, dz); // 0 = straight ahead (+Z), ±π at the back seam
    const el = Math.atan2(dy, Math.hypot(dx, dz));
    return [fa(az), (fe(el) - e0) / (e1 - e0)];
  };
  f.c = c;
  return f;
}

async function bakeHeadTexture(c, proj, S, minY) {
  const { pos, uv, idx, atlas } = O;
  const img = new Float32Array(S * S * 3);
  const depth = new Float32Array(S * S).fill(-1);
  const pu = new Float32Array(3), pv = new Float32Array(3), pr = new Float32Array(3);
  for (let t = 0; t < idx.length; t += 3) {
    const vs = [idx[t], idx[t + 1], idx[t + 2]];
    if (vs.some((v) => pos[v * 3 + 1] < minY || !(pos[v * 3 + 1] > CFG.headBase - 0.02 || Math.abs(pos[v * 3]) < 0.09))) continue;
    for (let k = 0; k < 3; k++) {
      const v = vs[k];
      const [u, w] = proj(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      pu[k] = u; pv[k] = w;
      pr[k] = Math.hypot(pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]);
    }
    // Across the back seam: shift the low side by one turn, draw at both offsets.
    const sd = vs.map((v) => (pos[v * 3 + 2] - c[2] < 0 ? Math.sign(pos[v * 3] - c[0]) || 1 : 0));
    if (sd.includes(1) && sd.includes(-1)) for (let k = 0; k < 3; k++) if (pu[k] < 0.5) pu[k] += 1;
    for (const off of [0, -1]) {
      const X = [(pu[0] + off) * S, (pu[1] + off) * S, (pu[2] + off) * S];
      const Y = [(1 - pv[0]) * S, (1 - pv[1]) * S, (1 - pv[2]) * S];
      const x0 = Math.max(0, Math.floor(Math.min(...X))), x1 = Math.min(S - 1, Math.ceil(Math.max(...X)));
      const y0 = Math.max(0, Math.floor(Math.min(...Y))), y1 = Math.min(S - 1, Math.ceil(Math.max(...Y)));
      if (x1 < x0 || y1 < y0) continue;
      const den = (Y[1] - Y[2]) * (X[0] - X[2]) + (X[2] - X[1]) * (Y[0] - Y[2]);
      if (Math.abs(den) < 1e-12) continue;
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const sx = px + 0.5, sy = py + 0.5;
        let a = ((Y[1] - Y[2]) * (sx - X[2]) + (X[2] - X[1]) * (sy - Y[2])) / den;
        let b = ((Y[2] - Y[0]) * (sx - X[2]) + (X[0] - X[2]) * (sy - Y[2])) / den;
        let g = 1 - a - b;
        // A little slack so thin triangles still cover their pixels.
        if (a < -0.05 || b < -0.05 || g < -0.05) continue;
        const r = a * pr[0] + b * pr[1] + g * pr[2];
        const o = py * S + px;
        if (r <= depth[o]) continue;
        depth[o] = r;
        a = Math.max(0, a); b = Math.max(0, b); g = Math.max(0, g);
        const sN = a + b + g;
        const u = (a * uv[vs[0] * 2] + b * uv[vs[1] * 2] + g * uv[vs[2] * 2]) / sN;
        const w = (a * uv[vs[0] * 2 + 1] + b * uv[vs[1] * 2 + 1] + g * uv[vs[2] * 2 + 1]) / sN;
        const col = sampleAtlas(atlas, u, w);
        img[o * 3] = col[0]; img[o * 3 + 1] = col[1]; img[o * 3 + 2] = col[2];
      }
    }
  }
  // Fill holes outward from covered pixels.
  let filled = depth.map((d) => (d >= 0 ? 1 : 0));
  for (let pass = 0; pass < 64; pass++) {
    let any = false;
    const next = filled.slice();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const o = y * S + x;
      if (filled[o]) continue;
      let n = 0, r = 0, g = 0, b = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = (x + dx + S) % S, yy = y + dy;
        if (yy < 0 || yy >= S) continue;
        const q = yy * S + xx;
        if (!filled[q]) continue;
        n++; r += img[q * 3]; g += img[q * 3 + 1]; b += img[q * 3 + 2];
      }
      if (n) { img[o * 3] = r / n; img[o * 3 + 1] = g / n; img[o * 3 + 2] = b / n; next[o] = 1; any = true; }
    }
    filled = next;
    if (!any) break;
  }
  const raw = Buffer.alloc(S * S * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.max(0, Math.min(255, Math.round(img[i])));
  const buf = await sharp(raw, { raw: { width: S, height: S, channels: 3 } }).webp({ quality: 88 }).toBuffer();
  return { buf, depth, S, img };
}

/**
 * A clean head for the lower levels: the outermost surface seen from the
 * projection centre, as a grid in the texture's own (u, v). It matches the
 * texture exactly and simplifies evenly (the curls' many small pieces don't).
 */
function headShell(depthMap, S, c, cutY) {
  const GU = 112, GV = 72;
  const fa = Math.atan(KU * Math.PI) * 2, e0 = Math.atan(KV * (-Math.PI / 2 - EV0)), e1 = Math.atan(KV * (Math.PI / 2 - EV0));
  // Grid depth: the max radius over each cell's pixels, holes filled from neighbours.
  const D = new Float32Array(GU * GV).fill(-1);
  for (let j = 0; j < GV; j++) for (let i = 0; i < GU; i++) {
    const x0 = Math.floor((i / GU) * S), x1 = Math.floor(((i + 1) / GU) * S);
    const y0 = Math.floor(((GV - 1 - j) / GV) * S), y1 = Math.floor(((GV - j) / GV) * S);
    let m = -1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m = Math.max(m, depthMap[y * S + x]);
    D[j * GU + i] = m;
  }
  // Below the jaw, an empty cell is open air (the neck's cut end, the shoulders): leave it out.
  const covered = Uint8Array.from(D, (d) => (d >= 0 ? 1 : 0));
  for (let pass = 0; pass < 40; pass++) {
    let any = false;
    for (let j = 0; j < GV; j++) for (let i = 0; i < GU; i++) {
      const o = j * GU + i;
      if (D[o] >= 0) continue;
      let n = 0, sum = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jj = j + dj; if (jj < 0 || jj >= GV) continue;
        const q = jj * GU + ((i + di + GU) % GU);
        if (D[q] >= 0) { n++; sum += D[q]; }
      }
      if (n) { D[o] = -2 - sum / n; any = true; }
    }
    for (let o = 0; o < D.length; o++) if (D[o] < -1.5) D[o] = -D[o] - 2;
    if (!any) break;
  }
  // Light smoothing: the curls' spikes become a soft silhouette.
  for (let it = 0; it < 2; it++) {
    const E = D.slice();
    for (let j = 1; j < GV - 1; j++) for (let i = 0; i < GU; i++) {
      const o = j * GU + i;
      E[o] = (D[o] * 4 + D[o - GU] + D[o + GU] + D[j * GU + ((i + 1) % GU)] + D[j * GU + ((i - 1 + GU) % GU)]) / 8;
    }
    D.set(E);
  }
  const P = [], keep = [];
  for (let j = 0; j < GV; j++) for (let i = 0; i < GU; i++) {
    const u = (i + 0.5) / GU, v = (j + 0.5) / GV;
    const az = Math.tan((u - 0.5) * fa) / KU;
    const el = EV0 + Math.tan(e0 + v * (e1 - e0)) / KV;
    const r = D[j * GU + i];
    const x = c[0] + Math.sin(az) * Math.cos(el) * r, y = c[1] + Math.sin(el) * r, z = c[2] + Math.cos(az) * Math.cos(el) * r;
    P.push(x, y, z);
    keep.push(y > cutY && (covered[j * GU + i] === 1 || el > -0.35));
  }
  // Top cap: one vertex over the crown.
  const top = P.length / 3;
  let ty = 0; for (let i = 0; i < GU; i++) ty += P[((GV - 1) * GU + i) * 3 + 1] / GU;
  P.push(c[0], ty + 0.004, c[2]); keep.push(true);
  const I = [];
  for (let j = 0; j < GV - 1; j++) for (let i = 0; i < GU; i++) {
    const a = j * GU + i, b = j * GU + ((i + 1) % GU), cc = (j + 1) * GU + i, d = (j + 1) * GU + ((i + 1) % GU);
    // Outward winding (u grows to the left side seen from outside: check once below).
    if (keep[a] && keep[b] && keep[cc]) I.push(a, cc, b);
    if (keep[b] && keep[cc] && keep[d]) I.push(b, cc, d);
  }
  for (let i = 0; i < GU; i++) I.push((GV - 1) * GU + i, top, (GV - 1) * GU + ((i + 1) % GU));
  // Make the winding outward if it came out inward.
  let out = 0;
  for (let t = 0; t < I.length; t += 3) {
    const A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
    const ux = P[B] - P[A], uy = P[B + 1] - P[A + 1], uz = P[B + 2] - P[A + 2], vx = P[C] - P[A], vy = P[C + 1] - P[A + 1], vz = P[C + 2] - P[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out += nx * (P[A] - c[0]) + ny * (P[A + 1] - c[1]) + nz * (P[A + 2] - c[2]) > 0 ? 1 : -1;
  }
  if (out < 0) for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
  // Smooth normals.
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
    const ux = P[B] - P[A], uy = P[B + 1] - P[A + 1], uz = P[B + 2] - P[A + 2], vx = P[C] - P[A], vy = P[C + 1] - P[A + 1], vz = P[C + 2] - P[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const V of [A, B, C]) { N[V] += nx; N[V + 1] += ny; N[V + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  return compact({ P: new Float32Array(P), N, I: new Uint32Array(I) }, I);
}

/** UVs from the projection, with vertices duplicated along the back seam. */
function projectUVs(m, proj) {
  const P = Array.from(m.P), N = Array.from(m.N), UV = [];
  const n0 = m.P.length / 3;
  for (let i = 0; i < n0; i++) UV.push(...proj(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]));
  const I = Array.from(m.I);
  const dup = new Map();
  const extra = m.extra ? m.extra.map((e) => Array.from(e.data)) : [];
  const back = (v) => { const dz = P[v * 3 + 2] - proj.c[2]; return dz < 0 ? Math.sign(P[v * 3] - proj.c[0]) || 1 : 0; };
  for (let t = 0; t < I.length; t += 3) {
    const sides = [back(I[t]), back(I[t + 1]), back(I[t + 2])];
    if (!(sides.includes(1) && sides.includes(-1))) continue;
    for (let k = 0; k < 3; k++) {
      const v = I[t + k];
      if (UV[v * 2] >= 0.5) continue;
      let d = dup.get(v);
      if (d === undefined) {
        d = P.length / 3;
        dup.set(v, d);
        P.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        N.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
        UV.push(UV[v * 2] + 1, UV[v * 2 + 1]);
        m.extra?.forEach((e, j) => { for (let c = 0; c < e.n; c++) extra[j].push(extra[j][v * e.n + c]); });
      }
      I[t + k] = d;
    }
  }
  return { P, N, UV, I, extra };
}

// ── Skin weights ──
/** Four strongest, normalised: [names list, indices, weights]. */
function packWeights(list) {
  const names = [];
  const si = [], sw = [];
  for (const w of list) {
    const top = w.filter((x) => x[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s = top.reduce((a, x) => a + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      const t = top[k];
      if (!t) { si.push(0); sw.push(0); continue; }
      let j = names.indexOf(t[0]);
      if (j < 0) { j = names.length; names.push(t[0]); }
      si.push(j); sw.push(t[1] / s);
    }
  }
  return { j: names, si, sw };
}
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

const round = (a, k = 5) => Array.from(a, (x) => +x.toFixed(k));

// ═════════════════════════════ HEAD ═════════════════════════════
const out = { body, height: O.scale, cfg: CFG, levels: [], bones: {} };

const headSrc = largest(sub(W, (x, y) => y > CFG.neckCut && (y > CFG.headBase - 0.02 || Math.abs(x) < 0.085)), [0, CFG.headBase + 0.08, 0.02]);
// Anchor: the head bone at the skull base, on the neck's centre line.
let nz = 0, nn = 0;
for (let i = 0; i < headSrc.P.length / 3; i++) if (Math.abs(headSrc.P[i * 3 + 1] - CFG.headBase) < 0.01) { nz += headSrc.P[i * 3 + 2]; nn++; }
const neckZ = nn ? nz / nn : 0;
const headAnchor = [0, CFG.headBase, neckZ];
// Projection centre: middle of the skull above the chin.
let bb = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
for (let i = 0; i < headSrc.P.length / 3; i++) {
  const y = headSrc.P[i * 3 + 1];
  if (y < CFG.headBase + 0.02) continue;
  bb = [Math.min(bb[0], headSrc.P[i * 3]), Math.max(bb[1], headSrc.P[i * 3]), Math.min(bb[2], y), Math.max(bb[3], y), Math.min(bb[4], headSrc.P[i * 3 + 2]), Math.max(bb[5], headSrc.P[i * 3 + 2])];
}
const headC = [(bb[0] + bb[1]) / 2, bb[2] + (bb[3] - bb[2]) * 0.42, (bb[4] + bb[5]) / 2];
const proj = headProjector(headC);
/** The face (front, brow to chin) counts 2.2× for the simplifier; hair and the back of the head less. */
const faceFocus = (gain) => (x, y, z) => {
  const dx = x - headC[0], dy = y - headC[1], dz = z - headC[2];
  const az = Math.abs(Math.atan2(dx, dz));
  const el = Math.atan2(dy, Math.hypot(dx, dz));
  const front = 1 - smooth(0.7, 1.25, az);
  const band = smooth(-0.95, -0.6, el) * (1 - smooth(0.25, 0.55, el));
  return 1 + gain * front * band;
};
const baked = await bakeHeadTexture(headC, proj, 1024, CFG.neckCut - 0.01);
const texBuf = baked.buf;
const shell = headShell(baked.depth, baked.S, headC, CFG.neckCut);
console.log(`head shell: ${shell.I.length / 3} tris`);
// ═════════════════════════════ FACE RIG ═════════════════════════════
// Real eyes, eyelids that blink and a jaw that opens. Landmarks are picked on
// the baked head texture (pixels, 1024²): each eye's opening (an ellipse, a
// little taller than the scan's heavy lids) and the line where the lips meet.
//
//   eyes   the opening is cut out of the head and its rim wrapped onto a
//          sphere just outside the eyeball, so the lids sit on the eye with
//          no gap; the game puts an eyeball (eyeL/eyeR bones) behind it and a
//          skin-coloured lid (lidL/lidR) that rotates down over it to blink
//   mouth  the head is split along the lip line (the two sides share
//          positions, so closed it is seamless); everything below goes with
//          the jaw bone, so it opens onto a dark mouth the game adds
// The cuts are locked through every simplification, so no level cracks.
const FACE = {
  man: { eyes: [[320, 425], [690, 425]], hw: 58, hh: 32, mouth: [[362, 888], [530, 880], [700, 886]], R: 0.0118, jaw: [0, 0.036, -0.085], lidBox: [-40, -15] },
  woman: { eyes: [[375, 670], [655, 670]], hw: 45, hh: 24, mouth: [[405, 834], [512, 830], [622, 834]], R: 0.0122, jaw: [0, 0.035, -0.08], lidBox: [-82, -58] },
}[body];
const FS = baked.S;
const FA = Math.atan(KU * Math.PI) * 2, FE0 = Math.atan(KV * (-Math.PI / 2 - EV0)), FE1 = Math.atan(KV * (Math.PI / 2 - EV0));
const pxDir = (px, py) => {
  const u = px / FS, v = 1 - py / FS;
  const az = Math.tan((u - 0.5) * FA) / KU, el = EV0 + Math.tan(FE0 + v * (FE1 - FE0)) / KV;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
};
/** The outer surface at a texture pixel (absolute coordinates). */
const surfAt = (px, py) => {
  const r = baked.depth[Math.round(py) * FS + Math.round(px)];
  const d = pxDir(px, py);
  return headC.map((c, i) => c + d[i] * r);
};
const pxOf = (x, y, z) => { const [u, v] = proj(x, y, z); return [u * FS, (1 - v) * FS]; };
const RIM = FACE.R + 0.0012;
const EYES = FACE.eyes.map(([px, py]) => {
  const s = surfAt(px, py);
  // The eyeball's front just behind the scanned eye.
  const C = [s[0], s[1], s[2] - FACE.R - 0.0005];
  const rimPt = (tpx, tpy) => surfAt(tpx, tpy);
  const top = rimPt(px, py - FACE.hh), bot = rimPt(px, py + FACE.hh);
  const inn = rimPt(px + (px < FS / 2 ? FACE.hw : -FACE.hw), py), out = rimPt(px + (px < FS / 2 ? -FACE.hw : FACE.hw), py);
  const el = (q) => Math.asin(Math.max(-1, Math.min(1, (q[1] - C[1]) / RIM)));
  const az = (q) => Math.asin(Math.max(-1, Math.min(1, Math.abs(q[0] - C[0]) / RIM)));
  return { px, py, C, top: el(top), bot: el(bot), az: Math.max(az(inn), az(out)) };
});
const eyeRho = (e, px, py) => Math.hypot((px - e.px) / FACE.hw, (py - e.py) / FACE.hh);
const [MA, MM, MB] = FACE.mouth;
const seamPy = (px) => (px <= MM[0] ? MA[1] + (MM[1] - MA[1]) * Math.max(0, Math.min(1, (px - MA[0]) / (MM[0] - MA[0]))) : MM[1] + (MB[1] - MM[1]) * Math.max(0, Math.min(1, (px - MM[0]) / (MB[0] - MM[0]))));
const MCX = (MA[0] + MB[0]) / 2, MHW = (MB[0] - MA[0]) / 2;
const mouthMid = surfAt(MM[0], MM[1]);

function rigFace(src) {
  const n0 = src.P.length / 3;
  const P = Array.from(src.P), N = Array.from(src.N);
  const PX = [], PY = [];
  for (let i = 0; i < n0; i++) { const [a, b] = pxOf(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); PX.push(a); PY.push(b); }
  // 1. Cut the eye openings; drop the scan's folds inside the lips (they would flap as the mouth opens).
  let I = [];
  let folds = 0;
  for (let t = 0; t < src.I.length; t += 3) {
    const a = src.I[t], b = src.I[t + 1], c = src.I[t + 2];
    const cx = (PX[a] + PX[b] + PX[c]) / 3, cy = (PY[a] + PY[b] + PY[c]) / 3;
    if (EYES.some((e) => eyeRho(e, cx, cy) < 1)) continue;
    if (cx > MA[0] - 20 && cx < MB[0] + 20 && Math.abs(cy - seamPy(cx)) < 40) {
      const x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3 - headC[0], y = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3 - headC[1], z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3 - headC[2];
      const outer = baked.depth[Math.round(cy) * FS + Math.round(cx)];
      if (Math.hypot(x, y, z) < outer - 0.0025) { folds++; continue; }
    }
    I.push(a, b, c);
  }
  const lock = new Uint8Array(n0);
  // 2. The rim onto the sphere round the eyeball; the skin round it eased into a socket.
  const edges = new Map();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = I[t + k], b = I[t + ((k + 1) % 3)];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  const rim = new Set();
  for (const [key, cnt] of edges) {
    if (cnt !== 1) continue;
    const [a, b] = key.split(',').map(Number);
    if (EYES.some((e) => eyeRho(e, PX[a], PY[a]) < 1.6 && eyeRho(e, PX[b], PY[b]) < 1.6)) { rim.add(a); rim.add(b); }
  }
  const moved = new Set();
  for (const e of EYES) {
    const [cx, cy, cz] = e.C;
    const shellZ = (x, y) => { const d2 = (x - cx) ** 2 + (y - cy) ** 2; return d2 < RIM * RIM ? cz + Math.sqrt(RIM * RIM - d2) : -Infinity; };
    for (let i = 0; i < n0; i++) {
      const rho = eyeRho(e, PX[i], PY[i]);
      if (rho > 1.9) continue;
      if (rim.has(i) && rho < 1.6) {
        const a = Math.atan2((PY[i] - e.py) / FACE.hh, (PX[i] - e.px) / FACE.hw);
        const q = surfAt(e.px + FACE.hw * Math.cos(a), e.py + FACE.hh * Math.sin(a));
        const z = shellZ(q[0], q[1]);
        P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = z > -Infinity ? z : q[2];
        lock[i] = 1;
        moved.add(i);
      } else if (rho > 1) {
        const zs = shellZ(P[i * 3], P[i * 3 + 1]);
        if (zs === -Infinity) continue;
        const z = P[i * 3 + 2];
        const k = smooth(1, 1.9, rho);
        P[i * 3 + 2] = z < zs ? zs : zs + (z - zs) * k;
        moved.add(i);
      }
    }
  }
  // Normals again where the socket changed the shape (face normals, area-weighted).
  if (moved.size) {
    const acc = new Float64Array(n0 * 3);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const V of [a, b, c]) { acc[V] += nx; acc[V + 1] += ny; acc[V + 2] += nz; }
    }
    for (const i of moved) {
      const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) || 1;
      N[i * 3] = acc[i * 3] / l; N[i * 3 + 1] = acc[i * 3 + 1] / l; N[i * 3 + 2] = acc[i * 3 + 2] / l;
    }
  }
  // 3. Split along the lips: triangles in the mouth's span go to the upper lip
  // when no corner is below the line, else the lower (so the cut runs along
  // edges, never zig-zagging across a grid's diagonals); a vertex both use is doubled.
  const side = new Int8Array(I.length / 3); // 0 outside the span, 1 upper, 2 lower
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const cx = (PX[a] + PX[b] + PX[c]) / 3, cy = (PY[a] + PY[b] + PY[c]) / 3;
    if (cx <= MA[0] || cx >= MB[0] || Math.abs(cy - seamPy(cx)) > 70) continue;
    side[t / 3] = [a, b, c].every((v) => PY[v] <= seamPy(PX[v]) + 0.5) ? 1 : 2;
  }
  const uses = new Uint8Array(n0); // bit 1 upper, 2 lower, 4 outside
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) uses[I[t + k]] |= side[t / 3] === 1 ? 1 : side[t / 3] === 2 ? 2 : 4;
  const F = new Array(n0).fill(0);
  const L = Array.from(lock);
  const dup = new Map();
  for (let t = 0; t < I.length; t += 3) {
    if (side[t / 3] !== 2) continue;
    for (let k = 0; k < 3; k++) {
      const v = I[t + k];
      if (uses[v] !== 3) continue; // only where both lips meet, never at the corners' outer triangles
      let d = dup.get(v);
      if (d === undefined) {
        d = P.length / 3;
        dup.set(v, d);
        P.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        N.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
        F.push(1); L.push(1);
        F[v] = 2; L[v] = 1;
      }
      I[t + k] = d;
    }
  }
  // Every corner of a lower-lip triangle near the line goes wholly with the jaw,
  // of an upper-lip one wholly with the head: no triangle hangs between the two.
  for (let t = 0; t < I.length; t += 3) {
    if (!side[t / 3]) continue;
    for (let k = 0; k < 3; k++) {
      const v = I[t + k];
      if (F[v] || v >= n0) continue;
      const dy = PY[v] - seamPy(PX[v]);
      if (side[t / 3] === 2 && dy < 15) F[v] = 1;
      if (side[t / 3] === 1 && dy > -15) F[v] = 2;
    }
  }
  // The cut onto the lip line itself (a clean line at every level), both copies together.
  for (const [v, d] of dup) {
    const q = surfAt(PX[v], seamPy(PX[v]));
    for (const k of [v, d]) { P[k * 3] = q[0]; P[k * 3 + 1] = q[1]; P[k * 3 + 2] = q[2]; }
  }
  console.log(`  face rig: ${rim.size} rim vertices, ${dup.size} on the lip line, ${folds} fold triangles dropped`);
  return { P: new Float32Array(P), N: new Float32Array(N), I: new Uint32Array(I), F: new Float32Array(F), lock: new Uint8Array(L) };
}
const headRig = rigFace(headSrc);
const shellRig = rigFace(shell);

/** How much of a head vertex goes with the jaw: the lower lip, the chin, the jawline, never the throat. */
function jawWeight(x, y, z, f) {
  if (f === 1) return 1;
  if (f === 2) return 0;
  const [px, py] = pxOf(x, y, z);
  const e = Math.max(0, Math.abs(px - MCX) - MHW);
  const d = py - seamPy(px) + e * 0.6;
  let w = smooth(-1, 3, d);
  w *= 1 - smooth(MHW * 1.25, MHW * 2.3, Math.abs(px - MCX));
  w *= 1 - smooth(mouthMid[1] - 0.03, mouthMid[1] - 0.055, y) * (1 - smooth(mouthMid[2] - 0.055, mouthMid[2] - 0.03, z));
  return w;
}

// Lid skin: the median colour just above each eye (the scans paint lashes and highlights on the lid itself).
const lidSkin = (() => {
  const ch = [[], [], []];
  for (const e of EYES) for (let y = e.py + FACE.lidBox[0]; y < e.py + FACE.lidBox[1]; y++) for (let x = e.px - 30; x < e.px + 30; x++) {
    const o = (Math.round(y) * FS + Math.round(x)) * 3;
    for (let k = 0; k < 3; k++) ch[k].push(srgbToLinear(baked.img[o + k] / 255));
  }
  return ch.map((v) => +v.sort((a, b) => a - b)[v.length >> 1].toFixed(4));
})();
const relA = (q) => round(q.map((v, i) => v - headAnchor[i]), 5);
out.face = {
  R: FACE.R,
  rim: RIM,
  eyes: EYES.map((e) => ({ c: relA(e.C), top: +e.top.toFixed(3), bot: +e.bot.toFixed(3), az: +e.az.toFixed(3) })),
  lid: lidSkin,
  jaw: relA(mouthMid.map((v, i) => v + FACE.jaw[i])),
  mouth: { mid: relA(mouthMid), a: relA(surfAt(MA[0], MA[1])), b: relA(surfAt(MB[0], MB[1])) },
};
console.log('face', JSON.stringify(out.face));

out.headTex = 'data:image/webp;base64,' + texBuf.toString('base64');
writeFileSync(outPath.replace(/\.json$/, '_head.webp'), texBuf);
out.headCentre = round(headC.map((v, i) => v - headAnchor[i]));

function headWeights(P, F) {
  const list = [];
  for (let i = 0; i < P.length / 3; i++) {
    const y = P[i * 3 + 1];
    const toNeck = smooth(CFG.neckBase - 0.03, CFG.neckBase + 0.01, y);
    const toHead = smooth(CFG.headBase - 0.025, CFG.headBase + 0.02, y);
    const w = [['chest', 1 - toNeck], ['neck', toNeck * (1 - toHead)], ['head', toHead]];
    const j = F ? jawWeight(P[i * 3], y, P[i * 3 + 2], F[i]) : 0;
    list.push(j > 0 ? w.map(([b, x]) => [b, x * (1 - j)]).concat([['jaw', j]]) : w);
  }
  return list;
}

// ═════════════════════════════ HANDS ═════════════════════════════
// Always cut from the man's scan (five separate fingers).
const MAN = body === 'man' ? { W, O } : await (async () => { const o = await loadOriginal('man'); return { O: o, W: weld(o.pos, o.nor, o.idx) }; })();
const HAND_CUT = 0.885;

function adjacency(m) {
  const n = m.P.length / 3;
  const adj = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < m.I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = m.I[t + k], b = m.I[t + ((k + 1) % 3)];
    adj[a].add(b); adj[b].add(a);
  }
  return adj;
}

/**
 * Fingers by a merge tree over height: add vertices from the lowest up; each
 * fingertip starts its own piece, and a finger ends where its piece joins
 * another big piece (the web between fingers). Five leaves: four fingers and
 * the thumb.
 */
function fingers(m) {
  const n = m.P.length / 3;
  const adj = adjacency(m);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => m.P[a * 3 + 1] - m.P[b * 3 + 1]);
  const parent = new Int32Array(n).fill(-1);
  const members = new Map();
  const leaf = new Map(); // root → still a leaf
  const born = new Map(); // root → y where the piece started
  const label = new Int32Array(n).fill(-1);
  const webs = [];
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const big = (r, y) => members.get(r).length > 20 && y - born.get(r) > 0.005;
  for (const v of order) {
    const y = m.P[v * 3 + 1];
    parent[v] = v;
    members.set(v, [v]);
    leaf.set(v, true);
    born.set(v, y);
    for (const u of adj[v]) {
      if (parent[u] < 0) continue;
      const a = find(v), b = find(u);
      if (a === b) continue;
      const bigA = big(a, y), bigB = big(b, y);
      if (bigA && bigB) {
        for (const r of [a, b]) if (leaf.get(r)) {
          const id = webs.length;
          for (const x of members.get(r)) label[x] = id;
          webs.push({ y, size: members.get(r).length });
        }
        leaf.set(a, false); leaf.set(b, false);
      }
      const [keep, drop] = members.get(a).length >= members.get(b).length ? [a, b] : [b, a];
      parent[drop] = keep;
      members.get(keep).push(...members.get(drop));
      members.delete(drop);
      leaf.set(keep, leaf.get(keep) && leaf.get(drop) && !(bigA && bigB));
      born.set(keep, Math.min(born.get(keep), born.get(drop)));
    }
  }
  return { label, webs };
}

function handData(side) {
  const s = side === 'L' ? 1 : -1;
  const m = largest(sub(MAN.W, (x, y) => s * x > 0.215 && y < HAND_CUT && y > 0.5));
  const n = m.P.length / 3;
  // Wrist: centre of the cut ring.
  let wx = 0, wy = 0, wz = 0, wn = 0;
  for (let i = 0; i < n; i++) if (m.P[i * 3 + 1] > HAND_CUT - 0.012) { wx += m.P[i * 3]; wy += m.P[i * 3 + 1]; wz += m.P[i * 3 + 2]; wn++; }
  const wrist = [wx / wn, wy / wn - 0.005, wz / wn];
  const { label, webs } = fingers(m);
  // Per finger: tip, web centre, axis.
  const F = webs.map((w, id) => {
    let tip = null, cx = 0, cy = 0, cz = 0, cn = 0, zsum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      if (label[i] !== id) continue;
      cnt++; zsum += m.P[i * 3 + 2];
      if (!tip || m.P[i * 3 + 1] < tip[1]) tip = [m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]];
      if (m.P[i * 3 + 1] > w.y - 0.006) { cx += m.P[i * 3]; cy += m.P[i * 3 + 1]; cz += m.P[i * 3 + 2]; cn++; }
    }
    return { id, tip, web: [cx / cn, cy / cn, cz / cn], z: zsum / cnt, cnt };
  });
  return { m, wrist, label, F };
}

const NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];
async function debugHand(h, side) {
  const { writeGlb } = await import('./glbout.mjs');
  const pal = [[1,1,0],[.6,.6,0],[1,0,0],[.6,0,0],[0,1,0],[0,.55,0],[0,0,1],[0,0,.55],[1,0,1],[.55,0,.55]];
  const C = []; for (let i = 0; i < h.m.P.length/3; i++) { const l = h.label[i]; C.push(...(l < 0 ? [.8,.8,.8] : pal[l % 10])); }
  await writeGlb(`${process.env.DBG}/hand${side}.glb`, [{ P: h.m.P, N: h.m.N, I: h.m.I, C }]);
}
/** Geodesic (along the surface) distance from one vertex to all. */
function geodesic(m, adj, from) {
  const n = m.P.length / 3;
  const dist = new Float64Array(n).fill(Infinity);
  dist[from] = 0;
  // Binary heap of [d, v].
  const heap = [[0, from]];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } } return top; };
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    for (const u of adj[v]) {
      const e = Math.hypot(m.P[u * 3] - m.P[v * 3], m.P[u * 3 + 1] - m.P[v * 3 + 1], m.P[u * 3 + 2] - m.P[v * 3 + 2]);
      if (d + e < dist[u]) { dist[u] = d + e; push([d + e, u]); }
    }
  }
  return dist;
}

/** Surface length from the tip to the knuckle (index, middle, ring, pinky; thumb to its root). */
const FINGER_LEN = [0.1, 0.122, 0.134, 0.124, 0.102];

function rigHand(h, side) {
  const { m, wrist, F } = h;
  if (F.length !== 5) throw new Error(`hand ${side}: found ${F.length} fingertips, want 5`);
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  // Thumb: highest tip (it hangs shortest); the rest front (+Z) to back.
  const thumb = F.slice().sort((a, b) => b.tip[1] - a.tip[1])[0];
  const ordered = [thumb, ...F.filter((f) => f !== thumb).sort((a, b) => b.tip[2] - a.tip[2])];
  const n = m.P.length / 3;
  const adj = adjacency(m);
  const tipVert = (tip) => { let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = (m.P[i * 3] - tip[0]) ** 2 + (m.P[i * 3 + 1] - tip[1]) ** 2 + (m.P[i * 3 + 2] - tip[2]) ** 2; if (d < bd) { bd = d; best = i; } } return best; };
  const geo = ordered.map((f) => geodesic(m, adj, tipVert(f.tip)));
  const L = FINGER_LEN;

  // Bone points: centre of the ring of vertices at a given surface distance from the tip.
  const ringAt = (k, d, w = 0.005, own = true) => {
    let x = 0, y = 0, z = 0, c = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(geo[k][i] - d) > w) continue;
      // Only vertices that belong to this finger (closest tip).
      if (own && geo.some((g, j) => j !== k && g[i] / L[j] < geo[k][i] / L[k])) continue;
      x += m.P[i * 3]; y += m.P[i * 3 + 1]; z += m.P[i * 3 + 2]; c++;
    }
    return c ? [x / c, y / c, z / c] : null;
  };
  const bones = {};
  ordered.forEach((f, k) => {
    const at = (d) => ringAt(k, d) ?? ringAt(k, d, 0.01) ?? ringAt(k, d, 0.01, false);
    const b1 = at(L[k]);
    const b2 = at(L[k] * (k === 0 ? 0.5 : 0.48));

    bones[`${NAMES[k]}1${side}`] = sub3(b1, wrist);
    bones[`${NAMES[k]}2${side}`] = sub3(b2, wrist);
  });
  const list = [];
  for (let i = 0; i < n; i++) {
    const p = [m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]];
    const toHand = smooth(wrist[1] + 0.005, wrist[1] - 0.025, p[1]);
    let k = 0;
    for (let j = 1; j < 5; j++) if (geo[j][i] / L[j] < geo[k][i] / L[k]) k = j;
    const t = geo[k][i] / L[k]; // 0 tip … 1 knuckle
    const w = [];
    const root = 1 - smooth(0.88, 1.12, t);
    const mid = 1 - smooth(k === 0 ? 0.44 : 0.42, k === 0 ? 0.56 : 0.54, t);
    w.push([`hand${side}`, 1 - root], [`${NAMES[k]}1${side}`, root * (1 - mid)], [`${NAMES[k]}2${side}`, root * mid]);
    list.push(w.map(([b, x]) => [b, x * toHand]).concat([[`foreArm${side}`, 1 - toHand]]));
  }
  return { bones, weights: list };
}

const hands = {};
for (const side of ['L', 'R']) {
  const h = handData(side);
  const r = rigHand(h, side);
  { const cnt = {}; for (const w of r.weights) { const top = w.slice().sort((a, b) => b[1] - a[1])[0][0]; cnt[top] = (cnt[top] ?? 0) + 1; } console.log(side, JSON.stringify(cnt)); }
  if (process.env.DBG) { h.label = Int32Array.from(r.weights, (w) => { const top = w.slice().sort((a, b) => b[1] - a[1])[0][0]; const k = NAMES.findIndex((nm) => top.startsWith(nm)); return k < 0 ? -1 : k * 2 + (top.includes('2') ? 1 : 0); }); await debugHand(h, side); }
  hands[side] = { ...h, ...r };
  console.log(`hand ${side}: ${h.m.I.length / 3} tris, fingers`, h.F.map((f) => f.cnt).join('/'));
}

// Woman: the man's hands, smaller, re-toned to her skin.
const HAND_SCALE = body === 'woman' ? 0.88 : 1;
let tone = [1, 1, 1];
if (body === 'woman') {
  // Average skin of the neck/upper chest on both bodies (unclothed, well lit).
  // Median skin of the forearm on both scans (bare, no shadow from clothes).
  const med = (o, y0, y1, x0, x1) => {
    const ch = [[], [], []];
    for (let t = 0; t < o.idx.length; t += 3) {
      const a = o.idx[t];
      const x = Math.abs(o.pos[a * 3]), y = o.pos[a * 3 + 1];
      if (y < y0 || y > y1 || x < x0 || x > x1) continue;
      const c = sampleAtlas(o.atlas, o.uv[a * 2], o.uv[a * 2 + 1]).map((v) => srgbToLinear(v / 255));
      for (let k = 0; k < 3; k++) ch[k].push(c[k]);
    }
    return ch.map((v) => v.sort((p, q) => p - q)[v.length >> 1]);
  };
  const mine = med(O, 1.0, 1.1, 0.3, 0.5);
  const his = med(MAN.O, 0.95, 1.05, 0.22, 0.36);
  tone = mine.map((x, i) => x / his[i]);
  console.log('tone', tone.map((x) => x.toFixed(3)));
}
out.bones = {};
for (const side of ['L', 'R']) for (const [k, v] of Object.entries(hands[side].bones)) out.bones[k] = round(v.map((x) => x * HAND_SCALE));

// ═════════════════════════════ FEET ═════════════════════════════
function footPart(side) {
  const s = side === 'L' ? 1 : -1;
  const m = largest(sub(W, (x, y) => s * x > 0.01 && y < CFG.footCut));
  let ax = 0, az = 0, an = 0;
  for (let i = 0; i < m.P.length / 3; i++) if (m.P[i * 3 + 1] > CFG.footCut - 0.012) { ax += m.P[i * 3]; az += m.P[i * 3 + 2]; an++; }
  return { m, anchor: [ax / an, CFG.ankleY, az / an] };
}
function footWeights(P, anchor, side) {
  const list = [];
  for (let i = 0; i < P.length / 3; i++) {
    const t = smooth(CFG.ankleY + 0.01, CFG.footCut, P[i * 3 + 1] + anchor[1]);
    list.push([[`foot${side}`, 1 - t * 0.8], [`shin${side}`, t * 0.8]]);
  }
  return list;
}
const feet = { L: footPart('L'), R: footPart('R') };

// ═════════════════════════════ LEVELS ═════════════════════════════
const headGrid = buildSamples((x, y) => y > CFG.neckCut - 0.03);
const footGrid = buildSamples((x, y) => y < CFG.footCut + 0.03);
const handGrid = body === 'man' ? buildSamples((x, y) => Math.abs(x) > 0.2 && y < HAND_CUT + 0.03 && y > 0.5) : null;
const manHandGrid = body === 'man' ? handGrid : (() => { const save = O; return null; })();

/** Nearest source vertex for each vertex (weights and labels ride along). */
function nearest(src, P) {
  const g = new Map();
  const C = 0.006;
  for (let i = 0; i < src.P.length / 3; i++) {
    const k = `${Math.floor(src.P[i * 3] / C)},${Math.floor(src.P[i * 3 + 1] / C)},${Math.floor(src.P[i * 3 + 2] / C)}`;
    (g.get(k) ?? g.set(k, []).get(k)).push(i);
  }
  const out = new Int32Array(P.length / 3);
  for (let i = 0; i < P.length / 3; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    let best = -1, bd = Infinity;
    for (let r = 1; best < 0 && r < 6; r++) {
      const cx = Math.floor(x / C), cy = Math.floor(y / C), cz = Math.floor(z / C);
      for (let a = cx - r; a <= cx + r; a++) for (let b = cy - r; b <= cy + r; b++) for (let c = cz - r; c <= cz + r; c++) {
        for (const j of g.get(`${a},${b},${c}`) ?? []) {
          const d = (src.P[j * 3] - x) ** 2 + (src.P[j * 3 + 1] - y) ** 2 + (src.P[j * 3 + 2] - z) ** 2;
          if (d < bd) { bd = d; best = j; }
        }
      }
    }
    out[i] = best;
  }
  return out;
}

/** Pull the last `band` metres below the cut in towards the limb's axis, so the cut hides in the cuff. */
function tuck(P, top, band, k) {
  let cx = 0, cz = 0, n = 0;
  for (let i = 0; i < P.length; i += 3) if (P[i + 1] > top - 0.006) { cx += P[i]; cz += P[i + 2]; n++; }
  if (!n) return;
  cx /= n; cz /= n;
  for (let i = 0; i < P.length; i += 3) {
    const t = smooth(top - band, top, P[i + 1]);
    if (t <= 0) continue;
    const f = 1 - k * t;
    P[i] = cx + (P[i] - cx) * f;
    P[i + 2] = cz + (P[i + 2] - cz) * f;
  }
}

function pack(P, N, I, weights, anchor, extra = {}) {
  const pw = packWeights(weights);
  const rel = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) { rel[i] = P[i] - anchor[0]; rel[i + 1] = P[i + 1] - anchor[1]; rel[i + 2] = P[i + 2] - anchor[2]; }
  return { p: round(rel), n: round(N, 3), i: Array.from(I), ...pw, sw: round(pw.sw, 3), ...extra };
}

// Hands' colours come from the man's scan.
let handSamples = handGrid;
if (body === 'woman') {
  const saved = { pos: O.pos, uv: O.uv, idx: O.idx, atlas: O.atlas };
  Object.assign(O, { pos: MAN.O.pos, uv: MAN.O.uv, idx: MAN.O.idx, atlas: MAN.O.atlas });
  handSamples = buildSamples((x, y) => Math.abs(x) > 0.2 && y < HAND_CUT + 0.03 && y > 0.5);
  Object.assign(O, saved);
}

for (let L = 0; L < 4; L++) {
  const level = {};
  // Head
  {
    // The far level keeps the painted face: no cuts, no jaw.
    const d = L === 3 ? decimate(headRig, BUDGET.head[L], faceFocus(1.2)) : decimate(L === 0 ? shell : shellRig, BUDGET.head[L], faceFocus([2.2, 1.8, 1.4][L]));
    if (d.F) d.extra = [{ data: d.F, n: 1 }];
    const pr = projectUVs(d, proj);
    const wts = headWeights(pr.P, d.F ? pr.extra[0] : null);
    // The lip line's depth at this level (lower levels sit further back): where the game puts the inside of the mouth.
    let lz = 0, ln = 0;
    if (d.F) for (let i = 0; i < d.F.length; i++) if (d.F[i] === 1 && Math.abs(d.P[i * 3] - mouthMid[0]) < 0.012) { lz += d.P[i * 3 + 2]; ln++; }
    level.head = pack(pr.P, pr.N, pr.I, wts, headAnchor, { uv: round(pr.UV, 4), ...(ln ? { lipZ: +(lz / ln - headAnchor[2]).toFixed(4) } : {}) });
    if (ln) console.log(`  lip line L${L}: z ${(lz / ln - headAnchor[2]).toFixed(4)} (${ln} vertices), High scan ${(mouthMid[2] - headAnchor[2]).toFixed(4)}`);
  }
  // Hands
  for (const side of ['L', 'R']) {
    const h = hands[side];
    const d = decimate(h.m, BUDGET.hand[L]);
    const near = nearest(h.m, d.P);
    const wts = Array.from(near, (j) => h.weights[j]);
    const col = vertexColours(d, handSamples);
    for (let i = 0; i < col.length; i++) col[i] *= tone[i % 3];
    // Wrist-relative, scaled for the woman.
    const P = new Float32Array(d.P.length);
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) P[i + k] = (d.P[i + k] - h.wrist[k]) * HAND_SCALE;
    tuck(P, (HAND_CUT - h.wrist[1]) * HAND_SCALE, 0.02, 0.3);
    level[`hand${side}`] = pack(P, d.N, d.I, wts, [0, 0, 0], { c: round(col, 3) });
  }
  // Feet
  for (const side of ['L', 'R']) {
    const f = feet[side];
    const d = decimate(f.m, BUDGET.foot[L]);
    const col = vertexColours(d, footGrid);
    const P = new Float32Array(d.P.length);
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) P[i + k] = d.P[i + k] - f.anchor[k];
    tuck(P, CFG.footCut - f.anchor[1], 0.02, 0.25);
    level[`foot${side}`] = pack(P, d.N, d.I, footWeights(P, f.anchor, side), [0, 0, 0], { c: round(col, 3) });
  }
  const tris = Object.values(level).reduce((a, p) => a + p.i.length / 3, 0);
  console.log(`level ${L}: ${tris} tris`, Object.entries(level).map(([k, p]) => `${k} ${p.i.length / 3}`).join(', '));
  out.levels.push(level);
}
// ═════════════════════════════ BUILD ═════════════════════════════
// The body under the clothes, measured so the hoodie and joggers take its
// shape: per height, the outer radius in 32 directions round the torso (and
// 24 round the left leg), from the connected piece of the slice that is the
// torso (or leg). Directions start at the back and turn towards +X (the
// game's sweep convention); z is relative to the head's neck ring, which the
// game lines up with its neck bone.
function slicePieces(y0) {
  const C = 0.006, cells = new Map();
  for (let i = 0; i < O.pos.length; i += 3) {
    if (Math.abs(O.pos[i + 1] - y0) > 0.005) continue;
    const k = `${Math.floor(O.pos[i] / C)},${Math.floor(O.pos[i + 2] / C)}`;
    (cells.get(k) ?? cells.set(k, []).get(k)).push(O.pos[i], O.pos[i + 2]);
  }
  const seen = new Set(), pieces = [];
  for (const k of cells.keys()) {
    if (seen.has(k)) continue;
    const stack = [k], pts = [];
    seen.add(k);
    while (stack.length) {
      const c = stack.pop();
      pts.push(...cells.get(c));
      const [cx, cz] = c.split(',').map(Number);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const n = `${cx + dx},${cz + dz}`;
        if (cells.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    if (pts.length > 40) pieces.push(pts);
  }
  return pieces;
}
function profile(pts, n) {
  let cx = 0, cz = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
  cx = (x0 + x1) / 2; cz = (z0 + z1) / 2;
  const r = new Array(n).fill(0);
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - cx, dz = pts[i + 1] - cz;
    let a = Math.atan2(dx, -dz);
    if (a < 0) a += Math.PI * 2;
    const k = Math.round((a / (Math.PI * 2)) * n) % n;
    r[k] = Math.max(r[k], Math.hypot(dx, dz));
  }
  // Empty directions from their neighbours.
  for (let pass = 0; pass < n; pass++) {
    let any = false;
    for (let k = 0; k < n; k++) if (!r[k]) { const a = r[(k + n - 1) % n], b = r[(k + 1) % n]; if (a || b) { r[k] = a && b ? (a + b) / 2 : a || b; any = true; } }
    if (!any) break;
  }
  return { cx, cz, r };
}
const zRef = (() => { let s = 0, c = 0; for (let i = 0; i < headSrc.P.length / 3; i++) if (headSrc.P[i * 3 + 1] < CFG.neckCut + 0.015) { s += headSrc.P[i * 3 + 2]; c++; } return s / c; })();
const BUILD = { torso: [0.74, CFG.neckBase + 0.02], leg: [0.1, 0.78] };
const torso = [], leg = [];
for (let y = BUILD.torso[0]; y <= BUILD.torso[1] + 1e-6; y += 0.02) {
  const ps = slicePieces(y);
  // The torso: the piece over x = 0 (below the crotch, the two legs together).
  const mid = ps.filter((p) => { let a = Infinity, b = -Infinity; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); b = Math.max(b, p[i]); } return a < 0.02 && b > -0.02; });
  const pts = mid.length ? mid.flat() : ps.filter((p) => Math.abs(p[0]) < 0.25).flat();
  const pr = profile(pts, 32);
  torso.push([+pr.cx.toFixed(4), +(pr.cz - zRef).toFixed(4), ...pr.r.map((v) => +v.toFixed(4))]);
}
for (let y = BUILD.leg[0]; y <= BUILD.leg[1] + 1e-6; y += 0.02) {
  // The left leg (+X): the biggest piece wholly on that side.
  const ps = slicePieces(y).filter((p) => { for (let i = 0; i < p.length; i += 2) if (p[i] < 0.005) return false; return true; });
  ps.sort((a, b) => b.length - a.length);
  // Only the leg, not a hand hanging beside it: the piece nearest the middle.
  const near = ps.filter((p) => p.length > ps[0].length * 0.3).sort((a, b) => Math.min(...a.filter((_, i) => i % 2 === 0)) - Math.min(...b.filter((_, i) => i % 2 === 0)))[0];
  const pr = profile(near, 24);
  leg.push([+pr.cx.toFixed(4), +(pr.cz - zRef).toFixed(4), ...pr.r.map((v) => +v.toFixed(4))]);
}
out.body = { dy: 0.02, torso: { y0: BUILD.torso[0], rings: torso }, leg: { y0: BUILD.leg[0], rings: leg } };
console.log('build: torso', torso.length, 'rings, leg', leg.length, 'rings; zRef', zRef.toFixed(4));
for (const [i, r] of torso.entries()) if (i % 4 === 0) { const rr = r.slice(2); console.log(`  torso y ${(BUILD.torso[0] + i * 0.02).toFixed(2)} c ${r[0]},${r[1]}  back ${rr[0]} side ${rr[8]} front ${rr[16]}`); }
for (const [i, r] of leg.entries()) if (i % 6 === 0) { const rr = r.slice(2); console.log(`  leg y ${(BUILD.leg[0] + i * 0.02).toFixed(2)} c ${r[0]},${r[1]}  back ${rr[0]} out ${rr[6]} front ${rr[12]} in ${rr[18]}`); }

out.anchors = { head: round(headAnchor), footL: round(feet.L.anchor), footR: round(feet.R.anchor), wristL: round(hands.L.wrist), wristR: round(hands.R.wrist) };
writeFileSync(outPath, JSON.stringify(out));
console.log('wrote', outPath, (JSON.stringify(out).length / 1024).toFixed(0) + ' KB');
