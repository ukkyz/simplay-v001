"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ARCHETYPE_BY_ID, ZONE_META } from "@/game/constants";
import { planStats } from "@/game/plans";
import type { Building, FloorPlan, Project } from "@/game/types";
import { useGame } from "@/state/store";
import { cn } from "@/utils/cn";
import BuildingScene, { type NpcSpec, type SceneMode } from "./BuildingScene";
import FloorPlanEditor from "./FloorPlanEditor";
import { Btn, Chip, Icon, KV, Meter, Panel } from "./ui";
import { PhaseStrip } from "./Pipeline";
import { fmt } from "./Shell";

type Mode = "plan" | SceneMode;

const MODES: { id: Mode; label: string; icon: (p: { size?: number }) => React.ReactElement; hint: string }[] = [
  { id: "plan", label: "2D Plan", icon: Icon.plan, hint: "Author the floor plan — drives the 3D exactly" },
  { id: "preview", label: "3D Preview", icon: Icon.cube, hint: "Orbit the massing: drag rotate, wheel zoom" },
  { id: "fps", label: "First person", icon: Icon.eye, hint: "Click to lock the mouse · WASD walk · Shift sprint · E talk" },
  { id: "tps", label: "Third person", icon: Icon.walk, hint: "Drag to orbit the CEO avatar · WASD walk · E talk" },
];

export default function Studio() {
  const { state, ui, setUi, dispatch, toast } = useGame();
  const [mode, setMode] = useState<Mode>("plan");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [dialogue, setDialogue] = useState<{ who: string; role: string; lines: string[] } | null>(null);
  const tele = useRef({ x: 0, z: 0, yaw: 0, fps: 60 });

  const target = useMemo(() => resolveTarget(state, ui), [state, ui]);

  useEffect(() => {
    if (target?.readOnly) setMode((m) => (m === "plan" ? "fps" : m));
  }, [target?.readOnly]);

  if (!target) return <TargetPicker />;

  const { plan, title, subtitle, accent, npcs, building, project, readOnly } = target;
  const arch = ARCHETYPE_BY_ID[building?.archetypeId ?? project?.archetypeId ?? "solar_field"];
  const stats = planStats(plan);

  const handlePlan = (p: FloorPlan) => {
    if (readOnly) return;
    if (building) dispatch({ type: "updatePlan", targetId: building.id, plan: p });
    else if (project) {
      dispatch({ type: "updatePlan", targetId: project.id, plan: p });
      if (project.phase !== "design" && project.phase !== "discover")
        dispatch({ type: "changeRequest", projectId: project.id });
    }
  };

  const talk = (npc: NpcSpec) => {
    setDialogue({ who: npc.name, role: npc.role, lines: botLines(npc, state, building, project, plan) });
    if (building)
      dispatch({
        type: "log",
        entry: {
          kind: "visit",
          text: `${npc.name} (${npc.role}) engaged the CEO at ${arch.name}. Reception queue ${building.receptionBot.queue}, satisfaction ${Math.round(building.receptionBot.satisfaction)}%.`,
        },
      });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------------- header ------------------------------ */}
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-ink-900/85 px-3 py-2">
        <div className="min-w-0">
          <div className="eyebrow flex items-center gap-2">
            <span style={{ color: accent }}>●</span>
            {subtitle}
          </div>
          <h2 className="display truncate text-[19px] leading-tight text-chalk">{title}</h2>
        </div>

        <div className="ml-3 flex shrink-0 items-center gap-1">
          {MODES.map((m) => {
            const Ico = m.icon;
            return (
              <button
                key={m.id}
                title={m.hint}
                onClick={() => {
                  setMode(m.id);
                  setDialogue(null);
                }}
                className={cn(
                  "group relative flex items-center gap-1.5 border px-2.5 py-1.5 text-[11px] font-semibold transition-all duration-200",
                  mode === m.id
                    ? "border-transparent text-ink-950"
                    : "border-line bg-ink-850 text-mist hover:-translate-y-px hover:border-ink-600 hover:text-chalk",
                )}
                style={mode === m.id ? { background: accent } : undefined}
              >
                <Ico size={14} />
                {m.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {readOnly ? (
            <Chip color="#ff6a55">VISITING — read only</Chip>
          ) : project ? (
            <>
              <Chip color="#f2a33c">{project.phase.toUpperCase()}</Chip>
              <Btn
                size="sm"
                variant="teal"
                onClick={() => {
                  dispatch({ type: "changeRequest", projectId: project.id });
                  toast(
                    project.phase === "design"
                      ? "Change request filed in Design — free, quality +4."
                      : "Change request filed — 5% budget, 18% schedule regression.",
                    project.phase === "design" ? "good" : "bad",
                  );
                }}
              >
                <Icon.plan size={12} /> File change request
              </Btn>
            </>
          ) : (
            <Chip color="#35d6c0">OPERATIONAL</Chip>
          )}
          <Btn
            size="sm"
            variant="ghost"
            onClick={() =>
              setUi({
                screen: readOnly ? "diplomacy" : building ? "territory" : "world",
                studioTarget: null,
                visit: null,
              })
            }
          >
            <Icon.close size={12} /> {readOnly ? "Leave site" : "Exit site"}
          </Btn>
        </div>
      </header>

      {/* -------------------------------- body ------------------------------- */}
      <div className="flex min-h-0 flex-1">
        {mode === "plan" ? (
          <>
            <div className="min-w-0 flex-[1.35] border-r border-line">
              <FloorPlanEditor plan={plan} onChange={handlePlan} readOnly={readOnly} accent={accent} />
            </div>
            <div className="relative min-w-0 flex-1">
              <BuildingScene
                plan={plan}
                mode="preview"
                npcs={npcs}
                owner={state.ceoName}
                onTelemetry={(t) => (tele.current = t)}
              />
              <div className="pointer-events-none absolute left-3 top-3 panel-flat px-2.5 py-1.5">
                <div className="eyebrow">Live 3D preview</div>
                <div className="num text-[10px] text-mist">
                  Generated from the exact cells you are editing · 1 cell = 1 m · ceiling {2.9} m
                </div>
              </div>
              <Telemetry tele={tele} plan={plan} mode="preview" />
            </div>
          </>
        ) : (
          <div className="relative min-w-0 flex-1">
            <BuildingScene
              plan={plan}
              mode={mode}
              npcs={npcs}
              owner={state.ceoName}
              onPrompt={setPrompt}
              onTalk={talk}
              onTelemetry={(t) => (tele.current = t)}
            />

            {mode === "fps" && (
              <>
                <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
                  <div className="relative h-5 w-5">
                    <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-chalk/70" />
                    <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-chalk/70" />
                    <span className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal" />
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
                  <div className="panel-flat num px-3 py-1 text-[10px] text-mist">
                    Click to lock mouse · WASD walk · Shift sprint · E talk · Esc release
                  </div>
                </div>
              </>
            )}
            {mode === "tps" && (
              <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
                <div className="panel-flat num px-3 py-1 text-[10px] text-mist">
                  Drag to orbit the CEO · WASD walk relative to camera · Shift sprint · E talk
                </div>
              </div>
            )}

            {prompt && (
              <div className="pointer-events-none absolute bottom-20 left-1/2 z-20 -translate-x-1/2">
                <div className="rise border border-teal/70 bg-ink-950/92 px-3 py-1.5 text-[12px] font-semibold text-teal shadow-[0_0_28px_-8px_#35d6c0]">
                  {prompt}
                </div>
              </div>
            )}

            <Telemetry tele={tele} plan={plan} mode={mode} />

            {mode !== "preview" && (
              <div className="absolute right-3 top-3 z-10">
                <Minimap plan={plan} tele={tele} npcs={npcs} />
              </div>
            )}
          </div>
        )}

        {/* ------------------------------ right rail -------------------------- */}
        <aside className="flex w-[318px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-ink-900/70 p-3">
          <Panel title="Building spec" accent={accent} bodyClass="p-3">
            <KV k="Archetype" v={arch.name} />
            <KV k="Sector" v={arch.area.toUpperCase()} tone={accent} />
            <KV k="Tier / level" v={`T${arch.tier} · L${building?.level ?? 1}`} />
            <KV k="Footprint" v={`${plan.w} × ${plan.h} m · ${plan.storeys} storey`} />
            <KV k="Usable area" v={`${stats.usableM2} m²`} />
            <KV k="Zones / doors" v={`${stats.rooms} / ${stats.doors}`} />
            <KV k="Power" v={arch.power < 0 ? `−${-arch.power} kW (gen)` : `${arch.power} kW (draw)`} tone={arch.power < 0 ? "#35d6c0" : "#ff8347"} />
            <KV k="Output" v={`${arch.food ? `+${arch.food} food/h ` : ""}${arch.materials ? `+${arch.materials} mat/h` : ""}${!arch.food && !arch.materials ? "—" : ""}`} />
            <KV k="Crew / upkeep" v={`${arch.crew} · ₡${fmt(arch.upkeep)}/h`} />
            <p className="mt-2 border-l-2 pl-2 text-[10.5px] leading-snug text-mist" style={{ borderColor: accent }}>
              {arch.blurb} <span className="text-dim">Balance note: {arch.rationale}</span>
            </p>
          </Panel>

          {project && (
            <Panel title="Project gate" accent="#f2a33c" bodyClass="p-3">
              <PhaseStrip project={project} />
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                <KV k="Quality" v={`${project.quality}%`} />
                <KV k="Risk" v={`${project.risk}%`} tone={project.risk > 55 ? "#ff6a55" : undefined} />
                <KV k="Budget" v={`₡${fmt(Math.round(project.budget))}`} />
                <KV k="Change reqs" v={project.changeRequests} tone={project.changeRequests ? "#f2a33c" : undefined} />
              </div>
              <p className="num mt-2 text-[9.5px] leading-snug text-dim">
                {project.phase === "design"
                  ? "You are in Design. Editing the plan here is FREE and adds +4 quality per change request. This is the cheapest moment you will ever get."
                  : project.phase === "build"
                    ? "You are in Build. Any plan edit now is a change request: 5% of budget and an 18% schedule regression."
                    : `You are in ${project.phase}. Plan edits are logged as change requests.`}
              </p>
            </Panel>
          )}

          {building && (
            <Panel title="Site bots" accent="#ff6a55" bodyClass="p-3 flex flex-col gap-2.5">
              <BotCard
                name={building.securityBot.name}
                role="Security bot"
                color="#ff6a55"
                rows={[
                  ["Trust", `${building.securityBot.trust}/100`],
                  ["Alerts raised", `${building.securityBot.alerts}`],
                  ["Patrol", "corridor loop · 6 m/s"],
                ]}
                note={`Authority per open question Q7: non-allied visitors are held at reception and logged. Allied visitors roam free.`}
                onClick={() => setDialogue({ who: building.securityBot.name, role: "security", lines: botLines({ id: building.securityBot.id, name: building.securityBot.name, role: "security", line: "" }, state, building, project, plan) })}
              />
              <BotCard
                name={building.receptionBot.name}
                role="Receptionist bot"
                color="#35d6c0"
                rows={[
                  ["Queue", `${building.receptionBot.queue}`],
                  ["Satisfaction", `${Math.round(building.receptionBot.satisfaction)}%`],
                  ["Visitors today", `${building.visitorsToday}`],
                ]}
                note="Handles check-in, wayfinding and the visitor log for alliance walk-throughs."
                onClick={() => setDialogue({ who: building.receptionBot.name, role: "reception", lines: botLines({ id: building.receptionBot.id, name: building.receptionBot.name, role: "reception", line: "" }, state, building, project, plan) })}
              />
              <div>
                <Meter value={building.condition} color={building.condition > 70 ? "#35d6c0" : building.condition > 40 ? "#f2a33c" : "#ff6a55"} label={`Fabric condition ${Math.round(building.condition)}%`} danger={building.condition < 40} />
                <Btn
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => dispatch({ type: "maintain", buildingId: building.id })}
                  disabled={state.economy.credits < (100 - building.condition) * 45}
                >
                  Service fabric — ₡{fmt(Math.round((100 - building.condition) * 45))}
                </Btn>
              </div>
            </Panel>
          )}

          <Panel title="Zone schedule" bodyClass="p-3">
            <div className="flex flex-col gap-1">
              {Object.entries(stats.zones)
                .sort((a, b) => b[1] - a[1])
                .map(([z, n]) => (
                  <div key={z} className="flex items-center gap-2">
                    <i className="h-2.5 w-2.5 shrink-0" style={{ background: ZONE_META[z as keyof typeof ZONE_META].color }} />
                    <span className="num flex-1 text-[10px] text-mist">{ZONE_META[z as keyof typeof ZONE_META].label}</span>
                    <span className="num text-[10px] text-dim">{n} m²</span>
                  </div>
                ))}
            </div>
          </Panel>
        </aside>
      </div>

      {/* ------------------------------ dialogue ----------------------------- */}
      {dialogue && (
        <div className="fixed inset-0 z-[900] flex items-end justify-center bg-ink-950/70 p-6" onClick={() => setDialogue(null)}>
          <div
            className="rise panel w-full max-w-[620px] p-4"
            onClick={(e) => e.stopPropagation()}
            style={{ borderColor: dialogue.role === "security" ? "#ff6a5566" : "#35d6c066" }}
          >
            <div className="flex items-center gap-2">
              <span style={{ color: dialogue.role === "security" ? "#ff6a55" : "#35d6c0" }}>
                <Icon.bot size={18} />
              </span>
              <div>
                <div className="eyebrow">{dialogue.role} bot · site interface</div>
                <div className="display text-[17px] leading-tight text-chalk">{dialogue.who}</div>
              </div>
              <button className="ml-auto text-dim hover:text-coral" onClick={() => setDialogue(null)}>
                <Icon.close size={16} />
              </button>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {dialogue.lines.map((l, i) => (
                <p key={i} className="border-l-2 pl-2.5 text-[12.5px] leading-relaxed text-mist" style={{ borderColor: dialogue.role === "security" ? "#ff6a55" : "#35d6c0", animationDelay: `${i * 90}ms` }}>
                  {l}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ sub-components ----------------------------- */

function BotCard({
  name,
  role,
  color,
  rows,
  note,
  onClick,
}: {
  name: string;
  role: string;
  color: string;
  rows: [string, string][];
  note: string;
  onClick: () => void;
}) {
  return (
    <div className="border border-line bg-ink-950/55 p-2 transition-colors hover:border-ink-600">
      <div className="flex items-center gap-2">
        <span style={{ color }}>
          <Icon.bot size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="num truncate text-[11.5px] font-semibold" style={{ color }}>
            {name}
          </div>
          <div className="eyebrow !text-[8px]">{role}</div>
        </div>
        <Btn size="sm" variant="ghost" onClick={onClick} className="!px-1.5">
          Talk
        </Btn>
      </div>
      <div className="mt-1.5">
        {rows.map(([k, v]) => (
          <KV key={k} k={k} v={v} />
        ))}
      </div>
      <p className="num mt-1.5 text-[9px] leading-snug text-dim">{note}</p>
    </div>
  );
}

function Telemetry({ tele, plan, mode }: { tele: React.MutableRefObject<{ x: number; z: number; yaw: number; fps: number }>; plan: FloorPlan; mode: Mode }) {
  const [t, setT] = useState({ x: 0, z: 0, fps: 60 });
  useEffect(() => {
    const id = window.setInterval(() => setT({ x: tele.current.x, z: tele.current.z, fps: tele.current.fps }), 200);
    return () => window.clearInterval(id);
  }, [tele]);
  if (mode === "preview") return null;
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 panel-flat px-2.5 py-1.5">
      <div className="num flex gap-3 text-[10px] text-mist">
        <span>
          <span className="text-dim">POS </span>
          {t.x.toFixed(1)}, {t.z.toFixed(1)} m
        </span>
        <span>
          <span className="text-dim">PLAN </span>
          {plan.w}×{plan.h}
        </span>
        <span>
          <span className="text-dim">FPS </span>
          {t.fps}
        </span>
      </div>
    </div>
  );
}

function Minimap({ plan, tele, npcs }: { plan: FloorPlan; tele: React.MutableRefObject<{ x: number; z: number; yaw: number; fps: number }>; npcs: NpcSpec[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 168;
  const scale = Math.min(W / plan.w, (W * 0.72) / plan.h);
  const H = Math.round(plan.h * scale);
  useEffect(() => {
    const id = window.setInterval(() => {
      const cv = ref.current;
      if (!cv) return;
      const g = cv.getContext("2d")!;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = W * dpr;
      cv.height = H * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "rgba(7,13,16,.92)";
      g.fillRect(0, 0, W, H);
      for (let y = 0; y < plan.h; y++)
        for (let x = 0; x < plan.w; x++) {
          const c = plan.cells[y * plan.w + x];
          if (c.t === 0) continue;
          g.fillStyle =
            c.t === 2 ? "#8fa2a7" : c.t === 3 ? "#f2a33c" : c.t === 4 ? "#7fbfe8" : ZONE_META[c.z ?? "corridor"].color;
          g.fillRect(x * scale, y * scale, scale, scale);
        }
      const p = tele.current;
      // view cone
      g.save();
      g.translate(p.x * scale, p.z * scale);
      g.rotate(-p.yaw + Math.PI);
      g.fillStyle = "rgba(242,163,60,.22)";
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 26, -0.5, 0.5);
      g.closePath();
      g.fill();
      g.restore();
      g.fillStyle = "#f2a33c";
      g.beginPath();
      g.arc(p.x * scale, p.z * scale, 2.6, 0, Math.PI * 2);
      g.fill();
      npcs.forEach((n, i) => {
        g.fillStyle = n.role === "security" ? "#ff6a55" : "#35d6c0";
        g.fillRect(W - 8 - i * 6, H - 8, 4, 4);
      });
    }, 110);
    return () => window.clearInterval(id);
  }, [plan, scale, H, tele, npcs]);
  return (
    <div className="panel-flat p-1">
      <canvas ref={ref} style={{ width: W, height: H, display: "block" }} />
      <div className="num mt-1 flex justify-between px-0.5 text-[8.5px] text-dim">
        <span>FLOOR PLAN</span>
        <span>
          <i className="mr-1 inline-block h-1.5 w-1.5 bg-signal" />CEO
        </span>
      </div>
    </div>
  );
}

function TargetPicker() {
  const { state, setUi } = useGame();
  const items: { id: string; kind: "building" | "project"; label: string; sub: string; color: string }[] = [
    ...state.buildings.map((b) => ({
      id: b.id,
      kind: "building" as const,
      label: ARCHETYPE_BY_ID[b.archetypeId].name,
      sub: `operational · condition ${Math.round(b.condition)}% · ${b.plan.w}×${b.plan.h} m`,
      color: "#35d6c0",
    })),
    ...state.projects
      .filter((p) => p.phase !== "operate")
      .map((p) => ({
        id: p.id,
        kind: "project" as const,
        label: ARCHETYPE_BY_ID[p.archetypeId].name,
        sub: `${p.phase} · quality ${p.quality}%`,
        color: "#f2a33c",
      })),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <div>
        <div className="eyebrow">Building site studio</div>
        <h2 className="display text-[30px] leading-none text-chalk">CHOOSE A SITE TO ENTER</h2>
        <p className="mt-2 max-w-[640px] text-[12.5px] leading-relaxed text-mist">
          Every building site ships with a 2D floor plan and a 3D interior generated from that exact plan.
          Edit the plan, then walk it in first or third person and talk to the security and reception bots.
        </p>
      </div>
      {items.length === 0 && (
        <div className="panel-flat max-w-[560px] p-4">
          <p className="text-[12.5px] text-mist">
            No buildings or projects yet. Commission a build from the World map (click a ◇ site marker) or the
            Territory board, then come back here during the <b className="text-signal">Design</b> phase to author
            the floor plan for free.
          </p>
          <Btn variant="primary" className="mt-3" onClick={() => setUi({ screen: "world" })}>
            <Icon.globe size={13} /> Go to the world map
          </Btn>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {items.map((it) => (
          <button
            key={it.kind + it.id}
            onClick={() => setUi({ studioTarget: { kind: it.kind, id: it.id }, visit: null })}
            className="group panel-flat p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-ink-600"
            style={{ borderLeft: `2px solid ${it.color}` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-chalk">{it.label}</span>
              <span className="text-dim transition-transform duration-200 group-hover:translate-x-1 group-hover:text-chalk">
                <Icon.arrow size={14} />
              </span>
            </div>
            <div className="num mt-1 text-[10px] text-dim">{it.sub}</div>
            <div className="num mt-2 flex gap-1.5">
              <Chip color={it.color}>{it.kind === "building" ? "ENTER" : "DESIGN"}</Chip>
            </div>
          </button>
        ))}
      </div>
      {state.remote.some((r) => r.alliance) && (
        <div>
          <div className="eyebrow mt-2">Alliance walk-throughs</div>
          <div className="mt-2 grid grid-cols-2 gap-3 xl:grid-cols-3">
            {state.remote
              .filter((r) => r.alliance)
              .flatMap((r) => r.buildings.map((b) => ({ r, b })))
              .map(({ r, b }) => (
                <button
                  key={b.id}
                  onClick={() => setUi({ visit: { ownerName: `${r.name} ${r.handle}`, buildingName: b.name, planId: b.plan.id } })}
                  className="group panel-flat p-3 text-left transition-all duration-200 hover:-translate-y-0.5"
                  style={{ borderLeft: `2px solid ${r.color}` }}
                >
                  <div className="text-[12.5px] font-semibold text-chalk">{b.name}</div>
                  <div className="num mt-0.5 text-[10px] text-dim">
                    {r.name} · {b.plan.w}×{b.plan.h} m · {r.online ? "host online" : "host away"}
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- helpers -------------------------------- */

interface Target {
  plan: FloorPlan;
  title: string;
  subtitle: string;
  accent: string;
  npcs: NpcSpec[];
  building: Building | null;
  project: Project | null;
  readOnly: boolean;
}

function resolveTarget(state: ReturnType<typeof useGame>["state"], ui: ReturnType<typeof useGame>["ui"]): Target | null {
  if (ui.visit) {
    for (const peer of state.remote) {
      const b = peer.buildings.find((x) => x.plan.id === ui.visit!.planId);
      if (b)
        return {
          plan: b.plan,
          title: b.name,
          subtitle: `Visiting ${ui.visit.ownerName} · ${peer.online ? "host online" : "host away"}`,
          accent: peer.color,
          readOnly: true,
          building: null,
          project: null,
          npcs: [
            { id: "vsec", name: `SEC-${peer.handle.slice(2, 4).toUpperCase()}`, role: "security", line: "" },
            { id: "vrec", name: `REC-${peer.handle.slice(2, 4).toUpperCase()}`, role: "reception", line: "" },
          ],
        };
    }
  }
  const t = ui.studioTarget;
  if (!t) return null;
  if (t.kind === "building") {
    const b = state.buildings.find((x) => x.id === t.id);
    if (!b) return null;
    const arch = ARCHETYPE_BY_ID[b.archetypeId];
    const area = state.areas.find((a) => a.id === b.areaId)!;
    return {
      plan: b.plan,
      title: arch.name,
      subtitle: `${area.kind.toUpperCase()} SECTOR · SITE ${state.areas.flatMap((a) => a.sites).find((s) => s.id === b.siteId)!.index + 1}`,
      accent: "#35d6c0",
      readOnly: false,
      building: b,
      project: null,
      npcs: [
        { id: b.securityBot.id, name: b.securityBot.name, role: "security", line: "" },
        { id: b.receptionBot.id, name: b.receptionBot.name, role: "reception", line: "" },
      ],
    };
  }
  const p = state.projects.find((x) => x.id === t.id);
  if (!p || !p.draft) return null;
  const arch = ARCHETYPE_BY_ID[p.archetypeId];
  return {
    plan: p.draft,
    title: arch.name,
    subtitle: `PROJECT · ${p.phase.toUpperCase()} · quality ${p.quality}%`,
    accent: "#f2a33c",
    readOnly: false,
    building: null,
    project: p,
    npcs: [
      { id: "dsec", name: "SEC-UNPROVISIONED", role: "security", line: "" },
      { id: "drec", name: "REC-UNPROVISIONED", role: "reception", line: "" },
    ],
  };
}

function botLines(
  npc: NpcSpec,
  state: ReturnType<typeof useGame>["state"],
  building: Building | null,
  project: Project | null,
  plan: FloorPlan,
): string[] {
  const stats = planStats(plan);
  const zones = Object.keys(stats.zones);
  if (npc.role === "security") {
    if (!building)
      return [
        `Unit ${npc.name} is not yet provisioned — security bots come online at Deploy, along with the reception desk.`,
        project
          ? `Current gate is ${project.phase.toUpperCase()} at ${Math.round(project.progress * 100)}%. Risk index ${project.risk}%. I can walk the site once the fabric is up.`
          : "No project data on this site.",
        `Perimeter on record: ${plan.w}×${plan.h} m, ${stats.wall} wall panels, ${stats.doors} controlled openings. Every door is a choke point — that is what I plan around.`,
      ];
    return [
      `Perimeter sweep complete. ${stats.doors} controlled openings, ${stats.wall} wall panels, ${stats.glass} glazed panels — glazing is my weakest line, and I have logged it.`,
      `Fabric condition ${Math.round(building.condition)}%. ${building.condition < 40 ? "Below the 40% cliff: output is running at 60% and I am raising a maintenance ticket every hour." : "Above the efficiency cliff. No maintenance ticket outstanding."}`,
      `${building.visitorsToday} visitor(s) logged today. Allied CEOs roam free; non-allied visitors are held at the reception desk pending your ruling on trespass policy (open question Q7).`,
      `Zones under watch: ${zones.join(", ")}. Trust in your command ${building.securityBot.trust}/100 — overrides at the Approve gate cost me trust, so use them deliberately.`,
    ];
  }
  if (!building)
    return [
      `Desk ${npc.name} offline — reception is provisioned at the Deploy gate.`,
      project
        ? `I have your ${project.changeRequests} change request(s) on file. Filing them during Design is free; after that it costs 5% of budget and 18% of the schedule.`
        : "No project on file.",
      `Planned wayfinding covers ${zones.length} zone(s): ${zones.join(", ") || "none yet"}. Give me a lobby and I will give you a queue.`,
    ];
  return [
    `Good to see you, CEO ${state.ceoName}. Queue is ${building.receptionBot.queue} deep and satisfaction is holding at ${Math.round(building.receptionBot.satisfaction)}%.`,
    `This site is ${stats.usableM2} m² of usable floor across ${stats.rooms} zones — ${Object.entries(stats.zones).map(([z, n]) => `${ZONE_META[z as keyof typeof ZONE_META].label} ${n} m²`).join(", ")}.`,
    `${building.visitorsToday} alliance walk-through(s) today. Visitors spawn at the reception door and get the corridor spine first — that is why I keep the lobby glazed.`,
    state.economy.morale < 45
      ? `Morale across the claim is ${state.economy.morale.toFixed(0)}%. People are asking about rations and the grid. Fix one of those and my satisfaction number follows.`
      : `Claim morale is ${state.economy.morale.toFixed(0)}% — the desk is quiet and the crew is on station.`,
  ];
}
