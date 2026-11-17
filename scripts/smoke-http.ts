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

  // ---- 10. persistence across a restart is verified by --expect-token ----
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
