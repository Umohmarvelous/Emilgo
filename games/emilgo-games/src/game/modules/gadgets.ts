// The Free For All extras' items (SPEC-V3 §10.1; Phase 6): what each does in
// the world once it's used from the backpack (items.ts takes it from the pack
// and says "use"; this module hears it). Each has a counter (content/items.ts
// `counter`), so nothing is a sure thing.
//
//   Harmattan Smoke Pot  a cloud where you stand: nobody sees in or out
//                        (the Talking Drum can't find you in it, Lights Out
//                        can't light you). Counter: walk out of it.
//   Banana Peel          dropped behind you; the first rival to run over it
//                        is tripped. Counter: walk or crouch past it, jump it.
//   Pepper Powder        a sneeze in a cone in front: a stagger and a little
//                        wobble. Counter: brace (half), or be behind them.
//   Megaphone            a slow wind-up, then a push wave all round. Counter:
//                        hit them during the wind-up and it's lost.
//   Decoy Flag           a flag at your feet that isn't: a rival who grabs it
//                        is stunned. Counter: it isn't on the compass.
//   Talking Drum         shows you the nearest rival for 5 s, wherever they
//                        are. Counter: a smoke cloud, or a car going fast.
//   Aso-ebi Disguise     you wear a rival squad's colour for 20 s: they see a
//                        squad mate. Counter: it ends the moment you attack.
//
// The power-emote cards (§10.2), dances with an effect:
//   Zanku Bait           rivals within 6 m who face you wobble 20% more for
//                        3 s; you can't move while you dance. Counter: don't
//                        look, or hit the dancer from behind.
//   Shaku Shield         2 s nobody can knock you back, then 2 s slowed.
//   Odogwu Pose          rooted 4 s; your squad's objective counts 10% more
//                        while you pose near it. Counter: push them off it.
//   Breakdance Sweep     trips everyone round you (a jump or a brace beats
//                        it), then you're Dazed.
//
// v6 max (the owner: "every item working perfectly", Treasure Hunt first): the Decoy works in every mode
// (Treasure Hunt: it's a chest; elsewhere a flag) and marks whoever springs it for its owner; the Pulse
// Scanner finds every rival in range, not only the nearest; the Squad Disguise with no squads to copy (solo)
// is camouflage: off every sensor (scanner, Map Print, the carrier warning, auto-shoot), no name over your
// head. Firing ends a disguise, as a swing does. Smoke hides whoever is in it from auto-shoot and name tags.
//
// Pure and seeded like every module; the copy on a phone hears it all as events.

import { GADGETS, MOVE } from "../../config";
import type { ItemId } from "../../content/items";
import { knock } from "../combat";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import type { MeleeModule } from "./melee";
import type { TreasureModule } from "./treasure";
import type { VehiclesModule } from "./vehicles";

export type GadgetKind = "smoke" | "peel" | "powder" | "wave-up" | "wave" | "decoy" | "pop" | "slip" | "sneeze" | "lost" | "zanku" | "shaku" | "odogwu" | "sweep" | "pulse" | "fool" | "fooled";

/** Something an item left in the world: a smoke cloud, a peel, a decoy flag. */
export interface Placed {
  readonly index: number;
  readonly kind: "smoke" | "peel" | "decoy" | "fool";
  readonly x: number;
  readonly z: number;
  readonly h: number;
  /** Whose (body index). */
  readonly by: number;
  readonly at: number;
  until: number;
  /** v7 (H8): Fool's Gold: the treasure it looks like (its index). */
  readonly look?: number;
}

/** v6 max: what `wearing` holds for camouflage (a disguise with no squad to copy). */
export const CAMO = -2;

export class GadgetsModule implements RuleModule {
  readonly id = "gadgets" as const;
  readonly placed: Placed[] = [];
  /** The Talking Drum: who sees whom, until when (v7, H8: by −1: everyone). */
  readonly reveals: { by: number; tg: number; until: number }[] = [];
  /** Aso-ebi: the squad each body wears (−1: their own; CAMO: camouflage, solo), until when. */
  wearing = new Int32Array(0);
  wearUntil = new Float64Array(0);
  /** Megaphones winding up: whose, and when the wave goes. */
  private readonly waves: { by: number; at: number }[] = [];

  constructor(_params: Record<string, unknown> = {}) {}

  init(m: Match): void {
    const n = m.contestants.length;
    this.wearing = new Int32Array(n).fill(-1);
    this.wearUntil = new Float64Array(n);
  }

  // ── Can it be used now? (items.ts asks before taking it from the pack) ──

  can(m: Match, c: Contestant, kind: ItemId): boolean {
    if (m.seated(c) && kind !== "talking-drum" && kind !== "aso-ebi") return false;
    // One dance at a time.
    if ((kind === "zanku" || kind === "odogwu" || kind === "breakdance" || kind === "shaku") && (m.effect(c, "dance") > 0 || m.effect(c, "pose") > 0 || m.effect(c, "shaku-after") > 0)) return false;
    // v6 max: the decoy and the disguise in every mode.
    if (kind === "aso-ebi") return this.wearing[c.index] === -1;
    if (kind === "fools-gold") return !!m.module("treasure");
    if (kind === "megaphone") return !this.waves.some((w) => w.by === c.index);
    return true;
  }

  // ── Used ──

  onEvent(m: Match, e: MatchEvent): void {
    switch (e.type) {
      case "use": {
        const c = m.get(e.id);
        if (c) this.use(m, c, e.kind);
        break;
      }
      // Hit while winding up the megaphone: the wave is lost.
      case "hit": {
        const tg = m.get(e.tg);
        if (!tg) break;
        const k = this.waves.findIndex((w) => w.by === tg.index);
        if (k >= 0) {
          this.waves.splice(k, 1);
          m.emit({ type: "gadget", kind: "lost", n: -1, id: tg.id, x: tg.x, z: tg.z, h: tg.h });
        }
        break;
      }
      // A swing or a shot ends a disguise.
      case "swing":
      case "fire": {
        const c = m.get(e.id);
        if (c && this.wearing[c.index] !== -1) this.unwear(m, c);
        break;
      }
      case "eliminated": {
        const c = m.get(e.id);
        if (!c) break;
        if (this.wearing[c.index] !== -1) this.unwear(m, c);
        for (let k = this.waves.length - 1; k >= 0; k--) if (this.waves[k].by === c.index) this.waves.splice(k, 1);
        break;
      }
      default:
        break;
    }
  }

  private use(m: Match, c: Contestant, kind: ItemId): void {
    const G = GADGETS;
    const t = m.elapsed;
    switch (kind) {
      case "smoke-pot":
        this.place(m, c, "smoke", c.x, c.z, G.smoke.s);
        break;
      case "banana-peel": {
        // Behind you, where whoever's chasing will run.
        const x = c.x - Math.sin(c.heading) * G.peel.behind;
        const z = c.z - Math.cos(c.heading) * G.peel.behind;
        const ok = m.reach.at(x, z);
        this.place(m, c, "peel", ok ? x : c.x, ok ? z : c.z, G.peel.s);
        break;
      }
      case "decoy-flag":
        this.place(m, c, "decoy", c.x, c.z, G.decoy.s);
        break;
      case "fools-gold": {
        // v7 (H8): it looks like one still hidden (nobody has seen that one lying loose), else any of them.
        const tm = m.module<TreasureModule>("treasure");
        const hid = tm ? tm.treasures.filter((x) => x.box !== -1 && x.holder < 0) : [];
        const pool = hid.length ? hid : (tm?.treasures ?? []);
        this.place(m, c, "fool", c.x, c.z, G.fool.s, pool.length ? pool[this.placed.length % pool.length].index : 0);
        break;
      }
      case "pepper-powder": {
        m.emit({ type: "gadget", kind: "powder", n: -1, id: c.id, x: c.x, z: c.z, h: c.h, hd: c.heading });
        const melee = m.module<MeleeModule>("melee");
        for (const o of m.contestants) {
          if (o === c || o.status !== "alive" || m.seated(o) || m.sameSquad(c, o)) continue;
          const dx = o.x - c.x;
          const dz = o.z - c.z;
          const d = Math.hypot(dx, dz);
          if (d > G.powder.r || d < 1e-6) continue;
          const off = Math.acos(Math.max(-1, Math.min(1, (dx * Math.sin(c.heading) + dz * Math.cos(c.heading)) / d)));
          if (off > G.powder.cone || Math.abs(o.h - c.h) > 1.5) continue;
          const braced = melee?.brace[o.index] ? 0.5 : 1;
          o.stun = Math.max(o.stun, G.powder.stun * braced);
          o.sprinting = false;
          if (melee) melee.shove(m, o, dx / d, dz / d, 0.3, G.powder.stun * braced, G.powder.wobble * braced);
          m.emit({ type: "gadget", kind: "sneeze", n: -1, id: o.id, x: o.x, z: o.z, h: o.h });
        }
        break;
      }
      case "megaphone":
        this.waves.push({ by: c.index, at: t + G.wave.windup });
        m.emit({ type: "gadget", kind: "wave-up", n: -1, id: c.id, x: c.x, z: c.z, h: c.h });
        break;
      case "talking-drum": {
        // v6 max: the Pulse Scanner's sweep finds every rival within range (nearest first), not in smoke, not in
        // camouflage, not driving too fast for anyone to see.
        const cars = m.module<VehiclesModule>("vehicles");
        const found: { o: Contestant; d: number }[] = [];
        for (const o of m.contestants) {
          if (o === c || o.status !== "alive" || m.sameSquad(c, o)) continue;
          if (this.hidden(m, o.index) || cars?.hidden(m, o)) continue;
          const d = Math.hypot(o.x - c.x, o.z - c.z);
          if (d <= G.drum.range) found.push({ o, d });
        }
        found.sort((a, b) => a.d - b.d);
        const until = t + G.drum.s;
        for (const f of found.slice(0, G.drum.most)) {
          this.reveals.push({ by: c.index, tg: f.o.index, until });
          m.emit({ type: "reveal", id: c.id, tg: f.o.id, until });
        }
        if (!found.length) m.emit({ type: "reveal", id: c.id, tg: null, until: t });
        m.emit({ type: "gadget", kind: "pulse", n: found.length, id: c.id, x: c.x, z: c.z, h: c.h });
        break;
      }
      case "zanku": {
        m.setEffect(c, "dance", G.zanku.s);
        m.emit({ type: "gadget", kind: "zanku", n: -1, id: c.id, x: c.x, z: c.z, h: c.h, hd: c.heading });
        for (const o of m.contestants) {
          if (o === c || o.status !== "alive" || m.seated(o) || m.sameSquad(c, o)) continue;
          const dx = c.x - o.x;
          const dz = c.z - o.z;
          const d = Math.hypot(dx, dz);
          if (d > G.zanku.r || d < 1e-6 || Math.abs(o.h - c.h) > 1.5) continue;
          // Facing the dancer: watching.
          const look = Math.acos(Math.max(-1, Math.min(1, (dx * Math.sin(o.heading) + dz * Math.cos(o.heading)) / d)));
          if (look <= G.zanku.face) m.setEffect(o, "bait", G.zanku.s, G.zanku.more);
        }
        break;
      }
      case "shaku":
        m.setEffect(c, "shaku", G.shaku.s);
        m.setEffect(c, "shaku-after", G.shaku.s + G.shaku.slow);
        m.emit({ type: "gadget", kind: "shaku", n: -1, id: c.id, x: c.x, z: c.z, h: c.h });
        break;
      case "odogwu":
        m.setEffect(c, "pose", G.odogwu.s);
        m.emit({ type: "gadget", kind: "odogwu", n: -1, id: c.id, x: c.x, z: c.z, h: c.h });
        break;
      case "breakdance": {
        m.emit({ type: "gadget", kind: "sweep", n: -1, id: c.id, x: c.x, z: c.z, h: c.h });
        const melee = m.module<MeleeModule>("melee");
        for (const o of m.contestants) {
          if (o === c || o.status !== "alive" || m.seated(o) || m.sameSquad(c, o)) continue;
          if (Math.hypot(o.x - c.x, o.z - c.z) > G.sweep.r || Math.abs(o.h - c.h) > 0.8) continue;
          if (o.y > 0.15 || melee?.brace[o.index]) continue;
          if (melee) melee.knockdown(m, o, G.sweep.down, "trip", c);
          else o.stun = Math.max(o.stun, G.sweep.down);
        }
        if (melee) melee.knockdown(m, c, G.sweep.daze, "daze", null);
        else c.stun = Math.max(c.stun, G.sweep.daze);
        break;
      }
      case "aso-ebi": {
        // A rival squad's colour; with none to copy (solo), camouflage.
        const q = this.rivalSquad(m, c);
        this.wearing[c.index] = q >= 0 ? q : CAMO;
        this.wearUntil[c.index] = t + G.disguise.s;
        m.emit({ type: "disguise", id: c.id, squad: q >= 0 ? q : CAMO, until: t + G.disguise.s });
        break;
      }
      default:
        break;
    }
  }

  private place(m: Match, c: Contestant, kind: Placed["kind"], x: number, z: number, s: number, look?: number): void {
    const h = m.world.space.floorAt(x, z, c.h + 0.3).h;
    const p: Placed = { index: this.placed.length, kind, x, z, h, by: c.index, at: m.elapsed, until: m.elapsed + s, ...(look !== undefined ? { look } : {}) };
    this.placed.push(p);
    m.emit({ type: "gadget", kind, n: p.index, id: c.id, x, z, h, ...(look !== undefined ? { k: look } : {}) });
  }

  /** The nearest other squad's number (Aso-ebi copies it), or −1 in a mode without squads. */
  private rivalSquad(m: Match, c: Contestant): number {
    const sizes = m.squadSizes();
    if ([...sizes.values()].every((n) => n <= 1)) return -1;
    let best = -1;
    let bestD = Infinity;
    for (const o of m.contestants) {
      if (o.status !== "alive" || o === c || m.sameSquad(c, o)) continue;
      const q = m.squads[o.index];
      if ((sizes.get(q) ?? 0) <= 1) continue;
      const d = Math.hypot(o.x - c.x, o.z - c.z);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best;
  }

  private unwear(m: Match, c: Contestant): void {
    this.wearing[c.index] = -1;
    this.wearUntil[c.index] = 0;
    m.emit({ type: "disguise", id: c.id, squad: -1, until: m.elapsed });
  }

  // ── Every step ──

  /** Before the bodies move: a dancer or a poser is rooted; Shaku's tiredness slows. */
  pre(m: Match): void {
    for (const c of m.contestants) {
      if (c.status !== "alive") continue;
      if (m.effect(c, "dance") > 0 || m.effect(c, "pose") > 0) m.slow(c, 0);
      else if (m.effect(c, "shaku") <= 0 && m.effect(c, "shaku-after") > 0) m.slow(c, GADGETS.shaku.k);
    }
  }

  /** Squad q's objective near (x, z) counts this much (Odogwu Pose: ×1.1 while one of them poses within r). */
  boost(m: Match, q: number, x: number, z: number, r: number = GADGETS.odogwu.r): number {
    for (const c of m.contestants) {
      if (c.status === "alive" && m.squads[c.index] === q && m.effect(c, "pose") > 0 && Math.hypot(c.x - x, c.z - z) <= r) return GADGETS.odogwu.more;
    }
    return 1;
  }

  step(m: Match): void {
    const G = GADGETS;
    const t = m.elapsed;
    const melee = m.module<MeleeModule>("melee");
    // Megaphones: the wave goes.
    for (let k = this.waves.length - 1; k >= 0; k--) {
      const w = this.waves[k];
      if (t < w.at) continue;
      this.waves.splice(k, 1);
      const c = m.contestants[w.by];
      if (c.status !== "alive" || melee?.isDown(c.index)) continue;
      m.emit({ type: "gadget", kind: "wave", n: -1, id: c.id, x: c.x, z: c.z, h: c.h });
      for (const o of m.contestants) {
        if (o === c || o.status !== "alive" || m.seated(o) || m.sameSquad(c, o)) continue;
        const dx = o.x - c.x;
        const dz = o.z - c.z;
        const d = Math.hypot(dx, dz);
        if (d > G.wave.r || Math.abs(o.h - c.h) > 2) continue;
        const ux = d > 1e-6 ? dx / d : Math.sin(c.heading);
        const uz = d > 1e-6 ? dz / d : Math.cos(c.heading);
        const braced = melee?.brace[o.index] ? 0.5 : 1;
        // Strongest close in.
        const k2 = (1 - (d / G.wave.r) * 0.5) * braced;
        if (melee) melee.shove(m, o, ux, uz, G.wave.knock * k2, G.wave.stun * k2, G.wave.wobble * k2);
        else knock(o, ux, uz, G.wave.knock * k2, G.wave.stun * k2);
      }
    }
    // Peels and decoys on the ground.
    for (const p of this.placed) {
      if (p.until <= t || p.kind === "smoke") continue;
      const owner = m.contestants[p.by];
      for (const o of m.contestants) {
        if (o.status !== "alive" || m.seated(o) || o.y > 0.15) continue;
        // The one who put it down has a moment to walk off it; squad mates know it's there.
        if (o === owner && t - p.at < G.peel.safe) continue;
        if (o !== owner && m.sameSquad(owner, o)) continue;
        if (Math.hypot(o.x - p.x, o.z - p.z) > (p.kind === "peel" ? G.peel.r : p.kind === "fool" ? G.fool.r : G.decoy.r) || Math.abs(o.h - p.h) > 0.6) continue;
        if (p.kind === "fool") {
          // v7 (H8): grabbed like a real one (so only by a body that could take one): stunned, and on every map.
          if (o === owner || o.stun > 0 || melee?.isDown(o.index)) continue;
          p.until = t;
          m.emit({ type: "gadget", kind: "fooled", n: p.index, id: o.id, x: p.x, z: p.z, h: p.h });
          o.stun = Math.max(o.stun, G.fool.stun);
          o.sprinting = false;
          if (melee) melee.shove(m, o, 0, 0, 0, G.fool.stun, 0);
          const until = t + G.fool.ping;
          this.reveals.push({ by: -1, tg: o.index, until });
          m.emit({ type: "reveal", id: owner.id, tg: o.id, until, all: true });
        } else if (p.kind === "peel") {
          // Walking (or crouching) past it is safe; running over it isn't.
          if (Math.hypot(o.vx, o.vz) <= MOVE.walk + 0.2 || o.stance > 0) continue;
          p.until = t;
          m.emit({ type: "gadget", kind: "slip", n: p.index, id: o.id, x: p.x, z: p.z, h: p.h });
          if (melee) melee.knockdown(m, o, G.peel.down, "trip", owner);
          else o.stun = Math.max(o.stun, G.peel.down);
        } else {
          if (o === owner) continue;
          p.until = t;
          m.emit({ type: "gadget", kind: "pop", n: p.index, id: o.id, x: p.x, z: p.z, h: p.h });
          o.stun = Math.max(o.stun, G.decoy.stun);
          o.sprinting = false;
          if (melee) melee.shove(m, o, 0, 0, 0, G.decoy.stun, G.decoy.wobble);
          // v6 max: the trap marks them for its owner (on the map and the compass) for a while.
          if (owner.status === "alive") {
            const until = t + G.decoy.mark;
            this.reveals.push({ by: owner.index, tg: o.index, until });
            m.emit({ type: "reveal", id: owner.id, tg: o.id, until });
          }
        }
        break;
      }
    }
    // Disguises wearing off.
    for (const c of m.contestants) if (this.wearing[c.index] !== -1 && t >= this.wearUntil[c.index]) this.unwear(m, c);
    for (let k = this.reveals.length - 1; k >= 0; k--) if (this.reveals[k].until <= t) this.reveals.splice(k, 1);
  }

  /** Inside a smoke cloud now. */
  inSmoke(m: Match, x: number, z: number): boolean {
    for (const p of this.placed) if (p.kind === "smoke" && p.until > m.elapsed && Math.hypot(x - p.x, z - p.z) <= GADGETS.smoke.r) return true;
    return false;
  }

  /** The squad body i shows to others (a disguise), or its own. */
  shownSquad(m: Match, i: number): number {
    return this.wearing[i] >= 0 ? this.wearing[i] : m.squads[i];
  }

  /** v6 max: in camouflage (a solo disguise). */
  camo(i: number): boolean {
    return this.wearing[i] === CAMO;
  }

  /** v6 max: off the sensors and the sights: in camouflage, or inside a smoke cloud. */
  hidden(m: Match, i: number): boolean {
    const c = m.contestants[i];
    return this.wearing[i] === CAMO || (!!c && this.inSmoke(m, c.x, c.z));
  }

  // ── The online client's copy ──

  apply(m: Match, e: MatchEvent): void {
    switch (e.type) {
      case "gadget": {
        if ((e.kind === "smoke" || e.kind === "peel" || e.kind === "decoy" || e.kind === "fool") && e.n >= 0 && !this.placed[e.n]) {
          const by = m.get(e.id ?? "")?.index ?? -1;
          const s = e.kind === "smoke" ? GADGETS.smoke.s : e.kind === "peel" ? GADGETS.peel.s : e.kind === "fool" ? GADGETS.fool.s : GADGETS.decoy.s;
          this.placed[e.n] = { index: e.n, kind: e.kind, x: e.x, z: e.z, h: e.h, by, at: m.elapsed, until: m.elapsed + s, ...(e.k !== undefined ? { look: e.k } : {}) };
        } else if ((e.kind === "slip" || e.kind === "pop" || e.kind === "fooled") && this.placed[e.n]) this.placed[e.n].until = m.elapsed;
        // A dance: the copy roots the dancer too (a phone predicts its own body).
        const c = e.id ? m.get(e.id) : null;
        if (c && e.kind === "zanku") m.setEffect(c, "dance", GADGETS.zanku.s);
        if (c && e.kind === "odogwu") m.setEffect(c, "pose", GADGETS.odogwu.s);
        if (c && e.kind === "shaku") {
          m.setEffect(c, "shaku", GADGETS.shaku.s);
          m.setEffect(c, "shaku-after", GADGETS.shaku.s + GADGETS.shaku.slow);
        }
        break;
      }
      case "reveal": {
        const by = m.get(e.id);
        const tg = e.tg ? m.get(e.tg) : null;
        if (by && tg) this.reveals.push({ by: e.all ? -1 : by.index, tg: tg.index, until: e.until });
        break;
      }
      case "disguise": {
        const c = m.get(e.id);
        if (!c) break;
        this.wearing[c.index] = e.squad;
        this.wearUntil[c.index] = e.until;
        break;
      }
      default:
        break;
    }
  }

  view(m: Match): void {
    for (let k = this.reveals.length - 1; k >= 0; k--) if (this.reveals[k].until <= m.elapsed) this.reveals.splice(k, 1);
  }
}
