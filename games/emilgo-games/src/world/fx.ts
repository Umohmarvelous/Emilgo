// Elimination effects, pooled so a crowd of catches never allocates.
//
//   blood   the splatter, the splats and the pools under the bodies (blood.ts)
//
// (The red beam from Mama's eyes went with her in SPEC-V3 Phase 11: Ball
// Haunt's catches are the shared sky laser's, world/skyLaser.ts.)

import { Group, type Vector3 } from "three";

import { Blood } from "./blood";

export class Effects {
  readonly group = new Group();
  readonly blood = new Blood();

  constructor() {
    this.group.add(this.blood.group);
  }

  setBlood(on: boolean): void {
    this.blood.setOn(on);
  }

  /** The shot's splatter: `count` drops from `origin`, mostly along `away` (unit, horizontal). */
  burst(origin: Vector3, away: Vector3, count: number, lasting = true): void {
    this.blood.burst(origin, away, count, lasting);
  }

  clear(): void {
    this.blood.clear();
  }

  update(dt: number): void {
    this.blood.update(dt);
  }
}
