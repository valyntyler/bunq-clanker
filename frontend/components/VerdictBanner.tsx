import type React from "react";
import { DataProvenance } from "@/components/DataProvenance";
import { Term } from "@/components/Glossary";
import type { Report } from "@/lib/api";

/**
 * The synthesizer cites modules inline as `[module]` or `[module:event-id]`.
 * We render each match as a small inline chip — module name visible, the
 * verbose event-id moved into a `title` tooltip so it doesn't blow out the
 * layout. Plain `[some text]` that doesn't match a known module is left as-is.
 */
const CITATION_RE = /\[([a-z_]+)(?::([^\]]+))?\]/g;
const KNOWN_MODULES = new Set([
  "fundamentals",
  "news",
  "chart",
  "website",
  "earnings_call",
  "leadership",
  "panel",
  "consumer_panel",
  "bunq_spending",
  "geopolitical",
  "user",
]);

function renderWithCitations(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(CITATION_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const mod = m[1];
    const evt = m[2];
    if (KNOWN_MODULES.has(mod)) {
      out.push(<CitationChip key={`c-${i++}`} module={mod} eventId={evt} />);
    } else {
      out.push(m[0]);
    }
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CitationChip({ module, eventId }: { module: string; eventId?: string }) {
  return (
    <span
      title={eventId ? `${module} · ${eventId}` : module}
      className="mx-0.5 inline-flex items-center rounded-full px-1.5 py-0 align-baseline font-mono text-[9px] uppercase tracking-[0.14em]"
      style={{
        background: "rgba(0,0,0,0.18)",
        border: "1px solid rgba(0,0,0,0.18)",
      }}
    >
      {module.replace(/_/g, " ")}
      {eventId && (
        <span className="ml-1 max-w-[80px] truncate opacity-70">
          {eventId.split("-").slice(0, 2).join("-")}
        </span>
      )}
    </span>
  );
}

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
            {renderWithCitations(report.one_liner)}
          </p>
          <div className="mt-3">
            <DataProvenance kind="verdict" />
          </div>
        </div>

        <div className="shrink-0 text-right text-[12px]">
          <div className={`rounded-full px-3 py-1 font-mono ${s.chip}`}>
            <Term term="confidence">
              <span className="opacity-70">conf </span>
              <span className="bunq-numeral font-bold">
                {Math.round(report.confidence * 100)}%
              </span>
            </Term>
          </div>
          <div className={`mt-2 rounded-full px-3 py-1 font-mono ${s.chip}`}>
            <Term term="position_size">
              <span className="opacity-70">size </span>
              <span className="bunq-numeral font-bold">
                {report.position_size_pct.toFixed(1)}%
              </span>
            </Term>
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
