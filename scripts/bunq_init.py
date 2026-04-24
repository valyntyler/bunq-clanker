"""One-shot Bunq sandbox bootstrap.

1. If BUNQ_API_KEY isn't set, mint a fresh sandbox user — prints the key.
2. Run the 3-step auth (installation → device-server → session-server).
3. Save auth context to ./bunq_context.json so subsequent runs re-use it.
4. List monetary accounts, and create a "Prospectus Investments" pot if missing.

Run from project root:
    AWS_PROFILE=prospectus ./.venv/bin/python scripts/bunq_init.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Let us import backend.integrations.bunq_client from the project root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
from backend.integrations.bunq_client import BunqClient  # noqa: E402

load_dotenv()

INVESTMENT_POT_NAME = "Prospectus Investments"


def main() -> None:
    api_key = os.getenv("BUNQ_API_KEY", "").strip()
    if not api_key:
        print("No BUNQ_API_KEY in env — minting a fresh sandbox user…")
        api_key = BunqClient.create_sandbox_user()
        print(f"  API key: {api_key}")
        print("  → paste this into .env as BUNQ_API_KEY=... for future runs\n")

    client = BunqClient(api_key=api_key, sandbox=True)
    client.authenticate()
    print(f"authenticated as user_id={client.user_id}")

    # List accounts
    accounts = client.get(f"user/{client.user_id}/monetary-account-bank")
    print(f"\nfound {len(accounts)} monetary-account-bank:")
    pot_id = None
    for a in accounts:
        ma = a.get("MonetaryAccountBank") or {}
        name = ma.get("description")
        mid = ma.get("id")
        balance = (ma.get("balance") or {}).get("value", "?")
        currency = (ma.get("balance") or {}).get("currency", "?")
        status = ma.get("status")
        print(f"  [{mid}] {name!r} · {balance} {currency} · {status}")
        if name == INVESTMENT_POT_NAME and status == "ACTIVE":
            pot_id = mid

    if pot_id:
        print(f"\n'{INVESTMENT_POT_NAME}' pot already exists (id={pot_id}).")
    else:
        print(f"\nCreating '{INVESTMENT_POT_NAME}' pot…")
        resp = client.post(
            f"user/{client.user_id}/monetary-account-bank",
            body={
                "currency": "EUR",
                "description": INVESTMENT_POT_NAME,
            },
        )
        for item in resp:
            if "Id" in item:
                pot_id = item["Id"]["id"]
                break
        print(f"  created pot id={pot_id}")

    print("\nDone. bunq_context.json saved. Ready to wire /invest.")


if __name__ == "__main__":
    main()
