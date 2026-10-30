// The GameMode seam (SPEC-V3 §1.1, built in Phase 4 with Free For All, the
// first mode beside Red Light, Green Light). The session (game/session.ts)
// owns what every mode shares — the renderer, the scene and the camera, the
// people, the HUD and the controls, sound, the network, the menus — and hands
// a mode the round: its fixed step, its frame, its messages from the server.
//
// Red Light, Green Light still runs inline in session.ts; it moves behind
// this seam with its rebuild on the shared core (Phase 11).

import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";

import type { Sound } from "../audio/sound";
import type { ModeDef } from "../content/modes";
import type { Standing } from "../game/core/match";
import type { GradeLook } from "../graphics/grade";
import type { TierSpec } from "../graphics/tiers";
import type { Controls } from "../input/controls";
import type { ServerMsg } from "../net/protocol";
import type { HapticKind } from "../platform/types";
import type { Settings } from "../settings";
import type { Hud } from "../ui/hud";
import type { CameraRig } from "../world/camera";
import type { Crowd } from "../world/crowd";
import type { Look } from "../world/human/wardrobe";

export interface GameMode {
  /** Fixed 60 Hz: input in, the match steps, its events out. */
  update(dt: number): void;
  /** Every frame: animate, follow, draw. */
  render(dt: number): void;
  /** A message from the server; true when it was this mode's to handle. */
  receive(m: ServerMsg): boolean;
  /** The match is over (its result has gone to the host). */
  readonly over: boolean;
  dispose(): void;
}

/** What the session lends a mode. */
export interface ModeHost {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly rig: CameraRig;
  readonly crowd: Crowd;
  readonly hud: Hud;
  readonly controls: Controls;
  readonly sound: Sound;
  readonly spec: TierSpec;
  readonly settings: Settings;
  /** The UI layer (for what a mode draws over the game: meters over heads). */
  readonly ui: HTMLElement;
  /** The pause menu is up (online the match goes on: you stand still). */
  readonly paused: boolean;
  /** Draw the scene through the session's film look (post, grade, or the lights). */
  draw(look: GradeLook): void;
  haptic(kind: HapticKind): void;
  /** You, dressed as you are. */
  myLook(): Look;
  /** The match is over: show its result. */
  onEnd(r: ModeResult): void;
  /** Remember the settings (a first-use tip seen). */
  saveSettings(): void;
}

/** A finished Free For All match, for the results screen. */
export interface ModeResult {
  def: ModeDef;
  /** Places (the winner's squad first), with names. */
  standings: (Standing & { name: string; me: boolean; look: Look })[];
  /** Your squad won. */
  won: boolean;
  /** Online (XP comes from the server) or a practice walk. */
  online: boolean;
  /** Seconds of play. */
  seconds: number;
  /** The mode's measure, named ("Seconds held", "Deliveries"…), or "" for none. */
  measure: string;
}
