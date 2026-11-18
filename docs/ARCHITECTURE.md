# Architecture and source map — v2 (Next.js + SQLite)

Updated 2026-11-17 on `arena/8af8e052-simplay` (base `1cfb21e`). Supersedes the v1
Vite/localStorage description. Runtime behavior is defined by the source listed here.

## Runtime

```
src/app/layout.tsx  (server component: metadata, fonts, globals.css)
  └─ src/app/page.tsx ("use client", dynamic ssr:false)
       └─ src/components/GameShell.tsx ("use client")
            └─ src/state/store.tsx (GameProvider: save lifecycle, tick clock, queue)
                 ├─ onboarding → six-screen console (World/Territory/Studio/Boardroom/Diplomacy/GDD)
                 └─ src/app/api/{session,save,advisor}/route.ts  (Node runtime + SQLite)
```

Player input → typed `Action` → `reducer` (`src/game/engine.ts`) → `GameState` → views.
`store.tsx` owns the simulation interval (1 sim-hour per tick, 1,000 ms / speed) and
the save queue. The simulation is still **client-driven**: there is no server tick,
no offline catch-up, and no server-authoritative action validation.

Stack: Next.js 16.4.6 (App Router, Turbopack build), React 19.2.6, TypeScript 5.9.3
(strict), Tailwind CSS 4.3.5 via `@tailwindcss/postcss`, better-sqlite3 13.2.0,
Drizzle ORM 0.45.4 / drizzle-kit 0.31.11, Zod not required (hand-written validator).

## Find the right file

| Concern/change | Source |
| --- | --- |
| Domain entities, save shape, phases | `src/game/types.ts` |
| Actions, init/demo, tick, projects, trade | `src/game/engine.ts` |
| Costs, phases, catalogue, role prompts | `src/game/constants.ts` |
| Claim geometry, seeded helpers, road polylines | `src/game/geo.ts` |
| Row-major floor plans, stats, collision | `src/game/plans.ts` |
| City digest (shared client/server) | `src/game/digest.ts` |
| Local rule-based advisor (isomorphic) | `src/game/localAdvisor.ts` |
| Browser advisor transport → `/api/advisor` | `src/game/advisor.ts` |
| UI state, save lifecycle, tick gate | `src/state/store.tsx` |
| Serialized/coalesced autosave queue | `src/state/saveQueue.ts` |
| Browser save transport, legacy localStorage | `src/state/persistence.ts` |
| Save validation + secret stripping (isomorphic) | `src/server/gameSave.ts` |
| SQLite connection, migrations, saves | `src/server/db/{client,migrate,saves,schema}.ts` |
| Session cookie, CSRF, body caps, rate limits | `src/server/session.ts`, `src/server/config.ts` |
| Advisory prompt assembly / env allowlists | `src/server/ai/{prompt,config}.ts` |
| Shared-world roster, coarsening, publish copy | `src/game/world.ts` |
| Published-area registry (server-derived) | `src/server/db/world.ts`, `src/server/db/schema.ts` (`world_players`) |
| World routes | `src/app/api/world/{route,me/route,publish/route}.ts` |
| Screens, keyboard shortcuts, save badge | `src/components/GameShell.tsx`, `src/components/Shell.tsx` |
| Map / interiors / plan editor | `src/components/{WorldMap,Onboarding,BuildingScene,FloorPlanEditor,Studio}.tsx` |
| Board chat | `src/components/Boardroom.tsx` |
| In-app GDD, import/export, reset | `src/components/GDD.tsx` |

## Rendering boundaries

- Root layout is a server component and imports nothing browser-dependent.
- `page.tsx` is the only `next/dynamic(..., { ssr: false })` site; every component
  under `GameShell` declares `"use client"`.
- Leaflet (`WorldMap`, `Onboarding`) is imported inside client components only, and
  maps are created in `useEffect` with `map.remove()` cleanup so StrictMode's
  double-mount cannot produce duplicate maps.
- Three.js (`BuildingScene`) is imported inside the client `Studio` tree; renderer,
  geometries and listeners are disposed in the effect cleanup, pointer lock is
  released on unmount, and requestAnimationFrame is cancelled.
- Tailwind and `leaflet/dist/leaflet.css` are imported from `src/app/globals.css`, so
  assets load through the Next pipeline (no `index.html`, no single-file bundling).
- OSM tiles keep attribution in both map surfaces; attribution copy is unchanged.
- All browser API calls use relative paths (`/api/...`) with
  `credentials: "same-origin"`; nothing calls a sandbox-localhost backend.

## Persistence

See [PERSISTENCE.md](PERSISTENCE.md) for the full contract. Summary:

- `game_saves` holds one credential-free `GameState` JSON per player, with
  `revision` (optimistic concurrency), `schema_version`, `created_at`, `updated_at`.
- `players.id` = SHA-256 of the anonymous session cookie token; ownership is enforced
  in every SQL predicate and there is no id-taking parameter.
- Writes run inside a single IMMEDIATE transaction with a compare-and-set update;
  a stale `baseRevision` returns 409 and never overwrites.
- Validation rejects malformed saves before they can touch the row; legitimate
  edge states (debt, negative power demand, zero food) are explicitly allowed.
- `stripSecrets` removes `apiKey`/`baseUrl` from every persisted and exported save.

## Request trust

| Layer | Control |
| --- | --- |
| Identity | `HttpOnly` `SameSite=Lax` (Secure in production) random cookie; DB stores only its hash |
| CSRF | JSON content type required + `Origin` must equal `Host` + `Sec-Fetch-Site: same-origin` |
| Host spoofing | optional `SIMPLAYZ_ALLOWED_HOSTS`; Host/Origin must agree |
| Payload | 1.5 MB save cap, 32 KB advisor cap, checked via `Content-Length` and actual bytes |
| Errors | fixed envelopes; SQL/paths/stacks logged server-side only |
| AI | operator env credentials, endpoint+model allowlist, timeout, per-session rate limit, server-built digest |

Production hardening still required before public exposure: TLS termination,
`SIMPLAYZ_ALLOWED_HOSTS`, centralised rate limiting, log retention, and a decision
about whether a client-driven simulation is acceptable.

## Geography and remote requests

Leaflet uses `[lat, lng]` tuples and named `{lat, lng}` centers; GeoJSON would use
`[lng, lat]` and must convert at a named boundary. `claimCorners` is a local
small-angle approximation, not a cadastral grid. Independent player centers do not
guarantee non-overlapping claims. Roads are synthetic Manhattan-bend polylines, not
OSM routes. Tiles come from `tile.openstreetmap.org`; fonts from Google Fonts. Review
<https://operations.osmfoundation.org/policies/tiles/> and
<https://www.openstreetmap.org/copyright> before scale.

## AI boundary

`POST /api/advisor` → validate role/prompt/history limits → allowlist env check →
per-session rate limit → load **the caller's persisted save** and build the digest
server-side → `POST {SIMPLAYZ_AI_BASE_URL}/chat/completions` with the operator key
and a bounded `AbortSignal.timeout` → clip text to 2000 chars. Every failure path
returns `200` with server-composed local advice plus an error code. Provider text is
advisory only; it can never mutate game state.

## Shared world (presence only, implemented)

`src/app/api/world` returns published player areas plus a deterministic AI roster for a
bbox. Two players in different browsers therefore see each other, but **only presence
crosses the wire**: the registry stores an opt-in, 1/100°-coarsened outline derived
server-side from the caller's own save (never from a request body), and no simulation
state, economy or action is shared. Publishing is refreshed after an accepted save write
and deleted on opt-out or reset. `GameState` is untouched, so `schema 4` and both save
validators did not change; the AI roster depends only on `SIMPLAYZ_WORLD_SEED` and a coarse
cell grid, so every client sees the same simulated cast and panning never reshuffles it.
The prompt and review contract for this change is `docs/prompts/SHARED_WORLD.md`.

## Multiplayer direction (not implemented)

Persistence plus the published-area registry is still not a shared world: what exists is an
opt-in map of approximate outlines, not a shared simulation. A multiplayer request still needs
decisions on authority, identity/recovery, time progression, claim conflicts,
transaction atomicity and abuse limits. `RemoteCeo`, `netMode` and generated peer
plans remain prototype seams, not a network contract or authorization boundary.
The current server trusts the values inside a validated snapshot; it validates
*shape*, not *legality* of each economic transition.
