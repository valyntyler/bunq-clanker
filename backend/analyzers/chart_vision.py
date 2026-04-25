"""Chart-vision analyzer.

Render a 1-year candlestick + volume chart with mplfinance and feed it to
Claude Sonnet 4 vision for pattern / support / resistance / trend. The PNG
exists only in-memory for the Claude call — we don't upload or display it,
because the frontend renders an interactive Recharts price chart instead.
"""

from __future__ import annotations

from backend.llm import call_claude_json
from backend.models import Section
from backend.scrapers.yahoo import render_candlestick_png

SYSTEM = (
    "You are a technical analyst. You will be shown a 1-year candlestick + "
    "volume chart for one ticker. Identify observable price patterns, "
    "support/resistance levels, trend direction, and any technical red flags "
    "(breakdown, blow-off top, distribution). Do not hallucinate numbers that "
    "you cannot read off the chart. If uncertain, say so. Return a score "
    "on -1..+1 where positive means the technicals favor the long side over "
    "the next 1-3 months."
)


def analyze_chart(symbol: str) -> Section:
    png = render_candlestick_png(symbol, period="1y")
    user = f"""Analyze the 1-year candlestick chart for {symbol}.

Return STRICT JSON with keys:
  score: number -1..+1
  summary: string (one sentence fit for a retail dashboard)
  trend: "uptrend" | "downtrend" | "sideways"
  patterns: string[] (e.g. "ascending triangle", "bearish engulfing", "double top"; max 3)
  support: string (approximate price level or range, with currency if visible)
  resistance: string (approximate price level or range)
  technical_verdict: "bullish" | "neutral" | "bearish"
"""
    out = call_claude_json(user, system=SYSTEM, images=[png], max_tokens=600)
    return Section(
        score=float(out["score"]),
        summary=out["summary"],
        sources=[f"yfinance:{symbol}:ohlcv-1y"],
        extra={
            # Note: image_url intentionally absent — the frontend renders an
            # interactive Recharts price chart from /chart-data instead.
            "trend": out.get("trend"),
            "patterns": out.get("patterns", []),
            "support": out.get("support"),
            "resistance": out.get("resistance"),
            "technical_verdict": out.get("technical_verdict"),
        },
    )
