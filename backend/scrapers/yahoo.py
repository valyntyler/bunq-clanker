"""yfinance wrapper for fundamentals + OHLCV + chart rendering."""

from __future__ import annotations

import io
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import yfinance as yf


@dataclass
class Fundamentals:
    ticker: str
    name: str
    sector: str | None
    industry: str | None
    currency: str | None
    price: float | None
    market_cap: float | None
    trailing_pe: float | None
    forward_pe: float | None
    revenue: float | None
    net_income: float | None
    total_debt: float | None
    total_cash: float | None
    debt_to_equity: float | None
    profit_margin: float | None
    revenue_growth: float | None
    earnings_growth: float | None
    business_summary: str | None

    def to_prompt(self) -> str:
        """Compact serialization for Claude."""
        def fmt_money(v: float | None) -> str:
            if v is None:
                return "n/a"
            if abs(v) >= 1e9:
                return f"{v / 1e9:,.2f}B"
            if abs(v) >= 1e6:
                return f"{v / 1e6:,.1f}M"
            return f"{v:,.0f}"

        def fmt_pct(v: float | None) -> str:
            return f"{v * 100:+.1f}%" if v is not None else "n/a"

        lines = [
            f"Ticker:           {self.ticker} ({self.name})",
            f"Sector/Industry:  {self.sector} / {self.industry}",
            f"Price/Currency:   {self.price} {self.currency}",
            f"Market cap:       {fmt_money(self.market_cap)} {self.currency or ''}",
            f"P/E trailing:     {self.trailing_pe}",
            f"P/E forward:      {self.forward_pe}",
            f"Revenue (ttm):    {fmt_money(self.revenue)}",
            f"Revenue growth:   {fmt_pct(self.revenue_growth)}",
            f"Net income (ttm): {fmt_money(self.net_income)}",
            f"Earnings growth:  {fmt_pct(self.earnings_growth)}",
            f"Profit margin:    {fmt_pct(self.profit_margin)}",
            f"Total debt:       {fmt_money(self.total_debt)}",
            f"Total cash:       {fmt_money(self.total_cash)}",
            f"Debt/Equity:      {self.debt_to_equity}",
        ]
        if self.business_summary:
            lines.append("")
            lines.append("Business summary:")
            lines.append(self.business_summary[:1500])
        return "\n".join(lines)


@lru_cache(maxsize=64)
def _ticker(symbol: str) -> yf.Ticker:
    return yf.Ticker(symbol)


def fetch_fundamentals(symbol: str) -> Fundamentals:
    t = _ticker(symbol)
    try:
        info: dict[str, Any] = t.info
    except Exception:
        info = {}
    return Fundamentals(
        ticker=symbol,
        name=info.get("longName") or info.get("shortName") or symbol,
        sector=info.get("sector"),
        industry=info.get("industry"),
        currency=info.get("currency"),
        price=info.get("currentPrice") or info.get("regularMarketPrice"),
        market_cap=info.get("marketCap"),
        trailing_pe=info.get("trailingPE"),
        forward_pe=info.get("forwardPE"),
        revenue=info.get("totalRevenue"),
        net_income=info.get("netIncomeToCommon"),
        total_debt=info.get("totalDebt"),
        total_cash=info.get("totalCash"),
        debt_to_equity=info.get("debtToEquity"),
        profit_margin=info.get("profitMargins"),
        revenue_growth=info.get("revenueGrowth"),
        earnings_growth=info.get("earningsGrowth"),
        business_summary=info.get("longBusinessSummary"),
    )


def render_candlestick_png(
    symbol: str, period: str = "1y", size: tuple[int, int] = (1024, 768)
) -> bytes:
    """Render a candlestick + volume PNG and return raw bytes."""
    import matplotlib
    matplotlib.use("Agg")
    import mplfinance as mpf

    hist = _ticker(symbol).history(period=period)
    if hist.empty:
        raise RuntimeError(f"no price history for {symbol}")
    # For multi-year periods (5y / 10y / max) candles become a smudge —
    # auto-switch to a clean line chart so the long-arc trend reads cleanly.
    bars = len(hist)
    plot_type = "line" if bars > 400 else "candle"
    buf = io.BytesIO()
    mpf.plot(
        hist,
        type=plot_type,
        volume=True,
        style="charles",
        title=f"{symbol} · {period}",
        figratio=(16, 10),
        figscale=1.2,
        warn_too_much_data=10_000,
        savefig=dict(fname=buf, format="png", dpi=100, bbox_inches="tight"),
    )
    buf.seek(0)
    return buf.read()


def latest_price(symbol: str) -> float | None:
    try:
        hist = _ticker(symbol).history(period="5d")
        if hist.empty:
            return None
        return float(hist["Close"].iloc[-1])
    except Exception:
        return None


def fetch_ohlcv(symbol: str, period: str = "1y") -> tuple[list[dict], str | None]:
    """Returns (bars, currency) — daily OHLCV bars plus the listing currency
    pulled from yfinance .info.

        bars = [{"date": "2025-04-25", "open": 130.1, "high": 132.4, "low":
                 129.5, "close": 131.8, "volume": 45_000_000}, …]
        currency = "USD" / "EUR" / "GBp" / etc.

    The interval auto-scales with the period so 1d gets minute bars and 5y
    still loads in <1s.
    """
    interval = _interval_for_period(period)
    t = _ticker(symbol)
    hist = t.history(period=period, interval=interval)
    if hist.empty:
        return [], None
    out: list[dict] = []
    for ts, row in hist.iterrows():
        out.append(
            {
                "date": ts.strftime("%Y-%m-%dT%H:%M:%S"),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": float(row["Volume"]) if "Volume" in row else 0.0,
            }
        )
    try:
        info = t.info or {}
        currency = info.get("currency")
    except Exception:
        currency = None
    return out, currency


def _interval_for_period(period: str) -> str:
    """Pick a sensible bar interval for a given period so the chart looks
    reasonable without timing-out yfinance."""
    return {
        "1d": "5m",
        "5d": "30m",
        "1mo": "1h",
        "3mo": "1d",
        "6mo": "1d",
        "1y": "1d",
        "2y": "1d",
        "5y": "1wk",
        "10y": "1wk",
        "max": "1mo",
    }.get(period, "1d")


def validate_ticker(symbol: str) -> tuple[bool, str | None]:
    """Cheap existence check via yfinance. Returns (is_valid, name_if_valid).

    yfinance silently returns empty info + 0-row history for bogus symbols
    (and logs an HTTP 404 stderr line). We treat 'no name AND no price AND no
    history' as 'not a real listed equity'.
    """
    try:
        t = _ticker(symbol)
        info = t.info or {}
        name = info.get("longName") or info.get("shortName")
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        if name and price:
            return True, name
        # Fallback — some illiquid tickers have no info but do have price history
        try:
            hist = t.history(period="5d")
            if not hist.empty:
                return True, name or symbol
        except Exception:
            pass
        return False, None
    except Exception:
        return False, None
