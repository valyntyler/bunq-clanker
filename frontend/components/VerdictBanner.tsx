import type { Report } from "@/lib/api";

const SCHEMES: Record<
  Report["verdict"],
  { bg: string; text: string; chip: string; ring: string; arrow: string }
> = {
  BUY: {
    bg: "bg-[var(--bunq-green)] text-[#0a0d05]",
    text: "text-[#0a0d05]",
    chip: "bg-black/20 text-[#0a0d05]",
    ring: "ring-[var(--bunq-green)]",
    arrow: "↑",
  },
  HOLD: {
    bg: "bg-[var(--bunq-warn)] text-[#1d1503]",
    text: "text-[#1d1503]",
    chip: "bg-black/20 text-[#1d1503]",
    ring: "ring-[var(--bunq-warn)]",
    arrow: "→",
  },
  AVOID: {
    bg: "bg-[var(--bunq-bad)] text-[#150406]",
    text: "text-[#150406]",
    chip: "bg-black/20 text-[#150406]",
    ring: "ring-[var(--bunq-bad)]",
    arrow: "↓",
  },
};

const DIR_ARROW: Record<string, string> = {
  beat: "↑",
  "in-line": "→",
  miss: "↓",
};

export function VerdictBanner({ report }: { report: Report }) {
  const fx = report.consumer_panel_forecast;
  const s = SCHEMES[report.verdict];

  return (
    <div
      className={`rounded-3xl ${s.bg} p-7 shadow-[0_18px_60px_-20px_rgba(0,0,0,0.6)]`}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">
            {report.company_name} · {report.ticker}
          </div>
          <div className="mt-1 bunq-numeral text-[64px] font-black leading-none">
            {report.verdict}
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed opacity-90">
            {report.one_liner}
          </p>
        </div>

        <div className="shrink-0 text-right text-[12px]">
          <div className={`rounded-full px-3 py-1 font-mono ${s.chip}`}>
            <span className="opacity-70">conf </span>
            <span className="bunq-numeral font-bold">
              {Math.round(report.confidence * 100)}%
            </span>
          </div>
          <div className={`mt-2 rounded-full px-3 py-1 font-mono ${s.chip}`}>
            <span className="opacity-70">size </span>
            <span className="bunq-numeral font-bold">
              {report.position_size_pct.toFixed(1)}%
            </span>
          </div>

          {fx && (
            <div className="mt-4 rounded-2xl bg-black/20 px-4 py-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] opacity-70">
                Q+1 revenue
              </div>
              <div className="mt-1 bunq-numeral text-2xl font-bold">
                {DIR_ARROW[fx.next_quarter.revenue_direction] ?? "·"}{" "}
                {fx.next_quarter.vs_consensus_pct}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
