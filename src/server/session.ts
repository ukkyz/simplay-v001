import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  allowedHosts,
  cookieSecure,
  isProduction,
} from "./config";

/**
 * Anonymous session identity.
 *
 * The cookie carries a 32-byte cryptographically random token. The database
 * stores only its SHA-256 hash as the player id, so a database leak does not
 * hand out usable session cookies, and the cookie value itself is never a valid
 * lookup key for anything but "which row is mine".
 */

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function playerIdFromToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readSessionToken(req: NextRequest): string | null {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  // base64url of 32 bytes is exactly 43 chars; reject anything else before hashing.
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  return raw;
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 0,
  });
}

/* --------------------------- request protections --------------------------- */

export class RequestRejected extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Same-origin / CSRF guard for state-changing requests.
 *
 * The session cookie is SameSite=Lax, which already blocks cross-site POSTs from
 * forms, but that is a best-effort browser behaviour. We additionally require an
 * Origin header that matches the Host the request was sent to. Non-browser
 * clients (tests, curl, server-to-server) can opt in by sending the same
 * `Origin` value; requests with no Origin header at all are rejected for
 * state-changing verbs.
 */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const allowed = allowedHosts();

  if (allowed.length > 0) {
    const hostname = host.split(":")[0]?.toLowerCase() ?? "";
    if (!allowed.includes(hostname))
      throw new RequestRejected(403, "host_not_allowed", "This host is not configured for this server.");
  }

  // Fetch metadata is the strongest signal when the browser sends it.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    throw new RequestRejected(403, "cross_origin", "Cross-origin state changes are not allowed.");

  if (!origin)
    throw new RequestRejected(
      403,
      "missing_origin",
      "State-changing requests must include an Origin header.",
    );

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new RequestRejected(403, "bad_origin", "Origin header is not a valid URL.");
  }
  if (!host || originHost !== host)
    throw new RequestRejected(403, "cross_origin", "Origin does not match this host.");
}

export function assertJsonContentType(req: NextRequest): void {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json"))
    throw new RequestRejected(415, "unsupported_media_type", "Expected application/json.");
}

/**
 * Read a JSON body with a hard byte cap. Returns a discriminated result so route
 * handlers can answer 413 without exceptions carrying payload content.
 */
export async function readJsonBody(
  req: NextRequest,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; code: string; message: string }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes)
    return { ok: false, status: 413, code: "payload_too_large", message: "Request body is too large." };

  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, status: 400, code: "unreadable_body", message: "Could not read the request body." };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes)
    return { ok: false, status: 413, code: "payload_too_large", message: "Request body is too large." };
  if (!text.trim())
    return { ok: false, status: 400, code: "empty_body", message: "Request body is empty." };

  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, code: "invalid_json", message: "Request body is not valid JSON." };
  }
}

/** Error envelope shared by every API route. Never includes SQL/paths/stacks. */
export function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Log a server-side cause without exposing it to the client. */
export function logServerError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[simplayz] ${scope}: ${message}${isProduction() ? "" : ""}`);
}

/**
 * Advisor rate limiting. In-memory and per-process: it protects a single server
 * from one client hammering the endpoint. It is NOT a distributed quota — a
 * restart resets it and multiple instances would each keep their own bucket.
 */
const buckets = new Map<string, number[]>();

export function takeRateLimitToken(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}
