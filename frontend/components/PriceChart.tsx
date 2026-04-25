"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DataProvenance } from "@/components/DataProvenance";
import { chartData, type ChartDataResponse } from "@/lib/api";

const PERIODS: { id: string; label: string }[] = [
  { id: "5d", label: "1W" },
  { id: "1mo", label: "1M" },
  { id: "3mo", label: "3M" },
  { id: "6mo", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "5y", label: "5Y" },
  { id: "max", label: "ALL" },
];

const CCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CHF: "CHF ",
  CAD: "C$",
  AUD: "A$",
  CNY: "¥",
  HKD: "HK$",
  GBp: "p",
};

function ccySymbol(c: string | null): string {
  if (!c) return "";
  return CCY_SYMBOL[c] ?? `${c} `;
}

function formatTick(d: string, period: string): string {
  // d is like "2025-04-25T13:30:00"; strip to month-day or hour-min depending on period
  if (period === "1d" || period === "5d") {
    return d.slice(11, 16);
  }
  if (period === "1mo" || period === "3mo") {
    return d.slice(5, 10); // MM-DD
  }
  return d.slice(2, 7); // YY-MM
}

export function PriceChart({ ticker }: { ticker: string }) {
  const [period, setPeriod] = useState("5y");
  const [data, setData] = useState<ChartDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    chartData(ticker, period)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [ticker, period]);

  const ccy = ccySymbol(data?.currency ?? null);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            interactive · {data?.currency ?? "—"}
          </div>
          <DataProvenance kind="price_chart" />
        </div>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className="rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] transition"
              style={
                period === p.id
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
      </div>

      <div className="mt-2 h-56 w-full">
        {error && (
          <div className="text-[11px] text-[var(--bunq-bad)]">
            chart unavailable: {error}
          </div>
        )}
        {!error && data === null && (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-[var(--bunq-faint)]">
            loading…
          </div>
        )}
        {data && data.bars.length > 0 && (
          <ResponsiveContainer>
            <AreaChart
              data={data.bars}
              margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
            >
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(181,255,0,0.40)" />
                  <stop offset="100%" stopColor="rgba(181,255,0,0)" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--bunq-faint)", fontSize: 10 }}
                stroke="var(--bunq-border-strong)"
                tickFormatter={(d: string) => formatTick(d, period)}
                minTickGap={48}
              />
              <YAxis
                tick={{ fill: "var(--bunq-faint)", fontSize: 10 }}
                stroke="var(--bunq-border-strong)"
                tickFormatter={(v: number) => `${ccy}${v.toFixed(0)}`}
                width={56}
                domain={[
                  (dataMin: number) => dataMin * 0.97,
                  (dataMax: number) => dataMax * 1.03,
                ]}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--bunq-surface)",
                  border: "1px solid var(--bunq-border-strong)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--bunq-muted)" }}
                formatter={(value) => [
                  `${ccy}${Number(value).toFixed(2)}`,
                  "close",
                ]}
                labelFormatter={(l) => String(l).replace("T", " ").slice(0, 16)}
                cursor={{ stroke: "var(--bunq-border-strong)" }}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke="var(--bunq-green)"
                strokeWidth={1.5}
                fill="url(#priceFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
