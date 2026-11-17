import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit only generates SQL migration files here (`npm run db:generate`).
 * Applying them is done by `npm run db:migrate` (src/server/db/migrate.ts) and
 * lazily by the server itself at boot, so operators have one obvious path.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
