"use client";

import { useState } from "react";
import {
  ingestUrlStream,
  searchClips,
  type UploadStepEvent,
  type UserSource,
  type YouTubeSearchResult,
} from "@/lib/api";

const SUGGESTIONS_FOR = (companyName: string): string[] => [
  `${companyName} earnings call`,
  `${companyName} CEO interview`,
  "ECB Lagarde monetary policy",
  "Trump tariffs statement",
  "EU Commission AI Act",
  "Federal Reserve FOMC press conference",
];

const STAGE_LABEL: Record<string, string> = {
  yt_dlp: "Downloading clip",
  upload: "Uploading to S3",
  audio_extract: "Extracting audio",
  prosody: "Computing prosody",
  frame_grid: "Sampling 9 frames",
  transcribe: "Transcribing (AWS)",
  vision_claude: "Multimodal Claude analysis",
};

export function LiveClipSearch({
  ticker,
  companyName,
  onIngested,
}: {
  ticker: string;
  companyName?: string;
  onIngested?: (src: UserSource) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Per-result analyze state. errors and "done" markers keyed by id so a
  // failed ingest leaves a visible error and a successful one shows "Added".
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stages, setStages] = useState<Record<string, UploadStepEvent>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [doneIds, setDoneIds] = useState<Record<string, true>>({});

  const suggestions = SUGGESTIONS_FOR(companyName || ticker);

  async function run(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const r = await searchClips(q, 10);
      setResults(r.results);
      setQuery(r.query);
    } catch (e) {
      setError((e as Error).message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function ingest(r: YouTubeSearchResult) {
    if (activeId) return;
    setActiveId(r.id);
    setStages({});
    setErrors((prev) => {
      const { [r.id]: _drop, ...rest } = prev;
      return rest;
    });
    try {
      const src = await ingestUrlStream({
        url: r.url,
        ticker,
        companyName,
        startS: 0,
        durationS: Math.min(r.duration_s ?? 60, 90),
        userNote: `Ingested live YouTube result: ${r.title}`,
        userTag: "neutral",
        onStep: (ev) =>
          setStages((prev) => ({ ...prev, [ev.step]: ev })),
      });
      onIngested?.(src);
      setDoneIds((prev) => ({ ...prev, [r.id]: true }));
    } catch (e) {
      setErrors((prev) => ({ ...prev, [r.id]: (e as Error).message }));
    } finally {
      setActiveId(null);
    }
  }

  return (
    <section>
      <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        Live YouTube search
      </h2>
      <div
        className="rounded-2xl p-4"
        style={{
          background: "var(--bunq-surface)",
          border: "1px solid var(--bunq-border)",
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(query);
          }}
          className="flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search YouTube for clips about ${companyName || ticker}…`}
            className="flex-1 rounded-full px-4 py-2 text-sm outline-none"
            style={{
              background: "var(--bunq-surface-2)",
              border: "1px solid var(--bunq-border-strong)",
              color: "var(--bunq-text)",
            }}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="bunq-glow rounded-full px-5 text-sm font-bold disabled:opacity-50"
            style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
          >
            {loading ? "…" : "Search"}
          </button>
        </form>

        {!searched && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setQuery(s);
                  void run(s);
                }}
                className="rounded-full px-3 py-1 font-mono text-[11px]"
                style={{
                  background: "var(--bunq-surface-2)",
                  border: "1px solid var(--bunq-border)",
                  color: "var(--bunq-muted)",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div
            className="mt-3 rounded-xl p-2 text-xs"
            style={{
              background: "var(--bunq-bad-soft)",
              color: "var(--bunq-bad)",
            }}
          >
            {error}
          </div>
        )}

        {searched && !loading && results.length === 0 && !error && (
          <div className="mt-3 text-[11px] text-[var(--bunq-faint)]">
            No results.
          </div>
        )}

        {results.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((r) => (
              <ResultCard
                key={r.id}
                r={r}
                isActive={activeId === r.id}
                stages={activeId === r.id ? stages : {}}
                disabled={activeId !== null && activeId !== r.id}
                error={errors[r.id] ?? null}
                done={doneIds[r.id] === true}
                onAnalyze={() => void ingest(r)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ResultCard({
  r,
  isActive,
  stages,
  disabled,
  error,
  done,
  onAnalyze,
}: {
  r: YouTubeSearchResult;
  isActive: boolean;
  stages: Record<string, UploadStepEvent>;
  disabled: boolean;
  error: string | null;
  done: boolean;
  onAnalyze: () => void;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: "var(--bunq-surface-2)",
        border: `1px solid ${isActive ? "rgba(181,255,0,0.30)" : "var(--bunq-border)"}`,
      }}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {r.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.thumbnail}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-[10px] text-[var(--bunq-faint)]">
            no thumbnail
          </div>
        )}
        {r.duration_s && (
          <span
            className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 font-mono text-[10px]"
            style={{ color: "var(--bunq-text)" }}
          >
            {Math.floor(r.duration_s / 60)}:
            {String(r.duration_s % 60).padStart(2, "0")}
          </span>
        )}
      </div>
      <div className="p-3">
        <div className="line-clamp-2 text-xs font-bold text-[var(--bunq-text)]">
          {r.title}
        </div>
        <div className="mt-1 truncate font-mono text-[10px] text-[var(--bunq-faint)]">
          {r.channel}
          {r.upload_date
            ? ` · ${r.upload_date.slice(0, 4)}-${r.upload_date.slice(4, 6)}-${r.upload_date.slice(6, 8)}`
            : ""}
          {r.view_count
            ? ` · ${(r.view_count / 1000).toFixed(0)}k views`
            : ""}
        </div>

        {!isActive && (
          <>
            <div className="mt-2 flex gap-2">
              <button
                onClick={onAnalyze}
                disabled={disabled || done}
                className="flex-1 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-40"
                style={
                  done
                    ? {
                        background: "var(--bunq-surface)",
                        color: "var(--bunq-green)",
                        border: "1px solid rgba(181,255,0,0.30)",
                      }
                    : {
                        background: "var(--bunq-green-soft)",
                        color: "var(--bunq-green)",
                        border: "1px solid rgba(181,255,0,0.30)",
                      }
                }
              >
                {done ? "Added ✓" : error ? "Retry" : "Analyze"}
              </button>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                style={{
                  background: "var(--bunq-surface)",
                  color: "var(--bunq-muted)",
                  border: "1px solid var(--bunq-border)",
                }}
              >
                YouTube ↗
              </a>
            </div>
            {error && (
              <div
                className="mt-2 rounded-md px-2 py-1 text-[10px] leading-snug"
                style={{
                  background: "var(--bunq-bad-soft)",
                  color: "var(--bunq-bad)",
                }}
              >
                {error}
              </div>
            )}
          </>
        )}

        {isActive && (
          <div className="mt-2 space-y-0.5">
            {[
              "yt_dlp",
              "upload",
              "audio_extract",
              "prosody",
              "frame_grid",
              "transcribe",
              "vision_claude",
            ].map((step) => {
              const ev = stages[step];
              const status = ev?.status;
              const glyph =
                status === "running"
                  ? "⟳"
                  : status === "done"
                    ? "✓"
                    : status === "skipped"
                      ? "·"
                      : status === "error"
                        ? "✗"
                        : "○";
              return (
                <div
                  key={step}
                  className="flex items-center gap-1.5 font-mono text-[10px]"
                  style={{
                    color:
                      status === "done" || status === "running"
                        ? "var(--bunq-green)"
                        : "var(--bunq-faint)",
                  }}
                >
                  <span
                    className={status === "running" ? "animate-spin" : ""}
                  >
                    {glyph}
                  </span>
                  <span className="opacity-90">{STAGE_LABEL[step] ?? step}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
