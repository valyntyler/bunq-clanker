"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataProvenance } from "@/components/DataProvenance";
import { InvestModal } from "@/components/InvestModal";
import {
  meRebalance,
  type RebalanceResponse,
  type RebalanceSignal,
  type RebalanceSuggestion,
  type Report,
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

/** Build a minimal Report stub for InvestModal. The modal only reads
 *  ticker / position_size_pct / verdict / company_name — everything else
 *  is fine as a default. We tune position_size_pct so the modal's default
 *  invest amount lands on the suggested delta:
 *      default = position_size_pct/100 × 1000
 *  → set position_size_pct = clamp(delta / 10, 0, 10). */
function buildStubReport(s: RebalanceSuggestion): Report {
  const sizePct = Math.max(
    0,
    Math.min(10, Math.round((s.suggested_delta_eur / 10) * 10) / 10)
  );
  return {
    ticker: s.ticker,
    company_name: s.company_name || s.ticker,
    generated_at: new Date().toISOString(),
    verdict: s.verdict ?? "HOLD",
    confidence: s.verdict_confidence ?? 0.5,
    position_size_pct: sizePct,
    one_liner: s.rationale,
    sections: {},
    geopolitical_overlays: [],
    user_sources: [],
    bunq_spending_overlay: null,
    consumer_panel_forecast: null,
    location_context: { used: false, detected_at: null, coords: null },
    risks: [],
    conflicts: [],
    data_gaps: [],
    citations: [],
    index_options: [],
    disclaimer: "",
  };
}

export function RebalanceSection() {
  const [data, setData] = useState<RebalanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [investing, setInvesting] = useState<RebalanceSuggestion | null>(null);

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
            onChooseAmount={() => setInvesting(s)}
          />
        ))}
      </ul>

      {investing && (
        <InvestModal
          report={buildStubReport(investing)}
          open={true}
          onClose={() => {
            setInvesting(null);
            // Refresh on close in case they invested — modal doesn't fire
            // a callback, so re-pulling the rebalance data covers it.
            void reload();
          }}
        />
      )}
    </section>
  );
}

function RebalanceRow({
  s,
  onChooseAmount,
}: {
  s: RebalanceSuggestion;
  onChooseAmount: () => void;
}) {
  const palette = SIGNAL_PALETTE[s.signal];
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

      {s.signal === "underweight" && s.suggested_delta_eur > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-[var(--bunq-faint)]">
            suggested rebalance ·{" "}
            <span style={{ color: palette.fg }}>
              +€{Math.round(s.suggested_delta_eur).toLocaleString()}
            </span>{" "}
            to match your wallet
          </span>
          <button
            onClick={onChooseAmount}
            className="bunq-glow rounded-full px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
          >
            Choose amount · invest ↗
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
