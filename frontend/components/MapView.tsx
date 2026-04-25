"use client";

import "leaflet/dist/leaflet.css";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { locationsHqs, type MapHq } from "@/lib/api";

/**
 * Sauron Map — HQ pins coloured by the user's most-recent verdict, sized
 * by the user's spend at that ticker. Click any pin for the verdict
 * snapshot + 'analyse / invest' shortcuts.
 *
 * Tiles: free OpenStreetMap-style basemap from openfreemap.org (no key,
 * stable up to demo-grade traffic). CartoDB voyager looks lovely too if
 * we ever want a dark variant.
 */

// CartoDB Dark Matter — matches the Bunq dark palette and serves
// reliably without an API key (anonymous fair-use).
const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_SUBDOMAINS = ["a", "b", "c", "d"];
const TILE_ATTRIBUTION =
  "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>";

const VERDICT_COLOR: Record<NonNullable<MapHq["verdict"]>, string> = {
  BUY: "#b5ff00",
  HOLD: "#ffb74d",
  AVOID: "#ff5b6b",
};
const NOT_ANALYSED = "#8a8f9b";

export function MapView() {
  const [hqs, setHqs] = useState<MapHq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<MapHq | null>(null);

  useEffect(() => {
    let alive = true;
    locationsHqs()
      .then((d) => alive && setHqs(d.hqs))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  // Center: user GPS if granted, else Amsterdam (Bunq's home).
  const initialCenter: [number, number] = userLoc ?? [52.37, 4.89];

  const stats = useMemo(() => {
    if (!hqs) return null;
    let analysed = 0;
    let totalSpend = 0;
    let totalInvested = 0;
    let verdictCounts: Record<string, number> = { BUY: 0, HOLD: 0, AVOID: 0 };
    const seenTickers = new Set<string>();
    for (const h of hqs) {
      if (seenTickers.has(h.ticker)) continue;
      seenTickers.add(h.ticker);
      if (h.verdict) {
        analysed++;
        verdictCounts[h.verdict] = (verdictCounts[h.verdict] || 0) + 1;
      }
      totalSpend += h.spend_eur;
      totalInvested += h.invested_eur;
    }
    return {
      total: seenTickers.size,
      analysed,
      verdictCounts,
      totalSpend,
      totalInvested,
    };
  }, [hqs]);

  function locateMe() {
    setError(null);
    if (!navigator.geolocation) {
      setError("Geolocation not supported by this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLoc([pos.coords.latitude, pos.coords.longitude]),
      (e) => setError(e.message),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_280px]">
      <div
        className="relative overflow-hidden rounded-3xl"
        style={{
          background: "var(--bunq-surface)",
          border: "1px solid var(--bunq-border)",
          height: "70vh",
        }}
      >
        <MapContainer
          center={initialCenter}
          zoom={5}
          scrollWheelZoom
          style={{ width: "100%", height: "100%" }}
        >
          <TileLayer
            attribution={TILE_ATTRIBUTION}
            url={TILE_URL}
            subdomains={TILE_SUBDOMAINS}
            maxZoom={19}
            crossOrigin
          />
          {userLoc && (
            <CircleMarker
              center={userLoc}
              radius={8}
              pathOptions={{
                color: "#5ac8fa",
                fillColor: "#5ac8fa",
                fillOpacity: 0.4,
                weight: 2,
              }}
            >
              <Popup>You are here</Popup>
            </CircleMarker>
          )}
          {(hqs ?? []).map((h, i) => (
            <HqMarker
              key={`${h.ticker}-${i}`}
              hq={h}
              onClick={() => setSelected(h)}
            />
          ))}
          {userLoc && <FlyTo to={userLoc} />}
        </MapContainer>

        {/* Legend overlay */}
        <div
          className="pointer-events-none absolute bottom-3 left-3 rounded-xl px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]"
          style={{
            background: "rgba(8,10,5,0.75)",
            color: "var(--bunq-text)",
            border: "1px solid rgba(255,255,255,0.10)",
            backdropFilter: "blur(6px)",
          }}
        >
          <LegendDot color={VERDICT_COLOR.BUY} label="buy" />
          <LegendDot color={VERDICT_COLOR.HOLD} label="hold" />
          <LegendDot color={VERDICT_COLOR.AVOID} label="avoid" />
          <LegendDot color={NOT_ANALYSED} label="not analysed" />
          <div
            className="mt-1 normal-case tracking-normal opacity-70"
            style={{ fontSize: "10px" }}
          >
            ring size = your spend
          </div>
        </div>

        {/* Locate-me button overlay */}
        <button
          onClick={locateMe}
          className="absolute right-3 top-3 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]"
          style={{
            background: "rgba(8,10,5,0.78)",
            color: "var(--bunq-green)",
            border: "1px solid rgba(181,255,0,0.30)",
            backdropFilter: "blur(6px)",
          }}
        >
          📍 locate me
        </button>
      </div>

      <aside className="space-y-3">
        {stats && <StatsPanel stats={stats} />}
        <SelectedPanel selected={selected} onClear={() => setSelected(null)} />
        {error && (
          <div
            className="rounded-2xl px-3 py-2 text-xs"
            style={{
              background: "var(--bunq-surface-2)",
              color: "var(--bunq-muted)",
              border: "1px solid var(--bunq-border)",
            }}
          >
            {error.toLowerCase().includes("denied") ||
            error.toLowerCase().includes("unavailable") ||
            error.toLowerCase().includes("timeout")
              ? `Couldn't read your location (${error.toLowerCase()}). The map still works without it.`
              : error}
          </div>
        )}
      </aside>
    </div>
  );
}

function FlyTo({ to }: { to: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(to, Math.max(map.getZoom(), 9), { duration: 0.8 });
  }, [to, map]);
  return null;
}

function HqMarker({
  hq,
  onClick,
}: {
  hq: MapHq;
  onClick: () => void;
}) {
  const color = hq.verdict ? VERDICT_COLOR[hq.verdict] : NOT_ANALYSED;
  // Spend size: floor radius 8, ceiling 22.
  const spendRadius =
    hq.spend_eur <= 0 ? 8 : Math.min(22, 8 + Math.log10(1 + hq.spend_eur) * 5);
  return (
    <CircleMarker
      center={[hq.lat, hq.lng]}
      radius={spendRadius}
      pathOptions={{
        color,
        fillColor: color,
        fillOpacity: hq.verdict ? 0.55 : 0.30,
        weight: hq.verdict ? 2 : 1,
      }}
      eventHandlers={{ click: onClick }}
    >
      <Popup>
        <div style={{ minWidth: 180 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              color,
              fontWeight: 700,
            }}
          >
            {hq.ticker}
            {hq.verdict ? ` · ${hq.verdict}` : " · not analysed"}
          </div>
          <div style={{ fontWeight: 700, marginTop: 2 }}>{hq.name}</div>
          {(hq.spend_eur > 0 || hq.invested_eur > 0) && (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "#5e6470",
              }}
            >
              {hq.spend_eur > 0 && <>spend €{hq.spend_eur.toLocaleString()}</>}
              {hq.spend_eur > 0 && hq.invested_eur > 0 && " · "}
              {hq.invested_eur > 0 && (
                <>invested €{hq.invested_eur.toLocaleString()}</>
              )}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <Link
              href={`/analyze/${encodeURIComponent(hq.ticker)}`}
              style={{
                background: "#b5ff00",
                color: "#0a0d05",
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              {hq.verdict ? "re-analyse" : "analyse"} ↗
            </Link>
          </div>
        </div>
      </Popup>
    </CircleMarker>
  );
}

function StatsPanel({
  stats,
}: {
  stats: {
    total: number;
    analysed: number;
    verdictCounts: Record<string, number>;
    totalSpend: number;
    totalInvested: number;
  };
}) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        On the map
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
        <Stat label="HQs" value={stats.total.toString()} />
        <Stat label="analysed" value={stats.analysed.toString()} />
        <Stat label="buy" value={(stats.verdictCounts.BUY || 0).toString()} accent="green" />
        <Stat label="hold" value={(stats.verdictCounts.HOLD || 0).toString()} accent="warn" />
        <Stat label="avoid" value={(stats.verdictCounts.AVOID || 0).toString()} accent="bad" />
        <Stat
          label="invested"
          value={`€${Math.round(stats.totalInvested).toLocaleString()}`}
        />
      </div>
      {stats.totalSpend > 0 && (
        <div className="mt-3 text-[11px] text-[var(--bunq-muted)]">
          You&apos;ve spent <span className="bunq-numeral font-bold text-[var(--bunq-green)]">€{Math.round(stats.totalSpend).toLocaleString()}</span> at companies on this map.
        </div>
      )}
    </div>
  );
}

function SelectedPanel({
  selected,
  onClear,
}: {
  selected: MapHq | null;
  onClear: () => void;
}) {
  if (!selected) {
    return (
      <div
        className="rounded-2xl p-4 text-xs text-[var(--bunq-muted)]"
        style={{
          background: "var(--bunq-surface)",
          border: "1px solid var(--bunq-border)",
        }}
      >
        Click any pin to inspect a company. Marker colour = your verdict
        (or grey if you haven&apos;t analysed it yet); ring size scales
        with how much you&apos;ve spent there.
      </div>
    );
  }
  const color = selected.verdict ? VERDICT_COLOR[selected.verdict] : NOT_ANALYSED;
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--bunq-surface)",
        border: `1px solid ${color}`,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="bunq-numeral font-mono text-[12px] font-bold uppercase tracking-[0.16em]"
          style={{ color }}
        >
          {selected.ticker}
        </span>
        <button
          onClick={onClear}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--bunq-muted)] hover:text-[var(--bunq-text)]"
        >
          clear
        </button>
      </div>
      <div className="text-sm font-bold text-[var(--bunq-text)]">
        {selected.name}
      </div>
      <div className="mt-1 text-[10px] font-mono text-[var(--bunq-faint)]">
        {selected.lat.toFixed(3)}, {selected.lng.toFixed(3)} · {selected.type}
      </div>
      <div className="mt-3 grid gap-1 text-[12px]">
        {selected.verdict ? (
          <span style={{ color }}>
            verdict · <strong>{selected.verdict}</strong>
            {selected.verdict_confidence !== null &&
              selected.verdict_confidence !== undefined && (
                <> · conf {Math.round(selected.verdict_confidence * 100)}%</>
              )}
          </span>
        ) : (
          <span className="text-[var(--bunq-muted)]">not yet analysed</span>
        )}
        {selected.spend_eur > 0 && (
          <span className="text-[var(--bunq-muted)]">
            spend · €{selected.spend_eur.toLocaleString()}
          </span>
        )}
        {selected.invested_eur > 0 && (
          <span className="text-[var(--bunq-muted)]">
            invested · €{selected.invested_eur.toLocaleString()}
          </span>
        )}
      </div>
      <Link
        href={`/analyze/${encodeURIComponent(selected.ticker)}`}
        className="mt-3 block rounded-full px-4 py-2 text-center text-sm font-bold"
        style={{
          background: "var(--bunq-green)",
          color: "#0a0d05",
        }}
      >
        {selected.verdict ? "Re-analyse" : "Analyse"} {selected.ticker} ↗
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "warn" | "bad";
}) {
  const color =
    accent === "green"
      ? "var(--bunq-green)"
      : accent === "warn"
        ? "var(--bunq-warn)"
        : accent === "bad"
          ? "var(--bunq-bad)"
          : "var(--bunq-text)";
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {label}
      </div>
      <div className="bunq-numeral font-mono font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: color, boxShadow: "0 0 0 1px rgba(0,0,0,0.3)" }}
      />
      <span>{label}</span>
    </div>
  );
}

