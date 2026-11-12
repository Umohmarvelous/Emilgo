// Boot: find the host, load settings, build the game, drop the splash.
// Target: playable within a few seconds on mobile data. The street, the doll
// and the sounds are all generated; the only download is the scanned people
// (about 150 KB for the far and Low levels, fetched while the host is found;
// Medium and High follow after the lobby is up, only on tiers that draw them).

import "./ui/styles.css";

import { loadFonts } from "./ui/fonts";
import { nextDrop } from "./ui/places";
import dropPic from "./ui/howto/basics-items.webp?url";
import findPic from "./ui/howto/treasure-hunt.webp?url";
import uploadPic from "./ui/howto/basics-zone.webp?url";

import { Game } from "./game/session";
import { loadOperators, loadScans } from "./world/human";
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
/**
 * v7 (2.12): a first-timer gets long enough to take in how it plays (each
 * picture lit in turn), or taps on once the game is ready.
 */
const FIRST_MIN_MS = 5200;
const STEP_MS = 1300;
const WELCOMED = "eg.welcomed";
const bootStarted = performance.now();

/** Never seen the welcome on this phone (storage that throws counts as seen: no hold). */
function firstVisit(): boolean {
  try {
    return localStorage.getItem(WELCOMED) === null;
  } catch {
    return false;
  }
}
const first = firstVisit();

/** How it plays: the three pictures lit one after another (all three at once for a returning player). */
function showHow(pics: boolean): void {
  const items = [...document.querySelectorAll<HTMLElement>("#boot .how li")];
  if (pics) {
    const urls: Record<string, string> = { drop: dropPic, find: findPic, upload: uploadPic };
    for (const p of document.querySelectorAll<HTMLElement>("#boot .how .pic")) p.style.backgroundImage = `url(${urls[p.dataset.pic ?? ""]})`;
  }
  if (!first) {
    for (const li of items) li.classList.add("on");
    return;
  }
  items.forEach((li, i) => setTimeout(() => li.classList.add("on"), 350 + i * STEP_MS));
}

function hideBoot(): void {
  const boot = document.getElementById("boot");
  if (!boot) return;
  let gone = false;
  const go = () => {
    if (gone) return;
    gone = true;
    try {
      localStorage.setItem(WELCOMED, "1");
    } catch {
      /* private mode */
    }
    boot.classList.add("done");
    setTimeout(() => boot.remove(), 500);
  };
  const wait = Math.max(0, (first ? FIRST_MIN_MS : WELCOME_MIN_MS) - (performance.now() - bootStarted));
  if (first && wait > 0) {
    // Ready: a tap goes on at once.
    boot.classList.add("ready");
    boot.addEventListener("pointerdown", go, { once: true });
  }
  setTimeout(go, wait);
}

/** The hero art (dev/poster.ts renders it); the gradient shows until it has loaded. */
function showArt(): void {
  const art = document.getElementById("boot-art");
  if (!art) return;
  // A slow connection (the script itself took seconds to come) or data saver:
  // the picture would arrive after the lobby and take bandwidth from it.
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const slow = performance.now() > 2000 || !!conn?.saveData;
  showHow(!slow);
  if (slow) return;
  // v4 Welcome A: this week's place, full-bleed (lobby B's background), named top right.
  const drop = nextDrop();
  const tag = document.getElementById("boot-drop");
  if (tag) tag.innerHTML = `NEXT DROP<b>${drop.name.toUpperCase()}</b>`;
  const img = new Image();
  img.onload = () => {
    art.style.backgroundImage = `url(${img.src})`;
    art.classList.add("in");
  };
  img.src = drop.url;
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
  // The operators' bodies and moves (v4 rework): in the background; Free For All waits on them (session.ts).
  loadOperators().catch((e) => console.warn("operators unavailable", e));
  loadFonts();
  showArt();
  progress(0.25, "Loading Lagos...");
  const host = await detectHost();
  mark("host");
  progress(0.55, "Waking the city...");
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
