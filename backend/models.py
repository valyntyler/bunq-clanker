"""Pydantic schemas mirroring the §8 report JSON. Strict on the top level,
permissive inside `sections` so analyzers can add fields without breaking the UI.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Verdict = Literal["BUY", "HOLD", "AVOID"]
Direction = Literal["beat", "in-line", "miss"]


class Section(BaseModel):
    score: float = Field(ge=-1, le=1)
    summary: str
    sources: list[str] = []
    # analyzers may attach extra fields (image_url, transcript_excerpt, …)
    extra: dict[str, Any] = {}


class GeopoliticalOverlay(BaseModel):
    event_id: str
    speaker: str
    clip_url: str | None = None
    relevance: float = Field(ge=0, le=1)
    impact_direction: int = Field(ge=-1, le=1)
    impact_magnitude: float = Field(ge=0, le=1)
    transcript_excerpt: str = ""
    tone_notes: str = ""
    visual_notes: str = ""
    reasoning: str


class UserSource(BaseModel):
    source_id: str
    source_type: Literal["url", "text", "image", "pdf", "video", "audio"]
    origin: str | None = None
    user_note: str = ""
    user_tag: Literal["supporting", "contradicting", "neutral"] = "neutral"
    score: float = Field(ge=-1, le=1)
    summary: str
    key_claims: list[str] = []
    trust_level: Literal["high", "medium", "low"] = "medium"


class BunqSpendingOverlay(BaseModel):
    total_spent_12m_eur: float
    visit_count: int
    last_visit: str
    trend: Literal["accelerating", "flat", "declining"]
    personal_conviction_score: float = Field(ge=-1, le=1)
    summary: str
    geo_signal: str = ""


class NextQuarter(BaseModel):
    revenue_direction: Direction
    vs_consensus_pct: str
    confidence: float = Field(ge=0, le=1)


class ConsumerPanelForecast(BaseModel):
    panel_size_n: int
    yoy_change_pct: float
    qoq_change_pct: float
    trend: Literal["accelerating", "flat", "declining"]
    historical_correlation: float
    next_quarter: NextQuarter
    chart_url: str | None = None
    merchant_aliases: list[str] = []
    disclaimer: str = (
        "Aggregated, anonymized. Panel is NL-skewed. Simulated for hackathon prototype."
    )


class LocationContext(BaseModel):
    used: bool = False
    detected_at: str | None = None
    coords: tuple[float, float] | None = None


class Citation(BaseModel):
    id: str
    title: str
    url: str | None = None


class Report(BaseModel):
    ticker: str
    company_name: str
    generated_at: str
    verdict: Verdict
    confidence: float = Field(ge=0, le=1)
    position_size_pct: float = Field(ge=0, le=10)
    one_liner: str
    sections: dict[str, Section]
    geopolitical_overlays: list[GeopoliticalOverlay] = []
    user_sources: list[UserSource] = []
    bunq_spending_overlay: BunqSpendingOverlay | None = None
    consumer_panel_forecast: ConsumerPanelForecast | None = None
    location_context: LocationContext = LocationContext()
    risks: list[str] = []
    conflicts: list[str] = []
    data_gaps: list[str] = []
    citations: list[Citation] = []
    disclaimer: str = (
        "This is a hackathon prototype. Nothing here is financial advice. "
        "All money movement is in sandbox/paper environments."
    )


class NearbyTicker(BaseModel):
    ticker: str
    name: str
    distance_m: float
    lat: float
    lng: float
    type: str


class AnalyzeRequest(BaseModel):
    ticker: str
    lat: float | None = None
    lng: float | None = None


class EvidenceRequest(BaseModel):
    ticker: str
    company_name: str | None = None
    source_type: Literal["url", "text"]
    url: str | None = None
    text: str | None = None
    user_note: str = ""
    user_tag: Literal["supporting", "contradicting", "neutral"] = "neutral"


class ResynthesizeRequest(BaseModel):
    """Re-run the synthesizer with the original module outputs + a new
    user_sources list, without paying for a full pipeline re-run.
    """

    ticker: str
    company_name: str
    sections: dict[str, Section]
    consumer_panel_forecast: ConsumerPanelForecast | None = None
    bunq_spending_overlay: BunqSpendingOverlay | None = None
    geopolitical_overlays: list[GeopoliticalOverlay] = []
    user_sources: list[UserSource] = []
    location_context: LocationContext = LocationContext()


class InvestRequest(BaseModel):
    ticker: str
    amount_eur: float = Field(gt=0)
    report_id: str | None = None


class InvestReceipt(BaseModel):
    bunq_payment_id: str | None
    alpaca_order_id: str | None
    ticker: str
    amount_eur: float
    amount_usd: float
    shares: float
    timestamp: str
    verdict_snapshot: dict
