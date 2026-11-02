// Rank profiles (SPEC-V3 §1.4): the one place a player's XP lives, so a rank
// follows them to any phone. The server is the only authority: phones send
// what happened, never how much XP it was worth.
//
// Two ladders that never meet (Vatar Developer Agreement §8.2, README §1):
//   ll:<test|live>:<player id>   a Lagos Life player (the per-game pseudonymous id, checked with Lagos Life)
//   em:<sha256 of the EMILGO user id>   an EMILGO account (a Supabase session, checked here)
// What is stored, and nothing more: that key, total XP, a few counts, the day
// of the last counted match, and timestamps. No names, no device data. Delete
// on request (§8.2(e)): DELETE /profiles/<key> with the admin token.

import { createHash, createHmac, createPublicKey, timingSafeEqual, verify as verifySig, type JsonWebKeyInput } from "node:crypto";

type JsonWebKey = JsonWebKeyInput["key"];
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { VatarApi } from "./vatar.js";

export interface Profile {
  key: string;
  xp: number;
  matches: number;
  wins: number;
  /** YYYY-MM-DD (UTC) of the last match that counted. */
  lastDay: string;
  /** Commends from other players after matches (SPEC-V3 §10.12): a cosmetic title. */
  honour: number;
  /** Wins in a row, now (§10.18: the streak glow). */
  streak: number;
}

export interface ProfileStore {
  get(key: string): Profile | null;
  /** Add XP from one match; creates the profile on first use. */
  award(key: string, xp: number, won: boolean, day: string): Profile;
  /** One more commend; the new count (creates the profile on first use). */
  commend(key: string): number;
  remove(key: string): boolean;
  close(): void;
}

export class SqliteProfiles implements ProfileStore {
  private readonly db: DatabaseSync;
  private readonly q;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS profiles (
        key        TEXT PRIMARY KEY,
        xp         INTEGER NOT NULL DEFAULT 0,
        matches    INTEGER NOT NULL DEFAULT 0,
        wins       INTEGER NOT NULL DEFAULT 0,
        last_day   TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    // Phase 6: commends (an older file gains the column).
    const cols = this.db.prepare("PRAGMA table_info(profiles)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "honour")) this.db.exec("ALTER TABLE profiles ADD COLUMN honour INTEGER NOT NULL DEFAULT 0");
    if (!cols.some((c) => c.name === "streak")) this.db.exec("ALTER TABLE profiles ADD COLUMN streak INTEGER NOT NULL DEFAULT 0");
    this.q = {
      get: this.db.prepare("SELECT key, xp, matches, wins, last_day, honour, streak FROM profiles WHERE key = ?"),
      commend: this.db.prepare(
        `INSERT INTO profiles (key, xp, matches, wins, last_day, created_at, updated_at, honour) VALUES (?, 0, 0, 0, '', ?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET honour = honour + 1, updated_at = excluded.updated_at`,
      ),
      upsert: this.db.prepare(
        `INSERT INTO profiles (key, xp, matches, wins, last_day, created_at, updated_at, streak) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET xp = xp + excluded.xp, matches = matches + 1, wins = wins + excluded.wins,
           last_day = excluded.last_day, updated_at = excluded.updated_at,
           streak = CASE WHEN excluded.wins > 0 THEN streak + 1 ELSE 0 END`,
      ),
      remove: this.db.prepare("DELETE FROM profiles WHERE key = ?"),
    };
  }

  get(key: string): Profile | null {
    const r = this.q.get.get(key) as { key: string; xp: number; matches: number; wins: number; last_day: string; honour: number; streak: number } | undefined;
    return r ? { key: r.key, xp: Number(r.xp), matches: Number(r.matches), wins: Number(r.wins), lastDay: r.last_day, honour: Number(r.honour), streak: Number(r.streak) } : null;
  }

  award(key: string, xp: number, won: boolean, day: string): Profile {
    const t = Date.now();
    this.q.upsert.run(key, Math.max(0, Math.round(xp)), won ? 1 : 0, day, t, t, won ? 1 : 0);
    return this.get(key)!;
  }

  commend(key: string): number {
    const t = Date.now();
    this.q.commend.run(key, t, t);
    return this.get(key)!.honour;
  }

  remove(key: string): boolean {
    return Number(this.q.remove.run(key).changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}

/** Today in UTC, for the first-match-of-the-day bonus (one clock for everyone). */
export function utcDay(t = Date.now()): string {
  return new Date(t).toISOString().slice(0, 10);
}

// ── Who is this? ─────────────────────────────────────────────────────────────

export type IdKind = "ll" | "em";

/**
 * Checks a phone's claim to a profile. Lagos Life: a fresh session token, asked
 * of Lagos Life itself. EMILGO: a Supabase access token, checked here against
 * the project's signing key (SUPABASE_JWT_SECRET for HS256 projects, else the
 * public keys at SUPABASE_URL).
 */
export class Identity {
  private jwks: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;

  constructor(
    private readonly vatar: VatarApi | null,
    private readonly supabase: { url: string | null; secret: string | null },
  ) {}

  /** Which kinds this server can check. */
  get kinds(): IdKind[] {
    return [...(this.vatar ? (["ll"] as const) : []), ...(this.supabase.url || this.supabase.secret ? (["em"] as const) : [])];
  }

  async verify(kind: IdKind, token: string): Promise<string> {
    if (typeof token !== "string" || token.length < 8 || token.length > 4096) throw new Error("bad_token");
    if (kind === "ll") {
      if (!this.vatar) throw new Error("not_here");
      const s = await this.vatar.verifySession(token);
      return `ll:${s.mode}:${s.playerId}`;
    }
    if (kind === "em") {
      const sub = await this.supabaseUser(token);
      return `em:${createHash("sha256").update(`emilgo|${sub}`).digest("hex").slice(0, 40)}`;
    }
    throw new Error("bad_kind");
  }

  /** The Supabase user id (`sub`) of a valid, unexpired access token. */
  private async supabaseUser(jwt: string): Promise<string> {
    const parts = jwt.split(".");
    if (parts.length !== 3) throw new Error("bad_token");
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string; kid?: string };
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as { sub?: string; exp?: number; aud?: string | string[]; iss?: string; role?: string };
    const signed = Buffer.from(`${h}.${p}`);
    const sig = Buffer.from(s, "base64url");
    let ok = false;
    if (header.alg === "HS256") {
      if (!this.supabase.secret) throw new Error("not_here");
      const want = createHmac("sha256", this.supabase.secret).update(signed).digest();
      ok = want.length === sig.length && timingSafeEqual(want, sig);
    } else if (header.alg === "ES256" || header.alg === "RS256") {
      const jwk = await this.key(header.kid);
      const key = createPublicKey({ key: jwk, format: "jwk" });
      ok = header.alg === "ES256" ? verifySig("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, sig) : verifySig("sha256", signed, key, sig);
    } else {
      throw new Error("bad_alg");
    }
    if (!ok) throw new Error("bad_signature");
    if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error("expired");
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes("authenticated") || claims.role === "anon") throw new Error("not_a_user");
    if (this.supabase.url && claims.iss && !claims.iss.startsWith(this.supabase.url.replace(/\/+$/, ""))) throw new Error("wrong_project");
    if (!claims.sub) throw new Error("no_user");
    return claims.sub;
  }

  private async key(kid: string | undefined): Promise<JsonWebKey> {
    if (!this.supabase.url) throw new Error("not_here");
    if (!this.jwks || Date.now() - this.jwks.at > 3_600_000 || !this.jwks.keys.some((k) => k.kid === kid)) {
      const res = await fetch(`${this.supabase.url.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`);
      if (!res.ok) throw new Error("jwks_unavailable");
      const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
      this.jwks = { at: Date.now(), keys: body.keys ?? [] };
    }
    const k = this.jwks.keys.find((x) => x.kid === kid) ?? (kid ? undefined : this.jwks.keys[0]);
    if (!k) throw new Error("unknown_key");
    return k;
  }
}
