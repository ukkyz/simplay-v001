import type { NextConfig } from "next";

/**
 * Simplayz runs as a single Node.js process with a persistent local filesystem.
 * Do not deploy this configuration to an ephemeral/serverless target: the SQLite
 * file would be lost (see README "Deployment").
 *
 * `serverExternalPackages` keeps the native better-sqlite3 addon out of the
 * bundler so it loads as a normal Node module in route handlers.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3"],
  // Dev-only: allow the Arena preview proxy host (*.e2b.app) to talk to the dev
  // server. `next dev` rejects unknown origins for /_next and HMR requests.
  // Production `next start` ignores this list; protections stay enabled.
  allowedDevOrigins: (process.env.SIMPLAYZ_DEV_ORIGINS ?? "*.e2b.app")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export default nextConfig;
