"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DataProvenance } from "@/components/DataProvenance";
import { streamNewsroom, type NewsroomItem } from "@/lib/api";

const MAX_VISIBLE = 12;
const TOAST_TTL_MS = 8000;

/** Live newsroom strip: pulls Reuters / Bloomberg / AP / WSJ / FT / Yahoo
 *  Finance / CNBC headlines in the background and highlights anything that
 *  matches the current user's research history. New items that match the
 *  watchlist also pop a toast in the bottom-right. */
export function NewsroomTicker({ onlyWatchlist = false }: { onlyWatchlist?: boolean }) {
  const [items, setItems] = useState<NewsroomItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<NewsroomItem[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const abort = new AbortController();
    let stopped = false;
    (async () => {
      try {
        setConnected(true);
        await streamNewsroom({
          onlyWatchlist,
          limitInitial: 20,
          signal: abort.signal,
          onItem: (item, fresh) => {
            // De-dupe within the session. The server backlog can re-emit
            // an item that's also re-emitted as "fresh" if it lands during
            // the boundary moment.
            if (seenIdsRef.current.has(item.id)) return;
            seenIdsRef.current.add(item.id);
            setItems((prev) => {
              const next = [item, ...prev];
              next.sort((a, b) =>
                (b.fetched_at + b.published).localeCompare(
                  a.fetched_at + a.published
                )
              );
              return next.slice(0, 60);
            });
            if (fresh && item.tickers.length > 0) {
              const toast = item;
              setToasts((prev) => [toast, ...prev].slice(0, 3));
              setTimeout(() => {
                if (stopped) return;
                setToasts((prev) => prev.filter((t) => t.id !== toast.id));
              }, TOAST_TTL_MS);
            }
          },
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      } finally {
        setConnected(false);
      }
    })();
    return () => {
      stopped = true;
      abort.abort();
    };
  }, [onlyWatchlist]);

  if (items.length === 0 && !error && !connected) return null;

  return (
    <>
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Live newsroom
          </h2>
          <DataProvenance kind="newsroom" />
          <span
            className="flex items-center gap-1.5 font-mono text-[10px]"
            style={{
              color: connected ? "var(--bunq-green)" : "var(--bunq-faint)",
            }}
          >
            <span
              className={
                connected
                  ? "inline-block h-1.5 w-1.5 animate-pulse rounded-full"
                  : "inline-block h-1.5 w-1.5 rounded-full"
              }
              style={{
                background: connected
                  ? "var(--bunq-green)"
                  : "var(--bunq-faint)",
              }}
            />
            {connected ? "live" : "reconnecting…"}
          </span>
        </div>

        {error && (
          <div
            className="mb-3 rounded-2xl px-3 py-2 text-xs"
            style={{
              background: "var(--bunq-bad-soft)",
              color: "var(--bunq-bad)",
            }}
          >
            newsroom unavailable: {error}
          </div>
        )}

        {items.length === 0 && connected && (
          <div
            className="rounded-2xl p-4 text-xs"
            style={{
              background: "var(--bunq-surface)",
              border: "1px solid var(--bunq-border)",
              color: "var(--bunq-muted)",
            }}
          >
            Waiting for the first headlines… the poller hits Reuters, Bloomberg,
            AP, WSJ, FT, Yahoo Finance, and CNBC every {Math.round(90)}s.
          </div>
        )}

        {items.length > 0 && (
          <ul
            className="overflow-hidden rounded-2xl"
            style={{
              background: "var(--bunq-surface)",
              border: "1px solid var(--bunq-border)",
            }}
          >
            {items.slice(0, MAX_VISIBLE).map((it) => (
              <NewsRow key={it.id} item={it} />
            ))}
          </ul>
        )}
      </section>

      <ToastStack
        toasts={toasts}
        onDismiss={(id) =>
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }
      />
    </>
  );
}

function NewsRow({ item }: { item: NewsroomItem }) {
  const matched = item.tickers.length > 0;
  return (
    <li
      className="border-t first:border-t-0"
      style={{
        borderColor: "var(--bunq-border)",
        background: matched
          ? "linear-gradient(160deg, rgba(181,255,0,0.04), transparent)"
          : "transparent",
      }}
    >
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm transition hover:bg-[var(--bunq-surface-2)]"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[var(--bunq-text)]">{item.title}</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-2 font-mono text-[10px] text-[var(--bunq-faint)]">
            <span>{item.source}</span>
            {item.published && <span>· {item.published.slice(0, 16)}</span>}
            {matched &&
              item.tickers.map((t) => (
                <Link
                  key={t}
                  href={`/analyze/${encodeURIComponent(t)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="bunq-numeral rounded-full px-1.5 py-0 font-mono text-[9px] uppercase tracking-[0.16em]"
                  style={{
                    background: "var(--bunq-green-soft)",
                    color: "var(--bunq-green)",
                    border: "1px solid rgba(181,255,0,0.30)",
                  }}
                >
                  {t} ↗
                </Link>
              ))}
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-[var(--bunq-faint)]">
          ↗
        </span>
      </a>
    </li>
  );
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: NewsroomItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <a
          key={t.id}
          href={t.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-2xl p-3 transition hover:brightness-110"
          style={{
            background:
              "linear-gradient(160deg, rgba(181,255,0,0.10), var(--bunq-surface))",
            border: "1px solid rgba(181,255,0,0.35)",
            boxShadow: "0 12px 32px -10px rgba(0,0,0,0.6)",
          }}
        >
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
            <span>● fresh · {t.tickers.join(", ")}</span>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDismiss(t.id);
              }}
              className="opacity-60 hover:opacity-100"
              aria-label="dismiss"
            >
              ✕
            </button>
          </div>
          <div className="mt-1 text-sm font-bold text-[var(--bunq-text)]">
            {t.title}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-[var(--bunq-faint)]">
            {t.source}
          </div>
        </a>
      ))}
    </div>
  );
}
