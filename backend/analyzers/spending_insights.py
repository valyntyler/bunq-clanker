"""Aggregate the user's payment history into spend insights + ticker
discovery suggestions.

Reads the seeded bunq_user_payments.json and the merchant_aliases mapping
(ticker → merchant alias list). For each ticker covered, computes total
spend, visit count, and last visit. Groups everything else under a
heuristic category derived from the merchant name.

The discovery panel surfaces tickers the user spends meaningfully at,
ranked by 12-month spend, plus the top peer tickers in the same sector
they DON'T already spend at — opening room to act on conviction.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"

# Heuristic merchant → category. Pure substring match in merchant.lower().
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Beer & Bars":     ["heineken", "amstel", "brand bier", "desperados", "tap house", "bar"],
    "Groceries":       ["albert heijn", "ah ", "ah xl", "ah to go", "etos", "hema"],
    "Restaurants & Delivery": ["mcdonald", "starbucks", "just eat", "takeaway", "thuisbezorgd"],
    "Subscriptions":   ["netflix", "spotify", "amazon prime", "icloud", "apple music"],
    "Tech & Apps":     ["apple", "app store", "google", "microsoft", "github"],
    "Online shopping": ["amazon", "amazon.nl", "amazon.com"],
    "Transport & Fuel":["shell", "ns travel", "uber", "tesla"],
    "Apparel & Sports":["nike", "adidas"],
    "Banking fees":    ["ing", "abn amro"],
    "Luxury":          ["louis vuitton", "hermes", "dior"],
}

# Ticker → category for the discovery suggestion logic.
TICKER_CATEGORY: dict[str, str] = {
    "HEIA.AS": "Beer & Bars",
    "AD.AS":   "Groceries",
    "MCD":     "Restaurants & Delivery",
    "SBUX":    "Restaurants & Delivery",
    "TKWY.AS": "Restaurants & Delivery",
    "AAPL":    "Tech & Apps",
    "GOOGL":   "Tech & Apps",
    "MSFT":    "Tech & Apps",
    "NFLX":    "Subscriptions",
    "AMZN":    "Online shopping",
    "SHEL.L":  "Transport & Fuel",
    "TSLA":    "Transport & Fuel",
    "NKE":     "Apparel & Sports",
    "INGA.AS": "Banking fees",
    "ABN.AS":  "Banking fees",
    "MC.PA":   "Luxury",
    "RMS.PA":  "Luxury",
    "META":    "Tech & Apps",
    "NVDA":    "Tech & Apps",
    "ADYEN.AS":"Tech & Apps",
}


@dataclass
class SpendingInsights:
    total_eur: float
    visit_count: int
    by_month: list[dict]
    by_category: list[dict]
    top_merchants: list[dict]
    by_ticker: list[dict]      # tickers the user spends at
    discovery: list[dict]      # peer tickers in same categories they don't spend at


@lru_cache(maxsize=1)
def _payments() -> list[dict]:
    return json.loads((FIXTURES / "bunq_user_payments.json").read_text())


@lru_cache(maxsize=1)
def _aliases() -> dict[str, list[str]]:
    return json.loads((FIXTURES / "merchant_aliases.json").read_text())


def _categorise(merchant: str) -> str:
    m = merchant.lower()
    for cat, keys in CATEGORY_KEYWORDS.items():
        if any(k in m for k in keys):
            return cat
    return "Other"


def _ticker_for(merchant: str) -> str | None:
    m = merchant.lower()
    for ticker, aliases in _aliases().items():
        if any(a.lower() in m for a in aliases):
            return ticker
    return None


def compute() -> SpendingInsights:
    pays = _payments()
    if not pays:
        return SpendingInsights(0.0, 0, [], [], [], [], [])

    total = round(sum(p["amount_eur"] for p in pays), 2)

    # Monthly aggregate
    month_map: dict[str, float] = defaultdict(float)
    for p in pays:
        month_map[p["date"][:7]] += p["amount_eur"]
    by_month = [
        {"month": m, "spend_eur": round(month_map[m], 2)}
        for m in sorted(month_map.keys())
    ]

    # Category aggregate
    cat_map: dict[str, dict] = defaultdict(lambda: {"spend_eur": 0.0, "count": 0})
    for p in pays:
        c = _categorise(p["merchant"])
        cat_map[c]["spend_eur"] += p["amount_eur"]
        cat_map[c]["count"] += 1
    by_category = sorted(
        [
            {
                "category": c,
                "spend_eur": round(v["spend_eur"], 2),
                "count": v["count"],
            }
            for c, v in cat_map.items()
        ],
        key=lambda x: x["spend_eur"],
        reverse=True,
    )

    # Top merchants
    merch_map: dict[str, dict] = defaultdict(lambda: {"spend_eur": 0.0, "count": 0})
    for p in pays:
        merch_map[p["merchant"]]["spend_eur"] += p["amount_eur"]
        merch_map[p["merchant"]]["count"] += 1
    top_merchants = sorted(
        [
            {
                "merchant": m,
                "spend_eur": round(v["spend_eur"], 2),
                "count": v["count"],
            }
            for m, v in merch_map.items()
        ],
        key=lambda x: x["spend_eur"],
        reverse=True,
    )[:8]

    # By ticker (spend at companies whose merchants we have aliases for)
    ticker_map: dict[str, dict] = defaultdict(
        lambda: {"spend_eur": 0.0, "count": 0, "last_visit": ""}
    )
    for p in pays:
        t = _ticker_for(p["merchant"])
        if t is None:
            continue
        ticker_map[t]["spend_eur"] += p["amount_eur"]
        ticker_map[t]["count"] += 1
        if p["date"] > ticker_map[t]["last_visit"]:
            ticker_map[t]["last_visit"] = p["date"]
    by_ticker = sorted(
        [
            {
                "ticker": t,
                "spend_eur": round(v["spend_eur"], 2),
                "count": v["count"],
                "last_visit": v["last_visit"],
                "category": TICKER_CATEGORY.get(t),
            }
            for t, v in ticker_map.items()
        ],
        key=lambda x: x["spend_eur"],
        reverse=True,
    )

    # Discovery: peer tickers in the same categories the user already spends in,
    # but doesn't directly spend at.
    held_tickers = {entry["ticker"] for entry in by_ticker}
    user_categories = {entry["category"] for entry in by_ticker if entry["category"]}
    peers_by_cat: dict[str, list[str]] = defaultdict(list)
    for ticker, cat in TICKER_CATEGORY.items():
        if cat in user_categories and ticker not in held_tickers:
            peers_by_cat[cat].append(ticker)
    discovery: list[dict] = []
    for cat, tickers in peers_by_cat.items():
        # Find the user's strongest entry in this category for context
        anchor = next(
            (
                entry
                for entry in by_ticker
                if entry["category"] == cat
            ),
            None,
        )
        for t in tickers[:3]:  # top 3 per category
            discovery.append(
                {
                    "ticker": t,
                    "category": cat,
                    "rationale": (
                        f"You spend €{anchor['spend_eur']:.0f} at {anchor['ticker']} "
                        f"({anchor['count']} visits) — peer in the same {cat.lower()} category."
                        if anchor
                        else f"Peer in {cat.lower()}."
                    ),
                    "anchor_ticker": anchor["ticker"] if anchor else None,
                }
            )

    return SpendingInsights(
        total_eur=total,
        visit_count=len(pays),
        by_month=by_month,
        by_category=by_category,
        top_merchants=top_merchants,
        by_ticker=by_ticker,
        discovery=discovery,
    )


def to_dict(s: SpendingInsights) -> dict:
    return {
        "total_eur": s.total_eur,
        "visit_count": s.visit_count,
        "by_month": s.by_month,
        "by_category": s.by_category,
        "top_merchants": s.top_merchants,
        "by_ticker": s.by_ticker,
        "discovery": s.discovery,
    }
