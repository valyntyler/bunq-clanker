"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DataProvenance } from "@/components/DataProvenance";
import type { SpendingInsights } from "@/lib/api";

const CATEGORY_COLORS = [
  "var(--bunq-green)",
  "#5ac8fa",
  "#ffb74d",
  "#ff5b6b",
  "#b388ff",
  "#4dd0b8",
  "#ffd54f",
  "#a1a8b4",
  "#ff8a65",
  "#7986cb",
];

export function SpendingSection({ data }: { data: SpendingInsights }) {
  if (data.visit_count === 0) return null;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          Spending patterns
        </h2>
        <DataProvenance
          kind="spending_insights"
          detail={`${data.visit_count} payments · €${Math.round(data.total_eur).toLocaleString()}`}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryTile
          label="12-mo spend"
          value={`€${Math.round(data.total_eur).toLocaleString()}`}
          sub={`${data.visit_count} payments`}
          accent
        />
        <SummaryTile
          label="categories"
          value={String(data.by_category.length)}
          sub={`top: ${data.by_category[0]?.category ?? "—"}`}
        />
        <SummaryTile
          label="tickers you spend at"
          value={String(data.by_ticker.length)}
          sub={
            data.by_ticker[0]
              ? `top: ${data.by_ticker[0].ticker}`
              : "no matches"
          }
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Card title="Monthly spend">
          <div className="h-44">
            <ResponsiveContainer>
              <BarChart
                data={data.by_month}
                margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
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
                  formatter={(value) => [
                    `€${Math.round(Number(value)).toLocaleString()}`,
                    "spend",
                  ]}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
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
        </Card>

        <Card title="Spend by category">
          <div className="flex h-44 items-center gap-2">
            <ResponsiveContainer width="55%">
              <PieChart>
                <Pie
                  data={data.by_category}
                  dataKey="spend_eur"
                  nameKey="category"
                  innerRadius={36}
                  outerRadius={66}
                  paddingAngle={2}
                  isAnimationActive={false}
                  stroke="var(--bunq-surface)"
                >
                  {data.by_category.map((_, i) => (
                    <Cell
                      key={i}
                      fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--bunq-surface)",
                    border: "1px solid var(--bunq-border-strong)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(value, name) => [
                    `€${Math.round(Number(value)).toLocaleString()}`,
                    String(name),
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 space-y-1 overflow-y-auto pr-1 text-[11px]">
              {data.by_category.slice(0, 8).map((c, i) => (
                <li
                  key={c.category}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-sm"
                      style={{
                        background:
                          CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                      }}
                    />
                    <span className="truncate text-[var(--bunq-text)]">
                      {c.category}
                    </span>
                  </span>
                  <span className="bunq-numeral font-mono text-[var(--bunq-faint)]">
                    €{Math.round(c.spend_eur).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Card title="Top merchants">
          <ul className="space-y-1">
            {data.top_merchants.slice(0, 8).map((m) => (
              <li
                key={m.merchant}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <span className="truncate text-[var(--bunq-text)]">
                  {m.merchant}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-[var(--bunq-muted)]">
                  €{Math.round(m.spend_eur).toLocaleString()}
                  <span className="ml-1 text-[var(--bunq-faint)]">
                    · {m.count}x
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="You already invest your money at">
          {data.by_ticker.length === 0 ? (
            <div className="text-xs text-[var(--bunq-muted)]">
              No matches — try buying something at one of our covered
              merchants 🍻
            </div>
          ) : (
            <ul className="space-y-1.5">
              {data.by_ticker.slice(0, 8).map((t) => (
                <li key={t.ticker}>
                  <Link
                    href={`/analyze/${encodeURIComponent(t.ticker)}`}
                    className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1 text-sm transition hover:bg-[var(--bunq-surface-2)]"
                  >
                    <span className="flex items-baseline gap-2 truncate">
                      <span className="bunq-numeral font-mono font-bold text-[var(--bunq-text)]">
                        {t.ticker}
                      </span>
                      <span className="truncate text-[11px] text-[var(--bunq-faint)]">
                        {t.category}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-[var(--bunq-green)]">
                      €{Math.round(t.spend_eur).toLocaleString()}
                      <span className="ml-1 text-[var(--bunq-faint)]">
                        · {t.count}x
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {data.discovery.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
              <span
                className="inline-flex h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--bunq-green)" }}
              />
              Categories you could move into
            </h3>
            <span className="text-[10px] text-[var(--bunq-muted)]">
              peers in categories you spend in but don't yet hold
            </span>
            <DataProvenance kind="spending_insights" detail="discovery" />
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {data.discovery.map((d) => (
              <Link
                key={`${d.ticker}-${d.anchor_ticker}`}
                href={`/analyze/${encodeURIComponent(d.ticker)}`}
                className="rounded-2xl p-3 transition hover:brightness-110"
                style={{
                  background:
                    "linear-gradient(160deg, rgba(181,255,0,0.06), var(--bunq-surface))",
                  border: "1px solid rgba(181,255,0,0.18)",
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="bunq-numeral font-mono font-bold text-[var(--bunq-text)]">
                    {d.ticker}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
                    style={{
                      background: "var(--bunq-green-soft)",
                      color: "var(--bunq-green)",
                    }}
                  >
                    {d.category}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-[var(--bunq-muted)]">
                  {d.rationale}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {title}
      </div>
      {children}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: accent
          ? "linear-gradient(160deg, rgba(181,255,0,0.08), var(--bunq-surface))"
          : "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {label}
      </div>
      <div
        className="bunq-numeral mt-1 text-3xl font-black"
        style={{ color: accent ? "var(--bunq-green)" : "var(--bunq-text)" }}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] text-[var(--bunq-muted)]">{sub}</div>
    </div>
  );
}
