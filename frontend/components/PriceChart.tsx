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
import { chartData, type OhlcvBar } from "@/lib/api";

export function PriceChart({ ticker }: { ticker: string }) {
  const [bars, setBars] = useState<OhlcvBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    chartData(ticker, "1y")
      .then((d) => !cancelled && setBars(d.bars))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (error)
    return (
      <div className="text-[11px] text-[var(--bunq-faint)]">
        chart unavailable: {error}
      </div>
    );
  if (bars === null)
    return (
      <div className="font-mono text-[11px] text-[var(--bunq-faint)]">
        loading price history…
      </div>
    );
  if (bars.length === 0) return null;

  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const padding = (max - min) * 0.1;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <AreaChart data={bars} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
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
            tickFormatter={(d: string) => d.slice(2, 7)}
            minTickGap={48}
          />
          <YAxis
            tick={{ fill: "var(--bunq-faint)", fontSize: 10 }}
            stroke="var(--bunq-border-strong)"
            domain={[min - padding, max + padding]}
            tickFormatter={(v: number) => v.toFixed(0)}
            width={42}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bunq-surface)",
              border: "1px solid var(--bunq-border-strong)",
              borderRadius: 12,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--bunq-muted)" }}
            formatter={(value) => [Number(value).toFixed(2), "close"]}
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
    </div>
  );
}
