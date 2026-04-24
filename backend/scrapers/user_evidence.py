"""User-provided evidence ingestion (spec §6.6).

Tier-2 minimum: URL fetch (HTML extraction) + raw text passthrough.
Image/PDF/video come later if we have time.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from selectolax.parser import HTMLParser


@dataclass
class ExtractedEvidence:
    text: str
    title: str | None
    origin: str | None  # URL or None for pasted text


def fetch_url(url: str, timeout_s: float = 8.0, max_chars: int = 18_000) -> ExtractedEvidence:
    headers = {
        "user-agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        )
    }
    r = httpx.get(url, headers=headers, timeout=timeout_s, follow_redirects=True)
    r.raise_for_status()
    parser = HTMLParser(r.text)
    # Strip scripts/styles/nav for cleaner text
    for sel in ("script", "style", "nav", "header", "footer", "aside", "noscript"):
        for n in parser.css(sel):
            n.decompose()
    title_el = parser.css_first("title")
    title = title_el.text(strip=True) if title_el else None

    # Prefer <article>, then <main>, then body.
    container = (
        parser.css_first("article")
        or parser.css_first("main")
        or parser.body
    )
    text = container.text(separator=" ", strip=True) if container else ""
    if len(text) > max_chars:
        text = text[:max_chars] + " …[truncated]"
    return ExtractedEvidence(text=text, title=title, origin=url)


def passthrough_text(content: str, max_chars: int = 18_000) -> ExtractedEvidence:
    text = content.strip()
    if len(text) > max_chars:
        text = text[:max_chars] + " …[truncated]"
    return ExtractedEvidence(text=text, title=None, origin=None)
