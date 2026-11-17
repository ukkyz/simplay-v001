"use client";

import { useEffect, useRef, useState } from "react";
import { EXEC_META } from "@/game/constants";
import { askExec, SUGGESTIONS } from "@/game/advisor";
import { stateDigest } from "@/game/digest";
import type { AIConfig, ChatMessage, ExecRole } from "@/game/types";
import { useGame } from "@/state/store";
import { cn } from "@/utils/cn";
import { Btn, Chip, Icon, KV, Meter, Panel } from "./ui";

const ROLES: ExecRole[] = ["cto", "cfo", "coo"];

export default function Boardroom() {
  const { state, ui, setUi, dispatch, toast } = useGame();
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<ExecRole | "all">("all");
  const [busy, setBusy] = useState(false);
  const [showDigest, setShowDigest] = useState(false);
  const [configFor, setConfigFor] = useState<ExecRole | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [ui.chat.length, busy]);

  const send = async (text: string, to: ExecRole | "all" = target) => {
    if (!text.trim() || busy) return;
    const roles: ExecRole[] = to === "all" ? ROLES : [to];
    const ceoMsg: ChatMessage = {
      id: `m${Date.now()}`,
      role: "ceo",
      author: `CEO ${state.ceoName}`,
      text: text.trim(),
      tick: state.economy.tick,
    };
    const pendings: ChatMessage[] = roles.map((r) => ({
      id: `p${Date.now()}_${r}`,
      role: r,
      author: EXEC_META[r].callsign,
      text: "",
      tick: state.economy.tick,
      pending: true,
    }));
    setUi({ chat: [...ui.chat, ceoMsg, ...pendings] });
    setDraft("");
    setBusy(true);

    for (let i = 0; i < roles.length; i++) {
      const r = roles[i];
      const history = [...ui.chat, ceoMsg];
      const res = await askExec(r, history, text.trim(), state);
      setUi((u) => ({
        chat: u.chat.map((m) =>
          m.id === pendings[i].id
            ? { ...m, pending: false, text: res.text, source: res.source, error: res.error ? true : undefined }
            : m,
        ),
      }));
      if (res.error) toast(res.error, "bad");
    }
    setBusy(false);
  };

  return (
    <div className="flex h-full min-h-0 gap-3 p-3">
      {/* ------------------------------- roster ------------------------------ */}
      <div className="flex w-[330px] shrink-0 flex-col gap-3 overflow-y-auto pr-1">
        <div>
          <div className="eyebrow">Executive board · 3 bots · SDLC lanes</div>
          <h2 className="display text-[26px] leading-none text-chalk">THE BOARDROOM</h2>
        </div>

        {state.execs.map((e) => {
          const m = EXEC_META[e.role];
          // "LIVE MODEL" is a server capability, not a browser key: the advisor
          // route reports whether a provider is configured for this deployment.
          const live = e.ai.enabled;
          return (
            <div
              key={e.role}
              className="panel relative overflow-hidden p-3 transition-all duration-300 hover:border-ink-600"
              style={{ borderLeft: `2px solid ${m.color}` }}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center border"
                  style={{ borderColor: `${m.color}66`, background: `${m.color}14`, color: m.color }}
                >
                  <Icon.bot size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-chalk">{e.name}</div>
                  <div className="eyebrow !text-[8.5px]">{m.title}</div>
                  <div className="num mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] text-dim">
                    <span style={{ color: m.color }}>{m.domain}</span>
                    <Chip color={live ? m.color : "#647c84"}>{live ? e.ai.model : "LOCAL ADVISOR"}</Chip>
                  </div>
                </div>
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                <Meter value={e.skill} color={m.color} label="Skill" height={3} />
                <Meter value={e.load} color={e.load > 85 ? "#ff6a55" : m.color} label="Load" height={3} danger={e.load > 85} />
                <Meter value={e.trust} color="#f2a33c" label="Trust" height={3} />
              </div>
              <div className="mt-2 flex gap-1.5">
                <Btn size="sm" variant="teal" onClick={() => setTarget(e.role)}>
                  Address {e.role.toUpperCase()}
                </Btn>
                <Btn size="sm" variant="ghost" className="ml-auto" onClick={() => setConfigFor(configFor === e.role ? null : e.role)}>
                  <Icon.gear size={12} /> Model
                </Btn>
              </div>
              {configFor === e.role && (
                <ModelConfig
                  role={e.role}
                  ai={e.ai}
                  onSave={(patch) => dispatch({ type: "setAI", role: e.role, patch })}
                  onTest={async () => {
                    setBusy(true);
                    const res = await askExec(e.role, [], "Report your current load and your top concern in one sentence.", state);
                    setUi((u) => ({
                      chat: [
                        ...u.chat,
                        { id: `t${Date.now()}`, role: "ceo", author: `CEO ${state.ceoName}`, text: "[connection test] Report load and top concern.", tick: state.economy.tick },
                        { id: `t2${Date.now()}`, role: e.role, author: EXEC_META[e.role].callsign, text: res.text, tick: state.economy.tick, source: res.source, error: res.error ? true : undefined },
                      ] as ChatMessage[],
                    }));
                    setBusy(false);
                    toast(
                      res.source === "live-api"
                        ? "The configured model responded."
                        : `Local advisor — ${res.error ?? "no live model configured on this server"}`,
                      res.source === "live-api" ? "good" : "bad",
                    );
                  }}
                />
              )}
            </div>
          );
        })}

        <Panel title="What the model sees" bodyClass="p-0">
          <button onClick={() => setShowDigest((s) => !s)} className="num flex w-full items-center justify-between px-3 py-2 text-[10.5px] text-mist transition-colors hover:text-chalk">
            <span>{showDigest ? "Hide" : "Show"} live state digest ({stateDigest(state).length} chars)</span>
            <span className="text-signal">{showDigest ? "▴" : "▾"}</span>
          </button>
          {showDigest && (
            <pre className="num max-h-[260px] overflow-auto whitespace-pre-wrap border-t border-line px-3 py-2 text-[9.5px] leading-relaxed text-mist">
              {stateDigest(state)}
            </pre>
          )}
          <p className="num border-t border-line px-3 py-2 text-[9px] leading-snug text-dim">
            The digest is injected as system context on every call, so a live model can only reason over
            numbers that actually exist in the simulation. The local advisor is bound to the same digest —
            identical contract, zero network.
          </p>
        </Panel>
      </div>

      {/* -------------------------------- thread ----------------------------- */}
      <Panel
        className="min-w-0 flex-1"
        title={
          <span className="flex items-center gap-2">
            Board thread
            <Chip color={target === "all" ? "#f2a33c" : EXEC_META[target].color}>
              {target === "all" ? "ALL THREE" : target.toUpperCase()}
            </Chip>
            {busy && <span className="num text-[9px] text-teal blink">thinking…</span>}
          </span>
        }
        right={
          <div className="flex items-center gap-1">
            <button onClick={() => setTarget("all")} className={cn("num border px-1.5 py-[2px] text-[9px]", target === "all" ? "border-signal text-signal" : "border-line text-dim hover:text-mist")}>
              ALL
            </button>
            {ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setTarget(r)}
                className={cn("num border px-1.5 py-[2px] text-[9px] uppercase", target === r ? "text-ink-950" : "border-line text-dim hover:text-mist")}
                style={target === r ? { background: EXEC_META[r].color, borderColor: EXEC_META[r].color } : undefined}
              >
                {r}
              </button>
            ))}
            {ui.chat.length > 0 && (
              <button onClick={() => setUi({ chat: [] })} className="num ml-1 border border-line px-1.5 py-[2px] text-[9px] text-dim hover:border-coral hover:text-coral">
                CLEAR
              </button>
            )}
          </div>
        }
        bodyClass="flex min-h-0 flex-1 flex-col"
      >
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {ui.chat.length === 0 && (
            <div className="panel-flat mx-auto mt-6 max-w-[620px] p-4">
              <div className="eyebrow">Thread empty</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-mist">
                The board plans and executes with you. Ask the CTO about design and schedule risk, the CFO
                about funding and runway, the COO about rations, roads and alliance throughput — or address
                all three and watch them disagree.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {ROLES.map((r) => (
                  <div key={r}>
                    <div className="eyebrow mb-1" style={{ color: EXEC_META[r].color }}>
                      {r}
                    </div>
                    <div className="flex flex-col gap-1">
                      {SUGGESTIONS[r].map((s) => (
                        <button
                          key={s}
                          onClick={() => send(s, r)}
                          className="border border-line bg-ink-950/50 px-2 py-1 text-left text-[10px] leading-snug text-mist transition-all hover:-translate-y-px hover:border-signal/50 hover:text-chalk"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ui.chat.map((m) => {
            const isCeo = m.role === "ceo";
            const color = isCeo ? "#f2a33c" : EXEC_META[m.role as ExecRole].color;
            return (
              <div key={m.id} className={cn("rise flex gap-2.5", isCeo && "flex-row-reverse")}>
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center border"
                  style={{ borderColor: `${color}66`, background: `${color}14`, color }}
                >
                  {isCeo ? <span className="num text-[10px] font-bold">CEO</span> : <Icon.bot size={15} />}
                </div>
                <div className={cn("min-w-0 max-w-[76%]", isCeo && "text-right")}>
                  <div className="num flex items-baseline gap-2 text-[9.5px]" style={{ justifyContent: isCeo ? "flex-end" : "flex-start" }}>
                    <span style={{ color }}>{m.author}</span>
                    <span className="text-dim">h{m.tick}</span>
                    {!isCeo && !m.pending && (
                      <span className={cn("border px-1 text-[8px]", m.source === "live-api" ? "border-teal/50 text-teal" : "border-line text-dim")}>
                        {m.source === "live-api" ? "LIVE MODEL" : "LOCAL ADVISOR"}
                      </span>
                    )}
                  </div>
                  <div
                    className={cn("mt-1 whitespace-pre-line border px-2.5 py-2 text-left text-[12px] leading-relaxed", m.error ? "border-coral/50 bg-coral/6" : "border-line bg-ink-950/55")}
                    style={{ color: m.pending ? "#647c84" : "#dbe8e9" }}
                  >
                    {m.pending ? (
                      <span className="num flex gap-1 text-[11px]">
                        <span className="blink">▍</span> consulting the simulation…
                      </span>
                    ) : (
                      m.text
                    )}
                    {m.error && <div className="num mt-1.5 border-t border-coral/40 pt-1.5 text-[9.5px] text-coral">{m.error}</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-line p-2.5">
          <div className="mb-2 flex flex-wrap gap-1">
            {(target === "all" ? ROLES : [target]).flatMap((r) => SUGGESTIONS[r].slice(0, 2)).map((s, i) => (
              <button
                key={`${s}-${i}`}
                onClick={() => send(s)}
                disabled={busy}
                className="num border border-line bg-ink-850 px-1.5 py-[2px] text-[9.5px] text-dim transition-colors hover:border-signal/50 hover:text-signal disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              placeholder={
                target === "all"
                  ? "Put a question to the whole board — Enter to send, Shift+Enter for a new line"
                  : `Address ${EXEC_META[target].name} (${EXEC_META[target].title})`
              }
              className="field min-h-[52px] flex-1 resize-none leading-relaxed"
            />
            <Btn variant="primary" disabled={busy || !draft.trim()} onClick={() => send(draft)} className="!px-4 !py-3">
              <Icon.arrow size={15} /> Send
            </Btn>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------ model config ------------------------------ */

function ModelConfig({
  role,
  ai,
  onSave,
  onTest,
}: {
  role: ExecRole;
  ai: AIConfig;
  onSave: (patch: Partial<AIConfig>) => void;
  onTest: () => void;
}) {
  const [local, setLocal] = useState<AIConfig>(ai);
  useEffect(() => setLocal(ai), [ai]);
  const m = EXEC_META[role];
  return (
    <div className="rise mt-3 border-t border-line pt-2.5">
      <div className="eyebrow mb-1.5" style={{ color: m.color }}>
        {role} advisor · server-proxied model
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="num border border-line bg-ink-950/60 px-2 py-1.5 text-[9.5px] leading-snug text-dim">
          Provider endpoint, model and API key are configured by the operator on the server
          (<span className="text-mist">SIMPLAYZ_AI_*</span>). They are never stored in your save,
          exported files or this browser. With no provider configured the grounded local advisor
          answers instead.
        </div>
        <label className="block">
          <span className="num text-[9px] text-dim">PREFERRED MODEL (display only)</span>
          <input
            className="field mt-0.5"
            value={local.model}
            placeholder="unset — server default"
            onChange={(e) => setLocal({ ...local, model: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="num text-[9px] text-dim">TEMPERATURE {local.temperature.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1.4}
            step={0.05}
            value={local.temperature}
            onChange={(e) => setLocal({ ...local, temperature: Number(e.target.value) })}
            className="mt-2 w-full accent-[#35d6c0]"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={local.enabled}
            onChange={(e) => setLocal({ ...local, enabled: e.target.checked })}
            className="accent-[#35d6c0]"
          />
          <span className="num text-[10px] text-mist">Route {role.toUpperCase()} through the live model when available</span>
        </label>
        <div className="mt-1 flex gap-1.5">
          <Btn size="sm" variant="primary" onClick={() => onSave(local)}>
            <Icon.check size={12} /> Save preferences
          </Btn>
          <Btn size="sm" variant="teal" disabled={!local.enabled} onClick={onTest}>
            Test connection
          </Btn>
        </div>
        <div className="mt-1">
          <KV k="System prompt" v={`${m.system.length} chars · v2 server proxy`} />
          <KV k="Fallback" v="grounded local advisor" tone="#35d6c0" />
          <KV k="Credentials in save" v="none" tone="#35d6c0" />
        </div>
      </div>
    </div>
  );
}
