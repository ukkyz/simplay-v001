"use client";

import L from "leaflet";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AREA_META, ARCHETYPES, ARCHETYPE_BY_ID, ROAD_GRADES } from "@/game/constants";
import { areaCenter, flows, priceFor, siteLL, tradeCapacity } from "@/game/engine";
import { claimCorners, formatLL, haversineKm } from "@/game/geo";
import {
  WORLD_LABELS,
  WORLD_POLL_MS,
  type WorldEntry,
} from "@/game/world";
import type { AreaKind, GameState } from "@/game/types";
import { fetchWorld } from "@/state/persistence";
import { useGame } from "@/state/store";
import { cn } from "@/utils/cn";
import { Btn, Chip, Icon, Meter } from "./ui";
import { PhaseStrip, Stat } from "./Pipeline";
import { fmt } from "./Shell";

type Sel =
  | { t: "area"; id: string }
  | { t: "site"; id: string }
  | { t: "bot"; id: string }
  | { t: "peer"; id: string }
  | { t: "road"; id: string }
  | null;

const SITE_HTML = (color: string, filled: boolean, building: boolean, label: string) => `
<div style="position:relative;width:26px;height:26px;margin:-13px 0 0 -13px;cursor:pointer">
  ${building ? `<span class="pulse-ring" style="position:absolute;inset:2px;color:${color}"></span>` : ""}
  <div style="position:absolute;inset:3px;border:1.6px solid ${color};background:${filled ? color : "rgba(7,13,16,.85)"};transform:rotate(45deg);transition:transform .2s"></div>
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:600 9px 'IBM Plex Mono',monospace;color:${filled ? "#0a1114" : color}">${label}</div>
</div>`;

const BOT_HTML = (color: string, glyph: string, name: string) => `
<div style="position:relative;width:30px;height:30px;margin:-15px 0 0 -15px;cursor:pointer">
  <span class="pulse-ring" style="position:absolute;inset:0;color:${color}"></span>
  <div style="position:absolute;inset:0;border:1.6px solid ${color};background:rgba(7,13,16,.92);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;color:${color}">${glyph}</div>
  <div style="position:absolute;top:32px;left:50%;transform:translateX(-50%);white-space:nowrap;font:600 9px 'IBM Plex Mono',monospace;letter-spacing:.08em;color:${color};background:rgba(7,13,16,.8);padding:1px 4px;border:1px solid ${color}44">${name}</div>
</div>`;

const PEER_HTML = (color: string, initial: string, online: boolean) => `
<div style="position:relative;width:24px;height:24px;margin:-12px 0 0 -12px;cursor:pointer">
  <div style="position:absolute;inset:0;border:1.6px solid ${color};background:${online ? color : "rgba(7,13,16,.9)"};clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);display:flex;align-items:center;justify-content:center;font:800 10px 'IBM Plex Mono',monospace;color:${online ? "#0a1114" : color}">${initial}</div>
</div>`;

const LABEL_HTML = (color: string, text: string, sub: string) => `
<div style="transform:translate(-50%,-50%);white-space:nowrap;pointer-events:none;text-align:center">
  <div style="font:800 10px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:${color};text-shadow:0 1px 4px #000">${text}</div>
  <div style="font:400 8.5px 'IBM Plex Mono',monospace;letter-spacing:.1em;color:#9bb2b8aa">${sub}</div>
</div>`;

/* ------------------------------------------------------------------------- */
/* Shared-world icons                                                        */
/*                                                                           */
/* These are built as DOM nodes and filled with `textContent`, never as HTML  */
/* strings: the text comes from another player's save, so string             */
/* interpolation here would be stored XSS. Every colour is a server-assigned  */
/* palette value that is re-checked before use.                              */
/* ------------------------------------------------------------------------- */

const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/;

function safeColor(value: string, fallback = "#6fb7ff"): string {
  return SAFE_COLOR.test(value) ? value : fallback;
}

/**
 * Neighbour marker: hexagon for another player, circle for a simulated one.
 * The shape difference is deliberate — "simulated" must be readable at a
 * glance, not only in a tooltip.
 */
function neighbourNode(entry: WorldEntry): HTMLElement {
  const color = safeColor(entry.color);
  const root = document.createElement("div");
  root.style.cssText =
    "position:relative;width:26px;height:26px;margin:-13px 0 0 -13px;cursor:pointer";

  const glyph = document.createElement("div");
  const isPlayer = entry.kind === "player";
  glyph.style.cssText = [
    "position:absolute;inset:0",
    `border:1.6px solid ${color}`,
    isPlayer
      ? `background:${entry.online ? color : "rgba(7,13,16,.9)"};clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)`
      : `background:rgba(7,13,16,.92);border-radius:50%;border-style:dashed`,
    "display:flex;align-items:center;justify-content:center",
    "font:800 10px 'IBM Plex Mono',monospace",
    `color:${entry.online ? "#0a1114" : color}`,
  ].join(";");
  glyph.textContent = (entry.display[0] ?? "?").toUpperCase();
  root.appendChild(glyph);

  const badge = document.createElement("div");
  badge.style.cssText = `position:absolute;top:28px;left:50%;transform:translateX(-50%);white-space:nowrap;font:600 9px 'IBM Plex Mono',monospace;letter-spacing:.06em;color:${color};background:rgba(7,13,16,.85);padding:1px 4px;border:1px solid ${color}55`;
  badge.textContent = entry.display.slice(0, 24);
  root.appendChild(badge);

  return root;
}

/** Tooltip body for a neighbour area. Built with DOM nodes, not a template string. */
function neighbourTooltip(entry: WorldEntry): HTMLElement {
  const wrap = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = entry.display.slice(0, 64);
  wrap.appendChild(title);
  const line = document.createElement("div");
  line.textContent = `${
    entry.kind === "player" ? WORLD_LABELS.player : WORLD_LABELS.ai
  } · ${entry.sideKm}×${entry.sideKm} km · ${entry.buildings} buildings`;
  wrap.appendChild(line);
  return wrap;
}

export default function WorldMap() {
  const { state } = useGame();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [show, setShow] = useState({ peers: true, roads: true, labels: true });
  /**
   * Readiness signal for the polling effect. Without it the effect could run
   * before the Leaflet map exists (or before StrictMode's remount finished) and
   * then never start again, leaving the neighbours permanently empty.
   */
  const [mapReady, setMapReady] = useState(false);
  /**
   * Shared world roster. `source` records where the neighbours came from, so the
   * map can say "offline neighbours" instead of silently pretending: with
   * `fallback` the drawing comes from the save's generated `state.remote`, which
   * is per-player fabricated data, not a shared world.
   */
  const [roster, setRoster] = useState<{
    entries: WorldEntry[];
    source: "server" | "fallback";
    truncated: boolean;
    counts: { player: number; ai: number };
  }>({ entries: [], source: "fallback", truncated: false, counts: { player: 0, ai: 0 } });

  const claim = state.claim!;

  /**
   * Structural key: the overlay only rebuilds when something you can *see* on
   * the map changes. Without this the layer group is torn down every sim tick,
   * which restarts CSS marker animations and burns the frame budget.
   */
  const structKey = useMemo(
    () =>
      JSON.stringify([
        claim.corners,
        state.areas.map((a) => [a.kind, a.sites.map((s) => [s.status, s.buildingId])]),
        state.buildings.map((b) => [b.id, Math.round(b.condition / 12)]),
        state.projects.map((p) => [p.id, p.phase, Math.round(p.progress * 10), p.blockedReason ? 1 : 0]),
        state.roads.map((r) => [r.id, r.grade]),
        state.alliance.map((b) => [b.id, Math.round(b.relation)]),
        // Shared roster: only identity + presence, so a poll that returns the
        // same world does not tear the layer group down.
        roster.source,
        roster.entries.map((e) => [e.ref, e.online, e.buildings]),
        roster.truncated,
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, claim, roster],
  );

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, {
      center: [claim.center.lat, claim.center.lng],
      zoom: 11,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setMapReady(true);
    window.setTimeout(() => map.invalidateSize(), 120);
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- shared world polling ---------------------------------------------
  // One request per WORLD_POLL_MS, paused while the tab is hidden, aborted on
  // unmount, and only when the peers layer is visible. The bbox is the map's
  // current viewport, so panning far enough triggers an early refresh.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !show.peers) return;

    let disposed = false;
    let timer: number | null = null;
    let inFlight: AbortController | null = null;

    const load = async () => {
      if (disposed) return;
      const b = map.getBounds();
      const controller = new AbortController();
      inFlight?.abort();
      inFlight = controller;
      const result = await fetchWorld(
        {
          latMin: b.getSouth(),
          latMax: b.getNorth(),
          lngMin: b.getWest(),
          lngMax: b.getEast(),
        },
        200,
        controller.signal,
      );
      if (disposed) return;
      setRoster((prev) => {
        if (!result.ok || !result.json)
          return prev.source === "fallback" && prev.entries.length === 0
            ? prev
            : { ...prev, source: "fallback" };
        return {
          entries: result.json.entries,
          source: "server",
          truncated: result.json.truncated,
          counts: result.json.counts,
        };
      });
    };

    const schedule = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (document.visibilityState === "visible") void load();
      }, WORLD_POLL_MS);
    };

    void load();
    schedule();
    const onMoveEnd = () => void load();
    map.on("moveend", onMoveEnd);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      if (timer !== null) window.clearInterval(timer);
      inFlight?.abort();
      map.off("moveend", onMoveEnd);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [show.peers, mapReady]);

  // ---- overlay render ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const lg = layerRef.current;
    if (!map || !lg) return;
    lg.clearLayers();

    // claim
    L.polygon(claim.corners, {
      color: "#f2a33c",
      weight: 2,
      fillColor: "#f2a33c",
      fillOpacity: 0.05,
      dashArray: "10 6",
    })
      .addTo(lg)
      .bindTooltip(
        `<b>${state.company}</b><br/>${claim.sideKm}×${claim.sideKm} km · ${claim.sideKm ** 2} km²`,
        { className: "spz-popup", sticky: true },
      );

    // sectors
    const half = claim.sideKm / 4;
    state.areas.forEach((a) => {
      const c = areaCenter(claim, a.index);
      const meta = AREA_META[a.kind];
      const corners = [
        [c.lat - half / 110.574, c.lng - half / (111.32 * Math.cos((c.lat * Math.PI) / 180))],
        [c.lat - half / 110.574, c.lng + half / (111.32 * Math.cos((c.lat * Math.PI) / 180))],
        [c.lat + half / 110.574, c.lng + half / (111.32 * Math.cos((c.lat * Math.PI) / 180))],
        [c.lat + half / 110.574, c.lng - half / (111.32 * Math.cos((c.lat * Math.PI) / 180))],
      ] as [number, number][];
      const built = a.sites.filter((s) => s.buildingId).length;
      L.polygon(corners, { color: meta.color, weight: 1.2, fillColor: meta.color, fillOpacity: 0.09 })
        .addTo(lg)
        .on("click", () => setSel({ t: "area", id: a.id }));
      if (show.labels)
        L.marker([c.lat - half / 221, c.lng], {
          icon: L.divIcon({
            className: "",
            html: LABEL_HTML(meta.color, `${meta.label.toUpperCase()} SECTOR`, `${built}/${a.sites.length} sites built`),
            iconSize: [0, 0],
          }),
          interactive: false,
        }).addTo(lg);

      // sites
      a.sites.forEach((s) => {
        const ll = siteLL(claim, a.index, s.index);
        const b = s.buildingId ? state.buildings.find((x) => x.id === s.buildingId) : null;
        const prj = state.projects.find((p) => p.siteId === s.id);
        const color = b ? meta.color : prj ? "#f2a33c" : "#3d5a63";
        L.marker([ll.lat, ll.lng], {
          icon: L.divIcon({
            className: "",
            html: SITE_HTML(color, !!b, !!prj && !b, String(s.index + 1)),
            iconSize: [0, 0],
          }),
        })
          .addTo(lg)
          .on("click", () => setSel({ t: "site", id: s.id }));
      });
    });

    // roads
    if (show.roads)
      state.roads.forEach((r) => {
        const g = ROAD_GRADES[r.grade];
        L.polyline(r.path, { color: "#05090b", weight: 6, opacity: 0.85 }).addTo(lg);
        L.polyline(r.path, {
          color: g.color,
          weight: r.grade === 3 ? 2.6 : 1.7,
          opacity: 0.95,
          dashArray: r.grade === 1 ? "5 6" : undefined,
        })
          .addTo(lg)
          .on("click", () => setSel({ t: "road", id: r.id }));
      });

    // alliance bots
    state.alliance.forEach((b) => {
      const color = b.kind === "supplier" ? "#ff8347" : "#6fb7ff";
      L.marker([b.lat, b.lng], {
        icon: L.divIcon({
          className: "",
          html: BOT_HTML(color, b.kind === "supplier" ? "◈" : "▤", b.name.split(" ")[0]),
          iconSize: [0, 0],
        }),
      })
        .addTo(lg)
        .on("click", () => setSel({ t: "bot", id: b.id }));
    });

    // ---- neighbours ----------------------------------------------------
    // Exactly one cast is drawn. When the shared registry answers, it is the
    // real players + the deterministic AI roster; only when the request fails do
    // we fall back to the save's generated peers, and the panel says so.
    if (show.peers) {
      if (roster.source === "server") {
        roster.entries.forEach((e) => drawNeighbour(lg, e));
      } else {
        state.remote.forEach((p) => {
          const side = 6.4;
          const dLat = side / 2 / 110.574;
          const dLng = side / 2 / (111.32 * Math.cos((p.lat * Math.PI) / 180));
          L.polygon(
            [
              [p.lat - dLat, p.lng - dLng],
              [p.lat - dLat, p.lng + dLng],
              [p.lat + dLat, p.lng + dLng],
              [p.lat + dLat, p.lng - dLng],
            ],
            {
              color: p.color,
              weight: 1,
              dashArray: "2 6",
              opacity: 0.7,
              fillColor: p.color,
              fillOpacity: 0.03,
            },
          )
            .addTo(lg)
            .on("click", () => setSel({ t: "peer", id: p.id }));
          L.marker([p.lat, p.lng], {
            icon: L.divIcon({ className: "", html: PEER_HTML(p.color, p.handle[1].toUpperCase(), p.online), iconSize: [0, 0] }),
          })
            .addTo(lg)
            .on("click", () => setSel({ t: "peer", id: p.id }));
        });
      }
    }

    /**
     * One neighbour = area outline + marker. Outline uses `claimCorners` on the
     * *coarsened* centre, so it matches the published (approximate) position
     * rather than a precise one the server never stored.
     */
    function drawNeighbour(layer: L.LayerGroup, e: WorldEntry) {
      const color = safeColor(e.color);
      const isPlayer = e.kind === "player";
      L.polygon(claimCorners({ lat: e.lat, lng: e.lng }, e.sideKm), {
        color,
        weight: isPlayer ? 1.6 : 1,
        dashArray: isPlayer ? undefined : "4 6",
        fillColor: color,
        fillOpacity: isPlayer ? 0.06 : 0.025,
      })
        .addTo(layer)
        .bindTooltip(neighbourTooltip(e), { className: "spz-popup", sticky: true });
      L.marker([e.lat, e.lng], {
        icon: L.divIcon({
          className: "",
          html: neighbourNode(e),
          iconSize: [0, 0],
        }),
        // Labels/keys are cheap but not free: keep them out of the tab order.
        keyboard: false,
      }).addTo(layer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey, show, claim, roster]);

  const f = flows(state);
  // Honest roster status: humans and simulation are counted separately, never
  // summed into one "players online" figure.
  const rosterStatus =
    roster.source === "server"
      ? `${roster.counts.player} player${roster.counts.player === 1 ? "" : "s"} · ${roster.counts.ai} AI${roster.truncated ? " · truncated" : ""}`
      : WORLD_LABELS.offline;

  return (
    <div className="relative flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        <div ref={hostRef} className="absolute inset-0" />

        {/* map chrome */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex items-start justify-between gap-2 p-3">
          <div className="pointer-events-auto panel-flat px-3 py-2">
            <div className="eyebrow">Live world layer · OpenStreetMap</div>
            <div className="display mt-0.5 text-[17px] leading-none text-chalk">
              {state.company} <span className="text-signal">CLAIM</span>
            </div>
            <div className="num mt-1 text-[10px] text-mist">
              {formatLL(claim.center)} · {claim.sideKm ** 2} km² · placed by {claim.placedBy}
            </div>
            <SharingRow />
          </div>

          <div className="pointer-events-auto flex gap-1">
            {(
              [
                ["roads", "Roads", Icon.road],
                ["peers", "Alliance CEOs", Icon.globe],
                ["labels", "Labels", Icon.eye],
              ] as const
            ).map(([k, label, Ico]) => (
              <button
                key={k}
                onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
                className={cn(
                  "num flex items-center gap-1.5 border px-2 py-1.5 text-[10px] transition-all duration-200",
                  show[k]
                    ? "border-signal/60 bg-signal/12 text-signal"
                    : "border-line bg-ink-900/85 text-dim hover:text-mist",
                )}
              >
                <Ico size={13} /> {label}
              </button>
            ))}
            <button
              onClick={() => mapRef.current?.flyTo([claim.center.lat, claim.center.lng], 11, { duration: 0.8 })}
              className="num border border-line bg-ink-900/85 px-2 py-1.5 text-[10px] text-mist transition-colors hover:border-signal hover:text-signal"
            >
              Recentre
            </button>
          </div>
        </div>

        {/* legend */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] panel-flat px-2.5 py-2">
          <div className="eyebrow mb-1.5 flex items-center justify-between gap-3">
            <span>Legend</span>
            <span className="num normal-case tracking-normal text-[8.5px] text-dim">
              {rosterStatus}
            </span>
          </div>
          <div className="num flex flex-col gap-1 text-[9.5px] text-mist">
            {Object.values(AREA_META).map((m) => (
              <span key={m.label} className="flex items-center gap-1.5">
                <i className="inline-block h-2 w-2 rotate-45" style={{ background: m.color }} /> {m.label} sector
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: "#ff8347" }} /> Alliance supplier
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: "#6fb7ff" }} /> Alliance offtaker
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2" style={{ background: "#a3cb4d", clipPath: "polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)" }} />
              {WORLD_LABELS.player}
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-full border border-dashed" style={{ borderColor: "#6fb7ff" }} />
              {WORLD_LABELS.ai}
            </span>
          </div>
        </div>

        {/* pipeline HUD */}
        <div className="pointer-events-none absolute bottom-3 right-3 z-[500] w-[290px] panel-flat px-2.5 py-2">
          <div className="eyebrow mb-1.5 flex items-center justify-between">
            <span>Active pipeline</span>
            <span className="num text-signal">
              {state.projects.filter((p) => p.phase !== "operate").length}/6
            </span>
          </div>
          {state.projects.filter((p) => p.phase !== "operate").length === 0 && (
            <p className="num text-[10px] text-dim">
              Nothing in flight. Click a ◇ site marker to commission a build.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {state.projects
              .filter((p) => p.phase !== "operate")
              .slice(0, 3)
              .map((p) => (
                <div key={p.id}>
                  <div className="num mb-0.5 flex justify-between text-[9.5px] text-mist">
                    <span className="truncate">{ARCHETYPE_BY_ID[p.archetypeId].name}</span>
                    <span style={{ color: p.blockedReason ? "#ff6a55" : "#647c84" }}>
                      {p.blockedReason ? "BLOCKED" : p.phase.toUpperCase()}
                    </span>
                  </div>
                  <PhaseStrip project={p} compactMode />
                </div>
              ))}
          </div>
        </div>
      </div>

      <Inspector sel={sel} setSel={setSel} f={f} />
    </div>
  );
}

/* ------------------------------- Sharing -------------------------------- */

/**
 * Opt-in publication of this player's area, plus an honest roster status line.
 *
 * Copy comes from `WORLD_LABELS` so the map, the legend and any future screen
 * cannot drift into claiming more than presence: other players see an
 * approximate outline, not a live shared simulation.
 */
function SharingRow() {
  const { world, togglePublished, persistence } = useGame();
  const ready = persistence.phase === "ready";

  return (
    <div className="mt-1.5 flex flex-col gap-1 border-t border-line/60 pt-1.5">
      <button
        onClick={() => void togglePublished()}
        disabled={!ready || world.busy}
        className={cn(
          "num flex items-center gap-1.5 self-start border px-1.5 py-1 text-[9.5px] transition-all duration-200 disabled:opacity-40",
          world.published
            ? "border-teal/70 bg-teal/12 text-teal"
            : "border-line bg-ink-900/70 text-dim hover:text-mist",
        )}
        title={
          world.published
            ? "Stop sharing your area with other players (deletes the published row)"
            : "Publish your area so other players see an approximate outline (≈1 km)"
        }
      >
        <Icon.globe size={11} />
        {world.busy
          ? "Updating…"
          : world.published
            ? "Sharing area · on"
            : "Share area · off"}
      </button>
      <div className="num text-[9px] leading-tight text-dim">
        {world.published
          ? world.area
            ? `Published · ${WORLD_LABELS.player} · ${world.area.sideKm} km side`
            : WORLD_LABELS.shared
          : WORLD_LABELS.notShared}
      </div>
    </div>
  );
}

/* ------------------------------- Inspector ------------------------------- */

function Inspector({
  sel,
  setSel,
  f,
}: {
  sel: Sel;
  setSel: (s: Sel) => void;
  f: ReturnType<typeof flows>;
}) {
  const { state, dispatch, setUi, toast } = useGame();

  const close = (
    <button onClick={() => setSel(null)} className="text-dim transition-colors hover:text-coral">
      <Icon.close size={14} />
    </button>
  );

  let body: React.ReactNode = null;

  if (sel?.t === "site") {
    const site = state.areas.flatMap((a) => a.sites).find((s) => s.id === sel.id)!;
    const area = state.areas.find((a) => a.id === site.areaId)!;
    const meta = AREA_META[area.kind];
    const building = site.buildingId ? state.buildings.find((b) => b.id === site.buildingId) : null;
    const project = state.projects.find((p) => p.siteId === site.id);
    const ll = siteLL(state.claim!, area.index, site.index);
    const options = ARCHETYPES.filter((a) => a.area === area.kind);

    body = (
      <>
        <div className="eyebrow">
          {meta.label} sector · site {site.index + 1}
        </div>
        <h3 className="display mt-1 text-[20px] leading-tight text-chalk">
          {building ? ARCHETYPE_BY_ID[building.archetypeId].name : project ? "Under construction" : "Vacant site"}
        </h3>
        <div className="num mt-1 text-[10px] text-dim">{formatLL(ll)}</div>

        {building && (
          <div className="mt-3 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Condition" value={`${Math.round(building.condition)}%`} tone={building.condition < 40 ? "#ff6a55" : "#35d6c0"} />
              <Stat label="Crew" value={ARCHETYPE_BY_ID[building.archetypeId].crew} />
              <Stat label="Security bot" value={building.securityBot.name} />
              <Stat label="Reception bot" value={building.receptionBot.name} />
            </div>
            <p className="text-[11.5px] leading-snug text-mist">{ARCHETYPE_BY_ID[building.archetypeId].blurb}</p>
            <div className="flex gap-1.5">
              <Btn
                variant="teal"
                size="sm"
                onClick={() => {
                  setUi({ screen: "studio", studioTarget: { kind: "building", id: building.id }, visit: null });
                }}
              >
                <Icon.walk size={12} /> Enter site (FP/TP)
              </Btn>
              <Btn size="sm" onClick={() => dispatch({ type: "maintain", buildingId: building.id })}>
                Service ₡{fmt(Math.round((100 - building.condition) * 45))}
              </Btn>
            </div>
          </div>
        )}

        {project && !building && (
          <div className="mt-3">
            <PhaseStrip project={project} />
            <p className="num mt-2 text-[10.5px] text-mist">
              {project.phase.toUpperCase()} · {Math.round(project.progress * 100)}% · quality {project.quality}%
            </p>
            {project.blockedReason && (
              <p className="num mt-2 border-l-2 border-coral bg-coral/8 px-2 py-1 text-[10px] text-coral">
                {project.blockedReason}
              </p>
            )}
            <div className="mt-2 flex gap-1.5">
              <Btn size="sm" variant="teal" onClick={() => setUi({ screen: "studio", studioTarget: { kind: "project", id: project.id } })}>
                <Icon.plan size={12} /> Edit floor plan
              </Btn>
              <Btn size="sm" variant="danger" onClick={() => dispatch({ type: "cancelProject", projectId: project.id })}>
                Cancel
              </Btn>
            </div>
          </div>
        )}

        {!building && !project && (
          <div className="mt-3">
            <div className="eyebrow mb-1.5">Commission — {meta.label} catalogue</div>
            <div className="flex flex-col gap-1.5">
              {options.map((a) => {
                const locked = state.economy.level < a.unlockAt;
                const poor = state.economy.credits < a.cost * 1.15;
                return (
                  <button
                    key={a.id}
                    disabled={locked}
                    onClick={() => {
                      dispatch({ type: "startProject", areaId: area.id, siteIndex: site.index, archetypeId: a.id });
                      toast(`${a.name} commissioned — pipeline opened at Discover.`, "good");
                    }}
                    className={cn(
                      "group border border-line bg-ink-950/60 p-2 text-left transition-all duration-200",
                      locked ? "opacity-40" : "hover:-translate-y-px hover:border-signal/60 hover:bg-ink-800",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] font-semibold text-chalk">{a.name}</span>
                      <span className={cn("num text-[10.5px]", poor ? "text-coral" : "text-signal")}>₡{fmt(a.cost)}</span>
                    </div>
                    <div className="num mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9.5px] text-dim">
                      <span>{a.hours} h build</span>
                      <span>T{a.tier}</span>
                      <span style={{ color: a.power < 0 ? "#35d6c0" : "#ff8347" }}>
                        {a.power < 0 ? `−${-a.power} kW` : `${a.power} kW`}
                      </span>
                      {a.food > 0 && <span className="text-moss">+{a.food} food/h</span>}
                      {a.materials > 0 && <span className="text-rust">+{a.materials} mat/h</span>}
                      {a.storage > 0 && <span className="text-sky2">+{a.storage} store</span>}
                      <span>{a.crew} crew</span>
                      {locked && <span className="text-coral">LVL {a.unlockAt}</span>}
                    </div>
                    <p className="mt-1 text-[10.5px] leading-snug text-mist opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      {a.rationale}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </>
    );
  } else if (sel?.t === "area") {
    const area = state.areas.find((a) => a.id === sel.id)!;
    const meta = AREA_META[area.kind];
    const kinds: AreaKind[] = ["energy", "food", "factory", "warehouse"];
    const taken = state.areas.filter((a) => a.id !== area.id).map((a) => a.kind);
    body = (
      <>
        <div className="eyebrow">Sector {area.index + 1} of 4</div>
        <h3 className="display mt-1 text-[22px] leading-tight" style={{ color: meta.color }}>
          {meta.label.toUpperCase()}
        </h3>
        <p className="num mt-1 text-[10.5px] text-dim">{meta.tagline} · 4×4 km quadrant</p>
        <div className="mt-3 grid grid-cols-5 gap-1">
          {area.sites.map((s) => (
            <button
              key={s.id}
              onClick={() => setSel({ t: "site", id: s.id })}
              className="aspect-square border transition-all hover:scale-105"
              style={{
                borderColor: s.buildingId ? meta.color : "#24424b",
                background: s.buildingId ? `${meta.color}33` : "rgba(7,13,16,.6)",
              }}
              title={`Site ${s.index + 1} — ${s.status}`}
            />
          ))}
        </div>
        <div className="mt-4">
          <div className="eyebrow mb-1.5">Re-specify sector</div>
          <div className="grid grid-cols-2 gap-1.5">
            {kinds.map((k) => (
              <Btn
                key={k}
                size="sm"
                variant={area.kind === k ? "primary" : "default"}
                disabled={taken.includes(k)}
                onClick={() => {
                  dispatch({ type: "specArea", areaId: area.id, kind: k });
                  toast(`Sector re-specified as ${AREA_META[k].label}.`, "good");
                }}
              >
                {AREA_META[k].glyph} {AREA_META[k].label}
              </Btn>
            ))}
          </div>
          <p className="num mt-2 text-[9.5px] leading-snug text-dim">
            Locked once any site in this sector is built on, and locked if another sector already holds
            that kind — 4 sectors, 4 distinct kinds is the spec.
          </p>
        </div>
      </>
    );
  } else if (sel?.t === "bot") {
    const b = state.alliance.find((x) => x.id === sel.id)!;
    const dist = haversineKm(claimCenter(state), { lat: b.lat, lng: b.lng });
    const cd = Math.max(0, 6 - (state.economy.tick - b.lastTradeTick));
    const cap = tradeCapacity(state);
    body = (
      <>
        <div className="eyebrow">Alliance partner · auto-provisioned at registration</div>
        <h3 className="display mt-1 text-[20px] leading-tight" style={{ color: b.kind === "supplier" ? "#ff8347" : "#6fb7ff" }}>
          {b.name}
        </h3>
        <div className="num mt-1 flex flex-wrap gap-1.5 text-[10px] text-dim">
          <Chip color={b.kind === "supplier" ? "#ff8347" : "#6fb7ff"}>{b.kind.toUpperCase()}</Chip>
          <span>{dist.toFixed(2)} km from claim centre</span>
          <span>· {b.mood}</span>
        </div>
        <div className="mt-3">
          <Meter value={b.relation} color={b.relation > 60 ? "#35d6c0" : b.relation > 30 ? "#f2a33c" : "#ff6a55"} label={`Relation ${b.relation.toFixed(0)}/100`} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Their purse" value={`₡${fmt(Math.round(b.inventory.credits))}`} />
          <Stat label="Deals done" value={b.dealsDone} />
          <Stat label="Materials" value={fmt(Math.round(b.inventory.materials))} />
          <Stat label="Food" value={fmt(Math.round(b.inventory.food))} />
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          {(["materials", "food"] as const).map((c) => (
            <div key={c} className="border border-line bg-ink-950/60 p-2">
              <div className="num flex items-center justify-between text-[10px]">
                <span className="uppercase tracking-widest text-mist">{c}</span>
                <span className="text-dim">market ₡{state.market[c].toFixed(2)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Btn
                  size="sm"
                  disabled={cd > 0}
                  onClick={() => dispatch({ type: "trade", botId: b.id, commodity: c, dir: "buy", qty: Math.min(cap, b.inventory[c], Math.floor(state.economy.credits / priceFor(state, c, b, "buy"))) })}
                >
                  Buy {fmt(Math.min(cap, b.inventory[c]))} @ ₡{priceFor(state, c, b, "buy").toFixed(2)}
                </Btn>
                <Btn
                  size="sm"
                  disabled={cd > 0 || state.economy[c] < 1}
                  onClick={() => dispatch({ type: "trade", botId: b.id, commodity: c, dir: "sell", qty: Math.min(cap, state.economy[c]) })}
                >
                  Sell {fmt(Math.min(cap, state.economy[c]))} @ ₡{priceFor(state, c, b, "sell").toFixed(2)}
                </Btn>
              </div>
            </div>
          ))}
          {cd > 0 && (
            <p className="num text-[10px] text-coral">Cooldown — {cd} sim-hours until the next deal with {b.name.split(" ")[0]}.</p>
          )}
          <Btn size="sm" variant="ghost" onClick={() => setUi({ screen: "diplomacy" })}>
            Full trade desk <Icon.arrow size={12} />
          </Btn>
        </div>
      </>
    );
  } else if (sel?.t === "peer") {
    const p = state.remote.find((x) => x.id === sel.id)!;
    const dist = haversineKm(claimCenter(state), { lat: p.lat, lng: p.lng });
    body = (
      <>
        <div className="eyebrow">{p.alliance ? "Allied CEO" : "Independent CEO"} · simulated presence</div>
        <h3 className="display mt-1 text-[20px] leading-tight" style={{ color: p.color }}>
          {p.name}
        </h3>
        <div className="num mt-1 flex items-center gap-2 text-[10px] text-dim">
          <span>{p.handle}</span>
          <span className={cn("flex items-center gap-1", p.online ? "text-moss" : "text-dim")}>
            <i className={cn("inline-block h-1.5 w-1.5 rounded-full", p.online && "blink")} style={{ background: p.online ? "#a3cb4d" : "#3d5a63" }} />
            {p.online ? "online" : `last seen h${p.lastSeenTick}`}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Distance" value={`${dist.toFixed(1)} km`} />
          <Stat label="Reputation" value={p.reputation.toFixed(0)} />
          <Stat label="Buildings" value={p.buildings.length} />
          <Stat label="Alliance" value={p.alliance ? "yes" : "no"} tone={p.alliance ? "#35d6c0" : "#ff6a55"} />
        </div>
        <div className="eyebrow mt-4 mb-1.5">Explore their interiors</div>
        <div className="flex flex-col gap-1.5">
          {p.buildings.map((b) => (
            <button
              key={b.id}
              disabled={!p.alliance}
              onClick={() => {
                setUi({
                  screen: "studio",
                  studioTarget: null,
                  visit: { ownerName: `${p.name} ${p.handle}`, buildingName: b.name, planId: b.plan.id },
                });
                dispatch({ type: "log", entry: { kind: "visit", text: `You travelled ${dist.toFixed(1)} km to walk ${p.name}'s ${b.name} in first person. Their reception bot logged the visit.` } });
              }}
              className={cn(
                "group flex items-center justify-between border border-line bg-ink-950/60 px-2 py-1.5 text-left transition-all",
                p.alliance ? "hover:-translate-y-px hover:border-teal/60 hover:bg-ink-800" : "opacity-40",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-[11.5px] font-semibold text-chalk">{b.name}</span>
                <span className="num block text-[9.5px] text-dim">
                  {ARCHETYPE_BY_ID[b.archetypeId].name} · {b.plan.w}×{b.plan.h} m · {b.crew} crew
                </span>
              </span>
              <span className="text-teal opacity-0 transition-opacity group-hover:opacity-100">
                <Icon.walk size={14} />
              </span>
            </button>
          ))}
          {!p.alliance && (
            <p className="num text-[9.5px] leading-snug text-coral">
              Non-allied. Per open question Q7 their security bot would hold you at the reception desk —
              roaming is gated until you rule on trespass policy.
            </p>
          )}
        </div>
      </>
    );
  } else if (sel?.t === "road") {
    const r = state.roads.find((x) => x.id === sel.id)!;
    const g = ROAD_GRADES[r.grade];
    const target = state.alliance.find((b) => b.id === r.to) ?? state.remote.find((p) => p.id === r.to);
    body = (
      <>
        <div className="eyebrow">Service road</div>
        <h3 className="display mt-1 text-[20px] leading-tight text-chalk">
          Claim centre → {target ? ("handle" in target ? `${target.name} ${target.handle}` : target.name) : r.to}
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Grade" value={`${r.grade} · ${g.label}`} tone={g.color} />
          <Stat label="Throughput" value={`${Math.round(r.throughput * f.mods.roadBonus)} u/h`} />
        </div>
        <div className="mt-3">
          <div className="eyebrow mb-1">Upgrade</div>
          <div className="flex gap-1.5">
            <Btn size="sm" variant="primary" disabled={r.grade >= 3 || state.economy.credits < (r.grade === 1 ? 24000 : 78000)} onClick={() => dispatch({ type: "upgradeRoad", roadId: r.id })}>
              {r.grade >= 3 ? "Max grade" : `→ ${ROAD_GRADES[(r.grade + 1) as 2 | 3].label} ₡${fmt(r.grade === 1 ? 24000 : 78000)}`}
            </Btn>
          </div>
          <p className="num mt-2 text-[9.5px] leading-snug text-dim">
            Throughput caps how many units physically move per hour on this road; trade volume is also
            capped per deal ({fmt(tradeCapacity(state))} u) and by the 6 h cooldown. Packaging &amp; Freight
            multiplies all road throughput by 1.4× each.
          </p>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="eyebrow">Nothing selected</div>
        <h3 className="display mt-1 text-[19px] leading-tight text-chalk">Click the map</h3>
        <p className="mt-1.5 text-[11.5px] leading-snug text-mist">
          ◇ site markers to commission builds · sector blocks to re-specify · ◈/▤ to trade with your
          alliance bots · hexagons to visit other CEOs · road lines to upgrade them.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {state.areas.map((a) => {
            const m = AREA_META[a.kind];
            const built = a.sites.filter((s) => s.buildingId).length;
            return (
              <button
                key={a.id}
                onClick={() => setSel({ t: "area", id: a.id })}
                className="group flex items-center gap-2 border border-line bg-ink-950/50 px-2 py-1.5 text-left transition-all hover:-translate-y-px hover:bg-ink-800"
                style={{ borderLeft: `2px solid ${m.color}` }}
              >
                <span className="text-[13px]" style={{ color: m.color }}>{m.glyph}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11.5px] font-semibold text-chalk">{m.label} sector</span>
                  <span className="num block text-[9.5px] text-dim">{built}/5 sites built</span>
                </span>
                <span className="flex gap-[2px]">
                  {a.sites.map((s) => (
                    <i key={s.id} className="inline-block h-3 w-[3px]" style={{ background: s.buildingId ? m.color : "#24424b" }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="Grid" value={`${fmt(f.produced)}/${fmt(f.demanded)} kW`} tone={f.brownout ? "#ff6a55" : "#35d6c0"} />
          <Stat label="Crew" value={f.crew} />
          <Stat label="Net ₡/h" value={`${f.netCredits >= 0 ? "+" : ""}${fmt(Math.round(f.netCredits))}`} tone={f.netCredits >= 0 ? "#a3cb4d" : "#ff6a55"} />
          <Stat label="Efficiency" value={`${Math.round(f.eff * 100)}%`} />
        </div>
      </>
    );
  }

  return (
    <aside className="relative z-[600] flex w-[336px] shrink-0 flex-col border-l border-line bg-ink-900/94">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
        <span className="eyebrow">Inspector</span>
        {sel && close}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{body}</div>
    </aside>
  );
}

function claimCenter(s: GameState) {
  return s.claim!.center;
}
