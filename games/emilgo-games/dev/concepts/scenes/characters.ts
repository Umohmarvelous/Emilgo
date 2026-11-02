// Dev only (concept renders): the tactical operator and the armour ladder.
//   operator       hero shot: low-ready with the rifle, in the hangar's haze
//   operator-turn  front, three-quarter, side, back
//   operator-face  the eyes through the slit, helmet and comms
//   armour         the five armour tiers, Operator → Titan, to scale

import { DirectionalLight, Group, HemisphereLight, Matrix4, Scene, Vector3 } from "three";
import { loadScans } from "../../../src/world/human";
import { loadScanLevel } from "../../../src/world/human/scanbody";
import { rifle, type Rarity } from "../lib/arms";
import { grip, operator, reach, TIERS, type Operator } from "../lib/gear";
import { hangar, ruinStreet, shaft, spot, studio, texturesReady } from "../lib/sets";
import { camera, done, draw, hdri, useSky } from "../lib/stage";

export async function ready(): Promise<void> {
  await loadScans();
  await Promise.all([loadScanLevel(2), loadScanLevel(3)]);
}

/** Let the idle settle (breathing, weight shift), facing `yaw`. */
export function settle(op: Operator, yaw = 0, seconds = 1.6): void {
  op.h.mesh.rotation.y = yaw;
  for (let t = 0; t < seconds; t += 1 / 60) op.h.update(1 / 60, 0);
  op.h.mesh.updateMatrixWorld(true);
}

/** Put a rifle in the operator's hands: "low" (low ready) or "ads" (aiming down sights). */
export function holdRifle(scene: Scene | Group, op: Operator, mode: "low" | "ads" | "port" = "low", rarity: Rarity = "common"): Group {
  const h = op.h;
  h.mesh.updateMatrixWorld(true);
  const s = h.mesh.scale.y;
  const shR = h.bone("upperArmR").getWorldPosition(new Vector3());
  const shL = h.bone("upperArmL").getWorldPosition(new Vector3());
  const fwd = new Vector3(0, 0, 1).applyQuaternion(h.mesh.quaternion);
  const left = new Vector3(1, 0, 0).applyQuaternion(h.mesh.quaternion);
  const up = new Vector3(0, 1, 0);
  const gun = rifle(rarity);
  gun.scale.setScalar(Math.min(1.25, s));
  let butt: Vector3;
  let dir: Vector3;
  if (mode === "ads") {
    butt = shR.clone().addScaledVector(left, 0.07 * s).addScaledVector(up, 0.0).addScaledVector(fwd, 0.05 * s);
    dir = fwd.clone().addScaledVector(left, 0.04).normalize();
  } else if (mode === "port") {
    butt = shR.clone().addScaledVector(left, 0.02 * s).addScaledVector(up, -0.32 * s).addScaledVector(fwd, 0.12 * s);
    dir = fwd.clone().multiplyScalar(0.55).addScaledVector(up, 0.75).addScaledVector(left, 0.38).normalize();
  } else {
    butt = shR.clone().addScaledVector(left, 0.06 * s).addScaledVector(up, -0.1 * s).addScaledVector(fwd, 0.08 * s);
    dir = fwd.clone().addScaledVector(up, -0.6).addScaledVector(left, 0.3).normalize();
  }
  gun.position.copy(butt);
  gun.up.copy(up);
  gun.lookAt(butt.clone().add(dir));
  scene.add(gun);
  gun.updateMatrixWorld(true);
  const W = (x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(gun.matrixWorld);
  // Wrists a hand's length short of the grips.
  reach(h, "R", W(-0.012, -0.075, 0.265), shR.clone().addScaledVector(left, -0.35).addScaledVector(up, -0.5).addScaledVector(fwd, -0.15));
  reach(h, "L", W(0.02, -0.02, 0.56), shL.clone().addScaledVector(left, 0.45).addScaledVector(up, -0.6).addScaledVector(fwd, 0.1));
  grip(h, "R", 1);
  grip(h, "L", 0.9);
  h.posed();
  return gun;
}

/** Outdoors at sunset: the ruined street, the sky turned so the sun is behind the subject, haze. */
export async function sunsetStreet(scene: Scene, skyName = "industrial_sunset_02_puresky", want = new Vector3(-0.35, 0, -1)): Promise<{ sun: Vector3 }> {
  const sky = await hdri(skyName);
  const st = ruinStreet(scene, sky, { fog: 0.016, fogColor: 0x7a5a44 });
  // Turn the sky so its sun sits where we want it (azimuth only).
  const az = Math.atan2(st.sun.z, st.sun.x);
  const azWant = Math.atan2(want.z, want.x);
  const rot = azWant - az;
  await useSky(scene, skyName, { background: true, intensity: 0.8, rotation: rot });
  const c = Math.cos(-rot);
  const sn = Math.sin(-rot);
  const sun = new Vector3(st.sun.x * Math.cos(rot) + st.sun.z * Math.sin(rot) * 0 , st.sun.y, 0);
  void c; void sn; void sun;
  const dir = new Vector3(Math.cos(azWant) * Math.cos(Math.asin(st.sun.y)), st.sun.y, Math.sin(azWant) * Math.cos(Math.asin(st.sun.y))).normalize();
  const light = new DirectionalLight(0xffb070, 3.2);
  light.position.copy(dir).multiplyScalar(60);
  light.castShadow = true;
  light.shadow.mapSize.set(4096, 4096);
  const sc = light.shadow.camera;
  sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 160;
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = 0.03;
  scene.add(light, light.target);
  const fill = new HemisphereLight(0x8fa6c8, 0x2a2018, 0.35);
  scene.add(fill);
  await texturesReady();
  return { sun: dir.clone().multiplyScalar(500) };
}

export default async function render(name: string): Promise<void> {
  await ready();
  const scene = new Scene();
  const cam = camera(30);
  const outdoors = name === "operator" || name === "armour" || name === "tps-ffa" || name === "ads" || name === "win";
  let sun = new Vector3(-5.6, 3, -9);
  if (outdoors) {
    sun = (await sunsetStreet(scene)).sun;
  } else if (name === "operator-turn") {
    studio(scene, 0x34363a);
    await useSky(scene, "photo_studio_01", { background: false, intensity: 0.55 });
    await texturesReady();
  } else {
    hangar(scene, { door: 1.5, fog: name === "operator-face" ? 0.01 : 0.022 });
    await useSky(scene, "abandoned_factory_canteen_01", { background: false, intensity: 0.3 });
    await texturesReady();
  }

  if (name === "operator" || name === "operator-face") {
    const op = operator({ kit: "ironwood" });
    scene.add(op.h.mesh);
    settle(op, 0.35);
    holdRifle(scene, op, name === "operator-face" ? "port" : "low");
    spot(scene, 0xdbe6ff, outdoors ? 150 : 110, [2.6, 2.4, 5.0], [0, 1.2, 0], 0.4, 0.8, !outdoors);
    if (!outdoors) {
      spot(scene, 0xff9a48, 260, [-3.4, 3.2, -3.6], [0, 1.4, 0], 0.4, 0.5);
      spot(scene, 0x9cc4ff, 30, [-4, 1.6, 3], [0, 1.3, 0], 0.5, 0.8, false);
      shaft(scene, 0xffc890, [-5.6, 5.5, -8.9], [-1.6, 0, -2], 1.4, 3.6, 0.035);
    }
    if (name === "operator") {
      cam.fov = 26;
      cam.position.set(1.35, 0.95, 3.6);
      cam.lookAt(0.05, 1.08, 0);
      draw({ scene, cam, look: { dof: [3.7, 0.0009], rays: { sun, strength: 0.5, color: [1, 0.8, 0.55] }, bloom: [0.45, 0.5, 0.95], exposure: 0.95 } });
    } else {
      const head = op.h.bone("head").getWorldPosition(new Vector3());
      cam.fov = 14;
      cam.position.set(head.x + 0.32, head.y + 0.14, head.z + 0.95);
      cam.lookAt(head.x, head.y + 0.08, head.z);
      draw({ scene, cam, look: { dof: [1.0, 0.004], bloom: [0.5, 0.5, 0.9], exposure: 1.1, rays: null } });
    }
    done({ tris: op.h.triangles });
    return;
  }

  if (name === "tps-ffa" || name === "ads") {
    // Over the shoulder (the game's camera: 2.5 m back, 0.5 m right, 1.6 m up) / down the sights.
    const me = operator({ kit: "ironwood" });
    scene.add(me.h.mesh);
    settle(me, Math.PI);
    holdRifle(scene, me, "ads");
    const foe = operator({ kit: "ash", tier: 1, seed: 0.9 });
    foe.h.mesh.position.set(-2.4, 0, -17);
    scene.add(foe.h.mesh);
    settle(foe, 0.25);
    const g2 = new Group();
    scene.add(g2);
    holdRifle(g2, foe, "low", "epic");
    const foe2 = operator({ kit: "dune", tier: 2, seed: 1.3 });
    foe2.h.mesh.position.set(4.5, 0, -30);
    scene.add(foe2.h.mesh);
    settle(foe2, -0.4);
    spot(scene, 0xdbe6ff, 90, [2, 3, 6], [0, 1.2, -4], 0.6, 0.8, false);
    if (name === "tps-ffa") {
      cam.fov = 52;
      cam.position.set(0.55, 1.62, 2.5);
      cam.lookAt(-0.6, 1.45, -20);
      draw({ scene, cam, look: { rays: { sun, strength: 0.4, color: [1, 0.8, 0.55] }, bloom: [0.4, 0.5, 0.95], exposure: 0.95, dof: null } });
    } else {
      me.h.mesh.visible = false;
      const head = me.h.bone("head").getWorldPosition(new Vector3());
      cam.fov = 46;
      cam.near = 0.02;
      cam.position.set(head.x - 0.07, head.y + 0.06, head.z - 0.1);
      cam.lookAt(-2.4, 1.45, -17);
      // The rifle in front of the eye, sight on the line of view.
      const gun = scene.children.find((c) => c.name === "rifle")!;
      const target = new Vector3(-2.4, 1.45, -17);
      const dir = target.clone().sub(cam.position).normalize();
      // Eye 12 cm behind the holo sight's window (local 0, 0.124, 0.355): the stock is behind the eye.
      gun.position.copy(cam.position).addScaledVector(dir, 0.34 - 0.355).add(new Vector3(0, -0.124, 0));
      gun.lookAt(gun.position.clone().add(dir));
      draw({ scene, cam, look: { rays: { sun, strength: 0.35 }, bloom: [0.4, 0.5, 0.95], exposure: 0.95, dof: [17.5, 0.0035], vignette: 0.55 } });
    }
    done();
    return;
  }

  if (name === "win") {
    // The MVP pose: a Titan in the final circle, the squad behind.
    const t4 = operator({ tier: 4, seed: 0.5 });
    scene.add(t4.h.mesh);
    settle(t4, 0.15);
    for (const [x, z, k] of [[-1.6, -1.4, 1], [1.7, -1.6, 2]] as const) {
      const o = operator({ tier: k, seed: x + 3 });
      o.h.mesh.position.set(x, 0, z);
      scene.add(o.h.mesh);
      settle(o, 0.1);
      const g3 = new Group();
      scene.add(g3);
      if (k < 2) holdRifle(g3, o, "low", "legendary");
    }
    spot(scene, 0xdbe6ff, 260, [1.5, 3, 6], [0, 1.6, 0], 0.5, 0.8, false);
    cam.fov = 34;
    cam.position.set(0.2, 1.1, 6.4);
    cam.lookAt(0.1, 1.55, 0);
    draw({ scene, cam, look: { rays: { sun, strength: 0.6, color: [1, 0.8, 0.55] }, bloom: [0.55, 0.5, 0.9], exposure: 1.0, dof: [6.4, 0.0012] } });
    done();
    return;
  }

  if (name === "operator-turn") {
    const yaws = [0, 0.75, Math.PI / 2, Math.PI];
    yaws.forEach((y, i) => {
      const op = operator({ kit: "ironwood", seed: 0.3 + i * 0.1 });
      op.h.mesh.position.x = (i - 1.5) * 1.15;
      scene.add(op.h.mesh);
      settle(op, y);
      const g = new Group();
      scene.add(g);
      holdRifle(g, op, "low");
    });
    spot(scene, 0xfff4e8, 420, [3, 6, 8], [0, 1, 0], 0.55, 0.7);
    spot(scene, 0xffb070, 260, [-3, 4, -3.5], [0, 1.3, 0], 0.7, 0.6, false);
    spot(scene, 0x9cc4ff, 120, [-7, 2.5, 5], [0, 1, 0], 0.6, 0.8, false);
    cam.fov = 22;
    cam.position.set(0, 1.0, 9.5);
    cam.lookAt(0, 0.95, 0);
    draw({ scene, cam, look: { rays: null, exposure: 1.0, vignette: 0.25, bloom: [0.2, 0.4, 1] } });
    done();
    return;
  }

  if (name === "armour") {
    let x = -3.3;
    TIERS.forEach((t, i) => {
      const op = operator({ tier: i, seed: 0.2 + i * 0.13 });
      const w = 0.62 * t.scale * t.bulk + 0.5;
      x += w / 2;
      op.h.mesh.position.x = x;
      x += w / 2;
      scene.add(op.h.mesh);
      settle(op, -0.12 + i * 0.03);
      if (i < 2) {
        const g = new Group();
        scene.add(g);
        holdRifle(g, op, "low", i === 0 ? "common" : "rare");
      }
    });
    spot(scene, 0xdbe6ff, 160, [1.5, 6, 8], [0.4, 1.2, 0], 0.5, 0.6, false);
    cam.fov = 30;
    cam.position.set(0.2, 0.9, 8.2);
    cam.lookAt(0.2, 1.25, 0);
    draw({ scene, cam, look: { rays: { sun, strength: 0.45, color: [1, 0.8, 0.55] }, bloom: [0.6, 0.5, 0.9], exposure: 0.95 } });
    done();
    return;
  }
}

export { Matrix4 };
