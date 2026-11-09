// Dev only: the game's icon (v5, 3.9; the owner: "the face of the character
// with the mask, the nose and eyes and some portions round them still visible
// like cod ... a sharp sword in a diagonal position ... the name of the game").
// The face is the game's own operator in the open-face mask, rendered here;
// the sword and the name are drawn over it. Needs `npm run dev` on :5173.
//
//   node dev/icon.mjs        → public/icons/icon-{1024,512,192,180}.png (with the name), icon-32.png and icon-bare-512.png (without)
//
// The name (the owner asked for a better one than "Kill Squad"): BLACKMASK.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = "public/icons";
mkdirSync(OUT, { recursive: true });

// In the page: the lobby's operator alone on black, the camera on her face; then a 2D canvas: the
// backdrop, the sword behind her (black keyed out of the render), her face, the name.
const COMPOSE = `(() => {
  const g = __game, st = g.stage, r = g.renderer, scene = st.scene;
  const me = st.me.mesh;
  // Everything but her (and the lights) out of sight: walk down from the scene, into what leads to her only.
  const keep = new Set();
  for (let o = me; o; o = o.parent) keep.add(o);
  const hidden = [];
  const walk = (o) => { for (const ch of o.children) { if (ch === me || ch.isLight) continue; if (keep.has(ch)) walk(ch); else if (ch.visible) { ch.visible = false; hidden.push(ch); } } };
  walk(scene);
  const bg = scene.background; scene.background = null; const fog = scene.fog; scene.fog = null;
  r.setClearColor(0x000000, 1);
  const cam = st.camera;
  const S = 1024;
  r.setPixelRatio(1); r.setSize(S, S, false);
  cam.aspect = 1; cam.fov = 22; cam.position.set(0.15, 1.6, 0.95); cam.lookAt(0.0, 1.5, 0); cam.updateProjectionMatrix();
  r.render(scene, cam);
  const shot = document.createElement('canvas'); shot.width = shot.height = S;
  shot.getContext('2d').drawImage(r.domElement, 0, 0, S, S);
  // Key the black out of the render.
  const sg = shot.getContext('2d'); const img = sg.getImageData(0, 0, S, S); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const l = Math.max(d[i], d[i+1], d[i+2]); if (l < 6) d[i+3] = 0; else if (l < 14) d[i+3] = Math.round(((l - 6) / 8) * 255); }
  sg.putImageData(img, 0, 0);
  const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  // Backdrop: a dark steel field with a warm light behind the head.
  const rg = x.createRadialGradient(S * 0.52, S * 0.4, S * 0.05, S * 0.5, S * 0.5, S * 0.75);
  rg.addColorStop(0, '#3a2a12'); rg.addColorStop(0.35, '#16130f'); rg.addColorStop(1, '#050607');
  x.fillStyle = rg; x.fillRect(0, 0, S, S);
  // The sword, corner to corner behind her: a long blade with a bright edge, a guard, a wrapped grip.
  x.save(); x.translate(S * 0.5, S * 0.52); x.rotate(-Math.PI / 4);
  const L = S * 0.82, W = S * 0.05;
  const bl = x.createLinearGradient(0, -W, 0, W); bl.addColorStop(0, '#f4f6f8'); bl.addColorStop(0.48, '#aab2ba'); bl.addColorStop(0.52, '#5d656d'); bl.addColorStop(1, '#c9d0d6');
  x.fillStyle = bl; x.beginPath(); x.moveTo(-L * 0.55, -W * 0.5); x.lineTo(L * 0.62, -W * 0.5); x.lineTo(L * 0.78, 0); x.lineTo(L * 0.62, W * 0.5); x.lineTo(-L * 0.55, W * 0.5); x.closePath(); x.fill();
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = S * 0.004; x.beginPath(); x.moveTo(-L * 0.5, -W * 0.46); x.lineTo(L * 0.62, -W * 0.46); x.lineTo(L * 0.77, 0); x.stroke();
  x.fillStyle = '#c99a2e'; x.fillRect(-L * 0.58, -W * 1.5, S * 0.03, W * 3);
  x.fillStyle = '#1b1b1d'; x.fillRect(-L * 0.82, -W * 0.42, L * 0.24, W * 0.84);
  x.strokeStyle = '#c99a2e'; x.lineWidth = S * 0.006; for (let k = 0; k < 6; k++) { const px = -L * 0.8 + k * L * 0.04; x.beginPath(); x.moveTo(px, -W * 0.42); x.lineTo(px + L * 0.02, W * 0.42); x.stroke(); }
  x.fillStyle = '#c99a2e'; x.beginPath(); x.arc(-L * 0.84, 0, W * 0.55, 0, Math.PI * 2); x.fill();
  x.restore();
  // Her face over it, a little shadow under.
  x.save(); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = S * 0.03; x.drawImage(shot, 0, -S * 0.04); x.restore();
  // Without the name (the small sizes: a phone writes the name under its icon).
  const bare = document.createElement('canvas'); bare.width = bare.height = S; bare.getContext('2d').drawImage(c, 0, 0); window.__iconBare = bare;
  // The name.
  const band = x.createLinearGradient(0, S * 0.74, 0, S); band.addColorStop(0, 'rgba(5,6,7,0)'); band.addColorStop(0.45, 'rgba(5,6,7,.85)'); band.addColorStop(1, 'rgba(5,6,7,.95)');
  x.fillStyle = band; x.fillRect(0, S * 0.74, S, S * 0.26);
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.font = '900 ' + Math.round(S * 0.125) + 'px Montserrat, "Arial Black", Impact, sans-serif';
  x.lineWidth = S * 0.012; x.strokeStyle = 'rgba(0,0,0,.8)'; x.strokeText('BLACKMASK', S * 0.5, S * 0.925);
  const tg = x.createLinearGradient(0, S * 0.8, 0, S * 0.93); tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#ffd36a');
  x.fillStyle = tg; x.fillText('BLACKMASK', S * 0.5, S * 0.925);
  window.__icon = c;
  // Put the world back.
  for (const o of hidden) o.visible = true; scene.background = bg; scene.fog = fog;
  return 1;
})()`;

const size = (n, bare = false) => `(() => { const c = document.createElement('canvas'); c.width = c.height = ${n}; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(window.${bare ? "__iconBare" : "__icon"}, 0, 0, ${n}, ${n}); return c.toDataURL('image/png'); })()`;

const steps = [
  { until: "!!window.__game && !!document.querySelector('[data-screen=lobby]') && !!__game.stage.me", timeout: 120000 },
  { eval: "(()=>{const g=__game;g.settings.graphics='high';g.applySettings();document.querySelector('#ui').style.visibility='hidden';return 1})()", label: "tier" },
  { wait: 4000 },
  { eval: COMPOSE, label: "compose" },
  ...[1024, 512, 192, 180].map((n) => ({ saveEval: size(n), file: join(OUT, `icon-${n}.png`) })),
  { saveEval: size(32, true), file: join(OUT, "icon-32.png") },
  { saveEval: size(512, true), file: join(OUT, "icon-bare-512.png") },
];
const f = join(mkdtempSync(join(tmpdir(), "icon-")), "s.json");
writeFileSync(f, JSON.stringify(steps));
const out = execFileSync("node", ["dev/cdp.mjs", "http://localhost:5173/", mkdtempSync(join(tmpdir(), "icon-out-")), f], { encoding: "utf8", env: { ...process.env, GPU: "1", VIEW: "600x600" }, timeout: 300000 });
console.log(out.split("\n").filter((l) => /compose|saved|failed|timeout|error/i.test(l)).join("\n"));
