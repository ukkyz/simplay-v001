# Decisions, risks and open questions — v2.0

v1.0 audit: 2026-11-16, baseline `294a75c`. v2.0: 2026-11-17, `arena/8af8e052-simplay`
(Next.js + SQLite persistence migration). Priority is a recommendation, not an approved
implementation backlog.

## Accepted decisions in v2 (Next.js + SQLite)

| ID | Decision | Rationale / alternatives rejected |
| --- | --- | --- |
| D1 | Next.js 16.4.6 App Router + React 19.2.6 + TS 5.9.3; Vite and single-file build removed | Requested stack; mutually compatible peers verified before install. Remix/Vite+Node server rejected as not requested. |
| D2 | Node.js runtime for all SQLite routes, `serverExternalPackages: ["better-sqlite3"]` | Edge runtime cannot open a local SQLite file. |
| D3 | better-sqlite3 13.2.0 + Drizzle ORM 0.45.4 / drizzle-kit 0.31.11, migrations as SQL files in `drizzle/` applied by a small internal runner | Verified the native addon builds and loads SQLite 3.54.1 before adoption. libsql/prisma alternatives were heavier or needed extra services. A tiny runner avoids depending on the dev-only CLI at boot. |
| D4 | Single Node server, local persistent filesystem, WAL journal | Requested target. Ephemeral/serverless hosting documented as unsupported. |
| D5 | Anonymous session cookie (32 random bytes; DB stores SHA-256) | Requested; no accounts. Client-supplied save ids are never used for authorization. |
| D6 | Optimistic concurrency via `revision` + compare-and-set inside one IMMEDIATE transaction | Prevents silent overwrite; 409 is surfaced as a recoverable choice. |
| D7 | Coalesced save queue: one in-flight write, ≥1 attempt / 4 s during continuous play, immediate flush on pause/significant action | Replaces the debounce that accelerated play could starve (old R3). 4 s is inside the 5 s progress-loss budget and ~1/64 of a 16× tick rate. |
| D8 | Client-driven simulation retained; server persists snapshots only | Requested; server authority/offline progression explicitly out of scope. |
| D9 | Operator-owned AI credentials, allowlisted endpoint/model, 12 s timeout, per-session rate limit; player-key UI removed | Fixes old R1 partly. Arbitrary client URL proxying rejected as an SSRF/open-proxy risk. |
| D10 | Reset deletes only the caller's save row + its advisor preferences; session row survives | Documented and implemented in `DELETE /api/save`. |

## Reworked risk register

| ID | Status | Impact and evidence |
| --- | --- | --- |
| R1 | **Partially fixed (v2)** | API keys are gone from `GameState`, persistence, exports, responses, bundles and logs (tests assert it). Remaining exposure: save contents (identity, claim location, economy) are still readable by whoever holds the cookie or the DB file; the advisor still sends a city digest externally when configured. Retention/consent policy still undefined. |
| R2 | **Partially fixed (v2)** | Saves and imports are structurally validated (bounds, plan `w*h`, entity references) before persistence; invalid payloads cannot replace the last valid save. The simulation values themselves are not re-derived server-side, so a hand-crafted *valid-shaped* save (e.g. absurd credits within bounds) is still accepted — that is client-driven simulation, not a validation bug. |
| R3 | **Fixed (v2)** | Autosave no longer starves under 4×/16× play; cadence and single-in-flight behaviour are unit-tested. Unload writes remain best effort. |
| R4 | Open | Still no shared authority or multiplayer. Snapshot persistence is not a network contract. |
| R5 | Open | Engine still uses `Math.random`/`Date.now`; tests that need determinism inject clocks/ids. Not addressed by this migration. |
| R6 | Partially fixed (v2) | Advisor now has a bounded timeout; the duplicated latest-turn bug is gone (history + current question are separate). `flows.revenue`/`netCredits` civic-dividend mismatch and static balance claims in local advice remain. |
| R7 | Open | Claim geometry still overlaps; roads still synthetic. |
| R8 | Open | Economic exploits (cancel-before-spend, phase overshoot, unbudgeted change requests) unchanged by design (no rebalancing in this change). |
| R9 | Open | Rationale drift in constants/in-app GDD unchanged. |
| R10 | **Partially fixed (v2)** | `npm test` (node:test + tsx) now exists with HTTP/SQLite/scheduler/boundary suites; typecheck is a separate script. Still no CI workflow and no lint script. |
| R11 | Open | OSM tile policy, fonts, and missing LICENSE unchanged. |
| R12 | **New (v2)** | Single-writer SQLite. Multi-instance, network filesystems and unplanned process kills during WAL growth are untested and unsupported. Rate limiting and session caches are per-process. |
| R13 | **New (v2)** | Anonymous identity: clearing cookies or site data loses access; no recovery. Users must export JSON. Documented in README and the Save screen. |

## Decisions needed for a shared world

1. One persistent planet or instanced worlds with asynchronous visits?
2. Who owns simulation time: continuous server, per-session, scheduled catch-up? Offline progress?
3. Identity/account recovery, sharding, authoritative action validation (the server currently validates snapshots, not actions)?
4. Exact claim geometry/size, overlap resolution, water/protected land, location privacy?
5. Multiplayer writes: who may edit/visit/trade; atomicity, cooldown authority, anti-duplication?
6. OSM as basemap only or as gameplay data? Provider/caching/licensing/query budget?
7. Production AI providers/models/temperatures, budget, retention, latency?
8. Economy goals: session length, escrow/refunds, inflation/sinks, monetization constraints?
9. Target devices/accessibility; touch interiors?
10. Deployment target and backup/restore ownership (single VM vs managed platform) — see R12.

## Revision log

- v1.0 — 2026-11-16: repository audit; separated multiplayer/OSM vision from browser-local simulation.
- v2.0 — 2026-11-17: accepted Next.js + SQLite decisions (D1–D10), updated R1/R2/R3/R6/R10 status, added R12/R13.


## Confirmed direction vs provisional defaults

**User-confirmed direction:** Simplayz is intended to be a multiplayer world simulation using the same real-world map based on OpenStreetMap.

**Existing prototype defaults, not confirmed product decisions:** 64 km² claims, four sectors × five sites, 20 archetypes, desktop-first interiors, 10–15 minute sessions, local persistence, simulated peers, SDLC construction and OpenAI-compatible advisors. These are playable hypotheses. See `OPEN_QUESTIONS` (`q1`–`q12`) in `src/game/constants.ts`. In-app question answers are saved text only; they do not reconfigure game rules.

## Known risks / source discrepancies

| ID | Impact and evidence | Recommended handling in a future scoped change |
| --- | --- | --- |
| R1 | **High: secret/privacy exposure.** AI keys, identity and claim location live in `GameState`; store persists it, GDD exports it, advisor sends a digest/history externally. | Redact exports and design server-side credential custody; define data consent/retention. Never share raw saves. |
| R2 | **High: untrusted saves.** GDD schema-only check and direct `hydrate`; startup checks schema/claim only. Malformed matching-schema saves may crash views. | Runtime validation, reference integrity checks and safe error recovery before hydration. |
| R3 | **High: save starvation.** 700 ms debounce is reset by 250/62.5 ms ticks at 4×/16×. Quota failures are silent. | Define maximum unsaved duration and visible failure; test reload during accelerated play. |
| R4 | **High: no shared authority.** Generated peers/online flags, local actions and synthetic claims. | Decide server model, ownership and conflict resolution before multiplayer implementation. |
| R5 | **Medium: simulation is not pure/replayable.** Engine calls `Math.random` and `Date.now`, contrary to its header. React runs under StrictMode. | Control RNG/time for tests; evaluate replay-safe actions before authoritative networking. |
| R6 | **Medium: advisor correctness/liveness.** No request timeout; duplicated latest user turn; local text includes static balance assertions. `flows.revenue` includes civic dividend but `netCredits` excludes it, affecting displayed/digested runway. | Choose canonical accounting semantics; test digest/advice against formulas; add timeout separately if requested. |
| R7 | **Medium: geometry overclaims.** Free-selected centers can overlap; small-angle boxes are not a globally tiled land registry. q8 says 3-node road bend; actual path has five points and is not OSM routing. | Specify claim geometry/conflicts and routing provider/budget. Do not treat comments as guarantees. |
| R8 | **Medium: economic exploits/bounds need tests.** Cancellation adds a fraction of unspent budget even before any debit; phase draws may overshoot on boundary ticks; change requests lack a treasury guard. | Agree escrow/refund/debt semantics, then add conservation/boundary tests. Do not silently rebalance in docs work. |
| R9 | **Medium: rationale drift.** Opening stocks total 1,600 units against 400 base capacity; Aquaponics says “25% more power” but table draws 55 vs Farm 70; some opening-food/material rationales are stale. | Reconcile descriptions with measured behavior. Rationale is a hypothesis, not verified balance data. |
| R10 | **Medium: missing regression infrastructure.** No test runner/lint/CI scripts; build does not typecheck. | Add focused tests in a separately scoped change; use documented manual checks now. |
| R11 | **Medium: service/rights readiness.** External OSM tiles/fonts, browser API CORS, no project LICENSE. | Review tile policy, attribution, hosting and distribution rights before launch; don't invent a license. |

## Decisions needed for a shared world

1. One persistent planet or instanced worlds with asynchronous visits? What does “same map” mean for ownership and visibility?
2. Who owns simulation time: continuously running server, per-session, or scheduled catch-up? What happens offline?
3. Identity/account recovery, region/shard scope and authoritative action validation?
4. Exact claim geometry/size, overlapping claims, water/protected land, antimeridian and location privacy?
5. Multiplayer writes: who may edit/visit/trade; atomicity, cooldown authority and anti-duplication rules?
6. OSM as visual basemap only or terrain/buildings/roads as gameplay data? Provider, caching, licensing and query budget?
7. Production AI providers/models/temperatures, budget, retention, latency target and credential handling?
8. Economy goals: target session length, recovery floor, escrow/refunds, inflation/sinks and any monetization constraints?
9. Target devices and accessibility; are touch interiors in scope?

Resolve only the decisions needed for the next change. Do not block a local UI fix on the entire roadmap. Record accepted decisions with date, user authority, rationale, alternatives and affected files/tests.

## Revision log

- v1.0 — 2026-11-16: repository audit and separation of confirmed vision from prototype assumptions. No product decisions newly approved.
