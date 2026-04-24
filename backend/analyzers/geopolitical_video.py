"""Geopolitical *video* analyzer.

Reads the pre-seeded clip registry (transcript + prosody features + frame-grid
PNG in S3), and for each clip asks Claude Sonnet 4 (vision) to score the
clip's market-relevance to the target ticker. Multimodal in the strict sense:
text transcript + visual frame grid + prosody numbers go in the same prompt.

If no clips are cached, returns an empty list silently — the text-based
geopolitical analyzer covers the ticker either way.

The analyzer caches per (event_id, ticker) so repeat /analyze calls reuse
the same Claude judgement rather than burning tokens.
"""

from __future__ import annotations

import asyncio
import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx

from backend.llm import call_claude_json
from backend.models import GeopoliticalOverlay

log = logging.getLogger("prospectus.geopolitical_video")

REGISTRY_PATH = (
    Path(__file__).resolve().parent.parent / "fixtures" / "clips_registry.json"
)

SYSTEM = (
    "You are an equity analyst evaluating whether a recent public statement "
    "from a political or central-bank figure is materially relevant to a "
    "specific stock. Multimodal inputs: transcript, prosody numbers (pitch / "
    "energy / pauses), and a 3x3 grid of frames sampled across the clip.\n"
    "\n"
    "Hard ethical rules: "
    "(1) Strictly OBSERVATIONAL — describe what is visibly or audibly "
    "present. Never psychoanalyze, never claim hidden motives, never characterize "
    "intent. The reader infers; you observe. "
    "(2) Reason about market implications ONLY. No political commentary, no "
    "partisan framing. "
    "(3) Cite specific quotes from the transcript for claims about what was said. "
    "(4) Skip events with relevance < 0.3.\n"
    "\n"
    "Look for these OBSERVABLE patterns and only report them if present:\n"
    "  TRANSCRIPT (NLP):\n"
    "    - Hedging markers: 'could', 'may', 'depending on', 'we'll have to see', "
    "'it's too early to'\n"
    "    - Certainty markers: 'definitely', 'absolutely', 'will', 'guaranteed'\n"
    "    - Deflection / pivot: rapid topic change, reframing the question\n"
    "    - Emphasis: word repetition, qualifying-then-doubling-down patterns\n"
    "  PROSODY (audio numbers):\n"
    "    - Low pitch variance (std < 30 Hz) → measured / scripted delivery\n"
    "    - High RMS std → emphasis spikes, possibly emotional weight\n"
    "    - High silence_fraction (> 0.3) → deliberate pauses / hesitation\n"
    "  FRAMES (vision):\n"
    "    - Posture: upright vs forward-leaning vs slouched\n"
    "    - Gesture intensity: hand visibility, motion across frames\n"
    "    - Gaze direction: at camera vs off to notes vs sideways\n"
    "    - Setting: podium / studio / outdoor / informal\n"
    "\n"
    "Synthesize what they SAID, how they said it, and what they observably "
    "AVOIDED saying — without crossing into mind-reading."
)


def _load_registry() -> list[dict]:
    if not REGISTRY_PATH.exists():
        return []
    try:
        return json.loads(REGISTRY_PATH.read_text()).get("clips", [])
    except Exception:  # noqa: BLE001
        log.exception("failed to read clips registry")
        return []


@lru_cache(maxsize=128)
def _fetch_grid_bytes(url: str) -> bytes:
    """Fetch presigned frame-grid PNG once and cache."""
    return httpx.get(url, timeout=15).content


@lru_cache(maxsize=512)
def _analyze_one(event_id: str, ticker: str, company_name_hint: str = "") -> str | None:
    """Returns JSON string or None if analyzer skipped / failed."""
    registry = _load_registry()
    clip = next((c for c in registry if c["event_id"] == event_id), None)
    if clip is None:
        return None

    try:
        grid_bytes = _fetch_grid_bytes(clip["frame_grid_url"])
    except Exception:  # noqa: BLE001
        log.warning("could not fetch frame grid for %s — falling back to text-only", event_id)
        grid_bytes = b""

    prosody = clip.get("prosody") or {}
    user = f"""Evaluate clip for relevance to ticker {ticker}{f' ({company_name_hint})' if company_name_hint else ''}.

Speaker:    {clip.get('speaker', 'unknown')}
Title:      {clip.get('title', '')}
Duration:   {clip.get('duration_s', '?')}s
Source:     {clip.get('source_url', '')}

Transcript:
\"\"\"{clip.get('transcript', '').strip()}\"\"\"

Prosody (audio numbers):
  pitch_mean_hz   = {prosody.get('pitch_mean_hz')}
  pitch_std_hz    = {prosody.get('pitch_std_hz')}
  rms_mean        = {prosody.get('rms_mean')}
  rms_std         = {prosody.get('rms_std')}
  silence_fraction= {prosody.get('silence_fraction')}

The attached image is a 3x3 grid of frames sampled evenly through the clip.

Return STRICT JSON:
{{
  "relevance":         number 0..1,
  "impact_direction":  -1 | 0 | 1,
  "impact_magnitude":  number 0..1,
  "reasoning":         "one-sentence market implication for {ticker}",
  "transcript_excerpt":"the most material clause (verbatim, <=200 chars)",
  "tone_notes":        "<=140 chars interpreting prosody",
  "visual_notes":      "<=140 chars describing what is visibly on screen — observable only"
}}
"""
    images = [grid_bytes] if grid_bytes else []
    out = call_claude_json(user, system=SYSTEM, images=images, max_tokens=600)
    return json.dumps(out)


async def _analyze_one_async(
    event_id: str, ticker: str, company_name_hint: str = ""
) -> dict | None:
    raw = await asyncio.to_thread(_analyze_one, event_id, ticker, company_name_hint)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def analyze_geopolitical_video(
    *,
    ticker: str,
    company_name: str | None = None,
    sector: str | None = None,
    max_overlays: int = 3,
) -> list[GeopoliticalOverlay]:
    registry = _load_registry()
    if not registry:
        return []

    hint = company_name or ""

    tasks = [
        _analyze_one_async(c["event_id"], ticker.upper(), hint) for c in registry
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    overlays: list[GeopoliticalOverlay] = []
    for clip, res in zip(registry, results):
        if isinstance(res, BaseException) or res is None:
            continue
        try:
            relevance = float(res.get("relevance", 0))
            if relevance < 0.3:
                continue
            overlays.append(
                GeopoliticalOverlay(
                    event_id=clip["event_id"],
                    speaker=clip.get("speaker", "unknown"),
                    clip_url=clip.get("clip_url"),
                    relevance=relevance,
                    impact_direction=int(res.get("impact_direction", 0)),
                    impact_magnitude=float(res.get("impact_magnitude", 0)),
                    transcript_excerpt=res.get("transcript_excerpt", "")[:240],
                    tone_notes=res.get("tone_notes", "")[:200],
                    visual_notes=res.get("visual_notes", "")[:200],
                    reasoning=res.get("reasoning", ""),
                )
            )
        except (TypeError, ValueError, KeyError):
            continue

    overlays.sort(key=lambda o: (o.relevance * (1 + o.impact_magnitude)), reverse=True)
    return overlays[:max_overlays]
