# Simplayz

A world-simulation web game about running a company on a real-world map: claim territory, commission buildings through an SDLC-style pipeline, balance resources, and consult an executive board.

**Product direction:** multiplayer on the same real-world geography using OpenStreetMap (OSM). **Current implementation:** a Next.js (App Router) single-server app with SQLite persistence. The simulation still runs in the browser; the server stores one anonymous player's snapshot at a time. There is no shared world, real human presence, or server-authoritative economy yet.

## Run locally

Use **Node.js 22.x** (verified on Node 22.22.3 / npm 10.9.8). Node 20.9+ satisfies Next.js 16, but this repo is only verified on 22. Dependencies are locked in `package-lock.json`.

```sh
npm ci                            # builds the better-sqlite3 native addon
# Behind a restrictive proxy/firewall where node-gyp cannot fetch Node headers:
#   npm ci --nodedir=/path/to/node-headers   (or your distro's node headers)

# SQLite lives outside src/public. Default: ./data/simplayz.sqlite
cp .env.example .env.local        # optional; defaults work out of the box
npm run db:migrate                # create/upgrade the schema (also runs on first request)

npm run dev                       # next dev, bound to 0.0.0.0:3000
```

Open `http://localhost:3000` or the Arena preview URL. The dev server accepts the
preview host `*.e2b.app` via `allowedDevOrigins` in `next.config.ts`; that list is
configurable with `SIMPLAYZ_DEV_ORIGINS` and is **dev-only** — production origin
checks are not disabled anywhere.

```sh
npm run typecheck     # tsc --noEmit (strict)
npm test              # node:test suites incl. real HTTP route + real SQLite tests
npm run build         # next build
npm run start         # next start, bound to 0.0.0.0:3000 (needs a prior build)
```

| Script | Purpose |
| --- | --- |
| `dev` | `next dev --hostname 0.0.0.0 --port 3000` |
| `build` | `next build` (Turbopack) |
| `start` | `next start --hostname 0.0.0.0 --port 3000` |
| `typecheck` | `tsc --noEmit` |
| `test` | Node test runner with `tsx`; runs `tests/*.test.ts` |
| `db:generate` | `drizzle-kit generate` → new SQL file in `drizzle/` |
| `db:migrate` | applies pending migrations from `drizzle/` |
| `db:backup` | consistent WAL-safe snapshot → `backups/simplayz-<ts>.sqlite` |

`better-sqlite3` is a native module: `npm ci` compiles it (needs Python 3, make and a
C++ toolchain) or downloads a prebuilt binary. If `node-gyp` cannot reach
`nodejs.org`, pass local headers with `npm ci --nodedir=/usr/local` — that is a
sandbox/network workaround, not a production step.

There is no lint script and no CI workflow (unchanged from before this migration);
`npm run typecheck` is the static gate.

Additional runnable checks (need a running server):

```sh
npx tsx scripts/smoke-http.ts                          # 11 HTTP checks on :3000
npx tsx scripts/smoke-http.ts http://localhost:3100     # or another port
SMOKE_EXPECT_TOKEN=<token> npx tsx scripts/smoke-http.ts # save survived a restart
```

## Environment variables

Copy `.env.example`; every value below is server-side. There are **no**
`NEXT_PUBLIC_*` variables and no browser-visible secrets.

| Name | Default | Meaning |
| --- | --- | --- |
| `SIMPLAYZ_DB_PATH` | `./data/simplayz.sqlite` | SQLite file (absolute path on a persistent volume in deployment) |
| `SIMPLAYZ_COOKIE_SECURE` | on in production | `Secure` flag on the anonymous-session cookie; set `false` only for plain-HTTP local dev |
| `SIMPLAYZ_ALLOWED_HOSTS` | unset (accept any) | Optional comma-separated Host allowlist; set it in production |
| `SIMPLAYZ_DB_MIGRATE` | `auto` | `manual` requires `npm run db:migrate` before serving |
| `SIMPLAYZ_DEV_ORIGINS` | `*.e2b.app` | Extra dev origins allowed to talk to `next dev` only |
| `SIMPLAYZ_AI_API_KEY` | unset | Enables the live executive advisor; unset ⇒ local advisor only |
| `SIMPLAYZ_AI_BASE_URL` | `https://api.openai.com/v1` | Must also appear in the allowlist |
| `SIMPLAYZ_AI_MODEL` | `gpt-4o-mini` | Must also appear in the allowlist |
| `SIMPLAYZ_AI_ALLOWED_BASE_URLS` | the OpenAI v1 URL | Comma-separated allowlist of provider endpoints |
| `SIMPLAYZ_AI_ALLOWED_MODELS` | `gpt-4o-mini` | Comma-separated allowlist of model ids |
| `SIMPLAYZ_AI_TIMEOUT_MS` | `12000` | Bounded upstream timeout (3–30 s) |
| `SIMPLAYZ_AI_RATE_LIMIT_PER_MINUTE` | `10` | Per-session advisor requests/min (in-memory, single process) |

## Persistence, saves and credentials

- Each browser gets an **opaque anonymous session cookie** (32 random bytes, `HttpOnly`, `SameSite=Lax`, `Secure` in production). Only the SHA-256 of the token is stored, as the player id.
- Progress is stored as a complete game snapshot in SQLite with `revision` (monotonic), `schema_version` (game-save shape, currently `4`) and `created_at` / `updated_at`. The database schema version is separate, tracked in `__simplayz_migrations`.
- Writes are **optimistic**: a stale `baseRevision` returns `409 revision_conflict` instead of overwriting newer progress. The client pauses autosave and offers "load server version" or "keep this tab".
- Autosave is a **serialized, coalesced queue**: one write in flight, a write attempted at least every 4 s during continuous 1×/4×/16× play (inside the 5 s progress-loss budget; far below one write per tick), immediate flush on pause/significant actions. `pagehide` saving is best effort only.
- **Clearing site data or the session cookie loses access to that save.** There is no account, email, OAuth or cross-device recovery. Export JSON if you need a portable copy.
- Legacy schema-4 saves under the `simplayz.save.v4` localStorage key are read (never deleted) and offered as a **one-time, validated migration**. If a server save already exists, the player explicitly chooses; legacy data is never uploaded automatically, and it is only removed after a server write is acknowledged. Old AI keys in that blob are dropped, never uploaded.
- **Reset** (GDD → Save) deletes only *your* server save row and clears the in-game advisor preferences that lived in it; the anonymous session row survives so you can register again. It is confirmation-gated and cannot be undone.
- Export/import JSON is validated structurally (schema, numeric bounds, entity references) before it can replace anything.

**Credentials.** The prototype stored per-exec API keys in game state, localStorage and exports. That is removed: game saves, API responses, exports and client bundles carry no `apiKey`/`baseUrl`. The optional live advisor is a server route (`POST /api/advisor`) that uses operator-owned environment credentials, an allowlisted endpoint/model, a bounded timeout and per-session rate limiting. With no provider configured, the grounded local rule-based advisor answers. Provider/model quality is **not** evaluated here.

## Deployment and backup

Single Node server + persistent local filesystem. **Not** for serverless/ephemeral
hosting — the SQLite file must survive restarts. One process (or at least one
writer) per database; multi-instance/HA SQLite is out of scope.

- WAL journal mode: readers never block the writer, and `-wal` / `-shm` files live next to the database.
- Back up with `npm run db:backup` (uses SQLite's online backup API). Do **not** copy the file mid-write and do not omit `-wal`.
- Restore: stop the server → replace the `.sqlite` file → delete stale `-wal`/`-shm` siblings → start the server (migrations are idempotent).
- These files, plus `data/`, `backups/` and `*.env`, are gitignored. Never commit player saves.

## What you can play today

- Register a CEO/company and select a location manually or with browser geolocation; alternatively load the demo.
- Manage an approximately 8 × 8 km claim, four resource sectors, five sites per sector, and 20 building archetypes.
- Commission projects: Discover → Design → Approve → Build → Test → Deploy → Operate.
- Edit 2D floor plans and inspect derived Three.js interiors.
- Balance credits, materials, food, power, storage, morale, and building condition.
- Consult CTO/CFO/COO advisors (local rules by default; optional server-configured model).
- Trade with simulated alliance bots and visit simulated neighboring CEOs.
- Use keys 1–6 to switch screens; control time at pause/1×/4×/16×.

**Not implemented:** accounts/OAuth/recovery, shared worlds, cross-player claim conflicts,
authoritative server simulation or offline progression, real human presence, OSM-way
routing, multi-instance deployment. `netMode: "live"` is a type option, not a transport.
Simulated peers remain labeled simulated.

## Documentation

| File | Use |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Agent start point, boundaries, change workflow, definition of done |
| [Architecture](docs/ARCHITECTURE.md) | Source map, request trust, persistence, map/network seams |
| [Persistence runbook](docs/PERSISTENCE.md) | Schema, migrations, save lifecycle, conflict/reset, backup/restore |
| [Systems reference](docs/GAME_DESIGN.md) | v1.0 current mechanics, player choices, balance rules |
| [Known gaps and decisions](docs/DECISIONS.md) | Risks, unresolved product questions, source inconsistencies |
| [Validation](docs/TESTING.md) | Verified baseline and reproducible manual/regression checks |
| [Advisor prompt contract](docs/prompts/ADVISOR_PROMPT.md) | Prompt v2 output contract, success criteria, three test cases |
| [Arena change-request prompt](docs/prompts/CHANGE_REQUEST.md) | Copyable migration prompt |
| [Ally areas prompt](docs/prompts/ALLY_AREAS.md) | Proposed v1 prompt + review contract for ally autonomy and read-only 3D parcel tours |
| [Changelog](CHANGELOG.md) | Repository revisions |

## Contributing

Follow [AGENTS.md](AGENTS.md). Keep changes scoped, state acceptance criteria before implementation, preserve saves or supply an explicit migration/reset policy, and report actual checks separately from untested claims. No project license file currently exists; dependency licenses and OSM data/tile obligations are separate concerns. Review applicable OSM attribution and tile-service policies before production distribution.
