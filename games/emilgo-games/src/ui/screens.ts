// Every menu, Call of Duty Mobile style: the lobby with something in each
// corner, side sheets that keep your character in view, a mode select with a
// big START, the winner's circle and the squad room.
//
// One container, one screen at a time, built from templates. Anything that
// came from outside (a player's display name) goes through esc() — never raw
// into innerHTML. Text is white or black; nothing is bigger than 16px; no emoji.

import { DISTANCES, FLOW, MODES, MODE_NAME, NET, PRACTICE, STAKED, TIME_LIMIT, ballCount } from "../config";
import { CONTROLS, RLGL_CONTROLS, unusedReason } from "../input/actions";
import type { ChallengeDef } from "../game/progress";
import { CATEGORIES, MAPS, SKY_LABEL, SKY_STATES, mapOf, thumbSvg, type MapCategory, type SkyState } from "../maps/registry";
import type { RoomInfo } from "../net/protocol";
import type { Host, Leaderboard, MatchView } from "../platform/types";
import { errorText } from "../platform/vatarErrors";
import type { Settings } from "../settings";
import { BOOSTS, BOOST_BY_ID, BOOST_ROUNDS, BOOST_SLOTS, type Boost, type BoostId } from "../shop/boosts";
import { PRODUCTS, PRODUCT_BY_ID } from "../shop/catalog";
import type { FriendState } from "../social/friends";
import { EMOTES, EMOTE_BY_ID, type EmoteId } from "../social/emotes";
import { POSES } from "../world/human/animator";
import { HOODIE_COLORS, HOODIE_DESIGNS, type HoodieDesign, type Look } from "../world/human/wardrobe";
import { esc, ordinal } from "./dom";
import { t, translateTree } from "./i18n";
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
  /** CP earned this round (shop/boosts cpForRound). */
  cp: number;
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

/** The Play menu (SPEC-V2 §1.1): Invite Friends, Play with New People, Play Solo vs AI; and staked Lagos Life matches. */
export type PlayMode = "friends" | "new" | "solo" | "lagos";
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

type RangeKey = "sensH" | "sensV" | "stickOpacity" | "sens" | "master" | "musicVol" | "sfxVol";

export interface StoreState {
  tab: "boosts" | "cosmetics";
  owned: ReadonlySet<string>;
  badge: boolean;
  busy: string | null;
  note: string | null;
  canBuy: boolean;
  cp: number;
  boosts: Partial<Record<BoostId, number>>;
  boostsOn: readonly BoostId[];
}

export interface FriendsState {
  online: OnlineAvailability;
  tab: "friends" | "recent" | "invite";
  code: string | null;
  counts: { online: number; inMatch: number };
  friends: { name: string; state: FriendState }[];
  requests: { name: string }[];
  invites: { name: string }[];
  recent: { name: string; at: number; seat?: string; friend: boolean }[];
}

const MODE_INFO: Record<PlayMode, { name: string; sub: string; icon: string }> = {
  friends: { name: "Invite Friends", sub: "Make a room and share its code, or join one", icon: "invite" },
  new: { name: "Play with New People", sub: `Matched with up to ${NET.crowdMax} players`, icon: "people" },
  solo: { name: "Play Solo vs AI", sub: `Practice with ${PRACTICE.bots} CPU players · works offline`, icon: "target" },
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
  private noticeTimer = 0;

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
    this.toastEl.textContent = t(text);
    this.toastEl.classList.add("visible");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("visible"), ms);
  }

  private mount(name: string, html: string, variant = ""): HTMLElement {
    this.current = name;
    this.root.innerHTML = `<div class="screen ${variant}" data-screen="${name}">${html}</div>`;
    this.root.classList.add("visible");
    translateTree(this.root);
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
          <span class="meta"><span>RANK <b>${esc(s.rank ?? "—")}</b></span><span>BEST <b>${settings.best || 0}</b></span><span>CP <b>${settings.cp}</b></span></span>
        </div>
      </div>
      ${tabsHtml("lobby")}
      <div class="lb-tr">
        <button class="ibtn" data-act="tutorial" aria-label="Tutorial">${icon("help")}</button>

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
        <span class="art-t"><span class="h" style="display:block">Store</span><span class="small">${s.shop ? "Boosts · outfits · emotes" : "Boosts · try the looks"}</span></span>
      </button>

      <div class="lb-name glass"><span data-name></span>${s.badge ? `<span class="badge-star">${icon("star", "", 12)}</span>` : ""}</div>
      ${this.modeCard(s)}
      <div class="lb-bar glass-fill">
        <button class="act" data-act="loadout">${icon("loadout")}<span>Loadout</span></button>
        <button class="act" data-act="customize">${icon("customize")}<span>Customize</span></button>
        <button class="act" data-act="emotes">${icon("emote")}<span>Emotes</span></button>
        <button class="act" data-act="invite" ${s.online !== "ready" ? "disabled" : ""}>${icon("invite")}<span>Invite</span></button>
        <button class="act play" data-act="start">${icon("play", "ico-pulse")}<span>Play</span></button>
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

  /** Character editor: the hoodie (colour and design: the only clothes there are) and the body. Paid ones show their price and a lock. */
  customize(look: Look, tab: string, owned: ReadonlySet<string>, canBuy: boolean): void {
    const tabs = [
      ["hoodie", "Hoodie"],
      ["body", "Body"],
    ]
      .map(([id, label]) => `<button class="tab ${tab === id ? "on" : ""}" data-act="ctab" data-tab="${id}">${label}</button>`)
      .join("");
    let body = "";
    const lock = (product: string | undefined) => !!product && !owned.has(product);
    const price = (product: string | undefined, locked: boolean) => (product && locked ? `<span class="price num">${naira(PRODUCT_BY_ID[product].price)}</span>` : "");
    if (tab === "body") {
      body = `<div class="label" style="margin-bottom:8px">Build</div>
        <div class="grid">${(["m", "f"] as const)
          .map((b) => `<button class="tile ${look.body === b ? "on" : ""}" data-act="look" data-key="body" data-val="${b}">${icon("body", "", 28)}<span class="t">${b === "m" ? "Build A" : "Build B"}</span></button>`)
          .join("")}</div>
        <div class="row-set" style="margin-top:12px"><span class="lbl"><b>Height</b><small>A little taller or shorter</small></span>
          <input class="slider" type="range" min="95" max="105" step="1" value="${Math.round(look.height * 100)}" data-act="look-range" data-key="height" aria-label="Height" /></div>`;
    } else {
      const main = HOODIE_COLORS[look.hoodie]?.hex ?? HOODIE_COLORS[0].hex;
      const alt = contrastOf(main);
      const colours = HOODIE_COLORS.map((c, i) => {
        const locked = lock(c.product);
        const fill = c.satin ? `linear-gradient(135deg, ${c.hex} 20%, rgba(255,255,255,.55) 50%, ${c.hex} 80%), ${c.hex}` : c.hex;
        return `<button class="tile ${look.hoodie === i ? "on" : ""} ${locked ? "locked" : ""}" data-act="look" data-key="hoodie" data-val="${i}" ${locked ? `data-locked="${c.product}"` : ""} aria-label="${esc(c.name)}">
          ${locked ? `<span class="lock">${icon("lock", "", 14)}</span>` : ""}<span class="swatch" style="background:${fill}"></span><span class="t">${esc(c.name)}</span>${price(c.product, locked)}
        </button>`;
      }).join("");
      const designs = HOODIE_DESIGNS.map((d) => {
        const locked = lock(d.product);
        return `<button class="tile ${look.design === d.id ? "on" : ""} ${locked ? "locked" : ""}" data-act="look" data-key="design" data-val="${d.id}" ${locked ? `data-locked="${d.product}"` : ""}>
          ${locked ? `<span class="lock">${icon("lock", "", 14)}</span>` : ""}<span class="swatch" style="background:${designSwatch(d.id, main, alt)}"></span><span class="t">${esc(d.name)}</span>${price(d.product, locked)}
        </button>`;
      }).join("");
      body = `<div class="label" style="margin-bottom:8px">Colour</div><div class="grid">${colours}</div>
        <div class="label" style="margin:14px 0 8px">Design</div><div class="grid wide">${designs}</div>
        ${canBuy ? "" : `<p class="note" style="margin-top:10px">Gold, Midnight and the Ankara design are bought inside Lagos Life. Here you can try them on.</p>`}`;
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
       <button class="md" style="margin: auto" data-act="emotes">${icon("wheel", "", 18)}<span class="grow" ><b>Edit the wheel</b><small>${s.wheel.map((id) => EMOTE_BY_ID[id].label).join(" · ")}</small></span>${icon("next", "", 16)}</button>
       <button class="md" style="margin: 8px auto 0" data-act="boosts">${icon("bolt", "", 18)}<span class="grow"><b>Boosts</b><small>${s.boostsOn.length ? s.boostsOn.map((id) => `${BOOST_BY_ID[id].name} (${s.boosts[id] ?? 0})`).join(" · ") : `None on · ${s.cp} CP`}</small></span>${icon("next", "", 16)}</button>`,
    );
  }

  store(st: StoreState): void {
    const { owned, badge, busy, note, canBuy } = st;
    const prevScroll = this.current === "store" ? (this.root.querySelector<HTMLElement>(".sheet-body")?.scrollTop ?? 0) : 0;
    const tabs = `<button class="tab ${st.tab === "boosts" ? "on" : ""}" data-act="store-tab" data-tab="boosts">Boosts · CP</button><button class="tab ${st.tab === "cosmetics" ? "on" : ""}" data-act="store-tab" data-tab="cosmetics">Cosmetics</button>`;
    let body: string;
    if (st.tab === "boosts") {
      const on = new Set(st.boostsOn);
      const tile = (b: Boost) => {
        const left = st.boosts[b.id] ?? 0;
        const isOn = on.has(b.id);
        const full = !isOn && on.size >= BOOST_SLOTS;
        return `<div class="tile boost ${isOn ? "on" : ""}" style="min-height:150px;justify-content:space-between">
          ${icon(b.icon, "", 26)}<span class="t">${esc(b.name)}</span><span class="s">${esc(b.blurb)}${b.balls ? " Ball Haunting." : ""}</span>
          <span class="s">${left ? `${left} round${left === 1 ? "" : "s"} left` : "None yet"}</span>
          <span style="display:flex;gap:6px;width:100%">
            <button class="btn primary" style="height:32px;flex:1" data-act="buy-boost" data-id="${b.id}" ${st.cp < b.cp ? "disabled" : ""}>${b.cp} CP · ${BOOST_ROUNDS}</button>
            ${left ? `<button class="btn secondary ${isOn ? "on" : ""}" style="height:32px;flex:1" data-act="boost-on" data-id="${b.id}" ${full ? "disabled" : ""}>${isOn ? "On" : "Off"}</button>` : ""}
          </span>
        </div>`;
      };
      body = `<div class="cp-bar glass"><span class="label">Your CP</span><b class="num">${st.cp}</b><span class="small grow">Earned only by playing: every round, more for crossing, more for first.</span></div>
        <p class="note">Switch on up to ${BOOST_SLOTS}. Each one switched on uses a round when a round starts, in Solo and free matches. Boosts are always off in staked Lagos Life matches, and cost no money: CP only.</p>
        <div class="grid wide">${BOOSTS.map(tile).join("")}</div>`;
    } else {
      const tile = (p: (typeof PRODUCTS)[number]) => {
        const has = owned.has(p.id);
        let action: string;
        if (!has && canBuy) action = `<button class="btn primary" style="height:32px;width:100%" data-act="buy" data-id="${p.id}" ${busy ? "disabled" : ""}>${busy === p.id ? "Paying" : naira(p.price)}</button>`;
        else if (!has) action = `<span class="price num">${naira(p.price)}</span>`;
        else if (p.kind === "hoodie") action = `<button class="btn secondary" style="height:32px;width:100%" data-act="wear" data-id="${p.id}">Wear</button>`;
        else if (p.kind === "badge") action = `<button class="btn ${badge ? "secondary on" : "secondary"}" style="height:32px;width:100%" data-act="toggle-badge">${badge ? "On" : "Off"}</button>`;
        else action = `<span class="owned">Owned</span>`;
        return `<div class="tile" style="min-height:150px;justify-content:space-between">
          <button data-act="try" data-id="${p.id}" style="display:flex;flex-direction:column;align-items:center;gap:6px" aria-label="Try ${esc(p.name)}">
            ${icon(p.icon, "", 30)}<span class="t">${esc(p.name)}</span><span class="s">${esc(p.blurb)}</span>
          </button>${action}</div>`;
      };
      body = `${note ? `<p class="status" role="status">${esc(note)}</p>` : ""}
        <p class="note">${canBuy ? "Cosmetics only: nothing here helps you win. You pay with Lagos Life Game Naira on Lagos Life's own sheet, and the price there is the price. Each item is yours for good." : "Cosmetics only. Items are bought inside Lagos Life; here you can tap any item to try it on."}</p>
        <div class="grid wide">${PRODUCTS.map(tile).join("")}</div>`;
    }
    this.sheet("store", "Store", body, {
      tabs,
      foot: canBuy && st.tab === "cosmetics" ? `<button class="btn secondary" data-act="restore" ${busy ? "disabled" : ""}>${icon("refresh", "", 16)}Restore purchases</button><span class="grow"></span>` : undefined,
    });
    const el = this.root.querySelector<HTMLElement>(".sheet-body");
    if (el && prevScroll) el.scrollTop = prevScroll;
  }

  /** Update just the note on an open store. */
  storeNote(text: string): void {
    const el = this.root.querySelector<HTMLElement>("[data-screen=store] .status");
    if (el) el.textContent = text;
  }

  friends(s: FriendsState): void {
    const tabs = (["friends", "recent", "invite"] as const)
      .map((t) => `<button class="tab ${s.tab === t ? "on" : ""}" data-act="ftab" data-tab="${t}">${t === "friends" ? `Friends${s.requests.length ? ` <i class="dot-badge">${s.requests.length}</i>` : ""}` : t === "recent" ? "Recent players" : "Room code"}</button>`)
      .join("");
    const offline = s.online !== "ready" ? `<div class="status">Friends need the game server. ${s.online === "offline" ? "You're offline right now." : "It isn't switched on in this build yet."}</div>` : "";
    const inRoom = !!s.code;
    let body: string;
    if (s.tab === "invite") {
      body =
        s.online !== "ready"
          ? offline
          : s.code
            ? `<p class="note">Your room is open. Share this code, or invite a friend from the Friends tab.</p>
               <div class="code">${esc(s.code)}</div>
               <div style="display:flex;gap:8px;margin-top:10px"><button class="btn secondary" data-act="copy-code">${icon("copy", "", 16)}Copy code</button><button class="btn primary" data-act="room">Go to room</button></div>`
            : `<p class="note">Make a private room and share its six-letter code. Up to ${Math.max(...NET.privateSizes)} people; 2 to 4 matches Lagos Life's match seats.</p>
               <div class="label" style="margin:10px 0 8px">Room size</div>
               <div class="grid">${NET.privateSizes.map((n) => `<button class="tile" data-act="create" data-size="${n}">${icon("people", "", 22)}<span class="t">${n} players</span></button>`).join("")}</div>`;
    } else if (s.tab === "recent") {
      const rows = s.recent.length
        ? s.recent
            .map(
              (r, i) => `<li class="li"><span class="avatar" style="width:32px;height:32px;font-size:12px">${esc(r.name.charAt(0).toUpperCase())}</span><span class="grow"><b>${esc(r.name)}</b><small>Played ${ago(r.at)}</small></span>${
                r.friend ? `<span class="owned">Friend</span>` : r.seat && s.online === "ready" ? `<button class="btn secondary" style="height:30px" data-act="fadd" data-i="${i}">${icon("invite", "", 14)}Add</button>` : ""
              }</li>`,
            )
            .join("")
        : `<li class="li"><span class="grow"><b>No one yet</b><small>People you play online with show up here.</small></span></li>`;
      body = `<ul class="list">${rows}</ul><p class="note" style="margin-top:10px">Add someone while they're still online: they get a friend request. Players are known by display name only.</p>`;
    } else {
      const req = s.requests
        .map((r, i) => `<li class="li req"><span class="grow"><b>${esc(r.name)}</b><small>Wants to be friends</small></span><button class="btn secondary" style="height:30px" data-act="fno" data-i="${i}">No</button><button class="btn primary" style="height:30px" data-act="fyes" data-i="${i}">Accept</button></li>`)
        .join("");
      const inv = s.invites
        .map((v, i) => `<li class="li req"><span class="grow"><b>${esc(v.name)}</b><small>Invites you to a room</small></span><button class="btn secondary" style="height:30px" data-act="inv-no" data-i="${i}">No</button><button class="btn primary" style="height:30px" data-act="inv-join" data-i="${i}">Join</button></li>`)
        .join("");
      const label: Record<FriendState, string> = { off: "Offline", on: "In the lobby", room: "In a room", playing: "In a match" };
      const rows = s.friends.length
        ? s.friends
            .map(
              (f, i) => `<li class="li"><i class="dot ${f.state === "off" ? "" : f.state === "playing" ? "busy" : "on"}"></i><span class="grow"><b>${esc(f.name)}</b><small>${label[f.state]}</small></span>${
                inRoom && f.state !== "off" ? `<button class="btn primary" style="height:30px" data-act="finv" data-i="${i}">Invite</button>` : ""
              }<button class="ibtn" data-act="fdel" data-i="${i}" aria-label="Remove ${esc(f.name)}">${icon("close", "", 14)}</button></li>`,
            )
            .join("")
        : `<li class="li"><span class="grow"><b>No friends yet</b><small>Add people from Recent players, or tap a name in your room or on the scoreboard.</small></span></li>`;
      body = `${offline}
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <div class="glass" style="flex:1;padding:8px 10px"><div class="label">Online</div><div class="num" style="font-size:14px">${s.online === "ready" ? s.counts.online : "—"}</div></div>
          <div class="glass" style="flex:1;padding:8px 10px"><div class="label">In a match</div><div class="num" style="font-size:14px">${s.online === "ready" ? s.counts.inMatch : "—"}</div></div>
        </div>
        ${req || inv ? `<ul class="list" style="margin-bottom:10px">${inv}${req}</ul>` : ""}
        <ul class="list">${rows}</ul>
        <p class="note" style="margin-top:10px">${inRoom ? "Invite friends who are on: they get a notification in the lobby." : "Make a room (Room code) to invite friends who are on."} Your friends list is kept on this phone.</p>`;
    }
    this.sheet("friends", "Friends", body, { tabs, side: "right" });
  }

  /** A lobby notification (§7.5 #17): an invite or a friend request, with its answers. */
  notice(text: string, yes: string, no: string): void {
    let el = document.querySelector<HTMLElement>(".notice");
    if (!el) {
      el = document.createElement("div");
      el.className = "notice glass";
      el.setAttribute("role", "alert");
      el.dataset.ui = "1";
      this.toastEl.parentElement?.append(el);
      el.addEventListener("click", (e) => {
        const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
        if (!t) return;
        el!.classList.remove("visible");
        this.onAction(t.dataset.act!, t, e);
      });
    }
    el.innerHTML = `<span class="grow">${esc(text)}</span><button class="btn secondary" style="height:30px" data-act="${no}">No</button><button class="btn primary" style="height:30px" data-act="${yes}">${yes.startsWith("inv") ? "Join" : "Accept"}</button>`;
    translateTree(el);
    el.classList.add("visible");
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => el!.classList.remove("visible"), 12000);
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
    const off = (m: PlayMode) => (m === "solo" ? false : m === "lagos" ? !s.lagosLife || s.online !== "ready" : s.online !== "ready");
    const modes = (Object.keys(MODE_INFO) as PlayMode[])
      .filter((m) => m !== "lagos" || s.lagosLife)
      .map((m) => {
        const i = MODE_INFO[m];
        const tag = m === "solo" ? "Practice" : m === "lagos" ? "Stakes" : "Online";
        return `<button class="md ${s.mode === m ? "on" : ""}" data-act="pick-mode" data-mode="${m}" ${off(m) ? "disabled" : ""}>${icon(i.icon, "", 20)}<span class="grow"><b>${i.name}</b><small>${off(m) && s.online !== "ready" ? (s.online === "offline" ? "You're offline" : "Coming soon in this build") : i.sub}</small></span><span class="tag">${tag}</span></button>`;
      })
      .join("");
    const practice = s.mode === "solo";
    const staked = s.mode === "lagos";
    const skies = SKY_STATES.map((k) => `<button class="${k === s.sky ? "on" : ""}" data-act="sky" data-s="${k}">${SKY_LABEL[k]}</button>`).join("");
    const forced = s.settings.lightMode !== "auto";
    const join =
      s.mode === "friends" && !off("friends")
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
        <div class="start"><button class="btn secondary" data-act="tutorial">${icon("help", "", 16)}Tutorial</button><button class="btn primary" data-act="go" ${off(s.mode) || s.connecting ? "disabled" : ""}>${s.mode === "friends" ? "Make a room" : "Start"}</button></div>
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

  settings(s: Settings, tab: string, from: "lobby" | "pause", tierNote: string, confirmReset = false): void {
    const sw = (key: keyof Settings, label: string, sub = "") => `
      <label class="row-set"><span class="lbl"><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span>
        <span class="switch"><input type="checkbox" data-act="toggle" data-key="${key}" ${s[key] ? "checked" : ""} /><i></i></span></label>`;
    const seg = (key: string, cur: string, opts: [string, string][]) =>
      `<span class="seg">${opts.map(([v, l]) => `<button class="${cur === v ? "on" : ""}" data-act="set" data-key="${key}" data-val="${v}">${l}</button>`).join("")}</span>`;
    const RANGE: Record<RangeKey, [number, number]> = { sensH: [5, 100], sensV: [5, 100], stickOpacity: [30, 100], sens: [50, 200], master: [0, 100], musicVol: [0, 100], sfxVol: [0, 100] };
    const range = (key: RangeKey, label: string, sub: string, off = false) =>
      `<div class="row-set${off ? " off" : ""}"><span class="lbl"><b>${label}</b><small>${sub}</small></span><input class="slider" type="range" min="${RANGE[key][0]}" max="${RANGE[key][1]}" step="1" value="${Math.round(s[key] * 100)}" data-act="range" data-key="${key}" aria-label="${label}" ${off ? "disabled" : ""} /><span class="num pct" data-pct="${key}">${Math.round(s[key] * 100)}%</span></div>`;
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
        ${sw("rotate", "Rotate the game", "Turns the game on its side, for landscape with rotation lock on")}
        ${sw("dataSaver", "Data saver", "Half the updates from the server online. Others look a touch less smooth")}
        <p class="note" style="margin-top:10px">Low: no shadows, 2D clouds, lightest on battery, 30 fps on menus. Medium: shadows, sharper people and textures. High: full shadows, volumetric clouds, real reflections in puddles, glow and colour grading. Auto picks for your phone and adjusts the sharpness as you play.</p>`;
    } else if (tab === "audio") {
      body = `${range("master", "Master volume", "Everything")}
        ${sw("music", "Music", "Her songs. Her warning hum still plays when off")}
        ${range("musicVol", "Music volume", "Her songs", !s.music)}
        ${sw("sound", "Sound effects")}
        ${range("sfxVol", "Sound effects volume", "Lasers, hits, footsteps, the drum", !s.sound)}
        ${sw("haptics", "Vibration")}
        <label class="row-set off"><span class="lbl"><b>Voice chat</b><small>Not available: games in Lagos Life have no microphone. Use text chat and quick chat</small></span><span class="switch"><input type="checkbox" disabled /><i></i></span></label>
        <div class="row-set off"><span class="lbl"><b>Voice chat volume</b><small>Not available</small></span><input class="slider" type="range" min="0" max="100" value="0" disabled aria-label="Voice chat volume" /></div>`;
    } else if (tab === "controls") {
      body = `${range("sens", "Camera sensitivity", "Both look speeds together")}
        ${range("sensH", "Horizontal sensitivity", "Looking sideways. Lower is calmer")}
        ${range("sensV", "Vertical sensitivity", "Looking up and down. Lower is calmer")}
        ${sw("invertY", "Invert Y axis", "Push up to look down")}
        <div class="row-set"><span class="lbl"><b>Stick size</b></span>${seg("stickSize", s.stickSize, [["small", "Small"], ["medium", "Medium"], ["large", "Large"]])}</div>
        ${range("stickOpacity", "Stick opacity", "How solid the sticks look while you hold them")}
        ${sw("leftHanded", "Left-handed", "Move on the right, look on the left")}
        <div class="row-set"><span class="lbl"><b>Sprint</b><small>Toggle: tap on, tap off. Hold: sprint while held. Auto: a full push sprints</small></span>${seg("sprintMode", s.sprintMode, [["toggle", "Toggle"], ["hold", "Hold"], ["auto", "Auto"]])}</div>
        <div class="row-set"><span class="lbl"><b>Look stick</b><small>Always drawn, or only while touched</small></span>${seg("lookStick", s.lookStick, [["touch", "On touch"], ["always", "Always"]])}</div>
        ${sw("autoCam", "Camera drifts back behind you", "Off: the camera stays where you leave it")}
        ${sw("firstPerson", "Start in first person", "Switch any time with the eye button")}
        <div class="label" style="margin:14px 0 6px">All controls</div>
        <ul class="list ctl-list">${CONTROLS.map((c) => {
          const used = RLGL_CONTROLS.has(c.id);
          return `<li class="li${used ? "" : " off"}">${icon(c.icon, "", 18)}<span class="grow"><b>${esc(c.label)}</b><small>${esc(used ? c.touch : unusedReason(c.id))}</small></span>${used && c.key ? `<span class="key">${esc(c.key)}</span>` : ""}</li>`;
        }).join("")}</ul>
        <p class="note" style="margin-top:10px">Also: WASD or the arrows to move, Q/E or a mouse drag to look, V for first person, Esc to pause.</p>`;
    } else if (tab === "game") {
      body = `<div class="row-set"><span class="lbl"><b>Language</b><small>Menus, the HUD and the tutorial</small></span>${seg("lang", s.lang, [["en", "English"], ["pcm", "Pidgin"]])}</div>
        <div class="row-set"><span class="lbl"><b>Map size</b><small>The minimap. Tap it in a round for the full map</small></span>${seg("mapSize", s.mapSize, [["small", "Small"], ["medium", "Medium"], ["large", "Large"]])}</div>
        ${sw("notify", "Notifications", "Invites and friend requests pop up in the lobby")}
        ${sw("friendReqs", "Friend requests", "Off: nobody can send you one")}
        ${sw("chat", "Online chat", "Waiting rooms and results. Tap a message, or a name on the scoreboard, to mute, block or report")}
        ${sw("killFeed", "Kill feed", "Who was eliminated, top centre")}
        ${sw("blood", "Blood effects", "Off shows dust instead")}
        ${sw("shake", "Screen shake")}`;
    } else {
      body = `<div class="li"><span class="avatar" style="width:36px;height:36px">${icon("user", "", 18)}</span><span class="grow"><b data-name></b><small>Your name comes from the app you play in</small></span></div>
        <div class="row-set"><span class="lbl"><b>Level</b><small>Earned by playing; kept on this device</small></span><span class="num">${s.xp} XP</span></div>
        <div class="row-set"><span class="lbl"><b>CP</b><small>Earned by playing; spent on boosts in the Store</small></span><span class="num">${s.cp} CP</span></div>
        <div class="row-set"><span class="lbl"><b>Rounds played</b></span><span class="num">${s.played}</span></div>
        <div class="row-set"><span class="lbl"><b>Lines crossed</b></span><span class="num">${s.wins}</span></div>
        <div class="row-set"><span class="lbl"><b>Best score</b></span><span class="num">${s.best}</span></div>
        <div class="row-set"><span class="lbl"><b>Tutorial</b><small>Watch a round played, every rule explained</small></span><button class="btn secondary" style="height:30px" data-act="tutorial">Play</button></div>
        <div class="row-set"><span class="lbl"><b>Reset to default</b><small>Every setting back to how it came. Your level, CP, boosts, friends and looks stay</small></span>${
          confirmReset
            ? `<span style="display:flex;gap:6px"><button class="btn secondary" style="height:30px" data-act="reset-no">Cancel</button><button class="btn primary" style="height:30px" data-act="reset-yes">Reset</button></span>`
            : `<button class="btn secondary" style="height:30px" data-act="reset">Reset</button>`
        }</div>`;
    }
    this.sheet("settings", "Settings", body, { tabs, side: "wide", back: from === "pause" ? "pause-menu" : "back" });
  }

  /** A slider moved: its number follows without redrawing the sheet. */
  settingPct(key: string, pct: number): void {
    const el = this.root.querySelector<HTMLElement>(`[data-pct="${key}"]`);
    if (el) el.textContent = `${pct}%`;
  }

  // ── How to play ────────────────────────────────────────────────────────────

  // ── Pause ──────────────────────────────────────────────────────────────────

  /** The pause menu (§7.1, COD style): over an opaque blur. Online the round goes on. */
  pause(host: Host, online = false): void {
    this.mount(
      "pause",
      `<div class="pause-menu" role="dialog" aria-label="Paused">
        <div class="pause-head"><span class="h">Paused</span>${online ? `<span class="small">The round goes on online. You're standing still, and standing still is safe.</span>` : ""}</div>
        <div class="pause-list">
          <button class="md" data-act="resume" autofocus>${icon("play", "", 18)}<span class="grow"><b>Resume</b></span></button>
          <button class="md" data-act="pause-tab" data-tab="game">${icon("gear", "", 18)}<span class="grow"><b>Settings</b></span></button>
          <button class="md" data-act="pause-tab" data-tab="controls">${icon("controls", "", 18)}<span class="grow"><b>Controls</b></span></button>
          <button class="md" data-act="pause-tab" data-tab="audio">${icon("sound", "", 18)}<span class="grow"><b>Audio</b></span></button>
          <button class="md" data-act="pause-tab" data-tab="graphics">${icon("graphics", "", 18)}<span class="grow"><b>Graphics</b></span></button>
          ${online ? "" : `<button class="md" data-act="restart">${icon("refresh", "", 18)}<span class="grow"><b>Restart</b></span></button>`}
          <button class="md quit" data-act="menu">${icon("home", "", 18)}<span class="grow"><b>${online ? "Quit match" : "Quit to lobby"}</b></span></button>
          ${host.can.exit ? `<button class="md" data-act="exit">${icon("exit", "", 18)}<span class="grow"><b>Close game</b></span></button>` : ""}
        </div>
      </div>`,
      "pause-blur",
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
         <div class="pm-xp"><span class="label">+${r.xp} XP · +${r.cp} CP</span><span class="bar gold"><i style="width:100%"></i></span><span class="label">LV ${r.level}${r.levelUp ? " · Level up" : ""}</span></div>
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

  /** Solo: a moment while the map is built. */
  loading(): void {
    this.mount("loading", `<div class="sq-status glass sq-loading" style="bottom:50%"><span>Loading</span><i class="sq-load busy"><b></b></i></div>`);
  }

  /** A short holding card while the server answers. */
  waiting(text: string): void {
    this.mount(
      "room",
      `<div class="sq-status glass" style="bottom:50%">${esc(text)} · One moment…</div>
       <div class="sq-bar glass"><button class="btn secondary" data-act="leave-room">Cancel</button></div>`,
    );
  }

  /**
   * The waiting room (SPEC-V2 §1.2) over the 3D circle: name tags with ready
   * marks, the ready button, text chat (the chat button), and the 2 s loading
   * once everyone is ready.
   */
  room(room: RoomInfo, meId: string, serverNow: number, error: string | null): void {
    const n = room.players.length;
    const ready = room.players.filter((p) => p.ready).length;
    const me = room.players.find((p) => p.id === meId);
    const loading = !!room.map && room.state === "lobby";
    const canReady = room.kind !== "match" && room.state === "lobby" && !loading;
    const title = room.kind === "quick" ? "Play with New People" : room.kind === "match" ? "Lagos Life match" : "Invite Friends";
    this.mount(
      "room",
      `<div class="sq-head">
         <span class="label">${room.kind === "match" && room.stake ? `${naira(room.stake)} each` : `${MODE_NAME[room.mode]} · ${room.dist} m`}</span>
         <span class="h">${title}</span>
         ${room.code && room.kind !== "match" ? `<div style="display:flex;gap:6px;align-items:center"><span class="code" style="padding:6px 10px;font-size:14px">${esc(room.code)}</span><button class="ibtn glass" data-act="copy-code" aria-label="Copy code">${icon("copy", "", 18)}</button></div>` : ""}
       </div>
       <div class="sq-right">
         <span class="sq-count glass" style="padding:4px 10px">${n}/${room.size}</span>
         ${room.kind !== "match" ? `<span class="sq-ready">${icon("check", "", 14)}<b>${ready}/${n}</b> ready</span>` : ""}
       </div>
       <div class="tags" data-tags>${room.players
         .map((p) => `<span class="ntag ${p.id === meId ? "me" : ""} ${p.ready ? "ready" : ""} ${p.away ? "away" : ""}" data-tag="${esc(p.id)}" style="left:-999px">${p.ready ? icon("check", "rd", 12) : ""}${esc(p.name)}</span>`)
         .join("")}</div>
       ${
         error
           ? `<div class="sq-status glass status error" role="alert">${esc(error)}</div>`
           : loading
             ? `<div class="sq-status glass sq-loading" data-starts="${room.startsAt ?? ""}" data-loading="1"><span>Loading</span><i class="sq-load"><b data-load></b></i></div>`
             : `<div class="sq-status glass" data-starts="${room.startsAt ?? ""}">${this.roomStatus(room, serverNow, !!me?.ready)}</div>`
       }
       <div class="sq-bar glass">
         <button class="btn secondary" data-act="leave-room">${icon("exit", "", 16)}Leave</button>
         ${canReady ? `<button class="btn ${me?.ready ? "secondary" : "primary"}" data-act="ready" data-on="${me?.ready ? "0" : "1"}">${icon("check", "", 16)}${me?.ready ? "Not ready" : "Ready"}</button>` : ""}
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

  /** Called every frame while the room is showing: the countdown text, or the loading bar. */
  tickRoom(serverNow: number): void {
    const el = this.root.querySelector<HTMLElement>("[data-starts]");
    const at = Number(el?.dataset.starts);
    if (!el || !at) return;
    if (el.dataset.loading) {
      const bar = el.querySelector<HTMLElement>("[data-load]");
      const left = Math.max(0, at - serverNow) / (FLOW.loading * 1000);
      if (bar) bar.style.width = `${Math.round((1 - Math.min(1, left)) * 100)}%`;
      return;
    }
    const s = Math.max(0, Math.ceil((at - serverNow) / 1000));
    const text = s > 0 ? `Starting in ${s}s, or when everyone's ready` : "Here we go";
    if (el.textContent !== text) el.textContent = text;
  }

  private roomStatus(room: RoomInfo, serverNow: number, meReady: boolean): string {
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
    if (room.players.length < 2) return room.kind === "private" ? "Share the code. It starts when everyone's ready." : "Waiting for more players…";
    if (room.startsAt) {
      const s = Math.max(0, Math.ceil((room.startsAt - serverNow) / 1000));
      return s > 0 ? `Starting in ${s}s, or when everyone's ready` : "Here we go";
    }
    return meReady ? "Waiting for everyone to be ready…" : "Tap Ready. It starts when everyone's ready.";
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

/** Trim that stands out against a hoodie colour (as the painter picks it). */
function contrastOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return l > 140 ? "#1d1d20" : "#ece9e2";
}

/** A little picture of a design in the chosen colour. */
function designSwatch(id: HoodieDesign, main: string, alt: string): string {
  switch (id) {
    case "twotone":
      return `linear-gradient(180deg, ${alt} 0 22%, ${main} 22% 78%, ${alt} 78%)`;
    case "stripe":
      return `linear-gradient(180deg, ${main} 0 34%, ${alt} 34% 48%, #0a8a4a 48% 54%, ${main} 54%)`;
    case "ankara":
      return `radial-gradient(circle at 30% 72%, #e85d04 0 14%, #ffba08 15% 22%, transparent 23%), radial-gradient(circle at 70% 72%, #0f4c5c 0 14%, #ffba08 15% 22%, transparent 23%), ${main}`;
    case "block":
      return `linear-gradient(180deg, ${main} 0 52%, ${alt} 52%)`;
    default:
      return main;
  }
}
