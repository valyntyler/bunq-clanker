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


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
