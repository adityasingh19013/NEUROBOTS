"""Runtime configuration. Override any value with an IMPACTTRACE_* env var or backend/.env."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_prefix="IMPACTTRACE_", extra="ignore")

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'impacttrace.db').as_posix()}"
    storage_dir: Path = BACKEND_DIR / "storage" / "raw"
    sample_data_dir: Path = REPO_DIR / "sample_data"
    # Built frontend (npm run build). When present, the API also serves the web app (single-container deploys).
    frontend_dist: Path = REPO_DIR / "frontend" / "dist"

    # Secrets live in env/config, never in the DB (FR-9).
    hmac_secret: str = "dev-only-hmac-secret-change-me"
    jwt_secret: str = "dev-only-jwt-secret-change-me"
    jwt_expire_minutes: int = 12 * 60

    max_file_mb: int = 10
    max_files_per_project: int = 10
    max_rows_per_file: int = 10_000

    # Load sample_data/ as a demo project the first time the database is empty.
    seed_sample_project: bool = True

    demo_user_email: str = "demo@impacttrace.org"
    demo_user_password: str = "impact123"

    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173",
                               "http://127.0.0.1:3000", "http://127.0.0.1:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
