"""Real-time IPO filings from SEC EDGAR.

EDGAR exposes a public atom feed of recent filings by form type. We pull
S-1 (initial registration) and S-1/A (amended) filings — these are the
prospectus filings that precede a US listing.

No API key, no auth — but SEC requires a descriptive User-Agent with a
contact identifier per their fair-access policy:
    https://www.sec.gov/os/accessing-edgar-data
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass
from xml.etree import ElementTree as ET

import httpx

log = logging.getLogger("prospectus.edgar")

UA = os.getenv(
    "EDGAR_USER_AGENT",
    "Sauron Wallet research prototype contact@sauron-wallet.local",
)

ATOM_NS = "{http://www.w3.org/2005/Atom}"


@dataclass
class EdgarFiling:
    title: str          # e.g. "S-1/A - ACME ROBOTICS INC. (0001234567) (Filer)"
    company: str        # ACME ROBOTICS INC.
    form: str           # S-1 or S-1/A
    cik: str            # 0001234567
    filed_at: str       # ISO timestamp
    url: str            # link to filing index
    summary: str = ""


# ──────────────────────────────────────────────────────────────────────────
# Cheap in-memory cache. SEC asks for a max of 10 req/sec; we only need to
# hit them every 30 minutes anyway.

_CACHE: dict[str, tuple[float, list[EdgarFiling]]] = {}
_CACHE_TTL_S = 30 * 60


def fetch_recent_filings(form: str = "S-1", limit: int = 40) -> list[EdgarFiling]:
    cache_key = f"{form}:{limit}"
    now = time.monotonic()
    cached = _CACHE.get(cache_key)
    if cached and now - cached[0] < _CACHE_TTL_S:
        return cached[1]

    # action=getcurrent returns the most recent filings; output=atom gives us
    # a clean parseable feed. Form filter narrows to S-1 family.
    url = (
        "https://www.sec.gov/cgi-bin/browse-edgar"
        f"?action=getcurrent&type={form}&output=atom&count={limit}"
    )
    try:
        r = httpx.get(
            url,
            headers={
                "user-agent": UA,
                "accept-encoding": "gzip, deflate",
                "host": "www.sec.gov",
            },
            timeout=12.0,
            follow_redirects=True,
        )
        r.raise_for_status()
    except Exception as e:  # noqa: BLE001
        log.warning("edgar fetch failed (%s): %s", form, e)
        return cached[1] if cached else []

    out: list[EdgarFiling] = []
    try:
        root = ET.fromstring(r.content)
        for entry in root.findall(f"{ATOM_NS}entry"):
            title = (entry.findtext(f"{ATOM_NS}title") or "").strip()
            link_el = entry.find(f"{ATOM_NS}link")
            link = link_el.get("href") if link_el is not None else ""
            updated = (entry.findtext(f"{ATOM_NS}updated") or "").strip()
            summary = (entry.findtext(f"{ATOM_NS}summary") or "").strip()
            company, form_in_title, cik = _parse_title(title)
            out.append(
                EdgarFiling(
                    title=title,
                    company=company,
                    form=form_in_title or form,
                    cik=cik,
                    filed_at=updated,
                    url=link,
                    summary=_strip_html(summary)[:280],
                )
            )
    except ET.ParseError:
        log.warning("could not parse EDGAR atom feed")
        return cached[1] if cached else []

    _CACHE[cache_key] = (now, out)
    return out


def fetch_recent_ipo_filings(limit: int = 40) -> list[EdgarFiling]:
    """S-1 + S-1/A combined, deduped on filing URL (the EDGAR S-1 query
    also returns S-1/A entries, so we'd get every amended filing twice
    without explicit dedupe). Sorted by filed_at desc."""
    s1 = fetch_recent_filings("S-1", limit)
    s1a = fetch_recent_filings("S-1/A", limit)
    seen: set[str] = set()
    merged: list[EdgarFiling] = []
    for f in sorted(s1 + s1a, key=lambda x: x.filed_at, reverse=True):
        key = f.url or f"{f.cik}-{f.form}-{f.filed_at}"
        if key in seen:
            continue
        seen.add(key)
        merged.append(f)
        if len(merged) >= limit:
            break
    return merged


# ──────────────────────────────────────────────────────────────────────────


_TITLE_RE = re.compile(r"^\s*([A-Z\-/]+)\s+-\s+(.+?)\s+\((\d+)\)", re.IGNORECASE)


def _parse_title(title: str) -> tuple[str, str | None, str]:
    """EDGAR atom titles look like:
        "S-1 - ACME ROBOTICS INC. (0001234567) (Filer)"

    Return (company_name, form, cik). Falls back to ("", None, "") on shapes
    we don't recognise.
    """
    m = _TITLE_RE.match(title)
    if not m:
        return title, None, ""
    form = m.group(1).strip().upper()
    company = m.group(2).strip()
    cik = m.group(3).strip()
    return company, form, cik


_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(s: str) -> str:
    return _TAG_RE.sub("", s).strip()


def to_dict(f: EdgarFiling) -> dict:
    return {
        "title": f.title,
        "company": f.company,
        "form": f.form,
        "cik": f.cik,
        "filed_at": f.filed_at,
        "url": f.url,
        "summary": f.summary,
    }
