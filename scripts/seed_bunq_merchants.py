"""Seed the Bunq sandbox with realistic merchant-shaped outflows so the
consumer-panel analyzer's live aggregation has real data to roll up.

The sandbox doesn't let us pay arbitrary external merchants — paths that
reliably work are internal transfers (Main → a pot we own). We exploit
that: send small EUR amounts from Main to a freshly-created "Sauron · Panel
Seed" pot, with the merchant name in BOTH the description AND the
counterparty `name` (which Bunq surfaces as the recipient label). Our
aggregator matches on both fields, so this lights up the live signal end
to end.

Run from project root:
    ./.venv/bin/python scripts/seed_bunq_merchants.py
    ./.venv/bin/python scripts/seed_bunq_merchants.py --count 3   # smaller batch

Idempotent-ish: re-running adds more payments (the pot is reused if it
already exists). Spend is small per-payment (€4–110).
"""

from __future__ import annotations

import os
import random
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

import json

from backend.integrations import bunq as bunq_i  # noqa: E402

# Spread the seed across these tickers' merchants. Each merchant gets a few
# outflows over the trailing ~24 months. Amounts are realistic per-category.
SEED_PLAN: dict[str, dict] = {
    "AAPL": {
        "merchants": ["Apple Store", "App Store", "iCloud", "Apple Music", "Apple TV+"],
        "min": 4, "max": 25,
        "count": 14,
    },
    "AMZN": {
        "merchants": ["Amazon.nl", "Amazon Prime", "Audible", "Whole Foods"],
        "min": 8, "max": 110,
        "count": 18,
    },
    "NFLX": {
        "merchants": ["Netflix"],
        "min": 12, "max": 18,
        "count": 12,
    },
    "SBUX": {
        "merchants": ["Starbucks"],
        "min": 4, "max": 11,
        "count": 16,
    },
    "MCD": {
        "merchants": ["McDonald's"],
        "min": 6, "max": 14,
        "count": 10,
    },
    "HEIA.AS": {
        "merchants": ["Heineken Experience", "Amstel", "Heineken"],
        "min": 8, "max": 30,
        "count": 9,
    },
    "AD.AS": {
        "merchants": ["Albert Heijn", "AH to go", "Etos", "Gall & Gall"],
        "min": 12, "max": 95,
        "count": 22,
    },
    "TKWY.AS": {
        "merchants": ["Thuisbezorgd", "Just Eat"],
        "min": 14, "max": 38,
        "count": 11,
    },
    "GOOGL": {
        "merchants": ["Google Play", "YouTube Premium", "Google One"],
        "min": 5, "max": 18,
        "count": 9,
    },
    "MSFT": {
        "merchants": ["Microsoft 365", "Xbox Live", "GitHub"],
        "min": 7, "max": 22,
        "count": 8,
    },
}

SEED_POT_NAME = "Sauron · Panel Seed"


def _ensure_seed_pot(client, user_id: int) -> int:
    """Find or create the dedicated seed pot. We dump merchant-shaped payments
    into it so they don't pollute the user's real Main/Pot history. Returns
    the pot account id."""
    resp = client.get(f"user/{user_id}/monetary-account")
    for item in resp:
        ma = item.get("MonetaryAccountBank") or item.get("MonetaryAccountSavings") or {}
        if ma.get("description") == SEED_POT_NAME and ma.get("status") == "ACTIVE":
            return int(ma["id"])
    print(f"creating dedicated seed pot {SEED_POT_NAME!r}…")
    resp = client.post(
        f"user/{user_id}/monetary-account-bank",
        body={"currency": "EUR", "description": SEED_POT_NAME},
    )
    for item in resp:
        if "Id" in item:
            return int(item["Id"]["id"])
    raise RuntimeError("could not create seed pot")


def main() -> None:
    count_scale = 1.0
    if "--count" in sys.argv:
        try:
            count_scale = float(sys.argv[sys.argv.index("--count") + 1]) / 10.0
        except (ValueError, IndexError):
            count_scale = 1.0

    user_id, main_id, _pot_id = bunq_i._ids()  # noqa: SLF001
    client = bunq_i._client()  # noqa: SLF001

    seed_pot_id = _ensure_seed_pot(client, user_id)
    seed_iban = bunq_i._iban_for(seed_pot_id)  # noqa: SLF001

    # Sugardaddy has a per-request cap (~€500). Top up in repeated chunks
    # until Main has enough to cover the planned spend.
    target_total = sum(p["count"] * (p["min"] + p["max"]) / 2 for p in SEED_PLAN.values())
    target_total = int(target_total * count_scale * 1.3)
    print(f"target Main top-up: €{target_total} (chunked at €500)")
    chunk = 500
    topped = 0
    while topped < target_total:
        amount = min(chunk, target_total - topped)
        try:
            bunq_i.fund_main_from_sugardaddy(float(amount), description="merchant-seed top-up")
            topped += amount
            print(f"  topped up €{amount} (total €{topped})")
        except Exception as e:  # noqa: BLE001
            print(f"  top-up €{amount} failed: {e}")
            break

    rng = random.Random(42)
    sent = 0
    skipped = 0
    for ticker, plan in SEED_PLAN.items():
        n = max(1, int(round(plan["count"] * count_scale)))
        for _ in range(n):
            merchant = rng.choice(plan["merchants"])
            amount = round(rng.uniform(plan["min"], plan["max"]), 2)
            try:
                resp = client.post(
                    f"user/{user_id}/monetary-account/{main_id}/payment",
                    body={
                        "amount": {"value": f"{amount:.2f}", "currency": "EUR"},
                        "counterparty_alias": {
                            "type": "IBAN",
                            "value": seed_iban,
                            "name": merchant,
                        },
                        "description": merchant,
                    },
                )
                pid = "?"
                for item in resp:
                    if "Id" in item:
                        pid = item["Id"]["id"]
                        break
                print(f"  {ticker:8} {merchant:28} €{amount:>7.2f}  payment_id={pid}")
                sent += 1
            except Exception as e:  # noqa: BLE001
                print(f"  {ticker:8} {merchant:28} FAILED: {e}")
                skipped += 1

    print(f"\ndone · sent={sent} skipped={skipped} · {datetime.utcnow().isoformat()}")
    print("re-run the analyzer; live aggregation should now have matches.")


if __name__ == "__main__":
    main()
