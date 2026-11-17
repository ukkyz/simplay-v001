import "server-only";
import path from "node:path";

/**
 * Server configuration. Never import this from a client component: values here
 * (DB path, advisor key) must not reach the browser bundle.
 */

const DEFAULT_DB_RELATIVE_PATH = path.join("data", "simplayz.sqlite");

/** Absolute SQLite path. `SIMPLAYZ_DB_PATH` may be relative to the process cwd. */
export function getDatabasePath(): string {
  const raw = process.env.SIMPLAYZ_DB_PATH?.trim() || DEFAULT_DB_RELATIVE_PATH;
  // turbopackIgnore: the DB path is runtime configuration, not a traced asset.
  return path.isAbsolute(raw) ? raw : path.resolve(/*turbopackIgnore: true*/ process.cwd(), raw);
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * `Secure` cookies require HTTPS. Default: on in production, off in dev.
 * Override with SIMPLAYZ_COOKIE_SECURE=true|false when termination differs
 * (e.g. TLS terminated upstream but NODE_ENV=development in a shared env).
 */
export function cookieSecure(): boolean {
  const raw = process.env.SIMPLAYZ_COOKIE_SECURE?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return isProduction();
}

export const SESSION_COOKIE = "simplayz_session";

/** Anonymous session cookie lifetime (30 days, sliding on save/reset writes). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Hard cap for a single save payload body, in bytes. */
export const MAX_SAVE_BYTES = 1_500_000;

/** Hard cap for an advisor request body, in bytes. */
export const MAX_ADVISOR_BYTES = 32_000;

/**
 * Allowed Host header values. `null`/empty means "accept whatever the server is
 * addressed as" which is fine for a single-tenant local server; set this in
 * production to prevent Host-header spoofing from undermining the same-origin
 * checks (see docs/ARCHITECTURE.md "Request trust").
 */
export function allowedHosts(): string[] {
  return (process.env.SIMPLAYZ_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
