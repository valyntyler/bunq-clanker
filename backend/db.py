"""SQLite via SQLModel — single source of truth for user accounts.

Per spec we don't use this for analyzer state (ephemeral / cached on disk),
only for identity. One file, one table, one writer — keeps demo simple.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from sqlmodel import Field, Session, SQLModel, create_engine

DB_PATH = Path(os.getenv("SAURON_DB_PATH", "backend/db/sauron.sqlite"))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    echo=False,
    connect_args={"check_same_thread": False},
)


class User(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Investment(SQLModel, table=True):
    """Persisted /invest receipts. One row per money-move."""

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    ticker: str = Field(index=True)
    company_name: str = ""
    verdict: str = ""              # snapshot at the time of investment
    confidence: float = 0.0
    amount_eur: float
    amount_usd: float
    fx_rate: float
    bunq_payment_id: str | None = None
    bunq_pot_id: int | None = None
    bunq_pot_name: str | None = None
    alpaca_order_id: str | None = None
    alpaca_symbol: str = ""
    shares_estimated: float = 0.0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)


class UserEvidence(SQLModel, table=True):
    """Persisted user-submitted sources (URL/text/image/video/audio/PDF)."""

    id: str = Field(primary_key=True)  # mirrors UserSource.source_id
    user_id: str = Field(foreign_key="user.id", index=True)
    ticker: str = Field(index=True)
    company_name: str | None = None
    source_type: str
    origin: str | None = None  # presigned S3 URL or external URL
    user_note: str = ""
    user_tag: str = "neutral"
    score: float = 0.0
    summary: str = ""
    trust_level: str = "medium"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)


class AnalysisRun(SQLModel, table=True):
    """Lightweight log of every /analyze call — verdict + one_liner only,
    not the full Report (which is large and rebuildable). Lets the user
    scroll back through what they've researched."""

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    ticker: str = Field(index=True)
    company_name: str = ""
    verdict: str = ""
    confidence: float = 0.0
    position_size_pct: float = 0.0
    one_liner: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)


class CachedReport(SQLModel, table=True):
    """Most recent full Report per (user, ticker). Lets the analyze page
    re-hydrate instantly when the user navigates back instead of re-running
    the 25-second pipeline. Keep one row per ticker — replace on each new
    /analyze run.
    """

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    ticker: str = Field(index=True)
    report_json: str  # serialized Report.model_dump_json()
    generated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc), index=True
    )


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
