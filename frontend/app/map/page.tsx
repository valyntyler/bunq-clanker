"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { DataProvenance } from "@/components/DataProvenance";

// Leaflet pulls in `window` at import time, which breaks Next's SSR pass.
// Lazy-load the whole MapView client-only so the rest of the page can
// still render server-side and the leaflet bundle never ships to the
// initial paint.
const MapView = dynamic(
  () => import("@/components/MapView").then((m) => m.MapView),
  {
    ssr: false,
    loading: () => (
      <div
        className="rounded-3xl text-center font-mono text-[11px] text-[var(--bunq-faint)]"
        style={{
          background: "var(--bunq-surface)",
          border: "1px solid var(--bunq-border)",
          height: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        loading map…
      </div>
    ),
  }
);

export default function MapPageWrapper() {
  return (
    <AuthGuard>
      <MapPage />
    </AuthGuard>
  );
}

function MapPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header>
        <Link
          href="/"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)] hover:text-[var(--bunq-text)]"
        >
          ← back
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="bunq-numeral text-4xl font-black tracking-tight">
            Map
          </h1>
          <DataProvenance kind="map" />
        </div>
        <p className="mt-1 max-w-2xl text-sm text-[var(--bunq-muted)]">
          Every covered HQ as a pin — coloured by your most-recent verdict
          (BUY / HOLD / AVOID, grey if you haven&apos;t analysed it yet) and
          sized by how much you&apos;ve spent at the company. Click any pin
          to inspect, locate yourself to centre the map.
        </p>
      </header>
      <MapView />
    </main>
  );
}
