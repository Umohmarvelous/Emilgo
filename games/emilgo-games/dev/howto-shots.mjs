// Dev only: the real pictures for "How to play" (src/ui/howto/*.webp) and the
// lobby's place art (src/ui/places/*.webp), shot from the game itself. Needs
// `npm run dev` on :5173. Re-run after a mode or a world changes:
//
//   node dev/howto-shots.mjs [id…]      (every picture, or just these)

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOWTO = "src/ui/howto";
const PLACES = "src/ui/places";

// What each picture shows: a mode to play, where to stand (`at`: JS over the match `m`, giving {x, z}), how far back, from which side.
const flagAt = "m.byId('flags').flags[0]";
const SHOTS = [
  { id: "find-the-flag", mode: "find-the-flag", at: flagAt, back: 11, side: 5, pitch: 0.2 },
  { id: "hold-the-flag", mode: "hold-the-flag", at: flagAt, back: 0.5, side: 0, take: true },
  { id: "steal-reposition", mode: "steal-reposition", at: "m.byId('dropzones').zones[0]", back: 12, side: 3, pitch: 0.34 },
  { id: "squad-rally", mode: "squad-rally", at: "m.byId('capture').at?.(0) ?? m.byId('capture').pos ?? {x:60,z:0}", back: 10, side: 0, pitch: 0.28 },
  { id: "hustle", mode: "hustle", at: "m.byId('economy').stations[0]", back: 6, side: 2 },
  { id: "scarcity", mode: "scarcity", at: "m.byId('flags').flags[1]", back: 10, side: 4, pitch: 0.2 },
  { id: "chase-reverse", mode: "chase-reverse", at: "({x:60,z:-300})", back: 3, side: 0 },
  { id: "compound-wars", mode: "compound-wars", at: "m.byId('rooms').rooms[0]", back: 8, side: 0, pitch: 0.2 },
  { id: "riddles-elders", mode: "riddles-elders", at: "m.byId('riddles').bench", back: 7, side: 2 },
  { id: "lights-out", mode: "lights-out", at: "({x:-740,z:-550})", back: 3, side: 0, night: true },
  { id: "max-royale", mode: "max-royale", at: "({x:760,z:-40})", back: 2, side: 0, pitch: 0.06 },
  { id: "max-flag", mode: "max-flag", at: flagAt, back: 11, side: -5, pitch: 0.2 },
  { id: "flag-duel", mode: "flag-duel", at: flagAt, back: 9, side: 3, pitch: 0.2 },
  { id: "dead-streets", mode: "dead-streets", at: null },
  { id: "basics-move", mode: "max-royale", at: "({x:60,z:-260})", back: 3, side: 0, hud: true },
  { id: "basics-guns", mode: "max-royale", at: "({x:-40,z:760})", back: 3, side: 0, hud: true },
  { id: "basics-zone", mode: "max-royale", at: "({x:330,z:-420})", back: 3, side: 0, hud: true, zone: true },
  { id: "basics-items", mode: "max-royale", at: "m.byId('items').ground?.[0] ?? ({x:60,z:-260})", back: 5, side: 0, pitch: 0.3 },
  { id: "basics-cars", mode: "max-royale", at: "m.byId('vehicles').cars?.[0] ?? ({x:60,z:-260})", back: 9, side: 2, pitch: 0.16 },
  { id: "glass", dir: PLACES, mode: "max-royale", at: "({x:330,z:-340})", back: 3, side: 0, pitch: 0.02 },
  { id: "frostline", dir: PLACES, mode: "max-royale", at: "({x:772,z:320})", back: 3, side: 0, pitch: 0.08 },
];

const only = new Set(process.argv.slice(2));
const list = only.size ? SHOTS.filter((s) => only.has(s.id)) : SHOTS;

for (const s of list) {
  const steps = [
    { until: "!!window.__game && !!document.querySelector('[data-screen=lobby]')", timeout: 90000 },
    { eval: `(()=>{const g=__game;g.settings.graphics='high';g.applySettings();g.settings.ffaSeen='';return 1})()`, label: "tier" },
    s.mode === "dead-streets"
      ? { eval: `(()=>{const g=__game;g.settings.game='survival';g.goRun();return 1})()`, label: "start" }
      : { eval: `(()=>{const g=__game;g.practiceFfa(g.content.manifest.modes.find(d=>d.id==='${s.mode}'));return 1})()`, label: "start" },
    { until: "!!__game.gm && !!__game.gm.match && __game.gm.match.phase==='play'", timeout: 120000 },
    { wait: 1500 },
  ];
  if (s.at) {
    steps.push({
      eval: `(()=>{const g=__game,m=g.gm.match,me=m.contestants[0];const t=${s.at.replace(/m\.byId\('(\w+)'\)/g, "m.modules.find(x=>x.id==='$1')")};const f=Math.atan2(t.x-me.x,t.z-me.z);const dx=Math.sin(f),dz=Math.cos(f);me.x=t.x-dx*${s.back}+dz*${s.side};me.z=t.z-dz*${s.back}-dx*${s.side};me.vx=me.vz=0;me.y=m.world.space.floorAt(me.x,me.z,0).h;me.h=me.y;me.heading=f;const yaw=Math.atan2(me.x-t.x,me.z-t.z);g.rig.yaw=g.rig.viewYaw=yaw;g.rig.pitch=g.rig.viewPitch=${s.pitch ?? 0.1};return JSON.stringify({x:me.x,z:me.z,t:{x:t.x,z:t.z}})})()`,
      label: "stand",
    });
  }
  steps.push({ wait: 3500 });
  if (!s.hud) steps.push({ eval: `(()=>{document.querySelector('#ui')?.style.setProperty('visibility','hidden');for(const e of document.querySelectorAll('[data-ui]'))e.style.visibility='hidden';return 1})()`, label: "hide" });
  steps.push({ wait: 400, shot: s.id, webp: 58 });
  const f = join(mkdtempSync(join(tmpdir(), "shot-")), "s.json");
  writeFileSync(f, JSON.stringify(steps));
  const out = execFileSync("node", ["dev/cdp.mjs", "http://localhost:5173/", s.dir ?? HOWTO, f], { encoding: "utf8", env: { ...process.env, GPU: "1", VIEW: "640x360" }, timeout: 300000 });
  console.log(s.id, out.split("\n").filter((l) => /stand|FAIL|timeout|error:/i.test(l)).join(" | ").slice(0, 220));
}
