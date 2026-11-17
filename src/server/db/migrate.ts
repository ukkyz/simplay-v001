import "server-only";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

/**
 * Versioned migrations.
 *
 * Drizzle Kit generates SQL into `drizzle/` (`npm run db:generate`). This module
 * applies every `drizzle/NNNN_*.sql` file exactly once, tracked in the
 * `__simplayz_migrations` table, inside a transaction per file. It deliberately
 * does not use drizzle-kit at runtime: the server must not need a dev-only CLI
 * package to boot.
 */
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export interface MigrationResult {
  applied: string[];
  skipped: number;
}

export function runMigrations(sqlite: Database.Database): MigrationResult {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS __simplayz_migrations (
       name TEXT PRIMARY KEY NOT NULL,
       applied_at INTEGER NOT NULL
     )`,
  );

  const done = new Set(
    sqlite
      .prepare<[], { name: string }>("SELECT name FROM __simplayz_migrations")
      .all()
      .map((r) => r.name),
  );

  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .sort()
    : [];

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    sqlite.transaction(() => {
      for (const stmt of statements) sqlite.exec(stmt);
      sqlite
        .prepare("INSERT INTO __simplayz_migrations (name, applied_at) VALUES (?, ?)")
        .run(file, Date.now());
    })();
    applied.push(file);
  }

  return { applied, skipped: files.length - applied.length };
}

/* CLI entry point: `npm run db:migrate` */
const isCli =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /migrate\.ts$/.test(process.argv[1] ?? "");

if (isCli) {
  void (async () => {
    const { default: DatabaseCtor } = await import("better-sqlite3");
    const { getDatabasePath } = await import("@/server/config");
    const dbPath = getDatabasePath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = new DatabaseCtor(dbPath);
    sqlite.pragma("journal_mode = WAL");
    const result = runMigrations(sqlite);
    sqlite.close();
    console.log(
      `[simplayz] database ${dbPath}\n  applied: ${result.applied.length ? result.applied.join(", ") : "none"}\n  already up to date: ${result.skipped}`,
    );
  })().catch((err) => {
    console.error("[simplayz] migration failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
