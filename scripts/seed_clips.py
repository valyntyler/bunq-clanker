"""Pre-seed the geopolitical clip library.

Downloads short segments of public press-conference videos, runs the full
preprocessing pipeline (audio extract + Transcribe + frame grid + prosody),
uploads artifacts to S3, and writes the metadata into:

    backend/fixtures/clips_registry.json

The geopolitical_video analyzer reads from that registry at runtime.

Usage:
    AWS_PROFILE=prospectus ./.venv/bin/python scripts/seed_clips.py

You can edit CLIPS below. Each entry needs a public source URL (YouTube,
direct MP4 from .gov / .europa.eu, etc.), a start_s + duration_s window,
and a stable event_id used as the S3 key prefix.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

import backend.scrapers.geopolitical_clips as gc  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("seed_clips")

REGISTRY_PATH = (
    Path(__file__).resolve().parent.parent
    / "backend" / "fixtures" / "clips_registry.json"
)


# Pick short, well-recorded segments. 30 seconds is enough for a frame grid
# to look meaningful and a transcript to carry the policy claim. Longer than
# 60s means a slow Transcribe round-trip.
#
# If a URL gets removed or geofenced, swap it — the pipeline doesn't care
# what the source is.
# yt-dlp accepts `ytsearch1:<query>` and returns the first matching video on
# YouTube — robust against any specific video being removed/geofenced.
CLIPS = [
    {
        "event_id": "ecb-lagarde-press-recent",
        "speaker": "ECB President",
        "title": "ECB rate-decision press conference (excerpt)",
        "source_url": "ytsearch1:ECB Lagarde press conference monetary policy",
        "start_s": 90,
        "duration_s": 30,
    },
    {
        "event_id": "trump-tariffs-recent",
        "speaker": "US President",
        "title": "Tariff policy statement (excerpt)",
        "source_url": "ytsearch1:Trump tariffs announcement statement",
        "start_s": 30,
        "duration_s": 30,
    },
    {
        "event_id": "eu-commission-ai-act",
        "speaker": "EU Commission",
        "title": "EU AI Act announcement (excerpt)",
        "source_url": "ytsearch1:European Commission AI Act announcement",
        "start_s": 30,
        "duration_s": 30,
    },
]


def load_existing() -> dict:
    if REGISTRY_PATH.exists():
        return json.loads(REGISTRY_PATH.read_text())
    return {"clips": []}


def save(registry: dict) -> None:
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2))


def main() -> None:
    registry = load_existing()
    have = {c["event_id"] for c in registry.get("clips", [])}
    log.info("registry currently has %d clips", len(have))

    new_clips: list[dict] = []
    for clip in CLIPS:
        if clip["event_id"] in have:
            log.info("skip (cached): %s", clip["event_id"])
            continue
        try:
            log.info("processing %s — %s", clip["event_id"], clip["source_url"])
            processed = gc.process_clip(**clip)
            d = gc.to_dict(processed)
            registry.setdefault("clips", []).append(d)
            new_clips.append(d)
            save(registry)
            log.info(
                "✓ %s — duration %.1fs · transcript %d chars · pitch %s Hz",
                clip["event_id"],
                d["duration_s"],
                len(d["transcript"]),
                d["prosody"].get("pitch_mean_hz"),
            )
        except Exception as e:  # noqa: BLE001
            log.exception("✗ %s failed: %s", clip["event_id"], e)
            registry.setdefault("failed", []).append(
                {"event_id": clip["event_id"], "error": str(e)}
            )
            save(registry)

    log.info("done — %d new clips, %d total", len(new_clips), len(registry.get("clips", [])))


if __name__ == "__main__":
    main()
