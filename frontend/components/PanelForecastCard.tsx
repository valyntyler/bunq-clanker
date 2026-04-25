import { PanelChart } from "@/components/PanelChart";
import type { ConsumerPanelForecast } from "@/lib/api";

const DIR_ARROW: Record<string, string> = {
  beat: "↑",
  "in-line": "→",
  miss: "↓",
};
const DIR_COLOR: Record<string, string> = {
  beat: "text-[var(--bunq-green)]",
  "in-line": "text-[var(--bunq-text)]",
  miss: "text-[var(--bunq-bad)]",
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
    <div
      className="rounded-3xl border p-6"
      style={{
        background:
          "linear-gradient(160deg, rgba(181,255,0,0.10), var(--bunq-surface))",
        borderColor: "var(--bunq-border)",
      }}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
        <span className="rounded-full bg-[var(--bunq-green-soft)] px-2 py-0.5">
          alt-data
        </span>
        <span className="text-[var(--bunq-muted)]">
          Bunq panel · {ticker}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-[var(--bunq-muted)]">
            Q+1 revenue forecast
          </div>
          <div
            className={`mt-1 bunq-numeral text-5xl font-black tracking-tight ${DIR_COLOR[dir]}`}
          >
            {DIR_ARROW[dir]} {forecast.next_quarter.vs_consensus_pct}
          </div>
          <div className="mt-1 text-[11px] text-[var(--bunq-faint)]">
            confidence · {Math.round(forecast.next_quarter.confidence * 100)}%
          </div>
        </div>

        <div className="text-right text-sm">
          <Stat
            label="YoY spend"
            value={`${forecast.yoy_change_pct >= 0 ? "+" : ""}${forecast.yoy_change_pct.toFixed(1)}%`}
            accent={forecast.yoy_change_pct >= 0}
          />
          <Stat
            label="QoQ spend"
            value={`${forecast.qoq_change_pct >= 0 ? "+" : ""}${forecast.qoq_change_pct.toFixed(1)}%`}
            accent={forecast.qoq_change_pct >= 0}
          />
          <Stat
            label="panel N"
            value={forecast.panel_size_n.toLocaleString()}
          />
          <Stat
            label="hist. corr."
            value={forecast.historical_correlation.toFixed(2)}
          />
        </div>
      </div>

      <div className="mt-5">
        <PanelChart ticker={ticker} />
      </div>

      {forecast.merchant_aliases && forecast.merchant_aliases.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1 font-mono text-[10px] text-[var(--bunq-faint)]">
          <span className="mr-1 opacity-60">matched:</span>
          {forecast.merchant_aliases.map((m) => (
            <span
              key={m}
              className="rounded-full px-2 py-0.5"
              style={{
                background: "var(--bunq-surface-2)",
                color: "var(--bunq-muted)",
              }}
            >
              {m}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 text-[11px] italic text-[var(--bunq-faint)]">
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
    <div className="mt-1 flex items-baseline justify-end gap-2">
      <span className="text-xs text-[var(--bunq-faint)]">{label}</span>
      <span
        className={`bunq-numeral font-mono font-bold ${
          accent === undefined
            ? "text-[var(--bunq-text)]"
            : accent
              ? "text-[var(--bunq-green)]"
              : "text-[var(--bunq-bad)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
