"""Geopolitical event monitor.

Curated Google News RSS queries that surface recent statements / actions from
market-moving figures. Returns lightweight events: speaker, event_id, title,
snippet, published, source_url.

Live monitor wins us the right to say "the pipeline is real, this wasn't
pre-baked" during judging — even though we run it on demand, not on a poller.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote_plus
from xml.etree import ElementTree as ET

import httpx


@dataclass
class GeoEvent:
    event_id: str
    speaker: str
    title: str
    snippet: str
    published: str
    source_url: str
    query: str


# Speaker -> Google News query string. Tuned for high signal-to-noise on
# market-moving statements. We keep ~20 hits per query and let the analyzer
# filter for ticker relevance.
QUERIES: dict[str, str] = {
    "US President": "(Trump OR \"White House\") (tariffs OR sanctions OR \"executive order\")",
    "Federal Reserve": "(\"Federal Reserve\" OR FOMC OR Powell) (rates OR policy OR inflation)",
    "ECB President": "(\"European Central Bank\" OR ECB OR Lagarde) (rates OR policy OR euro)",
    "EU Commission": "(\"European Commission\" OR Brussels) (antitrust OR fine OR \"AI Act\" OR regulation)",
    "China / MOFCOM": "(China OR Xi OR MOFCOM) (export controls OR semiconductors OR tariffs)",
    "OPEC": "OPEC (output OR cut OR production OR oil)",
}

_HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


def _slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    return s[:60]


def _digest(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:8]


def _fetch_rss(query: str, max_items: int = 12) -> list[dict]:
    url = (
        f"https://news.google.com/rss/search?q={quote_plus(query)}"
        f"+when:7d&hl=en-US&gl=US&ceid=US:en"
    )
    r = httpx.get(url, headers=_HEADERS, timeout=8.0, follow_redirects=True)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    out: list[dict] = []
    for item in root.findall(".//item")[:max_items]:
        out.append(
            {
                "title": (item.findtext("title") or "").strip(),
                "link": (item.findtext("link") or "").strip(),
                "pub": (item.findtext("pubDate") or "").strip(),
                "desc": (item.findtext("description") or "").strip(),
            }
        )
    return out


def fetch_recent_events(per_speaker: int = 6) -> list[GeoEvent]:
    """Pull recent items across all curated speaker queries."""
    events: list[GeoEvent] = []
    today = datetime.now(timezone.utc).date().isoformat()
    for speaker, query in QUERIES.items():
        try:
            items = _fetch_rss(query, max_items=per_speaker)
        except Exception:  # noqa: BLE001
            continue
        for it in items[:per_speaker]:
            slug = _slugify(it["title"]) or _digest(it["link"])
            events.append(
                GeoEvent(
                    event_id=f"{_slugify(speaker)}-{slug}-{today}"[:80],
                    speaker=speaker,
                    title=it["title"],
                    snippet=it["desc"][:240],
                    published=it["pub"][:25],
                    source_url=it["link"],
                    query=query,
                )
            )
    return events


def format_for_claude(events: list[GeoEvent], max_n: int = 25) -> str:
    lines = []
    for i, e in enumerate(events[:max_n], 1):
        lines.append(
            f"[{i}] speaker={e.speaker} | published={e.published[:16]}"
            f" | id={e.event_id}"
        )
        lines.append(f"    {e.title}")
    return "\n".join(lines)
