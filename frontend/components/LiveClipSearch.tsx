"use client";

import { useState } from "react";
import { searchClips, type YouTubeSearchResult } from "@/lib/api";

const SUGGESTIONS_FOR = (companyName: string): string[] => [
  `${companyName} earnings call`,
  `${companyName} CEO interview`,
  "ECB Lagarde monetary policy",
  "Trump tariffs statement",
  "EU Commission AI Act",
  "Federal Reserve FOMC press conference",
];

/**
 * Live YouTube search panel for the analyze page. Hits /geopolitical/search,
 * which runs `yt-dlp ytsearch10:` against YouTube and returns metadata only.
 * Each result is a thumbnail card that deep-links to YouTube — real videos,
 * not stubs. The pre-seeded library still drives the multimodal Claude
 * analysis on the verdict; this is the user-driven discovery layer.
 */
export function LiveClipSearch({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

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
              <a
                key={r.id}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block overflow-hidden rounded-xl transition hover:brightness-110"
                style={{
                  background: "var(--bunq-surface-2)",
                  border: "1px solid var(--bunq-border)",
                }}
              >
                {r.thumbnail ? (
                  <div className="relative aspect-video w-full overflow-hidden bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.thumbnail}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
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
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-black font-mono text-[10px] text-[var(--bunq-faint)]">
                    no thumbnail
                  </div>
                )}
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
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
