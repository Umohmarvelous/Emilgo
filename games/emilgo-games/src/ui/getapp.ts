// One click from X (v5, 3.4).
//
//   The link   ?play (or ?play=<mode id>) on the site's address: the game
//              loads straight to one big button, and one tap is a match (a
//              practice on the big world, no account, no setup). The site's
//              page carries an X card (vite.config.ts: siteMeta) so a post of
//              the link shows the game.
//   The app    after a few minutes of play in a browser, between matches, a
//              short note: the EMILGO app is the full game (sharper, smoother,
//              offline). v6 (the owner): the game first, on a PLAY NOW button,
//              then the EMILGO app. Not inside the EMILGO app or Lagos Life. Once a day
//              at most; "Not now" waits three days.
//
// The store addresses come from the build (VITE_APP_ANDROID_URL,
// VITE_APP_IOS_URL, VITE_APP_URL): the owner sets them when the listings exist.

import { el, esc } from "./dom";
import { icon } from "./icons";
import { t } from "./i18n";

/** Seconds of play in a browser before the note. */
export const GETAPP_AFTER = 6 * 60;
const DAY = 86_400_000;

const ANDROID = (import.meta.env.VITE_APP_ANDROID_URL as string | undefined) ?? "https://play.google.com/store/apps/details?id=com.teqil.app";
const IOS = (import.meta.env.VITE_APP_IOS_URL as string | undefined) ?? (import.meta.env.VITE_APP_URL as string | undefined) ?? "https://emilgo.app";
const OTHER = (import.meta.env.VITE_APP_URL as string | undefined) ?? "https://emilgo.app";

/** The store for this phone. */
export function appUrl(ua = navigator.userAgent): string {
  if (/android/i.test(ua)) return ANDROID;
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return IOS;
  return OTHER;
}

/** The mode a link asks for: null with no ?play, "" for the default. */
export function linkPlay(search = location.search): string | null {
  const q = new URLSearchParams(search);
  if (!q.has("play")) return null;
  const v = (q.get("play") ?? "").trim().toLowerCase();
  return /^[a-z0-9-]{0,40}$/.test(v) ? v : "";
}

/** The one big button over the lobby. Resolves when it is tapped. */
export function tapToPlay(parent: HTMLElement, mode: string, blurb: string): Promise<void> {
  return new Promise((done) => {
    const root = el("div", "tap-play");
    root.dataset.ui = "1";
    root.setAttribute("role", "button");
    root.setAttribute("tabindex", "0");
    root.innerHTML = `<div class="tp-in">
        <span class="tp-k">${esc(t("Free to play · no download"))}</span>
        <b class="tp-mode">${esc(t(mode))}</b>
        <span class="tp-blurb">${esc(blurb)}</span>
        <span class="tp-go">${icon("play", "", 22)}<span>${esc(t("Play now"))}</span></span>
      </div>`;
    let went = false;
    const go = (e: Event) => {
      e.preventDefault();
      if (went) return;
      went = true;
      root.classList.add("gone");
      setTimeout(() => root.remove(), 300);
      done();
    };
    // pointerup, not only click: a touch the lobby's own handlers claimed may never become a click.
    root.addEventListener("pointerup", go);
    root.addEventListener("click", go);
    root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") go(e);
    });
    parent.append(root);
    requestAnimationFrame(() => root.classList.add("in"));
  });
}

export interface GetAppState {
  /** Seconds played in a browser, all told. */
  webSeconds: number;
  /** When the note was last shown, and when "Not now" asks it to wait until (ms). */
  getAppAt: number;
  getAppWait: number;
}

/** Whether the note is due now (between matches). */
export function getAppDue(s: GetAppState, now = Date.now()): boolean {
  return s.webSeconds >= GETAPP_AFTER && now - s.getAppAt >= DAY && now >= s.getAppWait;
}

/** The note ("Not now" or a tap outside: three days before it comes again). `onClose` saves the state. */
export function showGetApp(parent: HTMLElement, s: GetAppState, onClose: () => void): void {
  s.getAppAt = Date.now();
  const root = el("div", "getapp");
  root.dataset.ui = "1";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", t("Get the app"));
  root.innerHTML = `<div class="ga-card">
      <span class="ga-k">${esc(t("Enjoying it?"))}</span>
      <b>${esc(t("Get the app"))}</b>
      <ul>
        <li>${icon("graphics", "", 16)}<span>${esc(t("Sharper graphics and smoother play"))}</span></li>
        <li>${icon("signal", "", 16)}<span>${esc(t("Plays offline, starts in a second"))}</span></li>
        <li>${icon("trophy", "", 16)}<span>${esc(t("LOOTLINE, your rank and your look on every phone"))}</span></li>
      </ul>
      <a class="btn primary" data-ga="get" href="${esc(appUrl())}" target="_blank" rel="noopener">${icon("next", "", 16)}${esc(t("Get the app"))}</a>
      <button class="btn secondary" data-ga="later">${esc(t("Not now"))}</button>
    </div>`;
  const close = (later: boolean) => {
    if (later) s.getAppWait = Date.now() + 3 * DAY;
    root.classList.remove("in");
    setTimeout(() => root.remove(), 250);
    onClose();
  };
  root.querySelector('[data-ga="get"]')?.addEventListener("click", () => close(false));
  root.querySelector('[data-ga="later"]')?.addEventListener("click", () => close(true));
  root.addEventListener("click", (e) => {
    if (e.target === root) close(true);
  });
  parent.append(root);
  requestAnimationFrame(() => root.classList.add("in"));
}
