"""Orchestrator — run the analyzers in parallel and synthesize.

Two entry points:
  analyze_async(...)   — single round-trip, returns the final Report.
  analyze_stream(...)  — async generator yielding per-module events for SSE.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from backend.analyzers.bunq_spending import analyze_personal_spending
from backend.analyzers.chart_vision import analyze_chart
from backend.analyzers.consumer_panel import analyze_consumer_panel
from backend.analyzers.fundamentals import analyze_fundamentals
from backend.analyzers.news_sentiment import analyze_news
from backend.analyzers.synthesizer import synthesize
from backend.models import (
    BunqSpendingOverlay,
    ConsumerPanelForecast,
    LocationContext,
    Report,
    Section,
)

log = logging.getLogger("prospectus.orchestrator")


async def _run(fn, *args, **kwargs):
    """Run a blocking analyzer in a thread so we can gather them concurrently."""
    return await asyncio.to_thread(fn, *args, **kwargs)


async def _gather_modules(ticker: str) -> dict[str, Any]:
    """Kick off all independent analyzers at once."""
    fund_task = _run(analyze_fundamentals, ticker)
    chart_task = _run(analyze_chart, ticker)
    panel_task = _run(_safe_panel, ticker)
    bunq_task = _run(_safe_bunq_spending, ticker)

    # news needs the company name from fundamentals — do it after fund resolves
    fund_result, chart_result, panel_result, bunq_result = await asyncio.gather(
        fund_task, chart_task, panel_task, bunq_task, return_exceptions=True
    )

    out: dict[str, Any] = {}

    if isinstance(fund_result, BaseException):
        log.exception("fundamentals failed", exc_info=fund_result)
        out["fundamentals"] = None
        company_name = ticker
    else:
        section, fundamentals_data = fund_result
        out["fundamentals"] = section
        out["_fundamentals_raw"] = fundamentals_data
        company_name = fundamentals_data.name

    news_result = await _run(_safe_news, ticker, company_name)
    out["news"] = news_result

    out["chart"] = None if isinstance(chart_result, BaseException) else chart_result
    if isinstance(chart_result, BaseException):
        log.exception("chart failed", exc_info=chart_result)

    out["panel"] = None if isinstance(panel_result, BaseException) else panel_result
    if isinstance(panel_result, BaseException):
        log.exception("panel failed", exc_info=panel_result)

    out["bunq_spending"] = None if isinstance(bunq_result, BaseException) else bunq_result
    if isinstance(bunq_result, BaseException):
        log.exception("bunq_spending failed", exc_info=bunq_result)

    out["company_name"] = company_name
    return out


def _safe_panel(ticker: str) -> ConsumerPanelForecast | None:
    try:
        return analyze_consumer_panel(ticker)
    except KeyError:
        return None


def _safe_bunq_spending(ticker: str) -> BunqSpendingOverlay | None:
    try:
        return analyze_personal_spending(ticker)
    except Exception:  # noqa: BLE001
        log.exception("personal-spending failed")
        return None


def _safe_news(ticker: str, company_name: str) -> Section | None:
    try:
        return analyze_news(ticker, company_name)
    except Exception:  # noqa: BLE001
        log.exception("news failed")
        return None


async def analyze_async(
    ticker: str,
    *,
    coords: tuple[float, float] | None = None,
    location_label: str | None = None,
) -> Report:
    ticker = ticker.upper()
    modules = await _gather_modules(ticker)

    sections: dict[str, Section] = {}
    for key in ("fundamentals", "news", "chart"):
        s = modules.get(key)
        if isinstance(s, Section):
            sections[key] = s

    panel: ConsumerPanelForecast | None = modules.get("panel")
    bunq_spending: BunqSpendingOverlay | None = modules.get("bunq_spending")
    company_name: str = modules["company_name"]

    synth = synthesize(
        ticker=ticker,
        company_name=company_name,
        sections=sections,
        consumer_panel=panel,
        bunq_spending=bunq_spending,
    )

    return Report(
        ticker=ticker,
        company_name=company_name,
        generated_at=datetime.now(timezone.utc).isoformat(),
        verdict=synth["verdict"],
        confidence=float(synth["confidence"]),
        position_size_pct=float(synth["position_size_pct"]),
        one_liner=synth["one_liner"],
        sections=sections,
        consumer_panel_forecast=panel,
        bunq_spending_overlay=bunq_spending,
        location_context=LocationContext(
            used=coords is not None,
            detected_at=location_label,
            coords=coords,
        ),
        risks=synth.get("risks", []),
        conflicts=synth.get("conflicts", []),
        data_gaps=synth.get("data_gaps", []),
    )


def analyze(
    ticker: str,
    *,
    coords: tuple[float, float] | None = None,
    location_label: str | None = None,
) -> Report:
    """Synchronous entry point for FastAPI handlers."""
    return asyncio.run(analyze_async(ticker, coords=coords, location_label=location_label))


# ---------- streaming variant ----------------------------------------


_MODULE_LABELS = {
    "fundamentals": "yfinance fundamentals",
    "news": "news sentiment (30d)",
    "chart": "chart-vision (1y candlestick)",
    "panel": "consumer panel forecast",
    "bunq_spending": "personal Bunq spending",
}


async def _labeled(name: str, coro):
    """Run coro and tag its result with the analyzer name."""
    try:
        return name, await coro, None
    except BaseException as e:  # noqa: BLE001
        return name, None, e


def _section_payload(section: Section | None) -> dict | None:
    if section is None:
        return None
    return section.model_dump()


async def analyze_stream(
    ticker: str,
    *,
    coords: tuple[float, float] | None = None,
    location_label: str | None = None,
) -> AsyncIterator[dict]:
    """Async generator yielding pipeline events:
        {"event": "start", "ticker": ...}
        {"event": "module_start", "name": ..., "label": ...}
        {"event": "module_done",  "name": ..., "section"|"data"|"error": ...}
        {"event": "synthesizing"}
        {"event": "report", "report": Report-as-dict}
    """
    ticker = ticker.upper()
    yield {"event": "start", "ticker": ticker, "ts": datetime.now(timezone.utc).isoformat()}

    # Kick all 5 in parallel. News uses ticker as query when no name available
    # — Google News maps tickers reasonably for known equities.
    parallel = {
        "fundamentals": _labeled("fundamentals", _run(analyze_fundamentals, ticker)),
        "chart":        _labeled("chart",        _run(analyze_chart, ticker)),
        "panel":        _labeled("panel",        _run(_safe_panel, ticker)),
        "bunq_spending": _labeled("bunq_spending", _run(_safe_bunq_spending, ticker)),
        "news":         _labeled("news",         _run(_safe_news, ticker, None)),
    }
    for name in parallel:
        yield {"event": "module_start", "name": name, "label": _MODULE_LABELS[name]}

    results: dict[str, Any] = {}
    fundamentals_raw = None

    for coro in asyncio.as_completed(list(parallel.values())):
        name, result, err = await coro
        if err is not None:
            log.exception("%s failed", name, exc_info=err)
            results[name] = None
            yield {"event": "module_done", "name": name, "error": str(err)}
            continue

        if name == "fundamentals":
            section, fundamentals_raw = result
            results[name] = section
            yield {
                "event": "module_done",
                "name": name,
                "section": _section_payload(section),
            }
        elif name in ("news", "chart"):
            results[name] = result
            yield {
                "event": "module_done",
                "name": name,
                "section": _section_payload(result),
            }
        else:
            # panel or bunq_spending — overlay objects (or None when no data)
            results[name] = result
            yield {
                "event": "module_done",
                "name": name,
                "data": result.model_dump() if result is not None else None,
            }

    yield {"event": "synthesizing"}

    sections: dict[str, Section] = {}
    for key in ("fundamentals", "news", "chart"):
        s = results.get(key)
        if isinstance(s, Section):
            sections[key] = s
    panel: ConsumerPanelForecast | None = results.get("panel")
    bunq_spending: BunqSpendingOverlay | None = results.get("bunq_spending")
    company_name = fundamentals_raw.name if fundamentals_raw else ticker

    synth = await _run(
        synthesize,
        ticker=ticker,
        company_name=company_name,
        sections=sections,
        consumer_panel=panel,
        bunq_spending=bunq_spending,
    )

    report = Report(
        ticker=ticker,
        company_name=company_name,
        generated_at=datetime.now(timezone.utc).isoformat(),
        verdict=synth["verdict"],
        confidence=float(synth["confidence"]),
        position_size_pct=float(synth["position_size_pct"]),
        one_liner=synth["one_liner"],
        sections=sections,
        consumer_panel_forecast=panel,
        bunq_spending_overlay=bunq_spending,
        location_context=LocationContext(
            used=coords is not None,
            detected_at=location_label,
            coords=coords,
        ),
        risks=synth.get("risks", []),
        conflicts=synth.get("conflicts", []),
        data_gaps=synth.get("data_gaps", []),
    )
    yield {"event": "report", "report": report.model_dump()}
