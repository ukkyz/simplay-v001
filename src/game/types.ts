/**
 * SIMPLAYZ — Core type definitions
 * GDD §14 "Data Contracts". Anything an engineer needs to persist or send over
 * the wire is declared here. If it is not in this file, it does not exist.
 */

export type AreaKind = "energy" | "food" | "factory" | "warehouse";
export type ExecRole = "cto" | "cfo" | "coo";
export type Commodity = "materials" | "food" | "power" | "credits";

/** SDLC-inspired city management pipeline (GDD §6.2) */
export type Phase =
  | "discover"
  | "design"
  | "approve"
  | "build"
  | "test"
  | "deploy"
  | "operate";

export const PHASES: Phase[] = [
  "discover",
  "design",
  "approve",
  "build",
  "test",
  "deploy",
  "operate",
];

export type CellType = 0 | 1 | 2 | 3 | 4; // void | floor | wall | door | glazing
export type ZoneKind =
  | "lobby"
  | "corridor"
  | "office"
  | "server"
  | "lab"
  | "storage"
  | "production"
  | "green"
  | "power"
  | "crew";
export type PropKind =
  | "desk"
  | "rack"
  | "machine"
  | "tank"
  | "console"
  | "crate"
  | "planter"
  | "bunk";

export interface Cell {
  t: CellType;
  z?: ZoneKind;
  p?: PropKind;
}

export interface FloorPlan {
  id: string;
  name: string;
  w: number; // metres
  h: number; // metres
  storeys: number;
  cells: Cell[]; // row-major, length w*h
  revision: number;
}

export interface Archetype {
  id: string;
  name: string;
  area: AreaKind;
  tier: 1 | 2 | 3;
  cost: number; // credits
  hours: number; // build hours at 100% crew efficiency
  upkeep: number; // credits / sim-hour
  power: number; // kW, negative = generation
  food: number; // units / sim-hour
  materials: number; // units / sim-hour
  storage: number; // capacity units added
  crew: number;
  size: { w: number; h: number };
  blurb: string;
  rationale: string; // GDD: no magic numbers
  unlockAt: number; // minimum CEO level
}

export type SiteStatus = "empty" | "surveyed" | "active" | "offline";

export interface Site {
  id: string;
  areaId: string;
  index: number;
  status: SiteStatus;
  buildingId: string | null;
}

export interface ResourceArea {
  id: string;
  kind: AreaKind;
  index: number; // 0..3 quadrant
  level: number;
  sites: Site[];
}

export interface Building {
  id: string;
  areaId: string;
  siteId: string;
  archetypeId: string;
  plan: FloorPlan;
  level: number;
  operational: boolean;
  condition: number; // 0..100, decays; <40 => efficiency penalty
  securityBot: { id: string; name: string; trust: number; alerts: number };
  receptionBot: { id: string; name: string; queue: number; satisfaction: number };
  visitorsToday: number;
}

export interface Project {
  id: string;
  buildingId: string | null;
  areaId: string;
  siteId: string;
  archetypeId: string;
  phase: Phase;
  progress: number; // 0..1 inside current phase
  owner: ExecRole;
  budget: number;
  spent: number;
  quality: number; // 0..100 — decided at design, tested at QA
  risk: number; // 0..100
  changeRequests: number;
  blockedReason: string | null;
  startedTick: number;
  testAttempts: number;
  /** Working floor plan authored during Design. Promoted to the Building at Deploy. */
  draft?: FloorPlan | null;
}

/**
 * Non-secret advisor preferences.
 *
 * `baseUrl` / `apiKey` are kept as always-empty fields for backward compatibility
 * with schema-4 saves and imports; they are never populated by the app any more.
 * Live model credentials are operator-owned server environment values (see
 * src/server/ai/config.ts). Anything written here is client-visible and
 * persisted, so it must never hold a secret.
 */
export interface AIConfig {
  /** Removed from new saves; only a legacy schema-4 import may carry it. */
  baseUrl?: string;
  /** Removed from new saves; a non-empty value in an import is rejected. */
  apiKey?: string;
  /** Non-secret display preference only; the served model is operator-configured. */
  model: string;
  temperature: number;
  enabled: boolean;
}

export interface ExecState {
  role: ExecRole;
  name: string;
  callsign: string;
  skill: number; // 1..100, grows with completed projects in their domain
  load: number; // 0..100 — over 85 causes phase slowdown
  trust: number; // 0..100 toward the CEO
  ai: AIConfig;
  stance: "aggressive" | "balanced" | "cautious";
}

export interface AllianceBot {
  id: string;
  name: string;
  kind: "supplier" | "offtaker";
  lat: number;
  lng: number;
  relation: number; // 0..100 — better prices as it rises
  inventory: Record<Commodity, number>;
  buyPrice: Record<string, number>;
  sellPrice: Record<string, number>;
  dealsDone: number;
  lastTradeTick: number;
  mood: string;
}

export interface Road {
  id: string;
  from: string;
  to: string;
  path: [number, number][];
  grade: 1 | 2 | 3; // gravel | asphalt | arterial
  throughput: number; // units/hour
}

export interface RemoteCeo {
  id: string;
  name: string;
  handle: string;
  lat: number;
  lng: number;
  online: boolean;
  alliance: boolean;
  reputation: number;
  buildings: {
    id: string;
    archetypeId: string;
    name: string;
    plan: FloorPlan;
    crew: number;
  }[];
  lastSeenTick: number;
  color: string;
}

export interface LogEntry {
  tick: number;
  kind: "build" | "econ" | "diplo" | "exec" | "alert" | "visit";
  text: string;
  who?: ExecRole | string;
}

export interface Claim {
  center: { lat: number; lng: number };
  sideKm: number;
  corners: [number, number][];
  placedBy: "geolocation" | "manual";
}

export interface Economy {
  credits: number;
  materials: number;
  food: number;
  powerProduced: number;
  powerDemanded: number;
  storageUsed: number;
  storageCap: number;
  morale: number; // 0..100
  reputation: number; // 0..100 — gates alliance offers
  level: number;
  xp: number;
  tick: number;
  brownouts: number;
  overflowWaste: number;
}

export interface MarketPrices {
  materials: number;
  food: number;
  power: number;
}

export interface OpenQuestion {
  id: string;
  section: string;
  question: string;
  assumption: string; // what the build currently does
  impact: "high" | "medium" | "low";
  answer: string;
}

export type Screen =
  | "world"
  | "territory"
  | "studio"
  | "boardroom"
  | "diplomacy"
  | "gdd";

export interface GameState {
  schema: number;
  ceoName: string;
  company: string;
  createdAt: number;
  claim: Claim | null;
  areas: ResourceArea[];
  buildings: Building[];
  projects: Project[];
  execs: ExecState[];
  alliance: AllianceBot[];
  roads: Road[];
  remote: RemoteCeo[];
  economy: Economy;
  market: MarketPrices;
  log: LogEntry[];
  speed: 0 | 1 | 4 | 16;
  netMode: "local-sim" | "live";
  questions: OpenQuestion[];
  changelogSeen: string;
}

export interface ChatMessage {
  id: string;
  role: ExecRole | "ceo";
  author: string;
  text: string;
  tick: number;
  pending?: boolean;
  error?: boolean;
  source?: "live-api" | "local-model";
}
