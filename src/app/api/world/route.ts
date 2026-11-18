import { NextResponse, type NextRequest } from "next/server";
import { handle, requirePlayer } from "@/server/http/handler";
import { RequestRejected } from "@/server/session";
import { queryAreas } from "@/server/db/world";
import { getWorldSeed, MAX_WORLD_BYTES } from "@/server/config";
import {
  WORLD_LIMIT_DEFAULT,
  WORLD_LIMIT_MAX,
  aiRoster,
  isValidBBox,
  type WorldBBox,
  type WorldResponse,
} from "@/game/world";

/**
 * GET /api/world?latMin&latMax&lngMin&lngMax&limit
 *
 * The shared world viewport: real players' published areas plus the
 * deterministic AI roster for the same bbox.
 *
 *  - Session required (401 otherwise): the world is not an open data feed.
 *  - `limit` defaults to and never exceeds `WORLD_LIMIT_MAX`; a full page is
 *    reported as `truncated: true` rather than silently cut.
 *  - The caller's own published area is filtered out: they already see it as
 *    their own claim overlay.
 *  - `no-store`: a cached roster would show stale presence to one client and
 *    fresh presence to another.
 *
 * This is presence only. Nothing here shares simulation state, economy or
 * authority; see docs/prompts/SHARED_WORLD.md.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string): never {
  throw new RequestRejected(400, "bad_bbox", message);
}

export async function GET(req: NextRequest) {
  return handle("world:get", () => {
    const playerId = requirePlayer(req);
    const params = req.nextUrl.searchParams;

    const num = (key: string): number => {
      const raw = params.get(key);
      if (raw === null || raw.trim() === "") bad(`Missing ${key}.`);
      const value = Number(raw);
      if (!Number.isFinite(value)) bad(`${key} must be a finite number.`);
      return value;
    };

    const rawLimit = params.get("limit");
    let limit = WORLD_LIMIT_DEFAULT;
    if (rawLimit !== null && rawLimit.trim() !== "") {
      const parsed = Number(rawLimit);
      if (!Number.isFinite(parsed) || parsed < 1) bad("limit must be a positive number.");
      limit = Math.min(WORLD_LIMIT_MAX, Math.floor(parsed));
    }

    const bbox: WorldBBox = {
      latMin: num("latMin"),
      latMax: num("latMax"),
      lngMin: num("lngMin"),
      lngMax: num("lngMax"),
    };
    if (!isValidBBox(bbox))
      bad("Bounding box is out of range or reversed (latMin<=latMax, lngMin<=lngMax).");

    const now = Date.now();
    const seed = getWorldSeed();
    const players = queryAreas(bbox, limit, playerId, now);
    const ai = aiRoster(bbox, seed, now);

    // Players win the budget: a grid cell full of real players must never be
    // hidden behind simulated ones.
    const room = Math.max(0, limit - players.entries.length);
    const entries = [...players.entries, ...ai.slice(0, room)];
    const truncated = players.truncated || ai.length > room;

    const body: WorldResponse = {
      version: 1,
      entries,
      truncated,
      counts: {
        player: players.entries.length,
        ai: Math.min(ai.length, room),
      },
      serverTime: now,
      seed,
    };

    const json = NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
    const size = Buffer.byteLength(JSON.stringify(body));
    if (size > MAX_WORLD_BYTES)
      // Cheap guard: the limits above should make this unreachable, so hitting
      // it means a limit changed. Fail loudly instead of shipping a huge body.
      console.error(`[simplayz] world:get response ${size}B exceeds ${MAX_WORLD_BYTES}B`);
    return json;
  });
}
