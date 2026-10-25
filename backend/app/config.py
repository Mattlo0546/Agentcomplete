from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Process configuration. Secrets come from the repo-root `.env` and never leave the backend."""

    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    gemini_api_key: str = Field(repr=False)
    database_url: str = Field(repr=False)
    snowflake_connection_name: str = "prompt-enhance"

    tag_model: str = "gemini-3.5-flash-lite"
    judge_model: str = "gemini-3.5-flash-lite"
    generate_model: str = "gemini-3.5-flash-lite"
    autocomplete_model: str = "gemini-3.5-flash-lite"
    embed_model: str = "gemini-embedding-001"
    embed_dims: int = 768
    catalog_review_enabled: bool = True
    fast_autocomplete_enabled: bool = True

    llm_timeout_s: float = 8.0
    retention_days: int = 30
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
