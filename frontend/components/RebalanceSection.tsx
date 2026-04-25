"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataProvenance } from "@/components/DataProvenance";
import {
  invest,
  meRebalance,
  type RebalanceResponse,
  type RebalanceSignal,
  type RebalanceSuggestion,
} from "@/lib/api";

const SIGNAL_PALETTE: Record<
  RebalanceSignal,
  { fg: string; bg: string; border: string; label: string }
> = {
  underweight: {
    fg: "var(--bunq-green)",
    bg: "rgba(181,255,0,0.06)",
    border: "rgba(181,255,0,0.30)",
    label: "underweight",
  },
  aligned: {
    fg: "var(--bunq-muted)",
    bg: "var(--bunq-surface-2)",
    border: "var(--bunq-border)",
    label: "aligned",
  },
  overweight: {
    fg: "var(--bunq-warn)",
    bg: "rgba(255,183,77,0.06)",
    border: "rgba(255,183,77,0.30)",
    label: "overweight",
  },
  position_only: {
    fg: "var(--bunq-info)",
    bg: "var(--bunq-info-soft)",
    border: "rgba(90,200,250,0.30)",
    label: "position only",
  },
};

export function RebalanceSection() {
  const [data, setData] = useState<RebalanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setData(await meRebalance());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (loading) {
    return (
      <section>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          Spend-vs-position alignment
        </h2>
        <div
          className="rounded-2xl p-4 text-xs text-[var(--bunq-muted)]"
          style={{
            background: "var(--bunq-surface)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          Cross-tabbing your spending against your positions…
        </div>
      </section>
    );
  }

  if (error || !data) return null;
  if (data.suggestions.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Spend-vs-position alignment
          </h2>
          <DataProvenance kind="rebalance" />
        </div>
        {data.summary.underweight_count > 0 && (
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{
              background: "var(--bunq-green-soft)",
              color: "var(--bunq-green)",
              border: "1px solid rgba(181,255,0,0.30)",
            }}
          >
            {data.summary.underweight_count} underweight · €
            {Math.round(data.summary.underweight_total_delta).toLocaleString()}{" "}
            gap
          </span>
        )}
      </div>

      <div
        className="rounded-2xl p-4 text-[12px] leading-relaxed text-[var(--bunq-muted)]"
        style={{
          background: "var(--bunq-surface)",
          border: "1px solid var(--bunq-border)",
          marginBottom: 12,
        }}
      >
        <span className="font-bold text-[var(--bunq-text)]">
          The thesis:
        </span>{" "}
        if Bunq panel data predicts revenue, your own spend predicts your
        conviction in a brand. Mismatches between your wallet and your
        portfolio are the most actionable signal we can give you.
      </div>

      <ul className="space-y-2">
        {data.suggestions.map((s) => (
          <RebalanceRow
            key={s.ticker}
            s={s}
            onInvested={() => void reload()}
          />
        ))}
      </ul>
    </section>
  );
}

function RebalanceRow({
  s,
  onInvested,
}: {
  s: RebalanceSuggestion;
  onInvested: () => void;
}) {
  const palette = SIGNAL_PALETTE[s.signal];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number; potName?: string | null } | null>(null);

  async function fire() {
    if (s.suggested_delta_eur <= 0) return;
    setPending(true);
    setError(null);
    try {
      const receipt = await invest(s.ticker, s.suggested_delta_eur);
      setDone({
        amount: receipt.amount_eur,
        potName: receipt.bunq_pot_name,
      });
      onInvested();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <li
      className="rounded-2xl p-3"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link
            href={`/analyze/${encodeURIComponent(s.ticker)}`}
            className="bunq-numeral font-mono text-sm font-bold text-[var(--bunq-text)] hover:underline"
          >
            {s.ticker}
          </Link>
          <span className="truncate text-[12px] text-[var(--bunq-muted)]">
            {s.company_name}
          </span>
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
            style={{
              background: "var(--bunq-surface)",
              color: palette.fg,
              border: `1px solid ${palette.border}`,
            }}
          >
            {palette.label}
          </span>
          {s.verdict && (
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
              style={{
                background: "var(--bunq-surface)",
                color:
                  s.verdict === "BUY"
                    ? "var(--bunq-green)"
                    : s.verdict === "AVOID"
                      ? "var(--bunq-bad)"
                      : "var(--bunq-warn)",
                border: "1px solid var(--bunq-border)",
              }}
              title="Most-recent analysis verdict"
            >
              {s.verdict}
              {s.verdict_confidence !== null &&
                s.verdict_confidence !== undefined &&
                ` ${Math.round(s.verdict_confidence * 100)}%`}
            </span>
          )}
        </div>
        <div className="text-right text-[12px] font-mono">
          <div className="text-[var(--bunq-text)]">
            <span className="bunq-numeral font-bold">
              €{Math.round(s.invested_eur).toLocaleString()}
            </span>
            <span className="text-[var(--bunq-faint)]"> invested</span>
          </div>
          <div className="text-[var(--bunq-faint)]">
            €{Math.round(s.spend_eur).toLocaleString()} spent
            {s.visit_count > 0 ? ` · ${s.visit_count}×` : ""}
          </div>
        </div>
      </div>

      <p className="mt-2 text-[12px] leading-snug text-[var(--bunq-text)]/85">
        {s.rationale}
      </p>

      {/* Action zone */}
      {done ? (
        <div
          className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]"
          style={{
            background: "var(--bunq-green-soft)",
            color: "var(--bunq-green)",
            border: "1px solid rgba(181,255,0,0.30)",
          }}
        >
          ✓ €{done.amount.toFixed(2)} into {done.potName ?? `${s.ticker} pot`}
        </div>
      ) : s.signal === "underweight" && s.suggested_delta_eur > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {error ? (
            <span className="font-mono text-[10px] text-[var(--bunq-bad)]">
              {error}
            </span>
          ) : (
            <span className="font-mono text-[10px] text-[var(--bunq-faint)]">
              suggested rebalance ·{" "}
              <span style={{ color: palette.fg }}>
                +€{Math.round(s.suggested_delta_eur).toLocaleString()}
              </span>{" "}
              to match your wallet
            </span>
          )}
          <button
            onClick={() => void fire()}
            disabled={pending}
            className="bunq-glow rounded-full px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-60"
            style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
          >
            {pending
              ? "Investing…"
              : `Invest €${Math.round(s.suggested_delta_eur).toLocaleString()} ↗`}
          </button>
        </div>
      ) : s.signal === "overweight" ? (
        <div className="mt-3 font-mono text-[10px] text-[var(--bunq-faint)]">
          consider trimming · informational only · we don&apos;t auto-sell
        </div>
      ) : null}
    </li>
  );
}
