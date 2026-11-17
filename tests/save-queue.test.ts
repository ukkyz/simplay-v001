import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SaveQueue, type SaveResponse, type SaveSnapshot } from "@/state/saveQueue";

/**
 * Scheduling contract tests for the autosave queue. Timers and the clock are
 * injected, so these assert cadence logic, not wall-clock behaviour.
 */

interface TimerEntry {
  at: number;
  fn: () => void;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** A deterministic clock + timer registry standing in for setTimeout. */
function harness(save: (snap: SaveSnapshot<number>) => Promise<SaveResponse>) {
  let time = 0;
  let seq = 0;
  const timers = new Map<number, TimerEntry>();

  const queue = new SaveQueue<number>({
    save,
    minIntervalMs: 4_000,
    retryBaseMs: 3_000,
    retryMaxMs: 9_000,
    now: () => time,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: time + ms, fn });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
  });

  /** Advance the clock in 1 ms steps, firing timers that come due. */
  const advance = async (ms: number): Promise<void> => {
    const target = time + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      time = Math.max(time, due[1].at);
      due[1].fn();
      await flushMicrotasks();
    }
    time = target;
    await flushMicrotasks();
  };

  return { queue, now: () => time, advance };
}

describe("SaveQueue — accelerated continuous play", () => {
  it("attempts a write at least every 5 s while snapshots keep arriving", async () => {
    const writes: { at: number; baseRevision: number }[] = [];
    let revision = 0;
    const h = harness(async (snap) => {
      writes.push({ at: h.now(), baseRevision: snap.baseRevision });
      revision += 1;
      return { ok: true, revision, created: snap.baseRevision === 0 };
    });

    // 16× play = one snapshot every 62.5 ms for 30 simulated seconds.
    // (Keeping this tight: 480 submissions.)
    for (let t = 0; t < 30_000; t += 62.5) {
      h.queue.submit(t);
      await h.advance( 62.5);
    }

    assert.ok(writes.length >= 6, `expected ≥6 writes in 30 s, got ${writes.length}`);

    // No two writes closer together than the cadence (allow a 1 ms rounding edge).
    for (let i = 1; i < writes.length; i++) {
      const gap = writes[i].at - writes[i - 1].at;
      assert.ok(gap >= 3_999, `writes ${i - 1}→${i} were ${gap} ms apart, below the 4 s cadence`);
    }
    // Writes are never more than 5 s apart → bounded progress loss.
    for (let i = 1; i < writes.length; i++) {
      assert.ok(writes[i].at - writes[i - 1].at <= 5_000, "cadence must stay within the 5 s budget");
    }
    // The queue never issues a burst of one write per tick.
    assert.ok(writes.length < 15, `expected coalescing, got ${writes.length} writes`);

    // Base revisions are strictly sequential: one write in flight at a time.
    const bases = writes.map((w) => w.baseRevision);
    assert.deepEqual(
      bases,
      bases.map((_, i) => i),
    );
    h.queue.dispose();
  });

  it("coalesces many submissions into one in-flight write", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const firstHold = { resolve: null as null | ((r: SaveResponse) => void) };
    let calls = 0;
    const h = harness((snap) => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (calls === 1)
        return new Promise<SaveResponse>((resolve) => {
          firstHold.resolve = (r) => {
            inFlight -= 1;
            resolve(r);
          };
        });
      inFlight -= 1;
      return Promise.resolve({ ok: true, revision: snap.baseRevision + 1, created: false });
    });

    for (let i = 0; i < 200; i++) h.queue.submit(i);
    await h.advance( 4_000);
    assert.equal(calls, 1, "one request per cadence window, not one per submission");

    for (let i = 200; i < 400; i++) h.queue.submit(i);
    await h.advance( 1_000);
    assert.equal(calls, 1, "no second request while one is in flight");

    firstHold.resolve?.({ ok: true, revision: 1, created: true });
    await flushMicrotasks();
    await h.advance(4_000);
    assert.equal(maxInFlight, 1, "at most one write in flight per client");
    assert.equal(calls, 2, "the pending snapshot is written after the first settles");
    h.queue.dispose();
  });

  it("flushNow writes immediately (pause / significant action) without per-tick requests", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls += 1;
      return { ok: true, revision: calls, created: false };
    });
    h.queue.submit(1);
    await h.queue.flushNow();
    assert.equal(calls, 1);

    // A burst of ticks after the flush does not each trigger a request.
    for (let i = 0; i < 50; i++) h.queue.submit(i);
    assert.equal(calls, 1, "submitting does not write synchronously");
    h.queue.dispose();
  });
});

describe("SaveQueue — failure and recovery", () => {
  it("keeps the pending snapshot and retries with backoff after a network error", async () => {
    const attempts: number[] = [];
    let succeed = false;
    const h = harness(async () => {
      attempts.push(h.now());
      if (!succeed) return { ok: false, status: 0, code: "network_error", message: "offline" };
      return { ok: true, revision: 1, created: false };
    });

    h.queue.submit(1);
    await h.advance( 4_000); // first attempt fails
    assert.equal(attempts.length, 1);
    assert.equal(h.queue.getStatus().kind, "error");
    assert.equal(h.queue.hasPending(), true, "the snapshot is retained for retry");

    await h.advance( 3_000); // retry after 3 s
    assert.equal(attempts.length, 2);
    await h.advance( 6_000); // retry after 6 s (exponential)
    assert.equal(attempts.length, 3);
    assert.ok(attempts[2] - attempts[1] >= 5_900, "backoff grows");

    succeed = true;
    await h.advance( 9_000);
    assert.equal(h.queue.getStatus().kind, "saved");
    assert.equal(h.queue.hasPending(), false);
    h.queue.dispose();
  });

  it("pauses on a revision conflict and never overwrites silently", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls += 1;
      return { ok: false, status: 409, code: "revision_conflict", currentRevision: 7 };
    });
    h.queue.submit(1);
    await h.advance( 4_000);
    assert.equal(calls, 1);
    const status = h.queue.getStatus();
    assert.equal(status.kind, "conflict");
    assert.equal(status.kind === "conflict" && status.serverRevision, 7);

    // Autosave is paused: further submissions do not hit the network.
    for (let i = 0; i < 10; i++) h.queue.submit(i);
    await h.advance( 20_000);
    assert.equal(calls, 1, "no writes while paused for conflict");
    assert.equal(h.queue.hasPending(), true);

    h.queue.resumeFrom(7, true);
    await h.advance( 4_000);
    assert.equal(calls, 2, "resuming continues from the server revision");
    h.queue.dispose();
  });

  it("stops retrying a payload the server rejected as invalid", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls += 1;
      return { ok: false, status: 422, code: "invalid_save", message: "rejected" };
    });
    h.queue.submit(1);
    await h.advance( 4_000);
    await h.advance( 30_000);
    assert.equal(calls, 1, "validation failures are not retried");
    assert.equal(h.queue.getStatus().kind, "error");
    assert.equal(h.queue.hasPending(), true, "the snapshot is kept so the player can export it");
    h.queue.dispose();
  });

  it("caps the retry interval", async () => {
    const times: number[] = [];
    const h = harness(async () => {
      times.push(h.now());
      return { ok: false, status: 503, code: "storage_error", message: "db down" };
    });
    h.queue.submit(1);
    await h.advance( 120_000);
    for (let i = 1; i < times.length; i++)
      assert.ok(times[i] - times[i - 1] <= 9_100, "retry backoff is capped, never unbounded");
    h.queue.dispose();
  });
});

describe("SaveQueue — teardown", () => {
  it("dispose clears timers so a StrictMode remount cannot double-save", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls += 1;
      return { ok: true, revision: calls, created: false };
    });
    h.queue.submit(1);
    h.queue.dispose();
    await h.advance( 20_000);
    assert.equal(calls, 0);
  });
});
