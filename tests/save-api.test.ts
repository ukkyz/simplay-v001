import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createGame } from "@/game/engine";
import type { GameState } from "@/game/types";
import { validateGameState } from "@/server/gameSave";
import {
  OTHER_TOKEN,
  disposeTempDb,
  makeRequest,
  playerIdFor,
  useTempDb,
} from "./helpers";

/**
 * Integration tests for the real Next.js route handlers against a real SQLite
 * file. These are NOT mocks of the database layer: better-sqlite3 and the
 * migrations run for real. They are not browser tests.
 */
let dbPath: string;
let sessionRoute: typeof import("@/app/api/session/route");
let saveRoute: typeof import("@/app/api/save/route");

function freshGame(overrides: Partial<GameState> = {}): GameState {
  const g = createGame("Ada Voss", "AXIOM WORKS", 51.5072, -0.1276, "manual");
  return { ...g, ...overrides };
}

async function createSession(token: string): Promise<void> {
  const res = await sessionRoute.POST(makeRequest("/api/session", { method: "POST", token: "" , body: {} }));
  // The helper cannot mint an arbitrary cookie value; write the row directly
  // through the same code path the route uses.
  void res;
  const { ensurePlayer } = await import("@/server/db/saves");
  ensurePlayer(playerIdFor(token));
}

before(async () => {
  dbPath = useTempDb("save-api");
  sessionRoute = await import("@/app/api/session/route");
  saveRoute = await import("@/app/api/save/route");
  await createSession("A".repeat(43));
  await createSession("B".repeat(43));
});

after(() => {
  disposeTempDb(dbPath);
});

describe("save API — happy path", () => {
  it("creates a session cookie, writes rev 1, reads it back, then increments", async () => {
    const token = "C".repeat(43);
    const sessionRes = await sessionRoute.POST(
      makeRequest("/api/session", { method: "POST", token: null, body: {} }),
    );
    assert.equal(sessionRes.status, 201);
    const setCookie = sessionRes.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /simplayz_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=lax/i);
    const minted = /simplayz_session=([A-Za-z0-9_-]{43})/.exec(setCookie)?.[1];
    assert.ok(minted, "session cookie must be a 43-char base64url token");
    assert.notEqual(minted, token);

    const game = freshGame();
    const put1 = await saveRoute.PUT(
      makeRequest("/api/save", { method: "PUT", token: minted, body: { baseRevision: 0, state: game } }),
    );
    assert.equal(put1.status, 201);
    const created = (await put1.json()) as { save: { revision: number } };
    assert.equal(created.save.revision, 1);

    const get = await saveRoute.GET(makeRequest("/api/save", { token: minted }));
    assert.equal(get.status, 200);
    const loaded = (await get.json()) as { save: { revision: number; state: GameState } };
    assert.equal(loaded.save.revision, 1);
    assert.equal(loaded.save.state.company, "AXIOM WORKS");

    const put2 = await saveRoute.PUT(
      makeRequest("/api/save", {
        method: "PUT",
        token: minted,
        body: { baseRevision: 1, state: { ...game, ceoName: "Ada Voss II" } },
      }),
    );
    assert.equal(put2.status, 200);
    const updated = (await put2.json()) as { save: { revision: number } };
    assert.equal(updated.save.revision, 2);
  });
});

describe("save API — concurrent stale write", () => {
  it("accepts exactly one of two writes that both claim revision 2", async () => {
    const token = "D".repeat(43);
    await createSession(token);
    const game = freshGame();

    const first = await saveRoute.PUT(
      makeRequest("/api/save", { method: "PUT", token, body: { baseRevision: 0, state: game } }),
    );
    assert.equal(first.status, 201);

    const [a, b] = await Promise.all([
      saveRoute.PUT(
        makeRequest("/api/save", {
          method: "PUT",
          token,
          body: { baseRevision: 1, state: { ...game, economy: { ...game.economy, tick: 10 } } },
        }),
      ),
      saveRoute.PUT(
        makeRequest("/api/save", {
          method: "PUT",
          token,
          body: { baseRevision: 1, state: { ...game, economy: { ...game.economy, tick: 99 } } },
        }),
      ),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], "one write wins, the other conflicts");

    const conflict = a.status === 409 ? a : b;
    const body = (await conflict.json()) as { error: { code: string }; currentRevision: number };
    assert.equal(body.error.code, "revision_conflict");
    assert.equal(body.currentRevision, 2);

    // The winner's state is what is stored; the stale write did not overwrite it.
    const get = await saveRoute.GET(makeRequest("/api/save", { token }));
    const stored = (await get.json()) as { save: { revision: number; state: GameState } };
    assert.equal(stored.save.revision, 2);
    assert.ok([10, 99].includes(stored.save.state.economy.tick));
  });
});

describe("save API — failure and abuse paths", () => {
  it("rejects a malformed save with 422 and leaves the last valid save untouched", async () => {
    const token = "E".repeat(43);
    await createSession(token);
    const game = freshGame();
    await saveRoute.PUT(makeRequest("/api/save", { method: "PUT", token, body: { baseRevision: 0, state: game } }));

    const bad = { ...game, economy: { ...game.economy, credits: "lots" } };
    const res = await saveRoute.PUT(
      makeRequest("/api/save", { method: "PUT", token, body: { baseRevision: 1, state: bad } }),
    );
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error: { code: string }; problems: string[] };
    assert.equal(body.error.code, "invalid_save");
    assert.ok(body.problems.some((p) => p.startsWith("economy.credits")));

    const get = await saveRoute.GET(makeRequest("/api/save", { token }));
    const stored = (await get.json()) as { save: { revision: number; state: GameState } };
    assert.equal(stored.save.revision, 1);
    assert.equal(stored.save.state.company, game.company);
  });

  it("rejects a save with a dangling entity reference", async () => {
    const token = "F".repeat(43);
    await createSession(token);
    const game = freshGame();
    const broken: GameState = {
      ...game,
      areas: game.areas.map((a, i) =>
        i === 0
          ? { ...a, sites: a.sites.map((s, j) => (j === 0 ? { ...s, buildingId: "bld_missing" } : s)) }
          : a,
      ),
    };
    const res = await saveRoute.PUT(
      makeRequest("/api/save", { method: "PUT", token, body: { baseRevision: 0, state: broken } }),
    );
    assert.equal(res.status, 422);
  });

  it("refuses unauthenticated reads and writes", async () => {
    const get = await saveRoute.GET(makeRequest("/api/save", { token: null }));
    assert.equal(get.status, 401);
    const put = await saveRoute.PUT(
      makeRequest("/api/save", { method: "PUT", token: null, body: { baseRevision: 0, state: freshGame() } }),
    );
    assert.equal(put.status, 401);
  });

  it("blocks cross-origin and origin-less state changes", async () => {
    const token = "G".repeat(43);
    await createSession(token);
    const cross = await saveRoute.PUT(
      makeRequest("/api/save", {
        method: "PUT",
        token,
        origin: "http://evil.example",
        body: { baseRevision: 0, state: freshGame() },
      }),
    );
    assert.equal(cross.status, 403);

    const noOrigin = await saveRoute.PUT(
      makeRequest("/api/save", {
        method: "PUT",
        token,
        origin: null,
        body: { baseRevision: 0, state: freshGame() },
      }),
    );
    assert.equal(noOrigin.status, 403);
  });

  it("rejects non-JSON content types and oversized bodies", async () => {
    const token = "H".repeat(43);
    await createSession(token);
    const wrongType = await saveRoute.PUT(
      makeRequest("/api/save", {
        method: "PUT",
        token,
        contentType: "text/plain",
        body: JSON.stringify({ baseRevision: 0, state: freshGame() }),
      }),
    );
    assert.equal(wrongType.status, 415);

    const huge = "x".repeat(1_600_000);
    const tooBig = await saveRoute.PUT(
      makeRequest("/api/save", {
        method: "PUT",
        token,
        body: `{"baseRevision":0,"state":${JSON.stringify(huge)}}`,
      }),
    );
    assert.equal(tooBig.status, 413);
  });

  it("surfaces a database write failure as 503 without leaking internals", async () => {
    const token = "I".repeat(43);
    await createSession(token);
    const { getSqlite } = await import("@/server/db/client");
    const sqlite = getSqlite();
    sqlite.exec("DROP TABLE game_saves");
    try {
      const res = await saveRoute.PUT(
        makeRequest("/api/save", { method: "PUT", token, body: { baseRevision: 0, state: freshGame() } }),
      );
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.ok(!/SQLITE|game_saves|no such table/i.test(text), "must not leak SQL/table names");
      const body = JSON.parse(text) as { error: { code: string; message: string } };
      assert.equal(body.error.code, "storage_error");
      assert.ok(!body.error.message.includes("/"), "must not leak filesystem paths");
    } finally {
      // Restore the schema for the remaining tests.
      sqlite.exec(`CREATE TABLE game_saves (
        player_id text PRIMARY KEY NOT NULL,
        schema_version integer NOT NULL,
        revision integer NOT NULL,
        state text NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      )`);
    }
  });
});

describe("save API — session isolation and reset", () => {
  it("never returns another session's save", async () => {
    const a = "J".repeat(43);
    const b = "K".repeat(43);
    await createSession(a);
    await createSession(b);

    await saveRoute.PUT(
      makeRequest("/api/save", {
        method: "PUT",
        token: a,
        body: { baseRevision: 0, state: freshGame({ company: "SESSION A" }) },
      }),
    );
    await saveRoute.PUT(
      makeRequest("/api/save", {
        method: "PUT",
        token: b,
        body: { baseRevision: 0, state: freshGame({ company: "SESSION B" }) },
      }),
    );

    const readB = await saveRoute.GET(makeRequest("/api/save", { token: b }));
    const bodyB = (await readB.json()) as { save: { state: GameState } };
    assert.equal(bodyB.save.state.company, "SESSION B");

    // A cannot address B: there is no id parameter, and B's revision is not known
    // to A's queue, so a write from A must not mutate B's row.
    await saveRoute.PUT(
      makeRequest("/api/save", {
        method: "PUT",
        token: a,
        body: { baseRevision: 1, state: freshGame({ company: "A OVERWRITES" }) },
      }),
    );
    const reReadB = await saveRoute.GET(makeRequest("/api/save", { token: b }));
    const after = (await reReadB.json()) as { save: { state: GameState } };
    assert.equal(after.save.state.company, "SESSION B");
  });

  it("reset deletes only the caller's save", async () => {
    const a = "L".repeat(43);
    const b = "M".repeat(43);
    await createSession(a);
    await createSession(b);
    await saveRoute.PUT(
      makeRequest("/api/save", { method: "PUT", token: a, body: { baseRevision: 0, state: freshGame() } }),
    );
    await saveRoute.PUT(
      makeRequest("/api/save", { method: "PUT", token: b, body: { baseRevision: 0, state: freshGame() } }),
    );

    const del = await saveRoute.DELETE(makeRequest("/api/save", { method: "DELETE", token: a }));
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { deleted: true });

    assert.equal((await saveRoute.GET(makeRequest("/api/save", { token: a }))).status, 200);
    const aSave = (await (await saveRoute.GET(makeRequest("/api/save", { token: a }))).json()) as {
      save: unknown;
    };
    assert.equal(aSave.save, null);

    const bSave = (await (await saveRoute.GET(makeRequest("/api/save", { token: b }))).json()) as {
      save: { revision: number } | null;
    };
    assert.equal(bSave.save?.revision, 1);
    void OTHER_TOKEN;
  });
});

describe("save API — secret boundary", () => {
  it("rejects a payload that still carries a credential and never echoes it", async () => {
    const token = "N".repeat(43);
    await createSession(token);
    const game = freshGame();
    const withKey: GameState = {
      ...game,
      execs: game.execs.map((e, i) => (i === 0 ? { ...e, ai: { ...e.ai, apiKey: "sk-live-should-not-exist" } } : e)),
    };
    const res = await saveRoute.PUT(
      makeRequest("/api/save", { method: "PUT", token, body: { baseRevision: 0, state: withKey } }),
    );
    assert.equal(res.status, 422);
    const text = await res.text();
    assert.ok(!text.includes("sk-live-should-not-exist"), "error body must not echo the secret");
  });

  it("strips empty credential fields from stored and returned saves", async () => {
    const token = "O".repeat(43);
    await createSession(token);
    const game = freshGame();
    await saveRoute.PUT(
      makeRequest("/api/save", { method: "PUT", token, body: { baseRevision: 0, state: game } }),
    );
    const get = await saveRoute.GET(makeRequest("/api/save", { token }));
    const text = await get.text();
    assert.ok(!text.includes("apiKey"), "responses must not contain apiKey fields");
    assert.ok(!text.includes("baseUrl"), "responses must not contain baseUrl fields");
    const parsed = validateGameState((JSON.parse(text) as { save: { state: unknown } }).save.state);
    assert.equal(parsed.ok, true);
  });
});
