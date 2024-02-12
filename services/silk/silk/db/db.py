from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from ..settings import app_settings
from .models import Base


def _setup_sqlite_conn(conn, _):
    pragmas = [
        "PRAGMA busy_timeout = 10000;",
        "PRAGMA journal_mode = WAL;",
        "PRAGMA synchronous = NORMAL;",
        "PRAGMA foreign_keys = ON;",
        "PRAGMA temp_store = MEMORY;",
    ]
    for pragma in pragmas:
        conn.execute(pragma)


def sqlite_create_engine():
    engine = create_engine(f"sqlite:///{Path(app_settings.sqlite_db).resolve()}")
    event.listen(engine, "connect", _setup_sqlite_conn)
    return engine


sqlite_engine = sqlite_create_engine()
db_session = sessionmaker(bind=sqlite_engine)
Base.metadata.create_all(sqlite_engine)
