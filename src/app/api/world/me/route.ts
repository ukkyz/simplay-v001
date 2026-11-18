import { NextResponse, type NextRequest } from "next/server";
import { handle, requirePlayer } from "@/server/http/handler";
import { readOwnPublication } from "@/server/db/world";
import type { WorldMeResponse } from "@/game/world";

/**
 * GET /api/world/me — is the caller's area published, and at what coarsened
 * position? Used by the World screen toggle and by the publish store. Returns
 * only the caller's own row, always coarsened, never a `player_id`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle("world:me", () => {
    const playerId = requirePlayer(req);
    const own = readOwnPublication(playerId);
    const body: WorldMeResponse = { version: 1, ...own };
    return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
  });
}
