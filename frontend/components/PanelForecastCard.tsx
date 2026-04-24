import type { ConsumerPanelForecast } from "@/lib/api";

const DIR_ARROW: Record<string, string> = {
  beat: "↑",
  "in-line": "→",
  miss: "↓",
};
const DIR_COLOR: Record<string, string> = {
  beat: "text-emerald-400",
  "in-line": "text-zinc-300",
  miss: "text-rose-400",
};

export function PanelForecastCard({
  forecast,
  ticker,
}: {
  forecast: ConsumerPanelForecast;
  ticker: string;
}) {
  const dir = forecast.next_quarter.revenue_direction;
  return (
    <div className="rounded-xl border border-sky-800/50 bg-gradient-to-br from-sky-950/80 to-zinc-950 p-6 shadow-2xl">
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-sky-300">
        <span className="rounded bg-sky-900/60 px-2 py-0.5">alt-data</span>
        <span>Bunq consumer panel · {ticker}</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <div className="text-sm text-zinc-400">Q+1 revenue forecast</div>
          <div
            className={`mt-1 text-5xl font-black tracking-tight ${DIR_COLOR[dir]}`}
          >
            {DIR_ARROW[dir]} {forecast.next_quarter.vs_consensus_pct}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            confidence {Math.round(forecast.next_quarter.confidence * 100)}%
          </div>
        </div>
        <div className="text-right text-sm">
          <Stat label="YoY spend" value={`${forecast.yoy_change_pct.toFixed(1)}%`} accent={forecast.yoy_change_pct >= 0} />
          <Stat label="QoQ spend" value={`${forecast.qoq_change_pct.toFixed(1)}%`} accent={forecast.qoq_change_pct >= 0} />
          <Stat label="panel N" value={forecast.panel_size_n.toLocaleString()} />
          <Stat
            label="hist. correlation"
            value={forecast.historical_correlation.toFixed(2)}
          />
        </div>
      </div>
      {forecast.merchant_aliases && forecast.merchant_aliases.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1 text-[10px] font-mono text-zinc-500">
          <span className="mr-1 text-zinc-600">matched:</span>
          {forecast.merchant_aliases.map((m) => (
            <span key={m} className="rounded bg-zinc-800 px-1.5 py-0.5">
              {m}
            </span>
          ))}
        </div>
      )}
      <div className="mt-4 text-[11px] text-zinc-500 italic">
        {forecast.disclaimer}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="mt-1">
      <span className="text-zinc-500">{label} </span>
      <span
        className={`font-mono font-bold ${
          accent === undefined
            ? "text-zinc-200"
            : accent
              ? "text-emerald-400"
              : "text-rose-400"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
