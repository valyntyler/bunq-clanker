"use client";

import { Markdown } from "@/components/Markdown";

/**
 * Render user-source key_claims as either:
 *  - Plain bulleted facts (no bracket prefix), OR
 *  - Multimodal-layered cards when the claim starts with `[label] body`
 *    (the user_video analyzer emits "[what they said] …", "[how they said
 *    it] …", "[what they avoided] …", "[visible behaviour] …").
 *
 * The visual split makes the multimodal analysis legible without burying
 * it in a flat bullet list.
 */
export function UserSourceClaims({ claims }: { claims: string[] }) {
  const layered: { label: string; body: string }[] = [];
  const flat: string[] = [];
  for (const c of claims) {
    const m = /^\[([^\]]+)\]\s*(.+)/.exec(c);
    if (m && /(said|how|avoided|visible|tone|posture|gesture)/i.test(m[1])) {
      layered.push({ label: m[1], body: m[2] });
    } else {
      flat.push(c);
    }
  }
  return (
    <div className="mt-2 space-y-2">
      {flat.length > 0 && (
        <ul className="space-y-0.5 text-xs text-[var(--bunq-muted)]">
          {flat.map((c, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="opacity-60">·</span>
              <Markdown text={c} inline />
            </li>
          ))}
        </ul>
      )}
      {layered.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {layered.map((l, i) => (
            <div
              key={i}
              className="rounded-xl p-2.5"
              style={{
                background: "var(--bunq-surface-2)",
                border: "1px solid var(--bunq-border)",
              }}
            >
              <div
                className="font-mono text-[9px] uppercase tracking-[0.18em]"
                style={{ color: "var(--bunq-green)" }}
              >
                {l.label}
              </div>
              <Markdown
                text={l.body}
                className="mt-1 text-xs text-[var(--bunq-text)]/90"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
