// Two builds from one source:
//
//   vite build                → dist/          the HTTPS site Lagos Life frames
//   vite build --mode emilgo  → dist-emilgo/   ONE self-contained HTML file that
//                                             the EMILGO app embeds (offline play)
//   vite build --mode web     → dist-web/      the game on its own web site: split
//                                             like dist/ (the matches' code comes
//                                             after the lobby), no Lagos Life SDK
//
// The Lagos Life build must be served with the frame-ancestors header below and
// never with X-Frame-Options DENY/SAMEORIGIN (docs, Quick start 02). The dev and
// preview servers send it too, so the sandbox can frame a tunnelled dev build.

import type { OutputAsset, OutputChunk } from "rollup";
import { defineConfig, type Plugin } from "vite";
import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

export const FRAME_ANCESTORS =
  "frame-ancestors https://lagoslife.app https://www.lagoslife.app https://naijalife.app https://www.naijalife.app https://lagoslife.eliysites.com";

/** The EMILGO copy never talks to Lagos Life: drop the SDK tag entirely. */
function stripVatarSdk(): Plugin {
  return {
    name: "emilgo-games-strip-vatar",
    transformIndexHtml(html) {
      // The comment just before the tag, and the tag (a comment may not run into another: the page has more than one).
      return html.replace(/\s*<!--(?:(?!-->)[\s\S])*-->\s*<script async src="https:\/\/lagoslife\.app\/sdk\/vatar-games-v1\.js"><\/script>/, "");
    },
  };
}

/** The app's single file has no public/ (v5, 3.9): no home-screen icon or manifest links to miss (the app has its own icon). */
function stripSiteLinks(): Plugin {
  return {
    name: "emilgo-games-strip-site-links",
    transformIndexHtml(html) {
      return html.replace(/\s*<link rel="(manifest|apple-touch-icon)"[^>]*>/g, "").replace(/<link rel="icon" type="image\/png" href="icons\/icon-32\.png" \/>/, '<link rel="icon" href="data:," />');
    },
  };
}

/** Inline the JS and CSS into index.html, so the app can load it as a string. */
function singleFile(): Plugin {
  return {
    name: "emilgo-games-single-file",
    enforce: "post",
    generateBundle(_, bundle) {
      const htmlName = Object.keys(bundle).find((k) => k.endsWith(".html"));
      if (!htmlName) return;
      const html = bundle[htmlName] as OutputAsset;
      let src = String(html.source);
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === "chunk" && (item as OutputChunk).isEntry) {
          // "</script" inside the code would end the tag early.
          const code = (item as OutputChunk).code.replace(/<\/script/gi, "<\\/script");
          const re = new RegExp(`<script[^>]*src="[^"]*${escapeRe(name)}"[^>]*></script>`);
          // A function replacement: `$&` and friends in minified code must stay literal.
          src = src.replace(re, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (item.type === "asset" && name.endsWith(".css")) {
          const re = new RegExp(`<link[^>]*href="[^"]*${escapeRe(name)}"[^>]*>`);
          const css = String((item as OutputAsset).source);
          src = src.replace(re, () => `<style>${css}</style>`);
          delete bundle[name];
        }
      }
      html.source = src;
    },
  };
}

/**
 * The scanned people's base files (scanbody.ts) are needed before the lobby:
 * fetch them alongside the script, not after it runs. On slow 4G that was over
 * a second of the boot.
 */
function preloadScans(): Plugin {
  return {
    name: "emilgo-games-preload-scans",
    transformIndexHtml: {
      order: "post",
      handler(_, ctx) {
        return Object.keys(ctx.bundle ?? {})
          .filter((f) => /\/scan-[mf]-base-[^/]*\.bin$/.test(f))
          .map((f) => ({ tag: "link", attrs: { rel: "preload", as: "fetch", crossorigin: "", href: `./${f}` }, injectTo: "head" as const }));
      },
    },
  };
}

/**
 * The site's downloaded assets (v4 rework: the CC0 music, textures, skies and
 * models the tools build into assets-site/, git-ignored): served at the root in
 * dev, copied into the site's build. ASSET_DIR overrides where they are (the
 * deploy script builds from a clean checkout). The EMILGO app's single file
 * never carries them; it streams them from the site.
 */
function siteAssets(): Plugin {
  const dir = resolve(process.env.ASSET_DIR ?? resolve(__dirname, "assets-site"));
  const TYPES: Record<string, string> = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".ktx2": "image/ktx2", ".glb": "model/gltf-binary", ".json": "application/json", ".hdr": "image/vnd.radiance", ".txt": "text/plain", ".bin": "application/octet-stream" };
  let out = "";
  return {
    name: "emilgo-games-site-assets",
    configResolved(c) {
      out = resolve(c.root, c.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0]);
        if (!/^\/(music|lib)\//.test(url)) return next();
        const file = normalize(join(dir, url));
        if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Length", String(statSync(file).size));
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (!existsSync(dir) || !out) return;
      for (const sub of ["music", "lib"]) if (existsSync(join(dir, sub))) cpSync(join(dir, sub), join(out, sub), { recursive: true });
    },
  };
}

/**
 * The link card (v5, 3.4: one click from X): what a post of the site's link
 * shows on X and the rest (Open Graph and Twitter Card tags). SITE_URL is the
 * site's address (the test site by default); the picture is public/card.jpg
 * (dev/howto-shots.mjs card). The link people post: <SITE_URL>/?play
 */
function siteMeta(): Plugin {
  const site = (process.env.SITE_URL ?? "https://milgogames.pages.dev").replace(/\/+$/, "");
  const title = "Blackmask: Treasure Hunt · free in your browser";
  const about = "Free in your browser, nothing to download: find the five hidden treasures, upload them at the machine, and fight for what the others found.";
  const tags: [string, string, string][] = [
    ["property", "og:type", "website"],
    ["property", "og:site_name", "Blackmask · EMILGO Games"],
    ["property", "og:title", title],
    ["property", "og:description", about],
    ["property", "og:url", `${site}/?play`],
    ["property", "og:image", `${site}/card.jpg`],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", "A player walking up to the treasure upload machine in its ring of light"],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", title],
    ["name", "twitter:description", about],
    ["name", "twitter:image", `${site}/card.jpg`],
  ];
  return {
    name: "emilgo-games-site-meta",
    transformIndexHtml() {
      return tags.map(([k, v, content]) => ({ tag: "meta", attrs: { [k]: v, content }, injectTo: "head" as const }));
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default defineConfig(({ mode }) => {
  const emilgo = mode === "emilgo";
  const web = mode === "web";
  return {
    base: "./",
    define: {
      __HOST_BUILD__: JSON.stringify(emilgo ? "emilgo" : "web"),
    },
    server: { headers: { "Content-Security-Policy": FRAME_ANCESTORS } },
    preview: { headers: { "Content-Security-Policy": FRAME_ANCESTORS } },
    build: {
      // Old Android WebViews and iOS 14 Safari still out there: transpile down.
      target: "es2019",
      outDir: emilgo ? "dist-emilgo" : web ? "dist-web" : "dist",
      emptyOutDir: true,
      sourcemap: false,
      reportCompressedSize: true,
      chunkSizeWarningLimit: 900,
      ...(emilgo
        ? {
            assetsInlineLimit: 100_000_000,
            cssCodeSplit: false,
            modulePreload: false,
            rollupOptions: { output: { inlineDynamicImports: true } },
          }
        : {}),
    },
    // The app's single file has no public/ (the link card and the site's headers are the site's).
    ...(emilgo ? { publicDir: false as const } : {}),
    plugins: emilgo ? [stripVatarSdk(), stripSiteLinks(), singleFile()] : web ? [stripVatarSdk(), preloadScans(), siteAssets(), siteMeta()] : [preloadScans(), siteAssets(), siteMeta()],
  };
});
