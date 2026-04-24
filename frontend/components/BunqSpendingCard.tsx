import type { BunqSpendingOverlay } from "@/lib/api";

const TREND_ARROW = {
  accelerating: "↗",
  flat: "→",
  declining: "↘",
} as const;
const TREND_COLOR = {
  accelerating: "text-emerald-400",
  flat: "text-zinc-300",
  declining: "text-rose-400",
} as const;

export function BunqSpendingCard({
  overlay,
  ticker,
}: {
  overlay: BunqSpendingOverlay;
  ticker: string;
}) {
  return (
    <div className="rounded-xl border border-fuchsia-900/50 bg-gradient-to-br from-fuchsia-950/60 to-zinc-950 p-6">
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-fuchsia-300">
        <span className="rounded bg-fuchsia-900/60 px-2 py-0.5">your bunq</span>
        <span>personal conviction · {ticker}</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <div className="text-sm text-zinc-400">12-month spend</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-black tracking-tight text-zinc-100">
              €{overlay.total_spent_12m_eur.toFixed(0)}
            </span>
            <span className={`text-2xl ${TREND_COLOR[overlay.trend]}`}>
              {TREND_ARROW[overlay.trend]}
            </span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {overlay.visit_count} visits · last {overlay.last_visit}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-zinc-400">conviction</div>
          <div className="text-3xl font-bold text-fuchsia-300">
            {Math.round(overlay.personal_conviction_score * 100)}
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm text-zinc-300">{overlay.summary}</p>
      {overlay.geo_signal && (
        <div className="mt-2 text-[11px] font-mono text-zinc-500">
          geo: {overlay.geo_signal}
        </div>
      )}
    </div>
  );
}
