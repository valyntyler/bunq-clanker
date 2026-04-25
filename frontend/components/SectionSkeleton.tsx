"use client";

/**
 * Loading-state placeholders for every report surface.
 *
 * These are kept deliberately verbose: when an analysis is in flight the
 * user sees a shimmering card in the exact position the real one will land,
 * with a clear "rendering · X" label so it's obvious which module is still
 * working. No mystery blank space, no premature emptiness.
 */

type Status = "pending" | "running" | "error";

const HEAD_GLYPH: Record<Status, string> = {
  pending: "○",
  running: "⟳",
  error: "✗",
};

const HEAD_COLOR: Record<Status, string> = {
  pending: "var(--bunq-faint)",
  running: "var(--bunq-green)",
  error: "var(--bunq-bad)",
};

function Header({
  status,
  label,
  detail,
}: {
  status: Status;
  label: string;
  detail?: string;
}) {
  const color = HEAD_COLOR[status];
  return (
    <div
      className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]"
      style={{ color }}
    >
      <span className={status === "running" ? "animate-spin" : ""}>
        {HEAD_GLYPH[status]}
      </span>
      <span>
        {status === "running" ? "rendering" : status} · {label}
      </span>
      {detail && (
        <span className="font-normal lowercase tracking-normal text-[var(--bunq-muted)]">
          · {detail}
        </span>
      )}
    </div>
  );
}

/** Big top-of-page banner skeleton, mirrors VerdictBanner. */
export function VerdictSkeleton({ ticker }: { ticker: string }) {
  return (
    <div
      className="rounded-3xl p-7"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <Header
        status="running"
        label="verdict"
        detail={`synthesising for ${ticker}`}
      />
      <div className="mt-3 flex items-baseline justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="bunq-skeleton h-4 w-40 rounded-full" />
          <div className="bunq-skeleton h-12 w-56 rounded-2xl" />
          <div className="bunq-skeleton h-3 w-full max-w-2xl rounded-full" />
          <div className="bunq-skeleton h-3 w-3/4 max-w-xl rounded-full" />
        </div>
        <div className="hidden flex-col gap-2 md:flex">
          <div className="bunq-skeleton h-7 w-24 rounded-full" />
          <div className="bunq-skeleton h-7 w-24 rounded-full" />
          <div className="bunq-skeleton mt-2 h-16 w-32 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

/** Skeleton for the panel-forecast / bunq-spending row. */
export function CardSkeleton({
  title,
  status = "running",
  height = 220,
}: {
  title: string;
  status?: Status;
  height?: number;
}) {
  return (
    <div
      className="rounded-3xl p-5"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
        minHeight: height,
      }}
    >
      <Header status={status} label={title} />
      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="bunq-skeleton h-3 w-24 rounded-full" />
          <div className="bunq-skeleton h-10 w-44 rounded-xl" />
          <div className="bunq-skeleton h-3 w-32 rounded-full" />
        </div>
        <div className="hidden w-40 space-y-1.5 md:block">
          <div className="bunq-skeleton h-3 w-full rounded-full" />
          <div className="bunq-skeleton h-3 w-3/4 rounded-full" />
          <div className="bunq-skeleton h-3 w-2/3 rounded-full" />
          <div className="bunq-skeleton h-3 w-4/5 rounded-full" />
        </div>
      </div>
      <div className="bunq-skeleton mt-5 h-24 w-full rounded-xl" />
    </div>
  );
}

/** Per-module analyzer card skeleton — matches SectionCard layout. */
export function ModuleSkeleton({
  name,
  status,
  desc,
}: {
  name: string;
  status: "pending" | "running" | "error";
  desc?: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: "var(--bunq-surface)",
        border: `1px solid ${status === "running" ? "rgba(181,255,0,0.20)" : "var(--bunq-border)"}`,
      }}
    >
      <div className="p-5">
        <Header status={status} label={name.replace(/_/g, " ")} detail={desc} />
        <div className="mt-3 space-y-2">
          <div className="bunq-skeleton h-3 w-5/6 rounded-full" />
          <div className="bunq-skeleton h-3 w-4/5 rounded-full" />
          <div className="bunq-skeleton h-3 w-3/4 rounded-full" />
        </div>
        <div className="mt-4 flex gap-1.5">
          <div className="bunq-skeleton h-5 w-16 rounded-full" />
          <div className="bunq-skeleton h-5 w-20 rounded-full" />
          <div className="bunq-skeleton h-5 w-14 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** Compact strip used inline above sections that haven't started yet — a
 *  reassurance that the request is in flight even before the first event
 *  lands. */
export function PendingStrip({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
        color: "var(--bunq-faint)",
        width: "fit-content",
      }}
    >
      <span className="animate-pulse" style={{ color: "var(--bunq-green)" }}>
        ●
      </span>
      <span>rendering · {label}</span>
    </div>
  );
}
