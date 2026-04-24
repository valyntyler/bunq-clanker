"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  streamAnalyze,
  type AnalyzeEvent,
  type BunqSpendingOverlay,
  type ConsumerPanelForecast,
  type Report,
  type Section,
} from "@/lib/api";
import { VerdictBanner } from "@/components/VerdictBanner";
import { SectionCard } from "@/components/SectionCard";
import { PanelForecastCard } from "@/components/PanelForecastCard";
import { BunqSpendingCard } from "@/components/BunqSpendingCard";
import { TerminalLog } from "@/components/TerminalLog";
import { InvestModal } from "@/components/InvestModal";

function ts() {
  return new Date().toTimeString().slice(0, 8);
}

const MODULE_DISPLAY: Record<string, string> = {
  fundamentals: "fundamentals",
  news: "news",
  chart: "chart",
  panel: "panel",
  bunq_spending: "bunq_spending",
};

export default function AnalyzePage() {
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
          className="text-xs font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
        >
          ← back
        </a>
        {report && (
          <button
            onClick={() => setInvestOpen(true)}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Invest →
          </button>
        )}
      </div>

      <TerminalLog lines={lines} />

      {err && (
        <div className="rounded-lg bg-rose-950/50 p-4 text-sm text-rose-300">
          {err}
        </div>
      )}

      {report && <VerdictBanner report={report} />}

      {(panel || bunqSpending) && (
        <div className="grid gap-4 md:grid-cols-2">
          {panel && <PanelForecastCard forecast={panel} ticker={ticker} />}
          {bunqSpending && (
            <BunqSpendingCard overlay={bunqSpending} ticker={ticker} />
          )}
        </div>
      )}

      {Object.keys(sections).length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-mono uppercase tracking-wider text-zinc-500">
            Analyzer modules
            {pending && (
              <span className="ml-2 inline-block animate-pulse text-emerald-400">
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

      {report && report.geopolitical_overlays.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-mono uppercase tracking-wider text-zinc-500">
            Geopolitical overlays
          </h2>
          <div className="space-y-3">
            {report.geopolitical_overlays.map((g) => (
              <div
                key={g.event_id}
                className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-amber-200">
                    {g.speaker}{" "}
                    <span className="font-mono text-[10px] text-amber-500">
                      {g.event_id}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-amber-400">
                    rel {g.relevance.toFixed(2)} · impact{" "}
                    {g.impact_direction > 0
                      ? "+"
                      : g.impact_direction < 0
                        ? "−"
                        : "·"}
                    {g.impact_magnitude.toFixed(2)}
                  </div>
                </div>
                <p className="mt-2 text-sm text-amber-100/80">{g.reasoning}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {report && report.conflicts.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-mono uppercase tracking-wider text-amber-400">
            Module disagreements
          </h2>
          <ul className="space-y-2 rounded-lg border border-amber-900/40 bg-amber-950/10 p-4 text-sm text-amber-100/90">
            {report.conflicts.map((c, i) => (
              <li key={i}>· {c}</li>
            ))}
          </ul>
        </section>
      )}

      {report && report.risks.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-mono uppercase tracking-wider text-zinc-500">
            Risks
          </h2>
          <ul className="space-y-1 text-sm text-zinc-300">
            {report.risks.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        </section>
      )}

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
    </main>
  );
}
