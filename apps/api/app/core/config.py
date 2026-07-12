from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[4]
API_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ROOT / ".env"), str(API_DIR / ".env"), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # sqlite+pysqlite for zero-deps local mode; postgres for docker/prod
    database_url: str = f"sqlite+pysqlite:///{(ROOT / 'data' / 'atlas.db').as_posix()}"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "change-me-to-a-long-random-secret"
    # Separate from JWT when set; falls back to jwt_secret for local compat
    file_signing_secret: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14
    # When true, refuse to boot with default JWT secret
    require_secure_secrets: bool = False

    # local | s3
    storage_backend: str = "local"
    local_storage_path: str = str(ROOT / "data" / "storage")

    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "atlas-documents"
    s3_region: str = "us-east-1"

    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    # Google AI Studio / Gemini API key (AIza...). Vertex needs project+ADC separately.
    ai_provider: str = "auto"  # auto | vertex | gemini | openai | heuristic
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"

    # Vertex AI (service account / ADC)
    vertex_project_id: str = ""
    vertex_location: str = "us-central1"
    vertex_model: str = "gemini-2.0-flash-001"
    google_application_credentials: str = ""  # path to service account JSON
    # Optional alias some users set
    vertex_api_key: str = ""

    api_cors_origins: str = "http://localhost:3000"
    max_upload_mb: int = 20
    confidence_review_threshold: float = 0.7
    api_public_url: str = "http://localhost:8000"
    default_currency: str = "PKR"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    def resolved_database_url(self) -> str:
        """Normalize DATABASE_URL for SQLAlchemy + Supabase/Postgres."""
        url = (self.database_url or "").strip()
        if not url:
            return url

        # Supabase dashboard often copies postgres:// or postgresql://
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://") :]
        elif url.startswith("postgresql://") and "+psycopg" not in url.split("://", 1)[0]:
            url = "postgresql+psycopg://" + url[len("postgresql://") :]

        if url.startswith("sqlite"):
            prefix = "sqlite+pysqlite:///"
            if url.startswith(prefix):
                path = url[len(prefix) :]
                if path.startswith("./") or not path.startswith("/"):
                    return f"{prefix}{(ROOT / path).resolve().as_posix()}"
            return url

        # Supabase (and most managed Postgres) require TLS
        lower = url.lower()
        if "sslmode=" not in lower and (
            "supabase.co" in lower or "pooler.supabase.com" in lower
        ):
            url += ("&" if "?" in url else "?") + "sslmode=require"

        return url

    @property
    def uses_supabase_pooler(self) -> bool:
        url = self.resolved_database_url().lower()
        return "pooler.supabase.com" in url or ":6543/" in url or ":6543?" in url

    def resolved_storage_path(self) -> Path:
        path = Path(self.local_storage_path)
        if not path.is_absolute():
            path = ROOT / path
        return path.resolve()

    def file_hmac_secret(self) -> str:
        return self.file_signing_secret or self.jwt_secret

    def assert_secure_enough(self) -> None:
        weak = {
            "",
            "change-me-to-a-long-random-secret",
            "replace-with-long-random-secret-at-least-32-chars",
        }
        if self.require_secure_secrets and self.jwt_secret in weak:
            raise RuntimeError(
                "JWT_SECRET is missing or insecure. Set a long random JWT_SECRET "
                "(and optionally FILE_SIGNING_SECRET) before starting staging/prod."
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
