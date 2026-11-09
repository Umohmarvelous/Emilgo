// Network status, COD-style (v6, the owner: "network status showing when the
// user is offline and when network is restored"): a small banner at the top
// centre, over every screen.
//
//   offline       the phone has no network (the browser says so): red, it
//                 stays until the network is back
//   reconnecting  the game server's link dropped and the client is resuming
//                 the seat: amber, with "you're standing still" in a match
//   restored      green for a moment, then it goes
//
// The phone's own network state comes from the browser's online/offline
// events; the server link from NetClient's states (session.onNetState). A
// banner for the server only shows once a link had been open, so a player who
// never went online never sees it.

import { el, esc } from "./dom";
import { t } from "./i18n";

type Shown = "none" | "offline" | "reconnecting" | "restored";

/** Bars of signal: full, or crossed out. */
function bars(cut: boolean): string {
  return `<svg class="ns-bars" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
    <rect x="3" y="15" width="3.2" height="5" rx="0.6"/><rect x="8" y="11.5" width="3.2" height="8.5" rx="0.6" ${cut ? 'opacity=".35"' : ""}/>
    <rect x="13" y="8" width="3.2" height="12" rx="0.6" ${cut ? 'opacity=".35"' : ""}/><rect x="18" y="4" width="3.2" height="16" rx="0.6" ${cut ? 'opacity=".35"' : ""}/>
    ${cut ? '<path d="M3 3l18 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' : ""}</svg>`;
}

export class NetStatus {
  private readonly root = el("div", "netstat");
  private shown: Shown = "none";
  private offline = typeof navigator !== "undefined" && navigator.onLine === false;
  private link: "none" | "ok" | "reconnecting" = "none";
  private inMatch = false;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    parent.append(this.root);
    window.addEventListener("offline", () => {
      this.offline = true;
      this.render();
    });
    window.addEventListener("online", () => {
      const was = this.offline;
      this.offline = false;
      // Back on the network: say so, unless the server link is still coming back (that banner says when it's done).
      if (was && this.link !== "reconnecting") this.flash();
      else this.render();
    });
    this.render();
  }

  /** The game server's link (NetClient states, simplified); `inMatch` adds what that means for you. */
  socket(state: "open" | "connecting" | "reconnecting" | "closed" | "idle", inMatch: boolean): void {
    this.inMatch = inMatch;
    const was = this.link;
    if (state === "open") {
      this.link = "ok";
      if (was === "reconnecting") this.flash();
      else this.render();
      return;
    }
    // A drop only counts once there was a link.
    if ((state === "reconnecting" || state === "connecting") && was !== "none") this.link = "reconnecting";
    else if (state === "closed" || state === "idle") this.link = was === "none" ? "none" : "reconnecting";
    this.render();
  }

  /** The server link given up for good (left online play): no banner for it. */
  forget(): void {
    this.link = "none";
    this.render();
  }

  private flash(): void {
    this.show("restored");
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.shown === "restored") this.render(true);
    }, 2600);
  }

  private render(afterFlash = false): void {
    if (this.shown === "restored" && !afterFlash && !this.offline && this.link !== "reconnecting") return;
    this.show(this.offline ? "offline" : this.link === "reconnecting" ? "reconnecting" : "none");
  }

  private show(s: Shown): void {
    if (s === this.shown && s !== "reconnecting") return;
    this.shown = s;
    this.root.className = `netstat ${s === "none" ? "" : `visible ${s}`}`;
    if (s === "none") return;
    const [head, sub] =
      s === "offline"
        ? [t("No connection"), t("You're offline. Check your data or Wi-Fi.")]
        : s === "reconnecting"
          ? [t("Connection lost"), this.inMatch ? t("Reconnecting… you're standing still") : t("Reconnecting…")]
          : [t("Connection restored"), ""];
    this.root.innerHTML = `${bars(s === "offline")}<span class="ns-txt"><b>${esc(head)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>${s === "reconnecting" ? '<i class="ns-spin" aria-hidden="true"></i>' : ""}`;
  }
}
