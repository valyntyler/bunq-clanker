"""FastAPI entrypoint.

Tier-1 surface only:
    GET  /health
    POST /analyze           -> Report JSON (fake until orchestrator lands)
    GET  /nearby-tickers    -> NearbyTicker[]
    GET  /panel/{ticker}    -> ConsumerPanelForecast
    POST /invest            -> InvestReceipt (stub until Bunq/Alpaca wired)

Streaming (SSE) will be added once the real orchestrator is in place —
frontend's TerminalLog will subscribe to that feed.
"""

from __future__ import annotations

import logging
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import json as _json

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

load_dotenv()

from backend.analyzers.consumer_panel import analyze_consumer_panel
from backend.integrations import alpaca as alpaca_i
from backend.integrations import bunq as bunq_i
from backend.models import (
    AnalyzeRequest,
    ConsumerPanelForecast,
    InvestReceipt,
    InvestRequest,
    NearbyTicker,
    Report,
)
from backend.orchestrator import analyze_async, analyze_stream

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("prospectus")

app = FastAPI(title="Prospectus / Sauron Wallet", version="0.0.1")

# frontend is served from a different port in dev — allow localhost origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- fixtures loaded once at boot ----
FIXTURES = Path(__file__).parent / "fixtures"
HQ_REGISTRY = Path(__file__).parent / "location" / "hq_registry.json"


def _load_hq_registry() -> list[dict]:
    import json

    if not HQ_REGISTRY.exists():
        return []
    return json.loads(HQ_REGISTRY.read_text())


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in meters."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "time": datetime.now(timezone.utc).isoformat(),
        "llm_provider": os.getenv("LLM_PROVIDER", "bedrock"),
        "bedrock_model": os.getenv("BEDROCK_MODEL_ID"),
        "s3_bucket": os.getenv("AWS_S3_BUCKET"),
    }


@app.post("/analyze/stream")
async def analyze_stream_route(req: AnalyzeRequest) -> StreamingResponse:
    """SSE stream of pipeline events. Events:
        start, module_start, module_done, synthesizing, report, error
    """
    coords = (req.lat, req.lng) if req.lat is not None and req.lng is not None else None
    location_label = _nearest_label(coords) if coords else None

    async def event_gen():
        try:
            async for ev in analyze_stream(
                req.ticker, coords=coords, location_label=location_label
            ):
                yield f"data: {_json.dumps(ev)}\n\n"
        except Exception as e:  # noqa: BLE001
            log.exception("analyze_stream failed")
            yield f"data: {_json.dumps({'event': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "cache-control": "no-cache",
            "x-accel-buffering": "no",  # disable nginx-style buffering
            "connection": "keep-alive",
        },
    )


@app.post("/analyze", response_model=Report)
async def analyze(req: AnalyzeRequest) -> Report:
    """Full pipeline: fundamentals + news + chart-vision + consumer_panel in
    parallel, then synthesized by Claude into a final verdict.
    """
    log.info("analyze: ticker=%s lat=%s lng=%s", req.ticker, req.lat, req.lng)
    coords = (req.lat, req.lng) if req.lat is not None and req.lng is not None else None
    # Location label comes from the nearest HQ hit if coords are present.
    location_label = _nearest_label(coords) if coords else None
    return await analyze_async(req.ticker, coords=coords, location_label=location_label)


def _nearest_label(coords: tuple[float, float] | None) -> str | None:
    if not coords:
        return None
    lat, lng = coords
    nearest = None
    best = float("inf")
    for row in _load_hq_registry():
        d = _haversine_m(lat, lng, row["lat"], row["lng"])
        if d < best:
            best = d
            nearest = row
    if nearest is None or best > 5000:
        return None
    return f"{nearest['name']}, {nearest.get('type', 'hq')} ({int(best)}m)"


@app.get("/nearby-tickers", response_model=list[NearbyTicker])
def nearby_tickers(lat: float, lng: float, radius_m: float = 5000) -> list[NearbyTicker]:
    results: list[NearbyTicker] = []
    for row in _load_hq_registry():
        d = _haversine_m(lat, lng, row["lat"], row["lng"])
        if d <= radius_m:
            results.append(
                NearbyTicker(
                    ticker=row["ticker"],
                    name=row["name"],
                    lat=row["lat"],
                    lng=row["lng"],
                    distance_m=d,
                    type=row.get("type", "hq"),
                )
            )
    results.sort(key=lambda r: r.distance_m)
    return results


@app.get("/panel/{ticker}", response_model=ConsumerPanelForecast)
def panel(ticker: str) -> ConsumerPanelForecast:
    try:
        return analyze_consumer_panel(ticker.upper())
    except KeyError:
        raise HTTPException(404, f"no panel data for ticker {ticker}")


FX_EUR_USD = 1.08  # stub rate — we don't need a live FX feed for a paper-trade demo


@app.get("/balance")
def balance() -> dict:
    """Live Bunq sandbox balances (main + pot). Powers the Invest modal."""
    try:
        return bunq_i.get_balance()
    except Exception as e:  # noqa: BLE001
        log.exception("bunq balance failed")
        raise HTTPException(503, f"bunq unavailable: {e}")


@app.post("/invest", response_model=InvestReceipt)
def invest(req: InvestRequest) -> InvestReceipt:
    """1) Top-up Bunq Main from sugardaddy if needed.
       2) Transfer EUR Main → Prospectus Investments pot.
       3) Submit an Alpaca paper market-buy at the mapped US-ADR symbol.
    """
    if req.amount_eur <= 0:
        raise HTTPException(400, "amount must be > 0")
    if req.amount_eur > 10_000:
        raise HTTPException(400, "amount capped at €10,000 in sandbox")

    # 1+2: ensure funds, then transfer Main -> Pot
    try:
        bal = bunq_i.get_balance()
        if bal["main"] < req.amount_eur:
            needed = req.amount_eur - bal["main"]
            bunq_i.fund_main_from_sugardaddy(
                max(needed, 50.0),
                description=f"prospectus top-up for {req.ticker}",
            )
        bunq_payment_id = bunq_i.transfer_main_to_pot(
            req.amount_eur,
            description=f"prospectus: {req.ticker} position",
        )
    except Exception as e:  # noqa: BLE001
        log.exception("bunq transfer failed")
        raise HTTPException(503, f"bunq transfer failed: {e}")

    # 3: Alpaca paper trade (best-effort — we don't fail the whole flow if it hiccups)
    amount_usd = req.amount_eur * FX_EUR_USD
    alpaca_symbol = alpaca_i.map_to_alpaca_symbol(req.ticker)
    alpaca_order_id: str | None = None
    shares = 0.0
    try:
        order = alpaca_i.submit_market_buy(alpaca_symbol, amount_usd)
        alpaca_order_id = order.id
        shares = order.qty
    except Exception as e:  # noqa: BLE001
        log.warning("alpaca buy failed (non-fatal): %s", e)

    return InvestReceipt(
        bunq_payment_id=bunq_payment_id,
        alpaca_order_id=alpaca_order_id,
        ticker=req.ticker.upper(),
        amount_eur=req.amount_eur,
        amount_usd=round(amount_usd, 2),
        shares=shares,
        timestamp=datetime.now(timezone.utc).isoformat(),
        verdict_snapshot={
            "alpaca_symbol": alpaca_symbol,
            "fx_rate": FX_EUR_USD,
            "note": "sandbox Bunq + Alpaca paper",
        },
    )
