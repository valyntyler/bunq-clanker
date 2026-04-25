"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { DataProvenance } from "@/components/DataProvenance";
import {
  getTrending,
  type ChartPeriod,
  type TrendingTicker,
} from "@/lib/api";

// Period choices shown to the user. Backend understands all yfinance period
// strings; we surface a subset that's useful at a glance.
const PERIODS: { id: ChartPeriod; label: string }[] = [
  { id: "1mo", label: "1M" },
  { id: "3mo", label: "3M" },
  { id: "6mo", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "5y", label: "5Y" },
  { id: "max", label: "MAX" },
];

const VERDICT_PALETTE: Record<
  NonNullable<TrendingTicker["latest_verdict"]>,
  { bg: string; fg: string; border: string; stroke: string; fill: string }
> = {
  BUY: {
    bg: "var(--bunq-green-soft)",
    fg: "var(--bunq-green)",
    border: "rgba(181,255,0,0.30)",
    stroke: "var(--bunq-green)",
    fill: "rgba(181,255,0,0.25)",
  },
  HOLD: {
    bg: "rgba(255,183,77,0.10)",
    fg: "var(--bunq-warn)",
    border: "rgba(255,183,77,0.30)",
    stroke: "var(--bunq-warn)",
    fill: "rgba(255,183,77,0.20)",
  },
  AVOID: {
    bg: "var(--bunq-bad-soft)",
    fg: "var(--bunq-bad)",
    border: "rgba(255,91,107,0.30)",
    stroke: "var(--bunq-bad)",
    fill: "rgba(255,91,107,0.20)",
  },
};

const NEUTRAL = {
  bg: "var(--bunq-surface-2)",
  fg: "var(--bunq-muted)",
  border: "var(--bunq-border)",
  stroke: "var(--bunq-muted)",
  fill: "rgba(138,143,155,0.18)",
};

const CCY: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

export function TrendingTickers() {
  const [data, setData] = useState<{
    as_of: string;
    trending: TrendingTicker[];
  } | null>(null);
  const [period, setPeriod] = useState<ChartPeriod>("1mo");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    getTrending({ hours: 168, limit: 12, sparkPeriod: period })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setRefreshing(false));
    return () => {
      cancelled = true;
    };
  }, [period]);

  if (error)
    return (
      <div
        className="rounded-2xl px-3 py-2 text-xs"
        style={{
          background: "var(--bunq-bad-soft)",
          color: "var(--bunq-bad)",
        }}
      >
        trending unavailable: {error}
      </div>
    );
  if (data === null)
    return (
      <div className="font-mono text-[11px] text-[var(--bunq-faint)]">
        loading what others searched…
      </div>
    );
  if (data.trending.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            What others are watching
          </h2>
          <DataProvenance kind="trending" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] text-[var(--bunq-faint)]">
            sparkline · {refreshing ? "loading…" : period}
          </span>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
        {data.trending.map((t) => (
          <TickerCard key={t.ticker} t={t} />
        ))}
      </div>
    </section>
  );
}

function PeriodSelector({
  value,
  onChange,
}: {
  value: ChartPeriod;
  onChange: (p: ChartPeriod) => void;
}) {
  return (
    <div className="flex gap-1">
      {PERIODS.map((p) => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          className="rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] transition"
          style={
            value === p.id
              ? {
                  background: "var(--bunq-green-soft)",
                  color: "var(--bunq-green)",
                  border: "1px solid rgba(181,255,0,0.30)",
                }
              : {
                  background: "var(--bunq-surface-2)",
                  color: "var(--bunq-muted)",
                  border: "1px solid var(--bunq-border)",
                }
          }
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function TickerCard({ t }: { t: TrendingTicker }) {
  const palette = t.latest_verdict
    ? VERDICT_PALETTE[t.latest_verdict]
    : NEUTRAL;
  const ccySym = (t.currency && CCY[t.currency]) || "";
  const last = t.spark.length > 0 ? t.spark[t.spark.length - 1] : null;
  const first = t.spark.length > 0 ? t.spark[0] : null;
  const pct =
    last && first ? ((last / first - 1) * 100) : null;
  const trend = pct === null ? "" : pct >= 0 ? "+" : "";

  // Recharts wants objects, not raw numbers
  const series = t.spark.map((c, i) => ({ i, c }));

  return (
    <Link
      href={`/analyze/${encodeURIComponent(t.ticker)}`}
      className="group block w-[260px] shrink-0 snap-start overflow-hidden rounded-2xl transition hover:brightness-110"
      style={{
        background: "var(--bunq-surface)",
        border: `1px solid ${palette.border}`,
      }}
    >
      <div className="flex items-start justify-between gap-2 p-4 pb-2">
        <div className="min-w-0">
          <div className="bunq-numeral font-mono text-sm font-bold text-[var(--bunq-text)]">
            {t.ticker}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--bunq-muted)]">
            {t.company_name}
          </div>
        </div>
        {t.latest_verdict && (
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em]"
            style={{ background: palette.bg, color: palette.fg }}
          >
            {t.latest_verdict}
          </span>
        )}
      </div>

      <div className="px-1" style={{ height: 64 }}>
        <ResponsiveContainer>
          <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient
                id={`spark-${t.ticker}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={palette.fill} />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </linearGradient>
            </defs>
            <Tooltip
              contentStyle={{
                background: "var(--bunq-surface)",
                border: "1px solid var(--bunq-border-strong)",
                borderRadius: 8,
                fontSize: 10,
                padding: "4px 6px",
              }}
              labelStyle={{ display: "none" }}
              formatter={(value) => [
                `${ccySym}${Number(value).toFixed(2)}`,
                "close",
              ]}
              cursor={{ stroke: palette.stroke, strokeWidth: 0.5 }}
            />
            <Area
              type="monotone"
              dataKey="c"
              stroke={palette.stroke}
              strokeWidth={1.5}
              fill={`url(#spark-${t.ticker})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-baseline justify-between gap-2 px-4 pb-3 pt-1">
        <div>
          {last !== null && (
            <span className="bunq-numeral font-mono text-sm font-bold text-[var(--bunq-text)]">
              {ccySym}
              {last.toFixed(2)}
            </span>
          )}
          {pct !== null && (
            <span
              className="ml-1 bunq-numeral font-mono text-[10px]"
              style={{
                color:
                  pct >= 0
                    ? "var(--bunq-green)"
                    : "var(--bunq-bad)",
              }}
            >
              {trend}
              {pct.toFixed(1)}%
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] text-[var(--bunq-faint)]">
          {t.search_count} {t.search_count === 1 ? "search" : "searches"}
        </span>
      </div>
    </Link>
  );
}
