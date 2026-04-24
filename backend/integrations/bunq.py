"""Bunq integration — the money-move half of /invest.

Keeps a single BunqClient alive across requests (auth context is cached on disk
as bunq_context.json). Top-level operations:

    get_balance()               -> {main, pot}
    fund_main_from_sugardaddy(amount_eur)  -> request test money
    transfer_to_pot(amount_eur, description) -> internal transfer Main → Pot

Sandbox-only. No real money ever touched.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache

from backend.integrations.bunq_client import BunqClient

log = logging.getLogger("prospectus.bunq")

SUGARDADDY = "sugardaddy@bunq.com"


@lru_cache(maxsize=1)
def _client() -> BunqClient:
    api_key = os.environ["BUNQ_API_KEY"]
    c = BunqClient(api_key=api_key, sandbox=True)
    c.authenticate()
    return c


def _ids() -> tuple[int, int, int]:
    user_id = int(os.environ["BUNQ_USER_ID"])
    main_id = int(os.environ["BUNQ_MAIN_ACCOUNT_ID"])
    pot_id = int(os.environ["BUNQ_POT_ACCOUNT_ID"])
    return user_id, main_id, pot_id


def get_balance() -> dict[str, float]:
    """Returns main + pot EUR balances."""
    c = _client()
    user_id, main_id, pot_id = _ids()
    out = {}
    for label, aid in (("main", main_id), ("pot", pot_id)):
        resp = c.get(f"user/{user_id}/monetary-account/{aid}")
        ma = resp[0]["MonetaryAccountBank"]
        out[label] = float(ma["balance"]["value"])
    return out


def fund_main_from_sugardaddy(amount_eur: float, description: str = "prospectus top-up") -> str:
    """Sandbox-only. Request money from sugardaddy@bunq.com to the Main account."""
    c = _client()
    user_id, main_id, _ = _ids()
    resp = c.post(
        f"user/{user_id}/monetary-account/{main_id}/request-inquiry",
        body={
            "amount_inquired": {"value": f"{amount_eur:.2f}", "currency": "EUR"},
            "counterparty_alias": {"type": "EMAIL", "value": SUGARDADDY},
            "description": description,
            "allow_bunqme": False,
        },
    )
    for item in resp:
        if "Id" in item:
            return str(item["Id"]["id"])
    return "?"


def transfer_main_to_pot(amount_eur: float, description: str) -> str:
    """Internal transfer from Main → Investment Pot. Returns the payment id."""
    c = _client()
    user_id, main_id, pot_id = _ids()
    resp = c.post(
        f"user/{user_id}/monetary-account/{main_id}/payment",
        body={
            "amount": {"value": f"{amount_eur:.2f}", "currency": "EUR"},
            "counterparty_alias": {
                "type": "IBAN",
                "value": _iban_for(pot_id),
                "name": "Prospectus Investments",
            },
            "description": description,
        },
    )
    for item in resp:
        if "Id" in item:
            return str(item["Id"]["id"])
    return "?"


@lru_cache(maxsize=8)
def _iban_for(account_id: int) -> str:
    """Resolve an IBAN for an internal monetary account id."""
    c = _client()
    user_id, _, _ = _ids()
    resp = c.get(f"user/{user_id}/monetary-account/{account_id}")
    ma = resp[0]["MonetaryAccountBank"]
    for alias in ma.get("alias") or []:
        if alias.get("type") == "IBAN":
            return alias["value"]
    raise RuntimeError(f"no IBAN alias for account {account_id}")
