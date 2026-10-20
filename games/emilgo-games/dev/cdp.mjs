// Dev only: drive the game in headless Chrome over the DevTools protocol —
// phone-sized viewports, touch input, screenshots, console capture. No
// dependencies (Node 22+ has WebSocket).
//
//   node dev/cdp.mjs <url> <outdir> <script.json>
//
// Env: VIEW=WxH (default 375x812, mobile), DPR=1, GPU=1 (real GPU, else
// SwiftShader), CPU_RATE=4 (throttle), NET_KBPS=1600 NET_RTT=150.
//
// Steps (JSON array):
//   {"wait": ms}                         {"shot": "name"} (may be combined with wait)
//   {"until": "js expr", "timeout": ms}  {"eval": "js expr", "label": "..."}
//   {"tapSel": "css"}                    {"tap": [x, y]}
//   {"hold": [[x0,y0],[x1,y1]]}          {"release": true}
//   {"key": "Space"}                     (keyDown + keyUp)
//   {"saveEval": "canvas.toDataURL()", "file": "path"}  (write a data: URL to disk)
//   {"profile": ms, "top": 25}           (sample the CPU for ms; print the functions with the most self time)
//   {"offline": true}                    (drop the network, or bring it back with false)
//   {"net": [kbps, rttMs]}               (throttle the network from here on; [0, 0] lifts it)

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const [url, outDir, scriptPath] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(scriptPath, "utf8"));
mkdirSync(outDir, { recursive: true });
const PORT = 9333 + Math.floor(Math.random() * 400);
const prof = join(outDir, `prof-${Date.now()}`);

const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`,
    ...(process.env.GPU ? ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"]),
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let id = 0;
const pending = new Map();
const logs = [];
let held = null;

async function connect() {
  for (let i = 0; i < 200; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("no chrome");
}

function send(method, params = {}) {
  return new Promise((ok, no) => {
    const i = ++id;
    pending.set(i, { ok, no });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}

async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } : { value: r.result?.value };
}

async function touch(type, x, y) {
  await send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
}

async function main() {
  ws = new WebSocket(await connect());
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      d.error ? p.no(new Error(JSON.stringify(d.error))) : p.ok(d.result);
    } else if (d.method === "Runtime.consoleAPICalled") {
      logs.push(`[${d.params.type}] ` + d.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    } else if (d.method === "Runtime.exceptionThrown") {
      logs.push("[exception] " + JSON.stringify(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
    } else if (d.method === "Log.entryAdded") {
      logs.push(`[log:${d.params.entry.level}] ${d.params.entry.text}`);
    }
  };
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  const [W, H] = (process.env.VIEW ?? "375x812").split("x").map(Number);
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: Number(process.env.DPR ?? 1), mobile: !process.env.VIEW });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  if (process.env.CPU_RATE) await send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CPU_RATE) });
  if (process.env.NET_KBPS) {
    await send("Network.enable");
    const bps = (Number(process.env.NET_KBPS) * 1024) / 8;
    await send("Network.emulateNetworkConditions", { offline: false, latency: Number(process.env.NET_RTT ?? 150), downloadThroughput: bps, uploadThroughput: bps / 2 });
  }
  const t0 = Date.now();
  await send("Page.navigate", { url });

  for (const s of steps) {
    if (s.wait) await sleep(s.wait);
    if (s.until) {
      const start = Date.now();
      let ok = false;
      while (Date.now() - start < (s.timeout ?? 10000)) {
        const r = await evaluate(`!!(${s.until})`).catch(() => ({}));
        if (r.value) {
          ok = true;
          break;
        }
        await sleep(100);
      }
      console.log(`until ${s.label ?? ""} ${ok ? "ok" : "TIMEOUT"} ${((Date.now() - start) / 1000).toFixed(1)}s`);
    }
    if (s.eval) {
      const r = await evaluate(s.eval);
      console.log("eval", s.label ?? "", JSON.stringify(r.error ?? r.value));
    }
    if (s.tapSel) {
      const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(s.tapSel)}); if (!e) return null; e.scrollIntoView({block: "center"}); const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
      if (!r.value) console.log(`tapSel MISSING ${s.tapSel}`);
      else {
        const [x, y] = r.value;
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        console.log(`tapped ${s.tapSel}`);
        await sleep(250);
      }
    }
    if (s.tap) {
      await touch("touchStart", s.tap[0], s.tap[1]);
      await sleep(60);
      await touch("touchEnd", s.tap[0], s.tap[1]);
    }
    if (s.hold) {
      const [[x0, y0], [x1, y1]] = s.hold;
      await touch("touchStart", x0, y0);
      for (let i = 1; i <= 6; i++) {
        await sleep(16);
        await touch("touchMove", x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6);
      }
      held = [x1, y1];
    }
    if (s.release && held) {
      await touch("touchEnd", held[0], held[1]);
      held = null;
    }
    if (s.key) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: s.key === "Space" ? " " : s.key, code: s.key });
      await sleep(40);
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: s.key === "Space" ? " " : s.key, code: s.key });
    }
    if (s.net) {
      await send("Network.enable");
      const [kbps, rtt] = s.net;
      const bps = kbps ? (kbps * 1024) / 8 : -1;
      await send("Network.emulateNetworkConditions", { offline: false, latency: rtt, downloadThroughput: bps, uploadThroughput: kbps ? bps / 2 : -1 });
      console.log(`network ${kbps ? `${kbps} kbps, ${rtt} ms` : "unthrottled"}`);
    }
    if (s.offline !== undefined) {
      await send("Network.enable");
      await send("Network.emulateNetworkConditions", { offline: !!s.offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      console.log(`network ${s.offline ? "off" : "on"}`);
    }
    if (s.profile) {
      await send("Profiler.enable");
      await send("Profiler.setSamplingInterval", { interval: 200 });
      await send("Profiler.start");
      await sleep(s.profile);
      const { profile } = await send("Profiler.stop");
      const dt = profile.timeDeltas;
      const self = new Map();
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      profile.samples.forEach((id, i) => {
        const n = byId.get(id);
        const f = n.callFrame;
        const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
        self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
      });
      const total = [...self.values()].reduce((a, b) => a + b, 0);
      const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, s.top ?? 25);
      console.log(`profile ${(total / 1000).toFixed(0)} ms sampled`);
      for (const [k, v] of top) console.log(`  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
    }
    if (s.saveEval) {
      // Evaluate to a data: URL and write the decoded bytes to s.file.
      const r = await evaluate(s.saveEval);
      const m = /^data:[^;]+;base64,(.*)$/.exec(String(r.value ?? ""));
      if (m) {
        writeFileSync(s.file, Buffer.from(m[1], "base64"));
        console.log(`saved ${s.file} (${Math.round(Buffer.byteLength(m[1], "base64") / 1024)} KB)`);
      } else console.log(`saveEval failed: ${JSON.stringify(r.error ?? r.value).slice(0, 200)}`);
    }
    if (s.shot) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(outDir, `${s.shot}.png`), Buffer.from(r.data, "base64"));
      console.log(`shot ${s.shot}`);
    }
  }
  writeFileSync(join(outDir, "console.txt"), logs.join("\n"));
  console.log(`console lines: ${logs.length} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const l of logs.filter((x) => /error|exception/i.test(x) && !/WebSocket/.test(x)).slice(0, 8)) console.log(l);
}

main()
  .catch((e) => console.error(e))
  .finally(() => {
    chrome.kill("SIGKILL");
    setTimeout(() => {
      try {
        rmSync(prof, { recursive: true, force: true });
      } catch {}
      process.exit(0);
    }, 300);
  });
