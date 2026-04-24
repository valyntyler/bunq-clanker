"""Generate backend/fixtures/bunq_user_payments.json.

A 12-month realistic-looking payment history for the demo user. Tuned so that:
- ~11 Heineken venue visits in Amsterdam, total ~€342, accelerating recent trend.
- Mix of grocery (AH), tech (AAPL/AMZN), QSR (MCD), etc. so per-ticker
  filtering produces non-empty matches for at least 6 of the demo tickers.
- Payments span 2025-04 to 2026-04 with realistic timestamps.

Each payment: {date, amount_eur, merchant, geo_city, type}.
The bunq_spending analyzer reads this and filters by ticker's merchant_aliases.
"""

from __future__ import annotations

import hashlib
import json
import random
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "backend" / "fixtures" / "bunq_user_payments.json"

START = date(2025, 4, 25)
END = date(2026, 4, 24)


def _seed_rand(s: str) -> random.Random:
    h = int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)
    return random.Random(h)


def _spread_dates(rng: random.Random, count: int, weight_recent: float = 1.5) -> list[date]:
    """Pick `count` dates between START and END. weight_recent > 1 biases toward recent."""
    days = (END - START).days
    out: list[date] = []
    for _ in range(count):
        # bias = weight_recent: x ** (1/weight_recent) where x in [0,1)
        # weight=1.5 → square-rootish bias toward 1.0 (recent)
        u = rng.random()
        biased = u ** (1.0 / max(weight_recent, 0.1))
        out.append(START + timedelta(days=int(biased * days)))
    return sorted(out)


def heineken_visits() -> list[dict]:
    rng = _seed_rand("heineken-visits")
    venues = [
        ("Heineken Experience",  "Amsterdam"),
        ("Cafe Heineken Hoek",   "Amsterdam"),
        ("Heineken Bar 't IJ",   "Amsterdam"),
        ("Heineken Pilsner Bar", "Amsterdam"),
        ("Amstel Tap House",     "Amsterdam"),
        ("Brand Bier Cafe",      "Eindhoven"),
        ("Desperados Lounge",    "Amsterdam"),
    ]
    # 11 visits, €15-€50 each, total ~€342 — pin the total by tail-adjustment
    raw = []
    n = 11
    dates = _spread_dates(rng, n, weight_recent=2.0)
    for d in dates:
        venue, city = rng.choice(venues)
        amt = round(rng.uniform(15, 48), 2)
        raw.append({
            "date": d.isoformat(),
            "amount_eur": amt,
            "merchant": venue,
            "geo_city": city,
            "type": "card",
        })
    # tune to land near €342
    target = 342.50
    cur = sum(p["amount_eur"] for p in raw)
    delta = target - cur
    raw[-1]["amount_eur"] = round(raw[-1]["amount_eur"] + delta, 2)
    # last visit pinned to 2026-04-18 for the demo
    raw[-1]["date"] = "2026-04-18"
    return raw


def other_payments() -> list[dict]:
    """Mix of payments so per-ticker filtering produces interesting non-zero matches
    on tickers other than HEIA — this lets the demo work even if a teammate
    types AAPL or AH.AS.
    """
    rng = _seed_rand("other-payments")
    pool = [
        # (merchant, amount_range, count, geo)
        ("Albert Heijn",        (8, 65),  42, "Amsterdam"),
        ("AH to go",            (3, 14),  18, "Amsterdam"),
        ("Apple Store",         (4, 25),   6, "Amsterdam"),
        ("Apple.com",           (1, 12),   8, None),
        ("App Store",           (1, 9),   12, None),
        ("Amazon.nl",           (12, 90), 15, None),
        ("Amazon Prime",        (4.99, 4.99), 12, None),
        ("Netflix",             (12.99, 12.99), 12, None),
        ("Spotify",             (10.99, 10.99), 12, None),
        ("McDonald's",          (5, 18),  11, "Amsterdam"),
        ("Starbucks",           (3, 8),    9, "Amsterdam"),
        ("Just Eat",            (12, 35), 14, "Amsterdam"),
        ("Thuisbezorgd",        (10, 28), 16, "Amsterdam"),
        ("Shell",               (35, 95), 10, "Amsterdam"),
        ("ING",                 (1.50, 4.20), 12, "Amsterdam"),  # bank fees
        ("Nike Store",          (45, 180), 3, "Amsterdam"),
        ("Hema",                (4, 32),  19, "Amsterdam"),
        ("NS Travel",           (3, 28),  24, "Amsterdam"),
        ("Etos",                (3, 22),   7, "Amsterdam"),
    ]
    out: list[dict] = []
    for merchant, (lo, hi), count, geo in pool:
        ds = _spread_dates(rng, count, weight_recent=1.0)
        for d in ds:
            amt = round(rng.uniform(lo, hi), 2) if lo != hi else lo
            out.append({
                "date": d.isoformat(),
                "amount_eur": amt,
                "merchant": merchant,
                "geo_city": geo or "Online",
                "type": "card" if geo else "online",
            })
    return out


def main() -> None:
    payments = heineken_visits() + other_payments()
    payments.sort(key=lambda p: p["date"])
    OUT.write_text(json.dumps(payments, indent=2))

    # quick demo-pin verification
    heia = [p for p in payments if any(
        a.lower() in p["merchant"].lower()
        for a in ["heineken", "amstel", "brand bier", "desperados"]
    )]
    total_h = sum(p["amount_eur"] for p in heia)
    print(f"wrote {OUT.name} — {len(payments)} payments")
    print(f"Heineken-matching: {len(heia)} visits, total €{total_h:.2f}, last {heia[-1]['date']}")


if __name__ == "__main__":
    main()
