// Ball Haunt's chunk (SPEC-V3 §1.2): everything only Red Light, Green Light
// uses, behind one dynamic import(). Game.loadRl fetches it with the first
// round (or while the lobby is idle, when Ball Haunt is switched on), so
// while FEATURES.ballHaunt is off the Lagos Life and web builds never
// download it; the EMILGO app's single file carries it and never runs it.

export { songFor, SONGS } from "../audio/songs";
export { Walkout } from "../flow/walkout";
export { attackTarget, canAttack } from "../game/combat";
export { BOT_NAMES, BotBrain } from "../game/bots";
export { CLIP, Highlights } from "../game/highlights";
export { Recorder } from "../game/replay";
export { RedLightRound } from "../game/rules";
export { buildWorld } from "../maps/world";
export { OnlineRound } from "../net/onlineRound";
export { ReplayView } from "../rlgl/replayView";
export { behindShot, finalTwoLens, killCamLens, potgLens, previewShots } from "../rlgl/shots";
export { DEMO, TutorialScript, tutorialPeople, tutorialSteps } from "../rlgl/tutorial";
export { PropsView } from "../world/props";
export { SkyLaser } from "../world/skyLaser";
export { SkyWatcher } from "../world/skyWatcher";
export { buildAtlas } from "../world/textures";
