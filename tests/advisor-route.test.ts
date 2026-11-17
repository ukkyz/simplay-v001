import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createGame } from "@/game/engine";
import { disposeTempDb, makeRequest, playerIdFor, useTempDb } from "./helpers";

/**
 * Advisor proxy tests. These are MOCKED integration tests: `fetch` is replaced,
 * so they prove credential containment, allowlisting, timeouts, rate limiting
 * and fallback wiring. They do NOT evaluate any real model's answer quality.
 */
let dbPath: string;
const realFetch = globalThis.fetch;
const calls: { url: string; init: RequestInit }[] = [];
let nextBehaviour: "ok" | "500" | "timeout" | "empty" | "hang" = "ok";

before(async () => {
  dbPath = useTempDb("advisor");
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    if (nextBehaviour === "500") return new Response("nope", { status: 500 });
    if (nextBehaviour === "timeout") {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }
    if (nextBehaviour === "empty")
      return Response.json({ choices: [{ message: { content: "" } }] });
    if (nextBehaviour === "hang")
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    return Response.json({ choices: [{ message: { content: "CTO-01: build a Photovoltaic Field next." } }] });
  }) as typeof fetch;

  const { ensurePlayer } = await import("@/server/db/saves");
  const { writeSave } = await import("@/server/db/saves");
  for (const token of ["S".repeat(43), "T".repeat(43), "U".repeat(43), "V".repeat(43)]) {
    const id = playerIdFor(token);
    ensurePlayer(id);
    writeSave({ playerId: id, baseRevision: 0, state: createGame("Proxy", "PROXY CO", 1, 1, "manual") });
  }
});

after(() => {
  globalThis.fetch = realFetch;
  disposeTempDb(dbPath);
});

afterEach(() => {
  nextBehaviour = "ok";
  calls.length = 0;
  delete process.env.SIMPLAYZ_AI_API_KEY;
  delete process.env.SIMPLAYZ_AI_BASE_URL;
  delete process.env.SIMPLAYZ_AI_MODEL;
  delete process.env.SIMPLAYZ_AI_TIMEOUT_MS;
  delete process.env.SIMPLAYZ_AI_RATE_LIMIT_PER_MINUTE;
  delete process.env.SIMPLAYZ_AI_ALLOWED_MODELS;
});

const ADVISOR = () => import("@/app/api/advisor/route");

function body(overrides: Record<string, unknown> = {}) {
  return { role: "cto", prompt: "What should I build next?", history: [], ...overrides };
}

/** Seeded session (see `before`): has a persisted save so the server can build a digest. */
const SEEDED = "S".repeat(43);

describe("advisor — no provider configured", () => {
  it("answers with server-composed local advice and never calls an upstream", async () => {
    const route = await ADVISOR();
    const res = await route.POST(makeRequest("/api/advisor", { method: "POST", token: SEEDED, body: body() }));
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      source: string;
      fallback: boolean;
      configured: boolean;
      text: string;
      error: { code: string };
    };
    assert.equal(json.source, "local-model");
    assert.equal(json.configured, false);
    assert.equal(json.error.code, "not_configured");
    assert.ok(json.text.length > 20, "local advice text is returned");
    assert.equal(calls.length, 0);
  });
});

describe("advisor — configured provider", () => {
  function configure(extra: Record<string, string> = {}) {
    process.env.SIMPLAYZ_AI_API_KEY = "sk-server-only-test-key";
    process.env.SIMPLAYZ_AI_BASE_URL = "https://api.openai.com/v1";
    process.env.SIMPLAYZ_AI_MODEL = "gpt-4o-mini";
    Object.assign(process.env, extra);
  }

  it("calls the allowlisted endpoint with the server key and never echoes the key", async () => {
    configure();
    const route = await ADVISOR();
    const res = await route.POST(makeRequest("/api/advisor", { method: "POST", token: SEEDED, body: body() }));
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer sk-server-only-test-key");
    assert.equal(JSON.parse(text).source, "live-api");
    assert.ok(!text.includes("sk-server-only-test-key"), "response must not echo the key");
    assert.ok(!text.includes("api.openai.com"), "response must not expose the base URL");

    // The prompt is built server-side from the persisted save, not the client.
    const sentBody = JSON.parse(String(calls[0].init.body)) as {
      messages: { role: string; content: string }[];
    };
    assert.equal(sentBody.messages[0].role, "system");
    assert.match(sentBody.messages[0].content, /CITY DIGEST/);
    assert.match(sentBody.messages[0].content, /PROXY CO/);
  });

  it("times out a hanging upstream and falls back to local advice", async () => {
    configure({ SIMPLAYZ_AI_TIMEOUT_MS: "50" });
    nextBehaviour = "hang";
    // AbortSignal.timeout() uses an unref'd timer; keep the event loop alive so
    // the mocked upstream can actually observe the abort.
    const keepAlive = setInterval(() => {}, 10);
    const route = await ADVISOR();
    let res: Response;
    try {
      res = await route.POST(makeRequest("/api/advisor", { method: "POST", token: SEEDED, body: body() }));
    } finally {
      clearInterval(keepAlive);
    }
    const json = (await res.json()) as { source: string; fallback: boolean; error: { code: string }; text: string };
    assert.equal(res.status, 200, "upstream failure is not a 5xx for the player");
    assert.equal(json.source, "local-model");
    assert.equal(json.fallback, true);
    assert.ok(["upstream_timeout", "upstream_unreachable"].includes(json.error.code));
    assert.ok(json.text.length > 20);
  });

  it("falls back on upstream 500 and on an empty completion", async () => {
    configure();
    const route = await ADVISOR();
    nextBehaviour = "500";
    const five = (await (
      await route.POST(makeRequest("/api/advisor", { method: "POST", token: SEEDED, body: body() }))
    ).json()) as { source: string; error: { code: string } };
    assert.equal(five.source, "local-model");
    assert.equal(five.error.code, "upstream_error");

    nextBehaviour = "empty";
    const empty = (await (
      await route.POST(makeRequest("/api/advisor", { method: "POST", token: SEEDED, body: body() }))
    ).json()) as { source: string; error: { code: string } };
    assert.equal(empty.source, "local-model");
    assert.equal(empty.error.code, "empty_completion");
  });

  it("refuses to use a provider endpoint outside the allowlist", async () => {
    configure({ SIMPLAYZ_AI_BASE_URL: "https://evil.example/v1" });
    const route = await ADVISOR();
    const res = await route.POST(makeRequest("/api/advisor", { method: "POST", token: SEEDED, body: body() }));
    const json = (await res.json()) as { configured: boolean; error: { code: string } };
    assert.equal(json.configured, false, "an unlisted base URL means 'no live model'");
    assert.equal(calls.length, 0);
  });

  it("refuses to use a model outside the allowlist", async () => {
    configure({ SIMPLAYZ_AI_MODEL: "some-other-model" });
    const route = await ADVISOR();
    const json = (await (
      await route.POST(makeRequest("/api/advisor", { method: "POST", token: SEEDED, body: body() }))
    ).json()) as { configured: boolean };
    assert.equal(json.configured, false);
    assert.equal(calls.length, 0);
  });
});

describe("advisor — input limits and abuse protection", () => {
  it("rejects an unknown role and an over-long prompt", async () => {
    const route = await ADVISOR();
    const badRole = await route.POST(
      makeRequest("/api/advisor", { method: "POST", token: SEEDED, body: body({ role: "ceo" }) }),
    );
    assert.equal(badRole.status, 400);

    const long = await route.POST(
      makeRequest("/api/advisor", { method: "POST", token: SEEDED, body: body({ prompt: "x".repeat(700) }) }),
    );
    assert.equal(long.status, 422);
  });

  it("requires a session and a same-origin state change", async () => {
    const route = await ADVISOR();
    assert.equal(
      (await route.POST(makeRequest("/api/advisor", { method: "POST", token: null, body: body() }))).status,
      401,
    );
    assert.equal(
      (
        await route.POST(
          makeRequest("/api/advisor", {
            method: "POST",
            origin: "http://evil.example",
            token: SEEDED,
            body: body(),
          }),
        )
      ).status,
      403,
    );
  });

  it("rate limits per session", async () => {
    process.env.SIMPLAYZ_AI_API_KEY = "sk-server-only-test-key";
    process.env.SIMPLAYZ_AI_RATE_LIMIT_PER_MINUTE = "2";
    const route = await ADVISOR();
    const token = "T".repeat(43);
    const first = await route.POST(makeRequest("/api/advisor", { method: "POST", token, body: body() }));
    const second = await route.POST(makeRequest("/api/advisor", { method: "POST", token, body: body() }));
    const third = await route.POST(makeRequest("/api/advisor", { method: "POST", token, body: body() }));
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    const json = (await third.json()) as { error: { code: string } };
    assert.equal(json.error.code, "rate_limited");
  });

  it("bounds client-supplied history", async () => {
    process.env.SIMPLAYZ_AI_API_KEY = "sk-server-only-test-key";
    const route = await ADVISOR();
    const history = Array.from({ length: 40 }, (_, i) => ({ role: "user", content: `m${i}` }));
    await route.POST(
      makeRequest("/api/advisor", {
        method: "POST",
        token: "U".repeat(43),
        body: body({ history }),
      }),
    );
    const sent = JSON.parse(String(calls[0].init.body)) as { messages: unknown[] };
    // system + ≤8 history + current question
    assert.ok(sent.messages.length <= 10, `history must be trimmed, got ${sent.messages.length}`);
  });
});
