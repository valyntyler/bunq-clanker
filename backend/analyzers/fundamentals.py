"""Fundamentals analyzer. yfinance pull → Claude interpretation → Section.

Cheaper than pulling the full 10-K: yfinance already exposes the material
financials (revenue, margins, debt, growth). 10-K text ingestion comes later
as a richer layer in the 'edgar' scraper + companion analyzer.
"""

from __future__ import annotations

from backend.llm import call_claude_json
from backend.models import Section
from backend.scrapers.yahoo import Fundamentals, fetch_fundamentals

SYSTEM = (
    "You are a sober equity analyst. Given a company's headline financials, "
    "produce a terse interpretation: score the fundamentals on a -1 to +1 scale "
    "(negative = concerning, positive = strong), write a one-sentence summary "
    "fit for a retail dashboard, and list up to 3 red_flags and 3 green_flags. "
    "Cite specific numbers in the flags (e.g. 'revenue growth only 1.2%'). "
    "Do not hallucinate. If a metric is missing, say so instead of guessing."
)


def analyze_fundamentals(symbol: str) -> tuple[Section, Fundamentals]:
    f = fetch_fundamentals(symbol)
    user = f"""{f.to_prompt()}

Return STRICT JSON with keys:
  score: number -1..+1
  summary: string (one sentence)
  red_flags: string[] (<=3)
  green_flags: string[] (<=3)
"""
    out = call_claude_json(user, system=SYSTEM, max_tokens=600)
    return (
        Section(
            score=float(out["score"]),
            summary=out["summary"],
            sources=[f"yfinance:{symbol}"],
            extra={
                "red_flags": out.get("red_flags", []),
                "green_flags": out.get("green_flags", []),
                "metrics": {
                    "price": f.price,
                    "currency": f.currency,
                    "market_cap": f.market_cap,
                    "trailing_pe": f.trailing_pe,
                    "revenue": f.revenue,
                    "revenue_growth": f.revenue_growth,
                    "net_income": f.net_income,
                    "profit_margin": f.profit_margin,
                },
            },
        ),
        f,
    )
