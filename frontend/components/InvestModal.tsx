"use client";

import { useEffect, useState } from "react";
import {
  bunqBalance,
  invest,
  type BunqBalance,
  type InvestReceipt,
  type Report,
} from "@/lib/api";

export function InvestModal({
  report,
  open,
  onClose,
}: {
  report: Report;
  open: boolean;
  onClose: () => void;
}) {
  const defaultAmt = Math.max(
    25,
    Math.round((report.position_size_pct / 100) * 1000)
  );
  const MIN = 1;
  const MAX = 10_000; // matches backend cap
  const [amount, setAmount] = useState(defaultAmt);
  const [amountText, setAmountText] = useState(String(defaultAmt));

  function setAmountFromText(s: string) {
    setAmountText(s);
    const n = parseFloat(s.replace(/[^\d.,-]/g, "").replace(",", "."));
    if (!Number.isFinite(n)) return;
    setAmount(Math.max(MIN, Math.min(MAX, n)));
  }
  function setAmountFromSlider(n: number) {
    setAmount(n);
    setAmountText(String(n));
  }
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<InvestReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<BunqBalance | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    bunqBalance().then((b) => !cancelled && setBalance(b)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, receipt]);

  if (!open) return null;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const r = await invest(report.ticker, amount);
      setReceipt(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        {!receipt ? (
          <>
            <div className="text-xs font-mono uppercase tracking-wider text-zinc-500">
              bunq → investment pot · {report.ticker}
            </div>
            <h2 className="mt-1 text-2xl font-bold">
              Invest €{amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Verdict: <span className="font-semibold">{report.verdict}</span> ·
              recommended position {report.position_size_pct.toFixed(1)}%
            </p>
            {balance && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <BalancePill label="Main Wallet" value={balance.main} />
                <BalancePill
                  label="Investment Pot"
                  value={balance.pot}
                  accent
                />
              </div>
            )}
            <div className="mt-4 flex items-center gap-2">
              <span className="font-mono text-sm text-zinc-500">€</span>
              <input
                type="text"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountFromText(e.target.value)}
                onBlur={() => setAmountText(String(amount))}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-lg outline-none focus:border-zinc-500"
                aria-label="Investment amount in EUR"
              />
              <div className="flex gap-1">
                {[25, 100, 500].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAmountFromSlider(q)}
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] font-mono text-zinc-300 hover:bg-zinc-700"
                  >
                    €{q}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="range"
              min={MIN}
              max={Math.min(MAX, Math.max(2000, defaultAmt * 5))}
              step={1}
              value={amount}
              onChange={(e) => setAmountFromSlider(parseInt(e.target.value))}
              className="mt-3 w-full"
            />
            <div className="flex justify-between text-[10px] font-mono text-zinc-500">
              <span>€{MIN}</span>
              <span>up to €{MAX.toLocaleString()}</span>
            </div>
            {balance && amount > balance.main && (
              <div className="mt-2 text-[11px] text-amber-300">
                Main has €{balance.main.toFixed(2)} — we'll auto-top-up from
                sandbox sugardaddy first.
              </div>
            )}
            {error && (
              <div className="mt-3 rounded-md bg-rose-950/50 p-2 text-xs text-rose-300">
                {error}
              </div>
            )}
            <div className="mt-6 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={pending}
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {pending
                  ? "Moving money…"
                  : `Confirm €${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-xs font-mono uppercase tracking-wider text-emerald-400">
              receipt
            </div>
            <h2 className="mt-1 text-2xl font-bold">Transfer complete</h2>
            {balance && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <BalancePill label="Main Wallet" value={balance.main} />
                <BalancePill
                  label="Investment Pot"
                  value={balance.pot}
                  accent
                />
              </div>
            )}
            <dl className="mt-4 space-y-2 text-sm">
              <Row k="Bunq payment" v={receipt.bunq_payment_id ?? "—"} />
              <Row k="Alpaca order" v={receipt.alpaca_order_id ?? "—"} />
              <Row
                k="Amount"
                v={`€${receipt.amount_eur.toFixed(2)} → $${receipt.amount_usd.toFixed(2)}`}
              />
              <Row k="Shares" v={receipt.shares.toString()} />
              <Row k="Ticker" v={receipt.ticker} />
              <Row k="Timestamp" v={receipt.timestamp} />
            </dl>
            <button
              onClick={onClose}
              className="mt-6 w-full rounded-lg bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-zinc-900 pb-1">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="truncate font-mono text-zinc-200">{v}</dd>
    </div>
  );
}

function BalancePill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        accent
          ? "border-emerald-800 bg-emerald-950/40"
          : "border-zinc-800 bg-zinc-900/60"
      }`}
    >
      <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-xl font-bold ${
          accent ? "text-emerald-300" : "text-zinc-100"
        }`}
      >
        €{value.toFixed(2)}
      </div>
    </div>
  );
}
