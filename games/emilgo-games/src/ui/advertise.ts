// v7 (2.9, the owner: "I want the advert screen to be inside the game, not
// outside on a browser just like lagoslife"). The lobby's Advertise button on
// the web opens this sheet over the game: what a board is and what it costs to
// book, then the EMILGO advertiser portal itself, framed inside the sheet. The
// player never leaves the game, and closing the sheet puts them back in the
// lobby where they were. In the EMILGO app the button opens the app's own
// portal screen over the game instead (app/games/redlight.tsx); Lagos Life
// never shows it.
//
// The portal (app/advertise, the app's web build) does the signing in, the
// upload, the booking and the review; the game holds no account, no key and no
// payment. Payment providers refuse to be framed, so the framed portal opens
// only the provider's checkout in a tab of its own.

import { el, esc } from "./dom";
import { t, translateTree } from "./i18n";
import { icon } from "./icons";

/** The portal's address (VITE_ADVERTISE_URL, else the EMILGO site's). */
export function advertiseUrl(): string {
  return (import.meta.env.VITE_ADVERTISE_URL as string | undefined) ?? "https://emilgo.app/advertise";
}

/** The rules every ad is checked against (src/services/billboards.ts BILLBOARD_RULES, the app's copy decides). */
const RULES = [
  "No gambling or betting",
  "Nothing adult or sexual",
  "No crypto, forex or trading schemes",
  "No scams, loan apps or giveaways for money",
];

const STEPS: [string, string][] = [
  ["Sign in", "With your account, or a new one for your business."],
  ["Make your ad", "A picture, a slideshow of up to 6, or a short film (MP4, up to 20 MB)."],
  ["Pick a billboard", "Every board is numbered with its place in the world. Book any free one for 1 or 2 weeks."],
  ["Pay, then go live", "A person checks your ad against the rules, then it runs in every match on that map."],
];

/** If the framed portal hasn't loaded in this long, offer it in a tab. */
const SLOW_MS = 12_000;

export class AdvertiseSheet {
  readonly root = el("div", "fcards adv-sheet");
  private frame: HTMLIFrameElement | null = null;
  private slow = 0;
  /** Each opening of the portal; an answer for an older one is dropped. */
  private run = 0;

  constructor(parent: HTMLElement) {
    this.root.dataset.ui = "1";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Advertise on our billboards");
    parent.append(this.root);
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-adv]");
      if (!b) return;
      const a = b.dataset.adv;
      if (a === "close") this.close();
      else if (a === "book") this.portal();
      else if (a === "back") this.intro();
      else if (a === "tab") window.open(advertiseUrl(), "_blank", "noopener");
    });
  }

  get open(): boolean {
    return this.root.classList.contains("visible");
  }

  /** The first page: what a billboard is, how booking one goes, the rules. */
  intro(): void {
    this.drop();
    this.root.classList.add("visible");
    this.root.innerHTML = `<div class="fcard glass adv-card">
      <div class="fc-top"><span class="h">${esc(t("Advertise on our billboards"))}</span><button class="ibtn" data-adv="close" aria-label="${esc(t("Close"))}">${icon("close", "", 16)}</button></div>
      <div class="ht-scroll">
        <div class="adv-hero">
          <span class="adv-board">${icon("billboard", "", 40)}</span>
          <p>${esc(t("Your business on the billboards players drive past in every match: on the roads, the plazas and the landmarks of our worlds."))}</p>
        </div>
        <ol class="adv-steps">${STEPS.map(([h, s], i) => `<li><b><span>${i + 1}</span>${esc(t(h))}</b><small>${esc(t(s))}</small></li>`).join("")}</ol>
        <div class="label">${esc(t("Every ad is checked"))}</div>
        <ul class="adv-rules">${RULES.map((r) => `<li>${esc(t(r))}</li>`).join("")}</ul>
        <p class="adv-note">${esc(t("We count how long each board was on screen, never who saw it."))}</p>
      </div>
      <button class="btn primary adv-go" data-adv="book">${icon("billboard", "", 16)}<span>${esc(t("Book a billboard"))}</span></button>
    </div>`;
    translateTree(this.root);
  }

  /** The portal itself, inside the sheet. */
  private portal(): void {
    this.drop();
    const run = ++this.run;
    this.root.innerHTML = `<div class="fcard glass adv-card adv-portal">
      <div class="fc-top">
        <button class="ibtn" data-adv="back" aria-label="${esc(t("Back"))}">${icon("back", "", 16)}</button>
        <span class="h">${esc(t("Book a billboard"))}</span>
        <button class="ibtn" data-adv="close" aria-label="${esc(t("Close"))}">${icon("close", "", 16)}</button>
      </div>
      <div class="adv-frame"><div class="adv-wait"><span class="spin"></span><span>${esc(t("Opening the advertiser portal…"))}</span></div></div>
    </div>`;
    translateTree(this.root);
    const box = this.root.querySelector<HTMLElement>(".adv-frame")!;
    const url = advertiseUrl();
    // A frame shows the browser's own broken page when the portal can't be
    // reached, and says nothing about it: ask first (an opaque answer is enough).
    fetch(url, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(SLOW_MS) }).then(
      () => run === this.run && this.mount(box, url),
      () => run === this.run && this.unreachable(box),
    );
  }

  private mount(box: HTMLElement, url: string): void {
    const f = document.createElement("iframe");
    f.title = t("Advertiser portal");
    // The portal signs in and uploads, and opens a payment in a tab of its own.
    f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    f.referrerPolicy = "origin";
    f.src = url;
    f.addEventListener("load", () => {
      window.clearTimeout(this.slow);
      box.classList.add("ready");
    });
    box.append(f);
    this.frame = f;
    this.slow = window.setTimeout(() => !box.classList.contains("ready") && this.unreachable(box), SLOW_MS);
  }

  private unreachable(box: HTMLElement): void {
    const w = box.querySelector<HTMLElement>(".adv-wait");
    if (!w) return;
    w.innerHTML = `${icon("billboard", "", 30)}<span>${esc(t("The advertiser portal can't be reached right now."))}</span>
      <div class="adv-row"><button class="btn primary" data-adv="book">${esc(t("Try again"))}</button><button class="btn secondary" data-adv="tab">${esc(t("Open it in a new tab"))}</button></div>`;
    translateTree(w);
  }

  close(): void {
    this.drop();
    this.root.classList.remove("visible");
    this.root.innerHTML = "";
  }

  /** Unload the portal (it may be playing a film), so a closed sheet costs nothing. */
  private drop(): void {
    this.run++;
    window.clearTimeout(this.slow);
    if (this.frame) {
      this.frame.src = "about:blank";
      this.frame.remove();
      this.frame = null;
    }
  }
}
