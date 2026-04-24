"""Grounded multi-turn chat about a synthesized report.

The user's existing Report (verdict, sections, panel, geopolitical overlays,
personal Bunq, user sources, conflicts, risks) is serialized into the system
prompt as the analyst's working memory. Claude answers with explicit module
citations and refuses to invent financial figures it doesn't have.
"""

from __future__ import annotations

import os

import boto3

from backend.models import ChatTurn, Report

_BEDROCK_MODEL = os.getenv(
    "BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0"
)
_REGION = os.getenv("AWS_REGION", "us-east-1")

SYSTEM_TEMPLATE = """\
You are a sober equity-analyst assistant chatting with a user about a specific
investment idea you have already analyzed. Your knowledge of this analysis is
provided below — do not invent figures or modules that aren't there.

Conversation rules:
1. Cite modules in brackets when you reference findings: [fundamentals],
   [news], [chart], [panel], [bunq_spending], [geopolitical:event_id],
   [user:source_id]. The user has seen these.
2. If the user asks for a number you don't have, say so plainly. Don't make
   up financial figures.
3. If the user asks "what would change your mind", be specific: name the
   metric or event and the threshold.
4. Keep replies short — 2 to 5 sentences typically. The user is reading on
   a phone-sized panel.
5. The disagreements between modules ARE the alpha — don't smooth them over.
6. Respect the spec's ethical rules on geopolitical overlays: observable
   behaviour only, market-implications only, no character judgement.
7. This is not financial advice. If asked for personal investment guidance,
   redirect to risk-tolerance / time-horizon questions.

=== current synthesized report for {ticker} ({company_name}) ===

VERDICT: {verdict}  ·  confidence {confidence}  ·  position size {position_size}%
ONE-LINER: {one_liner}

SECTIONS (Claude-scored modules):
{sections_block}

{panel_block}
{bunq_block}
{geopolitical_block}
{user_sources_block}

CONFLICTS (module disagreements — feature, not bug):
{conflicts_block}

RISKS:
{risks_block}

DATA GAPS:
{gaps_block}
"""


def _format_sections(report: Report) -> str:
    lines = []
    for name, s in report.sections.items():
        lines.append(f"  [{name}] score={s.score:+.2f} — {s.summary}")
        red = s.extra.get("red_flags") if s.extra else None
        green = s.extra.get("green_flags") if s.extra else None
        if red:
            lines.append("    red: " + " | ".join(red))
        if green:
            lines.append("    green: " + " | ".join(green))
    return "\n".join(lines) or "  (none)"


def _format_panel(report: Report) -> str:
    p = report.consumer_panel_forecast
    if not p:
        return "PANEL: not covered for this ticker."
    return (
        f"PANEL: N={p.panel_size_n} · YoY {p.yoy_change_pct:+.1f}% · "
        f"QoQ {p.qoq_change_pct:+.1f}% · trend={p.trend} · "
        f"hist_corr={p.historical_correlation:.2f} · "
        f"next-quarter direction={p.next_quarter.revenue_direction} "
        f"vs consensus {p.next_quarter.vs_consensus_pct} (conf {p.next_quarter.confidence})"
    )


def _format_bunq(report: Report) -> str:
    b = report.bunq_spending_overlay
    if not b:
        return "PERSONAL BUNQ: no merchant matches for this ticker."
    return (
        f"PERSONAL BUNQ: €{b.total_spent_12m_eur:.0f} across {b.visit_count} visits, "
        f"trend={b.trend} · conviction={b.personal_conviction_score:+.2f} · {b.summary}"
    )


def _format_geopolitical(report: Report) -> str:
    if not report.geopolitical_overlays:
        return "GEOPOLITICAL OVERLAYS: none above relevance threshold."
    out = ["GEOPOLITICAL OVERLAYS:"]
    for o in report.geopolitical_overlays:
        out.append(
            f"  [geopolitical:{o.event_id}] {o.speaker} · rel={o.relevance:.2f} · "
            f"impact {o.impact_direction:+d}*{o.impact_magnitude:.2f}"
        )
        out.append(f"    reasoning: {o.reasoning}")
        if o.tone_notes:
            out.append(f"    tone: {o.tone_notes}")
        if o.visual_notes:
            out.append(f"    visual: {o.visual_notes}")
    return "\n".join(out)


def _format_user_sources(report: Report) -> str:
    if not report.user_sources:
        return "USER SOURCES: none added yet."
    out = ["USER SOURCES (capped at 20% weight):"]
    for u in report.user_sources:
        out.append(
            f"  [user:{u.source_id}] type={u.source_type} · tag={u.user_tag} · "
            f"trust={u.trust_level} · score={u.score:+.2f}"
        )
        out.append(f"    {u.summary}")
    return "\n".join(out)


def _bullet_list(items: list[str], empty: str = "  (none)") -> str:
    return "\n".join(f"  · {x}" for x in items) if items else empty


def build_system_prompt(report: Report) -> str:
    return SYSTEM_TEMPLATE.format(
        ticker=report.ticker,
        company_name=report.company_name,
        verdict=report.verdict,
        confidence=f"{report.confidence:.2f}",
        position_size=f"{report.position_size_pct:.1f}",
        one_liner=report.one_liner,
        sections_block=_format_sections(report),
        panel_block=_format_panel(report),
        bunq_block=_format_bunq(report),
        geopolitical_block=_format_geopolitical(report),
        user_sources_block=_format_user_sources(report),
        conflicts_block=_bullet_list(report.conflicts),
        risks_block=_bullet_list(report.risks),
        gaps_block=_bullet_list(report.data_gaps),
    )


def chat_once(report: Report, history: list[ChatTurn], user_message: str) -> str:
    """Single-turn chat completion. Stateless; the caller passes back history
    each turn."""
    system = build_system_prompt(report)
    messages: list[dict] = []
    for t in history:
        messages.append({"role": t.role, "content": t.content})
    messages.append({"role": "user", "content": user_message})

    bedrock = boto3.client("bedrock-runtime", region_name=_REGION)
    import json

    resp = bedrock.invoke_model(
        modelId=_BEDROCK_MODEL,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 800,
                "temperature": 0.4,
                "system": system,
                "messages": messages,
            }
        ),
    )
    out = json.loads(resp["body"].read())
    return out["content"][0]["text"]


def chat_stream(report: Report, history: list[ChatTurn], user_message: str):
    """SSE-friendly streaming variant. Yields plain text chunks as Claude
    emits them — the caller wraps each chunk into an SSE 'token' event."""
    system = build_system_prompt(report)
    messages: list[dict] = []
    for t in history:
        messages.append({"role": t.role, "content": t.content})
    messages.append({"role": "user", "content": user_message})

    bedrock = boto3.client("bedrock-runtime", region_name=_REGION)
    import json

    resp = bedrock.invoke_model_with_response_stream(
        modelId=_BEDROCK_MODEL,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 800,
                "temperature": 0.4,
                "system": system,
                "messages": messages,
            }
        ),
    )
    for ev in resp["body"]:
        chunk = ev.get("chunk")
        if not chunk:
            continue
        data = json.loads(chunk["bytes"])
        if data.get("type") == "content_block_delta":
            delta = data.get("delta", {})
            if delta.get("type") == "text_delta":
                yield delta.get("text", "")
