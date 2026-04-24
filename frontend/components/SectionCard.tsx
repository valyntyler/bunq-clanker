import type { Section } from "@/lib/api";

function scoreColor(score: number) {
  if (score >= 0.3) return "text-emerald-400";
  if (score <= -0.3) return "text-rose-400";
  return "text-amber-300";
}

function scoreLabel(score: number) {
  if (score >= 0.3) return "positive";
  if (score <= -0.3) return "negative";
  return "mixed";
}

export function SectionCard({
  name,
  section,
}: {
  name: string;
  section: Section;
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
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60">
      {extra.image_url && (
        // chart-vision attaches a presigned S3 URL; show what Claude actually saw.
        <a href={extra.image_url} target="_blank" rel="noopener noreferrer">
          <img
            src={extra.image_url}
            alt={`${name} chart`}
            className="aspect-[4/3] w-full bg-zinc-950 object-cover"
            loading="lazy"
          />
        </a>
      )}
      <div className="p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            {name.replace(/_/g, " ")}
          </h3>
          <span className={`text-xs font-mono ${scoreColor(section.score)}`}>
            {scoreLabel(section.score)} · {section.score >= 0 ? "+" : ""}
            {section.score.toFixed(2)}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-200">
          {section.summary}
        </p>

        {extra.red_flags && extra.red_flags.length > 0 && (
          <FlagList color="rose" label="red flags" items={extra.red_flags} />
        )}
        {extra.green_flags && extra.green_flags.length > 0 && (
          <FlagList color="emerald" label="green flags" items={extra.green_flags} />
        )}
        {extra.material_events && extra.material_events.length > 0 && (
          <FlagList color="amber" label="material events" items={extra.material_events} />
        )}
        {(extra.support || extra.resistance || extra.technical_verdict) && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-mono">
            {extra.technical_verdict && (
              <Pill k="verdict" v={extra.technical_verdict} />
            )}
            {extra.trend && <Pill k="trend" v={extra.trend} />}
            {extra.support && <Pill k="support" v={extra.support} />}
            {extra.resistance && <Pill k="resistance" v={extra.resistance} />}
          </div>
        )}
        {extra.patterns && extra.patterns.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-mono text-zinc-500">
            {extra.patterns.map((p) => (
              <span key={p} className="rounded bg-zinc-800 px-1.5 py-0.5">
                {p}
              </span>
            ))}
          </div>
        )}
        {section.sources && section.sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1 text-[10px] font-mono text-zinc-500">
            {section.sources.map((s) => (
              <span key={s} className="rounded bg-zinc-800 px-1.5 py-0.5">
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
  color,
  label,
  items,
}: {
  color: "rose" | "emerald" | "amber";
  label: string;
  items: string[];
}) {
  const wrap = {
    rose: "border-rose-900/40 bg-rose-950/20 text-rose-300",
    emerald: "border-emerald-900/40 bg-emerald-950/20 text-emerald-300",
    amber: "border-amber-900/40 bg-amber-950/20 text-amber-300",
  }[color];
  return (
    <div className={`mt-3 rounded border ${wrap} p-2`}>
      <div className="text-[9px] font-mono uppercase tracking-wider opacity-80">
        {label}
      </div>
      <ul className="mt-1 space-y-0.5 text-[11px] leading-snug">
        {items.map((it, i) => (
          <li key={i}>· {it}</li>
        ))}
      </ul>
    </div>
  );
}

function Pill({ k, v }: { k: string; v: string }) {
  return (
    <span className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-300">
      <span className="text-zinc-500">{k}</span> {v}
    </span>
  );
}
