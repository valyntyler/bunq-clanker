"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DataProvenance } from "@/components/DataProvenance";
import { panelData, type PanelMonth } from "@/lib/api";

export function PanelChart({ ticker }: { ticker: string }) {
  const [series, setSeries] = useState<PanelMonth[] | null>(null);
  const [source, setSource] = useState<"live" | "simulated" | null>(null);
  const [matched, setMatched] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    panelData(ticker)
      .then((d) => {
        if (cancelled) return;
        setSeries(d.series);
        setSource(d.source ?? "simulated");
        setMatched(d.matched_count ?? 0);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (error) return null; // Tickers without panel data — silent skip
  if (series === null)
    return (
      <div className="font-mono text-[11px] text-[var(--bunq-faint)]">
        loading panel series…
      </div>
    );

  // Show last 12 months for the bar chart. Compare with same month prior year.
  const recent = series.slice(-12);

  return (
    <div className="w-full">
      <div className="mb-1 flex justify-end">
        {source === "live" ? (
          <DataProvenance
            kind="panel_chart"
            detail={`live · ${matched} matched`}
            override={{
              label: "Bunq panel · live",
              what: "12-month bars of Bunq sandbox spend matching the ticker's merchant aliases, vs same-month prior year.",
              source:
                "Bunq sandbox /v1/user/{id}/monetary-account/{aid}/payment.",
              method:
                "Outflows aggregated by month, alias-matched on counterparty + description. Prior-year baseline still pulled from the simulated fixture so YoY makes sense in a thin sandbox.",
              freshness: "Pulled live; trailing 24 months window.",
              caveat: undefined,
            }}
          />
        ) : (
          <DataProvenance kind="panel_chart" />
        )}
      </div>
      <div className="h-44 w-full">
      <ResponsiveContainer>
        <BarChart
          data={recent}
          margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
          barCategoryGap="20%"
        >
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: "var(--bunq-faint)", fontSize: 10 }}
            stroke="var(--bunq-border-strong)"
            tickFormatter={(d: string) => d.slice(2, 7)}
            minTickGap={32}
          />
          <YAxis
            tick={{ fill: "var(--bunq-faint)", fontSize: 10 }}
            stroke="var(--bunq-border-strong)"
            tickFormatter={(v: number) =>
              v >= 1000 ? `€${(v / 1000).toFixed(0)}k` : `€${v.toFixed(0)}`
            }
            width={56}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bunq-surface)",
              border: "1px solid var(--bunq-border-strong)",
              borderRadius: 12,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--bunq-muted)" }}
            formatter={(value, name) => [
              `€${Math.round(Number(value)).toLocaleString()}`,
              String(name) === "spend_eur" ? "this year" : "prior year",
            ]}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, color: "var(--bunq-muted)" }}
            iconSize={8}
            formatter={(v: string) =>
              v === "spend_eur" ? "this year" : "prior year"
            }
          />
          <Bar
            dataKey="prior_year_eur"
            fill="rgba(255,255,255,0.18)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="spend_eur"
            fill="var(--bunq-green)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
