"""Demo seeder.

Idempotent. On every boot we make sure a single, well-known demo account
exists and is funded — so a judge clicking "Sign in" with the published
credentials immediately lands in a fully wired dashboard with €1,000 of
sandbox euros parked in the Investment Pot, a Bunq link already in place,
and balance / spending endpoints actually returning numbers.

Credentials (intentionally public — sandbox only, no real money):
    email:    demo@sauron.app
    password: demo1234

If the user already exists we leave it alone (idempotent across restarts).
If Bunq sandbox is unreachable we still create the email/password row so
the login flow itself keeps working — the user can connect Bunq later.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, select

from backend.auth import hash_password
from backend.db import User, engine
from backend.integrations import bunq as bunq_i

log = logging.getLogger("prospectus.seed")

DEMO_EMAIL = "demo@sauron.app"
DEMO_PASSWORD = "demo1234"
DEMO_DISPLAY_NAME = "Demo User"
DEMO_SEED_AMOUNT_EUR = 1000.0


@dataclass
class _BunqUserShim:
    """Duck-typed shape the bunq integration's _resolve() reads. Built from
    the freshly-minted sandbox creds before we have a User row to point at."""

    bunq_api_key: str
    bunq_user_id: int
    bunq_main_account_id: int
    bunq_pot_account_id: int


def _ensure_pot_funded(shim: Any, target_eur: float) -> None:
    """Make best effort to leave `target_eur` sitting in the Investment Pot.

    Sandbox eventual consistency: sugardaddy@bunq.com auto-accepts
    request-inquiries up to ~€100 each, and even those land 1-3s later
    rather than synchronously. So we (a) chunk top-ups via the integration,
    (b) wait a short window for settlement, (c) sweep whatever main has into
    the pot. Re-running on the next boot catches any remainder.
    """
    import time

    try:
        pot_now = bunq_i.get_pot_balance_eur(user=shim)
    except Exception:  # noqa: BLE001
        log.exception("seed: could not read pot balance")
        return
    deficit = target_eur - pot_now
    if deficit <= 0.5:
        log.info("seed: pot already at €%.2f (target €%.2f) — nothing to do",
                 pot_now, target_eur)
        return
    log.info(
        "seed: pot at €%.2f, target €%.2f — funding deficit €%.2f",
        pot_now, target_eur, deficit,
    )

    try:
        main_now = bunq_i.get_main_balance_eur(user=shim)
    except Exception:  # noqa: BLE001
        log.exception("seed: could not read main balance")
        main_now = 0.0
    main_needed = max(0.0, deficit - main_now)
    if main_needed > 0:
        try:
            ids = bunq_i.topup_main_from_sugardaddy(main_needed, user=shim)
            log.info("seed: fired %d sugardaddy request(s) for €%.2f",
                     len(ids), main_needed)
        except Exception:  # noqa: BLE001
            log.exception("seed: sugardaddy top-up failed (will retry next boot)")

    # Wait up to ~6s for sandbox settlement. Sandbox is eventually consistent
    # — we poll instead of sleeping a flat number so happy paths stay quick.
    deadline = time.time() + 6.0
    while time.time() < deadline:
        try:
            main_now = bunq_i.get_main_balance_eur(user=shim)
        except Exception:  # noqa: BLE001
            main_now = 0.0
        if main_now + 0.5 >= deficit:
            break
        time.sleep(0.6)

    sweep = min(deficit, main_now)
    if sweep > 0.5:
        try:
            bunq_i.transfer_main_to_pot(sweep, "Sauron demo seed", user=shim)
            log.info("seed: swept €%.2f main→pot (main=%.2f)", sweep, main_now)
        except Exception:  # noqa: BLE001
            log.exception("seed: main→pot sweep failed")


def _provision_bunq() -> dict[str, Any] | None:
    """Mint a fresh Bunq sandbox user. Returns creds or None on failure."""
    try:
        return bunq_i.provision_new_sandbox_user()
    except Exception:  # noqa: BLE001
        log.exception("seed: could not mint Bunq sandbox user — skipping link")
        return None


def seed_demo_account() -> None:
    """Idempotent demo-account seed. Safe (and useful) to run on every boot:
    if the user already exists but has no Bunq link or the pot fell below
    the demo target, we top it back up.
    """
    if os.environ.get("SAURON_SEED_DEMO", "1").lower() in ("0", "false", "no"):
        log.info("seed: SAURON_SEED_DEMO disabled — skipping")
        return

    with Session(engine) as session:
        user = session.exec(
            select(User).where(User.email == DEMO_EMAIL)
        ).first()
        created = False
        if user is None:
            user = User(
                email=DEMO_EMAIL,
                password_hash=hash_password(DEMO_PASSWORD),
                auth_provider="email",
                display_name=DEMO_DISPLAY_NAME,
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            created = True
            log.info("seed: created demo user %s", DEMO_EMAIL)
        else:
            log.info("seed: demo user already present (id=%s)", user.id)

        # Ensure a Bunq sandbox link is attached.
        if not (user.bunq_api_key and user.bunq_user_id and user.bunq_main_account_id):
            creds = _provision_bunq()
            if creds is not None:
                user.bunq_api_key = creds["api_key"]
                user.bunq_user_id = int(creds["user_id"])
                user.bunq_main_account_id = int(creds["main_account_id"])
                user.bunq_pot_account_id = int(creds["pot_account_id"])
                session.add(user)
                session.commit()
                session.refresh(user)
                log.info("seed: attached fresh Bunq sandbox link")

    # Fund the pot — runs OUTSIDE the session so the long-ish Bunq calls
    # don't hold the SQLite write lock.
    if user.bunq_api_key:
        shim = _BunqUserShim(
            bunq_api_key=user.bunq_api_key,
            bunq_user_id=int(user.bunq_user_id),
            bunq_main_account_id=int(user.bunq_main_account_id),
            bunq_pot_account_id=int(user.bunq_pot_account_id or user.bunq_main_account_id),
        )
        _ensure_pot_funded(shim, DEMO_SEED_AMOUNT_EUR)
    else:
        log.warning("seed: demo user has no Bunq link — /balance will show 0")

    if created:
        log.info(
            "seed: demo ready — sign in with %s / %s",
            DEMO_EMAIL,
            DEMO_PASSWORD,
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    from backend.db import init_db

    init_db()
    seed_demo_account()
