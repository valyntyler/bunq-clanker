"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  resynthesize,
  streamAnalyze,
  type AnalyzeEvent,
  type BunqSpendingOverlay,
  type ConsumerPanelForecast,
  type GeopoliticalOverlay,
  type Report,
  type Section,
  type UserSource,
} from "@/lib/api";
import { AddEvidenceModal } from "@/components/AddEvidenceModal";
import { AuthGuard } from "@/components/AuthGuard";
import { ChatPanel } from "@/components/ChatPanel";
import { VerdictBanner } from "@/components/VerdictBanner";
import { SectionCard } from "@/components/SectionCard";
import { PanelForecastCard } from "@/components/PanelForecastCard";
import { BunqSpendingCard } from "@/components/BunqSpendingCard";
import { TerminalLog } from "@/components/TerminalLog";
import { InvestModal } from "@/components/InvestModal";

function ts() {
  return new Date().toTimeString().slice(0, 8);
}

function SubCard({ label, body }: { label: string; body: string }) {
  return (
    <div
      className="rounded-xl p-2"
      style={{
        background: "var(--bunq-surface-2)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {label}
      </div>
      <div className="mt-1 text-xs text-[var(--bunq-text)]/85">{body}</div>
    </div>
  );
}

const MODULE_DISPLAY: Record<string, string> = {
  fundamentals: "fundamentals",
  news: "news",
  chart: "chart",
  panel: "panel",
  bunq_spending: "bunq_spending",
};

export default function AnalyzePageWrapper() {
  return (
    <AuthGuard>
      <AnalyzePage />
    </AuthGuard>
  );
}

function AnalyzePage() {
  const params = useParams<{ ticker: string }>();
  const search = useSearchParams();
  const ticker = decodeURIComponent(params.ticker).toUpperCase();
  const coords = useMemo(() => {
    const lat = search.get("lat");
    const lng = search.get("lng");
    return lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined;
  }, [search]);

  const [report, setReport] = useState<Report | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [sections, setSections] = useState<Record<string, Section>>({});
  const [panel, setPanel] = useState<ConsumerPanelForecast | null>(null);
  const [bunqSpending, setBunqSpending] = useState<BunqSpendingOverlay | null>(null);
  const [pending, setPending] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [investOpen, setInvestOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [userSources, setUserSources] = useState<UserSource[]>([]);
  const [geoOverlays, setGeoOverlays] = useState<GeopoliticalOverlay[]>([]);
  const [resynthing, setResynthing] = useState(false);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const log = (s: string) =>
      setLines((prev) => [...prev, `[${ts()}] ${s}`]);

    setReport(null);
    setLines([]);
    setSections({});
    setPanel(null);
    setBunqSpending(null);
    setUserSources([]);
    setGeoOverlays([]);
    setErr(null);
    setPending(true);
    startedAt.current = performance.now();

    const onEvent = (ev: AnalyzeEvent) => {
      switch (ev.event) {
        case "start":
          log(
            `pipeline ▶ ${ev.ticker}${coords ? ` @ GPS ${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}` : ""}`
          );
          break;
        case "module_start":
          log(`▷ ${ev.label}`);
          break;
        case "module_done": {
          const dt = ((performance.now() - startedAt.current) / 1000).toFixed(1);
          if (ev.error) {
            log(`✗ ${ev.name} (${dt}s) — ${ev.error}`);
          } else if (ev.section) {
            const score = ev.section.score >= 0 ? "+" : "";
            log(
              `✓ ${ev.name} (${dt}s) score=${score}${ev.section.score.toFixed(2)}`
            );
            setSections((prev) => ({ ...prev, [ev.name]: ev.section as Section }));
          } else if (ev.data) {
            if (ev.name === "panel") {
              const p = ev.data as ConsumerPanelForecast;
              log(
                `✓ panel (${dt}s) yoy=${p.yoy_change_pct >= 0 ? "+" : ""}${p.yoy_change_pct.toFixed(1)}% → ${p.next_quarter.revenue_direction}`
              );
              setPanel(p);
            } else if (ev.name === "bunq_spending") {
              const b = ev.data as BunqSpendingOverlay;
              log(
                `✓ bunq_spending (${dt}s) €${b.total_spent_12m_eur.toFixed(0)}/${b.visit_count}v ${b.trend}`
              );
              setBunqSpending(b);
            } else if (ev.name === "geopolitical") {
              const overlays = ev.data as GeopoliticalOverlay[];
              log(`✓ geopolitical (${dt}s) ${overlays.length} overlays`);
              setGeoOverlays(overlays);
            }
          } else {
            log(`· ${ev.name} (${dt}s) — no data`);
          }
          break;
        }
        case "synthesizing":
          log("⟳ synthesizing verdict from all modules…");
          break;
        case "report": {
          const dt = ((performance.now() - startedAt.current) / 1000).toFixed(1);
          log(
            `★ verdict=${ev.report.verdict} conf=${ev.report.confidence.toFixed(2)} · total ${dt}s`
          );
          setReport(ev.report);
          setPending(false);
          break;
        }
        case "error":
          log(`ERROR: ${ev.message}`);
          setErr(ev.message);
          setPending(false);
          break;
      }
    };

    streamAnalyze(ticker, coords, onEvent, ctrl.signal).catch((e) => {
      if (ctrl.signal.aborted) return;
      const msg = (e as Error).message;
      log(`ERROR: ${msg}`);
      setErr(msg);
      setPending(false);
    });

    return () => ctrl.abort();
  }, [ticker, coords]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <a
          href="/"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)] hover:text-[var(--bunq-text)]"
        >
          ← back
        </a>
        <div className="flex gap-2">
          <button
            onClick={() => setEvidenceOpen(true)}
            disabled={pending || resynthing || !report}
            className="rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: "var(--bunq-surface)",
              border: "1px solid var(--bunq-border-strong)",
              color: "var(--bunq-text)",
            }}
            title={
              pending
                ? "Wait for the initial pipeline to finish"
                : resynthing
                  ? "Re-synthesizing previous evidence"
                  : ""
            }
          >
            + Add evidence
          </button>
          {report && (
            <button
              onClick={() => setInvestOpen(true)}
              disabled={resynthing}
              className="bunq-glow rounded-full px-5 py-2 text-sm font-bold disabled:opacity-50"
              style={{
                background: "var(--bunq-green)",
                color: "#0a0d05",
              }}
            >
              Invest →
            </button>
          )}
        </div>
      </div>

      <TerminalLog lines={lines} />

      {err && (
        <div className="rounded-xl border border-rose-700 bg-rose-950/40 p-6 text-rose-100">
          <div className="text-xs font-mono uppercase tracking-wider text-rose-400">
            analyze failed
          </div>
          <p className="mt-1 text-sm">{err}</p>
          <a
            href="/"
            className="mt-4 inline-block rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600"
          >
            ← back to landing
          </a>
        </div>
      )}

      {report && (
        <div className="relative">
          <VerdictBanner report={report} />
          {resynthing && (
            <div className="absolute right-4 top-4 rounded-md bg-black/60 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-300 backdrop-blur">
              ⟳ re-synthesizing
            </div>
          )}
        </div>
      )}

      {(panel || bunqSpending) && (
        <div className="grid gap-4 md:grid-cols-2">
          {panel && <PanelForecastCard forecast={panel} ticker={ticker} />}
          {bunqSpending && (
            <BunqSpendingCard overlay={bunqSpending} ticker={ticker} />
          )}
        </div>
      )}

      {report && !panel && !bunqSpending && (
        <div
          className="rounded-2xl p-4 text-xs"
          style={{
            background: "var(--bunq-surface)",
            border: "1px solid var(--bunq-border)",
            color: "var(--bunq-muted)",
          }}
        >
          <div className="mb-1 font-mono uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Coverage note
          </div>
          {report.ticker} isn't in our 25-stock demo seed, so the Bunq panel
          forecast and personal spending overlays are skipped. Fundamentals,
          news, chart vision, and geopolitical overlays still run on real
          data.
        </div>
      )}

      {Object.keys(sections).length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Analyzer modules
            {pending && (
              <span
                className="ml-2 inline-block animate-pulse"
                style={{ color: "var(--bunq-green)" }}
              >
                ●
              </span>
            )}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(sections).map(([name, s]) => (
              <SectionCard key={name} name={name} section={s} />
            ))}
          </div>
        </section>
      )}

      {userSources.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Your sources
          </h2>
          <div className="space-y-2">
            {userSources.map((u) => (
              <div
                key={u.source_id}
                className="rounded-2xl p-4"
                style={{
                  background: "var(--bunq-surface)",
                  border: "1px solid var(--bunq-border)",
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--bunq-muted)]">
                    {u.source_type} · {u.user_tag}
                    {u.origin && (
                      <a
                        href={u.origin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 underline decoration-dotted"
                        style={{ color: "var(--bunq-green)" }}
                      >
                        link ↗
                      </a>
                    )}
                  </span>
                  <span className="bunq-numeral font-mono text-[11px] text-[var(--bunq-faint)]">
                    trust:{u.trust_level} · {u.score >= 0 ? "+" : ""}
                    {u.score.toFixed(2)}
                  </span>
                </div>
                {u.user_note && (
                  <p className="mt-1 text-xs italic text-[var(--bunq-muted)]">
                    "{u.user_note}"
                  </p>
                )}
                <p className="mt-2 text-sm text-[var(--bunq-text)]/90">
                  {u.summary}
                </p>
                {u.key_claims && u.key_claims.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-[var(--bunq-muted)]">
                    {u.key_claims.map((c, i) => (
                      <li key={i}>· {c}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {geoOverlays.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Geopolitical overlays
          </h2>
          <div className="space-y-3">
            {geoOverlays.map((g) => (
              <div
                key={g.event_id}
                className="overflow-hidden rounded-2xl"
                style={{
                  background: "var(--bunq-surface)",
                  border: "1px solid var(--bunq-border)",
                }}
              >
                <div className="grid gap-4 p-5 md:grid-cols-[260px_1fr]">
                  {g.clip_url ? (
                    <video
                      src={g.clip_url}
                      controls
                      preload="metadata"
                      playsInline
                      className="aspect-video w-full rounded-xl bg-black"
                    />
                  ) : (
                    <div
                      className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed font-mono text-[10px] uppercase tracking-[0.18em]"
                      style={{
                        borderColor: "var(--bunq-border-strong)",
                        color: "var(--bunq-faint)",
                      }}
                    >
                      live RSS · text-only
                    </div>
                  )}
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-[var(--bunq-text)]">
                          {g.speaker}
                          {g.clip_url && (
                            <span
                              className="ml-2 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
                              style={{
                                background: "var(--bunq-green-soft)",
                                color: "var(--bunq-green)",
                              }}
                            >
                              video · prosody · vision
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-[var(--bunq-faint)]">
                          {g.event_id}
                        </div>
                      </div>
                      <div className="text-right font-mono text-xs text-[var(--bunq-muted)]">
                        <div className="bunq-numeral">
                          rel {g.relevance.toFixed(2)}
                        </div>
                        <div className="bunq-numeral">
                          impact{" "}
                          {g.impact_direction > 0
                            ? "+"
                            : g.impact_direction < 0
                              ? "−"
                              : "·"}
                          {g.impact_magnitude.toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-[var(--bunq-text)]/90">
                      {g.reasoning}
                    </p>
                    {g.transcript_excerpt && (
                      <blockquote
                        className="mt-2 border-l-2 pl-3 text-xs italic text-[var(--bunq-muted)]"
                        style={{ borderColor: "var(--bunq-border-strong)" }}
                      >
                        “{g.transcript_excerpt}”
                      </blockquote>
                    )}
                    {(g.tone_notes || g.visual_notes) && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {g.tone_notes && (
                          <SubCard label="tone (audio)" body={g.tone_notes} />
                        )}
                        {g.visual_notes && (
                          <SubCard label="visual (frame grid)" body={g.visual_notes} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {report && report.conflicts.length > 0 && (
        <section>
          <h2
            className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{ color: "var(--bunq-warn)" }}
          >
            Module disagreements
          </h2>
          <ul
            className="space-y-2 rounded-2xl p-4 text-sm"
            style={{
              background: "rgba(255,183,77,0.05)",
              border: "1px solid rgba(255,183,77,0.18)",
              color: "var(--bunq-text)",
            }}
          >
            {report.conflicts.map((c, i) => (
              <li key={i}>· {c}</li>
            ))}
          </ul>
        </section>
      )}

      {report && report.risks.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Risks
          </h2>
          <ul className="space-y-1 text-sm text-[var(--bunq-muted)]">
            {report.risks.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        </section>
      )}

      {report && <ChatPanel report={report} />}

      {report && (
        <footer className="border-t border-zinc-900 pt-4 text-[11px] text-zinc-600">
          {report.disclaimer}
        </footer>
      )}

      {report && (
        <InvestModal
          report={report}
          open={investOpen}
          onClose={() => setInvestOpen(false)}
        />
      )}

      <AddEvidenceModal
        ticker={ticker}
        companyName={report?.company_name}
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        onAdded={(src) => {
          const nextSources = [...userSources, src];
          setUserSources(nextSources);
          if (!report) return;
          setResynthing(true);
          const log = (s: string) =>
            setLines((prev) => [...prev, `[${ts()}] ${s}`]);
          log(`+ user-source ${src.source_id} (${src.user_tag}, score ${src.score >= 0 ? "+" : ""}${src.score.toFixed(2)})`);
          log("⟳ re-synthesizing with new evidence…");
          resynthesize({
            ticker: report.ticker,
            company_name: report.company_name,
            sections: report.sections,
            consumer_panel_forecast: report.consumer_panel_forecast,
            bunq_spending_overlay: report.bunq_spending_overlay,
            geopolitical_overlays: geoOverlays,
            user_sources: nextSources,
            location_context: report.location_context,
          })
            .then((r) => {
              setReport(r);
              log(
                `★ verdict=${r.verdict} conf=${r.confidence.toFixed(2)} (re-synth)`
              );
            })
            .catch((e) => log(`re-synth error: ${(e as Error).message}`))
            .finally(() => setResynthing(false));
        }}
      />
    </main>
  );
}
