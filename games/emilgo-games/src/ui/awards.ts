// The awards on screen (v6 max, 3.10): the emblem (a hexagon in its step's
// metal: bronze, silver, gold, a shimmering diamond, the award's own icon in
// it), the Awards sheet (the milestones with their bars, the achievements),
// and the row the results card gets when a match reached something. Our own
// drawings; the rules are rank/awards.ts.

import { AWARD_BY_ID, AWARD_TIERS, AWARDS, badgeCount, parseBadge, shown, stepOf, type AwardState, type Unlock } from "../rank/awards";
import { esc } from "./dom";
import { t } from "./i18n";
import { icon } from "./icons";

/** An award's emblem at a step (0: not reached, drawn dark). */
export function emblem(id: string, tier: number, size = 40, cls = ""): string {
  const def = AWARD_BY_ID[id];
  // An achievement is one step: gold when reached.
  const k = def && !def.stat && tier > 0 ? 3 : Math.max(0, Math.min(4, Math.floor(tier)));
  return `<span class="emb ${k ? `t${k}` : "off"} ${cls}" style="--es:${size}px" aria-hidden="true">${icon(def?.icon ?? "medal", "", Math.round(size * 0.48))}</span>`;
}

/** A worn badge from the wire ("veteran.3"), as an emblem; "" for none or a bad one. */
export function badgeEmblem(wire: string | undefined, size = 18, cls = ""): string {
  const b = parseBadge(wire);
  return b ? emblem(b[0].id, b[1], size, cls) : "";
}

/** "Veteran · Gold", "Rampage". */
export function awardTitle(id: string, tier: number): string {
  const def = AWARD_BY_ID[id];
  if (!def) return "";
  return def.stat ? `${t(def.name)} · ${t(AWARD_TIERS[Math.max(0, tier - 1)])}` : t(def.name);
}

/** The results card's row: what this match reached, and the CP it paid. */
export function unlockedHtml(list: readonly Unlock[]): string {
  if (!list.length) return "";
  const cp = list.reduce((a, u) => a + u.cp, 0);
  const items = list
    .slice(0, 6)
    .map((u) => `<span class="aw-new">${emblem(u.id, u.tier, 34, "pop")}<span><b>${esc(awardTitle(u.id, u.tier))}</b><small>${esc(t(AWARD_BY_ID[u.id]?.blurb ?? ""))}</small></span></span>`)
    .join("");
  return `<div class="pm-awards"><span class="label">${esc(t("Awards unlocked"))} · <b>+${cp} CP</b></span><div class="aw-list">${items}</div>${list.length > 6 ? `<span class="small">+${list.length - 6} ${esc(t("more in Awards"))}</span>` : ""}</div>`;
}

/** The Awards sheet's body. */
export function awardsBody(s: AwardState): string {
  const { got, all } = badgeCount(s);
  const worn = s.wear ? s.got[s.wear] ?? 0 : 0;
  const head = `<div class="aw-head">
      ${worn ? emblem(s.wear, worn, 56) : emblem("veteran", 0, 56)}
      <span class="grow"><b>${worn ? esc(awardTitle(s.wear, worn)) : esc(t("No badge worn"))}</b>
        <small>${esc(t("Your worn badge shows on your profile card, beside your name. Never on your body in a match."))}</small>
        <span class="aw-bar"><i style="width:${Math.round((got / Math.max(1, all)) * 100)}%"></i></span>
        <small class="num">${got} / ${all} ${esc(t("badges"))}</small></span>
      ${worn ? `<button class="btn secondary" data-act="award-wear" data-id="">${esc(t("Take off"))}</button>` : ""}
    </div>`;
  const wear = (id: string) =>
    s.wear === id ? `<span class="aw-on">${icon("check", "", 12)}${esc(t("Worn"))}</span>` : `<button class="mini" data-act="award-wear" data-id="${id}">${esc(t("Wear"))}</button>`;
  const miles = AWARDS.filter((d) => d.stat)
    .map((d) => {
      const n = s.stats[d.stat!] ?? 0;
      const k = s.got[d.id] ?? stepOf(d, n);
      const next = k < 4 ? d.steps![k] : d.steps![3];
      const from = k > 0 ? d.steps![k - 1] : 0;
      const pct = k >= 4 ? 100 : Math.round(Math.max(0, Math.min(1, (n - from) / Math.max(1, next - from))) * 100);
      const unit = d.unit === "h" ? " h" : d.unit === "m" ? " m" : "";
      const pips = [1, 2, 3, 4].map((i) => `<i class="${i <= k ? `t${i}` : ""}"></i>`).join("");
      return `<div class="aw-row${s.fresh.includes(d.id) ? " fresh" : ""}">
        ${emblem(d.id, k, 40)}
        <span class="grow"><b>${esc(t(d.name))}${k ? ` <small>${esc(t(AWARD_TIERS[k - 1]))}</small>` : ""}</b>
          <small>${esc(t(d.blurb))}</small>
          <span class="aw-bar"><i style="width:${pct}%"></i></span>
          <small class="num">${shown(d, n).toLocaleString()}${k < 4 ? ` / ${shown(d, next).toLocaleString()}` : ""}${unit}</small></span>
        <span class="aw-side"><span class="aw-pips">${pips}</span>${k ? wear(d.id) : ""}</span>
      </div>`;
    })
    .join("");
  const feats = AWARDS.filter((d) => !d.stat)
    .map((d) => {
      const k = s.got[d.id] ?? 0;
      return `<div class="aw-tile${k ? "" : " locked"}${s.fresh.includes(d.id) ? " fresh" : ""}">
        ${emblem(d.id, k, 40)}<b>${esc(t(d.name))}</b><small>${esc(t(d.blurb))}</small>${k ? wear(d.id) : `<span class="aw-lock">${icon("lock", "", 12)}</span>`}
      </div>`;
    })
    .join("");
  return `${head}
    <div class="label" style="margin:14px 0 8px">${esc(t("Milestones"))}</div>
    <div class="aw-rows">${miles}</div>
    <div class="label" style="margin:14px 0 8px">${esc(t("Achievements"))}</div>
    <div class="aw-grid">${feats}</div>
    <p class="note" style="margin-top:12px">${esc(t("Every badge pays CP once, the moment you reach it. Matches left in the first minute count nothing."))}</p>`;
}
