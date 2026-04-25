"""Live earnings-call co-pilot.

Pipeline (yields events at every stage so the SSE consumer can paint
progress in real time, not just spin):

  1. yt-dlp grabs the audio track of the YouTube earnings call URL.
  2. AWS Transcribe runs a single batch job (poll every 3s, emit progress).
  3. The full transcript gets split into ~250-word windows.
  4. Each window is sent to Claude in sequence. The scorer maintains a
     short rolling context (last 2 windows' scores) so it can flag
     sentiment SHIFTS, not just per-window sentiment in isolation.
  5. A final summary call rolls everything up.

The 'live' framing for the demo is honest: the transcribe step is a one-
time batch cost, but the analysis itself streams chunk-by-chunk so the
user sees the call being read in real time.

Yields events shaped as plain dicts for direct SSE serialization:

  {step: "yt_dlp",      status: "running"|"done"|"error", detail?: dict}
  {step: "transcribe",  status: "running"|"done"|"error", detail?: dict}
  {step: "scoring",     status: "running",                detail: {chunk_index, of}}
  {chunk: {...ChunkScore...}}
  {summary: {...}}
  {error: str}
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, Iterator

import boto3
import httpx

from backend.aws import BUCKET, REGION, put_bytes
from backend.llm import call_claude_json
from backend.scrapers.geopolitical_clips import extract_audio_wav

log = logging.getLogger("prospectus.earnings_copilot")


@dataclass
class ChunkScore:
    index: int
    text: str
    tone: str           # "confident" | "defensive" | "hedging" | "neutral" | "concerned" | "bullish"
    score: float        # -1..1 (negative = bearish/defensive, positive = bullish/confident)
    hedging: list[str]  # short strings, e.g. ["we'll see how Q3 plays out", "macro is uncertain"]
    commitments: list[str]
    key_topics: list[str]
    shift: str          # "↑bullish" | "↓bearish" | "stable" | "" (relative to running average)
    shift_reason: str   # one short sentence explaining the shift, "" if stable


# ---------------------------------------------------------------------------
# yt-dlp + audio extraction (re-uses the geopolitical helpers)
# ---------------------------------------------------------------------------


def _download_full_audio(url: str, out_dir: Path) -> Path:
    """Download the best audio of an arbitrary YouTube URL — full length, no
    segment trimming. Returns a local .wav path ready for Transcribe."""
    if not shutil.which("yt-dlp"):
        raise RuntimeError("yt-dlp not on PATH")
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not on PATH")

    out_dir.mkdir(parents=True, exist_ok=True)
    mp4 = out_dir / f"call-{uuid.uuid4().hex[:8]}.mp4"
    # bestaudio[ext=m4a] / bestaudio is fast to download (no video re-mux).
    import subprocess
    args = [
        "yt-dlp",
        "-f", "bestaudio/best",
        "-o", str(mp4),
        "--no-playlist",
        "--quiet",
        "--no-warnings",
        url,
    ]
    p = subprocess.run(args, capture_output=True, text=True, timeout=600)
    if p.returncode != 0 or not mp4.exists():
        raise RuntimeError(f"yt-dlp failed: {p.stderr[:300]}")
    wav = out_dir / f"{mp4.stem}.wav"
    extract_audio_wav(mp4, wav)
    return wav


# ---------------------------------------------------------------------------
# AWS Transcribe — full file, polled with progress
# ---------------------------------------------------------------------------


def _transcribe_full(audio_s3_uri: str, on_poll=None) -> str:
    client = boto3.client("transcribe", region_name=REGION)
    job_name = f"sauron-call-{uuid.uuid4().hex[:10]}"
    client.start_transcription_job(
        TranscriptionJobName=job_name,
        Media={"MediaFileUri": audio_s3_uri},
        MediaFormat="wav",
        LanguageCode="en-US",
    )
    log.info("transcribe job %s submitted", job_name)
    polls = 0
    while True:
        time.sleep(3)
        polls += 1
        j = client.get_transcription_job(TranscriptionJobName=job_name)
        status = j["TranscriptionJob"]["TranscriptionJobStatus"]
        if on_poll:
            on_poll({"poll": polls, "status": status})
        if status == "COMPLETED":
            uri = j["TranscriptionJob"]["Transcript"]["TranscriptFileUri"]
            data = httpx.get(uri, timeout=30).json()
            return data["results"]["transcripts"][0]["transcript"]
        if status == "FAILED":
            raise RuntimeError(
                j["TranscriptionJob"].get("FailureReason", "transcribe failed")
            )


# ---------------------------------------------------------------------------
# Chunking + scoring
# ---------------------------------------------------------------------------


def _word_chunks(text: str, words_per_chunk: int = 220) -> Iterator[str]:
    words = text.split()
    if not words:
        return
    for i in range(0, len(words), words_per_chunk):
        yield " ".join(words[i : i + words_per_chunk])


_SCORE_SYSTEM = (
    "You are a sober equity analyst listening to an earnings call as it is "
    "read out chunk by chunk. For each new chunk, you score the speaker's "
    "tone, surface hedging language and commitments, and — crucially — flag "
    "SHIFTS relative to the rolling baseline you've been building. Be "
    "calibrated. Hedging is normal in earnings calls; only call it out when "
    "it's elevated or topic-specific. Score is -1..+1: negative = "
    "defensive/concerned, positive = confident/bullish, zero = neutral."
)


def _score_chunk(
    ticker: str,
    company: str,
    chunk_index: int,
    total_chunks: int,
    chunk_text: str,
    rolling_avg: float | None,
    last_topics: list[str],
) -> ChunkScore:
    user = f"""Ticker: {ticker}
Company: {company}
Chunk {chunk_index + 1} of {total_chunks}.
Rolling average score (so far): {rolling_avg if rolling_avg is not None else 'n/a'}
Recent topics: {', '.join(last_topics) or 'none yet'}

CHUNK:
\"\"\"
{chunk_text}
\"\"\"

Return STRICT JSON:
{{
  "tone":         "confident | defensive | hedging | neutral | concerned | bullish",
  "score":        -1..1,
  "hedging":      [short strings],
  "commitments":  [short strings — concrete promises about timelines, numbers, products],
  "key_topics":   [<=4 short topic strings present in this chunk],
  "shift":        "↑bullish" | "↓bearish" | "stable" | "",
  "shift_reason": "one sentence — empty string when stable"
}}

Rules:
- shift compares the current chunk to the rolling baseline. If the
  baseline isn't established yet (chunk_index < 2), set shift="" and
  shift_reason="".
- hedging items should be paraphrases from the chunk, not direct quotes
  unless the phrasing itself is the signal.
- Drop empty / noisy chunks (e.g. operator boilerplate "the next question
  is from..." with no content): tone="neutral", score=0, all arrays [].
"""
    raw = call_claude_json(user, system=_SCORE_SYSTEM, max_tokens=700)
    return ChunkScore(
        index=chunk_index,
        text=chunk_text,
        tone=(raw.get("tone") or "neutral")[:32],
        score=_clamp(raw.get("score"), -1, 1),
        hedging=[h[:160] for h in (raw.get("hedging") or []) if h][:5],
        commitments=[c[:160] for c in (raw.get("commitments") or []) if c][:5],
        key_topics=[t[:60] for t in (raw.get("key_topics") or []) if t][:4],
        shift=(raw.get("shift") or "")[:16],
        shift_reason=(raw.get("shift_reason") or "")[:240],
    )


def _summary(
    ticker: str,
    company: str,
    chunks: list[ChunkScore],
) -> dict:
    if not chunks:
        return {
            "tone_overall": "neutral",
            "score_overall": 0,
            "headline": "no audio analysed",
            "top_commitments": [],
            "top_concerns": [],
            "key_shifts": [],
        }
    rolling = sum(c.score for c in chunks) / len(chunks)
    chunks_blob = "\n".join(
        f"[{c.index + 1}] tone={c.tone} score={c.score:+.2f} shift={c.shift or '·'} "
        f"topics={', '.join(c.key_topics) or '—'}"
        for c in chunks
    )
    user = f"""Ticker: {ticker}
Company: {company}
Aggregate score (mean across {len(chunks)} chunks): {rolling:+.2f}

Per-chunk summary:
{chunks_blob}

Return STRICT JSON:
{{
  "headline":         "one sentence framing the call's overall tone for retail investors",
  "tone_overall":     "confident | defensive | hedging | neutral | concerned | bullish",
  "score_overall":    -1..1,
  "top_commitments":  [<=4 most material commitments],
  "top_concerns":     [<=4 most material concerns / hedges],
  "key_shifts":       [<=3 specific points where tone shifted, format: "chunk N: ...reason..."]
}}
"""
    return call_claude_json(user, system=_SCORE_SYSTEM, max_tokens=900)


def _clamp(v, lo, hi) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return max(lo, min(hi, f))


# ---------------------------------------------------------------------------
# Async streaming pipeline — main public entry point
# ---------------------------------------------------------------------------


async def stream_earnings_call(
    *,
    url: str,
    ticker: str,
    company: str,
    words_per_chunk: int = 220,
    max_chunks: int = 30,
) -> AsyncIterator[dict]:
    """Yields SSE-shaped events end-to-end."""
    loop = asyncio.get_event_loop()
    workdir = Path(tempfile.mkdtemp(prefix="sauron-call-"))
    try:
        # 1. Download audio
        yield {"step": "yt_dlp", "status": "running"}
        try:
            wav = await loop.run_in_executor(None, _download_full_audio, url, workdir)
        except Exception as e:
            yield {"step": "yt_dlp", "status": "error", "detail": {"message": str(e)[:240]}}
            yield {"error": f"could not download: {e}"}
            return
        size_mb = wav.stat().st_size / (1024 * 1024)
        yield {"step": "yt_dlp", "status": "done", "detail": {"audio_mb": round(size_mb, 1)}}

        # 2. Upload to S3
        yield {"step": "upload_s3", "status": "running"}
        s3_uri = await loop.run_in_executor(
            None,
            lambda: put_bytes(
                f"earnings/{uuid.uuid4().hex[:10]}.wav",
                wav.read_bytes(),
                content_type="audio/wav",
            ),
        )
        yield {"step": "upload_s3", "status": "done"}

        # 3. Transcribe — emit poll progress so the user sees motion
        yield {"step": "transcribe", "status": "running"}
        progress_q: asyncio.Queue = asyncio.Queue()

        def on_poll(detail):
            try:
                progress_q.put_nowait(detail)
            except asyncio.QueueFull:
                pass

        transcribe_task = loop.run_in_executor(None, _transcribe_full, s3_uri, on_poll)
        # Drain progress events while the transcribe task is running.
        while not transcribe_task.done():
            try:
                detail = await asyncio.wait_for(progress_q.get(), timeout=4)
                yield {"step": "transcribe", "status": "running", "detail": detail}
            except asyncio.TimeoutError:
                continue
        try:
            transcript = await transcribe_task
        except Exception as e:
            yield {"step": "transcribe", "status": "error", "detail": {"message": str(e)[:240]}}
            yield {"error": f"transcribe failed: {e}"}
            return
        yield {
            "step": "transcribe",
            "status": "done",
            "detail": {"chars": len(transcript), "words": len(transcript.split())},
        }

        # 4. Chunk + stream-score
        chunk_texts = list(_word_chunks(transcript, words_per_chunk=words_per_chunk))[:max_chunks]
        total = len(chunk_texts)
        yield {"step": "scoring", "status": "running", "detail": {"total_chunks": total}}

        scored: list[ChunkScore] = []
        for i, text in enumerate(chunk_texts):
            yield {"step": "scoring", "status": "running", "detail": {"chunk_index": i, "of": total}}
            rolling_avg = (sum(c.score for c in scored) / len(scored)) if scored else None
            last_topics = [t for c in scored[-2:] for t in c.key_topics][:6]
            try:
                cs = await loop.run_in_executor(
                    None,
                    _score_chunk,
                    ticker, company, i, total, text, rolling_avg, last_topics,
                )
                scored.append(cs)
                yield {
                    "chunk": {
                        "index": cs.index,
                        "text": cs.text,
                        "tone": cs.tone,
                        "score": cs.score,
                        "hedging": cs.hedging,
                        "commitments": cs.commitments,
                        "key_topics": cs.key_topics,
                        "shift": cs.shift,
                        "shift_reason": cs.shift_reason,
                    }
                }
            except Exception as e:
                log.warning("chunk %s scoring failed: %s", i, e)
                yield {"chunk_error": {"index": i, "message": str(e)[:240]}}

        # 5. Final summary
        yield {"step": "summary", "status": "running"}
        try:
            summary = await loop.run_in_executor(None, _summary, ticker, company, scored)
            yield {"summary": summary}
        except Exception as e:
            yield {"step": "summary", "status": "error", "detail": {"message": str(e)[:240]}}

        yield {"done": True, "chunks_scored": len(scored)}
    finally:
        try:
            shutil.rmtree(workdir, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass
