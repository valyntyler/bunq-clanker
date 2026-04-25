"""Local Whisper transcription via faster-whisper.

Runs the openai/whisper-base.en model (74MB) locally on CPU. ~16× realtime
on a Mac, so a 5-second voice clip transcribes in ~300ms — vastly faster
than the AWS Transcribe batch round-trip (3-6s) we used before.

Lazy-loaded singleton: the model loads on first call and stays alive for
the life of the process. First call after server boot is slow (model
load); subsequent calls are fast.

Falls back to AWS Transcribe when the import fails or the model errors.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any

log = logging.getLogger("prospectus.whisper")

# Model selection. base.en is a good demo balance: 74MB download, ~16x
# realtime on M-series CPUs, accuracy clearly better than tiny.en.
# Override via env if a deployer wants something different.
_MODEL_NAME = os.getenv("WHISPER_MODEL", "base.en")
# CPU inference uses int8 quant for ~2x speed at minimal accuracy cost.
_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

_model: Any | None = None  # faster_whisper.WhisperModel


def _ensure_model() -> Any:
    """Lazy-load the Whisper model. Subsequent calls return the cached one.

    Raises ImportError if faster-whisper isn't installed; the caller should
    catch and fall back to AWS Transcribe."""
    global _model
    if _model is not None:
        return _model
    from faster_whisper import WhisperModel  # type: ignore[import-not-found]

    log.info("loading whisper model %s on %s (compute=%s)…", _MODEL_NAME, _DEVICE, _COMPUTE_TYPE)
    _model = WhisperModel(
        _MODEL_NAME,
        device=_DEVICE,
        compute_type=_COMPUTE_TYPE,
    )
    log.info("whisper model %s ready", _MODEL_NAME)
    return _model


def transcribe_bytes(audio_bytes: bytes, suffix: str = "webm") -> str:
    """Synchronous transcription of an audio blob. Returns the joined
    transcript text. Whisper handles webm/opus, mp4/m4a, mp3, wav natively
    via PyAV — no separate ffmpeg call needed."""
    model = _ensure_model()
    # Whisper wants a path (or numpy array). Cheapest is a tempfile.
    with tempfile.NamedTemporaryFile(suffix=f".{suffix}", delete=False) as f:
        f.write(audio_bytes)
        tmp_path = Path(f.name)
    try:
        segments, info = model.transcribe(
            str(tmp_path),
            beam_size=1,           # greedy decode — fastest for short clips
            language="en",
            vad_filter=True,       # voice-activity-detection drops silence/noise
            vad_parameters=dict(min_silence_duration_ms=400),
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        log.debug(
            "whisper transcribed %d bytes (%.2fs audio) → %d chars",
            len(audio_bytes),
            info.duration if hasattr(info, "duration") else 0,
            len(text),
        )
        return text
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass


def warmup() -> None:
    """Pre-load the model so the first user-facing /voice/transcribe call
    doesn't pay the cold-start cost. Called from the FastAPI startup hook."""
    try:
        _ensure_model()
    except Exception as e:  # noqa: BLE001
        log.warning("whisper warmup skipped: %s", e)
