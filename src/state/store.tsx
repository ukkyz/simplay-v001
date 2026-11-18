"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createGame, demoGame, reducer } from "@/game/engine";
import type { Action } from "@/game/engine";
import type { ChatMessage, GameState, Screen } from "@/game/types";
import { GAME_SAVE_SCHEMA, prepareLegacySave, stripSecrets, validateGameState } from "@/server/gameSave";
import {
  LEGACY_KEY,
  clearLegacySave,
  ensureSession,
  fetchWorldMe,
  loadSave,
  putSave,
  putSaveKeepalive,
  readLegacySave,
  resetSave,
  setPublished,
} from "./persistence";
import { SaveQueue, type SaveQueueStatus } from "./saveQueue";

export const TICK_MS = 1000;

/**
 * Save lifecycle.
 *   booting          — first paint, not yet talking to the server
 *   loading          — session + save GET in flight
 *   onboarding       — no save; the player must register or choose the demo
 *   ready            — save loaded (or created); simulation may tick
 *   legacy-offer     — a schema-4 localStorage save exists; awaiting the choice
 *   legacy-conflict  — both a server save and legacy data exist; player decides
 *   load-error       — the server could not be reached; retry is offered
 */
export type SavePhase =
  | "booting"
  | "loading"
  | "onboarding"
  | "legacy-offer"
  | "legacy-conflict"
  | "ready"
  | "load-error";

export interface UiState {
  screen: Screen;
  booted: boolean;
  selectedAreaId: string | null;
  selectedSiteId: string | null;
  studioTarget: { kind: "project" | "building"; id: string } | null;
  visit: { ownerName: string; buildingName: string; planId: string } | null;
  toast: { text: string; tone: "info" | "good" | "bad" } | null;
  chat: ChatMessage[];
  chatRole: "cto" | "cfo" | "coo" | "all";
}

/**
 * Shared-world publication state for *this* player.
 *
 * `published` defaults to false and is never inferred: the server is the source
 * of truth, and a player who never opted in must stay invisible.
 */
export interface WorldView {
  published: boolean;
  busy: boolean;
  /** Coarsened position the server stored, only while published. */
  area: { lat: number; lng: number; sideKm: number } | null;
}

export interface PersistenceView {
  phase: SavePhase;
  status: SaveQueueStatus;
  revision: number;
  serverUpdatedAt: number | null;
  lastSavedAt: number | null;
  loadError: string | null;
  conflict: { serverRevision: number; message: string } | null;
  legacy: { available: boolean; valid: boolean; company?: string; tick?: number; problem?: string } | null;
}

interface Ctx {
  state: GameState;
  ui: UiState;
  dispatch: React.Dispatch<Action>;
  setUi: (patch: Partial<UiState> | ((u: UiState) => Partial<UiState>)) => void;
  toast: (text: string, tone?: "info" | "good" | "bad") => void;
  newGame: (name: string, company: string, lat: number, lng: number, by: "geolocation" | "manual") => void;
  loadDemo: () => void;
  hardReset: () => Promise<void>;
  persistence: PersistenceView;
  /** Shared-world publication for this player (presence only, opt-in). */
  world: WorldView;
  togglePublished: () => Promise<void>;
  retrySave: () => void;
  reloadFromServer: () => Promise<void>;
  /** Conflict recovery: adopt the server's newer snapshot, discarding local pending. */
  acceptServerVersion: () => Promise<void>;
  /** Conflict recovery: force the local snapshot over the server revision. */
  overwriteWithLocal: () => Promise<void>;
  /** Explicit one-time legacy localStorage migration. */
  migrateLegacy: () => Promise<void>;
  dismissLegacy: () => void;
  /** Replace the live state from a validated import; schedules a save. */
  importState: (state: GameState) => Promise<void>;
  exportState: () => GameState;
  unloadWarning: boolean;
}

const GameCtx = createContext<Ctx | null>(null);

function placeholder(): GameState {
  return createGame("UNREGISTERED", "UNCLAIMED HOLDINGS", 0, 0, "manual");
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, placeholder);
  const [ui, setUiRaw] = useState<UiState>({
    screen: "world",
    booted: false,
    selectedAreaId: null,
    selectedSiteId: null,
    studioTarget: null,
    visit: null,
    toast: null,
    chat: [],
    chatRole: "all",
  });
  const [phase, setPhase] = useState<SavePhase>("booting");
  const [status, setStatus] = useState<SaveQueueStatus>({ kind: "idle" });
  const [revision, setRevision] = useState(0);
  const [serverUpdatedAt, setServerUpdatedAt] = useState<number | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ serverRevision: number; message: string } | null>(null);
  const [legacy, setLegacy] = useState<PersistenceView["legacy"]>(null);
  const [world, setWorld] = useState<WorldView>({ published: false, busy: false, area: null });
  const worldRef = useRef(world);
  worldRef.current = world;

  const queueRef = useRef<SaveQueue<GameState> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;

  // ---- save queue -------------------------------------------------------
  // Held in a ref so StrictMode's mount → unmount → mount cycle disposes the
  // first queue (timers cleared) and transparently builds a fresh one.
  const getQueue = useCallback((): SaveQueue<GameState> => {
    if (!queueRef.current)
      queueRef.current = new SaveQueue<GameState>({
        save: putSave,
        minIntervalMs: 4_000,
        onStatus: setStatus,
      });
    return queueRef.current;
  }, []);

  const setUi = useCallback(
    (patch: Partial<UiState> | ((u: UiState) => Partial<UiState>)) =>
      setUiRaw((u) => ({ ...u, ...(typeof patch === "function" ? patch(u) : patch) })),
    [],
  );

  const toastTimer = useRef<number | null>(null);
  const toast = useCallback((text: string, tone: "info" | "good" | "bad" = "info") => {
    setUiRaw((u) => ({ ...u, toast: { text, tone } }));
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setUiRaw((u) => ({ ...u, toast: null })), 3600);
  }, []);

  /* ------------------------------ bootstrap ------------------------------ */

  const bootstrap = useCallback(async () => {
    setPhase("loading");
    setLoadError(null);
    try {
      let load = await loadSave();
      if (!load.hasSession) {
        const created = await ensureSession();
        if (!created) throw new Error("Could not create an anonymous session.");
        load = await loadSave();
        if (!load.hasSession) throw new Error("Anonymous session was not accepted.");
      }

      // An existing server save always wins over local defaults. It is never
      // replaced by onboarding state.
      if (load.save) {
        dispatch({ type: "hydrate", state: stripSecrets(load.save.state) });
        getQueue().setBaseRevision(load.save.revision);
        setRevision(load.save.revision);
        setServerUpdatedAt(load.save.updatedAt);
        setUiRaw((u) => ({ ...u, booted: true, screen: "world" }));
        const legacyRaw = readLegacySave();
        if (legacyRaw) {
          const v = validateGameState(prepareLegacySave(legacyRaw));
          setLegacy({
            available: true,
            valid: v.ok,
            company: v.ok ? v.state?.company : undefined,
            tick: v.ok ? v.state?.economy.tick : undefined,
            problem: v.ok ? undefined : `legacy save failed validation (${v.errors.slice(0, 3).join(", ")})`,
          });
          setPhase("legacy-conflict");
          return;
        }
        setPhase("ready");
        return;
      }

      // No server save yet.
      const legacyRaw = readLegacySave();
      if (legacyRaw) {
        const v = validateGameState(prepareLegacySave(legacyRaw));
        setLegacy({
          available: true,
          valid: v.ok,
          company: v.ok ? v.state?.company : undefined,
          tick: v.ok ? v.state?.economy.tick : undefined,
          problem: v.ok ? undefined : `legacy save failed validation (${v.errors.slice(0, 3).join(", ")})`,
        });
        setPhase("legacy-offer");
        return;
      }
      setPhase("onboarding");
    } catch (error) {
      setLoadError((error as Error).message || "Could not reach the save server.");
      setPhase("load-error");
    }
  }, [getQueue]);

  useEffect(() => {
    void bootstrap();
    return () => {
      queueRef.current?.dispose();
      queueRef.current = null;
    };
  }, [bootstrap]);

  /* ------------------------------ simulation ----------------------------- */

  // Ticks only run once the save state is settled: never during loading, never
  // behind the onboarding/legacy choice, never on top of an unresolved conflict.
  useEffect(() => {
    // A conflict freezes the simulation so the two versions stay comparable while
    // the player decides which one to keep.
    if (phase !== "ready" || conflict || !ui.booted || state.speed === 0) return;
    const id = window.setInterval(() => dispatch({ type: "tick" }), TICK_MS / state.speed);
    return () => window.clearInterval(id);
  }, [phase, conflict, ui.booted, state.speed]);

  /* ------------------------------ autosave ------------------------------- */

  // Every state change after the initial load is queued. The queue coalesces
  // these into one write per ~4 s while the game is running; it is NOT a
  // per-tick request. The very first run is the snapshot that just came from
  // the server, so re-writing it would only burn a revision.
  const hydratedStateRef = useRef<GameState | null>(null);
  useEffect(() => {
    if (phase !== "ready") return;
    if (hydratedStateRef.current === null) {
      hydratedStateRef.current = state;
      return;
    }
    getQueue().submit(state);
  }, [state, phase, getQueue]);

  // Significant events save promptly without waiting for the cadence.
  const lastSavedTick = useRef(-1);
  useEffect(() => {
    if (phase !== "ready") return;
    const paused = state.speed === 0 && lastSavedTick.current !== state.economy.tick;
    if (paused) {
      lastSavedTick.current = state.economy.tick;
      void getQueue().flushNow();
    }
  }, [state.speed, state.economy.tick, phase, getQueue]);

  // Best-effort unload flush. Not a durability guarantee: the browser may kill
  // the request, and `keepalive` bodies are byte-capped.
  useEffect(() => {
    if (phase !== "ready") return;
    const onHide = () => {
      const snap = queueRef.current?.buildUnloadRequest();
      if (snap) putSaveKeepalive(snap);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase]);

  // Track the server revision whenever a write succeeds.
  useEffect(() => {
    if (status.kind === "saved") {
      setRevision(status.revision);
      setLastSavedAt(status.at);
      setServerUpdatedAt(status.at);
      setConflict(null);
      // Only after an acknowledged write may a legacy copy be retired.
      if (legacy?.available && phase === "ready") {
        clearLegacySave();
        setLegacy(null);
      }
    }
    if (status.kind === "conflict") {
      setConflict({ serverRevision: status.serverRevision, message: status.message });
      void (async () => {
        const { save } = await loadSave();
        if (save) setServerUpdatedAt(save.updatedAt);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const retrySave = useCallback(() => {
    void getQueue().flushNow();
  }, [getQueue]);

  /* --------------------------- player choices ---------------------------- */

  const startPlayer = useCallback(
    (next: GameState) => {
      const q = getQueue();
      dispatch({ type: "hydrate", state: next });
      q.setBaseRevision(0);
      setRevision(0);
      setUiRaw((u) => ({ ...u, booted: true, screen: "world", chat: [] }));
      setPhase("ready");
      q.submit(next);
    },
    [getQueue],
  );

  const newGame = useCallback(
    (name: string, company: string, lat: number, lng: number, by: "geolocation" | "manual") => {
      const g = createGame(name, company, lat, lng, by);
      g.speed = 1;
      startPlayer(g);
    },
    [startPlayer],
  );

  const loadDemo = useCallback(() => {
    // Pre-rolled city (GDD §7.2): 274 sim-hours of history so the loops are
    // visible on first contact instead of behind an empty map.
    startPlayer(demoGame());
  }, [startPlayer]);

  const hardReset = useCallback(async () => {
    const result = await resetSave();
    // Keep the same queue instance: a new one would be invisible to callbacks
    // that captured the previous reference. Resetting the base revision is what
    // makes the next write a create.
    getQueue().resumeFrom(0, false);
    setRevision(0);
    setServerUpdatedAt(null);
    setConflict(null);
    setUiRaw((u) => ({ ...u, booted: false, screen: "world", chat: [] }));
    dispatch({
      type: "register",
      ceoName: "UNREGISTERED",
      company: "UNCLAIMED HOLDINGS",
      lat: 0,
      lng: 0,
      placedBy: "manual",
    });
    if (result.error) {
      toast(`Reset could not reach the server — ${result.error}`, "bad");
      setPhase("ready");
      return;
    }
    setPhase("onboarding");
    toast("Server save deleted and legacy browser save cleared. Back to the claim form.", "bad");
    clearLegacySave();
  }, [getQueue, toast]);

  /* --------------------------- conflict recovery ------------------------- */

  const acceptServerVersion = useCallback(async () => {
    const { save } = await loadSave();
    if (!save) {
      toast("The server reports no save to load.", "bad");
      return;
    }
    dispatch({ type: "hydrate", state: stripSecrets(save.state) });
    getQueue().resumeFrom(save.revision, false);
    setRevision(save.revision);
    setServerUpdatedAt(save.updatedAt);
    setConflict(null);
    toast(`Loaded the server version (revision ${save.revision}). Local edits were discarded.`, "good");
  }, [getQueue, toast]);

  const overwriteWithLocal = useCallback(async () => {
    const { save } = await loadSave();
    if (!save) return;
    getQueue().resumeFrom(save.revision, true);
    setRevision(save.revision);
    setConflict(null);
    await getQueue().flushNow();
    toast("Local snapshot written over the server revision.", "good");
  }, [getQueue, toast]);

  const reloadFromServer = useCallback(async () => {
    await bootstrap();
  }, [bootstrap]);

  /* ------------------------------ legacy path ---------------------------- */

  /**
   * Revision to write against for an *explicit* player action (import, legacy
   * migration) that is allowed to replace an existing server save. Reads the
   * current revision so the write is an accepted overwrite rather than a 409.
   */
  const serverRevisionForOverwrite = useCallback(async (): Promise<number> => {
    try {
      const { save } = await loadSave();
      return save?.revision ?? 0;
    } catch {
      return revisionRef.current;
    }
  }, []);

  const migrateLegacy = useCallback(async () => {
    const raw = readLegacySave();
    if (!raw) {
      setLegacy(null);
      toast("No legacy save found in this browser.", "bad");
      return;
    }
    const validation = validateGameState(prepareLegacySave(raw));
    if (!validation.ok || !validation.state) {
      toast(`Legacy save rejected — ${validation.errors.slice(0, 3).join(", ")}`, "bad");
      return;
    }
    // Credentials in the old blob are dropped by normalizeAdvisorConfig inside
    // validateGameState: old AI keys are never uploaded.
    const migrated = validation.state;
    const q = getQueue();
    // The player explicitly chose to migrate, so an existing server save may be
    // replaced — but only from its current revision, never blindly.
    const base = await serverRevisionForOverwrite();
    q.resumeFrom(base, true);
    setRevision(base);
    dispatch({ type: "hydrate", state: migrated });
    setUiRaw((u) => ({ ...u, booted: true, screen: "world" }));
    setPhase("ready");
    q.submit(migrated);
    await q.flushNow();
    if (q.getStatus().kind === "conflict") {
      toast("The server changed while migrating — choose which version to keep.", "bad");
      return;
    }
    toast("Legacy save migrated to the server. The browser copy is cleared after the write is acknowledged.", "good");
  }, [getQueue, serverRevisionForOverwrite, toast]);

  const dismissLegacy = useCallback(() => {
    setLegacy(null);
    setPhase((p) => (p === "legacy-offer" || p === "legacy-conflict" ? "onboarding" : "ready"));
  }, []);

  /* ------------------------------- import -------------------------------- */

  const importState = useCallback(
    async (imported: GameState) => {
      const clean = stripSecrets(imported);
      const q = getQueue();
      // Import is an explicit replace: write from the server's current revision so
      // the player's choice is not turned into a spurious conflict.
      const base = await serverRevisionForOverwrite();
      q.resumeFrom(base, true);
      setRevision(base);
      dispatch({ type: "hydrate", state: clean });
      setUiRaw((u) => ({ ...u, booted: true, screen: "world" }));
      setPhase("ready");
      q.submit(clean);
      await q.flushNow();
      if (q.getStatus().kind === "conflict") {
        toast("The server changed while importing — choose which version to keep.", "bad");
        return;
      }
      toast("Save imported, validated and written to the server.", "good");
    },
    [getQueue, serverRevisionForOverwrite, toast],
  );

  const exportState = useCallback(() => stripSecrets(stateRef.current), []);

  /* ---------------------------- shared world ----------------------------- */

  /** Ask the server whether this player's area is published (source of truth). */
  const refreshWorldMe = useCallback(async () => {
    const me = await fetchWorldMe();
    if (!me) return;
    setWorld((w) => ({
      ...w,
      published: me.published,
      area:
        me.published && typeof me.lat === "number" && typeof me.lng === "number"
          ? { lat: me.lat, lng: me.lng, sideKm: me.sideKm ?? 0 }
          : null,
    }));
  }, []);

  useEffect(() => {
    if (phase !== "ready" || !ui.booted) return;
    void refreshWorldMe();
  }, [phase, ui.booted, refreshWorldMe]);

  const togglePublished = useCallback(async () => {
    setWorld((w) => ({ ...w, busy: true }));
    const next = !worldRef.current.published;
    const result = await setPublished(next);
    if (!result.ok) {
      toast(result.message ?? "Could not change sharing.", "bad");
      setWorld((w) => ({ ...w, busy: false }));
      return;
    }
    toast(
      result.published
        ? "Your area is published (approximate, ≈1 km). Other players will see it."
        : "Your area is no longer shared. The published row was deleted.",
      result.published ? "good" : "bad",
    );
    await refreshWorldMe();
    setWorld((w) => ({ ...w, busy: false }));
  }, [refreshWorldMe, toast]);

  const value = useMemo<Ctx>(
    () => ({
      state,
      ui,
      dispatch,
      setUi,
      toast,
      newGame,
      loadDemo,
      hardReset,
      persistence: {
        phase,
        status,
        revision,
        serverUpdatedAt,
        lastSavedAt,
        loadError,
        conflict,
        legacy,
      },
      world,
      togglePublished,
      retrySave,
      reloadFromServer,
      acceptServerVersion,
      overwriteWithLocal,
      migrateLegacy,
      dismissLegacy,
      importState,
      exportState,
      unloadWarning: phase === "ready" && (status.kind === "error" || status.kind === "saving"),
    }),
    [
      state,
      ui,
      setUi,
      toast,
      newGame,
      loadDemo,
      hardReset,
      phase,
      status,
      revision,
      serverUpdatedAt,
      lastSavedAt,
      loadError,
      conflict,
      legacy,
      world,
      togglePublished,
      retrySave,
      reloadFromServer,
      acceptServerVersion,
      overwriteWithLocal,
      migrateLegacy,
      dismissLegacy,
      importState,
      exportState,
    ],
  );

  return <GameCtx.Provider value={value}>{children}</GameCtx.Provider>;
}

export function useGame() {
  const c = useContext(GameCtx);
  if (!c) throw new Error("useGame must be used inside GameProvider");
  return c;
}

export { GAME_SAVE_SCHEMA, LEGACY_KEY };
