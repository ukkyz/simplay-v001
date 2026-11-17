import "server-only";

/**
 * Executive advisor prompt contract — v2 (server-proxied).
 *
 * v1 lived in the browser and shipped credentials from GameState. v2 keeps the
 * same persona/system text and the same digest, but the provider endpoint and
 * key are operator-owned environment values and the request is made from the
 * server. See docs/prompts/ADVISOR_PROMPT.md for the output contract, success
 * criteria and test cases.
 */
export const ADVISOR_PROMPT_VERSION = "advisor-prompt/v2";

/** Max characters a client may put in one question to the board. */
export const MAX_PROMPT_CHARS = 600;

/** Conversation history turns accepted from the client (older ones dropped). */
export const MAX_HISTORY_MESSAGES = 8;

/** Max characters per history message accepted from the client. */
export const MAX_HISTORY_CHARS = 900;

export interface AdvisorEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
  allowedBaseUrls: string[];
  allowedModels: string[];
  timeoutMs: number;
  rateLimitPerMinute: number;
}

/**
 * Read advisor configuration from the environment. Returns null when the
 * operator has not configured a provider, which means "local advisor only".
 *
 * Deliberately NOT named NEXT_PUBLIC_*: those are inlined into the browser
 * bundle. These values never leave the server process.
 */
export function readAdvisorEnv(): AdvisorEnv | null {
  const apiKey = process.env.SIMPLAYZ_AI_API_KEY?.trim();
  if (!apiKey) return null;

  const baseUrl = (process.env.SIMPLAYZ_AI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.SIMPLAYZ_AI_MODEL?.trim() || "gpt-4o-mini";
  const allowedBaseUrls = (process.env.SIMPLAYZ_AI_ALLOWED_BASE_URLS ?? "https://api.openai.com/v1")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const allowedModels = (process.env.SIMPLAYZ_AI_ALLOWED_MODELS ?? "gpt-4o-mini")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!allowedBaseUrls.includes(baseUrl)) return null;
  if (!allowedModels.includes(model)) return null;

  const timeoutMs = clampInt(process.env.SIMPLAYZ_AI_TIMEOUT_MS, 3_000, 30_000, 12_000);
  const rateLimitPerMinute = clampInt(process.env.SIMPLAYZ_AI_RATE_LIMIT_PER_MINUTE, 1, 120, 10);

  return { apiKey, baseUrl, model, allowedBaseUrls, allowedModels, timeoutMs, rateLimitPerMinute };
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export const EXEC_ROLES = ["cto", "cfo", "coo"] as const;
export type AdvisorRole = (typeof EXEC_ROLES)[number];

export function isAdvisorRole(value: unknown): value is AdvisorRole {
  return typeof value === "string" && (EXEC_ROLES as readonly string[]).includes(value);
}
