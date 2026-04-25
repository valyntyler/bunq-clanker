"use client";

import { useState } from "react";
import { DataProvenance } from "@/components/DataProvenance";
import { Markdown } from "@/components/Markdown";
import {
  streamSentiment,
  type SentimentPost,
  type SentimentResult,
  type SentimentStance,
  type SentimentStepEvent,
} from "@/lib/api";

const SOURCE_LABEL: Record<SentimentPost["source"], string> = {
  reddit: "Reddit",
  stocktwits: "StockTwits",
  hackernews: "Hacker News",
  news: "News wires",
};

const SOURCE_DOT: Record<SentimentPost["source"], string> = {
  reddit: "#ff4500",
  stocktwits: "#5ac8fa",
  hackernews: "#ff8a4c",
  news: "#b388ff",
};

const STAGE_LABEL: Record<string, string> = {
  reddit: "Scanning Reddit (wsb / stocks / investing)",
  stocktwits: "Reading StockTwits",
  hackernews: "Searching Hacker News",
  news: "Aggregating news headlines",
  analyze: "Claude sentiment analysis",
};

const STAGES: SentimentStepEvent["step"][] = [
  "reddit",
  "stocktwits",
  "hackernews",
  "news",
  "analyze",
];

export function PulseCheckSection({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName: string;
}) {
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Record<string, SentimentStepEvent>>({});
  const [result, setResult] = useState<SentimentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setStages({});
    setResult(null);
    setRunning(true);
    try {
      const r = await streamSentiment({
        ticker,
        companyName,
        onStep: (ev) => setStages((prev) => ({ ...prev, [ev.step]: ev })),
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          Pulse check · public sentiment
        </h2>
        <DataProvenance kind="pulse_check" />
      </div>

      {!running && !result && (
        <div
          className="rounded-3xl p-5"
          style={{
            background:
              "linear-gradient(160deg, rgba(181,255,0,0.06), var(--bunq-surface))",
            border: "1px solid rgba(181,255,0,0.18)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-bold text-[var(--bunq-text)]">
                What is the internet saying about {ticker}?
              </div>
              <p className="mt-1 max-w-2xl text-sm text-[var(--bunq-muted)]">
                Pulls recent chatter from Reddit (wallstreetbets, stocks,
                investing), StockTwits, Hacker News and the news wires, then
                asks Claude to score the mood and tell you how it might move
                the price.
              </p>
            </div>
            <button
              onClick={() => void run()}
              className="bunq-glow rounded-full px-5 py-2 text-sm font-bold"
              style={{
                background: "var(--bunq-green)",
                color: "#0a0d05",
              }}
            >
              Run pulse check ↗
            </button>
          </div>
        </div>
      )}

      {running && (
        <div
          className="rounded-3xl p-5"
          style={{
            background: "var(--bunq-surface)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
            ⟳ scraping public sentiment…
          </div>
          <div className="mt-3 space-y-1">
            {STAGES.map((s) => (
              <StageRow key={s} step={s} ev={stages[s]} />
            ))}
          </div>
        </div>
      )}

      {error && (
        <div
          className="mt-3 rounded-2xl p-3 text-sm"
          style={{
            background: "var(--bunq-bad-soft)",
            color: "var(--bunq-bad)",
          }}
        >
          {error}
          <button
            onClick={() => void run()}
            className="ml-3 rounded-full px-3 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{
              background: "var(--bunq-surface-2)",
              color: "var(--bunq-text)",
              border: "1px solid var(--bunq-border)",
            }}
          >
            retry
          </button>
        </div>
      )}

      {result && <PulseResults r={result} onRerun={() => void run()} />}
    </section>
  );
}

function StageRow({ step, ev }: { step: string; ev: SentimentStepEvent | undefined }) {
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
  const detail = ev?.detail || {};
  let suffix = "";
  if ("count" in detail && typeof detail.count === "number")
    suffix = ` · ${detail.count} hits`;
  if ("posts" in detail && typeof detail.posts === "number")
    suffix = ` · ${detail.posts} posts`;
  return (
    <div className="flex items-center gap-2 font-mono text-[11px]" style={{ color }}>
      <span className={status === "running" ? "animate-spin" : ""}>{glyph}</span>
      <span>{STAGE_LABEL[step] ?? step}{suffix}</span>
    </div>
  );
}

function PulseResults({
  r,
  onRerun,
}: {
  r: SentimentResult;
  onRerun: () => void;
}) {
  const dirColor = stanceColor(r.market_impact.direction);
  return (
    <div
      className="rounded-3xl p-5"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
          ✓ {r.post_count} posts analysed across{" "}
          {Object.keys(r.by_source).length} sources
        </div>
        <button
          onClick={onRerun}
          className="rounded-full px-3 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
          style={{
            background: "var(--bunq-surface-2)",
            color: "var(--bunq-muted)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          re-run
        </button>
      </div>

      {/* aggregate row — explicit columns so the summary can't collapse */}
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <Markdown
            text={r.summary}
            className="text-sm leading-relaxed text-[var(--bunq-text)]/90"
          />
          <SentimentBar
            bull={r.bullish_pct}
            bear={r.bearish_pct}
            neu={r.neutral_pct}
          />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Object.entries(r.by_source).map(([k, v]) => (
              <span
                key={k}
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px]"
                style={{
                  background: "var(--bunq-surface-2)",
                  border: "1px solid var(--bunq-border)",
                  color: "var(--bunq-muted)",
                }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background:
                      SOURCE_DOT[k as SentimentPost["source"]] ?? "#888",
                  }}
                />
                {SOURCE_LABEL[k as SentimentPost["source"]] ?? k} · {v}
              </span>
            ))}
          </div>
        </div>

        {/* market impact card — sized + self-aligned so it doesn't stretch */}
        <div
          className="self-start rounded-2xl p-4"
          style={{
            background: "var(--bunq-surface-2)",
            border: `1px solid ${dirColor.border}`,
          }}
        >
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            market impact
          </div>
          <div
            className="bunq-numeral mt-1 text-2xl font-black uppercase"
            style={{ color: dirColor.fg }}
          >
            {r.market_impact.direction}
          </div>
          <div className="mt-1 font-mono text-[10px] text-[var(--bunq-muted)]">
            magnitude · {(r.market_impact.magnitude * 100).toFixed(0)}%
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-[var(--bunq-faint)]">
            {r.market_impact.horizon}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-[var(--bunq-text)]/90">
            {r.market_impact.reasoning}
          </p>
        </div>
      </div>

      {/* themes */}
      {r.themes.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            What people are talking about
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {r.themes.map((t, i) => (
              <ThemeCard key={i} t={t} />
            ))}
          </div>
        </div>
      )}

      {/* caveats */}
      {r.caveats.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-warn)]">
            caveats
          </div>
          <ul className="space-y-1 text-[12px] text-[var(--bunq-muted)]">
            {r.caveats.map((c, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="opacity-60">·</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* posts */}
      <div className="mt-5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          Sample of the chatter ({r.posts.length})
        </div>
        <ul className="space-y-2">
          {r.posts.slice(0, 16).map((p, i) => (
            <PostRow key={`${p.source}-${i}`} p={p} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function SentimentBar({
  bull,
  bear,
  neu,
}: {
  bull: number;
  bear: number;
  neu: number;
}) {
  return (
    <div className="mt-4">
      <div className="flex h-2 w-full overflow-hidden rounded-full"
        style={{ background: "var(--bunq-surface-2)" }}>
        <div style={{ width: `${bull}%`, background: "var(--bunq-green)" }} />
        <div style={{ width: `${neu}%`, background: "var(--bunq-muted)" }} />
        <div style={{ width: `${bear}%`, background: "var(--bunq-bad)" }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-[var(--bunq-faint)]">
        <span style={{ color: "var(--bunq-green)" }}>
          bullish {bull.toFixed(0)}%
        </span>
        <span>neutral {neu.toFixed(0)}%</span>
        <span style={{ color: "var(--bunq-bad)" }}>
          bearish {bear.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

function ThemeCard({ t }: { t: { label: string; stance: SentimentStance; support_count: number; summary: string } }) {
  const c = stanceColor(t.stance);
  return (
    <div
      className="rounded-2xl p-3"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-[var(--bunq-text)]">
          {t.label}
        </span>
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
          style={{
            background: "var(--bunq-surface)",
            color: c.fg,
            border: `1px solid ${c.border}`,
          }}
        >
          {t.stance} · {t.support_count}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[var(--bunq-text)]/85">
        {t.summary}
      </p>
    </div>
  );
}

function PostRow({ p }: { p: SentimentPost }) {
  const c = stanceColor(p.stance ?? "neutral");
  return (
    <li
      className="rounded-xl p-3"
      style={{
        background: "var(--bunq-surface-2)",
        border: `1px solid ${p.stance ? c.border : "var(--bunq-border)"}`,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <a
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-[12px] font-bold text-[var(--bunq-text)] hover:underline"
        >
          {p.title}
        </a>
        {p.stance && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
            style={{
              background: "var(--bunq-surface)",
              color: c.fg,
              border: `1px solid ${c.border}`,
            }}
          >
            {p.stance}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-[var(--bunq-faint)]">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: SOURCE_DOT[p.source] ?? "#888" }}
        />
        {SOURCE_LABEL[p.source] ?? p.source} · {p.subforum} · {p.author} ·{" "}
        {p.posted_at?.slice(0, 10)} · score {p.score}
      </div>
      {p.why && (
        <div className="mt-1 text-[11px] italic text-[var(--bunq-muted)]">
          {p.why}
        </div>
      )}
    </li>
  );
}

function stanceColor(s: SentimentStance): {
  bg: string;
  fg: string;
  border: string;
} {
  if (s === "bullish")
    return {
      bg: "rgba(181,255,0,0.06)",
      fg: "var(--bunq-green)",
      border: "rgba(181,255,0,0.30)",
    };
  if (s === "bearish")
    return {
      bg: "rgba(255,91,107,0.06)",
      fg: "var(--bunq-bad)",
      border: "rgba(255,91,107,0.30)",
    };
  return {
    bg: "var(--bunq-surface)",
    fg: "var(--bunq-muted)",
    border: "var(--bunq-border)",
  };
}
