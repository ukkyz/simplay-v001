import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb, getSqlite } from "./client";
import { gameSaves, players } from "./schema";
import type { GameState } from "@/game/types";
import { GAME_SAVE_SCHEMA, validateGameState } from "@/server/gameSave";

/**
 * Save persistence + ownership.
 *
 * Every function here takes the player id taken from the *verified anonymous
 * session cookie*. A client-supplied save/player id is never accepted as
 * authorization: the WHERE clause always constrains `player_id`.
 */

export interface SaveSnapshot {
  state: GameState;
  schemaVersion: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export type WriteOutcome =
  | { kind: "created"; save: SaveSnapshot }
  | { kind: "updated"; save: SaveSnapshot }
  | { kind: "conflict"; currentRevision: number }
  | { kind: "invalid"; errors: string[] }
  | { kind: "missing-player" }
  | { kind: "storage-error"; message: string };

export function ensurePlayer(playerId: string, now = Date.now()): void {
  const db = getDb();
  db.insert(players)
    .values({ id: playerId, createdAt: now, lastSeenAt: now })
    .onConflictDoUpdate({ target: players.id, set: { lastSeenAt: now } })
    .run();
}

export function touchPlayer(playerId: string, now = Date.now()): void {
  getDb().update(players).set({ lastSeenAt: now }).where(eq(players.id, playerId)).run();
}

export function playerExists(playerId: string): boolean {
  const row = getDb()
    .select({ id: players.id })
    .from(players)
    .where(eq(players.id, playerId))
    .get();
  return Boolean(row);
}

/** Read the caller's own save. Returns null when nothing has been written yet. */
export function readSave(playerId: string): SaveSnapshot | null {
  const row = getDb()
    .select()
    .from(gameSaves)
    .where(eq(gameSaves.playerId, playerId))
    .get();
  if (!row) return null;
  return {
    state: JSON.parse(row.state) as GameState,
    schemaVersion: row.schemaVersion,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface WriteSaveInput {
  playerId: string;
  /** Client's view of the current revision; 0 = "I believe there is no save". */
  baseRevision: number;
  /** Untrusted payload from the network. */
  state: unknown;
}

/**
 * Write a save with optimistic concurrency.
 *
 * - The payload is fully validated before it can touch the database. A rejected
 *   payload leaves the previous valid row untouched (no partial overwrite).
 * - The read-check-write runs in a single IMMEDIATE transaction so two clients
 *   using the same baseRevision cannot both succeed.
 */
export function writeSave(input: WriteSaveInput): WriteOutcome {
  const validation = validateGameState(input.state);
  if (!validation.ok || !validation.state)
    return { kind: "invalid", errors: validation.errors };

  if (!playerExists(input.playerId)) return { kind: "missing-player" };

  const state = validation.state;
  const serialized = JSON.stringify(state);
  const now = Date.now();
  const sqlite = getSqlite();

  try {
    const outcome = sqlite
      .transaction((): WriteOutcome => {
        const current = sqlite
          .prepare<[string], { revision: number }>(
            "SELECT revision FROM game_saves WHERE player_id = ?",
          )
          .get(input.playerId);

        if (!current) {
          // A client must start from revision 0 to create; anything else means it
          // is writing against a save it has never seen.
          if (input.baseRevision !== 0) return { kind: "conflict", currentRevision: 0 };
          sqlite
            .prepare(
              `INSERT INTO game_saves (player_id, schema_version, revision, state, created_at, updated_at)
               VALUES (?, ?, 1, ?, ?, ?)`,
            )
            .run(input.playerId, GAME_SAVE_SCHEMA, serialized, now, now);
          return {
            kind: "created",
            save: {
              state,
              schemaVersion: GAME_SAVE_SCHEMA,
              revision: 1,
              createdAt: now,
              updatedAt: now,
            },
          };
        }

        if (current.revision !== input.baseRevision)
          return { kind: "conflict", currentRevision: current.revision };

        // Compare-and-set: the WHERE clause re-checks the revision so a racing
        // writer cannot slip between the SELECT and the UPDATE.
        const next = current.revision + 1;
        const res = sqlite
          .prepare(
            `UPDATE game_saves SET state = ?, revision = ?, updated_at = ?, schema_version = ?
             WHERE player_id = ? AND revision = ?`,
          )
          .run(serialized, next, now, GAME_SAVE_SCHEMA, input.playerId, input.baseRevision);

        if (res.changes !== 1) return { kind: "conflict", currentRevision: next - 1 };

        const row = sqlite
          .prepare<[string], { created_at: number }>(
            "SELECT created_at FROM game_saves WHERE player_id = ?",
          )
          .get(input.playerId)!;
        return {
          kind: "updated",
          save: {
            state,
            schemaVersion: GAME_SAVE_SCHEMA,
            revision: next,
            createdAt: row.created_at,
            updatedAt: now,
          },
        };
      })
      .immediate();

    touchPlayer(input.playerId, now);
    return outcome;
  } catch (error) {
    // Never leak SQL or filesystem details to the caller.
    console.error("[simplayz] save write failed:", error instanceof Error ? error.message : error);
    return { kind: "storage-error", message: "The save could not be written to the database." };
  }
}

/** Delete only the caller's own game save; the anonymous session row survives. */
export function deleteSave(playerId: string): { deleted: boolean } {
  const db = getDb();
  const res = db.delete(gameSaves).where(eq(gameSaves.playerId, playerId)).run();
  touchPlayer(playerId);
  return { deleted: res.changes > 0 };
}

/**
 * Test-only helper: prove isolation directly at the SQL layer by counting rows
 * for a given player id.
 */
export function countSavesFor(playerId: string): number {
  return getDb()
    .select({ n: sql<number>`count(*)` })
    .from(gameSaves)
    .where(and(eq(gameSaves.playerId, playerId)))
    .get()!.n;
}
