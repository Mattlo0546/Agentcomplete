import asyncio
import logging
import time
from typing import Any

from pydantic import BaseModel, Field

from app.config import get_settings
from app.db.pool import connection


class AppSettings(BaseModel):
    trigger_delay_ms: int = Field(150, ge=150, le=1500)
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
_REFRESH_INTERVAL_S = 2.5
_cached: AppSettings | None = None
_expires_at = 0.0
_lock = asyncio.Lock()
_refresh_task: asyncio.Task[None] | None = None
_log = logging.getLogger(__name__)


def _remember(row: dict[str, Any] | None) -> AppSettings:
    global _cached, _expires_at
    _cached = AppSettings(**(row or {}), retention_days=get_settings().retention_days, store_payloads=False)
    _expires_at = time.monotonic() + _CACHE_TTL_S
    return _cached.model_copy()


def _fresh_settings() -> AppSettings | None:
    if _cached is not None and time.monotonic() < _expires_at:
        return _cached.model_copy()
    return None


async def _read_settings() -> AppSettings:
    """Read while holding _lock; only a successful transaction renews freshness."""
    async with connection() as conn:
        row = await (await conn.execute(f"SELECT {', '.join(_COLUMNS)} FROM app_settings WHERE id = 1")).fetchone()
    return _remember(row)


async def load_settings() -> AppSettings:
    # Fresh reads must not wait behind background refreshes or in-flight writes.
    # Copies isolate callers; committed writes replace the cache immediately.
    cached = _fresh_settings()
    if cached is not None:
        return cached
    async with _lock:
        cached = _fresh_settings()
        return cached if cached is not None else await _read_settings()


async def refresh_settings() -> AppSettings:
    """Force a read, serialized with writes to avoid restoring an old preference."""
    async with _lock:
        return await _read_settings()


async def _refresh_settings_loop() -> None:
    while True:
        await asyncio.sleep(_REFRESH_INTERVAL_S)
        try:
            await refresh_settings()
        except Exception as exc:
            # Keep the original expiry and let expired request-path reads fail normally.
            _log.warning("settings refresh failed (%s)", type(exc).__name__)


async def start_settings_refresh() -> None:
    """Warm settings before serving requests, then refresh ahead of their expiry."""
    global _refresh_task
    if _refresh_task is not None and not _refresh_task.done():
        return
    await refresh_settings()
    _refresh_task = asyncio.create_task(_refresh_settings_loop(), name="settings-refresh")


async def stop_settings_refresh() -> None:
    """Stop maintenance and release its database operation before closing the pool."""
    global _refresh_task
    task, _refresh_task = _refresh_task, None
    if task is not None:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


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
