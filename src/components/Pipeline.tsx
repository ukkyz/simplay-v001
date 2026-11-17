"use client";

import React from "react";
import { ARCHETYPE_BY_ID, EXEC_META, PHASE_CONFIG, TUNABLES } from "@/game/constants";
import { PHASES } from "@/game/types";
import type { Project } from "@/game/types";
import { cn } from "@/utils/cn";
import { Btn, Chip, Icon, Meter } from "./ui";
import { fmt } from "./Shell";

/** SDLC pipeline strip (GDD §6.2). Renders the seven city-management gates. */
export function PhaseStrip({ project, compactMode }: { project: Project; compactMode?: boolean }) {
  const idx = PHASES.indexOf(project.phase);
  return (
    <div className={cn("flex items-stretch gap-[3px]", compactMode && "gap-[2px]")}>
      {PHASES.map((p, i) => {
        const cfg = PHASE_CONFIG[p];
        const done = i < idx;
        const active = i === idx;
        const color = EXEC_META[cfg.owner].color;
        return (
          <div
            key={p}
            className={cn("group relative flex-1", compactMode ? "h-[14px]" : "h-[26px]")}
            title={`${cfg.label} — owned by ${cfg.owner.toUpperCase()} · ${cfg.share ? Math.round(cfg.share * 100) : 0}% of duration`}
          >
            <div
              className="absolute inset-0 border transition-all duration-500"
              style={{
                borderColor: done || active ? color : "#1e343b",
                background: done ? `${color}55` : active ? `${color}22` : "rgba(7,13,16,.6)",
              }}
            >
              {active && (
                <div
                  className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-linear"
                  style={{ width: `${Math.round(project.progress * 100)}%`, background: `${color}aa` }}
                />
              )}
            </div>
            {!compactMode && (
              <span
                className={cn(
                  "num absolute inset-0 flex items-center justify-center text-[8px] uppercase tracking-[0.08em]",
                  active ? "font-semibold" : "",
                )}
                style={{ color: done || active ? "#0a1114" : "#647c84", mixBlendMode: done ? "normal" : "normal" }}
              >
                {done ? "✓" : cfg.label.split(" ")[0]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ProjectCard({
  project,
  onCancel,
  onOverride,
  onChangeRequest,
  onOpenStudio,
}: {
  project: Project;
  onCancel: () => void;
  onOverride?: () => void;
  onChangeRequest?: () => void;
  onOpenStudio?: () => void;
}) {
  const arch = ARCHETYPE_BY_ID[project.archetypeId];
  const cfg = PHASE_CONFIG[project.phase];
  const remaining = Math.max(0, Math.round((1 - project.progress) * Math.max(1, arch.hours * cfg.share)));
  const blocked = !!project.blockedReason;

  return (
    <div
      className={cn(
        "panel-flat relative overflow-hidden p-2.5 transition-all duration-300 hover:border-ink-600",
        blocked && "!border-coral/55",
      )}
    >
      {blocked && <div className="hazard absolute inset-x-0 top-0 h-[3px] opacity-90" />}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold text-chalk">{arch.name}</div>
          <div className="num mt-0.5 flex flex-wrap items-center gap-1.5 text-[9.5px] text-dim">
            <span style={{ color: EXEC_META[cfg.owner].color }}>{cfg.label}</span>
            <span>·</span>
            <span>owner {cfg.owner.toUpperCase()}</span>
            <span>·</span>
            <span>~{remaining} h left</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Chip color="#f2a33c">₡{fmt(Math.round(project.budget - project.spent))}</Chip>
          <Chip color={project.quality > 70 ? "#35d6c0" : project.quality > 45 ? "#f2a33c" : "#ff6a55"}>
            Q{project.quality}%
          </Chip>
        </div>
      </div>

      <div className="mt-2">
        <PhaseStrip project={project} />
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2">
        <Stat label="Risk" value={`${project.risk}%`} tone={project.risk > 55 ? "#ff6a55" : "#9bb2b8"} />
        <Stat label="Spent" value={`₡${fmt(Math.round(project.spent))}`} />
        <Stat label="CRs" value={`${project.changeRequests}`} tone={project.changeRequests ? "#f2a33c" : undefined} />
        <Stat label="QA runs" value={`${project.testAttempts}`} />
      </div>

      {blocked && (
        <p className="num mt-2 border-l-2 border-coral bg-coral/8 px-2 py-1 text-[10px] leading-snug text-coral">
          {project.blockedReason}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {blocked && onOverride && (
          <Btn size="sm" variant="danger" onClick={onOverride} title="Pay 8% expedite fee, −6 CFO trust, +12 risk">
            <Icon.alert size={12} /> CEO override
          </Btn>
        )}
        {onChangeRequest && project.phase !== "operate" && (
          <Btn
            size="sm"
            onClick={onChangeRequest}
            title={project.phase === "design" ? "Free in Design: +4 quality" : "Costs 5% budget and 18% schedule regression"}
          >
            <Icon.plan size={12} /> Change request
          </Btn>
        )}
        {onOpenStudio && (
          <Btn size="sm" variant="teal" onClick={onOpenStudio}>
            <Icon.cube size={12} /> Floor plan
          </Btn>
        )}
        <Btn size="sm" variant="ghost" onClick={onCancel} className="ml-auto">
          Cancel
        </Btn>
      </div>

      <div className="num mt-2 text-[9px] text-dim">
        Started h{project.startedTick} · pipeline cap 6 · phase durations from TUNABLES.tickMs (1 s = 1 sim-hour at 1×)
      </div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="border border-line/70 bg-ink-950/60 px-1.5 py-1">
      <div className="eyebrow !text-[8px] leading-none">{label}</div>
      <div className="num mt-[3px] text-[11px] leading-none" style={{ color: tone ?? "#e9f2f3" }}>
        {value}
      </div>
    </div>
  );
}

export function BuildingCondition({ condition }: { condition: number }) {
  return (
    <Meter
      value={condition}
      color={condition > 70 ? "#35d6c0" : condition > 40 ? "#f2a33c" : "#ff6a55"}
      danger={condition < 40}
      height={4}
      label={`Condition ${Math.round(condition)}%`}
    />
  );
}

export const PIPELINE_NOTE = `Every project runs the same seven gates. Durations are shares of the archetype's build hours
(Discover 6%, Design 14%, Approve 4%, Build 62%, QA 8%, Deploy 6%) with a hard floor so short builds still get a design pass.
Approve is a *gate*, not a timer: it blocks until the treasury covers budget + ${Math.round(15)}% contingency.`;
export const MAX_PIPELINE = 6;
export const TICK_NOTE = TUNABLES.tickMs.why;
