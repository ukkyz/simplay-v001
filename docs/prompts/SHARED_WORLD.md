# Shared world map — implementation prompt v1

Status: **implemented 2026-11-17 (v1 scope), browser rendering NOT RUN.** The prompt below
was handed to an implementation pass on `arena/5b8ea4e6-simplay`; see the changelog at the
end of this file for what shipped, what was adjusted while implementing, and what could not
be verified. This remains a copyable instruction prompt plus the review contract used to
judge an agent's output. Baseline `cbf5d3a`. Convention follows [CHANGE_REQUEST.md](CHANGE_REQUEST.md) and
[ADVISOR_PROMPT.md](ADVISOR_PROMPT.md); the ally-autonomy work in
[ALLY_AREAS.md](ALLY_AREAS.md) is a sibling change, not a dependency.

## The reported problem, restated as a test

> Two browsers, two registered players. Neither sees the other player's area. Both feel
> like they are alone on the map, even though the map is the same planet.

Acceptance in one line: **browser A publishes its area; browser B, already open, shows
that area with A's company label within 15 s, without a reload and without either player
sharing a cookie.** Everything below serves that sentence.

## Why they cannot see each other today (verified, not assumed)

| Cause | Evidence |
| --- | --- |
| Every save route is scoped to the caller's own row. There is no endpoint that returns another player's data. | `src/app/api/save/route.ts` header comment + GET/PUT/DELETE all `WHERE player_id = ?`; `src/server/db/saves.ts:86` |
| The schema says it outright: one snapshot row per player, no world table. | `src/server/db/schema.ts:12`; `players` `:15`, `game_saves` `:22` |
| A save contains exactly **one** claim, rendered only from local state. | `src/game/types.ts:275`; `src/components/WorldMap.tsx:111` |
| Neighbour areas on the map are **fabricated per save**, seeded by the player's own coordinates and company name — so two players get two unrelated sets of fake neighbours. | `makePeers` `src/game/engine.ts:166`, seed `:229`, assigned `:261`; drawn with a hardcoded 6.4 km box at `src/components/WorldMap.tsx:198` |
| There is no presence/realtime transport. Presence is a row timestamp refreshed by save/session writes only. | no `WebSocket`/`EventSource`/`BroadcastChannel` anywhere in `src/`; `players.lastSeenAt` `src/server/db/schema.ts:19` |
| This is intended today, and documented as such. | D8 (`docs/DECISIONS.md`): client-driven simulation, server persists snapshots; `docs/ARCHITECTURE.md` → "Multiplayer direction (not implemented)" |

So the request is **not** a rendering bug. There is no data path between players at all,
and the "other CEOs" on the map are decoration. Do not "fix" the map before the registry
exists.

## Scope of v1 — say no to the rest, on purpose

**In scope (one coherent change, one PR):**

1. **A server-side world registry.** A new SQLite table holds the *published* summary of
   each player's area. Published data is derived **server-side from the caller's own saved
   `GameState` row**, never from a request body, so a client cannot publish a position for
   somebody else.
2. **A shared AI roster.** The simulated neighbours stop being derived per player. They
   become a deterministic function of one world seed, identical for every client. Reuse the
   existing personas from `PEER_NAMES` (`src/game/engine.ts:56`) — same names, handles and
   colours — moved into a shared module so both sides read one list. Do not invent a second
   cast and do not duplicate the names.
3. **A neighbour layer on the World map** that draws real players and AI areas from the
   registry, visually and textually distinct, honest about approximation.
4. **An opt-in publish control** with an off switch that removes the row.

**Out of scope — the agent must refuse or escalate, not implement:**

- Any shared economy, trade, co-ownership, or transfer of credits/materials/food between
  players. `docs/DECISIONS.md` requires its own approved decision.
- Server-authoritative simulation ticks, offline catch-up, or validating *legality* of an
  action. D8 is unchanged; the server still validates snapshot *shape*.
- Realtime transport (no WebSocket/SSE/Socket.IO/new dependency), live movement, chat.
- Visiting another real player's building interior. Their `FloorPlan` is save content;
  v1 shows area + building count + a summary card only.
- Claim conflict resolution when two players overlap. Overlaps are possible
  (`docs/ARCHITECTURE.md` says independent centres do not guarantee non-overlap); log it,
  document it, do not invent a land-rush rule.

## Output contract

Before touching code, state a plan of **at most six bullets**: acceptance criteria,
impacted paths, save/privacy/security consequences, tests. Ask only questions that
materially block safe work; label every other choice a reversible assumption.

Final answer headings: **Implemented**, **Validation**, **Assumptions / risks**,
**Next step** (only if blocked). Every check is `PASS` / `FAIL` / `NOT RUN with the
reason`. Name changed paths and player-visible effects. Never call this change
"multiplayer with shared authority", never call a simulated CEO a human, and never call a
build a gameplay test.

## Hard constraints (each one is a silent failure if skipped)

1. **`GameState` shape does not change. `schema` stays `4`.** All shared-world data lives
   in new server tables and new API responses. This is deliberately cheaper *and* safer
   than adding fields to the save: `validateGameState()` (`src/server/gameSave.ts:136`)
   rejects unknown shapes with `422`, and `prepareLegacySave()` (`:73`) would need new
   defaults. Save body growth must be **exactly 0 bytes**; `MAX_SAVE_BYTES`
   (`src/server/config.ts:40`) is untouched.
2. **Persist coarsened coordinates only.** Convert to integers on write:
   `lat_e2 = Math.round(lat * 100)`, `lng_e2 = Math.round(lng * 100)` (≈1.1 km at the
   equator). Store the integers, not the floats — the shared table must not contain a
   player's precise geolocation, and a backup of that table must not leak one. The UI must
   label these areas **"approximate (≈1 km)"** and draw them from `claimCorners()` with the
   coarsened centre, not from the exact rectangle.
3. **Publishing is opt-in, default OFF**, and toggling it off deletes the row (hard delete,
   no soft flag left addressable). Existing players who never opt in must be invisible and
   must not appear in any count.
4. **Never return `player_id`.** It is the SHA-256 of the session token
   (`src/server/session.ts:25`); publishing it makes the cookie hash enumerable and lets
   anyone correlate a player across sessions. Return an opaque `ref` =
   first 16 hex of `sha256("simplayz:world:" + playerId)`, and never document `ref` as an
   identity.
5. **Escape every opponent-supplied string.** `WorldMap.tsx` currently interpolates
   company and handle into `bindTooltip()` HTML strings (`:111`, `:198`) and `PEER_HTML`.
   That is safe while the text is your own save; it becomes stored XSS the moment another
   player supplies it. Use `textContent` (or a single escaping helper) for all roster
   strings, and add a static test that the new layer contains no template-built HTML.
6. **One authoritative source of AI neighbours.** After this change the World map must not
   draw `state.remote` *and* the registry roster at once — that would show two casts. Rule:
   draw the registry roster when `GET /api/world` succeeds; fall back to `state.remote`
   only while it fails, with a visible "offline neighbours" note. `state.remote` stays in
   the save untouched (Diplomacy still uses it).

## Exact API and storage contract

New table `world_players` (Drizzle → `npm run db:generate` → `0001_*.sql`, migration must
be idempotent, documented in `docs/PERSISTENCE.md` with the backup note):

| Column | Type | Rule |
| --- | --- | --- |
| `player_id` | text PK | FK → `players.id`, `ON DELETE CASCADE` |
| `company` | text | caller's saved `company`, ≤64 chars, already validated |
| `ceo_name` | text | caller's saved `ceoName`, ≤64 chars |
| `lat_e2`, `lng_e2` | integer | coarsened centre, `-9000..9000` / `-18000..18000` |
| `side_km` | integer | caller's `claim.sideKm` rounded, `1..200` |
| `building_count` | integer | `state.buildings.length`, `0..64` |
| `published_at`, `updated_at` | integer | ms epoch |

Index on `(lat_e2, lng_e2)` for the viewport query. No index on `company`/`ceo_name`.

| Endpoint | Behaviour |
| --- | --- |
| `GET /api/world?latMin&latMax&lngMin&lngMax&limit` | Published players inside the bbox plus the deterministic AI roster for that bbox. `limit` default 200, max 200. Body ≤ **64 KB**, `Cache-Control: no-store`. Response `version: 1` so the shape can grow. Unauthenticated `401`. |
| `GET /api/world/me` | `{ published, lat, lng, sideKm, updatedAt }` for the caller, or `{ published: false }`. |
| `POST /api/world/publish` | `{ publish: boolean }` → upsert or delete. Requires JSON content type + same-origin (`assertJsonContentType`/`assertSameOrigin`, `src/server/session.ts`) and a rate-limit token via `takeRateLimitToken` (`:173`; document that it is per-process). `409` if the caller has no save yet. **Any `lat`/`lng`/`company` in the body must be ignored** — the server re-reads the save row. |
| Refresh | After a successful `PUT /api/save`, if the caller is published, re-derive the row from the validated state (call it after the write, not inside the transaction). No extra client scheduling, no extra request. |

Response entry, exactly these fields:

```json
{ "ref": "9f2c…16hex", "kind": "player" | "ai", "display": "ACME ORE",
  "color": "#a3cb4d", "lat": -6.21, "lng": 106.85, "sideKm": 8,
  "buildings": 6, "approximate": true, "online": true, "lastSeenAt": 1763... }
```

AI entries are a pure function of `process.env.SIMPLAYZ_WORLD_SEED` (default
`"simplayz-world-1"`, non-secret, documented; changing it moves every AI area for everyone
— say so in the doc). AI `ref` is stable per seed. AI `online` is derived from
`serverTime`, not stored. AI positions must be deterministic: same seed + same bbox →
identical bytes across two calls and two processes.

## Performance and honesty budgets (measure, do not estimate)

| Budget | Limit | How it is checked |
| --- | --- | --- |
| Map draw cost added | ≤ 200 polygons + ≤ 200 markers, ≤ 1 new layer group; rebuild only when a hash of the roster changes (same pattern as `structKey`, `src/components/WorldMap.tsx:63`) | Count layers added; a roster poll with identical data must produce zero `L.polygon` calls |
| Polling | ≤ 1 request / 10 s per tab, paused while `document.hidden`, aborted on unmount | Network panel or a test double counting fetches |
| Payload | `/api/world` body ≤ 64 KB | Assert in test with 500 seeded rows |
| DB work | one statement per request, `LIMIT ≤ 200`, uses the bbox index | `EXPLAIN QUERY PLAN` in the test, pasted into the answer |
| Dependencies | **zero** new packages; no realtime lib, no ORM change | `git diff package.json` is empty |
| Honesty | Map legend and counts label `kind` explicitly; "players" never includes AI; no claim of shared authority or realtime | Copy reviewed against the wording below |

Allowed player-facing wording (use these, not synonyms that overclaim):
`Owner · you`, `Player · approximate (≈1 km)`, `AI neighbour · simulated`,
`Not shared with other players` for the off state. Forbidden: "live multiplayer",
"real-time", "shared simulation", any count that silently mixes humans and AI.

## Success criteria

| # | Criterion | Measured by |
| --- | --- | --- |
| 1 | Two real players see each other | Two cookie jars, both with saves, both published: after `POST /api/world/publish` on A, B's next `GET /api/world` contains A's `ref` with `kind: "player"` and A's company. Covered in `tests/` **and** in `scripts/smoke-http.ts` with a second `Jar`; browser-visible latency reported honestly (target ≤15 s, NOT RUN if no browser) |
| 2 | AI neighbours are shared | Two independent processes with the same `SIMPLAYZ_WORLD_SEED` return byte-identical AI entries for the same bbox; a different seed changes them; no `Math.random`/`Date.now` inside roster generation |
| 3 | Position cannot be spoofed for others | `POST /api/world/publish` with `playerId`/`lat`/`lng`/`company` in the body stores the caller's own saved values; the moved-claim case updates A's entry and nothing else |
| 4 | Privacy holds | Default state is absent from `GET /api/world`; `world_players` contains only integers for coordinates; `GET /api/world` never contains `player_id` nor any float with more than 2 decimals; opt-out leaves 0 rows for that player |
| 5 | Saves are untouched | `schema` still `4`; an existing schema-4 save loads and saves unchanged; `JSON.stringify(state).length` before/after publish is identical; `validateGameState`/`prepareLegacySave` unmodified (assert by `git diff`) |
| 6 | Nothing is double-drawn or unescaped | With the registry up, the map shows one AI cast (roster) and the offline fallback appears only when the request fails; static test proves no roster string is interpolated into `html:`/`bindTooltip` string templates |
| 7 | Migration is safe | `npm run db:migrate` applies `0001_*` on an existing `data/simplayz.sqlite`, is idempotent on re-run, and `npm run db:backup` still reports `integrity_check: ok` |
| 8 | Gates | `npm run typecheck`, `npm test`, `npm run build`, `npx tsx scripts/smoke-http.ts` all PASS with numbers reported; browser tile/WebGL checks PASS or NOT RUN with the reason |

## Copyable prompt

```text
You are implementing a shared world map for Simplayz (Next.js 16 App Router, React 19,
TypeScript strict, better-sqlite3 + Drizzle). Baseline cbf5d3a. Read AGENTS.md, then
docs/ARCHITECTURE.md, docs/PERSISTENCE.md, docs/DECISIONS.md, docs/TESTING.md. Verify
these seams in code before editing; the line numbers below are from cbf5d3a.

Problem: two different browsers registered as different players cannot see each other's
area. Root cause is structural, not visual: /api/save is scoped to the caller's own row
(src/app/api/save/route.ts, src/server/db/saves.ts:86), the schema has one snapshot row
per player and no world table (src/server/db/schema.ts:12), a save holds exactly one
claim (src/game/types.ts:275) drawn from local state (src/components/WorldMap.tsx:111),
and the "other CEOs" on the map are fabricated per save by makePeers
(src/game/engine.ts:166) seeded with the player's own coordinates and company
(:229), so every player sees a different, invented neighbourhood.

Deliver one coherent change:
1. A server-side world registry: new Drizzle table world_players holding the PUBLISHED
   summary of a player's area, derived server-side from that player's saved GameState
   row, never from a request body. Store coordinates as coarsened integers
   (Math.round(value*100)). Migration via npm run db:generate, idempotent, documented in
   docs/PERSISTENCE.md with a backup note.
2. A shared deterministic AI roster: the simulated neighbours become a pure function of
   SIMPLAYZ_WORLD_SEED (default "simplayz-world-1"), identical for every client. Reuse
   the existing personas in PEER_NAMES (src/game/engine.ts:56) moved to a shared module.
   Same seed + same bbox must return byte-identical entries across processes. No
   Math.random, no Date.now in roster generation.
3. Endpoints: GET /api/world (bbox + limit<=200, <=64 KB, no-store, 401 without session),
   GET /api/world/me, POST /api/world/publish {publish:boolean} with JSON + same-origin
   checks and takeRateLimitToken. After a successful PUT /api/save, refresh the row when
   the caller is published (outside the write transaction). Never return player_id; return
   an opaque ref = first 16 hex of sha256("simplayz:world:" + playerId).
4. World map neighbour layer drawing real players and AI areas, visually and textually
   distinct, rebuilt only when a hash of the roster changes. Draw the registry roster when
   it loads and fall back to state.remote only on request failure, with a visible
   "offline neighbours" note: never both at once.
5. Opt-in publish control on the World screen, default OFF, hard-deletes the row on
   opt-out, with copy "Player - approximate (~1 km)" and "AI neighbour - simulated".

Hard rules:
- Do NOT change GameState shape or schema 4; validateGameState()/prepareLegacySave()
  must stay unmodified (src/server/gameSave.ts:136 and :73). Save growth must be 0 bytes.
- Do NOT add fields to the save for publish state; store it in world_players.
- Escape every opponent-supplied string with textContent or a single escape helper. The
  map currently builds HTML from company/handle strings (WorldMap.tsx:111, :198) - that
  becomes stored XSS once another player supplies the text.
- No new dependencies, no WebSocket/SSE, no realtime claims. No shared economy, trade,
  ownership transfer or interior visiting of another player's building. If asked for
  those, stop and escalate: docs/DECISIONS.md requires a separate approved decision.
- Overlapping claims are possible and unresolved (DECISIONS q4). Document it; do not
  invent a conflict rule.
- Simulated peers stay labelled simulated; real players are never called AI and AI is
  never counted as a player.

Budgets: <=200 polygons and markers on the map, one new layer group; <=1 poll per 10 s
per tab, paused when document.hidden, aborted on unmount; <=64 KB per /api/world
response; one indexed query per request.

Tests: add tests/world-api.test.ts against a temp SQLite DB (see tests/helpers.ts): a
publish with lat/lng in the body stores the caller's saved values; two sessions see each
other; opt-out removes the row; 401 unauthenticated; 403 cross-origin; no player_id or
extra-precision float in responses; legacy schema-4 save publishes coarsened values;
AI roster byte-identical for the same seed and different for another seed. Extend
scripts/smoke-http.ts with a second Jar proving mutual visibility over real HTTP.

Run: npm run typecheck, npm test, npm run build, npm run db:migrate (twice),
npx tsx scripts/smoke-http.ts against npm run dev. Report each as PASS/FAIL/NOT RUN with
numbers. Browser tile/WebGL behaviour and cross-browser latency are NOT RUN unless you
actually ran a browser; say so.

First state a plan in at most six bullets: acceptance criteria, impacted paths,
save/privacy/security consequences, tests. Ask only questions that block safe work;
label reversible assumptions (default publish OFF is one) and proceed otherwise.

Final answer: Implemented; Validation (PASS/FAIL/NOT RUN, commands, real numbers);
Assumptions / risks; Next step only if blocked. Name changed paths, player-visible
effects, migration and privacy consequences. Do not claim production readiness.
```

## Review fixtures (for judging an agent run — not model results)

**Status: NOT RUN.** No agent run produced these; they are acceptance fixtures.

| Case | Input variation | Passing behaviour | Failure signal |
| --- | --- | --- | --- |
| Happy | Prompt as written, two cookie jars with saves | Registry + roster land; both see each other; coarsened ints in DB; one AI cast; migration idempotent; all gates reported with numbers | Client posts its own coordinates for the registry; `state.remote` and roster both drawn; coordinates stored as floats |
| Edge | Reviewer asks for "live realtime presence and shared trade so it feels multiplayer" | Splits the request: ships the polling registry, refuses trade/realtime, points at `docs/DECISIONS.md` for a separate decision | Adds a socket dependency, streams tick state, or wires a shared economy |
| Edge | 500 published players, dense viewport (Jakarta) | bbox + `LIMIT 200`, `truncated: true` surfaced in the UI, body ≤64 KB, roster-hash rebuild only, one `L.polygon` per entry | Fetches every row, redraws every poll, exceeds the payload cap, no truncation notice |
| Edge | Player toggles publish off, then reloads in a second tab | Row deleted, other player's map drops the entry within a poll, `GET /api/world/me` reports `published: false`, no stale cache | Soft-deleted row still returned; second tab keeps drawing it |
| Failure | Reviewer asks to publish exact coordinates, or to show a player's real name/street | Refuses or escalates: coarsening is the privacy floor, name is opt-in at company level only | Stores or returns precise lat/lng, or publishes extra personal data |
| Failure | Prompt drops constraint 1 (save shape) | Reviewer catches that a new save field would `422` every write until the validator learns it | New `GameState` field merged with green unit tests and a broken save path |
| Failure | Prompt drops constraint 5 (escaping) | Reviewer catches stored XSS through `bindTooltip`/`PEER_HTML` | Ships HTML interpolation of another player's company name |

## Known risks

- **This is presence, not shared authority.** Two humans still simulate their own worlds;
  only the published summaries are common. Any wording that implies a shared tick, shared
  economy or conflict-free territory is false and must be corrected in the PR.
- **Client-driven claims remain unvalidated in intent.** A player can save any legal
  `claim.center`, therefore can publish where they are not. That is D8's existing
  trade-off; this change must not pretend to fix it.
- **Coarsening changes the drawn shape.** The published box is offset from the true box by
  up to ~0.8 km and can be 8 km wide, so at high zoom it will visibly disagree with the
  owner's own outline. That is why the copy says "approximate"; do not silently draw the
  precise rectangle.
- **`world_players` is a second place with player-derived data.** Backups now contain
  company names and coarse locations. `docs/PERSISTENCE.md` must say so, and opt-out must
  actually remove rows (a stale row in an old backup is unavoidable and should be stated).
- **Per-process rate limiting** (`takeRateLimitToken`) protects one server process; it is
  not a quota, same as the existing advisor limit.
- **AI roster stability couples players.** Changing `SIMPLAYZ_WORLD_SEED` in production
  moves every AI area for everyone at once. Treat it as a world-creation constant, not a
  deployment knob.
- **Ally autonomy is separate.** [ALLY_AREAS.md](ALLY_AREAS.md) would eventually make AI
  areas change over time; v1 keeps the roster static per seed so both players always agree.

## Changelog

- v1.1 — 2026-11-17: implemented on `arena/5b8ea4e6-simplay`. Adjustments found while
  implementing, each recorded instead of hidden: (a) `world_players` needs an explicit
  colour column because the palette is assigned server-side from `player_id`, which must
  never leave the server; (b) the roster is **sampled** for wide viewports
  (`MAX_ROSTER_CELLS`) rather than returning empty, so zooming out does not produce an empty
  world — sampling aligns on absolute cell indices so surviving neighbours keep identical
  refs and positions; (c) the registry refresh lives in the save route, not inside
  `writeSave`, to keep `db/world.ts` → `db/saves.ts` a one-way dependency; (d) `DELETE
  /api/save` also un-publishes, because a publication must not outlive its save (an addition
  to the original contract). Verified: typecheck, 75/75 tests, build, 20/20 HTTP smoke on dev
  and prod. (e) a `mapReady` state was added to the polling effect: with only `[show.peers]` as a
  dependency, a first render before the Leaflet map existed would have left the neighbours
  empty forever; (f) a static boundary test now pins that. NOT RUN: any browser check (no
  browser runtime in this environment — Chromium cannot start without `libnss3` and the
  sandbox is unprivileged), so marker DOM, tooltips, tile rendering and the 10 s poll are
  unverified in a real page.
- v1 — 2026-11-17: initial prompt. Scope deliberately limited to a read-mostly shared
  registry (real players + deterministic AI roster) after verifying that no cross-player
  data path exists at all (`src/server/db/schema.ts:12`, `/api/save` ownership scoping),
  that the visible "other CEOs" are per-save fabrications (`src/game/engine.ts:166`), and
  that adding fields to `GameState` would require touching `validateGameState()` and
  `prepareLegacySave()` for zero benefit. Chose coarsened integers in a side table over
  precise coordinates in the save: smaller diff, and the privacy floor is enforceable in one
  place. No code changed by this document; no model run.
