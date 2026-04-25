"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearCachedReport,
  downloadReportPdf,
  getCachedReport,
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
import { DataProvenance } from "@/components/DataProvenance";
import { GeopoliticalOverlayCard } from "@/components/GeopoliticalOverlayCard";
import { IndexOptionsSection } from "@/components/IndexOptionsSection";
import { LiveClipSearch } from "@/components/LiveClipSearch";
import { PulseCheckSection } from "@/components/PulseCheckSection";
import {
  CardSkeleton,
  ModuleSkeleton,
  PendingStrip,
  VerdictSkeleton,
} from "@/components/SectionSkeleton";
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

function formatAge(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
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
  const [fromCache, setFromCache] = useState<{ generatedAt: string; ageS: number } | null>(null);

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

    let cancelled = false;

    const hydrateFromReport = (r: Report) => {
      setReport(r);
      setSections(r.sections);
      setPanel(r.consumer_panel_forecast ?? null);
      setBunqSpending(r.bunq_spending_overlay ?? null);
      setUserSources(r.user_sources ?? []);
      setGeoOverlays(r.geopolitical_overlays ?? []);
      // Mark every module as "done" in the pipeline grid since they all
      // already ran when the cache was populated.
      setPipeline((prev) => {
        const next: PipelineState = { ...prev };
        for (const k of Object.keys(prev)) {
          next[k] = { ...prev[k], status: "done" as const, elapsedMs: 0 };
        }
        return next;
      });
      setSynthesizing(false);
      setPending(false);
    };

    // Try the cache first — if we have a recent compiled report for this
    // ticker, hydrate instantly and skip the 25-second pipeline. The
    // "Re-run" button forces a fresh stream.
    (async () => {
      try {
        const cached = await getCachedReport(ticker);
        if (cancelled || ctrl.signal.aborted) return;
        if (cached) {
          hydrateFromReport(cached.report);
          setFromCache({
            generatedAt: cached.generated_at,
            ageS: cached.age_s,
          });
          log(
            `✦ cached analysis · ${formatAge(cached.age_s)} ago — Re-run to refresh`
          );
          return;
        }
      } catch (e) {
        log(`(no cache: ${(e as Error).message}) — running fresh`);
      }
      streamAnalyze(ticker, coords, onEvent, ctrl.signal).catch((e) => {
        if (ctrl.signal.aborted) return;
        const msg = (e as Error).message;
        log(`ERROR: ${msg}`);
        setErr(msg);
        setPending(false);
      });
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [ticker, coords]);

  async function reanalyze() {
    if (pending) return;
    try {
      await clearCachedReport(ticker);
    } catch {
      // ignore
    }
    window.location.reload();
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)] hover:text-[var(--bunq-text)]"
          >
            ← back
          </a>
          {fromCache && (
            <button
              onClick={reanalyze}
              className="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{
                background: "var(--bunq-green-soft)",
                color: "var(--bunq-green)",
                border: "1px solid rgba(181,255,0,0.30)",
              }}
              title="This report was loaded from cache — click to run a fresh analysis"
            >
              cached · {formatAge(fromCache.ageS)} ago · Re-run ↻
            </button>
          )}
        </div>
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

      {report ? (
        <div className="relative">
          <VerdictBanner report={report} />
          {resynthing && (
            <div className="absolute right-4 top-4 rounded-md bg-black/60 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-300 backdrop-blur">
              ⟳ re-synthesizing
            </div>
          )}
        </div>
      ) : (
        pending && !err && <VerdictSkeleton ticker={ticker} />
      )}

      {/* Panel + personal-spending row. Render skeletons in the slots
          while their analyzers are still in flight so the layout doesn't
          jump when the data lands. */}
      {(panel ||
        bunqSpending ||
        (pending &&
          (pipeline.panel?.status !== "done" ||
            pipeline.bunq_spending?.status !== "done"))) && (
        <div className="grid gap-4 md:grid-cols-2">
          {panel ? (
            <PanelForecastCard forecast={panel} ticker={ticker} />
          ) : pipeline.panel?.status !== "done" && pending ? (
            <CardSkeleton
              title="Bunq panel forecast"
              status={
                pipeline.panel?.status === "running" ? "running" : "pending"
              }
            />
          ) : null}
          {bunqSpending ? (
            <BunqSpendingCard overlay={bunqSpending} ticker={ticker} />
          ) : pipeline.bunq_spending?.status !== "done" && pending ? (
            <CardSkeleton
              title="Your personal spend"
              status={
                pipeline.bunq_spending?.status === "running"
                  ? "running"
                  : "pending"
              }
            />
          ) : null}
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

      {report && report.index_options && report.index_options.length > 0 && (
        <IndexOptionsSection
          ticker={ticker}
          options={report.index_options}
        />
      )}

      {(Object.keys(sections).length > 0 || pending) && (
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
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
            <span className="text-[10px] text-[var(--bunq-muted)]">
              one card per data modality — hover any
              <span
                className="mx-1 inline-block rounded-full px-1.5 py-0 font-mono text-[8px]"
                style={{
                  background: "var(--bunq-surface-2)",
                  border: "1px solid var(--bunq-border)",
                }}
              >
                data ⓘ
              </span>
              tag for full provenance
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {/* Always show all six module slots: real card if the section
                landed, skeleton otherwise. Order matches MODULE_ORDER so
                the layout is stable as data streams in. */}
            {[
              "fundamentals",
              "news",
              "chart",
              "website",
              "earnings_call",
              "leadership",
            ].map((name) => {
              const s = sections[name];
              if (s) {
                return (
                  <SectionCard
                    key={name}
                    name={name}
                    section={s}
                    ticker={ticker}
                  />
                );
              }
              if (!pending) return null;
              const status = pipeline[name]?.status;
              if (status === "done") return null;
              return (
                <ModuleSkeleton
                  key={name}
                  name={name}
                  status={
                    status === "running"
                      ? "running"
                      : status === "error"
                        ? "error"
                        : "pending"
                  }
                  desc={pipeline[name]?.desc}
                />
              );
            })}
            {/* Surface any extra modules that streamed in (e.g. user_text)
                that aren't in the canonical six-card grid above. */}
            {Object.entries(sections)
              .filter(([name]) =>
                ![
                  "fundamentals",
                  "news",
                  "chart",
                  "website",
                  "earnings_call",
                  "leadership",
                ].includes(name)
              )
              .map(([name, s]) => (
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

      {/* Geopolitical strip indicator while overlays are still being scored. */}
      {pending &&
        geoOverlays.length === 0 &&
        pipeline.geopolitical?.status &&
        pipeline.geopolitical.status !== "done" && (
          <PendingStrip
            label={
              pipeline.geopolitical.status === "running"
                ? "geopolitical overlays · scoring relevance"
                : "geopolitical overlays"
            }
          />
        )}

      {userSources.length > 0 && (
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
              Your sources
            </h2>
            <DataProvenance kind="user_source" detail={`${userSources.length} added`} />
          </div>
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
              Geopolitical overlays
            </h2>
            <DataProvenance
              kind="geopolitical_overlay"
              detail={`${geoOverlays.length} matched`}
            />
          </div>
          <div className="space-y-3">
            {geoOverlays.map((g) => (
              <GeopoliticalOverlayCard
                key={g.event_id}
                g={g}
                onExpand={() => setPreviewOverlay(g)}
              />
            ))}
          </div>
        </section>
      )}

      {report && (
        <LiveClipSearch
          ticker={ticker}
          companyName={report.company_name}
          onIngested={(src) =>
            setUserSources((prev) => [...prev, src])
          }
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

      {report && (
        <PulseCheckSection ticker={ticker} companyName={report.company_name} />
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
