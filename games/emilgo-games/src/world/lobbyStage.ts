// The lobby: your character on a Lagos street at golden hour.
//
// After the Inside Life references: interlocking pavers, a bungalow under a
// rusty zinc roof, danfos parked under a zinc shed, a wooden kiosk, a patio
// umbrella with plastic chairs, sandbags, palms, a mural wall, the flag, and a
// baobab in the haze. Warm low sun behind, three-point light on the character
// (key, fill, rim). The air is still: no dust, shafts or wind (SPEC-V2).
//
// Depth of field without a post-processing chain: the set behind you is drawn
// once into a small texture, blurred, and shown as the backdrop; only the
// character, the ground under them and the air in front are drawn every frame.
// The backdrop is redrawn only when the camera moves (zoom, a side panel).
//
// Modes: lobby (you), squad (the waiting room: everyone in a circle, you at
// the front; flow/waitingRoom.ts), podium (the
// winner's circle: top three on numbered plinths under spotlights).

import { toGame } from "../ui/rotate";
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  PointLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  SphereGeometry,
  SpotLight,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { TierSpec } from "../graphics/tiers";
import { Human, type Look, type PoseId } from "./human";
import type { EmoteId } from "../social/emotes";
import { circleRadius, circleSpots } from "../flow/waitingRoom";
import { bark, canvasTexture, danfoSkin, flagNg, foliage, frond, glow, mural, paving, plaster, tiled, wood, zinc } from "./tex";

export type StageMode = "lobby" | "squad" | "podium";
/** Where a panel covers the screen, so the character can step aside. */
export type Framing = "center" | "left-panel" | "right-panel" | "bottom-panel" | "full";

interface Member {
  id: string;
  name: string;
  human: Human;
}

export class LobbyStage {
  readonly scene = new Scene(); // what is drawn every frame
  private readonly back = new Scene(); // the set behind (blurred backdrop)
  readonly camera = new PerspectiveCamera(36, 1, 0.1, 400);
  private me: Human | null = null;
  private members: Member[] = [];
  /** The waiting room's circle. */
  private squadR = circleRadius(1);
  private disc: Mesh | null = null;
  private podium: Human[] = [];
  private readonly podiumSet = new Group();
  private readonly streetSet = new Group();
  private readonly near = new Group();
  private mode: StageMode = "lobby";
  private framing: Framing = "center";
  private yaw = 0;
  private yawVel = 0;
  private zoom = 1;
  private idle = 0;
  private time = 0;
  private dragging: { id: number; x: number; t: number } | null = null;
  private pinch: { a: number; b: number; d: number } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private readonly camPos = new Vector3();
  private readonly camLook = new Vector3();
  private readonly wantPos = new Vector3();
  private readonly wantLook = new Vector3();
  private flag: Mesh | null = null;
  private flagBase: Float32Array | null = null;
  private readonly key: DirectionalLight;
  private readonly spots: SpotLight[] = [];
  /** Everything light / dark mode changes (SPEC-V2 §6.4). */
  private readonly lit: {
    hemi: HemisphereLight;
    sunBack: DirectionalLight;
    amb: AmbientLight;
    fill: DirectionalLight;
    rim: DirectionalLight;
    hemi2: HemisphereLight;
    sky?: Mesh;
    sun?: Mesh;
    halo?: Mesh;
    lampBulb?: Mesh;
    lampLight?: PointLight;
  };
  private palette: "golden" | "day" | "night" = "golden";
  private spec: TierSpec;
  // Depth of field.
  private rt: WebGLRenderTarget | null = null;
  private rt2: WebGLRenderTarget | null = null;
  private blurMat: ShaderMaterial | null = null;
  private showMat: ShaderMaterial | null = null;
  private readonly quad = new Mesh(new PlaneGeometry(2, 2));
  private readonly quadScene = new Scene();
  private readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private backDirty = true;
  private readonly lastCam = new Vector3();
  private readonly size = new Vector2();
  /** Sets the camera aspect; call on resize. */
  aspect = 1;

  constructor(
    private readonly renderer: WebGLRenderer,
    spec: TierSpec,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.spec = spec;
    // Golden hour: warm haze, low sun behind, the street glowing.
    // const sky = new Color(0x000000);
    const sky = new Color(0xf2b06a);
    this.back.background = sky;
    this.back.fog = new Fog(0xe8a868, 14, 70);
    this.scene.fog = new Fog(0xe8a868, 14, 70);

    // ── Light ──
    const hemi = new HemisphereLight(0xffd9a8, 0x5a4030, 1.05);
    this.back.add(hemi);
    const sunBack = new DirectionalLight(0xffb070, 2.4);
    sunBack.position.set(-12, 9, -20);
    const amb = new AmbientLight(0xffe2c0, 0.25);
    this.back.add(sunBack, amb);
    // On the character: key (warm, front right), fill (cool, front left), rim (sun, behind).
    this.key = new DirectionalLight(0xffe0b8, 3.0);
    this.key.position.set(2.5, 3.2, 5.5);
    const fill = new DirectionalLight(0xbfd0ff, 0.9);
    fill.position.set(-4, 2, 4);
    const rim = new DirectionalLight(0xffa860, 3.2);
    rim.position.set(-3, 4, -6);
    const hemi2 = new HemisphereLight(0xffd9a8, 0x4a3426, 0.7);
    this.scene.add(this.key, fill, rim, hemi2);
    this.lit = { hemi, sunBack, amb, fill, rim, hemi2 };
    if (spec.shadows) {
      this.key.castShadow = true;
      this.key.shadow.mapSize.set(spec.shadowSize, spec.shadowSize);
      const c = this.key.shadow.camera;
      c.left = -3;
      c.right = 3;
      c.top = 3;
      c.bottom = -1;
      c.near = 1;
      c.far = 16;
      this.key.shadow.bias = -0.0008;
      this.key.shadow.normalBias = 0.02;
    }

    this.buildStreet();
    this.buildNear();
    this.buildPodium();
    this.back.add(this.streetSet);
    this.scene.add(this.near, this.podiumSet);
    this.podiumSet.visible = false;
    this.quadScene.add(this.quad);
    this.quad.frustumCulled = false;

    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  /** Accepting drags/zoom (only while the lobby shows). */
  interactive = false;

  /**
   * Light / dark mode (SPEC-V2 §6.4): golden hour (the lobby's own look),
   * full daylight with the lamp off, or full night with the lamp on.
   */
  setLightMode(mode: "auto" | "light" | "dark"): void {
    const p = mode === "dark" ? "night" : mode === "light" ? "day" : "golden";
    if (p === this.palette) return;
    this.palette = p;
    const L = this.lit;
    const P = {
      golden: { bg: 0xf2b06a, fog: 0xe8a868, far: 70, hemi: [0xffd9a8, 0x5a4030, 1.05], sun: [0xffb070, 2.4], amb: [0xffe2c0, 0.25], key: [0xffe0b8, 3.0], fill: [0xbfd0ff, 0.9], rim: [0xffa860, 3.2], hemi2: [0xffd9a8, 0x4a3426, 0.7], sky: [0x3d4f86, 0xe39a5b, 0xffc178], disc: [0xffd090, -60, 22, 36], lamp: 0 },
      day: { bg: 0xcfe2ee, fog: 0xd6e4ec, far: 90, hemi: [0xe8f2ff, 0x6a5a48, 1.25], sun: [0xfff4e0, 2.2], amb: [0xffffff, 0.3], key: [0xfff6ea, 2.6], fill: [0xd0e0ff, 1.0], rim: [0xffffff, 1.6], hemi2: [0xe8f2ff, 0x5a4a3a, 0.8], sky: [0x4f8fd8, 0x9cc4ea, 0xd6e6f0], disc: [0xfff8e8, 30, 120, 28], lamp: 0 },
      night: { bg: 0x0b1226, fog: 0x101a30, far: 55, hemi: [0x6a7ab0, 0x1a1a24, 0.75], sun: [0x9fb4ff, 1.0], amb: [0x8090c0, 0.16], key: [0xffdcb0, 2.4], fill: [0x8fa8ff, 0.8], rim: [0x9fb8ff, 2.2], hemi2: [0x7080b0, 0x1a1a24, 0.55], sky: [0x060a18, 0x121c38, 0x24304e], disc: [0xdfe8ff, 50, 70, 14], lamp: 14 },
    }[p];
    (this.back.background as Color).set(P.bg);
    for (const f of [this.back.fog as Fog, this.scene.fog as Fog]) {
      f.color.set(P.fog);
      f.far = P.far;
    }
    L.hemi.color.set(P.hemi[0]);
    L.hemi.groundColor.set(P.hemi[1]);
    L.hemi.intensity = P.hemi[2];
    L.sunBack.color.set(P.sun[0]);
    L.sunBack.intensity = P.sun[1];
    L.amb.color.set(P.amb[0]);
    L.amb.intensity = P.amb[1];
    this.key.color.set(P.key[0]);
    this.key.intensity = P.key[1];
    L.fill.color.set(P.fill[0]);
    L.fill.intensity = P.fill[1];
    L.rim.color.set(P.rim[0]);
    L.rim.intensity = P.rim[1];
    L.hemi2.color.set(P.hemi2[0]);
    L.hemi2.groundColor.set(P.hemi2[1]);
    L.hemi2.intensity = P.hemi2[2];
    if (L.sky) {
      const top = new Color(P.sky[0]);
      const mid = new Color(P.sky[1]);
      const hor = new Color(P.sky[2]);
      const pos = L.sky.geometry.attributes.position;
      const col = L.sky.geometry.attributes.color;
      const c = new Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 180;
        if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
        else c.copy(hor).lerp(mid, Math.max(0, y / 0.25));
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    }
    if (L.sun) {
      (L.sun.material as MeshBasicMaterial).color.set(P.disc[0]);
      L.sun.position.set(P.disc[1], P.disc[2], -150);
      L.sun.scale.setScalar(P.disc[3] / 36);
      L.sun.lookAt(0, 2, 0);
    }
    // The street lamp: off in daylight, on at golden hour and at night.
    const lampOn = p !== "day";
    if (L.halo) L.halo.visible = lampOn;
    if (L.lampBulb) (L.lampBulb.material as MeshBasicMaterial).color.set(lampOn ? 0xffe2a0 : 0x8a8a84);
    if (L.lampLight) L.lampLight.intensity = P.lamp;
    this.backDirty = true;
  }

  setSpec(spec: TierSpec): void {
    this.spec = spec;
    this.key.castShadow = spec.shadows;
    if (spec.shadows) this.key.shadow.mapSize.set(spec.shadowSize, spec.shadowSize);
    this.backDirty = true;
  }

  // ── Who stands here ────────────────────────────────────────────────────────

  setLook(look: Look, pose: PoseId): void {
    const tier = this.spec.tier;
    if (this.me && JSON.stringify(this.me.look) === JSON.stringify(look) && this.me.tier === tier) {
      this.me.setPose(pose);
      return;
    }
    const old = this.me;
    this.me = new Human(look, tier, { featured: true, seed: 3, lit: this.spec.pbr ? "standard" : "lambert" });
    this.me.castShadows(this.spec.shadows);
    this.me.setPose(pose);
    if (old) {
      // Keep the pose timing so a change of clothes doesn't jolt.
      this.me.anim.time = old.anim.time;
      old.dispose();
    }
    this.scene.add(this.me.mesh);
  }

  setPose(pose: PoseId): void {
    this.me?.setPose(pose);
  }

  emote(id: EmoteId): void {
    this.me?.emote(id);
  }

  /** Room members (not you): the rest of the circle. */
  setSquad(list: { id: string; name: string; look: Look }[]): void {
    const keep = new Map(this.members.map((m) => [m.id, m]));
    const next: Member[] = [];
    for (const p of list.slice(0, 19)) {
      const old = keep.get(p.id);
      if (old && JSON.stringify(old.human.look) === JSON.stringify(p.look)) {
        next.push(old);
        keep.delete(p.id);
        continue;
      }
      const h = new Human(p.look, Math.max(0, this.spec.tier - 1) as 0 | 1, { seed: next.length + 7, lit: this.spec.pbr ? "standard" : "lambert" });
      h.castShadows(this.spec.shadows);
      h.setPose((["relaxed", "arms", "hip", "relaxed", "hero"] as const)[next.length % 5]);
      this.scene.add(h.mesh);
      next.push({ id: p.id, name: p.name, human: h });
    }
    for (const m of keep.values()) m.human.dispose();
    this.members = next;
    const spots = circleSpots(next.length + 1);
    this.squadR = circleRadius(next.length + 1);
    this.members.forEach((m, i) => {
      const s = spots[i + 1];
      m.human.mesh.position.set(s.x, 0, s.z);
      m.human.mesh.rotation.y = s.facing;
    });
    this.placeDisc();
    this.backDirty = true;
  }

  /** The pavers under the circle (or under you). */
  private placeDisc(): void {
    if (!this.disc) return;
    const squad = this.mode === "squad";
    this.disc.position.z = squad ? -this.squadR : 0;
    this.disc.scale.setScalar(squad ? Math.max(1, (this.squadR + 1.6) / 4.2) : 1);
  }

  /** The winner's circle: up to three people, first in the middle. */
  setPodium(looks: Look[]): void {
    for (const h of this.podium) h.dispose();
    this.podium = looks.slice(0, 3).map((l, i) => {
      const h = new Human(l, i === 0 ? this.spec.tier : (Math.max(0, this.spec.tier - 1) as 0 | 1), { featured: i === 0, seed: 11 + i, lit: this.spec.pbr ? "standard" : "lambert" });
      h.castShadows(this.spec.shadows);
      h.setPose(i === 0 ? "hero" : i === 1 ? "arms" : "hip");
      if (i === 0) h.finish();
      this.podiumSet.add(h.mesh);
      return h;
    });
    const spots: [number, number, number][] = [
      [0, 0.6, 0],
      [-1.5, 0.4, 0.25],
      [1.5, 0.25, -0.25],
    ];
    this.podium.forEach((h, i) => {
      const [x, y, f] = spots[i];
      h.mesh.position.set(x, y, 0);
      h.mesh.rotation.y = f;
    });
  }

  setMode(mode: StageMode): void {
    this.mode = mode;
    const pod = mode === "podium";
    this.podiumSet.visible = pod;
    this.near.visible = !pod;
    for (const s of this.spots) s.visible = pod;
    if (this.me) this.me.mesh.visible = !pod;
    for (const m of this.members) m.human.mesh.visible = mode === "squad";
    this.backDirty = true;
    this.yaw = 0;
    this.zoom = 1;
    this.placeDisc();
  }

  setFraming(f: Framing): void {
    if (f !== this.framing) this.backDirty = true;
    this.framing = f;
  }

  // ── Input: drag to turn, pinch or wheel to zoom ────────────────────────────

  private onDown = (e: PointerEvent): void => {
    if (!this.interactive || this.mode === "podium") return;
    this.pointers.set(e.pointerId, toGame(e.clientX, e.clientY));
    if (this.pointers.size === 1) this.dragging = { id: e.pointerId, x: toGame(e.clientX, e.clientY).x, t: performance.now() };
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.entries()];
      this.pinch = { a: a[0], b: b[0], d: Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y) };
      this.dragging = null;
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, toGame(e.clientX, e.clientY));
    if (this.pinch) {
      const a = this.pointers.get(this.pinch.a);
      const b = this.pointers.get(this.pinch.b);
      if (a && b) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom = Math.max(0.55, Math.min(1.6, this.zoom * (d / Math.max(1, this.pinch.d))));
        this.pinch.d = d;
        this.backDirty = true;
      }
      return;
    }
    if (this.dragging && this.dragging.id === e.pointerId) {
      const gx = toGame(e.clientX, e.clientY).x;
      const dx = gx - this.dragging.x;
      const now = performance.now();
      const dt = Math.max(1, now - this.dragging.t) / 1000;
      this.yaw += dx * 0.012;
      this.yawVel = (dx * 0.012) / dt;
      this.dragging.x = gx;
      this.dragging.t = now;
      this.idle = 0;
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.dragging?.id === e.pointerId) this.dragging = null;
    if (this.pinch && (e.pointerId === this.pinch.a || e.pointerId === this.pinch.b)) this.pinch = null;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.interactive || this.mode === "podium") return;
    e.preventDefault();
    this.zoom = Math.max(0.55, Math.min(1.6, this.zoom * Math.exp(-e.deltaY * 0.0012)));
    this.backDirty = true;
  };

  // ── Every frame ────────────────────────────────────────────────────────────

  update(dt: number): void {
    this.time += dt;
    this.idle += dt;
    // Turntable: coast after a flick, then ease back to face the camera.
    if (!this.dragging) {
      this.yaw += this.yawVel * dt;
      this.yawVel *= Math.exp(-dt * 4);
      if (this.idle > 4 && Math.abs(this.yawVel) < 0.05) this.yaw += Math.atan2(Math.sin(-this.yaw), Math.cos(-this.yaw)) * (1 - Math.exp(-dt * 1.2));
    }
    if (this.me && this.mode !== "podium") {
      this.me.mesh.rotation.y = this.yaw;
      this.me.update(dt, 0, 0, 0);
    }
    for (const m of this.members) m.human.update(dt, 0, m.human.anim.stance, 0);
    for (const h of this.podium) h.update(dt, 0, 0, 0);

    // Everything else stands still (SPEC-V2: no dust, light shafts, wind or flicker).

    this.frame(dt);
  }

  private frame(dt: number): void {
    const z = this.zoom;
    let dist = 4.1 / z;
    let lookY = 0.98;
    let side = 0;
    let lift = 0;
    let high = 0.72;
    let lookZ = 0;
    if (this.mode === "squad") {
      // The whole circle in view, from a little above.
      const r = this.squadR;
      // A big circle from higher up, so the back row's name tags clear the front's.
      dist = (3.2 + r * 2.5) / z;
      high = 2.4 + r * (r > 2 ? 2 : 1.3);
      lookY = 0.6;
      lookZ = -r * 0.9;
    } else if (this.mode === "podium") {
      dist = 6.4;
      lookY = 1.25;
    }
    // A panel covers part of the screen: step the character into the clear part.
    const portrait = this.aspect < 1;
    if (this.framing === "left-panel" && !portrait) side = -dist * 0.22;
    if (this.framing === "right-panel" && !portrait) side = dist * 0.22;
    if (this.framing === "bottom-panel" || ((this.framing === "left-panel" || this.framing === "right-panel") && portrait)) lift = -0.5 / z;
    if (portrait && this.mode !== "podium") {
      // Tall screen: the character stands in the clear band between the tabs
      // and the bottom stack, a little higher than centre.
      dist *= this.mode === "squad" ? 1.7 : 1.25;
      lookY -= 0.5;
    }
    // Low angle: heroic.
    this.wantPos.set(side, high + lift * 0.2, dist);
    this.wantLook.set(side, lookY + lift, lookZ);
    const k = 1 - Math.exp(-dt * 5);
    if (this.camPos.lengthSq() === 0) {
      this.camPos.copy(this.wantPos);
      this.camLook.copy(this.wantLook);
    }
    this.camPos.lerp(this.wantPos, k);
    this.camLook.lerp(this.wantLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.fov = portrait ? 46 : 34;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    if (this.camPos.distanceToSquared(this.lastCam) > 0.0004) this.backDirty = true;
  }

  /** Draw the lobby. */
  render(): void {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    if (this.mode === "podium") {
      // The winner's circle is its own dark stage: no backdrop.
      r.setClearColor(0x07080a);
      r.autoClear = true;
      r.render(this.scene, this.camera);
      return;
    }
    if (!this.spec.dof) {
      // No blur: the set, then the foreground over it sharing the depth buffer.
      r.autoClear = true;
      r.render(this.back, this.camera);
      r.autoClear = false;
      r.render(this.scene, this.camera);
      r.autoClear = true;
      return;
    }
    this.ensureTargets();
    if (this.backDirty && !this.dragging) {
      // Backdrop: the set at half resolution, then blurred twice.
      this.backDirty = false;
      this.lastCam.copy(this.camPos);
      r.setRenderTarget(this.rt!);
      r.render(this.back, this.camera);
      this.blur(this.rt!, this.rt2!, 1, 0);
      this.blur(this.rt2!, this.rt!, 0, 1);
      this.blur(this.rt!, this.rt2!, 2, 0);
      this.blur(this.rt2!, this.rt!, 0, 2);
      r.setRenderTarget(null);
    }
    r.autoClear = false;
    r.clear();
    this.quad.material = this.showMat!;
    this.showMat!.uniforms.tex.value = this.rt!.texture;
    r.render(this.quadScene, this.ortho);
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.autoClear = true;
  }

  private ensureTargets(): void {
    const w = Math.max(64, Math.round(this.size.x / 2));
    const h = Math.max(64, Math.round(this.size.y / 2));
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    this.rt?.dispose();
    this.rt2?.dispose();
    this.rt = new WebGLRenderTarget(w, h);
    this.rt2 = new WebGLRenderTarget(w, h);
    if (!this.blurMat) {
      this.blurMat = new ShaderMaterial({
        uniforms: { tex: { value: null }, dir: { value: new Vector2() } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
          void main(){
            vec4 c = texture2D(tex, vUv) * 0.2270270270;
            c += texture2D(tex, vUv + dir * 1.3846153846) * 0.3162162162;
            c += texture2D(tex, vUv - dir * 1.3846153846) * 0.3162162162;
            c += texture2D(tex, vUv + dir * 3.2307692308) * 0.0702702703;
            c += texture2D(tex, vUv - dir * 3.2307692308) * 0.0702702703;
            gl_FragColor = c;
          }`,
        depthTest: false,
        depthWrite: false,
      });
      this.showMat = new ShaderMaterial({
        uniforms: { tex: { value: null } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `uniform sampler2D tex; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tex, vUv); }`,
        depthTest: false,
        depthWrite: false,
      });
    }
    this.backDirty = true;
  }

  private blur(src: WebGLRenderTarget, dst: WebGLRenderTarget, dx: number, dy: number): void {
    const m = this.blurMat!;
    m.uniforms.tex.value = src.texture;
    m.uniforms.dir.value.set(dx / src.width, dy / src.height);
    this.quad.material = m;
    this.renderer.setRenderTarget(dst);
    this.renderer.render(this.quadScene, this.ortho);
  }

  /** Screen px of a point on a squad member / podium place (name tags, plates). */
  project(world: Vector3, w: number, h: number): { x: number; y: number } | null {
    const v = world.clone().project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  }

  /** Where each squad member's head is (screen px), by id. */
  squadTags(w: number, h: number, meId: string | null): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    for (const m of this.members) {
      const p = this.project(m.human.mesh.position.clone().add(new Vector3(0, m.human.anim.stance > 0.5 ? 1.35 : 2.05, 0)), w, h);
      if (p) out.set(m.id, p);
    }
    if (meId && this.me) {
      const p = this.project(new Vector3(0, 2.05, 0), w, h);
      if (p) out.set(meId, p);
    }
    return out;
  }

  /** Under each podium place (screen px). */
  podiumPlates(w: number, h: number): ({ x: number; y: number } | null)[] {
    return this.podium.map((p) => this.project(p.mesh.position.clone().add(new Vector3(0, -0.08, 0.6)), w, h));
  }

  get triangles(): number {
    return (this.me?.triangles ?? 0) + this.members.reduce((t, m) => t + m.human.triangles, 0);
  }

  // ── The set ────────────────────────────────────────────────────────────────

  private mat(color: number | string, map?: Texture | null, opts: { rough?: number; metal?: number } = {}): Material {
    return this.spec.pbr
      ? new MeshStandardMaterial({ color, map: map ?? null, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0 })
      : new MeshLambertMaterial({ color, map: map ?? null });
  }

  private texSize(): number {
    return this.spec.tier === 2 ? 512 : this.spec.tier === 1 ? 256 : 128;
  }

  private buildStreet(): void {
    const S = this.streetSet;
    const ts = this.texSize();
    const add = (m: Mesh, x: number, y: number, z: number, ry = 0) => {
      m.position.set(x, y, z);
      m.rotation.y = ry;
      S.add(m);
      return m;
    };

    // Sky dome: deep blue up, burning orange at the horizon, the sun low behind.
    const skyGeo = new SphereGeometry(180, 24, 12);
    const skyCols: number[] = [];
    const pos = skyGeo.attributes.position;
    const top = new Color(0x3d4f86);
    const mid = new Color(0xe39a5b);
    const hor = new Color(0xffc178);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 180;
      const c = y > 0.25 ? mid.clone().lerp(top, Math.min(1, (y - 0.25) / 0.6)) : hor.clone().lerp(mid, Math.max(0, y / 0.25));
      skyCols.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute("color", new BufferAttribute(new Float32Array(skyCols), 3));
    const sky = new Mesh(skyGeo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
    S.add(sky);
    this.lit.sky = sky;
    const sun = new Mesh(new PlaneGeometry(36, 36), new MeshBasicMaterial({ map: canvasTexture("glow", 128, glow, false), color: 0xffd090, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }));
    sun.position.set(-60, 22, -150);
    sun.lookAt(0, 2, 0);
    S.add(sun);
    this.lit.sun = sun;

    // Ground: pavers near, asphalt road behind.
    const pav = tiled(canvasTexture("paving", ts, paving), 14, 14);
    const ground = new Mesh(new PlaneGeometry(60, 60), this.mat(0xffffff, pav));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    S.add(ground);

    // The bungalow (insidelife_background2): pastel walls, louvre windows, rusty hip roof.
    const plas = canvasTexture("plaster", ts, plaster);
    const house = new Group();
    const walls = new Mesh(new BoxGeometry(9, 3.2, 6), this.mat(0xf2e3a8, tiled(plas, 3, 1)));
    walls.position.y = 1.6;
    house.add(walls);
    const roofGeo = new ConeGeometry(7.4, 2.2, 4, 1);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1.25, 1, 0.85);
    const roof = new Mesh(roofGeo, this.mat(0xffffff, tiled(canvasTexture("zinc", ts, zinc), 4, 2), { rough: 0.7, metal: 0.3 }));
    roof.position.y = 4.3;
    house.add(roof);
    for (const x of [-2.6, 2.6]) {
      const win = new Mesh(new BoxGeometry(1.4, 1.2, 0.08), this.mat(0x5a6a72, null, { rough: 0.3 }));
      win.position.set(x, 1.8, 3.02);
      house.add(win);
      for (let k = 0; k < 6; k++) {
        const louvre = new Mesh(new BoxGeometry(1.36, 0.06, 0.1), this.mat(0xd8dde0, null, { rough: 0.25, metal: 0.4 }));
        louvre.position.set(x, 1.3 + k * 0.19, 3.08);
        louvre.rotation.x = -0.4;
        house.add(louvre);
      }
    }
    const door = new Mesh(new BoxGeometry(1.1, 2.2, 0.1), this.mat(0x6b3a22, tiled(canvasTexture("wood", ts, wood), 1, 1)));
    door.position.set(0, 1.1, 3.03);
    house.add(door);
    add(house as unknown as Mesh, -9.5, 0, -18, 0.12);

    // The danfo shed (insidelife_background): posts, a rusty roof, two danfos.
    const shed = new Group();
    const zincT = tiled(canvasTexture("zinc", ts, zinc), 5, 2);
    const shedRoof = new Mesh(new BoxGeometry(10, 0.12, 5.4), this.mat(0xffffff, zincT, { rough: 0.65, metal: 0.35 }));
    shedRoof.position.y = 3.1;
    shedRoof.rotation.x = 0.08;
    shed.add(shedRoof);
    for (const x of [-4.7, 0, 4.7]) for (const z of [-2.4, 2.4]) {
      const post = new Mesh(new CylinderGeometry(0.08, 0.1, 3.1, 8), this.mat(0x6b5a45, null));
      post.position.set(x, 1.55, z);
      shed.add(post);
    }
    for (const [x, rot] of [
      [-2.4, 0.04],
      [2.3, -0.05],
    ] as const) {
      const d = this.danfo(ts);
      d.position.set(x, 0, 0.2);
      d.rotation.y = rot;
      shed.add(d);
    }
    add(shed as unknown as Mesh, 10, 0, -17.5, -0.15);

    // Kiosk (wooden, painted), umbrella with plastic chairs, sandbags.
    const kiosk = new Group();
    const kb = new Mesh(new BoxGeometry(1.8, 2.2, 1.6), this.mat(0x6fd08a, tiled(canvasTexture("wood", ts, wood), 1, 1)));
    kb.position.y = 1.1;
    kiosk.add(kb);
    const kr = new Mesh(new BoxGeometry(2.3, 0.08, 2.1), this.mat(0xffffff, zincT, { metal: 0.3 }));
    kr.position.y = 2.32;
    kr.rotation.x = -0.12;
    kiosk.add(kr);
    const counter = new Mesh(new BoxGeometry(1.6, 0.08, 0.5), this.mat(0xc62828, null));
    counter.position.set(0, 1.05, 0.95);
    kiosk.add(counter);
    add(kiosk as unknown as Mesh, 4.6, 0, -10.5, -0.4);

    const umb = new Group();
    const pole = new Mesh(new CylinderGeometry(0.03, 0.03, 2.3, 6), this.mat(0xdddddd, null, { metal: 0.6, rough: 0.3 }));
    pole.position.y = 1.15;
    umb.add(pole);
    const canopy = new Mesh(new ConeGeometry(1.4, 0.5, 12, 1, true), this.mat(0x5a6fa8, null));
    canopy.position.y = 2.2;
    (canopy.material as Material).side = DoubleSide;
    umb.add(canopy);
    const table = new Mesh(new CylinderGeometry(0.45, 0.45, 0.05, 16), this.mat(0xf2f2f2, null));
    table.position.y = 0.72;
    umb.add(table);
    for (const [cx, cz, cr] of [
      [-0.8, 0.3, 0.6],
      [0.75, -0.2, -2.2],
    ] as const) {
      umb.add(this.plasticChair(cx, cz, cr));
    }
    add(umb as unknown as Mesh, -4.8, 0, -9.5);

    const bags = new Group();
    for (let i = 0; i < 6; i++) {
      const b = new Mesh(new RoundedBoxGeometry(0.6, 0.22, 0.32, 2, 0.08), this.mat(0xc9b48a, null, { rough: 1 }));
      b.position.set((i % 3) * 0.58 - 0.58, 0.11 + Math.floor(i / 3) * 0.22, (i % 2) * 0.05);
      b.rotation.y = (i % 2) * 0.1;
      bags.add(b);
    }
    add(bags as unknown as Mesh, 7, 0, -8, 0.3);

    // Hedges and flowers along the plot (Inside Life's gardens).
    const fol = canvasTexture("foliage", ts, foliage);
    for (let i = 0; i < 9; i++) {
      const h = new Mesh(new SphereGeometry(0.7 + (i % 3) * 0.15, 10, 8), this.mat(0xffffff, fol));
      h.scale.y = 0.75;
      h.position.set(-11 + i * 2.6, 0.45, -13 - (i % 2) * 0.4);
      S.add(h);
      if (i % 2 === 0) {
        const fl = new Mesh(new SphereGeometry(0.22, 8, 6), this.mat(i % 4 ? 0xd7263d : 0xffd700, null));
        fl.position.set(-10.6 + i * 2.6, 0.95, -12.6);
        S.add(fl);
      }
    }

    // Palms, swaying.
    for (const [x, z, hgt] of [
      [-13, -11, 7.5],
      [13.5, -12, 8.5],
      [-15, -16, 9],
      [14, -18, 8],
    ] as const) {
      S.add(this.palm(x, z, hgt, ts));
    }

    // Mural wall far back, a lamp post, the flag, a baobab in the haze.
    const muralWall = new Mesh(new BoxGeometry(14, 4.5, 0.4), this.mat(0xffffff, canvasTexture("mural", Math.max(256, ts), mural, false)));
    add(muralWall, 0, 2.25, -27);
    const lamp = new Group();
    const lp = new Mesh(new CylinderGeometry(0.06, 0.09, 4.2, 8), this.mat(0x2b2d31, null, { metal: 0.5, rough: 0.5 }));
    lp.position.y = 2.1;
    lamp.add(lp);
    const lh = new Mesh(new SphereGeometry(0.2, 10, 8), new MeshBasicMaterial({ color: 0xffe2a0 }));
    lh.position.y = 4.25;
    lamp.add(lh);
    const halo = new Mesh(new PlaneGeometry(1.6, 1.6), new MeshBasicMaterial({ map: canvasTexture("glow", 128, glow, false), color: 0xffcf80, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    halo.position.y = 4.25;
    lamp.add(halo);
    const lampLight = new PointLight(0xffd8a0, 0, 10, 1.6);
    lampLight.position.y = 4.1;
    lamp.add(lampLight);
    add(lamp as unknown as Mesh, 1.8, 0, -14.5);
    this.lit.halo = halo;
    this.lit.lampBulb = lh;
    this.lit.lampLight = lampLight;

    const flagPole = new Mesh(new CylinderGeometry(0.04, 0.05, 5.5, 6), this.mat(0xd0d0d0, null, { metal: 0.6, rough: 0.3 }));
    add(flagPole, -5.6, 2.75, -15);
    const fg = new PlaneGeometry(1.8, 1.1, 12, 6);
    const flag = new Mesh(fg, this.mat(0xffffff, canvasTexture("flag-ng", 64, flagNg, false)));
    (flag.material as Material).side = DoubleSide;
    flag.position.set(-4.7, 4.85, -15);
    S.add(flag);
    this.flag = flag;
    this.flagBase = (fg.attributes.position.array as Float32Array).slice();
    this.drapeFlag();

    S.add(this.baobab(-22, -34, ts));
    S.add(this.baobab(26, -40, ts));
  }

  private danfo(ts: number): Group {
    const g = new Group();
    const skin = canvasTexture("danfo", Math.max(128, ts / 2), danfoSkin, false);
    const body = new Mesh(new RoundedBoxGeometry(1.95, 1.9, 4.6, 3, 0.18), this.mat(0xffffff, skin, { rough: 0.45, metal: 0.1 }));
    body.position.y = 1.35;
    g.add(body);
    const ws = new Mesh(new BoxGeometry(1.6, 0.7, 0.05), this.mat(0x22303a, null, { rough: 0.1, metal: 0.2 }));
    ws.position.set(0, 1.85, 2.31);
    ws.rotation.x = -0.15;
    g.add(ws);
    const bumper = new Mesh(new BoxGeometry(2.0, 0.2, 0.2), this.mat(0x151515, null, { rough: 0.5 }));
    bumper.position.set(0, 0.5, 2.32);
    g.add(bumper);
    const rack = new Mesh(new BoxGeometry(1.5, 0.08, 2.4), this.mat(0x5a4632, null));
    rack.position.set(0, 2.36, -0.3);
    g.add(rack);
    for (const [x, z] of [
      [0.92, 1.5],
      [-0.92, 1.5],
      [0.92, -1.45],
      [-0.92, -1.45],
    ]) {
      const w = new Mesh(new CylinderGeometry(0.36, 0.36, 0.26, 14), this.mat(0x141414, null, { rough: 0.9 }));
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.36, z);
      g.add(w);
    }
    for (const x of [0.62, -0.62]) {
      const l = new Mesh(new CircleGeometry(0.13, 12), new MeshBasicMaterial({ color: 0xfff6d0 }));
      l.position.set(x, 0.85, 2.33);
      g.add(l);
    }
    return g;
  }

  private plasticChair(x: number, z: number, ry: number): Group {
    const c = new Group();
    const m = this.mat(0x1f6f3a, null, { rough: 0.4 });
    const seat = new Mesh(new RoundedBoxGeometry(0.45, 0.05, 0.45, 2, 0.02), m);
    seat.position.y = 0.45;
    c.add(seat);
    const back = new Mesh(new RoundedBoxGeometry(0.45, 0.45, 0.04, 2, 0.02), m);
    back.position.set(0, 0.7, -0.21);
    back.rotation.x = -0.15;
    c.add(back);
    for (const [lx, lz] of [
      [0.19, 0.19],
      [-0.19, 0.19],
      [0.19, -0.19],
      [-0.19, -0.19],
    ]) {
      const leg = new Mesh(new CylinderGeometry(0.02, 0.025, 0.45, 6), m);
      leg.position.set(lx, 0.22, lz);
      c.add(leg);
    }
    c.position.set(x, 0, z);
    c.rotation.y = ry;
    return c;
  }

  private palm(x: number, z: number, h: number, ts: number): Group {
    const g = new Group();
    const trunk = new Mesh(new CylinderGeometry(0.16, 0.26, h, 10, 6), this.mat(0xffffff, tiled(canvasTexture("bark", ts / 2, bark), 1, 4)));
    // A gentle lean.
    trunk.position.y = h / 2;
    trunk.rotation.z = 0.06;
    g.add(trunk);
    const tex = canvasTexture("frond", ts, frond, false);
    const fm = this.spec.pbr
      ? new MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: DoubleSide, roughness: 0.8 })
      : new MeshLambertMaterial({ map: tex, alphaTest: 0.4, side: DoubleSide });
    for (let i = 0; i < 9; i++) {
      const f = new Mesh(new PlaneGeometry(1.3, 3.6, 1, 4), fm);
      // Bend each frond down along its length.
      const p = f.geometry.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k) + 1.8;
        p.setZ(k, -y * y * 0.12);
        p.setY(k, y);
      }
      f.geometry.computeVertexNormals();
      const pivot = new Group();
      pivot.position.set(Math.sin(0.06) * -h * 0.5 + h * 0.03, h, 0);
      pivot.rotation.y = (i / 9) * Math.PI * 2;
      f.rotation.x = -1.1 + (i % 2) * 0.25;
      pivot.add(f);
      g.add(pivot);
    }
    g.position.set(x, 0, z);
    return g;
  }

  /** The baobab (trees1 / IMG_7779): a fat bottle trunk, short stubby branches, a flat crown. */
  private baobab(x: number, z: number, ts: number): Group {
    const g = new Group();
    const bt = tiled(canvasTexture("bark", ts / 2, bark), 2, 2);
    const trunkGeo = new CylinderGeometry(1.5, 2.4, 9, 14, 6);
    const p = trunkGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = 1 + Math.sin(((y + 4.5) / 9) * Math.PI) * 0.35; // the bottle bulge
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    trunkGeo.computeVertexNormals();
    const trunk = new Mesh(trunkGeo, this.mat(0xb8a690, bt));
    trunk.position.y = 4.5;
    g.add(trunk);
    const fol = canvasTexture("foliage", ts / 2, foliage);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const br = new Mesh(new CylinderGeometry(0.25, 0.5, 3.4, 6), this.mat(0xa8957e, bt));
      br.position.set(Math.cos(a) * 1.4, 9.8, Math.sin(a) * 1.4);
      br.rotation.z = Math.cos(a) * 0.7;
      br.rotation.x = -Math.sin(a) * 0.7;
      g.add(br);
      const crown = new Mesh(new SphereGeometry(1.8, 10, 6), this.mat(0x6f8f3a, fol));
      crown.scale.y = 0.45;
      crown.position.set(Math.cos(a) * 2.8, 11.2, Math.sin(a) * 2.8);
      g.add(crown);
    }
    g.position.set(x, 0, z);
    return g;
  }

  /** The foreground: the ground under your feet (sharp), and its contact shadow. */
  private buildNear(): void {
    const ts = this.texSize();
    // A disc of pavers that fades out, so the sharp ground meets the blurred one.
    const disc = new Mesh(
      new CircleGeometry(4.2, 40),
      new ShaderMaterial({
        uniforms: { map: { value: tiled(canvasTexture("paving", ts, paving), 1, 1) }, tint: { value: new Color(0xffe6c4) } },
        vertexShader: `varying vec2 vUv; varying vec2 vP; void main(){ vUv = uv; vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D map; uniform vec3 tint; varying vec2 vUv; varying vec2 vP;
          void main(){
            vec3 c = texture2D(map, vP * 0.115).rgb * tint;
            float r = length(vP) / 4.2;
            gl_FragColor = vec4(c * 0.92, 1.0 - smoothstep(0.55, 1.0, r));
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.002;
    this.near.add(disc);
    this.disc = disc;
    // A soft contact shadow under your feet (always, even without shadow maps).
    const contact = new Mesh(new CircleGeometry(0.55, 24), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, map: canvasTexture("glow", 64, glow, false), depthWrite: false }));
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.004;
    this.near.add(contact);
    if (this.spec.shadows) {
      // Shadow-only ground: the character's real shadow on the pavers.
      const catcher = new Mesh(new PlaneGeometry(6, 6), new ShadowMaterial({ opacity: 0.35 }));
      catcher.rotation.x = -Math.PI / 2;
      catcher.position.y = 0.006;
      catcher.receiveShadow = true;
      this.near.add(catcher);
    }
  }

  /** The winner's circle: a dark stage, three numbered plinths, steady spotlights. */
  private buildPodium(): void {
    const P = this.podiumSet;
    const floor = new Mesh(new CircleGeometry(9, 48), this.mat(0x15171a, null, { rough: 0.35, metal: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    P.add(floor);
    const heights = [0.6, 0.4, 0.25];
    const xs = [0, -1.5, 1.5];
    for (let i = 0; i < 3; i++) {
      const b = new Mesh(new RoundedBoxGeometry(1.25, heights[i], 1.1, 2, 0.04), this.mat(i === 0 ? 0x2a2a2e : 0x222226, null, { rough: 0.4, metal: 0.5 }));
      b.position.set(xs[i], heights[i] / 2, 0);
      b.receiveShadow = true;
      P.add(b);
      const edge = new Mesh(new BoxGeometry(1.26, 0.02, 0.02), new MeshBasicMaterial({ color: i === 0 ? 0xffd700 : 0xffffff }));
      edge.position.set(xs[i], heights[i], 0.56);
      P.add(edge);
    }
    // Back wall panels with thin light strips.
    for (let i = -4; i <= 4; i++) {
      const panel = new Mesh(new BoxGeometry(1.6, 5, 0.1), this.mat(0x1d2024, null, { rough: 0.6, metal: 0.3 }));
      panel.position.set(i * 1.7, 2.5, -3.2 - Math.abs(i) * 0.25);
      panel.rotation.y = -i * 0.08;
      P.add(panel);
      const strip = new Mesh(new BoxGeometry(0.03, 4.6, 0.02), new MeshBasicMaterial({ color: 0x9fd8ff }));
      strip.position.set(i * 1.7 + 0.78, 2.5, -3.14 - Math.abs(i) * 0.25);
      P.add(strip);
    }
    P.add(new HemisphereLight(0x9fb0c8, 0x101014, 0.6));
    for (let i = 0; i < 3; i++) {
      const s = new SpotLight(0xfff2dc, 60, 14, 0.42, 0.6, 1.6);
      s.position.set(xs[i], 7, 2.5);
      s.target.position.set(xs[i], heights[i], 0);
      s.castShadow = this.spec.shadows && i === 0;
      s.visible = false;
      P.add(s, s.target);
      this.spots.push(s);
    }
  }

  /** The flag hangs in still folds (no wind). */
  private drapeFlag(): void {
    if (!this.flag || !this.flagBase) return;
    const p = this.flag.geometry.attributes.position;
    const a = p.array as Float32Array;
    const b = this.flagBase;
    for (let i = 0; i < p.count; i++) {
      const x = b[i * 3] + 0.9; // 0 at the pole
      a[i * 3 + 2] = Math.sin(x * 3.2) * 0.07 * x;
    }
    p.needsUpdate = true;
    this.flag.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.rt?.dispose();
    this.rt2?.dispose();
  }
}
