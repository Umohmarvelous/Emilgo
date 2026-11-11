// The wire protocol between the game and the game server. JSON over one
// WebSocket. Shared by both sides — change it here and both follow.
//
// Principles:
//   - The client sends only INTENT: a stick vector. Never a position, never a
//     status. The server's referee decides where everyone is and who is out.
//   - The server sends compact state at NET.snapshotHz plus reliable events
//     (phase changes, catches, finishes) the moment they happen.
//   - Numbers on the wire are integers: centimetres, cm/s, milliradians.
//
// Nothing here identifies a person beyond the display name the host gave us.
// No ids from Lagos Life or EMILGO ever reach the server in Phase 2.

import { DEFAULT_DISTANCE, DISTANCES, MODES, NET, type Distance, type Mode } from "../config";
import { EMOTE_IDS, type EmoteId } from "../social/emotes";
import { filterChat } from "../social/filter";
import type { WireLook } from "../shop/catalog";
import type { Cause } from "../game/rules";
import { PHASES, type Phase } from "../game/phases";
import type { FfaStart, MatchEvents, MatchSnap, MatchSync } from "./matchWire";

// ── Client → server ──────────────────────────────────────────────────────────

export type ClientMsg =
  | { t: "hello"; v: number; name: string; resume?: string }
  /** Play with New People: matched with others who chose the same mode and distance. */
  | { t: "quick"; mode?: Mode; dist?: Distance }
  /** A private room. m: a Free For All mode id (protocol 12); missing, Red Light, Green Light. */
  | { t: "create"; size: number; mode?: Mode; dist?: Distance; m?: string }
  /** Free For All's public queue for a featured mode (protocol 12). A party's leader brings the party. */
  | { t: "fq"; m: string; r?: boolean }
  /** A party (up to 4, kept together as a squad): make one, join one by its code, leave it. */
  | { t: "party"; op: "make" | "leave" }
  | { t: "party"; op: "join"; code: string }
  | { t: "join"; code: string }
  /** Waiting room: I'm ready (or not any more). Everyone ready starts the 2 s loading. */
  | { t: "ready"; on: boolean }
  /** Walkout: skip to behind the players (counts once everyone is in the arena). */
  | { t: "skip" }
  | { t: "leave" }
  /**
   * Stick in WORLD space, each axis −100…100; buttons b = sprint | stance << 1
   * | brace << 3 (Free For All); j = jump counter; a = attack (counter << 2 |
   * kind 1 fist 2 slap 3 push); g = grab counter. Open worlds (protocol 12):
   * i = interact counter | held << 8; k = the backpack (Match.setPack).
   * Guns (protocol 15): y = the aim's yaw, p its pitch (milliradians); w =
   * trigger | ADS << 1 | reload counter << 2 (4 bits) | swap counter << 6.
   */
  | { t: "in"; x: number; z: number; b?: number; j?: number; a?: number; g?: number; i?: number; k?: number; y?: number; p?: number; w?: number }
  | { t: "pong"; s: number }
  /**
   * Play my Lagos Life match. `session` is a fresh Vatar.session() token; the
   * server checks it with Lagos Life — never trusting the phone about who it is.
   */
  | { t: "vmatch"; id: string; session: string }
  /**
   * Rank (SPEC-V3 §1.4): who I am, for my rank profile. k "ll" = a Lagos Life
   * session token (checked with Lagos Life), "em" = an EMILGO account's access
   * token (checked by the server). Never both, never linked.
   */
  | { t: "id"; k: "ll" | "em"; tok: string }
  // ── Social (Phase 4) ──
  | { t: "chat"; text: string }
  | { t: "emote"; e: EmoteId }
  /** A spectator's vote on where the next Airfall lands (SPEC-V3 §10.6): spot c of the three offered. */
  | { t: "mvote"; c: number }
  /** Dead Streets (Phase 7): ask for a run (the server gives its seed), send where it went in parts, then what it claims. */
  | { t: "runstart"; daily?: boolean }
  | { t: "runpart"; id: string; pts: number[] }
  | { t: "runend"; id: string; secs: number; fin: boolean; kills: number; heads: number; route: number; wp?: string; charm?: number }
  /** Commend a player I just played with (SPEC-V3 §10.12): once a match, soon after it ends. */
  | { t: "commend"; id: string }
  /** A squad ping (SPEC-V3 §10.7): go, help, item, danger, here (k 0–4), at x, z. Only my squad sees it. */
  | { t: "sping"; k: number; x: number; z: number }
  /** Report a seat in my room. The server keeps the last few lines they said as evidence. */
  | { t: "report"; id: string; reason: ReportReason }
  /** Stop seeing each other's chat and emotes, and never quick-match together again (this session). */
  | { t: "block"; id: string }
  // ── Shop (Phase 5) ──
  /**
   * What I'm wearing. `ticket` is the signed list of what I own, issued by the
   * server after it checked my purchases with Lagos Life — the server only
   * shows what the ticket allows.
   */
  | { t: "look"; ticket?: string; look: WireLook }
  // ── Phase 7 (protocol 10) ──
  /**
   * My preferences that the server acts on: the CP boosts I bring to free rooms
   * (bo, indexes into shop/boosts BOOSTS, at most BOOST_SLOTS), data saver (ds:
   * half the snapshots) and whether I take friend requests (fr).
   */
  | { t: "prefs"; bo: number[]; ds: boolean; fr: boolean }
  /**
   * Who I am to my friends: my friend id (random, made on this phone) and theirs.
   * The server keeps it in memory while I'm connected and tells me which of them
   * are on — only those who list me back.
   */
  | { t: "me"; fid: string; friends: string[] }
  /** Ask a player to be friends: a seat in my room, or someone I played with (their seat id then). */
  | { t: "freq"; id: string }
  /** Yes to a request (`id` is the asker's id from their freq). */
  | { t: "facc"; id: string }
  /** Invite a friend (both list each other) to my room. */
  | { t: "inv"; fid: string }
  // ── v6 max (3.11): the profile and direct messages ──
  /**
   * A direct message to a friend (by friend id). It only goes if we list each
   * other and they take messages; it's cleaned like chat (no numbers, links or
   * addresses). A friend who is off gets it when they come on (held a day).
   */
  | { t: "dm"; to: string; text: string; n: number }
  /** Report a friend's direct messages (the server keeps what it passed between us as evidence). */
  | { t: "dmrep"; fid: string; reason: ReportReason }
  /** My public card (what others see when they open my profile), and whether I take direct messages. */
  | { t: "card"; c: WireCard; dms: boolean }
  /** Show me a player's card: a seat in my room or someone I played with (id), or a friend (fid). */
  | { t: "cardq"; id?: string; fid?: string }
  /** v6 max (3.12): this week's leaderboard (k: which copy of the game I'm in, when I have no profile). */
  | { t: "lbq"; k: "ll" | "em" };

/**
 * v6 max (3.11): a player's public card. Numbers the phone keeps (as it keeps
 * CP and awards), except the rank, which the server's profile gives when there
 * is one. No ids, nothing that links a player anywhere else.
 */
export interface WireCard {
  /** Rank division (rank/ladder rankOf(xp).k). */
  r: number;
  /** The badge worn ("veteran.3"). */
  aw?: string;
  /** Matches, wins, kills, head shots, badges reached, commends. */
  m: number;
  w: number;
  k: number;
  hs: number;
  b: number;
  h: number;
  /** The last five results, newest first ("WLLWW"). */
  f?: string;
  /** Hidden by its owner: only the name, rank and badge show. */
  p?: 1;
}

/** A card off the wire, checked (numbers clamped, strings shaped). */
export function cleanCard(v: unknown): WireCard | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const n = (x: unknown, max = 1e7) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(max, Math.floor(x))) : 0);
  const c: WireCard = { r: n(o.r, 99), m: n(o.m), w: n(o.w), k: n(o.k), hs: n(o.hs), b: n(o.b, 999), h: n(o.h) };
  if (typeof o.aw === "string" && /^[a-z-]{1,20}\.[1-4]$/.test(o.aw)) c.aw = o.aw;
  if (typeof o.f === "string" && /^[WL]{0,5}$/.test(o.f)) c.f = o.f;
  if (o.p === 1) c.p = 1;
  return c;
}

export type ReportReason = "abuse" | "scam" | "cheating" | "name";
export const REPORT_REASONS: Record<ReportReason, string> = {
  abuse: "Insults or harassment",
  scam: "Scam or asking for money",
  cheating: "Cheating",
  name: "Offensive name",
};

// ── Server → client ──────────────────────────────────────────────────────────

export interface RoomPlayer {
  id: string;
  name: string;
  /** Temporarily disconnected (still in the room). */
  away?: boolean;
  /** What they look like (already checked against what they own). */
  look?: WireLook;
  /** Ticked ready in the waiting room. */
  ready?: 1;
}

export interface RoomInfo {
  /** match = a Lagos Life match (Vatar), seats fixed by the platform. */
  kind: "quick" | "private" | "match";
  /** Private rooms only. */
  code: string | null;
  size: number;
  /** Who created a private room. */
  owner: string | null;
  players: RoomPlayer[];
  /** Server time (ms) the round starts, or null while waiting. */
  startsAt: number | null;
  /** Loading (the last FLOW.loading s before the start): the map is chosen, so phones build it now. */
  map?: string;
  state: "lobby" | "playing" | "ended";
  /** Lagos Life matches: the stake per player, in the world's game money. */
  stake?: number;
  /** What this room plays. */
  mode: Mode;
  dist: Distance;
  /** Free For All (protocol 12): the mode id, and the fewest people it starts with. */
  ffa?: string;
  min?: number;
  /** Ranked (Phase 6): double XP and the mode's harder rules. */
  rk?: boolean;
}

export interface StartInfo {
  seed: number;
  /** Server time (ms) of the round's first tick. */
  s: number;
  /** bo: the CP boosts the referee applies to them (indexes into shop/boosts BOOSTS; protocol 10). */
  roster: { id: string; name: string; look?: WireLook; bo?: number[] }[];
  /** Initial [x, z, heading] per roster index, cm / mrad. */
  init: number[];
  /** Map id (maps/registry.ts). Missing: the classic Lagos street. */
  map?: string;
  /** Mode and distance (missing: Classic Run, 200 m), the field's half width (cm). */
  mode?: Mode;
  dist?: Distance;
  hw?: number;
  /** Ball Haunting: where each ball starts, [x, z] cm. */
  bp?: number[];
  /** The walkout's length, ms (missing: none, the round opens on the countdown). */
  wo?: number;
  /** Free For All (protocol 12): the mode, the map and the squads (net/matchWire.ts). */
  ffa?: FfaStart;
}

/** Round state for (re)joining mid-round: a full snapshot (balls included), plus outcomes. */
export interface SyncInfo extends StartInfo {
  snap: SnapMsg;
  /** Per roster index: [place, finishTime ms, eliminatedAt ms, cause 0 none 1 moved 2 time 3 noball, progress cm]. */
  outcomes: number[];
}

export interface SnapMsg {
  t: "snap";
  /** Server time (ms) of this tick. */
  s: number;
  /** Phase index into PHASES. */
  ph: number;
  /** Phase time / duration / elapsed, ms. Duration is 0 for secret-length phases (HIDDEN_LENGTH). */
  pt: number;
  pd: number;
  el: number;
  /** One char per roster index: a(live) f(inished) e(liminated). */
  st: string;
  /**
   * Per roster index: x, z, heading, y, flags (cm, cm, mrad, cm; flags =
   * packFlags below). Speed and distance run are worked out on the phone from
   * positions. Eliminated contestants are all zeros (they lie where the "out"
   * event put them), except in a sync. Kept small: twenty of these go out 15
   * times a second, to phones on mobile data.
   */
  p: number[];
  /**
   * Ball Haunting, in a sync only, per ball: x, z (cm), h (balls.ts ballState:
   * holder + 1, −(basket + 1), 0 free). During play every change to a ball
   * already arrives as an event (grb, drp, bnk), so snapshots don't repeat it.
   */
  b?: number[];
}

export type EventMsg =
  | { t: "ev"; k: "ph"; ph: number; d: number }
  | { t: "ev"; k: "out"; i: number; c: 0 | 1 | 2; x: number; z: number }
  | { t: "ev"; k: "fin"; i: number; time: number; place: number }
  | { t: "ev"; k: "end" }
  /** An attack by i (kind 1 fist, 2 slap, 3 push) on tg (−1: a miss), knocking ball db loose (−1: none). Target's slide: kx, kz (cm/s). */
  | { t: "ev"; k: "atk"; i: number; kind: number; tg: number; db: number; kx?: number; kz?: number }
  | { t: "ev"; k: "grb"; i: number; b: number }
  | { t: "ev"; k: "drp"; b: number; x: number; z: number }
  | { t: "ev"; k: "bnk"; i: number; b: number; bk: number }
  /** Two left running (protocol 8): everyone's clock slows (config FINAL). a, b: their roster indexes. */
  | { t: "ev"; k: "fn2"; a: number; b: number }
  /**
   * A highlight that beat the best so far (game/highlights.ts): kind (1 escape,
   * 2 dodge, 3 attack), contestant i, at (ms of play), sc (score × 10). The
   * last one before "end" is the play of the game.
   */
  | { t: "ev"; k: "hl"; i: number; kind: number; at: number; sc: number };

export type ServerMsg =
  | { t: "welcome"; id: string; token: string; s: number; name: string; on?: number; pl?: number; off?: string[] }
  /** The live kill switch changed: what's off now (mode ids, or a whole game). */
  | { t: "modes"; off: string[] }
  /** How many people are on the server (on) and in a round (pl), now and then. */
  | { t: "stats"; on: number; pl: number }
  | { t: "room"; room: RoomInfo }
  | { t: "start"; start: StartInfo }
  | { t: "sync"; sync: SyncInfo }
  | SnapMsg
  | EventMsg
  // ── Free For All (protocol 12, net/matchWire.ts) ──
  | MatchSnap
  | MatchEvents
  | { t: "msync"; sync: MatchSync }
  /** Your party: its code, who's in it, who leads (picks the game); off: you're in none. */
  | { t: "party"; code: string; members: { id: string; name: string }[]; lead: string }
  | { t: "party"; off: 1 }
  | { t: "ping"; s: number; rtt: number }
  /** Your contestant id in this room (Lagos Life matches use your per-game player id). */
  | { t: "seat"; id: string }
  /**
   * A Lagos Life match was decided by our referee and the result posted.
   * Money facts (payout) come from Lagos Life's own match update, not from here.
   */
  | { t: "vresult"; winner: string; posted: boolean }
  /** A chat line, already cleaned by the server. `from` is a seat id in this room. */
  | { t: "chat"; from: string; name: string; text: string; b?: 1 }
  /** A squad mate's ping (§10.7). */
  | { t: "sping"; from: string; k: number; x: number; z: number }
  | { t: "emote"; from: string; e: EmoteId }
  /** A short notice for this player only ("your message was cleaned", "reported"). */
  | { t: "note"; text: string }
  | { t: "left" }
  | { t: "err"; code: ErrorCode; msg?: string }
  // ── Phase 7 (protocol 10) ──
  /** My friends who are on (and list me back): in the lobby (on), waiting in a room (rm), in a round (pl). */
  | { t: "fr"; on: string[]; rm: string[]; pl: string[] }
  /** Someone asks to be friends. `id` answers them (facc); `fid` is who they'll be on your list. */
  | { t: "freq"; id: string; name: string; fid: string }
  /** They said yes: add them. */
  | { t: "facc"; name: string; fid: string }
  /** A friend invites you to their room. */
  | { t: "inv"; name: string; fid: string; code: string }
  // ── v3 (protocol 11) ──
  /**
   * Rank: your total XP on this server's profile (xp), what the last match
   * earned (gain), or off: no profile (a guest, or the identity didn't check
   * out: the phone keeps its own count for this device only).
   */
  | { t: "rank"; xp?: number; gain?: number; off?: 1; hon?: number; st?: number }
  /** A run's id and seed (Dead Streets). */
  | { t: "runtok"; id: string; seed: number }
  /** The server's word on a run: counted (the XP, your best and place, the board's best times) or not, and why. */
  | { t: "runres"; ok: boolean; why?: string; gain?: number; best?: number; place?: number; board?: { secs: number; you: boolean }[]; daily?: boolean }
  /** Someone commended you (§10.12); n: your commends now (none for a guest). */
  | { t: "honour"; by: string; n?: number }
  // ── v6 max (3.11) ──
  /** A direct message from a friend (cleaned), sent at `at` (ms since 1970, the server's clock). */
  | { t: "dm"; fid: string; name: string; text: string; at: number }
  /** My message n: delivered (ok), held for when they come on (held), or not sent and why. */
  | { t: "dmack"; to: string; n: number; ok?: 1; held?: 1; why?: string; text?: string }
  /** A player's public card (name from the server; null card: not available). */
  | { t: "card"; id?: string; fid?: string; name: string; c: WireCard | null }
  /** v6 max (3.12): this week's XP leaderboard (ISO week), the top, and my place on it (a profile's). */
  | { t: "lb"; week: string; rows: { name: string; xp: number; you?: boolean }[]; me: { place: number; xp: number } | null };

export type ErrorCode =
  | "version" // client too old
  | "bad" // malformed message
  | "full" // room full
  | "not_found" // no such code
  | "started" // round already running
  | "rate" // too many messages
  | "busy" // server at capacity
  | "vatar_off" // Lagos Life matches aren't set up on this server
  | "verify" // Lagos Life didn't accept the session
  | "not_in_match" // the session's player isn't in that match
  | "match_state" // the match isn't being played (not started, or over)
  | "mode_off" // the developer has that mode switched off (SPEC-V3: Ball Haunt's switch)
  | "locked" // your rank hasn't opened that mode yet
  | "lead"; // only your party's leader picks the game

export const ERROR_TEXT: Record<ErrorCode, string> = {
  version: "Update the game to play online.",
  bad: "Something went wrong talking to the server.",
  full: "That room is full.",
  not_found: "No room with that code. Check it and try again.",
  started: "That round has already started.",
  rate: "Easy! Too many taps. Try again small.",
  busy: "The server is busy. Try again in a moment.",
  vatar_off: "Lagos Life matches aren't switched on for this game yet.",
  verify: "Lagos Life couldn't confirm who you are. Try again.",
  not_in_match: "You're not in that match.",
  match_state: "That match isn't being played right now.",
  mode_off: "That game isn't on right now.",
  locked: "Your rank hasn't opened that mode yet.",
  lead: "Your party leader picks the game.",
};

export const SNAP_STRIDE = 5;
export const OUTCOME_STRIDE = 5;
export const BALL_STRIDE = 3;

/**
 * The snapshot flags word: stance (2 bits) | sprinting << 2 | stamina 0–31 << 3
 * | stunned << 8 | action << 9 (combat.ts ACT_CODES: 1 fist, 2 slap, 3 push, 4 grab)
 * | sliding << 12.
 */
export function packFlags(stance: number, sprinting: boolean, stamina: number, stunned = false, act = 0, sliding = false): number {
  return (stance & 3) | (sprinting ? 4 : 0) | (Math.round(Math.max(0, Math.min(1, stamina)) * 31) << 3) | (stunned ? 256 : 0) | ((act & 7) << 9) | (sliding ? 4096 : 0);
}
export function unpackFlags(f: number): { stance: 0 | 1 | 2; sprinting: boolean; stamina: number; stunned: boolean; act: number; sliding: boolean } {
  return { stance: Math.min(2, f & 3) as 0 | 1 | 2, sprinting: (f & 4) !== 0, stamina: ((f >> 3) & 31) / 31, stunned: (f & 256) !== 0, act: (f >> 9) & 7, sliding: (f & 4096) !== 0 };
}
export const STATUS_CHAR = { alive: "a", finished: "f", eliminated: "e" } as const;
export const CAUSES: readonly Cause[] = ["moved", "time", "noball"];
/** Highlight kinds on the wire: index + 1. */
export const MOMENT_WIRE = ["escape", "dodge", "attack"] as const;

/** A mode and distance from the wire, or the defaults. */
export function cleanMode(v: unknown): Mode {
  return MODES.includes(v as Mode) ? (v as Mode) : "classic";
}
export function cleanDist(v: unknown): Distance {
  return DISTANCES.includes(v as Distance) ? (v as Distance) : DEFAULT_DISTANCE;
}

export function phaseIndex(p: Phase): number {
  return PHASES.indexOf(p);
}

export function phaseAt(i: number): Phase {
  return PHASES[i] ?? "ended";
}

// ── Validation (server side uses these on every message) ─────────────────────

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : null;

/** Parse one client message. Returns null for anything malformed. */
export function parseClient(raw: string): ClientMsg | null {
  if (raw.length > NET.maxMessageBytes) return null;
  let o: Record<string, unknown>;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    o = v as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (o.t) {
    case "hello": {
      const v = int(o.v, 0, 1e6);
      if (v === null || typeof o.name !== "string") return null;
      const resume = typeof o.resume === "string" && o.resume.length <= 64 ? o.resume : undefined;
      return { t: "hello", v, name: o.name.slice(0, 64), resume };
    }
    case "quick":
      return { t: "quick", mode: cleanMode(o.mode), dist: cleanDist(o.dist) };
    case "skip":
    case "leave":
      return { t: o.t };
    case "ready":
      return typeof o.on === "boolean" ? { t: "ready", on: o.on } : null;
    case "create": {
      const size = int(o.size, 0, 99);
      if (size === null || !NET.privateSizes.includes(size)) return null;
      const m = typeof o.m === "string" && MODE_ID.test(o.m) ? o.m : undefined;
      return { t: "create", size, mode: cleanMode(o.mode), dist: cleanDist(o.dist), ...(m ? { m } : {}) };
    }
    case "fq":
      return typeof o.m === "string" && MODE_ID.test(o.m) ? { t: "fq", m: o.m, ...(o.r === true ? { r: true } : {}) } : null;
    case "party":
      if (o.op === "make" || o.op === "leave") return { t: "party", op: o.op };
      return o.op === "join" && typeof o.code === "string" ? { t: "party", op: "join", code: normalizeCode(o.code) } : null;
    case "join":
      return typeof o.code === "string" ? { t: "join", code: normalizeCode(o.code) } : null;
    case "in": {
      const x = int(o.x, -100, 100);
      const z = int(o.z, -100, 100);
      const b = o.b === undefined ? 0 : int(o.b, 0, 13);
      const j = o.j === undefined ? 0 : int(o.j, 0, 255);
      const a = o.a === undefined ? 0 : int(o.a, 0, 255);
      const g = o.g === undefined ? 0 : int(o.g, 0, 255);
      const i = o.i === undefined ? 0 : int(o.i, 0, 511);
      const k = o.k === undefined ? 0 : int(o.k, 0, 16383);
      const y = o.y === undefined ? 0 : int(o.y, -3142, 3142);
      const p = o.p === undefined ? 0 : int(o.p, -1100, 1100);
      const w = o.w === undefined ? 0 : int(o.w, 0, 1023);
      return x === null || z === null || b === null || j === null || a === null || g === null || i === null || k === null || y === null || p === null || w === null ? null : { t: "in", x, z, b, j, a, g, i, k, y, p, w };
    }
    case "pong": {
      const s = typeof o.s === "number" && Number.isFinite(o.s) ? o.s : null;
      return s === null ? null : { t: "pong", s };
    }
    case "chat":
      return typeof o.text === "string" && o.text.length <= 400 ? { t: "chat", text: o.text } : null;
    case "runstart":
      return { t: "runstart", ...(o.daily === true ? { daily: true } : {}) };
    case "runpart": {
      const pts = Array.isArray(o.pts) && o.pts.length <= 600 && o.pts.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e4) ? (o.pts as number[]) : null;
      return typeof o.id === "string" && o.id.length <= 32 && pts ? { t: "runpart", id: o.id, pts } : null;
    }
    case "runend": {
      const num = (v: unknown, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= hi ? v : null);
      const secs = num(o.secs, 3600);
      const kills = num(o.kills, 10000);
      const heads = num(o.heads, 10000);
      const route = num(o.route, 1);
      return typeof o.id === "string" && o.id.length <= 32 && secs !== null && kills !== null && heads !== null && route !== null && typeof o.fin === "boolean"
        ? { t: "runend", id: o.id, secs, fin: o.fin, kills: Math.floor(kills), heads: Math.floor(heads), route, ...(typeof o.wp === "string" && o.wp.length <= 12 ? { wp: o.wp } : {}), ...(typeof o.charm === "number" && Number.isFinite(o.charm) ? { charm: Math.max(1, Math.min(1.5, o.charm)) } : {}) }
        : null;
    }
    case "mvote": {
      const c = int(o.c, 0, 2);
      return c === null ? null : { t: "mvote", c };
    }
    case "commend":
      return typeof o.id === "string" && o.id.length > 0 && o.id.length <= 64 ? { t: "commend", id: o.id } : null;
    case "sping": {
      const k = int(o.k, 0, 4);
      const x = typeof o.x === "number" && Number.isFinite(o.x) && Math.abs(o.x) <= 2000 ? o.x : null;
      const z = typeof o.z === "number" && Number.isFinite(o.z) && Math.abs(o.z) <= 2000 ? o.z : null;
      return k === null || x === null || z === null ? null : { t: "sping", k, x, z };
    }
    case "emote":
      return typeof o.e === "string" && (EMOTE_IDS as string[]).includes(o.e) ? { t: "emote", e: o.e as EmoteId } : null;
    case "report": {
      const reason = typeof o.reason === "string" && o.reason in REPORT_REASONS ? (o.reason as ReportReason) : null;
      return typeof o.id === "string" && o.id.length <= 64 && reason ? { t: "report", id: o.id, reason } : null;
    }
    case "block":
      return typeof o.id === "string" && o.id.length <= 64 ? { t: "block", id: o.id } : null;
    case "look": {
      // The ticket is only needed for paid items; a free look travels without one.
      if ((o.ticket !== undefined && (typeof o.ticket !== "string" || o.ticket.length > 2000)) || !o.look || typeof o.look !== "object") return null;
      const l = o.look as Record<string, unknown>;
      const look: WireLook = {};
      const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);
      const int = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : undefined);
      look.hd = int(l.hd, 64);
      look.ds = str(l.ds, 16);
      look.o = str(l.o, 32);
      look.g = str(l.g, 1);
      look.s = int(l.s, 32);
      look.h = str(l.h, 16);
      look.hc = int(l.hc, 32);
      look.ht = int(l.ht, 200);
      if (Array.isArray(l.x)) look.x = l.x.filter((e): e is string => typeof e === "string" && e.length <= 16).slice(0, 6);
      if (l.b === 1) look.b = 1;
      // v5's closed mask (it never got through here before v6 max: others saw the open face).
      if (l.mk === 1) look.mk = 1;
      // v6 max (3.10): the award badge worn (allowedLook checks its shape).
      const aw = str(l.aw, 24);
      if (aw) look.aw = aw;
      return { t: "look", ticket: typeof o.ticket === "string" ? o.ticket : undefined, look };
    }
    case "prefs": {
      if (!Array.isArray(o.bo) || o.bo.length > 8 || typeof o.ds !== "boolean" || typeof o.fr !== "boolean") return null;
      return { t: "prefs", bo: o.bo.filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < 64), ds: o.ds, fr: o.fr };
    }
    case "me": {
      if (typeof o.fid !== "string" || !FID.test(o.fid) || !Array.isArray(o.friends) || o.friends.length > 100) return null;
      return { t: "me", fid: o.fid, friends: o.friends.filter((f): f is string => typeof f === "string" && FID.test(f)) };
    }
    case "freq":
    case "facc":
      return typeof o.id === "string" && o.id.length <= 64 ? { t: o.t, id: o.id } : null;
    case "inv":
      return typeof o.fid === "string" && FID.test(o.fid) ? { t: "inv", fid: o.fid } : null;
    case "dm":
      return typeof o.to === "string" && FID.test(o.to) && typeof o.text === "string" && o.text.length <= 400 && Number.isInteger(o.n) ? { t: "dm", to: o.to, text: o.text, n: Math.max(0, Math.min(1e9, o.n as number)) } : null;
    case "dmrep":
      return typeof o.fid === "string" && FID.test(o.fid) && typeof o.reason === "string" && o.reason in REPORT_REASONS ? { t: "dmrep", fid: o.fid, reason: o.reason as ReportReason } : null;
    case "card": {
      const c = cleanCard(o.c);
      return c && typeof o.dms === "boolean" ? { t: "card", c, dms: o.dms } : null;
    }
    case "lbq":
      return o.k === "ll" || o.k === "em" ? { t: "lbq", k: o.k } : null;
    case "cardq":
      if (typeof o.fid === "string" && FID.test(o.fid)) return { t: "cardq", fid: o.fid };
      return typeof o.id === "string" && o.id.length <= 64 ? { t: "cardq", id: o.id } : null;
    case "id":
      return (o.k === "ll" || o.k === "em") && typeof o.tok === "string" && o.tok.length >= 8 && o.tok.length <= 2400 ? { t: "id", k: o.k, tok: o.tok } : null;
    case "vmatch": {
      const id = typeof o.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.id) ? o.id : null;
      const session = typeof o.session === "string" && o.session.length <= 900 ? o.session : null;
      return id && session ? { t: "vmatch", id, session } : null;
    }
    default:
      return null;
  }
}

/** A mode id (content/modes.ts). */
const MODE_ID = /^[a-z0-9-]{1,32}$/;

/** A friend id (settings.ts newFid). */
const FID = /^[A-Za-z0-9_-]{16}$/;

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, NET.codeLength);
}

/**
 * A display name safe to show strangers: no control or direction-override
 * characters (they can flip text around a name), collapsed spaces, short.
 * Empty, the placeholder "You", or anything the chat filter would hide (an
 * insult, a phone number, a link, an @handle) becomes a guest name.
 */
export function cleanName(raw: string, fallback: () => string): string {
  const s = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NET.nameMax)
    .trim();
  return !s || s.toLowerCase() === "you" || filterChat(s).changed ? fallback() : s;
}
