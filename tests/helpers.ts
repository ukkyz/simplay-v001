import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { closeDb } from "@/server/db/client";
import { playerIdFromToken } from "@/server/session";

/**
 * Test harness: every test file gets an isolated SQLite file under the OS temp
 * directory (never the repository, never a player's real database).
 */
export function useTempDb(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `simplayz-${label}-`));
  const dbPath = path.join(dir, "test.sqlite");
  closeDb();
  process.env.SIMPLAYZ_DB_PATH = dbPath;
  process.env.SIMPLAYZ_DB_MIGRATE = "auto";
  (process.env as Record<string, string>).NODE_ENV = "test";
  return dbPath;
}

export function disposeTempDb(dbPath: string): void {
  closeDb();
  try {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  } catch {
    /* windows file locks — temp dir, safe to leave */
  }
}

export const TEST_TOKEN = "A".repeat(43);
export const OTHER_TOKEN = "B".repeat(43);

export function cookieHeader(token: string): string {
  return `simplayz_session=${token}`;
}

export function playerIdFor(token: string): string {
  return playerIdFromToken(token);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  origin?: string | null;
  host?: string;
  contentType?: string;
  headers?: Record<string, string>;
}

/** Build a NextRequest that looks like a same-origin browser fetch. */
export function makeRequest(pathname: string, opts: RequestOptions = {}): NextRequest {
  const host = opts.host ?? "localhost:3000";
  const method = opts.method ?? "GET";
  const headers = new Headers({ host, ...(opts.headers ?? {}) });
  if (opts.token !== null) headers.set("cookie", cookieHeader(opts.token ?? TEST_TOKEN));
  if (method !== "GET" && method !== "HEAD") {
    headers.set("origin", opts.origin === undefined ? `http://${host}` : (opts.origin ?? ""));
    headers.set("content-type", opts.contentType ?? "application/json");
  }
  const body =
    opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  return new NextRequest(`http://${host}${pathname}`, { method, headers, body });
}
