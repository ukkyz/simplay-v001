/**
 * Isomorphic city digest (GDD §7). Pure: reads GameState only.
 *
 * Shared by the boardroom (which displays it and forwards it to the advisor
 * proxy) and by the server (which builds the model system prompt from it). It is
 * derived, read-only context — never persisted and never authoritative.
 */
import { ARCHETYPE_BY_ID } from "./constants";
import { flows, systemMods } from "./engine";
import type { GameState } from "./types";

export function stateDigest(s: GameState): string {
  const f = flows(s);
  const mods = systemMods(s);
  const active = s.projects.filter((p) => p.phase !== "operate");
  return [
    `CITY DIGEST — ${s.company}, CEO ${s.ceoName}`,
    `Sim hour ${s.economy.tick} (day ${(s.economy.tick / 24).toFixed(1)}), CEO level ${s.economy.level}, XP ${Math.round(s.economy.xp)}`,
    `Treasury ₡${Math.round(s.economy.credits).toLocaleString()} | net ₡${Math.round(f.netCredits).toLocaleString()}/h | upkeep ₡${Math.round(f.upkeep).toLocaleString()}/h | service revenue ₡${Math.round(f.revenue).toLocaleString()}/h`,
    `Power ${f.produced} kW generated vs ${f.demanded} kW demanded${f.brownout ? " — BROWNOUT, output halved" : " — balanced"}`,
    `Food ${Math.round(s.economy.food).toLocaleString()} units, net ${f.food >= f.foodDemand ? "+" : ""}${(f.food - f.foodDemand).toFixed(1)}/h (crew demand ${f.foodDemand.toFixed(1)}/h for ${f.crew} crew)`,
    `Materials ${Math.round(s.economy.materials).toLocaleString()} units, net +${f.materials.toFixed(1)}/h`,
    `Storage ${s.economy.storageUsed}/${s.economy.storageCap}${s.economy.storageUsed > s.economy.storageCap ? " — OVER CAPACITY, spoiling 25%/h" : ""}`,
    `Morale ${s.economy.morale.toFixed(0)}/100 | reputation ${s.economy.reputation.toFixed(0)}/100 | brownout hours ${s.economy.brownouts}`,
    `Buildings operational: ${s.buildings.length} (${s.buildings.map((b) => ARCHETYPE_BY_ID[b.archetypeId]?.name).join(", ") || "none"})`,
    `Projects in pipeline: ${active.length}/6 — ${active.map((p) => `${ARCHETYPE_BY_ID[p.archetypeId]?.name}@${p.phase}${p.blockedReason ? "(BLOCKED)" : ""}`).join("; ") || "none"}`,
    `Systemic modifiers active: gen ×${mods.genBonus.toFixed(2)}, food ×${mods.foodBonus.toFixed(2)}, road ×${mods.roadBonus.toFixed(2)}`,
    `Alliance: ${s.alliance.map((b) => `${b.name} relation ${b.relation.toFixed(0)}`).join(" | ")}`,
  ].join("\n");
}
