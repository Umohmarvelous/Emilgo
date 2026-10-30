// Riddles of the Elders (SPEC-V3 §9 #9; Phase 6): brains over reflex. A
// riddle every `every` seconds; its answer is a place in the city. Kola-nut
// tokens wait at every answer and at a few places that answer nothing: take
// the token where the riddle points to solve it. A wrong token costs you
// `wrongCost` seconds (no tokens for you until then). Solve `need`, then get
// back to the Elders' Bench (under the baobab) first to win. Time up: the
// most solved wins.
//
// Pure: the riddles, their order, where the tokens lie and each riddle's
// language all come from the public seed, so a phone's copy knows them too
// (the riddle is the puzzle, not a secret). Whether a token was right is
// the server's word (an event).

import { RIDDLES_CFG } from "../../config";
import { ELDERS_BENCH, RIDDLES, shownLangs, type Riddle } from "../../content/riddles";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import { nearOpen } from "./flags";

export interface Token {
  readonly index: number;
  /** The place it lies at (a landmark or area id). */
  readonly place: string;
  readonly x: number;
  readonly z: number;
  readonly h: number;
}

export class RiddlesModule implements RuleModule {
  readonly id = "riddles" as const;
  readonly every: number;
  readonly need: number;
  readonly wrongCost: number;
  readonly langs: readonly string[];
  /** This match's riddles in the order they're asked, and the language each is asked in. */
  readonly asked: { riddle: Riddle; lang: "pcm" | "yo" | "ig" | "ha"; at: number }[] = [];
  readonly tokens: Token[] = [];
  bench: { x: number; z: number; h: number } | null = null;
  /** Per body: which asked riddles they've solved (bits), no tokens until. */
  solved = new Uint32Array(0);
  locked = new Float64Array(0);
  /** Riddles announced so far. */
  shown = 0;

  constructor(params: Record<string, unknown>) {
    const num = (k: string, d: number) => (typeof params[k] === "number" ? (params[k] as number) : d);
    this.every = Math.max(30, num("every", 90));
    this.need = Math.max(1, Math.floor(num("need", 3)));
    this.wrongCost = Math.max(0, num("wrongCost", 20));
    this.langs = Array.isArray(params.langs) ? (params.langs as unknown[]).filter((l): l is string => typeof l === "string") : ["pcm"];
  }

  init(m: Match): void {
    const n = m.contestants.length;
    this.solved = new Uint32Array(n);
    this.locked = new Float64Array(n);
    const named = new Map((m.world.named ?? []).map((p) => [p.id, p]));
    const rng = m.rng("riddles");
    const pool = rng.shuffle(RIDDLES.filter((r) => named.has(r.answer) && r.answer !== ELDERS_BENCH));
    const count = Math.min(pool.length, Math.max(this.need, Math.floor(m.settings.time / this.every)));
    for (let k = 0; k < count; k++) {
      const riddle = pool[k];
      const langs = shownLangs(riddle, this.langs);
      this.asked.push({ riddle, lang: langs[rng.int(0, langs.length - 1)], at: (k + 1) * this.every - this.every * 0.75 });
    }
    // Tokens: at every answer, and at a few places that answer nothing.
    const answers = new Set(this.asked.map((a) => a.riddle.answer));
    const others = rng.shuffle([...named.keys()].filter((id) => !answers.has(id) && id !== ELDERS_BENCH)).slice(0, RIDDLES_CFG.decoys);
    for (const id of [...answers, ...others]) {
      const p = named.get(id)!;
      const cell = nearOpen(m, p.x, p.z, Math.max(4, p.r * 0.5));
      if (cell < 0) continue;
      const [x, z] = m.reach.centre(cell);
      this.tokens.push({ index: this.tokens.length, place: id, x, z, h: m.reach.h[cell] });
    }
    const b = named.get(ELDERS_BENCH);
    if (b) {
      const cell = nearOpen(m, b.x, b.z, 6);
      if (cell >= 0) {
        const [x, z] = m.reach.centre(cell);
        this.bench = { x, z, h: m.reach.h[cell] };
      }
    }
  }

  /** The riddles asked so far that body i hasn't solved. */
  open(i: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < this.shown; k++) if (!(this.solved[i] & (1 << k))) out.push(k);
    return out;
  }

  count(i: number): number {
    let n = 0;
    for (let v = this.solved[i]; v; v &= v - 1) n++;
    return n;
  }

  // ── A tap at a token ──

  reachFor(m: Match, c: Contestant): { d: number; take: () => void } | null {
    let best: { d: number; take: () => void } | null = null;
    for (const tk of this.tokens) {
      const d = Math.hypot(tk.x - c.x, tk.z - c.z);
      if (d > RIDDLES_CFG.reach || Math.abs(tk.h - c.h) > 1.5 || (best && best.d <= d)) continue;
      best = { d, take: () => this.take(m, c, tk) };
    }
    return best;
  }

  private take(m: Match, c: Contestant, tk: Token): void {
    const i = c.index;
    if (m.elapsed < this.locked[i]) return;
    const k = this.open(i).find((q) => this.asked[q].riddle.answer === tk.place);
    if (k !== undefined) {
      this.solved[i] |= 1 << k;
      m.emit({ type: "token", id: c.id, token: tk.index, riddle: k, right: true });
    } else {
      this.locked[i] = m.elapsed + this.wrongCost;
      m.emit({ type: "token", id: c.id, token: tk.index, riddle: -1, right: false });
    }
  }

  // ── Every step: the next riddle; the bench ──

  step(m: Match): void {
    this.announce(m);
    if (m.winner || !this.bench) return;
    for (const c of m.contestants) {
      if (c.status !== "alive" || this.count(c.index) < this.need) continue;
      if (Math.hypot(c.x - this.bench.x, c.z - this.bench.z) <= RIDDLES_CFG.bench) m.win(c);
    }
  }

  private announce(m: Match): void {
    while (this.shown < this.asked.length && m.elapsed >= this.asked[this.shown].at) {
      const a = this.asked[this.shown];
      if (!m.mirror) m.emit({ type: "riddle", k: this.shown, id: a.riddle.id, lang: a.lang });
      this.shown++;
    }
  }

  /** Time up: the clear leader in riddles solved wins. */
  timeUp(m: Match): void {
    const st = m.standings();
    const top = st.filter((s) => s.place === 1);
    if (new Set(top.map((s) => s.squad)).size === 1 && top[0] && top[0].objective > 0) m.win(m.get(top[0].id) ?? null, top[0].squad);
  }

  objective(_m: Match, i: number): number {
    return this.count(i);
  }

  // ── The copy ──

  apply(m: Match, e: MatchEvent): void {
    if (e.type === "token") {
      const c = m.get(e.id);
      if (!c) return;
      if (e.right && e.riddle >= 0) this.solved[c.index] |= 1 << e.riddle;
      else this.locked[c.index] = m.elapsed + this.wrongCost;
    } else if (e.type === "riddle") this.shown = Math.max(this.shown, e.k + 1);
  }

  view(m: Match): void {
    // The copy knows when each is asked (the seed), as the server does.
    while (this.shown < this.asked.length && m.elapsed >= this.asked[this.shown].at) this.shown++;
  }
}
