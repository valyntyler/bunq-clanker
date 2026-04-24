"""Personal Bunq spending overlay (spec §6.7 part B).

Reads the seeded user-payments fixture, filters by the target ticker's merchant
aliases, computes total / visit count / trend, and asks Claude for a tight
one-sentence narrative. Falls back gracefully when no matches are found.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal

from backend.llm import call_claude_json
from backend.models import BunqSpendingOverlay

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


@lru_cache(maxsize=1)
def _payments() -> list[dict]:
    return json.loads((FIXTURES / "bunq_user_payments.json").read_text())


@lru_cache(maxsize=1)
def _aliases() -> dict[str, list[str]]:
    return json.loads((FIXTURES / "merchant_aliases.json").read_text())


def _matches(merchant: str, aliases: list[str]) -> bool:
    m = merchant.lower()
    return any(a.lower() in m for a in aliases)


def _trend_label(monthly_counts: list[int]) -> Literal["accelerating", "flat", "declining"]:
    """Compare the last 3 months vs the first 3 months. Need >=30% delta to flip."""
    if len(monthly_counts) < 6:
        return "flat"
    early = sum(monthly_counts[:3]) / 3
    late = sum(monthly_counts[-3:]) / 3
    if late > early * 1.30:
        return "accelerating"
    if late < early * 0.70:
        return "declining"
    return "flat"


def analyze_personal_spending(ticker: str) -> BunqSpendingOverlay | None:
    aliases = _aliases().get(ticker.upper())
    if not aliases:
        return None

    matched = [p for p in _payments() if _matches(p["merchant"], aliases)]
    if not matched:
        return None

    total = round(sum(p["amount_eur"] for p in matched), 2)
    count = len(matched)
    last_visit = max(p["date"] for p in matched)

    # 12 monthly buckets (oldest..newest)
    by_month: Counter[str] = Counter()
    for p in matched:
        by_month[p["date"][:7]] += 1
    months_sorted = sorted(by_month.keys())
    monthly_counts = [by_month[m] for m in months_sorted]
    trend: Literal["accelerating", "flat", "declining"] = _trend_label(monthly_counts)

    # Geo signal — top city for matched visits
    cities = Counter(p.get("geo_city", "Online") for p in matched)
    top_city, top_n = cities.most_common(1)[0]
    geo_signal = f"{top_n}/{count} visits in {top_city}" if top_city != "Online" else "online-only"

    # Conviction score from magnitude + frequency + trend
    score = 0.0
    if count >= 8:
        score += 0.3
    elif count >= 4:
        score += 0.15
    if total >= 200:
        score += 0.2
    elif total >= 50:
        score += 0.1
    if trend == "accelerating":
        score += 0.3
    elif trend == "declining":
        score -= 0.3
    score = max(-1.0, min(1.0, round(score, 2)))

    days_since_last = (datetime.now().date() - datetime.fromisoformat(last_visit).date()).days

    user = f"""Ticker: {ticker}
Matched merchant aliases: {', '.join(aliases)}
Personal Bunq history (last 12 months):
  total_spent_eur: {total}
  visit_count:     {count}
  last_visit:      {last_visit} ({days_since_last} days ago)
  trend:           {trend}
  geo:             {geo_signal}

Write ONE sober sentence (<=240 chars) that frames this as a personal-conviction
behavioural signal. Mention whether the user 'eats their own cooking'.
Avoid hype. If trend is declining, name it as a yellow flag.

Return STRICT JSON: {{ "summary": string }}
"""
    out = call_claude_json(user, max_tokens=200)
    return BunqSpendingOverlay(
        total_spent_12m_eur=total,
        visit_count=count,
        last_visit=last_visit,
        trend=trend,
        personal_conviction_score=score,
        summary=out["summary"],
        geo_signal=geo_signal,
    )
