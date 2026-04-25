"use client";

import { useState } from "react";
import { DataProvenance } from "@/components/DataProvenance";
import { nearbyTickers, type NearbyTicker } from "@/lib/api";

export function NearbyTickersPicker({
  onPick,
}: {
  onPick: (t: NearbyTicker, coords: { lat: number; lng: number }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<NearbyTicker[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );

  async function locate() {
    setLoading(true);
    setError(null);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
        });
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setCoords({ lat, lng });
      const near = await nearbyTickers(lat, lng, 5000);
      setResults(near);
      if (near.length === 0) {
        setError("No listed companies within 5km — try a typed ticker.");
      }
    } catch (e) {
      setError(
        e instanceof GeolocationPositionError
          ? "Location permission denied. Type a ticker instead."
          : (e as Error).message
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={locate}
        disabled={loading}
        className="flex w-full items-center gap-3 rounded-3xl px-5 py-4 text-left transition hover:opacity-90 disabled:opacity-50"
        style={{
          background: "var(--bunq-surface)",
          border: "1px solid var(--bunq-border-strong)",
        }}
      >
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl"
          style={{
            background: "var(--bunq-green-soft)",
            color: "var(--bunq-green)",
          }}
        >
          📍
        </span>
        <div>
          <div className="text-sm font-bold text-[var(--bunq-text)]">
            {loading ? "Locating…" : "Use my location"}
          </div>
          <div className="text-[11px] text-[var(--bunq-muted)]">
            Find publicly listed companies near you
          </div>
        </div>
      </button>

      {error && (
        <div
          className="rounded-2xl px-4 py-2 text-xs"
          style={{
            background: "var(--bunq-bad-soft)",
            color: "var(--bunq-bad)",
          }}
        >
          {error}
        </div>
      )}

      {results.length > 0 && coords && (
        <div
          className="overflow-hidden rounded-2xl"
          style={{
            background: "var(--bunq-surface)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            <span>
              within 5km · {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
            </span>
            <DataProvenance kind="nearby" />
          </div>
          {results.slice(0, 8).map((r, i) => (
            <button
              key={`${r.ticker}-${i}`}
              onClick={() => onPick(r, coords)}
              className="flex w-full items-baseline justify-between border-t px-4 py-3 text-left transition hover:bg-[var(--bunq-surface-2)]"
              style={{ borderColor: "var(--bunq-border)" }}
            >
              <div>
                <span className="bunq-numeral font-mono text-sm font-bold text-[var(--bunq-text)]">
                  {r.ticker}
                </span>
                <span className="ml-2 text-sm text-[var(--bunq-muted)]">
                  {r.name}
                </span>
              </div>
              <span className="bunq-numeral font-mono text-[11px] text-[var(--bunq-faint)]">
                {r.distance_m < 1 ? "0m" : `${Math.round(r.distance_m)}m`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
