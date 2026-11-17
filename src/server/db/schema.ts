import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Durable persistence for anonymous single-player sessions.
 *
 * Three version numbers are deliberately separate:
 *  - `schemaVersion`  — the game-save object shape (GameState.schema, currently 4).
 *  - `revision`       — monotonic counter for optimistic concurrency per save.
 *  - the database schema version is tracked by Drizzle in `__drizzle_migrations`.
 *
 * There is no multiplayer/ownership table yet: each row is one player's
 * snapshot, reachable only through that player's anonymous session cookie.
 */
export const players = sqliteTable("players", {
  /** Opaque server-generated id (never client supplied). */
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const gameSaves = sqliteTable(
  "game_saves",
  {
    /** Foreign key to players.id; one save row per player. */
    playerId: text("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    /** Game-save schema version of `state` (GameState.schema). */
    schemaVersion: integer("schema_version").notNull(),
    /** Optimistic-concurrency revision; starts at 1 for a created save. */
    revision: integer("revision").notNull(),
    /** Serialized, credential-free GameState JSON. */
    state: text("state").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("game_saves_updated_at_idx").on(table.updatedAt)],
);

export type PlayerRow = typeof players.$inferSelect;
export type GameSaveRow = typeof gameSaves.$inferSelect;

export const nowSql = sql`(unixepoch() * 1000)`;
