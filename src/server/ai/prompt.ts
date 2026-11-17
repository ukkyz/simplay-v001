import "server-only";
import { EXEC_META } from "@/game/constants";
import { stateDigest } from "@/game/digest";
import type { GameState } from "@/game/types";
import {
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_PROMPT_CHARS,
  type AdvisorRole,
} from "./config";

/**
 * Server-side prompt assembly. Shared by the live provider call and by the local
 * rule-based fallback so both see identical grounded context (the "digest"),
 * exactly as the v1 prototype promised.
 */

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export function systemPrompt(role: AdvisorRole, state: GameState): string {
  const meta = EXEC_META[role];
  return `${meta.system}\n\nYou are ${meta.name}, ${meta.title} of ${state.company}. Address the CEO directly. Be specific and quantitative.\n\n${stateDigest(state)}`;
}

/** Sanitize client-supplied history: bounded count/length, alternating roles. */
export function sanitizeHistory(input: unknown): HistoryTurn[] {
  if (!Array.isArray(input)) return [];
  const out: HistoryTurn[] = [];
  for (const raw of input.slice(-MAX_HISTORY_MESSAGES)) {
    if (!raw || typeof raw !== "object") continue;
    const msg = raw as { role?: unknown; content?: unknown };
    const role = msg.role === "user" || msg.role === "assistant" ? msg.role : null;
    if (!role || typeof msg.content !== "string") continue;
    const content = msg.content.slice(0, MAX_HISTORY_CHARS);
    if (!content.trim()) continue;
    out.push({ role, content });
  }
  return out;
}

export function buildMessages(
  role: AdvisorRole,
  state: GameState,
  prompt: string,
  history: HistoryTurn[],
): { role: "system" | "user" | "assistant"; content: string }[] {
  return [
    { role: "system", content: systemPrompt(role, state) },
    ...history,
    { role: "user", content: prompt.slice(0, MAX_PROMPT_CHARS) },
  ];
}
