// Every menu, Call of Duty Mobile style: the lobby with something in each
// corner, side sheets that keep your character in view, a mode select with a
// big START, the winner's circle and the squad room.
//
// One container, one screen at a time, built from templates. Anything that
// came from outside (a player's display name) goes through esc() — never raw
// into innerHTML. Text is white or black; nothing is bigger than 16px; no emoji.

import { DISTANCES, FEATURES, FLOW, MODES, MODE_NAME, NET, PRACTICE, SQUAD_COLORS, STAKED, TIME_LIMIT, ballCount } from "../config";
import { CONTROLS, RLGL_CONTROLS, unusedReason } from "../input/actions";
import type { ChallengeDef } from "../game/progress";
import { CATEGORIES, MAPS, SKY_LABEL, SKY_STATES, mapOf, thumbSvg, type MapCategory, type SkyState } from "../maps/registry";
import type { GameEntry, ModeEntry } from "../content/catalog";
import { BUILTIN_MANIFEST } from "../content/modes";
import type { RoomInfo } from "../net/protocol";
import type { Rank } from "../rank/ladder";
import type { Host, Leaderboard, MatchView } from "../platform/types";
import { errorText } from "../platform/vatarErrors";
import { LOOK_PRESETS, type Settings } from "../settings";
import { BOOSTS, BOOST_BY_ID, BOOST_ROUNDS, BOOST_SLOTS, type Boost, type BoostId } from "../shop/boosts";
import { PRODUCTS, PRODUCT_BY_ID } from "../shop/catalog";
import type { FriendState } from "../social/friends";
import { EMOTES, EMOTE_BY_ID, type EmoteId } from "../social/emotes";
import { HOODIE_COLORS, HOODIE_DESIGNS, type HoodieDesign, type Look } from "../world/human/wardrobe";
import { esc, fmtTime, ordinal } from "./dom";
import { SPOOKY_ROUTE } from "../maps/open/route";
import { divisionIndex } from "../content/validate";
import { getLang, t, translateTree } from "./i18n";
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
  /** Rank XP this round earned: null while the server hasn't said (online), 0 for practice. */
  xp: number | null;
  /** A line under the XP: why there's none, or that it wasn't saved. */
  xpNote: string | null;
  /** CP earned this round (shop/boosts cpForRound). */
  cp: number;
  rank: Rank;
  rankUp: boolean;
  /** Daily challenges finished by this round. */
  completed: string[];
}

/** The Play screen with Free For All picked (SPEC-V3 §9). */
export interface FfaPlayState {
  mode: PlayMode;
  online: OnlineAvailability;
  lagosLife: boolean;
  error: string | null;
  connecting: boolean;
  games: GameEntry[];
  /** Every Free For All mode you can see, and this week's featured ones (the public queues). */
  modes: ModeEntry[];
  rotation: readonly string[];
  pick: string;
  /** Your party, if you're in one. */
  party: { code: string; members: { id: string; name: string }[]; lead: string; me: string } | null;
  /** The Ranked queue (Phase 6): picked, and whether your rank has opened it (Pro I). */
  ranked: boolean;
  rankedOpen: boolean;
  /** This week's mutator, named ("" for none). */
  mutator: string;
}

/** A Free For All match's results. */
export interface FfaResultView {
  mode: string;
  won: boolean;
  place: number;
  /** Squads (or people on their own) in the match. */
  sides: number;
  seconds: number;
  measure: string;
  rows: { id: string; place: number; name: string; me: boolean; squad: number; objective: number; won: boolean }[];
  /** Online: you've commended someone from this match already (§10.12: once a match). */
  commended?: boolean;
  /** A Dead Streets run: its line ("8:12 · 34 down"), the server's word on it, the board's best times. */
  runLine?: string;
  runNote?: string;
  board?: { secs: number; you: boolean }[];
  /** The run summary map (§3.4 #22): where you went, where past runs ended, what you missed. */
  runMap?: { trace: readonly number[]; deaths: readonly [number, number][]; missed: readonly [number, number][] };
  online: "quick" | "private" | "match" | null;
  matchNote?: string | null;
  xp: number | null;
  xpNote: string | null;
  rank: Rank;
  rankUp: boolean;
  /** The play of the game (§10.11), and where you went (§10.22). */
  play?: string;
  trail?: readonly [number, number, number][];
  /** Today's challenges this match finished. */
  completed?: string[];
}

/** Honour's cosmetic title (§10.12) for this many commends, or null. */
export function honourTitle(n: number): string | null {
  return n >= 50 ? "Odogwu" : n >= 20 ? "Respected" : n >= 5 ? "Honoured" : null;
}

/** The results' XP line: what the round earned toward your rank, and where the rank stands. */
function rankLine(r: Pick<ResultInfo, "rank" | "xp" | "rankUp" | "xpNote"> & { cp?: number }): string {
  const k = r.rank;
  const xp = r.xp === null ? `<span class="label">Counting XP…</span>` : `<span class="label">+${r.xp} XP${r.cp !== undefined ? ` · +${r.cp} CP` : ""}</span>`;
  const bar = `<span class="bar gold"><i style="width:${k.top ? 100 : Math.round((k.into / k.need) * 100)}%"></i></span>`;
  const name = `<span class="label">${esc(k.name)}${r.rankUp ? " · Rank up" : ""}</span>`;
  return `${xp}${bar}${name}${r.xpNote ? `<span class="small">${esc(r.xpNote)}</span>` : ""}`;
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
  /** Your rank on the ladder (SPEC-V3 §2), and whether it is the server's (else this phone's own count). */
  rank: Rank;
  rankSaved: boolean;
  /** Your place on Lagos Life's board ("#12"), when there is one. */
  board: string | null;
  friends: { online: number | null; inMatch: number | null; recent: string[] };
  daily: { def: ChallengeDef; progress: number }[];
  mode: PlayMode;
  badge: boolean;
  /** Free For All's mode on the card (its name), or null for Ball Haunt. */
  ffa: string | null;
  /** v4 Lobby A: the week's next drop (full-bleed behind), this week's rotation, your squad, your loadout. */
  drop?: { name: string; line: string };
  rotation?: { name: string; url: string; on: boolean }[];
  squad?: { name: string; me: boolean }[];
  loadout?: { kit: string; armour: number; dead: string };
}

type Action = (name: string, el: HTMLElement, ev: Event) => void;

type RangeKey = "sensH" | "sensV" | "stickOpacity" | "sens" | "master" | "musicVol" | "sfxVol" | "adsVol" | "lookAccel";

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

/** Naija World's thumbnail: a market skyline at midday. */
const NAIJA_THUMB = { ...mapOf("market-square"), id: "naijaworld", colors: ["#6fa8dc", "#f3d9a4", "#8a7a5c", "#3b2a1e", "#f4a259"] } as const satisfies ReturnType<typeof mapOf>;



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

  /**
   * The unlock ceremony (SPEC-V3 §10.15): a new rank's name rises in gold,
   * then each mode it unlocks flips in as a card. Over whatever is showing;
   * a tap, or a few seconds, ends it.
   */
  ceremony(rank: string, modes: { name: string; blurb: string }[]): void {
    document.querySelector(".ceremony")?.remove();
    const node = document.createElement("div");
    node.className = "ceremony";
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label", `${t("Rank up")}: ${rank}`);
    node.innerHTML = `<div class="cer-rays"></div>
      <div class="cer-head"><span class="cer-small">${esc(t("Rank up"))}</span><span class="cer-rank">${esc(rank.toUpperCase())}</span></div>
      ${modes.length ? `<div class="cer-cards">${modes.map((m, i) => `<div class="cer-card glass" style="animation-delay:${1.1 + i * 0.35}s"><span class="cer-new">${esc(t("Unlocked"))}</span><b>${esc(t(m.name))}</b><small>${esc(t(m.blurb))}</small></div>`).join("")}</div>` : ""}
      <span class="cer-tap">${esc(t("Tap to continue"))}</span>`;
    const close = () => {
      node.classList.add("out");
      setTimeout(() => node.remove(), 400);
    };
    node.addEventListener("click", close);
    setTimeout(close, 4500 + modes.length * 600);
    document.body.append(node);
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
    const rk = s.rank;
    const node = this.mount(
      "lobby",
      `<div class="vignette-lobby"></div>
      <div class="lb-tl profile" data-act="customize" role="button" tabindex="0" aria-label="Your profile">
        <div class="avatar" data-avatar></div>
        <div class="who">
          <span class="nm" data-name></span>
          <span class="lv" title="${rk.into.toLocaleString()} / ${rk.need.toLocaleString()} XP${s.rankSaved ? "" : " (this device)"}"><b>${esc(rk.name.toUpperCase())}</b><span class="bar gold"><i style="width:${rk.top ? 100 : Math.round((rk.into / rk.need) * 100)}%"></i></span>${settings.founder ? `<span class="founder">FOUNDER</span>` : ""}${honourTitle(settings.honour) ? `<span class="founder honour">${esc(t(honourTitle(settings.honour)!).toUpperCase())}</span>` : ""}</span>
          <span class="meta">${settings.form ? `<span class="form" title="${esc(t("Form: your last five online matches"))}">FORM <b>${[...settings.form].map((x) => `<i class="${x === "W" ? "w" : "l"}">${x}</i>`).join("")}</b></span>` : ""}${settings.streak >= 2 ? `<span class="streak">STREAK <b>${settings.streak}</b></span>` : ""}${s.board ? `<span>BOARD <b>${esc(s.board)}</b></span>` : ""}<span>BEST <b>${settings.best || 0}</b></span><span>CP <b>${settings.cp}</b></span></span>
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
      ${this.lobbyA(s)}
      <div class="lb-bar glass-fill">
        <button class="act" data-act="loadout">${icon("loadout")}<span>Loadout</span></button>
        <button class="act" data-act="customize">${icon("customize")}<span>Customize</span></button>
        <button class="act" data-act="emotes">${icon("emote")}<span>Emotes</span></button>
        <button class="act" data-act="invite" ${s.online !== "ready" ? "disabled" : ""}>${icon("invite")}<span>Invite</span></button>
      </div>
      <button class="lb-play" data-act="start" aria-label="Play">PLAY</button>`,
      "lobby",
    );
    node.classList.add("lobby-a");
    this.setPlayer(node, host);
  }

  /**
   * v4 Lobby A's own parts: the next drop's name over its picture; the
   * loadout in HUD A's Field Kit style (sidearm, primary, melee, Dead
   * Streets' weapon, the suit: black, no armour, v4 rework); your squad's four slots (an empty
   * one invites); this week's rotation.
   */
  private lobbyA(s: LobbyState): string {
    const lo = s.loadout;
    const card = (slot: string, name: string, rar: string, col: string) => `<div class="fk-card" style="--c:${col}"><span class="s">${esc(t(slot)).toUpperCase()} · <b>${esc(t(rar)).toUpperCase()}</b></span><span class="n">${esc(t(name)).toUpperCase()}</span></div>`;
    const squad = s.squad ?? [];
    const slots = Array.from({ length: 4 }, (_, i) => {
      const m = squad[i];
      if (m) return `<div class="sq${m.me ? " me" : ""}"><span class="ini">${esc(m.name.trim().charAt(0).toUpperCase() || "?")}</span><span class="nm">${esc(m.name)}</span></div>`;
      return `<button class="sq empty" data-act="invite" ${s.online !== "ready" ? "disabled" : ""} aria-label="Invite"><span class="ini">+</span><span class="nm">${esc(t("Invite"))}</span></button>`;
    }).join("");
    return `${s.drop ? `<div class="lb-drop"><span class="k">${esc(t("Next drop"))}</span><b>${esc(t(s.drop.name)).toUpperCase()}</b><span class="l">${esc(t(s.drop.line))}</span></div>` : ""}
      ${lo ? `<div class="lb-kit">
        <span class="h">${esc(t("Loadout"))}</span>
        ${card("Sidearm", "Pistol", "Common", "#b9bcc2")}
        ${card("Primary", "Loot: rifle, SMG, shotgun", "Up to Mythic", "#ffb020")}
        ${card("Melee", "Close quarters", "Backup", "#3a9bff")}
        ${lo.dead ? card("Dead Streets", lo.dead, "Run weapon", "#ff5a4a") : ""}
        ${card("Suit", "Black, gloves, boots", "No armour worn", "#8a8f94")}
      </div>` : ""}
      <div class="lb-squad">${slots}</div>
      ${s.rotation?.length ? `<button class="lb-rot" data-act="mode" aria-label="${esc(t("Change mode"))}"><span class="h">${esc(t("Rotation · this week"))}</span><span class="row">${s.rotation.map((r) => `<span class="th${r.on ? " on" : ""}" style="background-image:url(${r.url})"><b>${esc(t(r.name))}</b></span>`).join("")}</span><span class="pick">${icon("swap", "", 12)}<b>${esc(t(s.rotation.find((r) => r.on)?.name ?? s.ffa ?? "Dead Streets")).toUpperCase()}</b></span></button>` : ""}`;
  }

  private modeCard(s: LobbyState): string {
    if (s.ffa !== null) {
      return `<button class="modecard glass" data-act="mode" aria-label="Change mode">
      <span class="thumb">${thumbSvg(NAIJA_THUMB)}</span>
      ${icon("swap", "", 18)}
      <span class="txt art-t"><span class="label">${s.ffa === "Dead Streets" ? "Survival" : "Free For All"}</span>
      <b>${esc(s.ffa)}</b>
      <span class="small">${t(s.ffa === "Dead Streets" ? "Spooky World" : "Meridian City")}</span></span>
    </button>`;
    }
    const map = mapOf(s.settings.map);
    const mode = MODE_INFO[s.mode];
    return `<button class="modecard glass" data-act="mode" aria-label="Change mode and map">
      <span class="thumb">${thumbSvg(map)}</span>
      ${icon("swap", "", 18)}
      <span class="txt art-t"><span class="label">Ball Haunt</span>
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
  customize(look: Look, tab: string, owned: ReadonlySet<string>, canBuy: boolean, rankK = 0): void {
    const tabs = [
      ["hoodie", "Armband"],
      ["body", "Body"],
    ]
      .map(([id, label]) => `<button class="tab ${tab === id ? "on" : ""}" data-act="ctab" data-tab="${id}">${label}</button>`)
      .join("");
    let body = "";
    const lock = (product: string | undefined) => !!product && !owned.has(product);
    const price = (product: string | undefined, locked: boolean) => (product && locked ? `<span class="price num">${naira(PRODUCT_BY_ID[product].price)}</span>` : "");
    if (tab === "body") {
      body = `<div class="row-set" style="margin-top:12px"><span class="lbl"><b>Height</b><small>A little taller or shorter</small></span>
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
        const rankLocked = !!d.rank && rankK < divisionIndex(d.rank);
        const locked = lock(d.product) || rankLocked;
        return `<button class="tile ${look.design === d.id ? "on" : ""} ${locked ? "locked" : ""}" data-act="look" data-key="design" data-val="${d.id}" ${lock(d.product) ? `data-locked="${d.product}"` : rankLocked ? `data-rank="${d.rank}"` : ""}>
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
       ${!packOwned ? `<div class="status" style="margin-top:12px">${icon("lock", "", 14)} Wobble, Shuffle and Hero come with the Party emote pack${canBuy ? ` · ${naira(PRODUCT_BY_ID.emotes_owambe.price)} in the Store` : " (inside Lagos Life)"}.</div>` : ""}`,
    );
  }

  loadout(s: Settings): void {
    this.sheet(
      "loadout",
      "Loadout",
      `<button class="md" style="margin: auto" data-act="emotes">${icon("wheel", "", 18)}<span class="grow" ><b>Edit the wheel</b><small>${s.wheel.map((id) => EMOTE_BY_ID[id].label).join(" · ")}</small></span>${icon("next", "", 16)}</button>
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

  play(s: { mode: PlayMode; settings: Settings; online: OnlineAvailability; lagosLife: boolean; error: string | null; connecting: boolean; sky: SkyState; games: GameEntry[] }): void {
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
        <div class="games">${s.games.map((g) => `<button class="gm ${g.id === "rlgl" ? "on" : ""}" ${g.state === "play" ? "" : "disabled"}>${esc(g.name)}${g.state === "play" ? "" : `<span class="soon">Soon</span>`}</button>`).join("")}</div>
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

  /** The Play screen, Free For All picked: how to play (queue, room, practice, stakes), which mode, your party. */
  /** Dead Streets on the Play screen (Phase 7): the run, your best, start. */
  playRun(s: { games: GameEntry[]; best: number; error: string | null; weapon: string; perks: string[]; charms: string[]; mods: string[]; daily: boolean; open: { dane: boolean; pestle: boolean; flame: boolean; perk2: boolean }; mutator: string }): void {
    const chip = (act: string, id: string, label: string, on: boolean, locked = false, why = "") =>
      `<button class="chip ${on ? "on" : ""}" data-act="${act}" data-id="${id}" ${locked ? "disabled" : ""} aria-pressed="${on}">${esc(label)}${locked ? ` <span class="soon">${esc(why)}</span>` : ""}</button>`;
    const weapons = [
      chip("run-weapon", "pistol", "Pistol", s.weapon === "pistol"),
      chip("run-weapon", "dane", "Breacher", s.weapon === "dane", !s.open.dane, "Pro"),
      chip("run-weapon", "pestle", "Thunder Maul", s.weapon === "pestle", !s.open.pestle, "Legendary"),
      chip("run-weapon", "flame", "Flamer", s.weapon === "flame", !s.open.flame, "Master"),
    ].join("");
    const perkNames: Record<string, string> = { breath: "Second Breath", quiet: "Quiet Feet", eagle: "Eagle Eye", mule: "Pack Mule", steady: "Steady Hand" };
    const perks = Object.entries(perkNames).map(([id, n]) => chip("run-perk", id, n, s.perks.includes(id))).join("");
    const charms = [chip("run-charm", "notorch", "No torch ×1.15", s.charms.includes("notorch")), chip("run-charm", "melee", "Melee only ×1.2", s.charms.includes("melee")), chip("run-charm", "six", "6 slots ×1.15", s.charms.includes("six"))].join("");
    const mods = [chip("run-mod", "suppressor", "Suppressor", s.mods.includes("suppressor")), chip("run-mod", "scope", "NV scope", s.mods.includes("scope"))].join("");
    const loadout = `<div class="glass gamecard runkit">
        <div class="label">Weapon</div><div class="chips">${weapons}</div>
        <div class="label">Perk${s.open.perk2 ? "s (2)" : " (1; a second at Legendary)"}</div><div class="chips">${perks}</div>
        <div class="label">Weapon mods</div><div class="chips">${mods}</div>
        <div class="label">Charms (harder, more XP)</div><div class="chips">${charms}</div>
        <div class="chips">${chip("run-daily", "daily", "Daily Run: today's seed for everyone", s.daily)}</div>
        ${s.mutator ? `<span class="small">${icon("star", "", 12)} ${esc(t("This week"))}: ${esc(t(s.mutator))}</span>` : ""}
      </div>`;
    const games = s.games
      .map((g) => `<button class="gm ${g.id === "survival" ? "on" : ""}" data-act="pick-game" data-g="${g.id}" ${g.state === "play" ? "" : "disabled"}>${esc(g.name)}${g.state === "play" ? "" : `<span class="soon">${g.state === "locked" ? "Locked" : "Soon"}</span>`}</button>`)
      .join("");
    this.mount(
      "play",
      `<div class="playscreen">
        <div class="head"><button class="ibtn glass" data-act="back" aria-label="Back">${icon("back")}</button><span class="h">Play</span><span class="grow"></span></div>
        <div class="games">${games}</div>
        <div class="modes">${s.error ? `<div class="status error" role="alert">${esc(s.error)}</div>` : ""}</div>
        <div class="side">
          <div class="glass mapcard">
            <div class="row"><b>Spooky World</b></div>
            <span class="small">A dead city at night, 320 × 320 m: from the Motor Park of the Lost to the Broadcast Mast, 1.4 km of streets through twelve districts and thirty obstacles. Churches and mosques are sanctuaries.</span>
          </div>
          ${loadout}
          <div class="glass gamecard"><div class="label">Dead Streets</div><span class="small">Cross the dead city to the Mast. Fast, and alive. After 12:00 you bleed. On your own; your run is checked by our server.</span>
            <span class="small">${s.best > 0 ? `Your best: <b class="num">${fmtTime(s.best)}</b>` : "No finished run yet."}</span></div>
        </div>
        <div class="start"><button class="btn primary" data-act="go">${icon("play", "", 16)}Start a run</button></div>
      </div>`,
      "dim",
    );
  }

  playFfa(s: FfaPlayState): void {
    const off = (m: PlayMode) => (m === "solo" ? false : m === "lagos" ? !s.lagosLife || s.online !== "ready" : s.online !== "ready");
    const info: Record<PlayMode, { name: string; sub: string; icon: string; tag: string }> = {
      new: { name: "Quick match", sub: "This week's featured modes · 12 players", icon: "people", tag: "Online" },
      friends: { name: "Private room", sub: "Any mode you've unlocked, with your people", icon: "invite", tag: "Online" },
      solo: { name: "Practice", sub: "Meridian City on your own: learn the moves", icon: "target", tag: "Alone" },
      lagos: { name: "Lagos Life match", sub: "The Flag Duel · 2–4 players · optional stakes", icon: "trophy", tag: "Stakes" },
    };
    const order: PlayMode[] = ["new", "friends", "solo", "lagos"];
    const modes = order
      .filter((m) => m !== "lagos" || s.lagosLife)
      .map((m) => {
        const i = info[m];
        return `<button class="md ${s.mode === m ? "on" : ""}" data-act="pick-mode" data-mode="${m}" ${off(m) ? "disabled" : ""}>${icon(i.icon, "", 20)}<span class="grow"><b>${i.name}</b><small>${off(m) && s.online !== "ready" ? (s.online === "offline" ? "You're offline" : "Coming soon in this build") : i.sub}</small></span><span class="tag">${i.tag}</span></button>`;
      })
      .join("");
    const games = s.games
      .map((g) => `<button class="gm ${g.id === "ffa" ? "on" : ""}" data-act="pick-game" data-g="${g.id}" ${g.state === "play" ? "" : "disabled"}>${esc(g.name)}${g.state === "play" ? "" : `<span class="soon">${g.state === "locked" ? "Locked" : "Soon"}</span>`}</button>`)
      .join("");
    // Which modes this way of playing offers: the queue has only the featured ones.
    const list = s.mode === "new" ? s.modes.filter((e) => s.rotation.includes(e.def.id)) : s.modes;
    const picked = list.find((e) => e.def.id === s.pick && e.state === "play") ?? list.find((e) => e.state === "play") ?? null;
    const seg = list
      .map((e) => {
        const why = e.state === "locked" ? `${icon("lock", "", 11)}${esc(e.unlocksAt ?? "")}` : e.state === "soon" ? "Soon" : "";
        return `<button class="${picked && e.def.id === picked.def.id ? "on" : ""}" data-act="ffa-mode" data-m="${esc(e.def.id)}" ${e.state === "play" ? "" : "disabled"}>${esc(e.def.name.en)}${why ? `<small>${why}</small>` : ""}</button>`;
      })
      .join("");
    const party = s.party;
    const lead = !party || party.lead === party.me;
    const partyBox =
      s.mode === "new" || s.mode === "friends"
        ? party
          ? `<div class="label">Party · <span class="num">${esc(party.code)}</span></div>
             <span class="small">${party.members.map((p) => esc(p.name) + (p.id === party.lead ? " (leader)" : "")).join(", ")}</span>
             ${lead ? "" : `<span class="small">The leader picks the game.</span>`}
             <button class="btn secondary" style="height:30px;padding:0 10px;align-self:flex-start" data-act="party-leave">Leave the party</button>`
          : `<div class="label">Party</div><span class="small">Up to 4: one squad, matched together.</span>
             <div class="row"><button class="btn secondary" style="height:30px;padding:0 10px" data-act="party-make">${icon("invite", "", 14)}Make a party</button></div>
             <form class="join party-join"><input name="pcode" maxlength="${NET.codeLength}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="PARTY CODE" aria-label="Party code" /><button class="btn secondary" type="button" data-act="party-join">Join</button></form>`
        : "";
    const join =
      s.mode === "friends" && !off("friends")
        ? `<form class="join room-join" style="margin-top:8px"><input name="code" maxlength="${NET.codeLength}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ROOM CODE" aria-label="Room code" /><button class="btn secondary" type="button" data-act="join">Join</button></form>`
        : "";
    const p = picked?.def;
    // Ranked: the public queue only, from Pro I.
    const ranked =
      s.mode === "new"
        ? `<button class="rk ${s.ranked && s.rankedOpen ? "on" : ""}" data-act="ffa-ranked" ${s.rankedOpen ? "" : "disabled"} aria-pressed="${s.ranked && s.rankedOpen}">${icon(s.rankedOpen ? "trophy" : "lock", "", 14)}<b>Ranked</b><small>${s.rankedOpen ? "Double XP, harder rules" : "Opens at Pro I"}</small></button>`
        : "";
    const card =
      s.mode === "lagos"
        ? `<div class="label">Lagos Life match</div><span class="small">The Flag Duel on the market: the first to find the hidden flag and hold it for 10 s wins. Melee, the zone and items are on. Every staked match plays the same.</span>`
        : `<div class="label">Mode</div><div class="seg wrap ffa-modes">${seg || `<span class="small">No mode here yet.</span>`}</div>
           ${ranked}
           ${s.mutator ? `<span class="small mu">${icon("star", "", 12)} ${esc(t("This week"))}: ${esc(t(s.mutator))}</span>` : ""}
           ${p ? `<span class="small">${esc(p.blurb.en)} ${p.players.min === p.players.max ? `${p.players.max} players` : `${p.players.min}–${p.players.max} players`}${p.players.squad[1] > 1 ? `, squads of ${p.players.squad[0] === p.players.squad[1] ? p.players.squad[0] : `up to ${p.players.squad[1]}`}` : ""}, ${Math.round(p.time / 60)} min.</span>` : ""}`;
    const label = s.mode === "friends" ? "Make a room" : s.mode === "solo" ? "Practice" : s.mode === "lagos" ? "Stakes" : "Find a match";
    const blocked = off(s.mode) || s.connecting || (s.mode !== "lagos" && !picked) || (s.mode === "new" && !lead);
    const node = this.mount(
      "play",
      `<div class="playscreen">
        <div class="head"><button class="ibtn glass" data-act="back" aria-label="Back">${icon("back")}</button><span class="h">Play</span><span class="grow"></span></div>
        <div class="games">${games}</div>
        <div class="modes">${modes}${join}
          ${s.error ? `<div class="status error" role="alert">${esc(s.error)}</div>` : ""}
          ${s.connecting ? `<div class="status">Connecting…</div>` : ""}
        </div>
        <div class="side">
          <div class="glass mapcard">
            <div class="row"><b>Meridian City</b></div>
            <span class="small">One city, 400 × 400 m: glass offices, the arcade and the transit hub in the east, courtyard flats, old farms and the river in the west. The zone closes in; the sky hunts whoever is outside it.</span>
          </div>
          <div class="glass gamecard">${card}${partyBox}</div>
        </div>
        <div class="start"><button class="btn secondary" data-act="ffa-tutorial">${icon("help", "", 16)}How to play</button><button class="btn primary" data-act="go" ${blocked ? "disabled" : ""}>${label}</button></div>
      </div>`,
      "dim",
    );
    for (const form of node.querySelectorAll("form")) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const btn = form.querySelector<HTMLElement>("[data-act]");
        if (btn) this.onAction(btn.dataset.act!, btn, e);
      });
    }
  }

  /** A Free For All match's results: your place, everyone's, the XP. */
  ffaResults(r: FfaResultView, plates: { name: string; line: string; me: boolean }[], returnIn: number): void {
    const head = r.won ? "Victory" : r.place > 0 ? `${ordinal(r.place)} of ${r.sides}` : "Match over";
    const primary =
      r.online === "match"
        ? `<button class="btn primary" data-act="vmenu" autofocus>${icon("trophy", "", 16)}Another match</button>`
        : r.online === "private"
          ? `<button class="btn primary" data-act="room" autofocus>${icon("back", "", 16)}Back to the room</button>`
          : r.online === "quick"
            ? `<button class="btn primary" data-act="ffa-again" autofocus>${icon("bolt", "", 16)}Play again</button>`
            : `<button class="btn primary" data-act="ffa-again" autofocus>${icon("refresh", "", 16)}Practice again</button>`;
    // The top five, and you (wherever you came).
    const mine = r.rows.findIndex((x) => x.me);
    const shown = r.rows.filter((_, i) => i < 5 || i === mine);
    const rows = shown
      .map((x) => {
        // Honour (§10.12): commend one player you just played with.
        const commend = r.online && !x.me ? `<button class="mini commend" data-act="commend" data-id="${esc(x.id)}" aria-label="Commend ${esc(x.name)}" ${r.commended ? "disabled" : ""}>${icon("respect", "", 13)}</button>` : "";
        return `<tr class="${x.me ? "me" : ""}"><td class="num">${x.place}</td><td>${esc(x.name)}${x.me && x.name !== "You" ? " · You" : ""} ${commend}</td><td class="num">${r.measure ? (Number.isInteger(x.objective) ? x.objective : x.objective.toFixed(1)) : ""}</td></tr>`;
      })
      .join("");
    // v4: the cinematic first (letterbox, the word, the line), then the card under it. A tap skips it.
    const mineRow = r.rows.find((x) => x.me);
    const line = r.runLine ?? [r.place > 0 && (r.won || r.place > 1) ? `${ordinal(r.place)} ${t("of")} ${r.sides}` : t("Time up"), r.measure && mineRow && mineRow.objective > 0 ? `${Number.isInteger(mineRow.objective) ? mineRow.objective : mineRow.objective.toFixed(1)} ${t(r.measure)}` : ""].filter(Boolean).join(" · ");
    const cine = `<div class="cine ${r.won ? "win" : "lose"}" data-cine><i class="lb t"></i><i class="lb b"></i><div class="ct"><span class="k">${esc(t(r.mode)).toUpperCase()}</span><b>${esc(t(r.won ? "Victory" : "Defeat")).toUpperCase()}</b><span class="p">${esc(line)}</span></div></div>`;
    this.mount(
      "results",
      `${cine}<div class="pm-head"><span class="h">${esc(r.mode)}</span><span class="sub ${r.won ? "win" : "lose"}">${head}</span></div>
       <div class="pm-return glass" data-return>${returnIn > 0 ? `Returning to lobby in <span class="num">${returnIn}</span>` : ""}</div>
       <div class="pm-plates">${plates
         .map((p, i) => `<div class="plate glass" data-plate="${i}" style="left:-999px"><span class="pl">${i + 1}</span><span class="pn"><b>${esc(p.name)}${p.me ? " · You" : ""}</b><small class="num">${esc(p.line)}</small></span></div>`)
         .join("")}</div>
       <div class="pm-card glass">
         <table class="ffa-table"><thead><tr><th>#</th><th>Player</th><th>${esc(r.measure)}</th></tr></thead><tbody>${rows}</tbody></table>
         ${r.runLine ? `<div class="pm-play"><span class="label">${t("Your run")}</span><span class="small">${esc(r.runLine)}</span><span class="small" data-run-note>${esc(r.runNote ?? "")}</span></div>` : ""}
         ${r.board?.length ? `<div class="pm-play" data-board><span class="label">${t("Best times")}</span><span class="small">${r.board.map((b, i) => `${i + 1}. <b class="num">${fmtTime(b.secs)}</b>${b.you ? ` · ${t("You")}` : ""}`).join("<br>")}</span></div>` : ""}
         ${r.play ? `<div class="pm-play"><span class="label">${t("Play of the game")}</span><span class="small">${esc(r.play)}</span></div>` : ""}
         ${r.runMap ? `<div class="pm-heat"><span class="label">${t("Your run")}</span><canvas width="140" height="140" data-runmap></canvas></div>` : ""}
         ${r.trail && r.trail.length > 4 && !r.runMap ? `<div class="pm-heat"><span class="label">${t("Where you went")}</span><canvas width="120" height="120" data-heat></canvas></div>` : ""}
         <div class="pm-xp" data-rank-line>${r.online ? rankLine(r) : `<span class="small">Practice: no XP. Play online to rank up.</span>`}</div>
         ${r.online === "match" ? `<div class="status" data-match-outcome>${esc(r.matchNote ?? "Sending the result to Lagos Life…")}</div>` : ""}
         ${r.completed?.length ? `<div class="status ok">${icon("check", "", 14)} Daily done: ${r.completed.map((c) => esc(t(c))).join(", ")}</div>` : ""}
         <div class="pm-actions">
           ${primary}
           ${r.runMap ? `<button class="btn secondary" data-act="photo">${icon("fpv", "", 16)}Photo</button>` : ""}
           <button class="btn secondary" data-act="menu">${icon("home", "", 16)}${r.online ? "Leave" : "Lobby"}</button>
         </div>
       </div>`,
    );
    const cineEl = this.root.querySelector<HTMLElement>("[data-cine]");
    if (cineEl) {
      this.root.firstElementChild?.classList.add("cined");
      const done = () => {
        cineEl.classList.add("gone");
        this.root.firstElementChild?.classList.remove("cined");
      };
      cineEl.addEventListener("pointerdown", done, { once: true });
      setTimeout(done, matchMedia("(prefers-reduced-motion: reduce)").matches ? 900 : 2900);
    }
    const heat = this.root.querySelector<HTMLCanvasElement>("canvas[data-heat]");
    if (heat && r.trail) this.drawHeat(heat, r.trail);
    const rm = this.root.querySelector<HTMLCanvasElement>("canvas[data-runmap]");
    if (rm && r.runMap) this.drawRunMap(rm, r.runMap);
  }

  /** The server's word on a run arrived after the results went up: its note and the board. */
  updateRun(r: FfaResultView): void {
    const note = this.root.querySelector<HTMLElement>("[data-run-note]");
    if (note) note.textContent = r.runNote ?? "";
    if (r.board?.length && !this.root.querySelector("[data-board]")) {
      const xp = this.root.querySelector<HTMLElement>("[data-rank-line]");
      xp?.insertAdjacentHTML("beforebegin", `<div class="pm-play" data-board><span class="label">${esc(t("Best times"))}</span><span class="small">${r.board.map((b, i) => `${i + 1}. <b class="num">${fmtTime(b.secs)}</b>${b.you ? ` · ${esc(t("You"))}` : ""}`).join("<br>")}</span></div>`);
    }
  }

  /** The run summary map (§3.4 #22): the route, your way along it, past runs' ends (red), what you missed (rings). */
  private drawRunMap(c: HTMLCanvasElement, r: NonNullable<FfaResultView["runMap"]>): void {
    const g = c.getContext("2d");
    if (!g) return;
    const W = c.width;
    const half = 160;
    const px = (v: number) => ((v + half) / (2 * half)) * W;
    g.fillStyle = "rgba(20,10,10,0.88)";
    g.fillRect(0, 0, W, W);
    g.lineWidth = 3;
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.beginPath();
    for (const [i, [x, z]] of SPOOKY_ROUTE.entries()) (i ? g.lineTo(px(x), px(z)) : g.moveTo(px(x), px(z)));
    g.stroke();
    g.lineWidth = 1.6;
    g.strokeStyle = "rgba(255,194,58,0.9)";
    g.beginPath();
    for (let i = 0; i + 3 < r.trace.length; i += 4) (i ? g.lineTo(px(r.trace[i + 1]), px(r.trace[i + 2])) : g.moveTo(px(r.trace[i + 1]), px(r.trace[i + 2])));
    g.stroke();
    g.fillStyle = "rgba(255,70,50,0.45)";
    for (const [x, z] of r.deaths) g.fillRect(px(x) - 1.5, px(z) - 1.5, 3, 3);
    g.strokeStyle = "rgba(160,220,255,0.7)";
    for (const [x, z] of r.missed) {
      g.beginPath();
      g.arc(px(x), px(z), 2.5, 0, Math.PI * 2);
      g.stroke();
    }
  }

  /** The heat map (§10.22): where you spent your match, gold where you had the objective. */
  private drawHeat(c: HTMLCanvasElement, trail: readonly [number, number, number][]): void {
    const g = c.getContext("2d");
    if (!g) return;
    const W = c.width;
    const half = 200;
    const px = (v: number) => ((v + half) / (2 * half)) * W;
    g.fillStyle = "rgba(20,16,12,0.85)";
    g.fillRect(0, 0, W, W);
    g.strokeStyle = "rgba(255,255,255,0.12)";
    for (const v of [-100, 0, 100]) {
      g.beginPath();
      g.moveTo(px(v), 0);
      g.lineTo(px(v), W);
      g.moveTo(0, px(v));
      g.lineTo(W, px(v));
      g.stroke();
    }
    g.globalCompositeOperation = "lighter";
    for (const [x, z, held] of trail) {
      const grad = g.createRadialGradient(px(x), px(z), 0, px(x), px(z), 6);
      grad.addColorStop(0, held ? "rgba(255,194,58,0.55)" : "rgba(255,90,58,0.28)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(px(x) - 6, px(z) - 6, 12, 12);
    }
    g.globalCompositeOperation = "source-over";
  }

  /** The server's XP for a Free For All match arrived after its results went up. */
  updateFfaRank(r: FfaResultView): void {
    const el = this.root.querySelector<HTMLElement>("[data-rank-line]");
    if (!el || !r.online) return;
    el.innerHTML = rankLine(r);
    translateTree(el);
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

  settings(s: Settings, tab: string, from: "lobby" | "pause", tierNote: string, confirmReset = false, ads = true): void {
    const sw = (key: keyof Settings, label: string, sub = "") => `
      <label class="row-set"><span class="lbl"><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span>
        <span class="switch"><input type="checkbox" data-act="toggle" data-key="${key}" ${s[key] ? "checked" : ""} /><i></i></span></label>`;
    const seg = (key: string, cur: string, opts: [string, string][]) =>
      `<span class="seg">${opts.map(([v, l]) => `<button class="${cur === v ? "on" : ""}" data-act="set" data-key="${key}" data-val="${v}">${l}</button>`).join("")}</span>`;
    const RANGE: Record<RangeKey, [number, number]> = { sensH: [5, 100], sensV: [5, 100], stickOpacity: [30, 100], sens: [50, 200], master: [0, 100], musicVol: [0, 100], sfxVol: [0, 100], adsVol: [0, 100], lookAccel: [0, 300] };
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
      body = `<div class="row-set"><span class="lbl"><b>Quality</b><small>${esc(tierNote)}</small></span>${seg("graphics", s.graphics, [["auto", "Auto"], ["low", "Low"], ["medium", "Med"], ["high", "High"], ["max", "Max"]])}</div>
        <div class="row-set"><span class="lbl"><b>Light / dark mode</b><small>Light: full daylight, street lights off. Dark: full night, street lights and neon on</small></span>${seg("lightMode", s.lightMode, [["auto", "Map"], ["light", "Light"], ["dark", "Dark"]])}</div>
        ${sw("rotate", "Rotate the game", "Turns the game on its side, for landscape with rotation lock on")}
        ${sw("dataSaver", "Data saver", "Half the updates from the server online. Others look a touch less smooth")}
        <p class="note" style="margin-top:10px">Low: no shadows, 2D clouds, lightest on battery, 30 fps on menus. Medium: shadows, sharper people and textures. High: full shadows, volumetric clouds, real reflections in puddles, glow and colour grading. Max: High plus ambient occlusion, god rays, depth of field when aiming, reflections on helmets and metal, for strong phones and computers. Auto picks for your phone and adjusts the sharpness as you play.</p>`;
    } else if (tab === "audio") {
      body = `${range("master", "Master volume", "Everything")}
        ${sw("music", "Music", FEATURES.ballHaunt ? "Songs and the car radio. The warning hum still plays when off" : "Songs and the car radio")}
        ${range("musicVol", "Music volume", "Songs and the car radio", !s.music)}
        ${sw("sound", "Sound effects")}
        ${range("sfxVol", "Sound effects volume", "Lasers, hits, footsteps, the drum", !s.sound)}
        ${ads ? `${sw("adsAudio", "Ads audio", "Sound from a billboard's film, when its advertiser allows it. Off: always silent")}
        ${range("adsVol", "Ads volume", "Billboard films", !s.adsAudio)}` : ""}
        ${sw("haptics", "Vibration")}
        <label class="row-set off"><span class="lbl"><b>Voice chat</b><small>Not available: games in Lagos Life have no microphone. Use text chat and quick chat</small></span><span class="switch"><input type="checkbox" disabled /><i></i></span></label>
        <div class="row-set off"><span class="lbl"><b>Voice chat volume</b><small>Not available</small></span><input class="slider" type="range" min="0" max="100" value="0" disabled aria-label="Voice chat volume" /></div>`;
    } else if (tab === "controls") {
      const preset = Object.entries(LOOK_PRESETS).find(([, [v, acc]]) => Math.abs(s.sens - v) < 0.005 && Math.abs(s.lookAccel - acc) < 0.005)?.[0] ?? "";
      body = `<p class="note" style="margin:0 0 8px">Look: drag anywhere on the ${s.leftHanded ? "left" : "right"} half. The camera turns as far as your thumb travels, more for a quick flick. Nothing re-centres.</p>
        <div class="row-set"><span class="lbl"><b>Look feel</b><small>Precise: slow and steady. Classic: the default. Fast: quick flicks turn round. Linear: no acceleration</small></span>${seg("lookPreset", preset, [["precise", "Precise"], ["classic", "Classic"], ["fast", "Fast"], ["linear", "Linear"]])}</div>
        ${range("sens", "Camera sensitivity", "Both look speeds together")}
        ${range("sensH", "Horizontal sensitivity", "Looking sideways. Lower is calmer")}
        ${range("sensV", "Vertical sensitivity", "Looking up and down. Lower is calmer")}
        ${range("lookAccel", "Acceleration", "How much a quick flick turns on top. 0: the same for any speed")}
        <div class="row-set"><span class="lbl"><b>Dead zone</b><small>How far a finger moves before the camera turns, so a tap stays a tap</small></span><input class="slider" type="range" min="0" max="12" step="1" value="${s.lookDead}" data-act="range" data-key="lookDead" aria-label="Dead zone" /><span class="num pct" data-pct="lookDead">${s.lookDead} px</span></div>
        ${sw("lookDot", "Show touch point", "A faint circle under your look finger. Off: nothing drawn")}
        ${sw("autoFire", "Auto-shoot", "Fires by itself when the crosshair is on an enemy. Off: you press FIRE")}
        ${sw("fireAim", "Aim while firing", "A drag that starts on the fire button also turns the camera")}
        ${sw("invertY", "Invert Y axis", "Drag up to look down")}
        <div class="row-set"><span class="lbl"><b>Move stick</b><small>Fixed: always in the corner. Floating: appears where your thumb lands</small></span>${seg("moveStick", s.moveStick, [["fixed", "Fixed"], ["float", "Floating"]])}</div>
        <div class="row-set"><span class="lbl"><b>Stick size</b></span>${seg("stickSize", s.stickSize, [["small", "Small"], ["medium", "Medium"], ["large", "Large"]])}</div>
        ${range("stickOpacity", "Stick opacity", "How solid the move stick looks")}
        ${sw("leftHanded", "Left-handed", "Move on the right, look on the left")}
        <div class="row-set"><span class="lbl"><b>Arrange the buttons</b><small>Drag every button where you want it and resize it. Saved for landscape and portrait apart</small></span><span class="seg"><button data-act="arrange-ctl">Arrange</button><button data-act="arrange-reset">Reset</button></span></div>
        <div class="row-set"><span class="lbl"><b>Sprint</b><small>Toggle: tap on, tap off. Hold: sprint while held. Auto: a full push sprints</small></span>${seg("sprintMode", s.sprintMode, [["toggle", "Toggle"], ["hold", "Hold"], ["auto", "Auto"]])}</div>
        <div class="row-set"><span class="lbl"><b>Mouse</b><small>Computer: click to take the mouse (Esc gives it back), or drag as a stick</small></span>${seg("mouseLook", s.mouseLook, [["lock", "Mouse look"], ["stick", "Joystick"]])}</div>
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
  settingPct(key: string, pct: number, unit = "%"): void {
    const el = this.root.querySelector<HTMLElement>(`[data-pct="${key}"]`);
    if (el) el.textContent = `${pct}${unit}`;
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
         <div class="pm-xp" data-rank-line>${rankLine(r)}</div>
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

  /** The server's word on this round's XP arrived after the results went up: redraw that line. */
  updateRankLine(r: ResultInfo): void {
    const el = this.root.querySelector<HTMLElement>("[data-rank-line]");
    if (!el) return;
    el.innerHTML = rankLine(r);
    translateTree(el);
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

  /**
   * The match loading screen (SPEC-V3 §12, Brief 1): your squad's cards (or you
   * alone in a run) over the 3D people on the stage behind, a map card with
   * the mode and its one-line goal, and a route sign that fills as the
   * world builds. A radio line. Free For All in amber, Dead
   * Streets red-black with lightning behind.
   */
  matchLoading(s: { kind: "ffa" | "run"; mode: string; goal: string; time: number; map: string; players: { name: string; rank: string; squad: number; me: boolean }[]; best?: number; daily?: string; top?: number[]; drop?: string; kit?: [string, string, string][] }): void {
    // v4 rework: radio chatter in the player's language (English, or Pidgin when chosen); no minibus slang.
    const pcm = getLang() === "pcm";
    const lines = s.kind === "run"
      ? pcm
        ? ["Oya, the Mast dey wait. No waste time o!", "Torch battery na life. No play with am.", "If you hear drum, run go find cover!"]
        : ["Command: the Mast is waiting. Move.", "Watch your torch battery. It's your life.", "Hear the drum? Find cover. Now."]
      : pcm
        ? ["Oya, the flag dey hide for arcade side o!", "Zone don dey close. Shine your eye!", "Na who sharp pass go win today o!"]
        : ["Command: the flag is hidden near the arcade.", "The zone is closing. Eyes open.", "Weapons free. Last squad standing wins.", "Vehicles on the roads. Watch your six."];
    const line = lines[Math.floor(Math.random() * lines.length)];
    const cards = s.players
      .map((p) => `<div class="ld-card ${p.me ? "me" : ""}" style="--sq:${SQUAD_COLORS[p.squad % SQUAD_COLORS.length]}"><span class="bar"></span><b>${esc(p.name)}</b><small>${esc(p.rank)}</small>${p.me ? `<span class="tick">${icon("check", "", 12)}</span>` : ""}</div>`)
      .join("");
    const extra = s.kind === "run"
      ? `${s.best ? `<span class="small">${esc(t("Your best"))}: <b class="num">${fmtTime(s.best)}</b> · ${esc(t("its ghost runs with you"))}</span>` : ""}
         ${s.daily ? `<span class="small">${esc(t("Daily Run"))}: <b>${esc(s.daily)}</b></span>` : ""}
         ${s.top?.length ? `<span class="small">${esc(t("Today's best"))}: ${s.top.slice(0, 3).map((x, i) => `${i + 1}. <b class="num">${fmtTime(x)}</b>`).join(" · ")}</span>` : ""}`
      : "";
    // v4: the drop's name big over its picture (the stage behind), and what you carry in, Field Kit cards.
    const drop = s.drop ? `<div class="ld-drop"><span class="k">${esc(t(s.kind === "run" ? "Tonight" : "Dropping into"))}</span><b>${esc(t(s.drop)).toUpperCase()}</b></div>` : "";
    const kit = s.kit?.length ? `<div class="ld-kit">${s.kit.map(([slot, name, col]) => `<div class="fk-card" style="--c:${col}"><span class="s">${esc(t(slot)).toUpperCase()}</span><span class="n">${esc(t(name)).toUpperCase()}</span></div>`).join("")}</div>` : "";
    this.mount(
      "room",
      `<div class="loadscreen ${s.kind}${s.drop ? " v4" : ""}">
        ${drop}
        <div class="ld-people">${cards}</div>
        <div class="ld-map glass"><span class="label">${esc(s.map)}</span><b class="ld-mode">${esc(s.mode)}</b><span class="small">${esc(s.goal)}</span><span class="small">${Math.round(s.time / 60)} min</span>${extra}${kit}<span class="ld-radio">“${esc(line)}”</span><button class="btn secondary ld-cancel" data-act="leave-room">Cancel</button></div>
        <div class="ld-sign"><span class="ld-route">${["Building world", "Spawning items", s.kind === "run" ? "Waking the dead" : "Syncing players"].map((x, i) => `<i class="stop" style="animation-delay:${i * 1.1}s"></i><span>${esc(t(x))}</span>`).join("")}</span></div>
      </div>`,
    );
  }

  /** A short holding card while the server answers. */
  waiting(text: string): void {
    this.mount(
      "room",
      `<div class="sq-status glass" style="bottom:50%">${esc(text)} · One moment…</div>
       <div class="sq-bar glass"><button class="btn secondary" data-act="leave-room">Cancel</button><button class="btn secondary" data-act="dummy">${icon("hand", "", 16)}Shove the dummy</button></div>`,
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
         <span class="label">${room.kind === "match" && room.stake ? `${naira(room.stake)} each` : room.ffa ? `${esc(BUILTIN_MANIFEST.modes.find((d) => d.id === room.ffa)?.name.en ?? "Free For All")} · ${t("Meridian City")}${room.rk ? ` · ${t("Ranked")}` : ""}` : `${MODE_NAME[room.mode]} · ${room.dist} m`}</span>
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
         <button class="btn secondary" data-act="dummy" aria-label="Shove the practice dummy">${icon("hand", "", 16)}Dummy</button>
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
    if (room.players.length < 2) return room.kind === "private" ? "Share the code. It starts when everyone's ready." : room.ffa ? `Finding players… (${room.players.length}/${room.size})` : "Waiting for more players…";
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
    case "tracksuit":
      return `linear-gradient(90deg, ${main} 0 40%, #efeee9 40% 46%, ${main} 46% 54%, #efeee9 54% 60%, ${main} 60%)`;
    case "adire":
      return `radial-gradient(circle, rgba(200,215,240,0.6) 0 18%, transparent 20%) 0 0 / 10px 10px, #1f2f5c`;
    case "bomber":
      return `linear-gradient(90deg, #4b5530 0 48%, #c46a1c 48% 52%, #4b5530 52%)`;
    case "tactical":
      return `linear-gradient(180deg, ${main} 0 20%, #25231f 20% 80%, ${main} 80%)`;
    case "armour":
      return `linear-gradient(180deg, #3c4045 0 20%, #4a4f55 20% 80%, #3c4045 80%)`;
    case "asooke":
      return `repeating-linear-gradient(180deg, #e8dcc0 0 6px, #8a2b2b 6px 8px, #e8dcc0 8px 14px, #2b4a8a 14px 16px)`;
    case "royal":
      return `radial-gradient(circle at 50% 40%, #d4a017 0 12%, transparent 14%), #3a1f5c`;
    case "titan":
      return `linear-gradient(180deg, #4a4236 0 30%, #d4a017 30% 36%, #5a5040 36%)`;
    default:
      return main;
  }
}
