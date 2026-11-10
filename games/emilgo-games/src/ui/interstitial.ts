// An ad before a store purchase (v6, the owner: "an ad system that plays every time a user wants to purchase an
// item from the store"). The web and the EMILGO app only: never in Lagos Life (Agreement 4(g): no advertising
// there but Vatar.purchase), so the session doesn't call it there.
//
//   A network's ad   when the page carries Google's H5 Games Ads (the Ad Placement API: `adBreak`, set up on the
//                    site once the owner has an AdSense account; ADS-NETWORKS.md), its "next" break plays.
//   A house ad       otherwise: a full-screen card for our own billboards ("your brand here"), 5 s with a
//                    countdown, then Continue. Nothing is tracked.
//
// Either way the purchase goes on afterwards: the ad never blocks what the player paid CP for.

import { el, esc } from "./dom";
import { icon } from "./icons";
import { t } from "./i18n";

type AdBreak = (o: { type: string; name: string; beforeAd?: () => void; afterAd?: () => void; adBreakDone?: (info: unknown) => void }) => void;

/** Seconds before the house ad can be closed. */
export const HOUSE_AD_SECONDS = 5;

export function showInterstitial(parent: HTMLElement, onBefore?: () => void, onAfter?: () => void): Promise<void> {
  const ab = (window as unknown as { adBreak?: AdBreak }).adBreak;
  if (typeof ab === "function") {
    return new Promise((done) => {
      let finished = false;
      const end = () => {
        if (finished) return;
        finished = true;
        onAfter?.();
        done();
      };
      try {
        ab({ type: "next", name: "store-purchase", beforeAd: onBefore, afterAd: end, adBreakDone: end });
      } catch {
        end();
      }
      // A network with nothing to show calls adBreakDone at once; one that never answers can't hold the purchase.
      setTimeout(end, 45_000);
    });
  }
  return houseAd(parent, onBefore, onAfter);
}

function houseAd(parent: HTMLElement, onBefore?: () => void, onAfter?: () => void): Promise<void> {
  return new Promise((done) => {
    onBefore?.();
    const root = el("div", "interstitial");
    root.dataset.ui = "1";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", t("Advertisement"));
    root.innerHTML = `<div class="ia-card">
        <span class="ia-k">${esc(t("Advertisement"))}</span>
        <div class="ia-art">${icon("billboard", "", 64)}</div>
        <b>${esc(t("Your brand on a billboard in Silo Zone"))}</b>
        <p>${esc(t("Numbered billboards across the city, seen by every player who passes. Book one for 1 or 2 weeks."))}</p>
        <button class="btn primary ia-go" disabled>${esc(t("Continue"))} <span class="ia-n">${HOUSE_AD_SECONDS}</span></button>
      </div>`;
    const go = root.querySelector<HTMLButtonElement>(".ia-go")!;
    const n = root.querySelector<HTMLElement>(".ia-n")!;
    let left = HOUSE_AD_SECONDS;
    const tick = setInterval(() => {
      left--;
      if (left > 0) n.textContent = String(left);
      else {
        clearInterval(tick);
        n.remove();
        go.disabled = false;
        go.focus({ preventScroll: true });
      }
    }, 1000);
    go.addEventListener("click", () => {
      if (go.disabled) return;
      root.classList.remove("in");
      setTimeout(() => root.remove(), 220);
      onAfter?.();
      done();
    });
    parent.append(root);
    requestAnimationFrame(() => root.classList.add("in"));
  });
}
