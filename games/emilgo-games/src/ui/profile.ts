// The profile on screen (v6 max, 3.11): your own (every stat, the awards, the
// history, what's public, your messages), another player's public card, and a
// direct-message thread with a friend. HTML for Screens' sheets; the rules are
// social/profile.ts and rank/awards.ts.

import type { WireCard } from "../net/protocol";
import { AWARDS, AWARD_BY_ID, badgeCount, shown, type AwardState } from "../rank/awards";
import { divisionStart, rankOf } from "../rank/ladder";
import type { DmThread, MatchRecord } from "../social/profile";
import { awardTitle, badgeEmblem, emblem } from "./awards";
import { esc, fmtTime } from "./dom";
import { t } from "./i18n";
import { icon } from "./icons";

export interface ProfileView {
  name: string;
  rank: { name: string; into: number; need: number; top: boolean; saved: boolean };
  awards: AwardState;
  history: readonly MatchRecord[];
  cp: number;
  honour: number;
  honourTitle: string | null;
  form: string;
  streak: number;
  runBest: number;
  /** Friends with a thread or on the list: name, state, unread. */
  inbox: { fid: string; name: string; on: boolean; unread: number; last: string }[];
  dmsOn: boolean;
  cardPublic: boolean;
  online: boolean;
}

/** A rank division's name ("Pro II") from its index. */
export function divisionName(k: number): string {
  return rankOf(divisionStart(Math.max(0, k))).name;
}

function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 90) return t("just now");
  if (s < 3600) return `${Math.round(s / 60)} ${t("min ago")}`;
  if (s < 86400) return `${Math.round(s / 3600)} ${t("h ago")}`;
  return `${Math.round(s / 86400)} ${t("d ago")}`;
}

function stat(label: string, value: string | number, sub = ""): string {
  return `<div class="pf-stat"><b class="num">${typeof value === "number" ? value.toLocaleString() : esc(value)}</b><span>${esc(t(label))}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
}

/** Your own profile. */
export function profileBody(p: ProfileView): string {
  const a = p.awards;
  const st = a.stats;
  const winRate = st.matches ? Math.round((st.wins / st.matches) * 100) : 0;
  const { got, all } = badgeCount(a);
  const worn = a.wear ? a.got[a.wear] ?? 0 : 0;
  // The best badges: highest steps first, then the achievements.
  const best = AWARDS.filter((d) => (a.got[d.id] ?? 0) > 0)
    .sort((x, y) => (a.got[y.id] ?? 0) * (y.stat ? 1 : 2.5) - (a.got[x.id] ?? 0) * (x.stat ? 1 : 2.5))
    .slice(0, 8)
    .map((d) => `<span class="pf-emb" title="${esc(awardTitle(d.id, a.got[d.id]))}">${emblem(d.id, a.got[d.id], 34)}</span>`)
    .join("");
  const hist = p.history.length
    ? p.history
        .map(
          (h) => `<li class="li pf-h ${h.won ? "w" : ""}"><span class="pf-res">${h.won ? "W" : h.place > 0 ? `#${h.place}` : "—"}</span><span class="grow"><b>${esc(t(h.mode))}</b><small>${[h.place > 0 ? `${h.place} / ${h.sides}` : "", h.kills ? `${h.kills} ${esc(t("kills"))}` : "", esc(t(h.online ? "online" : "practice"))].filter(Boolean).join(" · ")}</small></span><span class="pf-cp">${h.cp ? `+${h.cp} CP` : ""}<small>${esc(ago(h.at))}</small></span></li>`,
        )
        .join("")
    : `<li class="li"><span class="grow"><b>${esc(t("No matches yet"))}</b><small>${esc(t("Your last 30 matches show here."))}</small></span></li>`;
  const unread = p.inbox.reduce((s, x) => s + x.unread, 0);
  return `<div class="pf-head">
      <span class="avatar pf-av">${esc(p.name.trim().charAt(0).toUpperCase() || "?")}</span>
      <span class="grow"><b class="pf-name">${esc(p.name)}</b>
        <span class="pf-rank"><b>${esc(p.rank.name.toUpperCase())}</b>${p.rank.saved ? "" : ` <small>(${esc(t("this device"))})</small>`}</span>
        <span class="aw-bar"><i style="width:${p.rank.top ? 100 : Math.round((p.rank.into / Math.max(1, p.rank.need)) * 100)}%"></i></span>
        <small class="num">${p.rank.into.toLocaleString()} / ${p.rank.need.toLocaleString()} XP${p.honourTitle ? ` · ${esc(t(p.honourTitle))}` : ""}</small></span>
      ${worn ? emblem(a.wear, worn, 48) : ""}
    </div>
    <div class="pf-acts">
      <button class="btn secondary" data-act="customize">${icon("customize", "", 16)}${esc(t("Customize"))}</button>
      <button class="btn secondary" data-act="inbox">${icon("chat", "", 16)}${esc(t("Messages"))}${unread ? ` <i class="dot-badge">${unread > 9 ? "9+" : unread}</i>` : ""}</button>
      <button class="btn secondary" data-act="awards">${icon("medal", "", 16)}${esc(t("Awards"))}</button>
    </div>
    <div class="label" style="margin:14px 0 8px">${esc(t("Stats"))}</div>
    <div class="pf-stats">
      ${stat("Matches", st.matches)}${stat("Wins", st.wins, `${winRate}%`)}${stat("Top three", st.podiums)}${stat("Kills", st.kills)}
      ${stat("Head shots", st.heads, st.kills ? `${Math.round((st.heads / st.kills) * 100)}%` : "")}${stat("Treasures", st.treasures)}${stat("Crates", st.crates)}${stat("Items used", st.items)}
      ${stat("Knock-downs", st.downs)}${stat("Swum", `${shown(AWARD_BY_ID.swimmer, st.swum).toLocaleString()} m`)}${stat("Played", `${Math.floor(st.seconds / 3600)} h ${Math.floor((st.seconds % 3600) / 60)} m`)}${stat("CP", p.cp)}
      ${stat("Commends", p.honour)}${stat("Best streak now", p.streak)}${stat("Runs to the Mast", st.runs)}${stat("Best run", p.runBest ? fmtTime(p.runBest) : "—")}
    </div>
    ${p.form ? `<div class="pf-form">${esc(t("Form"))} <b>${[...p.form].map((x) => `<i class="${x === "W" ? "w" : "l"}">${x}</i>`).join("")}</b></div>` : ""}
    <div class="label" style="margin:14px 0 8px">${esc(t("Awards"))} · <span class="num">${got} / ${all}</span></div>
    <button class="pf-awards" data-act="awards">${best || `<span class="small">${esc(t("Play matches to reach your first badges."))}</span>`}${icon("next", "", 16)}</button>
    <div class="label" style="margin:14px 0 8px">${esc(t("History"))}</div>
    <ul class="list pf-hist">${hist}</ul>
    <div class="label" style="margin:14px 0 8px">${esc(t("Privacy"))}</div>
    <div class="pf-priv">
      <button class="md" data-act="pf-public">${icon("eye", "", 18)}<span class="grow"><b>${esc(t("Public card"))}: ${esc(t(p.cardPublic ? "On" : "Off"))}</b><small>${esc(t(p.cardPublic ? "Players who open your profile see your rank, badge and match numbers." : "Players who open your profile see only your name, rank and badge."))}</small></span></button>
      <button class="md" data-act="pf-dms">${icon("chat", "", 18)}<span class="grow"><b>${esc(t("Messages from friends"))}: ${esc(t(p.dmsOn ? "On" : "Off"))}</b><small>${esc(t("Only friends who list you back can message you; strangers never can. Numbers, links and addresses are removed."))}</small></span></button>
    </div>`;
}

/** The inbox: friends you have messages with, and the rest of your friends to start one. */
export function inboxBody(p: Pick<ProfileView, "inbox" | "online" | "dmsOn">): string {
  if (!p.inbox.length) return `<p class="note">${esc(t("Add friends first (Friends → Recent players, or tap a name in a room). Then message them here."))}</p>`;
  const rows = p.inbox
    .map(
      (f) => `<li class="li" data-act="dm-open" data-fid="${esc(f.fid)}" role="button" tabindex="0"><i class="dot ${f.on ? "on" : ""}"></i><span class="grow"><b>${esc(f.name)}</b><small>${esc(f.last || t(f.on ? "Online" : "Offline"))}</small></span>${f.unread ? `<i class="dot-badge pf-unread">${f.unread > 9 ? "9+" : f.unread}</i>` : ""}${icon("next", "", 14)}</li>`,
    )
    .join("");
  return `${p.online ? "" : `<div class="status">${esc(t("Messages need the game server. You can read what's here."))}</div>`}
    ${p.dmsOn ? "" : `<div class="status">${esc(t("Your messages are off (Profile → Privacy): friends can't reach you."))}</div>`}
    <ul class="list">${rows}</ul>
    <p class="note" style="margin-top:10px">${esc(t("Messages are kept on this phone. A friend who is off gets yours when they come on (within a day)."))}</p>`;
}

/** A thread with a friend. */
export function threadBody(fid: string, th: DmThread | undefined, on: boolean): string {
  const lines = (th?.lines ?? [])
    .map(
      (l) => `<div class="dm-l ${l.me ? "me" : ""}${l.fail ? " fail" : ""}"><span>${esc(l.text)}</span><small>${esc(new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}${l.me ? (l.fail ? ` · ${esc(t(l.fail))}` : l.held ? ` · ${esc(t("waiting for them"))}` : l.n !== undefined ? " · …" : ` · ${esc(t("sent"))}`) : ""}</small></div>`,
    )
    .join("");
  return `<div class="dm-top"><i class="dot ${on ? "on" : ""}"></i><span class="grow small">${esc(t(on ? "Online" : "Offline: they'll get it when they come on"))}</span>
      <button class="mini" data-act="dm-card" data-fid="${esc(fid)}">${icon("user", "", 13)}${esc(t("Profile"))}</button>
      <button class="mini" data-act="dm-report" data-fid="${esc(fid)}">${icon("info", "", 13)}${esc(t("Report"))}</button>
      <button class="mini danger" data-act="dm-block" data-fid="${esc(fid)}">${icon("close", "", 13)}${esc(t("Block"))}</button></div>
    <div class="dm-log" data-dm-log>${lines || `<p class="note">${esc(t("Say hello. Be kind: numbers, links and addresses are removed for everyone's safety."))}</p>`}</div>
    <form class="dm-form" data-fid="${esc(fid)}"><input data-dm-input maxlength="120" autocomplete="off" enterkeyhint="send" placeholder="${esc(t("Message"))}" aria-label="${esc(t("Message"))}"><button type="button" class="btn primary" data-act="dm-send" data-fid="${esc(fid)}" aria-label="${esc(t("Send"))}">${icon("send", "", 16)}</button></form>`;
}

/** Another player's public card. */
export function cardBody(name: string, c: WireCard | null): string {
  if (!c) return `<p class="note">${esc(t("Their card isn't available right now (they may have left)."))}</p>`;
  const rate = c.m ? Math.round((c.w / c.m) * 100) : 0;
  return `<div class="pf-head">
      <span class="avatar pf-av">${esc(name.trim().charAt(0).toUpperCase() || "?")}</span>
      <span class="grow"><b class="pf-name">${esc(name)}</b><span class="pf-rank"><b>${esc(divisionName(c.r).toUpperCase())}</b></span>
      ${c.f ? `<span class="pf-form">${esc(t("Form"))} <b>${[...c.f].map((x) => `<i class="${x === "W" ? "w" : "l"}">${x}</i>`).join("")}</b></span>` : ""}</span>
      ${c.aw ? badgeEmblem(c.aw, 48) : ""}
    </div>
    ${
      c.p
        ? `<p class="note">${esc(t("This player keeps their numbers private."))}</p>`
        : `<div class="pf-stats">${stat("Matches", c.m)}${stat("Wins", c.w, `${rate}%`)}${stat("Kills", c.k)}${stat("Head shots", c.hs)}${stat("Badges", c.b)}${stat("Commends", c.h)}</div>`
    }`;
}
