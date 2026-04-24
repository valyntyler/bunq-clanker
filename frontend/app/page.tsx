"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NearbyTickersPicker } from "@/components/NearbyTickers";
import { validateTicker } from "@/lib/api";

export default function Landing() {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function go(ticker: string, coords?: { lat: number; lng: number }) {
    const q = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : "";
    router.push(`/analyze/${encodeURIComponent(ticker)}${q}`);
  }

  async function submitTyped() {
    const t = typed.trim().toUpperCase();
    if (!t) return;
    setChecking(true);
    setError(null);
    try {
      const r = await validateTicker(t);
      if (!r.ok) {
        setError(
          `"${t}" doesn't look like a real listed ticker. Try AAPL, NVDA, HEIA.AS, ASML.AS, …`
        );
        return;
      }
      go(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-xl space-y-8">
        <header>
          <div className="font-mono text-xs uppercase tracking-wider text-fuchsia-400">
            Sauron Wallet
          </div>
          <h1 className="mt-2 text-4xl font-black tracking-tight">
            Multimodal AI investment analyst
          </h1>
          <p className="mt-3 text-sm text-zinc-400">
            Panel alt-data, geopolitical overlays, GPS, your own Bunq spending —
            synthesized into a next-quarter revenue call and a one-tap money move.
          </p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitTyped();
          }}
          className="space-y-3"
        >
          <label className="block text-xs font-mono uppercase tracking-wider text-zinc-500">
            Ticker
          </label>
          <div className="flex gap-2">
            <input
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (error) setError(null);
              }}
              placeholder="HEIA.AS, ASML, AAPL…"
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 font-mono outline-none focus:border-zinc-600"
              autoFocus
              disabled={checking}
            />
            <button
              type="submit"
              disabled={checking || !typed.trim()}
              className="rounded-lg bg-emerald-600 px-5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {checking ? "Checking…" : "Analyze"}
            </button>
          </div>
          {error && (
            <div className="rounded-md bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-800" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-zinc-950 px-3 text-[10px] font-mono uppercase tracking-wider text-zinc-600">
              or
            </span>
          </div>
        </div>

        <NearbyTickersPicker onPick={(t, coords) => go(t.ticker, coords)} />

        <footer className="pt-8 text-[11px] text-zinc-600">
          Hackathon prototype. Not financial advice. Bunq sandbox + Alpaca paper
          only.
        </footer>
      </div>
    </main>
  );
}
