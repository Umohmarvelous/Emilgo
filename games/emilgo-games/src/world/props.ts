// Ball Haunting's props (SPEC-V2 §2.1, §6.1): the balls and the baskets.
//
//   balls    one instanced mesh — 13 balls, one draw call. A free ball lies on
//            the ground, a held one sits between its holder's hands, a banked
//            one rests in its basket. Positions ease, so a ball knocked loose
//            flies rather than teleports.
//   baskets  woven baskets in a row just past the safe line, one merged mesh.

import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";

import type { Ball, Basket } from "../game/balls";
import type { TierSpec } from "../graphics/tiers";
import { merge } from "./geo";

const R = 0.12;
const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3(1, 1, 1);
const _p = new Vector3();
const UP = new Vector3(0, 1, 0);

/** A playground ball: red with a white band, smooth (≈ 360 triangles: it's 24 cm across). */
function ballGeometry(): BufferGeometry {
  const g = new SphereGeometry(R, 18, 12);
  const pos = g.attributes.position;
  const col: number[] = [];
  const red = new Color(0xc8202c);
  const white = new Color(0xf2efe8);
  for (let i = 0; i < pos.count; i++) {
    const band = Math.abs(pos.getY(i)) < R * 0.28;
    const c = band ? white : red;
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  return g;
}

/** A woven basket: a flared lathe, stripes for the weave (≈ 1,150 triangles). */
function basketGeometry(): BufferGeometry {
  const pts: Vector2[] = [];
  const H = 0.6;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new Vector2(0.34 + 0.12 * t + Math.sin(t * Math.PI) * 0.03, t * H));
  }
  // Rim, then back down inside to a floor.
  pts.push(new Vector2(0.5, H + 0.03), new Vector2(0.44, H), new Vector2(0.4, 0.06), new Vector2(0.0, 0.05));
  const g = new LatheGeometry(pts, 36);
  const pos = g.attributes.position;
  const col: number[] = [];
  const a = new Color(0xb58a4c);
  const b = new Color(0x8a6232);
  const rim = new Color(0x6b4a24);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const ang = Math.atan2(pos.getZ(i), pos.getX(i));
    const weave = (Math.floor(y / 0.05) + Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 36)) % 2 === 0;
    const c = y > H - 0.01 ? rim : weave ? a : b;
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  return g.toNonIndexed();
}

export class PropsView {
  readonly group = new Group();
  private balls: InstancedMesh | null = null;
  private baskets: Mesh | null = null;
  private readonly at: Vector3[] = [];
  private spin: number[] = [];

  constructor(private spec: TierSpec) {}

  setSpec(spec: TierSpec): void {
    this.spec = spec;
  }

  /** A new round: this many balls, these baskets (none in Classic Run). */
  setup(balls: readonly Ball[], baskets: readonly Basket[]): void {
    this.clear();
    if (!balls.length) return;
    const mat = () => (this.spec.pbr ? new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }) : new MeshLambertMaterial({ vertexColors: true }));
    this.balls = new InstancedMesh(ballGeometry(), mat(), balls.length);
    this.balls.instanceMatrix.setUsage(DynamicDrawUsage);
    this.balls.castShadow = this.spec.shadows;
    this.balls.frustumCulled = false;
    this.group.add(this.balls);
    this.at.length = 0;
    this.spin = balls.map(() => 0);
    for (const b of balls) this.at.push(new Vector3(b.x, R, b.z));
    if (baskets.length) {
      const one = basketGeometry();
      const parts = baskets.map((k) => one.clone().translate(k.x, 0, k.z));
      this.baskets = new Mesh(merge(parts), mat());
      this.baskets.castShadow = this.baskets.receiveShadow = this.spec.shadows;
      this.group.add(this.baskets);
    }
  }

  /**
   * Place every ball. `hands(i, out)` gives a holder's hands (null: not drawn).
   * Free balls ease to where the referee says; held ones stick to the hands.
   */
  update(dt: number, balls: readonly Ball[], hands: (holder: number, out: Vector3) => Vector3 | null): void {
    const mesh = this.balls;
    if (!mesh) return;
    const k = 1 - Math.exp(-dt * 14);
    for (const b of balls) {
      const cur = this.at[b.index];
      if (!cur) continue;
      let snap = false;
      if (b.holder >= 0 && b.basket < 0) {
        const h = hands(b.holder, _p);
        if (h) {
          cur.copy(h);
          snap = true;
        } else _p.set(b.x, R, b.z);
      } else if (b.basket >= 0) {
        _p.set(b.x, 0.12 + R, b.z);
      } else {
        _p.set(b.x, R, b.z);
      }
      if (!snap) {
        const dx = _p.x - cur.x;
        const dz = _p.z - cur.z;
        // Rolling: spin with the distance travelled.
        this.spin[b.index] += Math.hypot(dx, dz) * k * (1 / R);
        cur.lerp(_p, k);
        // A loose ball flies a little on its way.
        if (b.holder < 0 && b.basket < 0) cur.y = R + Math.min(0.6, Math.hypot(dx, dz) * 0.25);
      }
      _q.setFromAxisAngle(UP, this.spin[b.index] * 0.3);
      _m.compose(cur, _q, _s);
      mesh.setMatrixAt(b.index, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (const m of [this.balls, this.baskets]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as { dispose(): void }).dispose();
    }
    this.balls = null;
    this.baskets = null;
  }
}
