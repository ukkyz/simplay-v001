# Validation guide — v2 (Next.js + SQLite migration)

## Verified baseline (2026-11-17, Node 22.22.3 / npm 10.9.8)

| Check | Result |
| --- | --- |
| `npm ci` | PASS with `--nodedir=/usr/local`; the plain run fails in this sandbox because node-gyp cannot reach `nodejs.org` for Node headers (network policy, not a repo defect) |
| `npm run typecheck` (`tsc --noEmit`, strict) | PASS |
| `npm test` (75 assertions across 7 files) | PASS |
| `npm run build` (`next build`, Turbopack) | PASS |
| `npm run db:migrate` → `0000_init.sql` applied, idempotent on re-run | PASS |
| `npm run db:backup` → snapshot + `integrity_check: ok` | PASS |
| `npx tsx scripts/smoke-http.ts` against `next dev` | PASS 20/20 |
| `npx tsx scripts/smoke-http.ts` against `next start` (port 3100) | PASS 20/20 |
| Same-database save after a real dev-server restart (`SMOKE_EXPECT_TOKEN`) | PASS 12/12 |
| Browser gameplay (Leaflet tiles, WebGL interiors, pointer lock, full onboarding) | **NOT RUN** — no browser/GPU tooling in this environment (Chromium cannot start: `libnss3` is missing and the sandbox is unprivileged) |
| Shared-map rendering (neighbour markers/tooltips, 10 s poll, publish toggle in the page) | **NOT RUN** — covered by tests and HTTP smoke, never by a rendered page |
| Live model/provider evaluation | **NOT RUN** — no authorized provider/key; no player data sent |

**What the automated tests are.** `tests/save-api.test.ts`, `tests/legacy-migration.test.ts`
and `tests/advisor-route.test.ts` import the real Next.js route handlers and run them
against a **real better-sqlite3 database** in a temp directory (real migrations, real
transactions). `tests/advisor-route.test.ts` replaces `fetch`, so it is a *mocked*
integration test: it proves credential containment, allowlisting, timeout and fallback
wiring, not model quality. `tests/save-queue.test.ts` drives the autosave scheduler with
an injected clock. `tests/client-boundary.test.ts` is a static source audit.

`tests/world-api.test.ts` drives the real world routes against a real database: mutual
visibility between two cookie jars, ignored client-supplied position/identity, coarsening in
storage and in responses, opt-out deleting rows, reset withdrawing a publication, bbox and
limit validation, CSRF/content-type rejection, response-size budget, and AI-roster
determinism (same seed ⇒ byte-identical, different seed ⇒ different, wide viewports sampled
without moving survivors).

Compilation and HTTP checks do not prove gameplay correctness, visual fidelity, or
map/WebGL lifecycle safety. The shared map's marker DOM, tooltips and poll timing have never
been observed in a browser.

## Covered contracts

| Area | Test | Expectation |
| --- | --- | --- |
| Happy path | `save-api` → "creates a session cookie, writes rev 1, reads it back, then increments" | 43-char token, `HttpOnly`+`SameSite=lax`, rev 1 → 2 |
| Concurrency | "accepts exactly one of two writes that both claim revision 2" | exactly one 200, one 409 with `currentRevision` |
| Malformed save | "rejects a malformed save … last valid save untouched" | 422 + `problems`, stored rev unchanged |
| Dangling references | "rejects a save with a dangling entity reference" | 422 |
| Unauthenticated | "refuses unauthenticated reads and writes" | 401 |
| CSRF | "blocks cross-origin and origin-less state changes" | 403 both |
| Content type / size | "rejects non-JSON content types and oversized bodies" | 415 / 413 |
| DB failure | "surfaces a database write failure as 503 without leaking internals" | 503, no table/path text |
| Isolation | "never returns another session's save", "reset deletes only the caller's save" | B unchanged by A |
| Secrets | "rejects a payload that still carries a credential", "strips … stored and returned saves" | 422, no echo, no `apiKey`/`baseUrl` |
| Legacy migration | `legacy-migration` → validation, redaction, debt/bounds preservation, broken plan | valid blob migrates at rev 1 without the old key; invalid does not |
| Versioning | "reports schemaVersion alongside a revision" | save schema 4, revision 2, ledger present |
| Autosave cadence | `save-queue` → "at least every 5 s while snapshots keep arriving" | ≥6 writes / 30 s @16×, gaps 4–5 s, no per-tick burst |
| Single in-flight | "coalesces many submissions into one in-flight write" | `maxInFlight === 1` |
| Failure/retry | "keeps the pending snapshot and retries with backoff" | snapshot retained, backoff capped at 9 s |
| Conflict pause | "pauses on a revision conflict and never overwrites silently" | zero further writes until resolved |
| Invalid payload | "stops retrying a payload the server rejected as invalid" | exactly one attempt, snapshot kept |
| Teardown | "dispose clears timers" | zero writes after dispose (StrictMode remount safety) |
| Advisor | `advisor-route` | key server-side and never echoed, allowlists, timeout→fallback, 500/empty→fallback, 429, history trim, 401/403 |
| Loading gates | `client-boundary` → "gates simulation ticks behind the save phase" | tick effect returns unless `phase === "ready"` |
| SSR boundary | `client-boundary` → ssr:false page, layout imports, client directives, nodejs runtime, 0.0.0.0 scripts | as stated |

## Manual browser smoke protocol

Not run in this environment. Use a disposable browser profile and a disposable
database (`SIMPLAYZ_DB_PATH=/tmp/smoke.sqlite`), and record browser/device/commit.

| Case | Procedure | Expected |
| --- | --- | --- |
| Onboarding + save badge | Fresh profile → register a company | Console appears, badge reaches `SAVED`, no hydration warning, one map instance |
| Demo | Reload → "Skip ahead" on a fresh session | Pre-rolled city at revision 1 |
| OSM map | Inspect tiles + attribution | Tiles load, attribution visible, no duplicate map after a screen switch |
| Construction | Commission a Tier-1 site with funds | Phases advance, deploy creates exactly one building |
| Plan editing | Edit draft cells, deploy, compare 2D/3D | Layout retained, scene rebuilt without leaked WebGL contexts |
| 3D entry/exit | FPS mode → pointer lock → Esc → switch screen | Pointer lock released, listeners removed, no console errors |
| Board fallback | Ask the CTO with no `SIMPLAYZ_AI_API_KEY` | Local advice with a `LOCAL ADVISOR` label |
| Save/reload | Play 30 s at 16×, reload | Progress within the last ~4 s restored, revision increased |
| Separate sessions | Second profile | Independent company; first unaffected |
| Server restart | Stop/start the dev server with the same `SIMPLAYZ_DB_PATH` | Same company resumes (covered at HTTP level above) |
| Conflict | Two tabs on one session, both play, wait for the second write | `409` → conflict screen, autosave paused, both choices work |
| Network failure | DevTools → offline, keep playing | Badge `UNSAVED` + retry, game keeps running, unload guard appears; back online → saved |
| Legacy migration | Seed `localStorage["simplayz.save.v4"]` with an old save (no server save) | Migration offer, validated, uploaded once, local copy cleared after ack |
| Legacy + server | Seed legacy blob with an existing server save | Explicit choice; server save intact until the player confirms |

## Manual checks that remain OUT OF SCOPE / NOT RUN

- Real provider calls (`SIMPLAYZ_AI_*`) — needs an authorized key and budget.
- Mobile/touch interiors (pointer lock does not exist on touch devices).
- Multi-instance deployment, process-manager restarts under load, WAL on network FS.
