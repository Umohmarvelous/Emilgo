// Where every game-screen control sits (v4 rework R6; the owner: "placed at
// the bottom center of the screen like cod-style using boxes and rectangular
// shape. Allow players to arrange the game play controls as they want. No
// circles except the aim, fire and the joysticks").
//
// Each control has a default spot (its centre, as a share of the game area's
// width and height, and a size) for landscape and for portrait; left-handed
// mirrors them. A player's own arrangement (Settings → Controls → Arrange
// buttons: drag, resize, reset) is kept per orientation in settings.ctlLayout
// and wins over the defaults. Controls are tagged data-ctl="<id>" and placed
// through three CSS variables (--cx, --cy, --cs), so a press can still scale.
//
// The boxes, by default: two rows along the bottom centre.
//   upper row  fist · slap · push · grab · brace · emote · quick chat · chat
//   lower row  sprint · crouch · jump · reload · backpack · radio (in a car)
//   above them the interact prompt; the weapon panel bottom right (tap: swap)
// The circles: the move stick bottom left, FIRE right, aim (ADS) by it, a
// second FIRE on the left above the stick.
//
// v6 (the owner: "remove every control button by default except the jump,
// sprint, bend, backpack, aim, walk, speed walk, shoot ... allow players to
// remove any control buttons or add any"): only the stick, FIRE, aim, jump,
// sprint, crouch and the backpack show at first (DEFAULT_OFF are hidden; a
// magazine reloads itself when it runs dry). In Arrange buttons each control
// has a switch; the choice is kept in the same settings string (`vis`), for
// both orientations. The stick, the interact prompt and the weapon panel
// always show (they're how you move and what you're holding).

import { gameSize } from "../ui/rotate";
import { icon } from "../ui/icons";

export type CtlId =
  | "move" | "fire" | "fireL" | "ads"
  | "sprint" | "crouch" | "jump" | "reload" | "pack" | "radio"
  | "fist" | "slap" | "push" | "grab" | "brace" | "emote" | "quick" | "chat"
  | "interact" | "weapon";

export interface CtlSpot {
  /** Centre, share of the game area (0..1). */
  x: number;
  y: number;
  /** Size, × the default. */
  s: number;
}

export interface CtlDef {
  id: CtlId;
  name: string;
  icon: string;
  round: boolean;
  /** The size at 1× (px). */
  w: number;
  h: number;
}

/** Box size and the gaps (px at 1×). */
const BW = 46;
const BH = 36;
const GAP = 6;

export const CTLS: readonly CtlDef[] = [
  { id: "move", name: "Move stick", icon: "", round: true, w: 120, h: 120 },
  { id: "fire", name: "Fire", icon: "c-fire", round: true, w: 74, h: 74 },
  { id: "fireL", name: "Fire (left)", icon: "c-fire", round: true, w: 52, h: 52 },
  { id: "ads", name: "Aim down the sights", icon: "c-ads", round: true, w: 50, h: 50 },
  { id: "sprint", name: "Sprint", icon: "c-sprint", round: false, w: BW, h: BH },
  { id: "crouch", name: "Crouch", icon: "c-crouch", round: false, w: BW, h: BH },
  { id: "jump", name: "Jump", icon: "c-jump", round: false, w: BW, h: BH },
  { id: "reload", name: "Reload", icon: "c-reload", round: false, w: BW, h: BH },
  { id: "pack", name: "Backpack", icon: "c-pack", round: false, w: BW, h: BH },
  { id: "radio", name: "Radio", icon: "radio", round: false, w: BW, h: BH },
  { id: "fist", name: "Fist", icon: "fist", round: false, w: BW, h: BH },
  { id: "slap", name: "Slap", icon: "slap", round: false, w: BW, h: BH },
  { id: "push", name: "Push", icon: "push", round: false, w: BW, h: BH },
  { id: "grab", name: "Grab", icon: "grab", round: false, w: BW, h: BH },
  { id: "brace", name: "Brace", icon: "brace", round: false, w: BW, h: BH },
  { id: "emote", name: "Emotes", icon: "c-emote", round: false, w: BW, h: BH },
  { id: "quick", name: "Quick chat", icon: "c-ping", round: false, w: BW, h: BH },
  { id: "chat", name: "Chat", icon: "c-chat", round: false, w: BW, h: BH },
  { id: "interact", name: "Interact", icon: "hand", round: false, w: 150, h: 38 },
  { id: "weapon", name: "Weapon (tap: swap)", icon: "c-fire", round: false, w: 150, h: 54 },
];
export const CTL = Object.fromEntries(CTLS.map((c) => [c.id, c])) as Record<CtlId, CtlDef>;

const UPPER: CtlId[] = ["fist", "slap", "push", "grab", "brace", "emote", "quick", "chat"];
const LOWER: CtlId[] = ["sprint", "crouch", "jump", "reload", "pack", "radio"];

/** v6: hidden until the player adds them in Arrange buttons. */
export const DEFAULT_OFF: ReadonlySet<CtlId> = new Set<CtlId>(["fireL", "reload", "radio", "fist", "slap", "push", "grab", "brace", "emote", "quick", "chat"]);
/** v6: always shown: no switch. */
export const ALWAYS_ON: ReadonlySet<CtlId> = new Set<CtlId>(["move", "interact", "weapon"]);

/** Is this control shown, by the player's choice or the default. */
export function ctlOn(json: string, id: CtlId): boolean {
  if (ALWAYS_ON.has(id)) return true;
  const v = parse(json).vis?.[id];
  return v === undefined ? !DEFAULT_OFF.has(id) : v;
}

/** The defaults for a game area of w × h (px), right-handed; `on`: which controls show (the rows close up round them). */
function defaults(w: number, h: number, on: (id: CtlId) => boolean = (id) => !DEFAULT_OFF.has(id)): Record<CtlId, CtlSpot> {
  const portrait = h > w;
  const out = {} as Record<CtlId, CtlSpot>;
  const at = (id: CtlId, px: number, py: number) => (out[id] = { x: px / w, y: py / h, s: 1 });
  // Two rows of boxes along the bottom centre.
  const rowY = [h - 18 - BH / 2, h - 18 - BH - GAP - BH / 2];
  // A row narrower than the screen: the boxes shrink to fit (a portrait phone).
  const row = (ids: CtlId[], y: number) => {
    const step = Math.min(BW + GAP, (w - 12) / ids.length);
    ids.forEach((id, i) => {
      at(id, w / 2 + (i - (ids.length - 1) / 2) * step, y);
      out[id].s = Math.min(1, step / (BW + GAP));
    });
  };
  // v6: the shown boxes close up into the rows; hidden ones keep a spot in the same rows for when they're added.
  const lower = LOWER.filter(on);
  const upper = UPPER.filter(on);
  const spare = [...LOWER, ...UPPER].filter((id) => !on(id));
  const rows: CtlId[][] = upper.length ? [lower, [...upper, ...spare]] : [lower, spare];
  if (portrait) {
    row(rows[0], rowY[0]);
    if (rows[1].length) row(rows[1], rowY[1]);
    at("move", 24 + 60, rowY[1] - BH / 2 - 26 - 60);
    at("fire", w - 24 - 37, rowY[1] - BH / 2 - 60 - 37);
    at("ads", w - 24 - 37 - 72, rowY[1] - BH / 2 - 60 - 70);
    at("fireL", 24 + 26, rowY[1] - BH / 2 - 210 - 26);
    at("interact", w / 2, rowY[1] - BH / 2 - 150);
    at("weapon", w - 14 - 75, rowY[1] - BH / 2 - 34);
  } else {
    row(rows[0], rowY[0]);
    if (rows[1].length) row(rows[1], rowY[1]);
    at("move", 40 + 60, h - 40 - 60);
    at("fire", w - 92 - 37, h * 0.6);
    at("ads", w - 92 - 37 - 70, h * 0.6 - 62);
    at("fireL", 40 + 60 + 16, h - 40 - 120 - 64);
    at("interact", w / 2, rowY[1] - BH / 2 - 34);
    at("weapon", w - 14 - 75, h - 14 - 27);
  }
  return out;
}

type Saved = { land?: Partial<Record<CtlId, CtlSpot>>; port?: Partial<Record<CtlId, CtlSpot>>; vis?: Partial<Record<CtlId, boolean>> };

function parse(json: string): Saved {
  try {
    const o = JSON.parse(json || "{}") as Saved;
    const clean = (m: unknown) => {
      const r: Partial<Record<CtlId, CtlSpot>> = {};
      if (!m || typeof m !== "object") return r;
      for (const [k, v] of Object.entries(m as Record<string, CtlSpot>)) {
        if (!(k in CTL) || !v) continue;
        const x = Number(v.x);
        const y = Number(v.y);
        const s = Number(v.s);
        if ([x, y, s].every(Number.isFinite)) r[k as CtlId] = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), s: Math.min(1.8, Math.max(0.6, s)) };
      }
      return r;
    };
    const vis: Partial<Record<CtlId, boolean>> = {};
    if (o.vis && typeof o.vis === "object") for (const [k, v] of Object.entries(o.vis)) if (k in CTL && typeof v === "boolean" && !ALWAYS_ON.has(k as CtlId)) vis[k as CtlId] = v;
    return { land: clean(o.land), port: clean(o.port), vis };
  } catch {
    return {};
  }
}

/** Every control's spot now (the player's, else the default), right-handed as saved. */
export function spotsFor(json: string, w: number, h: number): Record<CtlId, CtlSpot> {
  const d = defaults(w, h, (id) => ctlOn(json, id));
  const own = parse(json)[h > w ? "port" : "land"] ?? {};
  for (const id of Object.keys(own) as CtlId[]) d[id] = own[id]!;
  return d;
}

/** Save one orientation's arrangement (null: back to the defaults), and which controls show (null: the defaults). */
export function saveSpots(json: string, portrait: boolean, spots: Partial<Record<CtlId, CtlSpot>> | null, vis?: Partial<Record<CtlId, boolean>> | null): string {
  const o = parse(json);
  if (spots) o[portrait ? "port" : "land"] = spots;
  else delete o[portrait ? "port" : "land"];
  if (vis === null) delete o.vis;
  else if (vis) o.vis = vis;
  return JSON.stringify(o);
}

/** Place every element tagged data-ctl under `root`. */
export function applySpots(root: ParentNode, json: string, lefty: boolean): Record<CtlId, CtlSpot> {
  const g = gameSize();
  const spots = spotsFor(json, g.w, g.h);
  for (const el of root.querySelectorAll<HTMLElement>("[data-ctl]")) {
    const id = el.dataset.ctl as CtlId;
    const s = spots[id];
    // v6: a control the player took off (or one off by default) isn't drawn and can't be pressed.
    el.classList.toggle("ctl-off", !ctlOn(json, id));
    if (!s || id === "move") continue;
    el.style.setProperty("--cx", `${((lefty ? 1 - s.x : s.x) * g.w).toFixed(1)}px`);
    el.style.setProperty("--cy", `${(s.y * g.h).toFixed(1)}px`);
    el.style.setProperty("--cs", String(s.s));
    el.classList.add("ctl", CTL[id].round ? "round" : "box");
  }
  return spots;
}

// ── The editor ─────────────────────────────────────────────────────────────────

/**
 * Arrange the buttons: every control drawn where it is; drag one to move it,
 * tap to pick it, − / + to resize it, its corner switch to add or remove it
 * (v6; removed ones show faded); Reset puts the defaults back; Save keeps
 * the places for this orientation and the switches for both. Resolves with
 * the new settings string (or null: cancelled).
 */
export function editSpots(host: HTMLElement, json: string, lefty: boolean): Promise<string | null> {
  return new Promise((done) => {
    const g = gameSize();
    const portrait = g.h > g.w;
    let spots = spotsFor(json, g.w, g.h);
    const vis: Partial<Record<CtlId, boolean>> = {};
    for (const d of CTLS) if (!ALWAYS_ON.has(d.id)) vis[d.id] = ctlOn(json, d.id);
    const wrap = document.createElement("div");
    wrap.className = "ctl-editor";
    wrap.innerHTML = `<div class="ce-bar">
        <b>Arrange the buttons</b><small>${portrait ? "Portrait" : "Landscape"} · drag to move, tap then − / + to resize, the corner to add or remove</small>
        <span class="grow"></span>
        <button class="ce-b" data-ce="smaller" aria-label="Smaller">−</button><button class="ce-b" data-ce="bigger" aria-label="Bigger">+</button>
        <button class="ce-b" data-ce="reset">Reset</button><button class="ce-b" data-ce="cancel">Cancel</button><button class="ce-b ce-save" data-ce="save">Save</button>
      </div>`;
    const els = new Map<CtlId, HTMLElement>();
    let picked: CtlId | null = null;
    const place = () => {
      for (const [id, el] of els) {
        const s = spots[id];
        const d = CTL[id];
        el.style.left = `${(lefty ? 1 - s.x : s.x) * g.w}px`;
        el.style.top = `${s.y * g.h}px`;
        el.style.width = `${d.w * s.s}px`;
        el.style.height = `${d.h * s.s}px`;
        el.classList.toggle("picked", id === picked);
        el.classList.toggle("off", vis[id] === false);
        const x = el.querySelector<HTMLElement>(".ce-x");
        if (x) {
          x.textContent = vis[id] === false ? "+" : "×";
          x.setAttribute("aria-label", `${vis[id] === false ? "Add" : "Remove"} ${CTL[id].name}`);
        }
      }
    };
    for (const d of CTLS) {
      const el = document.createElement("div");
      el.className = `ce-ctl ${d.round ? "round" : "box"}`;
      el.innerHTML = `${d.icon ? icon(d.icon, "", d.round ? 24 : 20) : `<i class="ce-dot"></i>`}<span>${d.name}</span>`;
      if (!ALWAYS_ON.has(d.id)) {
        // v6: the switch: × takes the control off the screen, + puts it back.
        const x = document.createElement("button");
        x.className = "ce-x";
        x.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          vis[d.id] = vis[d.id] === false;
          picked = d.id;
          place();
        });
        el.append(x);
      }
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        picked = d.id;
        el.setPointerCapture(e.pointerId);
        const sx = e.clientX;
        const sy = e.clientY;
        const s0 = { ...spots[d.id] };
        const move = (ev: PointerEvent) => {
          const dx = (ev.clientX - sx) / g.w;
          const dy = (ev.clientY - sy) / g.h;
          spots[d.id] = { ...s0, x: Math.min(0.99, Math.max(0.01, s0.x + (lefty ? -dx : dx))), y: Math.min(0.99, Math.max(0.01, s0.y + dy)) };
          place();
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
        place();
      });
      els.set(d.id, el);
      wrap.append(el);
    }
    const finish = (out: string | null) => {
      wrap.remove();
      done(out);
    };
    wrap.querySelector(".ce-bar")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ce]");
      if (!b) return;
      const a = b.dataset.ce;
      if (a === "smaller" || a === "bigger") {
        if (!picked) return;
        const s = spots[picked];
        spots[picked] = { ...s, s: Math.min(1.8, Math.max(0.6, s.s + (a === "bigger" ? 0.1 : -0.1))) };
        place();
      } else if (a === "reset") {
        for (const d of CTLS) if (!ALWAYS_ON.has(d.id)) vis[d.id] = !DEFAULT_OFF.has(d.id);
        spots = defaults(g.w, g.h);
        picked = null;
        place();
      } else if (a === "cancel") finish(null);
      else if (a === "save") {
        // Only what differs from the defaults is kept, so a later change to the defaults still reaches this player.
        const diff: Partial<Record<CtlId, boolean>> = {};
        for (const [id, v] of Object.entries(vis) as [CtlId, boolean][]) if (v === DEFAULT_OFF.has(id)) diff[id] = v;
        finish(saveSpots(json, portrait, spots, Object.keys(diff).length ? diff : null));
      }
    });
    place();
    host.append(wrap);
  });
}
