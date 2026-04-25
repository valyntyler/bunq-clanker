"""Vision-based object → company → ticker detection.

Used by the Scan feature: user opens phone camera, snaps a photo (or short
video clip's keyframe), and we identify the products / brands / logos in
the frame, map them to publicly listed parent companies + tickers, then
attach a quick verdict so the user can decide whether to run a full analysis.

Each detection is also enriched with a wallet-relationship signal pulled
from BOTH the user's live Bunq sandbox payments AND the seeded personal
spending fixture — so the user can see "you've spent €X at this brand
across N visits" alongside the macro investment take.

Output schema is shaped so the frontend can render each detection as a
clickable card that links to /analyze/{ticker}.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from backend.llm import call_claude_json

_FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
log = logging.getLogger("prospectus.object_scan")


def _load_alias_index() -> dict[str, str]:
    """Reverse-index of merchant_aliases.json: alias-lower → ticker. Used to
    sanity-check ambiguous Claude outputs and auto-fill tickers when Claude
    only returned a brand name."""
    path = _FIXTURES / "merchant_aliases.json"
    if not path.exists():
        return {}
    raw = json.loads(path.read_text())
    out: dict[str, str] = {}
    for ticker, aliases in raw.items():
        for a in aliases:
            out[a.lower()] = ticker
    return out


_SYSTEM = (
    "You are a sober equity analyst. The user just took a photo with their "
    "phone. Your job is to identify visible BRANDED products, services, "
    "logos, store fronts, vehicles, or labels — and for each one, ALWAYS "
    "trace the brand UP to the ultimate publicly traded parent company and "
    "return THAT company's ticker, even when the visible brand is a "
    "subsidiary, sub-brand, app, or product line.\n\n"
    "Examples of the brand → publicly traded parent resolution you MUST "
    "perform (this is non-exhaustive — apply the same logic to anything you "
    "see):\n"
    "  • Dove / Knorr / Magnum / Ben & Jerry's / Hellmann's / Axe → Unilever (UNA.AS)\n"
    "  • Sephora / Louis Vuitton / Dior / Tiffany / Bulgari / Tag Heuer → LVMH (MC.PA)\n"
    "  • Instagram / WhatsApp / Facebook / Quest / Reality Labs → Meta (META)\n"
    "  • iCloud / Apple Music / Apple TV+ / App Store / Beats → Apple (AAPL)\n"
    "  • GitHub / Xbox / LinkedIn / Microsoft 365 / Activision → Microsoft (MSFT)\n"
    "  • YouTube / Google Play / Waymo / Pixel / Nest → Alphabet (GOOGL)\n"
    "  • Whole Foods / Audible / Twitch / Ring / IMDb → Amazon (AMZN)\n"
    "  • Heineken Experience / Amstel / Desperados / Murphy's → Heineken (HEIA.AS)\n"
    "  • Coca-Cola / Fanta / Sprite / Innocent / Costa Coffee → Coca-Cola Co. (KO)\n"
    "  • Tesla / Tesla Supercharger / Tesla Energy / Powerwall → Tesla (TSLA)\n"
    "  • OLX / iFood (Brazil) → Prosus (PRX.AS)\n\n"
    "Rules:\n"
    "  1. NEVER mark a brand as 'private' if its parent IS publicly traded — "
    "trace up to the parent and use that parent's ticker.\n"
    "  2. If the brand is genuinely independent and private (e.g. IKEA, "
    "Bosch private divisions, family-owned producers), set ticker to '' and "
    "company to the private name. Only THEN is 'private' acceptable.\n"
    "  3. Be conservative on identification — if you can't identify the "
    "brand visually with high confidence, drop it from the list.\n"
    "  4. Order detections by prominence (biggest / most central first).\n"
    "  5. parent_relationship MUST explain the linkage when brand ≠ company "
    "(e.g. 'Dove is a personal-care brand owned by Unilever'). When brand "
    "and company are the same entity (e.g. Apple Store → Apple), set "
    "parent_relationship to ''."
)

_USER_TEMPLATE = """Analyze this image and return STRICT JSON of the form:

{
  "detections": [
    {
      "object":             "what you see (e.g. 'Dove soap bar', 'Tesla Model 3', 'GitHub octocat sticker')",
      "brand":              "the brand name visible in the image",
      "company":            "the publicly traded PARENT company name (e.g. 'Unilever', 'Microsoft Corporation') — NOT the brand if they differ",
      "ticker":             "the parent's primary ticker — e.g. UNA.AS, MSFT, AAPL. Empty string ONLY if parent is genuinely private",
      "exchange":           "NASDAQ | NYSE | LSE | Euronext Amsterdam | etc.",
      "parent_relationship":"explain the brand→parent linkage when they differ — e.g. 'Dove is a personal-care brand owned by Unilever'. Empty when brand and company are the same.",
      "confidence":         0..1,
      "rationale":          "one sentence: how you identified the item visually",
      "investment_take":    "one short line: macro-level lens on the PARENT company. Be calibrated, not bullish.",
      "box":                { "x": 0..1, "y": 0..1, "w": 0..1, "h": 0..1 }
    },
    ...
  ],
  "scene_summary": "one sentence describing the overall scene"
}

The "box" field MUST be the bounding box of the detected item as fractions
of the image's WIDTH and HEIGHT (so x=0,y=0 is top-left, x=1,y=1 is
bottom-right). Tighten the box to the visible logo / product, not the
whole frame. Set the box even when the item fills most of the frame —
that's still a valid box at roughly { "x":0.05, "y":0.05, "w":0.9, "h":0.9 }.

If the image has no recognizable branded items, return an empty detections array.
Never invent tickers. If unsure of the parent's ticker, leave the ticker field as "".
"""


def scan_image(image_bytes: bytes) -> dict[str, Any]:
    """Run Claude vision on a single image and return structured detections.
    Augments Claude's output with a fallback ticker pulled from our merchant
    alias index when Claude returned a brand but no ticker. Each detection
    is enriched with the user's wallet relationship to that brand."""
    raw = call_claude_json(
        _USER_TEMPLATE,
        system=_SYSTEM,
        images=[image_bytes],
        max_tokens=1500,
    )
    detections: list[dict] = list(raw.get("detections") or [])
    alias_idx = _load_alias_index()

    cleaned: list[dict] = []
    seen_tickers: set[str] = set()
    for d in detections:
        ticker = (d.get("ticker") or "").strip().upper()
        brand = (d.get("brand") or "").strip()
        company = (d.get("company") or "").strip()
        parent_rel = (d.get("parent_relationship") or "").strip()

        # Always cross-check with our alias map — even when Claude returned
        # a ticker, it's worth verifying the brand maps to a known parent.
        # The alias map is hand-curated for the demo set and will catch
        # cases where Claude either skipped the parent-resolution step or
        # returned a less-canonical ticker (e.g. an ADR vs the primary).
        alias_ticker = _resolve_ticker_from_brand(brand, alias_idx)
        if alias_ticker and alias_ticker != ticker:
            if not ticker:
                ticker = alias_ticker
                if not parent_rel and brand and company:
                    parent_rel = f"{brand} is a brand owned by {company}."
            # Else: trust Claude's ticker — alias lookup is fuzzy and could
            # over-match (e.g. "Apple" the company vs "Apple" in another brand).

        # Drop dupes (same parent ticker hit twice — keeps the parent take
        # while still showing each child brand in the rationale)
        if ticker and ticker in seen_tickers:
            continue
        if ticker:
            seen_tickers.add(ticker)

        # Heuristic: if brand differs from company in name AND we don't yet
        # have a relationship line, synthesise a minimal one. Better than a
        # blank field on the UI.
        if ticker and brand and company and not parent_rel:
            if brand.lower() != company.lower() and brand.lower() not in company.lower():
                parent_rel = f"{brand} is a brand of {company}."

        wallet = wallet_signal_for(ticker) if ticker else None

        box = _normalize_box(d.get("box"))

        cleaned.append({
            "object": (d.get("object") or "").strip()[:120],
            "brand": brand[:80],
            "company": company[:120],
            "ticker": ticker,
            "exchange": (d.get("exchange") or "").strip()[:32],
            "parent_relationship": parent_rel[:280],
            "is_subbrand": bool(parent_rel),
            "confidence": _clamp01(d.get("confidence")),
            "rationale": (d.get("rationale") or "").strip()[:280],
            "investment_take": (d.get("investment_take") or "").strip()[:280],
            "is_listed": bool(ticker),
            "wallet": wallet,
            "box": box,
        })

    return {
        "detections": cleaned,
        "scene_summary": (raw.get("scene_summary") or "").strip()[:280],
    }


# ---------------------------------------------------------------------------
# Wallet-relationship signal: per-ticker view of "have you ever bought from
# this brand?" — pulled from BOTH the live Bunq sandbox AND the seeded
# user-payments fixture, then merged.
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _aliases_for_ticker_map() -> dict[str, list[str]]:
    path = _FIXTURES / "merchant_aliases.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text())


@lru_cache(maxsize=1)
def _personal_payments() -> list[dict]:
    """Seeded personal-spending fixture (one user, hand-authored)."""
    path = _FIXTURES / "bunq_user_payments.json"
    if not path.exists():
        return []
    return json.loads(path.read_text())


def _matches(merchant: str, aliases: list[str]) -> bool:
    m = (merchant or "").lower()
    return any(a.lower() in m for a in aliases if a)


def wallet_signal_for(ticker: str) -> dict[str, Any] | None:
    """Build a wallet-relationship signal for a single ticker.

    Returns:
        None when there's no merchant-alias map for this ticker (we can't
        even ask the question). Otherwise returns a dict — relationship
        will be 'none' if there are no matches in either data source.

    Sources merged:
        1. Live Bunq sandbox payments via aggregate_panel (real API).
        2. Seeded personal-spending fixture (offline data, demo-friendly).
    """
    aliases = _aliases_for_ticker_map().get(ticker.upper())
    if not aliases:
        return None

    # Source 1: live Bunq sandbox
    live_total = 0.0
    live_count = 0
    live_last: str | None = None
    live_samples: list[dict] = []
    try:
        from backend.integrations import bunq as bunq_i
        agg = bunq_i.aggregate_panel(aliases, months=24, per_account=200)
        live_total = round(sum(agg["months"].values()), 2)
        live_count = int(agg["matched_count"])
        live_samples = agg.get("matched_sample") or []
        if live_samples:
            live_last = max(s["date"] for s in live_samples if s.get("date"))
    except Exception as e:  # noqa: BLE001
        log.warning("wallet_signal_for: live aggregate failed for %s: %s", ticker, e)

    # Source 2: personal-spending fixture
    fixture_total = 0.0
    fixture_count = 0
    fixture_last: str | None = None
    fixture_monthly: Counter[str] = Counter()
    fixture_cities: Counter[str] = Counter()
    matched = [p for p in _personal_payments() if _matches(p.get("merchant", ""), aliases)]
    for p in matched:
        amt = float(p.get("amount_eur") or 0.0)
        fixture_total += amt
        fixture_count += 1
        date = p.get("date") or ""
        if date and (fixture_last is None or date > fixture_last):
            fixture_last = date
        if date:
            fixture_monthly[date[:7]] += 1
        fixture_cities[p.get("geo_city") or "Online"] += 1
    fixture_total = round(fixture_total, 2)

    # Merged view
    total = round(live_total + fixture_total, 2)
    count = live_count + fixture_count
    last_visit = max(filter(None, [live_last, fixture_last]), default=None)
    sources: list[str] = []
    if live_count > 0:
        sources.append("live")
    if fixture_count > 0:
        sources.append("fixture")
    source_label = "+".join(sources) if sources else "none"

    # Trend from fixture monthly counts (live is current-month only in sandbox).
    months_sorted = sorted(fixture_monthly.keys())
    monthly_counts = [fixture_monthly[m] for m in months_sorted]
    trend = _trend_label(monthly_counts)

    # Brand relationship label — drives the inline pill on the scan card.
    if count == 0:
        relationship = "none"
        relationship_label = "no purchase history"
    elif count >= 8 and total >= 200:
        relationship = "loyal"
        relationship_label = "loyal customer"
    elif count >= 4 or total >= 100:
        relationship = "regular"
        relationship_label = "repeat buyer"
    else:
        relationship = "occasional"
        relationship_label = "occasional purchase"

    days_since: int | None = None
    if last_visit:
        try:
            days_since = (datetime.now(timezone.utc).date() - datetime.fromisoformat(last_visit).date()).days
        except Exception:  # noqa: BLE001
            days_since = None

    top_city = None
    if fixture_cities:
        top_city, _ = fixture_cities.most_common(1)[0]

    return {
        "matched": count > 0,
        "total_spent_eur": total,
        "visit_count": count,
        "last_visit": last_visit,
        "days_since_last": days_since,
        "trend": trend,
        "monthly_counts": monthly_counts,
        "relationship": relationship,
        "relationship_label": relationship_label,
        "merchant_aliases": aliases,
        "source": source_label,
        "live_total_eur": round(live_total, 2),
        "live_count": live_count,
        "fixture_total_eur": fixture_total,
        "fixture_count": fixture_count,
        "top_city": top_city if top_city != "Online" else None,
    }


def _trend_label(monthly_counts: list[int]) -> str:
    if len(monthly_counts) < 6:
        return "flat"
    early = sum(monthly_counts[:3]) / 3
    late = sum(monthly_counts[-3:]) / 3
    if late > early * 1.30:
        return "accelerating"
    if late < early * 0.70:
        return "declining"
    return "flat"


def _resolve_ticker_from_brand(brand: str, alias_idx: dict[str, str]) -> str:
    """Reverse-lookup a brand name → parent ticker. Prefers exact alias hits,
    falls back to a substring sweep ordered longest-alias-first so we don't
    over-match short tokens (e.g. 'Hue' matching anything containing 'hue')."""
    if not brand:
        return ""
    b = brand.lower().strip()
    if not b:
        return ""
    if b in alias_idx:
        return alias_idx[b]
    # Order keys by length desc so 'apple music' beats 'apple' on partials.
    for alias in sorted(alias_idx.keys(), key=len, reverse=True):
        if len(alias) < 4:
            continue
        if alias in b or b in alias:
            return alias_idx[alias]
    return ""


def _clamp01(v: Any) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, f))


def _normalize_box(b: Any) -> dict | None:
    """Coerce Claude's box output into {x, y, w, h} as 0..1 fractions, or
    None when malformed / missing. Clamps coords + ensures the box stays
    inside the image. Some Claude responses occasionally return pixel
    coords (>1) — we treat those as 'no usable box' since we can't know
    the source resolution."""
    if not isinstance(b, dict):
        return None
    try:
        x = float(b.get("x", 0))
        y = float(b.get("y", 0))
        w = float(b.get("w", 0))
        h = float(b.get("h", 0))
    except (TypeError, ValueError):
        return None
    # Reject obviously bad data (zero-size or pixel-scale).
    if w <= 0 or h <= 0:
        return None
    if x > 1.5 or y > 1.5 or w > 1.5 or h > 1.5:
        return None
    x = max(0.0, min(1.0, x))
    y = max(0.0, min(1.0, y))
    # Clamp w/h so the box doesn't run off the edge.
    w = max(0.0, min(1.0 - x, w))
    h = max(0.0, min(1.0 - y, h))
    if w < 0.02 or h < 0.02:
        # Sub-2% boxes are usually OCR-on-tiny-text noise — drop.
        return None
    return {"x": round(x, 4), "y": round(y, 4), "w": round(w, 4), "h": round(h, 4)}
