"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One-stop glossary for every metric / pill / label that appears in the UI.
 * Wrap any text or label with <Term term="..."> and an ⓘ icon shows up; click
 * to open a small popover with the definition.
 */

const GLOSSARY: Record<string, { title: string; body: string }> = {
  verdict: {
    title: "Verdict",
    body:
      "Synthesizer's final call: BUY (positive expected return), HOLD (mixed / not enough edge), AVOID (negative expected return). Not financial advice.",
  },
  confidence: {
    title: "Confidence",
    body:
      "0–100% — how sure the synthesizer is about its verdict. Low when modules disagree or data is thin.",
  },
  position_size: {
    title: "Position size %",
    body:
      "Suggested portfolio weight if you act on the BUY/HOLD/AVOID. Capped at 10%. A 'size 4%' means 4% of your investable capital.",
  },
  yoy: {
    title: "YoY (Year-over-Year)",
    body:
      "Change vs the same period one year ago. +14% YoY = current quarter is 14% larger than the same quarter last year.",
  },
  qoq: {
    title: "QoQ (Quarter-over-Quarter)",
    body:
      "Change vs the previous quarter. Watch for QoQ acceleration as a sign of trend change before the YoY follows.",
  },
  panel_size: {
    title: "Panel N",
    body:
      "Number of unique Bunq users contributing to the aggregate spending signal for this ticker's merchants. Higher N = lower noise.",
  },
  hist_correlation: {
    title: "Historical correlation",
    body:
      "Pearson correlation, over ~8 quarters of backtest, between panel-spend YoY growth and reported revenue YoY growth for this sector. 0.74 = very strong.",
  },
  trend_label: {
    title: "Trend",
    body:
      "Accelerating: current YoY > prior 4Q average. Flat: within ±5%. Declining: current YoY is meaningfully negative.",
  },
  conviction: {
    title: "Personal conviction",
    body:
      "0–100 score from your own Bunq spend. Behavioural signal: if you spend €342 at Heineken with a rising trend, your real-world demand says something the price doesn't yet.",
  },
  trust_level: {
    title: "Trust level",
    body:
      "How much weight the synthesizer gives a user-provided source. high = official / regulatory; medium = sourced press; low = anonymous screenshots / random posts.",
  },
  pe_trailing: {
    title: "P/E (trailing)",
    body:
      "Price ÷ trailing-twelve-month earnings per share. Lower = cheaper. Above ~25 is expensive for mature companies, below 15 is cheap. Sector matters.",
  },
  pe_forward: {
    title: "P/E (forward)",
    body:
      "Price ÷ analyst-consensus earnings for the next 12 months. Compare against trailing P/E to see whether the market expects growth (forward < trailing) or contraction.",
  },
  debt_to_equity: {
    title: "Debt / Equity",
    body:
      "Total debt as a multiple of shareholder equity. >1.0 (100%) = debt exceeds equity, leverage risk in a downturn. Sector-dependent (banks live above 5).",
  },
  profit_margin: {
    title: "Profit margin",
    body:
      "Net income ÷ revenue. >20% is excellent, 5–20% normal, sub-5% thin. Trends matter more than the level.",
  },
  market_cap: {
    title: "Market cap",
    body:
      "Total stock value (price × shares outstanding). Bigger = more liquid, less volatile. Below ~$2B = small-cap; €1T+ = mega-cap.",
  },
  relevance: {
    title: "Geopolitical relevance",
    body:
      "0–1 score for how directly the speaker's statement could affect this ticker's revenue, costs, demand, regulation, or supply chain.",
  },
  impact_direction: {
    title: "Impact direction",
    body:
      "+1 (bullish for the ticker), 0 (neutral), -1 (bearish). Combined with magnitude to weight the geopolitical overlay.",
  },
  impact_magnitude: {
    title: "Impact magnitude",
    body:
      "0–1 — how big the effect could be if the stated policy is enacted. Magnified for first-order effects (direct customers/inputs), discounted for second-order.",
  },
  prosody_pitch: {
    title: "Pitch (Hz)",
    body:
      "Mean fundamental frequency of the speaker's voice. Pitch_std < 30 Hz = measured/scripted delivery; high std = expressive variation.",
  },
  prosody_rms: {
    title: "RMS energy",
    body:
      "Root-mean-square audio energy — a proxy for loudness. RMS spikes pair with emphasis; high RMS std = intense delivery.",
  },
  prosody_silence: {
    title: "Silence fraction",
    body:
      "Fraction of the clip below the 20th-percentile energy threshold. > 0.3 = lots of deliberate pauses (hesitation, gravity, or pacing for effect).",
  },
  technical_verdict: {
    title: "Technical verdict",
    body:
      "Chart-pattern read: bullish (trend + setup favor up), neutral, or bearish. Independent of fundamentals — they often disagree.",
  },
  user_tag: {
    title: "Source stance",
    body:
      "Your label on a piece of evidence: supporting (agrees with the thesis), contradicting (challenges it), neutral (context only).",
  },
};

const ALIASES: Record<string, keyof typeof GLOSSARY> = {
  conf: "confidence",
  size: "position_size",
  rel: "relevance",
  pe: "pe_trailing",
  pitch: "prosody_pitch",
  rms: "prosody_rms",
  silence: "prosody_silence",
  trend: "trend_label",
  trust: "trust_level",
};

function lookup(term: string) {
  const t = term.toLowerCase();
  if (t in GLOSSARY) return GLOSSARY[t];
  if (t in ALIASES) return GLOSSARY[ALIASES[t]];
  return null;
}

export function Term({
  term,
  children,
}: {
  term: keyof typeof GLOSSARY | string;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const def = lookup(String(term));
  const open = hovered || focused;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocused(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-flex items-baseline gap-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span>{children}</span>
      {def && (
        <button
          type="button"
          tabIndex={0}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Explain ${def.title}`}
          className="inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full text-[8px] font-bold transition hover:opacity-100"
          style={{
            background: "var(--bunq-surface-2)",
            color: "var(--bunq-faint)",
            border: "1px solid var(--bunq-border)",
            opacity: open ? 1 : 0.7,
          }}
        >
          ?
        </button>
      )}
      {open && def && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-30 mt-1 w-64 rounded-xl p-3 shadow-2xl"
          style={{
            background: "var(--bunq-surface)",
            border: "1px solid var(--bunq-border-strong)",
          }}
        >
          <span
            className="block font-mono text-[9px] uppercase tracking-[0.18em]"
            style={{ color: "var(--bunq-green)" }}
          >
            {def.title}
          </span>
          <span className="mt-1 block text-[11px] leading-relaxed text-[var(--bunq-text)]/90">
            {def.body}
          </span>
        </span>
      )}
    </span>
  );
}
