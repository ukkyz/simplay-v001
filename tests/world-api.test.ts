import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createGame } from "@/game/engine";
import type { GameState } from "@/game/types";
import { MAX_ROSTER_CELLS, aiRoster, coarsen, refForPlayer, type WorldResponse } from "@/game/world";
import { disposeTempDb, makeRequest, playerIdFor, useTempDb } from "./helpers";

/**
 * Shared-world registry tests: real route handlers against a real SQLite file
 * (real migrations, real transactions). Not a browser test — the map layer,
 * polling and Leaflet rendering are NOT covered here.
 *
 * The properties asserted are the ones that make the feature honest:
 *   1. two different players can see each other,
 *   2. a client cannot publish somebody else's data (or its own lie),
 *   3. the registry never stores or returns a precise position,
 *   4. opting out leaves nothing behind,
 *   5. the AI roster is identical for every client with the same seed.
 */
let dbPath: string;
let saveRoute: typeof import("@/app/api/save/route");
let worldRoute: typeof import("@/app/api/world/route");
let meRoute: typeof import("@/app/api/world/me/route");
let publishRoute: typeof import("@/app/api/world/publish/route");

const TOKEN_A = "A".repeat(43);
const TOKEN_B = "B".repeat(43);
const TOKEN_C = "C".repeat(43);

function freshGame(lat = 51.5072, lng = -0.1276, company = "AXIOM WORKS"): GameState {
  const g = createGame("Ada Voss", company, lat, lng, "manual");
  return { ...g, speed: 0 };
}

async function ensurePlayer(token: string): Promise<void> {
  const { ensurePlayer: ensure } = await import("@/server/db/saves");
  ensure(playerIdFor(token));
}

async function putSave(token: string, state: GameState, baseRevision = 0) {
  return saveRoute.PUT(makeRequest("/api/save", { method: "PUT", token, body: { baseRevision, state } }));
}

function worldGet(token: string, bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number }, limit = 200) {
  const qs = new URLSearchParams({
    latMin: String(bbox.latMin),
    latMax: String(bbox.latMax),
    lngMin: String(bbox.lngMin),
    lngMax: String(bbox.lngMax),
    limit: String(limit),
  }).toString();
  return worldRoute.GET(makeRequest(`/api/world?${qs}`, { token }));
}

function publish(token: string, body: unknown) {
  return publishRoute.POST(makeRequest("/api/world/publish", { method: "POST", token, body }));
}

/** Everything published around London, wide enough to include the AI roster cells. */
const LONDON = { latMin: 50.5, latMax: 52.5, lngMin: -1.5, lngMax: 1.5 };

before(async () => {
  dbPath = useTempDb("world-api");
  saveRoute = await import("@/app/api/save/route");
  worldRoute = await import("@/app/api/world/route");
  meRoute = await import("@/app/api/world/me/route");
  publishRoute = await import("@/app/api/world/publish/route");
  for (const token of [TOKEN_A, TOKEN_B, TOKEN_C]) await ensurePlayer(token);
});

after(() => {
  disposeTempDb(dbPath);
});

describe("world API — publication and mutual visibility", () => {
  it("refuses the world and the registry without a session", async () => {
    const world = await worldRoute.GET(
      makeRequest(`/api/world?latMin=50&latMax=52&lngMin=-1&lngMax=1`, { token: null }),
    );
    assert.equal(world.status, 401);
    const me = await meRoute.GET(makeRequest("/api/world/me", { token: null }));
    assert.equal(me.status, 401);
    const pub = await publishRoute.POST(
      makeRequest("/api/world/publish", { method: "POST", token: null, body: { publish: true } }),
    );
    assert.equal(pub.status, 401);
  });

  it("reports nothing published before the player opts in", async () => {
    const res = await meRoute.GET(makeRequest("/api/world/me", { token: TOKEN_A }));
    assert.equal(res.status, 200);
    const json = (await res.json()) as { published: boolean };
    assert.equal(json.published, false);

    // A player with a save but no publication must be absent from the world.
    await putSave(TOKEN_A, freshGame());
    const world = await worldGet(TOKEN_C, LONDON);
    const body = (await world.json()) as WorldResponse;
    assert.equal(body.counts.player, 0, "unpublished players must be invisible");
  });

  it("rejects publishing before any save exists", async () => {
    const res = await publish(TOKEN_B, { publish: true });
    assert.equal(res.status, 409);
    const json = (await res.json()) as { error: { code: string } };
    assert.equal(json.error.code, "no_save");
  });

  it("lets two different players see each other", async () => {
    const a = await publish(TOKEN_A, { publish: true });
    assert.equal(a.status, 200);

    const bSaved = await putSave(TOKEN_B, freshGame(51.49, -0.09, "BOREAL FREIGHT"));
    assert.ok(bSaved.status === 201 || bSaved.status === 200);
    const b = await publish(TOKEN_B, { publish: true });
    assert.equal(b.status, 200);

    const seenByB = (await (await worldGet(TOKEN_B, LONDON)).json()) as WorldResponse;
    const seenByA = (await (await worldGet(TOKEN_A, LONDON)).json()) as WorldResponse;

    const playerA = seenByB.entries.find((e) => e.ref === refForPlayer(playerIdFor(TOKEN_A)));
    const playerB = seenByA.entries.find((e) => e.ref === refForPlayer(playerIdFor(TOKEN_B)));
    assert.ok(playerA, "B must see A's published area");
    assert.ok(playerB, "A must see B's published area");
    assert.equal(playerA!.kind, "player");
    assert.equal(playerA!.display, "AXIOM WORKS");
    assert.equal(playerB!.display, "BOREAL FREIGHT");

    // Self is never drawn as a neighbour.
    assert.equal(
      seenByA.entries.some((e) => e.ref === refForPlayer(playerIdFor(TOKEN_A))),
      false,
      "a player must not see themselves as a neighbour",
    );
    assert.deepEqual(seenByA.counts.player, 1);
  });

  it("ignores a client-supplied position, name and player id", async () => {
    // A hostile body tries to move A's area and rename it. Only `publish` may
    // be honoured: everything else is re-derived from A's own save.
    const res = await publish(TOKEN_A, {
      publish: true,
      lat: 35.6762,
      lng: 139.6503,
      company: "NOT AXIOM",
      ceoName: "Mallory",
      playerId: playerIdFor(TOKEN_B),
    });
    assert.equal(res.status, 200);

    const body = (await (await worldGet(TOKEN_C, LONDON)).json()) as WorldResponse;
    const mine = body.entries.find((e) => e.ref === refForPlayer(playerIdFor(TOKEN_A)))!;
    assert.equal(mine.display, "AXIOM WORKS");
    assert.equal(mine.lat, coarsen(51.5072), "position must come from the save, not the body");
    assert.equal(mine.lng, coarsen(-0.1276));
    // B's row was not overwritten by A's request.
    assert.ok(body.entries.some((e) => e.ref === refForPlayer(playerIdFor(TOKEN_B))));
  });

  it("re-follows the save when the claim moves", async () => {
    const moved = freshGame(48.8566, 2.3522, "AXIOM WORKS");
    const put = await putSave(TOKEN_A, moved, 1);
    assert.equal(put.status, 200);

    const paris = { latMin: 48.0, latMax: 49.5, lngMin: 1.5, lngMax: 3.2 };
    const body = (await (await worldGet(TOKEN_C, paris)).json()) as WorldResponse;
    const mine = body.entries.find((e) => e.ref === refForPlayer(playerIdFor(TOKEN_A)))!;
    assert.ok(mine, "the publication must follow a save write");
    assert.equal(mine.lat, coarsen(48.8566));
    assert.equal(mine.lng, coarsen(2.3522));

    const london = (await (await worldGet(TOKEN_C, LONDON)).json()) as WorldResponse;
    assert.equal(
      london.entries.some((e) => e.ref === refForPlayer(playerIdFor(TOKEN_A))),
      false,
      "the old position must not linger after the claim moves",
    );
  });

  it("stores only coarsened integers and never returns a player id", async () => {
    const { getSqlite } = await import("@/server/db/client");
    const row = getSqlite()
      .prepare<[], { lat_e2: number; lng_e2: number; player_id: string }>(
        "SELECT player_id, lat_e2, lng_e2 FROM world_players",
      )
      .all();
    assert.ok(row.length >= 1);
    for (const r of row) {
      assert.equal(Number.isInteger(r.lat_e2), true, "lat must be stored as an integer");
      assert.equal(Number.isInteger(r.lng_e2), true, "lng must be stored as an integer");
      assert.ok(Math.abs(r.lat_e2) <= 9000);
      assert.ok(Math.abs(r.lng_e2) <= 18000);
    }

    const raw = await (await worldGet(TOKEN_C, LONDON)).text();
    for (const token of [TOKEN_A, TOKEN_B]) {
      assert.equal(
        raw.includes(playerIdFor(token)),
        false,
        "the response must not contain a player id (it is the session-token hash)",
      );
    }
    assert.equal(/playerId|player_id/.test(raw), false);
    // No coordinate with more than 2 decimals anywhere in the payload.
    const floats = raw.match(/-?\d+\.\d{3,}/g) ?? [];
    assert.deepEqual(floats, [], `response leaked extra precision: ${floats.slice(0, 3).join(", ")}`);
  });

  it("removes everything on opt-out", async () => {
    const res = await publish(TOKEN_B, { publish: false });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { published: boolean; removed: boolean };
    assert.equal(json.published, false);
    assert.equal(json.removed, true);

    const { publishedCount } = await import("@/server/db/world");
    const before = publishedCount();
    const again = await publish(TOKEN_B, { publish: false });
    assert.equal(again.status, 200);
    assert.equal(publishedCount(), before, "a second opt-out must not create a row");

    const me = (await (await meRoute.GET(makeRequest("/api/world/me", { token: TOKEN_B }))).json()) as {
      published: boolean;
    };
    assert.equal(me.published, false);

    const body = (await (await worldGet(TOKEN_C, LONDON)).json()) as WorldResponse;
    assert.equal(
      body.entries.some((e) => e.ref === refForPlayer(playerIdFor(TOKEN_B))),
      false,
    );
  });

  it("withdraws the publication when the save is reset", async () => {
    const del = await saveRoute.DELETE(makeRequest("/api/save", { method: "DELETE", token: TOKEN_A }));
    assert.equal(del.status, 200);
    const me = (await (await meRoute.GET(makeRequest("/api/world/me", { token: TOKEN_A }))).json()) as {
      published: boolean;
    };
    assert.equal(me.published, false, "a registry row must not outlive its save");
  });
});

describe("world API — validation, limits and abuse", () => {
  it("rejects a reversed or out-of-range bounding box", async () => {
    const reversed = await worldGet(TOKEN_C, { latMin: 52, latMax: 50, lngMin: -1, lngMax: 1 });
    assert.equal(reversed.status, 400);
    const outOfRange = await worldGet(TOKEN_C, { latMin: -95, latMax: 50, lngMin: -1, lngMax: 1 });
    assert.equal(outOfRange.status, 400);
    const missing = await worldRoute.GET(makeRequest("/api/world?latMin=50", { token: TOKEN_C }));
    assert.equal(missing.status, 400);
  });

  it("caps the page and reports truncation instead of silently cutting", async () => {
    const body = (await (await worldGet(TOKEN_C, LONDON, 5)).json()) as WorldResponse;
    assert.ok(body.entries.length <= 5, "limit must be honoured");
    assert.equal(body.truncated, true);

    // An oversized limit is clamped, not rejected.
    const big = (await (await worldGet(TOKEN_C, LONDON, 10_000)).json()) as WorldResponse;
    assert.ok(big.entries.length <= 200);
  });

  it("blocks cross-origin publishing and non-JSON bodies", async () => {
    const crossOrigin = await publishRoute.POST(
      makeRequest("/api/world/publish", {
        method: "POST",
        token: TOKEN_C,
        origin: "https://evil.example",
        body: { publish: true },
      }),
    );
    assert.equal(crossOrigin.status, 403);

    const wrongType = await publishRoute.POST(
      makeRequest("/api/world/publish", {
        method: "POST",
        token: TOKEN_C,
        contentType: "text/plain",
        body: { publish: true },
      }),
    );
    assert.equal(wrongType.status, 415);

    const badBody = await publish(TOKEN_C, { publish: "yes" });
    assert.equal(badBody.status, 400);
  });

  it("keeps the whole response well under the 64 KB budget", async () => {
    const res = await worldGet(TOKEN_C, LONDON);
    const text = await res.text();
    const bytes = Buffer.byteLength(text);
    assert.ok(bytes < 65_536, `response was ${bytes}B`);
    // And it is a sane amount of data for the renderer to digest.
    const parsed = JSON.parse(text) as WorldResponse;
    assert.equal(parsed.version, 1);
    assert.ok(parsed.entries.length <= 200);
  });
});

describe("AI roster — one world for every client", () => {
  it("is byte-identical for the same seed and different for another seed", () => {
    const now = 1_700_000_000_000;
    const a = aiRoster(LONDON, "simplayz-world-1", now);
    const b = aiRoster(LONDON, "simplayz-world-1", now);
    const other = aiRoster(LONDON, "another-world", now);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, other);
    assert.ok(a.length > 0, "the roster must not be empty for a normal viewport");
  });

  it("does not shuffle when the viewport changes", () => {
    const now = 1_700_000_000_000;
    const wide = aiRoster({ latMin: 49, latMax: 53, lngMin: -3, lngMax: 3 }, "simplayz-world-1", now);
    const narrow = aiRoster({ latMin: 51, latMax: 52, lngMin: -1, lngMax: 1 }, "simplayz-world-1", now);
    const wideRefs = new Map(wide.map((e) => [e.ref, e]));
    for (const entry of narrow) {
      const same = wideRefs.get(entry.ref);
      assert.ok(same, "a neighbour inside both viewports must have the same ref");
      assert.equal(same!.lat, entry.lat);
      assert.equal(same!.lng, entry.lng);
      assert.equal(same!.display, entry.display);
    }
  });

  it("is deterministic without Math.random or Date.now", () => {
    // Same seed + same presence bucket at two very different call times.
    const t1 = 1_700_000_000_000;
    const t2 = t1 + 60_000; // six minutes would change presence; one minute must not
    assert.deepEqual(aiRoster(LONDON, "s", t1), aiRoster(LONDON, "s", t2));
  });

  it("samples a world-spanning bbox instead of looping over every cell", () => {
    const t0 = Date.now();
    const whole = aiRoster({ latMin: -90, latMax: 90, lngMin: -180, lngMax: 180 }, "s", 0);
    const elapsed = Date.now() - t0;
    // Sampled, not empty: zooming out must still show neighbours.
    assert.ok(whole.length > 0, "a wide viewport must not become an empty world");
    assert.ok(whole.length <= MAX_ROSTER_CELLS * 2, `sampled roster was ${whole.length} entries`);
    assert.ok(elapsed < 2000, `roster took ${elapsed}ms`);

    // Sampling keeps entries at their real positions: every sampled entry is
    // also present, unmodified, when the same area is viewed up close.
    const small = aiRoster({ latMin: -10, latMax: 10, lngMin: -10, lngMax: 10 }, "s", 0);
    const byRef = new Map(whole.map((e) => [e.ref, e]));
    const overlapping = small.filter((e) => byRef.has(e.ref));
    assert.ok(overlapping.length > 0, "the sampled and detailed rosters must overlap");
    for (const e of overlapping) assert.deepEqual(byRef.get(e.ref), e);
  });

  it("gives players and AI disjoint, stable refs", () => {
    const playerRef = refForPlayer(playerIdFor(TOKEN_A));
    assert.match(playerRef, /^[0-9a-f]{16}$/);
    assert.equal(playerRef, refForPlayer(playerIdFor(TOKEN_A)));
    assert.notEqual(playerRef, refForPlayer(playerIdFor(TOKEN_B)));
    const aiRefs = new Set(aiRoster(LONDON, "simplayz-world-1", 0).map((e) => e.ref));
    assert.equal(aiRefs.has(playerRef), false);
  });
});
