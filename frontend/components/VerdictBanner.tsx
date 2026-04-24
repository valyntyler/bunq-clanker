import type { Report } from "@/lib/api";

const COLOR: Record<Report["verdict"], string> = {
  BUY: "bg-emerald-600",
  HOLD: "bg-amber-600",
  AVOID: "bg-rose-600",
};

const DIR_ARROW: Record<string, string> = {
  beat: "↑",
  "in-line": "→",
  miss: "↓",
};

export function VerdictBanner({ report }: { report: Report }) {
  const fx = report.consumer_panel_forecast;
  return (
    <div
      className={`rounded-xl p-6 ${COLOR[report.verdict]} text-white shadow-xl`}
    >
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="text-sm uppercase tracking-wider opacity-80">
            {report.company_name} ({report.ticker})
          </div>
          <div className="mt-1 text-5xl font-black tracking-tight">
            {report.verdict}
          </div>
          <div className="mt-3 max-w-2xl text-sm opacity-95">
            {report.one_liner}
          </div>
        </div>
        <div className="text-right text-sm">
          <div>
            <span className="opacity-70">confidence</span>{" "}
            <span className="font-mono font-bold">
              {Math.round(report.confidence * 100)}%
            </span>
          </div>
          <div>
            <span className="opacity-70">position</span>{" "}
            <span className="font-mono font-bold">
              {report.position_size_pct.toFixed(1)}%
            </span>
          </div>
          {fx && (
            <div className="mt-3 rounded-md bg-black/20 px-3 py-2">
              <div className="text-xs uppercase tracking-wider opacity-80">
                Q+1 revenue
              </div>
              <div className="text-2xl font-bold">
                {DIR_ARROW[fx.next_quarter.revenue_direction] ?? ""}{" "}
                {fx.next_quarter.vs_consensus_pct}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
