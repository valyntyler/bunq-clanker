"""30-day news sentiment + material events.

Given a headline list, Claude produces a sentiment score, the top material
events (product launches, lawsuits, exec changes), and a one-sentence summary.
"""

from __future__ import annotations

from backend.llm import call_claude_json
from backend.models import Section
from backend.scrapers.news import fetch_news, format_for_claude

SYSTEM = (
    "You are an equity-market news analyst. Given recent headlines, estimate "
    "overall market sentiment on the stock from -1 (very negative) to +1 "
    "(very positive), and flag material events (lawsuits, M&A, exec changes, "
    "earnings surprises, regulatory actions, product launches). Ignore noise "
    "and repeated stories. Do not invent events that aren't in the headlines."
)


def analyze_news(symbol: str, company_name: str | None = None) -> Section:
    query = company_name or symbol
    items = fetch_news(query, limit=50)
    if not items:
        return Section(
            score=0.0,
            summary="No recent news coverage found.",
            sources=[],
            extra={"news_count": 0},
        )
    headlines = format_for_claude(items, max_items=40)
    user = f"""Recent news headlines for {query} (most recent first):

{headlines}

Return STRICT JSON with keys:
  score: number -1..+1 (overall sentiment)
  summary: string (one sentence summarizing the current news narrative)
  material_events: string[] (max 5, each a terse event with date if known)
  top_stories: {{"title": string, "source": string, "why_it_matters": string}}[] (max 3)
"""
    out = call_claude_json(user, system=SYSTEM, max_tokens=800)
    return Section(
        score=float(out["score"]),
        summary=out["summary"],
        sources=[f"google-news:{query}"],
        extra={
            "news_count": len(items),
            "material_events": out.get("material_events", []),
            "top_stories": out.get("top_stories", []),
        },
    )
