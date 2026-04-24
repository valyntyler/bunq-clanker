"""Thin wrappers around boto3 for S3 uploads + presigned URLs.

Everything lives in one bucket (AWS_S3_BUCKET) with key prefixes per artifact
kind (charts/, clips/, screenshots/, reports/).
"""

from __future__ import annotations

import os
from functools import lru_cache

import boto3

BUCKET = os.getenv("AWS_S3_BUCKET", "sauron-wallet")
REGION = os.getenv("AWS_REGION", "us-east-1")


@lru_cache(maxsize=1)
def _s3():
    return boto3.client("s3", region_name=REGION)


def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """Upload raw bytes and return the s3:// URI."""
    _s3().put_object(
        Bucket=BUCKET, Key=key, Body=data, ContentType=content_type
    )
    return f"s3://{BUCKET}/{key}"


def presigned_url(key: str, expires_s: int = 3600) -> str:
    return _s3().generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=expires_s,
    )


def put_and_sign(
    key: str, data: bytes, content_type: str = "application/octet-stream", expires_s: int = 3600
) -> str:
    put_bytes(key, data, content_type)
    return presigned_url(key, expires_s)
