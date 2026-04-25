"""Trusted-outlet allowlist for news + geopolitical analysis.

Boosts items from established financial-press / wire-service domains so
Claude reasons from better-sourced material first. Doesn't filter out the
long tail — both lists pass through, trusted ones just sort first.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

# Domains we treat as trusted financial / political wire services.
# Match is host-suffix based (so "uk.reuters.com" matches "reuters.com").
TRUSTED_DOMAINS: set[str] = {
    # global wires
    "reuters.com",
    "apnews.com",
    "bloomberg.com",
    "ft.com",
    "wsj.com",
    "nytimes.com",
    "washingtonpost.com",
    "economist.com",
    # finance / business press
    "cnbc.com",
    "barrons.com",
    "marketwatch.com",
    "yahoo.com",         # yahoo finance
    "morningstar.com",
    "investopedia.com",
    "axios.com",
    "politico.com",
    "politico.eu",
    "theguardian.com",
    "bbc.com",
    "bbc.co.uk",
    # EU / NL focus
    "euronews.com",
    "euractiv.com",
    "nltimes.nl",
    "dutchnews.nl",
    "iex.nl",
    # central banks / regulators (they're their own primary source)
    "ecb.europa.eu",
    "federalreserve.gov",
    "sec.gov",
    "treasury.gov",
    "bankofengland.co.uk",
    "europa.eu",
    "ec.europa.eu",
}


_HOST_RE = re.compile(r"^(?:https?://)?([^/]+)", re.IGNORECASE)


def _hostname(url_or_host: str) -> str:
    if not url_or_host:
        return ""
    # try urlparse first; fall back to regex if missing scheme
    try:
        parsed = urlparse(url_or_host)
        host = parsed.netloc or parsed.path
    except Exception:  # noqa: BLE001
        host = url_or_host
    if not host:
        m = _HOST_RE.match(url_or_host)
        host = m.group(1) if m else url_or_host
    return host.lower().lstrip("www.")


def is_trusted(url_or_host: str) -> bool:
    """True if the URL's host (or any suffix of it) appears in the
    trusted-outlet allowlist."""
    host = _hostname(url_or_host)
    if not host:
        return False
    parts = host.split(".")
    for i in range(len(parts) - 1):
        suffix = ".".join(parts[i:])
        if suffix in TRUSTED_DOMAINS:
            return True
    return False


def boost(items: list, key: str = "url") -> list:
    """Return a list with trusted items first, in their original relative order;
    untrusted items follow, also stable. `key` selects the URL attribute.

    Works on both dicts and dataclass-like objects with a `.<key>` attr.
    """
    def get_url(it) -> str:
        if isinstance(it, dict):
            return it.get(key) or ""
        return getattr(it, key, "") or ""

    trusted = [it for it in items if is_trusted(get_url(it))]
    rest = [it for it in items if not is_trusted(get_url(it))]
    return trusted + rest
