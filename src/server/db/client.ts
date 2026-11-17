import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getDatabasePath } from "@/server/config";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

/**
 * One process-wide SQLite connection per database path.
 *
 * Journal mode is WAL: concurrent readers do not block the single writer, and a
 * crash recovers cleanly. WAL strongly implies a local filesystem — do not put
 * this file on a network share and always back up with `npm run db:backup`
 * (see README "Backup and restore"), never by copying the file mid-write.
 */
export type AppDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

interface Cache {
  sqlite: Database.Database;
  db: AppDb;
  path: string;
}

const globalCache = globalThis as unknown as { __simplayzDb?: Cache };

export function getDb(): AppDb {
  const dbPath = getDatabasePath();
  if (globalCache.__simplayzDb?.path === dbPath) return globalCache.__simplayzDb.db;

  if (globalCache.__simplayzDb) {
    // A different path was requested (tests swap SIMPLAYZ_DB_PATH between files).
    try {
      globalCache.__simplayzDb.sqlite.close();
    } catch {
      /* already closed */
    }
    globalCache.__simplayzDb = undefined;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  // Schema creation is idempotent and cheap: the operator can also run
  // `npm run db:migrate` explicitly (documented path). Default: on for dev/test.
  // Set SIMPLAYZ_DB_MIGRATE=manual to require an explicit migrate step.
  if (process.env.SIMPLAYZ_DB_MIGRATE !== "manual") runMigrations(sqlite);

  const db = drizzle(sqlite, { schema }) as AppDb;
  globalCache.__simplayzDb = { sqlite, db, path: dbPath };
  return db;
}

/** Raw handle, for migrations/transactions that need better-sqlite3 directly. */
export function getSqlite(): Database.Database {
  getDb();
  return globalCache.__simplayzDb!.sqlite;
}

/** Test/script helper: close the cached connection so a temp DB can be deleted. */
export function closeDb(): void {
  if (globalCache.__simplayzDb) {
    try {
      globalCache.__simplayzDb.sqlite.close();
    } catch {
      /* ignore */
    }
    globalCache.__simplayzDb = undefined;
  }
}
