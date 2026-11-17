"use client";

import { useEffect } from "react";
import Boardroom from "./Boardroom";
import Diplomacy from "./Diplomacy";
import GDD from "./GDD";
import Onboarding from "./Onboarding";
import { NavRail, OpsTicker, SaveBadge, Toast, TopBar } from "./Shell";
import Studio from "./Studio";
import Territory from "./Territory";
import WorldMap from "./WorldMap";
import { TopoBackdrop } from "./ui";
import { SCREENS } from "@/game/engine";
import { GameProvider, useGame } from "@/state/store";
import { Btn, Icon } from "./ui";

/**
 * Browser-only application shell. Loaded with `dynamic(..., { ssr: false })` from
 * the app router page, so nothing below runs during server rendering.
 */
function Console() {
  const { ui, setUi, persistence, unloadWarning } = useGame();

  // Honest guard: while a write is failing, closing the tab can lose the last few
  // seconds of in-memory progress. The save itself is best-effort, not a promise.
  useEffect(() => {
    if (!unloadWarning) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unloadWarning]);

  // Keyboard: 1–6 jump screens (ignored while typing or while the mouse is locked)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (document.pointerLockElement) return;
      const i = Number(e.key);
      if (i >= 1 && i <= SCREENS.length) setUi({ screen: SCREENS[i - 1].id });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setUi]);

  if (persistence.phase === "booting" || persistence.phase === "loading") return <BootScreen />;
  if (persistence.phase === "load-error") return <LoadErrorScreen />;
  if (persistence.phase === "legacy-offer" || persistence.phase === "legacy-conflict")
    return <LegacyScreen />;
  if (persistence.conflict && persistence.phase !== "onboarding") return <ConflictScreen />;

  if (!ui.booted)
    return (
      <div className="relative h-full w-full">
        <TopoBackdrop />
        <Onboarding />
        <Toast />
      </div>
    );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <TopoBackdrop />
      <TopBar />
      <div className="relative z-10 flex min-h-0 flex-1">
        <NavRail />
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <div key={ui.screen} className="rise h-full min-h-0">
            {ui.screen === "world" && <WorldMap />}
            {ui.screen === "territory" && <Territory />}
            {ui.screen === "studio" && <Studio />}
            {ui.screen === "boardroom" && <Boardroom />}
            {ui.screen === "diplomacy" && <Diplomacy />}
            {ui.screen === "gdd" && <GDD />}
          </div>
        </main>
      </div>
      <OpsTicker />
      <SaveBadge />
      <Toast />
      <div className="pointer-events-none fixed bottom-9 right-3 z-[800] num text-[9px] text-dim/70">
        keys 1–6 switch console views
      </div>
    </div>
  );
}

/* --------------------------------- screens -------------------------------- */

function BootScreen() {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <TopoBackdrop />
      <div className="panel relative z-10 px-6 py-5 text-center">
        <div className="eyebrow">Simplayz land registry</div>
        <h1 className="display mt-1 text-[26px] leading-none text-chalk">
          SIM<span className="text-signal">PLAYZ</span>
        </h1>
        <p className="num mt-3 text-[11px] text-dim blink">restoring your company from the server…</p>
      </div>
    </div>
  );
}

function LoadErrorScreen() {
  const { persistence, reloadFromServer } = useGame();
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <TopoBackdrop />
      <div className="panel relative z-10 max-w-[460px] px-6 py-5">
        <div className="eyebrow">Persistence</div>
        <h2 className="display mt-1 text-[24px] leading-none text-chalk">CANNOT REACH YOUR SAVE</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-mist">
          The game server did not answer, so there is no safe way to know whether you already have a
          company. Nothing has been overwritten.
        </p>
        <p className="num mt-2 border-l-2 border-coral/60 pl-2 text-[10px] leading-snug text-coral">
          {persistence.loadError ?? "Unknown network error."}
        </p>
        <div className="mt-4 flex gap-2">
          <Btn variant="primary" onClick={() => void reloadFromServer()}>
            <Icon.play size={13} /> Retry connection
          </Btn>
        </div>
      </div>
    </div>
  );
}

function LegacyScreen() {
  const { persistence, migrateLegacy, dismissLegacy } = useGame();
  const legacy = persistence.legacy;
  const both = persistence.phase === "legacy-conflict";
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <TopoBackdrop />
      <div className="panel relative z-10 max-w-[600px] px-6 py-5">
        <div className="eyebrow">One-time migration · schema 4 localStorage</div>
        <h2 className="display mt-1 text-[24px] leading-none text-chalk">
          {both ? "THIS BROWSER HAS OLDER PROGRESS" : "MIGRATE BROWSER-SAVED PROGRESS?"}
        </h2>
        <p className="mt-2 text-[12px] leading-relaxed text-mist">
          {both
            ? "A server save already exists and a legacy browser save was also found. Neither has been changed. Choose which one you want to continue — the legacy browser copy stays on this device until a server write succeeds."
            : "A legacy schema-4 save is stored in this browser. Migrating copies it to the server after validation. API keys are never uploaded; they are dropped."}
        </p>
        <div className="panel-flat mt-3 p-3">
          <div className="num text-[10.5px] text-mist">
            <div>company: {legacy?.company ?? "unreadable"}</div>
            <div>sim hour: {legacy?.tick ?? "—"}</div>
            <div>validation: {legacy?.valid ? "PASS" : "FAIL"}</div>
            {!legacy?.valid && legacy?.problem && <div className="text-coral">{legacy.problem}</div>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="primary" disabled={!legacy?.valid} onClick={() => void migrateLegacy()}>
            <Icon.check size={13} /> Migrate legacy save to server
          </Btn>
          <Btn onClick={dismissLegacy}>
            {both ? "Keep my server save — discard legacy copy" : "Start without migrating"}
          </Btn>
        </div>
        <p className="num mt-3 border-l-2 border-signal/60 pl-2 text-[10px] leading-snug text-dim">
          Migrating replaces the server save only after you confirm here; it is never automatic.
        </p>
      </div>
    </div>
  );
}

function ConflictScreen() {
  const { persistence, acceptServerVersion, overwriteWithLocal } = useGame();
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <TopoBackdrop />
      <div className="panel relative z-10 max-w-[560px] px-6 py-5">
        <div className="eyebrow">Save conflict · autosave paused</div>
        <h2 className="display mt-1 text-[24px] leading-none text-chalk">TWO VERSIONS DIVERGED</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-mist">
          Another tab or device wrote this company after your last read (server revision{" "}
          {persistence.conflict?.serverRevision ?? "?"}). Autosave is paused and your in-memory progress is
          intact, so nothing has been discarded. Pick the version to keep.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="primary" onClick={() => void acceptServerVersion()}>
            <Icon.arrow size={13} /> Load the server version
          </Btn>
          <Btn variant="teal" onClick={() => void overwriteWithLocal()}>
            <Icon.check size={13} /> Keep this tab&apos;s version
          </Btn>
        </div>
        <p className="num mt-3 border-l-2 border-coral/60 pl-2 text-[10px] leading-snug text-dim">
          Keeping this tab writes your snapshot over the newer revision. Export first if you need both.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <Console />
    </GameProvider>
  );
}
