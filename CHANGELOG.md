# Changelog

Repository history. Existing in-game feature history remains in `src/game/constants.ts`; its dates/versions have not been independently verified. Package version `0.0.0`, game-save schema `4`, in-game feature version and document versions are separate identifiers.

## 2026-11-17 — Ally areas prompt v1 (documentation only)

- Added `docs/prompts/ALLY_AREAS.md`: a compact implementation prompt for ally-owned areas
  plus a read-only 3D parcel tour, with output contract, six success criteria, review
  fixtures and risks.
- Verified before writing: the app already has a UI-only `ui.visit` target routed by
  `Studio.resolveTarget()` into `BuildingScene` with `readOnly: true` (peer buildings only),
  so the prompt extends that seam instead of adding a second 3D route, and `AllianceBot`
  currently carries no area/structures.
- Called out the two silent-failure traps explicitly: new save fields need
  `validateGameState()`/`prepareLegacySave()` updates or every save returns `422`, and
  read-only must be enforced in the reducer rather than by hiding UI.
- Documentation only: no code, save, balance or prompt-runtime behaviour changed. Prompt
  status is **proposed / NOT RUN**.

## 2026-11-17 — Next.js + SQLite persistence migration (v2)

**Stack.** Replaced Vite 7 + `vite-plugin-singlefile` with Next.js 16.4.6 App Router
(Turbopack), React 19.2.6, TypeScript 5.9.3 strict, Tailwind 4.3.5 via
`@tailwindcss/postcss`. Removed `index.html`, `vite.config.ts`, `src/main.tsx` and the
single-file build. Path alias `@/*` retained.

- `src/app/layout.tsx` (server) + `src/app/page.tsx` (`dynamic(..., { ssr: false })`) +
  `src/components/GameShell.tsx`; all browser components are client components.
  Leaflet, Three.js, localStorage, pointer lock and WebGL stay out of SSR.
- Global + Leaflet CSS now load through `src/app/globals.css`; OSM attribution preserved.
- `npm run dev|build|start` bind to `0.0.0.0`; dev-preview origins allowlisted narrowly
  (`allowedDevOrigins`, `SIMPLAYZ_DEV_ORIGINS`); no global origin protection disabled.

**Persistence.** Added better-sqlite3 13.2.0 + Drizzle ORM 0.45.4 with versioned SQL
migrations in `drizzle/`, `npm run db:generate|db:migrate|db:backup`.

- `players` + `game_saves` tables; one credential-free snapshot per player.
- Anonymous session cookie (32 random bytes, `HttpOnly`, `SameSite=Lax`, `Secure` in
  production); the DB stores only its SHA-256, and ownership is enforced in every query.
- Optimistic concurrency: `revision` + compare-and-set in one IMMEDIATE transaction;
  stale writes get `409 revision_conflict` and are never silently applied.
- Full pre-write validation (bounds, plan dimensions, entity references) that allows
  legitimate states such as zero treasury, debt and negative `powerDemanded`. Invalid
  payloads never replace the last valid save.
- Same-origin/CSRF checks, JSON content type, payload caps, parameterized SQL,
  sanitized error envelopes, `server-only` DB modules.
- Save queue replaces the tick-reset debounce: single in-flight write, ≥1 attempt every
  4 s during continuous play, immediate flush on pause/import/reset; retry with capped
  backoff; conflict pauses autosave behind an explicit recovery choice.
- Lifecycle UI: loading, onboarding, legacy offer/conflict, saving, saved, unsaved-error,
  conflict. Ticks start only in the `ready` phase.
- Legacy `simplayz.save.v4` offers a one-time validated migration, never automatic, and
  is only cleared after the server acknowledges the write.
- Reset deletes only the caller's save (and its advisor preferences); the session row
  survives. Documented in README/PERSISTENCE and the in-app Save screen.

**Credentials.** Removed player API keys from `GameState` persistence, exports, responses
and bundles (`stripSecrets`). Added `POST /api/advisor` with operator env credentials,
endpoint/model allowlists, 12 s default timeout, per-session rate limiting and
server-built digest; local rule-based advice (now `src/game/localAdvisor.ts`, isomorphic)
answers when unconfigured or on any upstream failure. Boardroom key/base-URL inputs
replaced with a server-configuration explanation.

**Tests and docs.** Added `npm test` (node:test + tsx) covering happy path, concurrent
stale writes, malformed/unauthorized/storage-failure paths, session isolation, CSRF,
payload limits, legacy migration, secret stripping, autosave cadence/backoff/conflict
pause, advisor proxy behaviour and client-boundary/SSR gates; added
`scripts/smoke-http.ts`. New/updated docs: README, AGENTS, `docs/ARCHITECTURE.md`,
`docs/PERSISTENCE.md`, `docs/TESTING.md`, `docs/DECISIONS.md`, `docs/prompts/ADVISOR_PROMPT.md`.

Unchanged by intent: economy values, construction costs/durations, map geometry,
screens, floor-plan/3D behaviour, simulated peers. Browser gameplay and live-model
evaluation were **not run** in this environment.

## 2026-11-16 — Documentation v1.0 / change-request prompt v1

- Audited source at baseline `294a75c`; separated multiplayer/OSM vision from browser-local simulation.
- Added README, root agent instructions, architecture/source map, mechanic/balance reference, decision/risk register and validation guide.
- Added a versioned Arena change-request prompt with output contract, success criteria and happy/edge/failure evaluation fixtures; live-model tests explicitly not run.
- Added PR checklist and ignored generated `dist/` output.
- Verified dependency install, Vite production build and strict TypeScript check. Browser gameplay and external-service checks not run.
- No gameplay, economy, prompt runtime, networking or save format changed; identified risks remain unfixed.
