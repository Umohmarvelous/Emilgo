// Boot: find the host, load settings, build the game, drop the splash.
// Target: playable within a few seconds on mobile data. The street, the doll
// and the sounds are all generated; the only download is the scanned people
// (about 150 KB for the far and Low levels, fetched while the host is found;
// Medium and High follow after the lobby is up, only on tiers that draw them).

import "./ui/styles.css";

import { loadFonts } from "./ui/fonts";
import welcomeUrl from "./ui/welcome.webp?url";

import { Game } from "./game/session";
import { loadScans } from "./world/human";
import { detectHost } from "./platform";
import { loadSettings } from "./settings";

const bootFill = document.getElementById("boot-fill");
const bootText = document.getElementById("boot-text");

function progress(p: number, text?: string): void {
  if (bootFill) bootFill.style.width = `${Math.round(p * 100)}%`;
  if (text && bootText) bootText.textContent = text;
}

/** The welcome shows for at least this long (the brief: 2–3 seconds at most). */
const WELCOME_MIN_MS = 1600;
const bootStarted = performance.now();

function hideBoot(): void {
  const boot = document.getElementById("boot");
  if (!boot) return;
  const wait = Math.max(0, WELCOME_MIN_MS - (performance.now() - bootStarted));
  setTimeout(() => {
    boot.classList.add("done");
    setTimeout(() => boot.remove(), 500);
  }, wait);
}

/** The hero art (dev/poster.ts renders it); the gradient shows until it has loaded. */
function showArt(): void {
  const art = document.getElementById("boot-art");
  if (!art) return;
  const img = new Image();
  img.onload = () => {
    art.style.backgroundImage = `url(${img.src})`;
    art.classList.add("in");
  };
  img.src = welcomeUrl;
}

function fail(title: string, message: string): void {
  progress(1);
  const boot = document.getElementById("boot");
  if (bootText) bootText.textContent = "";
  if (boot) {
    const box = document.createElement("div");
    box.className = "boot-fail";
    const h = document.createElement("b");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = message;
    box.append(h, p);
    boot.append(box);
  }
}


/** Boot timings, readable from the console (performance.getEntriesByType("mark")). */
function mark(name: string): void {
  try {
    performance.mark(`eg:${name}`);
  } catch {
    /* very old browsers */
  }
}

async function boot(): Promise<void> {
  mark("script");
  // The people: started first, needed before the lobby is built. If it fails
  // everyone is drawn as the generated people instead.
  const scans = loadScans().catch((e) => console.warn("scanned people unavailable", e));
  loadFonts();
  showArt();
  progress(0.25, "Loading Lagos...");
  const host = await detectHost();
  mark("host");
  progress(0.55, "Calling Mama Gele...");
  const settings = loadSettings(host);

  const canvas = document.getElementById("scene") as HTMLCanvasElement;
  const ui = document.getElementById("ui") as HTMLElement;
  await scans;
  mark("scans");
  let game: Game;
  try {
    game = new Game(host, settings, canvas, ui);
    mark("game");
  } catch (e) {
    console.error(e);
    // No separate "is WebGL there?" probe: creating a throwaway context costs as
    // much as the real one on a weak phone. If the real one fails, say why.
    if (/webgl/i.test(String((e as Error)?.message ?? e))) {
      fail("3D no dey work here", "This browser can't draw 3D graphics. Try updating it, or open the game on another phone.");
    } else {
      fail("Something went wrong", "The game couldn't start on this device. Close it and try again.");
    }
    return;
  }
  progress(1, "Oya");
  game.start();
  // Development only: a handle for automated play-testing. Not in production builds.
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  // One frame for the first render to land before the splash goes.
  requestAnimationFrame(() => {
    mark("first-frame");
    hideBoot();
  });
}

boot().catch((e) => {
  console.error(e);
  fail("Something went wrong", "The game couldn't start. Close it and try again.");
});
