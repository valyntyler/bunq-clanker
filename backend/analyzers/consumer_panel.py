"""Aggregated Bunq consumer panel → next-quarter revenue forecast.

This is the hackathon's centerpiece signal (see spec §6.8). We do the math
deterministically in Python (numbers are ground truth) and ask Claude only
for the qualitative interpretation: direction, magnitude range, confidence,
narrative.
"""

from __future__ import annotations

import json
from datetime import date
from functools import lru_cache
from pathlib import Path

from backend.llm import call_claude_json
from backend.models import ConsumerPanelForecast, NextQuarter

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"

# Historical panel→revenue correlation, hand-tuned per sector. The real number
# would come from an 8-quarter backtest against reported revenue — this is the
# "simulated for prototype" value we surface in the UI disclaimer.
SECTOR_CORRELATION = {
    "beer":      0.74,
    "grocery":   0.81,
    "consumer":  0.68,
    "luxury":    0.79,
    "cloud":     0.54,   # lumpy enterprise recognition
    "streaming": 0.72,
    "qsr":       0.76,
    "coffee":    0.70,
    "apparel":   0.66,
    "bank":      0.42,   # fee revenue is noisy
    "auto":      0.58,
    "flat":      0.55,
}


@lru_cache(maxsize=1)
def _panel() -> dict:
    return json.loads((FIXTURES / "panel_spend.json").read_text())


@lru_cache(maxsize=1)
def _aliases() -> dict:
    return json.loads((FIXTURES / "merchant_aliases.json").read_text())


@lru_cache(maxsize=1)
def _sectors() -> dict[str, str]:
    """Map ticker -> sector-seasonality key, re-derived from the generator config."""
    # Kept in sync with scripts/gen_panel.py by re-reading the seasonal key via import.
    # Lazy import to avoid circular deps.
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "gen_panel", FIXTURES.parent.parent / "scripts" / "gen_panel.py"
    )
    module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return {t: cfg["season"] for t, cfg in module.TICKERS.items()}


def _quarter_of(y: int, m: int) -> tuple[int, int]:
    return (y, (m - 1) // 3 + 1)


def _months_in_quarter(y: int, q: int) -> list[str]:
    start = (q - 1) * 3 + 1
    return [f"{y:04d}-{m:02d}" for m in range(start, start + 3)]


def _today() -> date:
    """Anchor 'current' to the most recent month in the panel, not wall-clock —
    keeps the demo reproducible across days."""
    mos = sorted(next(iter(_panel().values()))["months"].keys())
    last = mos[-1]
    y, m = int(last[:4]), int(last[5:7])
    return date(y, m, 1)


def _series_line(monthly: dict[str, float]) -> str:
    keys = sorted(monthly.keys())
    return " ".join(f"{k}:€{monthly[k]/1000:.1f}k" for k in keys)


def analyze_consumer_panel(ticker: str) -> ConsumerPanelForecast:
    panel = _panel().get(ticker)
    if panel is None:
        raise KeyError(f"no panel data for ticker {ticker}")

    aliases = _aliases().get(ticker, [])
    monthly: dict[str, float] = panel["months"]
    n = panel["panel_size_n"]

    today = _today()
    cur_y, cur_q = _quarter_of(today.year, today.month)
    cur_months = _months_in_quarter(cur_y, cur_q)
    # QTD = available months within current quarter
    qtd_months = [m for m in cur_months if m in monthly]

    # Prior-year same period-to-date
    prior_year_qtd = [f"{cur_y - 1}-{m[5:]}" for m in qtd_months]
    # Prior quarter (full)
    prev_q = cur_q - 1 if cur_q > 1 else 4
    prev_q_year = cur_y if cur_q > 1 else cur_y - 1
    prev_quarter_months = _months_in_quarter(prev_q_year, prev_q)
    # Matched-duration slice of prior quarter for fair QoQ-QTD compare
    prev_q_slice = prev_quarter_months[: len(qtd_months)]

    cur_spend = sum(monthly[m] for m in qtd_months)
    py_spend = sum(monthly[m] for m in prior_year_qtd if m in monthly)
    prev_q_spend = sum(monthly[m] for m in prev_q_slice if m in monthly)

    yoy_pct = ((cur_spend / py_spend) - 1) * 100 if py_spend else 0.0
    qoq_pct = ((cur_spend / prev_q_spend) - 1) * 100 if prev_q_spend else 0.0

    # Trend over the last 4 quarters (trailing). Only include quarters where
    # BOTH current and prior-year have complete data — otherwise a partial-quarter
    # edge inflates the YoY comparison and poisons the trend call.
    last_4q_yoys: list[float] = []
    for back in range(1, 5):
        q = cur_q - back
        y = cur_y
        while q <= 0:
            q += 4
            y -= 1
        months_ = _months_in_quarter(y, q)
        prev_year_months = _months_in_quarter(y - 1, q)
        if not all(m in monthly for m in months_) or not all(
            m in monthly for m in prev_year_months
        ):
            continue
        a = sum(monthly[m] for m in months_)
        b = sum(monthly[m] for m in prev_year_months)
        if a and b:
            last_4q_yoys.append((a / b - 1) * 100)
    avg_prior_yoy = sum(last_4q_yoys) / len(last_4q_yoys) if last_4q_yoys else 0.0

    # Trend is primarily the growth story: magnitude of current YoY.
    # Claude's narrative can layer in the 2nd-derivative (vs. trailing avg) nuance.
    if yoy_pct >= 8:
        trend = "accelerating"
    elif yoy_pct <= -5:
        trend = "declining"
    else:
        trend = "flat"

    sector = _sectors().get(ticker, "flat")
    hist_corr = SECTOR_CORRELATION.get(sector, 0.55)

    # Claude interprets: direction, magnitude range, confidence, narrative.
    system = (
        "You are a sober equity analyst interpreting aggregated consumer-panel "
        "card-spending data as a leading indicator of next-quarter reported revenue. "
        "This is the same methodology hedge funds use when buying from YipitData or "
        "Earnest Analytics. Be calibrated — avoid hype. Historical panel→revenue "
        "correlation is imperfect; express uncertainty when appropriate."
    )
    user = f"""Ticker: {ticker}
Merchant aliases matched: {', '.join(aliases) or '(none)'}
Panel size N (Bunq users): {n:,}
Sector-level historical correlation (panel → reported revenue): {hist_corr:.2f}

Current quarter-to-date panel spend: €{cur_spend:,.0f}
Prior-year same-period-to-date:      €{py_spend:,.0f}   (YoY {yoy_pct:+.1f}%)
Prior quarter same slice:            €{prev_q_spend:,.0f} (QoQ {qoq_pct:+.1f}%)
Last-4-quarters average YoY: {avg_prior_yoy:+.1f}%

24-month monthly series (EUR):
{_series_line(monthly)}

Return STRICT JSON with these keys only:
  revenue_direction: one of "beat" | "in-line" | "miss"
  vs_consensus_pct: a short string like "+3 to +5%" or "-1 to +1%"
  confidence: number 0..1 (higher when YoY is strong AND trend is consistent AND hist_corr is high)
  reasoning: one-sentence narrative citing the specific YoY number and correlation
"""
    result = call_claude_json(user, system=system, max_tokens=500)

    return ConsumerPanelForecast(
        panel_size_n=n,
        yoy_change_pct=round(yoy_pct, 1),
        qoq_change_pct=round(qoq_pct, 1),
        trend=trend,  # type: ignore[arg-type]
        historical_correlation=hist_corr,
        next_quarter=NextQuarter(
            revenue_direction=result["revenue_direction"],
            vs_consensus_pct=result["vs_consensus_pct"],
            confidence=float(result["confidence"]),
        ),
        chart_url=f"/panel/{ticker}/chart.png",
        merchant_aliases=aliases,
    )
