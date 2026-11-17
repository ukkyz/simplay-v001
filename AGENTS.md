# Agent operating guide — v2.0

Applies to the whole repository. Updated 2026-11-17. Current stack: Next.js 16 (App Router)
+ React 19 + better-sqlite3/Drizzle. Migration baseline: `1cfb21e`; v1.0 documentation baseline `294a75c`.

## Read in this order

1. `README.md`: implemented app vs multiplayer vision, setup, env vars, deployment, secret handling.
2. `docs/ARCHITECTURE.md`: source map, rendering/request boundaries, persistence seams.
3. `docs/PERSISTENCE.md`: schema/versions, save lifecycle, API contract, backup/restore.
4. `docs/DECISIONS.md`: accepted decisions and known risks.
5. For mechanics/balance read `docs/GAME_DESIGN.md`; for prompts read `docs/prompts/ADVISOR_PROMPT.md`
   and `docs/prompts/CHANGE_REQUEST.md`; validate using `docs/TESTING.md`.

Inspect current source and `git status --short` before editing. These docs are a map, not a substitute for reading changed code. Existing runtime behavior wins when describing implementation; an explicit user decision defines intended behavior. Record disagreements instead of hiding them.

## Scope and guardrails

- Work on the session's current branch; do not create/switch/rename branches. Do not commit, push, open PRs, or change unrelated files unless requested.
- Preserve the Next.js/React/TypeScript stack and existing visual language unless the request changes them. Avoid unrelated dependency upgrades or architecture rewrites. Do not reintroduce Vite, `index.html` or single-file bundling.
- Game mutations belong in the engine/action contract, not duplicated UI calculations. UI-only selection/chat/toasts belong in the store's `UiState`.
- Do not claim that simulated peers are humans, that a type union enables multiplayer, or that visual OSM tiles are authoritative geography/ownership/routing data.
- Preserve OSM attribution. Read latitude/longitude ordering carefully; see architecture. Do not add mass tile downloads, unrestricted geocoding, or an Overpass dependency as a side effect of a visual change.
- Preserve `schema: 4` compatibility and the ability to migrate `simplayz.save.v4` unless the request requires a change. Schema changes need an explicit migration path, a legacy blob test, and a documented reset. Never silently discard player progress or overwrite a valid save with defaults.
- Never commit keys, location-bearing saves, `data/`, `backups/`, `*.sqlite*`, `.env*`, `node_modules/` or `.next/`. There are no `NEXT_PUBLIC_*` secrets: that prefix is public. AI credentials are server env only (`SIMPLAYZ_AI_*`) and must never reach a save, export, response, log or bundle.
- Keep the client/server boundary honest: DB/session/AI-config modules are `server-only`; Leaflet, Three.js, `window`/`document`, pointer lock and WebGL stay inside `"use client"` trees and `useEffect`. Browser application calls use relative URLs only.
- Persistence changes must keep: cookie-only ownership, optimistic concurrency (reject stale writes, never overwrite), validation before write, JSON content type + same-origin checks, and credential stripping.
- Do not describe the reducer as deterministic: it currently uses `Math.random` and `Date.now`. Mock/control those sources for reproducible tests.
- Dev/preview servers bind to `0.0.0.0`; browser code must not call sandbox `localhost` for a separate API. Allow preview origins narrowly (`allowedDevOrigins` / `SIMPLAYZ_DEV_ORIGINS`), never by disabling origin checks.

## Change workflow

1. Restate the player problem and measurable acceptance criteria. Identify impacted files, non-goals, save/API/security consequences, and dependencies.
2. Ask only questions that materially block safe work (especially authority, ownership conflicts, economic intent, data loss, credentials). Otherwise label reversible assumptions.
3. Implement the smallest coherent change; keep costs, durations, rewards, cooldowns and their rationale together. Do not silently rebalance while fixing UI.
4. Validate happy path, boundary/edge, and failure/recovery. Run `npm run typecheck`, `npm test` and `npm run build`; for server changes also run `npx tsx scripts/smoke-http.ts` against `npm run dev`. Add or extend focused tests (`tests/*.test.ts`). Never call a mocked or HTTP check an end-to-end gameplay test, and never claim a check you did not run.
5. Update relevant docs and `CHANGELOG.md` for significant behavior/design changes. Keep in-app GDD/tables aligned where relevant. Report discrepancies that remain.
6. Summarize changed behavior/files, check results, skipped checks with reasons, and remaining risks. Do not claim production readiness from compilation alone. Database changes need a migration file (`npm run db:generate`), a migrate/backup note in `docs/PERSISTENCE.md`, and a test.

## Design and prompt contracts

Every new/changed mechanic must specify purpose, player feeling/decision, inputs, outputs, rules/formulas, edge cases, failure/recovery, and acceptance tests. Every changed economic number needs units, a rationale, and a boundary example. Distinguish hypothesis from measured balance.

Before authoring a prompt define its output format and success criteria. Version it with a changelog and at least three cases (happy, edge, failure). Ground factual claims in provided state; make unknowns explicit; specify word/field limits instead of vague style instructions. Request concise decision summaries, not private chain-of-thought. Record actual production model identifier, provider, temperature, fixtures, and observations for model tests. If live evaluation is unavailable, mark it **not run** rather than asserting reliability. Do not send secrets or private player data to evaluate a prompt without approval.

## Definition of done

- Acceptance criteria implemented or explicitly marked blocked/deferred.
- `npm run typecheck`, `npm test`, `npm run build` results reported; browser-only checks disclosed as NOT RUN with a reason when tooling is unavailable.
- Save/schema/ownership, validation, resource integrity, map lifecycle, cleanup and endpoint fallback considered where touched.
- Anonymous-session limitations, reset semantics and backup/restore impact documented when persistence changes.
- Design/prompt revision and test evidence updated; no unrelated code/artifact changes; no committed database, backup or secret.
