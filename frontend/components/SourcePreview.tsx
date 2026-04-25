"use client";

import { Markdown } from "@/components/Markdown";
import { Modal } from "@/components/Modal";
import { UserSourceClaims } from "@/components/UserSourceClaims";
import type { GeopoliticalOverlay, UserSource } from "@/lib/api";

/**
 * Two preview shapes — one for user-uploaded sources, one for the curated
 * geopolitical clip overlays. Both render in the shared <Modal>, with the
 * media on top, the analysis underneath, and an "open original ↗" out.
 */

export function UserSourcePreview({
  source,
  open,
  onClose,
}: {
  source: UserSource | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!source) return null;
  return (
    <Modal open={open} onClose={onClose} size="xl" ariaLabel="Source preview">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
        <span
          className="rounded-full px-2 py-0.5"
          style={{ background: "var(--bunq-green-soft)" }}
        >
          {source.source_type}
        </span>
        <span className="text-[var(--bunq-muted)]">
          tag · {source.user_tag} · trust · {source.trust_level}
        </span>
        <span className="bunq-numeral ml-auto font-mono text-[11px] text-[var(--bunq-faint)]">
          {source.score >= 0 ? "+" : ""}
          {source.score.toFixed(2)}
        </span>
      </div>

      <h2 className="mt-3 bunq-numeral text-2xl font-black">User source</h2>
      {source.user_note && (
        <p className="mt-1 text-sm italic text-[var(--bunq-muted)]">
          "{source.user_note}"
        </p>
      )}

      {/* Render the media block only when there's media worth showing.
          Plain-text sources become a tighter, less awkward layout. */}
      {hasVisualMedia(source) && (
        <div className="mt-4">
          <SourceMedia source={source} large />
        </div>
      )}
      {source.source_type === "url" && source.origin && (
        <div
          className="mt-4 rounded-xl px-3 py-2 text-xs"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          <a
            href={source.origin}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all underline decoration-dotted"
            style={{ color: "var(--bunq-green)" }}
          >
            {source.origin}
          </a>
        </div>
      )}

      {/* analysis */}
      <div className="mt-5">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          Analyst summary
        </h3>
        <Markdown
          text={source.summary}
          className="mt-1 text-sm leading-relaxed text-[var(--bunq-text)]/90"
        />
      </div>

      {source.key_claims && source.key_claims.length > 0 && (
        <div className="mt-5">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Multimodal layers / claims
          </h3>
          <UserSourceClaims claims={source.key_claims} />
        </div>
      )}

      {source.origin && hasVisualMedia(source) && (
        <div className="mt-5">
          <a
            href={source.origin}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
            style={{
              background: "var(--bunq-surface-2)",
              border: "1px solid var(--bunq-border-strong)",
              color: "var(--bunq-text)",
            }}
          >
            Open original ↗
          </a>
        </div>
      )}
    </Modal>
  );
}

export function GeopoliticalPreview({
  overlay,
  open,
  onClose,
}: {
  overlay: GeopoliticalOverlay | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!overlay) return null;
  return (
    <Modal open={open} onClose={onClose} size="xl" ariaLabel="Geopolitical clip preview">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
        <span
          className="rounded-full px-2 py-0.5"
          style={{ background: "var(--bunq-green-soft)" }}
        >
          geopolitical
        </span>
        <span className="text-[var(--bunq-muted)]">{overlay.event_id}</span>
        <span className="bunq-numeral ml-auto font-mono text-[11px] text-[var(--bunq-faint)]">
          rel {overlay.relevance.toFixed(2)} · impact{" "}
          {overlay.impact_direction > 0
            ? "+"
            : overlay.impact_direction < 0
              ? "−"
              : "·"}
          {overlay.impact_magnitude.toFixed(2)}
        </span>
      </div>

      <h2 className="mt-2 bunq-numeral text-2xl font-black">{overlay.speaker}</h2>

      {overlay.clip_url ? (
        <video
          src={overlay.clip_url}
          controls
          autoPlay={false}
          preload="metadata"
          playsInline
          className="mt-4 aspect-video w-full rounded-xl bg-black"
        />
      ) : (
        <TextOnlyEventStrip overlay={overlay} />
      )}

      <div className="mt-4">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          Market reasoning
        </h3>
        <Markdown
          text={overlay.reasoning}
          className="mt-1 text-sm leading-relaxed text-[var(--bunq-text)]/90"
        />
      </div>

      {overlay.transcript_excerpt && (
        <div className="mt-4">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Transcript excerpt
          </h3>
          <blockquote
            className="mt-1 border-l-2 pl-3 text-sm italic text-[var(--bunq-text)]/85"
            style={{ borderColor: "var(--bunq-border-strong)" }}
          >
            "{overlay.transcript_excerpt}"
          </blockquote>
        </div>
      )}

      {overlay.source_url && (
        <a
          href={overlay.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border-strong)",
            color: "var(--bunq-text)",
          }}
        >
          Open source ↗
        </a>
      )}

      {(overlay.tone_notes || overlay.visual_notes) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {overlay.tone_notes && (
            <SubLayer label="Tone (audio prosody)" body={overlay.tone_notes} />
          )}
          {overlay.visual_notes && (
            <SubLayer
              label="Visual (frame grid)"
              body={overlay.visual_notes}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

export function ImageLightbox({
  src,
  alt,
  open,
  onClose,
}: {
  src: string | null;
  alt?: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!src) return null;
  return (
    <Modal open={open} onClose={onClose} size="full" ariaLabel="Image preview">
      <div className="flex items-center justify-center">
        <img
          src={src}
          alt={alt}
          className="max-h-[80vh] w-auto max-w-full rounded-xl"
        />
      </div>
      <div className="mt-3 text-center text-[11px] text-[var(--bunq-faint)]">
        Click outside the image or press Esc to close.
      </div>
    </Modal>
  );
}

// ── building blocks ─────────────────────────────────────────────

function hasVisualMedia(source: UserSource): boolean {
  if (!source.origin) return false;
  return ["image", "video", "audio", "pdf"].includes(source.source_type);
}

export function SourceMedia({
  source,
  large,
}: {
  source: UserSource;
  large?: boolean;
}) {
  if (!source.origin) return null;
  if (source.source_type === "image") {
    return (
      <a href={source.origin} target="_blank" rel="noopener noreferrer">
        <img
          src={source.origin}
          alt="user evidence"
          className={`w-full rounded-xl bg-black ${large ? "max-h-[60vh] object-contain" : "aspect-video object-cover"}`}
          loading="lazy"
        />
      </a>
    );
  }
  if (source.source_type === "video") {
    return (
      <video
        src={source.origin}
        controls
        preload="metadata"
        playsInline
        className={`w-full rounded-xl bg-black ${large ? "max-h-[60vh]" : "aspect-video"}`}
      />
    );
  }
  if (source.source_type === "audio") {
    return (
      <audio src={source.origin} controls className="w-full">
        Your browser doesn't support audio.
      </audio>
    );
  }
  if (source.source_type === "pdf") {
    return (
      <a
        href={source.origin}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
        style={{
          background: "var(--bunq-surface-2)",
          border: "1px solid var(--bunq-border-strong)",
          color: "var(--bunq-text)",
        }}
      >
        Open PDF ↗
      </a>
    );
  }
  if (source.source_type === "url") {
    return (
      <a
        href={source.origin}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-sm underline decoration-dotted"
        style={{ color: "var(--bunq-green)" }}
      >
        {source.origin}
      </a>
    );
  }
  return null;
}

function TextOnlyEventStrip({ overlay }: { overlay: GeopoliticalOverlay }) {
  const host = overlay.source_url ? safeHost(overlay.source_url) : null;
  const dirGlyph =
    overlay.impact_direction > 0
      ? "+"
      : overlay.impact_direction < 0
        ? "−"
        : "·";
  const dirColor =
    overlay.impact_direction > 0
      ? "var(--bunq-green)"
      : overlay.impact_direction < 0
        ? "var(--bunq-bad)"
        : "var(--bunq-muted)";
  const relPct = Math.round(Math.max(0, Math.min(1, overlay.relevance)) * 100);
  const impPct = Math.round(
    Math.max(0, Math.min(1, Math.abs(overlay.impact_magnitude))) * 100
  );
  return (
    <div
      className="mt-4 grid gap-3 rounded-xl p-4 sm:grid-cols-[1fr_auto]"
      style={{
        background:
          "linear-gradient(160deg, rgba(181,255,0,0.04), var(--bunq-surface-2))",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          live · text-only event
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {host && (
            <a
              href={overlay.source_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full px-2 py-0.5 font-mono text-[10px]"
              style={{
                background: "var(--bunq-surface)",
                color: "var(--bunq-green)",
                border: "1px solid var(--bunq-border-strong)",
              }}
            >
              {host} ↗
            </a>
          )}
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
            style={{
              background: "var(--bunq-surface)",
              color: "var(--bunq-muted)",
              border: "1px solid var(--bunq-border)",
            }}
          >
            no clip · scored from headline + snippet
          </span>
        </div>
        {overlay.transcript_excerpt && (
          <p
            className="mt-3 line-clamp-3 text-sm leading-snug text-[var(--bunq-text)]/90"
            title={overlay.transcript_excerpt}
          >
            {overlay.transcript_excerpt}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2 text-right">
        <Bar label="rel" value={relPct} color="var(--bunq-green)" />
        <Bar
          label="impact"
          value={impPct}
          color={dirColor}
          prefix={dirGlyph}
          rawValue={overlay.impact_magnitude}
        />
      </div>
    </div>
  );
}

function Bar({
  label,
  value,
  color,
  prefix,
  rawValue,
}: {
  label: string;
  value: number;
  color: string;
  prefix?: string;
  rawValue?: number;
}) {
  return (
    <div className="w-32">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          {label}
        </span>
        <span
          className="bunq-numeral font-mono text-[11px]"
          style={{ color }}
        >
          {prefix ?? ""}
          {rawValue !== undefined
            ? rawValue.toFixed(2)
            : (value / 100).toFixed(2)}
        </span>
      </div>
      <div
        className="mt-1 h-1 w-full rounded-full"
        style={{ background: "var(--bunq-surface)" }}
      >
        <div
          className="h-1 rounded-full"
          style={{ width: `${value}%`, background: color }}
        />
      </div>
    </div>
  );
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function SubLayer({ label, body }: { label: string; body: string }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "var(--bunq-surface-2)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div
        className="font-mono text-[9px] uppercase tracking-[0.18em]"
        style={{ color: "var(--bunq-green)" }}
      >
        {label}
      </div>
      <Markdown
        text={body}
        className="mt-1 text-xs text-[var(--bunq-text)]/90"
      />
    </div>
  );
}
