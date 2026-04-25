"""User-uploaded PDF analyzer (analyst notes, research reports).

Extracts text via PyMuPDF, runs the existing user_text analyzer with the
extracted content, attaches the PDF presigned URL as the source origin.
"""

from __future__ import annotations

import io
import logging
import uuid
from typing import Literal

from backend.analyzers.user_text import analyze_user_text
from backend.aws import put_and_sign
from backend.models import UserSource

log = logging.getLogger("prospectus.user_pdf")

UserTag = Literal["supporting", "contradicting", "neutral"]


def analyze_user_pdf(
    *,
    ticker: str,
    company_name: str | None,
    pdf_bytes: bytes,
    user_note: str = "",
    user_tag: UserTag = "neutral",
    filename: str | None = None,
    on_step=None,
) -> UserSource:
    def _step(name: str, status: str, detail: dict | None = None) -> None:
        if on_step is not None:
            try:
                on_step(name, status, detail)
            except Exception:
                pass

    sid = f"user-{uuid.uuid4().hex[:8]}"
    _step("upload", "running")
    pdf_url = put_and_sign(
        f"user-evidence/{sid}.pdf",
        pdf_bytes,
        content_type="application/pdf",
        expires_s=7 * 24 * 3600,
    )
    _step("upload", "done", {"bytes": len(pdf_bytes)})

    _step("pdf_extract", "running")
    text = _extract_text(pdf_bytes)
    _step("pdf_extract", "done", {"chars": len(text)})
    if not text.strip():
        # Empty PDF — return a minimal source rather than 500ing
        return UserSource(
            source_id=sid,
            source_type="pdf",
            origin=pdf_url,
            user_note=user_note,
            user_tag=user_tag,
            score=0.0,
            summary="PDF uploaded but no extractable text (likely image-only).",
            key_claims=[],
            trust_level="low",
        )

    _step("text_analyze", "running")
    src = analyze_user_text(
        ticker=ticker,
        company_name=company_name,
        text=text,
        title=filename,
        origin=pdf_url,
        user_note=user_note,
        user_tag=user_tag,
        source_type="pdf",
    )
    _step("text_analyze", "done")
    # Override source_id + origin to match the PDF artefact instead of the text wrapper
    src.source_id = sid
    src.origin = pdf_url
    return src


def _extract_text(pdf_bytes: bytes, max_pages: int = 30, max_chars: int = 30_000) -> str:
    try:
        import pymupdf  # type: ignore[import-not-found]
    except ImportError:
        try:
            import fitz as pymupdf  # type: ignore[import-not-found, no-redef]
        except ImportError:
            log.exception("PyMuPDF not installed — pip install pymupdf")
            return ""

    parts: list[str] = []
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        for i, page in enumerate(doc):
            if i >= max_pages:
                parts.append("\n[…truncated additional pages…]")
                break
            t = page.get_text("text") or ""
            parts.append(t.strip())
    text = "\n\n".join(p for p in parts if p)
    if len(text) > max_chars:
        text = text[:max_chars] + " […truncated]"
    return text
