// The game's own pages, when SITE_DIR names a web build (the Fly image does:
// server/Dockerfile). Files are listed once at start: a request can only reach
// a listed file, and nothing here blocks the tick loop with disk calls.
// A neighbouring x.gz (made at image build) is sent to browsers that take gzip,
// so serving costs no CPU the matches need.

import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, relative, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ktx2": "image/ktx2",
  ".hdr": "image/vnd.radiance",
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

// The same as public/_headers on the Cloudflare site, less the Lagos Life
// frame list: this copy is the game on its own, not framed by anyone.
const SECURITY = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

interface SiteFile {
  path: string;
  size: number;
  /** Size of path + ".gz", when that exists and is smaller. */
  gzSize: number | null;
}

function list(dir: string): Map<string, SiteFile> {
  const files = new Map<string, SiteFile>();
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && !entry.name.endsWith(".gz")) {
        const size = statSync(path).size;
        const gz = existsSync(`${path}.gz`) ? statSync(`${path}.gz`).size : null;
        files.set(`/${relative(dir, path).split(sep).join("/")}`, { path, size, gzSize: gz !== null && gz < size ? gz : null });
      }
    }
  };
  walk(dir);
  return files;
}

function cacheFor(url: string): string {
  if (url === "/index.html") return "no-cache";
  if (url.startsWith("/assets/")) return "public, max-age=31536000, immutable"; // hashed names
  return "public, max-age=604800";
}

/** Bytes to send for a Range header: null = the whole file, "bad" = can't satisfy. */
function rangeOf(header: string | undefined, size: number): { start: number; end: number } | "bad" | null {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start > end || start >= size ? "bad" : { start, end };
}

/** A request handler that answers true when it served the request; null without a build at dir. */
export function loadSite(dir: string): ((req: IncomingMessage, res: ServerResponse) => boolean) | null {
  if (!existsSync(join(dir, "index.html"))) return null;
  const files = list(dir);

  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    let url: string;
    try {
      url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    } catch {
      return false;
    }
    if (url === "/") url = "/index.html";
    const file = files.get(url);
    if (!file) return false;

    const headers: Record<string, string | number> = {
      ...SECURITY,
      "Content-Type": TYPES[extname(url)] ?? "application/octet-stream",
      "Cache-Control": cacheFor(url),
      "Accept-Ranges": "bytes",
      Vary: "Accept-Encoding",
    };

    const range = rangeOf(req.headers.range, file.size);
    if (range === "bad") {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${file.size}` }).end();
      return true;
    }

    // A range counts bytes of the file itself, so ranges skip the gzip copy.
    const gzip = !range && file.gzSize !== null && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
    if (gzip) headers["Content-Encoding"] = "gzip";
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${file.size}`;
    headers["Content-Length"] = range ? range.end - range.start + 1 : gzip ? file.gzSize! : file.size;
    res.writeHead(range ? 206 : 200, headers);

    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    const stream = gzip ? createReadStream(`${file.path}.gz`) : createReadStream(file.path, range ?? undefined);
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
    return true;
  };
}
