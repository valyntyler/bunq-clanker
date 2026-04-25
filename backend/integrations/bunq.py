"""Bunq integration — every money / identity touchpoint goes through here.

Per-user creds (preferred) OR a global env-var fallback. When a Sauron user
has signed up via the "Sign up with Bunq" path (or has connected their
sandbox API key later), they have a `bunq_api_key` + matching account ids
on their User row. We pass that user object through to every helper so each
user's /balance, /invest, etc. hit their own sandbox account. When no user
is supplied (legacy code paths, scripts, demo seed) we fall back to the
global BUNQ_API_KEY etc. env vars so existing flows keep working unchanged.

Top-level operations:

    get_balance(user=None)                            -> {main, pot}
    get_user_profile(user=None)                       -> {display_name, country, ...}
    list_monetary_accounts(user=None)                 -> [{id, description, ...}]
    list_payments(user=None, account_id?)             -> recent payments
    fund_main_from_sugardaddy(amount, user=None)      -> request test money
    transfer_main_to_pot(amount, desc, user=None)     -> Main → default pot
    transfer_main_to_account(aid, amt, desc, user=None)
    ensure_ticker_pot(ticker, user=None)              -> int
    aggregate_panel(aliases, ..., user=None)          -> live panel signal
    request_payment_from_email(email, amt, desc, user=None)

Sandbox-only. No real money ever touched.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from backend.integrations.bunq_client import BunqClient

log = logging.getLogger("prospectus.bunq")

SUGARDADDY = "sugardaddy@bunq.com"
POT_PREFIX = "Sauron · "  # ticker-pot naming convention
# Pots that share the POT_PREFIX but aren't real investment pots — skipped
# from balance aggregation and the dashboard's "ticker pots" filter.
NON_INVESTMENT_POT_NAMES = {"Sauron · Panel Seed"}


@dataclass
class _Creds:
    api_key: str
    user_id: int
    main_id: int
    pot_id: int  # default investment pot; per-ticker pots are looked up dynamically


@lru_cache(maxsize=64)
def _client_for(api_key: str) -> BunqClient:
    """One BunqClient per distinct API key; auth context is persisted by
    BunqClient itself in bunq_context.json (keyed by api_key)."""
    c = BunqClient(api_key=api_key, sandbox=True)
    c.authenticate()
    return c


def _resolve(user: Any | None) -> _Creds:
    """Pick per-user creds when present, else fall back to env. Accepts the
    User row (duck-typed: must have bunq_api_key / bunq_user_id /
    bunq_main_account_id / bunq_pot_account_id attrs) or None."""
    if user is not None:
        api_key = getattr(user, "bunq_api_key", None)
        u_id = getattr(user, "bunq_user_id", None)
        m_id = getattr(user, "bunq_main_account_id", None)
        p_id = getattr(user, "bunq_pot_account_id", None)
        if api_key and u_id and m_id:
            return _Creds(
                api_key=api_key,
                user_id=int(u_id),
                main_id=int(m_id),
                # pot_id is optional — fall back to main when not yet provisioned
                pot_id=int(p_id) if p_id else int(m_id),
            )
    # Global env fallback — legacy demo path.
    return _Creds(
        api_key=os.environ["BUNQ_API_KEY"],
        user_id=int(os.environ["BUNQ_USER_ID"]),
        main_id=int(os.environ["BUNQ_MAIN_ACCOUNT_ID"]),
        pot_id=int(os.environ["BUNQ_POT_ACCOUNT_ID"]),
    )


# Back-compat shims for the few call sites that take no user (scripts, the
# panel-seed run, etc.). Resolve env-fallback creds.
def _client() -> BunqClient:
    return _client_for(_resolve(None).api_key)


def _ids() -> tuple[int, int, int]:
    c = _resolve(None)
    return c.user_id, c.main_id, c.pot_id


def get_balance(user: Any | None = None) -> dict[str, float]:
    """Main + 'Investment Pot' EUR balances for the given Sauron user (or
    the env-fallback user when None). The 'pot' figure aggregates the
    default Investment Pot + every Sauron · TICKER pot."""
    creds = _resolve(user)
    c = _client_for(creds.api_key)
    main_resp = c.get(f"user/{creds.user_id}/monetary-account/{creds.main_id}")
    main_balance = float(main_resp[0]["MonetaryAccountBank"]["balance"]["value"])

    pot_total = 0.0
    for a in list_monetary_accounts(user=user):
        if a.get("status") != "ACTIVE":
            continue
        desc = a.get("description") or ""
        if desc in NON_INVESTMENT_POT_NAMES:
            continue
        if a.get("is_default_pot") or a.get("is_ticker_pot"):
            pot_total += float(a.get("balance") or 0.0)
        elif int(a["id"]) == creds.pot_id:
            pot_total += float(a.get("balance") or 0.0)
    return {"main": main_balance, "pot": round(pot_total, 2)}


def request_payment_from_email(
    email: str,
    amount_eur: float,
    description: str,
    user: Any | None = None,
) -> str:
    creds = _resolve(user)
    c = _client_for(creds.api_key)
    resp = c.post(
        f"user/{creds.user_id}/monetary-account/{creds.main_id}/request-inquiry",
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


def fund_main_from_sugardaddy(
    amount_eur: float,
    description: str = "prospectus top-up",
    user: Any | None = None,
) -> str:
    """Sandbox-only. Request money from sugardaddy@bunq.com to Main."""
    creds = _resolve(user)
    c = _client_for(creds.api_key)
    resp = c.post(
        f"user/{creds.user_id}/monetary-account/{creds.main_id}/request-inquiry",
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


def transfer_main_to_pot(
    amount_eur: float, description: str, user: Any | None = None
) -> str:
    creds = _resolve(user)
    c = _client_for(creds.api_key)
    return _send_payment(
        c, creds, creds.main_id, creds.pot_id, amount_eur, description,
        "Prospectus Investments",
    )


def transfer_main_to_account(
    account_id: int,
    amount_eur: float,
    description: str,
    name: str = "Sauron Investments",
    user: Any | None = None,
) -> str:
    creds = _resolve(user)
    c = _client_for(creds.api_key)
    return _send_payment(
        c, creds, creds.main_id, account_id, amount_eur, description, name,
    )


def _send_payment(
    c: BunqClient,
    creds: _Creds,
    src_id: int,
    dst_id: int,
    amount_eur: float,
    description: str,
    dst_name: str,
) -> str:
    resp = c.post(
        f"user/{creds.user_id}/monetary-account/{src_id}/payment",
        body={
            "amount": {"value": f"{amount_eur:.2f}", "currency": "EUR"},
            "counterparty_alias": {
                "type": "IBAN",
                "value": _iban_for(dst_id, creds=creds),
                "name": dst_name,
            },
            "description": description,
        },
    )
    for item in resp:
        if "Id" in item:
            return str(item["Id"]["id"])
    return "?"


@lru_cache(maxsize=256)
def _iban_for_cached(api_key: str, user_id: int, account_id: int) -> str:
    c = _client_for(api_key)
    resp = c.get(f"user/{user_id}/monetary-account/{account_id}")
    ma = resp[0]["MonetaryAccountBank"]
    for alias in ma.get("alias") or []:
        if alias.get("type") == "IBAN":
            return alias["value"]
    raise RuntimeError(f"no IBAN alias for account {account_id}")


def _iban_for(account_id: int, creds: _Creds | None = None, user: Any | None = None) -> str:
    """Resolve an IBAN for an internal monetary account id. Prefer passing
    a resolved Creds object so we don't re-hit env vars in hot paths."""
    if creds is None:
        creds = _resolve(user)
    return _iban_for_cached(creds.api_key, creds.user_id, account_id)


# ---------------------------------------------------------------------------
# Identity + account discovery — used by the dashboard
# ---------------------------------------------------------------------------


def get_user_profile(user: Any | None = None) -> dict:
    """The Bunq user record — display name, country, language."""
    creds = _resolve(user)
    c = _client_for(creds.api_key)
    resp = c.get(f"user/{creds.user_id}")
    item = resp[0] if resp else {}
    body = item.get("UserPerson") or item.get("UserCompany") or item.get("UserApiKey") or {}
    return {
        "id": body.get("id") or creds.user_id,
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


def list_monetary_accounts(user: Any | None = None) -> list[dict]:
    """All of the user's monetary accounts (Main + every pot). Cancelled
    accounts are dropped."""
    creds = _resolve(user)
    c = _client_for(creds.api_key)
    main_id = creds.main_id
    pot_id = creds.pot_id
    resp = c.get(f"user/{creds.user_id}/monetary-account")
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


def list_payments(
    account_id: int | None = None, count: int = 25, user: Any | None = None
) -> list[dict]:
    """Recent payments. If account_id is None, walks all active accounts and
    merges the streams sorted by created-at (newest first)."""
    creds = _resolve(user)
    c = _client_for(creds.api_key)
    aids: list[int]
    if account_id is None:
        aids = [a["id"] for a in list_monetary_accounts(user=user)]
    else:
        aids = [account_id]
    merged: list[dict] = []
    per = max(5, count // max(1, len(aids))) if account_id is None else count
    for aid in aids:
        try:
            resp = c.get(f"user/{creds.user_id}/monetary-account/{aid}/payment", params={"count": per})
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
    user: Any | None = None,
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
    aids = [a["id"] for a in list_monetary_accounts(user=user)]
    monthly: dict[str, float] = {}
    counterparties: set[str] = set()
    matched_count = 0
    samples: list[dict] = []

    for aid in aids:
        try:
            payments = list_payments(account_id=aid, count=per_account, user=user)
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


def ensure_ticker_pot(ticker: str, user: Any | None = None) -> int:
    """Find or create a 'Sauron · TICKER' pot. Returns the account id.
    Idempotent: re-uses an existing active pot with the same description."""
    target = f"{POT_PREFIX}{ticker.upper()}"
    for a in list_monetary_accounts(user=user):
        if a.get("description") == target and a.get("status") == "ACTIVE":
            return int(a["id"])
    creds = _resolve(user)
    c = _client_for(creds.api_key)
    resp = c.post(
        f"user/{creds.user_id}/monetary-account-bank",
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


# ---------------------------------------------------------------------------
# Sign-up: mint a fresh Bunq sandbox user + bootstrap Main + Investment Pot.
# Used by the /auth/register/bunq path.
# ---------------------------------------------------------------------------


def provision_new_sandbox_user() -> dict:
    """Mint a fresh Bunq sandbox user (new API key), authenticate, ensure a
    'Prospectus Investments' pot exists, and return the creds + identity
    pieces the caller needs to persist on the Sauron User row.

    Returns:
        {
          "api_key":           str,
          "user_id":           int,   # Bunq's user id
          "main_account_id":   int,
          "pot_account_id":    int,
          "display_name":      str,
          "country":           str | None,
        }
    """
    api_key = BunqClient.create_sandbox_user()
    c = BunqClient(api_key=api_key, sandbox=True)
    c.authenticate()
    if not c.user_id:
        raise RuntimeError("sandbox user mint succeeded but user_id is missing")
    bunq_user_id = int(c.user_id)

    # Identify the user (display name, country)
    profile_resp = c.get(f"user/{bunq_user_id}")
    body: dict = {}
    if profile_resp:
        item = profile_resp[0]
        body = (
            item.get("UserPerson")
            or item.get("UserCompany")
            or item.get("UserApiKey")
            or {}
        )
    display_name = body.get("display_name") or body.get("public_nick_name") or "Bunq user"
    country = body.get("country")

    # Pick the primary monetary account as Main, then ensure an Investment
    # Pot ('Prospectus Investments') is provisioned.
    accounts = c.get(f"user/{bunq_user_id}/monetary-account")
    main_id: int | None = None
    pot_id: int | None = None
    for item in accounts:
        ma = item.get("MonetaryAccountBank") or {}
        if ma.get("status") != "ACTIVE":
            continue
        desc = ma.get("description") or ""
        aid = int(ma["id"])
        if desc == "Prospectus Investments":
            pot_id = aid
        elif main_id is None:
            main_id = aid
    if main_id is None:
        raise RuntimeError("freshly minted sandbox user has no active main account")
    if pot_id is None:
        # Create the default Investment Pot
        resp = c.post(
            f"user/{bunq_user_id}/monetary-account-bank",
            body={
                "currency": "EUR",
                "description": "Prospectus Investments",
                "daily_limit": {"value": "10000.00", "currency": "EUR"},
            },
        )
        for item in resp:
            if "Id" in item:
                pot_id = int(item["Id"]["id"])
                break
    if pot_id is None:
        raise RuntimeError("could not create Investment Pot for new user")

    return {
        "api_key": api_key,
        "user_id": bunq_user_id,
        "main_account_id": main_id,
        "pot_account_id": pot_id,
        "display_name": display_name,
        "country": country,
    }


def attach_existing_api_key(api_key: str) -> dict:
    """Attach an existing Bunq sandbox API key — used when an email/OAuth
    user later wants to connect their own sandbox account. Validates that
    the key authenticates, then returns the same creds shape as
    provision_new_sandbox_user()."""
    api_key = (api_key or "").strip()
    if not api_key:
        raise ValueError("empty api_key")
    c = BunqClient(api_key=api_key, sandbox=True)
    c.authenticate()
    if not c.user_id:
        raise RuntimeError("authentication succeeded but user_id missing — bad key?")
    bunq_user_id = int(c.user_id)
    profile_resp = c.get(f"user/{bunq_user_id}")
    body: dict = {}
    if profile_resp:
        item = profile_resp[0]
        body = (
            item.get("UserPerson")
            or item.get("UserCompany")
            or item.get("UserApiKey")
            or {}
        )
    display_name = body.get("display_name") or body.get("public_nick_name") or "Bunq user"
    country = body.get("country")
    accounts = c.get(f"user/{bunq_user_id}/monetary-account")
    main_id: int | None = None
    pot_id: int | None = None
    for item in accounts:
        ma = item.get("MonetaryAccountBank") or {}
        if ma.get("status") != "ACTIVE":
            continue
        desc = ma.get("description") or ""
        aid = int(ma["id"])
        if desc == "Prospectus Investments" and pot_id is None:
            pot_id = aid
        elif main_id is None:
            main_id = aid
    if main_id is None:
        raise RuntimeError("connected account has no active main account")
    if pot_id is None:
        resp = c.post(
            f"user/{bunq_user_id}/monetary-account-bank",
            body={
                "currency": "EUR",
                "description": "Prospectus Investments",
                "daily_limit": {"value": "10000.00", "currency": "EUR"},
            },
        )
        for item in resp:
            if "Id" in item:
                pot_id = int(item["Id"]["id"])
                break
    if pot_id is None:
        raise RuntimeError("could not create Investment Pot on connected account")
    return {
        "api_key": api_key,
        "user_id": bunq_user_id,
        "main_account_id": main_id,
        "pot_account_id": pot_id,
        "display_name": display_name,
        "country": country,
    }
