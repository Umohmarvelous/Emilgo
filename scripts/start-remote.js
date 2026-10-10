/**
 * Share the Expo dev app with someone on another network.
 *
 * Expo's built-in `--tunnel` uses ngrok, which often fails with "session closed".
 * This script uses Cloudflare quick tunnels (cloudflared) instead — usually more reliable.
 *
 * Prerequisites: cloudflared installed (`brew install cloudflared`)
 *
 * Usage: npm run expo:remote
 */

const { spawn } = require("child_process");
const http = require("http");

const METRO_PORT = process.env.METRO_PORT || "8081";
const API_PORT = process.env.PORT || "5001";
const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

const children = [];

function track(child) {
  children.push(child);
  return child;
}

function cleanup() {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

function stripHost(domain) {
  let value = domain.trim();
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  return new URL(value).host;
}

function scanForTunnelUrl(text, onFound) {
  const match = text.match(TUNNEL_URL_RE);
  if (match) {
    onFound(match[0]);
    return true;
  }
  return false;
}

function waitForTunnelUrl(proc, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(`${label} tunnel did not start within 45s`));
    }, 45000);

    const onStreamData = (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      scanForTunnelUrl(text, (url) => finish(resolve, url));
    };

    proc.stdout?.on("data", onStreamData);
    proc.stderr.on("data", onStreamData);
    proc.on("error", (err) => finish(reject, err));
    proc.on("exit", (code) => {
      if (!settled) {
        finish(
          reject,
          new Error(`${label} tunnel exited (code ${code ?? "unknown"})`),
        );
      }
    });
  });
}

function startCloudflared(port, label) {
  const proc = track(
    spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );

  return waitForTunnelUrl(proc, label).then((url) => {
    console.log(`\n✓ ${label} tunnel: ${url}\n`);
    return url;
  });
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, () => resolve(true));
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function startApiServer() {
  return new Promise((resolve, reject) => {
    const proc = track(
      spawn("npm", ["run", "server:dev"], {
        stdio: "inherit",
        env: { ...process.env, PORT: API_PORT, NODE_ENV: "development" },
      }),
    );
    proc.on("error", reject);

    let attempts = 0;
    const poll = setInterval(async () => {
      attempts += 1;
      if (await isPortListening(API_PORT)) {
        clearInterval(poll);
        console.log(`\n✓ API server listening on port ${API_PORT}\n`);
        resolve(proc);
      } else if (attempts > 30) {
        clearInterval(poll);
        reject(new Error(`API server did not start on port ${API_PORT}`));
      }
    }, 1000);
  });
}

async function main() {
  console.log("Starting remote dev session (Cloudflare tunnels)…\n");

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  const apiAlreadyUp = await isPortListening(API_PORT);
  if (!apiAlreadyUp) {
    console.log("Starting Express API server…");
    await startApiServer();
  } else {
    console.log(`API server already running on port ${API_PORT}`);
  }

  const [metroTunnel, apiTunnel] = await Promise.all([
    startCloudflared(METRO_PORT, "Metro"),
    startCloudflared(API_PORT, "API"),
  ]);

  const metroHost = stripHost(metroTunnel);
  const apiHost = stripHost(apiTunnel);

  console.log("────────────────────────────────────────────");
  console.log("Share with your remote tester:");
  console.log(`  1. Install Expo Go on their phone`);
  console.log(`  2. Scan the QR code below (exp:// URL uses the Metro tunnel)`);
  console.log(`  3. API requests go to: https://${apiHost}`);
  console.log("────────────────────────────────────────────\n");

  const expoEnv = {
    ...process.env,
    CI: "false",
    EXPO_PUBLIC_DOMAIN: apiHost,
    EXPO_PACKAGER_PROXY_URL: metroTunnel,
    REACT_NATIVE_PACKAGER_HOSTNAME: metroHost,
  };

  const expo = track(
    spawn("npx", ["expo", "start", "--web", "--localhost", "--port", METRO_PORT], {
      stdio: "inherit",
      env: expoEnv,
    }),
  );

  expo.on("exit", (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err.message || err);
  cleanup();
  process.exit(1);
});
