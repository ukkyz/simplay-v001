import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Static guardrails for the client boundary.
 *
 * These are structural assertions on the source tree, NOT browser tests. They
 * fail loudly if a future change puts a browser-only API into the server render
 * graph, or re-introduces a client-visible credential path.
 */
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("server rendering boundary", () => {
  it("loads the game shell with ssr:false from a client page", () => {
    const page = read("src/app/page.tsx");
    assert.match(page, /^"use client";/);
    assert.match(page, /ssr:\s*false/);
    assert.match(page, /import\("@\/components\/GameShell"\)/);
  });

  it("the root layout imports no client game code (its comments may mention it)", () => {
    const layout = read("src/app/layout.tsx");
    const imports = layout.split("\n").filter((l) => /^import\s/.test(l));
    assert.deepEqual(imports, ['import type { Metadata, Viewport } from "next";', 'import "./globals.css";']);
    assert.ok(!/from "@\/components|from "@\/state|from "leaflet"|from "three"/.test(layout));
  });

  it("every browser-facing component is a client component", () => {
    const dir = path.join(ROOT, "src/components");
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const src = fs.readFileSync(path.join(dir, file), "utf8");
      assert.match(src, /^"use client";/, `${file} must declare a client boundary`);
    }
    assert.match(read("src/state/store.tsx"), /^"use client";/);
  });

  it("marks the database and credential modules server-only", () => {
    for (const rel of [
      "src/server/db/client.ts",
      "src/server/db/saves.ts",
      "src/server/db/migrate.ts",
      "src/server/config.ts",
      "src/server/session.ts",
      "src/server/ai/config.ts",
      "src/server/ai/prompt.ts",
      "src/server/http/handler.ts",
    ]) {
      assert.match(read(rel), /^import "server-only";/, `${rel} must be server-only`);
    }
  });

  it("keeps every SQLite route on the Node.js runtime", () => {
    for (const rel of [
      "src/app/api/save/route.ts",
      "src/app/api/session/route.ts",
      "src/app/api/advisor/route.ts",
    ]) {
      const src = read(rel);
      assert.match(src, /export const runtime = "nodejs";/, `${rel} must pin the nodejs runtime`);
      assert.match(src, /export const dynamic = "force-dynamic";/);
    }
  });

  it("binds the dev/start server to 0.0.0.0 and keeps dev-origin allowlisting narrow", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.match(pkg.scripts.dev, /--hostname 0\.0\.0\.0/);
    assert.match(pkg.scripts.start, /--hostname 0\.0\.0\.0/);
    const cfg = read("next.config.ts");
    assert.match(cfg, /allowedDevOrigins/);
    assert.ok(!/dangerouslyAllowAnyOrigin|disableOriginCheck/i.test(cfg));
  });
});

describe("browser API usage", () => {
  it("uses only same-origin relative URLs for application APIs", () => {
    for (const rel of ["src/state/persistence.ts"]) {
      const src = read(rel);
      const absolute = src.match(/fetch\(\s*[`"']https?:/g);
      assert.equal(absolute, null, `${rel} must not call an absolute application URL`);
      assert.match(src, /\/api\/save/);
      assert.match(src, /credentials: "same-origin"/);
    }
    // The advisor client call is relative too.
    assert.match(read("src/game/advisor.ts"), /fetch\("\/api\/advisor"/);
  });

  it("never reads or writes a localStorage game save except the legacy migration key", () => {
    const store = read("src/state/store.tsx");
    const storeCode = store.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!storeCode.includes("localStorage"), "the store must not persist game state locally");
    assert.match(storeCode, /readLegacySave|clearLegacySave/);
    const persistence = read("src/state/persistence.ts");
    for (const line of persistence.split("\n")) {
      if (!line.includes("localStorage")) continue;
      if (/^\s*(\*|\/\*|\/\/)/.test(line)) continue; // comments
      assert.match(line, /window\.localStorage\.(get|remove)Item\(LEGACY_SAVE_KEY\)|LEGACY_SAVE_KEY/);
    }
  });

  it("has no client-visible credential fields or NEXT_PUBLIC secrets", () => {
    const files = walk("src");
    for (const file of files) {
      const src = read(path.relative(ROOT, file));
      if (/apiKey\s*[:=]\s*"[^"]+"/.test(src) && !file.endsWith("gameSave.ts"))
        assert.fail(`${file} contains a hardcoded credential`);
      // A comment that names the pattern is fine; using one is not.
      for (const line of src.split("\n"))
        if (line.includes("NEXT_PUBLIC_") && !/^\s*(\*|\/\/|\/\*)/.test(line) && !/must not|never|no NEXT_PUBLIC/i.test(line))
          assert.fail(`${file} uses a NEXT_PUBLIC_* variable: ${line.trim()}`);
    }
  });

  it("no longer depends on Vite or a single-file build", () => {
    const pkg = read("package.json");
    assert.ok(!/"vite"/.test(pkg));
    assert.ok(!/"vite-plugin-singlefile"/.test(pkg));
    assert.ok(!fs.existsSync(path.join(ROOT, "vite.config.ts")));
    assert.ok(!fs.existsSync(path.join(ROOT, "index.html")));
    assert.ok(!fs.existsSync(path.join(ROOT, "src/main.tsx")));
    // TICK_MS is still the simulation clock, so the tick constants remain.
    assert.match(read("src/state/store.tsx"), /export const TICK_MS = 1000/);
  });

  it("gates simulation ticks behind the save phase", () => {
    const store = read("src/state/store.tsx");
    // Ticks require the ready phase and, additionally, no unresolved conflict.
    assert.match(
      store,
      /if \(phase !== "ready" \|\| conflict \|\| !ui\.booted \|\| state\.speed === 0\) return;/,
    );
    assert.match(store, /if \(phase !== "ready"\) return;/);
    assert.match(store, /setInterval\(\(\) => dispatch\(\{ type: "tick" \}\)/);
  });

  it("offers explicit conflict recovery and legacy migration actions", () => {
    const store = read("src/state/store.tsx");
    assert.match(store, /acceptServerVersion/);
    assert.match(store, /overwriteWithLocal/);
    assert.match(store, /migrateLegacy/);
    const shell = read("src/components/GameShell.tsx");
    assert.match(shell, /TWO VERSIONS DIVERGED/);
    assert.match(shell, /MIGRATE BROWSER-SAVED PROGRESS/);
  });

  it("keeps OSM attribution in both map surfaces", () => {
    for (const rel of ["src/components/WorldMap.tsx", "src/components/Onboarding.tsx"]) {
      const src = read(rel);
      assert.match(src, /tile\.openstreetmap\.org/);
      assert.match(src, /attribution:.*(OpenStreetMap|openstreetmap\.org\/copyright)/);
    }
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path.join(ROOT, rel));
  }
  return out;
}
