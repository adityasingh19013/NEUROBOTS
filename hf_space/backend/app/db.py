from collections.abc import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()
_is_sqlite = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()


# Raw rows are immutable (FR-1.5): enforced in the database, not just the API.
_RAW_ROW_TRIGGERS = [
    """CREATE TRIGGER IF NOT EXISTS raw_rows_no_update BEFORE UPDATE ON raw_rows
       BEGIN SELECT RAISE(ABORT, 'raw rows are immutable'); END;""",
    """CREATE TRIGGER IF NOT EXISTS raw_rows_no_delete BEFORE DELETE ON raw_rows
       BEGIN SELECT RAISE(ABORT, 'raw rows are immutable'); END;""",
]


def init_db() -> None:
    import app.models  # noqa: F401  (register tables)

    Base.metadata.create_all(engine)
    if _is_sqlite:
        with engine.begin() as conn:
            for ddl in _RAW_ROW_TRIGGERS:
                conn.execute(text(ddl))


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
