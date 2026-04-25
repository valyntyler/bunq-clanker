"use client";

import Link from "next/link";
import { DataProvenance } from "@/components/DataProvenance";
import type { IndexMembership } from "@/lib/api";

/**
 * "Safer option" card stack.
 *
 * If the analysed ticker belongs to one or more major indices, we surface
 * each index with its tradeable proxy ETFs and a one-click button to run
 * the same Sauron analysis on the proxy. The pitch: the user gets the
 * same exposure with single-name risk diluted across the index basket.
 */
export function IndexOptionsSection({
  ticker,
  options,
}: {
  ticker: string;
  options: IndexMembership[];
}) {
  if (!options || options.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          Safer-option indices
        </h2>
        <DataProvenance kind="index_options" detail={`${options.length} matches`} />
        <span className="text-[10px] text-[var(--bunq-muted)]">
          {ticker} sits inside these indices — buying the index ETF replaces
          single-stock risk with diversified beta.
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {options.map((idx) => (
          <IndexCard key={idx.key} idx={idx} />
        ))}
      </div>
    </section>
  );
}

function IndexCard({ idx }: { idx: IndexMembership }) {
  // Cheapest proxy first — usually the most accessible / liquid.
  const sortedProxies = [...idx.proxies].sort(
    (a, b) =>
      (a.expense_ratio_bps ?? 9999) - (b.expense_ratio_bps ?? 9999)
  );
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background:
          "linear-gradient(160deg, rgba(90,200,250,0.06), var(--bunq-surface))",
        border: "1px solid rgba(90,200,250,0.22)",
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-bold text-[var(--bunq-text)]">
          {idx.name}
        </span>
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
          style={{
            background: "rgba(90,200,250,0.12)",
            color: "#5ac8fa",
            border: "1px solid rgba(90,200,250,0.30)",
          }}
        >
          {idx.region}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[var(--bunq-muted)]">
        {idx.blurb}
      </p>
      <p className="mt-2 text-[12px] leading-snug text-[var(--bunq-text)]/85">
        {idx.rationale}
      </p>

      {sortedProxies.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {sortedProxies.map((p, i) => (
            <Link
              key={p.ticker}
              href={`/analyze/${encodeURIComponent(p.ticker)}`}
              className="flex items-baseline justify-between gap-2 rounded-xl px-3 py-2 text-sm transition hover:brightness-110"
              style={{
                background:
                  i === 0
                    ? "var(--bunq-green-soft)"
                    : "var(--bunq-surface-2)",
                border:
                  i === 0
                    ? "1px solid rgba(181,255,0,0.30)"
                    : "1px solid var(--bunq-border)",
                color: i === 0 ? "var(--bunq-green)" : "var(--bunq-text)",
              }}
            >
              <span className="flex items-baseline gap-2 truncate">
                <span className="bunq-numeral font-mono font-bold">
                  {p.ticker}
                </span>
                <span
                  className="truncate text-[11px]"
                  style={{
                    color:
                      i === 0
                        ? "var(--bunq-green)"
                        : "var(--bunq-muted)",
                  }}
                >
                  {p.name}
                </span>
              </span>
              <span className="flex shrink-0 items-baseline gap-2 font-mono text-[10px]">
                {p.expense_ratio_bps !== null &&
                  p.expense_ratio_bps !== undefined && (
                    <span
                      className="text-[var(--bunq-faint)]"
                      title="annual expense ratio"
                    >
                      ER {p.expense_ratio_bps}bps
                    </span>
                  )}
                <span className="uppercase tracking-[0.16em]">
                  analyse ↗
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
