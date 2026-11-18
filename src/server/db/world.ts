import "server-only";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "./client";
import { worldPlayers } from "./schema";
import { readSave } from "./saves";

import type { GameState } from "@/game/types";
import {
  COORD_SCALE,
  WORLD_LIMIT_MAX,
  WORLD_PLAYER_COLORS,
  coarsen,
  fromCoarseInt,
  isValidBBox,
  refForPlayer,
  toCoarseInt,
  type WorldBBox,
  type WorldEntry,
} from "@/game/world";

/**
 * Published-area registry.
 *
 * Every write re-reads the caller's own validated save row and derives the
 * published values from it. A request body can never name a position, a
 * company or another player: the only thing `publish()` accepts is the caller's
 * `playerId` (taken from the verified session cookie) and a boolean.
 */

export type PublishOutcome =
  | { kind: "published"; entry: WorldEntry; updatedAt: number }
  | { kind: "no-save" }
  | { kind: "missing-player" };

function colorFor(playerId: string): string {
  let h = 0;
  for (let i = 0; i < playerId.length; i += 1) h = (h * 31 + playerId.charCodeAt(i)) >>> 0;
  return WORLD_PLAYER_COLORS[h % WORLD_PLAYER_COLORS.length];
}

/** A published row counts as "recently active" for this long (derived, not stored). */
const ONLINE_WINDOW_MS = 5 * 60_000;

function entryFromRow(row: {
  playerId: string;
  company: string;
  latE2: number;
  lngE2: number;
  sideKm: number;
  buildingCount: number;
  color: string;
  updatedAt: number;
}, now = Date.now()): WorldEntry {
  return {
    ref: refForPlayer(row.playerId),
    kind: "player",
    display: row.company,
    color: row.color,
    lat: coarsen(fromCoarseInt(row.latE2)),
    lng: coarsen(fromCoarseInt(row.lngE2)),
    sideKm: row.sideKm,
    buildings: row.buildingCount,
    approximate: true,
    // Presence for real players is derived from their own save-driven row
    // timestamp, so two clients agree without anybody observing anybody, and
    // nothing extra is stored.
    online: now - row.updatedAt <= ONLINE_WINDOW_MS,
    lastSeenAt: row.updatedAt,
  };
}

/** Publish (or refresh) the caller's row from their own persisted save. */
export function publishArea(playerId: string, now = Date.now()): PublishOutcome {
  const save = readSave(playerId);
  if (!save) return { kind: "no-save" };
  const state: GameState = save.state;
  const claim = state.claim;
  if (!claim) return { kind: "no-save" };

  const latE2 = Math.max(-9000, Math.min(9000, toCoarseInt(claim.center.lat)));
  const lngE2 = Math.max(-18000, Math.min(18000, toCoarseInt(claim.center.lng)));
  const sideKm = Math.max(1, Math.min(200, Math.round(claim.sideKm)));
  const buildingCount = Math.max(0, Math.min(64, state.buildings.length));
  const color = colorFor(playerId);

  try {
    getDb()
      .insert(worldPlayers)
      .values({
        playerId,
        company: state.company.slice(0, 64),
        ceoName: state.ceoName.slice(0, 64),
        latE2,
        lngE2,
        sideKm,
        buildingCount,
        color,
        publishedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: worldPlayers.playerId,
        set: {
          company: state.company.slice(0, 64),
          ceoName: state.ceoName.slice(0, 64),
          latE2,
          lngE2,
          sideKm,
          buildingCount,
          color,
          updatedAt: now,
        },
      })
      .run();
  } catch {
    return { kind: "missing-player" };
  }

  return {
    kind: "published",
    updatedAt: now,
    entry: entryFromRow({
      playerId,
      company: state.company.slice(0, 64),
      latE2,
      lngE2,
      sideKm,
      buildingCount,
      color,
      updatedAt: now,
    }),
  };
}

/**
 * Refresh an existing publication after a save write. Deliberately a no-op when
 * the player never published, so browsers that never opt in stay invisible.
 * Called *after* the save transaction commits, never inside it.
 */
export function refreshPublishedArea(playerId: string, now = Date.now()): void {
  try {
    const existing = getDb()
      .select({ playerId: worldPlayers.playerId })
      .from(worldPlayers)
      .where(eq(worldPlayers.playerId, playerId))
      .get();
    if (!existing) return;
    publishArea(playerId, now);
  } catch {
    /* the save already succeeded; a stale registry row is not worth an error */
  }
}

/** Hard delete: opting out must leave nothing addressable behind. */
export function unpublishArea(playerId: string): boolean {
  const res = getDb().delete(worldPlayers).where(eq(worldPlayers.playerId, playerId)).run();
  return res.changes > 0;
}

export function readOwnPublication(playerId: string): {
  published: boolean;
  lat?: number;
  lng?: number;
  sideKm?: number;
  updatedAt?: number;
} {
  const row = getDb()
    .select()
    .from(worldPlayers)
    .where(eq(worldPlayers.playerId, playerId))
    .get();
  if (!row) return { published: false };
  return {
    published: true,
    lat: fromCoarseInt(row.latE2),
    lng: fromCoarseInt(row.lngE2),
    sideKm: row.sideKm,
    updatedAt: row.updatedAt,
  };
}

export interface QueryResult {
  entries: WorldEntry[];
  truncated: boolean;
}

/**
 * Published players inside a bbox. One indexed statement, hard `LIMIT`.
 * `playerId` is never selected into the response, only used to derive `ref`.
 */
export function queryAreas(
  bbox: WorldBBox,
  limit = WORLD_LIMIT_MAX,
  selfId?: string,
  now = Date.now(),
): QueryResult {
  if (!isValidBBox(bbox)) return { entries: [], truncated: false };
  const capped = Math.max(1, Math.min(WORLD_LIMIT_MAX, Math.floor(limit)));
  const latMin = Math.max(-9000, Math.floor(bbox.latMin * COORD_SCALE));
  const latMax = Math.min(9000, Math.ceil(bbox.latMax * COORD_SCALE));
  const lngMin = Math.max(-18000, Math.floor(bbox.lngMin * COORD_SCALE));
  const lngMax = Math.min(18000, Math.ceil(bbox.lngMax * COORD_SCALE));

  const rows = getDb()
    .select({
      playerId: worldPlayers.playerId,
      company: worldPlayers.company,
      latE2: worldPlayers.latE2,
      lngE2: worldPlayers.lngE2,
      sideKm: worldPlayers.sideKm,
      buildingCount: worldPlayers.buildingCount,
      color: worldPlayers.color,
      updatedAt: worldPlayers.updatedAt,
    })
    .from(worldPlayers)
    .where(
      and(
        gte(worldPlayers.latE2, latMin),
        lte(worldPlayers.latE2, latMax),
        gte(worldPlayers.lngE2, lngMin),
        lte(worldPlayers.lngE2, lngMax),
      ),
    )
    .orderBy(asc(worldPlayers.updatedAt))
    .limit(capped + 1)
    .all();

  const truncated = rows.length > capped;
  const entries = rows
    .slice(0, capped)
    // A player sees themselves through their own claim overlay, not as a neighbour.
    .filter((r) => r.playerId !== selfId)
    .map((r) => entryFromRow(r, now));
  return { entries, truncated };
}

/** Test/debug helper: number of published rows, without reading any of them. */
export function publishedCount(): number {
  const row = getDb().select({ n: sql<number>`count(*)` }).from(worldPlayers).get();
  return row?.n ?? 0;
}
