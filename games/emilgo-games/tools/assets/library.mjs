// The asset library (v4 rework R4; the owner: "use all assets you showed me in
// the plan document because i am not seeing them"). The concept pictures were
// made with CC0 photo textures and HDR skies from Poly Haven; ambientCG's CC0
// building facades join them. This builds them for the game:
//
//   textures  albedo + normal (OpenGL), JPEG at 256 / 512 / 1024 px
//             → assets-site/lib/tex/<name>.<a|n>.<size>.jpg
//   skies     each HDR sky as a picture for the background (1024 × 512 JPEG,
//             tone-mapped here) and a small HDR for the light (128 × 64)
//             → assets-site/lib/sky/<name>.jpg, <name>.hdr
//   library.json  what's there, where it came from, its licence
//
//   node tools/assets/library.mjs
//
// The site serves assets-site/ (vite.config.ts siteAssets); the game falls back
// to its own drawn textures without it (the app offline). Every source is CC0.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { FloatType } from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

const here = dirname(fileURLToPath(import.meta.url));
const IN = join(here, "in/lib");
const CACHE = join(here, "../../dev/concepts/.cache");
const OUT = join(here, "../../assets-site/lib");
for (const d of [IN, join(OUT, "tex"), join(OUT, "sky")]) mkdirSync(d, { recursive: true });

/** [game name, source ("ph" Poly Haven | "acg" ambientCG), source id, what it is] */
export const TEXTURES = [
  // Ground
  ["asphalt", "ph", "asphalt_02", "road asphalt"],
  ["asphaltWorn", "ph", "worn_asphalt", "worn asphalt"],
  ["roadDamaged", "ph", "road_damaged", "a broken road"],
  ["gravel", "ph", "gravel_road", "a gravel road"],
  ["paving", "ph", "concrete_floor_worn_001", "concrete paving"],
  ["cobble", "ph", "cobblestone_floor_08", "cobbles"],
  ["grass", "ph", "leafy_grass", "grass"],
  ["grassSparse", "ph", "sparse_grass", "sparse grass"],
  ["dirt", "ph", "park_dirt", "dirt"],
  ["forest", "ph", "forest_ground_04", "the forest floor"],
  ["leaves", "ph", "forest_leaves_02", "fallen leaves"],
  ["mud", "ph", "brown_mud_leaves_01", "mud and leaves"],
  ["dryMud", "ph", "dry_mud_field_001", "dry cracked mud"],
  ["sand", "ph", "sand_01", "sand"],
  ["snow", "ph", "snow_02", "snow"],
  ["rock", "ph", "aerial_rocks_02", "rock ground"],
  ["cliff", "ph", "cliff_side", "a cliff face"],
  ["darkRock", "ph", "dark_rock", "dark rock"],
  ["rockWall", "ph", "rock_wall_08", "a rock wall"],
  // Walls and roofs
  ["plaster", "ph", "plastered_wall", "plaster"],
  ["paintedConcrete", "ph", "painted_concrete", "painted concrete"],
  ["concrete", "ph", "concrete_wall_008", "concrete"],
  ["panels", "ph", "concrete_panels", "concrete panels"],
  ["brick", "ph", "brick_wall_001", "brick"],
  ["planks", "ph", "weathered_planks", "weathered planks"],
  ["metal", "ph", "metal_plate", "steel plate"],
  ["corrugated", "ph", "corrugated_iron", "corrugated iron"],
  ["rust", "ph", "rusty_metal_02", "rusted steel"],
  ["rustSheet", "ph", "rusty_metal_sheet", "a rusted sheet"],
  ["roofTiles", "ph", "grey_roof_tiles", "roof tiles"],
  // Facades (ambientCG): glass towers, brick and concrete blocks, lit windows at night
  ["glassTower", "acg", "Facade001", "a glass curtain wall"],
  ["glassGrid", "acg", "Facade006", "a gridded glass facade"],
  ["brickFacade", "acg", "Facade018A", "brick with windows"],
  ["concreteFacade", "acg", "Facade019A", "concrete with windows"],
  ["nightOffice", "acg", "Facade015", "an office at night"],
  ["nightTower", "acg", "Facade012", "a tower at night"],
];

/** [game name, Poly Haven HDRI id] */
export const SKIES = [
  ["day", "kloofendal_48d_partly_cloudy_puresky"],
  ["clear", "syferfontein_6d_clear_puresky"],
  ["afternoon", "qwantani_late_afternoon_puresky"],
  ["dusk", "qwantani_dusk_2_puresky"],
  ["sunset", "industrial_sunset_02_puresky"],
  ["overcast", "kloofendal_overcast_puresky"],
  ["misty", "kloofendal_misty_morning_puresky"],
  ["wasteland", "wasteland_clouds_puresky"],
  ["snowfield", "snow_field_2_puresky"],
  ["high", "kloppenheim_02_puresky"],
  ["moon", "qwantani_moonrise_puresky"],
  ["night", "qwantani_night_puresky"],
];

const SIZES = [256, 512, 1024];

async function fetchTo(url, file) {
  if (existsSync(file)) return true;
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        if (r.status === 404) return false;
        throw new Error(String(r.status));
      }
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return true;
    } catch (e) {
      console.warn("retry", url, e.message);
    }
  }
  return false;
}

/** The 1K albedo and normal of a set (from the concept cache when it has them). */
async function source(src, id) {
  const a = join(IN, `${id}_a.jpg`);
  const n = join(IN, `${id}_n.jpg`);
  if (src === "ph") {
    const ca = join(CACHE, "tex", `${id}_diff.jpg`);
    const cn = join(CACHE, "tex", `${id}_nor.jpg`);
    if (!existsSync(a) && existsSync(ca)) copyFileSync(ca, a);
    if (!existsSync(n) && existsSync(cn)) copyFileSync(cn, n);
    await fetchTo(`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_diff_1k.jpg`, a);
    await fetchTo(`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_nor_gl_1k.jpg`, n);
  } else {
    if (!existsSync(a) || !existsSync(n)) {
      const zip = join(IN, `${id}.zip`);
      await fetchTo(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`, zip);
      const dir = join(IN, id);
      mkdirSync(dir, { recursive: true });
      execFileSync("unzip", ["-o", "-q", zip, "-d", dir]);
      const files = readdirSync(dir);
      const col = files.find((f) => /_Color\.jpg$/i.test(f));
      const nor = files.find((f) => /_NormalGL\.jpg$/i.test(f));
      if (col) copyFileSync(join(dir, col), a);
      if (nor) copyFileSync(join(dir, nor), n);
    }
  }
  return existsSync(a) && existsSync(n) ? { a, n } : null;
}

function resize(src, size, out, q = 78) {
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(q), "-z", String(size), String(size), src, "--out", out], { stdio: "ignore" });
}

// ── PNG and RGBE writers (for the skies) ─────────────────────────────────────
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
function rgbe(w, h, f) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`);
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = f[i * 3];
    const g = f[i * 3 + 1];
    const b = f[i * 3 + 2];
    const m = Math.max(r, g, b);
    if (m < 1e-32) continue;
    const e = Math.ceil(Math.log2(m) + 1e-9);
    const s = 256 / Math.pow(2, e);
    px[i * 4] = Math.min(255, Math.floor(r * s));
    px[i * 4 + 1] = Math.min(255, Math.floor(g * s));
    px[i * 4 + 2] = Math.min(255, Math.floor(b * s));
    px[i * 4 + 3] = e + 128;
  }
  return Buffer.concat([head, px]);
}
/** Box-filter a float RGB picture down to w × h. */
function shrink(src, sw, sh, w, h) {
  const out = new Float32Array(w * h * 3);
  const fx = sw / w;
  const fy = sh / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.floor(y * fy); yy < Math.floor((y + 1) * fy); yy++)
        for (let xx = Math.floor(x * fx); xx < Math.floor((x + 1) * fx); xx++) {
          const i = (yy * sw + xx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          n++;
        }
      out[(y * w + x) * 3] = r / n;
      out[(y * w + x) * 3 + 1] = g / n;
      out[(y * w + x) * 3 + 2] = b / n;
    }
  return out;
}

async function sky(name, id) {
  const hdr = join(IN, `${id}.hdr`);
  const c = join(CACHE, "hdri", `${id}.hdr`);
  if (!existsSync(hdr) && existsSync(c)) copyFileSync(c, hdr);
  if (!(await fetchTo(`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${id}_1k.hdr`, hdr))) return false;
  const buf = readFileSync(hdr);
  const L = new HDRLoader();
  L.setDataType(FloatType);
  const t = L.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { width: W, height: H, data } = t;
  // The background: ACES-ish tone map and sRGB, at 1024 × 512.
  const w = 1024;
  const h = 512;
  const f = shrink(data, W, H, w, h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) sum += Math.log(1e-4 + 0.2126 * f[i * 3] + 0.7152 * f[i * 3 + 1] + 0.0722 * f[i * 3 + 2]);
  const key = 0.22 / Math.exp(sum / (w * h));
  const aces = (x) => (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  const srgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h * 3; i++) rgb[i] = Math.round(Math.min(1, Math.max(0, srgb(aces(f[i] * key)))) * 255);
  const tmp = join(IN, `${name}.sky.png`);
  writeFileSync(tmp, png(w, h, rgb));
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", tmp, "--out", join(OUT, "sky", `${name}.jpg`)], { stdio: "ignore" });
  // The light: 128 × 64 HDR (its exposure kept as it is; the game scales it).
  writeFileSync(join(OUT, "sky", `${name}.hdr`), rgbe(128, 64, shrink(data, W, H, 128, 64)));
  return { key: +key.toFixed(4) };
}

const lib = { textures: {}, skies: {} };
for (const [name, src, id, what] of TEXTURES) {
  const s = await source(src, id);
  if (!s) {
    console.warn("missing", name, id);
    continue;
  }
  for (const size of SIZES) {
    resize(s.a, size, join(OUT, "tex", `${name}.a.${size}.jpg`), size >= 1024 ? 80 : 78);
    resize(s.n, size, join(OUT, "tex", `${name}.n.${size}.jpg`), 82);
  }
  lib.textures[name] = { what, source: src === "ph" ? `https://polyhaven.com/a/${id}` : `https://ambientcg.com/view?id=${id}`, licence: "CC0" };
  console.log("texture", name);
}
for (const [name, id] of SKIES) {
  const r = await sky(name, id);
  if (!r) {
    console.warn("missing sky", name);
    continue;
  }
  lib.skies[name] = { source: `https://polyhaven.com/a/${id}`, licence: "CC0", key: r.key };
  console.log("sky", name);
}
writeFileSync(join(OUT, "library.json"), JSON.stringify(lib, null, 1));
writeFileSync(join(OUT, "CREDITS.txt"), "EMILGO Games: textures from Poly Haven (polyhaven.com) and ambientCG (ambientcg.com), skies from Poly Haven. All CC0 (public domain).\n" + Object.entries({ ...lib.textures, ...lib.skies }).map(([k, v]) => `${k}: ${v.source}`).join("\n") + "\n");
