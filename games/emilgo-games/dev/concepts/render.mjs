// Dev only: batch concept renders and UI screenshots — one headless Chrome
// (real GPU), many pages. Needs the dev server (npm run game:dev).
//
//   node dev/concepts/render.mjs <outdir> name[:w[:h]] ...
//
// A bare name renders /dev/concepts/shot.html?scene=<name> and saves its canvas.
// A name starting with "/" is a page path; the whole page is screenshotted.
// Each page sets window.__done when its frame is ready. Output: <outdir>/<name>.png
// (and .jpg at quality 84 with --jpg, written straight into concepts/img).
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const jpg = args.includes("--jpg");
const [outDir, ...jobs] = args.filter((a) => a !== "--jpg");
const base = process.env.BASE ?? "http://localhost:5173";
const imgDir = join(dirname(fileURLToPath(import.meta.url)), "../../concepts/img");
mkdirSync(outDir, { recursive: true });
const PORT = 9700 + Math.floor(Math.random() * 200);
const prof = join(outDir, `.prof-${Date.now()}`);
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--no-first-run", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let id = 0;
const pending = new Map();
const logs = [];
const send = (method, params = {}) =>
  new Promise((ok, no) => {
    const i = ++id;
    pending.set(i, { ok, no });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return { value: r.result?.value };
}
async function main() {
  let url;
  for (let i = 0; i < 900 && !url; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      url = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {}
    if (!url) await sleep(200);
  }
  if (!url) throw new Error("no chrome");
  ws = new WebSocket(url);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.no(new Error(m.error.message)) : p.ok(m.result);
    } else if (m.method === "Runtime.consoleAPICalled") logs.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
    else if (m.method === "Runtime.exceptionThrown") logs.push(`[exception] ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
  };
  await send("Runtime.enable");
  await send("Page.enable");
  for (const job of jobs) {
    const [name, w = "1600", h = "900", outName] = job.split(":");
    const t0 = Date.now();
    logs.length = 0;
    await send("Emulation.setDeviceMetricsOverride", { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false });
    const page = name.startsWith("/");
    const target = page ? `${base}${name}${name.includes("?") ? "&" : "?"}w=${w}&h=${h}` : `${base}/dev/concepts/shot.html?scene=${name}&w=${w}&h=${h}`;
    await send("Page.navigate", { url: target });
    let res = null;
    for (let i = 0; i < 1500 && !res; i++) {
      await sleep(200);
      const r = await evaluate("window.__done ? JSON.stringify(window.__done) : ''");
      if (r.value) res = JSON.parse(r.value);
    }
    const stem = outName ?? name.replace(/^\//, "").replace(/[^a-z0-9_-]+/gi, "_");
    const file = join(outDir, `${stem}.png`);
    if (!res?.ok) {
      console.log(`FAIL ${stem} ${((Date.now() - t0) / 1000).toFixed(1)}s ${res?.error ?? "timeout"}`);
      for (const l of logs.slice(-10)) console.log("   " + l.slice(0, 300));
      continue;
    }
    await sleep(250);
    const data = page ? (await send("Page.captureScreenshot", { format: "png" })).data : (await evaluate("document.getElementById('c').toDataURL('image/png')")).value.split(",")[1];
    writeFileSync(file, Buffer.from(data, "base64"));
    if (jpg) execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "84", file, "--out", join(imgDir, `${stem}.jpg`)], { stdio: "ignore" });
    console.log(`ok ${stem} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}
main()
  .catch((e) => console.error(e))
  .finally(() => {
    try {
      ws?.close();
    } catch {}
    chrome.kill("SIGKILL");
    setTimeout(() => {
      try {
        rmSync(prof, { recursive: true, force: true });
      } catch {}
      process.exit(0);
    }, 400);
  });
