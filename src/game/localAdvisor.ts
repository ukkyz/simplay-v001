/**
 * Local (rule-based) executive advisor — ISOMORPHIC, no "use client".
 *
 * Runs in the browser as an instant fallback and on the server as the mandatory
 * fallback for /api/advisor, so the same grounded text is produced wherever the
 * decision is made. It only reads GameState and contains no credentials, no
 * network access and no DOM access.
 */
import { ARCHETYPES, ARCHETYPE_BY_ID, PHASE_CONFIG } from "./constants";
import { flows, priceFor, tradeCapacity } from "./engine";
import type { ExecRole, GameState } from "./types";

const KEY: Record<string, string[]> = {
  power: ["power", "kw", "energy", "brownout", "electric", "grid", "solar", "turbine"],
  money: ["money", "credit", "cash", "budget", "fund", "cost", "cheap", "afford", "runway", "treasury", "₡"],
  food: ["food", "ration", "farm", "eat", "starv", "crew feed"],
  build: ["build", "construct", "site", "sector", "warehouse", "factory", "which", "next", "expand", "plan"],
  schedule: ["time", "when", "schedule", "slow", "fast", "delay", "hour", "eta", "deadline"],
  risk: ["risk", "qa", "test", "fail", "quality", "safe", "problem"],
  trade: ["trade", "sell", "buy", "market", "price", "alliance", "bot", "deal", "export"],
  road: ["road", "route", "throughput", "freight", "logistic", "traffic"],
  morale: ["morale", "crew", "happy", "unhappy", "strike", "people"],
  cancel: ["cancel", "stop", "scrap", "kill", "abandon"],
};

const hit = (msg: string, k: string) => (KEY[k] ?? []).some((w) => msg.toLowerCase().includes(w));

function topProject(s: GameState) {
  return s.projects.filter((p) => p.phase !== "operate").sort((a, b) => a.risk - b.risk)[0] ?? null;
}

/** Deterministic, state-grounded advisor. No hallucinated numbers — it only
 *  reads from the live simulation, which is the same contract we give the LLMs. */
export function localAdvice(role: ExecRole, msg: string, s: GameState): string {
  const f = flows(s);
  const p = topProject(s);
  const arch = p ? ARCHETYPE_BY_ID[p.archetypeId] : null;
  const cash = Math.round(s.economy.credits);
  const burn = Math.round(f.upkeep - f.revenue);
  const runway = burn > 0 ? Math.round(s.economy.credits / burn) : Infinity;
  const e = s.execs.find((x) => x.role === role)!;
  const out: string[] = [];

  if (role === "cto") {
    if (hit(msg, "power") || f.brownout) {
      const gap = f.demanded - f.produced;
      if (gap > 0)
        out.push(`We are ${Math.round(gap)} kW short. Everything on the grid is running at 50% — that is a ${Math.round(f.upkeep * 0.35 * 0.5).toLocaleString()} ₡/h revenue hole. Sequence: Photovoltaic Field (26 h, −340 kW) is the fastest kilowatt in the catalogue; Turbine Hall (72 h, −980 kW) is the durable one. A Grid Substation adds +12% to all generation claim-wide and pays for itself once you have three generators.`);
      else
        out.push(
          `Grid is stable: ${f.produced} kW generated against ${f.demanded} kW demand — headroom ${Math.round(f.produced - f.demanded)} kW. Do not spend that headroom on an Induction Smelter; it alone draws 540 kW and will brownout the claim on its own.`,
        );
    }
    if (hit(msg, "risk") || hit(msg, "qa")) {
      if (p) out.push(`${arch?.name} is at ${p.phase} with design quality ${p.quality}% and risk ${p.risk}%. QA pass probability is roughly quality − 0.25×risk + my skill bonus ≈ ${Math.min(97, Math.round(p.quality - p.risk * 0.25 + e.skill * 0.1))}%. A failure costs 30% of build duration. If you want that number up, file a change request while we are still in Design — it is free there and buys +4 quality.`);
      else out.push("Nothing in the pipeline to QA. Commission a site and I will set the quality target at Design.");
    }
    if (hit(msg, "schedule") || hit(msg, "time")) {
      if (p) {
        const cfg = PHASE_CONFIG[p.phase];
        const remaining = Math.max(1, Math.round((arch?.hours ?? 20) * cfg.share)) * (1 - p.progress);
        out.push(`${arch?.name}: ${Math.round(remaining)} h left in ${cfg.label}. My load is ${e.load}% — above 85% I run at 70% speed, so do not stack more than two builds on me at once.`);
      } else out.push("No schedule to report. Give me a site and I will give you an ETA in hours.");
    }
    if (hit(msg, "build") || hit(msg, "which") || hit(msg, "next")) {
      const needPower = f.demanded > f.produced * 0.8;
      const rec = needPower ? "solar_field" : f.materials < 400 ? "assembly_line" : f.storageCap - s.economy.storageUsed < 200 ? "bulk_racks" : "robotics_bay";
      const a = ARCHETYPE_BY_ID[rec];
      out.push(`Engineering recommendation: ${a.name} (${a.area}, tier ${a.tier}). ${a.hours} h build, ₡${a.cost.toLocaleString()}, ${a.power < 0 ? `generates ${-a.power} kW` : `draws ${a.power} kW`}. Rationale: ${a.rationale}`);
    }
    if (!out.length)
      out.push(`Read of the plant: ${s.buildings.length} buildings live, ${s.projects.filter((x) => x.phase !== "operate").length} in pipeline, quality averaging ${s.projects.length ? Math.round(s.projects.reduce((a, b) => a + b.quality, 0) / s.projects.length) : 0}%. Lowest condition asset at ${s.buildings.length ? Math.round(Math.min(...s.buildings.map((b) => b.condition))) : 0}% — below 40% I lose 40% of its output. Ask me about power, schedule, QA risk or what to build next.`);
  }

  if (role === "cfo") {
    if (hit(msg, "money") || hit(msg, "budget") || hit(msg, "afford") || hit(msg, "runway")) {
      out.push(`Treasury ₡${cash.toLocaleString()}. Revenue ₡${Math.round(f.revenue).toLocaleString()}/h against upkeep ₡${Math.round(f.upkeep).toLocaleString()}/h. ${burn > 0 ? `We are burning ₡${burn.toLocaleString()}/h — runway ${runway} h.` : `We are net positive ₡${Math.abs(burn).toLocaleString()}/h.`}`);
    }
    if (hit(msg, "cancel")) {
      const worst = s.projects.filter((x) => x.phase !== "operate").sort((a, b) => b.risk - a.risk)[0];
      if (worst) {
        const refund = Math.round((worst.budget - worst.spent) * (worst.phase === "build" ? 0.35 : 0.85));
        out.push(`Cheapest exit: cancel ${ARCHETYPE_BY_ID[worst.archetypeId].name} in ${worst.phase}. Salvage ₡${refund.toLocaleString()}, morale −4. Cancelling in Design or Discover refunds 85%; once we are in Build it drops to 35% — that cliff is the whole reason to decide early.`);
      } else out.push("Nothing to cancel. Pipeline is empty, which is its own risk.");
    }
    if (hit(msg, "trade") || hit(msg, "price") || hit(msg, "sell")) {
      const bot = s.alliance[0];
      out.push(`Market: materials ₡${s.market.materials.toFixed(2)}, food ₡${s.market.food.toFixed(2)}. Best counterparty is ${bot.name} at relation ${bot.relation.toFixed(0)} — every point of relation moves price ${TRADESLOPE}%. Selling ${Math.round(s.economy.materials * 0.4)} materials now returns ≈₡${Math.round(priceFor(s, "materials", bot, "sell") * Math.min(tradeCapacity(s), s.economy.materials * 0.4)).toLocaleString()}. Remember the 6 h cooldown and the ${tradeCapacity(s)}-unit cap per deal.`);
    }
    if (hit(msg, "build") || hit(msg, "fund")) {
      const affordable = ARCHETYPES.filter((a) => a.cost * 1.15 < cash && a.unlockAt <= s.economy.level);
      out.push(`I can fund ${affordable.length} archetypes without touching contingency: ${affordable.slice(0, 5).map((a) => `${a.name} ₡${a.cost.toLocaleString()}`).join(", ") || "none — we are over-extended"}. My gate needs budget + 15% contingency in cash at Approve, or I block and you either wait or sign an override at 8% fee and −6 trust from me.`);
    }
    if (!out.length)
      out.push(`Position: ₡${cash.toLocaleString()} cash, ${s.projects.filter((x) => x.blockedReason).length} blocked request(s), morale ${s.economy.morale.toFixed(0)}. I approve funding, I price risk, and I will always rather cancel one project than starve three. Ask me about runway, what I can fund, cancelling, or trade pricing.`);
  }

  if (role === "coo") {
    if (hit(msg, "food") || hit(msg, "morale") || hit(msg, "crew")) {
      out.push(`Crew ${f.crew} heads need ${f.foodDemand.toFixed(1)} rations/h; we produce ${f.food.toFixed(1)}/h and hold ${Math.round(s.economy.food)} units — ${f.food >= f.foodDemand ? `${Math.round(s.economy.food / Math.max(0.1, f.food - f.foodDemand))} h of surplus` : `${Math.round(s.economy.food / Math.max(0.1, f.foodDemand - f.food))} h until the crew goes hungry`}. Every unresolved deficit hour costs 1.5 morale and morale below 55 drags every phase clock.`);
    }
    if (hit(msg, "road") || hit(msg, "logistic") || hit(msg, "throughput")) {
      out.push(`Roads: ${s.roads.map((r) => `${r.to} = grade ${r.grade} (${r.throughput} u/h)`).join(", ")}. Upgrading to Arterial costs ₡78,000 and lifts throughput to 900 u/h. Packaging & Freight adds +40% throughput each, Freight Depot +25% trade volume — that is how you move more units per deal without more roads.`);
    }
    if (hit(msg, "trade") || hit(msg, "alliance")) {
      out.push(`Alliance board: ${s.alliance.map((b) => `${b.name} relation ${b.relation.toFixed(0)} (${b.mood})`).join("; ")}. Relation rises 0.6 per completed deal and 1/h per Distribution Hub. Below 30 they go Cold and pricing degrades.`);
    }
    if (hit(msg, "build") || hit(msg, "site")) {
      const free = s.areas.flatMap((a) => a.sites.filter((si) => !si.buildingId && !s.projects.some((p) => p.siteId === si.id))).length;
      out.push(`${free} of 20 sites are free. Pipeline is ${s.projects.length}/6 — that cap is crew, not space. I own Discover and Deploy; keep two slots open for me or your deployments queue.`);
    }
    if (hit(msg, "storage") || s.economy.storageUsed > s.economy.storageCap) {
      out.push(`Storage ${s.economy.storageUsed}/${s.economy.storageCap} units. ${s.economy.storageUsed > s.economy.storageCap ? `We are over by ${s.economy.storageUsed - s.economy.storageCap} and losing 25% of the overflow every hour — sell it down or build Bulk Racking (₡29,000, +600 units, 18 h).` : `Headroom ${s.economy.storageCap - s.economy.storageUsed} units.`} Cold Store stops food spoilage outright.`);
    }
    if (!out.length)
      out.push(`Operations read: morale ${s.economy.morale.toFixed(0)}, ${s.buildings.length} live assets, ${s.economy.storageUsed}/${s.economy.storageCap} storage, ${s.remote.filter((r) => r.online).length} alliance CEOs online right now. I handle discovery, deployment, roads and the alliance desks. Ask me about food, roads, storage or trade.`);
  }

  return out.slice(0, 3).join("\n\n");
}

const TRADESLOPE = "0.35";

/** The four questions every new CEO asks the board. Seeded as chips. */
