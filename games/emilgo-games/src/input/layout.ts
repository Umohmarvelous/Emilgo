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
  { id: "fire", name: "Fire", icon: "shoot", round: true, w: 74, h: 74 },
  { id: "fireL", name: "Fire (left)", icon: "shoot", round: true, w: 52, h: 52 },
  { id: "ads", name: "Aim down the sights", icon: "sight", round: true, w: 50, h: 50 },
  { id: "sprint", name: "Sprint", icon: "sprint", round: false, w: BW, h: BH },
  { id: "crouch", name: "Crouch", icon: "crouch", round: false, w: BW, h: BH },
  { id: "jump", name: "Jump", icon: "jump", round: false, w: BW, h: BH },
  { id: "reload", name: "Reload", icon: "reload", round: false, w: BW, h: BH },
  { id: "pack", name: "Backpack", icon: "pack", round: false, w: BW, h: BH },
  { id: "radio", name: "Radio", icon: "radio", round: false, w: BW, h: BH },
  { id: "fist", name: "Fist", icon: "fist", round: false, w: BW, h: BH },
  { id: "slap", name: "Slap", icon: "slap", round: false, w: BW, h: BH },
  { id: "push", name: "Push", icon: "push", round: false, w: BW, h: BH },
  { id: "grab", name: "Grab", icon: "grab", round: false, w: BW, h: BH },
  { id: "brace", name: "Brace", icon: "brace", round: false, w: BW, h: BH },
  { id: "emote", name: "Emotes", icon: "emote", round: false, w: BW, h: BH },
  { id: "quick", name: "Quick chat", icon: "ping", round: false, w: BW, h: BH },
  { id: "chat", name: "Chat", icon: "chat", round: false, w: BW, h: BH },
  { id: "interact", name: "Interact", icon: "hand", round: false, w: 150, h: 38 },
  { id: "weapon", name: "Weapon (tap: swap)", icon: "shoot", round: false, w: 150, h: 54 },
];
export const CTL = Object.fromEntries(CTLS.map((c) => [c.id, c])) as Record<CtlId, CtlDef>;

const UPPER: CtlId[] = ["fist", "slap", "push", "grab", "brace", "emote", "quick", "chat"];
const LOWER: CtlId[] = ["sprint", "crouch", "jump", "reload", "pack", "radio"];

/** The defaults for a game area of w × h (px), right-handed. */
function defaults(w: number, h: number): Record<CtlId, CtlSpot> {
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
  if (portrait) {
    row(LOWER, rowY[0]);
    row(UPPER, rowY[1]);
    at("move", 24 + 60, rowY[1] - BH / 2 - 26 - 60);
    at("fire", w - 24 - 37, rowY[1] - BH / 2 - 60 - 37);
    at("ads", w - 24 - 37 - 72, rowY[1] - BH / 2 - 60 - 70);
    at("fireL", 24 + 26, rowY[1] - BH / 2 - 210 - 26);
    at("interact", w / 2, rowY[1] - BH / 2 - 150);
    at("weapon", w - 14 - 75, rowY[1] - BH / 2 - 34);
  } else {
    row(LOWER, rowY[0]);
    row(UPPER, rowY[1]);
    at("move", 40 + 60, h - 40 - 60);
    at("fire", w - 92 - 37, h * 0.6);
    at("ads", w - 92 - 37 - 70, h * 0.6 - 62);
    at("fireL", 40 + 60 + 16, h - 40 - 120 - 64);
    at("interact", w / 2, rowY[1] - BH / 2 - 34);
    at("weapon", w - 14 - 75, h - 14 - 27);
  }
  return out;
}

type Saved = { land?: Partial<Record<CtlId, CtlSpot>>; port?: Partial<Record<CtlId, CtlSpot>> };

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
    return { land: clean(o.land), port: clean(o.port) };
  } catch {
    return {};
  }
}

/** Every control's spot now (the player's, else the default), right-handed as saved. */
export function spotsFor(json: string, w: number, h: number): Record<CtlId, CtlSpot> {
  const d = defaults(w, h);
  const own = parse(json)[h > w ? "port" : "land"] ?? {};
  for (const id of Object.keys(own) as CtlId[]) d[id] = own[id]!;
  return d;
}

/** Save one orientation's arrangement (null: back to the defaults). */
export function saveSpots(json: string, portrait: boolean, spots: Partial<Record<CtlId, CtlSpot>> | null): string {
  const o = parse(json);
  if (spots) o[portrait ? "port" : "land"] = spots;
  else delete o[portrait ? "port" : "land"];
  return JSON.stringify(o);
}

/** Place every element tagged data-ctl under `root`. */
export function applySpots(root: ParentNode, json: string, lefty: boolean): Record<CtlId, CtlSpot> {
  const g = gameSize();
  const spots = spotsFor(json, g.w, g.h);
  for (const el of root.querySelectorAll<HTMLElement>("[data-ctl]")) {
    const id = el.dataset.ctl as CtlId;
    const s = spots[id];
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
 * tap to pick it, − / + to resize it; Reset puts the defaults back; Save keeps
 * it for this orientation. Resolves with the new settings string (or null:
 * cancelled).
 */
export function editSpots(host: HTMLElement, json: string, lefty: boolean): Promise<string | null> {
  return new Promise((done) => {
    const g = gameSize();
    const portrait = g.h > g.w;
    let spots = spotsFor(json, g.w, g.h);
    const wrap = document.createElement("div");
    wrap.className = "ctl-editor";
    wrap.innerHTML = `<div class="ce-bar">
        <b>Arrange the buttons</b><small>${portrait ? "Portrait" : "Landscape"} · drag to move, tap then − / + to resize</small>
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
      }
    };
    for (const d of CTLS) {
      const el = document.createElement("div");
      el.className = `ce-ctl ${d.round ? "round" : "box"}`;
      el.innerHTML = `${d.icon ? icon(d.icon, "", d.round ? 24 : 20) : `<i class="ce-dot"></i>`}<span>${d.name}</span>`;
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
        spots = defaults(g.w, g.h);
        picked = null;
        place();
      } else if (a === "cancel") finish(null);
      else if (a === "save") finish(saveSpots(json, portrait, spots));
    });
    place();
    host.append(wrap);
  });
}
