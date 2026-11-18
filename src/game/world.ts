/**
 * Shared world: coarsening, deterministic AI roster and the wire types for
 * `/api/world`. Isomorphic — no `server-only`, no React, no timers.
 *
 * Why this file exists: the map used to fabricate "other CEOs" per save
 * (`makePeers` seeded with the player's own coordinates), so every player saw a
 * different invented neighbourhood. Everything a client shows as a *neighbour*
 * now comes from one of two shared sources:
 *   1. real players published in the `world_players` registry (server-derived),
 *   2. this module's AI roster, which depends only on `SIMPLAYZ_WORLD_SEED` and
 *      a coarse world cell grid — identical for every client and stable while
 *      panning, because placement never depends on the viewport.
 *
 * Coarsening note (privacy): published coordinates are rounded to 1/100 of a
 * degree (≈1.1 km at the equator) *before* they are stored, so the registry,
 * its backups and every response contain no precise geolocation.
 */
import { hashString, mulberry32 } from "./geo";

/** Persons reused from the original per-save peer generator. */
export const WORLD_PERSONAS = [
  { name: "Aurora Kasprzak", handle: "@aurora.builds", color: "#a3cb4d" },
  { name: "Teodor Mihail", handle: "@teodor_m", color: "#6fb7ff" },
  { name: "Nneka Adeyemi", handle: "@nneka.ops", color: "#f2a33c" },
  { name: "Ravi Chandran", handle: "@ravi_ch", color: "#ff8347" },
] as const;

/** Player colours are server-assigned from this palette (never client-supplied). */
export const WORLD_PLAYER_COLORS = ["#35d6c0", "#c9a227", "#8b7cf6", "#e05c7f", "#4f9d69", "#5aa9e6"] as const;

/** Default world seed. Non-secret; changing it moves every AI area for everyone. */
export const DEFAULT_WORLD_SEED = "simplayz-world-1";

/** Grid resolution for deterministic AI areas (≈27 km at the equator). */
export const WORLD_CELL_DEG = 0.25;

/** Coordinates are stored/transmitted at this precision (1/100 degree). */
export const COORD_SCALE = 100;

/** Upper bound on grid cells inspected per roster call (wide viewports sample). */
export const MAX_ROSTER_CELLS = 512;

export const WORLD_LIMIT_MAX = 200;
export const WORLD_LIMIT_DEFAULT = 200;
/** Per-tab poll interval; the map never polls faster than this. */
export const WORLD_POLL_MS = 10_000;
/** AI `online` flips on this bucket so two clients agree at the same moment. */
export const WORLD_PRESENCE_BUCKET_MS = 5 * 60_000;

export type WorldKind = "player" | "ai";

export interface WorldEntry {
  ref: string;
  kind: WorldKind;
  display: string;
  color: string;
  /** Coarsened centre (2 decimals). */
  lat: number;
  lng: number;
  sideKm: number;
  buildings: number;
  approximate: boolean;
  online: boolean;
  lastSeenAt: number;
}

export interface WorldResponse {
  version: 1;
  entries: WorldEntry[];
  truncated: boolean;
  /** `kind` counts, so a UI can never silently mix humans and simulation. */
  counts: { player: number; ai: number };
  serverTime: number;
  seed: string;
}

export interface WorldMeResponse {
  version: 1;
  published: boolean;
  lat?: number;
  lng?: number;
  sideKm?: number;
  updatedAt?: number;
}

/* ------------------------------- coarsening ------------------------------- */

/** Round to the published precision. Floats only ever leave the server at 2 dp. */
export function coarsen(value: number): number {
  return Math.round(value * COORD_SCALE) / COORD_SCALE;
}

/** Integer form used for storage; `COORD_SCALE` thousandths-of-a-degree. */
export function toCoarseInt(value: number): number {
  return Math.round(value * COORD_SCALE);
}

export function fromCoarseInt(value: number): number {
  return value / COORD_SCALE;
}

/** Reserved for the CSS-safe colour check on stored player colours. */
export function isWorldColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/* ------------------------------ AI roster --------------------------------- */

export interface WorldBBox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/**
 * Stable opaque handle. `kind` is part of the hash so a player ref can never
 * collide with an AI ref, and the player's real `player_id` never leaves the
 * server (it is the SHA-256 of the session cookie).
 */
export function refForPlayer(playerId: string): string {
  const a = hashString(`simplayz:world:player:${playerId}`).toString(16).padStart(8, "0");
  const b = hashString(`simplayz:world:2:${playerId}`).toString(16).padStart(8, "0");
  return `${a}${b}`;
}

function refForAi(seed: string, cx: number, cy: number, i: number): string {
  const key = `${seed}:${cx}:${cy}:${i}`;
  const a = hashString(`ai:${key}`).toString(16).padStart(8, "0");
  const b = hashString(`ai2:${key}`).toString(16).padStart(8, "0");
  return `${a}${b}`;
}

/**
 * Deterministic AI areas inside a bbox.
 *
 * Placement is a pure function of (seed, cell) — never of the bbox — so panning
 * the map does not shuffle the neighbours, and two processes with the same seed
 * return byte-identical entries. `presenceBucket` is the only time input, which
 * keeps `online` agreeing between clients without storing it.
 */
export function aiRoster(bbox: WorldBBox, seed: string, now: number): WorldEntry[] {
  const out: WorldEntry[] = [];
  const cxMin = Math.floor(bbox.latMin / WORLD_CELL_DEG);
  const cxMax = Math.floor(bbox.latMax / WORLD_CELL_DEG);
  const cyMin = Math.floor(bbox.lngMin / WORLD_CELL_DEG);
  const cyMax = Math.floor(bbox.lngMax / WORLD_CELL_DEG);
  if (cxMax < cxMin || cyMax < cyMin) return out;

  /**
   * Wide viewports are *sampled*, never dropped.
   *
   * A cell's content depends only on `(seed, cx, cy)`, so taking every Nth cell
   * leaves the surviving neighbours at identical positions with identical refs —
   * zooming out shows fewer, further-apart AI areas instead of an empty world,
   * and zooming back in never moves anything.
   */
  const cells = (cxMax - cxMin + 1) * (cyMax - cyMin + 1);
  const stride = cells > MAX_ROSTER_CELLS ? Math.ceil(Math.sqrt(cells / MAX_ROSTER_CELLS)) : 1;

  const bucket = Math.floor(now / WORLD_PRESENCE_BUCKET_MS);
  for (let cx = cxMin; cx <= cxMax; cx += 1) {
    // Alignment is on the absolute cell index, not the bbox origin, so panning
    // a sampled (zoomed-out) viewport cannot shuffle which neighbours survive.
    if (((cx % stride) + stride) % stride !== 0) continue;
    for (let cy = cyMin; cy <= cyMax; cy += 1) {
      if (((cy % stride) + stride) % stride !== 0) continue;
      const rnd = mulberry32(hashString(`${seed}:${cx}:${cy}`));
      const count = 1 + Math.floor(rnd() * 2); // 1–2 areas per cell
      for (let i = 0; i < count; i += 1) {
        const persona = WORLD_PERSONAS[Math.floor(rnd() * WORLD_PERSONAS.length)];
        const lat = (cx + 0.5) * WORLD_CELL_DEG + (rnd() - 0.5) * WORLD_CELL_DEG * 0.6;
        const lng = (cy + 0.5) * WORLD_CELL_DEG + (rnd() - 0.5) * WORLD_CELL_DEG * 0.6;
        const sideKm = 6 + Math.round(rnd() * 3);
        const buildings = 2 + Math.floor(rnd() * 6);
        const presence = mulberry32(hashString(`${seed}:${cx}:${cy}:${i}:${bucket}`))();
        out.push({
          ref: refForAi(seed, cx, cy, i),
          kind: "ai",
          display: persona.name,
          color: persona.color,
          lat: coarsen(lat),
          lng: coarsen(lng),
          sideKm,
          buildings,
          approximate: true,
          online: presence > 0.25,
          // Presence is derived, not observed: report the bucket start.
          lastSeenAt: bucket * WORLD_PRESENCE_BUCKET_MS,
        });
      }
    }
  }
  return out;
}

/** True when the bbox is missing, reversed or non-finite. */
export function isValidBBox(b: Partial<WorldBBox> | null | undefined): b is WorldBBox {
  if (!b) return false;
  const vals = [b.latMin, b.latMax, b.lngMin, b.lngMax];
  if (vals.some((v) => typeof v !== "number" || !Number.isFinite(v))) return false;
  if (b.latMin! < -90 || b.latMax! > 90 || b.lngMin! < -180 || b.lngMax! > 180) return false;
  return b.latMin! <= b.latMax! && b.lngMin! <= b.lngMax!;
}

/** Legend/copy contract — one place, so UI strings cannot drift apart. */
export const WORLD_LABELS = {
  own: "Owner · you",
  player: "Player · approximate (≈1 km)",
  ai: "AI neighbour · simulated",
  notShared: "Not shared with other players",
  shared: "Your area is published to other players",
  offline: "Offline neighbours · simulated fallback",
} as const;
