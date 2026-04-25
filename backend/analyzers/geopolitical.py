"""Geopolitical analyzer.

Given recent monitor events and the target ticker, ask Claude to:
  1. Filter to events whose policy/market implications are relevant to the
     ticker's sector, geography, or supply chain.
  2. For each relevant event, score relevance (0..1), impact_direction (-1/0/+1),
     impact_magnitude (0..1), and write a one-sentence reasoning that connects
     the statement to the ticker's revenue/cost/regulatory exposure.

Hard ethical guardrails (in the system prompt):
  - Describe observable facts only; never characterize the speaker.
  - Reason about market impact only, not about the speaker's intent.
  - Stay away from political commentary; this is a market-relevance lens.
"""

from __future__ import annotations

from backend.llm import call_claude_json
from backend.models import GeopoliticalOverlay
from backend.scrapers.geopolitical_monitor import (
    GeoEvent,
    fetch_recent_events,
    format_for_claude,
)

# Minimal hint fallback so geopolitical works even when called with just a
# ticker (e.g. before fundamentals resolves). Pairs ticker -> short sector
# string Claude can reason about.
TICKER_HINTS: dict[str, tuple[str, str]] = {
    "HEIA.AS":  ("Heineken",          "beer / consumer staples · EU production · global supply chain"),
    "AD.AS":    ("Ahold Delhaize",    "grocery retail · EU + US · staples"),
    "INGA.AS":  ("ING Group",         "EU bank · rates-sensitive"),
    "ABN.AS":   ("ABN AMRO",          "EU bank · rates-sensitive"),
    "ADYEN.AS": ("Adyen",             "EU payments · cross-border ecommerce"),
    "PHIA.AS":  ("Philips",           "medical devices · EU healthtech"),
    "UNA.AS":   ("Unilever",          "consumer staples · global brands · supply chain"),
    "TKWY.AS":  ("Just Eat Takeaway", "food delivery · EU consumer"),
    "KPN.AS":   ("KPN",               "telecom · NL"),
    "PRX.AS":   ("Prosus",            "EU-listed · holding · large Tencent stake"),
    "ASML.AS":  ("ASML",              "EUV lithography · semiconductors · China export controls"),
    "AAPL":     ("Apple",             "consumer electronics · China supply chain · services"),
    "GOOGL":    ("Alphabet",          "US big-tech · ad market · antitrust"),
    "MSFT":     ("Microsoft",         "US big-tech · cloud · enterprise IT"),
    "META":     ("Meta",              "US big-tech · ad market · EU regulation"),
    "NVDA":     ("NVIDIA",            "GPUs · AI buildout · China export controls"),
    "TSLA":     ("Tesla",             "EVs · autos · China demand · tariffs"),
    "AMZN":     ("Amazon",            "US ecommerce · AWS · global trade"),
    "NFLX":     ("Netflix",           "streaming · global content"),
    "SBUX":     ("Starbucks",         "QSR coffee · China consumer"),
    "NKE":      ("Nike",              "apparel · global supply chain · China consumer"),
    "MCD":      ("McDonald's",        "QSR · global · franchise"),
    "KO":       ("Coca-Cola",         "non-alc beverages · global"),
    "SHEL.L":   ("Shell",             "integrated oil & gas · OPEC-sensitive"),
    "MC.PA":    ("LVMH",              "luxury · China consumer · EU production"),
    "RMS.PA":   ("Hermès",            "luxury · EU production · China demand"),
    "SAP.DE":   ("SAP",               "EU enterprise software · cloud"),
}

SYSTEM = (
    "You are an equity analyst evaluating recent public statements / actions "
    "from political and central-bank figures for their potential impact on a "
    "specific stock. Hard rules: "
    "(1) Describe observable facts only — never characterize the speaker's "
    "intent or character. "
    "(2) Reason about market-implications only — what the statement could do "
    "to revenue, costs, demand, regulation, or supply chain. "
    "(3) No political commentary or partisan framing. "
    "(4) Skip events whose relevance to the ticker is below 0.3. "
    "(5) Do not invent details that are not in the headline / snippet."
)


def analyze_geopolitical(
    *,
    ticker: str,
    company_name: str | None,
    sector: str | None,
    max_overlays: int = 3,
) -> list[GeopoliticalOverlay]:
    events = fetch_recent_events(per_speaker=4)
    if not events:
        return []

    hint_name, hint_sector = TICKER_HINTS.get(ticker.upper(), (None, None))
    eff_name = company_name or hint_name
    eff_sector = sector or hint_sector

    user = f"""Ticker: {ticker}{f' ({eff_name})' if eff_name else ''}
Sector / industry hint: {eff_sector or 'unknown'}

Recent geopolitical / central-bank events (last ~7 days):
{format_for_claude(events, max_n=25)}

For each event whose market-relevance to {ticker} is >= 0.3, emit an overlay.
Prioritize the {max_overlays} most material; ignore the rest.

Return STRICT JSON: {{"overlays": [
  {{
    "event_id": "(use the id field from the input)",
    "speaker": "(the speaker name from the input)",
    "relevance": number 0..1,
    "impact_direction": -1 | 0 | 1,
    "impact_magnitude": number 0..1,
    "reasoning": "one-sentence market-implication for {ticker}",
    "transcript_excerpt": "(quote the most material clause from the title)"
  }}
]}}
"""
    out = call_claude_json(user, system=SYSTEM, max_tokens=1200)

    by_id = {e.event_id: e for e in events}
    overlays: list[GeopoliticalOverlay] = []
    for item in out.get("overlays", [])[:max_overlays]:
        ev_id = item.get("event_id")
        ev = by_id.get(ev_id)
        if ev is None:
            # Claude sometimes paraphrases the id; fall back to title match
            for e in events:
                if e.title[:40].lower() in (item.get("transcript_excerpt") or "").lower():
                    ev = e
                    break
        if ev is None:
            continue
        try:
            overlays.append(
                GeopoliticalOverlay(
                    event_id=ev.event_id,
                    speaker=ev.speaker,
                    clip_url=None,
                    source_url=ev.source_url,
                    relevance=float(item["relevance"]),
                    impact_direction=int(item["impact_direction"]),
                    impact_magnitude=float(item["impact_magnitude"]),
                    transcript_excerpt=item.get("transcript_excerpt") or ev.title,
                    tone_notes="",
                    visual_notes="",
                    reasoning=item["reasoning"],
                )
            )
        except (KeyError, ValueError, TypeError):
            continue
    return overlays
