# Decisions, risks and open questions — v2.3

v1.0 audit: 2026-11-16, baseline `294a75c`. v2.0: 2026-11-17, `arena/8af8e052-simplay`
(Next.js + SQLite persistence migration). v2.1: 2026-11-17, `arena/4f86a17c-simplay` (ally
areas prompt recorded as provisional; duplicated v1 tail removed from this file). v2.2:
2026-11-17, `arena/5b8ea4e6-simplay` (shared-world prompt recorded as provisional). Priority is
a recommendation, not an approved implementation backlog.

## Confirmed direction vs provisional defaults

**User-confirmed direction:** Simplayz is intended to be a multiplayer world simulation using
the same real-world map based on OpenStreetMap.

**Existing prototype defaults, not confirmed product decisions:** 64 km² claims, four sectors
× five sites, 20 archetypes, desktop-first interiors, 10–15 minute sessions, simulated peers,
SDLC construction and OpenAI-compatible advisors. Persistence is now server-side SQLite with
anonymous sessions (D4/D5), which is an accepted implementation decision, not a multiplayer
answer. These defaults remain playable hypotheses — see `OPEN_QUESTIONS` (`q1`–`q12`) in
`src/game/constants.ts`. In-app question answers are saved text only; they do not
reconfigure game rules.

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
| D10 | Reset deletes only the caller's save row + its advisor preferences; session row survives | Documented and implemented in `DELETE /api/save`. Now also deletes the caller's `world_players` row: a publication never outlives its save. |
| D11 | **Shared map = presence only.** A separate `world_players` table holds an opt-in, server-derived, 1/100°-coarsened outline per player; the AI neighbour roster is deterministic per `SIMPLAYZ_WORLD_SEED`. No shared simulation, economy, trade, ownership or authority. | Implemented 2026-11-17 from `docs/prompts/SHARED_WORLD.md`. Chosen over widening `GameState`: save shape `4` and both validators are untouched, opt-out is a hard delete, and precise coordinates never reach the database. `player_id` is never returned (responses use an opaque `ref`). |

## Reworked risk register

| ID | Status | Impact and evidence |
| --- | --- | --- |
| R1 | **Partially fixed (v2)** | API keys are gone from `GameState`, persistence, exports, responses, bundles and logs (tests assert it). Remaining exposure: save contents (identity, claim location, economy) are still readable by whoever holds the cookie or the DB file; the advisor still sends a city digest externally when configured. Retention/consent policy still undefined. |
| R2 | **Partially fixed (v2)** | Saves and imports are structurally validated (bounds, plan `w*h`, entity references) before persistence; invalid payloads cannot replace the last valid save. The simulation values themselves are not re-derived server-side, so a hand-crafted *valid-shaped* save (e.g. absurd credits within bounds) is still accepted — that is client-driven simulation, not a validation bug. |
| R3 | **Fixed (v2)** | Autosave no longer starves under 4×/16× play; cadence and single-in-flight behaviour are unit-tested. Unload writes remain best effort. |
| R4 | Open (partly mitigated by D11) | Two players can now *see* each other's approximate area, but there is still no shared authority, shared tick, shared economy or conflict rule. Snapshot persistence is not a network contract; a published position reflects what a client saved, not a verified location. |
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

## Provisional direction recorded, not approved

- **Ally-owned parcel areas + read-only 3D tour** (`docs/prompts/ALLY_AREAS.md`, prompt v1):
  proposed as the next visual/gameplay change. Not a decision: it touches `AllianceBot`
  shape (save growth), grants allies autonomous construction, and reuses the existing
  `ui.visit` → `BuildingScene` read-only path. Ally autonomy must not spend the player's
  treasury, and simulated allies stay labelled simulated. Any effect on trade or economy
  needs its own approved decision.
- **Shared world map** (`docs/prompts/SHARED_WORLD.md`, prompt v1): a published-area
  registry plus a deterministic shared AI roster, so two players can see each other's
  area. Not a decision. D8 (client-driven simulation, server stores snapshots) and q4
  (overlap) and q5 (who may write) stay open; the prompt is presence only — no shared
  economy, no realtime transport, no shared authority. Publishing is opt-in, off by
  default, and stores coarsened coordinates only.

## Revision log

- v1.0 — 2026-11-16: repository audit; separated multiplayer/OSM vision from browser-local simulation.
- v2.0 — 2026-11-17: accepted Next.js + SQLite decisions (D1–D10), updated R1/R2/R3/R6/R10 status, added R12/R13.
- v2.1 — 2026-11-17: recorded the ally-areas prompt (`docs/prompts/ALLY_AREAS.md`) as provisional direction — no product decision approved, no risk status changed. Also removed a duplicated v1 body that had survived the v2 rewrite (the file contained two `## Revision log` sections and a stale risk table); the "Confirmed direction vs provisional defaults" section was restored verbatim in intent and updated for server-side persistence.
- v2.2 — 2026-11-17: recorded the shared-world prompt as provisional direction. No decision approved, no risk status changed; R4 stays Open because presence is not authority.
