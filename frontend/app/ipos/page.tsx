"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Markdown } from "@/components/Markdown";
import { listIpos, type IpoBrief } from "@/lib/api";

export default function IposPage() {
  return (
    <AuthGuard>
      <Ipos />
    </AuthGuard>
  );
}

function Ipos() {
  const [data, setData] = useState<{
    as_of: string;
    disclaimer: string;
    ipos: IpoBrief[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listIpos()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header>
        <Link
          href="/"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)] hover:text-[var(--bunq-text)]"
        >
          ← analyze
        </Link>
        <h1 className="mt-3 bunq-numeral text-4xl font-black tracking-tight">
          Upcoming IPOs
        </h1>
        <p className="mt-1 text-sm text-[var(--bunq-muted)]">
          Pre-IPO companies that have filed an S-1 (or whose listing is
          publicly rumored). Tap one to see Claude's bull / bear / fair-value
          read.
          {data && (
            <span className="ml-2 text-[var(--bunq-faint)]">
              · as of {data.as_of}
            </span>
          )}
        </p>
      </header>

      {error && (
        <div
          className="rounded-2xl px-4 py-2 text-xs"
          style={{
            background: "var(--bunq-bad-soft)",
            color: "var(--bunq-bad)",
          }}
        >
          {error}
        </div>
      )}

      {data === null && !error ? (
        <div className="font-mono text-[11px] text-[var(--bunq-faint)]">
          loading…
        </div>
      ) : (
        data && (
          <>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {data.ipos.map((ipo) => (
                <IpoCard key={ipo.slug} ipo={ipo} />
              ))}
            </div>
            <footer className="border-t border-[var(--bunq-border)] pt-4 text-[11px] italic text-[var(--bunq-faint)]">
              {data.disclaimer}
            </footer>
          </>
        )
      )}
    </main>
  );
}

function statusPalette(status: string): {
  bg: string;
  fg: string;
  border: string;
} {
  if (status === "filed")
    return {
      bg: "var(--bunq-green-soft)",
      fg: "var(--bunq-green)",
      border: "rgba(181,255,0,0.30)",
    };
  if (status === "filed-confidentially")
    return {
      bg: "rgba(90,200,250,0.10)",
      fg: "var(--bunq-info)",
      border: "rgba(90,200,250,0.30)",
    };
  return {
    bg: "var(--bunq-surface-2)",
    fg: "var(--bunq-muted)",
    border: "var(--bunq-border)",
  };
}

function IpoCard({ ipo }: { ipo: IpoBrief }) {
  const pal = statusPalette(ipo.status);
  return (
    <Link
      href={`/ipos/${ipo.slug}`}
      className="block overflow-hidden rounded-2xl p-5 transition hover:brightness-110"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          {ipo.sector.split(" / ")[0]}
        </div>
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
          style={{
            background: pal.bg,
            color: pal.fg,
            border: `1px solid ${pal.border}`,
          }}
        >
          {ipo.status.replace(/-/g, " ")}
        </span>
      </div>
      <h3 className="mt-2 bunq-numeral text-xl font-black leading-tight">
        {ipo.company_name}
      </h3>
      <div className="mt-1 font-mono text-[11px] text-[var(--bunq-muted)]">
        {ipo.expected_window} · {ipo.expected_listing}
      </div>
      <div className="mt-4 flex items-baseline justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            last private val.
          </div>
          <div className="bunq-numeral text-2xl font-black text-[var(--bunq-green)]">
            ${ipo.last_private_valuation_usd_b.toFixed(1)}B
          </div>
        </div>
        <div className="text-right text-[11px] text-[var(--bunq-faint)]">
          {ipo.last_round_date}
        </div>
      </div>
      <Markdown
        text={ipo.summary}
        className="mt-3 text-xs leading-relaxed text-[var(--bunq-text)]/85 line-clamp-4"
      />
    </Link>
  );
}
