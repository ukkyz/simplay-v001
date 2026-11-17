import { NextResponse, type NextRequest } from "next/server";
import { deleteSave, readSave, writeSave } from "@/server/db/saves";
import { handle, requirePlayer } from "@/server/http/handler";
import {
  RequestRejected,
  assertJsonContentType,
  assertSameOrigin,
  readJsonBody,
} from "@/server/session";
import { MAX_SAVE_BYTES } from "@/server/config";

/**
 * /api/save — the caller's own game snapshot.
 *
 *  GET    → { save: { state, revision, schemaVersion, createdAt, updatedAt } | null }
 *  PUT    → { baseRevision, state } → 200 updated | 201 created | 409 conflict | 422 invalid
 *  DELETE → { deleted: boolean }
 *
 * Ownership comes exclusively from the anonymous session cookie; there is no
 * route parameter that lets a caller name somebody else's save. All three verbs
 * are scoped by `player_id` inside the SQL itself.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle("save:get", () => {
    const playerId = requirePlayer(req);
    const save = readSave(playerId);
    return NextResponse.json(
      {
        save: save
          ? {
              state: save.state,
              revision: save.revision,
              schemaVersion: save.schemaVersion,
              createdAt: save.createdAt,
              updatedAt: save.updatedAt,
            }
          : null,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function PUT(req: NextRequest) {
  return handle("save:put", async () => {
    const playerId = requirePlayer(req);
    assertJsonContentType(req);
    assertSameOrigin(req);

    const body = await readJsonBody(req, MAX_SAVE_BYTES);
    if (!body.ok) throw new RequestRejected(body.status, body.code, body.message);

    const payload = body.body as { baseRevision?: unknown; state?: unknown } | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new RequestRejected(400, "bad_envelope", "Body must be an object with baseRevision and state.");

    const baseRevision = payload.baseRevision;
    if (typeof baseRevision !== "number" || !Number.isInteger(baseRevision) || baseRevision < 0)
      throw new RequestRejected(400, "bad_base_revision", "baseRevision must be a non-negative integer.");

    const outcome = writeSave({ playerId, baseRevision, state: payload.state });

    switch (outcome.kind) {
      case "created":
      case "updated": {
        const res = NextResponse.json(
          {
            save: {
              revision: outcome.save.revision,
              schemaVersion: outcome.save.schemaVersion,
              createdAt: outcome.save.createdAt,
              updatedAt: outcome.save.updatedAt,
            },
          },
          { status: outcome.kind === "created" ? 201 : 200, headers: { "Cache-Control": "no-store" } },
        );
        return res;
      }
      case "conflict":
        return NextResponse.json(
          {
            error: {
              code: "revision_conflict",
              message:
                "Another write advanced this save. Your snapshot was kept locally — choose which version to keep.",
            },
            currentRevision: outcome.currentRevision,
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      case "invalid":
        return NextResponse.json(
          {
            error: {
              code: "invalid_save",
              message: "The save was rejected by validation. The last valid save is unchanged.",
            },
            problems: outcome.errors,
          },
          { status: 422, headers: { "Cache-Control": "no-store" } },
        );
      case "missing-player":
        throw new RequestRejected(
          401,
          "unknown_session",
          "This session is unknown to the server. Reload to create a new one.",
        );
      case "storage-error":
        return NextResponse.json(
          { error: { code: "storage_error", message: outcome.message } },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
    }
  });
}

export async function DELETE(req: NextRequest) {
  return handle("save:delete", () => {
    const playerId = requirePlayer(req);
    assertSameOrigin(req);
    const result = deleteSave(playerId);
    return NextResponse.json(
      { deleted: result.deleted },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  });
}
