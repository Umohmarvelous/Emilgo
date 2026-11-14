import sharp from "sharp";
import { buildMaxWorld } from "../../src/maps/open/max";
import { footprint } from "../../src/maps/open/prefabs";
const L = buildMaxWorld();
const H = L.half, S = 1000 / (2 * H);
const X = (x: number) => ((x + H) * S).toFixed(1), Z = (z: number) => ((z + H) * S).toFixed(1);
const col: Record<string, string> = { pine: "#1d4a22", snowpine: "#9ab", tree: "#3a7a2a", palm: "#4a8a3a", baobab: "#2a5a1a", mangrove: "#2a4a2a", bush: "#6a8a4a", rock: "#777", prop: "#c96", dune: "#d8b070" };
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="#cbb994"/>`;
for (const a of L.areas.filter((a) => a.id.startsWith("mx-"))) svg += `<circle cx="${X(a.x)}" cy="${Z(a.z)}" r="${(a.r * S).toFixed(1)}" fill="none" stroke="#0006" stroke-dasharray="4 3"/><text x="${X(a.x)}" y="${Z(a.z - a.r - 4)}" font-size="13" text-anchor="middle" fill="#000">${a.name}</text>`;
for (const r of L.roads) svg += `<line x1="${X(r.x0)}" y1="${Z(r.z0)}" x2="${X(r.x1)}" y2="${Z(r.z1)}" stroke="${r.kind === "asphalt" ? "#444" : "#a86"}" stroke-width="${Math.max(1, r.w * S)}"/>`;
for (const w of L.rivers) svg += `<polyline points="${w.pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(" ")}" fill="none" stroke="#38a" stroke-width="${Math.max(1, w.w * S)}"/>`;
for (const p of L.placements) {
  const [w, d] = footprint(p.prefab, p.v);
  const c = col[p.prefab] ?? "#933";
  svg += `<rect x="${(-w / 2) * S}" y="${(-d / 2) * S}" width="${Math.max(0.8, w * S)}" height="${Math.max(0.8, d * S)}" fill="${c}" transform="translate(${X(p.x)} ${Z(p.z)}) rotate(${(-p.rot * 180) / Math.PI})"/>`;
}
for (const [x, z] of L.spawns) svg += `<circle cx="${X(x)}" cy="${Z(z)}" r="2.5" fill="#f0f"/>`;
svg += "</svg>";
await sharp(Buffer.from(svg)).png().toFile(process.argv[2]);
