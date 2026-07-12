from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.security_hardening import RateLimitMiddleware
from app.services.categories import seed_system_categories
from app.services.merchants import seed_system_merchants
from app.db.session import SessionLocal

settings = get_settings()
settings.assert_secure_enough()

app = FastAPI(title="Atlas Finance AI", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RateLimitMiddleware)

app.include_router(api_router)


@app.on_event("startup")
def on_startup() -> None:
    from sqlalchemy import text

    from app.db.session import Base, engine
    from app import models  # noqa: F401

    # Ensure schema exists for local/dev if migrations haven't been run yet
    Base.metadata.create_all(bind=engine)

    # Lightweight SQLite column add for existing local DBs
    if settings.is_sqlite:
        with engine.begin() as conn:
            cols = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(documents)")).fetchall()
            }
            if "content_hash" not in cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN content_hash VARCHAR(64)"))
            if "extraction_meta_json" not in cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN extraction_meta_json JSON"))

            tx_cols = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(transactions)")).fetchall()
            }
            if "page_number" not in tx_cols:
                conn.execute(text("ALTER TABLE transactions ADD COLUMN page_number INTEGER"))
            if "extraction_source" not in tx_cols:
                conn.execute(
                    text("ALTER TABLE transactions ADD COLUMN extraction_source VARCHAR(64)")
                )
            if "source_meta_json" not in tx_cols:
                conn.execute(text("ALTER TABLE transactions ADD COLUMN source_meta_json JSON"))
            if "merchant_id" not in tx_cols:
                conn.execute(text("ALTER TABLE transactions ADD COLUMN merchant_id VARCHAR(36)"))

            # Clients foundation (006) — create table + nullable client_id columns for local SQLite
            tables = {
                row[0]
                for row in conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table'")
                ).fetchall()
            }
            if "clients" not in tables:
                conn.execute(
                    text(
                        """
                        CREATE TABLE clients (
                            id CHAR(36) NOT NULL PRIMARY KEY,
                            organization_id CHAR(36) NOT NULL,
                            name VARCHAR(255) NOT NULL,
                            slug VARCHAR(128) NOT NULL,
                            status VARCHAR(32) NOT NULL,
                            is_default BOOLEAN NOT NULL,
                            notes TEXT,
                            created_at DATETIME NOT NULL,
                            updated_at DATETIME NOT NULL,
                            FOREIGN KEY(organization_id) REFERENCES organizations (id),
                            UNIQUE (organization_id, slug)
                        )
                        """
                    )
                )
                conn.execute(
                    text("CREATE INDEX ix_clients_organization_id ON clients (organization_id)")
                )

            for table in (
                "bank_accounts",
                "documents",
                "transactions",
                "category_rules",
                "reports",
                "period_closes",
                "audit_logs",
            ):
                if table not in tables and table != "clients":
                    continue
                cols = {
                    row[1]
                    for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
                }
                if "client_id" not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN client_id VARCHAR(36)"))

            # Audit enrichment (007) — before/after + IP/UA for local SQLite
            audit_cols = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(audit_logs)")).fetchall()
            }
            if audit_cols:
                if "before_json" not in audit_cols:
                    conn.execute(text("ALTER TABLE audit_logs ADD COLUMN before_json JSON"))
                if "after_json" not in audit_cols:
                    conn.execute(text("ALTER TABLE audit_logs ADD COLUMN after_json JSON"))
                if "ip_address" not in audit_cols:
                    conn.execute(
                        text("ALTER TABLE audit_logs ADD COLUMN ip_address VARCHAR(64)")
                    )
                if "user_agent" not in audit_cols:
                    conn.execute(
                        text("ALTER TABLE audit_logs ADD COLUMN user_agent VARCHAR(512)")
                    )

    db = SessionLocal()
    try:
        seed_system_categories(db)
        seed_system_merchants(db)
        from app.services.clients import backfill_organization_clients

        backfill_organization_clients(db)
        db.commit()
        # Backfill content hashes so duplicate detection works for older uploads
        from app.models.document import Document
        from app.services.storage import download_bytes
        import hashlib

        missing = (
            db.query(Document)
            .filter(Document.content_hash.is_(None), Document.s3_key.isnot(None))
            .limit(50)
            .all()
        )
        for doc in missing:
            try:
                raw = download_bytes(doc.s3_key)
                doc.content_hash = hashlib.sha256(raw).hexdigest()
            except Exception:
                continue
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "atlas-api"}
