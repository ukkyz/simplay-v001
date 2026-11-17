# Executive advisor prompt contract — v2 (server proxy)

Supersedes the browser-side v1 behaviour (credentials in `GameState`, direct
browser fetch to a player-supplied endpoint). The **prompt text and persona are
unchanged**; only the trust boundary, transport and output handling changed.

## Contract

| Field | Value |
| --- | --- |
| Version | `advisor-prompt/v2` (reported on every `/api/advisor` response) |
| System prompt | `EXEC_META[role].system` + company/role wrapper + `stateDigest(save)` — identical text to v1 (`src/server/ai/prompt.ts`, `src/game/digest.ts`) |
| History | Last ≤ 8 client turns, ≤ 900 chars each, roles mapped `ceo → user`, exec → `assistant`, prefixed `[AUTHOR]` |
| User turn | The CEO question, ≤ 600 characters |
| Output contract | Free-form advisory text, ≤ 2000 characters after clipping, labelled `source: "live-api"` |
| Fallback contract | `source: "local-model"`, `fallback: true`, `text` from the deterministic local advisor, `error.code` naming the reason |
| Temperature | `0.6` (server-enforced) |
| Model / endpoint | Operator env only, must match an allowlist entry |
| Timeout | `SIMPLAYZ_AI_TIMEOUT_MS` (default 12 s, 3–30 s clamped) |
| Rate limit | `SIMPLAYZ_AI_RATE_LIMIT_PER_MINUTE` per session (in-memory, single process) |

Success criteria:

1. The reply is grounded in the digest only (no invented numbers) and is actionable.
2. The response body never contains the API key, the provider base URL, or any file/SQL detail.
3. The client-supplied prompt/history can never replace the server-built digest.
4. Any upstream failure (timeout, non-2xx, empty completion, unreachable) returns `200` with local advice instead of an error the player cannot act on.
5. The boardroom stays usable with no provider configured at all.

## Test cases

Automated (mocked `fetch`, `tests/advisor-route.test.ts` — these prove integration
handling, **not** live-model quality):

| # | Case | Fixture | Expected |
| --- | --- | --- | --- |
| 1 | Happy | provider configured, upstream returns text | `live-api`, key sent in `Authorization`, key absent from response, system message contains `CITY DIGEST` |
| 2 | Edge | 40 history turns supplied | ≤ 10 messages forwarded (system + 8 history + question) |
| 3 | Failure | hanging upstream / 500 / empty completion | `local-model` + `fallback:true` + `text` ≥ 20 chars, HTTP 200 |
| 4 | Abuse | unlisted `SIMPLAYZ_AI_BASE_URL` or model | treated as "not configured", zero outbound requests |
| 5 | Abuse | 3rd request within a minute at limit 2 | `429 rate_limited` |
| 6 | Boundary | no session / cross-origin | `401` / `403` |

## Live model evaluation

**NOT RUN.** No authorized provider, model, temperature or budget was available in
this environment, and no real player data was sent to any model. Live quality,
latency and cost remain unverified; do not claim production prompt reliability
from the mocked tests or from compilation.
