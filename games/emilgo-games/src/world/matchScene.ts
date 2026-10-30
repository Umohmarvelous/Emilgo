// The shared gameplay on screen (SPEC-V3 §7, Phase 3): one match's zone,
// items, Airfall and deaths, drawn, heard and shown on the HUD. Free For All
// and Dead Streets both use it (from Phase 4, through the GameMode seam); the
// dev page `dev/open.html?play=1` plays it on Naija World today.
//
//   events  the sky laser coming down, the fall it picks, respawns, pick-ups,
//           flares, crates, a full backpack: sounds, the feed, the bodies
//   state   every frame: the zone's curtain, the items near you, the crates,
//           your footprints, the HUD (zone, exposure, interact, backpack,
//           effects), the compass's item diamond, the zone on the map, the
//           heartbeat outside the circle

import { Group, type Vector3 } from "three";

import { ITEM_DEFS } from "../content/items";
import type { Match } from "../game/core/match";
import type { MatchEvent } from "../game/core/module";
import type { AirfallModule } from "../game/modules/airfall";
import type { ItemsModule } from "../game/modules/items";
import type { ZoneModule } from "../game/modules/zone";
import type { Tier } from "../graphics/tiers";
import type { Sound } from "../audio/sound";
import type { Hud, ItemPin, MapMark } from "../ui/hud";
import { itemName, type PlayHud, type PlayHudState } from "../ui/play";
import { t } from "../ui/i18n";
import type { Crowd } from "./crowd";
import { Footprints, type Ground } from "./footprints";
import { ItemsView, type ItemsState } from "./items";
import { SkyLaser } from "./skyLaser";
import { ZoneWall } from "./zone";
import type { VehiclesModule } from "../game/modules/vehicles";

/** The compass shows the nearest thing within this distance, metres. */
const PIN_RANGE = 180;

export interface MatchSceneOptions {
  tier: Tier;
  /** The tier's view distance (the zone's curtain fades before the haze). */
  view: number;
  ground: Ground;
  crowd: Crowd;
  hud: Hud;
  play: PlayHud;
  sound: Sound | null;
  /** Your body's index. */
  me: number;
  /** What a footstep lands on at a point (prints only where they'd show). */
  printsAt?: (x: number, z: number, feet: number) => boolean;
}

export class MatchScene {
  readonly group = new Group();
  readonly laser: SkyLaser;
  readonly wall: ZoneWall;
  readonly items: ItemsView;
  readonly prints: Footprints;
  private readonly o: MatchSceneOptions;
  /** Each body's beam, from its laser event to its fall. */
  private readonly beams = new Map<string, { fromYaw: number; lean: number }>();
  private beat = 0;
  private closingSaid = -1;
  private readonly state: { elapsed: number; items: ItemsState["items"]; bags: ItemsState["bags"]; crates: ItemsState["crates"] } = { elapsed: 0, items: [], bags: [], crates: [] };

  constructor(o: MatchSceneOptions) {
    this.o = o;
    this.laser = new SkyLaser(o.tier);
    this.wall = new ZoneWall(o.view, o.tier === 0 ? 64 : 96);
    this.items = new ItemsView(o.tier);
    this.prints = new Footprints(o.ground);
    this.group.add(this.laser.group, this.wall.mesh, this.items.group, this.prints.mesh);
    this.laser.setViewport(innerHeight);
    // Everyone alive wears their backpack.
    o.crowd.setPacks(true);
  }

  /** The match's events since the last frame. */
  events(list: readonly MatchEvent[], m: Match, cam: Vector3): void {
    const me = m.contestants[this.o.me];
    const near = (x: number, z: number, range: number) => Math.max(0, 1 - Math.hypot(x - cam.x, z - cam.z) / range);
    for (const e of list) {
      switch (e.type) {
        case "zone":
          this.o.hud.pushFeed(t("Next circle on the map"));
          break;
        case "laser": {
          const c = m.get(e.id);
          if (!c) break;
          // A car too fast for the sky: the laser comes down where it was, and misses.
          const cars = m.module<VehiclesModule>("vehicles");
          const target = () => (c.status === "alive" && !cars?.hidden(m, c) ? { x: c.x, y: c.h, z: c.z } : null);
          const ang = this.laser.strike(`${e.id}@${e.hitAt.toFixed(2)}`, target, e.hitAt - m.elapsed);
          this.beams.set(e.id, ang);
          this.o.sound?.skyWarn(e.hitAt - m.elapsed, near(c.x, c.z, 120));
          break;
        }
        case "eliminated": {
          const c = m.get(e.id);
          if (!c) break;
          const beam = this.beams.get(e.id);
          if (e.cause === "zone" && beam) {
            this.o.crowd.strike(c.index, c, beam.fromYaw, beam.lean);
            this.o.sound?.skyHit(near(e.x, e.z, 150));
          } else this.o.crowd.kill(c.index, c, c.x - Math.sin(c.heading), c.z - Math.cos(c.heading));
          this.beams.delete(e.id);
          // The backpack drops as a loot bag (or empty, stays behind): it's off the back.
          this.o.crowd.setPack(c.index, false);
          if (c === me) {
            this.o.hud.pushFeed(t("The sky laser got you"), "out");
            this.o.play.openPack(false);
          }
          break;
        }
        case "respawn": {
          const c = m.get(e.id);
          if (!c) break;
          this.o.crowd.revive(c.index);
          this.o.crowd.setPack(c.index, true);
          if (c === me) this.prints.wipe();
          break;
        }
        case "take":
        case "loot":
          if (e.id === me.id) {
            this.o.sound?.pickup();
            if (e.type === "take") this.o.hud.pushFeed(`+ ${itemName(e.kind)}`, "safe");
            else this.o.hud.pushFeed(`+ ${e.kinds.map(itemName).join(", ")}`, "safe");
          }
          break;
        case "use":
          if (e.id === me.id) this.o.sound?.useItem(e.kind === "zobo" || e.kind === "kola");
          break;
        case "full":
          if (e.id === me.id) {
            this.o.sound?.full();
            this.o.hud.pushFeed(t("Your backpack is full"));
          }
          break;
        case "flare":
          this.o.sound?.flare(near(e.x, e.z, 200));
          this.o.hud.pushFeed(t("Airfall: look for the red flare"));
          break;
        case "landed":
          this.o.hud.pushFeed(t("Airfall has landed"));
          break;
        case "open":
          if (e.id === me.id) this.o.sound?.crate();
          break;
        default:
          break;
      }
    }
  }

  /**
   * Every frame, after the match has stepped. `extra`: what a mode adds to
   * the HUD (Free For All: a stash to search or a prop to pick up, at its
   * distance — the nearest thing wins the interact prompt, as on the server;
   * and the objective line).
   */
  update(dt: number, m: Match, cam: Vector3, marks: MapMark[], extra?: { target: (NonNullable<PlayHudState["target"]> & { d: number }) | null; objective: string; car?: PlayHudState["car"]; smoke?: boolean; riddle?: PlayHudState["riddle"] }): { pin: ItemPin | null } {
    const zone = m.module<ZoneModule>("zone");
    const items = m.module<ItemsModule>("items");
    const air = m.module<AirfallModule>("airfall");
    const me = m.contestants[this.o.me];
    const i = me.index;
    const alive = me.status === "alive";

    // ── The world ──
    this.wall.set(zone ? zone.now : null);
    this.wall.update(dt);
    this.state.elapsed = m.elapsed;
    this.state.items = items?.items ?? [];
    this.state.bags = items?.bags ?? [];
    this.state.crates = air?.crates ?? [];
    this.items.update(dt, this.state, cam);
    this.laser.update(dt, cam);
    if (alive) this.prints.follow(me, this.o.printsAt ? this.o.printsAt(me.x, me.z, me.h + me.y) : true);
    this.prints.update(dt);

    // ── The zone on the HUD ──
    let zoneHud: PlayHudState["zone"] = null;
    let outside = false;
    if (zone) {
      const next = zone.next(m.elapsed);
      const final = zone.shown >= zone.phases.length && !next;
      zoneHud = next ? { closesIn: Math.max(0, next.at - m.elapsed), closing: m.elapsed >= next.at, final } : { closesIn: -1, closing: false, final };
      if (next && m.elapsed >= next.at && this.closingSaid !== next.at) {
        this.closingSaid = next.at;
        this.o.sound?.zoneAlert();
        if (alive && Math.hypot(me.x - next.c.x, me.z - next.c.z) > next.c.r) this.o.hud.pushFeed(t("The zone is closing: get inside"));
      }
      outside = alive && !zone.inside(me.x, me.z);
      this.o.hud.map.zone = { now: zone.now, next: next ? next.c : null };
    }
    const exposure = zone ? zone.exposureOf(i) : 0;
    const doomed = zone ? zone.doomed(i) : false;

    // The heartbeat outside: faster and harder as the meter fills.
    if (alive && (outside || doomed) && exposure > 0) {
      this.beat -= dt;
      if (this.beat <= 0) {
        this.o.sound?.heartbeat(exposure);
        this.beat = 0.95 - 0.55 * exposure;
      }
    } else this.beat = 0;

    // ── What interact would do ──
    let target: PlayHudState["target"] = null;
    if (alive && extra?.target && extra.target.d < 0) {
      // In a car: the only thing in reach is the door.
      target = extra.target;
    } else if (alive) {
      const crate = air?.nearest(me) ?? null;
      if (crate) target = { kind: "crate", progress: air!.opening(i) };
      else {
        const tg = items?.target(me) ?? null;
        let d = Infinity;
        if (tg?.item) {
          target = { kind: "item", item: tg.item.kind, progress: 0 };
          d = Math.hypot(tg.item.x - me.x, tg.item.z - me.z);
        } else if (tg?.bag) {
          target = { kind: "bag", left: tg.bag.kinds.length, progress: 0 };
          d = Math.hypot(tg.bag.x - me.x, tg.bag.z - me.z);
        }
        if (extra?.target && extra.target.d < d) target = extra.target;
      }
    }

    const respawn = alive ? -2 : m.respawnIn(me);
    this.o.play.update({
      zone: zoneHud,
      exposure,
      outside,
      doomed,
      pack: items?.packs[i] ?? [],
      target,
      effects: m.effects(me),
      respawn,
      heat: this.laser.heat,
      objective: extra?.objective ?? "",
      car: extra?.car ?? null,
      smoke: extra?.smoke ?? false,
      riddle: extra?.riddle ?? null,
    });

    // ── The compass's diamond and the map's crates ──
    let pin: ItemPin | null = null;
    let best = PIN_RANGE;
    const consider = (x: number, z: number, kind: ItemPin["kind"]) => {
      const d = Math.hypot(x - me.x, z - me.z);
      if (d < best) {
        best = d;
        pin = { x, z, kind };
      }
    };
    if (items) {
      for (const it of items.items) {
        if (it.taken || items.carries(i, it.kind)) continue;
        consider(it.x, it.z, ITEM_DEFS[it.kind].rare ? "rare" : "item");
      }
      for (const b of items.bags) if (b.kinds.length && m.elapsed - b.at < 60) consider(b.x, b.z, "bag");
    }
    if (air) {
      for (const k of air.crates) {
        if (k.opened) continue;
        marks.push({ x: k.x, z: k.z, kind: "crate" });
        consider(k.x, k.z, "crate");
      }
    }
    return { pin };
  }

  dispose(): void {
    this.laser.dispose();
    this.wall.dispose();
    this.items.dispose();
    this.prints.dispose();
  }
}

