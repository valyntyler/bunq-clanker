import { Markdown } from "@/components/Markdown";
import { PriceChart } from "@/components/PriceChart";
import type { Section } from "@/lib/api";

function scoreColor(score: number) {
  if (score >= 0.3) return "text-[var(--bunq-green)]";
  if (score <= -0.3) return "text-[var(--bunq-bad)]";
  return "text-[var(--bunq-warn)]";
}

function scoreLabel(score: number) {
  if (score >= 0.3) return "positive";
  if (score <= -0.3) return "negative";
  return "mixed";
}

export function SectionCard({
  name,
  section,
  ticker,
}: {
  name: string;
  section: Section;
  /** When the section is the chart-vision module, render an interactive
   * Recharts price chart underneath the static PNG that Claude analyzed. */
  ticker?: string;
}) {
  const extra = (section.extra ?? {}) as {
    image_url?: string;
    red_flags?: string[];
    green_flags?: string[];
    material_events?: string[];
    technical_verdict?: string;
    trend?: string;
    patterns?: string[];
    support?: string;
    resistance?: string;
    metrics?: Record<string, unknown>;
  };

  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{
        background: "var(--bunq-surface)",
        borderColor: "var(--bunq-border)",
      }}
    >
      {name === "chart" && ticker && (
        <div className="px-4 pt-4">
          <PriceChart ticker={ticker} />
        </div>
      )}
      <div className="p-5">
        <div className="flex items-baseline justify-between">
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--bunq-muted)]">
            {name.replace(/_/g, " ")}
          </h3>
          <span className={`bunq-numeral font-mono text-xs ${scoreColor(section.score)}`}>
            {scoreLabel(section.score)} · {section.score >= 0 ? "+" : ""}
            {section.score.toFixed(2)}
          </span>
        </div>
        <Markdown
          text={section.summary}
          className="mt-2 text-sm leading-relaxed text-[var(--bunq-text)]/90"
        />

        {extra.red_flags && extra.red_flags.length > 0 && (
          <FlagList variant="bad" label="red flags" items={extra.red_flags} />
        )}
        {extra.green_flags && extra.green_flags.length > 0 && (
          <FlagList variant="good" label="green flags" items={extra.green_flags} />
        )}
        {extra.material_events && extra.material_events.length > 0 && (
          <FlagList variant="warn" label="material events" items={extra.material_events} />
        )}
        {(extra.support || extra.resistance || extra.technical_verdict) && (
          <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[11px]">
            {extra.technical_verdict && (
              <Pill k="verdict" v={extra.technical_verdict} />
            )}
            {extra.trend && <Pill k="trend" v={extra.trend} />}
            {extra.support && <Pill k="support" v={extra.support} />}
            {extra.resistance && <Pill k="resistance" v={extra.resistance} />}
          </div>
        )}
        {extra.patterns && extra.patterns.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 font-mono text-[10px] text-[var(--bunq-faint)]">
            {extra.patterns.map((p) => (
              <span
                key={p}
                className="rounded-full px-2 py-0.5"
                style={{ background: "var(--bunq-surface-2)" }}
              >
                {p}
              </span>
            ))}
          </div>
        )}
        {section.sources && section.sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1 font-mono text-[10px] text-[var(--bunq-faint)]">
            {section.sources.map((s) => (
              <span
                key={s}
                className="rounded-full px-2 py-0.5"
                style={{ background: "var(--bunq-surface-2)" }}
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FlagList({
  variant,
  label,
  items,
}: {
  variant: "bad" | "good" | "warn";
  label: string;
  items: string[];
}) {
  const styles = {
    bad: {
      bg: "rgba(255, 91, 107, 0.06)",
      border: "rgba(255, 91, 107, 0.20)",
      header: "var(--bunq-bad)",
    },
    good: {
      bg: "rgba(181, 255, 0, 0.06)",
      border: "rgba(181, 255, 0, 0.22)",
      header: "var(--bunq-green)",
    },
    warn: {
      bg: "rgba(255, 183, 77, 0.06)",
      border: "rgba(255, 183, 77, 0.22)",
      header: "var(--bunq-warn)",
    },
  }[variant];
  return (
    <div
      className="mt-3 rounded-xl border p-2.5"
      style={{ background: styles.bg, borderColor: styles.border }}
    >
      <div
        className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: styles.header }}
      >
        {label}
      </div>
      <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-[var(--bunq-text)]/85">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="opacity-60">·</span>
            <Markdown text={it} inline />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pill({ k, v }: { k: string; v: string }) {
  return (
    <span
      className="rounded-full px-2.5 py-0.5"
      style={{
        background: "var(--bunq-surface-2)",
        color: "var(--bunq-text)",
      }}
    >
      <span className="text-[var(--bunq-faint)]">{k} </span>
      {v}
    </span>
  );
}
