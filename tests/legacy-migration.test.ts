import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { createGame } from "@/game/engine";
import type { GameState } from "@/game/types";
import {
  GAME_SAVE_SCHEMA,
  containsSecretLikeKey,
  prepareLegacySave,
  stripSecrets,
  validateGameState,
} from "@/server/gameSave";
import { disposeTempDb, makeRequest, playerIdFor, useTempDb } from "./helpers";

/**
 * Legacy (schema 4, localStorage) migration and secret-stripping contracts.
 */
let dbPath: string;

function legacySave(overrides: Partial<GameState> = {}): GameState {
  const g = createGame("Dana Reyes", "MERIDIAN WORKS", 51.5072, -0.1276, "geolocation");
  return {
    ...g,
    economy: { ...g.economy, tick: 274, credits: 512_345, materials: 2_100, food: 640 },
    execs: g.execs.map((e, i) => ({
      ...e,
      ai: {
        // Exactly what the prototype persisted.
        baseUrl: "https://api.openai.com/v1",
        apiKey: i === 0 ? "sk-legacy-key-that-must-not-survive" : "",
        model: "gpt-4o-mini",
        temperature: 0.6,
        enabled: i === 0,
      },
    })),
    ...overrides,
  };
}

before(() => {
  dbPath = useTempDb("legacy");
});

after(() => {
  disposeTempDb(dbPath);
});

describe("secret stripping", () => {
  it("removes apiKey and baseUrl from a save while keeping non-secret preferences", () => {
    const legacy = legacySave();
    const clean = stripSecrets(legacy);
    for (const exec of clean.execs) {
      assert.equal("apiKey" in exec.ai, false);
      assert.equal("baseUrl" in exec.ai, false);
      assert.equal(exec.ai.model, "gpt-4o-mini");
    }
    assert.equal(containsSecretLikeKey(clean), false);
    // The player's economy is untouched by redaction.
    assert.equal(clean.economy.credits, legacy.economy.credits);
    assert.equal(clean.economy.tick, 274);
  });

  it("detects a credential that survives anywhere in the tree", () => {
    const dirty = legacySave();
    assert.equal(containsSecretLikeKey(dirty), true);
    const nested = { ...legacySave(), extra: { list: [{ apiKey: "sk-x" }] } };
    assert.equal(containsSecretLikeKey(nested), true);
  });

  it("rejects a persisted payload carrying a non-empty apiKey", () => {
    const result = validateGameState(legacySave());
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.endsWith("ai.apiKey")));
  });
});

describe("legacy schema-4 migration", () => {
  it("validates a legacy blob after credential neutralization", () => {
    const prepared = prepareLegacySave(legacySave());
    const result = validateGameState(prepared);
    assert.equal(result.ok, true, result.errors.join(","));
    assert.equal(result.state?.economy.tick, 274);

    // ...and the credential is not uploaded by the migration path.
    const uploaded = stripSecrets(result.state!);
    assert.equal(containsSecretLikeKey(uploaded), false);
    assert.ok(!JSON.stringify(uploaded).includes("sk-legacy"));
  });

  it("does not rebalance a legitimate state: debt-like and edge values survive", () => {
    const g = createGame("Edge", "EDGE CO", 0.5, 1.5, "manual");
    const edge: GameState = {
      ...g,
      // Zero treasury and a negative net flow are legitimate gameplay states.
      economy: { ...g.economy, credits: 0, food: 0, materials: 0, morale: 5, reputation: 12, storageUsed: 3_000 },
      market: { materials: 24.2, food: 16.1, power: 6.4 },
    };
    const result = validateGameState(prepareLegacySave(edge));
    assert.equal(result.ok, true, result.errors.join(","));
    assert.equal(result.state?.economy.credits, 0);
    assert.equal(result.state?.economy.morale, 5);
    assert.equal(result.state?.economy.storageUsed, 3_000);
    assert.equal(result.state?.market.materials, 24.2);
  });

  it("accepts a negative power demand produced by the engine (generator in build)", () => {
    const g = createGame("Edge", "EDGE CO", 0.5, 1.5, "manual");
    const result = validateGameState({
      ...g,
      economy: { ...g.economy, powerDemanded: -340 },
    });
    assert.equal(result.ok, true, result.errors.join(","));
  });

  it("rejects out-of-bounds numbers instead of silently clamping gameplay", () => {
    const g = createGame("Edge", "EDGE CO", 0.5, 1.5, "manual");
    for (const [patch, key] of [
      [{ morale: 400 }, "economy.morale"],
      [{ credits: Number.POSITIVE_INFINITY }, "economy.credits"],
      [{ level: 0 }, "economy.level"],
      [{ tick: -1 }, "economy.tick"],
    ] as const) {
      const result = validateGameState({ ...g, economy: { ...g.economy, ...patch } });
      assert.equal(result.ok, false, `${key} should be rejected`);
      assert.ok(result.errors.includes(key), `expected ${key} in ${result.errors.join(",")}`);
    }
  });

  it("rejects an unsupported schema and a broken plan", () => {
    assert.equal(validateGameState({ ...createGame("a", "b", 0, 0, "manual"), schema: 3 }).ok, false);
    const g = createGame("a", "b", 0, 0, "manual");
    const brokenPlan = { ...g.areas[0].sites[0], id: "site_0_0" };
    void brokenPlan;
    const withBuilding: GameState = {
      ...g,
      buildings: [
        {
          id: "bld_1",
          areaId: "area_0",
          siteId: "site_0_0",
          archetypeId: "solar_field",
          plan: { id: "p", name: "n", w: 4, h: 4, storeys: 1, cells: [{ t: 1 }], revision: 1 },
          level: 1,
          operational: true,
          condition: 90,
          securityBot: { id: "s", name: "S", trust: 50, alerts: 0 },
          receptionBot: { id: "r", name: "R", queue: 0, satisfaction: 70 },
          visitorsToday: 0,
        },
      ],
    };
    const result = validateGameState(withBuilding);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("buildings[0].plan"));
  });
});

describe("server/legacy conflict handling", () => {
  it("keeps the server save untouched when legacy data is only offered, not accepted", async () => {
    const saveRoute = await import("@/app/api/save/route");
    const { ensurePlayer } = await import("@/server/db/saves");
    const token = "P".repeat(43);
    ensurePlayer(playerIdFor(token));

    const serverGame = { ...createGame("Server", "SERVER CO", 10, 10, "manual"), economy: { ...createGame("s", "c", 0, 0, "manual").economy, tick: 900 } };
    const put = await saveRoute.PUT(
      makeRequest("/api/save", { method: "PUT", token, body: { baseRevision: 0, state: serverGame } }),
    );
    assert.equal(put.status, 201);

    // An incompatible (unvalidated) legacy blob must be rejected by the same
    // validator the migration UI consults, leaving the server row intact.
    const badLegacy = prepareLegacySave({ ...legacySave(), claim: null });
    assert.equal(validateGameState(badLegacy).ok, false);

    const get = await saveRoute.GET(makeRequest("/api/save", { token }));
    const body = (await get.json()) as { save: { revision: number; state: { company: string } } };
    assert.equal(body.save.revision, 1);
    assert.equal(body.save.state.company, "SERVER CO");
  });

  it("writes migrated legacy data as revision 1 only when the player accepts", async () => {
    const saveRoute = await import("@/app/api/save/route");
    const { ensurePlayer } = await import("@/server/db/saves");
    const token = "Q".repeat(43);
    ensurePlayer(playerIdFor(token));

    const prepared = validateGameState(prepareLegacySave(legacySave()));
    assert.equal(prepared.ok, true);
    const uploaded = stripSecrets(prepared.state!);

    const put = await saveRoute.PUT(
      makeRequest("/api/save", { method: "PUT", token, body: { baseRevision: 0, state: uploaded } }),
    );
    assert.equal(put.status, 201);
    const body = (await put.json()) as { save: { revision: number } };
    assert.equal(body.save.revision, 1);

    const res = await saveRoute.GET(makeRequest("/api/save", { token }));
    const text = await res.text();
    assert.ok(!text.includes("sk-legacy"), "migrated save must not contain the old key");
    assert.ok(!text.includes("apiKey"));
    const stored = JSON.parse(text) as { save: { state: GameState } };
    assert.equal(stored.save.state.economy.tick, 274);
    assert.equal(stored.save.state.schema, GAME_SAVE_SCHEMA);
    assert.equal(stored.save.state.execs[0].ai.model, "gpt-4o-mini");
  });
});

describe("game-save schema version is separate from db/revision", () => {
  it("reports schemaVersion alongside a revision and preserves both across writes", async () => {
    const saveRoute = await import("@/app/api/save/route");
    const { ensurePlayer, readSave } = await import("@/server/db/saves");
    const token = "R".repeat(43);
    const playerId = playerIdFor(token);
    ensurePlayer(playerId);
    const g = createGame("Schema", "SCHEMA CO", 5, 5, "manual");

    await saveRoute.PUT(makeRequest("/api/save", { method: "PUT", token, body: { baseRevision: 0, state: g } }));
    await saveRoute.PUT(
      makeRequest("/api/save", {
        method: "PUT",
        token,
        body: { baseRevision: 1, state: { ...g, ceoName: "Schema II" } },
      }),
    );
    const row = readSave(playerId)!;
    assert.equal(row.schemaVersion, GAME_SAVE_SCHEMA);
    assert.equal(row.state.schema, GAME_SAVE_SCHEMA);
    assert.equal(row.revision, 2);
    assert.ok(row.updatedAt >= row.createdAt);

    // Database schema version lives in the migration ledger, not in the save.
    const { getSqlite } = await import("@/server/db/client");
    const applied = getSqlite()
      .prepare<[], { name: string }>("SELECT name FROM __simplayz_migrations ORDER BY name")
      .all();
    assert.ok(applied.length >= 1);
    assert.match(applied[0].name, /^\d{4}_.*\.sql$/);
    // The data lives in the configured SQLite file, not in source/public.
    assert.ok(fs.existsSync(dbPath));
    assert.ok(!dbPath.includes("/src/") && !dbPath.includes("/public/"));
  });
});
