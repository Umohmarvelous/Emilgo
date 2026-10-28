// The rule modules a match can run in this build (SPEC-V3 §1.1). The rest are
// known to the content validator but wait for their phases (content/modes.ts
// `BUILT`).

import type { ModuleId } from "../../content/modes";
import type { RuleModule } from "../core/module";
import { AirfallModule } from "./airfall";
import { ItemsModule } from "./items";
import { ZoneModule } from "./zone";

/** Phase 3: the zone, items and Airfall. */
export const MATCH_MODULES: ReadonlySet<ModuleId> = new Set<ModuleId>(["zone", "items", "airfall"]);

/**
 * The modules for a mode's settings, in the order they step: the zone first
 * (it judges exposure and may end a life), then items (a death's loot bag),
 * then Airfall (which hands out items).
 */
export function makeModules(mods: Partial<Record<ModuleId, Record<string, unknown>>>): RuleModule[] {
  const out: RuleModule[] = [];
  if (mods.zone) out.push(new ZoneModule(mods.zone));
  if (mods.items) out.push(new ItemsModule(mods.items));
  if (mods.airfall) out.push(new AirfallModule(mods.airfall));
  return out;
}
