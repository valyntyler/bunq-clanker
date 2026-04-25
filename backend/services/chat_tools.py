"""Live tools the chat-panel synthesizer can call mid-conversation.

When the user asks something the static report can't answer ('what's the
latest news on Apple?', 'is the chart breaking out today?', 'is Reddit
bullish on Tesla?'), Claude calls one of these tools, we run it, and the
result flows back into the conversation. Each tool returns a compact
text summary — keeping Claude's context window from blowing up — but
also surfaces 1-2 source links the chat UI can render as 'I checked X'
chips next to the answer.

The dispatcher streams progress events to the SSE client so the chat UI
can show 'Querying news for AAPL…' as an italic sub-line before Claude
resumes typing.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote_plus
from xml.etree import ElementTree as ET

import httpx

log = logging.getLogger("prospectus.chat_tools")

_HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


# ---------------------------------------------------------------------------
# Tool descriptors — exactly the schema Bedrock + Anthropic Messages API
# wants. Each block describes what Claude is allowed to call.
# ---------------------------------------------------------------------------


TOOL_DEFINITIONS: list[dict] = [
    {
        "name": "search_news",
        "description": (
            "Search recent news headlines for a ticker, company, or topic. "
            "Use this when the user asks about LATEST or RECENT news, what's "
            "happened today / this week, what people are saying, or any "
            "question that requires fresh information beyond the report. "
            "Always announce briefly what you're going to check before "
            "calling this tool ('let me pull the latest news on …')."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query — ticker, company name, or topic.",
                },
                "days": {
                    "type": "integer",
                    "description": "How recent (default 7). Use 1 for breaking, 30 for monthly context.",
                    "default": 7,
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "fetch_quote",
        "description": (
            "Fetch the current price, day move, market cap, and key valuation "
            "metrics for a ticker. Use when the user asks 'what's the price', "
            "'how is it trading today', or any question that needs a CURRENT "
            "number not in the report."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "ticker": {"type": "string", "description": "Yahoo Finance ticker (e.g. AAPL, HEIA.AS)"},
            },
            "required": ["ticker"],
        },
    },
    {
        "name": "web_search",
        "description": (
            "General web search via Google News RSS for any topic. Use when "
            "the user asks something that isn't a ticker query — analyst "
            "reports, sector trends, regulatory news, conference calls. "
            "Returns titles + snippets + source links from trusted outlets."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "fetch_panel_data",
        "description": (
            "Re-fetch the live consumer-panel YoY growth for a ticker (Bunq "
            "alt-data). Use when the user asks if the panel signal has "
            "changed, or 'what does the panel say right now'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "ticker": {"type": "string"},
            },
            "required": ["ticker"],
        },
    },
]


# ---------------------------------------------------------------------------
# Tool implementations. Each returns (text_for_claude, ui_chip_metadata).
# The UI chip is a small structured payload the chat-panel renders as a
# clickable source citation under the assistant's reply.
# ---------------------------------------------------------------------------


def _exec_search_news(args: dict) -> tuple[str, dict]:
    query = (args.get("query") or "").strip()
    days = int(args.get("days") or 7)
    if not query:
        return ("(no query supplied)", {"sources": []})
    url = (
        f"https://news.google.com/rss/search?q={quote_plus(query)}"
        f"+when:{days}d&hl=en-US&gl=US&ceid=US:en"
    )
    try:
        r = httpx.get(url, headers=_HEADERS, timeout=8.0, follow_redirects=True)
        r.raise_for_status()
        root = ET.fromstring(r.content)
    except Exception as e:  # noqa: BLE001
        return (f"(news search failed: {e})", {"sources": []})

    items: list[dict] = []
    for item in root.findall(".//item")[:8]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        if title and link:
            # Strip the " - Outlet" suffix Google appends.
            if " - " in title:
                head, tail = title.rsplit(" - ", 1)
                if len(tail) <= 40:
                    title = head.strip()
            items.append({"title": title, "url": link, "published": pub[:25]})

    if not items:
        return (f"No recent news found for '{query}' in the last {days}d.", {"sources": []})

    lines = [f"Top {len(items)} headlines for '{query}' (last {days}d):"]
    for i, it in enumerate(items, 1):
        lines.append(f"  [{i}] {it['title']}  ({it['published']})")
    return ("\n".join(lines), {"sources": items[:5]})


def _exec_fetch_quote(args: dict) -> tuple[str, dict]:
    ticker = (args.get("ticker") or "").strip().upper()
    if not ticker:
        return ("(no ticker supplied)", {"sources": []})
    try:
        from backend.scrapers.yahoo import fetch_fundamentals, fetch_ohlcv
        f = fetch_fundamentals(ticker)
    except Exception as e:  # noqa: BLE001
        return (f"(quote fetch failed for {ticker}: {e})", {"sources": []})

    if not f or not getattr(f, "price", None):
        return (f"(no quote data for {ticker})", {"sources": []})

    ccy = f.currency or "$"
    sym = "$" if ccy == "USD" else "€" if ccy == "EUR" else ccy + " "
    parts = [
        f"Live snapshot for {ticker} ({f.name or ticker}):",
        f"  price: {sym}{f.price:.2f}",
    ]
    # Derive day move from the most-recent two OHLCV bars.
    try:
        bars, _ccy = fetch_ohlcv(ticker, "5d")
        if bars and len(bars) >= 2:
            prev_close = float(bars[-2]["close"])
            delta = f.price - prev_close
            pct = (delta / prev_close) * 100 if prev_close else 0
            parts.append(f"  prev close: {sym}{prev_close:.2f}  ({delta:+.2f}, {pct:+.2f}%)")
    except Exception:  # noqa: BLE001
        pass
    if f.market_cap:
        parts.append(f"  market cap: {_humanize_money(f.market_cap)}")
    if f.trailing_pe:
        parts.append(f"  P/E (trailing): {f.trailing_pe:.1f}")
    if f.forward_pe:
        parts.append(f"  P/E (forward): {f.forward_pe:.1f}")
    if f.profit_margin is not None:
        parts.append(f"  profit margin: {f.profit_margin*100:.1f}%")
    return ("\n".join(parts), {"sources": []})


def _humanize_money(n: float | int | None) -> str:
    if n is None:
        return "—"
    n = float(n)
    if abs(n) >= 1e12:
        return f"${n/1e12:.2f}T"
    if abs(n) >= 1e9:
        return f"${n/1e9:.2f}B"
    if abs(n) >= 1e6:
        return f"${n/1e6:.1f}M"
    return f"${n:,.0f}"


def _exec_web_search(args: dict) -> tuple[str, dict]:
    # Reuse the same Google News RSS path with a 30-day window for broader
    # web-style queries. Production would use a real web search API.
    return _exec_search_news({"query": args.get("query"), "days": 30})


def _exec_fetch_panel_data(args: dict) -> tuple[str, dict]:
    ticker = (args.get("ticker") or "").strip().upper()
    if not ticker:
        return ("(no ticker supplied)", {"sources": []})
    try:
        from backend.analyzers.consumer_panel import analyze_consumer_panel
        forecast = analyze_consumer_panel(ticker)
    except KeyError:
        return (f"No panel data covered for {ticker}.", {"sources": []})
    except Exception as e:  # noqa: BLE001
        return (f"(panel fetch failed: {e})", {"sources": []})

    return (
        f"Live panel for {ticker}:\n"
        f"  YoY {forecast.yoy_change_pct:+.1f}% · QoQ {forecast.qoq_change_pct:+.1f}% · "
        f"trend={forecast.trend} · panel N={forecast.panel_size_n}\n"
        f"  next quarter: direction={forecast.next_quarter.revenue_direction} "
        f"vs consensus {forecast.next_quarter.vs_consensus_pct} (conf {forecast.next_quarter.confidence:.2f})\n"
        f"  source: {forecast.source}",
        {"sources": []},
    )


_DISPATCH = {
    "search_news": _exec_search_news,
    "fetch_quote": _exec_fetch_quote,
    "web_search": _exec_web_search,
    "fetch_panel_data": _exec_fetch_panel_data,
}


def execute_tool(name: str, args: dict) -> tuple[str, dict]:
    """Run a tool by name. Returns (text-for-Claude, ui-chip-metadata).
    Always returns gracefully — tool errors flow back to Claude as text so
    it can apologise and continue, rather than crashing the chat."""
    fn = _DISPATCH.get(name)
    if fn is None:
        return (f"(unknown tool: {name})", {"sources": []})
    try:
        return fn(args)
    except Exception as e:  # noqa: BLE001
        log.exception("tool %s failed", name)
        return (f"(tool '{name}' raised: {e})", {"sources": []})


def ui_announce(name: str, args: dict) -> str:
    """Short user-facing announcement of which tool is firing. Shown as an
    italic sub-line in the chat bubble so the user sees what's happening."""
    if name == "search_news":
        q = (args.get("query") or "").strip()
        d = int(args.get("days") or 7)
        return f"Searching the last {d} days of news for {q!r}…"
    if name == "fetch_quote":
        return f"Fetching live quote for {args.get('ticker')}…"
    if name == "web_search":
        return f"Searching the web for {args.get('query')!r}…"
    if name == "fetch_panel_data":
        return f"Re-pulling live panel data for {args.get('ticker')}…"
    return f"Running tool {name}…"
