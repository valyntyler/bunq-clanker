"""Auth: bcrypt password hashing, JWT (HS256, 24h) tokens, FastAPI dependency.

The JWT secret comes from JWT_SECRET in .env. If missing in dev, a deterministic
process-local fallback is used so the app boots — but the warning printed at
startup tells you to set one before sharing the build.
"""

from __future__ import annotations

import os
import secrets
import warnings
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session, select

from backend.db import User, get_session

JWT_ALG = "HS256"
JWT_TTL_HOURS = 24

_JWT_SECRET = os.getenv("JWT_SECRET")
if not _JWT_SECRET:
    _JWT_SECRET = secrets.token_hex(32)
    warnings.warn(
        "JWT_SECRET not set — using a per-process random secret. "
        "Tokens won't survive a backend restart. Set JWT_SECRET in .env.",
        RuntimeWarning,
        stacklevel=2,
    )


# ---- password hashing -----------------------------------------------------

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ---- JWT --------------------------------------------------------------------

def create_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_TTL_HOURS)).timestamp()),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> str:
    """Returns the user_id (sub) on success, raises HTTPException(401) on failure."""
    try:
        data = jwt.decode(token, _JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "invalid token")
    sub = data.get("sub")
    if not sub:
        raise HTTPException(401, "invalid token payload")
    return sub


# ---- FastAPI dependency -----------------------------------------------------


def _extract_bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth:
        return None
    parts = auth.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def require_user(
    request: Request,
    session: Session = Depends(get_session),
) -> User:
    """Dependency: 401s anything without a valid Bearer token."""
    token = _extract_bearer(request)
    if not token:
        # Some clients pass the token via query string for SSE — accept that too
        token = request.query_params.get("token")
    if not token:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "missing or malformed Authorization header",
            headers={"www-authenticate": "Bearer"},
        )
    user_id = decode_token(token)
    user = session.exec(select(User).where(User.id == user_id)).first()
    if user is None:
        raise HTTPException(401, "user not found")
    return user
