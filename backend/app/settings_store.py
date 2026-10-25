import asyncio
import time
from typing import Any

from pydantic import BaseModel, Field

from app.config import get_settings
from app.db.pool import connection


class AppSettings(BaseModel):
    trigger_delay_ms: int = Field(200, ge=150, le=1500)
    autocomplete_enabled: bool = True
    questions_enabled: bool = True
    max_options: int = Field(4, ge=2, le=6)
    retention_days: int = 30
    store_payloads: bool = False


class AppSettingsUpdate(BaseModel):
    trigger_delay_ms: int | None = Field(None, ge=150, le=1500)
    autocomplete_enabled: bool | None = None
    questions_enabled: bool | None = None
    max_options: int | None = Field(None, ge=2, le=6)


_COLUMNS = ("trigger_delay_ms", "autocomplete_enabled", "questions_enabled", "max_options")
_CACHE_TTL_S = 5.0
_cached: AppSettings | None = None
_expires_at = 0.0
_lock = asyncio.Lock()


def _remember(row: dict[str, Any] | None) -> AppSettings:
    global _cached, _expires_at
    _cached = AppSettings(**(row or {}), retention_days=get_settings().retention_days, store_payloads=False)
    _expires_at = time.monotonic() + _CACHE_TTL_S
    return _cached.model_copy()


async def load_settings() -> AppSettings:
    # Settings are shared by every keystroke. Serialize refreshes and writes so a slow
    # refresh cannot overwrite a newly saved preference; copies isolate callers.
    async with _lock:
        if _cached is not None and time.monotonic() < _expires_at:
            return _cached.model_copy()
        async with connection() as conn:
            row = await (await conn.execute(f"SELECT {', '.join(_COLUMNS)} FROM app_settings WHERE id = 1")).fetchone()
        return _remember(row)


async def update_settings(update: AppSettingsUpdate) -> AppSettings:
    changes = update.model_dump(exclude_none=True)
    if not changes:
        return await load_settings()
    async with _lock:
        assignments = ", ".join(f"{column} = %({column})s" for column in changes)
        async with connection() as conn:
            row = await (
                await conn.execute(
                    f"UPDATE app_settings SET {assignments} WHERE id = 1 RETURNING {', '.join(_COLUMNS)}",
                    changes,
                )
            ).fetchone()
        return _remember(row)
