"""Claude abstraction. Bedrock by default, direct Anthropic API as fallback.

Flip LLM_PROVIDER=anthropic in .env if Bedrock quota bites on demo day —
the rest of the backend stays identical.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any, Literal

import boto3

ProviderName = Literal["bedrock", "anthropic"]

_BEDROCK_MODEL = os.getenv(
    "BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0"
)
_ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
_PROVIDER: ProviderName = os.getenv("LLM_PROVIDER", "bedrock").lower()  # type: ignore[assignment]
_REGION = os.getenv("AWS_REGION", "us-east-1")


def _bedrock_runtime():
    return boto3.client("bedrock-runtime", region_name=_REGION)


def _encode_image(image: bytes | str | Path) -> dict:
    """Accept raw bytes, a path, or a base64 string — return Bedrock image content block."""
    if isinstance(image, (str, Path)) and Path(image).exists():
        data = base64.b64encode(Path(image).read_bytes()).decode()
        media_type = _infer_media_type(str(image))
    elif isinstance(image, bytes):
        data = base64.b64encode(image).decode()
        media_type = "image/png"
    else:
        data = str(image)
        media_type = "image/png"
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": data},
    }


def _infer_media_type(path: str) -> str:
    p = path.lower()
    if p.endswith(".jpg") or p.endswith(".jpeg"):
        return "image/jpeg"
    if p.endswith(".webp"):
        return "image/webp"
    if p.endswith(".gif"):
        return "image/gif"
    return "image/png"


def call_claude(
    user_text: str,
    *,
    system: str | None = None,
    images: list[bytes | str | Path] | None = None,
    max_tokens: int = 4096,
    temperature: float = 0.2,
    json_mode: bool = False,
) -> str:
    """Single-turn Claude call. Returns raw text.

    json_mode instructs Claude to return strict JSON; validate at the call site.
    """
    content: list[dict[str, Any]] = []
    for img in images or []:
        content.append(_encode_image(img))
    content.append({"type": "text", "text": user_text})
    messages = [{"role": "user", "content": content}]

    if _PROVIDER == "bedrock":
        return _invoke_bedrock(messages, system, max_tokens, temperature, json_mode)
    if _PROVIDER == "anthropic":
        return _invoke_anthropic(messages, system, max_tokens, temperature, json_mode)
    raise RuntimeError(f"unknown LLM_PROVIDER: {_PROVIDER}")


def call_claude_json(
    user_text: str,
    *,
    system: str | None = None,
    images: list[bytes | str | Path] | None = None,
    max_tokens: int = 4096,
) -> dict:
    """Call and parse JSON, with one retry on parse failure."""
    raw = call_claude(
        user_text,
        system=_with_json_instruction(system),
        images=images,
        max_tokens=max_tokens,
        json_mode=True,
    )
    try:
        return json.loads(_strip_code_fence(raw))
    except json.JSONDecodeError:
        # retry once, asking Claude to fix its own output
        retry = call_claude(
            "Your previous response was not valid JSON. Return ONLY valid JSON, no prose, no code fences.\n\n"
            f"Your previous response:\n{raw}\n\nOriginal request:\n{user_text}",
            system=_with_json_instruction(system),
            images=images,
            max_tokens=max_tokens,
            json_mode=True,
        )
        return json.loads(_strip_code_fence(retry))


def _with_json_instruction(system: str | None) -> str:
    suffix = "\n\nYou MUST respond with strict, valid JSON only. No prose, no markdown code fences."
    return (system or "") + suffix


def _strip_code_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        # strip opening fence (``` or ```json) and closing fence
        lines = t.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        t = "\n".join(lines)
    return t


def _invoke_bedrock(
    messages: list[dict],
    system: str | None,
    max_tokens: int,
    temperature: float,
    json_mode: bool,
) -> str:
    body: dict[str, Any] = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": messages,
    }
    if system:
        body["system"] = system
    resp = _bedrock_runtime().invoke_model(
        modelId=_BEDROCK_MODEL,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(body),
    )
    out = json.loads(resp["body"].read())
    return out["content"][0]["text"]


def _invoke_anthropic(
    messages: list[dict],
    system: str | None,
    max_tokens: int,
    temperature: float,
    json_mode: bool,
) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    kwargs: dict[str, Any] = {
        "model": _ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": messages,
    }
    if system:
        kwargs["system"] = system
    resp = client.messages.create(**kwargs)
    return resp.content[0].text
