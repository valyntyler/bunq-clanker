"""Index-membership lookup for the 'safer option' suggestion.

Given a ticker, returns the major indices it belongs to plus the tradeable
ETF proxies the user could analyse instead. This is what powers the
"diversification options" cards under the verdict — owning an S&P 500 ETF
gets you AAPL exposure plus 499 other names, which is structurally lower
single-name risk.

Membership data is hand-curated in backend/fixtures/index_membership.json
covering the ~25-ticker analysis universe + the most-popular global indices
(S&P 500, Nasdaq-100, Dow, AEX, EURO STOXX 50, FTSE 100, DAX, MSCI World).

The membership fixture is good enough for the demo; in production this
would be backed by a paid index-constituents data feed.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


@lru_cache(maxsize=1)
def _data() -> dict:
    return json.loads((_FIXTURES / "index_membership.json").read_text())


def memberships_for(ticker: str) -> list[dict]:
    """Return a list of indices that contain `ticker`, each enriched with
    its tradeable proxy ETFs and a one-line rationale. Returns [] when the
    ticker isn't a member of any tracked index.

    Output schema (per item):
        {
          "key":      "SP500",
          "name":     "S&P 500",
          "region":   "US",
          "blurb":    "500 largest US companies by market cap...",
          "proxies":  [{ticker, name, expense_ratio_bps}, ...],
          "rationale": "Owning SPY gives you AAPL exposure plus 499 other names ...",
        }
    """
    t = ticker.upper().strip()
    out: list[dict] = []
    for key, idx in _data().get("indices", {}).items():
        members = [m.upper() for m in idx.get("members") or []]
        if t not in members:
            continue
        proxies = list(idx.get("proxies") or [])
        # Pick a primary proxy for the rationale (first one with the lowest ER, fall back to first).
        primary = (
            min(proxies, key=lambda p: int(p.get("expense_ratio_bps", 9999)))
            if proxies
            else None
        )
        primary_ticker = (primary or {}).get("ticker", "an index ETF")
        breadth = len(members)
        rationale = (
            f"{ticker.upper()} is a member of the {idx['name']}. "
            f"Buying {primary_ticker} gives you {ticker.upper()} exposure plus "
            f"the rest of the index's diversification — single-name risk is "
            f"replaced with broad-market beta."
        )
        out.append({
            "key": key,
            "name": idx["name"],
            "region": idx["region"],
            "blurb": idx.get("blurb", ""),
            "proxies": proxies,
            "rationale": rationale,
            "member_count_demo": breadth,  # demo-universe count, not the real total
        })
    # Sort: most-prestigious indices first. Order matches the fixture's ordering.
    order = list(_data().get("indices", {}).keys())
    out.sort(key=lambda x: order.index(x["key"]))
    return out
