"""Stress-test every endpoint with real, edge-case, and bogus inputs.

Prints a pass/fail row per probe; exits non-zero if any expected check fails.
This is the safety net before demo day.
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from dotenv import load_dotenv

load_dotenv()

BACKEND = "http://127.0.0.1:8080"

PASSED: list[str] = []
FAILED: list[str] = []


@dataclass
class Probe:
    name: str
    method: str
    path: str
    body: dict | None = None
    expect_status: int = 200
    expect_keys: list[str] | None = None       # all must be present
    expect_truthy: list[str] | None = None      # all must be truthy
    expect_falsy: list[str] | None = None       # all must be falsy / None / []
    timeout: float = 90.0


def run(p: Probe) -> None:
    label = f"  [{p.method:5s}] {p.path[:60]:60s} {p.name}"
    try:
        r = httpx.request(p.method, BACKEND + p.path, json=p.body, timeout=p.timeout)
    except Exception as e:  # noqa: BLE001
        FAILED.append(f"{label} ✗ network error: {e}")
        print(FAILED[-1])
        return

    if r.status_code != p.expect_status:
        FAILED.append(
            f"{label} ✗ HTTP {r.status_code} != {p.expect_status} ({r.text[:120]})"
        )
        print(FAILED[-1])
        return

    if p.expect_status >= 400:
        # error path — don't try to parse JSON deeply
        PASSED.append(f"{label} ✓ {r.status_code}")
        print(PASSED[-1])
        return

    try:
        data = r.json()
    except json.JSONDecodeError:
        FAILED.append(f"{label} ✗ invalid JSON")
        print(FAILED[-1])
        return

    for k in p.expect_keys or []:
        if not _has_key(data, k):
            FAILED.append(f"{label} ✗ missing key {k}")
            print(FAILED[-1])
            return

    for k in p.expect_truthy or []:
        v = _dig(data, k)
        if not v:
            FAILED.append(f"{label} ✗ expected truthy at {k} (got {v!r})")
            print(FAILED[-1])
            return

    for k in p.expect_falsy or []:
        v = _dig(data, k)
        if v:
            FAILED.append(f"{label} ✗ expected falsy at {k} (got {v!r})")
            print(FAILED[-1])
            return

    PASSED.append(f"{label} ✓")
    print(PASSED[-1])


def _has_key(d: dict, dotted: str) -> bool:
    return _dig(d, dotted, sentinel=...) is not ...


def _dig(d, dotted: str, sentinel=None):
    cur = d
    for part in dotted.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return sentinel
    return cur


# --------------------------------------------------------------------
# Probes
# --------------------------------------------------------------------

PROBES: list[Probe] = [
    # ----- /health -----
    Probe(
        name="health endpoint",
        method="GET", path="/health",
        expect_keys=["status", "llm_provider", "bedrock_model"],
    ),

    # ----- /validate-ticker -----
    Probe(
        name="validate real common (AAPL)",
        method="GET", path="/validate-ticker/AAPL",
        expect_truthy=["ok"], expect_keys=["name"],
    ),
    Probe(
        name="validate real EU (HEIA.AS)",
        method="GET", path="/validate-ticker/HEIA.AS",
        expect_truthy=["ok", "name"],
    ),
    Probe(
        name="validate real but exotic (BRK-B)",
        method="GET", path="/validate-ticker/BRK-B",
        expect_truthy=["ok"],
    ),
    Probe(
        name="validate real obscure no fixtures (F)",
        method="GET", path="/validate-ticker/F",
        expect_truthy=["ok"],
    ),
    Probe(
        name="validate bogus letters (XYZZY)",
        method="GET", path="/validate-ticker/XYZZY",
        expect_falsy=["ok"],
    ),
    Probe(
        name="validate bogus numbers (12345)",
        method="GET", path="/validate-ticker/12345",
        expect_falsy=["ok"],
    ),
    Probe(
        name="validate bogus punctuation",
        method="GET", path="/validate-ticker/$$$$",
        expect_falsy=["ok"],
    ),

    # ----- /nearby-tickers -----
    Probe(
        name="nearby Amsterdam (52.36, 4.89) returns >=3",
        method="GET",
        path="/nearby-tickers?lat=52.36&lng=4.89&radius_m=5000",
        expect_keys=["0.ticker"],
    ),
    Probe(
        name="nearby middle of ocean returns []",
        method="GET",
        path="/nearby-tickers?lat=0&lng=0&radius_m=1000",
    ),

    # ----- /panel -----
    Probe(
        name="panel real with fixture (HEIA.AS)",
        method="GET", path="/panel/HEIA.AS",
        expect_truthy=["yoy_change_pct", "next_quarter.revenue_direction"],
    ),
    Probe(
        name="panel real no fixture (BRK-B)",
        method="GET", path="/panel/BRK-B",
        expect_status=404,
    ),
    Probe(
        name="panel bogus",
        method="GET", path="/panel/XYZZY",
        expect_status=404,
    ),

    # ----- /balance -----
    Probe(
        name="bunq balance",
        method="GET", path="/balance",
        expect_keys=["main", "pot"],
    ),

    # ----- /analyze -----
    Probe(
        name="analyze bogus ticker → 404",
        method="POST", path="/analyze",
        body={"ticker": "XYZZY"},
        expect_status=404,
    ),
    Probe(
        name="analyze empty ticker → 4xx",
        method="POST", path="/analyze",
        body={"ticker": ""},
        expect_status=404,
    ),
    Probe(
        name="analyze real common (AAPL) full report",
        method="POST", path="/analyze",
        body={"ticker": "AAPL"},
        expect_truthy=["verdict", "company_name", "sections.fundamentals"],
    ),
    Probe(
        name="analyze real obscure no fixtures (F=Ford)",
        method="POST", path="/analyze",
        body={"ticker": "F"},
        expect_truthy=["verdict", "company_name"],
        # Should still produce a verdict; panel + bunq_spending should be None
    ),

    # ----- /evidence -----
    Probe(
        name="evidence text too short",
        method="POST", path="/evidence",
        body={"ticker": "AAPL", "source_type": "text", "text": "tiny"},
        expect_status=400,
    ),
    Probe(
        name="evidence url 404 from origin",
        method="POST", path="/evidence",
        body={
            "ticker": "AAPL", "source_type": "url",
            "url": "https://example.com/this-page-definitely-does-not-exist-aaaa",
        },
        expect_status=400,
    ),
    Probe(
        name="evidence malformed URL",
        method="POST", path="/evidence",
        body={"ticker": "AAPL", "source_type": "url", "url": "not-a-url"},
        expect_status=400,
    ),
    Probe(
        name="evidence valid pasted text",
        method="POST", path="/evidence",
        body={
            "ticker": "AAPL",
            "company_name": "Apple Inc.",
            "source_type": "text",
            "text": "Apple iPhone 17 sales tracking ahead of plan in China; analysts raise FY estimates by 3 percent. Services revenue up 14 percent YoY.",
            "user_note": "bullish read",
            "user_tag": "supporting",
        },
        expect_truthy=["source_id", "summary"],
    ),

    # ----- /invest -----
    Probe(
        name="invest negative amount → 4xx",
        method="POST", path="/invest",
        body={"ticker": "AAPL", "amount_eur": -10},
        expect_status=422,  # pydantic gt=0 validator
    ),
    Probe(
        name="invest zero amount → 4xx",
        method="POST", path="/invest",
        body={"ticker": "AAPL", "amount_eur": 0},
        expect_status=422,
    ),
    Probe(
        name="invest over cap → 400",
        method="POST", path="/invest",
        body={"ticker": "AAPL", "amount_eur": 25000},
        expect_status=400,
    ),
    Probe(
        name="invest €1 happy path",
        method="POST", path="/invest",
        body={"ticker": "AAPL", "amount_eur": 1.00},
        expect_truthy=["bunq_payment_id"],
    ),

    # ----- /resynthesize -----
    Probe(
        name="resynthesize empty sections → 200 (degrades to 'unknown')",
        method="POST", path="/resynthesize",
        body={
            "ticker": "AAPL",
            "company_name": "Apple Inc.",
            "sections": {},
            "user_sources": [],
        },
        expect_truthy=["verdict"],
    ),
]


def stream_probes() -> None:
    """SSE stream probes — printed inline since they don't fit the dataclass."""
    label = lambda name: f"  [POST ] /analyze/stream {name:>40s}"

    # Bogus ticker should yield ONE error event
    try:
        with httpx.stream(
            "POST", BACKEND + "/analyze/stream",
            json={"ticker": "XYZZY"}, timeout=30,
        ) as r:
            events = []
            for line in r.iter_lines():
                if line.startswith("data: "):
                    events.append(json.loads(line[6:]))
            kinds = [e.get("event") for e in events]
            if kinds == ["error"]:
                PASSED.append(f"{label('stream bogus ticker → error')} ✓")
            else:
                FAILED.append(
                    f"{label('stream bogus ticker → error')} ✗ events={kinds}"
                )
            print(PASSED[-1] if kinds == ["error"] else FAILED[-1])
    except Exception as e:  # noqa: BLE001
        FAILED.append(f"{label('stream bogus ticker → error')} ✗ {e}")
        print(FAILED[-1])

    # Real ticker should emit start → module_starts → module_dones → synthesizing → report
    try:
        with httpx.stream(
            "POST", BACKEND + "/analyze/stream",
            json={"ticker": "AAPL"}, timeout=120,
        ) as r:
            events = []
            for line in r.iter_lines():
                if line.startswith("data: "):
                    events.append(json.loads(line[6:]))
            kinds = [e.get("event") for e in events]
            ok = (
                kinds[0] == "start"
                and "synthesizing" in kinds
                and kinds[-1] == "report"
                and kinds.count("module_start") >= 5
                and kinds.count("module_done") >= 5
            )
            if ok:
                PASSED.append(
                    f"{label('stream AAPL full cycle')} ✓ ({len(events)} events)"
                )
            else:
                FAILED.append(
                    f"{label('stream AAPL full cycle')} ✗ kinds={kinds}"
                )
            print(PASSED[-1] if ok else FAILED[-1])
    except Exception as e:  # noqa: BLE001
        FAILED.append(f"{label('stream AAPL full cycle')} ✗ {e}")
        print(FAILED[-1])


def main() -> None:
    print(f"Stress-testing {BACKEND} ({len(PROBES)} probes + 2 stream probes)\n")
    t0 = time.monotonic()
    for p in PROBES:
        run(p)
    print()
    stream_probes()
    dt = time.monotonic() - t0
    total = len(PASSED) + len(FAILED)
    print(f"\n{len(PASSED)}/{total} passed · {dt:.1f}s")
    if FAILED:
        print("\n--- FAILURES ---")
        for f in FAILED:
            print(f)
        sys.exit(1)


if __name__ == "__main__":
    main()
