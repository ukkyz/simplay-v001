"use client";

/**
 * Browser-side persistence transport. All requests are same-origin relative
 * paths; there is no configurable API host (which also means no arbitrary-URL
 * proxy and no CORS setup).
 */
import { LEGACY_SAVE_KEY, stripSecrets } from "@/server/gameSave";
import type { SaveResponse, SaveSnapshot } from "./saveQueue";
import type { GameState } from "@/game/types";
import type { WorldMeResponse, WorldResponse } from "@/game/world";

export interface LoadedSave {
  state: GameState;
  revision: number;
  schemaVersion: number;
  updatedAt: number;
}

export interface LoadResult {
  save: LoadedSave | null;
  hasSession: boolean;
}

async function sessionFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
}

/** Create the anonymous session cookie if this browser has none. Idempotent. */
export async function ensureSession(): Promise<boolean> {
  const res = await sessionFetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return res.ok;
}

/** Read the caller's own save. Throws on transport failure. */
export async function loadSave(): Promise<LoadResult> {
  const res = await sessionFetch("/api/save", { method: "GET" });
  if (res.status === 401) return { save: null, hasSession: false };
  if (!res.ok) throw new Error(`Load failed (${res.status})`);
  const json = (await res.json()) as { save: LoadedSave | null };
  return { save: json.save, hasSession: true };
}

/** Save transport used by SaveQueue. Never throws: failures become results. */
export async function putSave(
  snapshot: SaveSnapshot<GameState>,
  signal: AbortSignal,
): Promise<SaveResponse> {
  let res: Response;
  try {
    res = await fetch("/api/save", {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseRevision: snapshot.baseRevision, state: stripSecrets(snapshot.state) }),
      signal,
      keepalive: false,
    });
  } catch {
    return { ok: false, status: 0, code: "network_error", message: "Network unavailable." };
  }

  const json = (await res.json().catch(() => null)) as
    | {
        save?: { revision: number };
        error?: { code?: string; message?: string };
        currentRevision?: number;
        problems?: string[];
      }
    | null;

  if (res.ok && json?.save)
    return { ok: true, revision: json.save.revision, created: res.status === 201 };

  return {
    ok: false,
    status: res.status,
    code: json?.error?.code ?? `http_${res.status}`,
    message: json?.error?.message,
    currentRevision: json?.currentRevision,
    problems: json?.problems,
  };
}

/** Best-effort unload save. `keepalive` may fail; it is never a durability promise. */
export function putSaveKeepalive(snapshot: SaveSnapshot<GameState>): void {
  try {
    void fetch("/api/save", {
      method: "PUT",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseRevision: snapshot.baseRevision, state: stripSecrets(snapshot.state) }),
    });
  } catch {
    /* unload best effort */
  }
}

export interface ResetResult {
  deleted: boolean;
  error?: string;
}

export async function resetSave(): Promise<ResetResult> {
  const res = await fetch("/api/save", {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  if (res.ok) {
    const json = (await res.json().catch(() => ({ deleted: false }))) as { deleted: boolean };
    return { deleted: json.deleted };
  }
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return { deleted: false, error: json?.error?.message ?? `Reset failed (${res.status})` };
}

/* ------------------------- legacy localStorage path ------------------------- */

export const LEGACY_KEY = LEGACY_SAVE_KEY;

/** Read the legacy v4 save if present. Never deletes it. */
export function readLegacySave(): unknown | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_SAVE_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/**
 * Retire the legacy copy *after* the server has acknowledged a save, so a failed
 * migration can never lose the only copy of a player's progress.
 */
export function clearLegacySave(): void {
  try {
    window.localStorage.removeItem(LEGACY_SAVE_KEY);
  } catch {
    /* private mode — leave it, it will simply be re-offered next load */
  }
}

/* ----------------------------- shared world ------------------------------ */

/**
 * Shared-world transport. Relative URLs only, `no-store` everywhere: a cached
 * roster would show one player a stale world and another a fresh one.
 *
 * This is presence, not authority: nothing here can mutate the caller's save.
 */
export interface WorldFetchResult {
  ok: boolean;
  json?: WorldResponse;
  status: number;
}

export async function fetchWorld(
  bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number },
  limit: number,
  signal: AbortSignal,
): Promise<WorldFetchResult> {
  const qs = new URLSearchParams({
    latMin: bbox.latMin.toFixed(4),
    latMax: bbox.latMax.toFixed(4),
    lngMin: bbox.lngMin.toFixed(4),
    lngMax: bbox.lngMax.toFixed(4),
    limit: String(limit),
  });
  try {
    const res = await sessionFetch(`/api/world?${qs.toString()}`, { signal });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, json: (await res.json()) as WorldResponse };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function fetchWorldMe(): Promise<WorldMeResponse | null> {
  try {
    const res = await sessionFetch("/api/world/me", { method: "GET" });
    if (!res.ok) return null;
    return (await res.json()) as WorldMeResponse;
  } catch {
    return null;
  }
}

export interface PublishResult {
  ok: boolean;
  published: boolean;
  message?: string;
}

/**
 * Toggle publication of the caller's area. The body carries only the boolean:
 * position and company are derived server-side from the caller's own save.
 */
export async function setPublished(publish: boolean): Promise<PublishResult> {
  try {
    const res = await sessionFetch("/api/world/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publish }),
    });
    const json = (await res.json().catch(() => null)) as
      | { published?: boolean; error?: { message?: string } }
      | null;
    if (!res.ok)
      return {
        ok: false,
        published: !publish,
        message: json?.error?.message ?? `Publish failed (${res.status}).`,
      };
    return { ok: true, published: json?.published ?? publish };
  } catch {
    return { ok: false, published: !publish, message: "Network unavailable." };
  }
}
