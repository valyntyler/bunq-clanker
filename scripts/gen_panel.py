"""Generate backend/fixtures/panel_spend.json.

Hand-tuned per-ticker trend + monthly seasonality + mild deterministic noise.
Output is 24 months ending 2026-04 (the current month). Each ticker has:
    panel_size_n: anonymized Bunq user panel size for this merchant's aliases
    months:       {"YYYY-MM": eur_cents_spend}

Determinism matters: the demo runs off this file, so regenerating should
produce the same numbers. Seed the noise per-ticker from the ticker string.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

# -- config --------------------------------------------------------

START = (2024, 5)  # inclusive
END = (2026, 4)    # inclusive -> 24 months

# Seasonality multipliers keyed by month (1..12). 1.00 == baseline.
SEASONAL = {
    "beer":      {1:0.83,2:0.80,3:0.88,4:0.98,5:1.08,6:1.25,7:1.32,8:1.22,9:1.02,10:0.92,11:0.92,12:1.18},
    "grocery":   {1:0.96,2:0.92,3:1.00,4:0.98,5:1.00,6:0.98,7:1.00,8:1.02,9:1.00,10:1.02,11:1.08,12:1.22},
    "consumer":  {1:0.95,2:0.90,3:0.98,4:1.00,5:1.02,6:1.00,7:0.98,8:0.95,9:1.00,10:1.05,11:1.20,12:1.35},
    "luxury":    {1:0.85,2:0.90,3:0.95,4:1.00,5:1.05,6:1.10,7:1.05,8:0.95,9:1.00,10:1.05,11:1.25,12:1.45},
    "cloud":     {1:1.00,2:0.98,3:1.02,4:1.00,5:1.02,6:1.00,7:1.00,8:1.00,9:1.05,10:1.02,11:1.00,12:0.95},
    "streaming": {1:1.02,2:1.00,3:1.00,4:0.98,5:0.98,6:0.98,7:0.98,8:0.98,9:1.00,10:1.02,11:1.05,12:1.08},
    "qsr":       {1:0.96,2:0.95,3:1.00,4:1.02,5:1.05,6:1.08,7:1.10,8:1.05,9:1.02,10:1.00,11:0.98,12:1.00},
    "coffee":    {1:1.00,2:0.95,3:1.02,4:1.02,5:1.02,6:1.00,7:0.98,8:0.98,9:1.02,10:1.05,11:1.05,12:1.08},
    "apparel":   {1:0.88,2:0.90,3:1.02,4:1.05,5:1.02,6:0.95,7:0.88,8:1.00,9:1.05,10:1.02,11:1.25,12:1.20},
    "bank":      {1:1.00,2:0.98,3:1.00,4:1.00,5:1.00,6:1.00,7:0.98,8:0.98,9:1.00,10:1.00,11:1.00,12:1.05},
    "auto":      {1:0.85,2:0.88,3:1.08,4:1.02,5:1.00,6:1.08,7:0.95,8:0.95,9:1.10,10:0.98,11:0.95,12:1.15},
    "flat":      {m:1.00 for m in range(1, 13)},
}

# Per-ticker: panel size N, seasonal key, monthly baseline (EUR), YoY growth decimal.
# Tuned so the "feature story" of each ticker is legible.
# HEIA is pinned to hit ~+14% YoY in Q2.
TICKERS = {
    # NL / EU blue chips
    "HEIA.AS":  {"N": 12843, "season": "beer",     "base": 75_000, "yoy": 0.124},
    "AD.AS":    {"N": 28450, "season": "grocery",  "base": 610_000,"yoy": 0.058},
    "INGA.AS":  {"N":  9320, "season": "bank",     "base":  42_000,"yoy": 0.012},
    "ABN.AS":   {"N":  7140, "season": "bank",     "base":  31_000,"yoy":-0.008},
    "ADYEN.AS": {"N":   820, "season": "flat",     "base":   8_800,"yoy": 0.220},
    "PHIA.AS":  {"N":  3140, "season": "consumer", "base":  11_500,"yoy": 0.015},
    "UNA.AS":   {"N": 19450, "season": "consumer", "base":  88_000,"yoy": 0.022},
    "TKWY.AS":  {"N":  6210, "season": "consumer", "base":  22_000,"yoy":-0.041},
    "KPN.AS":   {"N": 11230, "season": "flat",     "base":  67_000,"yoy": 0.008},
    # US mega-caps
    "AAPL":     {"N": 21340, "season": "consumer", "base": 210_000,"yoy": 0.075},
    "GOOGL":    {"N": 14210, "season": "cloud",    "base":  62_000,"yoy": 0.035},
    "MSFT":     {"N": 10850, "season": "cloud",    "base":  55_000,"yoy": 0.048},
    "META":     {"N":  4310, "season": "streaming","base":  18_000,"yoy": 0.085},
    "NVDA":     {"N":   310, "season": "flat",     "base":   2_200,"yoy": 0.420},
    "TSLA":     {"N":   640, "season": "auto",     "base":   9_500,"yoy":-0.165},
    "AMZN":     {"N": 22180, "season": "consumer", "base": 185_000,"yoy": 0.065},
    "NFLX":     {"N":  9810, "season": "streaming","base":  48_000,"yoy": 0.118},
    "SBUX":     {"N":  8640, "season": "coffee",   "base":  36_000,"yoy":-0.028},
    "NKE":      {"N":  5220, "season": "apparel",  "base":  21_000,"yoy":-0.095},
    "MCD":      {"N": 13450, "season": "qsr",      "base":  74_000,"yoy": 0.024},
    "KO":       {"N":  7840, "season": "consumer", "base":  29_000,"yoy": 0.015},
    "SHEL.L":   {"N":  4920, "season": "auto",     "base":  38_000,"yoy":-0.022},
    "MC.PA":    {"N":   460, "season": "luxury",   "base":   5_400,"yoy": 0.082},
    "RMS.PA":   {"N":   160, "season": "luxury",   "base":   2_900,"yoy": 0.148},
    "SAP.DE":   {"N":  1240, "season": "cloud",    "base":   6_800,"yoy": 0.092},
}


def months() -> list[tuple[int, int]]:
    out = []
    y, m = START
    while (y, m) <= END:
        out.append((y, m))
        m += 1
        if m == 13:
            m = 1
            y += 1
    return out


def deterministic_noise(ticker: str, ym: tuple[int, int]) -> float:
    """±5% deterministic noise seeded from (ticker, year, month)."""
    h = hashlib.sha256(f"{ticker}:{ym[0]}:{ym[1]}".encode()).hexdigest()
    # first 4 hex chars → 0..65535 → map to ±0.05
    return ((int(h[:4], 16) / 0xFFFF) - 0.5) * 0.10


def generate() -> dict:
    mos = months()
    out: dict = {}
    for ticker, cfg in TICKERS.items():
        season = SEASONAL[cfg["season"]]
        base = cfg["base"]
        yoy = cfg["yoy"]
        monthly = {}
        for (y, m) in mos:
            # Linear interpolation of YoY growth from START to END.
            # month_index from 0 (START) to len(mos)-1 (END).
            i = mos.index((y, m))
            years_elapsed = i / 12.0
            trend = math.pow(1.0 + yoy, years_elapsed)
            noise = 1.0 + deterministic_noise(ticker, (y, m))
            eur = base * season[m] * trend * noise
            monthly[f"{y:04d}-{m:02d}"] = round(eur, 2)
        out[ticker] = {
            "panel_size_n": cfg["N"],
            "months": monthly,
        }
    return out


def main() -> None:
    data = generate()
    # verify HEIA Q2-2026 YoY for the demo
    heia = data["HEIA.AS"]["months"]
    q2_26 = heia.get("2026-04", 0)  # only Apr so far in 24-month window
    q2_25 = heia.get("2025-04", 0)
    yoy_apr = (q2_26 - q2_25) / q2_25 * 100
    print(f"HEIA Apr 2026 vs Apr 2025 YoY: {yoy_apr:+.1f}%")
    # and the QTD (Apr-only) full-quarter extrapolation from Apr factor
    out_path = Path(__file__).resolve().parent.parent / "backend" / "fixtures" / "panel_spend.json"
    out_path.write_text(json.dumps(data, indent=2))
    print(f"wrote {out_path} ({len(data)} tickers × {len(next(iter(data.values()))['months'])} months)")


if __name__ == "__main__":
    main()
