"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Markdown } from "@/components/Markdown";
import { UserSourcePreview } from "@/components/SourcePreview";
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
  // Map result-id → the resulting UserSource so the "Added" button becomes
  // a hover preview and click-to-expand surface for that clip's analysis.
  const [doneSources, setDoneSources] = useState<Record<string, UserSource>>({});
  const [previewSrc, setPreviewSrc] = useState<UserSource | null>(null);

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
      setDoneSources((prev) => ({ ...prev, [r.id]: src }));
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
                doneSrc={doneSources[r.id] ?? null}
                onAnalyze={() => void ingest(r)}
                onOpen={(src) => setPreviewSrc(src)}
              />
            ))}
          </div>
        )}
      </div>
      <UserSourcePreview
        source={previewSrc}
        open={previewSrc !== null}
        onClose={() => setPreviewSrc(null)}
      />
    </section>
  );
}

function ResultCard({
  r,
  isActive,
  stages,
  disabled,
  error,
  doneSrc,
  onAnalyze,
  onOpen,
}: {
  r: YouTubeSearchResult;
  isActive: boolean;
  stages: Record<string, UploadStepEvent>;
  disabled: boolean;
  error: string | null;
  doneSrc: UserSource | null;
  onAnalyze: () => void;
  onOpen: (src: UserSource) => void;
}) {
  const done = doneSrc !== null;
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
              {done && doneSrc ? (
                <AnalyzedButton src={doneSrc} onOpen={onOpen} />
              ) : (
                <button
                  onClick={onAnalyze}
                  disabled={disabled}
                  className="flex-1 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-40"
                  style={{
                    background: "var(--bunq-green-soft)",
                    color: "var(--bunq-green)",
                    border: "1px solid rgba(181,255,0,0.30)",
                  }}
                >
                  {error ? "Retry" : "Analyze"}
                </button>
              )}
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

function AnalyzedButton({
  src,
  onOpen,
}: {
  src: UserSource;
  onOpen: (src: UserSource) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!hovered || !ref.current) {
      setPos(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    const W = 340;
    const H = 260; // approximate
    const margin = 12;
    const left = Math.max(
      margin,
      Math.min(window.innerWidth - W - margin, rect.left)
    );
    const placeAbove = rect.bottom + H + 12 > window.innerHeight;
    const top = placeAbove ? rect.top - H - 8 : rect.bottom + 8;
    setPos({ top, left });
  }, [hovered]);

  // close on Esc just in case
  useEffect(() => {
    if (!hovered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHovered(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hovered]);

  const tagColor =
    src.user_tag === "supporting"
      ? "var(--bunq-green)"
      : src.user_tag === "contradicting"
        ? "var(--bunq-bad)"
        : "var(--bunq-muted)";
  const trustColor =
    src.trust_level === "high"
      ? "var(--bunq-green)"
      : src.trust_level === "low"
        ? "var(--bunq-bad)"
        : "var(--bunq-warn)";
  const scoreColor =
    src.score >= 0.3
      ? "var(--bunq-green)"
      : src.score <= -0.3
        ? "var(--bunq-bad)"
        : "var(--bunq-warn)";

  return (
    <>
      <button
        ref={ref}
        onClick={() => onOpen(src)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="flex-1 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition hover:brightness-110"
        style={{
          background: "var(--bunq-surface)",
          color: "var(--bunq-green)",
          border: "1px solid rgba(181,255,0,0.30)",
        }}
        title="Open analysis"
      >
        Added · open ↗
      </button>
      {hovered &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[100] w-[340px] rounded-2xl p-4 shadow-2xl"
            style={{
              top: pos.top,
              left: pos.left,
              background: "var(--bunq-surface)",
              border: "1px solid var(--bunq-border-strong)",
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
                analysed · {src.source_type}
              </span>
              <span className="bunq-numeral font-mono text-[11px]" style={{ color: scoreColor }}>
                {src.score >= 0 ? "+" : ""}
                {src.score.toFixed(2)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
                style={{
                  background: "var(--bunq-surface-2)",
                  color: tagColor,
                  border: "1px solid var(--bunq-border)",
                }}
              >
                tag · {src.user_tag}
              </span>
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
                style={{
                  background: "var(--bunq-surface-2)",
                  color: trustColor,
                  border: "1px solid var(--bunq-border)",
                }}
              >
                trust · {src.trust_level}
              </span>
            </div>
            <div className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
              Analyst summary
            </div>
            <Markdown
              text={truncate(src.summary, 320)}
              className="mt-1 text-[12px] leading-snug text-[var(--bunq-text)]/90"
            />
            {src.key_claims && src.key_claims.length > 0 && (
              <>
                <div className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
                  Key claims
                </div>
                <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--bunq-text)]/85">
                  {src.key_claims.slice(0, 3).map((c, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="opacity-60">·</span>
                      <span className="line-clamp-2">{c}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
              click to open full analysis ↗
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
