"use client";

import { useState } from "react";
import { ARCHETYPE_BY_ID, BASE_PRICES, MARKET, ROAD_GRADES, TRADE } from "@/game/constants";
import { flows, priceFor, systemMods, tradeCapacity } from "@/game/engine";
import { formatLL, haversineKm } from "@/game/geo";
import type { AllianceBot, Commodity } from "@/game/types";
import { useGame } from "@/state/store";
import { cn } from "@/utils/cn";
import { Btn, Chip, Icon, KV, Meter, Panel } from "./ui";
import { Stat } from "./Pipeline";
import { fmt } from "./Shell";

export default function Diplomacy() {
  const { state, dispatch, setUi, toast } = useGame();
  const mods = systemMods(state);
  const cap = tradeCapacity(state);
  const f = flows(state);
  const [qty, setQty] = useState<Record<string, number>>({});

  const getQty = (id: string) => qty[id] ?? Math.round(cap / 2);
  const setQ = (id: string, v: number) => setQty((q) => ({ ...q, [id]: Math.max(1, Math.min(cap, Math.round(v))) }));

  return (
    <div className="flex h-full min-h-0 gap-3 overflow-y-auto p-3">
      {/* --------------------------- alliance trade --------------------------- */}
      <div className="flex min-w-0 flex-[1.5] flex-col gap-3">
        <div>
          <div className="eyebrow">Diplomacy desk · auto-provisioned at registration</div>
          <h2 className="display text-[26px] leading-none text-chalk">
            TWO ALLIANCE PARTNERS, <span className="text-signal">ONE ROAD EACH</span>
          </h2>
          <p className="mt-1.5 max-w-[720px] text-[12px] leading-relaxed text-mist">
            Every registered CEO is seeded with a supplier and an offtaker inside 7 km, each with their own
            purse, inventory, relation score and price sheet. Relation is the compounding asset: it moves
            price on both sides of every future deal.
          </p>
        </div>

        {state.alliance.map((b) => (
          <TradeCard
            key={b.id}
            bot={b}
            cap={cap}
            qty={getQty(b.id)}
            setQty={(v) => setQ(b.id, v)}
            cooldown={Math.max(0, TRADE.cooldownHours - (state.economy.tick - b.lastTradeTick))}
            onTrade={(c, dir) => {
              const q = Math.min(getQty(b.id), cap);
              dispatch({ type: "trade", botId: b.id, commodity: c, dir, qty: q });
              toast(`${dir === "buy" ? "Bought" : "Sold"} ${q} ${c} with ${b.name}.`, dir === "buy" ? "info" : "good");
            }}
          />
        ))}

        <Panel title="Market tape" accent="#a3cb4d" bodyClass="p-3">
          <div className="grid grid-cols-3 gap-2">
            {(["materials", "food", "power"] as const).map((c) => {
              const p = state.market[c];
              const base = BASE_PRICES[c];
              const dev = ((p - base) / base) * 100;
              return (
                <div key={c} className="border border-line bg-ink-950/55 p-2">
                  <div className="eyebrow">{c}</div>
                  <div className="num mt-0.5 text-[16px] font-semibold text-chalk">₡{p.toFixed(2)}</div>
                  <div className="num text-[9.5px]" style={{ color: dev > 2 ? "#a3cb4d" : dev < -2 ? "#ff6a55" : "#647c84" }}>
                    {dev >= 0 ? "+" : ""}
                    {dev.toFixed(1)}% vs base ₡{base}
                  </div>
                  <div className="mt-1.5 h-[3px] w-full bg-ink-950">
                    <div className="h-full bg-signal transition-all duration-500" style={{ width: `${((p - base * (1 - MARKET.driftBand)) / (base * 2 * MARKET.driftBand)) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="num mt-2 border-l-2 border-moss/60 pl-2 text-[9.5px] leading-snug text-dim">
            {MARKET.why}
          </p>
        </Panel>
      </div>

      {/* ------------------------------ logistics ----------------------------- */}
      <div className="flex w-[400px] shrink-0 flex-col gap-3">
        <Panel title="Roads &amp; throughput" accent="#6fb7ff" bodyClass="p-3 flex flex-col gap-2">
          {state.roads.map((r) => {
            const g = ROAD_GRADES[r.grade];
            const target = state.alliance.find((x) => x.id === r.to) ?? state.remote.find((x) => x.id === r.to);
            const label = target ? ("handle" in target ? `${target.name} ${target.handle}` : target.name) : r.to;
            const cost = r.grade === 1 ? 24_000 : r.grade === 2 ? 78_000 : 0;
            return (
              <div key={r.id} className="border border-line bg-ink-950/55 p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11.5px] font-semibold text-chalk">Claim centre → {label}</span>
                  <Chip color={g.color}>G{r.grade} {g.label}</Chip>
                </div>
                <div className="num mt-1 flex gap-3 text-[9.5px] text-dim">
                  <span>{Math.round(r.throughput * mods.roadBonus)} u/h effective</span>
                  <span>base {r.throughput} u/h</span>
                  <span>road ×{mods.roadBonus.toFixed(2)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  {[1, 2, 3].map((lvl) => (
                    <span key={lvl} className="h-1.5 flex-1" style={{ background: lvl <= r.grade ? g.color : "#1e343b" }} />
                  ))}
                </div>
                {r.grade < 3 && (
                  <Btn size="sm" className="mt-2 w-full" disabled={state.economy.credits < cost} onClick={() => dispatch({ type: "upgradeRoad", roadId: r.id })}>
                    <Icon.road size={12} /> Upgrade to {ROAD_GRADES[(r.grade + 1) as 2 | 3].label} — ₡{fmt(cost)}
                  </Btn>
                )}
              </div>
            );
          })}
          <p className="num border-t border-line pt-2 text-[9px] leading-snug text-dim">
            Throughput is the physical cap on units moving per hour. Trade volume is separately capped at{" "}
            {cap} units per deal (base {TRADE.volumeCapBase} × depot modifier {mods.tradeBonus.toFixed(2)}) with a{" "}
            {TRADE.cooldownHours} h cooldown per partner. {TRADE.why}
          </p>
        </Panel>

        <Panel title="Alliance CEOs on the map" accent="#a3cb4d" bodyClass="p-3 flex flex-col gap-2">
          {state.remote.map((p) => {
            const dist = haversineKm(state.claim!.center, { lat: p.lat, lng: p.lng });
            return (
              <div key={p.id} className="border border-line bg-ink-950/55 p-2" style={{ borderLeft: `2px solid ${p.color}` }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] font-semibold text-chalk">{p.name}</span>
                  <span className={cn("num flex items-center gap-1 text-[9px]", p.online ? "text-moss" : "text-dim")}>
                    <i className={cn("inline-block h-1.5 w-1.5 rounded-full", p.online && "blink")} style={{ background: p.online ? "#a3cb4d" : "#3d5a63" }} />
                    {p.online ? "ONLINE" : `h${p.lastSeenTick}`}
                  </span>
                </div>
                <div className="num mt-0.5 flex flex-wrap gap-x-2.5 text-[9.5px] text-dim">
                  <span>{p.handle}</span>
                  <span>{dist.toFixed(1)} km</span>
                  <span>rep {p.reputation.toFixed(0)}</span>
                  <span style={{ color: p.alliance ? "#35d6c0" : "#ff6a55" }}>{p.alliance ? "ALLIED" : "INDEPENDENT"}</span>
                </div>
                <div className="num mt-0.5 text-[9px] text-dim">{formatLL({ lat: p.lat, lng: p.lng })}</div>
                <div className="mt-1.5 flex flex-col gap-1">
                  {p.buildings.map((b) => (
                    <div key={b.id} className="flex items-center gap-2 border border-line/70 bg-ink-900/60 px-2 py-1">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[10.5px] text-chalk">{b.name}</span>
                        <span className="num block text-[9px] text-dim">
                          {ARCHETYPE_BY_ID[b.archetypeId].name} · {b.plan.w}×{b.plan.h} m · {b.crew} crew
                        </span>
                      </span>
                      <Btn
                        size="sm"
                        variant={p.alliance ? "teal" : "ghost"}
                        disabled={!p.alliance}
                        onClick={() => {
                          setUi({ screen: "studio", studioTarget: null, visit: { ownerName: `${p.name} ${p.handle}`, buildingName: b.name, planId: b.plan.id } });
                          dispatch({ type: "log", entry: { kind: "visit", text: `Walk-through started at ${p.name}'s ${b.name} (${dist.toFixed(1)} km away). Their reception bot logged your arrival.` } });
                        }}
                        title={p.alliance ? "Enter in first person" : "Non-allied — see open question Q7"}
                      >
                        <Icon.walk size={11} /> {p.alliance ? "Walk" : "Locked"}
                      </Btn>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </Panel>

        <Panel title="Netcode status" accent="#ff6a55" bodyClass="p-3">
          <KV k="Mode" v={state.netMode === "local-sim" ? "LOCAL SIMULATION" : "LIVE"} tone={state.netMode === "local-sim" ? "#f2a33c" : "#35d6c0"} />
          <KV k="Authority" v="client-side reducer" />
          <KV k="Persistence" v="SQLite snapshot · schema 4" />
          <KV k="Peer agents" v={`${state.remote.length} simulated CEOs`} />
          <KV k="Grid" v={`${f.produced}/${f.demanded} kW`} tone={f.brownout ? "#ff6a55" : "#35d6c0"} />
          <p className="mt-2 border-l-2 border-coral/60 pl-2 text-[10px] leading-snug text-mist">
            Multiplayer is stubbed behind a single seam: remote CEOs are deterministic agents driven by the
            same tick, and their published floor plans are read-only walk-throughs. Swapping to a live
            authoritative server (Colyseus / Supabase Realtime / Liveblocks) means replacing the tick source
            and the `remote` array — no gameplay code changes. That substitution is open question{" "}
            <b className="text-coral">Q2/Q3</b> in the design doc and needs your ruling.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="Visits logged" value={state.log.filter((l) => l.kind === "visit").length} />
            <Stat label="Deals done" value={state.alliance.reduce((a, b) => a + b.dealsDone, 0)} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* -------------------------------- trade card ------------------------------- */

function TradeCard({
  bot,
  cap,
  qty,
  setQty,
  cooldown,
  onTrade,
}: {
  bot: AllianceBot;
  cap: number;
  qty: number;
  setQty: (v: number) => void;
  cooldown: number;
  onTrade: (c: Commodity, dir: "buy" | "sell") => void;
}) {
  const { state } = useGame();
  const color = bot.kind === "supplier" ? "#ff8347" : "#6fb7ff";
  const dist = haversineKm(state.claim!.center, { lat: bot.lat, lng: bot.lng });
  const goods = ["materials", "food"] as const;

  return (
    <Panel
      accent={color}
      title={
        <span className="flex items-center gap-2">
          <span style={{ color }}>{bot.kind === "supplier" ? "◈" : "▤"}</span>
          <span style={{ color }}>{bot.name}</span>
          <span className="num normal-case tracking-normal text-dim">
            {bot.kind} · {dist.toFixed(2)} km · {bot.mood}
          </span>
        </span>
      }
      right={
        cooldown > 0 ? (
          <Chip color="#ff6a55">COOLDOWN {cooldown} h</Chip>
        ) : (
          <Chip color="#35d6c0">DESK OPEN</Chip>
        )
      }
      bodyClass="p-3"
    >
      <div className="grid gap-3 lg:grid-cols-[190px_1fr]">
        <div className="flex flex-col gap-2">
          <Meter
            value={bot.relation}
            color={bot.relation > 60 ? "#35d6c0" : bot.relation > 30 ? "#f2a33c" : "#ff6a55"}
            label={`Relation ${bot.relation.toFixed(0)}/100`}
          />
          <KV k="Their purse" v={`₡${fmt(Math.round(bot.inventory.credits))}`} />
          <KV k="Their materials" v={fmt(Math.round(bot.inventory.materials))} />
          <KV k="Their food" v={fmt(Math.round(bot.inventory.food))} />
          <KV k="Deals closed" v={bot.dealsDone} />
          <div className="num text-[9px] leading-snug text-dim">
            +0.6 relation per deal, +1/h per Distribution Hub. Up to {Math.round(TRADE.relationPriceSlope * 100)}%
            better pricing at 100 relation on both sides of the trade.
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div>
            <div className="eyebrow mb-1">Volume per deal</div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={cap}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                className="flex-1 accent-[#f2a33c]"
              />
              <span className="num w-[74px] text-right text-[13px] font-semibold text-signal">{fmt(qty)} u</span>
            </div>
            <div className="mt-1 flex gap-1">
              {[0.25, 0.5, 1].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setQty(cap * pct)}
                  className="num border border-line px-1.5 py-[1px] text-[9px] text-dim transition-colors hover:border-signal hover:text-signal"
                >
                  {pct * 100}%
                </button>
              ))}
              <span className="num ml-auto text-[9px] text-dim">cap {cap} u</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {goods.map((c) => {
              const buy = priceFor(state, c, bot, "buy");
              const sell = priceFor(state, c, bot, "sell");
              const mine = c === "materials" ? state.economy.materials : state.economy.food;
              const theirs = bot.inventory[c];
              return (
                <div key={c} className="border border-line bg-ink-950/55 p-2">
                  <div className="num flex items-baseline justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-chalk">{c}</span>
                    <span className="text-[9px] text-dim">mkt ₡{state.market[c].toFixed(2)}</span>
                  </div>
                  <div className="num mt-1 grid grid-cols-2 gap-1 text-[9.5px]">
                    <span className="text-coral">buy ₡{buy.toFixed(2)}</span>
                    <span className="text-moss">sell ₡{sell.toFixed(2)}</span>
                    <span className="text-dim">you {fmt(Math.round(mine))}</span>
                    <span className="text-dim">them {fmt(Math.round(theirs))}</span>
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <Btn
                      size="sm"
                      className="flex-1"
                      disabled={cooldown > 0 || theirs < 1 || state.economy.credits < buy * Math.min(qty, theirs)}
                      onClick={() => onTrade(c, "buy")}
                    >
                      Buy ₡{fmt(Math.round(buy * Math.min(qty, theirs)))}
                    </Btn>
                    <Btn
                      size="sm"
                      className="flex-1"
                      variant="teal"
                      disabled={cooldown > 0 || mine < 1 || bot.inventory.credits < sell * Math.min(qty, mine)}
                      onClick={() => onTrade(c, "sell")}
                    >
                      Sell ₡{fmt(Math.round(sell * Math.min(qty, mine)))}
                    </Btn>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="num text-[9px] leading-snug text-dim">
            {bot.kind === "supplier"
              ? "Suppliers discount materials (×0.92) and mark up food (×1.04) — sell your rations elsewhere."
              : "Offtakers discount food (×0.92 on your buys) and pay up for materials — this is your export desk."}
            {" "}Power is a flow, never a stock: it cannot be traded or stored (GDD §11.4).
          </p>
        </div>
      </div>
    </Panel>
  );
}
