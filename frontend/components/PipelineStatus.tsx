"use client";

/**
 * Per-module pipeline status grid. Each of the six analyzer tracks gets a
 * card that walks pending → running (animated) → done (with score) → error.
 *
 * Driven entirely by the SSE events the backend already emits — no extra
 * round-trips needed.
 */

export type ModuleState =
  | { status: "pending"; label: string; desc: string }
  | { status: "running"; label: string; desc: string; startedAt: number }
  | {
      status: "done";
      label: string;
      desc: string;
      elapsedMs: number;
      score?: number;
      summary?: string;
    }
  | { status: "error"; label: string; desc: string; error: string };

export type PipelineState = Record<string, ModuleState>;

export const MODULE_ORDER: { name: string; label: string; desc: string }[] = [
  {
    name: "fundamentals",
    label: "Fundamentals",
    desc: "yfinance financials → red/green flags",
  },
  {
    name: "news",
    label: "News",
    desc: "30d Google News → sentiment + events",
  },
  {
    name: "chart",
    label: "Chart vision",
    desc: "1y candlestick → Claude vision",
  },
  {
    name: "panel",
    label: "Bunq panel",
    desc: "aggregated spend → Q+1 forecast",
  },
  {
    name: "bunq_spending",
    label: "Your wallet",
    desc: "personal spending → conviction",
  },
  {
    name: "geopolitical",
    label: "Geopolitical",
    desc: "RSS + clip library → overlays",
  },
];

export function emptyPipelineState(): PipelineState {
  const out: PipelineState = {};
  for (const m of MODULE_ORDER) {
    out[m.name] = { status: "pending", label: m.label, desc: m.desc };
  }
  return out;
}

export function PipelineStatus({
  pipeline,
  synthesizing,
}: {
  pipeline: PipelineState;
  synthesizing: boolean;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        Pipeline
        {synthesizing && (
          <span
            className="rounded-full px-2 py-0.5 text-[9px] font-bold"
            style={{
              background: "var(--bunq-green-soft)",
              color: "var(--bunq-green)",
            }}
          >
            ⟳ synthesizing
          </span>
        )}
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {MODULE_ORDER.map((m) => (
          <ModuleCard key={m.name} state={pipeline[m.name]} />
        ))}
      </div>
    </section>
  );
}

function ModuleCard({ state }: { state: ModuleState | undefined }) {
  if (!state) return null;
  const palette = STATE_COLOR[state.status];
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-3 transition"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      {/* Top stripe — animated when running, solid when done */}
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{
          background: palette.stripe,
        }}
      >
        {state.status === "running" && (
          <div
            className="h-full w-1/3 animate-[slide_1.2s_linear_infinite]"
            style={{ background: "var(--bunq-green)" }}
          />
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{ color: palette.label }}
          >
            <StatusGlyph status={state.status} />
            <span>{state.label}</span>
          </div>
          <div className="mt-1 truncate text-[11px] text-[var(--bunq-muted)]">
            {state.desc}
          </div>
        </div>
        {state.status === "done" && state.score !== undefined && (
          <ScoreChip score={state.score} />
        )}
        {state.status === "done" && state.score === undefined && (
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{
              background: "var(--bunq-surface-2)",
              color: "var(--bunq-faint)",
              border: "1px solid var(--bunq-border)",
            }}
          >
            no coverage
          </span>
        )}
      </div>

      {state.status === "running" && (
        <div className="mt-2 font-mono text-[10px] text-[var(--bunq-green)]">
          analyzing…
        </div>
      )}
      {state.status === "done" && (
        <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-[var(--bunq-faint)]">
          <span>{(state.elapsedMs / 1000).toFixed(1)}s</span>
        </div>
      )}
      {state.status === "error" && (
        <div className="mt-2 text-[11px] text-[var(--bunq-bad)]">
          {state.error}
        </div>
      )}

      <style jsx>{`
        @keyframes slide {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(400%);
          }
        }
      `}</style>
    </div>
  );
}

const STATE_COLOR: Record<
  ModuleState["status"],
  { bg: string; border: string; stripe: string; label: string }
> = {
  pending: {
    bg: "var(--bunq-surface)",
    border: "var(--bunq-border)",
    stripe: "var(--bunq-border)",
    label: "var(--bunq-faint)",
  },
  running: {
    bg: "linear-gradient(160deg, rgba(181,255,0,0.08), var(--bunq-surface))",
    border: "rgba(181,255,0,0.30)",
    stripe: "var(--bunq-surface-2)",
    label: "var(--bunq-green)",
  },
  done: {
    bg: "var(--bunq-surface)",
    border: "rgba(181,255,0,0.18)",
    stripe: "var(--bunq-green)",
    label: "var(--bunq-text)",
  },
  error: {
    bg: "var(--bunq-bad-soft)",
    border: "rgba(255,91,107,0.30)",
    stripe: "var(--bunq-bad)",
    label: "var(--bunq-bad)",
  },
};

function StatusGlyph({ status }: { status: ModuleState["status"] }) {
  if (status === "pending")
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: "var(--bunq-border-strong)" }}
      />
    );
  if (status === "running")
    return (
      <span
        className="inline-block h-2.5 w-2.5 animate-pulse rounded-full"
        style={{ background: "var(--bunq-green)" }}
      />
    );
  if (status === "done")
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: "var(--bunq-green)" }}
      />
    );
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: "var(--bunq-bad)" }}
    />
  );
}

function ScoreChip({ score }: { score: number }) {
  const color =
    score >= 0.3
      ? "var(--bunq-green)"
      : score <= -0.3
        ? "var(--bunq-bad)"
        : "var(--bunq-warn)";
  return (
    <span
      className="bunq-numeral rounded-full px-2 py-0.5 font-mono text-[10px] font-bold"
      style={{
        background: "var(--bunq-surface-2)",
        color,
      }}
    >
      {score >= 0 ? "+" : ""}
      {score.toFixed(2)}
    </span>
  );
}
