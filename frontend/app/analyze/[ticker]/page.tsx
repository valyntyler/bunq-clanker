"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadReportPdf,
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
import { LiveClipSearch } from "@/components/LiveClipSearch";
import { Markdown } from "@/components/Markdown";
import {
  emptyPipelineState,
  PipelineStatus,
  type PipelineState,
} from "@/components/PipelineStatus";
import {
  GeopoliticalPreview,
  ImageLightbox,
  UserSourcePreview,
} from "@/components/SourcePreview";
import { UserSourceClaims } from "@/components/UserSourceClaims";
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
  const [synthesizing, setSynthesizing] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineState>(emptyPipelineState());
  const [err, setErr] = useState<string | null>(null);
  const [investOpen, setInvestOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [userSources, setUserSources] = useState<UserSource[]>([]);
  const [geoOverlays, setGeoOverlays] = useState<GeopoliticalOverlay[]>([]);
  const [resynthing, setResynthing] = useState(false);
  const [previewSource, setPreviewSource] = useState<UserSource | null>(null);
  const [previewOverlay, setPreviewOverlay] =
    useState<GeopoliticalOverlay | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  async function exportPdf() {
    if (!report || exportingPdf) return;
    setExportingPdf(true);
    try {
      const blob = await downloadReportPdf(report);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
      a.download = `sauron-${report.ticker.replace(/\./g, "_")}-${ts}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setLines((prev) => [
        ...prev,
        `[${ts()}] PDF export failed: ${(e as Error).message}`,
      ]);
    } finally {
      setExportingPdf(false);
    }
  }
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
    setPipeline(emptyPipelineState());
    setSynthesizing(false);
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
          setPipeline((prev) => ({
            ...prev,
            [ev.name]: prev[ev.name]
              ? {
                  ...prev[ev.name],
                  status: "running" as const,
                  startedAt: performance.now(),
                }
              : prev[ev.name],
          }));
          break;
        case "module_done": {
          const dt = ((performance.now() - startedAt.current) / 1000).toFixed(1);

          // 1. Update PipelineStatus card state
          setPipeline((prev) => {
            const cur = prev[ev.name];
            if (!cur) return prev;
            const elapsedMs =
              cur.status === "running" ? performance.now() - cur.startedAt : 0;
            if (ev.error) {
              return {
                ...prev,
                [ev.name]: {
                  status: "error" as const,
                  label: cur.label,
                  desc: cur.desc,
                  error: ev.error,
                },
              };
            }
            let score: number | undefined;
            let summary: string | undefined;
            if (ev.section) {
              score = ev.section.score;
              summary = ev.section.summary;
            } else if (ev.data && !Array.isArray(ev.data)) {
              const d = ev.data as ConsumerPanelForecast | BunqSpendingOverlay;
              if ("yoy_change_pct" in d) {
                score = d.yoy_change_pct / 30;
              } else if ("personal_conviction_score" in d) {
                score = d.personal_conviction_score;
              }
            } else if (Array.isArray(ev.data)) {
              const overlays = ev.data as GeopoliticalOverlay[];
              const avg = overlays.length
                ? overlays.reduce(
                    (s, o) => s + o.impact_direction * o.impact_magnitude,
                    0
                  ) / overlays.length
                : 0;
              score = avg;
            }
            return {
              ...prev,
              [ev.name]: {
                status: "done" as const,
                label: cur.label,
                desc: cur.desc,
                elapsedMs,
                score,
                summary,
              },
            };
          });

          // 2. Update terminal log + section/overlay state
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
          setSynthesizing(true);
          break;
        case "report": {
          const dt = ((performance.now() - startedAt.current) / 1000).toFixed(1);
          log(
            `★ verdict=${ev.report.verdict} conf=${ev.report.confidence.toFixed(2)} · total ${dt}s`
          );
          setReport(ev.report);
          setSynthesizing(false);
          setPending(false);
          break;
        }
        case "error":
          log(`ERROR: ${ev.message}`);
          setErr(ev.message);
          setSynthesizing(false);
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
            onClick={exportPdf}
            disabled={!report || exportingPdf}
            className="rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: "var(--bunq-surface)",
              border: "1px solid var(--bunq-border-strong)",
              color: "var(--bunq-text)",
            }}
            title="Download a PDF of this report"
          >
            {exportingPdf ? "Generating…" : "Export PDF ⬇"}
          </button>
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

      <PipelineStatus pipeline={pipeline} synthesizing={synthesizing} />

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
              <SectionCard
                key={name}
                name={name}
                section={s}
                ticker={ticker}
              />
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
                <Markdown
                  text={u.summary}
                  className="mt-2 text-sm text-[var(--bunq-text)]/90"
                />
                {u.key_claims && u.key_claims.length > 0 && (
                  <UserSourceClaims claims={u.key_claims} />
                )}
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => setPreviewSource(u)}
                    className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                    style={{
                      background: "var(--bunq-green-soft)",
                      color: "var(--bunq-green)",
                      border: "1px solid rgba(181,255,0,0.30)",
                    }}
                  >
                    expand ↗
                  </button>
                </div>
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
                      <div className="flex flex-col items-end gap-2">
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
                        <button
                          onClick={() => setPreviewOverlay(g)}
                          className="rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
                          style={{
                            background: "var(--bunq-green-soft)",
                            color: "var(--bunq-green)",
                            border: "1px solid rgba(181,255,0,0.30)",
                          }}
                        >
                          expand ↗
                        </button>
                      </div>
                    </div>
                    <Markdown
                      text={g.reasoning}
                      className="mt-2 text-sm text-[var(--bunq-text)]/90"
                    />
                    {g.source_url && (
                      <a
                        href={g.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] underline decoration-dotted"
                        style={{ color: "var(--bunq-green)" }}
                      >
                        source ↗
                      </a>
                    )}
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

      {report && (
        <LiveClipSearch
          ticker={ticker}
          companyName={report.company_name}
        />
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
              <li key={i} className="flex gap-2">
                <span>·</span>
                <Markdown text={c} inline />
              </li>
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
              <li key={i} className="flex gap-2">
                <span>·</span>
                <Markdown text={r} inline />
              </li>
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

      <UserSourcePreview
        source={previewSource}
        open={previewSource !== null}
        onClose={() => setPreviewSource(null)}
      />

      <GeopoliticalPreview
        overlay={previewOverlay}
        open={previewOverlay !== null}
        onClose={() => setPreviewOverlay(null)}
      />

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
