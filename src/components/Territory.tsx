"use client";

import { useEffect, useRef, useState } from "react";
import { AREA_META, ARCHETYPES, ARCHETYPE_BY_ID, EXEC_META, PHASE_CONFIG, TUNABLES } from "@/game/constants";
import { flows, siteLL, systemMods } from "@/game/engine";
import { formatLL } from "@/game/geo";
import { PHASES } from "@/game/types";
import type { ExecRole } from "@/game/types";
import { useGame } from "@/state/store";
import { cn } from "@/utils/cn";
import { Btn, Chip, Icon, KV, Meter, Panel, Sparkline } from "./ui";
import { BuildingCondition, MAX_PIPELINE, PIPELINE_NOTE, PhaseStrip, ProjectCard, Stat } from "./Pipeline";
import { compact, fmt } from "./Shell";

export default function Territory() {
  const { state, dispatch, setUi, toast } = useGame();
  const f = flows(state);
  const mods = systemMods(state);
  const active = state.projects.filter((p) => p.phase !== "operate");

  const [hist, setHist] = useState<number[]>([]);
  const lastTick = useRef(-1);
  useEffect(() => {
    if (state.economy.tick === lastTick.current) return;
    lastTick.current = state.economy.tick;
    setHist((h) => [...h.slice(-47), state.economy.credits]);
  }, [state.economy.tick, state.economy.credits]);

  return (
    <div className="flex h-full min-h-0 gap-3 overflow-hidden p-3">
      {/* ------------------------------ sectors ----------------------------- */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-end justify-between">
          <div>
            <div className="eyebrow">Territory board · {TUNABLES.maxAreas.v} sectors × {TUNABLES.maxSites.v} sites</div>
            <h2 className="display text-[26px] leading-none text-chalk">
              {state.buildings.length}<span className="text-dim">/20</span> SITES BUILT
            </h2>
          </div>
          <div className="flex gap-2">
            <Chip color="#35d6c0">GRID {f.brownout ? "BROWNOUT" : "STABLE"}</Chip>
            <Chip color="#a3cb4d">CREW {f.crew}</Chip>
            <Chip color="#f2a33c">EFFICIENCY {Math.round(f.eff * 100)}%</Chip>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3 overflow-y-auto pr-1">
          {state.areas.map((area) => {
            const meta = AREA_META[area.kind];
            const options = ARCHETYPES.filter((a) => a.area === area.kind);
            return (
              <Panel
                key={area.id}
                accent={meta.color}
                className="min-h-[240px]"
                bodyClass="p-2.5 flex flex-col gap-2 min-h-0"
                title={
                  <span className="flex items-center gap-2">
                    <span style={{ color: meta.color }}>{meta.glyph}</span>
                    <span style={{ color: meta.color }}>{meta.label.toUpperCase()} SECTOR</span>
                    <span className="num normal-case tracking-normal text-dim">
                      {area.sites.filter((s) => s.buildingId).length}/5 · {meta.tagline}
                    </span>
                  </span>
                }
                right={
                  <span className="num text-[9.5px] text-dim">
                    {formatLL(siteLL(state.claim!, area.index, 0))}
                  </span>
                }
              >
                {area.sites.map((site) => {
                  const b = site.buildingId ? state.buildings.find((x) => x.id === site.buildingId) : null;
                  const prj = state.projects.find((p) => p.siteId === site.id);
                  const arch = b ? ARCHETYPE_BY_ID[b.archetypeId] : prj ? ARCHETYPE_BY_ID[prj.archetypeId] : null;
                  return (
                    <div
                      key={site.id}
                      className={cn(
                        "group relative border bg-ink-950/55 px-2 py-1.5 transition-all duration-200",
                        b ? "border-line hover:border-teal/50" : prj ? "border-signal/45" : "border-dashed border-ink-600 hover:border-signal/50",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="num flex h-5 w-5 shrink-0 items-center justify-center border text-[9px]"
                          style={{
                            borderColor: b ? meta.color : "#24424b",
                            background: b ? `${meta.color}22` : "transparent",
                            color: b ? meta.color : "#647c84",
                          }}
                        >
                          {site.index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          {arch ? (
                            <>
                              <span className="block truncate text-[11.5px] font-semibold text-chalk">{arch.name}</span>
                              <span className="num block text-[9px] text-dim">
                                {arch.hours} h · ₡{fmt(arch.cost)} · {arch.power < 0 ? `−${-arch.power} kW` : `${arch.power} kW`}
                                {arch.food ? ` · +${arch.food} food/h` : ""}
                                {arch.materials ? ` · +${arch.materials} mat/h` : ""}
                              </span>
                            </>
                          ) : (
                            <span className="num block text-[10.5px] text-dim group-hover:text-mist">
                              Vacant — {options.length} archetypes available
                            </span>
                          )}
                        </span>
                        {b && (
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="num text-[9px] text-dim">{Math.round(b.condition)}%</span>
                            <Btn
                              size="sm"
                              variant="teal"
                              className="!px-1.5"
                              onClick={() => setUi({ screen: "studio", studioTarget: { kind: "building", id: b.id }, visit: null })}
                              title="Enter the building in first or third person"
                            >
                              <Icon.walk size={12} />
                            </Btn>
                          </div>
                        )}
                        {!b && !prj && (
                          <select
                            className="field !w-[128px] !py-[2px] !text-[10px]"
                            value=""
                            onChange={(e) => {
                              if (!e.target.value) return;
                              dispatch({ type: "startProject", areaId: area.id, siteIndex: site.index, archetypeId: e.target.value });
                              toast(`${ARCHETYPE_BY_ID[e.target.value].name} commissioned at ${meta.label} site ${site.index + 1}.`, "good");
                            }}
                          >
                            <option value="">Commission…</option>
                            {options.map((o) => (
                              <option key={o.id} value={o.id} disabled={state.economy.level < o.unlockAt}>
                                {o.name} — ₡{fmt(o.cost)} · {o.hours}h{o.unlockAt > state.economy.level ? ` (LVL ${o.unlockAt})` : ""}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {b && (
                        <div className="mt-1">
                          <BuildingCondition condition={b.condition} />
                        </div>
                      )}
                      {prj && (
                        <div className="mt-1.5">
                          <PhaseStrip project={prj} compactMode />
                          <div className="num mt-1 flex justify-between text-[9px]">
                            <span style={{ color: EXEC_META[prj.owner].color }}>{prj.phase.toUpperCase()}</span>
                            <span className={prj.blockedReason ? "text-coral" : "text-dim"}>
                              {prj.blockedReason ? "BLOCKED" : `${Math.round(prj.progress * 100)}%`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </Panel>
            );
          })}
        </div>
      </div>

      {/* ------------------------------- ledger ----------------------------- */}
      <div className="flex w-[370px] shrink-0 flex-col gap-3 overflow-y-auto pr-1">
        <Panel title="Economy ledger · per sim-hour" accent="#f2a33c" bodyClass="p-3">
          <KV k="Service revenue" v={`+₡${fmt(Math.round(f.revenue))}`} tone="#a3cb4d" />
          <KV k="Upkeep" v={`−₡${fmt(Math.round(f.upkeep))}`} tone="#ff6a55" />
          <KV k="Civic dividend" v={`+₡${fmt(state.economy.level * 250)} (lvl ${state.economy.level} × 250)`} tone="#a3cb4d" />
          <KV k="Net" v={`${f.netCredits >= 0 ? "+" : "−"}₡${fmt(Math.abs(Math.round(f.netCredits)))}`} tone={f.netCredits >= 0 ? "#a3cb4d" : "#ff6a55"} />
          <div className="mt-2 border-t border-line pt-2">
            <div className="eyebrow mb-1">Treasury trajectory</div>
            <Sparkline points={hist.length > 1 ? hist : [state.economy.credits, state.economy.credits]} color="#f2a33c" w={318} h={34} />
          </div>
          <p className="num mt-2 border-l-2 border-signal/50 pl-2 text-[9.5px] leading-snug text-dim">
            Buildings net +35% over upkeep only while fully powered and fed. Any deficit flips them to a
            half-margin drain — that is the core risk/reward lever, not a hidden tax.
          </p>
        </Panel>

        <Panel title="Resource flows" accent="#35d6c0" bodyClass="p-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Power gen" value={`${compact(f.produced)} kW`} tone="#35d6c0" />
            <Stat label="Power draw" value={`${compact(f.demanded)} kW`} tone={f.brownout ? "#ff6a55" : undefined} />
            <Stat label="Food net" value={`${f.food - f.foodDemand >= 0 ? "+" : ""}${(f.food - f.foodDemand).toFixed(1)}/h`} tone={f.food >= f.foodDemand ? "#a3cb4d" : "#ff6a55"} />
            <Stat label="Materials net" value={`+${f.materials.toFixed(1)}/h`} tone="#ff8347" />
            <Stat label="Storage" value={`${compact(state.economy.storageUsed)}/${compact(f.storageCap)}`} tone={state.economy.storageUsed > f.storageCap ? "#ff6a55" : "#6fb7ff"} />
            <Stat label="Spoiled total" value={compact(state.economy.overflowWaste)} tone={state.economy.overflowWaste > 0 ? "#ff6a55" : undefined} />
          </div>
          <div className="mt-2.5 flex flex-col gap-1.5">
            <Meter value={f.produced} max={Math.max(f.demanded, 1)} color={f.brownout ? "#ff6a55" : "#35d6c0"} label="Grid balance" danger={f.brownout} />
            <Meter value={state.economy.morale} color={state.economy.morale < 40 ? "#ff6a55" : "#a3cb4d"} label="Morale" danger={state.economy.morale < 30} />
          </div>
          <div className="num mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9.5px] text-dim">
            <span>gen ×{mods.genBonus.toFixed(2)} (substation)</span>
            <span>food ×{mods.foodBonus.toFixed(2)} (seed vault)</span>
            <span>XP ×{mods.xpBonus.toFixed(2)} (R&amp;D)</span>
            <span>road ×{mods.roadBonus.toFixed(2)} (packaging)</span>
            <span>trade ×{mods.tradeBonus.toFixed(2)} (depot)</span>
            <span>relation +{mods.relationRate}/h (hub)</span>
          </div>
        </Panel>

        <Panel title={`Pipeline · ${active.length}/${MAX_PIPELINE}`} accent="#6fb7ff" bodyClass="p-3 flex flex-col gap-2">
          {active.length === 0 && (
            <p className="num text-[10.5px] leading-snug text-dim">
              Pipeline empty. Commission a build from any vacant site — Discover is cheap by design so you
              can scout an option before capital is committed.
            </p>
          )}
          {active.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onCancel={() => dispatch({ type: "cancelProject", projectId: p.id })}
              onOverride={p.blockedReason ? () => dispatch({ type: "overrideBlock", projectId: p.id }) : undefined}
              onChangeRequest={() => dispatch({ type: "changeRequest", projectId: p.id })}
              onOpenStudio={() => setUi({ screen: "studio", studioTarget: { kind: "project", id: p.id } })}
            />
          ))}
          <p className="num whitespace-pre-line border-t border-line pt-2 text-[9px] leading-snug text-dim">
            {PIPELINE_NOTE}
          </p>
        </Panel>

        <Panel title="Executive board workload" accent="#35d6c0" bodyClass="p-3 flex flex-col gap-2.5">
          {state.execs.map((e) => {
            const m = EXEC_META[e.role as ExecRole];
            return (
              <div key={e.role} className="border border-line bg-ink-950/50 p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11.5px] font-semibold" style={{ color: m.color }}>
                    {e.role.toUpperCase()} · {e.callsign.split(" / ")[1]}
                  </span>
                  <span className="num text-[9px] text-dim">{m.domain}</span>
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  <Meter value={e.skill} color={m.color} label="Skill" height={3} />
                  <Meter value={e.load} color={e.load > 85 ? "#ff6a55" : m.color} label="Load" height={3} danger={e.load > 85} />
                  <Meter value={e.trust} color="#f2a33c" label="Trust" height={3} />
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <span className="eyebrow mr-1">Stance</span>
                  {(["cautious", "balanced", "aggressive"] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => dispatch({ type: "setStance", role: e.role, stance: st })}
                      className={cn(
                        "num border px-1.5 py-[1px] text-[9px] uppercase transition-all",
                        e.stance === st ? "border-signal bg-signal/15 text-signal" : "border-line text-dim hover:text-mist",
                      )}
                    >
                      {st}
                    </button>
                  ))}
                  <span className="num ml-auto text-[9px] text-dim">
                    {e.stance === "aggressive" ? "+22% speed, −6 quality" : e.stance === "cautious" ? "−18% speed, +8 quality" : "baseline"}
                  </span>
                </div>
              </div>
            );
          })}
          <Btn size="sm" variant="teal" onClick={() => setUi({ screen: "boardroom" })}>
            <Icon.board size={12} /> Open boardroom &amp; model endpoints
          </Btn>
        </Panel>

        <Panel title="Phase gate reference" bodyClass="p-3">
          <div className="flex flex-col gap-1">
            {PHASES.map((p, i) => (
              <div key={p} className="flex items-center gap-2 text-[10.5px]">
                <span className="num w-4 text-dim">{i + 1}</span>
                <span className="w-[74px] font-semibold text-chalk">{p}</span>
                <span className="num w-[40px]" style={{ color: EXEC_META[({ discover: "coo", design: "cto", approve: "cfo", build: "cto", test: "cto", deploy: "coo", operate: "coo" } as Record<string, ExecRole>)[p]].color }}>
                  {({ discover: "coo", design: "cto", approve: "cfo", build: "cto", test: "cto", deploy: "coo", operate: "coo" } as Record<string, ExecRole>)[p]}
                </span>
                <span className="num w-[52px] text-mist">
                  {PHASE_CONFIG[p].share ? `${Math.round(PHASE_CONFIG[p].share * 100)}%` : "—"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[9.5px] leading-snug text-dim" title={PHASE_CONFIG[p].why}>
                  {PHASE_CONFIG[p].why.split(".")[0]}.
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
