// Dev only: look at the CC0 Universal Animation Library's mannequins and clips.
//   /dev/ual.html?file=ual1&clip=Walk_Loop&t=0.3&cam=front|side|back
import { AmbientLight, AnimationMixer, Box3, DirectionalLight, HemisphereLight, MeshStandardMaterial, PerspectiveCamera, Scene, SkinnedMesh, Vector3, WebGLRenderer, Color, Mesh, PlaneGeometry } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const q = new URLSearchParams(location.search);
const canvas = document.getElementById("c") as HTMLCanvasElement;
const r = new WebGLRenderer({ canvas, antialias: true });
r.setSize(innerWidth, innerHeight);
r.shadowMap.enabled = true;
const scene = new Scene();
scene.background = new Color(0x56606c);
scene.add(new HemisphereLight(0xbfd4ff, 0x40362c, 1.2));
const sun = new DirectionalLight(0xffffff, 2.2);
sun.position.set(2, 4, 3);
sun.castShadow = true;
scene.add(sun, new AmbientLight(0xffffff, 0.2));
const floor = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial({ color: 0x777777 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const cam = new PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 100);
const files = (q.get("file") ?? "ual1").split(",");
const clipName = q.get("clip") ?? "A_TPose";
const t = Number(q.get("t") ?? 0);
let x = -(files.length - 1) * 0.5;
for (const f of files) {
  const g = await new GLTFLoader().loadAsync(`/tools/anim/in/${f}.glb`);
  const root = g.scene;
  root.position.x = x;
  x += 1;
  root.traverse((o) => {
    if ((o as Mesh).isMesh) {
      (o as Mesh).castShadow = true;
      (o as Mesh).material = new MeshStandardMaterial({ color: (o as Mesh).name.includes("Joint") ? 0x333333 : 0x9a9a9a, roughness: 0.6 });
    }
  });
  scene.add(root);
  const src = (await new GLTFLoader().loadAsync(`/tools/anim/in/${q.get("anims") ?? f}.glb`)).animations;
  const c = src.find((a) => a.name === clipName) ?? g.animations.find((a) => a.name === clipName);
  if (c) {
    const mx = new AnimationMixer(root);
    mx.clipAction(c).play();
    mx.setTime(t);
  }
  console.log(f, "meshes", root.children.length, g.animations.length);
}
const box = new Box3().setFromObject(scene.children[scene.children.length - 1]);
const mid = box.getCenter(new Vector3());
const view = q.get("cam") ?? "front";
const d = 2.4 + files.length * 0.6;
const dir = view === "side" ? new Vector3(1, 0.1, 0) : view === "back" ? new Vector3(0, 0.1, -1) : new Vector3(0.25, 0.1, 1);
cam.position.copy(new Vector3(0, mid.y, 0)).addScaledVector(dir.normalize(), d);
cam.lookAt(0, mid.y, 0);
r.render(scene, cam);
(window as unknown as { __done: boolean }).__done = true;
