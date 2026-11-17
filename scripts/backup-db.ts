/**
 * Consistent SQLite backup for a WAL database.
 *
 * Copying `data/simplayz.sqlite` while the server is running is NOT safe: recent
 * commits may live in `-wal` and a plain copy can be torn. This script uses
 * SQLite's online backup API (`VACUUM INTO` would also work) which takes a
 * consistent snapshot under a read transaction, then verifies the result.
 *
 * Usage:
 *   npm run db:backup                    # → backups/simplayz-<timestamp>.sqlite
 *   npm run db:backup -- /path/out.sqlite
 *
 * Restore (server stopped):
 *   1. stop the Next.js process
 *   2. replace the database file with the backup
 *   3. delete any stale `-wal` / `-shm` siblings
 *   4. start the server (migrations run idempotently)
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = process.env.SIMPLAYZ_DB_PATH
  ? path.resolve(process.env.SIMPLAYZ_DB_PATH)
  : path.resolve(process.cwd(), "data", "simplayz.sqlite");

const target =
  process.argv[2] ??
  path.join(
    process.cwd(),
    "backups",
    `simplayz-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
  );

if (!fs.existsSync(dbPath)) {
  console.error(`[simplayz] no database at ${dbPath} — nothing to back up.`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });

const sqlite = new Database(dbPath, { readonly: true });
try {
  // better-sqlite3 exposes the online backup API as `.backup(dest)`, which takes
  // a consistent snapshot of a live WAL database.
  await sqlite.backup(target);
} finally {
  sqlite.close();
}

// Verify the copy opens, passes integrity_check, and reports a sane row count.
const copy = new Database(target, { readonly: true });
const integrity = copy.pragma("integrity_check") as { integrity_check: string }[];
const players = copy.prepare<[], { n: number }>("SELECT count(*) AS n FROM players").get()?.n ?? 0;
const saves = copy.prepare<[], { n: number }>("SELECT count(*) AS n FROM game_saves").get()?.n ?? 0;
copy.close();

if (integrity[0]?.integrity_check !== "ok") {
  console.error("[simplayz] backup failed integrity check:", integrity);
  process.exit(1);
}

console.log(
  `[simplayz] backup ok → ${target}\n  source: ${dbPath}\n  players: ${players}\n  saves: ${saves}\n  integrity_check: ok`,
);
