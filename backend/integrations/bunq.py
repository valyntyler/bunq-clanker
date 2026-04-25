"""Bunq integration — every money / identity touchpoint goes through here.

Keeps a single BunqClient alive across requests (auth context is cached on disk
as bunq_context.json). Top-level operations:

    get_balance()                            -> {main, pot}
    get_user_profile()                       -> {display_name, country, ...}
    list_monetary_accounts()                 -> [{id, description, balance, iban, ...}]
    list_payments(account_id?)               -> recent payments across pots
    fund_main_from_sugardaddy(amount_eur)    -> request test money
    transfer_main_to_pot(amount_eur, desc)   -> Main → default Investment Pot
    transfer_main_to_account(aid, amt, desc) -> Main → arbitrary internal pot
    ensure_ticker_pot(ticker)                -> int (creates "Sauron · TICKER" pot
                                                if missing, returns its id)

Sandbox-only. No real money ever touched.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache

from backend.integrations.bunq_client import BunqClient

log = logging.getLogger("prospectus.bunq")

SUGARDADDY = "sugardaddy@bunq.com"
POT_PREFIX = "Sauron · "  # ticker-pot naming convention
# Pots that share the POT_PREFIX but aren't real investment pots — skipped
# from balance aggregation and the dashboard's "ticker pots" filter.
NON_INVESTMENT_POT_NAMES = {"Sauron · Panel Seed"}


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
    """Returns Main + 'Investment Pot' EUR balances.

    The 'pot' figure is the SUM of every Sauron-managed pot — the legacy
    default Investment Pot plus every per-ticker pot created by /invest
    ('Sauron · TICKER'). That matches the user's mental model: when they
    invest €X, the Investment Pot tile in the InvestModal jumps by €X
    regardless of which per-ticker sub-account the money actually landed
    in. Without this aggregation the tile looks frozen even though the
    money clearly moved."""
    c = _client()
    user_id, main_id, pot_id = _ids()
    # Main is a single account
    main_resp = c.get(f"user/{user_id}/monetary-account/{main_id}")
    main_balance = float(main_resp[0]["MonetaryAccountBank"]["balance"]["value"])

    # Pot is sum across the default pot + every Sauron · TICKER pot.
    # Skip housekeeping pots that share the prefix but aren't investments
    # (e.g. the merchant-seed pot used to fuel the consumer-panel demo).
    pot_total = 0.0
    for a in list_monetary_accounts():
        if a.get("status") != "ACTIVE":
            continue
        desc = a.get("description") or ""
        if desc in NON_INVESTMENT_POT_NAMES:
            continue
        if a.get("is_default_pot") or a.get("is_ticker_pot"):
            pot_total += float(a.get("balance") or 0.0)
        elif int(a["id"]) == pot_id:
            pot_total += float(a.get("balance") or 0.0)
    return {"main": main_balance, "pot": round(pot_total, 2)}


def request_payment_from_email(
    email: str,
    amount_eur: float,
    description: str,
) -> str:
    """Send a Bunq payment request to an arbitrary EMAIL counterparty.
    Returns the Bunq request-inquiry id.

    Sandbox-only. Real-production behaviour: Bunq emails the recipient with
    a tap-to-pay link (Tikkie-style). In sandbox the request is recorded
    against the user account regardless of whether the email maps to a
    real sandbox user — perfect for the bill-split demo.
    """
    c = _client()
    user_id, main_id, _ = _ids()
    resp = c.post(
        f"user/{user_id}/monetary-account/{main_id}/request-inquiry",
        body={
            "amount_inquired": {"value": f"{amount_eur:.2f}", "currency": "EUR"},
            "counterparty_alias": {"type": "EMAIL", "value": email},
            "description": description,
            "allow_bunqme": True,
        },
    )
    for item in resp:
        if "Id" in item:
            return str(item["Id"]["id"])
    return "?"


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
    """Internal transfer from Main → default Investment Pot. Returns the payment id."""
    c = _client()
    user_id, main_id, pot_id = _ids()
    return _send_payment(c, user_id, main_id, pot_id, amount_eur, description, "Prospectus Investments")


def transfer_main_to_account(account_id: int, amount_eur: float, description: str, name: str = "Sauron Investments") -> str:
    """Internal transfer from Main → arbitrary internal account. Returns the payment id."""
    c = _client()
    user_id, main_id, _ = _ids()
    return _send_payment(c, user_id, main_id, account_id, amount_eur, description, name)


def _send_payment(c: BunqClient, user_id: int, src_id: int, dst_id: int, amount_eur: float, description: str, dst_name: str) -> str:
    resp = c.post(
        f"user/{user_id}/monetary-account/{src_id}/payment",
        body={
            "amount": {"value": f"{amount_eur:.2f}", "currency": "EUR"},
            "counterparty_alias": {
                "type": "IBAN",
                "value": _iban_for(dst_id),
                "name": dst_name,
            },
            "description": description,
        },
    )
    for item in resp:
        if "Id" in item:
            return str(item["Id"]["id"])
    return "?"


@lru_cache(maxsize=64)
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


# ---------------------------------------------------------------------------
# Identity + account discovery — used by the dashboard
# ---------------------------------------------------------------------------


def get_user_profile() -> dict:
    """The Bunq user record — display name, country, language. Powers the
    TopBar + Bunq Accounts panel. Falls back to any of the three Bunq user
    sub-types (Person / Company / ApiKey) since the sandbox skin varies."""
    c = _client()
    user_id, _, _ = _ids()
    resp = c.get(f"user/{user_id}")
    item = resp[0] if resp else {}
    body = item.get("UserPerson") or item.get("UserCompany") or item.get("UserApiKey") or {}
    return {
        "id": body.get("id") or user_id,
        "display_name": body.get("display_name") or body.get("public_nick_name") or "Bunq User",
        "public_nick_name": body.get("public_nick_name"),
        "country": body.get("country"),
        "language": body.get("language"),
        "avatar_url": _avatar_from(body.get("avatar")),
    }


def _avatar_from(avatar: dict | None) -> str | None:
    if not avatar:
        return None
    images = avatar.get("image") or []
    if not images:
        return None
    uuid = images[0].get("attachment_public_uuid")
    if not uuid:
        return None
    return f"https://public-api.sandbox.bunq.com/v1/attachment-public/{uuid}/content"


def list_monetary_accounts() -> list[dict]:
    """All of the user's monetary accounts (Main + every pot). Returns a
    normalized shape so the frontend doesn't need to know about Bunq's
    nested envelope. Cancelled accounts are dropped."""
    c = _client()
    user_id, _, _ = _ids()
    _, main_id, pot_id = _ids()
    resp = c.get(f"user/{user_id}/monetary-account")
    out: list[dict] = []
    for item in resp:
        ma = item.get("MonetaryAccountBank") or item.get("MonetaryAccountSavings") or item.get("MonetaryAccountJoint")
        if not ma:
            continue
        if ma.get("status") == "CANCELLED":
            continue
        iban = next((a["value"] for a in (ma.get("alias") or []) if a.get("type") == "IBAN"), None)
        aid = int(ma.get("id"))
        out.append({
            "id": aid,
            "description": ma.get("description") or "",
            "currency": ma.get("currency") or "EUR",
            "balance": float((ma.get("balance") or {}).get("value", 0.0)),
            "status": ma.get("status"),
            "iban": iban,
            "is_main": aid == main_id,
            "is_default_pot": aid == pot_id,
            "is_ticker_pot": (
                (ma.get("description") or "").startswith(POT_PREFIX)
                and (ma.get("description") or "") not in NON_INVESTMENT_POT_NAMES
            ),
            "ticker": (
                (ma.get("description") or "")[len(POT_PREFIX):].strip() or None
                if (ma.get("description") or "").startswith(POT_PREFIX)
                and (ma.get("description") or "") not in NON_INVESTMENT_POT_NAMES
                else None
            ),
        })
    out.sort(key=lambda a: (not a["is_main"], not a["is_default_pot"], a["description"].lower()))
    return out


def list_payments(account_id: int | None = None, count: int = 25) -> list[dict]:
    """Recent payments. If account_id is None, walks all active accounts and
    merges the streams sorted by created-at (newest first)."""
    c = _client()
    user_id, _, _ = _ids()
    aids: list[int]
    if account_id is None:
        aids = [a["id"] for a in list_monetary_accounts()]
    else:
        aids = [account_id]
    merged: list[dict] = []
    per = max(5, count // max(1, len(aids))) if account_id is None else count
    for aid in aids:
        try:
            resp = c.get(f"user/{user_id}/monetary-account/{aid}/payment", params={"count": per})
        except Exception as e:  # noqa: BLE001
            log.warning("list_payments failed for account %s: %s", aid, e)
            continue
        for item in resp:
            p = item.get("Payment")
            if not p:
                continue
            cp = p.get("counterparty_alias") or {}
            cp_label = cp.get("display_name") or (cp.get("label_monetary_account") or {}).get("display_name") or ""
            merged.append({
                "id": p.get("id"),
                "account_id": aid,
                "amount": float((p.get("amount") or {}).get("value", 0.0)),
                "currency": (p.get("amount") or {}).get("currency", "EUR"),
                "description": p.get("description") or "",
                "type": p.get("type"),
                "sub_type": p.get("sub_type"),
                "counterparty": cp_label,
                "created": p.get("created"),
                "updated": p.get("updated"),
            })
    merged.sort(key=lambda x: x.get("created") or "", reverse=True)
    return merged[:count]


def aggregate_panel(
    aliases: list[str],
    months: int = 24,
    per_account: int = 200,
) -> dict:
    """Real-Bunq aggregation. Walks every active account's payment history,
    matches counterparty / description against the ticker's merchant aliases,
    and rolls outflows up into monthly EUR totals.

    Returns:
        {
          "months":          {"YYYY-MM": float, ...},  # all months in window, zero-filled
          "panel_size_n":    int,                       # distinct counterparties
          "matched_count":   int,                       # number of payment rows
          "matched_sample":  [{"date","amount","counterparty","description"}, ...]
        }

    Sandbox notes: Bunq sandbox is one user, so panel_size_n will be small.
    The analyzer caller decides how to react (live signal vs. fixture
    fallback) based on matched_count.
    """
    from datetime import datetime, timezone, timedelta

    if not aliases:
        return {"months": {}, "panel_size_n": 0, "matched_count": 0, "matched_sample": []}

    needles = [a.lower() for a in aliases if a]
    cutoff = datetime.now(timezone.utc) - timedelta(days=31 * months)

    # Walk every account so we don't miss payments split across pots.
    aids = [a["id"] for a in list_monetary_accounts()]
    monthly: dict[str, float] = {}
    counterparties: set[str] = set()
    matched_count = 0
    samples: list[dict] = []

    for aid in aids:
        try:
            payments = list_payments(account_id=aid, count=per_account)
        except Exception as e:  # noqa: BLE001
            log.warning("aggregate_panel: account %s failed: %s", aid, e)
            continue
        for p in payments:
            amt = float(p.get("amount") or 0.0)
            if amt >= 0:
                continue  # outflows only — we measure user spend
            cp = (p.get("counterparty") or "").lower()
            desc = (p.get("description") or "").lower()
            blob = f"{cp} {desc}"
            if not any(n in blob for n in needles):
                continue
            created = p.get("created") or ""
            try:
                ts = datetime.fromisoformat(created.replace(" ", "T"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
            except Exception:  # noqa: BLE001
                continue
            if ts < cutoff:
                continue
            month = ts.strftime("%Y-%m")
            spend = -amt  # outflow → positive €
            monthly[month] = monthly.get(month, 0.0) + spend
            matched_count += 1
            counterparties.add(cp or desc[:32])
            if len(samples) < 8:
                samples.append({
                    "date": ts.date().isoformat(),
                    "amount": round(spend, 2),
                    "counterparty": p.get("counterparty"),
                    "description": p.get("description"),
                })

    # Zero-fill the full N-month window so the chart isn't gappy.
    today = datetime.now(timezone.utc)
    for i in range(months):
        y = today.year
        m = today.month - i
        while m <= 0:
            m += 12
            y -= 1
        key = f"{y:04d}-{m:02d}"
        monthly.setdefault(key, 0.0)

    return {
        "months": dict(sorted(monthly.items())),
        "panel_size_n": len(counterparties),
        "matched_count": matched_count,
        "matched_sample": samples,
    }


def ensure_ticker_pot(ticker: str) -> int:
    """Find or create a 'Sauron · TICKER' pot. Returns the account id.
    Idempotent: re-uses an existing active pot with the same description."""
    target = f"{POT_PREFIX}{ticker.upper()}"
    for a in list_monetary_accounts():
        if a.get("description") == target and a.get("status") == "ACTIVE":
            return int(a["id"])
    c = _client()
    user_id, _, _ = _ids()
    resp = c.post(
        f"user/{user_id}/monetary-account-bank",
        body={
            "currency": "EUR",
            "description": target,
            "daily_limit": {"value": "10000.00", "currency": "EUR"},
        },
    )
    for item in resp:
        if "Id" in item:
            return int(item["Id"]["id"])
    raise RuntimeError(f"failed to create pot for {ticker}")
