// Two builds from one source:
//
//   vite build                → dist/          the HTTPS site Lagos Life frames
//   vite build --mode emilgo  → dist-emilgo/   ONE self-contained HTML file that
//                                             the EMILGO app embeds (offline play)
//
// The Lagos Life build must be served with the frame-ancestors header below and
// never with X-Frame-Options DENY/SAMEORIGIN (docs, Quick start 02). The dev and
// preview servers send it too, so the sandbox can frame a tunnelled dev build.

import type { OutputAsset, OutputChunk } from "rollup";
import { defineConfig, type Plugin } from "vite";

export const FRAME_ANCESTORS =
  "frame-ancestors https://lagoslife.app https://www.lagoslife.app https://naijalife.app https://www.naijalife.app https://lagoslife.eliysites.com";

/** The EMILGO copy never talks to Lagos Life: drop the SDK tag entirely. */
function stripVatarSdk(): Plugin {
  return {
    name: "emilgo-games-strip-vatar",
    transformIndexHtml(html) {
      return html.replace(/\s*<!--[^]*?-->\s*<script async src="https:\/\/lagoslife\.app\/sdk\/vatar-games-v1\.js"><\/script>/, "");
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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default defineConfig(({ mode }) => {
  const emilgo = mode === "emilgo";
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
      outDir: emilgo ? "dist-emilgo" : "dist",
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
    plugins: emilgo ? [stripVatarSdk(), singleFile()] : [],
  };
});
