"use client";

import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { TUNABLES } from "@/game/constants";
import { claimCorners, formatLL } from "@/game/geo";
import { useGame } from "@/state/store";
import { Btn, Icon } from "./ui";

/**
 * GDD §7.1 — Registration is the first meaningful decision, not a form.
 * The claim box is drawn live under the cursor so "64 km² of the real planet"
 * is understood visually before the player commits to it.
 */
export default function Onboarding() {
  const { newGame, loadDemo, toast } = useGame();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const boxRef = useRef<L.Polygon | null>(null);
  const [ceoName, setCeoname] = useState("");
  const [company, setCompany] = useState("");
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [placedBy, setPlacedBy] = useState<"geolocation" | "manual">("manual");
  const lockedRef = useRef(false);
  const [locating, setLocating] = useState(false);
  const [side, setSide] = useState<number>(TUNABLES.claimSideKm.v);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, {
      center: [30, 8],
      zoom: 3,
      zoomControl: false,
      worldCopyJump: true,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      lockedRef.current = false;
      setPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
      setPlacedBy("manual");
    });
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      if (lockedRef.current) return;
      drawBox(map, { lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawBox(map: L.Map, p: { lat: number; lng: number }) {
    const corners = claimCorners(p, side);
    if (!boxRef.current) {
      boxRef.current = L.polygon(corners, {
        color: "#f2a33c",
        weight: 1.6,
        fillColor: "#f2a33c",
        fillOpacity: 0.12,
        dashArray: "6 4",
      }).addTo(map);
    } else boxRef.current.setLatLngs(corners);
  }

  useEffect(() => {
    if (mapRef.current && point) drawBox(mapRef.current, point);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point, side]);

  function locate() {
    if (!navigator.geolocation) {
      toast("This browser has no geolocation API — click the map to place your claim.", "bad");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPoint(p);
        setPlacedBy("geolocation");
        lockedRef.current = true;
        setLocating(false);
        mapRef.current?.flyTo([p.lat, p.lng], 10, { duration: 1.6 });
        toast(`Fix acquired — ${formatLL(p)} (±${Math.round(pos.coords.accuracy)} m)`, "good");
      },
      (err) => {
        setLocating(false);
        toast(
          err.code === 1
            ? "Permission denied. Design fallback: click anywhere on the map to place your claim."
            : `No fix (${err.message}). Click the map instead.`,
          "bad",
        );
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 },
    );
  }

  const ready = !!point && ceoName.trim().length > 1 && company.trim().length > 1;

  return (
    <div className="relative z-10 flex h-full w-full">
      <div ref={hostRef} className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-r from-ink-950 via-ink-950/85 to-transparent" />

      <div className="relative z-20 flex h-full w-full max-w-[560px] flex-col overflow-y-auto border-r border-line bg-ink-950/88 px-7 py-6 backdrop-blur-[2px]">
        <div className="eyebrow">Simplayz land registry · form 01</div>
        <h1 className="display mt-2 text-[46px] leading-[0.92] text-chalk">
          CLAIM YOUR
          <br />
          <span className="text-signal">64 KM²</span> OF
          <br />
          THE REAL PLANET
        </h1>
        <p className="mt-3 max-w-[430px] text-[13px] leading-relaxed text-mist">
          One claim per CEO, anchored to where you actually are. Inside it you get four resource
          sectors, twenty building sites, two auto-provisioned alliance trading partners wired to you
          by road, and an executive board of three bots — each running on its own AI model.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="eyebrow">CEO name</span>
            <input
              className="field mt-1"
              value={ceoName}
              maxLength={26}
              placeholder="e.g. Dana Reyes"
              onChange={(e) => setCeoname(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="eyebrow">Company</span>
            <input
              className="field mt-1 uppercase"
              value={company}
              maxLength={24}
              placeholder="e.g. Meridian Works"
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-5 border border-line bg-ink-900/70 p-3">
          <div className="flex items-center justify-between">
            <span className="eyebrow !text-mist">Claim geometry</span>
            <span className="num text-[10px] text-dim">
              {placedBy === "geolocation" ? "GEOLOCATED" : "MANUAL PLACEMENT"}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Btn onClick={locate} disabled={locating} variant="teal">
              <Icon.pin size={14} /> {locating ? "Fixing…" : "Use my location"}
            </Btn>
            <div className="flex-1">
              <div className="eyebrow">Side length</div>
              <input
                type="range"
                min={4}
                max={16}
                step={1}
                value={side}
                onChange={(e) => setSide(Number(e.target.value))}
                className="mt-1 w-full accent-[#f2a33c]"
              />
            </div>
          </div>
          <div className="num mt-2 grid grid-cols-3 gap-2 text-[10.5px] text-mist">
            <span>
              <span className="text-dim">AREA </span>
              {(side * side).toLocaleString()} km²
            </span>
            <span>
              <span className="text-dim">SECTORS </span>4 × {(side / 2).toFixed(0)}×{(side / 2).toFixed(0)} km
            </span>
            <span className="truncate">
              <span className="text-dim">CENTRE </span>
              {point ? formatLL(point) : "— click map —"}
            </span>
          </div>
          {side !== 8 && (
            <p className="num mt-2 border-l-2 border-coral/60 pl-2 text-[10px] leading-snug text-coral">
              Spec says 64 km² (8×8). Deviating from it is open question Q1 — the register records your ruling.
            </p>
          )}
        </div>

        <div className="mt-5">
          <div className="eyebrow">On registration the system provisions</div>
          <ul className="mt-2 space-y-1.5">
            {[
              ["2 alliance bots", "a supplier and an offtaker placed within 7 km, each with their own purse, inventory and relation score"],
              ["connecting roads", "surveyed polylines from your claim centre to both partners, upgradable gravel → asphalt → arterial"],
              ["3 executive bots", "CTO ATLAS, CFO LEDGER, COO RELAY — each with a configurable model endpoint and their own SDLC lane"],
              ["2 site bots per building", "security and reception, provisioned at Deploy and walkable in first person"],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-2 text-[11.5px] leading-snug text-mist">
                <span className="mt-[3px] text-signal">▸</span>
                <span>
                  <b className="font-semibold text-chalk">{t}</b> — {d}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto flex flex-col gap-2 pt-6">
          <Btn
            variant="primary"
            disabled={!ready}
            className="!py-3 !text-[14px]"
            onClick={() => {
              if (!point) return;
              newGame(ceoName.trim(), company.trim().toUpperCase(), point.lat, point.lng, placedBy);
            }}
          >
            <Icon.check size={16} /> Register claim &amp; found company
          </Btn>
          <Btn onClick={loadDemo} className="!py-2">
            <Icon.play size={13} /> Skip ahead — load a pre-rolled city (274 sim-hours of history)
          </Btn>
          {!ready && (
            <p className="num text-center text-[10px] text-dim">
              {!point ? "Click the map to drop your claim centre" : "CEO name and company required"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
