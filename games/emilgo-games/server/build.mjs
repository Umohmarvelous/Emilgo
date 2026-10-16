// Bundles the server (and the shared referee it imports) into one ES module.
//   node server/build.mjs          → server/dist/index.mjs
//   node server/build.mjs --watch  → rebuild + restart on change (development)
import { spawn } from "node:child_process";
import { context, build } from "esbuild";

const watch = process.argv.includes("--watch");
const options = {
  entryPoints: ["server/src/index.ts"],
  outfile: "server/dist/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external", // ws stays a real dependency, installed next to the bundle
  sourcemap: true,
  logLevel: "info",
};

if (!watch) {
  await build(options);
} else {
  let child = null;
  const restart = () => {
    if (child) child.kill("SIGTERM");
    child = spawn(process.execPath, ["--enable-source-maps", options.outfile], { stdio: "inherit" });
  };
  const ctx = await context({
    ...options,
    plugins: [{ name: "restart", setup: (b) => b.onEnd((r) => !r.errors.length && restart()) }],
  });
  await ctx.watch();
}
