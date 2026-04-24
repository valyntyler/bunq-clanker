"""Compress user uploads before they hit S3 and downstream Claude calls.

Targets:
    image  — Pillow JPEG, q=82, max 2048px on longest side
    video  — ffmpeg H.264 720p CRF 23, AAC 96k mono, faststart for inline play
    audio  — ffmpeg AAC 96k mono in M4A container

Returns (compressed_bytes, output_content_type, stats_dict).

stats_dict gives the caller a one-line summary for logging:
    {
      "in_bytes": 8_124_900, "out_bytes": 412_300,
      "ratio": 0.05, "elapsed_s": 1.2, "format": "jpeg"
    }

Failures fall back to the original bytes — better to upload uncompressed than
to fail the user-visible upload. We log the warning but don't raise.
"""

from __future__ import annotations

import io
import logging
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

log = logging.getLogger("prospectus.compress")


def _stats(in_bytes: int, out_bytes: int, t0: float, fmt: str) -> dict:
    return {
        "in_bytes": in_bytes,
        "out_bytes": out_bytes,
        "ratio": (out_bytes / in_bytes) if in_bytes else 1.0,
        "elapsed_s": round(time.monotonic() - t0, 2),
        "format": fmt,
    }


def compress_image(
    raw: bytes, *, max_dim: int = 2048, quality: int = 82
) -> tuple[bytes, str, dict]:
    t0 = time.monotonic()
    try:
        from PIL import Image, ImageOps

        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)  # respect orientation
        if img.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")
        # Cap longest side
        if max(img.size) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
        out = buf.getvalue()
        return out, "image/jpeg", _stats(len(raw), len(out), t0, "jpeg")
    except Exception as e:  # noqa: BLE001
        log.warning("image compression failed (%s) — falling back to original", e)
        return raw, "image/png", _stats(len(raw), len(raw), t0, "passthrough")


def _ffmpeg_present() -> bool:
    return shutil.which("ffmpeg") is not None


def compress_video(
    raw: bytes,
    *,
    max_h: int = 720,
    crf: int = 23,
    audio_kbps: int = 96,
) -> tuple[bytes, str, dict]:
    """Re-encode to H.264 baseline-friendly MP4 with faststart for inline <video> play.
    Audio downmixed to mono AAC.
    """
    t0 = time.monotonic()
    if not _ffmpeg_present():
        log.warning("ffmpeg missing — passthrough video")
        return raw, "video/mp4", _stats(len(raw), len(raw), t0, "passthrough")

    with tempfile.TemporaryDirectory(prefix="compress-vid-") as td:
        tmp = Path(td)
        in_path = tmp / "in"
        out_path = tmp / "out.mp4"
        in_path.write_bytes(raw)
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(in_path),
            "-vf", f"scale='if(gt(ih,{max_h}),trunc(iw*{max_h}/ih/2)*2,iw)':'if(gt(ih,{max_h}),{max_h},ih)'",
            "-c:v", "libx264",
            "-crf", str(crf),
            "-preset", "fast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", f"{audio_kbps}k",
            "-ac", "1",
            "-movflags", "+faststart",
            str(out_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0 or not out_path.exists():
            log.warning("ffmpeg video compress failed: %s — passthrough", res.stderr[-200:])
            return raw, "video/mp4", _stats(len(raw), len(raw), t0, "passthrough")
        out = out_path.read_bytes()
        return out, "video/mp4", _stats(len(raw), len(out), t0, "h264-720p")


def compress_audio(
    raw: bytes, *, audio_kbps: int = 96
) -> tuple[bytes, str, dict]:
    """Re-encode to mono AAC in M4A. Smaller files for the UI player.
    Transcribe still gets a fresh 16kHz wav extract from the analyzer."""
    t0 = time.monotonic()
    if not _ffmpeg_present():
        log.warning("ffmpeg missing — passthrough audio")
        return raw, "audio/m4a", _stats(len(raw), len(raw), t0, "passthrough")

    with tempfile.TemporaryDirectory(prefix="compress-aud-") as td:
        tmp = Path(td)
        in_path = tmp / "in"
        out_path = tmp / "out.m4a"
        in_path.write_bytes(raw)
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(in_path),
            "-vn",
            "-c:a", "aac",
            "-b:a", f"{audio_kbps}k",
            "-ac", "1",
            "-movflags", "+faststart",
            str(out_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0 or not out_path.exists():
            log.warning("ffmpeg audio compress failed: %s — passthrough", res.stderr[-200:])
            return raw, "audio/m4a", _stats(len(raw), len(raw), t0, "passthrough")
        out = out_path.read_bytes()
        return out, "audio/m4a", _stats(len(raw), len(out), t0, "aac-96k-mono")
