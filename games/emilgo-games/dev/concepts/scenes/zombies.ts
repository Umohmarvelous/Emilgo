// Dev only (concept renders): Dead Streets' zombies at night.
//   zombies       the eight kinds coming up the street in your torch beam
//   zombie-close  a Shambler's face in the beam
//   zombie-rise   emerging: hands through the ground → torso → up → the lunge

import { Color, DirectionalLight, FogExp2, HemisphereLight, Mesh, MeshBasicMaterial, AdditiveBlending, PlaneGeometry, Scene, Vector3, PointLight, SpotLight } from "three";
import { ready } from "./characters";
import { poseZombie, zombie, ZKINDS, type ZKind } from "../lib/zombie";
import { reach } from "../lib/gear";
import { ruinStreet, shaft, texturesReady } from "../lib/sets";
import { bloodDecal, tex } from "../lib/tex";
import { camera, done, draw, hdri, useSky } from "../lib/stage";

async function night(scene: Scene): Promise<void> {
  const sky = await hdri("qwantani_moonrise_puresky");
  ruinStreet(scene, sky, { fog: 0.045, fogColor: 0x1c0807, embers: true });
  await useSky(scene, "qwantani_moonrise_puresky", { background: true, intensity: 0.12, bgIntensity: 0.18 });
  scene.fog = new FogExp2(0x1d0807, 0.05);
  scene.add(new HemisphereLight(0x3a2026, 0x060304, 0.4));
  const moon = new DirectionalLight(0x9fb4ff, 0.7);
  moon.position.set(30, 40, -60);
  scene.add(moon);
  // Fires down the street: red-orange rims.
  for (const [x, z] of [[-6, -14], [7, -22], [-3, -32]] as const) {
    const f = new PointLight(0xff4a14, 60, 18, 2);
    f.position.set(x, 1.2, z);
    scene.add(f);
  }
  await texturesReady();
}

/** The player's torch from just under the camera: a hard beam, its shadows, a faint cone in the haze. */
function torch(scene: Scene, from: Vector3, to: Vector3, power = 260, angle = 0.32): void {
  const s = new SpotLight(0xe8f0ff, power, 0, angle, 0.45, 2);
  s.position.copy(from);
  s.target.position.copy(to);
  s.castShadow = true;
  s.shadow.mapSize.set(2048, 2048);
  s.shadow.bias = -0.0002;
  s.shadow.normalBias = 0.02;
  scene.add(s, s.target);
  if (location.search.includes("shaft")) shaft(scene, 0xfff0dc, [from.x, from.y, from.z], [to.x, to.y - 1, to.z], 0.05, Math.tan(angle) * from.distanceTo(to), 0.03);
}

export default async function render(name: string): Promise<void> {
  await ready();
  const scene = new Scene();
  await night(scene);
  const cam = camera(32);
  const look = { exposure: 1.15, bloom: [0.7, 0.5, 0.85] as [number, number, number], split: { shadow: [0.22, 0.05, 0.04] as [number, number, number], high: [1, 0.9, 0.82] as [number, number, number], amount: 0.2 }, saturation: 0.9, contrast: 1.12, vignette: 0.5, grain: 0.06, rays: null };

  if (name === "zombies") {
    const spots: [ZKind, number, number, number][] = [
      ["brute", -0.4, -7.5, 0.1],
      ["shambler", -2.6, -5.2, 0.35],
      ["screamer", 2.4, -8.6, -0.2],
      ["bloater", 1.4, -5.6, -0.25],
      ["runner", -1.2, -3.4, 0.15],
      ["masked", 3.6, -4.4, -0.4],
      ["crawler", 0.6, -2.4, 0.05],
      ["lurker", -4.2, -3.2, 0.45],
    ];
    spots.forEach(([k, x, z, yaw], i) => {
      const zb = zombie(k, i + 2);
      zb.h.mesh.position.set(x, k === "lurker" ? -0.75 : 0, z);
      scene.add(zb.h.mesh);
      poseZombie(zb, yaw, 0.3 + i * 0.07);
    });
    cam.position.set(0.3, 1.45, 3.2);
    cam.lookAt(0.1, 1.0, -6);
    torch(scene, new Vector3(0.55, 1.25, 2.9), new Vector3(0, 0.9, -6));
    draw({ scene, cam, look });
    done({ kinds: ZKINDS.length });
    return;
  }

  if (name === "tps-dead") {
    const { operator } = await import("../lib/gear");
    const { holdRifle, settle } = await import("./characters");
    const me = operator({ kit: "ash" });
    scene.add(me.h.mesh);
    settle(me, Math.PI);
    holdRifle(scene, me, "ads");
    const spots: [ZKind, number, number, number][] = [
      ["shambler", -0.8, -6.5, 0.1],
      ["runner", 1.4, -8.5, -0.2],
      ["bloater", -2.4, -11, 0.3],
      ["shambler", 2.6, -13, -0.3],
      ["screamer", 0.2, -16, 0],
    ];
    spots.forEach(([k, x, z, yaw], i) => {
      const zb = zombie(k, i + 20);
      zb.h.mesh.position.set(x, 0, z);
      scene.add(zb.h.mesh);
      poseZombie(zb, yaw, 0.3 + i * 0.1);
    });
    cam.fov = 52;
    cam.position.set(0.55, 1.62, 2.5);
    cam.lookAt(-0.3, 1.35, -20);
    torch(scene, new Vector3(0.15, 1.35, -0.6), new Vector3(0, 0.9, -12), 1400, 0.42);
    torch(scene, new Vector3(0.9, 2.2, 3.2), new Vector3(0, 1.2, -9), 45, 0.5);
    draw({ scene, cam, look: { ...look, exposure: 1.45 } });
    done();
    return;
  }

  if (name === "zombie-close") {
    const zb = zombie("shambler", 4);
    scene.add(zb.h.mesh);
    poseZombie(zb, 0.15, 0.4);
    // Head up for the portrait: undo the loll.
    zb.h.bone("head").quaternion.identity();
    zb.h.bone("head").updateMatrix();
    zb.h.posed();
    const head = zb.h.bone("head").getWorldPosition(new Vector3());
    cam.fov = 18;
    cam.position.set(head.x + 0.25, head.y + 0.05, head.z + 1.25);
    cam.lookAt(head.x, head.y + 0.03, head.z);
    torch(scene, new Vector3(head.x + 0.5, head.y - 0.12, head.z + 1.5), head, 26, 0.35);
    const rim = new PointLight(0xff3a10, 3, 4, 2);
    rim.position.set(head.x - 0.8, head.y + 0.3, head.z - 0.8);
    scene.add(rim);
    draw({ scene, cam, look: { ...look, dof: [1.25, 0.004], exposure: 1.2 } });
    done();
    return;
  }

  if (name === "zombie-rise") {
    // Four moments side by side, each over its own crack in the road.
    const crack = new MeshBasicMaterial({ map: tex(bloodDecal(256, 9, 0)), transparent: true, depthWrite: false, color: new Color(0x050302) });
    const frames: [number, number, string][] = [
      [-2.55, -1.18, "hands"],
      [-0.85, -0.62, "torso"],
      [0.85, 0, "up"],
      [2.55, 0, "lunge"],
    ];
    frames.forEach(([x, y, f], i) => {
      const zb = zombie("shambler", 10 + i);
      zb.h.mesh.position.set(x, y, -1.5);
      scene.add(zb.h.mesh);
      if (f === "lunge") {
        zb.kind = "runner";
        poseZombie(zb, -0.35, 0.6);
      } else poseZombie(zb, 0.1, 0.5);
      const h = zb.h;
      h.mesh.updateMatrixWorld(true);
      const at = (b: string) => h.bone(b as never).getWorldPosition(new Vector3());
      if (f === "hands") {
        // Clawing up out of the road.
        reach(h, "R", new Vector3(x - 0.18, 0.28, -1.35), at("upperArmR").add(new Vector3(-0.3, 0, 0.2)));
        reach(h, "L", new Vector3(x + 0.16, 0.36, -1.3), at("upperArmL").add(new Vector3(0.3, 0, 0.2)));
        h.posed();
      } else if (f === "torso") {
        // Hands flat on the road, hauling itself out.
        reach(h, "R", new Vector3(x - 0.32, 0.02, -1.15), at("upperArmR").add(new Vector3(-0.4, 0.2, -0.2)));
        reach(h, "L", new Vector3(x + 0.3, 0.02, -1.1), at("upperArmL").add(new Vector3(0.4, 0.2, -0.2)));
        h.posed();
      }
      if (f === "hands" || f === "torso") {
        const c = new Mesh(new PlaneGeometry(1.5, 1.5), crack);
        c.rotation.x = -Math.PI / 2;
        c.position.set(x, 0.01, -1.4);
        scene.add(c);
      }
    });
    cam.fov = 40;
    cam.position.set(0, 1.25, 4.6);
    cam.lookAt(0, 0.75, -1.5);
    torch(scene, new Vector3(0.5, 1.5, 3.4), new Vector3(0, 0.5, -1.5), 220, 0.62);
    draw({ scene, cam, look: { ...look, exposure: 1.3 } });
    done();
  }
}
