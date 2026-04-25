"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import { DataProvenance } from "@/components/DataProvenance";
import { Markdown } from "@/components/Markdown";
import {
  streamEarningsCall,
  type EarningsChunkScore,
  type EarningsStepEvent,
  type EarningsSummary,
} from "@/lib/api";

const STAGE_LABEL: Record<string, string> = {
  yt_dlp: "Downloading audio",
  upload_s3: "Uploading to S3",
  transcribe: "AWS Transcribe",
  scoring: "Claude scoring chunks",
  summary: "Final summary",
};

const TONE_PALETTE: Record<
  string,
  { fg: string; bg: string; border: string }
> = {
  confident: { fg: "var(--bunq-green)", bg: "rgba(181,255,0,0.10)", border: "rgba(181,255,0,0.30)" },
  bullish:   { fg: "var(--bunq-green)", bg: "rgba(181,255,0,0.10)", border: "rgba(181,255,0,0.30)" },
  hedging:   { fg: "var(--bunq-warn)",  bg: "rgba(255,183,77,0.10)", border: "rgba(255,183,77,0.30)" },
  defensive: { fg: "var(--bunq-warn)",  bg: "rgba(255,183,77,0.10)", border: "rgba(255,183,77,0.30)" },
  concerned: { fg: "var(--bunq-bad)",   bg: "rgba(255,91,107,0.10)", border: "rgba(255,91,107,0.30)" },
  neutral:   { fg: "var(--bunq-muted)", bg: "var(--bunq-surface-2)", border: "var(--bunq-border)" },
};

const SHIFT_COLOR: Record<string, string> = {
  "↑bullish": "var(--bunq-green)",
  "↓bearish": "var(--bunq-bad)",
  stable: "var(--bunq-muted)",
};

export function EarningsCopilotSection({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName: string;
}) {
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Record<string, EarningsStepEvent>>({});
  const [chunks, setChunks] = useState<EarningsChunkScore[]>([]);
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function start() {
    if (!url.trim() || running) return;
    setRunning(true);
    setError(null);
    setStages({});
    setChunks([]);
    setSummary(null);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await streamEarningsCall({
        url: url.trim(),
        ticker,
        companyName,
        signal: ac.signal,
        onStep: (ev) => setStages((prev) => ({ ...prev, [ev.step]: ev })),
        onChunk: (c) =>
          setChunks((prev) => {
            // De-dupe on index in case the stream re-emits.
            const next = prev.filter((x) => x.index !== c.index);
            next.push(c);
            next.sort((a, b) => a.index - b.index);
            return next;
          }),
        onSummary: (s) => setSummary(s),
        onDone: () => setRunning(false),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }

  const sentimentSeries = useMemo(
    () =>
      chunks.map((c) => ({
        index: c.index + 1,
        score: c.score,
      })),
    [chunks]
  );

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          Earnings-call co-pilot
        </h2>
        <DataProvenance kind="earnings_copilot" />
      </div>

      {!running && chunks.length === 0 && !summary && (
        <div
          className="rounded-3xl p-5"
          style={{
            background:
              "linear-gradient(160deg, rgba(181,255,0,0.06), var(--bunq-surface))",
            border: "1px solid rgba(181,255,0,0.18)",
          }}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
            paste a youtube url
          </div>
          <p className="mt-2 max-w-2xl text-sm text-[var(--bunq-muted)]">
            Drop the link to a recent {ticker} earnings call (or any
            earnings-call video on YouTube). We&apos;ll pull the audio, run
            AWS Transcribe over the whole thing, then stream Claude over the
            transcript chunk by chunk so you see tone shifts, hedging, and
            commitments appearing in real time.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              className="min-w-0 flex-1 rounded-full px-4 py-2 text-sm outline-none"
              style={{
                background: "var(--bunq-surface-2)",
                border: "1px solid var(--bunq-border-strong)",
                color: "var(--bunq-text)",
              }}
            />
            <button
              onClick={() => void start()}
              disabled={!url.trim()}
              className="bunq-glow rounded-full px-5 py-2 text-sm font-bold disabled:opacity-50"
              style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
            >
              Start co-pilot ↗
            </button>
          </div>
        </div>
      )}

      {(running || chunks.length > 0 || summary) && (
        <>
          <PipelineStatusRow
            stages={stages}
            running={running}
            onCancel={cancel}
          />
          {error && (
            <div
              className="mt-3 rounded-2xl px-3 py-2 text-sm"
              style={{
                background: "var(--bunq-bad-soft)",
                color: "var(--bunq-bad)",
              }}
            >
              {error}
            </div>
          )}

          {summary && <SummaryCard summary={summary} />}

          {chunks.length > 0 && (
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_280px]">
              <div className="min-w-0 space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
                  Live chunk stream · {chunks.length} scored
                </div>
                <ul className="space-y-2">
                  {chunks.map((c) => (
                    <ChunkRow key={c.index} c={c} />
                  ))}
                </ul>
              </div>
              <aside className="space-y-3">
                <SentimentTimeline series={sentimentSeries} />
                <ShiftList chunks={chunks} />
              </aside>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PipelineStatusRow({
  stages,
  running,
  onCancel,
}: {
  stages: Record<string, EarningsStepEvent>;
  running: boolean;
  onCancel: () => void;
}) {
  const order: EarningsStepEvent["step"][] = [
    "yt_dlp",
    "upload_s3",
    "transcribe",
    "scoring",
    "summary",
  ];
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
          {running ? "⟳ pipeline" : "✓ pipeline"}
        </div>
        {running && (
          <button
            onClick={onCancel}
            className="rounded-full px-3 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{
              background: "var(--bunq-surface-2)",
              color: "var(--bunq-muted)",
              border: "1px solid var(--bunq-border)",
            }}
          >
            cancel
          </button>
        )}
      </div>
      <div className="mt-2 grid gap-1 text-[11px]">
        {order.map((s) => (
          <StepLine key={s} step={s} ev={stages[s]} />
        ))}
      </div>
    </div>
  );
}

function StepLine({
  step,
  ev,
}: {
  step: EarningsStepEvent["step"];
  ev: EarningsStepEvent | undefined;
}) {
  const status = ev?.status;
  const glyph =
    status === "running"
      ? "⟳"
      : status === "done"
        ? "✓"
        : status === "error"
          ? "✗"
          : "○";
  const color =
    status === "done" || status === "running"
      ? "var(--bunq-green)"
      : status === "error"
        ? "var(--bunq-bad)"
        : "var(--bunq-faint)";
  let detail = "";
  const d = ev?.detail || {};
  if (typeof d.audio_mb === "number") detail = ` · ${d.audio_mb} MB`;
  if (typeof d.chars === "number") detail = ` · ${d.chars.toLocaleString()} chars`;
  if (typeof d.poll === "number" && d.status) detail = ` · poll ${d.poll} (${d.status})`;
  if (typeof d.chunk_index === "number" && typeof d.of === "number")
    detail = ` · chunk ${d.chunk_index + 1}/${d.of}`;
  if (typeof d.total_chunks === "number") detail = ` · ${d.total_chunks} chunks`;
  if (typeof d.message === "string") detail = ` · ${d.message}`;
  return (
    <div className="flex items-center gap-2 font-mono" style={{ color }}>
      <span className={status === "running" ? "animate-spin" : ""}>{glyph}</span>
      <span>{STAGE_LABEL[step] ?? step}{detail}</span>
    </div>
  );
}

function SummaryCard({ summary }: { summary: EarningsSummary }) {
  const tone = TONE_PALETTE[summary.tone_overall.toLowerCase()] ?? TONE_PALETTE.neutral;
  return (
    <div
      className="mt-4 rounded-3xl p-5"
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: tone.fg }}>
          ✓ overall · {summary.tone_overall}
        </div>
        <div className="bunq-numeral font-mono text-sm" style={{ color: tone.fg }}>
          score {summary.score_overall >= 0 ? "+" : ""}
          {summary.score_overall.toFixed(2)}
        </div>
      </div>
      <Markdown
        text={summary.headline}
        className="mt-2 text-sm leading-relaxed text-[var(--bunq-text)]/90"
      />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <FlagBlock
          title="Top commitments"
          items={summary.top_commitments}
          tone="good"
        />
        <FlagBlock
          title="Top concerns / hedges"
          items={summary.top_concerns}
          tone="bad"
        />
      </div>
      {summary.key_shifts.length > 0 && (
        <div className="mt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            tone shifts
          </div>
          <ul className="mt-1 space-y-1 text-[12px] text-[var(--bunq-text)]/85">
            {summary.key_shifts.map((s, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="opacity-60">·</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FlagBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "good" | "bad";
}) {
  if (items.length === 0) return null;
  const palette =
    tone === "good"
      ? {
          bg: "rgba(181,255,0,0.06)",
          border: "rgba(181,255,0,0.22)",
          fg: "var(--bunq-green)",
        }
      : {
          bg: "rgba(255,91,107,0.06)",
          border: "rgba(255,91,107,0.22)",
          fg: "var(--bunq-bad)",
        };
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: palette.bg, border: `1px solid ${palette.border}` }}
    >
      <div
        className="font-mono text-[9px] uppercase tracking-[0.18em]"
        style={{ color: palette.fg }}
      >
        {title}
      </div>
      <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-[var(--bunq-text)]/85">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="opacity-60">·</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChunkRow({ c }: { c: EarningsChunkScore }) {
  const palette = TONE_PALETTE[c.tone.toLowerCase()] ?? TONE_PALETTE.neutral;
  return (
    <li
      className="rounded-2xl p-3"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
          <span style={{ color: palette.fg }}>chunk #{c.index + 1}</span>
          <span style={{ color: palette.fg }}>· {c.tone}</span>
          {c.shift && c.shift !== "stable" && (
            <span
              className="rounded-full px-2 py-0.5 font-bold"
              style={{
                background: "var(--bunq-surface)",
                color: SHIFT_COLOR[c.shift] ?? "var(--bunq-text)",
                border: `1px solid ${SHIFT_COLOR[c.shift] ?? "var(--bunq-border)"}`,
              }}
            >
              {c.shift}
            </span>
          )}
          {c.key_topics.map((t) => (
            <span
              key={t}
              className="rounded-full px-1.5 py-0 font-mono text-[9px] uppercase tracking-[0.16em]"
              style={{
                background: "var(--bunq-surface)",
                color: "var(--bunq-muted)",
                border: "1px solid var(--bunq-border)",
              }}
            >
              {t}
            </span>
          ))}
        </div>
        <span
          className="bunq-numeral font-mono text-[11px]"
          style={{ color: palette.fg }}
        >
          {c.score >= 0 ? "+" : ""}
          {c.score.toFixed(2)}
        </span>
      </div>
      {c.shift_reason && (
        <p className="mt-1 text-[12px] italic text-[var(--bunq-text)]/85">
          {c.shift_reason}
        </p>
      )}
      <p className="mt-2 text-[12px] leading-snug text-[var(--bunq-text)]/85">
        {c.text.length > 320 ? c.text.slice(0, 320).trimEnd() + "…" : c.text}
      </p>
      {(c.hedging.length > 0 || c.commitments.length > 0) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {c.commitments.length > 0 && (
            <FlagBlock
              title="commitments"
              items={c.commitments}
              tone="good"
            />
          )}
          {c.hedging.length > 0 && (
            <FlagBlock title="hedging" items={c.hedging} tone="bad" />
          )}
        </div>
      )}
    </li>
  );
}

function SentimentTimeline({
  series,
}: {
  series: { index: number; score: number }[];
}) {
  return (
    <div
      className="rounded-2xl p-3"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        Sentiment timeline
      </div>
      <div className="mt-2 h-24">
        <ResponsiveContainer>
          <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="ec-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(181,255,0,0.55)" />
                <stop offset="100%" stopColor="rgba(181,255,0,0)" />
              </linearGradient>
            </defs>
            <YAxis domain={[-1, 1]} hide />
            <Tooltip
              contentStyle={{
                background: "var(--bunq-surface)",
                border: "1px solid var(--bunq-border-strong)",
                borderRadius: 8,
                fontSize: 11,
                padding: "4px 6px",
              }}
              labelFormatter={(v) => `chunk ${v}`}
              formatter={(value) => [Number(value).toFixed(2), "score"]}
            />
            <Area
              type="monotone"
              dataKey="score"
              stroke="var(--bunq-green)"
              strokeWidth={1.5}
              fill="url(#ec-grad)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ShiftList({ chunks }: { chunks: EarningsChunkScore[] }) {
  const shifts = chunks.filter((c) => c.shift && c.shift !== "stable");
  if (shifts.length === 0) return null;
  return (
    <div
      className="rounded-2xl p-3"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        Tone shifts
      </div>
      <ul className="mt-2 space-y-1.5 text-[11px]">
        {shifts.map((c) => (
          <li key={c.index} className="flex gap-2">
            <span
              className="bunq-numeral shrink-0 font-mono"
              style={{
                color: SHIFT_COLOR[c.shift] ?? "var(--bunq-text)",
              }}
            >
              #{c.index + 1} {c.shift}
            </span>
            <span className="text-[var(--bunq-text)]/85">
              {c.shift_reason || "(reason unspecified)"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
