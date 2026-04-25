"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Markdown } from "@/components/Markdown";
import { getIpo, type IpoBrief, type IpoThesis } from "@/lib/api";

export default function IpoDetailPage() {
  return (
    <AuthGuard>
      <IpoDetail />
    </AuthGuard>
  );
}

function IpoDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<{
    brief: IpoBrief;
    thesis: IpoThesis;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getIpo(slug)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error)
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <div
          className="rounded-2xl p-4 text-sm"
          style={{
            background: "var(--bunq-bad-soft)",
            color: "var(--bunq-bad)",
          }}
        >
          {error}
        </div>
        <Link
          href="/ipos"
          className="mt-4 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]"
        >
          ← all IPOs
        </Link>
      </main>
    );
  if (!data)
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="font-mono text-[11px] text-[var(--bunq-faint)]">
          loading thesis (Claude)…
        </div>
      </main>
    );

  const { brief, thesis } = data;
  const fvLow = thesis.fair_value_usd_b.low;
  const fvHigh = thesis.fair_value_usd_b.high;
  const last = brief.last_private_valuation_usd_b;
  const fvMid = (fvLow + fvHigh) / 2;
  const tilt = fvMid > last ? "+" : "";
  const tiltPct = ((fvMid / last - 1) * 100).toFixed(0);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <Link
        href="/ipos"
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)] hover:text-[var(--bunq-text)]"
      >
        ← all IPOs
      </Link>

      <header>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          {brief.sector} · {brief.hq}
        </div>
        <h1 className="mt-2 bunq-numeral text-4xl font-black leading-tight">
          {brief.company_name}
        </h1>
        <div className="mt-1 font-mono text-[11px] text-[var(--bunq-muted)]">
          {brief.expected_window} · {brief.expected_listing} ·{" "}
          {brief.expected_ticker}
        </div>
      </header>

      {/* Headline tile: last priv. val + Claude fair-value range */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div
          className="rounded-2xl p-5"
          style={{
            background: "var(--bunq-surface)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            last private valuation
          </div>
          <div className="bunq-numeral mt-1 text-3xl font-black">
            ${brief.last_private_valuation_usd_b.toFixed(1)}B
          </div>
          <div className="mt-1 text-[11px] text-[var(--bunq-muted)]">
            {brief.last_round_date}
          </div>
        </div>
        <div
          className="rounded-2xl p-5"
          style={{
            background:
              "linear-gradient(160deg, rgba(181,255,0,0.10), var(--bunq-surface))",
            border: "1px solid rgba(181,255,0,0.20)",
          }}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
            claude fair-value range
          </div>
          <div className="bunq-numeral mt-1 text-3xl font-black">
            ${fvLow.toFixed(0)}B – ${fvHigh.toFixed(0)}B
          </div>
          <div className="mt-1 text-[11px] text-[var(--bunq-muted)]">
            mid {tilt}
            {tiltPct}% vs last private · confidence{" "}
            {Math.round(thesis.confidence * 100)}%
          </div>
        </div>
      </div>

      {/* Summary */}
      <Markdown
        text={brief.summary}
        className="text-sm leading-relaxed text-[var(--bunq-text)]/90"
      />

      {/* Bull / bear */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card label="Bull case" tone="good">
          <Markdown text={thesis.bull_case} className="text-sm" />
        </Card>
        <Card label="Bear case" tone="bad">
          <Markdown text={thesis.bear_case} className="text-sm" />
        </Card>
      </div>

      {/* Catalysts */}
      <Section title="Catalysts to watch">
        <ul className="space-y-1.5 text-sm text-[var(--bunq-text)]/90">
          {thesis.catalysts.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className="opacity-60">·</span>
              <Markdown text={c} inline />
            </li>
          ))}
        </ul>
      </Section>

      <Card label="Retail take" tone="neutral">
        <Markdown text={thesis.retail_take} className="text-sm" />
      </Card>

      {/* Highlights / Risks from the brief */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Section title="Highlights (brief)">
          <ul className="space-y-1 text-sm text-[var(--bunq-text)]/90">
            {brief.highlights.map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className="opacity-60">·</span>
                <Markdown text={h} inline />
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Risks (brief)">
          <ul className="space-y-1 text-sm text-[var(--bunq-text)]/90">
            {brief.risks.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="opacity-60">·</span>
                <Markdown text={r} inline />
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <footer className="border-t border-[var(--bunq-border)] pt-4 text-[11px] italic text-[var(--bunq-faint)]">
        Pre-IPO data hand-curated from public S-1 filings, financial press,
        and reporting on rumored IPOs. Valuations reflect last-known private
        rounds or analyst estimates. Not investment advice.
      </footer>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Card({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "good" | "bad" | "neutral";
  children: React.ReactNode;
}) {
  const palette = {
    good: {
      bg: "rgba(181,255,0,0.06)",
      border: "rgba(181,255,0,0.20)",
      label: "var(--bunq-green)",
    },
    bad: {
      bg: "rgba(255,91,107,0.06)",
      border: "rgba(255,91,107,0.20)",
      label: "var(--bunq-bad)",
    },
    neutral: {
      bg: "var(--bunq-surface)",
      border: "var(--bunq-border)",
      label: "var(--bunq-faint)",
    },
  }[tone];
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: palette.bg, border: `1px solid ${palette.border}` }}
    >
      <div
        className="font-mono text-[10px] uppercase tracking-[0.18em]"
        style={{ color: palette.label }}
      >
        {label}
      </div>
      <div className="mt-2 text-[var(--bunq-text)]/90">{children}</div>
    </div>
  );
}
