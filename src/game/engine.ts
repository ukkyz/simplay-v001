import {
  AREA_META,
  ARCHETYPE_BY_ID,
  BASE_PRICES,
  BUILD,
  EXEC_META,
  MARKET,
  PHASE_CONFIG,
  ROAD_GRADES,
  TUNABLES,
  TRADE,
  OPEN_QUESTIONS,
  LEVELS,
} from "./constants";
import { claimCorners, formatLL, hashString, mulberry32, offsetLL, roadPath } from "./geo";
import { generatePlan } from "./plans";
import { WORLD_PERSONAS } from "./world";
import { PHASES } from "./types";
import type {
  AIConfig,
  AllianceBot,
  AreaKind,
  Building,
  Claim,
  Commodity,
  ExecRole,
  ExecState,
  FloorPlan,
  GameState,
  LogEntry,
  Phase,
  Project,
  RemoteCeo,
  ResourceArea,
  Road,
  Screen,
} from "./types";

/* ------------------------------------------------------------------ *
 * SIMPLAYZ — Simulation engine (GDD §6 loops, §9 numbers)
 * Pure reducer + pure tick. No React, no timers, no side effects.
 * ------------------------------------------------------------------ */

const DEFAULT_AI: AIConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.6,
  enabled: false,
};

const BOT_NAMES = [
  ["HALDEN MERCANTILE", "supplier"],
  ["VOSTOK FREIGHT CO.", "offtaker"],
] as const;

/**
 * The simulated cast is defined once, in `src/game/world.ts`, and shared with the
 * server-side AI roster so the map cannot show two different casts. This local
 * copy is only a fallback for `state.remote` when `/api/world` is unreachable.
 */
const PEER_NAMES = WORLD_PERSONAS;

export const QUADRANT: Record<number, { dx: number; dy: number }> = {
  0: { dx: 2, dy: 2 },
  1: { dx: -2, dy: 2 },
  2: { dx: -2, dy: -2 },
  3: { dx: 2, dy: -2 },
};

const SITE_OFFSETS: [number, number][] = [
  [-1.15, 0.75],
  [0.05, 1.2],
  [1.2, 0.7],
  [-0.75, -0.95],
  [0.9, -1.0],
];

export function areaCenter(claim: Claim, areaIndex: number) {
  const q = QUADRANT[areaIndex] ?? QUADRANT[0];
  return offsetLL(claim.center, q.dx, q.dy);
}
export function siteLL(claim: Claim, areaIndex: number, siteIndex: number) {
  const c = areaCenter(claim, areaIndex);
  const [dx, dy] = SITE_OFFSETS[siteIndex] ?? [0, 0];
  return offsetLL(c, dx, dy);
}

/* ------------------------------ Actions ------------------------------ */

export type Action =
  | { type: "register"; ceoName: string; company: string; lat: number; lng: number; placedBy: "geolocation" | "manual" }
  | { type: "tick" }
  | { type: "speed"; speed: 0 | 1 | 4 | 16 }
  | { type: "specArea"; areaId: string; kind: AreaKind }
  | { type: "startProject"; areaId: string; siteIndex: number; archetypeId: string }
  | { type: "cancelProject"; projectId: string }
  | { type: "overrideBlock"; projectId: string }
  | { type: "changeRequest"; projectId: string }
  | { type: "updatePlan"; plan: FloorPlan; targetId: string }
  | { type: "trade"; botId: string; commodity: Commodity; dir: "buy" | "sell"; qty: number }
  | { type: "upgradeRoad"; roadId: string }
  | { type: "maintain"; buildingId: string }
  | { type: "setAI"; role: ExecRole; patch: Partial<AIConfig> }
  | { type: "setStance"; role: ExecRole; stance: ExecState["stance"] }
  | { type: "answer"; id: string; answer: string }
  | { type: "log"; entry: Omit<LogEntry, "tick"> }
  | { type: "hydrate"; state: GameState }
  | { type: "reset" };

/* --------------------------- Initialisation --------------------------- */

function makeExecs(): ExecState[] {
  return (["cto", "cfo", "coo"] as ExecRole[]).map((role) => ({
    role,
    name: EXEC_META[role].name,
    callsign: EXEC_META[role].callsign,
    skill: role === "cto" ? 58 : role === "cfo" ? 64 : 52,
    load: 12,
    trust: 62,
    stance: "balanced",
    ai: { ...DEFAULT_AI },
  }));
}

function makeBots(center: { lat: number; lng: number }, seed: number): { bots: AllianceBot[]; roads: Road[] } {
  const rnd = mulberry32(seed);
  const bots: AllianceBot[] = [];
  const roads: Road[] = [];
  BOT_NAMES.forEach(([name, kind], i) => {
    const ang = i === 0 ? 0.72 : 3.6;
    const dist = 5.2 + rnd() * 1.9;
    const ll = offsetLL(center, Math.cos(ang) * dist, Math.sin(ang) * dist);
    const id = `bot_${i}`;
    const rel = 42 + Math.round(rnd() * 12);
    bots.push({
      id,
      name,
      kind,
      lat: ll.lat,
      lng: ll.lng,
      relation: rel,
      inventory: {
        credits: 90_000 + Math.round(rnd() * 60_000),
        materials: kind === "supplier" ? 5_200 : 900,
        food: kind === "offtaker" ? 2_400 : 380,
        power: 1_600,
      },
      buyPrice: { ...BASE_PRICES },
      sellPrice: { ...BASE_PRICES },
      dealsDone: 0,
      lastTradeTick: -99,
      mood: "Cordial",
    });
    roads.push({
      id: `road_${id}`,
      from: "claim",
      to: id,
      path: roadPath(center, ll, i + 3),
      grade: 2,
      throughput: ROAD_GRADES[2].throughput,
    });
  });
  return { bots, roads };
}

function makePeers(center: { lat: number; lng: number }, seed: number): { peers: RemoteCeo[]; roads: Road[] } {
  const rnd = mulberry32(seed + 991);
  const peers: RemoteCeo[] = [];
  const roads: Road[] = [];
  PEER_NAMES.forEach((p, i) => {
    const ang = 0.4 + i * 1.55 + rnd() * 0.4;
    const dist = 11 + rnd() * 14;
    const ll = offsetLL(center, Math.cos(ang) * dist, Math.sin(ang) * dist);
    const allied = i < 2;
    const kinds = Object.keys(ARCHETYPE_BY_ID);
    const count = 1 + Math.floor(rnd() * 3);
    const buildings = Array.from({ length: count }, (_, b) => {
      const archId = kinds[Math.floor(rnd() * kinds.length)];
      const arch = ARCHETYPE_BY_ID[archId];
      return {
        id: `rb_${i}_${b}`,
        archetypeId: archId,
        name: `${arch.name} · ${p.handle.slice(1, 6).toUpperCase()}`,
        plan: generatePlan(arch, `${p.handle}-${b}`),
        crew: arch.crew,
      };
    });
    peers.push({
      id: `peer_${i}`,
      name: p.name,
      handle: p.handle,
      lat: ll.lat,
      lng: ll.lng,
      online: rnd() > 0.35,
      alliance: allied,
      reputation: 38 + Math.round(rnd() * 55),
      buildings,
      lastSeenTick: 0,
      color: p.color,
    });
    if (allied)
      roads.push({
        id: `road_peer_${i}`,
        from: "claim",
        to: `peer_${i}`,
        path: roadPath(center, ll, i + 21),
        grade: 1,
        throughput: ROAD_GRADES[1].throughput,
      });
  });
  return { peers, roads };
}

export function createGame(
  ceoName: string,
  company: string,
  lat: number,
  lng: number,
  placedBy: "geolocation" | "manual",
): GameState {
  const center = { lat, lng };
  const sideKm = TUNABLES.claimSideKm.v;
  const claim: Claim = {
    center,
    sideKm,
    corners: claimCorners(center, sideKm),
    placedBy,
  };
  const seed = hashString(`${lat.toFixed(3)}:${lng.toFixed(3)}:${company}`);

  const kinds: AreaKind[] = ["energy", "food", "factory", "warehouse"];
  const areas: ResourceArea[] = kinds.map((kind, i) => ({
    id: `area_${i}`,
    kind,
    index: i,
    level: 1,
    sites: Array.from({ length: TUNABLES.maxSites.v }, (_, s) => ({
      id: `site_${i}_${s}`,
      areaId: `area_${i}`,
      index: s,
      status: "empty",
      buildingId: null,
    })),
  }));

  const { bots, roads: botRoads } = makeBots(center, seed);
  const { peers, roads: peerRoads } = makePeers(center, seed);

  return {
    schema: 4,
    ceoName,
    company,
    createdAt: Date.now(),
    claim,
    areas,
    buildings: [],
    projects: [],
    execs: makeExecs(),
    alliance: bots,
    roads: [...botRoads, ...peerRoads],
    remote: peers,
    economy: {
      credits: TUNABLES.startCredits.v,
      materials: TUNABLES.startMaterials.v,
      food: TUNABLES.startFood.v,
      powerProduced: 0,
      powerDemanded: 0,
      storageUsed: 0,
      storageCap: 400,
      morale: 78,
      reputation: 30,
      level: 1,
      xp: 0,
      tick: 0,
      brownouts: 0,
      overflowWaste: 0,
    },
    market: { ...BASE_PRICES },
    log: [
      { tick: 0, kind: "diplo", text: `Claim registered — ${sideKm}×${sideKm} km (${sideKm * sideKm} km²) at ${formatLL(center)}. Title issued by the Simplayz Land Registry.` },
      { tick: 0, kind: "diplo", text: `Two alliance partners auto-provisioned within 7 km: ${bots.map((b) => b.name).join(", ")}. Service roads surveyed.` },
      { tick: 0, kind: "exec", text: "Executive board online: CTO ATLAS, CFO LEDGER, COO RELAY. Configure their model endpoints in the Boardroom." },
    ],
    speed: 1,
    netMode: "local-sim",
    questions: OPEN_QUESTIONS.map((q) => ({ ...q })),
    changelogSeen: "0.4.0",
  };
}

/**
 * GDD §7.2 — Pre-rolled city. A new CEO who skips registration should land in a
 * city that already demonstrates every loop: deployed assets, an in-flight
 * pipeline, a funded treasury, live alliance relations and 274 hours of log.
 */
export function demoGame(): GameState {
  let g = createGame("Dana Reyes", "MERIDIAN WORKS", 51.5072, -0.1276, "manual");

  const first: [number, number, string][] = [
    [0, 0, "solar_field"],
    [0, 1, "battery_bank"],
    [1, 0, "vertical_farm"],
    [3, 0, "bulk_racks"],
  ];
  for (const [a, s, arch] of first)
    g = reducer(g, { type: "startProject", areaId: `area_${a}`, siteIndex: s, archetypeId: arch });
  for (let i = 0; i < 190; i++) g = reducer(g, { type: "tick" });

  // Founder's grant — demo-only injection so the board opens healthy instead of
  // mid-death-spiral. Real starts get the 250k from TUNABLES.startCredits only.
  g.economy.credits += 460_000;
  g.economy.materials += 2_600;
  g.economy.food += 900;
  g.economy.morale = 82;
  g.log = [
    { tick: g.economy.tick, kind: "econ" as const, text: "Founder's grant released: ₡460,000, 2,600 materials, 900 rations. (Demo-only injection — a registered start gets ₡250,000.)" },
    ...g.log,
  ].slice(0, TUNABLES.maxLog.v);

  const second: [number, number, string][] = [
    [2, 0, "assembly_line"],
    [1, 1, "aquaponics"],
    [0, 2, "turbine_hall"],
    [3, 1, "freight_depot"],
  ];
  for (const [a, s, arch] of second) {
    g.economy.level = Math.max(g.economy.level, ARCHETYPE_BY_ID[arch].unlockAt);
    g = reducer(g, { type: "startProject", areaId: `area_${a}`, siteIndex: s, archetypeId: arch });
  }
  for (let i = 0; i < 34; i++) g = reducer(g, { type: "tick" });
  g = reducer(g, { type: "trade", botId: "bot_0", commodity: "materials", dir: "buy", qty: 220 });
  for (let i = 0; i < 6; i++) g = reducer(g, { type: "tick" });
  g.speed = 1;
  return g;
}

/* ------------------------------ Selectors ------------------------------ */

export function systemMods(s: GameState) {
  const has = (id: string) => s.buildings.some((b) => b.archetypeId === id && b.operational);
  const count = (id: string) => s.buildings.filter((b) => b.archetypeId === id && b.operational).length;
  return {
    genBonus: 1 + (has("substation") ? 0.12 : 0),
    foodBonus: 1 + (has("seed_vault") ? 0.08 : 0),
    xpBonus: 1 + (has("rnd_workshop") ? 0.18 : 0),
    roadBonus: 1 + count("packaging") * 0.4,
    tradeBonus: 1 + count("freight_depot") * 0.25,
    relationRate: count("distribution_hub"),
    coldStore: count("cold_store") > 0,
  };
}

export function flows(s: GameState) {
  const mods = systemMods(s);
  const ops = s.buildings.filter((b) => b.operational);
  let produced = 0;
  let demanded = 0;
  let food = 0;
  let materials = 0;
  let storageCap = 400; // GDD §9: the claim itself has a 400-unit bonded yard
  let upkeep = 0;
  let crew = 0;
  for (const b of ops) {
    const a = ARCHETYPE_BY_ID[b.archetypeId];
    if (!a) continue;
    const cond = b.condition < 40 ? 0.6 : 1;
    if (a.power < 0) produced += -a.power * mods.genBonus * cond;
    else demanded += a.power * cond;
    food += a.food * mods.foodBonus * cond;
    materials += a.materials * cond;
    storageCap += a.storage;
    upkeep += a.upkeep;
    crew += a.crew;
  }
  // in-flight builds draw crew + a quarter of the future upkeep
  for (const p of s.projects) {
    const a = ARCHETYPE_BY_ID[p.archetypeId];
    if (!a) continue;
    if (p.phase === "build" || p.phase === "test") {
      crew += Math.ceil(a.crew * 0.6);
      demanded += a.power * 0.25;
      upkeep += a.upkeep * 0.25;
    }
  }
  const moraleF = 0.5 + s.economy.morale / 200;
  const brownout = demanded > 0 && produced < demanded;
  const powerF = brownout ? TUNABLES.brownoutPenalty.v : 1;
  const eff = moraleF * powerF;
  const foodDemand = crew * 0.4; // 1 ration unit = 2.5 crew-hours
  const revenue = brownout || food < foodDemand ? upkeep * 0.35 * 0.5 : upkeep * 0.35;
  return {
    // Negative net demand is a real state: a claim can generate more power than
    // it draws (e.g. a half-built smelter drawing at 25%). Validation must accept
    // it, so it is not floored here.
    produced: Math.round(produced),
    demanded: Math.round(demanded),
    food: food * eff,
    foodDemand,
    materials: materials * eff,
    storageCap,
    upkeep,
    crew,
    revenue: revenue + s.economy.level * 250, // civic dividend scales with CEO level
    brownout,
    eff,
    mods,
    netCredits: revenue - upkeep,
  };
}

export function priceFor(s: GameState, c: "materials" | "food" | "power", bot: AllianceBot, dir: "buy" | "sell") {
  const base = s.market[c] ?? BASE_PRICES[c];
  const rel = bot.relation / 100;
  const slope = TRADE.relationPriceSlope;
  const spread = dir === "buy" ? 1.1 : 0.9;
  const relF = dir === "buy" ? 1 - slope * rel : 1 + slope * rel;
  const kindF =
    (bot.kind === "supplier" && c === "materials") || (bot.kind === "offtaker" && c === "food") ? 0.92 : 1.04;
  return Math.max(1, Math.round(base * spread * relF * kindF * 100) / 100);
}

export function tradeCapacity(s: GameState) {
  return Math.round(TRADE.volumeCapBase * systemMods(s).tradeBonus);
}

/* ------------------------------- Reducer ------------------------------- */

function pushLog(s: GameState, e: Omit<LogEntry, "tick">): LogEntry[] {
  const next = [{ ...e, tick: s.economy.tick }, ...s.log];
  return next.slice(0, TUNABLES.maxLog.v);
}

function phaseHours(archId: string, phase: Phase, project: Project): number {
  const a = ARCHETYPE_BY_ID[archId];
  if (!a) return 4;
  const cfg = PHASE_CONFIG[phase];
  const base = Math.max(cfg.min, Math.round(a.hours * cfg.share));
  const crPenalty = 1 + project.changeRequests * 0.12;
  return phase === "build" || phase === "test" ? Math.round(base * crPenalty) : base;
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "register":
      return createGame(action.ceoName, action.company, action.lat, action.lng, action.placedBy);

    case "hydrate":
      return action.state;

    case "reset":
      return createGame(state.ceoName, state.company, state.claim?.center.lat ?? 0, state.claim?.center.lng ?? 0, state.claim?.placedBy ?? "manual");

    case "speed":
      return { ...state, speed: action.speed };

    case "specArea": {
      const area = state.areas.find((a) => a.id === action.areaId);
      if (!area) return state;
      // Locked once anything is built or in flight — otherwise an in-flight
      // project would reference an archetype that no longer belongs to the sector.
      if (area.sites.some((si) => si.buildingId)) return state;
      if (state.projects.some((p) => p.areaId === area.id && p.phase !== "operate"))
        return {
          ...state,
          log: pushLog(state, {
            kind: "alert",
            text: `Cannot re-specify ${AREA_META[area.kind].label} sector — a project is in flight there. Cancel it first.`,
            who: "coo",
          }),
        };
      if (state.areas.some((a) => a.id !== area.id && a.kind === action.kind)) return state;
      const areas = state.areas.map((a) => (a.id === action.areaId ? { ...a, kind: action.kind } : a));
      return {
        ...state,
        areas,
        log: pushLog(state, { kind: "build", text: `Sector ${area.index + 1} re-specified as ${AREA_META[action.kind].label}.`, who: "coo" }),
      };
    }

    case "startProject": {
      const area = state.areas.find((a) => a.id === action.areaId);
      if (!area) return state;
      const site = area.sites[action.siteIndex];
      if (!site || site.buildingId) return state;
      if (state.projects.some((p) => p.siteId === site.id)) return state;
      const arch = ARCHETYPE_BY_ID[action.archetypeId];
      if (!arch || arch.area !== area.kind) return state;
      if (state.economy.level < arch.unlockAt) return state;
      // Cap counts *active* projects only — deployed ones leave the pipeline.
      if (state.projects.filter((p) => p.phase !== "operate").length >= 6)
        return {
          ...state,
          log: pushLog(state, {
            kind: "alert",
            text: "Pipeline capped at 6 concurrent projects — the board refuses to spread crew thinner. Wait for a Deploy or cancel one.",
            who: "coo",
          }),
        };

      const cto = state.execs.find((e) => e.role === "cto")!;
      const quality = Math.min(98, Math.round(38 + cto.skill * 0.5 + (cto.stance === "cautious" ? 8 : cto.stance === "aggressive" ? -6 : 0)));
      const risk = Math.max(4, Math.round(arch.tier * 14 + (100 - quality) * 0.4));
      const pid = `prj_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`;
      const project: Project = {
        id: pid,
        draft: generatePlan(arch, pid, 1),
        buildingId: null,
        areaId: area.id,
        siteId: site.id,
        archetypeId: arch.id,
        phase: "discover",
        progress: 0,
        owner: PHASE_CONFIG.discover.owner,
        budget: Math.round(arch.cost * (1 + BUILD.budgetContingency)),
        spent: 0,
        quality,
        risk,
        changeRequests: 0,
        blockedReason: null,
        startedTick: state.economy.tick,
        testAttempts: 0,
      };
      const areas = state.areas.map((a) =>
        a.id !== area.id
          ? a
          : { ...a, sites: a.sites.map((si) => (si.id === site.id ? { ...si, status: "surveyed" as const } : si)) },
      );
      return {
        ...state,
        areas,
        projects: [...state.projects, project],
        log: pushLog(state, {
          kind: "build",
          text: `${arch.name} commissioned at ${AREA_META[area.kind].label} Sector, site ${site.index + 1}. Budget ₡${project.budget.toLocaleString()} · design quality ${quality}%.`,
          who: "coo",
        }),
      };
    }

    case "cancelProject": {
      const p = state.projects.find((x) => x.id === action.projectId);
      if (!p) return state;
      const refund = Math.max(0, (p.budget - p.spent) * (p.phase === "build" ? 0.35 : 0.85));
      const areas = state.areas.map((a) =>
        a.id !== p.areaId ? a : { ...a, sites: a.sites.map((si) => (si.id === p.siteId ? { ...si, status: "empty" as const } : si)) },
      );
      return {
        ...state,
        areas,
        projects: state.projects.filter((x) => x.id !== action.projectId),
        economy: { ...state.economy, credits: state.economy.credits + refund, morale: Math.max(5, state.economy.morale - 4) },
        log: pushLog(state, { kind: "econ", text: `${ARCHETYPE_BY_ID[p.archetypeId]?.name ?? "Project"} cancelled in ${p.phase}. Salvage refund ₡${Math.round(refund).toLocaleString()}, morale −4.`, who: "cfo" }),
      };
    }

    case "overrideBlock": {
      const p = state.projects.find((x) => x.id === action.projectId);
      if (!p || !p.blockedReason) return state;
      const fee = Math.round(p.budget * 0.08);
      if (state.economy.credits < fee) return state;
      const execs = state.execs.map((e) =>
        e.role === "cfo" ? { ...e, trust: Math.max(0, e.trust - 6), load: Math.min(100, e.load + 8) } : e,
      );
      return {
        ...state,
        execs,
        projects: state.projects.map((x) =>
          x.id === p.id ? { ...x, blockedReason: null, progress: 0, phase: "build", owner: "cto", risk: Math.min(100, x.risk + 12) } : x,
        ),
        economy: { ...state.economy, credits: state.economy.credits - fee, morale: Math.max(5, state.economy.morale - 3) },
        log: pushLog(state, { kind: "exec", text: `CEO override signed. ₡${fee.toLocaleString()} expedite fee paid; CFO trust −6, risk +12. The board will remember this.`, who: "cfo" }),
      };
    }

    case "changeRequest": {
      const p = state.projects.find((x) => x.id === action.projectId);
      if (!p) return state;
      const inDesign = p.phase === "design";
      const cost = inDesign ? 0 : Math.round(p.budget * 0.05);
      return {
        ...state,
        projects: state.projects.map((x) =>
          x.id === p.id
            ? {
                ...x,
                changeRequests: x.changeRequests + 1,
                progress: inDesign ? x.progress : Math.max(0, x.progress - 0.18),
                quality: Math.min(98, x.quality + (inDesign ? 4 : 1)),
                risk: Math.min(100, x.risk + (inDesign ? 0 : 5)),
              }
            : x,
        ),
        economy: { ...state.economy, credits: state.economy.credits - cost },
        log: pushLog(state, {
          kind: "build",
          text: inDesign
            ? `Change request filed during Design — free, quality +4. This is why Design exists.`
            : `Change request filed during ${p.phase} — ₡${cost.toLocaleString()} and 18% schedule regression. CTO logs the risk.`,
          who: "cto",
        }),
      };
    }

    case "updatePlan": {
      const buildings = state.buildings.map((b) => (b.id === action.targetId ? { ...b, plan: action.plan } : b));
      const projects = state.projects.map((p) =>
        p.id === action.targetId ? { ...p, draft: action.plan } : p,
      );
      return { ...state, buildings, projects };
    }

    case "maintain": {
      const b = state.buildings.find((x) => x.id === action.buildingId);
      if (!b) return state;
      const cost = Math.round((100 - b.condition) * 45);
      if (state.economy.credits < cost) return state;
      return {
        ...state,
        buildings: state.buildings.map((x) => (x.id === b.id ? { ...x, condition: 100 } : x)),
        economy: { ...state.economy, credits: state.economy.credits - cost },
        log: pushLog(state, { kind: "econ", text: `${ARCHETYPE_BY_ID[b.archetypeId].name} serviced for ₡${cost.toLocaleString()} — condition restored to 100%.` }),
      };
    }

    case "upgradeRoad": {
      const r = state.roads.find((x) => x.id === action.roadId);
      if (!r || r.grade >= 3) return state;
      const next = (r.grade + 1) as 1 | 2 | 3;
      const cost = next === 2 ? 24_000 : 78_000;
      if (state.economy.credits < cost) return state;
      return {
        ...state,
        roads: state.roads.map((x) => (x.id === r.id ? { ...x, grade: next, throughput: ROAD_GRADES[next].throughput } : x)),
        economy: { ...state.economy, credits: state.economy.credits - cost },
        log: pushLog(state, { kind: "diplo", text: `Road to ${r.to.replace("bot_", "alliance ").replace("road_", "")} upgraded to ${ROAD_GRADES[next].label} — throughput ${ROAD_GRADES[next].throughput} u/h for ₡${cost.toLocaleString()}.`, who: "coo" }),
      };
    }

    case "trade": {
      const bot = state.alliance.find((b) => b.id === action.botId);
      if (!bot) return state;
      const cap = tradeCapacity(state);
      const qty = Math.min(action.qty, cap);
      if (qty <= 0) return state;
      if (state.economy.tick - bot.lastTradeTick < TRADE.cooldownHours) return state;
      const c = action.commodity;
      // GDD §11.4: power is a flow, never a stock — it cannot be traded or held.
      if (c === "credits" || c === "power") return state;
      const unit = priceFor(state, c, bot, action.dir);
      const total = Math.round(unit * qty);
      const econ = { ...state.economy };
      let inv = { ...bot.inventory };
      let ok = true;
      let note = "";
      if (action.dir === "buy") {
        if (econ.credits < total) { ok = false; note = "Treasury short."; }
        else if (inv[c] < qty) { ok = false; note = `${bot.name} does not hold ${qty} ${c}.`; }
        else {
          econ.credits -= total;
          inv = { ...inv, credits: inv.credits + total, [c]: inv[c] - qty };
          if (c === "materials" || c === "food") econ[c] += qty;
        }
      } else {
        if (econ[c] < qty) { ok = false; note = `You do not hold ${qty} ${c}.`; }
        else if (inv.credits < total) { ok = false; note = `${bot.name} purse is short by ₡${(total - inv.credits).toLocaleString()}.`; }
        else {
          econ[c] -= qty;
          inv = { ...inv, credits: inv.credits - total, [c]: inv[c] + qty };
          econ.credits += total;
        }
      }
      if (!ok) return { ...state, log: pushLog(state, { kind: "alert", text: `Trade refused — ${note}` }) };

      // market impact (GDD §9 MARKET.impactPerUnit)
      const market = { ...state.market };
      market[c as "materials" | "food"] = Math.max(
        BASE_PRICES[c as "materials" | "food"] * (1 - MARKET.driftBand),
        Math.min(
          BASE_PRICES[c as "materials" | "food"] * (1 + MARKET.driftBand),
          market[c as "materials" | "food"] * (1 + (action.dir === "buy" ? 1 : -1) * MARKET.impactPerUnit * qty),
        ),
      );
      const relation = Math.min(100, bot.relation + 0.6 + qty / cap);
      const alliance = state.alliance.map((b) =>
        b.id === bot.id
          ? {
              ...b,
              inventory: inv,
              relation,
              dealsDone: b.dealsDone + 1,
              lastTradeTick: state.economy.tick,
              mood: relation > 78 ? "Trusted" : relation > 55 ? "Cordial" : relation > 30 ? "Wary" : "Cold",
            }
          : b,
      );
      return {
        ...state,
        alliance,
        market,
        economy: { ...econ, reputation: Math.min(100, econ.reputation + 0.4) },
        log: pushLog(state, {
          kind: "diplo",
          text: `${action.dir === "buy" ? "Bought" : "Sold"} ${qty.toLocaleString()} ${c} ${action.dir === "buy" ? "from" : "to"} ${bot.name} @ ₡${unit.toFixed(2)} = ₡${total.toLocaleString()}. Relation ${relation.toFixed(0)}.`,
        }),
      };
    }

    case "setAI": {
      return {
        ...state,
        execs: state.execs.map((e) => (e.role === action.role ? { ...e, ai: { ...e.ai, ...action.patch } } : e)),
      };
    }

    case "setStance": {
      return { ...state, execs: state.execs.map((e) => (e.role === action.role ? { ...e, stance: action.stance } : e)) };
    }

    case "answer":
      return {
        ...state,
        questions: state.questions.map((q) => (q.id === action.id ? { ...q, answer: action.answer } : q)),
      };

    case "log":
      return { ...state, log: pushLog(state, action.entry) };

    case "tick":
      return tick(state);

    default:
      return state;
  }
}

/* --------------------------------- Tick --------------------------------- */

function tick(s: GameState): GameState {
  const f = flows(s);
  const econ = { ...s.economy };
  econ.tick += 1;

  let log: LogEntry[] = s.log;
  const say = (e: Omit<LogEntry, "tick">) => {
    log = [{ ...e, tick: econ.tick }, ...log].slice(0, TUNABLES.maxLog.v);
  };

  // ---- 1. production & consumption -------------------------------------
  econ.powerProduced = f.produced;
  econ.powerDemanded = f.demanded;

  const foodNet = f.food - f.foodDemand;
  const matNet = f.materials;
  econ.food = Math.max(0, econ.food + foodNet);
  econ.materials = Math.max(0, econ.materials + matNet);

  // ---- 2. storage overflow ---------------------------------------------
  econ.storageUsed = Math.round(econ.materials + econ.food);
  const cap = f.storageCap + (f.mods.coldStore ? 420 : 0);
  econ.storageCap = cap;
  if (econ.storageUsed > cap) {
    const over = econ.storageUsed - cap;
    const loss = over * TUNABLES.storageOverflowLoss.v;
    if (!f.mods.coldStore) {
      const foodShare = econ.food / Math.max(1, econ.storageUsed);
      econ.food = Math.max(0, econ.food - loss * foodShare);
      econ.materials = Math.max(0, econ.materials - loss * (1 - foodShare));
    } else {
      econ.materials = Math.max(0, econ.materials - loss);
    }
    econ.overflowWaste += loss;
    if (econ.tick % 12 === 0)
      say({ kind: "alert", text: `Storage over capacity by ${Math.round(over)} units — ${Math.round(loss)} spoiled this hour. Build racking or sell down.`, who: "coo" });
  }

  // ---- 3. treasury ------------------------------------------------------
  econ.credits += f.netCredits;
  if (econ.credits < 0) econ.credits = 0;

  // ---- 4. morale / brownout ---------------------------------------------
  let deficit = 0;
  if (f.brownout) deficit += 1;
  if (econ.food <= 0 && f.crew > 0) deficit += 1;
  if (econ.storageUsed > cap) deficit += 0.5;
  if (deficit > 0) {
    econ.morale = Math.max(0, econ.morale - TUNABLES.moralePerDeficit.v * deficit);
    if (f.brownout) econ.brownouts += 1;
    if (econ.morale < 25 && econ.tick % 24 === 0)
      say({ kind: "alert", text: `Morale ${econ.morale.toFixed(0)} — crew absenteeism is dragging every phase clock.`, who: "coo" });
  } else {
    econ.morale = Math.min(100, econ.morale + 0.35);
  }

  // ---- 5. condition decay ------------------------------------------------
  const buildings = s.buildings.map((b) => {
    if (!b.operational) return b;
    const condition = Math.max(0, b.condition - TUNABLES.conditionDecay.v);
    const visitorsToday = b.visitorsToday + (Math.random() < 0.02 ? 1 : 0);
    const receptionBot = {
      ...b.receptionBot,
      queue: Math.max(0, b.receptionBot.queue + (Math.random() < 0.1 ? 1 : -1)),
      satisfaction: Math.min(100, Math.max(0, b.receptionBot.satisfaction + (condition > 60 ? 0.05 : -0.08))),
    };
    return { ...b, condition, visitorsToday, receptionBot };
  });

  // ---- 6. project pipeline ----------------------------------------------
  const projects: Project[] = [];
  let newBuildings = buildings;
  let execs = s.execs.map((e) => ({ ...e }));
  const areas = s.areas.map((a) => ({ ...a, sites: a.sites.map((si) => ({ ...si })) }));

  for (const p of s.projects) {
    const arch = ARCHETYPE_BY_ID[p.archetypeId];
    const np: Project = { ...p };
    const owner = execs.find((e) => e.role === PHASE_CONFIG[np.phase].owner)!;

    if (np.phase === "operate") {
      projects.push(np);
      continue;
    }

    // Approval gate — re-evaluated every hour so a block releases itself the
    // moment the treasury recovers. A gate that never re-opens is a dead end.
    if (np.phase === "approve") {
      const need = np.budget - np.spent;
      const matNeed = arch.cost * BUILD.materialIntensity;
      if (econ.credits < need) {
        if (!np.blockedReason) {
          np.blockedReason = `CFO LEDGER withheld funding: ₡${Math.round(need).toLocaleString()} required, ₡${Math.round(econ.credits).toLocaleString()} in treasury.`;
          say({ kind: "exec", text: np.blockedReason, who: "cfo" });
        }
      } else if (econ.materials < matNeed) {
        if (!np.blockedReason) {
          np.blockedReason = `Materials short: ${Math.round(matNeed)} units required at foundation pour (${Math.round(econ.materials)} on hand).`;
          say({ kind: "exec", text: np.blockedReason, who: "coo" });
        }
      } else if (np.blockedReason) {
        say({ kind: "exec", text: `CFO LEDGER released funding for ${arch.name} — treasury covers the ₡${Math.round(need).toLocaleString()} draw. Build resumes.`, who: "cfo" });
        np.blockedReason = null;
      }
    }

    if (np.blockedReason) {
      projects.push(np);
      continue;
    }

    // funding draw + crew speed
    const loadF = owner.load > 85 ? 0.7 : owner.load > 65 ? 0.88 : 1;
    const moraleF = 0.55 + econ.morale / 220;
    const skillF = 0.75 + owner.skill / 300;
    const stanceF = owner.stance === "aggressive" ? 1.22 : owner.stance === "cautious" ? 0.82 : 1;
    const hours = Math.max(1, phaseHours(np.archetypeId, np.phase, np));
    const advance = (loadF * moraleF * skillF * stanceF) / hours;
    np.progress += advance;

    // Budget is drawn once, split 15% mobilisation at Approve / 85% across Build.
    // (Earlier builds drew 100% at Approve *and* 55% during Build — a 1.55×
    // double charge that quietly bankrupted every mid-game city.)
    if (np.phase === "approve") {
      const draw = np.budget * 0.15 * advance;
      np.spent += draw;
      econ.credits -= draw;
    } else if (np.phase === "build") {
      const draw = np.budget * 0.85 * advance;
      np.spent += draw;
      econ.credits -= draw;
      const matDraw = arch.cost * BUILD.materialIntensity * advance;
      if (econ.materials >= matDraw) econ.materials -= matDraw;
      else np.progress -= advance * 0.5; // starved site works half speed
    }

    if (np.progress >= 1) {
      np.progress = 0;
      const idx = PHASES.indexOf(np.phase);
      const nextPhase = PHASES[Math.min(PHASES.length - 1, idx + 1)];

      // QA roll
      if (np.phase === "test") {
        np.testAttempts += 1;
        const pass = Math.random() * 100 < np.quality - np.risk * 0.25 + execs[0].skill * 0.1;
        if (!pass && np.testAttempts < 3) {
          np.phase = "build";
          np.quality = Math.max(10, np.quality - 10);
          np.risk = Math.min(100, np.risk + 6);
          np.progress = 0.7; // 30% rework
          execs = execs.map((e) => (e.role === "cto" ? { ...e, skill: Math.max(1, e.skill - 1), trust: Math.max(0, e.trust - 2) } : e));
          say({ kind: "alert", text: `QA FAILED on ${arch.name} (attempt ${np.testAttempts}). Rework ordered — 30% of build duration, quality now ${np.quality}%.`, who: "cto" });
          projects.push(np);
          continue;
        }
        say({ kind: "build", text: `QA signed off on ${arch.name} after ${np.testAttempts} attempt(s). Quality ${np.quality}%.`, who: "cto" });
      }

      if (np.phase === "deploy") {
        // hand over: create the Building
        const site = areas.flatMap((a) => a.sites).find((si) => si.id === np.siteId)!;
        const area = areas.find((a) => a.id === np.areaId)!;
        // the CEO's Design-phase layout wins; otherwise the archetype default ships
        const plan = np.draft ?? generatePlan(arch, np.id, Math.max(1, Math.round(np.quality / 40)));
        const b: Building = {
          id: `bld_${np.id.slice(4)}`,
          areaId: area.id,
          siteId: site.id,
          archetypeId: arch.id,
          plan,
          level: 1,
          operational: true,
          condition: Math.min(100, 60 + np.quality * 0.4),
          securityBot: { id: `sec_${site.id}`, name: `SEC-${(hashString(site.id) % 90) + 10}`, trust: 50, alerts: 0 },
          receptionBot: { id: `rec_${site.id}`, name: `REC-${(hashString(site.id + "r") % 90) + 10}`, queue: 0, satisfaction: 72 },
          visitorsToday: 0,
        };
        newBuildings = [...newBuildings, b];
        np.buildingId = b.id;
        np.phase = "operate";
        site.buildingId = b.id;
        site.status = "active";
        const xp = Math.round(arch.cost * 0.02 * f.mods.xpBonus);
        econ.xp += xp;
        econ.reputation = Math.min(100, econ.reputation + arch.tier * 1.6);
        execs = execs.map((e) => ({
          ...e,
          skill: Math.min(100, e.skill + (PHASE_CONFIG.design.owner === e.role ? 1.4 : 0.8)),
          trust: Math.min(100, e.trust + 2),
          load: Math.max(5, e.load - 14),
        }));
        say({ kind: "build", text: `${arch.name} DEPLOYED at ${AREA_META[area.kind].label} site ${site.index + 1}. Condition ${Math.round(b.condition)}%, security bot ${b.securityBot.name} and reception bot ${b.receptionBot.name} provisioned. +${xp} XP.` });
        // Handover: the project leaves the pipeline, the building takes over.
        continue;
      }

      np.phase = nextPhase;
      np.owner = PHASE_CONFIG[nextPhase].owner;
      if (nextPhase === "design") say({ kind: "build", text: `${arch.name} entered Design. Floor plan is editable for free in this phase — CTO ATLAS is waiting on your layout.`, who: "cto" });
      if (nextPhase === "approve") say({ kind: "exec", text: `${arch.name} submitted for funding: ₡${Math.round(np.budget - np.spent).toLocaleString()} draw required.`, who: "cfo" });
    }
    projects.push(np);
  }

  // ---- 7. exec load -------------------------------------------------------
  execs = execs.map((e) => {
    const owned = projects.filter((p) => p.owner === e.role && p.phase !== "operate").length;
    const target = 8 + owned * 22;
    return { ...e, load: Math.round(e.load + (target - e.load) * 0.25) };
  });

  // ---- 8. level up --------------------------------------------------------
  const need = LEVELS(econ.level);
  if (econ.xp >= need && econ.level < 6) {
    econ.xp -= need;
    econ.level += 1;
    say({ kind: "exec", text: `CEO level ${econ.level}. Tier ${Math.min(3, econ.level)} archetypes unlocked across all four sectors.` });
  }

  // ---- 9. market mean reversion ------------------------------------------
  const market = { ...s.market };
  (["materials", "food", "power"] as const).forEach((c) => {
    const base = BASE_PRICES[c];
    market[c] = market[c] + (base - market[c]) * MARKET.meanReversion + (Math.random() - 0.5) * base * 0.012;
    market[c] = Math.max(base * (1 - MARKET.driftBand), Math.min(base * (1 + MARKET.driftBand), market[c]));
  });

  // ---- 10. alliance + relation drift --------------------------------------
  const alliance = s.alliance.map((b) => {
    // Neglect costs 1 relation every 96 h but never below 20 — an alliance bot
    // you have never traded with stays Wary, not hostile. Hostility needs an act.
    const rel = Math.max(
      20,
      Math.min(100, b.relation + f.mods.relationRate * 0.05 - (b.dealsDone === 0 && econ.tick % 96 === 0 ? 1 : 0)),
    );
    const restock = econ.tick % 24 === 0 ? 1 : 0;
    return {
      ...b,
      relation: rel,
      inventory: restock
        ? {
            ...b.inventory,
            credits: b.inventory.credits + 14_000,
            materials: b.inventory.materials + (b.kind === "supplier" ? 700 : 90),
            food: b.inventory.food + (b.kind === "offtaker" ? 420 : 60),
          }
        : b.inventory,
      mood: rel > 78 ? "Trusted" : rel > 55 ? "Cordial" : rel > 30 ? "Wary" : "Cold",
    };
  });

  // ---- 11. remote CEOs (simulated netcode — see GDD §16 q2) ---------------
  const remote = s.remote.map((p) => {
    const r = mulberry32(econ.tick * 31 + hashString(p.id));
    const online = r() > 0.25;
    return { ...p, online, lastSeenTick: online ? econ.tick : p.lastSeenTick, reputation: Math.min(100, p.reputation + (r() - 0.45) * 0.6) };
  });

  return {
    ...s,
    economy: econ,
    buildings: newBuildings,
    projects,
    areas,
    execs,
    alliance,
    remote,
    market,
    log,
  };
}

export const SCREENS: { id: Screen; label: string; hint: string }[] = [
  { id: "world", label: "World", hint: "Claim · sectors · roads · alliance" },
  { id: "territory", label: "Territory", hint: "4 sectors × 5 building sites" },
  { id: "studio", label: "Studio", hint: "2D floor plan + 3D walk-through" },
  { id: "boardroom", label: "Boardroom", hint: "CTO · CFO · COO with own AI models" },
  { id: "diplomacy", label: "Diplomacy", hint: "Trade & visit alliance peers" },
  { id: "gdd", label: "Design Doc", hint: "Spec · changelog · open questions" },
];
