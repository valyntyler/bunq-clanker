"use client";

import { useState } from "react";
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
        className="w-full rounded-lg border border-sky-700 bg-sky-900/50 px-4 py-3 text-left text-sky-100 hover:bg-sky-900 disabled:opacity-50"
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">📍</span>
          <div>
            <div className="font-semibold">
              {loading ? "Locating…" : "Use my location"}
            </div>
            <div className="text-xs text-sky-300/80">
              Find listed companies nearby
            </div>
          </div>
        </div>
      </button>
      {error && (
        <div className="rounded-md bg-rose-950/50 p-2 text-xs text-rose-300">
          {error}
        </div>
      )}
      {results.length > 0 && coords && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="px-2 py-1 text-[10px] font-mono uppercase text-zinc-500">
            within 5km · {coords.lat.toFixed(4)},{coords.lng.toFixed(4)}
          </div>
          {results.slice(0, 8).map((r, i) => (
            <button
              key={`${r.ticker}-${i}`}
              onClick={() => onPick(r, coords)}
              className="flex w-full items-baseline justify-between rounded px-2 py-2 text-left hover:bg-zinc-800"
            >
              <div>
                <span className="font-mono text-sm text-zinc-100">
                  {r.ticker}
                </span>
                <span className="ml-2 text-sm text-zinc-400">{r.name}</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">
                {r.distance_m < 1 ? "0m" : `${Math.round(r.distance_m)}m`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
