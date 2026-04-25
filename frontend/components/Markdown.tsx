"use client";

/**
 * Tiny inline-markdown renderer for Claude output. Handles only the patterns
 * Claude actually emits in this app:
 *   **bold**             → <strong>
 *   *italic*  / _x_      → <em>
 *   `code`               → <code>
 *   [text](url)          → <a> (new tab)
 *   [module]             → small inline citation chip (module name visible)
 *   [module:event-id]    → small inline citation chip (full id in tooltip)
 *   single \n            → <br/>
 *   blank line           → new <p>
 *
 * The citation chips are how the synthesizer cites which module supported
 * each claim — without rendering them as chips they show up as ugly inline
 * text that breaks the typography.
 */

import React from "react";

const CITATION_MODULES = new Set([
  "fundamentals",
  "news",
  "chart",
  "website",
  "earnings_call",
  "leadership",
  "panel",
  "consumer_panel",
  "bunq_spending",
  "geopolitical",
  "user",
]);

function CitationChip({
  module,
  eventId,
}: {
  module: string;
  eventId?: string;
}) {
  return (
    <span
      title={eventId ? `${module} · ${eventId}` : module}
      className="mx-0.5 inline-flex items-baseline rounded-full px-1.5 py-0 align-baseline font-mono text-[9px] uppercase tracking-[0.14em]"
      style={{
        background: "var(--bunq-surface-2)",
        color: "var(--bunq-faint)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      {module.replace(/_/g, " ")}
      {eventId && (
        <span className="ml-1 max-w-[80px] truncate opacity-70">
          {eventId.split("-").slice(0, 2).join("-")}
        </span>
      )}
    </span>
  );
}

export function Markdown({
  text,
  className,
  inline,
}: {
  text: string;
  className?: string;
  /** When true, skip paragraph wrapping — useful inside small chips. */
  inline?: boolean;
}) {
  if (inline) {
    return <span className={className}>{renderInline(text)}</span>;
  }
  const paragraphs = text.split(/\n\s*\n+/);
  return (
    <div className={className}>
      {paragraphs.map((p, i) => (
        <p key={i} className={i > 0 ? "mt-2.5" : ""}>
          {renderParagraph(p)}
        </p>
      ))}
    </div>
  );
}

function renderParagraph(p: string): React.ReactNode[] {
  const lines = p.split("\n");
  const out: React.ReactNode[] = [];
  lines.forEach((line, i) => {
    out.push(
      <React.Fragment key={`l${i}`}>{renderInline(line)}</React.Fragment>
    );
    if (i < lines.length - 1) out.push(<br key={`br${i}`} />);
  });
  return out;
}

function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < text.length) {
    // **bold**
    if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        out.push(
          <strong key={k++} className="font-bold">
            {renderInline(text.slice(i + 2, end))}
          </strong>
        );
        i = end + 2;
        continue;
      }
    }
    // *italic*  (single asterisk; require non-space neighbour to avoid matching bullets)
    if (text[i] === "*" && text[i - 1] !== "*" && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (
        end > i + 1 &&
        end < text.length &&
        text[i + 1] !== " " &&
        text[end - 1] !== " "
      ) {
        out.push(
          <em key={k++} className="italic">
            {renderInline(text.slice(i + 1, end))}
          </em>
        );
        i = end + 1;
        continue;
      }
    }
    // _italic_
    if (text[i] === "_" && (i === 0 || /\s|[(\[]/.test(text[i - 1]))) {
      const end = text.indexOf("_", i + 1);
      if (end > i + 1 && /\s|[)\]\.,;:!?]|$/.test(text[end + 1] ?? " ")) {
        out.push(
          <em key={k++} className="italic">
            {renderInline(text.slice(i + 1, end))}
          </em>
        );
        i = end + 1;
        continue;
      }
    }
    // `code`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push(
          <code
            key={k++}
            className="rounded px-1 py-0.5 text-[90%]"
            style={{
              background: "var(--bunq-surface-2)",
              color: "var(--bunq-text)",
            }}
          >
            {text.slice(i + 1, end)}
          </code>
        );
        i = end + 1;
        continue;
      }
    }
    // [text](url) — markdown link.
    // [module] / [module:event-id] — synthesizer citation chip.
    if (text[i] === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      // Markdown link first (text followed by parenthesised URL)
      if (closeBracket > i && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket + 1) {
          const linkText = text.slice(i + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          if (/^https?:\/\//i.test(url)) {
            out.push(
              <a
                key={k++}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-dotted"
                style={{ color: "var(--bunq-green)" }}
              >
                {linkText}
              </a>
            );
            i = closeParen + 1;
            continue;
          }
        }
      }
      // Citation chip: [module] or [module:event-id]
      if (closeBracket > i + 1) {
        const inner = text.slice(i + 1, closeBracket);
        const m = inner.match(/^([a-z_]+)(?::([^\]]+))?$/);
        if (m && CITATION_MODULES.has(m[1])) {
          out.push(
            <CitationChip key={k++} module={m[1]} eventId={m[2]} />
          );
          i = closeBracket + 1;
          continue;
        }
      }
    }
    // accumulate plain text until next potential special char
    let next = i + 1;
    while (next < text.length && !"*`[_".includes(text[next])) next++;
    out.push(text.slice(i, next));
    i = next;
  }
  return out;
}
