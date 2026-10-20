// Bundles the test tools (load test, fairness test). Kept apart from the server
// build on purpose: test tools never ship with the server.
import { build } from "esbuild";

for (const name of ["loadtest", "fairness", "mockvatar", "matchtest", "shoptest", "apicheck", "rulestest", "ballstest", "socialtest"]) {
  await build({
    entryPoints: [`server/scripts/${name}.ts`],
    outfile: `server/dist/${name}.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    packages: "external",
    logLevel: "warning",
  });
}
