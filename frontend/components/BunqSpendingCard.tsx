import { DataProvenance } from "@/components/DataProvenance";
import { Term } from "@/components/Glossary";
import type { BunqSpendingOverlay } from "@/lib/api";

const TREND_ARROW = {
  accelerating: "↗",
  flat: "→",
  declining: "↘",
} as const;
const TREND_COLOR = {
  accelerating: "text-[var(--bunq-green)]",
  flat: "text-[var(--bunq-muted)]",
  declining: "text-[var(--bunq-bad)]",
} as const;

export function BunqSpendingCard({
  overlay,
  ticker,
}: {
  overlay: BunqSpendingOverlay;
  ticker: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl border p-6"
      style={{
        background:
          "linear-gradient(150deg, #0c1308, var(--bunq-surface) 70%)",
        borderColor: "var(--bunq-border)",
      }}
    >
      {/* Bunq-style top stripe */}
      <div className="absolute inset-x-0 top-0 h-[3px] bg-[var(--bunq-green)]" />

      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
        <BunqMark />
        <span className="text-[var(--bunq-muted)]">
          your wallet · personal conviction · {ticker}
        </span>
        <DataProvenance kind="bunq_personal" />
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-[var(--bunq-muted)]">
            Spend at {ticker} venues · 12 months
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="bunq-numeral text-5xl font-black text-[var(--bunq-text)]">
              €{overlay.total_spent_12m_eur.toFixed(0)}
            </span>
            <span className={`text-3xl ${TREND_COLOR[overlay.trend]}`}>
              {TREND_ARROW[overlay.trend]}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[var(--bunq-faint)]">
            {overlay.visit_count} visits · last {overlay.last_visit}
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-[var(--bunq-muted)]">
            <Term term="conviction">conviction</Term>
          </div>
          <div className="bunq-numeral text-3xl font-black text-[var(--bunq-green)]">
            {Math.round(overlay.personal_conviction_score * 100)}
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-[var(--bunq-text)]/85">
        {overlay.summary}
      </p>
      {overlay.geo_signal && (
        <div className="mt-2 font-mono text-[11px] text-[var(--bunq-faint)]">
          geo · {overlay.geo_signal}
        </div>
      )}
    </div>
  );
}

/** Tiny inline mark riffing on Bunq's b-monogram. Decorative only. */
function BunqMark() {
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black"
      style={{
        background: "var(--bunq-green)",
        color: "#0a0d05",
      }}
      aria-hidden
    >
      b
    </span>
  );
}
