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
      <div className="w-full max-w-xl space-y-10">
        <header>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-black"
              style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
            >
              b
            </span>
            <span className="bunq-numeral font-mono text-xs uppercase tracking-[0.22em] text-[var(--bunq-green)]">
              Sauron Wallet
            </span>
          </div>
          <h1 className="mt-6 bunq-numeral text-5xl font-black leading-[1.05] tracking-tight text-[var(--bunq-text)]">
            See what your{" "}
            <span style={{ color: "var(--bunq-green)" }}>money</span> is doing
            before it does.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--bunq-muted)]">
            Hedge funds pay millions a year for one signal — aggregated card
            spending that predicts quarterly revenue. Your bunq account
            already has it. Tap a ticker, get a verdict, move money.
          </p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitTyped();
          }}
          className="space-y-3"
        >
          <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Ticker
          </label>
          <div className="flex gap-2">
            <input
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (error) setError(null);
              }}
              placeholder="HEIA.AS · ASML · AAPL"
              className="bunq-numeral flex-1 rounded-full px-5 py-3 font-mono text-base outline-none"
              style={{
                background: "var(--bunq-surface-2)",
                border: "1px solid var(--bunq-border-strong)",
                color: "var(--bunq-text)",
              }}
              autoFocus
              disabled={checking}
            />
            <button
              type="submit"
              disabled={checking || !typed.trim()}
              className="bunq-glow rounded-full px-6 text-sm font-bold disabled:opacity-50"
              style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
            >
              {checking ? "Checking…" : "Analyze"}
            </button>
          </div>
          {error && (
            <div
              className="rounded-2xl px-4 py-2 text-xs"
              style={{
                background: "var(--bunq-bad-soft)",
                color: "var(--bunq-bad)",
                border: "1px solid rgba(255,91,107,0.18)",
              }}
            >
              {error}
            </div>
          )}
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div
              className="w-full border-t"
              style={{ borderColor: "var(--bunq-border)" }}
            />
          </div>
          <div className="relative flex justify-center">
            <span
              className="px-3 font-mono text-[10px] uppercase tracking-[0.22em]"
              style={{
                background: "var(--bunq-bg)",
                color: "var(--bunq-faint)",
              }}
            >
              or
            </span>
          </div>
        </div>

        <NearbyTickersPicker onPick={(t, coords) => go(t.ticker, coords)} />

        <footer className="pt-4 text-[11px] leading-relaxed text-[var(--bunq-faint)]">
          Hackathon prototype. Not financial advice. Bunq sandbox + Alpaca
          paper only.
        </footer>
      </div>
    </main>
  );
}
