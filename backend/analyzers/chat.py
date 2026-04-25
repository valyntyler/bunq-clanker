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
    """Streaming chat with tool-use loop.

    Yields events as dicts so the SSE caller can paint progress, not just
    text:
        {'type': 'token',        'text': '...'}            — Claude text delta
        {'type': 'tool_call',    'name': str,   'announce': str, 'input': dict}
        {'type': 'tool_result',  'name': str,   'sources': list[dict]}
        {'type': 'done'}                                   — final stop

    Tools available: search_news, web_search, fetch_quote, fetch_panel_data.
    Loop terminates when Claude stops with end_turn (no more tool calls).
    Hard cap of 4 tool-call rounds to bound latency + cost.
    """
    from backend.services.chat_tools import (
        TOOL_DEFINITIONS,
        execute_tool,
        ui_announce,
    )

    system = build_system_prompt(report) + (
        "\n\n=== Live tools ===\n"
        "When the user asks something the static report can't answer "
        "(latest news, current price, fresh panel data, web facts), call "
        "one of the tools. ALWAYS write a brief one-sentence message "
        "BEFORE calling a tool ('let me check the latest news on …', "
        "'one sec — pulling a live quote'), so the user knows why there's "
        "a pause. AFTER the tool returns, continue the answer naturally, "
        "weaving in the new info."
    )

    messages: list[dict] = []
    for t in history:
        messages.append({"role": t.role, "content": t.content})
    messages.append({"role": "user", "content": user_message})

    bedrock = boto3.client("bedrock-runtime", region_name=_REGION)
    import json

    for round_idx in range(4):
        resp = bedrock.invoke_model_with_response_stream(
            modelId=_BEDROCK_MODEL,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(
                {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 1200,
                    "temperature": 0.4,
                    "system": system,
                    "messages": messages,
                    "tools": TOOL_DEFINITIONS,
                }
            ),
        )

        # Reconstruct the assistant turn from the streamed deltas so we
        # can echo it back as a `messages` entry on the next round.
        assistant_blocks: list[dict] = []
        # Per-block staging — Bedrock streams blocks one at a time.
        cur_block: dict | None = None
        cur_text: list[str] = []
        cur_tool_input_json: list[str] = []
        stop_reason: str | None = None

        for ev in resp["body"]:
            chunk = ev.get("chunk")
            if not chunk:
                continue
            data = json.loads(chunk["bytes"])
            t = data.get("type")
            if t == "content_block_start":
                cb = data.get("content_block") or {}
                cur_block = {**cb}
                cur_text = []
                cur_tool_input_json = []
            elif t == "content_block_delta":
                delta = data.get("delta") or {}
                dt = delta.get("type")
                if dt == "text_delta":
                    text = delta.get("text", "")
                    cur_text.append(text)
                    if text:
                        yield {"type": "token", "text": text}
                elif dt == "input_json_delta":
                    cur_tool_input_json.append(delta.get("partial_json", ""))
            elif t == "content_block_stop":
                if cur_block is None:
                    continue
                if cur_block.get("type") == "text":
                    assistant_blocks.append(
                        {"type": "text", "text": "".join(cur_text)}
                    )
                elif cur_block.get("type") == "tool_use":
                    raw_input = "".join(cur_tool_input_json) or "{}"
                    try:
                        input_obj = json.loads(raw_input)
                    except Exception:  # noqa: BLE001
                        input_obj = {}
                    assistant_blocks.append(
                        {
                            "type": "tool_use",
                            "id": cur_block.get("id"),
                            "name": cur_block.get("name"),
                            "input": input_obj,
                        }
                    )
                cur_block = None
                cur_text = []
                cur_tool_input_json = []
            elif t == "message_delta":
                stop_reason = (data.get("delta") or {}).get("stop_reason")
            elif t == "message_stop":
                pass

        # Append the assistant turn to message history.
        messages.append({"role": "assistant", "content": assistant_blocks})

        if stop_reason != "tool_use":
            yield {"type": "done"}
            return

        # Execute every tool_use block, append tool_result back as a user turn.
        tool_results: list[dict] = []
        for blk in assistant_blocks:
            if blk.get("type") != "tool_use":
                continue
            name = blk.get("name") or ""
            input_obj = blk.get("input") or {}
            yield {
                "type": "tool_call",
                "name": name,
                "input": input_obj,
                "announce": ui_announce(name, input_obj),
            }
            text, meta = execute_tool(name, input_obj)
            yield {
                "type": "tool_result",
                "name": name,
                "sources": meta.get("sources", []),
            }
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": blk.get("id"),
                    "content": text,
                }
            )
        if not tool_results:
            yield {"type": "done"}
            return
        messages.append({"role": "user", "content": tool_results})

    # Hard cap reached.
    yield {"type": "done"}
