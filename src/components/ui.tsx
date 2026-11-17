"use client";

import React from "react";
import { cn } from "@/utils/cn";

/* ------------------------------- Icons ------------------------------- */
type IP = { className?: string; size?: number };
const S = ({ children, className, size = 16 }: IP & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="square"
    strokeLinejoin="miter"
    className={className}
    aria-hidden
  >
    {children}
  </svg>
);

export const Icon = {
  globe: (p: IP) => (
    <S {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.6 3 14.4 0 18M12 3c-3 3.6-3 14.4 0 18" />
    </S>
  ),
  grid: (p: IP) => (
    <S {...p}>
      <path d="M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18" />
    </S>
  ),
  plan: (p: IP) => (
    <S {...p}>
      <path d="M3 4h18v16H3z M3 12h7 M10 12v8 M14 4v6 M14 10h7" />
    </S>
  ),
  cube: (p: IP) => (
    <S {...p}>
      <path d="M12 2.6 21 7v10l-9 4.4L3 17V7z M3 7l9 4.4L21 7 M12 11.4V21.4" />
    </S>
  ),
  board: (p: IP) => (
    <S {...p}>
      <path d="M3 5h18v11H8l-5 4z M7 9h10 M7 12h6" />
    </S>
  ),
  handshake: (p: IP) => (
    <S {...p}>
      <path d="M2 12l4-4 4 2 4-2 4 2 4-2 M6 8v8l4 3 3-2 3 2 2-2V8" />
    </S>
  ),
  book: (p: IP) => (
    <S {...p}>
      <path d="M4 3h7a3 3 0 013 3v15a2.5 2.5 0 00-2.5-2.5H4z M20 3h-4v15h4z" />
    </S>
  ),
  bolt: (p: IP) => (
    <S {...p}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
    </S>
  ),
  leaf: (p: IP) => (
    <S {...p}>
      <path d="M4 20c0-9 6-15 16-16 0 10-6 16-16 16z M4 20l8-8" />
    </S>
  ),
  crate: (p: IP) => (
    <S {...p}>
      <path d="M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10" />
    </S>
  ),
  gear: (p: IP) => (
    <S {...p}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2" />
    </S>
  ),
  coin: (p: IP) => (
    <S {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.2c-.6-.9-1.6-1.3-2.7-1.3-1.6 0-2.6.8-2.6 2s1 1.7 2.7 2.1c1.9.4 2.9 1 2.9 2.3 0 1.3-1.2 2.1-2.9 2.1-1.3 0-2.4-.5-2.9-1.5M12 6v12" />
    </S>
  ),
  play: (p: IP) => (
    <S {...p}>
      <path d="M6 3.5 20 12 6 20.5z" />
    </S>
  ),
  pause: (p: IP) => (
    <S {...p}>
      <path d="M7 4v16M17 4v16" />
    </S>
  ),
  pin: (p: IP) => (
    <S {...p}>
      <path d="M12 21s7-6.4 7-11a7 7 0 10-14 0c0 4.6 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </S>
  ),
  alert: (p: IP) => (
    <S {...p}>
      <path d="M12 3 22 20H2z M12 9v5 M12 17h.01" />
    </S>
  ),
  check: (p: IP) => (
    <S {...p}>
      <path d="M4 12.5 9.5 18 20 6.5" />
    </S>
  ),
  close: (p: IP) => (
    <S {...p}>
      <path d="M5 5l14 14M19 5L5 19" />
    </S>
  ),
  arrow: (p: IP) => (
    <S {...p}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </S>
  ),
  bot: (p: IP) => (
    <S {...p}>
      <rect x="4" y="7" width="16" height="12" />
      <path d="M12 3v4M8 12h.01M16 12h.01M9 16h6" />
    </S>
  ),
  road: (p: IP) => (
    <S {...p}>
      <path d="M7 3 4 21M17 3l3 18M12 4v3M12 11v3M12 18v3" />
    </S>
  ),
  walk: (p: IP) => (
    <S {...p}>
      <circle cx="13" cy="4" r="2" />
      <path d="M11 21l2-6-3-3 1-5 3 3 3 1M13 15l-4-2" />
    </S>
  ),
  eye: (p: IP) => (
    <S {...p}>
      <path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </S>
  ),
};

/* ------------------------------ Surfaces ------------------------------ */

export function Panel({
  title,
  right,
  children,
  className,
  bodyClass,
  accent,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
  accent?: string;
}) {
  return (
    <section className={cn("panel inset-shadow relative flex min-h-0 flex-col", className)}>
      {accent && <span className="absolute left-0 top-0 h-full w-[2px]" style={{ background: accent }} />}
      {title && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2">
          <h2 className="eyebrow !text-mist">{title}</h2>
          {right}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClass ?? "p-3")}>{children}</div>
    </section>
  );
}

export function Chip({
  children,
  color,
  solid,
  className,
}: {
  children: React.ReactNode;
  color?: string;
  solid?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("num inline-flex items-center gap-1 border px-1.5 py-[1px] text-[10px] tracking-wide", className)}
      style={{
        color: solid ? "#0a1114" : color ?? "#9bb2b8",
        background: solid ? color ?? "#9bb2b8" : color ? `${color}1f` : "rgba(21,36,42,.6)",
        borderColor: color ? `${color}66` : "#1e343b",
      }}
    >
      {children}
    </span>
  );
}

export function Meter({
  value,
  max = 100,
  color = "#35d6c0",
  height = 4,
  label,
  danger,
}: {
  value: number;
  max?: number;
  color?: string;
  height?: number;
  label?: string;
  danger?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="w-full">
      {label && (
        <div className="mb-1 flex items-baseline justify-between">
          <span className="eyebrow">{label}</span>
          <span className="num text-[10px] text-mist">{Math.round(pct)}%</span>
        </div>
      )}
      <div className="relative w-full overflow-hidden bg-ink-950" style={{ height }}>
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%`, background: danger ? "#ff6a55" : color, boxShadow: `0 0 12px -2px ${danger ? "#ff6a55" : color}` }}
        />
        {danger && <div className="absolute inset-0 hazard opacity-40" />}
      </div>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = "default",
  disabled,
  className,
  title,
  size = "md",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "teal" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  title?: string;
  size?: "sm" | "md";
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "teal" && "btn-teal",
        variant === "danger" && "!border-coral/50 !bg-coral/12 !text-coral hover:!bg-coral/22",
        variant === "ghost" && "!border-transparent !bg-transparent hover:!bg-ink-750",
        size === "sm" && "!px-2 !py-1 !text-[11px]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function KV({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line/60 py-[3px] last:border-0">
      <span className="eyebrow !text-dim">{k}</span>
      <span className="num text-[11.5px]" style={{ color: tone ?? "#e9f2f3" }}>
        {v}
      </span>
    </div>
  );
}

/** Ambient topographic backdrop — the game is about land, so the chrome is land. */
export function TopoBackdrop() {
  return (
    <div className="topo">
      <svg width="100%" height="100%" aria-hidden>
        <defs>
          <pattern id="topoGrid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0V48" fill="none" stroke="#12333a" strokeWidth="0.6" opacity="0.55" />
          </pattern>
          <pattern id="topoLines" width="240" height="160" patternUnits="userSpaceOnUse">
            <g fill="none" stroke="#1d4b52" strokeWidth="0.8" opacity="0.5">
              <path d="M-20 120c40-30 70 12 110-14s60-52 100-30 60 44 90 20" />
              <path d="M-20 100c40-30 70 12 110-14s60-52 100-30 60 44 90 20" />
              <path d="M-20 80c40-30 70 12 110-14s60-52 100-30 60 44 90 20" />
              <path d="M-20 60c40-30 70 12 110-14s60-52 100-30 60 44 90 20" />
              <path d="M-20 40c40-30 70 12 110-14s60-52 100-30 60 44 90 20" />
              <ellipse cx="180" cy="30" rx="26" ry="12" />
              <ellipse cx="180" cy="30" rx="16" ry="7" />
              <ellipse cx="46" cy="132" rx="30" ry="14" />
              <ellipse cx="46" cy="132" rx="18" ry="8" />
            </g>
          </pattern>
          <radialGradient id="glowA" cx="18%" cy="12%" r="55%">
            <stop offset="0%" stopColor="#12565a" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#0a1114" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="glowB" cx="86%" cy="82%" r="52%">
            <stop offset="0%" stopColor="#6b4415" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#0a1114" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="#070d10" />
        <rect width="100%" height="100%" fill="url(#glowA)" />
        <rect width="100%" height="100%" fill="url(#glowB)" />
        <g className="topo-drift">
          <rect x="-260" y="-180" width="200%" height="200%" fill="url(#topoLines)" />
        </g>
        <rect width="100%" height="100%" fill="url(#topoGrid)" opacity="0.5" />
      </svg>
    </div>
  );
}

export function Sparkline({ points, color = "#35d6c0", w = 92, h = 22 }: { points: number[]; color?: string; w?: number; h?: number }) {
  if (points.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((p - min) / span) * (h - 3) - 1.5).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" />
      <circle cx={w} cy={h - ((points[points.length - 1] - min) / span) * (h - 3) - 1.5} r="1.8" fill={color} />
    </svg>
  );
}
