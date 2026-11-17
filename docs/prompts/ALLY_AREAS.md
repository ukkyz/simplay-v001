# Ally autonomy + 3D ally tour — implementation prompt v1

Status: **proposed, not executed.** Nothing in this document has been implemented; it is a
copyable instruction prompt plus the review contract used to judge the result. Baseline
`1696de2` (Next.js + SQLite migration merged). Convention follows
[CHANGE_REQUEST.md](CHANGE_REQUEST.md) and [ADVISOR_PROMPT.md](ADVISOR_PROMPT.md).

Purpose: give an agentic coding AI a prompt small enough to follow precisely, while keeping
the three constraints whose omission would be silently destructive in *this* codebase:

1. **The save validator must learn the new fields.** `validateGameState()`
   (`src/server/gameSave.ts:136`) rejects unknown-shaped saves with `422`, and
   `prepareLegacySave()` (`:73`) must default the fields for existing rows. Skip this and
   every new save stops persisting, with the last valid save frozen in place.
2. **New simulation code must be seeded.** Existing ticks lean on `Math.random`/`Date.now`
   (`src/game/engine.ts`), which `AGENTS.md` explicitly says not to extend: control RNG for
   reproducible tests.
3. **Read-only must be enforced in the reducer, not the UI.** Hiding buttons leaves
   `updatePlan` / `maintain` / `cancelProject` reachable through the action contract.

## What already exists (verify before coding)

The 3D visit seam is real and should be reused, not duplicated:

| Fact | Where |
| --- | --- |
| UI-only `ui.visit` target (`{ownerName, buildingName, planId}`), never persisted | `src/state/store.tsx:56` |
| `resolveTarget()` returns `readOnly: true` for a visited peer building, routing to `BuildingScene` | `src/components/Studio.tsx:582` |
| One `THREE.WebGLRenderer` per mounted scene, disposed on unmount, pointer lock released | `src/components/BuildingScene.tsx:120` |
| Visit entry points today: remote-CEO cards | `src/components/Diplomacy.tsx:155`, `Studio.tsx:551` |
| `AllianceBot` has **no** area or structures — only purse/relation/prices | `src/game/types.ts:172` |
| Plan helpers available for reuse (`generatePlan`, `blankPlan`, `clonePlan`, `planStats`) | `src/game/plans.ts:199` |
| Deterministic helpers (`mulberry32`, `hashString`) | `src/game/geo.ts:66`,`:77` |
| Save body cap 1.5 MB, advisor/save routes on Node runtime | `src/server/config.ts`, `src/app/api/save/route.ts` |

Gap to close: today's tour is per-building and covers `state.remote`. The request needs a
per-ally **parcel** with several buildings, walkable between them, for `state.alliance`.

## Output contract

The agent's final answer uses four headings — **Implemented**, **Validation**,
**Assumptions / risks**, **Next step** — preceded by a plan of at most six bullets. Every
check is reported as PASS / FAIL / **NOT RUN with a reason**. Changed paths and
player-visible effects are named. No invented test results, no claim that simulated allies
are human players, no claim that this is multiplayer.

## Success criteria

| # | Criterion | Measured by |
| --- | --- | --- |
| 1 | Allies visibly develop their parcel over time | After 72 sim-hours at 16×, each ally has ≥1 new structure and ≥1 log line; player `credits`/`materials`/`food` delta attributable to ally activity is exactly 0 |
| 2 | Ally growth is reproducible | Same `GameState` + same tick count → byte-identical ally structure lists across two runs; no `Math.random`/`Date.now` in `src/game/allies.ts` |
| 3 | Parcel tour is navigable and read-only | Opens from both entry points; walk between two structures, enter one interior, exit; `updatePlan`/`startProject`/`maintain`/`cancelProject` aimed at an ally id leave `GameState` unchanged |
| 4 | No renderer or listener leak | 5× enter/exit leaves exactly one canvas; `renderer.info.memory` stays flat; window listeners and `requestAnimationFrame` return to baseline |
| 5 | Saves stay compatible and bounded | Legacy schema-4 save without ally data loads with defaults; ally data round-trips through `validateGameState`; malformed ally data → `422` with the previous save intact; snapshot growth ≤ **+60 KB** and still far below the 1.5 MB cap |
| 6 | Gates green | `npm run typecheck`, `npm test`, `npm run build`, `npx tsx scripts/smoke-http.ts` PASS; browser-only tour checks PASS or NOT RUN with reason |

## Copyable prompt

```text
Repo: ukkyz/simplay — Next.js 16 App Router, React 19, Three.js, SQLite snapshots.
Read AGENTS.md and docs/{ARCHITECTURE,PERSISTENCE,GAME_DESIGN,TESTING}.md first (plus
docs/prompts/ALLY_AREAS.md), inspect the current code, work on the current branch, and
do not commit/push/PR unless asked.

Player problem: the two alliance partners are inert trade desks. Each ally should visibly
develop its own parcel over time, and the player should be able to walk that parcel in 3D
as a read-only guest.

1. DATA — extend AllianceBot (src/game/types.ts) with
   area { center{lat,lng}, cornerRadiusKm, sites[], structures[] },
   structures[] = { id, siteId, archetypeId, plan, level, condition, builtTick }.
   Caps: <=6 sites, <=4 structures, plan <=16x16 cells, 1 storey. Keep schema: 4.
   Update validateGameState() and prepareLegacySave() in src/server/gameSave.ts: bounds,
   reference integrity (siteId/plan.id resolve, plan.cells.length === w*h), and safe
   defaults for saves written before this change. No new tables, no new dependencies.

2. MANAGER — add src/game/allies.ts: pure and seeded
   (mulberry32(hashString(`${bot.id}:${tick}`))), no Math.random/Date.now, no mutation of
   arguments. Call it from tick() in src/game/engine.ts at most once per 4 sim-hours per
   ally, one action per call, chosen from exactly: build on a free site, upgrade (level<=3),
   repair (condition<50), restock inventory. Ally spending never touches the player's
   credits/materials/food. At most one log line per ally per 24 sim-hours.

3. TOUR — reuse the existing visit seam; do not add a second 3D route.
   - Extend the UI-only target in src/state/store.tsx (ui.visit) to also address an ally
     parcel, and extend resolveTarget() in src/components/Studio.tsx (currently
     peer-building visits only, readOnly: true) to return an ally parcel target.
   - Parcel view: the ally's plot with its structures; WASD + drag look to walk between
     them; E enters a structure interior through the existing BuildingScene; Esc returns
     to the parcel, then exits to Diplomacy. Geometry comes from the persisted plans —
     never regenerated at mount.
   - Read-only: the reducer must no-op updatePlan/startProject/maintain/cancelProject when
     the target id belongs to an ally. Keep FloorPlanEditor readOnly.
   - Entry points: "Tour their parcel" on the ally card (src/components/Diplomacy.tsx) and
     on the ally marker (src/components/WorldMap.tsx).
   - One WebGLRenderer at a time, StrictMode-safe disposal of geometries/materials/textures,
     pointer lock released on exit.

4. BUDGET — <=150 draw calls and <=60k visible triangles for the parcel view, one
   shadow-casting light (map <=1024, disabled below 720p), devicePixelRatio capped at 2,
   instanced repeated props, zero per-frame allocations, and never two live WebGL contexts.
   Measure with renderer.info and report the actual numbers; do not estimate.

5. TESTS — add tests/allies-manager.test.ts (determinism across two runs, caps enforced,
   player economy delta exactly 0 over 200 ticks, one action per 4 sim-hours) and
   tests/ally-save.test.ts (ally data round-trips through validateGameState; legacy
   schema-4 save without ally data still loads; malformed ally data => 422 with the
   previous save intact; JSON growth <= 60 KB), and extend
   tests/client-boundary.test.ts with reducer no-op guards for ally ids plus a single
   WebGLRenderer construction site. Run npm run typecheck, npm test, npm run build and
   npx tsx scripts/smoke-http.ts against a running server.

6. DOCS — README, docs/ARCHITECTURE.md, one GAME_DESIGN mechanic-contract row (purpose,
   player decision, inputs, outputs, edge/failure, acceptance), docs/DECISIONS.md,
   CHANGELOG, and the in-app GDD text that currently describes allies as trade-only.
   Bump doc versions. Do not edit docs/prompts/ALLY_AREAS.md's revision log.

Do NOT change: trade pricing/cooldowns/caps, archetype catalogue numbers, costs or
durations, claim geometry, OSM attribution, existing visual tokens, or the save schema
number. Do not refactor existing Math.random/Date.now usage outside the new module.

If a constraint cannot be met (for example save growth exceeds the budget, or the tour
needs a second renderer), stop and report the conflict instead of trimming validation,
relaxing the read-only guard, or raising the save cap.

Answer with: Plan (<=6 bullets) -> Implemented (paths + player-visible changes) ->
Validation (PASS/FAIL/NOT RUN with the command used) -> Assumptions/risks -> Next step
only if blocked.
```

## Review fixtures (for judging an agent run — not model results)

**Status: NOT RUN.** No agent run was executed to produce these; they are the acceptance
fixtures to apply, not evidence.

| Case | Input variation | Passing behaviour | Failure signal |
| --- | --- | --- | --- |
| Happy | Prompt as written | Ally data added with caps; seeded manager; parcel tour reuses `BuildingScene`; validator + legacy defaults; four gates green with real numbers reported | Builds a second renderer/route; omits `prepareLegacySave`; reports budget without `renderer.info` numbers |
| Edge | Reviewer asks to raise the cap to 8 structures × 32×32 plans "for visual density" | Computes JSON growth, notes the 1.5 MB body cap and read-path cost, proposes ≤4×16×16 or asks for a decision | Silently raises caps or the save-body limit; ships without the growth measurement |
| Edge | Legacy save + existing local tour state both present | Old save loads with ally defaults; `ui.visit` stays UI-only and never persisted | Persists tour state; rewrites cluster/blocks the old save |
| Failure | Reviewer asks allies to "spend the player's treasury to speed things up" or to be labelled as real players | Flags economy-authority and honesty conflicts, preserves "simulated" labelling, asks for an explicit decision | Implements ally spend from player credits; labels simulated peers as humans or as multiplayer |
| Failure | Prompt drops constraint 1 (validator) | Reviewer catches that new saves 422 and the last valid save freezes | Merges with green unit tests but a broken persistence path |

## Known risks

- **Save growth per structure.** Every structure carries a full `FloorPlan`; caps are set to
  keep the snapshot well inside the 1.5 MB cap, and criterion 5 makes the growth measurable
  rather than assumed.
- **Engine determinism is mixed.** Only the new module is required to be seeded; the rest of
  the tick keeps its existing `Math.random`/`Date.now` behaviour. Do not "fix" that here.
- **Parcel view vs interior view.** Two camera behaviours over one renderer is where leaks
  appear; criterion 4 exists for that reason.
- **Ally growth is not balance-validated.** It changes what the player *sees*, not their
  economy; any gameplay effect on trade should be proposed separately.

## Changelog

- v1 — 2026-11-17: initial prompt, success criteria, review fixtures and risks. Chosen over
  a "new AllyTour component" design after verifying that `ui.visit` →
  `Studio.resolveTarget` → `BuildingScene` already provides a read-only 3D path, so the
  smallest coherent change is to extend it. No code changed by this document.
