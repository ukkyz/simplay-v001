import { NextResponse, type NextRequest } from "next/server";
import { readAdvisorEnv, isAdvisorRole, MAX_PROMPT_CHARS, ADVISOR_PROMPT_VERSION } from "@/server/ai/config";
import { buildMessages, sanitizeHistory } from "@/server/ai/prompt";
import { stateDigest } from "@/game/digest";
import { localAdvice } from "@/game/localAdvisor";
import { stripSecrets } from "@/server/gameSave";
import { readSave } from "@/server/db/saves";
import type { GameState } from "@/game/types";

/**
 * Response for every "live model unavailable" path. The *server* composes the
 * grounded local advice from its own persisted snapshot, so a client cannot
 * smuggle arbitrary text or fake city numbers into the boardroom transcript.
 */
function localFallback(
  code: string,
  message: string,
  args: { role: Parameters<typeof localAdvice>[0]; prompt: string; state: GameState | null; configured: boolean },
) {
  return NextResponse.json(
    {
      source: "local-model",
      fallback: true,
      configured: args.configured,
      promptVersion: ADVISOR_PROMPT_VERSION,
      text: args.state ? localAdvice(args.role, args.prompt, args.state) : "",
      error: { code, message },
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
import { handle, requirePlayer } from "@/server/http/handler";
import {
  RequestRejected,
  assertJsonContentType,
  assertSameOrigin,
  readJsonBody,
  takeRateLimitToken,
} from "@/server/session";
import { MAX_ADVISOR_BYTES } from "@/server/config";

/**
 * POST /api/advisor — executive board consultation.
 *
 * Security boundary (see docs/ARCHITECTURE.md):
 *  - Credentials are operator environment values; the client never sees them.
 *  - The provider endpoint and model are allowlisted by server configuration, so
 *    this is not an open arbitrary-URL proxy.
 *  - Body size, prompt length and history length are capped.
 *  - A bounded timeout aborts slow upstreams.
 *  - Per-session rate limiting is in-memory and single-process only.
 *
 * Failure contract: never a 5xx for an upstream problem. The client receives
 * `{ source: "local-model", fallback: true, error }` and renders local advice, so
 * the boardroom degrades instead of dying.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handle("advisor:post", async () => {
    const playerId = requirePlayer(req);
    assertJsonContentType(req);
    assertSameOrigin(req);

    const body = await readJsonBody(req, MAX_ADVISOR_BYTES);
    if (!body.ok) throw new RequestRejected(body.status, body.code, body.message);

    const payload = body.body as { role?: unknown; prompt?: unknown; history?: unknown } | null;
    if (!payload || typeof payload !== "object")
      throw new RequestRejected(400, "bad_envelope", "Body must be an object.");

    if (!isAdvisorRole(payload.role))
      throw new RequestRejected(400, "bad_role", "role must be one of cto, cfo, coo.");

    if (typeof payload.prompt !== "string" || !payload.prompt.trim())
      throw new RequestRejected(400, "bad_prompt", "prompt must be a non-empty string.");
    if (payload.prompt.length > MAX_PROMPT_CHARS)
      throw new RequestRejected(422, "prompt_too_long", `prompt must be ≤ ${MAX_PROMPT_CHARS} characters.`);

    const env = readAdvisorEnv();
    const saved = readSave(playerId);
    const ownState = saved ? stripSecrets(saved.state) : null;
    const askPrompt = payload.prompt.trim();

    if (!env)
      return localFallback(
        "not_configured",
        "No live model is configured on this server — local advisor.",
        { role: payload.role, prompt: askPrompt, state: ownState, configured: false },
      );

    if (!takeRateLimitToken(playerId, env.rateLimitPerMinute))
      throw new RequestRejected(
        429,
        "rate_limited",
        "Too many advisor requests. Wait a minute and try again — the local advisor still works.",
      );

    // The digest is rebuilt server-side from the caller's persisted save so the
    // client cannot inject a fake city state into the model context.
    if (!saved)
      return localFallback("no_save", "Save your company before consulting the live model.", {
        role: payload.role,
        prompt: askPrompt,
        state: null,
        configured: true,
      });

    const messages = buildMessages(payload.role, saved.state, askPrompt, sanitizeHistory(payload.history));

    let upstream: Response;
    try {
      upstream = await fetch(`${env.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.apiKey}` },
        body: JSON.stringify({ model: env.model, temperature: 0.6, messages, max_tokens: 400 }),
        signal: AbortSignal.timeout(env.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return localFallback(
        timedOut ? "upstream_timeout" : "upstream_unreachable",
        timedOut
          ? "The advisor took too long to answer — local advice shown."
          : "The advisor could not be reached — local advice shown.",
        { role: payload.role, prompt: askPrompt, state: ownState, configured: true },
      );
    }

    if (!upstream.ok) {
      // Provider status is useful operationally, but the provider's body may
      // contain account details — log the code only, never forward it.
      console.error(`[simplayz] advisor upstream status ${upstream.status}`);
      return localFallback("upstream_error", "The advisor returned an error — local advice shown.", {
        role: payload.role,
        prompt: askPrompt,
        state: ownState,
        configured: true,
      });
    }

    const json = (await upstream.json().catch(() => null)) as
      | { choices?: { message?: { content?: unknown } }[] }
      | null;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      return localFallback("empty_completion", "The advisor returned no text — local advice shown.", {
        role: payload.role,
        prompt: askPrompt,
        state: ownState,
        configured: true,
      });

    return NextResponse.json(
      {
        source: "live-api",
        text: content.trim().slice(0, 2_000),
        // The model *identifier* is not a secret; the key and base URL never leave
        // the server. `model` is only reported so the UI can label the response.
        model: env.model,
        digest: stateDigest(saved.state).length,
        promptVersion: ADVISOR_PROMPT_VERSION,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  });
}
