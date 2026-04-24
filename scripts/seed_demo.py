"""Pre-flight + warm-up for the live demo.

What this does (in order):
  1. Verify Bedrock, S3, Bunq, Alpaca are all reachable.
  2. Top up the Bunq sandbox Main account to >=€500.
  3. Run /analyze for the demo tickers (HEIA, AAPL, NVDA, TSLA) so:
       a. yfinance caches warm,
       b. chart PNGs land in S3,
       c. any module bugs surface here, not on stage.
  4. Print a final READY/NOT-READY banner with the URLs to open.

Run from project root:
    AWS_PROFILE=prospectus ./.venv/bin/python scripts/seed_demo.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

# Allow `from backend...` imports when running from project root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

import httpx  # noqa: E402

BACKEND = os.getenv("BACKEND_URL", "http://127.0.0.1:8080")
FRONTEND = os.getenv("APP_PUBLIC_URL", "http://localhost:3000")
DEMO_TICKERS = ["HEIA.AS", "AAPL", "NVDA", "TSLA"]
TARGET_MAIN_BALANCE_EUR = 500.0


def check_aws() -> tuple[bool, str]:
    try:
        import boto3

        sts = boto3.client("sts")
        ident = sts.get_caller_identity()
        return True, f"AWS account {ident['Account']} as {ident['Arn'].rsplit('/', 1)[-1]}"
    except Exception as e:  # noqa: BLE001
        return False, f"AWS: {e}"


def check_bedrock() -> tuple[bool, str]:
    try:
        from backend.llm import call_claude

        out = call_claude("Reply with exactly the word OK.", max_tokens=8)
        return ("OK" in out.upper()), f"Bedrock: {out.strip()[:30]}"
    except Exception as e:  # noqa: BLE001
        return False, f"Bedrock: {e}"


def check_s3() -> tuple[bool, str]:
    try:
        import boto3

        bucket = os.getenv("AWS_S3_BUCKET", "sauron-wallet")
        boto3.client("s3").head_bucket(Bucket=bucket)
        return True, f"S3 bucket {bucket}"
    except Exception as e:  # noqa: BLE001
        return False, f"S3: {e}"


def check_bunq() -> tuple[bool, str]:
    try:
        from backend.integrations.bunq import get_balance

        b = get_balance()
        return True, f"Bunq main €{b['main']} pot €{b['pot']}"
    except Exception as e:  # noqa: BLE001
        return False, f"Bunq: {e}"


def check_alpaca() -> tuple[bool, str]:
    try:
        from backend.integrations.alpaca import get_account

        a = get_account()
        return True, f"Alpaca paper ${a['cash']:.0f} cash"
    except Exception as e:  # noqa: BLE001
        return False, f"Alpaca: {e}"


def check_backend_alive() -> tuple[bool, str]:
    try:
        r = httpx.get(f"{BACKEND}/health", timeout=3)
        return r.status_code == 200, f"backend HTTP {r.status_code}"
    except Exception as e:  # noqa: BLE001
        return False, f"backend not reachable: {e}"


def topup_bunq_to_target() -> str:
    from backend.integrations.bunq import fund_main_from_sugardaddy, get_balance

    bal = get_balance()
    if bal["main"] >= TARGET_MAIN_BALANCE_EUR:
        return f"Bunq Main already at €{bal['main']:.2f} (target €{TARGET_MAIN_BALANCE_EUR})"
    needed = TARGET_MAIN_BALANCE_EUR - bal["main"]
    rid = fund_main_from_sugardaddy(needed, description="prospectus demo seed")
    time.sleep(2)
    bal = get_balance()
    return f"topped up €{needed:.2f} (req {rid}) — Main now €{bal['main']:.2f}"


def warm_one(ticker: str) -> tuple[bool, str]:
    try:
        t0 = time.monotonic()
        r = httpx.post(
            f"{BACKEND}/analyze",
            json={"ticker": ticker},
            timeout=90,
        )
        r.raise_for_status()
        d = r.json()
        dt = time.monotonic() - t0
        verdict = d["verdict"]
        panel = d.get("consumer_panel_forecast")
        bunq = d.get("bunq_spending_overlay")
        bits = [f"verdict={verdict}", f"{dt:.1f}s"]
        if panel:
            bits.append(f"panel YoY {panel['yoy_change_pct']:+.1f}%")
        if bunq:
            bits.append(f"bunq €{bunq['total_spent_12m_eur']}/{bunq['visit_count']}v")
        return True, " · ".join(bits)
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def run_checks() -> bool:
    print("== preflight ==")
    rows: list[tuple[str, bool, str]] = []
    for label, fn in [
        ("aws.sts", check_aws),
        ("bedrock", check_bedrock),
        ("s3", check_s3),
        ("bunq", check_bunq),
        ("alpaca", check_alpaca),
        ("backend", check_backend_alive),
    ]:
        ok, msg = fn()
        rows.append((label, ok, msg))
        mark = "✓" if ok else "✗"
        print(f"  [{mark}] {label:10s} {msg}")
    return all(ok for _, ok, _ in rows)


def main() -> None:
    if not run_checks():
        print("\n✗ preflight failed — fix the red rows above before warming.")
        sys.exit(1)

    print("\n== bunq topup ==")
    print(f"  {topup_bunq_to_target()}")

    print(f"\n== warming demo tickers ({', '.join(DEMO_TICKERS)}) ==")
    for t in DEMO_TICKERS:
        ok, msg = warm_one(t)
        mark = "✓" if ok else "✗"
        print(f"  [{mark}] {t:8s} {msg}")

    print("\n== READY ==")
    print(f"  Frontend:  {FRONTEND}")
    print(f"  Backend:   {BACKEND}")
    print(f"  Demo URL:  {FRONTEND}/analyze/HEIA.AS?lat=52.3579&lng=4.8931")
    print()
    print("Demo flow:")
    print("  1. Open frontend, click 📍 Use my location (or pre-set in DevTools).")
    print("  2. HEIA.AS appears at 0m → click it.")
    print("  3. Watch Panel ↑+14% YoY, Bunq personal €342, verdict HOLD.")
    print("  4. Top-right Invest €X → live balance pills → Confirm.")
    print("  5. Receipt: Bunq payment id + Alpaca order id.")


if __name__ == "__main__":
    main()
