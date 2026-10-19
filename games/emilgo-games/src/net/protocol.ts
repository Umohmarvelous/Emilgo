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
import type { Cause, Phase } from "../game/rules";
import { PHASES } from "../game/rules";

// ── Client → server ──────────────────────────────────────────────────────────

export type ClientMsg =
  | { t: "hello"; v: number; name: string; resume?: string }
  /** Play with New People: matched with others who chose the same mode and distance. */
  | { t: "quick"; mode?: Mode; dist?: Distance }
  | { t: "create"; size: number; mode?: Mode; dist?: Distance }
  | { t: "join"; code: string }
  /** Waiting room: I'm ready (or not any more). Everyone ready starts the 2 s loading. */
  | { t: "ready"; on: boolean }
  /** Walkout: skip to behind the players (counts once everyone is in the arena). */
  | { t: "skip" }
  | { t: "leave" }
  /**
   * Stick in WORLD space, each axis −100…100; buttons b = sprint | stance << 1;
   * j = jump counter; a = attack (counter << 2 | kind 1 fist 2 slap 3 push); g = grab counter.
   */
  | { t: "in"; x: number; z: number; b?: number; j?: number; a?: number; g?: number }
  | { t: "pong"; s: number }
  /**
   * Play my Lagos Life match. `session` is a fresh Vatar.session() token; the
   * server checks it with Lagos Life — never trusting the phone about who it is.
   */
  | { t: "vmatch"; id: string; session: string }
  // ── Social (Phase 4) ──
  | { t: "chat"; text: string }
  | { t: "emote"; e: EmoteId }
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
  | { t: "look"; ticket?: string; look: WireLook };

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
}

export interface StartInfo {
  seed: number;
  /** Server time (ms) of the round's first tick. */
  s: number;
  roster: { id: string; name: string; look?: WireLook }[];
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
  | { t: "welcome"; id: string; token: string; s: number; name: string; on?: number; pl?: number }
  /** How many people are on the server (on) and in a round (pl), now and then. */
  | { t: "stats"; on: number; pl: number }
  | { t: "room"; room: RoomInfo }
  | { t: "start"; start: StartInfo }
  | { t: "sync"; sync: SyncInfo }
  | SnapMsg
  | EventMsg
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
  | { t: "emote"; from: string; e: EmoteId }
  /** A short notice for this player only ("your message was cleaned", "reported"). */
  | { t: "note"; text: string }
  | { t: "left" }
  | { t: "err"; code: ErrorCode; msg?: string };

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
  | "match_state"; // the match isn't being played (not started, or over)

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
      return size !== null && NET.privateSizes.includes(size) ? { t: "create", size, mode: cleanMode(o.mode), dist: cleanDist(o.dist) } : null;
    }
    case "join":
      return typeof o.code === "string" ? { t: "join", code: normalizeCode(o.code) } : null;
    case "in": {
      const x = int(o.x, -100, 100);
      const z = int(o.z, -100, 100);
      const b = o.b === undefined ? 0 : int(o.b, 0, 5);
      const j = o.j === undefined ? 0 : int(o.j, 0, 255);
      const a = o.a === undefined ? 0 : int(o.a, 0, 255);
      const g = o.g === undefined ? 0 : int(o.g, 0, 255);
      return x === null || z === null || b === null || j === null || a === null || g === null ? null : { t: "in", x, z, b, j, a, g };
    }
    case "pong": {
      const s = typeof o.s === "number" && Number.isFinite(o.s) ? o.s : null;
      return s === null ? null : { t: "pong", s };
    }
    case "chat":
      return typeof o.text === "string" && o.text.length <= 400 ? { t: "chat", text: o.text } : null;
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
      look.o = str(l.o, 32);
      look.g = str(l.g, 1);
      look.s = int(l.s, 32);
      look.h = str(l.h, 16);
      look.hc = int(l.hc, 32);
      look.ht = int(l.ht, 200);
      if (Array.isArray(l.x)) look.x = l.x.filter((e): e is string => typeof e === "string" && e.length <= 16).slice(0, 6);
      if (l.b === 1) look.b = 1;
      return { t: "look", ticket: typeof o.ticket === "string" ? o.ticket : undefined, look };
    }
    case "vmatch": {
      const id = typeof o.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.id) ? o.id : null;
      const session = typeof o.session === "string" && o.session.length <= 900 ? o.session : null;
      return id && session ? { t: "vmatch", id, session } : null;
    }
    default:
      return null;
  }
}

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
