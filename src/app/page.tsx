"use client";

import dynamic from "next/dynamic";

/**
 * Browser-only application entry. Everything under GameShell touches Leaflet,
 * Three.js, WebGL, pointer lock or localStorage, so it must never be part of the
 * server render graph. `ssr: false` is only legal inside a client component,
 * which is why this small wrapper exists and carries the client boundary.
 */
const GameShell = dynamic(() => import("@/components/GameShell"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <div className="num text-[11px] tracking-[0.22em] text-dim">BOOTING SIMPLAYZ…</div>
    </div>
  ),
});

export default function Page() {
  return <GameShell />;
}
