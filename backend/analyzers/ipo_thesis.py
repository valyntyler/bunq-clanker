"""Claude-generated investment thesis for an IPO listing.

Reads the curated brief from ipo_calendar.json (sector / valuation / status
/ highlights / risks) and asks Claude to produce a calibrated retail-friendly
thesis: bull case, bear case, fair-value range, and a watch list of
catalysts. Cached per slug — the brief is static, the thesis can be too.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from backend.llm import call_claude_json

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "ipo_calendar.json"

SYSTEM = (
    "You are a sober retail-focused analyst evaluating a pre-IPO company. "
    "Stay calibrated — don't hype. Acknowledge that the listing has not "
    "happened yet, valuations are private-market estimates, and that early "
    "trading is highly volatile. No financial advice. "
    "Output the JSON contract requested, nothing else."
)


@lru_cache(maxsize=1)
def _calendar() -> dict:
    return json.loads(FIXTURE.read_text())


def list_ipos() -> dict:
    return _calendar()


def get_brief(slug: str) -> dict | None:
    cal = _calendar()
    for ipo in cal.get("ipos", []):
        if ipo.get("slug") == slug:
            return ipo
    return None


@lru_cache(maxsize=64)
def thesis_for(slug: str) -> dict:
    """Returns Claude's investment thesis for a single IPO. Cached after the
    first call — briefs are static."""
    brief = get_brief(slug)
    if brief is None:
        return {"error": f"unknown IPO {slug}"}

    user = f"""IPO brief:
Company:           {brief['company_name']}
Sector:            {brief['sector']}
HQ:                {brief.get('hq', 'unknown')}
Status:            {brief['status']}
Expected window:   {brief['expected_window']}
Expected listing:  {brief.get('expected_listing', 'TBD')}
Expected ticker:   {brief.get('expected_ticker', 'TBD')}
Last private valuation: ${brief.get('last_private_valuation_usd_b', '?')}B
({brief.get('last_round_date', 'unknown')})
Summary:           {brief['summary']}

Highlights provided by the brief:
{chr(10).join(f'  - {h}' for h in brief.get('highlights', []))}

Risks flagged in the brief:
{chr(10).join(f'  - {r}' for r in brief.get('risks', []))}

Return STRICT JSON with these keys:
  bull_case:    string (2-3 sentences — what has to be true to win)
  bear_case:    string (2-3 sentences — the most plausible failure mode)
  fair_value_usd_b: {{"low": number, "high": number}} — your range estimate at IPO,
                in $B; note the last_private_valuation as the anchor
  catalysts:    string[] (3-5 items — events to watch in the next 6-12 months)
  retail_take:  string (1 sentence — what a retail investor should actually do
                differently for a pre-IPO listing vs. a seasoned stock)
  confidence:   number 0..1 (be honest — pre-IPO is data-poor)
"""
    return call_claude_json(user, system=SYSTEM, max_tokens=900)
