from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings

settings = get_settings()
database_url = settings.resolved_database_url()

connect_args: dict = {}
engine_kwargs: dict = {
    "pool_pre_ping": not settings.is_sqlite,
}

if settings.is_sqlite:
    connect_args["check_same_thread"] = False
    db_path = database_url.replace("sqlite+pysqlite:///", "")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
elif settings.uses_supabase_pooler:
    # Transaction-mode pooler (port 6543) does not support prepared statements
    connect_args["prepare_threshold"] = None
    engine_kwargs["pool_size"] = 5
    engine_kwargs["max_overflow"] = 10

engine = create_engine(
    database_url,
    connect_args=connect_args,
    **engine_kwargs,
)

if settings.is_sqlite:

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):  # noqa: ARG001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass
