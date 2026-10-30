// The rule modules a match can run in this build (SPEC-V3 §1.1). The rest are
// known to the content validator but wait for their phases (content/modes.ts
// `BUILT`).

import type { ModuleId } from "../../content/modes";
import type { RuleModule } from "../core/module";
import { AirfallModule } from "./airfall";
import { CaptureModule } from "./capture";
import { DropzonesModule } from "./dropzones";
import { FlagsModule } from "./flags";
import { GadgetsModule } from "./gadgets";
import { ItemsModule } from "./items";
import { MeleeModule } from "./melee";
import { VehiclesModule } from "./vehicles";
import { ZoneModule } from "./zone";

/** Phase 3: the zone, items and Airfall. Phase 4: melee, flags, drop zones, the rally point. Phase 5: vehicles. */
export const MATCH_MODULES: ReadonlySet<ModuleId> = new Set<ModuleId>(["zone", "items", "airfall", "melee", "flags", "dropzones", "capture", "vehicles", "gadgets"]);

/**
 * The modules for a mode's settings, in the order they step: vehicles first
 * (the drivers drive, and riders' buttons are theirs before melee sees
 * them), the zone (it judges exposure and may end a life), then melee (its knockdowns drop
 * what's in your hands), then items (a death's loot bag), Airfall (which
 * hands out items), the drop zones (they move before flags are delivered),
 * flags and the rally point.
 */
export function makeModules(mods: Partial<Record<ModuleId, Record<string, unknown>>>): RuleModule[] {
  const out: RuleModule[] = [];
  if (mods.vehicles) out.push(new VehiclesModule(mods.vehicles));
  if (mods.zone) out.push(new ZoneModule(mods.zone));
  if (mods.melee) out.push(new MeleeModule(mods.melee));
  if (mods.items) {
    out.push(new ItemsModule(mods.items));
    // What the §10 items do in the world comes with them.
    out.push(new GadgetsModule());
  }
  if (mods.airfall) out.push(new AirfallModule(mods.airfall));
  if (mods.dropzones) out.push(new DropzonesModule(mods.dropzones));
  if (mods.flags) out.push(new FlagsModule(mods.flags));
  if (mods.capture) out.push(new CaptureModule(mods.capture));
  return out;
}
