"use client";

import type { ChatMessage, ExecRole, GameState } from "./types";
import { localAdvice } from "./localAdvisor";

/**
 * GDD §7 — Executive board intelligence.
 *
 * The live-model path now lives behind `/api/advisor` (server-side provider
 * credentials; see src/server/ai). This module keeps:
 *  - `localAdvice` (re-exported from ./localAdvisor): the deterministic,
 *    state-grounded fallback so the boardroom is never a dead screen when no
 *    provider is configured or a request fails.
 *  - `askExec`: the browser-side call into the proxy. It no longer accepts or
 *    reads an API key — credentials are operator-owned environment values.
 */

export { localAdvice };

export interface AdvisorReply {
  text: string;
  source: "live-api" | "local-model";
  error?: string;
  promptVersion?: string;
}

const LOCAL_LATENCY_MS = 420;

/**
 * Ask the board. Sends the question plus the plan-safe rolling history to the
 * server proxy; on any failure it degrades to the local advisor while reporting
 * the reason so the UI can show "unsaved/local" degradation honestly.
 */
export async function askExec(
  role: ExecRole,
  history: ChatMessage[],
  prompt: string,
  s: GameState,
): Promise<AdvisorReply> {
  const fallback = (error?: string): AdvisorReply => ({
    text: localAdvice(role, prompt, s),
    source: "local-model",
    error,
  });

  const turns = history
    .filter((m) => !m.pending && m.text.trim())
    .slice(-8)
    .map((m) => ({
      role: m.role === "ceo" ? ("user" as const) : ("assistant" as const),
      content: m.author ? `[${m.author}] ${m.text}` : m.text,
    }));

  try {
    const res = await fetch("/api/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, prompt, history: turns }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as
      | { text?: string; source?: AdvisorReply["source"]; promptVersion?: string; error?: { message?: string; code?: string }; fallback?: boolean }
      | null;

    if (json?.source === "live-api" && json.text) {
      return { text: json.text, source: "live-api", promptVersion: json.promptVersion };
    }
    if (json?.fallback) {
      await new Promise((r) => setTimeout(r, LOCAL_LATENCY_MS / 2));
      return fallback(json.error?.message);
    }
    if (!res.ok) return fallback(json?.error?.message ?? `Advisor unavailable (${res.status}).`);
    return fallback("The advisor returned no text.");
  } catch (err) {
    return fallback(`Could not reach the advisor (${(err as Error).name === "TimeoutError" ? "timed out" : "network error"}) — local advice shown.`);
  }
}

export const SUGGESTIONS: Record<ExecRole, string[]> = {
  cto: ["What should I build next and why?", "Are we at risk of a brownout?", "Give me the schedule for the current pipeline", "What is the QA risk on the active build?"],
  cfo: ["What is my runway right now?", "Which projects can you fund today?", "Should I cancel anything?", "When is the best time to sell materials?"],
  coo: ["Are we going to run out of food?", "What is our storage situation?", "Should I upgrade a road?", "How do I improve alliance relations?"],
};
