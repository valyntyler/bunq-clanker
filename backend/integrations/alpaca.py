"""Alpaca paper trading integration.

Thin wrapper around alpaca-py. We only need three things:
    submit_market_buy(symbol, usd_amount) -> order object
    get_account() -> cash/buying power
    latest_trade_price(symbol) -> last price in USD

Paper only — no real money.
"""

from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass
from functools import lru_cache

log = logging.getLogger("prospectus.alpaca")


@dataclass
class AlpacaOrder:
    id: str
    symbol: str
    qty: float
    notional_usd: float
    status: str


@lru_cache(maxsize=1)
def _trading_client():
    from alpaca.trading.client import TradingClient

    return TradingClient(
        os.environ["ALPACA_API_KEY"],
        os.environ["ALPACA_API_SECRET"],
        paper=True,
    )


@lru_cache(maxsize=1)
def _data_client():
    from alpaca.data.historical import StockHistoricalDataClient

    return StockHistoricalDataClient(
        os.environ["ALPACA_API_KEY"],
        os.environ["ALPACA_API_SECRET"],
    )


def get_account() -> dict:
    acct = _trading_client().get_account()
    return {
        "cash": float(acct.cash),
        "buying_power": float(acct.buying_power),
        "portfolio_value": float(acct.portfolio_value),
        "status": str(acct.status),
    }


def latest_trade_price(symbol: str) -> float | None:
    """Latest trade price in USD. None if Alpaca can't quote (e.g. non-US listing)."""
    try:
        from alpaca.data.requests import StockLatestTradeRequest

        resp = _data_client().get_stock_latest_trade(
            StockLatestTradeRequest(symbol_or_symbols=symbol)
        )
        trade = resp.get(symbol) if isinstance(resp, dict) else None
        if trade is None:
            return None
        # alpaca-py may return dict or model — handle both
        if isinstance(trade, dict):
            return float(trade["price"])
        return float(trade.price)
    except Exception as e:  # noqa: BLE001
        log.warning("latest_trade_price(%s) failed: %s", symbol, e)
        return None


def submit_market_buy(symbol: str, usd_amount: float) -> AlpacaOrder:
    """Notional market-buy — alpaca-py supports fractional notional on paper."""
    from alpaca.trading.enums import OrderSide, TimeInForce
    from alpaca.trading.requests import MarketOrderRequest

    if usd_amount <= 0:
        raise ValueError("usd_amount must be > 0")

    req = MarketOrderRequest(
        symbol=symbol,
        notional=round(usd_amount, 2),
        side=OrderSide.BUY,
        time_in_force=TimeInForce.DAY,
    )
    order = _trading_client().submit_order(order_data=req)
    # Notional fractional fills may not have qty at submission time — estimate it.
    price = latest_trade_price(symbol)
    qty = (usd_amount / price) if price and price > 0 else 0.0
    return AlpacaOrder(
        id=str(order.id),
        symbol=symbol,
        qty=round(qty, 4),
        notional_usd=round(usd_amount, 2),
        status=str(order.status),
    )


def map_to_alpaca_symbol(ticker: str) -> str:
    """Alpaca is US-equities only on the free plan. Best-effort mapping:
      HEIA.AS -> HEINY (Heineken ADR)
      ASML.AS -> ASML
      SAP.DE  -> SAP
      MC.PA   -> LVMUY
      etc.
    For non-US tickers without a clean ADR, fall back to a default demo symbol.
    """
    adrs = {
        "HEIA.AS": "HEINY",
        "ASML.AS": "ASML",
        "INGA.AS": "ING",
        "UNA.AS": "UL",
        "PHIA.AS": "PHG",
        "AD.AS": "ADRNY",
        "PRX.AS": "PROSY",
        "ADYEN.AS": "ADYEY",
        "SHEL.L": "SHEL",
        "SAP.DE": "SAP",
        "MC.PA": "LVMUY",
        "RMS.PA": "HESAY",
    }
    return adrs.get(ticker.upper(), ticker.upper())
