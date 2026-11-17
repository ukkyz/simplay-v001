/**
 * Serialized, coalesced save queue.
 *
 * Replaces the prototype's 700 ms debounce, which was reset by every simulation
 * tick: at 4× (250 ms) and 16× (62.5 ms) a save could be postponed forever.
 *
 * Contract:
 *  - At most one write is in flight per client.
 *  - While submissions keep arriving (continuous play), a write is attempted at
 *    least every `minIntervalMs` (default 4,000 ms) — comfortably inside the
 *    5-second progress-loss budget, and far cheaper than one write per tick
 *    (16 writes/s at 16×).
 *  - The latest snapshot always wins; intermediate ticks are dropped, which is
 *    safe because a snapshot is complete game state, not a delta.
 *  - Failures keep the pending snapshot and retry with capped backoff; the game
 *    keeps running in memory.
 *  - `flushNow()` is used for significant events (pause, construction, trade,
 *    reset) and never creates one request per tick.
 *  - On a revision conflict the queue pauses and reports it; nothing is
 *    overwritten until the player picks a version.
 *
 * Timing and I/O are injected so the scheduling contract is unit-testable
 * without real timers or a server.
 */

export interface SaveSnapshot<T> {
  state: T;
  baseRevision: number;
}

export type SaveResponse =
  | { ok: true; revision: number; created: boolean }
  | {
      ok: false;
      status: number;
      code: string;
      message?: string;
      currentRevision?: number;
      problems?: string[];
    };

export type SaveFn<T> = (snapshot: SaveSnapshot<T>, signal: AbortSignal) => Promise<SaveResponse>;

export type SaveQueueStatus =
  | { kind: "idle" }
  | { kind: "saving"; revision: number }
  | { kind: "saved"; revision: number; at: number }
  | { kind: "error"; message: string; code: string; retryInMs: number }
  | { kind: "conflict"; serverRevision: number; message: string }
  | { kind: "paused" };

export interface SaveQueueOptions<T> {
  save: SaveFn<T>;
  minIntervalMs?: number; // healthy-connectivity cadence, must stay <= 5000
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Injected for tests; default wall clock. */
  now?: () => number;
  /** Injected for tests; must behave like setTimeout/clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onStatus?: (status: SaveQueueStatus) => void;
}

export class SaveQueue<T> {
  private readonly save: SaveFn<T>;
  private readonly minIntervalMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly onStatus?: (status: SaveQueueStatus) => void;

  /** Latest snapshot not yet acknowledged by the server. */
  private pending: SaveSnapshot<T> | null = null;
  private baseRevision = 0;
  private inFlight: AbortController | null = null;
  private timer: unknown = null;
  private lastAttemptAt = 0;
  private failures = 0;
  private pausedForConflict = false;
  private disposed = false;
  private status: SaveQueueStatus = { kind: "idle" };

  constructor(opts: SaveQueueOptions<T>) {
    this.save = opts.save;
    this.minIntervalMs = Math.min(opts.minIntervalMs ?? 4_000, 5_000);
    this.retryBaseMs = opts.retryBaseMs ?? 3_000;
    this.retryMaxMs = opts.retryMaxMs ?? 30_000;
    this.now = opts.now ?? (() => Date.now());
    this.setTimer =
      opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onStatus = opts.onStatus;
  }

  getStatus(): SaveQueueStatus {
    return this.status;
  }

  getBaseRevision(): number {
    return this.baseRevision;
  }

  /** Seed the revision after an initial GET (0 when the server has no save). */
  setBaseRevision(revision: number): void {
    this.baseRevision = revision;
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  /** Queue a snapshot. Cheap to call on every tick: it only replaces `pending`. */
  submit(state: T): void {
    if (this.disposed) return;
    this.pending = { state, baseRevision: this.baseRevision };
    if (this.pausedForConflict) return;
    this.armTimer();
  }

  /** Attempt a write now (used by pause, significant actions, pagehide). */
  async flushNow(): Promise<void> {
    if (this.disposed || this.pausedForConflict) return;
    this.clearTimerHandle();
    await this.drain();
  }

  /** Stop scheduling (conflict or unmount) without discarding the snapshot. */
  pauseForConflict(serverRevision: number, message: string): void {
    this.pausedForConflict = true;
    this.clearTimerHandle();
    this.setStatus({ kind: "conflict", serverRevision, message });
  }

  /** Player resolved the conflict: continue from the chosen revision. */
  resumeFrom(revision: number, keepPending: boolean): void {
    this.pausedForConflict = false;
    this.baseRevision = revision;
    this.failures = 0;
    if (keepPending && this.pending) this.pending = { state: this.pending.state, baseRevision: revision };
    if (keepPending) this.armTimer();
    else this.pending = null;
  }

  /** Best-effort unload flush: keepalive fetch, no retry, never blocks unload. */
  buildUnloadRequest(): { state: T; baseRevision: number } | null {
    if (!this.pending) return null;
    return { state: this.pending.state, baseRevision: this.pending.baseRevision };
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimerHandle();
    this.inFlight?.abort();
    this.inFlight = null;
  }

  /* ------------------------------- internals ------------------------------ */

  private setStatus(status: SaveQueueStatus): void {
    this.status = status;
    this.onStatus?.(status);
  }

  private clearTimerHandle(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private armTimer(): void {
    if (this.disposed || this.pausedForConflict || !this.pending) return;
    if (this.inFlight) return; // the drain loop re-arms after the write settles
    this.clearTimerHandle();
    const elapsed = this.now() - this.lastAttemptAt;
    const wait = Math.max(0, this.minIntervalMs - elapsed);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.drain();
    }, wait);
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.pausedForConflict || this.inFlight) return;
    const snapshot = this.pending;
    if (!snapshot) return;

    const controller = new AbortController();
    this.inFlight = controller;
    this.lastAttemptAt = this.now();
    this.setStatus({ kind: "saving", revision: this.baseRevision });

    let response: SaveResponse;
    try {
      response = await this.save({ ...snapshot, baseRevision: this.baseRevision }, controller.signal);
    } catch (error) {
      const message = controller.signal.aborted
        ? "Save was cancelled."
        : "Network error — the game is still running in memory.";
      response = { ok: false, status: 0, code: "network_error", message };
      void error;
    } finally {
      this.inFlight = null;
    }
    if (this.disposed) return;

    if (response.ok) {
      this.baseRevision = response.revision;
      this.failures = 0;
      // Only clear `pending` if no newer snapshot arrived while writing.
      if (this.pending && this.pending.state === snapshot.state) this.pending = null;
      this.setStatus({ kind: "saved", revision: response.revision, at: this.now() });
      if (this.pending) this.armTimer();
      return;
    }

    if (response.code === "revision_conflict") {
      this.pauseForConflict(
        response.currentRevision ?? -1,
        response.message ?? "Another session advanced this save.",
      );
      return;
    }

    this.failures += 1;
    const retryInMs = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** (this.failures - 1));
    const code = response.code;
    if (code === "invalid_save") {
      // A rejected payload will never become valid by retrying. Keep it pending
      // (so the player can export it) but stop hammering the server.
      this.setStatus({
        kind: "error",
        message: response.message ?? "The save was rejected by validation.",
        code,
        retryInMs: 0,
      });
      return;
    }
    this.setStatus({
      kind: "error",
      message: response.message ?? "Could not save.",
      code,
      retryInMs,
    });
    this.clearTimerHandle();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.drain();
    }, retryInMs);
  }
}
