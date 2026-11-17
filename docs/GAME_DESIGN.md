# Systems reference — v1.1

2026-11-16; observed baseline `294a75c`. This is an implementation-oriented design map, not a new balance pass. Numeric sources: `constants.ts` and `engine.ts`; known contradictions: [decision register](DECISIONS.md). Existing in-app § references describe its own GDD, not section numbers in this document.

## Motivation and loops

**Player fantasy:** a CEO making portfolio and operational tradeoffs on a recognizable place. **Moment-to-moment:** inspect bottleneck → allocate/build/trade → watch feedback. **Session:** commission → iterate plan → fund → recover from constraints → deploy. **Long-term prototype:** gain XP/levels, unlock tiers, improve infrastructure and relationships within 20 sites. Shared-world competition/cooperation remains a future direction.

Target feeling is informed control, not surprise bankruptcy. Meaningful decisions trade scarce capital, space, schedule and resilience. The current tuning is unvalidated; no player telemetry or playtest evidence is in the repo.

## Mechanic contracts (observed behavior)

| Mechanic | Purpose; player feeling/decision | Inputs → outputs/rules | Edges, failure and recovery |
| --- | --- | --- | --- |
| Claim/onboarding | Place identity in a real location; choose where to start | CEO/company + manual/GPS point → claim, sectors, generated neighbors; default side 8 km | GPS denial can use manual selection/demo. No global overlap validation; approximate geography only. |
| Sector/site specialization | Make limited space legible; choose portfolio | Area kind + site/archetype → surveyed site/project; four areas, five sites each | Existing building or active project locks respec; duplicate area kinds rejected. Wrong kind/locked tier/occupied site cannot start. |
| Construction pipeline | Give capital a visible schedule; choose sequencing | `startProject` → Discover/Design/Approve/Build/Test/Deploy/Operate; max six non-operate projects | Approval rechecks money/materials each tick and releases when funded. QA failures 1–2 return to Build at 0.7 progress, quality −10/risk +6; third test signs off even if roll fails. Deployment creates building and promotes draft plan. |
| Design iteration | Reward earlier decisions; choose quality now vs late cost | `changeRequest`: in Design costs 0, quality +4 (cap 98). Outside Design costs 5% budget, quality +1, risk +5, progress −0.18 floored at 0 | Reducer has no affordability/terminal-phase guard here; do not infer UI restrictions as engine guarantees. Free Design quality boosts can be repeated. |
| Plan editing/interiors | Let players author and inhabit an asset; choose layout | Cell edits → draft/building plan → 2D/3D geometry and collision; `updatePlan` replaces matching target plan | Engine does not validate plan shape or enforce phase restrictions. Bad layouts may strand spawn/navigation. Validate 2D→3D consistency and return navigation. |
| Approval override/cancel | Offer costly escape from commitment; choose risk vs wait | Override blocked project: 8% budget fee, risk +12, CFO trust −6/load +8, morale −3; moves to Build. Cancel removes project, restores site, adds salvage, morale −4 | Insufficient override fee does nothing. Cancel salvage = max(0, budget−spent) × (0.35 in Build else 0.85); this can create credits before spending. Escrow semantics unresolved. |
| Resource operation | Make resilience matter; choose production vs capacity | Operational buildings → power/food/materials, upkeep/revenue, crew/storage; `flows` + hourly tick | Brownout halves production efficiency; empty food/overcapacity lower morale. Trade/build/maintenance are recovery levers; storage stocks can spoil. |
| Condition/maintenance | Keep old assets relevant; choose repair timing | Hourly condition decay 0.08; below 40 condition multiplier 0.6. `maintain` costs round((100−condition)×45), restores 100 | Insufficient credits rejected. At exactly 40 penalty is not yet active. Current multiplier affects power demand as well as output. |
| Trade/roads | Give surplus an outlet; choose timing/partner/infrastructure | Buy/sell food/materials against bot inventory/purse; price depends on market/relation/modifiers; grade upgrades affect capacity | Per-bot cooldown 6 sim-hours; quantity capped by `tradeCapacity`; insufficient stock/cash refuses. Power/credits trades rejected. Roads/partners are simulated, not real player contracts. |
| Executive board/stance | Explain bottlenecks and schedule tradeoffs; choose whose advice to follow | Chat/digest → advisory text via server proxy; stance modifies phase speed/design quality | No server provider configured → local rules; timeout/error/empty → local fallback (server-composed). Text never directly executes actions. Local facts/prompt grounding still need regression checks. |
| Speed/persistence | Let players control waiting; choose pace | 0/1/4/16× → timer cadence; server snapshot saves via a coalesced queue (≤1 write in flight, ≥1 attempt / 4 s) | No offline progress/server clock; browser throttling still slows progression. Reset deletes the server save (and advisor preferences) for this anonymous session. Exports are credential-free. Snapshot persistence ≠ multiplayer. |
| Progression/visits | Make expansion and neighboring activity visible | XP → CEO level/tier access; generated remote plans → visits | Neighbors/presence/security affordances are local simulation, not authorization. Read-only visit UI is not a multiplayer permission system. |

## Balance levers and rationale

Do not copy the full archetype table here; edit `ARCHETYPES` with its `rationale`, then reconcile catalogue/UI/advisor text. All durations below are simulation hours, not promises of wall-clock completion.

| Lever/source | Current value/formula | Intent and qualification |
| --- | --- | --- |
| Clock/store | 1 sim-hour per tick; 1,000 ms / speed | Rapidly visible construction. `TUNABLES.tickMs` duplicates store `TICK_MS`; changing one alone does not change both. |
| Opening resources | ₡250,000; materials 1,200; food 400 | Opening experimentation buffer; exact runway rationale is not validated. Base yard is 400 units, so opening stocks already overflow. |
| Construction budget | archetype cost × 1.15 | Contingency buffer; 15% draw during Approve, 85% during Build, proportional to phase advance. Boundary/rework conservation requires tests. |
| Materials | archetype cost × 0.004 | Coupling construction to industry (₡100,000 → 400 units). Gate checks this amount. |
| Phase allocation | shares 6/14/4/62/8/6%; minimums 2/4/1/8/2/2 h | Build is the long pole; short phases stay visible. Actual phase speed uses owner load, morale, skill and stance. Read `phaseHours` before estimating ETAs. |
| Brownout/morale | 0.5 output factor; morale deficit rate 1.5 × deficit score/h | Recoverable penalties rather than instant shutdown. Starvation/brownout each add 1 deficit; overflow adds 0.5; stable morale recovers 0.35/h. |
| Overflow | 25% of excess/h | Make storage meaningful. Cold-store modifier changes allocation; consult tick implementation rather than assuming all stocks spoil equally. |
| Food demand | 0.4 units/crew-hour | One unit covers 2.5 crew-hours. Food is stock; power is capacity/flow, not stock. |
| Trade | 6 h cooldown; capacity base 400; grade throughput 120/340/900 | Limit spam, make logistics investment matter. Actual deal cap uses `tradeCapacity`, not simply the selected route's displayed throughput. |
| Market | base materials 34, food 22, power 9; reversion 0.06/h; impact 0.00035/unit; band ±28% | Moving prices create timing decisions without indefinite divergence. Power has a price field but is not tradable. |
| Progression | `LEVELS(l) = round(600 × 1.55^(l−1))` | Increasing level thresholds. Verify caller semantics rather than assuming “600 to level 2” from prose. |

## Required spec for a mechanic change

Record: version/date → player problem and target feeling → decision → purpose → input/action/schema → outputs/state transitions → formulas with units and rationale → bounds/rounding → invalid inputs → failure/recovery → feedback/UI → save/network/security effects → happy/edge/failure cases → measurement plan. This is a specification checklist, not an extra runtime prompt.

Balance proposals must compare a reproducible starting state and controlled time/RNG, resource deltas, completion time, loss/recovery, and dominant strategies. No number is “balanced” until evidence supports it.

## Revision log

- v1.0 — 2026-11-16: current-system inventory and balance provenance; no tuning changed.
- v1.1 — 2026-11-17: persistence/advisor rows updated for server snapshots and the server-proxied advisor. No balance value changed.
