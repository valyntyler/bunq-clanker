"""Live newsroom — single shared poller with per-user SSE subscribers.

Architecture
    One asyncio task polls Reuters / Bloomberg / AP / Yahoo Finance / WSJ
    RSS every NEWSROOM_POLL_INTERVAL_S seconds, dedupes by URL, and pushes
    new items into every connected subscriber queue. The cache lives in
    memory (per-process) and is bounded so a long-running session can't
    leak unboundedly. Per-user filtering happens at the subscribe-time
    boundary: each subscriber gets new items as they land, but the
    /news/stream handler can apply a watchlist filter on top.

Why singleton-poll-many-subscribers
    RSS feeds rate-limit hard if every connected user pulls them
    independently, and the same headline is the same headline regardless
    of which user is reading. One poll → fan-out to N subscribers is the
    cheap and correct shape.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Iterator
from urllib.parse import quote_plus, urlparse
from xml.etree import ElementTree as ET

import httpx

log = logging.getLogger("prospectus.newsroom")

NEWSROOM_POLL_INTERVAL_S = int(os.getenv("NEWSROOM_POLL_INTERVAL_S", "90"))
# Hard cap on the in-memory cache. Items beyond this are evicted oldest-first.
NEWSROOM_CACHE_MAX = int(os.getenv("NEWSROOM_CACHE_MAX", "500"))


@dataclass
class NewsroomItem:
    id: str          # sha256-prefix of the URL — stable across polls
    title: str
    source: str      # "Reuters" | "Bloomberg" | "AP" | "Yahoo Finance" | ...
    url: str
    published: str   # ISO 8601 UTC
    snippet: str
    fetched_at: str  # ISO 8601 UTC — when WE saw it (often newer than published)
    tickers: list[str]  # tickers matched against the user-search-history watchlist


def _digest(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


_HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


# Source-domain → display name. The Google News RSS path returns a wrapper
# domain, so we sniff the underlying URL to attribute correctly.
_SOURCE_LABELS: dict[str, str] = {
    "reuters.com": "Reuters",
    "bloomberg.com": "Bloomberg",
    "apnews.com": "AP",
    "ap.org": "AP",
    "ft.com": "Financial Times",
    "wsj.com": "WSJ",
    "nytimes.com": "NYT",
    "axios.com": "Axios",
    "cnbc.com": "CNBC",
    "marketwatch.com": "MarketWatch",
    "yahoo.com": "Yahoo Finance",
    "finance.yahoo.com": "Yahoo Finance",
    "economist.com": "Economist",
    "politico.com": "Politico",
    "bbc.com": "BBC",
    "bbc.co.uk": "BBC",
}


def _label_for(url: str, fallback: str = "News") -> str:
    """Resolve a URL OR a free-form source string to a clean display name."""
    if not url:
        return fallback
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:  # noqa: BLE001
        host = ""
    if host.startswith("www."):
        host = host[4:]
    if host:
        parts = host.split(".")
        for i in range(len(parts) - 1):
            suffix = ".".join(parts[i:])
            if suffix in _SOURCE_LABELS:
                return _SOURCE_LABELS[suffix]
    # The arg might be free-form text from <source> rather than a URL.
    cleaned = url.strip().rstrip(".")
    cl = cleaned.lower()
    if cl.endswith(".com"):
        cl = cl[:-4]
        cleaned = cleaned[: -4]
    # Final lookup against the label map by suffix on the cleaned text.
    for k, v in _SOURCE_LABELS.items():
        if k.split(".")[0] == cl or v.lower() == cl:
            return v
    if cleaned and cleaned != host:
        # Title-case "bloomberg" → "Bloomberg" but keep all-caps acronyms.
        return cleaned[:1].upper() + cleaned[1:]
    return fallback


# Curated set of feeds. We use Google News RSS site-filter queries so we
# don't have to worry about each outlet's RSS path changing.
_FEEDS: list[tuple[str, str]] = [
    ("Reuters",       "site:reuters.com"),
    ("Bloomberg",     "site:bloomberg.com"),
    ("AP",            "site:apnews.com"),
    ("WSJ",           "site:wsj.com"),
    ("FT",            "site:ft.com"),
    ("Yahoo Finance", "site:finance.yahoo.com"),
    ("CNBC",          "site:cnbc.com"),
]


def _fetch_one_feed(feed_label: str, query: str, limit: int = 30) -> list[NewsroomItem]:
    url = (
        f"https://news.google.com/rss/search?q={quote_plus(query)}"
        f"+when:1d&hl=en-US&gl=US&ceid=US:en"
    )
    try:
        r = httpx.get(url, headers=_HEADERS, timeout=8.0, follow_redirects=True)
        r.raise_for_status()
        root = ET.fromstring(r.content)
    except Exception as e:  # noqa: BLE001
        log.warning("newsroom: feed %s failed: %s", feed_label, e)
        return []
    now = datetime.now(timezone.utc).isoformat()
    out: list[NewsroomItem] = []
    for item in root.findall(".//item")[:limit]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        published = (item.findtext("pubDate") or "").strip()
        snippet = (item.findtext("description") or "").strip()[:300]
        # Google News wraps every URL through news.google.com so the link
        # hostname is useless for source attribution. Two reliable signals:
        # the <source> child element AND a " - Outlet" suffix on the title.
        source_label = feed_label
        src_el = item.find("source")
        if src_el is not None:
            # Prefer the source element's `url` attribute (canonical) for
            # _label_for; fall back to its text content (also normalized).
            src_url = (src_el.get("url") or "").strip()
            if src_url:
                source_label = _label_for(src_url, fallback=feed_label)
            elif (src_el.text or "").strip():
                source_label = _label_for(src_el.text.strip(), fallback=feed_label)
        # Trim the trailing " - Outlet" Google appends, since we now have
        # the source out-of-band.
        if " - " in title:
            head, tail = title.rsplit(" - ", 1)
            if len(tail) <= 40:
                title = head.strip()
                # If we somehow still don't have a clean source, use the
                # suffix — but pass it through _label_for so 'Bloomberg.com'
                # collapses to 'Bloomberg', etc.
                if source_label in (feed_label, "news.google.com"):
                    source_label = _label_for(tail.strip(), fallback=feed_label)
        out.append(
            NewsroomItem(
                id=_digest(link),
                title=title,
                source=source_label,
                url=link,
                published=published,
                snippet=snippet,
                fetched_at=now,
                tickers=[],
            )
        )
    return out


def _fetch_all() -> list[NewsroomItem]:
    """Hit every curated feed in parallel-ish (sequential httpx is fine —
    the whole set finishes in a few seconds and we only run every 90s)."""
    seen: set[str] = set()
    out: list[NewsroomItem] = []
    for label, query in _FEEDS:
        for item in _fetch_one_feed(label, query, limit=30):
            if item.id in seen:
                continue
            seen.add(item.id)
            out.append(item)
    return out


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------


class Newsroom:
    """Process-wide poll-and-fan-out service. Start once on app boot."""

    def __init__(self) -> None:
        self.cache: dict[str, NewsroomItem] = {}
        self._cache_order: list[str] = []  # FIFO of ids for eviction
        self._subscribers: set[asyncio.Queue[NewsroomItem]] = set()
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._poll_loop(), name="newsroom-poller")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        self._task = None

    async def _poll_loop(self) -> None:
        # First poll runs immediately so subscribers don't have to wait
        # NEWSROOM_POLL_INTERVAL_S seconds for any data on first connect.
        while True:
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("newsroom: poll cycle failed")
            try:
                await asyncio.sleep(NEWSROOM_POLL_INTERVAL_S)
            except asyncio.CancelledError:
                return

    async def _poll_once(self) -> None:
        items = await asyncio.to_thread(_fetch_all)
        new_items: list[NewsroomItem] = []
        async with self._lock:
            for it in items:
                if it.id in self.cache:
                    continue
                self.cache[it.id] = it
                self._cache_order.append(it.id)
                new_items.append(it)
            # Evict if we're over the cap.
            while len(self._cache_order) > NEWSROOM_CACHE_MAX:
                old = self._cache_order.pop(0)
                self.cache.pop(old, None)
        if new_items:
            log.info("newsroom: +%d new headlines (cache=%d)", len(new_items), len(self.cache))
            # Fan out to every subscriber. Use a bounded put — if a
            # consumer is slow we drop instead of blocking the poller.
            for q in list(self._subscribers):
                for it in new_items:
                    try:
                        q.put_nowait(it)
                    except asyncio.QueueFull:
                        log.warning("newsroom: subscriber queue full — dropping item")

    # ------------------------------------------------------------------
    # Public API used by the SSE / REST endpoints
    # ------------------------------------------------------------------

    def recent(self, limit: int = 30) -> list[NewsroomItem]:
        return sorted(
            self.cache.values(),
            key=lambda i: (i.fetched_at, i.published),
            reverse=True,
        )[:limit]

    def subscribe(self) -> asyncio.Queue[NewsroomItem]:
        q: asyncio.Queue[NewsroomItem] = asyncio.Queue(maxsize=128)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[NewsroomItem]) -> None:
        self._subscribers.discard(q)


_singleton: Newsroom | None = None


def get_newsroom() -> Newsroom:
    global _singleton
    if _singleton is None:
        _singleton = Newsroom()
    return _singleton


# ---------------------------------------------------------------------------
# Watchlist matching — connects newsroom items to a user's research history.
# ---------------------------------------------------------------------------


def watchlist_match(item: NewsroomItem, watchlist: list[dict]) -> list[str]:
    """Return the subset of watchlist tickers that this item plausibly
    relates to. Cheap text match against title + snippet (case-insensitive,
    word-boundary on tickers, substring on company names) — fast, runs on
    every item without touching Claude.

    `watchlist` rows have shape: {ticker, company_name, aliases?}.
    """
    if not watchlist:
        return []
    blob = (item.title + " " + item.snippet).lower()
    hits: list[str] = []
    for row in watchlist:
        t = (row.get("ticker") or "").upper()
        if not t:
            continue
        # Match the ticker as a token (with optional $ prefix) so we don't
        # false-match e.g. KO inside "broke".
        token = t.lower()
        if _word_match(blob, token):
            hits.append(t)
            continue
        company = (row.get("company_name") or "").lower().strip()
        if company and len(company) >= 4 and company in blob:
            hits.append(t)
            continue
        for alias in row.get("aliases") or []:
            if alias and len(alias) >= 4 and alias.lower() in blob:
                hits.append(t)
                break
    return hits


def _word_match(haystack: str, needle: str) -> bool:
    """Word-boundary substring match without pulling in regex for the hot
    path. Treats $TICKER and TICKER as both valid hits."""
    if not needle:
        return False
    idx = 0
    while True:
        pos = haystack.find(needle, idx)
        if pos < 0:
            return False
        before = haystack[pos - 1] if pos > 0 else " "
        after = haystack[pos + len(needle)] if pos + len(needle) < len(haystack) else " "
        # Allow a leading $ on the ticker token.
        if (not before.isalnum() or before == "$") and not after.isalnum():
            return True
        idx = pos + 1


def to_dict(item: NewsroomItem) -> dict:
    return asdict(item)


def iter_recent_with_watchlist(
    watchlist: list[dict], limit: int = 30
) -> Iterator[dict]:
    """Helper for the REST endpoint — yield recent items, each tagged with
    its matched-watchlist ticker list."""
    for it in get_newsroom().recent(limit):
        matched = watchlist_match(it, watchlist)
        d = to_dict(it)
        d["tickers"] = matched
        yield d
