"""Helpers to ingest a short geopolitical video clip into the pipeline.

Pipeline per clip:
    1. yt-dlp downloads a segment (start + duration) of the source video
    2. ffmpeg extracts mono 16 kHz wav
    3. AWS Transcribe (async, polled) → transcript text
    4. ffmpeg samples 9 frames into a 3x3 grid PNG (Claude-vision-friendly)
    5. librosa computes prosody features (pitch, energy, pauses)

Outputs are uploaded to S3 with key prefix `clips/<event_id>.<ext>` and the
metadata is returned so the caller can persist it in `clips_registry.json`.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import boto3
import httpx
import numpy as np

from backend.aws import BUCKET, REGION, presigned_url, put_bytes

log = logging.getLogger("prospectus.clips")


@dataclass
class ProcessedClip:
    event_id: str
    speaker: str
    title: str
    source_url: str
    duration_s: float
    transcript: str
    prosody: dict[str, Any]
    s3_mp4: str  # s3://...
    s3_audio: str
    s3_grid: str
    clip_url: str  # presigned (long-lived)
    frame_grid_url: str  # presigned
    audio_url: str  # presigned


def _yt_dlp_bin() -> str:
    """Locate yt-dlp on the running process's PATH or in the active venv."""
    found = shutil.which("yt-dlp")
    if found:
        return found
    import sys

    venv_bin = Path(sys.executable).parent / "yt-dlp"
    if venv_bin.exists():
        return str(venv_bin)
    raise RuntimeError(
        "yt-dlp not found on PATH or in the venv — install with `pip install yt-dlp`"
    )


def yt_dlp_search(query: str, max_results: int = 10) -> list[dict]:
    """Search YouTube via yt-dlp without downloading. Returns metadata only.

    Each result: {id, title, channel, url, thumbnail, upload_date, duration_s,
                  view_count}
    """
    import json as _json

    cmd = [
        _yt_dlp_bin(),
        "--no-playlist",
        "--flat-playlist",
        "--quiet",
        "--dump-json",
        "--default-search", "ytsearch",
        f"ytsearch{max_results}:{query}",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    if res.returncode != 0:
        raise RuntimeError(f"yt-dlp search failed: {res.stderr or res.stdout}")
    out: list[dict] = []
    for line in res.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            d = _json.loads(line)
        except _json.JSONDecodeError:
            continue
        thumb = d.get("thumbnail")
        if not thumb:
            # In flat-playlist mode yt-dlp returns a list of thumbnails with
            # multiple resolutions instead of a single URL — pick the largest
            # so the UI cards aren't blurry.
            thumbs = d.get("thumbnails") or []
            if thumbs:
                # Prefer the highest-resolution (last item is usually largest)
                thumb = thumbs[-1].get("url") if isinstance(thumbs[-1], dict) else None
        if not thumb and d.get("id"):
            # Fallback to YouTube's deterministic thumbnail URL — always works
            thumb = f"https://i.ytimg.com/vi/{d['id']}/hqdefault.jpg"
        out.append(
            {
                "id": d.get("id"),
                "title": d.get("title"),
                "channel": d.get("channel") or d.get("uploader"),
                "url": d.get("webpage_url") or f"https://www.youtube.com/watch?v={d.get('id')}",
                "thumbnail": thumb,
                "duration_s": d.get("duration"),
                "view_count": d.get("view_count"),
                "upload_date": d.get("upload_date"),
            }
        )
    return out


def yt_dlp_segment(url: str, start_s: int, duration_s: int, out_mp4: Path) -> None:
    """Download a precise segment with yt-dlp + ffmpeg post-processor."""
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    end_s = start_s + duration_s
    cmd = [
        _yt_dlp_bin(),
        "--no-playlist",
        "--download-sections", f"*{start_s}-{end_s}",
        "--force-keyframes-at-cuts",
        "--quiet",
        "-f", "mp4/bestvideo[height<=720]+bestaudio/best",
        "--merge-output-format", "mp4",
        "-o", str(out_mp4),
        url,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0 or not out_mp4.exists():
        raise RuntimeError(f"yt-dlp failed: {res.stderr or res.stdout}")


def ffprobe_duration(path: Path) -> float:
    res = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json", str(path),
        ],
        capture_output=True, text=True, check=True,
    )
    return float(json.loads(res.stdout)["format"]["duration"])


def extract_audio_wav(mp4: Path, wav: Path) -> None:
    res = subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(mp4),
            "-ac", "1", "-ar", "16000",
            str(wav),
        ],
        capture_output=True, text=True,
    )
    if res.returncode != 0 or not wav.exists():
        raise RuntimeError(f"ffmpeg audio extract failed: {res.stderr}")


def frame_grid(mp4: Path, out_png: Path, n: int = 9, tile_w: int = 320) -> None:
    """Sample n frames evenly through the clip and tile them into a grid."""
    out_png.parent.mkdir(parents=True, exist_ok=True)
    duration = ffprobe_duration(mp4)
    # fps such that we get exactly n frames over the clip
    fps = max(n / duration, 0.1)
    rows = cols = int(round(n ** 0.5))
    if rows * cols < n:
        cols += 1
    res = subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(mp4),
            "-vf", f"fps={fps:.4f},scale={tile_w}:-1,tile={cols}x{rows}",
            "-frames:v", "1",
            str(out_png),
        ],
        capture_output=True, text=True,
    )
    if res.returncode != 0 or not out_png.exists():
        raise RuntimeError(f"ffmpeg frame grid failed: {res.stderr}")


def prosody_features(wav: Path) -> dict[str, Any]:
    """Lightweight prosody summary: pitch (yin), energy, pause fraction."""
    import librosa

    y, sr = librosa.load(str(wav), sr=16000, mono=True)
    duration = float(len(y) / sr)
    out: dict[str, Any] = {"duration_s": round(duration, 2)}
    try:
        pitch = librosa.yin(y, fmin=60, fmax=400, sr=sr)
        voiced = pitch[(pitch > 60) & (pitch < 400)]
        out["pitch_mean_hz"] = float(np.mean(voiced)) if voiced.size else None
        out["pitch_std_hz"] = float(np.std(voiced)) if voiced.size else None
    except Exception:
        out["pitch_mean_hz"] = None
        out["pitch_std_hz"] = None
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    out["rms_mean"] = float(np.mean(rms))
    out["rms_std"] = float(np.std(rms))
    silence_thresh = float(np.percentile(rms, 20))
    out["silence_fraction"] = float(np.mean(rms < silence_thresh))
    return out


def transcribe_via_aws(audio_s3_uri: str, language: str = "en-US") -> str:
    """Submit Transcribe job, poll until COMPLETED, fetch transcript text.

    Cheap and OK for short demo clips (~30s). For long content we'd switch to
    streaming or Whisper local.
    """
    client = boto3.client("transcribe", region_name=REGION)
    job_name = f"prospectus-clip-{uuid.uuid4().hex[:10]}"
    client.start_transcription_job(
        TranscriptionJobName=job_name,
        Media={"MediaFileUri": audio_s3_uri},
        MediaFormat="wav",
        LanguageCode=language,
    )
    log.info("transcribe job %s submitted", job_name)
    while True:
        time.sleep(3)
        j = client.get_transcription_job(TranscriptionJobName=job_name)
        status = j["TranscriptionJob"]["TranscriptionJobStatus"]
        if status == "COMPLETED":
            uri = j["TranscriptionJob"]["Transcript"]["TranscriptFileUri"]
            data = httpx.get(uri, timeout=15).json()
            return data["results"]["transcripts"][0]["transcript"]
        if status == "FAILED":
            raise RuntimeError(
                j["TranscriptionJob"].get("FailureReason", "transcribe failed")
            )


def process_clip(
    *,
    event_id: str,
    speaker: str,
    title: str,
    source_url: str,
    start_s: int,
    duration_s: int,
    workdir: Path | None = None,
) -> ProcessedClip:
    """Run the full pipeline for one clip and upload artifacts to S3."""
    if not shutil.which("yt-dlp"):
        raise RuntimeError("yt-dlp not on PATH; install with `pip install yt-dlp`")
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not on PATH; install with `brew install ffmpeg`")

    tmp = workdir or Path(tempfile.mkdtemp(prefix="prospectus-clip-"))
    tmp.mkdir(parents=True, exist_ok=True)
    mp4 = tmp / f"{event_id}.mp4"
    wav = tmp / f"{event_id}.wav"
    grid = tmp / f"{event_id}.grid.png"

    log.info("yt-dlp %s [%ds, +%ds]", source_url, start_s, duration_s)
    yt_dlp_segment(source_url, start_s, duration_s, mp4)

    log.info("ffmpeg → audio %s", wav.name)
    extract_audio_wav(mp4, wav)

    log.info("ffmpeg → frame grid %s", grid.name)
    frame_grid(mp4, grid, n=9)

    log.info("librosa prosody")
    pros = prosody_features(wav)

    # Upload to S3
    s3_mp4_uri = put_bytes(
        f"clips/{event_id}.mp4",
        mp4.read_bytes(),
        content_type="video/mp4",
    )
    s3_audio_uri = put_bytes(
        f"clips/{event_id}.wav",
        wav.read_bytes(),
        content_type="audio/wav",
    )
    s3_grid_uri = put_bytes(
        f"clips/{event_id}.grid.png",
        grid.read_bytes(),
        content_type="image/png",
    )

    log.info("AWS Transcribe → %s", s3_audio_uri)
    transcript = transcribe_via_aws(s3_audio_uri)

    return ProcessedClip(
        event_id=event_id,
        speaker=speaker,
        title=title,
        source_url=source_url,
        duration_s=ffprobe_duration(mp4),
        transcript=transcript,
        prosody=pros,
        s3_mp4=s3_mp4_uri,
        s3_audio=s3_audio_uri,
        s3_grid=s3_grid_uri,
        # 7-day URLs so the demo just works for the rest of the hackathon
        clip_url=presigned_url(f"clips/{event_id}.mp4", expires_s=7 * 24 * 3600),
        audio_url=presigned_url(f"clips/{event_id}.wav", expires_s=7 * 24 * 3600),
        frame_grid_url=presigned_url(
            f"clips/{event_id}.grid.png", expires_s=7 * 24 * 3600
        ),
    )


def to_dict(clip: ProcessedClip) -> dict:
    return asdict(clip)
