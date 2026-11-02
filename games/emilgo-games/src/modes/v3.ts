// The matches' code (SPEC-V3: Free For All, Dead Streets, the open worlds) as
// one chunk of its own, loaded after the lobby is up (Session.loadV3). The
// lobby never needs it: on slow 4G that was over half a second of the boot.

export { FfaMode } from "./ffa";
export { buildOpenWorldIdle } from "../maps/open/build";
export { buildNaijaWorld } from "../maps/open/naija";
export { buildMaxWorld } from "../maps/open/max";
export { buildSpookyWorld } from "../maps/open/spooky";
