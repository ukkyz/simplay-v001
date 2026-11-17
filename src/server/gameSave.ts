/**
 * Shared (isomorphic) game-save contract.
 *
 * This module is imported by BOTH the browser store and the server routes, so it
 * must stay free of `server-only`, Node built-ins, DOM APIs and secrets.
 *
 * Responsibilities:
 *  1. Strip credentials from a GameState before it is persisted or exported.
 *  2. Validate an untrusted save object (structure, numeric bounds, entity
 *     references) without rebalancing any economy value.
 */

import type { AIConfig, GameState } from "@/game/types";
import { ARCHETYPE_BY_ID } from "@/game/constants";

/** Game-save schema version understood by this build. */
export const GAME_SAVE_SCHEMA = 4;

/** Legacy browser-localStorage key (kept readable for a one-time migration). */
export const LEGACY_SAVE_KEY = "simplayz.save.v4";

/** Advisor preferences that are safe to persist (no endpoint/key secrets). */
export interface AdvisorPreferences {
  enabled: boolean;
  temperature: number;
}

/**
 * Secret-free advisor config. The live endpoint and API key are operator-owned
 * server environment values, never part of a player's game snapshot: both fields
 * are kept in the save shape for compatibility but are ALWAYS empty strings.
 */
export const SAFE_AI_CONFIG: AIConfig = {
  model: "",
  enabled: false,
  temperature: 0.6,
};

/** Advisor preference object with no credential fields at all. */
function safeAdvisorConfig(ai: AIConfig | undefined): AIConfig {
  return {
    model: typeof ai?.model === "string" ? ai.model : "",
    enabled: ai?.enabled === true,
    temperature: clampNumber(ai?.temperature, 0, 1.4, 0.6),
  };
}

/**
 * Remove every credential from a game snapshot.
 * `apiKey`/`baseUrl` are dropped (they used to hold player secrets), `model` is
 * retained as a non-secret display preference.
 */
export function stripSecrets(state: GameState): GameState {
  return {
    ...state,
    execs: state.execs.map((e) => ({ ...e, ai: safeAdvisorConfig(e.ai) })),
  };
}

/** JSON clone that also strips credentials; used for exports. */
export function toPersistableState(state: GameState): GameState {
  return stripSecrets(JSON.parse(JSON.stringify(state)) as GameState);
}

/**
 * Normalize a schema-4 blob found in browser localStorage before validation.
 *
 * The prototype stored per-exec `ai.apiKey` / `ai.baseUrl`. Those fields are not
 * uploaded: they are blanked here and then dropped by `stripSecrets`, and a
 * non-empty key anywhere else still fails validation. Nothing else in the save is
 * touched, so migration cannot silently rebalance a player's company.
 */
export function prepareLegacySave(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as { execs?: unknown };
  if (!Array.isArray(obj.execs)) return raw;
  return {
    ...obj,
    execs: obj.execs.map((e) => {
      if (!e || typeof e !== "object") return e;
      const exec = e as { ai?: Record<string, unknown> };
      return { ...exec, ai: { ...(exec.ai ?? {}), apiKey: "", baseUrl: "" } };
    }),
  };
}

/** Quick, cheap scan used to prove secrets are absent in responses/exports. */
export function containsSecretLikeKey(value: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (v: unknown): boolean => {
    if (!v || typeof v !== "object") return false;
    if (seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some(walk);
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      if (k === "apiKey" && typeof child === "string" && child.length > 0) return true;
      if (walk(child)) return true;
    }
    return false;
  };
  return walk(value);
}

/* ------------------------------ Validation ------------------------------ */

export interface ValidationResult {
  ok: boolean;
  /** Problem code list, e.g. ["claim.center.lat"] — no user data echoed. */
  errors: string[];
  /** Validated state with defaults applied where documented. */
  state?: GameState;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  return isNum(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/**
 * Validate an untrusted game save.
 *
 * Deliberately tolerant where the simulation legitimately produces extremes:
 *  - credits may be 0 (the tick floors negative cash at 0) — debt-like states
 *    such as negative net flow are accepted, large negative values are bounded
 *    only by magnitude, not rebalanced.
 *  - morale/reputation/condition are 0..100 by engine contract.
 * Everything rejected here is a structural or reference problem, not a balance
 * opinion: no value is rounded, clamped or "fixed" silently except for optional
 * advisor preferences and legacy `AIConfig` defaults.
 */
export function validateGameState(input: unknown): ValidationResult {
  const errors: string[] = [];
  const err = (path: string) => errors.push(path);

  if (!isObj(input)) return { ok: false, errors: ["<root>"] };

  if (input.schema !== GAME_SAVE_SCHEMA) err("schema");

  for (const key of ["ceoName", "company"] as const) {
    if (!isStr(input[key]) || (input[key] as string).length === 0) err(key);
  }
  if (isStr(input.ceoName) && input.ceoName.length > 64) err("ceoName.length");
  if (isStr(input.company) && input.company.length > 64) err("company.length");

  // ---- claim -------------------------------------------------------------
  const claim = input.claim;
  if (!isObj(claim)) err("claim");
  else {
    const center = claim.center;
    if (!isObj(center)) err("claim.center");
    else {
      if (!isNum(center.lat) || center.lat < -90 || center.lat > 90) err("claim.center.lat");
      if (!isNum(center.lng) || center.lng < -180 || center.lng > 180) err("claim.center.lng");
    }
    if (!isNum(claim.sideKm) || claim.sideKm < 1 || claim.sideKm > 200) err("claim.sideKm");
    if (!Array.isArray(claim.corners) || claim.corners.length < 3) err("claim.corners");
    if (claim.placedBy !== "geolocation" && claim.placedBy !== "manual") err("claim.placedBy");
  }

  // ---- economy -----------------------------------------------------------
  const econ = input.economy;
  if (!isObj(econ)) err("economy");
  else {
    const nonNegative: [string, number][] = [
      ["materials", 1e9],
      ["food", 1e9],
      ["powerProduced", 1e9],
      ["storageUsed", 1e9],
      ["storageCap", 1e9],
      ["xp", 1e12],
      ["brownouts", 1e9],
      ["overflowWaste", 1e12],
    ];
    for (const [key, max] of nonNegative) {
      const v = econ[key];
      if (!isNum(v) || v < 0 || v > max) err(`economy.${key}`);
    }
    // Built projects in `build`/`test` draw 25% of their archetype power even
    // when the archetype is a generator, so demanded can legitimately be negative.
    if (!isNum(econ.powerDemanded) || econ.powerDemanded < -1e9 || econ.powerDemanded > 1e9)
      err("economy.powerDemanded");
    // Credits: bounded magnitude, may legitimately be 0 or large. Debt is
    // allowed (the engine floors at 0, but an imported legacy save can hold a
    // small negative from older builds) — do not rebalance.
    if (!isNum(econ.credits) || econ.credits < -1e9 || econ.credits > 1e12) err("economy.credits");
    for (const key of ["morale", "reputation"] as const) {
      const v = econ[key];
      if (!isNum(v) || v < 0 || v > 100) err(`economy.${key}`);
    }
    if (!isNum(econ.level) || econ.level < 1 || econ.level > 99) err("economy.level");
    if (!isNum(econ.tick) || econ.tick < 0 || econ.tick > 1e8) err("economy.tick");
  }

  // ---- market ------------------------------------------------------------
  if (!isObj(input.market)) err("market");
  else
    for (const key of ["materials", "food", "power"] as const) {
      const v = (input.market as Obj)[key];
      if (!isNum(v) || v <= 0 || v > 1e6) err(`market.${key}`);
    }

  // ---- areas / sites -----------------------------------------------------
  const buildingIds = new Set<string>();
  const buildings = input.buildings;
  if (!Array.isArray(buildings)) err("buildings");
  else {
    if (buildings.length > 400) err("buildings.length");
    buildings.forEach((b, i) => {
      const at = `buildings[${i}]`;
      if (!isObj(b)) return err(at);
      for (const key of ["id", "areaId", "siteId", "archetypeId"] as const) {
        if (!isStr(b[key])) err(`${at}.${key}`);
      }
      if (isStr(b.id)) {
        if (buildingIds.has(b.id)) err(`${at}.id.duplicate`);
        buildingIds.add(b.id);
      }
      if (isStr(b.archetypeId) && !ARCHETYPE_BY_ID[b.archetypeId]) err(`${at}.archetypeId`);
      if (!isNum(b.condition) || b.condition < 0 || b.condition > 100) err(`${at}.condition`);
      if (typeof b.operational !== "boolean") err(`${at}.operational`);
      const plan = b.plan;
      if (!validPlan(plan)) err(`${at}.plan`);
    });
  }

  const areas = input.areas;
  const siteIds = new Set<string>();
  const siteBuildingRefs: { site: string; buildingId: unknown }[] = [];
  if (!Array.isArray(areas)) err("areas");
  else {
    if (areas.length > 64) err("areas.length");
    areas.forEach((a, i) => {
      const at = `areas[${i}]`;
      if (!isObj(a)) return err(at);
      if (!isStr(a.id)) err(`${at}.id`);
      if (!isStr(a.kind)) err(`${at}.kind`);
      if (!isNum(a.index)) err(`${at}.index`);
      if (!Array.isArray(a.sites)) return err(`${at}.sites`);
      if (a.sites.length > 64) err(`${at}.sites.length`);
      a.sites.forEach((s, j) => {
        const sat = `${at}.sites[${j}]`;
        if (!isObj(s)) return err(sat);
        if (!isStr(s.id)) err(`${sat}.id`);
        else {
          if (siteIds.has(s.id)) err(`${sat}.id.duplicate`);
          siteIds.add(s.id);
        }
        if (s.buildingId !== null && !isStr(s.buildingId)) err(`${sat}.buildingId`);
        siteBuildingRefs.push({ site: sat, buildingId: s.buildingId });
      });
    });
  }
  for (const ref of siteBuildingRefs)
    if (isStr(ref.buildingId) && !buildingIds.has(ref.buildingId)) err(`${ref.site}.buildingId`);

  // ---- projects ----------------------------------------------------------
  const projects = input.projects;
  if (!Array.isArray(projects)) err("projects");
  else {
    if (projects.length > 64) err("projects.length");
    const phases = new Set(["discover", "design", "approve", "build", "test", "deploy", "operate"]);
    projects.forEach((p, i) => {
      const at = `projects[${i}]`;
      if (!isObj(p)) return err(at);
      if (!isStr(p.id)) err(`${at}.id`);
      if (!isStr(p.areaId) || !siteIds.has(p.areaId)) {
        // areaId must reference an area id (validated below by kind lookup)
      }
      if (isStr(p.archetypeId) && !ARCHETYPE_BY_ID[p.archetypeId]) err(`${at}.archetypeId`);
      if (!isStr(p.phase) || !phases.has(p.phase)) err(`${at}.phase`);
      if (!isNum(p.progress) || p.progress < 0 || p.progress > 1) err(`${at}.progress`);
      if (!isNum(p.quality) || p.quality < 0 || p.quality > 100) err(`${at}.quality`);
      if (!isNum(p.risk) || p.risk < 0 || p.risk > 100) err(`${at}.risk`);
      if (!isNum(p.budget) || p.budget < 0 || p.budget > 1e9) err(`${at}.budget`);
      if (!isNum(p.spent) || p.spent < -1e9 || p.spent > 1e9) err(`${at}.spent`);
      if (isStr(p.siteId) && !siteIds.has(p.siteId)) err(`${at}.siteId`);
      if (p.buildingId !== null && !(isStr(p.buildingId) && buildingIds.has(p.buildingId)))
        err(`${at}.buildingId`);
      if (p.draft != null && !validPlan(p.draft)) err(`${at}.draft`);
      if (p.blockedReason !== null && !isStr(p.blockedReason)) err(`${at}.blockedReason`);
    });
    const areaIds = new Set(
      Array.isArray(areas) ? areas.filter(isObj).map((a) => a.id).filter(isStr) : [],
    );
    projects.forEach((p, i) => {
      if (isObj(p) && isStr(p.areaId) && !areaIds.has(p.areaId)) err(`projects[${i}].areaId`);
    });
  }

  // ---- execs / advisor preferences --------------------------------------
  const execs = input.execs;
  if (!Array.isArray(execs)) err("execs");
  else
    execs.forEach((e, i) => {
      const at = `execs[${i}]`;
      if (!isObj(e)) return err(at);
      if (!isStr(e.role)) err(`${at}.role`);
      if (!isNum(e.skill) || e.skill < 0 || e.skill > 100) err(`${at}.skill`);
      if (!isNum(e.load) || e.load < 0 || e.load > 100) err(`${at}.load`);
      if (!isNum(e.trust) || e.trust < 0 || e.trust > 100) err(`${at}.trust`);
      if (!isObj(e.ai)) err(`${at}.ai`);
      else {
        // Credentials are never accepted in a persisted snapshot. A schema-4
        // save written by the old prototype stored `baseUrl: "https://api..."`;
        // that is a non-secret default URL, so only a non-URL value is a
        // credential-shaped payload (and stripSecrets removes it either way).
        if ("apiKey" in e.ai && e.ai.apiKey !== "") err(`${at}.ai.apiKey`);
        if ("baseUrl" in e.ai && e.ai.baseUrl !== "" && !isKnownProviderUrl(e.ai.baseUrl))
          err(`${at}.ai.baseUrl`);
        if (typeof e.ai.enabled !== "boolean") err(`${at}.ai.enabled`);
      }
    });

  // ---- alliance / roads / remote / log ----------------------------------
  if (!Array.isArray(input.alliance)) err("alliance");
  if (!Array.isArray(input.roads)) err("roads");
  if (!Array.isArray(input.remote)) err("remote");
  if (!Array.isArray(input.log)) err("log");
  else if (input.log.length > 2000) err("log.length");
  if (!Array.isArray(input.questions)) err("questions");
  if (![0, 1, 4, 16].includes(input.speed as number)) err("speed");
  if (!isNum(input.createdAt) || input.createdAt < 0) err("createdAt");

  if (errors.length) return { ok: false, errors: errors.slice(0, 25) };

  return { ok: true, errors: [], state: normalizeAdvisorConfig(input as unknown as GameState) };
}

/** Non-secret default provider URLs legacy saves may legitimately still carry. */
const KNOWN_PROVIDER_URLS = new Set(["https://api.openai.com/v1"]);

function isKnownProviderUrl(value: unknown): boolean {
  return typeof value === "string" && KNOWN_PROVIDER_URLS.has(value.replace(/\/+$/, ""));
}

function validPlan(plan: unknown): boolean {
  if (!isObj(plan)) return false;
  if (!isStr(plan.id) || !isStr(plan.name)) return false;
  if (!isNum(plan.w) || !isNum(plan.h) || plan.w < 1 || plan.h < 1) return false;
  if (plan.w > 256 || plan.h > 256) return false;
  if (!isNum(plan.storeys) || plan.storeys < 1 || plan.storeys > 16) return false;
  if (!Array.isArray(plan.cells) || plan.cells.length !== plan.w * plan.h) return false;
  return plan.cells.every((c) => isObj(c) && [0, 1, 2, 3, 4].includes(c.t as number));
}

/**
 * Normalize only advisor *preferences*: keep enabled/model/temperature, drop any
 * credential fields a legacy save may still carry. Everything else is returned
 * untouched so no economy value is silently rewritten.
 */
function normalizeAdvisorConfig(state: GameState): GameState {
  return {
    ...state,
    execs: state.execs.map((e) => ({ ...e, ai: safeAdvisorConfig(e.ai) })),
  };
}
