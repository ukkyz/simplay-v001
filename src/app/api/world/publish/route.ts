import { NextResponse, type NextRequest } from "next/server";
import { handle, requirePlayer } from "@/server/http/handler";
import { publishArea, unpublishArea } from "@/server/db/world";
import {
  RequestRejected,
  assertJsonContentType,
  assertSameOrigin,
  readJsonBody,
  takeRateLimitToken,
} from "@/server/session";
import { MAX_SAVE_BYTES } from "@/server/config";

/**
 * POST /api/world/publish  body: `{ publish: boolean }`
 *
 *  - The body's ONLY accepted field is `publish`. Any `lat`, `lng`, `company`,
 *    `playerId` or similar is ignored: the published values are re-derived from
 *    the caller's own saved GameState row, so a client cannot publish a
 *    position (or a name) on behalf of itself falsely or for anybody else.
 *  - Opting out is a hard DELETE, so no stale addressable row survives.
 *  - Requires JSON content type + same-origin, and is rate limited.
 *
 * Presence only: this does not share simulation state or grant any authority.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Publish toggles per session per minute. In-memory, single process. */
const PUBLISH_LIMIT_PER_MINUTE = 20;

export async function POST(req: NextRequest) {
  return handle("world:publish", async () => {
    const playerId = requirePlayer(req);
    assertJsonContentType(req);
    assertSameOrigin(req);

    if (!takeRateLimitToken(`world-publish:${playerId}`, PUBLISH_LIMIT_PER_MINUTE))
      throw new RequestRejected(429, "rate_limited", "Too many publish changes. Retry shortly.");

    const body = await readJsonBody(req, MAX_SAVE_BYTES);
    if (!body.ok) throw new RequestRejected(body.status, body.code, body.message);

    const payload = body.body as { publish?: unknown } | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new RequestRejected(400, "bad_envelope", "Body must be an object with `publish`.");
    if (typeof payload.publish !== "boolean")
      throw new RequestRejected(400, "bad_publish", "`publish` must be true or false.");

    if (!payload.publish) {
      const removed = unpublishArea(playerId);
      return NextResponse.json(
        { version: 1, published: false, removed },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const outcome = publishArea(playerId);
    if (outcome.kind === "no-save")
      return NextResponse.json(
        {
          error: {
            code: "no_save",
            message: "Register a company and save at least once before publishing your area.",
          },
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    if (outcome.kind === "missing-player")
      throw new RequestRejected(
        401,
        "unknown_session",
        "This session is unknown to the server. Reload to create a new one.",
      );

    return NextResponse.json(
      {
        version: 1,
        published: true,
        area: {
          lat: outcome.entry.lat,
          lng: outcome.entry.lng,
          sideKm: outcome.entry.sideKm,
          buildings: outcome.entry.buildings,
        },
        updatedAt: outcome.updatedAt,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  });
}
