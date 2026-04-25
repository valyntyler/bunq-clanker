// Backend base URL. In dev we hit FastAPI on :8080 directly.
// Override with NEXT_PUBLIC_BACKEND_URL in .env.local if backend lives elsewhere.
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";

// ---- auth header injection ----------------------------------------------
// Read token directly from localStorage rather than importing from auth.ts
// — keeps lib/api.ts safe to use during SSR (where window is undefined).
const TOKEN_KEY = "sauron.token";

function authHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = window.localStorage.getItem(TOKEN_KEY);
  return t ? { authorization: `Bearer ${t}` } : {};
}

/** Bunq fetch wrapper: adds Authorization on every call, handles 401 by
 * dropping the token (so the AuthGuard re-renders to /login). */
async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(authHeader())) headers.set(k, v);
  const r = await fetch(url, { ...init, headers });
  if (r.status === 401 && typeof window !== "undefined") {
    window.localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event("sauron-auth"));
  }
  return r;
}

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
  source?: "live" | "simulated";
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
  source_url?: string | null;
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

export interface IndexProxy {
  ticker: string;
  name: string;
  expense_ratio_bps?: number | null;
}

export interface IndexMembership {
  key: string;
  name: string;
  region: string;
  blurb: string;
  proxies: IndexProxy[];
  rationale: string;
  member_count_demo: number;
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
  index_options: IndexMembership[];
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
  bunq_pot_id: number | null;
  bunq_pot_name: string | null;
  alpaca_order_id: string | null;
  ticker: string;
  amount_eur: number;
  amount_usd: number;
  shares: number;
  timestamp: string;
  verdict_snapshot: Record<string, unknown>;
}

export interface BunqProfile {
  id: number;
  display_name: string;
  public_nick_name: string | null;
  country: string | null;
  language: string | null;
  avatar_url: string | null;
}

export interface BunqAccount {
  id: number;
  description: string;
  currency: string;
  balance: number;
  status: string;
  iban: string | null;
  is_main: boolean;
  is_default_pot: boolean;
  is_ticker_pot: boolean;
  ticker: string | null;
}

export interface BunqAccountsList {
  accounts: BunqAccount[];
  summary: {
    count: number;
    total_eur: number;
    ticker_pots: BunqAccount[];
  };
}

export interface BunqPayment {
  id: number;
  account_id: number;
  amount: number;
  currency: string;
  description: string;
  type: string | null;
  sub_type: string | null;
  counterparty: string;
  created: string | null;
  updated: string | null;
}

export async function meBunqProfile(): Promise<BunqProfile> {
  return j<BunqProfile>(await authFetch(`${BACKEND_URL}/me/bunq/profile`));
}

export async function meBunqAccounts(): Promise<BunqAccountsList> {
  return j<BunqAccountsList>(
    await authFetch(`${BACKEND_URL}/me/bunq/accounts`)
  );
}

export async function meBunqActivity(opts?: {
  accountId?: number;
  count?: number;
}): Promise<{ payments: BunqPayment[] }> {
  const qs = new URLSearchParams();
  if (opts?.accountId !== undefined) qs.set("account_id", String(opts.accountId));
  if (opts?.count !== undefined) qs.set("count", String(opts.count));
  const tail = qs.toString() ? `?${qs}` : "";
  return j(await authFetch(`${BACKEND_URL}/me/bunq/activity${tail}`));
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
    await authFetch(`${BACKEND_URL}/analyze`, {
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
    await authFetch(
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
    await authFetch(
      `${BACKEND_URL}/validate-ticker/${encodeURIComponent(ticker)}`
    )
  );
}

export async function invest(
  ticker: string,
  amountEur: number
): Promise<InvestReceipt> {
  return j<InvestReceipt>(
    await authFetch(`${BACKEND_URL}/invest`, {
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
  return j<BunqBalance>(await authFetch(`${BACKEND_URL}/balance`));
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
    await authFetch(`${BACKEND_URL}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    })
  );
}

export type UploadKind = "image" | "video" | "audio" | "pdf";

export async function uploadEvidence(args: {
  ticker: string;
  companyName?: string;
  sourceType: UploadKind;
  file: File;
  userNote?: string;
  userTag?: EvidenceTag;
}): Promise<UserSource> {
  const fd = new FormData();
  fd.set("ticker", args.ticker);
  if (args.companyName) fd.set("company_name", args.companyName);
  fd.set("source_type", args.sourceType);
  fd.set("user_note", args.userNote ?? "");
  fd.set("user_tag", args.userTag ?? "neutral");
  fd.set("file", args.file);
  return j<UserSource>(
    await authFetch(`${BACKEND_URL}/evidence/upload`, {
      method: "POST",
      body: fd,
    })
  );
}

export type UploadStepStatus = "running" | "done" | "skipped" | "error";
export interface UploadStepEvent {
  step:
    | "compress"
    | "upload"
    | "audio_extract"
    | "frame_grid"
    | "prosody"
    | "transcribe"
    | "pdf_extract"
    | "text_analyze"
    | "vision_claude";
  status: UploadStepStatus;
  detail?: Record<string, unknown>;
}

/** Stream upload: invokes onStep per stage; resolves with the final UserSource. */
export async function uploadEvidenceStream(args: {
  ticker: string;
  companyName?: string;
  sourceType: UploadKind;
  file: File;
  userNote?: string;
  userTag?: EvidenceTag;
  onStep: (ev: UploadStepEvent) => void;
  signal?: AbortSignal;
}): Promise<UserSource> {
  const fd = new FormData();
  fd.set("ticker", args.ticker);
  if (args.companyName) fd.set("company_name", args.companyName);
  fd.set("source_type", args.sourceType);
  fd.set("user_note", args.userNote ?? "");
  fd.set("user_tag", args.userTag ?? "neutral");
  fd.set("file", args.file);

  const r = await authFetch(`${BACKEND_URL}/evidence/upload/stream`, {
    method: "POST",
    body: fd,
    signal: args.signal,
  });
  if (!r.ok || !r.body) {
    throw new Error(`upload stream failed: ${r.status} ${r.statusText}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: UserSource | null = null;
  let error: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.step) {
            args.onStep(ev as UploadStepEvent);
          } else if (ev.result) {
            result = ev.result as UserSource;
          } else if (ev.error) {
            error = ev.error;
          }
        } catch {
          // ignore parse errors
        }
      }
    }
  }
  if (error) throw new Error(error);
  if (!result) throw new Error("upload completed without a result");
  return result;
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

// ---- per-user dashboard endpoints --------------------------------------

export interface InvestmentRow {
  id: string;
  ticker: string;
  company_name: string;
  verdict: string;
  amount_eur: number;
  amount_usd: number;
  fx_rate: number;
  bunq_payment_id: string | null;
  bunq_pot_id: number | null;
  bunq_pot_name: string | null;
  alpaca_order_id: string | null;
  alpaca_symbol: string;
  shares_estimated: number;
  created_at: string;
  alpaca?: {
    status: string;
    filled_qty: number;
    filled_avg_price: number | null;
    submitted_at: string | null;
    filled_at: string | null;
    symbol: string;
    notional: number | null;
  } | null;
  current_price_usd?: number;
  unrealized_pnl_usd?: number;
  unrealized_pnl_pct?: number;
}

export interface InvestmentList {
  investments: InvestmentRow[];
  summary: {
    count: number;
    total_invested_eur: number;
    total_unrealized_pnl_usd: number;
  };
}

export async function meInvestments(enrich = true): Promise<InvestmentList> {
  return j<InvestmentList>(
    await authFetch(`${BACKEND_URL}/me/investments?enrich=${enrich}`)
  );
}

export interface EvidenceRow {
  id: string;
  ticker: string;
  company_name: string | null;
  source_type: string;
  origin: string | null;
  user_note: string;
  user_tag: string;
  score: number;
  summary: string;
  trust_level: string;
  created_at: string;
}

export async function meEvidence(): Promise<{ evidence: EvidenceRow[] }> {
  return j<{ evidence: EvidenceRow[] }>(
    await authFetch(`${BACKEND_URL}/me/evidence`)
  );
}

export interface AnalysisRow {
  id: string;
  ticker: string;
  company_name: string;
  verdict: string;
  confidence: number;
  position_size_pct: number;
  one_liner: string;
  created_at: string;
}

export async function meAnalyses(): Promise<{ analyses: AnalysisRow[] }> {
  return j<{ analyses: AnalysisRow[] }>(
    await authFetch(`${BACKEND_URL}/me/analyses`)
  );
}

export interface SpendingInsights {
  total_eur: number;
  visit_count: number;
  by_month: { month: string; spend_eur: number }[];
  by_category: { category: string; spend_eur: number; count: number }[];
  top_merchants: { merchant: string; spend_eur: number; count: number }[];
  by_ticker: {
    ticker: string;
    spend_eur: number;
    count: number;
    last_visit: string;
    category: string | null;
  }[];
  discovery: {
    ticker: string;
    category: string;
    rationale: string;
    anchor_ticker: string | null;
  }[];
}

export async function meSpending(): Promise<SpendingInsights> {
  return j<SpendingInsights>(await authFetch(`${BACKEND_URL}/me/spending`));
}

export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartDataResponse {
  ticker: string;
  period: string;
  currency: string | null;
  bars: OhlcvBar[];
}

export async function chartData(
  ticker: string,
  period = "1y"
): Promise<ChartDataResponse> {
  return j(
    await authFetch(
      `${BACKEND_URL}/chart-data/${encodeURIComponent(ticker)}?period=${period}`
    )
  );
}

export interface PanelMonth {
  month: string;
  spend_eur: number;
  prior_year_eur: number | null;
}

export async function panelData(
  ticker: string
): Promise<{
  ticker: string;
  panel_size_n: number;
  source?: "live" | "simulated";
  matched_count?: number;
  series: PanelMonth[];
}> {
  return j(
    await authFetch(`${BACKEND_URL}/panel-data/${encodeURIComponent(ticker)}`)
  );
}

// ---- trending (cross-user search history) ------------------------------

export interface TrendingTicker {
  ticker: string;
  company_name: string;
  search_count: number;
  last_at: string | null;
  latest_verdict: "BUY" | "HOLD" | "AVOID" | null;
  latest_confidence: number | null;
  one_liner: string | null;
  spark: number[];
  currency: string | null;
}

export type ChartPeriod =
  | "1d"
  | "5d"
  | "1mo"
  | "3mo"
  | "6mo"
  | "1y"
  | "2y"
  | "5y"
  | "10y"
  | "max";

export async function getTrending(opts?: {
  hours?: number;
  limit?: number;
  sparkPeriod?: ChartPeriod;
}): Promise<{
  as_of: string;
  window_hours: number;
  spark_period?: ChartPeriod;
  trending: TrendingTicker[];
}> {
  const qs = new URLSearchParams();
  if (opts?.hours !== undefined) qs.set("hours", String(opts.hours));
  if (opts?.limit !== undefined) qs.set("limit", String(opts.limit));
  if (opts?.sparkPeriod) qs.set("spark_period", opts.sparkPeriod);
  const url = `${BACKEND_URL}/trending${qs.toString() ? `?${qs}` : ""}`;
  return j(await authFetch(url));
}

// ---- pre-IPO calendar ---------------------------------------------------

export interface IpoBrief {
  slug: string;
  company_name: string;
  sector: string;
  hq: string;
  status: string;
  expected_window: string;
  expected_listing: string;
  expected_ticker: string;
  last_private_valuation_usd_b: number;
  last_round_date: string;
  founders: string[];
  summary: string;
  highlights: string[];
  risks: string[];
}

export interface IpoThesis {
  bull_case: string;
  bear_case: string;
  fair_value_usd_b: { low: number; high: number };
  catalysts: string[];
  retail_take: string;
  confidence: number;
}

export interface EdgarFiling {
  title: string;
  company: string;
  form: string;
  cik: string;
  filed_at: string;
  url: string;
  summary: string;
}

export async function listIpos(): Promise<{
  as_of: string;
  disclaimer: string;
  ipos: IpoBrief[];
  recent_filings?: EdgarFiling[];
  recent_filings_source?: string;
}> {
  return j(await authFetch(`${BACKEND_URL}/ipos`));
}

export async function getIpo(
  slug: string
): Promise<{ brief: IpoBrief; thesis: IpoThesis }> {
  return j(
    await authFetch(`${BACKEND_URL}/ipos/${encodeURIComponent(slug)}`)
  );
}

// ---- receipt scan + bill-split ----------------------------------------

export interface ReceiptItem {
  name: string;
  qty: number;
  unit_price: number;
  total_price: number;
  category: string;
  brand: string;
  company: string;
  ticker: string;
  exchange: string;
  is_listed: boolean;
}

export interface ReceiptByTicker {
  ticker: string;
  company: string;
  spend: number;
  items: number;
}

export interface ReceiptResult {
  scanned_at: string;
  image_bytes?: number;
  merchant: string;
  merchant_ticker: string;
  merchant_company: string;
  date: string;
  currency: string;
  country: string;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  total: number;
  confidence: number;
  notes: string;
  by_ticker: ReceiptByTicker[];
  listed_total: number;
  is_recent: boolean;
}

export async function scanReceipt(file: File | Blob): Promise<ReceiptResult> {
  const fd = new FormData();
  if (file instanceof File) fd.set("file", file);
  else fd.set("file", file, "receipt.jpg");
  return j<ReceiptResult>(
    await authFetch(`${BACKEND_URL}/receipts/scan`, {
      method: "POST",
      body: fd,
    })
  );
}

export interface SplitParticipant {
  name: string;
  email: string;
  amount_eur: number;
}

export interface SplitResult {
  merchant: string;
  currency: string;
  sent_at: string;
  results: {
    name: string;
    email: string;
    amount_eur: number;
    request_id: string | null;
    error: string | null;
  }[];
}

export async function sendSplitRequests(args: {
  merchant: string;
  currency: string;
  participants: SplitParticipant[];
}): Promise<SplitResult> {
  return j<SplitResult>(
    await authFetch(`${BACKEND_URL}/receipts/split/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    })
  );
}

// ---- live newsroom feed ----------------------------------------------

export interface NewsroomItem {
  id: string;
  title: string;
  source: string;
  url: string;
  published: string;
  snippet: string;
  fetched_at: string;
  /** Subset of the user's watchlist this headline matched. */
  tickers: string[];
}

export async function newsroomRecent(
  limit = 30
): Promise<{ as_of: string; items: NewsroomItem[]; watchlist: string[] }> {
  return j(
    await authFetch(`${BACKEND_URL}/news/recent?limit=${limit}`)
  );
}

/** SSE consumer: fires onItem for each cached item, then for every new
 *  headline as the poller picks it up. `fresh: true` indicates the item
 *  arrived during this stream session (not part of the initial backlog).
 *  Returns a Promise that only resolves on close. */
export async function streamNewsroom(args: {
  onItem: (item: NewsroomItem, fresh: boolean) => void;
  onlyWatchlist?: boolean;
  limitInitial?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const r = await authFetch(`${BACKEND_URL}/news/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      only_watchlist: args.onlyWatchlist ?? false,
      limit_initial: args.limitInitial ?? 20,
    }),
    signal: args.signal,
  });
  if (!r.ok || !r.body) {
    throw new Error(`news stream failed: ${r.status} ${r.statusText}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.item) args.onItem(ev.item as NewsroomItem, !!ev.fresh);
        } catch {
          // ignore parse errors
        }
      }
    }
  }
}

// ---- pulse-check: public-sentiment scrape + Claude analysis ----------

export type SentimentStance = "bullish" | "bearish" | "neutral";

export interface SentimentPost {
  source: "reddit" | "stocktwits" | "hackernews" | "news";
  subforum: string;
  title: string;
  body: string;
  url: string;
  author: string;
  posted_at: string;
  score: number;
  stance?: SentimentStance | null;
  why?: string | null;
}

export interface SentimentTheme {
  label: string;
  stance: SentimentStance;
  support_count: number;
  summary: string;
}

export interface SentimentResult {
  summary: string;
  aggregate_score: number;
  bullish_pct: number;
  bearish_pct: number;
  neutral_pct: number;
  themes: SentimentTheme[];
  market_impact: {
    direction: SentimentStance;
    magnitude: number;
    horizon: "near-term" | "medium-term" | "long-term";
    reasoning: string;
  };
  caveats: string[];
  posts: SentimentPost[];
  post_count: number;
  by_source: Record<string, number>;
}

export type SentimentStepStatus = "running" | "done" | "error";

export interface SentimentStepEvent {
  step: "reddit" | "stocktwits" | "hackernews" | "news" | "analyze";
  status: SentimentStepStatus;
  detail?: Record<string, unknown>;
}

export async function streamSentiment(args: {
  ticker: string;
  companyName?: string;
  onStep: (ev: SentimentStepEvent) => void;
  signal?: AbortSignal;
}): Promise<SentimentResult> {
  const r = await authFetch(
    `${BACKEND_URL}/sentiment/${encodeURIComponent(args.ticker)}/stream`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company_name: args.companyName }),
      signal: args.signal,
    }
  );
  if (!r.ok || !r.body) {
    throw new Error(`sentiment stream failed: ${r.status} ${r.statusText}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SentimentResult | null = null;
  let error: string | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.step) args.onStep(ev as SentimentStepEvent);
          else if (ev.result) result = ev.result as SentimentResult;
          else if (ev.error) error = ev.error;
        } catch {
          // ignore parse errors
        }
      }
    }
  }
  if (error) throw new Error(error);
  if (!result) throw new Error("sentiment stream completed without a result");
  return result;
}

// ---- camera scan: image → product → company → ticker -----------------

export interface WalletSignal {
  matched: boolean;
  total_spent_eur: number;
  visit_count: number;
  last_visit: string | null;
  days_since_last: number | null;
  trend: "accelerating" | "flat" | "declining";
  monthly_counts: number[];
  relationship: "loyal" | "regular" | "occasional" | "none";
  relationship_label: string;
  merchant_aliases: string[];
  source: string;
  live_total_eur: number;
  live_count: number;
  fixture_total_eur: number;
  fixture_count: number;
  top_city: string | null;
}

export interface ScanBox {
  x: number;  // fractions of image width  (0..1)
  y: number;  // fractions of image height (0..1)
  w: number;
  h: number;
}

export interface ScanDetection {
  object: string;
  brand: string;
  company: string;
  ticker: string;
  exchange: string;
  parent_relationship: string;
  is_subbrand: boolean;
  confidence: number;
  rationale: string;
  investment_take: string;
  is_listed: boolean;
  wallet: WalletSignal | null;
  box: ScanBox | null;
}

export interface ScanResult {
  scanned_at: string;
  image_bytes?: number;
  scene_summary: string;
  detections: ScanDetection[];
}

export async function scanImage(file: File | Blob): Promise<ScanResult> {
  const fd = new FormData();
  // FormData wants a filename for File; coerce Blob to a stable name.
  if (file instanceof File) {
    fd.set("file", file);
  } else {
    fd.set("file", file, "scan.jpg");
  }
  return j<ScanResult>(
    await authFetch(`${BACKEND_URL}/scan`, {
      method: "POST",
      body: fd,
    })
  );
}

// ---- live YouTube search for geopolitical clips ------------------------

export interface YouTubeSearchResult {
  id: string;
  title: string;
  channel: string;
  url: string;
  thumbnail: string | null;
  duration_s: number | null;
  view_count: number | null;
  upload_date: string | null;
}

export async function searchClips(
  query: string,
  maxResults = 10
): Promise<{ query: string; results: YouTubeSearchResult[] }> {
  return j(
    await authFetch(
      `${BACKEND_URL}/geopolitical/search?q=${encodeURIComponent(query)}&max_results=${maxResults}`
    )
  );
}

/** Stream-ingest a YouTube URL into the analysis as a UserSource.
 *  Calls onStep per stage (yt_dlp → audio_extract → prosody → frame_grid →
 *  transcribe → vision_claude); resolves with the final UserSource. */
export async function ingestUrlStream(args: {
  url: string;
  ticker: string;
  companyName?: string;
  startS?: number;
  durationS?: number;
  userNote?: string;
  userTag?: EvidenceTag;
  onStep: (ev: UploadStepEvent) => void;
  signal?: AbortSignal;
}): Promise<UserSource> {
  const r = await authFetch(`${BACKEND_URL}/evidence/from-url/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: args.url,
      ticker: args.ticker,
      company_name: args.companyName,
      start_s: args.startS ?? 0,
      duration_s: args.durationS ?? 60,
      user_note: args.userNote ?? "",
      user_tag: args.userTag ?? "neutral",
    }),
    signal: args.signal,
  });
  if (!r.ok || !r.body) throw new Error(`ingest failed: ${r.status}`);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: UserSource | null = null;
  let error: string | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.step) args.onStep(ev as UploadStepEvent);
          else if (ev.result) result = ev.result as UserSource;
          else if (ev.error) error = ev.error;
        } catch {
          // ignore parse errors
        }
      }
    }
  }
  if (error) throw new Error(error);
  if (!result) throw new Error("ingest completed without a result");
  return result;
}

export interface CachedReportResponse {
  ticker: string;
  generated_at: string;
  age_s: number;
  report: Report;
}

export async function getCachedReport(
  ticker: string
): Promise<CachedReportResponse | null> {
  const r = await authFetch(
    `${BACKEND_URL}/me/reports/${encodeURIComponent(ticker)}/latest`
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export async function clearCachedReport(ticker: string): Promise<void> {
  await authFetch(`${BACKEND_URL}/me/reports/${encodeURIComponent(ticker)}`, {
    method: "DELETE",
  });
}

export async function downloadReportPdf(report: Report): Promise<Blob> {
  const r = await authFetch(`${BACKEND_URL}/report/pdf`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  });
  if (!r.ok) throw new Error(`pdf failed: ${r.status} ${r.statusText}`);
  return r.blob();
}

export async function resynthesize(
  req: ResynthesizeRequest
): Promise<Report> {
  return j<Report>(
    await authFetch(`${BACKEND_URL}/resynthesize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    })
  );
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Streaming chat: invokes onToken with each text chunk; resolves on done. */
export async function chatStream(args: {
  ticker: string;
  report: Report;
  history: ChatTurn[];
  message: string;
  onToken: (s: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const r = await authFetch(`${BACKEND_URL}/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: args.ticker,
      report: args.report,
      history: args.history,
      message: args.message,
    }),
    signal: args.signal,
  });
  if (!r.ok || !r.body) throw new Error(`chat stream failed: ${r.status}`);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const ev = JSON.parse(payload);
          if (typeof ev.token === "string") args.onToken(ev.token);
          if (ev.done) return;
          if (ev.error) throw new Error(ev.error);
        } catch {
          // ignore parse errors
        }
      }
    }
  }
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
  const r = await authFetch(`${BACKEND_URL}/analyze/stream`, {
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
