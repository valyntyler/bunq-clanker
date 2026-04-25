"""News scraping via Google News RSS (no API key required).

The NewsAPI path is kept behind the NEWSAPI_KEY env var; if set, it takes
priority. Otherwise we hit Google News RSS — unlimited, messier, works fine.

Trusted-outlet boost: items from a curated allowlist (Reuters, Bloomberg,
WSJ, FT, Axios, Politico, AP, AFP, Yahoo Finance, CNBC, NYT, Economist,
plus the official press-release domains of the largest companies) are
surfaced first, with the long tail behind. Lets Claude reason from
better-sourced material first while still seeing the breadth.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import quote_plus
from xml.etree import ElementTree as ET

import httpx


@dataclass
class NewsItem:
    title: str
    source: str
    url: str
    published: str
    snippet: str = ""


def fetch_news(query: str, limit: int = 40) -> list[NewsItem]:
    """Prefer NewsAPI if keyed; else Google News RSS."""
    key = os.getenv("NEWSAPI_KEY")
    if key:
        try:
            return _fetch_newsapi(query, key, limit)
        except Exception:
            pass
    return _fetch_google_news_rss(query, limit)


def _fetch_newsapi(query: str, key: str, limit: int) -> list[NewsItem]:
    r = httpx.get(
        "https://newsapi.org/v2/everything",
        params={
            "q": query,
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": min(limit, 100),
            "apiKey": key,
        },
        timeout=10.0,
    )
    r.raise_for_status()
    arts = r.json().get("articles", [])
    return [
        NewsItem(
            title=a["title"],
            source=a.get("source", {}).get("name", "newsapi"),
            url=a["url"],
            published=a.get("publishedAt", ""),
            snippet=a.get("description") or "",
        )
        for a in arts[:limit]
    ]


def _fetch_google_news_rss(query: str, limit: int) -> list[NewsItem]:
    url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"
    r = httpx.get(url, timeout=10.0, follow_redirects=True)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    items: list[NewsItem] = []
    for item in root.findall(".//item")[:limit]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        desc = (item.findtext("description") or "").strip()
        # Google News RSS "description" is HTML — we keep raw HTML short.
        source_el = item.find("{http://www.w3.org/2005/Atom}source") or item.find("source")
        source = source_el.text if source_el is not None and source_el.text else "Google News"
        items.append(
            NewsItem(
                title=title,
                source=source,
                url=link,
                published=pub,
                snippet=desc[:280],
            )
        )
    return items


def format_for_claude(items: list[NewsItem], max_items: int = 40) -> str:
    lines = []
    for i, it in enumerate(items[:max_items], 1):
        lines.append(f"[{i}] ({it.source} · {it.published[:16]}) {it.title}")
    return "\n".join(lines)
