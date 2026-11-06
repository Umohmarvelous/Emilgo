// Dev only: what can be checked of "the screen blinks" and "the music skips"
// without a phone. Needs `npm run dev` on :5173. Prints numbers, saves nothing.
//
//   node dev/verify-av.mjs music     the shortest loop, played 2.5 times with the CPU slowed 4×: any gap in the sound?
//   node dev/verify-av.mjs blink     a practice match with resizes and resolution changes: any frame the screen would show empty?
//
// Not the same as a phone and ears. It catches the two causes that were fixed;
// it can't catch a phone's own audio driver or GPU.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BOOT = { until: "!!window.__game && !!document.querySelector('[data-screen=lobby]')", timeout: 120000 };

const MUSIC = [
  BOOT,
  { tap: [190, 400] },
  {
    eval: `(()=>{const g=__game,s=g.sound;s.prepare&&s.prepare();const gr=s.graph;if(!gr)return 'no audio graph';gr.ctx.resume();
      const an=gr.ctx.createAnalyser();an.fftSize=2048;gr.music.connect(an);window.__an=an;window.__rms=[];
      s.score.play('menu');
      const d=new Float32Array(2048);
      setInterval(()=>{an.getFloatTimeDomainData(d);let e=0;for(let i=0;i<2048;i++)e+=d[i]*d[i];window.__rms.push([gr.ctx.currentTime,Math.sqrt(e/2048)])},25);
      return 'state '+gr.ctx.state})()`,
    label: "start",
  },
  { wait: 57000 },
  {
    eval: `(()=>{const s=__game.sound,r=window.__rms.slice(120),track=s.score.playing;const buf=s.score.cur&&s.score.cur.buf;
      let run=0,worst=0,quiet=0;const dt=[];for(let i=1;i<r.length;i++){dt.push(r[i][0]-r[i-1][0]);if(r[i][1]<0.0008){run+=r[i][0]-r[i-1][0];quiet++;worst=Math.max(worst,run)}else run=0}
      return JSON.stringify({track,seconds:buf&&buf.duration,samples:r.length,quietSamples:quiet,longestSilence:+worst.toFixed(3),loudest:+Math.max(...r.map(x=>x[1])).toFixed(3),passes:s.score.cur&&s.score.cur.sources.length})})()`,
    label: "result",
  },
];

const BLINK = [
  BOOT,
  {
    eval: `(()=>{const g=__game;const gl=g.renderer.getContext();window.__b={frames:0,lum:[],outside:0,inside:0,sizes:0};const px=new Uint8Array(4);
      const R=g.render.bind(g);let inR=false;
      for(const name of ['setPixelRatio','setSize']){const f=g.renderer[name].bind(g.renderer);g.renderer[name]=(...a)=>{window.__b.sizes++;if(inR)window.__b.inside++;else window.__b.outside++;return f(...a)}}
      g.render=(...a)=>{inR=true;try{R(...a)}finally{inR=false}
        const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;let s=0;for(const [u,v] of [[.25,.3],[.5,.5],[.75,.3],[.5,.8]]){gl.readPixels(w*u|0,h*v|0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);s+=px[0]+px[1]+px[2]}
        window.__b.frames++;window.__b.lum.push(s/12)};
      g.practiceFfa(g.content.manifest.modes.find(d=>d.id==='find-the-flag'));return 1})()`,
    label: "start",
  },
  { until: "!!__game.gm && !!__game.gm.match && __game.gm.match.phase==='play'", timeout: 180000 },
  { eval: `(()=>{window.__b.lum.length=0;window.__b.frames=0;window.__b.outside=0;window.__b.inside=0;window.__b.sizes=0;
      let n=0;window.__t=setInterval(()=>{n++;if(n%2)__game.pendingRatio=n%4===1?0.75:1;else window.dispatchEvent(new Event('resize'))},1500);return 1})()`, label: "disturb" },
  { wait: 30000 },
  {
    eval: `(()=>{clearInterval(window.__t);const b=window.__b,l=b.lum,sorted=[...l].sort((a,b)=>a-b),med=sorted[sorted.length>>1];let black=0,drops=0;for(let i=1;i<l.length;i++){if(l[i]<3)black++;if(l[i]<med*0.25&&l[i-1]>=med*0.25)drops++}
      return JSON.stringify({frames:b.frames,median:+med.toFixed(1),min:+sorted[0].toFixed(1),blackFrames:black,suddenDrops:drops,sizeChanges:b.sizes,duringRender:b.inside,betweenFrames:b.outside})})()`,
    label: "result",
  },
];

const which = process.argv[2] ?? "music";
const f = join(mkdtempSync(join(tmpdir(), "av-")), "s.json");
writeFileSync(f, JSON.stringify(which === "blink" ? BLINK : MUSIC));
const out = execFileSync("node", ["dev/cdp.mjs", "http://localhost:5173/", join(tmpdir(), "av-out"), f], {
  encoding: "utf8",
  env: { ...process.env, GPU: "1", VIEW: "390x844", CPU_RATE: "4" },
  timeout: 400000,
});
console.log(out.split("\n").filter((l) => /eval (result|start)|timeout|FAIL/i.test(l)).join("\n"));
