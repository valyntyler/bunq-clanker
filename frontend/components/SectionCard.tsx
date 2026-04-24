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
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          {name.replace(/_/g, " ")}
        </h3>
        <span className={`text-xs font-mono ${scoreColor(section.score)}`}>
          {scoreLabel(section.score)} · {section.score.toFixed(2)}
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-200 leading-relaxed">
        {section.summary}
      </p>
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
  );
}
