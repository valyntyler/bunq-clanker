// Backend base URL. In dev we hit FastAPI on :8080 directly.
// Override with NEXT_PUBLIC_BACKEND_URL in .env.local if backend lives elsewhere.
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";

export type Verdict = "BUY" | "HOLD" | "AVOID";
export type Direction = "beat" | "in-line" | "miss";
export type Trend = "accelerating" | "flat" | "declining";

export interface Section {
  score: number;
  summary: string;
  sources?: string[];
  extra?: Record<string, unknown>;
}

export interface NextQuarter {
  revenue_direction: Direction;
  vs_consensus_pct: string;
  confidence: number;
}

export interface ConsumerPanelForecast {
  panel_size_n: number;
  yoy_change_pct: number;
  qoq_change_pct: number;
  trend: Trend;
  historical_correlation: number;
  next_quarter: NextQuarter;
  chart_url?: string | null;
  merchant_aliases?: string[];
  disclaimer?: string;
}

export interface BunqSpendingOverlay {
  total_spent_12m_eur: number;
  visit_count: number;
  last_visit: string;
  trend: Trend;
  personal_conviction_score: number;
  summary: string;
  geo_signal?: string;
}

export interface GeopoliticalOverlay {
  event_id: string;
  speaker: string;
  clip_url?: string | null;
  relevance: number;
  impact_direction: number;
  impact_magnitude: number;
  transcript_excerpt?: string;
  tone_notes?: string;
  visual_notes?: string;
  reasoning: string;
}

export interface UserSource {
  source_id: string;
  source_type: "url" | "text" | "image" | "pdf" | "video" | "audio";
  origin?: string | null;
  user_note?: string;
  user_tag: "supporting" | "contradicting" | "neutral";
  score: number;
  summary: string;
  key_claims?: string[];
  trust_level: "high" | "medium" | "low";
}

export interface Report {
  ticker: string;
  company_name: string;
  generated_at: string;
  verdict: Verdict;
  confidence: number;
  position_size_pct: number;
  one_liner: string;
  sections: Record<string, Section>;
  geopolitical_overlays: GeopoliticalOverlay[];
  user_sources: UserSource[];
  bunq_spending_overlay: BunqSpendingOverlay | null;
  consumer_panel_forecast: ConsumerPanelForecast | null;
  location_context: {
    used: boolean;
    detected_at: string | null;
    coords: [number, number] | null;
  };
  risks: string[];
  conflicts: string[];
  data_gaps: string[];
  citations: { id: string; title: string; url?: string | null }[];
  disclaimer: string;
}

export interface NearbyTicker {
  ticker: string;
  name: string;
  distance_m: number;
  lat: number;
  lng: number;
  type: string;
}

export interface InvestReceipt {
  bunq_payment_id: string | null;
  alpaca_order_id: string | null;
  ticker: string;
  amount_eur: number;
  amount_usd: number;
  shares: number;
  timestamp: string;
  verdict_snapshot: Record<string, unknown>;
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${await r.text()}`);
  return (await r.json()) as T;
}

export async function analyze(
  ticker: string,
  coords?: { lat: number; lng: number }
): Promise<Report> {
  return j<Report>(
    await fetch(`${BACKEND_URL}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker, lat: coords?.lat, lng: coords?.lng }),
    })
  );
}

export async function nearbyTickers(
  lat: number,
  lng: number,
  radiusM = 5000
): Promise<NearbyTicker[]> {
  return j<NearbyTicker[]>(
    await fetch(
      `${BACKEND_URL}/nearby-tickers?lat=${lat}&lng=${lng}&radius_m=${radiusM}`
    )
  );
}

export interface ValidateTickerResponse {
  ok: boolean;
  name: string | null;
  ticker: string;
}

export async function validateTicker(
  ticker: string
): Promise<ValidateTickerResponse> {
  return j<ValidateTickerResponse>(
    await fetch(
      `${BACKEND_URL}/validate-ticker/${encodeURIComponent(ticker)}`
    )
  );
}

export async function invest(
  ticker: string,
  amountEur: number
): Promise<InvestReceipt> {
  return j<InvestReceipt>(
    await fetch(`${BACKEND_URL}/invest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker, amount_eur: amountEur }),
    })
  );
}

export interface BunqBalance {
  main: number;
  pot: number;
}

export async function bunqBalance(): Promise<BunqBalance> {
  return j<BunqBalance>(await fetch(`${BACKEND_URL}/balance`));
}

export type EvidenceTag = "supporting" | "contradicting" | "neutral";

export interface EvidenceRequest {
  ticker: string;
  company_name?: string;
  source_type: "url" | "text";
  url?: string;
  text?: string;
  user_note?: string;
  user_tag?: EvidenceTag;
}

export async function submitEvidence(
  req: EvidenceRequest
): Promise<UserSource> {
  return j<UserSource>(
    await fetch(`${BACKEND_URL}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    })
  );
}

export interface ResynthesizeRequest {
  ticker: string;
  company_name: string;
  sections: Record<string, Section>;
  consumer_panel_forecast?: ConsumerPanelForecast | null;
  bunq_spending_overlay?: BunqSpendingOverlay | null;
  geopolitical_overlays?: GeopoliticalOverlay[];
  user_sources?: UserSource[];
  location_context?: Report["location_context"];
}

export async function resynthesize(
  req: ResynthesizeRequest
): Promise<Report> {
  return j<Report>(
    await fetch(`${BACKEND_URL}/resynthesize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    })
  );
}

// ---- streaming analyze --------------------------------------------------

export type AnalyzeEvent =
  | { event: "start"; ticker: string; ts: string }
  | { event: "module_start"; name: string; label: string }
  | {
      event: "module_done";
      name: string;
      section?: Section;
      data?: ConsumerPanelForecast | BunqSpendingOverlay | GeopoliticalOverlay[];
      error?: string;
    }
  | { event: "synthesizing" }
  | { event: "report"; report: Report }
  | { event: "error"; message: string };

export async function streamAnalyze(
  ticker: string,
  coords: { lat: number; lng: number } | undefined,
  onEvent: (ev: AnalyzeEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const r = await fetch(`${BACKEND_URL}/analyze/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker, lat: coords?.lat, lng: coords?.lng }),
    signal,
  });
  if (!r.ok || !r.body) {
    throw new Error(`stream failed: ${r.status} ${r.statusText}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      // SSE chunks may have multiple lines; we only emit on `data:`.
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          const payload = line.slice(6).trim();
          if (!payload) continue;
          try {
            onEvent(JSON.parse(payload) as AnalyzeEvent);
          } catch {
            // ignore parse errors, keep streaming
          }
        }
      }
    }
  }
}
