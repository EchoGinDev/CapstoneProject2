"""SQLAlchemy setup. PostgreSQL is the application default; SQLite is opt-in for tests."""
from __future__ import annotations

import os
from datetime import datetime, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def _load_dotenv(path: str = ".env") -> None:
    """Load simple KEY=VALUE entries without overwriting the process environment."""
    try:
        if not os.path.exists(path):
            return
        with open(path, encoding="utf-8") as dotenv:
            for line in dotenv:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key, value = key.strip(), value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


_load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg://eaics:eaics@localhost:5432/eaics"
)

if DATABASE_URL.startswith("sqlite"):
    # SQLite is reserved for tests and must be selected explicitly.
    engine = create_engine(DATABASE_URL, pool_pre_ping=True,
                           connect_args={"check_same_thread": False})
else:
    try:
        engine = create_engine(DATABASE_URL, pool_pre_ping=True)
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Driver PostgreSQL belum terpasang. Jalankan: python -m pip install -r requirements.txt"
        ) from exc
    except SQLAlchemyError as exc:
        raise RuntimeError(
            "PostgreSQL tidak bisa dihubungi. Nyalakan Docker Desktop lalu jalankan: "
            "docker compose up -d postgres"
        ) from exc


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
