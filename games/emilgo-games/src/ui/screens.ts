// Every menu, Call of Duty Mobile style: the lobby with something in each
// corner, side sheets that keep your character in view, a mode select with a
// big START, the winner's circle and the squad room.
//
// One container, one screen at a time, built from templates. Anything that
// came from outside (a player's display name) goes through esc() — never raw
// into innerHTML. Text is white or black; nothing is bigger than 16px; no emoji.

import { DISTANCES, MODES, MODE_NAME, NET, STAKED, TIME_LIMIT, ballCount } from "../config";
import { CONTROLS, RLGL_CONTROLS, unusedReason } from "../input/actions";
import type { ChallengeDef } from "../game/progress";
import { CATEGORIES, MAPS, SKY_LABEL, SKY_STATES, mapOf, thumbSvg, type MapCategory, type SkyState } from "../maps/registry";
import type { RoomInfo } from "../net/protocol";
import type { Host, Leaderboard, MatchView } from "../platform/types";
import { errorText } from "../platform/vatarErrors";
import type { Settings } from "../settings";
import { PRODUCTS, PRODUCT_BY_ID } from "../shop/catalog";
import { EMOTES, EMOTE_BY_ID, type EmoteId } from "../social/emotes";
import { POSES } from "../world/human/animator";
import { EXTRAS, FREE_OUTFITS, HAIRS, HAIR_COLORS, OUTFITS, SKIN_TONES, type Look } from "../world/human/wardrobe";
import { esc, ordinal } from "./dom";
import { icon } from "./icons";

export interface ResultInfo {
  outcome: "finished" | "moved" | "time" | "noball";
  place: number;
  time: number;
  progress: number; // 0..1
  score: number;
  best: number;
  newBest: boolean;
  survivors: number;
  total: number;
  canWatch: boolean;
  boardNote: string | null;
  online: "quick" | "private" | "match" | null;
  matchNote?: string | null;
  xp: number;
  level: number;
  levelUp: boolean;
  /** Daily challenges finished by this round. */
  completed: string[];
}

/** Stake chips (whole naira of the world's game money) and their street names. */
export const STAKES = [0, 100, 500, 1000, 5000, 20000, 50000, 100000] as const;

export function stakeTier(n: number): string {
  if (n === 0) return "Kalo Kalo · just for fun";
  if (n <= 500) return "Small Small";
  if (n <= 5000) return "Serious";
  if (n <= 50000) return "Big Boy";
  return "Odogwu";
}

export function naira(n: number): string {
  return "₦" + Math.round(n).toLocaleString("en-NG");
}

/** What the winner takes: the pot less the house's 5% (Lagos Life settles it, not us). */
export function payoutOf(stake: number, players: number): number {
  return Math.floor(stake * players * 0.95);
}

/** ready: a server is configured · offline: no network · unavailable: no server in this build. */
export type OnlineAvailability = "ready" | "offline" | "unavailable";

export type PlayMode = "practice" | "quick" | "private" | "join" | "lagos";
export type LobbyTab = "lobby" | "loadout" | "store" | "friends" | "clan" | "board";

export interface LobbyState {
  host: Host;
  settings: Settings;
  online: OnlineAvailability;
  shop: boolean;
  level: { level: number; into: number; need: number };
  rank: string | null;
  friends: { online: number | null; inMatch: number | null; recent: string[] };
  daily: { def: ChallengeDef; progress: number }[];
  mode: PlayMode;
  badge: boolean;
}

type Action = (name: string, el: HTMLElement, ev: Event) => void;

const MODE_INFO: Record<PlayMode, { name: string; sub: string; icon: string }> = {
  practice: { name: "Practice", sub: "11 CPU players · works offline", icon: "target" },
  quick: { name: "Quick match", sub: `Up to ${NET.crowdMax} real people`, icon: "bolt" },
  private: { name: "Private room", sub: "Make a room, share the code", icon: "lock" },
  join: { name: "Join with code", sub: "Six letters from a friend", icon: "invite" },
  lagos: { name: "Lagos Life match", sub: "2–4 players · optional stakes", icon: "trophy" },
};

const GAMES = [
  { id: "redlight", name: "Red Light, Green Light", ready: true },
  { id: "ayo", name: "Ayo", ready: false },
  { id: "ludo", name: "Naija Ludo", ready: false },
  { id: "suwe", name: "Suwe", ready: false },
];


export class Screens {
  readonly root: HTMLDivElement;
  private onAction: Action = () => {};
  private current = "";
  private toastEl: HTMLDivElement;
  private toastTimer = 0;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "screens";
    const fire = (e: Event) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!t || (t as HTMLButtonElement).disabled) return;
      // Ranges and checkboxes report on input/change; buttons on click.
      const isField = t instanceof HTMLInputElement;
      if (e.type === "click" && isField && t.type !== "checkbox") return;
      if (e.type !== "click" && !isField) return;
      this.onAction(t.dataset.act!, t, e);
    };
    this.root.addEventListener("click", fire);
    this.root.addEventListener("input", fire);
    this.toastEl = document.createElement("div");
    this.toastEl.className = "toast glass";
    this.toastEl.setAttribute("role", "status");
  }

  /** The toast lives outside the screens (it shows over play too). */
  get toastNode(): HTMLDivElement {
    return this.toastEl;
  }

  handle(fn: Action): void {
    this.onAction = fn;
  }

  get name(): string {
    return this.current;
  }

  hide(): void {
    this.current = "";
    this.root.replaceChildren();
    this.root.classList.remove("visible");
  }

  toast(text: string, ms = 2400): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add("visible");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("visible"), ms);
  }

  private mount(name: string, html: string, variant = ""): HTMLElement {
    this.current = name;
    this.root.innerHTML = `<div class="screen ${variant}" data-screen="${name}">${html}</div>`;
    this.root.classList.add("visible");
    const focus = this.root.querySelector<HTMLElement>("[autofocus]");
    focus?.focus({ preventScroll: true });
    return this.root.firstElementChild as HTMLElement;
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────

  lobby(s: LobbyState): void {
    const { host, settings } = s;
    const exit = host.can.exit ? `<button class="ibtn glass" data-act="exit" aria-label="Close game">${icon("close")}</button>` : "";
    const lv = s.level;
    const node = this.mount(
      "lobby",
      `<div class="vignette-lobby"></div>
      <div class="lb-tl profile" data-act="customize" role="button" tabindex="0" aria-label="Your profile">
        <div class="avatar" data-avatar></div>
        <div class="who">
          <span class="nm" data-name></span>
          <span class="lv"><b>LV ${lv.level}</b><span class="bar gold"><i style="width:${Math.round((lv.into / lv.need) * 100)}%"></i></span></span>
          <span class="meta"><span>RANK <b>${esc(s.rank ?? "—")}</b></span><span>BEST <b>${settings.best || 0}</b></span></span>
        </div>
      </div>
      ${tabsHtml("lobby")}
      <div class="lb-tr">
        <button class="ibtn" data-act="howto" aria-label="How to play">${icon("help")}</button>

        <button class="ibtn" data-act="settings" aria-label="Settings">${icon("gear", "ico-spin")}</button>
        ${exit}
      </div>
      <div class="lb-center-right">${s.daily
        .map(
          (d) => `<div class="challenge ${d.progress >= d.def.goal ? "done" : ""}">
            <div class="top">${icon(d.progress >= d.def.goal ? "check" : "target", "", 14)}<span>${esc(d.def.label)}</span><b>${Math.min(d.progress, d.def.goal)}/${d.def.goal}</b></div>
            <div class="bar"><i style="width:${Math.round((Math.min(d.progress, d.def.goal) / d.def.goal) * 100)}%"></i></div>
          </div>`,
        )
        .join("")}
        <div class="label" style="text-align:center">Daily · resets at midnight</div>
      </div>
      <button class="lb-bl friends-w" data-act="friends" aria-label="Friends">
        <div class="row"><span class="label">Friends</span>${icon("friends", "", 16)}</div>
        <div class="row"><i class="dot ${s.friends.online ? "on" : ""}"></i>Online<b class="num" data-fon>${s.friends.online ?? "—"}</b></div>
        <div class="row"><i class="dot busy"></i>In match<b class="num" data-fin>${s.friends.inMatch ?? "—"}</b></div>
      </button>

      <button class="lb-br glass-fill store-w" data-act="store" aria-label="Store">
        <span class="art">${icon("store", "ico-bob")}</span>
        <span class="art-t"><span class="h" style="display:block">Store</span><span class="small">${s.shop ? "Outfits · emotes · badge" : "Browse the looks"}</span></span>
      </button>

      <div class="lb-name glass"><span data-name></span>${s.badge ? `<span class="badge-star">${icon("star", "", 12)}</span>` : ""}</div>
      ${this.modeCard(s)}
      <div class="lb-bar glass-fill">
        <button class="act" data-act="loadout">${icon("loadout")}<span>Loadout</span></button>
        <button class="act" data-act="customize">${icon("customize")}<span>Customize</span></button>
        <button class="act" data-act="emotes">${icon("emote")}<span>Emotes</span></button>
        <button class="act" data-act="invite" ${s.online !== "ready" ? "disabled" : ""}>${icon("invite")}<span>Invite</span></button>
        <button class="act play" data-act="start"  "ico-pulse")}<span>Play</span></button>
      </div>`,
      "lobby",
    );
    this.setPlayer(node, host);
  }

  private modeCard(s: LobbyState): string {
    const map = mapOf(s.settings.map);
    const mode = MODE_INFO[s.mode];
    return `<button class="modecard glass" data-act="mode" aria-label="Change mode and map">
      <span class="thumb">${thumbSvg(map)}</span>
      ${icon("swap", "", 18)}
      <span class="txt art-t"><span class="label">Red Light</span>
      <b>${mode.name}</b>
      <span class="small">${esc(map.name)}</span></span>
    </button>`;
  }

  /** Refresh the name/avatar if identity arrived after the lobby drew. */
  setPlayer(node: HTMLElement | null, host: Host): void {
    const root = node ?? this.root;
    for (const n of root.querySelectorAll<HTMLElement>("[data-name]")) n.textContent = host.player.name;
    const av = root.querySelector<HTMLElement>("[data-avatar]");
    if (!av) return;
    av.replaceChildren();
    if (host.player.avatar) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = host.player.avatar; // validated as data:image/… by the host
      av.append(img);
    } else {
      av.textContent = host.player.name.trim().charAt(0).toUpperCase() || "E";
    }
  }

  /** Live friend counts on the lobby. */
  setFriendCounts(online: number | null, inMatch: number | null): void {
    const a = this.root.querySelector<HTMLElement>("[data-fon]");
    const b = this.root.querySelector<HTMLElement>("[data-fin]");
    if (a) a.textContent = online === null ? "—" : String(online);
    if (b) b.textContent = inMatch === null ? "—" : String(inMatch);
  }

  blocked(message: string): void {
    this.mount("blocked", `<div class="sheet wide glass" style="top:30%;bottom:auto"><div class="sheet-head"><span class="h">Not today</span></div><div class="sheet-body"><p class="note" style="font-size:12px;color:#fff">${esc(message)}</p></div></div>`, "dim");
  }

  fatal(title: string, message: string): void {
    this.mount(
      "fatal",
      `<div class="sheet wide glass" style="top:30%;bottom:auto"><div class="sheet-head"><span class="h">${esc(title)}</span></div>
       <div class="sheet-body"><p class="note" style="font-size:12px;color:#fff">${esc(message)}</p></div>
       <div class="sheet-foot"><span class="grow"></span><button class="btn primary" data-act="reload">Try again</button></div></div>`,
      "dim",
    );
  }

  // ── Sheets around the character ────────────────────────────────────────────

  private sheet(name: string, title: string, body: string, opts: { tabs?: string; foot?: string; side?: "left" | "right" | "wide"; back?: string } = {}): HTMLElement {
    const cls = opts.side === "right" ? "right" : opts.side === "wide" ? "wide" : "";
    return this.mount(
      name,
      `<div class="sheet glass ${cls}" role="dialog" aria-label="${esc(title)}">
        <div class="sheet-head">
          <button class="ibtn" data-act="${opts.back ?? "back"}" aria-label="Back">${icon("back")}</button>
          <span class="h">${esc(title)}</span>
        </div>
        ${opts.tabs ? `<div class="sheet-tabs">${opts.tabs}</div>` : ""}
        <div class="sheet-body">${body}</div>
        ${opts.foot ? `<div class="sheet-foot">${opts.foot}</div>` : ""}
      </div>`,
      opts.side === "wide" ? "dim" : "",
    );
  }

  /** Character editor: body, skin, hair, outfit, extras. Paid items show their price and a lock. */
  customize(look: Look, tab: string, owned: ReadonlySet<string>, canBuy: boolean): void {
    const tabs = [
      ["body", "Body"],
      ["skin", "Skin"],
      ["hair", "Hair"],
      ["outfit", "Outfit"],
      ["extras", "Extras"],
    ]
      .map(([id, label]) => `<button class="tab ${tab === id ? "on" : ""}" data-act="ctab" data-tab="${id}">${label}</button>`)
      .join("");
    let body = "";
    if (tab === "body") {
      body = `<div class="label" style="margin-bottom:8px">Build</div>
        <div class="grid">${(["m", "f"] as const)
          .map((b) => `<button class="tile ${look.body === b ? "on" : ""}" data-act="look" data-key="body" data-val="${b}">${icon("body", "", 28)}<span class="t">${b === "m" ? "Build A" : "Build B"}</span></button>`)
          .join("")}</div>
        <div class="row-set" style="margin-top:12px"><span class="lbl"><b>Height</b><small>A little taller or shorter</small></span>
          <input class="slider" type="range" min="95" max="105" step="1" value="${Math.round(look.height * 100)}" data-act="look-range" data-key="height" aria-label="Height" /></div>`;
    } else if (tab === "skin") {
      body = `<div class="grid">${SKIN_TONES.map(
        (c, i) => `<button class="tile ${look.skin === i ? "on" : ""}" data-act="look" data-key="skin" data-val="${i}" aria-label="Skin tone ${i + 1}"><span class="swatch" style="background:${c}"></span></button>`,
      ).join("")}</div>`;
    } else if (tab === "hair") {
      body = `<div class="label" style="margin-bottom:8px">Style</div><div class="grid">${HAIRS.map(
        (h) => `<button class="tile ${look.hair === h.id ? "on" : ""}" data-act="look" data-key="hair" data-val="${h.id}">${icon("hair", "", 26)}<span class="t">${esc(h.name)}</span></button>`,
      ).join("")}</div>
        <div class="label" style="margin:14px 0 8px">Colour</div><div class="grid">${HAIR_COLORS.map(
          (c, i) => `<button class="tile ${look.hairColor === i ? "on" : ""}" data-act="look" data-key="hairColor" data-val="${i}" aria-label="Hair colour ${i + 1}"><span class="swatch" style="background:${c}"></span></button>`,
        ).join("")}</div>`;
    } else if (tab === "outfit") {
      const tile = (o: (typeof OUTFITS)[number]) => {
        const locked = !!o.product && !owned.has(o.product);
        const p = o.product ? PRODUCT_BY_ID[o.product] : null;
        return `<button class="tile ${look.outfit === o.id ? "on" : ""} ${locked ? "locked" : ""}" data-act="look" data-key="outfit" data-val="${o.id}" ${locked ? `data-locked="${o.product}"` : ""}>
          ${locked ? `<span class="lock">${icon("lock", "", 14)}</span>` : ""}
          <span class="swatch" style="background:linear-gradient(135deg, ${o.accent} 50%, ${(o.bottom.pattern as { color?: string }).color ?? "#333"} 50%)"></span>
          <span class="t">${esc(o.name)}</span>
          ${p && locked ? `<span class="price num">${naira(p.price)}</span>` : ""}
        </button>`;
      };
      body = `<div class="grid wide">${FREE_OUTFITS.map(tile).join("")}${OUTFITS.filter((o) => o.product).map(tile).join("")}</div>
        ${canBuy ? "" : `<p class="note" style="margin-top:10px">Shop outfits are bought inside Lagos Life. Here you can try them on.</p>`}`;
    } else {
      body = `<div class="grid">${EXTRAS.map((e) => {
        const locked = !!e.product && !owned.has(e.product);
        const on = look.extras.includes(e.id);
        return `<button class="tile ${on ? "on" : ""} ${locked ? "locked" : ""}" data-act="look" data-key="extra" data-val="${e.id}" ${locked ? `data-locked="${e.product}"` : ""}>
          ${locked ? `<span class="lock">${icon("lock", "", 14)}</span>` : ""}
          ${icon(e.id === "fila" ? "cap" : e.id === "shades" || e.id === "glasses" ? "shades" : e.id === "headset" ? "sound" : e.id === "watch" ? "timer" : e.id === "earrings" ? "medal" : "crown", "", 24)}
          <span class="t">${esc(e.name)}</span>
          ${locked && e.product ? `<span class="price num">${naira(PRODUCT_BY_ID[e.product].price)}</span>` : on ? `<span class="owned">On</span>` : ""}
        </button>`;
      }).join("")}</div>
      <p class="note" style="margin-top:10px">One thing on the head and one on the face at a time.</p>`;
    }
    this.sheet("customize", "Customize", body, {
      tabs,
      foot: `<span class="small grow">Changes save as you go. Everyone online sees them.</span><button class="btn secondary" data-act="random-look">${icon("refresh", "", 16)}Random</button>`,
    });
  }

  emotes(selected: EmoteId | null, owned: ReadonlySet<string>, wheel: EmoteId[], slot: number, canBuy: boolean): void {
    const packOwned = owned.has("emotes_owambe");
    const tiles = EMOTES.map((e) => {
      const locked = !!e.pack && !packOwned;
      return `<button class="tile ${selected === e.id ? "on" : ""} ${locked ? "locked" : ""}" data-act="emote-pick" data-id="${e.id}">
        ${locked ? `<span class="lock">${icon("lock", "", 14)}</span>` : ""}${icon(e.icon, "", 26)}<span class="t">${esc(e.label)}</span>
        ${wheel.includes(e.id) ? `<span class="owned">Wheel</span>` : ""}
      </button>`;
    }).join("");
    const slots = wheel
      .map(
        (id, i) =>
          `<button class="tile ${slot === i ? "on" : ""}" data-act="emote-slot" data-i="${i}" style="min-height:58px">${icon(EMOTE_BY_ID[id].icon, "", 20)}<span class="s">${i + 1} · ${esc(EMOTE_BY_ID[id].label)}</span></button>`,
      )
      .join("");
    this.sheet(
      "emotes",
      "Emotes",
      `<p class="note">Tap an emote to see it. Pick a wheel slot below, then an emote to put there. Hold the emote button in a round to use the wheel.</p>
       <div class="grid">${tiles}</div>
       <div class="label" style="margin:14px 0 8px">Emote wheel</div>
       <div class="grid" style="grid-template-columns:repeat(4,1fr)">${slots}</div>
       ${!packOwned ? `<div class="status" style="margin-top:12px">${icon("lock", "", 14)} Zanku, Shaku Shaku and Odogwu come with the Owambe emote pack${canBuy ? ` · ${naira(PRODUCT_BY_ID.emotes_owambe.price)} in the Store` : " (inside Lagos Life)"}.</div>` : ""}`,
    );
  }

  loadout(s: Settings): void {
    this.sheet(
      "loadout",
      "Loadout",
      `<div class="label" style="margin-bottom:8px">Lobby pose</div>
       <div class="grid">${POSES.map((p) => `<button class="tile ${s.lobbyPose === p.id ? "on" : ""}" data-act="pose" data-id="${p.id}">${icon("pose", "", 24)}<span class="t">${esc(p.label)}</span></button>`).join("")}</div>
       <button class="md" style="margin: auto" data-act="emotes">${icon("wheel", "", 18)}<span class="grow" ><b>Edit the wheel</b><small>${s.wheel.map((id) => EMOTE_BY_ID[id].label).join(" · ")}</small></span>${icon("next", "", 16)}</button>`,
    );
  }

  store(owned: ReadonlySet<string>, badge: boolean, busy: string | null, note: string | null, canBuy: boolean): void {
    const prevScroll = this.current === "store" ? (this.root.querySelector<HTMLElement>(".sheet-body")?.scrollTop ?? 0) : 0;
    const tile = (p: (typeof PRODUCTS)[number]) => {
      const has = owned.has(p.id);
      let action: string;
      if (!has && canBuy) action = `<button class="btn primary" style="height:32px;width:100%" data-act="buy" data-id="${p.id}" ${busy ? "disabled" : ""}>${busy === p.id ? "Paying" : naira(p.price)}</button>`;
      else if (!has) action = `<span class="price num">${naira(p.price)}</span>`;
      else if (p.kind === "outfit") action = `<button class="btn secondary" style="height:32px;width:100%" data-act="wear" data-id="${p.id}">Wear</button>`;
      else if (p.kind === "cap") action = `<button class="btn secondary" style="height:32px;width:100%" data-act="wear" data-id="${p.id}">Wear</button>`;
      else if (p.kind === "badge") action = `<button class="btn ${badge ? "secondary on" : "secondary"}" style="height:32px;width:100%" data-act="toggle-badge">${badge ? "On" : "Off"}</button>`;
      else action = `<span class="owned">Owned</span>`;
      return `<div class="tile" style="min-height:150px;justify-content:space-between">
        <button data-act="try" data-id="${p.id}" style="display:flex;flex-direction:column;align-items:center;gap:6px" aria-label="Try ${esc(p.name)}">
          ${icon(p.icon, "", 30)}<span class="t">${esc(p.name)}</span><span class="s">${esc(p.blurb)}</span>
        </button>${action}</div>`;
    };
    this.sheet(
      "store",
      "Store",
      `${note ? `<p class="status" role="status">${esc(note)}</p>` : ""}
       <p class="note">${canBuy ? "Cosmetics only: nothing here helps you win. You pay on Lagos Life's own sheet, and the price there is the price. Each item is yours for good." : "Cosmetics only. Items are bought inside Lagos Life; here you can tap any item to try it on."}</p>
       <div class="grid wide">${PRODUCTS.map(tile).join("")}</div>`,
      { foot: canBuy ? `<button class="btn secondary" data-act="restore" ${busy ? "disabled" : ""}>${icon("refresh", "", 16)}Restore purchases</button><span class="grow"></span>` : undefined },
    );
    const body = this.root.querySelector<HTMLElement>(".sheet-body");
    if (body && prevScroll) body.scrollTop = prevScroll;
  }

  /** Update just the note on an open store. */
  storeNote(text: string): void {
    const el = this.root.querySelector<HTMLElement>("[data-screen=store] .status");
    if (el) el.textContent = text;
  }

  friends(s: { online: OnlineAvailability; recent: { name: string; at: number }[]; counts: { online: number | null; inMatch: number | null }; tab: "friends" | "invite"; code: string | null }): void {
    const tabs = `<button class="tab ${s.tab === "friends" ? "on" : ""}" data-act="ftab" data-tab="friends">Recent players</button><button class="tab ${s.tab === "invite" ? "on" : ""}" data-act="ftab" data-tab="invite">Invite</button>`;
    let body: string;
    if (s.tab === "invite") {
      body =
        s.online !== "ready"
          ? `<div class="status">Invites need the game server. ${s.online === "offline" ? "You're offline right now." : "It isn't switched on in this build yet."}</div>`
          : s.code
            ? `<p class="note">Your room is open. Share this code; friends tap Play, Join with code.</p>
               <div class="code">${esc(s.code)}</div>
               <div style="display:flex;gap:8px;margin-top:10px"><button class="btn secondary" data-act="copy-code">${icon("copy", "", 16)}Copy code</button><button class="btn primary" data-act="room">Go to room</button></div>`
            : `<p class="note">Make a private room and share its six-letter code. Up to ${Math.max(...NET.privateSizes)} people; 2 to 4 matches Lagos Life's match seats.</p>
               <div class="label" style="margin:10px 0 8px">Room size</div>
               <div class="grid">${NET.privateSizes.map((n) => `<button class="tile" data-act="create" data-size="${n}">${icon("people", "", 22)}<span class="t">${n} players</span></button>`).join("")}</div>`;
    } else {
      const rows = s.recent.length
        ? s.recent
            .map((r) => `<li class="li"><span class="avatar" style="width:32px;height:32px;font-size:12px">${esc(r.name.charAt(0).toUpperCase())}</span><span class="grow"><b>${esc(r.name)}</b><small>Played ${ago(r.at)}</small></span></li>`)
            .join("")
        : `<li class="li"><span class="grow"><b>No one yet</b><small>People you play online with show up here.</small></span></li>`;
      body = `<div style="display:flex;gap:8px;margin-bottom:12px">
          <div class="glass" style="flex:1;padding:8px 10px"><div class="label">Online now</div><div class="num" style="font-size:14px">${s.counts.online ?? "—"}</div></div>
          <div class="glass" style="flex:1;padding:8px 10px"><div class="label">In a match</div><div class="num" style="font-size:14px">${s.counts.inMatch ?? "—"}</div></div>
        </div>
        <ul class="list">${rows}</ul>
        <p class="note" style="margin-top:10px">Players are known by display name only. To play together, make a room and share its code.</p>`;
    }
    this.sheet("friends", "Friends", body, { tabs, side: "right" });
  }

  clan(): void {
    this.sheet(
      "clan",
      "Clan",
      `<div class="status">${icon("clan", "", 16)} Clans are coming: a crew name, a badge, and a weekly table for your street. Not yet.</div>
       <p class="note">Till then: make a private room, share the code, and run with your people.</p>`,
      { side: "right" },
    );
  }

  boardLoading(): void {
    this.sheet("board", "Leaderboard", `<p class="note">Loading…</p>`, { side: "right" });
  }

  board(b: Leaderboard | null, error: unknown): void {
    const rows = b?.top?.length
      ? b.top
          .map((r) => `<li class="li"><span class="rank ${r.rank <= 3 ? "top" : ""}">${r.rank}</span><span class="grow"><b>${esc(String(r.name))}</b></span><span class="num">${Number(r.score) || 0}</span></li>`)
          .join("")
      : `<li class="li"><span class="grow"><b>No scores yet</b><small>Be the first.</small></span></li>`;
    const me = b?.me ? `<div class="li me" style="margin-top:8px"><span class="rank">${icon("user", "", 14)}</span><span class="grow"><b>You · ${esc(b.me.label)}</b></span><span class="num">${Number(b.me.score) || 0}</span></div>` : "";
    this.sheet("board", "Leaderboard", `${error && !b ? `<div class="status error">${esc(errorText(error))}</div>` : ""}<ul class="list">${rows}</ul>${me}`, { side: "right" });
  }

  // ── Play: game and mode select ─────────────────────────────────────────────

  play(s: { mode: PlayMode; settings: Settings; online: OnlineAvailability; lagosLife: boolean; error: string | null; connecting: boolean; sky: SkyState }): void {
    const map = mapOf(s.settings.map);
    const off = (m: PlayMode) => (m === "practice" ? false : m === "lagos" ? !s.lagosLife || s.online !== "ready" : s.online !== "ready");
    const modes = (Object.keys(MODE_INFO) as PlayMode[])
      .filter((m) => m !== "lagos" || s.lagosLife)
      .map((m) => {
        const i = MODE_INFO[m];
        const tag = m === "practice" ? "Offline" : m === "lagos" ? "Stakes" : "Online";
        return `<button class="md ${s.mode === m ? "on" : ""}" style="top: calc(var(--safe-t) + var(--gap) + 100px); " data-act="pick-mode" data-mode="${m}" ${off(m) ? "disabled" : ""}>${icon(i.icon, "", 20)}<span class="grow"><b>${i.name}</b><small>${off(m) && s.online !== "ready" ? (s.online === "offline" ? "You're offline" : "Coming soon in this build") : i.sub}</small></span><span class="tag">${tag}</span></button>`;
      })
      .join("");
    const practice = s.mode === "practice";
    const staked = s.mode === "lagos";
    const skies = SKY_STATES.map((k) => `<button class="${k === s.sky ? "on" : ""}" data-act="sky" data-s="${k}">${SKY_LABEL[k]}</button>`).join("");
    const forced = s.settings.lightMode !== "auto";
    const join =
      s.mode === "join"
        ? `<form class="join" style="margin-top:8px"><input name="code" maxlength="${NET.codeLength}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CODE" aria-label="Room code" /><button class="btn secondary" type="button" data-act="join">Join</button></form>`
        : "";
    const node = this.mount(
      "play",
      `<div class="playscreen">
        <div class="head"><button class="ibtn glass" data-act="back" aria-label="Back">${icon("back")}</button><span class="h">Play</span><span class="grow"></span></div>
        <div class="games">${GAMES.map((g) => `<button class="gm ${g.id === "redlight" ? "on" : ""}" ${g.ready ? "" : "disabled"}>${esc(g.name)}${g.ready ? "" : `<span class="soon">Soon</span>`}</button>`).join("")}</div>
        <div class="modes">${modes}${join}
          ${s.error ? `<div class="status error" role="alert">${esc(s.error)}</div>` : ""}
          ${s.connecting ? `<div class="status">Connecting…</div>` : ""}
        </div>
        <div class="side">
          <div class="glass mapcard">
            <span class="thumb">${thumbSvg(map)}</span>
            <div class="row"><b>${esc(map.name)}</b><button class="btn secondary" style="height:30px;padding:0 10px" data-act="maps">${icon("swap", "", 14)}Switch</button></div>
            <span class="small">${esc(map.blurb)}</span>
            ${practice ? `<div class="label">Sky</div><div class="seg wrap" style="align-self:flex-start">${skies}</div>${forced ? `<span class="small">${s.settings.lightMode === "dark" ? "Dark" : "Light"} mode is on (Settings): ${s.settings.lightMode === "dark" ? "every map plays at night" : "every map plays in daylight"}.</span>` : ""}` : `<span class="small">Online rounds pick a map for the room.</span>`}
          </div>
          <div class="glass gamecard">${staked
            ? `<div class="label">Lagos Life match</div><span class="small">${MODE_NAME[STAKED.mode]}, ${STAKED.distance} m, ${TIME_LIMIT[STAKED.distance]} s${STAKED.mode === "balls" ? ", one ball fewer than players" : ""}. Every staked match plays the same.</span>`
            : `<div class="label">Mode</div>
            <div class="seg">${MODES.map((m) => `<button class="${m === s.settings.mode ? "on" : ""}" data-act="rmode" data-m="${m}">${MODE_NAME[m]}</button>`).join("")}</div>
            <div class="label">Distance</div>
            <div class="seg">${DISTANCES.map((d) => `<button class="${d === s.settings.distance ? "on" : ""}" data-act="dist" data-d="${d}">${d} m</button>`).join("")}</div>
            <span class="small">${s.settings.mode === "balls" ? "Grab a ball and carry it over the line. Fewer balls than players." : "Reach the line. Survive."} ${TIME_LIMIT[s.settings.distance]} s.</span>`}
          </div>
        </div>
        <div class="start"><button class="btn primary" data-act="go" ${off(s.mode) || s.connecting ? "disabled" : ""}>Start</button></div>
      </div>`,
      "dim",
    );
    const form = node.querySelector("form");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const btn = form.querySelector<HTMLElement>("[data-act=join]");
      if (btn) this.onAction("join", btn, e);
    });
  }

  maps(selected: string, cat: MapCategory): void {
    const tabs = CATEGORIES.map((c) => `<button class="tab ${c.id === cat ? "on" : ""}" data-act="mapcat" data-cat="${c.id}">${esc(c.label)}</button>`).join("");
    const tiles = MAPS.filter((x) => x.category === cat)
      .map(
        (x) => `<button class="tile ${x.id === selected ? "on" : ""}" data-act="pick-map" data-map="${x.id}">
          <span class="thumb">${thumbSvg(x)}</span>
          <span class="cap"><span class="t">${esc(x.name)}</span><span class="s">${SKY_LABEL[x.sky]}</span></span>
        </button>`,
      )
      .join("");
    this.sheet("maps", "Maps", `<div class="mapgrid">${tiles}</div>`, { tabs, side: "wide", back: "mode" });
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  settings(s: Settings, tab: string, from: "lobby" | "pause", tierNote: string): void {
    const sw = (key: keyof Settings, label: string, sub = "") => `
      <label class="row-set"><span class="lbl"><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span>
        <span class="switch"><input type="checkbox" data-act="toggle" data-key="${key}" ${s[key] ? "checked" : ""} /><i></i></span></label>`;
    const seg = (key: string, cur: string, opts: [string, string][]) =>
      `<span class="seg">${opts.map(([v, l]) => `<button class="${cur === v ? "on" : ""}" data-act="set" data-key="${key}" data-val="${v}">${l}</button>`).join("")}</span>`;
    const range = (key: "sensH" | "sensV" | "stickOpacity", label: string, sub: string) =>
      `<div class="row-set"><span class="lbl"><b>${label}</b><small>${sub}</small></span><input class="slider" type="range" min="${key === "stickOpacity" ? 30 : 5}" max="100" step="1" value="${Math.round(s[key] * 100)}" data-act="range" data-key="${key}" aria-label="${label}" /></div>`;
    const tabs = [
      ["graphics", "Graphics", "graphics"],
      ["audio", "Audio", "sound"],
      ["controls", "Controls", "controls"],
      ["game", "Game", "game"],
      ["account", "Account", "account"],
    ]
      .map(([id, label]) => `<button class="tab ${tab === id ? "on" : ""}" data-act="stab" data-tab="${id}">${label}</button>`)
      .join("");
    let body = "";
    if (tab === "graphics") {
      body = `<div class="row-set"><span class="lbl"><b>Quality</b><small>${esc(tierNote)}</small></span>${seg("graphics", s.graphics, [["auto", "Auto"], ["low", "Low"], ["medium", "Med"], ["high", "High"]])}</div>
        <div class="row-set"><span class="lbl"><b>Light / dark mode</b><small>Light: full daylight, street lights off. Dark: full night, street lights and neon on</small></span>${seg("lightMode", s.lightMode, [["auto", "Map"], ["light", "Light"], ["dark", "Dark"]])}</div>
        <p class="note" style="margin-top:10px">Low: no shadows, 2D clouds, lightest on battery, 30 fps on menus. Medium: shadows, sharper people and textures. High: full shadows, volumetric clouds, real reflections in puddles, glow and colour grading. Auto picks for your phone and adjusts the sharpness as you play.</p>`;
    } else if (tab === "audio") {
      body = `${sw("sound", "Sound effects")}${sw("music", "The doll's song", "Her warning hum still plays when off")}${sw("haptics", "Vibration")}`;
    } else if (tab === "controls") {
      body = `${sw("leftHanded", "Swap sticks", "Move on the right, look on the left")}
        <div class="row-set"><span class="lbl"><b>Look stick</b><small>Always drawn, or only while touched</small></span>${seg("lookStick", s.lookStick, [["touch", "On touch"], ["always", "Always"]])}</div>
        <div class="row-set"><span class="lbl"><b>Stick size</b></span>${seg("stickSize", s.stickSize, [["small", "Small"], ["medium", "Medium"], ["large", "Large"]])}</div>
        ${range("stickOpacity", "Stick opacity", "How solid the sticks look while you hold them")}
        <div class="row-set"><span class="lbl"><b>Sprint</b><small>Toggle: tap on, tap off. Hold: sprint while held. Auto: a full push sprints</small></span>${seg("sprintMode", s.sprintMode, [["toggle", "Toggle"], ["hold", "Hold"], ["auto", "Auto"]])}</div>
        ${range("sensH", "Look sensitivity, sideways", "Lower is calmer")}
        ${range("sensV", "Look sensitivity, up and down", "Lower is calmer")}
        ${sw("invertY", "Invert look up and down")}
        ${sw("autoCam", "Camera drifts back behind you", "Off: the camera stays where you leave it")}
        ${sw("firstPerson", "Start in first person", "Switch any time with the eye button")}
        <div class="label" style="margin:14px 0 6px">All controls</div>
        <ul class="list ctl-list">${CONTROLS.map((c) => {
          const used = RLGL_CONTROLS.has(c.id);
          return `<li class="li${used ? "" : " off"}">${icon(c.icon, "", 18)}<span class="grow"><b>${esc(c.label)}</b><small>${esc(used ? c.touch : unusedReason(c.id))}</small></span>${used && c.key ? `<span class="key">${esc(c.key)}</span>` : ""}</li>`;
        }).join("")}</ul>
        <p class="note" style="margin-top:10px">Also: WASD or the arrows to move, Q/E or a mouse drag to look, V for first person, Esc to pause.</p>`;
    } else if (tab === "game") {
      body = `${sw("blood", "Blood effects", "Off shows dust instead")}${sw("shake", "Screen shake")}${sw("killFeed", "Kill feed", "Who was eliminated, top centre")}
        <div class="row-set"><span class="lbl"><b>Minimap size</b><small>Tap the minimap in a round for the full map</small></span>${seg("mapSize", s.mapSize, [["small", "Small"], ["medium", "Medium"], ["large", "Large"]])}</div>
        ${sw("chat", "Online chat", "Waiting rooms and results. Tap a message to mute, block or report")}`;
    } else {
      body = `<div class="li"><span class="avatar" style="width:36px;height:36px">${icon("user", "", 18)}</span><span class="grow"><b data-name></b><small>Your name comes from the app you play in</small></span></div>
        <div class="row-set"><span class="lbl"><b>Level</b><small>Earned by playing; kept on this device</small></span><span class="num">${s.xp} XP</span></div>
        <div class="row-set"><span class="lbl"><b>Rounds played</b></span><span class="num">${s.played}</span></div>
        <div class="row-set"><span class="lbl"><b>Lines crossed</b></span><span class="num">${s.wins}</span></div>
        <div class="row-set"><span class="lbl"><b>Best score</b></span><span class="num">${s.best}</span></div>
        <div class="row-set"><span class="lbl"><b>How to play</b></span><button class="btn secondary" style="height:30px" data-act="howto">Open</button></div>`;
    }
    this.sheet("settings", "Settings", body, { tabs, side: "wide", back: from === "pause" ? "pause-menu" : "back" });
  }

  // ── How to play ────────────────────────────────────────────────────────────

  howto(firstTime: boolean): void {
    const step = (ico: string, title: string, text: string) => `<li class="li">${icon(ico, "", 22)}<span class="grow"><b>${title}</b><small>${text}</small></span></li>`;
    this.sheet(
      "howto",
      "How to play",
      `<ul class="list">
        ${step("play", "Mama sings: waka", "Push the left side to move. A small push walks, a full push runs. Sprint while your stamina lasts.")}
        ${step("eye", "She turns: freeze", "Let go. Anyone still moving once she's looking is out. Jumping or crouching counts as moving.")}
        ${step("flag", "Cross the line", `${TIME_LIMIT[100]} s for 100 m, ${TIME_LIMIT[200]} s for 200 m, ${TIME_LIMIT[300]} s for 300 m. Walking all the way won't make it: you'll have to run.`)}
        ${step("people", "Ball Haunting", "Grab a ball and carry it over the line. There are fewer balls than players. Fist, slap or push someone close to knock theirs loose, but never while she's looking.")}
        ${step("music", "The song never warns you", "She can stop after two words or deep in the second verse. Sometimes she stops and doesn't turn. Watch her, not the beat.")}
        ${step("swap", "Look around", "Drag the right side to look. The eye button switches to first person.")}
      </ul>`,
      { side: "wide", foot: `<span class="grow"></span><button class="btn primary" data-act="${firstTime ? "go" : "back"}" autofocus>${firstTime ? "Oya, let's go" : "Got it"}</button>` },
    );
  }

  // ── Pause ──────────────────────────────────────────────────────────────────

  pause(host: Host, online = false): void {
    this.sheet(
      "pause",
      "Paused",
      `${online ? `<div class="status">The round goes on online. You're standing still, and standing still is safe.</div>` : ""}


       <div class="list cb" style="margin-top: auto">
        <button class="md" data-act="resume" autofocus>${icon("play", "", 18)}<span class="grow"><b>Resume</b></span></button>
        ${online ? "" : `<button class="md" data-act="restart">${icon("refresh", "", 18)}<span class="grow"><b>Restart</b></span></button>`}
        <button class="md" data-act="settings-pause">${icon("gear", "", 18)}<span class="grow"><b>Settings</b></span></button>
        <button class="md" data-act="menu">${icon("home", "", 18)}<span class="grow"><b>${online ? "Leave match" : "Back to lobby"}</b></span></button>
        ${host.can.exit ? `<button class="md" data-act="exit">${icon("exit", "", 18)}<span class="grow"><b>Close game</b></span></button>` : ""}
       </div>`,

      { side: "wide", back: "resume" },
    );
  }

  // ── Post-match: the winner's circle ────────────────────────────────────────

  postmatch(r: ResultInfo, podium: { name: string; time: number; me: boolean }[], returnIn: number): void {
    const won = r.outcome === "finished";
    const head = won ? (r.place === 1 ? "Victory" : `${ordinal(r.place)} across`) : r.outcome === "time" ? "Time up" : r.outcome === "noball" ? "No ball left" : "Eliminated";
    const primary =
      r.online === "match"
        ? `<button class="btn primary" data-act="vmenu" autofocus>${icon("trophy", "", 16)}Another match</button>`
        : r.online === "private"
          ? `<button class="btn primary" data-act="room" autofocus>${icon("back", "", 16)}Back to the room</button>`
          : r.online === "quick"
            ? `<button class="btn primary" data-act="quick" autofocus>${icon("bolt", "", 16)}Play again online</button>`
            : `<button class="btn primary" data-act="again" autofocus>${icon("refresh", "", 16)}Play again</button>`;
    this.mount(
      "results",
      `<div class="pm-head"><span class="h">Winner's circle</span><span class="sub ${won ? "win" : "lose"}">${head}</span></div>
       <div class="pm-return glass" data-return>${returnIn > 0 ? `Returning to lobby in <span class="num">${returnIn}</span>` : ""}</div>
       <div class="pm-plates">${podium
         .map(
           (p, i) => `<div class="plate glass" data-plate="${i}" style="left:-999px"><span class="pl">${i + 1}</span><span class="pn"><b>${esc(p.name)}${p.me ? " · You" : ""}</b><small class="num">${p.time.toFixed(1)}s</small></span></div>`,
         )
         .join("")}</div>
       <div class="pm-card glass">
         <div class="pm-stats">
           <div><b>${won ? ordinal(r.place) : "—"}</b><small>Place</small></div>
           <div><b>${won ? r.time.toFixed(1) + "s" : Math.round(r.progress * 100) + "%"}</b><small>${won ? "Time" : "Distance"}</small></div>
           <div><b>${r.score}</b><small>${r.newBest ? `<span class="pm-best">Best</span>` : "Score"}</small></div>
           <div><b>${r.survivors}/${r.total}</b><small>Crossed</small></div>
         </div>
         <div class="pm-xp"><span class="label">+${r.xp} XP</span><span class="bar gold"><i style="width:100%"></i></span><span class="label">LV ${r.level}${r.levelUp ? " · Level up" : ""}</span></div>
         ${r.completed.length ? `<div class="status ok">${icon("check", "", 14)} Daily done: ${r.completed.map(esc).join(", ")}</div>` : ""}
         ${r.online === "match" ? `<div class="status" data-match-outcome>${esc(r.matchNote ?? "Sending the result to Lagos Life…")}</div>` : ""}
         ${r.boardNote ? `<span class="small">${esc(r.boardNote)}</span>` : ""}
         <div class="pm-actions">
           ${primary}
           ${r.canWatch ? `<button class="btn secondary" data-act="watch">${icon("eye", "", 16)}Watch</button>` : ""}
           <button class="btn secondary" data-act="menu">${icon("home", "", 16)}${r.online ? "Leave" : "Lobby"}</button>
         </div>
       </div>`,
    );
  }

  /** Move the podium name plates under their characters (screen px), and the countdown. */
  placePlates(pos: ({ x: number; y: number } | null)[], returnIn: number): void {
    pos.forEach((p, i) => {
      const el = this.root.querySelector<HTMLElement>(`[data-plate="${i}"]`);
      if (!el) return;
      el.style.left = p ? `${Math.round(p.x)}px` : "-999px";
      el.style.top = p ? `${Math.round(p.y)}px` : "-999px";
    });
    const r = this.root.querySelector<HTMLElement>("[data-return]");
    if (r) {
      const t = returnIn > 0 ? `Returning to lobby in <span class="num">${returnIn}</span>` : "";
      if (r.innerHTML !== t) r.innerHTML = t;
      r.style.display = returnIn > 0 ? "" : "none";
    }
  }

  /** Update the match line on an open results card (Lagos Life settles after we post). */
  matchOutcome(text: string): void {
    const el = this.root.querySelector<HTMLElement>("[data-match-outcome]");
    if (el) el.textContent = text;
  }

  // ── Online: the squad room ─────────────────────────────────────────────────

  /** A short holding card while the server answers. */
  waiting(text: string): void {
    this.mount(
      "room",
      `<div class="sq-status glass" style="bottom:50%">${esc(text)} · One moment…</div>
       <div class="sq-bar glass"><button class="btn secondary" data-act="leave-room">Cancel</button></div>`,
    );
  }

  room(room: RoomInfo, meId: string, serverNow: number, error: string | null): void {
    const owner = room.owner === meId;
    const n = room.players.length;
    const waitingFor = Math.max(0, Math.min(room.size, 2) - n);
    const canStart = room.kind === "private" && owner && n >= 2 && room.state === "lobby" && room.startsAt === null;
    const title = room.kind === "quick" ? "Quick match" : room.kind === "match" ? "Lagos Life match" : "Private room";
    this.mount(
      "room",
      `<div class="sq-head">
         <span class="label">${room.kind === "match" && room.stake ? `${naira(room.stake)} each` : "Public lobby"}</span>
         <span class="h">${title}</span>
         ${room.code && room.kind !== "match" ? `<div style="display:flex;gap:6px;align-items:center"><span class="code" style="padding:6px 10px;font-size:14px">${esc(room.code)}</span><button class="ibtn glass" data-act="copy-code" aria-label="Copy code">${icon("copy", "", 18)}</button></div>` : ""}
       </div>
       <div class="sq-right">
         <span class="sq-count glass" style="padding:4px 10px">${n}/${room.size}</span>
         <span class="sq-next" data-next>${this.nextText(room, serverNow)}</span>
       </div>
       <div class="tags" data-tags>${room.players
         .map((p) => `<span class="ntag ${p.id === meId ? "me" : ""} ${p.id === room.owner ? "host" : ""} ${p.away ? "away" : ""}" data-tag="${esc(p.id)}" style="left:-999px">${esc(p.name)}</span>`)
         .join("")}</div>
       ${error ? `<div class="sq-status glass status error" role="alert">${esc(error)}</div>` : `<div class="sq-status glass" data-starts="${room.startsAt ?? ""}">${this.roomStatus(room, serverNow, waitingFor, owner)}</div>`}
       <div class="sq-bar glass">
         <button class="btn secondary" data-act="leave-room">${icon("exit", "", 16)}Leave</button>
         ${canStart ? `<button class="btn primary" data-act="start-now">${icon("play", "", 16)}Start now · ${n}</button>` : ""}
       </div>`,
    );
  }

  /** Name tags over the room members (screen px), by player id. */
  placeTags(pos: Map<string, { x: number; y: number }>): void {
    for (const el of this.root.querySelectorAll<HTMLElement>("[data-tag]")) {
      const p = pos.get(el.dataset.tag!);
      el.style.left = p ? `${Math.round(p.x)}px` : "-999px";
      el.style.top = p ? `${Math.round(p.y)}px` : "-999px";
    }
  }

  private nextText(room: RoomInfo, serverNow: number): string {
    if (!room.startsAt) return room.state === "playing" ? "Round in progress" : "Waiting";
    const s = Math.max(0, Math.ceil((room.startsAt - serverNow) / 1000));
    return `Next match <b>${String(s).padStart(2, "0")}</b>`;
  }

  /** Called every frame while the room is showing: updates the countdown text only. */
  tickRoom(serverNow: number): void {
    const el = this.root.querySelector<HTMLElement>("[data-starts]");
    const at = Number(el?.dataset.starts);
    if (!el || !at) return;
    const s = Math.max(0, Math.ceil((at - serverNow) / 1000));
    const text = s > 0 ? `Starting in ${s}s…` : "Here we go";
    if (el.textContent !== text) el.textContent = text;
    const next = this.root.querySelector<HTMLElement>("[data-next]");
    const t = `Next match <b>${String(s).padStart(2, "0")}</b>`;
    if (next && next.innerHTML !== t) next.innerHTML = t;
  }

  private roomStatus(room: RoomInfo, serverNow: number, waitingFor: number, owner: boolean): string {
    if (room.kind === "match") {
      if (room.state !== "lobby") return "Here we go";
      if (room.startsAt) {
        const s = Math.max(0, Math.ceil((room.startsAt - serverNow) / 1000));
        const missing = room.players.filter((p) => p.away).length;
        return missing ? `Starting in ${s}s · ${missing} still on the way…` : `Starting in ${s}s…`;
      }
      return "Waiting for everyone in the match…";
    }
    if (room.state === "playing") return "A round is running. You'll join the next one.";
    if (room.state === "ended") return "Round over. Back in a moment…";
    if (room.startsAt) {
      const s = Math.max(0, Math.ceil((room.startsAt - serverNow) / 1000));
      return s > 0 ? `Starting in ${s}s…` : "Here we go";
    }
    if (waitingFor > 0) return `Waiting for ${waitingFor === 1 ? "one more person" : `${waitingFor} more people`}…`;
    if (room.kind === "private") {
      const full = room.players.length >= room.size;
      if (owner) return full ? "Everyone's here. Start when you're ready." : `Waiting for friends (${room.players.length}/${room.size}), or start now.`;
      return full ? "Everyone's here. Waiting for the host…" : `Waiting for friends (${room.players.length}/${room.size}) or the host…`;
    }
    return "Waiting for more players…";
  }

  // ── Lagos Life matches ─────────────────────────────────────────────────────

  matchMenu(stake: number, seats: number, error: string | null, busy: boolean): void {
    const off = busy ? "disabled" : "";
    const chips = STAKES.map((n) => `<button class="chip ${n === stake ? "on" : ""}" data-act="vstake" data-stake="${n}" ${off}>${n === 0 ? "Free" : naira(n)}</button>`).join("");
    const segs = [2, 3, 4].map((n) => `<button class="${n === seats ? "on" : ""}" data-act="vseats" data-seats="${n}" ${off}>${n} players</button>`).join("");
    const node = this.sheet(
      "vmenu",
      "Lagos Life match",
      `<p class="note">Every staked match is ${MODE_NAME[STAKED.mode]}, ${STAKED.distance} m, ${TIME_LIMIT[STAKED.distance]} s${STAKED.mode === "balls" ? `, with one ball fewer than players (${ballCount(seats)} for ${seats})` : ""}. First across the line${STAKED.mode === "balls" ? " holding a ball" : ""} takes the pot. Nobody makes it? It's a draw and every stake goes back.</p>
       ${error ? `<div class="status error" role="alert">${esc(error)}</div>` : ""}
       <div class="label" style="margin-bottom:6px">Stake each</div>
       <div style="display:flex;flex-wrap:wrap;gap:6px">${chips}</div>
       <p class="note" style="margin-top:6px">${esc(stakeTier(stake))}${stake ? ` · winner takes ${naira(payoutOf(stake, seats))} of a ${naira(stake * seats)} pot` : ""}</p>
       <div class="label" style="margin:10px 0 6px">Players</div><span class="seg">${segs}</span>
       <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
         <button class="btn primary" data-act="vcreate" ${off}>${busy ? "One moment" : `Create match${stake ? ` · ${naira(stake)}` : ""}`}</button>
         <button class="btn secondary" data-act="vquick" ${off}>${icon("bolt", "", 16)}Quick match · 2 players${stake ? ` · ${naira(stake)}` : ""}</button>
         <form class="join"><input name="vcode" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CODE" aria-label="Lagos Life match code" ${off} /><button class="btn secondary" type="button" data-act="vjoin" ${off}>Join</button></form>
       </div>
       <p class="note" style="margin-top:10px">Stakes are Lagos Life game money: not real money, never cashed out. You confirm on Lagos Life's own sheet.</p>`,
      { side: "wide", back: "mode" },
    );
    const form = node.querySelector("form");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const btn = form.querySelector<HTMLElement>("[data-act=vjoin]");
      if (btn && !(btn as HTMLButtonElement).disabled) this.onAction("vjoin", btn, e);
    });
  }

  matchWaiting(m: MatchView, note: string | null): void {
    const players = m.players.map((p) => `<li class="li ${p.id === m.me ? "me" : ""}"><span class="grow"><b>${esc(p.name)}${p.id === m.me ? " · You" : ""}</b></span></li>`).join("");
    const empty = Math.max(0, m.seats - m.players.length);
    const open = Array.from({ length: empty }, () => `<li class="li"><span class="grow"><small>Waiting…</small></span></li>`).join("");
    this.sheet(
      "vwait",
      `Lagos Life match · ${m.stake ? `${naira(m.stake)} each` : "friendly"}`,
      `<p class="note">Share this code. The round starts when every seat is filled.</p>
       <div class="code">${esc(m.code)}</div>
       <ul class="list" style="margin-top:10px">${players}${open}</ul>
       ${m.stake ? `<p class="note" style="margin-top:8px">Pot ${naira(m.stake * m.seats)} · winner takes ${naira(payoutOf(m.stake, m.seats))}</p>` : ""}
       ${note ? `<div class="status">${esc(note)}</div>` : ""}`,
      { side: "wide", back: "vleave", foot: `<span class="grow"></span><button class="btn secondary" data-act="vleave">Leave${m.stake ? " · stake back" : ""}</button>` },
    );
  }
}

function tabsHtml(on: LobbyTab): string {
  const tabs: [LobbyTab, string, boolean][] = [
    ["lobby", "Lobby", false],
    ["loadout", "Loadout", false],
    ["store", "Store", false],
    ["friends", "Friends", false],
    ["clan", "Clan", true],
    ["board", "Leaderboard", false],
  ];
  return `<nav class="lb-tabs tabs" style="padding:0 6px" aria-label="Sections">${tabs
    .map(([id, label, soon]) => `<button class="tab ${on === id ? "on" : ""}" data-act="tab" data-tab="${id}">${label}${soon ? `<span class="soon">Soon</span>` : ""}</button>`)
    .join("")}</nav>`;
}

function ago(at: number): string {
  const m = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

