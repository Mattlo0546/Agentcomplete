from pydantic import BaseModel, Field

from app.config import get_settings
from app.db.pool import connection


class AppSettings(BaseModel):
    trigger_delay_ms: int = Field(400, ge=150, le=1500)
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


async def load_settings() -> AppSettings:
    async with connection() as conn:
        row = await (await conn.execute(f"SELECT {', '.join(_COLUMNS)} FROM app_settings WHERE id = 1")).fetchone()
    return AppSettings(**(row or {}), retention_days=get_settings().retention_days, store_payloads=False)


async def update_settings(update: AppSettingsUpdate) -> AppSettings:
    changes = update.model_dump(exclude_none=True)
    if changes:
        assignments = ", ".join(f"{column} = %({column})s" for column in changes)
        async with connection() as conn:
            await conn.execute(f"UPDATE app_settings SET {assignments} WHERE id = 1", changes)  # type: ignore[arg-type]
    return await load_settings()
