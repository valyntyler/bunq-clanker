"use client";

import { Markdown } from "@/components/Markdown";
import type { AuthenticityReport, GeopoliticalOverlay } from "@/lib/api";

/**
 * Compact card for one geopolitical overlay. Two layouts:
 *
 *  - With a clip → 240px video on the left, narrative on the right.
 *  - Text-only (live-RSS event) → single column, no big empty placeholder;
 *    relevance + impact rendered as inline meters so the card stays dense.
 */
export function GeopoliticalOverlayCard({
  g,
  onExpand,
}: {
  g: GeopoliticalOverlay;
  onExpand: () => void;
}) {
  const hasClip = !!g.clip_url;
  const sourceHost = g.source_url ? safeHost(g.source_url) : null;
  const dirGlyph =
    g.impact_direction > 0 ? "+" : g.impact_direction < 0 ? "−" : "·";
  const dirColor =
    g.impact_direction > 0
      ? "var(--bunq-green)"
      : g.impact_direction < 0
        ? "var(--bunq-bad)"
        : "var(--bunq-muted)";

  return (
    <div
      className="rounded-2xl"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div
        className={
          hasClip
            ? "grid gap-4 p-4 md:grid-cols-[240px_1fr]"
            : "p-4"
        }
      >
        {hasClip && (
          <video
            src={g.clip_url ?? undefined}
            controls
            preload="metadata"
            playsInline
            className="aspect-video w-full rounded-xl bg-black"
          />
        )}

        <div className="min-w-0">
          {/* header row */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-[var(--bunq-text)]">
                  {g.speaker}
                </span>
                {hasClip ? (
                  <span
                    className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
                    style={{
                      background: "var(--bunq-green-soft)",
                      color: "var(--bunq-green)",
                    }}
                  >
                    video · prosody · vision
                  </span>
                ) : (
                  <span
                    className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
                    style={{
                      background: "var(--bunq-surface-2)",
                      color: "var(--bunq-faint)",
                      border: "1px solid var(--bunq-border)",
                    }}
                  >
                    live rss · text
                  </span>
                )}
                {sourceHost && (
                  <a
                    href={g.source_url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                    style={{
                      background: "var(--bunq-surface-2)",
                      color: "var(--bunq-green)",
                      border: "1px solid var(--bunq-border)",
                    }}
                  >
                    {sourceHost} ↗
                  </a>
                )}
                {g.authenticity && <AuthenticityChip a={g.authenticity} />}
              </div>
              <div
                className="mt-1 truncate font-mono text-[10px] text-[var(--bunq-faint)]"
                title={g.event_id}
              >
                {g.event_id}
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Meter
                label="rel"
                value={g.relevance}
                color="var(--bunq-green)"
              />
              <Meter
                label="impact"
                value={g.impact_magnitude}
                prefix={dirGlyph}
                color={dirColor}
              />
              <button
                onClick={onExpand}
                aria-label="Expand overlay"
                className="inline-flex items-center justify-center rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
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
            className="mt-3 text-sm leading-relaxed text-[var(--bunq-text)]/90"
          />

          {g.transcript_excerpt && (
            <blockquote
              className="mt-3 border-l-2 pl-3 text-xs italic text-[var(--bunq-muted)]"
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
  );
}

function Meter({
  label,
  value,
  prefix,
  color,
}: {
  label: string;
  value: number;
  prefix?: string;
  color: string;
}) {
  const pct = Math.max(0, Math.min(1, Math.abs(value))) * 100;
  return (
    <div className="w-[72px] shrink-0 text-right">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {label}
      </div>
      <div className="bunq-numeral mt-0.5 font-mono text-[12px]" style={{ color }}>
        {prefix ?? ""}
        {value.toFixed(2)}
      </div>
      <div
        className="mt-1 h-1 w-full rounded-full"
        style={{ background: "var(--bunq-surface-2)" }}
      >
        <div
          className="h-1 rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function SubCard({ label, body }: { label: string; body: string }) {
  return (
    <div
      className="rounded-xl p-2.5"
      style={{
        background: "var(--bunq-surface-2)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {label}
      </div>
      <div className="mt-1 text-xs leading-snug text-[var(--bunq-text)]/85">
        {body}
      </div>
    </div>
  );
}

function safeHost(url: string): string | null {
  try {
    const h = new URL(url).hostname;
    return h.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function AuthenticityChip({ a }: { a: AuthenticityReport }) {
  // Four states. Verified is the strong-positive (green check), uncertain
  // is amber, likely_synthetic is red — the user should immediately see
  // when an overlay didn't pass the deepfake check.
  const styleByLabel: Record<
    AuthenticityReport["label"],
    { bg: string; fg: string; border: string; glyph: string; label: string }
  > = {
    verified: {
      bg: "rgba(181,255,0,0.10)",
      fg: "var(--bunq-green)",
      border: "rgba(181,255,0,0.35)",
      glyph: "✓",
      label: "verified source",
    },
    likely_real: {
      bg: "rgba(181,255,0,0.06)",
      fg: "var(--bunq-green)",
      border: "rgba(181,255,0,0.22)",
      glyph: "✓",
      label: "likely real",
    },
    uncertain: {
      bg: "rgba(255,183,77,0.08)",
      fg: "var(--bunq-warn)",
      border: "rgba(255,183,77,0.30)",
      glyph: "?",
      label: "unverified",
    },
    likely_synthetic: {
      bg: "var(--bunq-bad-soft)",
      fg: "var(--bunq-bad)",
      border: "rgba(255,90,90,0.30)",
      glyph: "✗",
      label: "deepfake-suspected",
    },
  };
  const s = styleByLabel[a.label];
  const tooltipParts: string[] = [
    a.source_verified
      ? `Source verified: ${a.source_label ?? "trusted channel"}.`
      : "Source not on the verified-channels list.",
    `Method: ${a.method}.`,
    `Score: ${(a.score * 100).toFixed(0)}/100.`,
  ];
  if (a.flags && a.flags.length > 0) {
    tooltipParts.push("Flags: " + a.flags.join(" · "));
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
      style={{ background: s.bg, color: s.fg, border: `1px solid ${s.border}` }}
      title={tooltipParts.join(" ")}
    >
      <span aria-hidden>{s.glyph}</span>
      {s.label}
    </span>
  );
}
