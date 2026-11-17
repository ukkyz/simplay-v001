"use client";

import { useRef, useState } from "react";
import {
  ARCHETYPES,
  AREA_META,
  BUILD,
  CHANGELOG,
  EXEC_META,
  MARKET,
  PHASE_CONFIG,
  TRADE,
  TUNABLES,
} from "@/game/constants";
import { flows, systemMods } from "@/game/engine";
import { PHASES } from "@/game/types";
import { GAME_SAVE_SCHEMA, validateGameState } from "@/server/gameSave";
import { useGame, type PersistenceView } from "@/state/store";
import { cn } from "@/utils/cn";
import { Btn, Chip, Icon, KV, Panel } from "./ui";
import { fmt } from "./Shell";

const TABS = ["Overview", "Numbers", "Catalogue", "Questions", "Changelog", "Save"] as const;
type Tab = (typeof TABS)[number];

export default function GDD() {
  const { state, toast, hardReset, persistence, exportState, importState } = useGame();
  const [tab, setTab] = useState<Tab>("Questions");
  const answered = state.questions.filter((q) => q.answer.trim()).length;
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-ink-900/85 px-4 py-2.5">
        <div>
          <div className="eyebrow">Game design document · living artefact · schema {state.schema}</div>
          <h2 className="display text-[22px] leading-none text-chalk">
            SIMPLAYZ <span className="text-signal">GDD</span> v0.4.0
          </h2>
        </div>
        <div className="ml-auto flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "num relative border px-2.5 py-1.5 text-[10.5px] uppercase tracking-[0.12em] transition-all duration-200",
                tab === t ? "border-transparent bg-signal text-ink-950" : "border-line bg-ink-850 text-mist hover:-translate-y-px hover:border-ink-600 hover:text-chalk",
              )}
            >
              {t}
              {t === "Questions" && answered < state.questions.length && (
                <span className="num absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center border border-coral bg-ink-950 px-1 text-[9px] text-coral">
                  {state.questions.length - answered}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "Overview" && <Overview />}
        {tab === "Numbers" && <Numbers />}
        {tab === "Catalogue" && <Catalogue />}
        {tab === "Questions" && <Questions />}
        {tab === "Changelog" && <Changelog />}
        {tab === "Save" && (
          <SaveTab
            fileRef={fileRef}
            onExport={() => {
              // Credentials are stripped by `exportState` (the API-key fields are
              // always empty in the new model, but exports must never regress).
              const blob = new Blob([JSON.stringify(exportState(), null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `simplayz-${state.company.replace(/\s+/g, "-").toLowerCase()}-h${state.economy.tick}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
              toast("Save exported.", "good");
            }}
            onImport={async (file: File) => {
              try {
                if (file.size > 1_500_000) throw new Error("file is larger than 1.5 MB");
                const parsed = JSON.parse(await file.text());
                if (parsed?.schema !== GAME_SAVE_SCHEMA)
                  throw new Error(`schema ${parsed?.schema} is not ${GAME_SAVE_SCHEMA}`);
                // Full structural + reference validation, not a schema-number check.
                const validation = validateGameState(parsed);
                if (!validation.ok || !validation.state)
                  throw new Error(`validation failed (${validation.errors.slice(0, 4).join(", ")})`);
                await importState(validation.state);
              } catch (e) {
                toast(`Import refused — ${(e as Error).message}`, "bad");
              }
            }}
            onReset={() => {
              const ok = window.confirm(
                "Delete the server save for this anonymous session?\n\nThis cannot be undone and it also clears the optional advisor preferences held in that save. The browser's legacy localStorage copy is cleared too. Export a JSON save first if you want a backup.",
              );
              if (!ok) return;
              void hardReset();
            }}
            persistence={persistence}
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------- overview -------------------------------- */

function Overview() {
  const { state } = useGame();
  const f = flows(state);
  const mods = systemMods(state);

  const loops = [
    {
      tag: "Moment to moment · 30 s – 3 min",
      title: "Walk, inspect, adjust",
      color: "#35d6c0",
      w: "flex-[1.05]",
      body: [
        "Enter a building site in first or third person and read the fabric: condition, queue, security alerts.",
        "Edit the 2D floor plan and watch the 3D regenerate from the same cells — 1 cell = 1 m.",
        "Decision: spend this minute on layout quality (+4 quality, free in Design) or on the ops board?",
      ],
    },
    {
      tag: "Session · 10 – 20 min",
      title: "Commission → gate → deploy",
      color: "#f2a33c",
      w: "flex-[1.35]",
      body: [
        "Pick a vacant site, commission an archetype, then push it through Discover → Design → Approve → Build → QA → Deploy → Operate.",
        "The CFO blocks Approve when the treasury cannot cover budget + 15% contingency: wait, cancel, or sign a CEO override for an 8% fee and −6 trust.",
        "Trade with an alliance partner on a 6 h cooldown; relation compounds into better pricing on every future deal.",
      ],
    },
    {
      tag: "Long term · days",
      title: "Portfolio & systemic modifiers",
      color: "#6fb7ff",
      w: "flex-[1.2]",
      body: [
        "20 sites across 4 sectors. Systemic buildings (Substation, Seed Vault, R&D, Freight Depot, Distribution Hub) multiply the whole claim rather than adding raw output.",
        "Level gates Tier 2/3 archetypes; XP scales ×1.55 per level so early wins arrive inside a session.",
        "Alliance CEOs publish interiors you can walk; reputation decides who opens their doors.",
      ],
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
      <section>
        <div className="eyebrow">§1 High concept</div>
        <h3 className="display mt-1 max-w-[900px] text-[30px] leading-[1.02] text-chalk">
          A persistent company on a real parcel of the planet, run by an AI executive board that follows an
          SDLC pipeline.
        </h3>
        <p className="mt-2 max-w-[860px] text-[13px] leading-relaxed text-mist">
          Simplayz is a world simulation, not a city builder with a map skin. The map is OpenStreetMap and the
          claim is a real {TUNABLES.claimSideKm.v}×{TUNABLES.claimSideKm.v} km box anchored to the player's
          position. Everything inside it — sectors, sites, roads, alliance partners, bot staff — is derived from
          that anchor, so no two CEOs get the same opening board. The fantasy is <b className="text-chalk">being
          the person who decides</b>: the executives quantify, the bots execute, the player arbitrates.
        </p>
      </section>

      <section>
        <div className="eyebrow">§4 Core loops</div>
        <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-stretch">
          {loops.map((l, i) => (
            <div key={l.title} className={cn("relative flex gap-2", l.w)}>
              <div className="panel relative flex-1 p-3" style={{ borderTop: `2px solid ${l.color}` }}>
                <div className="eyebrow" style={{ color: l.color }}>{l.tag}</div>
                <h4 className="display mt-1 text-[17px] leading-tight text-chalk">{l.title}</h4>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {l.body.map((b) => (
                    <li key={b} className="flex gap-2 text-[11.5px] leading-snug text-mist">
                      <span style={{ color: l.color }}>▸</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {i < loops.length - 1 && (
                <div className="hidden w-6 shrink-0 items-center justify-center text-dim lg:flex">
                  <Icon.arrow size={18} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[1.25fr_1fr]">
        <Panel title="§6.2 SDLC gate map" accent="#35d6c0" bodyClass="p-3">
          <div className="flex flex-col gap-1.5">
            {PHASES.map((p, i) => {
              const cfg = PHASE_CONFIG[p];
              const m = EXEC_META[cfg.owner];
              return (
                <div key={p} className="flex items-center gap-2">
                  <span className="num w-4 shrink-0 text-[10px] text-dim">{i + 1}</span>
                  <span className="w-[76px] shrink-0 border px-1.5 py-[2px] text-center text-[10px] font-semibold" style={{ color: m.color, borderColor: `${m.color}55`, background: `${m.color}12` }}>
                    {cfg.label}
                  </span>
                  <span className="num w-[86px] shrink-0 text-[9.5px] text-dim">{cfg.owner.toUpperCase()} · {cfg.share ? `${Math.round(cfg.share * 100)}%` : "terminal"}</span>
                  <span className="min-w-0 flex-1 text-[10.5px] leading-snug text-mist">{cfg.why}</span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="§9 Live economy snapshot" accent="#f2a33c" bodyClass="p-3">
          <KV k="Treasury" v={`₡${fmt(Math.round(state.economy.credits))}`} tone="#f2a33c" />
          <KV k="Net per hour" v={`${f.netCredits >= 0 ? "+" : "−"}₡${fmt(Math.abs(Math.round(f.netCredits)))}`} tone={f.netCredits >= 0 ? "#a3cb4d" : "#ff6a55"} />
          <KV k="Grid" v={`${fmt(f.produced)} / ${fmt(f.demanded)} kW`} tone={f.brownout ? "#ff6a55" : "#35d6c0"} />
          <KV k="Rations net" v={`${(f.food - f.foodDemand).toFixed(1)}/h for ${f.crew} crew`} tone={f.food >= f.foodDemand ? "#a3cb4d" : "#ff6a55"} />
          <KV k="Storage" v={`${fmt(state.economy.storageUsed)} / ${fmt(f.storageCap)}`} tone={state.economy.storageUsed > f.storageCap ? "#ff6a55" : "#6fb7ff"} />
          <KV k="Morale / reputation" v={`${state.economy.morale.toFixed(0)} · ${state.economy.reputation.toFixed(0)}`} />
          <KV k="Systemic modifiers" v={`gen ×${mods.genBonus.toFixed(2)} · food ×${mods.foodBonus.toFixed(2)} · XP ×${mods.xpBonus.toFixed(2)}`} />
          <KV k="Road / trade modifiers" v={`road ×${mods.roadBonus.toFixed(2)} · trade ×${mods.tradeBonus.toFixed(2)}`} />
          <p className="num mt-2 border-l-2 border-signal/60 pl-2 text-[9.5px] leading-snug text-dim">
            Failure states are all recoverable by design: brownout halves output, starvation drains morale at
            1.5/h, overflow spoils 25%/h. Nothing zeroes. A CEO who ignores the sim for a day comes back to a
            bad city, not a dead one.
          </p>
        </Panel>
      </section>

      <section className="grid gap-3 lg:grid-cols-4">
        {Object.entries(AREA_META).map(([k, m]) => {
          const n = ARCHETYPES.filter((a) => a.area === k).length;
          const built = state.areas.find((a) => a.kind === k)?.sites.filter((s) => s.buildingId).length ?? 0;
          return (
            <div key={k} className="panel-flat p-3" style={{ borderLeft: `2px solid ${m.color}` }}>
              <div className="flex items-baseline justify-between">
                <span className="display text-[15px]" style={{ color: m.color }}>{m.label.toUpperCase()}</span>
                <span className="num text-[10px] text-dim">{built}/5</span>
              </div>
              <div className="num mt-0.5 text-[9.5px] text-dim">{m.tagline} · {n} archetypes</div>
              <div className="mt-2 flex flex-col gap-0.5">
                {ARCHETYPES.filter((a) => a.area === k).map((a) => (
                  <span key={a.id} className="num flex justify-between text-[9.5px] text-mist">
                    <span className="truncate">{a.name}</span>
                    <span className="text-dim">T{a.tier}</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/* --------------------------------- numbers --------------------------------- */

function Numbers() {
  const rows: [string, string | number, string][] = [
    ...Object.entries(TUNABLES).map(([k, v]) => [k, v.v as string | number, v.why] as [string, string | number, string]),
    ["MARKET.driftBand", MARKET.driftBand, MARKET.why],
    ["TRADE.cooldownHours", TRADE.cooldownHours, TRADE.why],
    ["TRADE.relationPriceSlope", TRADE.relationPriceSlope, "Price improves on both sides of the deal as relation rises, so diplomacy is a compounding economic asset rather than a flavour stat."],
    ["serviceMargin", "0.35", "Operational buildings net +35% over their upkeep, but only while the claim is fully powered and fed. Any deficit halves the margin — the risk/reward lever in one number."],
    ["BUILD.budget", "cost × 1.15", BUILD.why],
    ["approveGate", "budget − spent, re-checked hourly", "A gate that never re-opens is a dead end, so the CFO re-evaluates every sim-hour and releases funding the moment the treasury or the materials yard recovers. The CEO override (8% fee, −6 trust) exists for when you cannot wait."],
    ["crewRationRate", "0.4 u/crew·h", "One ration unit covers 2.5 crew-hours. At an opening crew of 4 the draw is 1.6 u/h, which a single Vertical Farm (14 u/h) covers eight times over — food is a tutorial, not a wall."],
    ["qaPassRoll", "quality − 0.25·risk + 0.1·CTO skill", "QA is legible arithmetic the player can influence in three distinct ways: author a better plan, cut scope to lower risk, or level the CTO."],
    ["reworkPenalty", "30% of build duration", "A failed QA returns to Build at 70% progress and costs 10 quality. Punishes skipping Design, never the player who tried."],
    ["pipelineCap", 6, "Crew, not space, is the constraint. 6 concurrent projects is the point at which exec load crosses 85% and phase speed drops to 70%."],
    ["xpCurve", "600 × 1.55^(L−1)", "Level 2 in roughly one session, level 5 in a long arc. Tier gates hang off it so unlocks feel earned, not time-locked."],
  ];
  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="eyebrow">§9 Numbers &amp; rationale</div>
      <h3 className="display mt-1 text-[26px] leading-none text-chalk">NO MAGIC NUMBERS</h3>
      <p className="mt-1.5 max-w-[820px] text-[12.5px] leading-relaxed text-mist">
        Every tunable in the shipped build, with the reasoning that set it. Change any of these and the loops
        below change shape — that is the point of writing them down.
      </p>
      <div className="panel mt-3 overflow-hidden">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-ink-850/70">
              <th className="eyebrow px-3 py-2 !text-mist">Tunable</th>
              <th className="eyebrow px-3 py-2 !text-mist">Value</th>
              <th className="eyebrow px-3 py-2 !text-mist">Rationale</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v, why], i) => (
              <tr key={k} className={cn("border-b border-line/60 transition-colors hover:bg-ink-800/60", i % 2 && "bg-ink-950/35")}>
                <td className="num px-3 py-2 text-[11px] font-semibold text-signal">{k}</td>
                <td className="num px-3 py-2 text-[11px] text-chalk">{String(v)}</td>
                <td className="px-3 py-2 text-[11px] leading-snug text-mist">{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------- catalogue -------------------------------- */

function Catalogue() {
  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="eyebrow">§5 Building catalogue</div>
      <h3 className="display mt-1 text-[26px] leading-none text-chalk">20 ARCHETYPES · 4 SECTORS · 3 TIERS</h3>
      <p className="mt-1.5 max-w-[860px] text-[12.5px] leading-relaxed text-mist">
        Authored from first principles — this list is a proposal, not an assumption. Every row is a hypothesis
        about a decision the player should be making. Overrule any of it in the Questions tab (Q4).
      </p>
      <div className="panel mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-ink-850/70">
              {["Archetype", "Sector", "T", "₡ cost", "h build", "₡/h up", "kW", "food/h", "mat/h", "store", "crew", "LVL", "Why it exists"].map((h) => (
                <th key={h} className="eyebrow whitespace-nowrap px-2 py-2 !text-mist">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ARCHETYPES.map((a, i) => (
              <tr key={a.id} className={cn("border-b border-line/60 align-top transition-colors hover:bg-ink-800/60", i % 2 && "bg-ink-950/35")}>
                <td className="px-2 py-2">
                  <div className="text-[11.5px] font-semibold text-chalk">{a.name}</div>
                  <div className="text-[10px] leading-snug text-dim">{a.blurb}</div>
                </td>
                <td className="num px-2 py-2 text-[10px]" style={{ color: AREA_META[a.area].color }}>{a.area}</td>
                <td className="num px-2 py-2 text-[10px] text-mist">{a.tier}</td>
                <td className="num px-2 py-2 text-[10.5px] text-signal">{fmt(a.cost)}</td>
                <td className="num px-2 py-2 text-[10.5px] text-mist">{a.hours}</td>
                <td className="num px-2 py-2 text-[10.5px] text-mist">{fmt(a.upkeep)}</td>
                <td className="num px-2 py-2 text-[10.5px]" style={{ color: a.power < 0 ? "#35d6c0" : "#ff8347" }}>{a.power < 0 ? `−${-a.power}` : a.power}</td>
                <td className="num px-2 py-2 text-[10.5px] text-moss">{a.food || "—"}</td>
                <td className="num px-2 py-2 text-[10.5px] text-rust">{a.materials || "—"}</td>
                <td className="num px-2 py-2 text-[10.5px] text-sky2">{a.storage || "—"}</td>
                <td className="num px-2 py-2 text-[10.5px] text-mist">{a.crew}</td>
                <td className="num px-2 py-2 text-[10.5px] text-dim">{a.unlockAt}</td>
                <td className="max-w-[340px] px-2 py-2 text-[10.5px] leading-snug text-mist">{a.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------- questions -------------------------------- */

const IMPACT_COLOR = { high: "#ff6a55", medium: "#f2a33c", low: "#6fb7ff" } as const;

function Questions() {
  const { state, dispatch, toast } = useGame();
  const answered = state.questions.filter((q) => q.answer.trim()).length;
  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="eyebrow">§16 Requirements clarification register</div>
      <h3 className="display mt-1 text-[28px] leading-none text-chalk">
        {state.questions.length - answered} OF {state.questions.length} QUESTIONS{" "}
        <span className={answered === state.questions.length ? "text-teal" : "text-coral"}>
          {answered === state.questions.length ? "ANSWERED" : "STILL OPEN"}
        </span>
      </h3>
      <p className="mt-2 max-w-[880px] border-l-2 border-coral bg-coral/6 px-3 py-2 text-[12.5px] leading-relaxed text-mist">
        I was told not to assume. The build below ships anyway, because a playable wrong answer is easier to
        correct than an empty spec — but every place I chose for you is recorded here with the default I picked
        and the reason. Answer inline; rulings persist with the save and drive the next revision's changelog.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {state.questions.map((q) => (
          <div key={q.id} className={cn("panel p-3 transition-colors", q.answer.trim() && "!border-teal/45")}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="num text-[11px] font-bold text-signal">{q.id.toUpperCase()}</span>
              <Chip color={IMPACT_COLOR[q.impact]}>{q.impact} impact</Chip>
              <span className="num text-[9.5px] text-dim">{q.section}</span>
              {q.answer.trim() && <Chip color="#35d6c0">RULED</Chip>}
            </div>
            <p className="mt-1.5 text-[13px] font-semibold leading-snug text-chalk">{q.question}</p>
            <p className="mt-1 text-[11.5px] leading-snug text-mist">
              <b className="text-dim">Shipped default: </b>
              {q.assumption}
            </p>
            <div className="mt-2 flex gap-2">
              <input
                className="field flex-1"
                placeholder="Your ruling…"
                value={q.answer}
                onChange={(e) => dispatch({ type: "answer", id: q.id, answer: e.target.value })}
              />
              <Btn
                size="sm"
                variant={q.answer.trim() ? "teal" : "default"}
                disabled={!q.answer.trim()}
                onClick={() => {
                  dispatch({ type: "log", entry: { kind: "exec", text: `CEO ruling recorded on ${q.id.toUpperCase()} (${q.section}): “${q.answer.trim()}” — queued for the next GDD revision.` } });
                  toast(`Ruling on ${q.id.toUpperCase()} logged to the ops feed.`, "good");
                }}
              >
                <Icon.check size={12} /> Log ruling
              </Btn>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- changelog -------------------------------- */

function Changelog() {
  const { state } = useGame();
  return (
    <div className="mx-auto max-w-[900px]">
      <div className="eyebrow">§17 Version history</div>
      <h3 className="display mt-1 text-[26px] leading-none text-chalk">CHANGELOG</h3>
      <div className="mt-3 flex flex-col">
        {CHANGELOG.map((c, i) => (
          <div key={c.v} className="relative flex gap-4 pb-5">
            <div className="flex w-[104px] shrink-0 flex-col items-end">
              <span className="display text-[17px] leading-none text-signal">{c.v}</span>
              <span className="num mt-1 text-[9px] text-dim">{c.date}</span>
            </div>
            <div className="relative flex flex-col items-center">
              <span className={cn("mt-1 h-2.5 w-2.5 rotate-45 border", i === 0 ? "border-signal bg-signal" : "border-ink-600 bg-ink-900")} />
              {i < CHANGELOG.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
            </div>
            <div className="min-w-0 flex-1 border border-line bg-ink-900/60 p-3">
              <ul className="flex flex-col gap-1">
                {c.notes.map((n) => (
                  <li key={n} className="flex gap-2 text-[11.5px] leading-snug text-mist">
                    <span className="text-dim">▸</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
      <div className="panel-flat p-3">
        <div className="eyebrow">Next revision is gated on</div>
        <p className="mt-1 text-[12px] leading-relaxed text-mist">
          The {state.questions.filter((q) => !q.answer.trim()).length} unanswered question(s) in the register.
          Q1 (claim size), Q2 (authoritative backend) and Q6 (AI provider contract) are the three that change
          architecture rather than content — they are the ones I would answer first.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------- save ----------------------------------- */

function SaveTab({
  fileRef,
  onExport,
  onImport,
  onReset,
  persistence,
}: {
  fileRef: React.MutableRefObject<HTMLInputElement | null>;
  onExport: () => void;
  onImport: (f: File) => void;
  onReset: () => void;
  persistence: PersistenceView;
}) {
  const { state } = useGame();
  return (
    <div className="mx-auto max-w-[760px]">
      <div className="eyebrow">§3 Persistence</div>
      <h3 className="display mt-1 text-[26px] leading-none text-chalk">SAVE &amp; STATE</h3>
      <div className="panel mt-3 p-3">
        <KV k="Game-save schema" v={state.schema} />
        <KV k="Save storage" v="SQLite on the game server (durable snapshot)" />
        <KV k="Save revision" v={persistence.revision || "—"} />
        <KV k="Autosave status" v={persistence.status.kind.toUpperCase()} />
        <KV k="Legacy key (read-only)" v="simplayz.save.v4 (browser, migrated one-time)" />
        <KV k="Credentials in save" v="none — server-side operator keys" tone="#35d6c0" />
        <KV k="CEO / company" v={`${state.ceoName} · ${state.company}`} />
        <KV k="Claim centre" v={`${state.claim!.center.lat.toFixed(4)}, ${state.claim!.center.lng.toFixed(4)} (${state.claim!.placedBy})`} />
        <KV k="Sim hour" v={`${state.economy.tick} (day ${(state.economy.tick / 24).toFixed(1)})`} />
        <KV k="Buildings / projects" v={`${state.buildings.length} / ${state.projects.length}`} />
        <KV k="Log entries retained" v={`${state.log.length} of ${TUNABLES.maxLog.v}`} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn variant="primary" onClick={onExport}>
            <Icon.arrow size={13} /> Export save JSON
          </Btn>
          <Btn variant="teal" onClick={() => fileRef.current?.click()}>
            Import save JSON
          </Btn>
          <Btn variant="danger" onClick={onReset}>
            <Icon.close size={13} /> Wipe registry &amp; re-register
          </Btn>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = "";
            }}
          />
        </div>
        <p className="num mt-3 border-l-2 border-signal/60 pl-2 text-[10px] leading-snug text-dim">
          Progress is persisted as a complete snapshot in the server&apos;s SQLite database, keyed to this
          browser&apos;s anonymous session cookie. The simulation still runs in your browser. Clearing site
          data or the session cookie loses access to that save unless you exported it — there is no account
          recovery yet. Reset deletes the server save for this session and clears the in-game advisor
          preferences; it does not delete the anonymous session row.
        </p>
      </div>
    </div>
  );
}
