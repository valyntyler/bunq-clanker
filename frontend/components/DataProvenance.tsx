"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Tiny data-provenance tag that shows up on every report surface:
 *
 *    [ source · YAHOO FINANCE  ⓘ ]
 *
 * On hover/focus it expands to a popover that spells out:
 *  - What this data IS
 *  - Where it comes from (provider / API / scraper / fixture)
 *  - How it was processed (Claude vision, Pearson correlation, k-anon, etc.)
 *  - Freshness / scope / coverage
 *  - Trust caveats (simulated, sandbox, NL-skewed, etc.)
 *
 * Centralised so every surface labels its data the same way and updating one
 * registry entry updates the whole UI.
 */

export type ProvenanceKind =
  | "fundamentals"
  | "news"
  | "chart"
  | "website"
  | "earnings_call"
  | "leadership"
  | "synthesizer"
  | "panel_forecast"
  | "bunq_personal"
  | "bunq_accounts"
  | "bunq_payments"
  | "bunq_profile"
  | "geopolitical_overlay"
  | "geopolitical_live"
  | "user_source"
  | "spending_insights"
  | "trending"
  | "nearby"
  | "price_chart"
  | "panel_chart"
  | "ipo_calendar"
  | "ipo_filings"
  | "object_scan"
  | "receipt_scan"
  | "pulse_check"
  | "index_options"
  | "newsroom"
  | "earnings_copilot"
  | "map"
  | "rebalance"
  | "verdict";

interface ProvenanceMeta {
  /** Tag label — kept short (1–2 words). */
  label: string;
  /** What this number / panel actually represents in plain English. */
  what: string;
  /** Where the raw data came from. Provider name + endpoint. */
  source: string;
  /** How the raw data is transformed before display. */
  method: string;
  /** Time window / scope. */
  freshness: string;
  /** Truthy = simulated / sandbox / not-real-money. Worth flagging. */
  caveat?: string;
  /** Optional doc link. */
  docs?: { label: string; href: string };
}

const REGISTRY: Record<ProvenanceKind, ProvenanceMeta> = {
  fundamentals: {
    label: "Yahoo + SEC",
    what: "Valuation, profitability, balance-sheet metrics + the most recent 10-K MD&A and risk-factors text.",
    source:
      "yfinance (price, P/E, margin, debt) + SEC EDGAR (latest 10-K filing).",
    method:
      "Numbers fetched live from yfinance; filing text truncated to MD&A + risk sections, scored by Claude Sonnet 4 on Bedrock.",
    freshness: "Quote: live · 10-K: most recent annual filing.",
  },
  news: {
    label: "News wires",
    what: "Recent headlines + context for the ticker, scored for sentiment and material events.",
    source:
      "Google News RSS (default) or NewsAPI.org if NEWSAPI_KEY is set. Trusted-outlet allowlist (Reuters, Bloomberg, FT, WSJ, AP, …) sorted first.",
    method:
      "Top ~40 items per query → Claude Sonnet 4 sentiment + material-event extraction.",
    freshness: "Last 30 days, pulled at analysis time.",
  },
  chart: {
    label: "yfinance OHLCV",
    what: "Daily open/high/low/close/volume bars and Claude's read of chart patterns, support, resistance, trend.",
    source: "Yahoo Finance daily bars via yfinance.",
    method:
      "1y OHLCV → mplfinance candlestick PNG → Claude Sonnet 4 vision analysis. Live Recharts overlay on the same bars.",
    freshness: "Daily bars · last 252 trading days.",
  },
  website: {
    label: "Site + Wayback",
    what: "Brand quality, design, and how the company's website has evolved over time.",
    source:
      "Live homepage screenshot (Playwright) + archive.org Wayback snapshots.",
    method:
      "Three screenshots passed to Claude vision for execution-quality and evolution notes.",
    freshness: "Live + ~1y and ~2y prior Wayback snapshots.",
  },
  earnings_call: {
    label: "Earnings call",
    what: "CEO/CFO tone, hedging language, repeated concerns from the latest earnings call Q&A.",
    source:
      "yt-dlp pull from the company's IR YouTube → AWS Transcribe (or Whisper fallback).",
    method:
      "Transcript chunks → Claude Sonnet 4 tone + hedging + commitment extraction.",
    freshness: "Most recent quarterly call.",
  },
  leadership: {
    label: "Wiki + press",
    what: "Tenure, prior companies, scandals, and overall stability of the C-suite.",
    source: "Wikipedia bios + Google News mentions per executive.",
    method: "Claude Sonnet 4 narrative + flag extraction.",
    freshness: "Wikipedia: live · press mentions: last 24 months.",
  },
  synthesizer: {
    label: "Claude synthesis",
    what: "Final BUY/HOLD/AVOID verdict, confidence, position size, next-quarter revenue forecast.",
    source: "All analyzer outputs above + every user-provided source.",
    method:
      "Claude Sonnet 4 (Bedrock cross-region inference profile) using the synthesizer system prompt — explicit weighting and citation rules in CLAUDE.md §7.2.",
    freshness: "Re-runs every time you click Re-synthesize or add evidence.",
  },
  panel_forecast: {
    label: "Bunq panel · simulated",
    what: "Aggregated, anonymised Bunq-user spending at the ticker's merchants, used as an alt-data leading indicator for next-quarter revenue.",
    source:
      "backend/fixtures/panel_spend.json (hand-authored monthly aggregates with realistic seasonality).",
    method:
      "YoY / QoQ from rolling sums, panel-to-revenue Pearson correlation over 8 backtested quarters, k-anonymity floor N≥500 before publish.",
    freshness: "Trailing 24 months of monthly aggregates.",
    caveat:
      "Simulated for the hackathon prototype. The architecture assumes Bunq would expose an aggregated, opt-in panel API. NL-skewed.",
  },
  bunq_personal: {
    label: "Your Bunq · sandbox",
    what: "Your own payment history at this ticker's merchants — a personal conviction signal alongside the panel.",
    source:
      "Bunq sandbox via /v1/user/{id}/monetary-account/{aid}/payment, joined against ticker → merchant aliases.",
    method:
      "Aggregated client-side per ticker; passed to Claude for the trend narrative. Never written to disk.",
    freshness: "Last 12 months of sandbox transactions.",
    caveat:
      "Bunq sandbox seed data — payments are fixture-seeded for the demo, not real spend.",
  },
  bunq_accounts: {
    label: "Bunq sandbox",
    what: "Live list of every monetary account you own — Main, the default Investment Pot, plus any per-ticker pot the /invest flow created.",
    source: "Bunq sandbox /v1/user/{id}/monetary-account.",
    method:
      "Cancelled accounts dropped, sorted Main → default pot → ticker pots alphabetically.",
    freshness: "Pulled live on every dashboard load.",
    caveat: "Sandbox account, not real money.",
  },
  bunq_payments: {
    label: "Bunq activity",
    what: "Recent payments across all your Bunq accounts.",
    source:
      "Bunq sandbox /v1/user/{id}/monetary-account/{aid}/payment — merged across accounts, sorted newest first.",
    method: "No transformation; raw Bunq payment objects normalised to a flat shape.",
    freshness: "Pulled live · 25 most-recent payments by default.",
    caveat: "Sandbox transactions only.",
  },
  bunq_profile: {
    label: "Bunq identity",
    what: "Your Bunq display name, country, language, and avatar.",
    source: "Bunq sandbox /v1/user/{id}.",
    method: "First populated record across UserPerson / UserCompany / UserApiKey.",
    freshness: "Pulled live on first page load per session.",
  },
  geopolitical_overlay: {
    label: "Geopolitical clip",
    what: "Statements from market-moving figures (heads of state, central bankers, regulators) scored for impact on this ticker. Each overlay also carries a verified-human / deepfake check.",
    source:
      "Pre-seeded clip library (yt-dlp from official channels) + live Google News RSS poller for new items. Authenticity registry: WhiteHouse / ECB / EU Commission / IMF / UN / Fed YouTube channel IDs + Reuters / AP / Bloomberg / BBC / FT / WSJ / .gov domains.",
    method:
      "Audio → AWS Transcribe + librosa prosody. Video → ffmpeg 9-frame grid → Claude vision (observable behaviour only). Per-clip relevance + impact scored by Claude. Authenticity = trusted-source check (binary) ⊕ prosody fingerprint (pitch jitter + energy variability + silence fraction); synthesizer down-weights overlays scoring < 0.5 and drops 'likely_synthetic' clips entirely.",
    freshness: "Library: trailing 30 days · live monitor: last 5-min poll.",
  },
  geopolitical_live: {
    label: "Live RSS",
    what: "Curated Google News queries that surface fresh statements from market-moving figures.",
    source:
      "Google News RSS — Trump / Powell / Lagarde / EU Commission / China-MOFCOM / OPEC queries (backend/scrapers/geopolitical_monitor.py).",
    method:
      "20 hits per query; trusted outlets sorted first; analyzer filters for ticker relevance.",
    freshness: "Last 7 days, fetched at analysis time.",
  },
  user_source: {
    label: "User-provided",
    what: "Evidence you uploaded — URL, pasted text, image, PDF, video, or audio.",
    source: "Your input, ingested via /evidence or /evidence/upload.",
    method:
      "URLs → httpx + selectolax. PDFs → PyMuPDF. Audio/Video → ffmpeg + AWS Transcribe. Images → Claude vision. All wrapped in <user_source> tags so injected instructions are ignored.",
    freshness: "Whatever you submit, when you submit it.",
    caveat:
      "Cap: ≤20% combined weight in the synthesizer; regulatory filings win on conflict.",
  },
  spending_insights: {
    label: "Your Bunq · personal",
    what: "Monthly spend, category breakdown, top merchants, ticker matches, and discovery suggestions.",
    source:
      "Bunq sandbox seed payments (backend/fixtures/bunq_user_payments.json) joined against the merchant-alias map.",
    method:
      "Pure-Python aggregation; ticker discovery suggests peers in categories you spend in but don't yet hold.",
    freshness: "Trailing 12 months of fixture transactions. Seed data — not real spend, but representative of a Bunq user's wallet.",
  },
  trending: {
    label: "Cross-user search history",
    what: "What other Sauron users have analysed in the last N hours.",
    source:
      "AnalysisRun rows in our SQLite (every /analyze call appends one row).",
    method:
      "Group-by ticker, count + most-recent-verdict + a price sparkline pulled from yfinance.",
    freshness: "Configurable window; 24h by default.",
  },
  nearby: {
    label: "GPS · HQ registry",
    what: "Listed companies near you — HQs and major offices we've geocoded by hand.",
    source:
      "backend/location/hq_registry.json (hand-authored ~30 EU/US tickers with lat/lng).",
    method:
      "Browser navigator.geolocation → haversine ranking against the registry.",
    freshness: "Registry static; coords live on each tap.",
    caveat: "Session-only; GPS coords never stored.",
  },
  price_chart: {
    label: "yfinance OHLCV",
    what: "Interactive close-price chart for the ticker.",
    source: "Yahoo Finance daily bars via yfinance.",
    method: "Recharts area chart over the most recent 252 trading days.",
    freshness: "Daily bars; refreshed when you reopen the page.",
  },
  panel_chart: {
    label: "Bunq panel · simulated",
    what: "12-month line chart of YoY Bunq-panel spend at the ticker's merchants.",
    source: "backend/fixtures/panel_spend.json.",
    method:
      "Monthly aggregate vs same-month prior year. K-anonymity floor N≥500.",
    freshness: "Trailing 12 months of monthly fixture aggregates.",
    caveat: "Simulated for the hackathon prototype.",
  },
  ipo_calendar: {
    label: "IPO briefs",
    what: "Curated late-stage private companies tracked toward an expected IPO.",
    source:
      "backend/fixtures/ipos.json (hand-authored briefs) + a Claude-generated thesis on demand.",
    method: "Claude Sonnet 4 generates bull/bear/fair-value live per slug.",
    freshness: "Briefs static; thesis re-runs on each open.",
  },
  ipo_filings: {
    label: "SEC EDGAR",
    what: "Recent S-1 / S-1/A registration statements from the live SEC feed.",
    source:
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent atom feed (no API key required).",
    method: "Filtered to S-1 forms; deduped by CIK; newest first.",
    freshness: "SEC's own near-real-time atom feed.",
  },
  object_scan: {
    label: "Camera · Claude vision",
    what: "Branded products, logos, store fronts, vehicles or labels visible in your photo, mapped to the publicly listed parent company + ticker.",
    source:
      "Image captured live from your device camera (or an uploaded photo) — sent to Claude Sonnet 4 vision via Bedrock.",
    method:
      "Image is compressed client-side, then Claude Sonnet 4 vision returns a structured list of detections; brands without an explicit ticker are reverse-looked-up against the merchant-alias map.",
    freshness: "Single-shot at capture time. Re-run on each new photo.",
  },
  receipt_scan: {
    label: "Receipt OCR · Claude vision + Bunq",
    what: "Line items, totals, brands, and the publicly traded parent owners parsed from your receipt photo. Recent receipts also unlock a per-item bill-split with one-click Bunq payment requests.",
    source:
      "Image you uploaded → Claude Sonnet 4 vision via Bedrock. Bill-split requests fire through the Bunq sandbox /v1/user/{id}/monetary-account/{aid}/request-inquiry endpoint with EMAIL counterparties.",
    method:
      "Claude returns structured JSON (items, qty, prices, brand, parent ticker). Brand→ticker resolution is double-checked against the curated merchant-alias map. Per-item ticker spend is aggregated into the breakdown chart. Splits divide each line equally among the participants you check, with optional proportional tax/fee distribution.",
    freshness: "Single-shot at upload time. Recency for split-eligibility = within the last 7 days.",
    caveat:
      "Bunq sandbox accepts arbitrary EMAIL counterparties — in production each request would actually email the recipient a tap-to-pay link.",
  },
  index_options: {
    label: "Index membership · curated",
    what: "Major indices the analysed ticker belongs to, with one-click access to the cheapest tradeable ETF proxies for each — so you can compare 'own this stock' vs 'own the basket it sits in'.",
    source:
      "Hand-curated index → constituents map covering the analysis universe (S&P 500, Nasdaq-100, Dow, AEX, EURO STOXX 50, FTSE 100, DAX, MSCI World) and their most popular tracker ETFs.",
    method:
      "Reverse-lookup: input ticker → all indices that contain it → ETF proxies sorted by expense ratio (cheapest first).",
    freshness: "Static fixture; refreshed when the analysis universe changes.",
    caveat:
      "Demo-grade fixture; in production this would be backed by a paid index-constituents data feed.",
  },
  rebalance: {
    label: "Spend × position cross-tab",
    what: "Per-ticker comparison of how much you've spent at the company's merchants vs how much you've invested in the ticker. Surfaces alignment gaps as actionable rebalance suggestions.",
    source:
      "Your Bunq spending insights (12-month sandbox payments matched to merchant aliases) cross-joined with your Sauron Investment rows + most-recent AnalysisRun verdict per ticker.",
    method:
      "Per-ticker classification: underweight (invested < spend × 0.5 AND spend ≥ €50), aligned (invested ∈ [spend×0.5, spend×5]), overweight (invested > spend × 5), position_only (invested but no matching spend). Suggested delta = max(spend − invested) for underweight rows.",
    freshness: "Pulled live on dashboard load.",
    caveat:
      "This is a wallet-conviction signal, not financial advice. Suggested deltas are informational; you decide whether to act.",
  },
  map: {
    label: "Map · HQ pins · per-user overlay",
    what: "Every covered HQ as a pin on an OpenStreetMap basemap, coloured by your most-recent verdict (or grey if not yet analysed) and sized by how much you've spent at that company.",
    source:
      "backend/location/hq_registry.json (curated lat/lng for ~30 EU/US tickers) + your AnalysisRun + Investment + spending-insights rows server-side.",
    method:
      "GET /locations/hqs builds an enriched list per request; the map renders react-leaflet CircleMarkers with verdict-coloured fill and a log-scaled radius for spend.",
    freshness: "HQ registry static; verdicts + spend pulled live on each map load.",
  },
  earnings_copilot: {
    label: "Earnings call · Claude live-scoring",
    what: "Per-chunk tone, hedging, commitments, and tone-shift flags from the earnings call's transcript, streamed in real time as Claude reads through the call.",
    source:
      "YouTube URL → yt-dlp pulls bestaudio → AWS Transcribe (single batch job, polled with progress) → transcript split into ~220-word windows → Claude Sonnet 4 scores each window with rolling-baseline context.",
    method:
      "The transcribe step is a one-time batch cost; the analysis itself streams chunk-by-chunk so tone shifts surface as Claude reads forward. Each chunk is scored against the rolling average so 'hedging' shows up only when it's elevated relative to baseline.",
    freshness: "Whatever's on YouTube — works on completed earnings calls and live streams (live mode pulls what's available as the recording extends).",
    caveat:
      "Demo-grade: transcribe is batch (not streaming), and for very long calls we cap at ~30 chunks to keep the Claude bill bounded.",
  },
  newsroom: {
    label: "Newsroom · Reuters / Bloomberg / AP / WSJ / FT / Yahoo / CNBC",
    what: "Live wire-service headlines polled from a curated set of trusted financial outlets, with each item tagged against your watchlist (every ticker you've analysed or invested in).",
    source:
      "Google News RSS with site-filter queries (site:reuters.com, site:bloomberg.com, site:apnews.com, site:wsj.com, site:ft.com, site:finance.yahoo.com, site:cnbc.com).",
    method:
      "One process-wide background poller every 90s, dedupe by URL hash, fan-out via SSE to subscribed clients. Watchlist matching is a fast word-boundary text match on title+snippet against ticker symbols + company names + sub-brand aliases (Magnum → UNA.AS).",
    freshness: "Polled every 90s. Snapshot first, then live updates while connected.",
  },
  pulse_check: {
    label: "Public sentiment · multi-source",
    what: "Recent retail-investor chatter and news coverage about this ticker, scored for sentiment + likely market impact.",
    source:
      "Reddit (r/wallstreetbets, r/stocks, r/investing) public JSON API · StockTwits messages stream · Hacker News Algolia search · Google News RSS / NewsAPI.",
    method:
      "Posts merged + ranked by platform score, top ~60 fed to Claude Sonnet 4 for stance tagging, theme extraction, and a market-impact direction/magnitude/horizon read.",
    freshness: "Pulled live on demand; per-source windows: Reddit ~30 days, StockTwits ~recent, HN all-time, news 30 days.",
    caveat:
      "Retail forums can be echo chambers and contain coordinated hype — Claude is instructed to flag thin / noisy chatter, but treat magnitude as a sentiment indicator, not fundamentals.",
  },
  verdict: {
    label: "Synthesised verdict",
    what: "BUY/HOLD/AVOID + confidence + suggested position size + next-quarter revenue direction.",
    source: "Synthesizer aggregates every module and user source above.",
    method:
      "Claude Sonnet 4 with explicit weighting rules (CLAUDE.md §7.2). Cited modules in [brackets] inside the narrative.",
    freshness: "Re-runs whenever you re-synthesize or add new evidence.",
    caveat: "Not financial advice. Sandbox / paper-trading only.",
  },
};

interface DataProvenanceProps {
  kind: ProvenanceKind;
  /** Optional override that augments the registry's freshness line. */
  detail?: string;
  /** Pin to the top of a card vs inline next to a heading. */
  variant?: "tag" | "inline";
  /** If set, overrides the registry entry's strings — useful for kinds
   *  that can be sourced live OR simulated depending on runtime conditions
   *  (e.g. the consumer panel falling back to fixture when sandbox is thin). */
  override?: Partial<ProvenanceMeta>;
}

export function DataProvenance({
  kind,
  detail,
  variant = "tag",
  override,
}: DataProvenanceProps) {
  const baseMeta = REGISTRY[kind];
  const meta: ProvenanceMeta | undefined = baseMeta
    ? override
      ? { ...baseMeta, ...override }
      : baseMeta
    : undefined;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placeRight: boolean } | null>(
    null
  );
  const ref = useRef<HTMLSpanElement>(null);
  const open = hovered || focused;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocused(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Position the portal popover relative to the trigger; flip horizontally
  // when it would clip the right edge of the viewport.
  useLayoutEffect(() => {
    if (!open || !ref.current) {
      setPos(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    // 360px keeps each provenance row to ~3 lines max — wide enough to
    // breathe but narrow enough that the popover doesn't dominate the
    // surface it's annotating.
    const POPOVER_W = 360;
    const margin = 12;
    const wantLeft = rect.left;
    const overflowsRight =
      wantLeft + POPOVER_W > window.innerWidth - margin;
    setPos({
      top: rect.bottom + 6,
      left: overflowsRight
        ? Math.max(margin, rect.right - POPOVER_W)
        : wantLeft,
      placeRight: overflowsRight,
    });
  }, [open]);

  if (!meta) return null;

  const tone = meta.caveat ? "caveat" : "neutral";
  return (
    <span
      ref={ref}
      className={
        variant === "tag"
          ? "relative inline-flex max-w-full items-center gap-1.5"
          : "relative inline-flex items-center gap-1"
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Data provenance: ${meta.label}`}
        className="inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
        style={{
          background:
            tone === "caveat"
              ? "rgba(255,183,77,0.10)"
              : "var(--bunq-surface-2)",
          color:
            tone === "caveat"
              ? "var(--bunq-warn)"
              : "var(--bunq-faint)",
          border: `1px solid ${
            tone === "caveat"
              ? "rgba(255,183,77,0.25)"
              : "var(--bunq-border)"
          }`,
        }}
      >
        <span aria-hidden style={{ opacity: 0.8 }}>
          {tone === "caveat" ? "▲" : "◇"}
        </span>
        <span className="truncate">data · {meta.label}</span>
        {detail && (
          <span className="ml-0.5 truncate opacity-70">· {detail}</span>
        )}
        <span aria-hidden className="opacity-70">
          ⓘ
        </span>
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            // z-[9999] sits above leaflet (which uses 400-700) and any
            // late-mount overlay we might add — the portal puts us at
            // document.body so we don't inherit a clipping context.
            className="pointer-events-none fixed z-[9999] rounded-xl p-3.5"
            style={{
              top: pos.top,
              left: pos.left,
              width: 360,
              // Fully opaque so page text never bleeds through. The
              // earlier 0.97 + backdrop-blur combo looked broken on dense
              // intro paragraphs (text on either side of the 360px
              // popover read like the popover itself was transparent).
              background: "var(--bunq-surface)",
              border: "1px solid var(--bunq-border-strong)",
              boxShadow:
                "0 24px 48px -8px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,0,0,0.55)",
            }}
          >
            {/* The chip below the trigger already shows meta.label, so we
             *  drop the redundant header in here and lead with WHAT. */}
            <ProvRow label="what" body={meta.what} />
            <ProvRow label="source" body={meta.source} />
            <ProvRow label="method" body={meta.method} />
            <ProvRow label="freshness" body={meta.freshness} />
            {meta.caveat && (
              <ProvRow label="caveat" body={meta.caveat} tone="caveat" />
            )}
            {meta.docs && (
              <a
                href={meta.docs.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block font-mono text-[10px] underline decoration-dotted"
                style={{ color: "var(--bunq-green)" }}
              >
                {meta.docs.label} ↗
              </a>
            )}
          </div>,
          document.body
        )}
    </span>
  );
}

function ProvRow({
  label,
  body,
  tone,
}: {
  label: string;
  body: string;
  tone?: "caveat";
}) {
  return (
    <span className="mt-1.5 block">
      <span
        className="font-mono text-[9px] uppercase tracking-[0.18em]"
        style={{
          color:
            tone === "caveat" ? "var(--bunq-warn)" : "var(--bunq-faint)",
        }}
      >
        {label}
      </span>
      <span
        className="ml-1 text-[11px] leading-snug"
        style={{
          color:
            tone === "caveat"
              ? "var(--bunq-warn)"
              : "var(--bunq-text)",
          opacity: tone === "caveat" ? 1 : 0.92,
        }}
      >
        {body}
      </span>
    </span>
  );
}
