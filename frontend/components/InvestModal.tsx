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
  const MAX = 10_000;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
      <div
        className="w-full max-w-md rounded-3xl border p-6 shadow-2xl"
        style={{
          background: "var(--bunq-surface)",
          borderColor: "var(--bunq-border)",
        }}
      >
        {!receipt ? (
          <>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
              <BunqMark />
              <span className="text-[var(--bunq-muted)]">
                Move money · Main → Investment Pot
              </span>
            </div>
            <h2 className="mt-2 bunq-numeral text-3xl font-black">
              Invest €
              {amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </h2>
            <p className="mt-1 text-sm text-[var(--bunq-muted)]">
              Verdict <span className="font-semibold text-[var(--bunq-text)]">{report.verdict}</span>
              {" · "}
              recommended position {report.position_size_pct.toFixed(1)}%
            </p>

            {balance && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <BalancePill label="Main Wallet" value={balance.main} />
                <BalancePill label="Investment Pot" value={balance.pot} accent />
              </div>
            )}

            <div className="mt-5 flex items-center gap-2">
              <span className="bunq-numeral font-mono text-2xl font-black text-[var(--bunq-faint)]">
                €
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountFromText(e.target.value)}
                onBlur={() => setAmountText(String(amount))}
                className="bunq-numeral flex-1 rounded-2xl px-3 py-2.5 text-2xl font-black outline-none"
                style={{
                  background: "var(--bunq-surface-2)",
                  border: "1px solid var(--bunq-border-strong)",
                  color: "var(--bunq-text)",
                }}
                aria-label="Investment amount in EUR"
              />
            </div>
            <div className="mt-2 flex gap-1.5">
              {[25, 100, 500, 1000].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setAmountFromSlider(q)}
                  className="rounded-full px-3 py-1 font-mono text-[11px] hover:opacity-80"
                  style={{
                    background: "var(--bunq-surface-2)",
                    border: "1px solid var(--bunq-border)",
                    color: "var(--bunq-muted)",
                  }}
                >
                  €{q}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={MIN}
              max={Math.min(MAX, Math.max(2000, defaultAmt * 5))}
              step={1}
              value={amount}
              onChange={(e) => setAmountFromSlider(parseInt(e.target.value))}
              className="mt-3 w-full accent-[var(--bunq-green)]"
            />
            <div className="flex justify-between font-mono text-[10px] text-[var(--bunq-faint)]">
              <span>€{MIN}</span>
              <span>up to €{MAX.toLocaleString()}</span>
            </div>
            {balance && amount > balance.main && (
              <div className="mt-2 text-[11px] text-[var(--bunq-warn)]">
                Main has €{balance.main.toFixed(2)} — we'll top-up from sandbox
                sugardaddy first.
              </div>
            )}
            {error && (
              <div
                className="mt-3 rounded-xl p-2 text-xs"
                style={{
                  background: "var(--bunq-bad-soft)",
                  color: "var(--bunq-bad)",
                }}
              >
                {error}
              </div>
            )}
            <div className="mt-6 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-full px-4 py-2.5 text-sm font-semibold"
                style={{
                  background: "var(--bunq-surface-2)",
                  border: "1px solid var(--bunq-border-strong)",
                  color: "var(--bunq-text)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={pending}
                className="bunq-glow flex-1 rounded-full px-4 py-2.5 text-sm font-bold disabled:opacity-50"
                style={{
                  background: "var(--bunq-green)",
                  color: "#0a0d05",
                }}
              >
                {pending
                  ? "Moving money…"
                  : `Confirm €${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
              <BunqMark />
              receipt
            </div>
            <h2 className="mt-2 bunq-numeral text-3xl font-black">
              Transfer complete
            </h2>
            {balance && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <BalancePill label="Main Wallet" value={balance.main} />
                <BalancePill label="Investment Pot" value={balance.pot} accent />
              </div>
            )}
            <dl className="mt-5 space-y-2 text-sm">
              <Row k="Bunq payment" v={receipt.bunq_payment_id ?? "—"} />
              <Row k="Alpaca order" v={receipt.alpaca_order_id ?? "—"} />
              <Row
                k="Amount"
                v={`€${receipt.amount_eur.toFixed(2)} → $${receipt.amount_usd.toFixed(2)}`}
              />
              <Row k="Shares" v={receipt.shares.toString()} />
              <Row k="Ticker" v={receipt.ticker} />
              <Row k="Timestamp" v={receipt.timestamp.slice(0, 19)} />
            </dl>
            <button
              onClick={onClose}
              className="mt-6 w-full rounded-full px-4 py-2.5 text-sm font-semibold"
              style={{
                background: "var(--bunq-surface-2)",
                border: "1px solid var(--bunq-border-strong)",
                color: "var(--bunq-text)",
              }}
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
    <div
      className="flex justify-between gap-2 border-b pb-1"
      style={{ borderColor: "var(--bunq-border)" }}
    >
      <dt className="text-[var(--bunq-faint)]">{k}</dt>
      <dd className="bunq-numeral truncate font-mono text-[var(--bunq-text)]">
        {v}
      </dd>
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
      className="rounded-2xl px-3 py-2.5"
      style={{
        background: accent ? "var(--bunq-green-soft)" : "var(--bunq-surface-2)",
        border: `1px solid ${accent ? "rgba(181,255,0,0.30)" : "var(--bunq-border)"}`,
      }}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {label}
      </div>
      <div
        className="bunq-numeral mt-0.5 font-mono text-2xl font-black"
        style={{
          color: accent ? "var(--bunq-green)" : "var(--bunq-text)",
        }}
      >
        €{value.toFixed(2)}
      </div>
    </div>
  );
}

function BunqMark() {
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black"
      style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
      aria-hidden
    >
      b
    </span>
  );
}
