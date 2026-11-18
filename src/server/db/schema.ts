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
 * `game_saves` is still one row per player, reachable only through that player's
 * anonymous session cookie. `world_players` is the *published summary* of a
 * player's area: a separate table so the shared world never widens the save
 * shape (and never touches the save validators), and so opting out is a DELETE
 * that cannot leave a stale flag behind.
 *
 * Published coordinates are integers at 1/100 degree (≈1.1 km): the registry,
 * its backups and every API response must never hold a precise position.
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

export const worldPlayers = sqliteTable(
  "world_players",
  {
    /** FK to players.id. Never returned to any client — see `refForPlayer`. */
    playerId: text("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    /** Company/CEO names are already save-validated (≤64 chars, non-empty). */
    company: text("company").notNull(),
    ceoName: text("ceo_name").notNull(),
    /** Coarsened claim centre: `Math.round(lat * 100)` / `Math.round(lng * 100)`. */
    latE2: integer("lat_e2").notNull(),
    lngE2: integer("lng_e2").notNull(),
    /** Claim side in km, rounded. */
    sideKm: integer("side_km").notNull(),
    /** `state.buildings.length` at publish time. */
    buildingCount: integer("building_count").notNull(),
    /** Server-assigned colour from the fixed palette. */
    color: text("color").notNull(),
    publishedAt: integer("published_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("world_players_bbox_idx").on(table.latE2, table.lngE2)],
);

export type PlayerRow = typeof players.$inferSelect;
export type WorldPlayerRow = typeof worldPlayers.$inferSelect;
export type GameSaveRow = typeof gameSaves.$inferSelect;

export const nowSql = sql`(unixepoch() * 1000)`;
