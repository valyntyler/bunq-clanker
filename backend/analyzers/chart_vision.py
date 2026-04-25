"""Chart-vision analyzer.

Render a 5-year candlestick + volume chart with mplfinance and feed it to
Claude Sonnet 4 vision for the long-arc trend, pattern, support/resistance.
Five years is long enough to span multiple cycles (covid drawdown, post-2022
rate regime, recent recovery) so the technical read isn't dominated by the
last few weeks of noise.
"""

from __future__ import annotations

from backend.llm import call_claude_json
from backend.models import Section
from backend.scrapers.yahoo import render_candlestick_png

SYSTEM = (
    "You are a technical analyst with a multi-year time horizon. You will be "
    "shown a 5-year candlestick + volume chart for one ticker. Identify the "
    "DOMINANT long-arc trend (multi-year, not last-month noise), key "
    "support/resistance levels, and any structural technical red flags "
    "(major breakdown of a multi-year support, secular distribution, secular "
    "reaccumulation). Do not hallucinate numbers you cannot read off the "
    "chart. Return a score on -1..+1 where positive means the long-arc "
    "technicals favor the long side over the next 12-24 months. Be willing "
    "to take a directional view — neutral is only for genuinely sideways "
    "multi-year price action."
)


def analyze_chart(symbol: str) -> Section:
    png = render_candlestick_png(symbol, period="5y")
    user = f"""Analyze the 5-year candlestick chart for {symbol}.

Return STRICT JSON with keys:
  score: number -1..+1   (long-arc 12-24 month directional view)
  summary: string        (one sentence fit for a retail dashboard, framed at the multi-year horizon)
  trend: "uptrend" | "downtrend" | "sideways"
  patterns: string[]     (e.g. "multi-year ascending channel", "secular breakout", "head and shoulders"; max 3)
  support: string        (key multi-year support — price level or range, with currency if visible)
  resistance: string     (key multi-year resistance)
  technical_verdict: "bullish" | "neutral" | "bearish"
"""
    out = call_claude_json(user, system=SYSTEM, images=[png], max_tokens=600)
    return Section(
        score=float(out["score"]),
        summary=out["summary"],
        sources=[f"yfinance:{symbol}:ohlcv-5y"],
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
