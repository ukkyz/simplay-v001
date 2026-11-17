"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ZONE_META } from "@/game/constants";
import { clonePlan, planStats } from "@/game/plans";
import { DOOR, FLOOR, GLASS, VOID, WALL } from "@/game/plans";
import type { Cell, FloorPlan, PropKind, ZoneKind } from "@/game/types";
import { cn } from "@/utils/cn";
import { Btn, Chip, Icon } from "./ui";

type Tool = "wall" | "floor" | "door" | "glass" | "void" | "zone" | "prop" | "eraser";

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "wall", label: "Wall", hint: "Solid 1 m panel, 2.9 m high. Blocks movement and sight." },
  { id: "floor", label: "Floor", hint: "Walkable slab. Zone colour drives the 3D floor material." },
  { id: "door", label: "Door", hint: "2.15 m opening with a lintel. The only way through a wall." },
  { id: "glass", label: "Glazing", hint: "Vision panel. Solid to movement, translucent in 3D." },
  { id: "void", label: "Void", hint: "Cuts the cell out of the footprint entirely." },
  { id: "zone", label: "Zone", hint: "Paints the functional zone of a floor cell." },
  { id: "prop", label: "Prop", hint: "Places furniture / equipment on a floor cell." },
  { id: "eraser", label: "Clear prop", hint: "Removes the prop but keeps the floor." },
];

const ZONES = Object.keys(ZONE_META) as ZoneKind[];
const PROPS: PropKind[] = ["desk", "rack", "machine", "tank", "console", "crate", "planter", "bunk"];

export default function FloorPlanEditor({
  plan,
  onChange,
  readOnly,
  accent = "#35d6c0",
}: {
  plan: FloorPlan;
  onChange?: (p: FloorPlan) => void;
  readOnly?: boolean;
  accent?: string;
}) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState<FloorPlan>(plan);
  const [tool, setTool] = useState<Tool>("wall");
  const [zone, setZone] = useState<ZoneKind>("office");
  const [prop, setProp] = useState<PropKind>("desk");
  const [brush, setBrush] = useState(1);
  const [scale, setScale] = useState(20);
  const [off, setOff] = useState({ x: 30, y: 30 });
  const undo = useRef<FloorPlan[]>([]);
  const painting = useRef(false);
  const panning = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (plan.id !== local.id || plan.revision !== local.revision) setLocal(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id, plan.revision]);

  const commit = useCallback(
    (next: FloorPlan) => {
      setLocal(next);
      onChange?.(next);
    },
    [onChange],
  );

  const snapshot = useCallback(() => {
    undo.current = [...undo.current.slice(-39), { ...local, cells: local.cells.map((c) => ({ ...c })) }];
  }, [local]);

  /* ------------------------------- drawing ------------------------------- */
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#070d10";
    g.fillRect(0, 0, w, h);

    // site context grid
    g.strokeStyle = "#12333a";
    g.lineWidth = 0.5;
    for (let x = 0; x < w; x += 24) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 0; y < h; y += 24) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }

    const s = scale;
    // footprint shadow
    g.fillStyle = "rgba(0,0,0,.5)";
    g.fillRect(off.x + 5, off.y + 6, local.w * s, local.h * s);

    for (let y = 0; y < local.h; y++) {
      for (let x = 0; x < local.w; x++) {
        const c = local.cells[y * local.w + x];
        const px = off.x + x * s;
        const py = off.y + y * s;
        if (c.t === VOID) {
          g.fillStyle = "#0a1114";
          g.fillRect(px, py, s, s);
          continue;
        }
        if (c.t === FLOOR || c.t === DOOR) {
          g.fillStyle = ZONE_META[c.z ?? "corridor"].color;
          g.fillRect(px, py, s, s);
        }
        if (c.t === WALL) {
          g.fillStyle = "#b6c5c8";
          g.fillRect(px, py, s, s);
          g.fillStyle = "rgba(0,0,0,.22)";
          g.fillRect(px, py + s * 0.72, s, s * 0.28);
        }
        if (c.t === GLASS) {
          g.fillStyle = "rgba(159,216,255,.42)";
          g.fillRect(px, py, s, s);
          g.strokeStyle = "#9fd8ff";
          g.lineWidth = 1;
          g.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
        }
        if (c.t === DOOR) {
          g.fillStyle = "#f2a33c";
          g.fillRect(px + s * 0.16, py + s * 0.16, s * 0.68, s * 0.68);
          g.strokeStyle = "#0a1114";
          g.lineWidth = 1.2;
          g.beginPath();
          g.arc(px + s * 0.2, py + s * 0.5, s * 0.52, -Math.PI / 2.4, Math.PI / 5);
          g.stroke();
        }
        if (c.p && s > 9) drawProp(g, c.p, px, py, s);
        if (s > 13) {
          g.strokeStyle = "rgba(255,255,255,.05)";
          g.lineWidth = 0.5;
          g.strokeRect(px + 0.25, py + 0.25, s - 0.5, s - 0.5);
        }
      }
    }

    // dimensions
    g.fillStyle = "#647c84";
    g.font = "500 9px 'IBM Plex Mono', monospace";
    g.textAlign = "center";
    for (let x = 0; x <= local.w; x += 2) {
      g.fillText(`${x}`, off.x + x * s, off.y - 6);
    }
    g.textAlign = "right";
    for (let y = 0; y <= local.h; y += 2) {
      g.fillText(`${y}`, off.x - 6, off.y + y * s + 3);
    }
    g.textAlign = "left";
    g.fillStyle = accent;
    g.font = "700 10px 'IBM Plex Mono', monospace";
    g.fillText(`${local.w} m × ${local.h} m · ${local.storeys} storey(ies) · ${local.name}`, off.x, off.y + local.h * s + 16);

    // zone labels at centroids
    if (s > 15) {
      const cents: Record<string, { x: number; y: number; n: number }> = {};
      for (let y = 0; y < local.h; y++)
        for (let x = 0; x < local.w; x++) {
          const c = local.cells[y * local.w + x];
          if (c.t !== FLOOR || !c.z) continue;
          const k = c.z;
          cents[k] = cents[k] ?? { x: 0, y: 0, n: 0 };
          cents[k].x += x;
          cents[k].y += y;
          cents[k].n++;
        }
      g.font = "600 8.5px 'IBM Plex Mono', monospace";
      g.textAlign = "center";
      Object.entries(cents).forEach(([k, v]) => {
        const cx = off.x + (v.x / v.n + 0.5) * s;
        const cy = off.y + (v.y / v.n + 0.5) * s;
        g.fillStyle = "rgba(7,13,16,.72)";
        const label = ZONE_META[k as ZoneKind].label.toUpperCase();
        g.fillRect(cx - label.length * 3 - 3, cy - 6, label.length * 6 + 6, 12);
        g.fillStyle = "#e9f2f3";
        g.fillText(label, cx, cy + 3);
      });
      g.textAlign = "left";
    }
  }, [local, scale, off, accent]);

  function drawProp(g: CanvasRenderingContext2D, p: PropKind, px: number, py: number, s: number) {
    g.save();
    g.translate(px + s / 2, py + s / 2);
    const r = s * 0.3;
    g.fillStyle = "rgba(233,242,243,.86)";
    g.strokeStyle = "rgba(7,13,16,.7)";
    g.lineWidth = 1;
    if (p === "rack" || p === "crate") {
      g.fillRect(-r, -r, r * 2, r * 2);
      g.strokeRect(-r, -r, r * 2, r * 2);
    } else if (p === "tank") {
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    } else if (p === "planter") {
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(r, r);
      g.lineTo(-r, r);
      g.closePath();
      g.fill();
      g.stroke();
    } else {
      g.fillRect(-r * 1.25, -r * 0.6, r * 2.5, r * 1.2);
      g.strokeRect(-r * 1.25, -r * 0.6, r * 2.5, r * 1.2);
    }
    g.restore();
  }

  /* ------------------------------ interaction ----------------------------- */
  const cellFromEvent = (e: React.PointerEvent) => {
    const rect = cvRef.current!.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - rect.left - off.x) / scale),
      y: Math.floor((e.clientY - rect.top - off.y) / scale),
    };
  };

  function apply(x: number, y: number) {
    if (readOnly) return;
    const w = local.w;
    const h = local.h;
    const cells = local.cells.map((c) => ({ ...c }));
    const r = brush - 1;
    let changed = false;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const c: Cell = cells[cy * w + cx];
        const before = `${c.t}${c.z ?? ""}${c.p ?? ""}`;
        switch (tool) {
          case "wall":
            cells[cy * w + cx] = { t: WALL };
            break;
          case "floor":
            cells[cy * w + cx] = { t: FLOOR, z: c.z ?? zone };
            break;
          case "door":
            cells[cy * w + cx] = { t: DOOR, z: c.z ?? "corridor" };
            break;
          case "glass":
            cells[cy * w + cx] = { t: GLASS };
            break;
          case "void":
            cells[cy * w + cx] = { t: VOID };
            break;
          case "zone":
            if (c.t === FLOOR || c.t === DOOR) cells[cy * w + cx] = { ...c, t: FLOOR, z: zone };
            break;
          case "prop":
            if (c.t === FLOOR) cells[cy * w + cx] = { ...c, p: prop };
            break;
          case "eraser":
            if (c.p) cells[cy * w + cx] = { ...c, p: undefined };
            break;
        }
        const after = cells[cy * w + cx];
        if (`${after.t}${after.z ?? ""}${after.p ?? ""}` !== before) changed = true;
      }
    if (!changed) return;
    dirty.current = true;
    setLocal({ ...local, cells });
  }

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    if (e.button === 1 || e.shiftKey) {
      panning.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
      return;
    }
    if (readOnly) return;
    snapshot();
    dirty.current = false;
    painting.current = true;
    const { x, y } = cellFromEvent(e);
    apply(x, y);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (panning.current) {
      setOff({ x: panning.current.ox + (e.clientX - panning.current.x), y: panning.current.oy + (e.clientY - panning.current.y) });
      return;
    }
    if (!painting.current) return;
    const { x, y } = cellFromEvent(e);
    apply(x, y);
  };
  const onPointerUp = () => {
    painting.current = false;
    panning.current = null;
    if (dirty.current) {
      dirty.current = false;
      commit({ ...local, revision: local.revision + 1 });
    }
  };

  const stats = planStats(local);
  const current = TOOLS.find((t) => t.id === tool)!;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-ink-900/70 px-2 py-1.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            disabled={readOnly}
            onClick={() => setTool(t.id)}
            title={t.hint}
            className={cn(
              "num border px-2 py-1 text-[10px] uppercase tracking-wider transition-all duration-150 disabled:opacity-40",
              tool === t.id ? "border-transparent text-ink-950" : "border-line bg-ink-850 text-mist hover:border-ink-600 hover:text-chalk",
            )}
            style={tool === t.id ? { background: accent } : undefined}
          >
            {t.label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <div className="flex items-center gap-1">
          <span className="eyebrow">Brush</span>
          {[1, 2, 3].map((b) => (
            <button
              key={b}
              onClick={() => setBrush(b)}
              className={cn(
                "num h-[22px] w-[22px] border text-[10px] transition-colors",
                brush === b ? "border-signal bg-signal/20 text-signal" : "border-line text-dim hover:text-mist",
              )}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => {
              const prev = undo.current.pop();
              if (prev) commit(prev);
            }}
            disabled={readOnly || !undo.current.length}
            className="btn !px-2 !py-1 !text-[10px]"
            title="Undo last stroke"
          >
            ↶ Undo
          </button>
          <button
            onClick={() => setScale((s) => Math.max(8, s - 3))}
            className="btn !px-2 !py-1 !text-[10px]"
            title="Zoom out"
          >
            −
          </button>
          <span className="num w-9 text-center text-[10px] text-dim">{scale}px/m</span>
          <button
            onClick={() => setScale((s) => Math.min(48, s + 3))}
            className="btn !px-2 !py-1 !text-[10px]"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => {
              setScale(20);
              setOff({ x: 30, y: 30 });
            }}
            className="btn !px-2 !py-1 !text-[10px]"
            title="Reset view"
          >
            Fit
          </button>
        </div>
      </div>

      {/* contextual sub-toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-ink-950/60 px-2 py-1.5">
        {tool === "zone" &&
          ZONES.map((z) => (
            <button
              key={z}
              onClick={() => setZone(z)}
              className={cn(
                "num border px-1.5 py-[2px] text-[9.5px] uppercase transition-all",
                zone === z ? "text-ink-950" : "border-line text-mist hover:text-chalk",
              )}
              style={zone === z ? { background: ZONE_META[z].color, borderColor: ZONE_META[z].color } : undefined}
            >
              {ZONE_META[z].label}
            </button>
          ))}
        {tool === "prop" &&
          PROPS.map((p) => (
            <button
              key={p}
              onClick={() => setProp(p)}
              className={cn(
                "num border px-1.5 py-[2px] text-[9.5px] uppercase transition-all",
                prop === p ? "border-signal bg-signal/18 text-signal" : "border-line text-mist hover:text-chalk",
              )}
            >
              {p}
            </button>
          ))}
        {(tool === "wall" || tool === "floor" || tool === "door" || tool === "glass" || tool === "void" || tool === "eraser") && (
          <span className="num text-[9.5px] text-dim">{current.hint}</span>
        )}
        <span className="num ml-auto text-[9.5px] text-dim">shift+drag = pan · middle-drag = pan</span>
      </div>

      {/* canvas */}
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={cvRef}
          className="absolute inset-0 h-full w-full touch-none"
          style={{ cursor: readOnly ? "default" : painting.current ? "none" : "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={(e) => {
            const d = e.deltaY > 0 ? -2 : 2;
            setScale((s) => Math.max(8, Math.min(48, s + d)));
          }}
        />
        {readOnly && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2">
            <Chip color="#ff6a55">READ-ONLY — you are visiting another CEO's building</Chip>
          </div>
        )}
      </div>

      {/* stats */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-ink-900/70 px-2.5 py-1.5">
        <span className="num text-[9.5px] text-dim">
          <b className="text-chalk">{stats.usableM2}</b> m² usable
        </span>
        <span className="num text-[9.5px] text-dim">
          <b className="text-chalk">{stats.wall}</b> wall
        </span>
        <span className="num text-[9.5px] text-dim">
          <b className="text-chalk">{stats.doors}</b> doors
        </span>
        <span className="num text-[9.5px] text-dim">
          <b className="text-chalk">{stats.glass}</b> glazing
        </span>
        <span className="num text-[9.5px] text-dim">
          <b className="text-chalk">{stats.rooms}</b> zones
        </span>
        <span className="num ml-auto text-[9.5px] text-dim">
          rev {local.revision} · {Object.entries(stats.zones).map(([k, v]) => `${k}:${v}`).join(" ")}
        </span>
        {!readOnly && onChange && (
          <Btn size="sm" variant="ghost" onClick={() => commit(clonePlan(local))} title="Bump the revision — free during Design, costs schedule later">
            <Icon.check size={11} /> Commit revision
          </Btn>
        )}
      </div>
    </div>
  );
}
