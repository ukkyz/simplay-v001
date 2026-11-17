"use client";

import React from "react";
import { AREA_META, LEVELS } from "@/game/constants";
import { SCREENS, flows } from "@/game/engine";
import { formatLL } from "@/game/geo";
import type { Screen } from "@/game/types";
import { useGame } from "@/state/store";
import { cn } from "@/utils/cn";
import { Btn, Chip, Icon, Meter } from "./ui";

export const fmt = (n: number, d = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const compact = (n: number) =>
  Math.abs(n) >= 1e6
    ? (n / 1e6).toFixed(2) + "M"
    : Math.abs(n) >= 1e4
      ? (n / 1e3).toFixed(1) + "k"
      : Math.round(n).toString();

/* --------------------------------- Top bar -------------------------------- */

function Readout({
  icon,
  label,
  value,
  sub,
  color,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex min-w-[104px] items-center gap-2 border border-transparent px-2 py-1 text-left transition-colors duration-200 hover:border-line hover:bg-ink-800/70",
        danger && "border-coral/45 bg-coral/8",
      )}
    >
      <span className="shrink-0 transition-transform duration-300 group-hover:scale-110" style={{ color }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="eyebrow block !text-[9px] leading-none">{label}</span>
        <span
          className={cn("num block text-[13px] font-semibold leading-tight", danger && "text-coral blink")}
          style={{ color: danger ? undefined : "#e9f2f3" }}
        >
          {value}
        </span>
        {sub && <span className="num block text-[9.5px] leading-tight text-dim">{sub}</span>}
      </span>
      {danger && <span className="absolute -right-px -top-px h-1.5 w-1.5 bg-coral blink" />}
    </button>
  );
}

export function TopBar() {
  const { state, dispatch, setUi } = useGame();
  const f = flows(state);
  const e = state.economy;
  const day = Math.floor(e.tick / 24) + 1;
  const hour = e.tick % 24;
  const need = LEVELS(e.level);

  return (
    <header className="relative z-20 flex h-[66px] shrink-0 items-stretch gap-2 border-b border-line bg-ink-900/92 px-3 backdrop-blur-sm">
      {/* brand */}
      <div className="flex w-[228px] shrink-0 flex-col justify-center border-r border-line pr-3">
        <div className="flex items-baseline gap-2">
          <span className="display text-[22px] leading-none text-chalk">
            SIM<span className="text-signal">PLAYZ</span>
          </span>
          <span className="num text-[9px] tracking-[0.18em] text-dim">v0.4</span>
        </div>
        <div className="eyebrow mt-1 !text-[8.5px] leading-none">
          {state.company} · CEO {state.ceoName}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Chip color="#f2a33c">LVL {e.level}</Chip>
          <div className="flex-1">
            <Meter value={e.xp} max={need} color="#f2a33c" height={3} />
          </div>
        </div>
      </div>

      {/* resources */}
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        <Readout
          icon={<Icon.coin size={19} />}
          label="Treasury"
          color="#f2a33c"
          value={`₡${compact(e.credits)}`}
          sub={`${f.netCredits >= 0 ? "+" : "−"}₡${compact(Math.abs(f.netCredits))}/h`}
          danger={e.credits < 20000}
        />
        <Readout
          icon={<Icon.bolt size={19} />}
          label="Grid"
          color={f.brownout ? "#ff6a55" : "#35d6c0"}
          value={`${compact(f.produced)}/${compact(f.demanded)}`}
          sub={f.brownout ? "BROWNOUT −50%" : `${compact(f.produced - f.demanded)} kW spare`}
          danger={f.brownout}
          onClick={() => setUi({ screen: "territory" })}
        />
        <Readout
          icon={<Icon.leaf size={19} />}
          label="Rations"
          color={f.food < f.foodDemand ? "#ff6a55" : "#a3cb4d"}
          value={compact(e.food)}
          sub={`${f.food - f.foodDemand >= 0 ? "+" : ""}${(f.food - f.foodDemand).toFixed(1)}/h · ${f.crew} crew`}
          danger={e.food <= 0 && f.crew > 0}
        />
        <Readout
          icon={<Icon.crate size={19} />}
          label="Materials"
          color="#ff8347"
          value={compact(e.materials)}
          sub={`+${f.materials.toFixed(1)}/h`}
        />
        <Readout
          icon={<Icon.grid size={19} />}
          label="Storage"
          color="#6fb7ff"
          value={`${compact(e.storageUsed)}/${compact(e.storageCap)}`}
          sub={e.storageUsed > e.storageCap ? "SPOILING 25%/h" : `${compact(e.storageCap - e.storageUsed)} free`}
          danger={e.storageUsed > e.storageCap}
        />
        <Readout
          icon={<Icon.walk size={19} />}
          label="Morale"
          color={e.morale < 40 ? "#ff6a55" : "#35d6c0"}
          value={`${e.morale.toFixed(0)}%`}
          sub={`rep ${e.reputation.toFixed(0)}`}
          danger={e.morale < 30}
        />
      </div>

      {/* clock + speed */}
      <div className="flex w-[236px] shrink-0 flex-col justify-center border-l border-line pl-3">
        <div className="flex items-baseline justify-between">
          <span className="eyebrow">Sim clock</span>
          <span className="num text-[13px] font-semibold text-chalk">
            D{day} · {String(hour).padStart(2, "0")}:00
          </span>
        </div>
        {state.claim && (
          <div className="num mt-0.5 flex items-center gap-1 text-[9px] text-dim">
            <Icon.pin size={10} /> {formatLL(state.claim.center)} · {state.claim.sideKm}×{state.claim.sideKm} km
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-1">
          {([0, 1, 4, 16] as const).map((sp) => (
            <button
              key={sp}
              onClick={() => dispatch({ type: "speed", speed: sp })}
              className={cn(
                "num border px-2 py-[2px] text-[10px] transition-all duration-200",
                state.speed === sp
                  ? "border-signal bg-signal text-ink-950 shadow-[0_0_14px_-4px_#f2a33c]"
                  : "border-line bg-ink-850 text-mist hover:border-ink-600 hover:text-chalk",
              )}
            >
              {sp === 0 ? "❚❚" : `${sp}×`}
            </button>
          ))}
          <span className="eyebrow ml-auto !text-[8.5px]">
            {state.speed === 0 ? "held" : `${state.speed} sim-h/s`}
          </span>
        </div>
      </div>
    </header>
  );
}

/* --------------------------------- Nav rail -------------------------------- */

export function NavRail() {
  const { state, ui, setUi } = useGame();
  const badges: Partial<Record<Screen, { n: number; c: string }>> = {
    territory: { n: state.projects.filter((p) => p.phase !== "operate").length, c: "#f2a33c" },
    studio: { n: state.buildings.length, c: "#35d6c0" },
    diplomacy: { n: state.remote.filter((r) => r.online).length, c: "#6fb7ff" },
    gdd: { n: state.questions.filter((q) => !q.answer).length, c: "#ff6a55" },
  };
  const iconFor: Record<Screen, (p: { size?: number }) => React.ReactElement> = {
    world: Icon.globe,
    territory: Icon.grid,
    studio: Icon.cube,
    boardroom: Icon.board,
    diplomacy: Icon.handshake,
    gdd: Icon.book,
  };

  return (
    <nav className="relative z-20 flex w-[86px] shrink-0 flex-col items-stretch gap-1 border-r border-line bg-ink-900/80 py-2">
      {SCREENS.map((s) => {
        const Ico = iconFor[s.id];
        const active = ui.screen === s.id;
        const badge = badges[s.id];
        return (
          <button
            key={s.id}
            onClick={() => setUi({ screen: s.id })}
            className={cn(
              "group relative flex flex-col items-center gap-1 px-1 py-2.5 transition-all duration-200",
              active ? "bg-ink-750" : "hover:bg-ink-850",
            )}
          >
            <span
              className={cn(
                "absolute left-0 top-0 h-full w-[2px] transition-all duration-300",
                active ? "bg-signal" : "bg-transparent group-hover:bg-ink-600",
              )}
            />
            <span className={cn("transition-transform duration-300", active ? "scale-110 text-signal" : "text-mist group-hover:text-chalk")}>
              <Ico size={20} />
            </span>
            <span className={cn("num text-[9px] uppercase tracking-[0.1em]", active ? "text-chalk" : "text-dim group-hover:text-mist")}>
              {s.label}
            </span>
            {badge && badge.n > 0 && (
              <span
                className="num absolute right-2 top-1.5 min-w-[15px] border px-[3px] text-[9px] leading-[14px]"
                style={{ color: badge.c, borderColor: `${badge.c}66`, background: `${badge.c}1a` }}
              >
                {badge.n}
              </span>
            )}
          </button>
        );
      })}
      <div className="mt-auto px-2 pb-1">
        <div className="eyebrow !text-[8px] leading-tight">Sectors</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {state.areas.map((a) => (
            <span
              key={a.id}
              className="h-2 w-2 border"
              style={{ background: AREA_META[a.kind].color, borderColor: "#0a1114" }}
              title={`${AREA_META[a.kind].label}: ${a.sites.filter((s) => s.buildingId).length}/5 built`}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}

/* -------------------------------- Ops ticker ------------------------------- */

const KIND_COLOR: Record<string, string> = {
  build: "#f2a33c",
  econ: "#a3cb4d",
  diplo: "#6fb7ff",
  exec: "#35d6c0",
  alert: "#ff6a55",
  visit: "#ff8347",
};

export function OpsTicker() {
  const { state, setUi } = useGame();
  const items = state.log.slice(0, 9);
  return (
    <footer className="relative z-20 flex h-[30px] shrink-0 items-center gap-3 border-t border-line bg-ink-900/92 px-3">
      <button
        onClick={() => setUi({ screen: "gdd" })}
        className="num shrink-0 border border-line bg-ink-850 px-2 py-[2px] text-[9px] uppercase tracking-[0.16em] text-mist transition-colors hover:border-signal hover:text-signal"
      >
        Ops log
      </button>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-6 whitespace-nowrap">
          {items.map((l, i) => (
            <span
              key={`${l.tick}-${i}`}
              className="num slide-in flex items-center gap-1.5 text-[10.5px] text-mist"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className="text-dim">h{l.tick}</span>
              <span style={{ color: KIND_COLOR[l.kind] ?? "#9bb2b8" }}>▸</span>
              <span className="max-w-[640px] truncate">{l.text}</span>
            </span>
          ))}
        </div>
      </div>
      <span className="num shrink-0 text-[9.5px] text-dim">
        {state.netMode === "local-sim" ? "NET: LOCAL-SIM" : "NET: LIVE"} · {state.buildings.length} assets ·{" "}
        {state.projects.filter((p) => p.phase !== "operate").length} in flight
      </span>
    </footer>
  );
}

export function Toast() {
  const { ui } = useGame();
  if (!ui.toast) return null;
  const c = ui.toast.tone === "bad" ? "#ff6a55" : ui.toast.tone === "good" ? "#35d6c0" : "#f2a33c";
  return (
    <div
      className="rise pointer-events-none fixed bottom-12 left-1/2 z-50 -translate-x-1/2 border bg-ink-900/96 px-4 py-2 text-[12px] shadow-[0_18px_50px_-20px_#000]"
      style={{ borderColor: `${c}80`, color: "#e9f2f3" }}
    >
      <span className="num mr-2" style={{ color: c }}>▸</span>
      {ui.toast.text}
    </div>
  );
}

/* ------------------------------- save badge ------------------------------- */

/**
 * Persistence status. The player must always be able to tell whether the last
 * few seconds of progress reached the server, and to retry after a failure.
 */
export function SaveBadge() {
  const { persistence, retrySave } = useGame();
  const { phase, status, revision, conflict } = persistence;

  const tone =
    phase !== "ready" || conflict || status.kind === "error"
      ? "bad"
      : status.kind === "saved"
        ? "good"
        : status.kind === "saving"
          ? "busy"
          : "idle";

  const label =
    conflict
      ? "CONFLICT"
      : phase === "onboarding"
        ? "NOT SAVED"
        : status.kind === "saving"
          ? "SAVING…"
          : status.kind === "saved"
            ? "SAVED"
            : status.kind === "error"
              ? "UNSAVED"
              : status.kind === "conflict"
                ? "CONFLICT"
                : "UNSAVED";

  const detail =
    status.kind === "error"
      ? (status.code === "invalid_save"
          ? "Server rejected this snapshot — export it from the Save screen."
          : `Retrying in ${Math.max(1, Math.round(status.retryInMs / 1000))}s`)
      : status.kind === "conflict"
        ? "Autosave paused"
        : revision > 0
          ? `rev ${revision}`
          : "rev —";

  return (
    <div className="pointer-events-none fixed bottom-2 left-3 z-[820] flex items-center gap-2">
      <span
        className={cn(
          "num flex items-center gap-1.5 border px-1.5 py-[3px] text-[9px] tracking-[0.14em]",
          tone === "good" && "border-teal/50 bg-teal/10 text-teal",
          tone === "bad" && "border-coral/55 bg-coral/10 text-coral",
          tone === "busy" && "border-signal/50 bg-signal/10 text-signal",
          tone === "idle" && "border-line bg-ink-900/80 text-dim",
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {label}
      </span>
      <span className="num text-[9px] text-dim/80">{detail}</span>
      {(status.kind === "error" || conflict) && (
        <span className="pointer-events-auto">
          <Btn size="sm" variant="ghost" onClick={retrySave} className="!px-1.5 !py-0 !text-[9px]">
            <Icon.arrow size={10} /> retry
          </Btn>
        </span>
      )}
    </div>
  );
}
