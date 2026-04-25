"""Public-sentiment scrapers for the Pulse Check feature.

Pulls recent chatter for a ticker from a handful of free sources:
  - Reddit (r/wallstreetbets, r/stocks, r/investing) via the public JSON API
  - StockTwits messages stream (free, no auth)
  - Hacker News via the Algolia search API
  - Google News RSS (already wired in news.py)

No keys required. Each fetcher returns a list of normalized Post dicts so
the analyzer can score them uniformly. Failures are non-fatal — one source
going down should never block the whole pulse check.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from urllib.parse import quote_plus

import httpx

log = logging.getLogger("prospectus.social_sentiment")


@dataclass
class Post:
    source: str           # "reddit" | "stocktwits" | "hackernews" | "news"
    subforum: str         # e.g. "r/wallstreetbets" or "stocktwits" or domain for news
    title: str
    body: str
    url: str
    author: str
    posted_at: str        # ISO 8601 UTC
    score: int            # platform-native score (upvotes / likes / N comments)


_HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


def _ts_from_unix(unix_s: float | int) -> str:
    return datetime.fromtimestamp(float(unix_s), tz=timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Reddit — no auth needed for public threads. We use the json variant of
# search across three big retail-investing subs and pull top posts.
# ---------------------------------------------------------------------------

REDDIT_SUBS = ("wallstreetbets", "stocks", "investing")


def fetch_reddit(ticker: str, per_sub: int = 8) -> list[Post]:
    out: list[Post] = []
    for sub in REDDIT_SUBS:
        try:
            r = httpx.get(
                f"https://www.reddit.com/r/{sub}/search.json",
                params={
                    "q": f"${ticker} OR {ticker}",
                    "restrict_sr": 1,
                    "sort": "top",
                    "t": "month",
                    "limit": per_sub,
                },
                headers=_HEADERS,
                timeout=8.0,
                follow_redirects=True,
            )
            r.raise_for_status()
            j = r.json()
        except Exception as e:  # noqa: BLE001
            log.warning("reddit fetch r/%s for %s failed: %s", sub, ticker, e)
            continue
        children = (j.get("data") or {}).get("children") or []
        for c in children:
            d = c.get("data") or {}
            title = (d.get("title") or "").strip()
            body = (d.get("selftext") or "").strip()[:1200]
            url = "https://www.reddit.com" + (d.get("permalink") or "")
            score = int(d.get("score") or 0)
            comments = int(d.get("num_comments") or 0)
            author = d.get("author") or "anon"
            created = d.get("created_utc")
            posted_at = _ts_from_unix(created) if created else ""
            out.append(
                Post(
                    source="reddit",
                    subforum=f"r/{sub}",
                    title=title,
                    body=body,
                    url=url,
                    author=author,
                    posted_at=posted_at,
                    score=max(score, comments),
                )
            )
    out.sort(key=lambda p: p.score, reverse=True)
    return out


# ---------------------------------------------------------------------------
# StockTwits — free messages stream. Best signal for retail sentiment because
# many users self-tag bullish/bearish.
# ---------------------------------------------------------------------------


def fetch_stocktwits(ticker: str, limit: int = 25) -> list[Post]:
    """StockTwits uses bare US-style symbols (no .AS / .L suffix). We strip
    the exchange suffix when the ticker has one."""
    base = ticker.split(".")[0].upper()
    try:
        r = httpx.get(
            f"https://api.stocktwits.com/api/2/streams/symbol/{base}.json",
            params={"limit": limit},
            headers=_HEADERS,
            timeout=8.0,
        )
        r.raise_for_status()
        j = r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("stocktwits fetch %s failed: %s", base, e)
        return []
    messages = j.get("messages") or []
    out: list[Post] = []
    for m in messages:
        body = (m.get("body") or "").strip()
        if not body:
            continue
        sentiment = (m.get("entities") or {}).get("sentiment") or {}
        st_label = sentiment.get("basic")  # "Bullish" | "Bearish" | None
        title = f"[{st_label}] " if st_label else ""
        title += body[:80]
        out.append(
            Post(
                source="stocktwits",
                subforum="stocktwits",
                title=title.strip(),
                body=body[:600],
                url=f"https://stocktwits.com/{(m.get('user') or {}).get('username','')}/message/{m.get('id','')}",
                author=(m.get("user") or {}).get("username") or "anon",
                posted_at=m.get("created_at") or "",
                score=int(m.get("likes", {}).get("total", 0) or 0),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Hacker News — high-signal for tech tickers. Algolia search API is free.
# ---------------------------------------------------------------------------


def fetch_hackernews(ticker: str, company_name: str | None = None, limit: int = 12) -> list[Post]:
    queries = [ticker]
    if company_name:
        queries.append(company_name)
    seen: set[str] = set()
    out: list[Post] = []
    for q in queries:
        try:
            r = httpx.get(
                "https://hn.algolia.com/api/v1/search",
                params={
                    "query": q,
                    "tags": "story",
                    "hitsPerPage": limit,
                },
                headers=_HEADERS,
                timeout=8.0,
            )
            r.raise_for_status()
            j = r.json()
        except Exception as e:  # noqa: BLE001
            log.warning("hackernews fetch %s failed: %s", q, e)
            continue
        for h in j.get("hits") or []:
            sid = str(h.get("objectID") or "")
            if sid in seen:
                continue
            seen.add(sid)
            title = (h.get("title") or "").strip()
            url = h.get("url") or f"https://news.ycombinator.com/item?id={sid}"
            posted_at = h.get("created_at") or ""
            out.append(
                Post(
                    source="hackernews",
                    subforum="hackernews",
                    title=title,
                    body=(h.get("story_text") or "").strip()[:800],
                    url=url,
                    author=h.get("author") or "anon",
                    posted_at=posted_at,
                    score=int(h.get("points") or 0)
                    + int(h.get("num_comments") or 0),
                )
            )
    out.sort(key=lambda p: p.score, reverse=True)
    return out[:limit]


# ---------------------------------------------------------------------------
# Helpers exposed for the analyzer / endpoint.
# ---------------------------------------------------------------------------


def to_dict(p: Post) -> dict:
    return asdict(p)


def truncate_for_prompt(posts: list[Post], max_per_post: int = 320) -> str:
    """Build a single string of the top posts to feed Claude. Cap each post's
    body so the system prompt doesn't explode."""
    lines: list[str] = []
    for i, p in enumerate(posts, 1):
        head = f"[{i}] ({p.source} · {p.subforum} · {p.posted_at[:16]} · score={p.score}) {p.author}: {p.title}".strip()
        lines.append(head)
        if p.body:
            body = p.body[:max_per_post].replace("\n", " ").strip()
            if body:
                lines.append(f"    {body}")
    return "\n".join(lines)
