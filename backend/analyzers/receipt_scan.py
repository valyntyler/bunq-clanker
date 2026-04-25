"""Receipt scan analyzer.

Claude vision parses a photo of a receipt into structured line items and a
total, then attaches a publicly-traded-parent ticker to every item where we
can resolve one. The frontend uses this two ways:

  1. Spend analysis — show what you bought, which listed companies own
     those brands, and the per-ticker EUR breakdown.
  2. Bill splitting (only when the receipt is recent) — the parsed items
     feed an interactive per-item checkbox grid where the user assigns each
     line to one or more participants; we compute each share and fire Bunq
     payment requests.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from backend.llm import call_claude_json

_FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
log = logging.getLogger("prospectus.receipt_scan")


@lru_cache(maxsize=1)
def _alias_index() -> dict[str, str]:
    """Reverse lookup: alias-lower → ticker. Same map used by scan/dashboard."""
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
    "You are an OCR + categorisation assistant reading a photograph of a "
    "retail receipt. Extract: merchant, date, currency, every line item "
    "(name + price + qty), subtotal, tax, and grand total. For each item, "
    "ALSO identify the visible brand AND the publicly traded PARENT "
    "company that owns it — same brand→parent resolution rules as the "
    "Sauron object scanner.\n\n"
    "Examples of the brand → publicly traded parent resolution you MUST "
    "apply:\n"
    "  • Dove / Knorr / Magnum / Ben & Jerry's / Hellmann's / Axe → Unilever (UNA.AS)\n"
    "  • Heineken / Amstel / Desperados / Murphy's → Heineken (HEIA.AS)\n"
    "  • Coca-Cola / Fanta / Sprite / Innocent → Coca-Cola Co. (KO)\n"
    "  • Apple Music / iCloud / App Store → Apple (AAPL)\n"
    "  • Whole Foods / Amazon Prime / Audible → Amazon (AMZN)\n"
    "  • Google Play / YouTube Premium → Alphabet (GOOGL)\n"
    "  • Microsoft 365 / Xbox / GitHub → Microsoft (MSFT)\n"
    "  • Sephora / Louis Vuitton / Dior → LVMH (MC.PA)\n\n"
    "Rules:\n"
    "  1. The merchant itself may also be publicly traded (Albert Heijn → "
    "AD.AS, Heineken Experience → HEIA.AS) — set merchant_ticker if so.\n"
    "  2. If you can't read a price clearly, leave it 0. If you can't read "
    "an item name, drop it from the list.\n"
    "  3. Ticker fields are exact strings ('UNA.AS', 'KO'). Empty string "
    "when the brand is genuinely private (e.g. store-brand items, local "
    "produce) — do not invent tickers.\n"
    "  4. Date in YYYY-MM-DD. If the receipt has no clear date, use \"\".\n"
    "  5. Currency from the symbol on the receipt (EUR / USD / GBP...). "
    "Default EUR if not visible.\n"
    "  6. Numbers in the JSON are bare numbers (no currency symbol)."
)


_USER = """Parse this receipt. Return STRICT JSON only:

{
  "merchant":          "store name as it appears",
  "merchant_ticker":   "ticker for the merchant if publicly traded, else \"\"",
  "merchant_company":  "publicly traded parent of the merchant (or \"\")",
  "date":              "YYYY-MM-DD or \"\"",
  "currency":          "EUR | USD | GBP | ...",
  "country":           "two-letter country code if visible, else \"\"",
  "items": [
    {
      "name":          "product name (clean — no SKU codes)",
      "qty":           number,
      "unit_price":    number,
      "total_price":   number,
      "category":      "groceries | food&drink | electronics | apparel | beauty | media | transport | services | other",
      "brand":         "visible brand or \"\" if generic / store brand",
      "company":       "publicly traded parent company name (or \"\")",
      "ticker":        "parent ticker (or \"\")",
      "exchange":      "NASDAQ | NYSE | Euronext Amsterdam | LSE | ... or \"\"",
      "is_listed":     boolean
    }
  ],
  "subtotal":          number,
  "tax":               number,
  "total":             number,
  "confidence":        0..1,
  "notes":             "anything ambiguous worth flagging"
}

If the image isn't a receipt at all, return total=0 and items=[]."""


def scan_receipt(image_bytes: bytes) -> dict[str, Any]:
    raw = call_claude_json(
        _USER,
        system=_SYSTEM,
        images=[image_bytes],
        max_tokens=2000,
    )
    items = list(raw.get("items") or [])
    alias_idx = _alias_index()

    cleaned: list[dict] = []
    for it in items:
        ticker = (it.get("ticker") or "").strip().upper()
        brand = (it.get("brand") or "").strip()
        company = (it.get("company") or "").strip()
        # Reverse-lookup: if Claude returned a brand but no ticker, resolve
        # via the curated alias map. Same trick as scan_image.
        if not ticker and brand:
            ticker = _resolve(brand, alias_idx)
        cleaned.append({
            "name": (it.get("name") or "").strip()[:120],
            "qty": _safe_num(it.get("qty"), default=1.0),
            "unit_price": _safe_num(it.get("unit_price")),
            "total_price": _safe_num(it.get("total_price")),
            "category": (it.get("category") or "other").strip()[:40],
            "brand": brand[:60],
            "company": company[:80],
            "ticker": ticker,
            "exchange": (it.get("exchange") or "").strip()[:32],
            "is_listed": bool(ticker),
        })

    merchant = (raw.get("merchant") or "").strip()
    merchant_ticker = (raw.get("merchant_ticker") or "").strip().upper()
    if not merchant_ticker and merchant:
        merchant_ticker = _resolve(merchant, alias_idx)

    receipt_date = (raw.get("date") or "").strip()
    is_recent = _is_recent(receipt_date)

    # Spend by ticker (€ aggregated). The frontend pie/bar uses this.
    by_ticker: dict[str, dict] = {}
    for it in cleaned:
        if not it["ticker"]:
            continue
        key = it["ticker"]
        b = by_ticker.setdefault(key, {
            "ticker": key,
            "company": it["company"],
            "spend": 0.0,
            "items": 0,
        })
        b["spend"] += float(it["total_price"])
        b["items"] += 1
    by_ticker_list = sorted(
        ({**v, "spend": round(v["spend"], 2)} for v in by_ticker.values()),
        key=lambda x: x["spend"],
        reverse=True,
    )

    listed_total = round(
        sum(it["total_price"] for it in cleaned if it["is_listed"]), 2
    )

    return {
        "merchant": merchant,
        "merchant_ticker": merchant_ticker,
        "merchant_company": (raw.get("merchant_company") or "").strip()[:80],
        "date": receipt_date,
        "currency": (raw.get("currency") or "EUR").strip()[:6],
        "country": (raw.get("country") or "").strip()[:6],
        "items": cleaned,
        "subtotal": _safe_num(raw.get("subtotal")),
        "tax": _safe_num(raw.get("tax")),
        "total": _safe_num(raw.get("total")),
        "confidence": _safe_num(raw.get("confidence")),
        "notes": (raw.get("notes") or "").strip()[:280],
        "by_ticker": by_ticker_list,
        "listed_total": listed_total,
        "is_recent": is_recent,
    }


def _safe_num(v: Any, default: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if f != f or f in (float("inf"), float("-inf")):
        return default
    return round(f, 2)


def _is_recent(date_str: str, days: int = 7) -> bool:
    if not date_str:
        return False
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        return False
    today = datetime.now(timezone.utc).date()
    delta = (today - d).days
    return -1 <= delta <= days  # tolerate clock skew of 1 day forward


def _resolve(text: str, alias_idx: dict[str, str]) -> str:
    """Reverse-lookup brand/merchant → parent ticker."""
    if not text:
        return ""
    t = text.lower().strip()
    if t in alias_idx:
        return alias_idx[t]
    for alias in sorted(alias_idx.keys(), key=len, reverse=True):
        if len(alias) < 4:
            continue
        if alias in t or t in alias:
            return alias_idx[alias]
    return ""
