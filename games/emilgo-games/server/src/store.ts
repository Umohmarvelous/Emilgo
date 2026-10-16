// Who owns what. The one thing the game server must remember between restarts.
//
// One row per Lagos Life purchase, keyed by purchaseId: the PRIMARY KEY is what
// makes "give the item once per purchaseId" (docs, The purchase flow) a property
// of the database rather than of careful code.
//
// What is stored, and nothing more (Developer Agreement §8): the purchase id,
// the per-game pseudonymous player id (p_… / t_…), the product id, test/live,
// and timestamps. No names, no device data. When the game is removed, or if
// Lagos Life asks, delete the file (§8.2(e)).
//
// Built-in SQLite (node:sqlite, Node 22.13+): one file, no service to run.
// Several server processes need ONE shared store — point them at the same
// database service by implementing this interface on Postgres; nothing else
// changes. See the README.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface Grant {
  purchaseId: string;
  playerId: string;
  productId: string;
  mode: "live" | "test";
}

export interface OwnershipStore {
  /** Record a grant. Returns false if this purchaseId was already granted (nothing changes). */
  grant(g: Grant): boolean;
  markDelivered(purchaseId: string): void;
  /** Grants not yet confirmed delivered with Lagos Life (to retry after a crash). */
  undelivered(): Grant[];
  /** Remove a refunded purchase's grant. */
  revoke(purchaseId: string): void;
  owned(playerId: string, mode: "live" | "test"): string[];
  close(): void;
}

export class SqliteStore implements OwnershipStore {
  private readonly db: DatabaseSync;
  private readonly q;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS grants (
        purchase_id  TEXT PRIMARY KEY,
        player_id    TEXT NOT NULL,
        product_id   TEXT NOT NULL,
        mode         TEXT NOT NULL CHECK (mode IN ('live', 'test')),
        granted_at   INTEGER NOT NULL,
        delivered_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS grants_by_player ON grants (player_id, mode);
    `);
    this.q = {
      insert: this.db.prepare(
        "INSERT OR IGNORE INTO grants (purchase_id, player_id, product_id, mode, granted_at) VALUES (?, ?, ?, ?, ?)",
      ),
      delivered: this.db.prepare("UPDATE grants SET delivered_at = ? WHERE purchase_id = ? AND delivered_at IS NULL"),
      undelivered: this.db.prepare(
        "SELECT purchase_id, player_id, product_id, mode FROM grants WHERE delivered_at IS NULL ORDER BY granted_at LIMIT 200",
      ),
      revoke: this.db.prepare("DELETE FROM grants WHERE purchase_id = ?"),
      owned: this.db.prepare("SELECT DISTINCT product_id FROM grants WHERE player_id = ? AND mode = ?"),
    };
  }

  grant(g: Grant): boolean {
    const r = this.q.insert.run(g.purchaseId, g.playerId, g.productId, g.mode, Date.now());
    return Number(r.changes) === 1;
  }

  markDelivered(purchaseId: string): void {
    this.q.delivered.run(Date.now(), purchaseId);
  }

  undelivered(): Grant[] {
    return (this.q.undelivered.all() as Record<string, string>[]).map((r) => ({
      purchaseId: r.purchase_id,
      playerId: r.player_id,
      productId: r.product_id,
      mode: r.mode as "live" | "test",
    }));
  }

  revoke(purchaseId: string): void {
    this.q.revoke.run(purchaseId);
  }

  owned(playerId: string, mode: "live" | "test"): string[] {
    return (this.q.owned.all(playerId, mode) as { product_id: string }[]).map((r) => r.product_id);
  }

  close(): void {
    this.db.close();
  }
}
