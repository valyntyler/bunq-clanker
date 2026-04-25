"""Render a synthesized Report into a Bunq-themed PDF.

We use fpdf2 (pure-python, no system deps) and lay out the report by hand:
header → verdict banner → panel → personal-Bunq → analyzer modules with their
flags + top-stories links → geopolitical overlays → user sources → conflicts
→ risks → data gaps → citations / source links → disclaimer.

Output is a single bytes payload streamed back through FastAPI as a download.
"""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone

from fpdf import FPDF

from backend.models import Report

# ── Bunq palette (RGB tuples) ────────────────────────────────────────────
BG = (8, 8, 10)
SURFACE = (17, 18, 26)
SURFACE_2 = (22, 24, 32)
TEXT = (245, 247, 250)
MUTED = (138, 143, 155)
FAINT = (90, 94, 108)
GREEN = (181, 255, 0)
GREEN_DEEP = (108, 184, 0)
WARN = (255, 183, 77)
BAD = (255, 91, 107)


def _strip_md(s: str) -> str:
    """Best-effort strip of bold/italic/code markdown so the PDF stays clean."""
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"\*(.+?)\*", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    return s


def _safe(s: str | None) -> str:
    """fpdf with the default core font is latin-1 only — drop / replace
    characters it can't encode so the renderer doesn't bail mid-document."""
    if s is None:
        return ""
    s = _strip_md(s)
    # common non-latin replacements
    repl = {
        "—": "-",
        "–": "-",
        "…": "...",
        "“": '"',
        "”": '"',
        "‘": "'",
        "’": "'",
        "→": "->",
        "←": "<-",
        "↑": "^",
        "↓": "v",
        "↗": "^",
        "↘": "v",
        "·": "-",
        "•": "-",
        "✓": "v",
        "✗": "x",
        "★": "*",
        "≥": ">=",
        "≤": "<=",
        "≈": "~",
        "©": "(c)",
        "®": "(r)",
    }
    for k, v in repl.items():
        s = s.replace(k, v)
    # final pass: any remaining non-latin-1 → ASCII apostrophe
    return s.encode("latin-1", "replace").decode("latin-1")


# ── PDF builder ─────────────────────────────────────────────────────────


class ReportPDF(FPDF):
    def header(self) -> None:
        # b-monogram + wordmark
        self.set_fill_color(*GREEN)
        self.rect(15, 12, 7, 7, "F")
        self.set_text_color(8, 13, 5)
        self.set_font("Helvetica", "B", 9)
        self.set_xy(15, 12)
        self.cell(7, 7, "b", align="C")
        self.set_text_color(*GREEN)
        self.set_font("Helvetica", "B", 8)
        self.set_xy(25, 13.5)
        self.cell(0, 5, "SAURON WALLET")
        self.set_text_color(*FAINT)
        self.set_font("Helvetica", "", 7)
        self.set_xy(-60, 13.5)
        self.cell(45, 5, _safe(datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")), align="R")
        # divider
        self.set_draw_color(40, 44, 56)
        self.line(15, 24, 195, 24)
        self.set_y(30)

    def footer(self) -> None:
        self.set_y(-15)
        self.set_draw_color(40, 44, 56)
        self.line(15, self.get_y() - 1, 195, self.get_y() - 1)
        self.set_text_color(*FAINT)
        self.set_font("Helvetica", "", 7)
        self.cell(
            0,
            5,
            _safe(
                "Hackathon prototype. Not financial advice. Sandbox / paper movements only."
            ),
            align="L",
        )
        self.set_x(-25)
        self.cell(10, 5, str(self.page_no()), align="R")


def _h2(pdf: FPDF, text: str) -> None:
    pdf.set_text_color(*FAINT)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(0, 5, _safe(text.upper()), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)


def _body(pdf: FPDF, text: str, color=TEXT, size: int = 10) -> None:
    pdf.set_text_color(*color)
    pdf.set_font("Helvetica", "", size)
    pdf.multi_cell(0, 5, _safe(text), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")


def _verdict_banner(pdf: ReportPDF, report: Report) -> None:
    color_map = {"BUY": GREEN, "HOLD": WARN, "AVOID": BAD}
    bg = color_map.get(report.verdict, MUTED)
    pdf.set_fill_color(*bg)
    pdf.rect(15, pdf.get_y(), 180, 38, "F")
    pdf.set_text_color(10, 13, 5)

    pdf.set_xy(20, pdf.get_y() + 4)
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(
        0,
        4,
        _safe(f"{report.company_name}  -  {report.ticker}"),
        new_x="LMARGIN",
        new_y="NEXT",
    )

    pdf.set_x(20)
    pdf.set_font("Helvetica", "B", 28)
    pdf.cell(60, 14, _safe(report.verdict), new_x="LEFT", new_y="TOP")

    pdf.set_xy(85, pdf.get_y() + 1)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(105, 5, _safe(report.one_liner), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")

    pdf.set_xy(150, pdf.get_y() - 14)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(
        45,
        5,
        _safe(
            f"conf {int(report.confidence * 100)}%  ·  size {report.position_size_pct:.1f}%"
        ),
        align="R",
    )
    if report.consumer_panel_forecast:
        nq = report.consumer_panel_forecast.next_quarter
        pdf.set_xy(150, pdf.get_y() + 5)
        pdf.cell(
            45,
            5,
            _safe(f"Q+1 {nq.revenue_direction}  {nq.vs_consensus_pct}"),
            align="R",
        )

    pdf.set_y(pdf.get_y() + 12)
    pdf.ln(4)


def _panel(pdf: ReportPDF, report: Report) -> None:
    p = report.consumer_panel_forecast
    if not p:
        return
    _h2(pdf, "Bunq panel forecast (alt-data)")
    pdf.set_text_color(*TEXT)
    pdf.set_font("Helvetica", "B", 11)
    arrow = (
        ">"
        if p.next_quarter.revenue_direction == "in-line"
        else ("^" if p.next_quarter.revenue_direction == "beat" else "v")
    )
    pdf.cell(
        0,
        6,
        _safe(
            f"  {arrow} {p.next_quarter.vs_consensus_pct}   ·   YoY {p.yoy_change_pct:+.1f}%   ·   QoQ {p.qoq_change_pct:+.1f}%"
        ),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.set_text_color(*MUTED)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(
        0,
        5,
        _safe(
            f"  panel N {p.panel_size_n:,}  ·  hist. correlation {p.historical_correlation:.2f}  ·  conf {int(p.next_quarter.confidence * 100)}%"
        ),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    if p.merchant_aliases:
        pdf.set_text_color(*FAINT)
        pdf.cell(
            0,
            5,
            _safe(f"  matched: {', '.join(p.merchant_aliases)}"),
            new_x="LMARGIN",
            new_y="NEXT",
        )
    pdf.ln(2)
    pdf.set_text_color(*FAINT)
    pdf.set_font("Helvetica", "I", 8)
    pdf.multi_cell(0, 4, _safe(p.disclaimer), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)


def _personal_bunq(pdf: ReportPDF, report: Report) -> None:
    b = report.bunq_spending_overlay
    if not b:
        return
    _h2(pdf, "Personal Bunq spending (your conviction)")
    pdf.set_text_color(*TEXT)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(
        0,
        6,
        _safe(
            f"  EUR {b.total_spent_12m_eur:.0f}  ·  {b.visit_count} visits  ·  trend {b.trend}  ·  conviction {b.personal_conviction_score:+.2f}"
        ),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.set_text_color(*MUTED)
    pdf.set_font("Helvetica", "", 9)
    pdf.multi_cell(0, 5, _safe(f"  {b.summary}"), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")
    if b.geo_signal:
        pdf.set_text_color(*FAINT)
        pdf.cell(0, 5, _safe(f"  geo: {b.geo_signal}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)


def _sections(pdf: ReportPDF, report: Report) -> None:
    if not report.sections:
        return
    _h2(pdf, "Analyzer modules")
    for name, s in report.sections.items():
        pdf.set_text_color(*TEXT)
        pdf.set_font("Helvetica", "B", 10)
        score = s.score
        score_color = GREEN if score >= 0.3 else (BAD if score <= -0.3 else WARN)
        pdf.cell(60, 6, _safe(name.replace("_", " ").upper()))
        pdf.set_text_color(*score_color)
        pdf.cell(
            0,
            6,
            _safe(f"score {'+' if score >= 0 else ''}{score:.2f}"),
            new_x="LMARGIN",
            new_y="NEXT",
        )
        _body(pdf, s.summary, color=TEXT, size=9)
        red = (s.extra or {}).get("red_flags") or []
        green = (s.extra or {}).get("green_flags") or []
        events = (s.extra or {}).get("material_events") or []
        for it in red:
            pdf.set_text_color(*BAD)
            pdf.set_font("Helvetica", "", 8)
            pdf.multi_cell(0, 4, _safe(f"  - {it}"), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")
        for it in green:
            pdf.set_text_color(*GREEN_DEEP)
            pdf.set_font("Helvetica", "", 8)
            pdf.multi_cell(0, 4, _safe(f"  + {it}"), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")
        for it in events:
            pdf.set_text_color(*WARN)
            pdf.set_font("Helvetica", "", 8)
            pdf.multi_cell(0, 4, _safe(f"  ! {it}"), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")

        # Top news stories with URLs
        top_stories = (s.extra or {}).get("top_stories") or []
        for story in top_stories:
            pdf.set_text_color(*MUTED)
            pdf.set_font("Helvetica", "B", 8)
            pdf.multi_cell(0, 4, _safe(f"  > {story.get('title', '')}"), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")
            url = story.get("url")
            if url:
                pdf.set_text_color(*GREEN_DEEP)
                pdf.set_font("Helvetica", "U", 7)
                pdf.cell(
                    0,
                    4,
                    _safe(f"    {story.get('source', '')}  {url}"),
                    new_x="LMARGIN",
                    new_y="NEXT",
                    link=url,
                )

        # Reference links
        links = (s.extra or {}).get("links") or []
        for link in links:
            pdf.set_text_color(*GREEN_DEEP)
            pdf.set_font("Helvetica", "U", 8)
            pdf.cell(
                0,
                4,
                _safe(f"  -> {link['label']}: {link['url']}"),
                new_x="LMARGIN",
                new_y="NEXT",
                link=link["url"],
            )
        pdf.ln(2)
    pdf.ln(2)


def _geopolitical(pdf: ReportPDF, report: Report) -> None:
    if not report.geopolitical_overlays:
        return
    _h2(pdf, "Geopolitical overlays")
    for o in report.geopolitical_overlays:
        pdf.set_text_color(*TEXT)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 6, _safe(o.speaker), new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(*MUTED)
        pdf.set_font("Helvetica", "", 8)
        pdf.cell(
            0,
            4,
            _safe(
                f"  rel {o.relevance:.2f}  ·  impact {o.impact_direction:+d} x {o.impact_magnitude:.2f}  ·  {o.event_id}"
            ),
            new_x="LMARGIN",
            new_y="NEXT",
        )
        _body(pdf, o.reasoning, color=TEXT, size=9)
        if o.transcript_excerpt:
            pdf.set_text_color(*FAINT)
            pdf.set_font("Helvetica", "I", 8)
            pdf.multi_cell(0, 4, _safe(f'  "{o.transcript_excerpt}"'), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")
        if o.tone_notes:
            pdf.set_text_color(*MUTED)
            pdf.set_font("Helvetica", "", 8)
            pdf.multi_cell(0, 4, _safe(f"  tone: {o.tone_notes}"), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")
        if o.visual_notes:
            pdf.multi_cell(0, 4, _safe(f"  visual: {o.visual_notes}"), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")
        if o.source_url:
            pdf.set_text_color(*GREEN_DEEP)
            pdf.set_font("Helvetica", "U", 8)
            pdf.cell(
                0,
                4,
                _safe(f"  source: {o.source_url}"),
                new_x="LMARGIN",
                new_y="NEXT",
                link=o.source_url,
            )
        if o.clip_url:
            pdf.set_text_color(*GREEN_DEEP)
            pdf.set_font("Helvetica", "U", 8)
            pdf.cell(
                0,
                4,
                _safe(f"  clip: {o.clip_url[:80]}..."),
                new_x="LMARGIN",
                new_y="NEXT",
                link=o.clip_url,
            )
        pdf.ln(2)
    pdf.ln(2)


def _user_sources(pdf: ReportPDF, report: Report) -> None:
    if not report.user_sources:
        return
    _h2(pdf, "User-provided sources")
    for u in report.user_sources:
        pdf.set_text_color(*TEXT)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(
            0,
            6,
            _safe(f"{u.source_type.upper()}  ·  {u.user_tag}  ·  trust {u.trust_level}"),
            new_x="LMARGIN",
            new_y="NEXT",
        )
        if u.user_note:
            pdf.set_text_color(*FAINT)
            pdf.set_font("Helvetica", "I", 8)
            pdf.multi_cell(0, 4, _safe(f'  "{u.user_note}"'), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")
        _body(pdf, u.summary, color=TEXT, size=9)
        if u.origin:
            pdf.set_text_color(*GREEN_DEEP)
            pdf.set_font("Helvetica", "U", 8)
            pdf.cell(
                0,
                4,
                _safe(f"  origin: {u.origin[:90]}{'...' if len(u.origin) > 90 else ''}"),
                new_x="LMARGIN",
                new_y="NEXT",
                link=u.origin,
            )
        pdf.ln(2)
    pdf.ln(2)


def _bullet_section(pdf: ReportPDF, title: str, items: list[str], color=TEXT) -> None:
    if not items:
        return
    _h2(pdf, title)
    pdf.set_text_color(*color)
    pdf.set_font("Helvetica", "", 9)
    for it in items:
        pdf.multi_cell(0, 5, _safe(f"  - {it}"), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)


def render_report_pdf(report: Report) -> bytes:
    pdf = ReportPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()
    pdf.set_left_margin(15)
    pdf.set_right_margin(15)

    _verdict_banner(pdf, report)
    _panel(pdf, report)
    _personal_bunq(pdf, report)
    _sections(pdf, report)
    _geopolitical(pdf, report)
    _user_sources(pdf, report)
    _bullet_section(pdf, "Module disagreements (conflicts)", report.conflicts, color=WARN)
    _bullet_section(pdf, "Risks", report.risks, color=TEXT)
    _bullet_section(pdf, "Data gaps", report.data_gaps, color=MUTED)

    # Citations
    if report.citations:
        _h2(pdf, "Citations")
        for c in report.citations:
            pdf.set_text_color(*MUTED)
            pdf.set_font("Helvetica", "", 8)
            line = f"[{c.id}] {c.title}"
            if c.url:
                pdf.set_text_color(*GREEN_DEEP)
                pdf.set_font("Helvetica", "U", 8)
                pdf.cell(
                    0,
                    4,
                    _safe(f"  - {line}  {c.url}"),
                    new_x="LMARGIN",
                    new_y="NEXT",
                    link=c.url,
                )
            else:
                pdf.cell(0, 4, _safe(f"  - {line}"), new_x="LMARGIN", new_y="NEXT")

    pdf.ln(4)
    pdf.set_text_color(*FAINT)
    pdf.set_font("Helvetica", "I", 7)
    pdf.multi_cell(0, 4, _safe(report.disclaimer), wrapmode="CHAR", new_x="LMARGIN", new_y="NEXT")

    buf = io.BytesIO()
    pdf.output(buf)
    return buf.getvalue()
