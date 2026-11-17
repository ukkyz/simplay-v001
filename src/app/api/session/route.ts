import { NextResponse, type NextRequest } from "next/server";
import { ensurePlayer, readSave } from "@/server/db/saves";
import { handle, optionalPlayer } from "@/server/http/handler";
import {
  RequestRejected,
  assertJsonContentType,
  assertSameOrigin,
  newSessionToken,
  playerIdFromToken,
  readSessionToken,
  setSessionCookie,
} from "@/server/session";

/**
 * Anonymous session bootstrap.
 *
 *  GET  /api/session — who am I? Returns the player's existing save (if any).
 *  POST /api/session — create a session cookie if this browser has none.
 *
 * The session is created lazily so a first-time visitor who only reads the
 * onboarding screen does not write a row.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle("session:get", () => {
    const playerId = optionalPlayer(req);
    if (!playerId) {
      return NextResponse.json(
        { session: null, save: null },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }
    const save = readSave(playerId);
    return NextResponse.json(
      {
        session: { playerIdHint: playerId.slice(0, 8) },
        save: save ? { revision: save.revision, schemaVersion: save.schemaVersion, updatedAt: save.updatedAt } : null,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function POST(req: NextRequest) {
  return handle("session:post", () => {
    assertJsonContentType(req);
    assertSameOrigin(req);

    const existing = readSessionToken(req);
    if (existing) {
      // Idempotent: never rotate a token the player may already have progress on.
      const playerId = playerIdFromToken(existing);
      ensurePlayer(playerId);
      return NextResponse.json(
        { session: { created: false }, save: null },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const token = newSessionToken();
    const playerId = playerIdFromToken(token);

    // A fresh token is astronomically unlikely to collide, but a 401 is cheaper
    // than silently handing one player another player's row.
    if (readSave(playerId)) throw new RequestRejected(409, "session_collision", "Please reload and retry.");

    ensurePlayer(playerId);
    const res = NextResponse.json(
      { session: { created: true }, save: null },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
    setSessionCookie(res, token);
    return res;
  });
}
