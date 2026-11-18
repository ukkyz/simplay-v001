/**
 * HTTP-level smoke test against a running Simplayz server.
 *
 *   npm run dev            # in one shell
 *   npx tsx scripts/smoke-http.ts [baseUrl]
 *
 * This exercises the real HTTP surface the browser uses (session cookie, save
 * PUT/GET/DELETE, CSRF rejection, conflict detection, session isolation, and
 * persistence across a server restart). It is NOT a browser test: it does not
 * render React, load Leaflet tiles or open a WebGL context, so gameplay/visual
 * behaviour still needs a manual browser pass.
 */
const BASE = process.argv[2] ?? "http://localhost:3000";

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

const results: Result[] = [];
function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

class Jar {
  cookie = "";
  async call(pathname: string, init: RequestInit & { json?: unknown } = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      headers.set("origin", BASE);
    }
    if (init.method && init.method !== "GET") headers.set("origin", headers.get("origin") ?? BASE);
    const res = await fetch(`${BASE}${pathname}`, {
      ...init,
      headers,
      body: init.json === undefined ? init.body : JSON.stringify(init.json),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return res;
  }
}

async function main() {
  const { createGame, demoGame } = await import("@/game/engine");
  const { stripSecrets } = await import("@/server/gameSave");
  // Exact identity for the world checks: the script knows its own session tokens,
  // so it can compute the same opaque `ref` the server publishes. Asserting on
  // display names alone would be ambiguous in a dev database that already holds
  // publications from earlier smoke runs.
  const { createHash } = await import("node:crypto");
  const { refForPlayer } = await import("@/game/world");
  // Mirrors src/server/session.ts:25 (that module is `server-only`, so it cannot
  // be imported from a script that also pulls in client code).
  const playerIdFromToken = (token: string) => createHash("sha256").update(token).digest("hex");
  const refOf = (jar: Jar) => refForPlayer(playerIdFromToken(jar.cookie.replace("simplayz_session=", "")));

  // ---- 1. session + create ------------------------------------------------
  const a = new Jar();
  const sessionRes = await a.call("/api/session", { method: "POST", json: {} });
  record("anonymous session created", sessionRes.status === 201 && a.cookie.startsWith("simplayz_session="), `status ${sessionRes.status}`);

  const fresh = createGame("Smoke Test", "SMOKE WORKS", 40.7128, -74.006, "manual");
  const put1 = await a.call("/api/save", { method: "PUT", json: { baseRevision: 0, state: stripSecrets(fresh) } });
  const put1Body = (await put1.json()) as { save?: { revision: number } };
  record("first save creates revision 1", put1.status === 201 && put1Body.save?.revision === 1, `status ${put1.status}, rev ${put1Body.save?.revision}`);

  // ---- 2. read back -------------------------------------------------------
  const get1 = await a.call("/api/save");
  const get1Body = (await get1.json()) as { save: { revision: number; state: { company: string } } };
  record(
    "reload returns the same company",
    get1.status === 200 && get1Body.save.state.company === "SMOKE WORKS" && get1Body.save.revision === 1,
    `status ${get1.status}, rev ${get1Body.save.revision}`,
  );

  // ---- 3. progress + revision increment -----------------------------------
  const played = stripSecrets({ ...fresh, economy: { ...fresh.economy, tick: 42, credits: 123_456 } });
  const put2 = await a.call("/api/save", { method: "PUT", json: { baseRevision: 1, state: played } });
  const put2Body = (await put2.json()) as { save?: { revision: number } };
  record("second save increments the revision", put2.status === 200 && put2Body.save?.revision === 2, `status ${put2.status}, rev ${put2Body.save?.revision}`);

  // ---- 4. stale write is rejected ---------------------------------------
  const stale = await a.call("/api/save", { method: "PUT", json: { baseRevision: 1, state: played } });
  const staleBody = (await stale.json()) as { error?: { code?: string }; currentRevision?: number };
  record(
    "stale write rejected with a recoverable conflict",
    stale.status === 409 && staleBody.error?.code === "revision_conflict" && staleBody.currentRevision === 2,
    `status ${stale.status}, code ${staleBody.error?.code}`,
  );

  // ---- 5. CSRF --------------------------------------------------------
  const csrf = await a.call("/api/save", {
    method: "DELETE",
    headers: { origin: "http://evil.example", "content-type": "application/json" },
  });
  record("cross-origin state change blocked", csrf.status === 403, `status ${csrf.status}`);

  // ---- 6. malformed payload does not replace the save --------------------
  const malformed = await a.call("/api/save", {
    method: "PUT",
    json: { baseRevision: 2, state: { ...played, economy: { ...played.economy, credits: "lots" } } },
  });
  const afterMalformed = (await (await a.call("/api/save")).json()) as { save: { revision: number; state: { economy: { credits: number } } } };
  record(
    "invalid save rejected, previous save intact",
    malformed.status === 422 && afterMalformed.save.revision === 2 && afterMalformed.save.state.economy.credits === 123_456,
    `status ${malformed.status}, stored rev ${afterMalformed.save.revision}`,
  );

  // ---- 7. session isolation ---------------------------------------------
  const b = new Jar();
  await b.call("/api/session", { method: "POST", json: {} });
  const bRead = (await (await b.call("/api/save")).json()) as { save: unknown };
  record("second session sees no save", bRead.save === null, `save ${JSON.stringify(bRead.save)?.slice(0, 20)}`);

  const bWrite = await b.call("/api/save", {
    method: "PUT",
    json: { baseRevision: 0, state: stripSecrets(demoGame()) },
  });
  const aAfterB = (await (await a.call("/api/save")).json()) as { save: { revision: number; state: { company: string } } };
  record(
    "second session cannot read or overwrite the first",
    bWrite.status === 201 && aAfterB.save.state.company === "SMOKE WORKS" && aAfterB.save.revision === 2,
    `first session still rev ${aAfterB.save.revision} / ${aAfterB.save.state.company}`,
  );

  // ---- 8. secret boundary ----------------------------------------------
  const leaked = await a.call("/api/save");
  const leakedText = await leaked.text();
  record(
    "save response contains no credential fields",
    !leakedText.includes("apiKey") && !leakedText.includes("baseUrl") && !leakedText.includes("sk-"),
    `${leakedText.length} bytes scanned`,
  );

  // ---- 9. advisor degrades without a provider ---------------------------
  const advisor = await a.call("/api/advisor", {
    method: "POST",
    json: { role: "cto", prompt: "What should I build next?", history: [] },
  });
  const advisorBody = (await advisor.json()) as { source: string; text: string; error?: { code: string } };
  record(
    "advisor returns grounded local advice (no live provider configured)",
    advisor.status === 200 && advisorBody.source === "local-model" && advisorBody.text.length > 20,
    `code ${advisorBody.error?.code ?? "live"}, ${advisorBody.text.length} chars`,
  );

  // ---- 10. shared world: two players, one map ---------------------------
  // A and B are independent cookie jars, i.e. two browsers. This is the exact
  // reported bug: before the registry, neither could see the other's area.
  const meA = (await (await a.call("/api/world/me")).json()) as { published: boolean };
  record("world: unpublished by default", meA.published === false, `published ${meA.published}`);

  // B loads the demo city, whose claim is nowhere near A's. Give B a save next
  // to A so the "one map" claim is tested on real shared geography.
  const bNearby = stripSecrets({ ...fresh, company: "SMOKE RIVAL", ceoName: "Rival Test", speed: 0 });
  const bRewritten = await b.call("/api/save", { method: "PUT", json: { baseRevision: 1, state: bNearby } });
  record("world: second player re-registers next to the first", bRewritten.status === 200, `status ${bRewritten.status}`);

  const pubA = await a.call("/api/world/publish", { method: "POST", json: { publish: true } });
  const pubB = await b.call("/api/world/publish", { method: "POST", json: { publish: true } });
  record(
    "world: both players publish their area",
    pubA.status === 200 && pubB.status === 200,
    `A ${pubA.status}, B ${pubB.status}`,
  );

  const bbox = "latMin=30&latMax=50&lngMin=-90&lngMax=-60";
  const worldForB = (await (await b.call(`/api/world?${bbox}&limit=200`)).json()) as {
    entries: { ref: string; kind: string; display: string }[];
    counts: { player: number; ai: number };
  };
  const refA = refOf(a);
  const refB = refOf(b);
  const seesA = worldForB.entries.find((e) => e.ref === refA);
  record(
    "world: player B sees player A's area (the reported bug)",
    Boolean(seesA) && seesA?.kind === "player" && seesA?.display === "SMOKE WORKS",
    `${worldForB.counts.player} player / ${worldForB.counts.ai} AI entries for B`,
  );

  const worldForA = (await (await a.call(`/api/world?${bbox}&limit=200`)).json()) as {
    entries: { ref: string; display: string; kind: string }[];
    counts: { player: number; ai: number };
  };
  record(
    "world: player A sees player B's area",
    worldForA.entries.some((e) => e.ref === refB && e.display === "SMOKE RIVAL"),
    `${worldForA.counts.player} player / ${worldForA.counts.ai} AI entries for A`,
  );
  record(
    "world: a player never sees themselves as a neighbour",
    !worldForA.entries.some((e) => e.ref === refA),
    `own ref present: ${worldForA.entries.some((e) => e.ref === refA)}`,
  );

  const worldText = await (await b.call(`/api/world?${bbox}`)).text();
  record(
    "world: response carries no player id and no extra coordinate precision",
    !/player[_-]?id/i.test(worldText) && !/-?\d+\.\d{3,}/.test(worldText),
    `${worldText.length} bytes scanned`,
  );

  // A third, independent session observes both — a player's own query filters
  // themselves out by design, so B cannot be used to confirm B.
  const c = new Jar();
  await c.call("/api/session", { method: "POST", json: {} });
  const unshare = await a.call("/api/world/publish", { method: "POST", json: { publish: false } });
  const worldAfterUnshare = (await (await c.call(`/api/world?${bbox}`)).json()) as {
    entries: { ref: string; display: string; kind: string }[];
  };
  record(
    "world: opting out removes the area from other players",
    unshare.status === 200 &&
      !worldAfterUnshare.entries.some((e) => e.ref === refA) &&
      worldAfterUnshare.entries.some((e) => e.ref === refB),
    `status ${unshare.status}, A present after opt-out: ${
      worldAfterUnshare.entries.some((e) => e.ref === refA)
    }, B still visible: ${worldAfterUnshare.entries.some((e) => e.ref === refB)}`,
  );

  // Leave the shared dev database as we found it.
  await b.call("/api/world/publish", { method: "POST", json: { publish: false } });

  const worldNoSession = await new Jar().call(`/api/world?${bbox}`);
  record("world: unauthenticated read refused", worldNoSession.status === 401, `status ${worldNoSession.status}`);

  // ---- 11. persistence across a restart is verified by --expect-token ----
  const expect = process.env.SMOKE_EXPECT_TOKEN;
  if (expect) {
    const jar = new Jar();
    jar.cookie = `simplayz_session=${expect}`;
    const res = await jar.call("/api/save");
    const body = (await res.json()) as { save: { revision: number; state: { company: string; economy: { tick: number } } } | null };
    record(
      "save survived a server restart",
      res.status === 200 && body.save?.state.company === "SMOKE WORKS" && body.save.state.economy.tick === 42,
      `status ${res.status}, rev ${body.save?.revision}, tick ${body.save?.state.economy.tick}`,
    );
  } else {
    console.log(
      `\nSESSION TOKEN for the restart check: ${a.cookie.replace("simplayz_session=", "")}\n` +
        `Restart the server, then run:\n  SMOKE_EXPECT_TOKEN=<token> npx tsx scripts/smoke-http.ts\n` +
        `(that mode only checks that the save still loads; the token is a test session, not a player's.)`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
