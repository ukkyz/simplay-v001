import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { playerIdFromToken, readSessionToken } from "@/server/session";
import { RequestRejected } from "@/server/session";
import { errorResponse, logServerError } from "@/server/session";

/**
 * Route wrapper: converts thrown RequestRejected / unexpected errors into the
 * shared JSON error envelope, so no route can accidentally leak a stack trace,
 * SQL statement or filesystem path to a client.
 */
export async function handle(
  scope: string,
  fn: () => Promise<NextResponse> | NextResponse,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof RequestRejected)
      return errorResponse(error.status, error.code, error.message);
    logServerError(scope, error);
    return errorResponse(500, "internal_error", "The server could not complete this request.");
  }
}

/** Resolve the caller's player id from the signed-in anonymous session cookie. */
export function requirePlayer(req: NextRequest): string {
  const token = readSessionToken(req);
  if (!token)
    throw new RequestRejected(
      401,
      "no_session",
      "No anonymous session. Reload the page to start one.",
    );
  return playerIdFromToken(token);
}

export function optionalPlayer(req: NextRequest): string | null {
  const token = readSessionToken(req);
  return token ? playerIdFromToken(token) : null;
}
