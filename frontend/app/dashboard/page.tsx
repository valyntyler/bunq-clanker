"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Markdown } from "@/components/Markdown";
import {
  meAnalyses,
  meEvidence,
  meInvestments,
  type AnalysisRow,
  type EvidenceRow,
  type InvestmentList,
  type InvestmentRow,
} from "@/lib/api";

export default function DashboardPage() {
  return (
    <AuthGuard>
      <Dashboard />
    </AuthGuard>
  );
}

function Dashboard() {
  const [inv, setInv] = useState<InvestmentList | null>(null);
  const [ev, setEv] = useState<EvidenceRow[] | null>(null);
  const [an, setAn] = useState<AnalysisRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([meInvestments(true), meEvidence(), meAnalyses()])
      .then(([i, e, a]) => {
        if (cancelled) return;
        setInv(i);
        setEv(e.evidence);
        setAn(a.analyses);
      })
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8">
      <header>
        <Link
          href="/"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)] hover:text-[var(--bunq-text)]"
        >
          ← back to analyze
        </Link>
        <h1 className="mt-3 bunq-numeral text-4xl font-black tracking-tight">
          Your dashboard
        </h1>
        <p className="mt-1 text-sm text-[var(--bunq-muted)]">
          Every analysis you ran, every source you uploaded, every paper-trade
          you fired — with live Alpaca status.
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

      {/* ── summary tiles ──────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile
          label="invested"
          value={
            inv ? `€${inv.summary.total_invested_eur.toFixed(2)}` : "—"
          }
          sub={inv ? `${inv.summary.count} positions` : ""}
          accent
        />
        <SummaryTile
          label="unrealized P&L (paper)"
          value={
            inv
              ? `${inv.summary.total_unrealized_pnl_usd >= 0 ? "+" : ""}$${inv.summary.total_unrealized_pnl_usd.toFixed(2)}`
              : "—"
          }
          sub={
            inv
              ? "fills land Mon 09:30 ET if submitted after-hours"
              : ""
          }
          tone={
            inv && inv.summary.total_unrealized_pnl_usd > 0
              ? "good"
              : inv && inv.summary.total_unrealized_pnl_usd < 0
                ? "bad"
                : undefined
          }
        />
        <SummaryTile
          label="evidence + analyses"
          value={
            ev !== null && an !== null
              ? `${ev.length} · ${an.length}`
              : "—"
          }
          sub="sources · runs"
        />
      </div>

      {/* ── investments ─────────────────────────────────── */}
      <Section title="Investments">
        {inv === null ? (
          <Loader />
        ) : inv.investments.length === 0 ? (
          <EmptyState
            title="No paper trades yet"
            body={
              <>
                Open <Link href="/" className="underline" style={{ color: "var(--bunq-green)" }}>any analysis</Link>
                {" "}and click Invest. We'll push a Bunq sandbox transfer + an Alpaca paper buy.
              </>
            }
          />
        ) : (
          <div
            className="overflow-hidden rounded-2xl"
            style={{
              background: "var(--bunq-surface)",
              border: "1px solid var(--bunq-border)",
            }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--bunq-faint)]"
                  style={{ background: "var(--bunq-surface-2)" }}
                >
                  <Th>Date</Th>
                  <Th>Ticker</Th>
                  <Th>Amount</Th>
                  <Th>Alpaca</Th>
                  <Th>Status</Th>
                  <Th>P&L</Th>
                </tr>
              </thead>
              <tbody>
                {inv.investments.map((r) => (
                  <InvestmentRowView key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── evidence ────────────────────────────────────── */}
      <Section title="Uploaded evidence">
        {ev === null ? (
          <Loader />
        ) : ev.length === 0 ? (
          <EmptyState
            title="No sources yet"
            body={
              <>
                Click <strong>+ Add evidence</strong> on any analysis to attach
                a URL, pasted text, image, video, audio, or PDF.
              </>
            }
          />
        ) : (
          <div className="space-y-2">
            {ev.map((e) => (
              <EvidenceRowView key={e.id} e={e} />
            ))}
          </div>
        )}
      </Section>

      {/* ── analyses ────────────────────────────────────── */}
      <Section title="Recent analyses">
        {an === null ? (
          <Loader />
        ) : an.length === 0 ? (
          <EmptyState title="No analyses yet" body="Type a ticker on the landing page." />
        ) : (
          <div className="space-y-2">
            {an.map((a) => (
              <AnalysisRowView key={a.id} a={a} />
            ))}
          </div>
        )}
      </Section>
    </main>
  );
}

// ── helpers ─────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Loader() {
  return (
    <div className="font-mono text-[11px] text-[var(--bunq-faint)]">
      loading…
    </div>
  );
}

function EmptyState({
  title,
  body,
}: {
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-6 text-sm"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="font-bold text-[var(--bunq-text)]">{title}</div>
      <div className="mt-1 text-[var(--bunq-muted)]">{body}</div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  accent,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  tone?: "good" | "bad";
}) {
  const valueColor =
    tone === "good"
      ? "var(--bunq-green)"
      : tone === "bad"
        ? "var(--bunq-bad)"
        : accent
          ? "var(--bunq-green)"
          : "var(--bunq-text)";
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: accent
          ? "linear-gradient(160deg, rgba(181,255,0,0.08), var(--bunq-surface))"
          : "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {label}
      </div>
      <div
        className="bunq-numeral mt-1 text-3xl font-black"
        style={{ color: valueColor }}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-[11px] text-[var(--bunq-muted)]">{sub}</div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 text-left font-mono">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-top">{children}</td>;
}

function InvestmentRowView({ r }: { r: InvestmentRow }) {
  const status = r.alpaca?.status ?? "n/a";
  const pnl = r.unrealized_pnl_usd;
  const pct = r.unrealized_pnl_pct;
  const filled = r.alpaca?.filled_qty ?? 0;
  const fillPrice = r.alpaca?.filled_avg_price;
  return (
    <tr style={{ borderTop: "1px solid var(--bunq-border)" }}>
      <Td>
        <div className="font-mono text-[11px] text-[var(--bunq-muted)]">
          {r.created_at.slice(0, 16).replace("T", " ")}
        </div>
      </Td>
      <Td>
        <div className="bunq-numeral font-mono text-sm font-bold">
          {r.ticker}
        </div>
        <div className="font-mono text-[10px] text-[var(--bunq-faint)]">
          → {r.alpaca_symbol}
        </div>
      </Td>
      <Td>
        <div className="bunq-numeral font-bold">
          €{r.amount_eur.toFixed(2)}
        </div>
        <div className="font-mono text-[10px] text-[var(--bunq-faint)]">
          ${r.amount_usd.toFixed(2)} @ {r.fx_rate.toFixed(2)}
        </div>
      </Td>
      <Td>
        <div className="font-mono text-[11px] text-[var(--bunq-muted)]">
          {r.alpaca_order_id ? r.alpaca_order_id.slice(0, 8) : "—"}
        </div>
        {fillPrice && (
          <div className="bunq-numeral font-mono text-[11px] text-[var(--bunq-text)]">
            filled {filled.toFixed(4)} @ ${fillPrice.toFixed(2)}
          </div>
        )}
      </Td>
      <Td>
        <StatusPill status={status} />
      </Td>
      <Td>
        {pnl !== undefined && pct !== undefined ? (
          <div
            className="bunq-numeral font-mono font-bold"
            style={{
              color:
                pnl > 0
                  ? "var(--bunq-green)"
                  : pnl < 0
                    ? "var(--bunq-bad)"
                    : "var(--bunq-text)",
            }}
          >
            {pnl >= 0 ? "+" : ""}
            ${pnl.toFixed(2)}
            <span className="ml-1 text-[10px] opacity-70">
              ({pct >= 0 ? "+" : ""}
              {pct.toFixed(2)}%)
            </span>
          </div>
        ) : (
          <span className="font-mono text-[11px] text-[var(--bunq-faint)]">
            awaiting fill
          </span>
        )}
      </Td>
    </tr>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "filled" || status === "partially_filled"
      ? "good"
      : status === "rejected" || status === "canceled"
        ? "bad"
        : "neutral";
  const palette = {
    good: { bg: "var(--bunq-green-soft)", color: "var(--bunq-green)" },
    bad: { bg: "var(--bunq-bad-soft)", color: "var(--bunq-bad)" },
    neutral: { bg: "var(--bunq-surface-2)", color: "var(--bunq-muted)" },
  }[tone];
  return (
    <span
      className="rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]"
      style={palette}
    >
      {status}
    </span>
  );
}

function EvidenceRowView({ e }: { e: EvidenceRow }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--bunq-muted)]">
          <span
            className="rounded-full px-2 py-0.5"
            style={{ background: "var(--bunq-surface-2)" }}
          >
            {e.source_type}
          </span>
          <span>{e.user_tag}</span>
          <span className="text-[var(--bunq-faint)]">
            · {e.created_at.slice(0, 16).replace("T", " ")}
          </span>
          <Link
            href={`/analyze/${encodeURIComponent(e.ticker)}`}
            className="ml-2 underline decoration-dotted"
            style={{ color: "var(--bunq-green)" }}
          >
            {e.ticker}
          </Link>
          {e.origin && (
            <a
              href={e.origin}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted"
              style={{ color: "var(--bunq-green)" }}
            >
              open ↗
            </a>
          )}
        </div>
        <span className="bunq-numeral font-mono text-[11px] text-[var(--bunq-faint)]">
          trust:{e.trust_level} · {e.score >= 0 ? "+" : ""}
          {e.score.toFixed(2)}
        </span>
      </div>
      {e.user_note && (
        <p className="mt-1 text-xs italic text-[var(--bunq-muted)]">
          "{e.user_note}"
        </p>
      )}
      <Markdown
        text={e.summary}
        className="mt-2 text-sm text-[var(--bunq-text)]/90"
      />
    </div>
  );
}

function AnalysisRowView({ a }: { a: AnalysisRow }) {
  const verdictColor: Record<string, string> = {
    BUY: "var(--bunq-green)",
    HOLD: "var(--bunq-warn)",
    AVOID: "var(--bunq-bad)",
  };
  return (
    <Link
      href={`/analyze/${encodeURIComponent(a.ticker)}`}
      className="block rounded-2xl p-4 transition hover:bg-[var(--bunq-surface-2)]"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{
              background: "var(--bunq-surface-2)",
              color: verdictColor[a.verdict] || "var(--bunq-text)",
              border: `1px solid ${verdictColor[a.verdict] || "var(--bunq-border)"}40`,
            }}
          >
            {a.verdict || "?"}
          </span>
          <div>
            <div className="bunq-numeral font-mono text-sm font-bold">
              {a.ticker}{" "}
              <span className="text-xs font-normal text-[var(--bunq-muted)]">
                · {a.company_name}
              </span>
            </div>
            <div className="font-mono text-[10px] text-[var(--bunq-faint)]">
              conf {Math.round(a.confidence * 100)}% · pos{" "}
              {a.position_size_pct.toFixed(1)}% ·{" "}
              {a.created_at.slice(0, 16).replace("T", " ")}
            </div>
          </div>
        </div>
      </div>
      <Markdown
        text={a.one_liner}
        className="mt-2 text-sm text-[var(--bunq-text)]/90"
      />
    </Link>
  );
}
