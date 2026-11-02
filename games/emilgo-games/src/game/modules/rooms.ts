// Compound Wars (SPEC-V3 §9 #7; Phase 6): the Face-me-I-face-you courtyard's
// eight rooms, worth 1–5 points a second each, from the Boys' Quarters up to
// the Master Bedroom with the AC. A room scores for the one squad inside it
// while its door is shut; two squads inside, or the door open, and it scores
// for nobody. A room flips on one shove.
//
//   Doors    tap at one (either side) to open or shut it. Inside a shut one,
//            a tap opens it and a hold jams it: nobody opens it for a while.
//   Keys     the best two rooms start locked; two keys lie in the yard.
//            Walk onto one; tap the locked door with it to open it for good.
//   Fuse     the fuse box by the gate darkens the room scoring the most
//            for a rival: it scores nothing until the light comes back.
//
// A shut door is solid: nobody walks through it (the server keeps bodies out
// of the doorway; a phone keeps its own body out the same way).
//
// Pure: the keys' places come from the public seed; doors, keys and the
// fuse arrive on a phone as events.

import { FLAGS, MOVE, ROOMS } from "../../config";
import type { CourtRoom } from "../../maps/open/prefabs";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { GadgetsModule } from "./gadgets";
import type { MatchEvent, RuleModule } from "../core/module";
import { nearOpen } from "./flags";
import type { MeleeModule } from "./melee";

export const ROOM_NAMES = ["Boys' Quarters", "Storeroom", "Kitchen", "Children's Room", "Guest Room", "Parlour", "Madam's Room", "Master Bedroom"] as const;

export interface Door {
  open: boolean;
  locked: boolean;
  /** Jammed shut until (seconds of play). */
  jam: number;
}

export interface Key {
  readonly index: number;
  x: number;
  z: number;
  h: number;
  holder: number;
  used: boolean;
}

export class RoomsModule implements RuleModule {
  readonly id = "rooms" as const;
  readonly values: number[];
  readonly fuse: boolean;
  readonly keysOn: boolean;
  rooms: readonly CourtRoom[] = [];
  readonly doors: Door[] = [];
  readonly keys: Key[] = [];
  /** The fuse: the room that's dark, until when; when the box can be used again. */
  dark = { room: -1, until: 0 };
  fuseReady = 0;
  fuseAt: { x: number; z: number; h: number } | null = null;
  points = new Float64Array(0);
  private jamming = new Float64Array(0);
  /** Inside a shut door: the room whose door a press is deciding about (a tap opens it, a hold jams it), or −1. */
  private pending = new Int32Array(0);

  constructor(params: Record<string, unknown>) {
    const v = Array.isArray(params.values) ? (params.values as unknown[]).map(Number).filter((x) => Number.isFinite(x)) : [];
    this.values = v.length ? v : [1, 1, 2, 2, 3, 3, 4, 5];
    this.fuse = params.fuse !== false;
    this.keysOn = params.keys !== false;
  }

  init(m: Match): void {
    const n = m.contestants.length;
    this.points = new Float64Array(n);
    this.jamming = new Float64Array(n);
    this.pending = new Int32Array(n).fill(-1);
    this.rooms = (m.world.rooms ?? []).slice(0, this.values.length);
    for (let i = 0; i < this.rooms.length; i++) this.doors.push({ open: true, locked: false, jam: 0 });
    if (!this.rooms.length) return;
    // The best two start locked (shut); the keys lie in the yard.
    const cx = this.rooms.reduce((a, r) => a + r.x, 0) / this.rooms.length;
    const cz = this.rooms.reduce((a, r) => a + r.z, 0) / this.rooms.length;
    if (this.keysOn) {
      const best = [...this.rooms.keys()].sort((a, b) => this.value(b) - this.value(a)).slice(0, ROOMS.keys);
      for (const i of best) this.doors[i] = { open: false, locked: true, jam: 0 };
      const rng = m.rng("rooms");
      for (let k = 0; k < ROOMS.keys; k++) {
        const cell = nearOpen(m, cx + rng.range(-6, 6), cz + rng.range(-6, 6), 4);
        if (cell < 0) continue;
        const [x, z] = m.reach.centre(cell);
        this.keys.push({ index: this.keys.length, x, z, h: m.reach.h[cell], holder: -1, used: false });
      }
    }
    // The fuse box: in the yard, by the gate side (the yard's middle, nudged towards the rooms' mean).
    const cell = nearOpen(m, cx, cz, 4);
    if (this.fuse && cell >= 0) {
      const [x, z] = m.reach.centre(cell);
      this.fuseAt = { x, z, h: m.reach.h[cell] };
    }
  }

  value(i: number): number {
    return this.values[i] ?? 1;
  }

  /** Which room (x, z) is inside, or −1. */
  roomAt(x: number, z: number): number {
    for (const r of this.rooms) {
      const dx = x - r.x;
      const dz = z - r.z;
      const c = Math.cos(r.rot);
      const s = Math.sin(r.rot);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) <= r.hx && Math.abs(lz) <= r.hz) return r.index;
    }
    return -1;
  }

  /** Who holds room i now: a squad number, or −1 (open, dark, empty, or contested). */
  holder(m: Match, i: number): number {
    if (this.doors[i]?.open || this.dark.room === i && m.elapsed < this.dark.until) return -1;
    let q = -1;
    for (const c of m.contestants) {
      if (c.status !== "alive" || this.roomAt(c.x, c.z) !== i) continue;
      const s = m.squads[c.index];
      if (q >= 0 && q !== s) return -1;
      q = s;
    }
    return q;
  }

  // ── Taps: a door, a key's lock, the fuse box ──

  reachFor(m: Match, c: Contestant): { d: number; take: () => void } | null {
    let best: { d: number; take: () => void } | null = null;
    for (const r of this.rooms) {
      const d = Math.hypot(r.door.x - c.x, r.door.z - c.z);
      if (d > ROOMS.reach || (best && best.d <= d)) continue;
      const inside = this.roomAt(c.x, c.z) === r.index && !this.doors[r.index].open && !this.doors[r.index].locked;
      best = { d, take: () => (inside ? (this.pending[c.index] = r.index) : this.useDoor(m, c, r.index)) };
    }
    if (this.fuseAt && m.elapsed >= this.fuseReady) {
      const d = Math.hypot(this.fuseAt.x - c.x, this.fuseAt.z - c.z);
      if (d <= ROOMS.reach && (!best || d < best.d)) best = { d, take: () => this.flipFuse(m, c) };
    }
    return best;
  }

  private useDoor(m: Match, c: Contestant, i: number): void {
    const d = this.doors[i];
    if (m.elapsed < d.jam) return;
    if (d.locked) {
      const key = this.keys.find((k) => k.holder === c.index && !k.used);
      if (!key) return;
      key.used = true;
      key.holder = -1;
      d.locked = false;
      m.emit({ type: "key", key: key.index, how: "use", id: c.id, x: c.x, z: c.z, h: c.h });
    }
    d.open = !d.open;
    m.emit({ type: "door", room: i, open: d.open, locked: d.locked, jam: 0, id: c.id });
  }

  private flipFuse(m: Match, c: Contestant): void {
    // The room scoring the most for a rival of c goes dark (else the best room).
    let pick = -1;
    let top = -1;
    for (const r of this.rooms) {
      const q = this.holder(m, r.index);
      const rival = q >= 0 && q !== m.squads[c.index];
      const v = this.value(r.index) + (rival ? 10 : 0);
      if (v > top) {
        top = v;
        pick = r.index;
      }
    }
    if (pick < 0) return;
    this.dark = { room: pick, until: m.elapsed + ROOMS.dark };
    this.fuseReady = m.elapsed + ROOMS.dark + ROOMS.rest;
    m.emit({ type: "fuse", room: pick, until: this.dark.until, id: c.id });
  }

  // ── Every step ──

  step(m: Match, dt: number): void {
    const t = m.elapsed;
    const melee = m.module<MeleeModule>("melee");
    // Keys: walk onto one.
    for (const k of this.keys) {
      if (k.used) continue;
      if (k.holder >= 0) {
        const c = m.contestants[k.holder];
        k.x = c.x;
        k.z = c.z;
        k.h = c.h;
        continue;
      }
      for (const c of m.contestants) {
        if (c.status !== "alive" || melee?.isDown(c.index) || this.keys.some((o) => o.holder === c.index && !o.used)) continue;
        if (Math.hypot(c.x - k.x, c.z - k.z) > FLAGS.touch || Math.abs(c.h - k.h) > 1) continue;
        k.holder = c.index;
        m.emit({ type: "key", key: k.index, how: "take", id: c.id, x: k.x, z: k.z, h: k.h });
        break;
      }
    }
    // Inside a shut door: held, it jams; let go sooner, it opens.
    for (const c of m.contestants) {
      const i = c.index;
      const room = this.pending[i];
      if (room < 0) continue;
      const d = this.doors[room];
      if (c.status !== "alive" || d.open || this.roomAt(c.x, c.z) !== room) {
        this.pending[i] = -1;
        this.jamming[i] = 0;
        continue;
      }
      if (!m.holding(c)) {
        this.pending[i] = -1;
        this.jamming[i] = 0;
        this.useDoor(m, c, room);
        continue;
      }
      this.jamming[i] += dt;
      if (this.jamming[i] >= ROOMS.jamHold) {
        this.pending[i] = -1;
        this.jamming[i] = 0;
        d.jam = t + ROOMS.jam;
        m.emit({ type: "door", room, open: false, locked: d.locked, jam: d.jam, id: c.id });
      }
    }
    // Shut doors are solid.
    for (const c of m.contestants) if (c.status === "alive") this.keepOut(m, c);
    // Points: a held room pays its squad (shared by whoever of them is inside).
    for (const r of this.rooms) {
      const q = this.holder(m, r.index);
      if (q < 0) continue;
      const inside = m.contestants.filter((c) => c.status === "alive" && m.squads[c.index] === q && this.roomAt(c.x, c.z) === r.index);
      const k = m.module<GadgetsModule>("gadgets")?.boost(m, q, inside[0]?.x ?? 0, inside[0]?.z ?? 0) ?? 1;
      for (const c of inside) this.points[c.index] += (this.value(r.index) * dt * k) / inside.length;
    }
  }

  /** Keep a body out of every shut doorway (it's pushed back the way it came). */
  keepOut(_m: Match, c: Contestant): void {
    const half = MOVE.radius + 0.12;
    for (const r of this.rooms) {
      const d = this.doors[r.index];
      if (d.open) continue;
      const { x, z, nx, nz, w } = r.door;
      const dx = c.x - x;
      const dz = c.z - z;
      // Along the doorway (tx, tz) and across it (the normal).
      const along = dx * -nz + dz * nx;
      const across = dx * nx + dz * nz;
      if (Math.abs(along) > w / 2 + 0.05 || Math.abs(across) >= half) continue;
      const side = across >= 0 ? 1 : -1;
      const push = side * half - across;
      c.x += nx * push;
      c.z += nz * push;
      const into = c.vx * nx + c.vz * nz;
      if (into * side < 0) {
        c.vx -= into * nx;
        c.vz -= into * nz;
      }
    }
  }

  onEvent(m: Match, e: MatchEvent): void {
    // Knocked down or out with a key: it drops.
    if (e.type !== "down" && e.type !== "eliminated") return;
    const c = m.get(e.id);
    if (!c) return;
    for (const k of this.keys) {
      if (k.holder !== c.index || k.used) continue;
      k.holder = -1;
      k.x = c.x;
      k.z = c.z;
      k.h = c.h;
      m.emit({ type: "key", key: k.index, how: "drop", id: c.id, x: c.x, z: c.z, h: c.h });
    }
  }

  timeUp(m: Match): void {
    const st = m.standings();
    const top = st.filter((s) => s.place === 1);
    if (new Set(top.map((s) => s.squad)).size === 1 && top[0] && top[0].objective > 0) m.win(m.get(top[0].id) ?? null, top[0].squad);
  }

  objective(_m: Match, i: number): number {
    return Math.floor(this.points[i] ?? 0);
  }

  /** The copy's points are the server's measures (FfaView sets them); this keeps it close between. */
  setObjective(i: number, v: number): void {
    this.points[i] = v;
  }

  // ── The copy ──

  apply(m: Match, e: MatchEvent): void {
    if (e.type === "door") {
      const d = this.doors[e.room];
      if (!d) return;
      d.open = e.open;
      d.locked = e.locked;
      d.jam = e.jam;
    } else if (e.type === "key") {
      const k = this.keys[e.key];
      const c = e.id ? m.get(e.id) : null;
      if (!k) return;
      if (e.how === "take" && c) k.holder = c.index;
      else if (e.how === "use") {
        k.used = true;
        k.holder = -1;
      } else {
        k.holder = -1;
        k.x = e.x;
        k.z = e.z;
        k.h = e.h;
      }
    } else if (e.type === "fuse") {
      this.dark = { room: e.room, until: e.until };
      this.fuseReady = e.until + ROOMS.rest;
    }
  }

  view(m: Match): void {
    for (const k of this.keys) {
      if (k.holder < 0 || k.used) continue;
      const c = m.contestants[k.holder];
      k.x = c.x;
      k.z = c.z;
      k.h = c.h;
    }
  }
}
