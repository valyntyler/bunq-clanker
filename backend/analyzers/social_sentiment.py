"""Social-sentiment analyzer.

Takes the merged post list from social_sentiment scrapers + recent news,
asks Claude to score the chatter as a market-impact signal, and returns
both per-post tags and an aggregate verdict.

Output shape is what the frontend renders directly — sentiment buckets,
themes, market-impact direction/magnitude, sample quotes.
"""

from __future__ import annotations

from typing import Any

from backend.llm import call_claude_json
from backend.scrapers.social_sentiment import Post, truncate_for_prompt

_SYSTEM = (
    "You are a sober equity analyst reading retail-investor chatter and "
    "public news to gauge market sentiment for a single ticker. Be "
    "calibrated, not breathless. Distinguish between echo-chamber hype "
    "(WSB-style memes) and substantive arguments. Note when bull/bear "
    "narratives diverge between sources. Never invent posts. If the chatter "
    "is thin or noisy, say so."
)


def _user_prompt(ticker: str, company_name: str, posts_block: str) -> str:
    return f"""Ticker: {ticker}
Company: {company_name}

You will receive a list of recent public posts about this ticker, drawn from
Reddit (wallstreetbets, stocks, investing), StockTwits, Hacker News, and
Google News. Score the overall chatter and pick out the most signal-bearing
posts.

POSTS:
{posts_block or '(no posts collected)'}

Return STRICT JSON with this shape (no extra keys):
{{
  "summary": "one paragraph (3–5 sentences) framing what people are saying right now",
  "aggregate_score": -1.0..1.0,
  "bullish_pct": 0..100,
  "bearish_pct": 0..100,
  "neutral_pct":  0..100,
  "themes": [
    {{ "label": "short theme name", "stance": "bullish|bearish|neutral", "support_count": int, "summary": "one sentence" }}
  ],
  "highlight_posts": [
    {{ "index": int (1-based, matching the [N] in POSTS), "stance": "bullish|bearish|neutral", "why": "one sentence" }}
  ],
  "market_impact": {{
    "direction": "bullish|bearish|neutral",
    "magnitude": 0..1,
    "horizon": "near-term|medium-term|long-term",
    "reasoning": "two sentences citing specific themes / outlets, no hype"
  }},
  "caveats": ["short caveat 1", "short caveat 2"]
}}

Rules:
  - bullish_pct + bearish_pct + neutral_pct must sum to 100.
  - magnitude reflects how much the chatter could plausibly move the price.
  - If all posts are stale or off-topic, set magnitude near 0 and say so in caveats.
"""


def analyze_social_sentiment(
    ticker: str,
    company_name: str,
    posts: list[Post],
) -> dict[str, Any]:
    block = truncate_for_prompt(posts, max_per_post=320)
    raw = call_claude_json(
        _user_prompt(ticker, company_name, block),
        system=_SYSTEM,
        max_tokens=1800,
    )
    # Normalize per-post stance back onto the original post list so the UI
    # can render coloured chips without doing index math itself.
    per_post: dict[int, str] = {}
    per_post_why: dict[int, str] = {}
    for h in raw.get("highlight_posts") or []:
        try:
            idx = int(h.get("index", 0))
            stance = (h.get("stance") or "neutral").lower()
            per_post[idx] = stance
            per_post_why[idx] = (h.get("why") or "").strip()[:240]
        except (TypeError, ValueError):
            continue
    annotated_posts: list[dict] = []
    for i, p in enumerate(posts, 1):
        annotated_posts.append({
            "source": p.source,
            "subforum": p.subforum,
            "title": p.title,
            "body": p.body,
            "url": p.url,
            "author": p.author,
            "posted_at": p.posted_at,
            "score": p.score,
            "stance": per_post.get(i),
            "why": per_post_why.get(i),
        })

    # Coerce sums to 100 in case Claude's percentages drift.
    bull = float(raw.get("bullish_pct", 0) or 0)
    bear = float(raw.get("bearish_pct", 0) or 0)
    neu = float(raw.get("neutral_pct", 0) or 0)
    total = bull + bear + neu
    if total > 0 and abs(total - 100) > 1:
        bull, bear, neu = (round(bull * 100 / total, 1),
                           round(bear * 100 / total, 1),
                           round(neu * 100 / total, 1))

    return {
        "summary": (raw.get("summary") or "").strip()[:1500],
        "aggregate_score": _clamp(raw.get("aggregate_score"), -1.0, 1.0),
        "bullish_pct": bull,
        "bearish_pct": bear,
        "neutral_pct": neu,
        "themes": [
            {
                "label": (t.get("label") or "")[:80],
                "stance": (t.get("stance") or "neutral").lower(),
                "support_count": int(t.get("support_count") or 0),
                "summary": (t.get("summary") or "")[:240],
            }
            for t in (raw.get("themes") or [])
        ][:8],
        "market_impact": {
            "direction": (raw.get("market_impact") or {}).get("direction", "neutral"),
            "magnitude": _clamp((raw.get("market_impact") or {}).get("magnitude"), 0.0, 1.0),
            "horizon": (raw.get("market_impact") or {}).get("horizon", "near-term"),
            "reasoning": ((raw.get("market_impact") or {}).get("reasoning") or "")[:600],
        },
        "caveats": [c[:140] for c in (raw.get("caveats") or []) if c][:5],
        "posts": annotated_posts,
        "post_count": len(posts),
        "by_source": _by_source(posts),
    }


def _by_source(posts: list[Post]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for p in posts:
        counts[p.source] = counts.get(p.source, 0) + 1
    return counts


def _clamp(v: Any, lo: float, hi: float) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return max(lo, min(hi, f))
