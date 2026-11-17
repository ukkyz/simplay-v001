# Persistence runbook — v1

Implemented 2026-11-17 on `arena/8af8e052-simplay` (base `1cfb21e`). Describes the
Next.js + SQLite persistence layer, not a shared world.

## Layers and version numbers

| Concern | Where | Current value |
| --- | --- | --- |
| Database schema version | `drizzle/000N_*.sql` + `__simplayz_migrations` ledger | `0000_init.sql` |
| Game-save schema version | `GameState.schema`, `GAME_SAVE_SCHEMA` | `4` |
| Save revision | `game_saves.revision` per player | starts at `1`, `+1` per accepted write |
| Legacy browser key | `simplayz.save.v4` in `localStorage` | read-only migration source |

They are independent on purpose: a save can be schema 4 at revision 87 while the
database is on migration 0003.

## Tables

```sql
players(id TEXT PRIMARY KEY, created_at INT, last_seen_at INT)
game_saves(player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
           schema_version INT, revision INT, state TEXT, created_at INT, updated_at INT)
```

`players.id` is the **SHA-256 of the anonymous session token**. The raw token only
lives in the `HttpOnly` cookie. A database dump therefore does not hand out usable
sessions, and there is no client-supplied save id anywhere in the API.

## Setup commands

```sh
npm ci
cp .env.example .env.local         # optional
npm run db:migrate                 # explicit path; also runs lazily on first request
npm run dev
```

`SIMPLAYZ_DB_PATH` defaults to `./data/simplayz.sqlite` relative to the process
cwd. Keep it outside `src/` and `public/`, and on a persistent volume in
deployment. `data/`, `backups/` and all `*.sqlite*` files are gitignored.

## Save lifecycle (client)

| State | Trigger | Player-visible |
| --- | --- | --- |
| booting → loading | first paint, session POST + save GET | "restoring your company…" |
| load-error | server unreachable | blocking screen with retry; nothing is overwritten |
| onboarding | no server save, no legacy blob | registration / demo |
| legacy-offer | legacy blob, no server save | one-time validated migration offer |
| legacy-conflict | legacy blob **and** server save | explicit choice; neither is modified first |
| ready | snapshot loaded/created | simulation ticks may run |
| conflict | 409 from the server | autosave paused, "load server version" / "keep this tab" |
| error (unsaved) | network/DB/validation failure | status badge, retained snapshot, retry, unload guard |

Simulation ticks do not start until `ready`, and never run behind onboarding, the
legacy choice or an unresolved conflict.

Autosave cadence: a coalesced queue keeps at most one write in flight, replacing
the old 700 ms debounce that accelerated play could starve. Under continuous play a
write is attempted at least every 4 s (inside the 5 s progress-loss budget).
Pausing, completing a significant action, import and legacy migration flush
immediately. `pagehide`/`visibilitychange` may fire a `keepalive` request; that is
best effort and is not a durability guarantee.

## API

All routes are `runtime = "nodejs"`, `Cache-Control: no-store`, and require the
anonymous session cookie. State-changing verbs require `Content-Type:
application/json`, a matching `Origin` (same-origin), and `Sec-Fetch-Site:
same-origin` when the browser sends it.

| Route | Body | Success | Errors |
| --- | --- | --- | --- |
| `POST /api/session` | `{}` | `201` + `Set-Cookie` (or `200` if already has one) | `403` cross-origin, `415` content type |
| `GET /api/session` | — | `{session, save:{revision,...} \| null}` | — |
| `GET /api/save` | — | `{save:{state,revision,schemaVersion,createdAt,updatedAt} \| null}` | `401` |
| `PUT /api/save` | `{baseRevision, state}` | `201` created / `200` updated + `{save:{revision,...}}` | `401`, `403`, `409` conflict, `413` body > 1.5 MB, `415`, `422` invalid, `503` storage |
| `DELETE /api/save` | — | `{deleted:boolean}` | `401`, `403` |
| `POST /api/advisor` | `{role, prompt, history[]}` | `200` live or local advice | `400`, `401`, `403`, `413`, `422`, `429` |

Error envelope: `{error:{code,message}}` / `{error:{code,message}, currentRevision}`
/ `{error:{code,message}, problems:[field paths]}`. Never SQL, table names,
filesystem paths, stack traces or credentials.

### Validation (server, `src/server/gameSave.ts`)

Structure, numeric bounds and entity references are checked before anything is
written: claim lat/lng ranges, economy bounds, plan `cells.length === w*h`, and
that every `site.buildingId`, `project.siteId`, `project.areaId` and
`project.buildingId` resolves. Legitimate states are explicitly allowed — zero
treasury, zero food/materials, low morale, over-capacity storage, large debts, and
**negative `powerDemanded`** (the engine can produce it when a generator archetype
is mid-build). Values are never silently re-clamped or rebalanced; a rejected
payload leaves the previous valid save in place. Optional advisor preferences are
the only normalized field, and credentials inside a payload are rejected outright.

## Reset semantics

`DELETE /api/save` removes **only the caller's** `game_saves` row. After a reset:

- the game returns to onboarding;
- advisor preferences (enabled/model/temperature) that lived in that save are gone;
- the `players` row (anonymous session) survives, so the same browser can register
  a new company; the legacy localStorage copy is cleared too;
- other sessions are untouched.

## Backup and restore

```sh
npm run db:backup                       # → backups/simplayz-<timestamp>.sqlite
npm run db:backup -- /mnt/backups/x.sqlite
```

The script uses better-sqlite3's online backup API (consistent snapshot of a live
WAL database) and then verifies `PRAGMA integrity_check` plus row counts on the
copy. Copying the database file by hand while the server runs is unsafe: recent
commits may still be in `-wal`.

Restore:

1. stop the Next.js process (single writer);
2. replace the database file with the backup;
3. delete stale `-wal` / `-shm` siblings;
4. `npm run db:migrate` (idempotent) and start the server.

## Known limitations

- Anonymous ownership only: clearing cookies/site data means losing the save unless
  it was exported. No accounts, recovery, or cross-device identity.
- One writer process; SQLite files on network filesystems are unsupported.
- Rate limiting is in-memory per process and resets on restart.
- `keepalive` unload writes can be dropped by the browser.
- The runtime still trusts the client snapshot's simulation values (client-driven
  simulation). Server-side action validation is required before any multiplayer.
